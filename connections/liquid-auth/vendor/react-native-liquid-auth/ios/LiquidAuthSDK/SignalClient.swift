/*
 * Copyright 2025 Algorand Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import CoreImage
import SocketIO
import WebRTC

// MARK: - SignalClient

public class SignalClient {
    private let manager: SocketManager
    private let socket: SocketIOClient
    weak var service: SignalService?
    private var sdpHandler: ((String) -> Void)?
    var peerClient: PeerApi?
    private var candidatesBuffer: [RTCIceCandidate] = []
    private var eventQueue: [(String, QueuedEventData)] = []
    private var dataChannelDelegates: [RTCDataChannel: DataChannelDelegate] = [:]
    var onLinkError: ((LinkError) -> Void)?
    var onSocketConnected: (() -> Void)?
    /// Signaling-socket connectivity changes (`"connected"` / `"disconnected"`),
    /// including socket.io auto-reconnects. Lets consumers surface a
    /// "signaling offline" state that is independent of the p2p connection —
    /// the data channels deliberately survive signaling disruptions.
    var onSignalingState: ((String) -> Void)?
    /// Server-broadcast `presence` updates for the current `requestId` room
    /// (`{ requestId, deviceCount, online }`). Set before ``connectToPeer`` so
    /// the socket listener is registered when the socket is created. Mirrors
    /// `SignalClient.onPresence` in the Android SDK.
    var onPresence: (([String: Any]) -> Void)?
    /// The most recent server `presence` broadcast, cached so a consumer that
    /// (re)attaches AFTER the broadcast fired can still read it (via
    /// ``SignalService/getConnectionState()``). The server broadcasts presence
    /// when this socket joins the `requestId` room — during service start,
    /// before the consumer's JS listener is attached — and then stays silent
    /// until a device joins or leaves, so without this cache a launch against
    /// an offline peer never learns the peer is absent. Cleared on an explicit
    /// ``disconnectSocket()``; kept across socket blips (the server
    /// rebroadcasts on reconnect, overwriting it). Mirrors
    /// `SignalClient.lastPresence` in the Android SDK.
    private(set) var lastPresence: [String: Any]?
    /// Forwarded to ``PeerApi/onConnectionStateChange`` when the peer is created,
    /// so callers can observe ICE connection state without a native handle.
    var onConnectionStateChange: ((String) -> Void)?
    /// Re-emits the pending `offer-description` until the peer answers. The
    /// signaling server only relays the offer to peers ALREADY in the room, so
    /// a peer that (re)joins moments after the first emit (the classic
    /// agent-restart race) would otherwise never see it and the negotiation
    /// would stall until the caller's deadline. The remote waits with a
    /// one-shot listener, so duplicates are harmless. Main-queue timer; see
    /// ``startOfferResend(sdp:)``.
    private var offerResendTimer: Timer?
    private static let offerResendInterval: TimeInterval = 5

    init(url: String, service: SignalService) {
        self.service = service

        // Initialize the Socket.IO manager and client. Callers pass a full
        // origin (`https://debug.liquidauth.com`) — the same value the Android
        // client feeds `IO.socket(url)` verbatim. Only prepend a scheme when
        // one is missing (the upstream liquid-auth-ios SDK took a bare host):
        // blindly prefixing produced `https://https://…`, whose "hostname"
        // is `https` — the socket then dies with "A server with the specified
        // hostname could not be found" and the wallet never reaches signaling.
        let socketOrigin =
            url.hasPrefix("https://") || url.hasPrefix("http://") ? url : "https://\(url)"
        manager = SocketManager(socketURL: URL(string: socketOrigin)!, config: [.log(false), .compress])
        socket = manager.defaultSocket

        // Set up event listeners
        setupSocketListeners()
    }

    /// Whether the signaling socket is currently connected.
    func isSignalingConnected() -> Bool {
        return socket.status == .connected
    }

    /// Create the signaling socket if none exists yet, or (re)connect the
    /// existing one. The socket is PERSISTENT: it is reused across peer
    /// negotiations (and across [cancel]) so `presence` broadcasts keep flowing
    /// between chats — it is only torn down by an explicit [disconnectSocket].
    func ensureSocket() {
        if socket.status != .connected && socket.status != .connecting {
            Logger.debug("SignalClient: Socket is not connected. Attempting to connect...")
            socket.connect()
        }
    }

    // swiftlint:disable:next function_body_length
    public func connectToPeer(
        requestId: String,
        type: LiquidAuthPeerType,
        iceServers: [RTCIceServer],
        dataChannels: [String: DataChannelConfig] = DataChannelConfig.defaultChannels,
        onDataChannelOpen: @escaping (RTCDataChannel) -> Void,
        onMessage: @escaping (String, String) -> Void,
        onStateChange: @escaping (String, String?) -> Void,
        onLinkError: ((LinkError) -> Void)? = nil
    ) -> RTCDataChannel? {
        ensureSocket()

        // Clean up any existing peer connection
        peerClient?.close()
        peerClient = nil

        // The socket is persistent across negotiations, so clear any
        // listeners a previous (cancelled/failed) negotiation left
        // behind before re-registering this run's own.
        detachNegotiationListeners()

        self.onLinkError = onLinkError
        installLinkErrorListeners(requestId: requestId)

        Logger.debug("SignalClient: Attempting to connect to peer with requestId: \(requestId), type: \(type.rawValue)")

        // Listen for Remote ICE Candidates
        socket.on("candidate") { [weak self] data, _ in
            guard let self, let eventData = data.first as? [String: Any] else { return }
            self.handleIceCandidate(eventData)
        }
        socket.on("offer-candidate") { [weak self] data, _ in
            guard let self, let eventData = data.first as? [String: Any] else { return }
            self.handleIceCandidate(eventData)
        }
        socket.on("answer-candidate") { [weak self] data, _ in
            guard let self, let eventData = data.first as? [String: Any] else { return }
            self.handleIceCandidate(eventData)
        }

        peerClient = PeerApi(
            iceServers: iceServers,
            poolSize: 10,
            signalService: service,
            onDataChannel: { [weak self] dataChannel in
                Logger.debug("SignalClient: onDataChannel called with: \(dataChannel.label)")
                Logger.debug("Received data channel from remote peer: \(dataChannel.label)")
                let label = dataChannel.label
                let delegate = DataChannelDelegate(
                    signalService: self?.service,
                    onMessage: { message in
                        Logger.info("💬 SignalClient: Received message on \(label): \(message)")
                        onMessage(label, message)
                    },
                    onStateChange: { state in
                        Logger.debug("SignalClient: Data channel \(label) state changed: \(state ?? "unknown")")
                        onStateChange(label, state)
                        if state == "open" {
                            Logger.info("✅ SignalClient: Open and ready: \(label)")
                            Logger
                                .debug(
                                    "SignalService: Setting dataChannel to " +
                                        "\(ObjectIdentifier(dataChannel)) label: \(label)"
                                )
                            onDataChannelOpen(dataChannel)
                        }
                    },
                    onChannelAvailable: { [weak self] channel in
                        if self?.service?.dataChannel !== channel {
                            Logger
                                .debug(
                                    "SignalClient: Setting dataChannel from " +
                                        "didReceiveMessageWith: \(ObjectIdentifier(channel))"
                                )
                            self?.service?.dataChannel = channel
                        }
                    }
                )
                dataChannel.delegate = delegate
                self?.dataChannelDelegates[dataChannel] = delegate
                Logger.debug("SignalClient: DataChannelDelegate assigned to remote data channel: \(label)")

                if dataChannel.readyState == .open {
                    Logger.info("✅ SignalClient: Open and ready (immediate): \(label)")
                    Logger
                        .debug(
                            "SignalService: Setting dataChannel to " +
                                "\(ObjectIdentifier(dataChannel)) label: \(label)"
                        )
                    onDataChannelOpen(dataChannel)
                }
            },
            onIceCandidate: { [weak self] candidate in
                guard let self else { return }
                Logger.debug("Generated ICE candidate: \(candidate)")
                let candidateEvent = (type == .offer) ? "answer-candidate" : "offer-candidate"
                send(event: candidateEvent, data: [
                    "candidate": candidate.sdp,
                    "sdpMid": candidate.sdpMid ?? "",
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                ])
            }
        )

        peerClient?.onConnectionStateChange = onConnectionStateChange

        if peerClient?.peerConnection != nil {
            Logger.info("SignalClient: Peer connection created successfully.")
        } else {
            Logger.error("SignalClient: Failed to create peer connection!")
        }

        if type == .answer {
            // Initiator logic (creates and sends offer)
            Logger.info("Answer (initiator): sending link request")
            send(event: "link", data: ["requestId": requestId])

            // Listen for the answer-description event (only for initiator)
            socket.on("answer-description") { [weak self] data, _ in
                guard let self else { return }
                if let eventData = data.first as? [String: Any] {
                    self.handleAnswerDescription(eventData)
                } else if let sdp = data.first as? String {
                    self.handleAnswerDescription(sdp)
                }
            }

            guard let peerClient, peerClient.peerConnection != nil else {
                Logger.error("PeerClient or its peerConnection is nil!")
                return nil
            }

            // Open every requested named data channel (defaulting to a single
            // `liquid` channel), mirroring `SignalClient.peer()`'s
            // `options.dataChannels` map in the JavaScript client. The `liquid`
            // channel (or the first one created) is returned as the primary.
            let channels = dataChannels.isEmpty ? DataChannelConfig.defaultChannels : dataChannels
            var primaryChannel: RTCDataChannel?
            // Create in explicit `order` (then by label for determinism):
            // dictionary iteration order is arbitrary, but the remote peer
            // receives channels in creation order and the AC2 agent requires
            // the control channel (`ac2-v1`, order 0) to arrive first.
            let orderedChannels = channels.sorted { lhs, rhs in
                let l = lhs.value.order ?? Int.max
                let r = rhs.value.order ?? Int.max
                return l != r ? l < r : lhs.key < rhs.key
            }
            for (label, config) in orderedChannels {
                let channel = peerClient.createDataChannel(
                    label: label,
                    config: config,
                    onMessage: { message in onMessage(label, message) },
                    onStateChange: { state in onStateChange(label, state) }
                )
                if label == "liquid" || primaryChannel == nil {
                    primaryChannel = channel
                }
            }

            peerClient.createOffer { offer in
                guard let offer else {
                    Logger.error("Failed to create offer: Offer is nil")
                    return
                }
                Logger.info("Answer (initiator): Setting local description")
                peerClient.setLocalDescription(offer) { error in
                    if let error {
                        Logger.error("Failed to set local description: \(error)")
                    } else {
                        Logger.debug("Answer (initiator): Sending offer description")
                        self.send(event: "offer-description", sdp: offer.sdp)
                        self.startOfferResend(sdp: offer.sdp)
                    }
                }
            }
            return primaryChannel
        } else if type == .offer {
            // Responder logic (waits for offer, then sends answer)
            Logger.info("Offer (responder): Waiting for remote offer")
            send(event: "link", data: ["requestId": requestId])

            // Listen for the offer-description event (only for responder).
            // The JavaScript SignalClient (and the Android client) emit the
            // SDP as a RAW STRING — accept both that and the legacy
            // `{sdp, type}` dictionary. Dropping the string form silently is
            // what left iOS deaf to the agent's offer while Android paired.
            socket.on("offer-description") { [weak self] data, _ in
                guard let self else { return }
                if let eventData = data.first as? [String: Any] {
                    self.handleOfferDescription(eventData)
                } else if let sdp = data.first as? String {
                    self.handleOfferDescription(sdp)
                } else {
                    Logger.error("offer-description payload has unexpected shape")
                }
            }
            return nil
        }
        return nil
    }

    // MARK: - Connect to the Socket.IO Server

    func connectSocket() {
        ensureSocket()
    }

    func disconnectSocket() {
        stopOfferResend()
        socket.disconnect()
        peerClient?.close()
        peerClient = nil
        lastPresence = nil
        handleDisconnect()
    }

    /// Abort an in-flight negotiation: cancel the negotiation, and destroy the
    /// peer connection.
    ///
    /// Deliberately does NOT touch the signaling socket. Cancelling used to run
    /// a full [disconnectSocket], which closed the socket while the service
    /// kept this client instance alive — so no further `presence` broadcasts
    /// could ever arrive, and a consumer waiting for the peer to come back
    /// online (presence-gated renegotiation) was left permanently deaf. The
    /// socket must outlive the peer: it is the persistent presence/rendezvous
    /// plane; only [disconnectSocket] (an explicit stop) tears it down.
    func cancel() {
        stopOfferResend()
        peerClient?.close()
        peerClient = nil
        // Drop this negotiation's socket listeners (candidates + the one-shot
        // description waiters) so a stray late frame can't hit a destroyed
        // peer, and the next negotiation on the SAME socket starts clean.
        detachNegotiationListeners()
        candidatesBuffer.removeAll()
    }

    /// Re-emit the pending offer on an interval until the peer answers, so a
    /// peer that joined the `requestId` room AFTER the first emit (e.g. an
    /// agent that just restarted) still receives it instead of leaving the
    /// negotiation to stall out its deadline. The timer self-terminates once
    /// the answer is applied (the signaling state leaves `haveLocalOffer`) or
    /// the peer is destroyed, and is stopped explicitly by
    /// ``stopOfferResend()`` on answer/cancel/disconnect.
    private func startOfferResend(sdp: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            offerResendTimer?.invalidate()
            offerResendTimer = Timer.scheduledTimer(
                withTimeInterval: Self.offerResendInterval,
                repeats: true
            ) { [weak self] timer in
                guard let self, self.peerClient?.peerConnection?.signalingState == .haveLocalOffer else {
                    timer.invalidate()
                    return
                }
                Logger.debug("Re-emitting offer-description (no answer yet)")
                send(event: "offer-description", sdp: sdp)
            }
        }
    }

    private func stopOfferResend() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            offerResendTimer?.invalidate()
            offerResendTimer = nil
        }
    }

    /// Remove the per-negotiation socket listeners (``connectToPeer`` re-registers
    /// them on each run). The persistent listeners (`presence`, `exception`, socket
    /// connectivity) registered in ``setupSocketListeners`` are left untouched.
    private func detachNegotiationListeners() {
        socket.off("offer-candidate")
        socket.off("answer-candidate")
        socket.off("offer-description")
        socket.off("answer-description")
        socket.off("candidate")
        socket.off("link-error")
        socket.off("exception")
    }

    private func handleDisconnect() {
        Logger.debug("Handling Socket.IO disconnection...")
        // peerClient?.close()
        // peerClient = nil
    }

    // MARK: - Link Error Handling

    /// Listen for a refused `link` so callers can fast-fail with a typed
    /// ``LinkError`` instead of waiting out a negotiation timeout. Mirrors the
    /// JavaScript client, which races the `link` ack against a `requestId`-scoped
    /// `exception` carrying `event: "link-error"`.
    private func installLinkErrorListeners(requestId: String) {
        socket.off("link-error")
        socket.on("link-error") { [weak self] data, _ in
            guard let self, let eventData = data.first as? [String: Any] else { return }
            Logger.error("SignalClient: Received link-error: \(eventData)")
            handleLinkError(eventData, expectedRequestId: requestId)
        }

        socket.off("exception")
        socket.on("exception") { [weak self] data, _ in
            guard let self, let eventData = data.first as? [String: Any] else { return }
            // The server delivers a refusal as a generic `exception` carrying
            // `event: "link-error"`; filter the same shape the JS client does.
            guard (eventData["event"] as? String) == "link-error" else { return }
            Logger.error("SignalClient: Received link-error via exception: \(eventData)")
            handleLinkError(eventData, expectedRequestId: requestId)
        }
    }

    private func handleLinkError(_ data: [String: Any], expectedRequestId: String) {
        let rawReason = data["reason"] as? String
        let receivedRequestId = data["requestId"] as? String
        // Only surface refusals scoped to this negotiation's requestId (or those
        // that omit it), matching the JS client's requestId-scoped filtering.
        if let receivedRequestId, receivedRequestId != expectedRequestId { return }
        let message = data["message"] as? String
        let error = LinkError(
            reason: rawReason.flatMap { LinkErrorReason(rawValue: $0) },
            rawReason: rawReason,
            requestId: receivedRequestId ?? expectedRequestId,
            message: message
        )
        onLinkError?(error)
    }

    // MARK: - Send Data Channel Messages

    /// Send a string over the primary (`liquid`) data channel.
    func sendData(_ message: String) {
        peerClient?.send(message)
    }

    /// Send a string over a specific named data channel.
    func sendData(_ message: String, to label: String) {
        peerClient?.send(message, to: label)
    }

    // MARK: - Set Up Socket.IO Listeners

    private func setupSocketListeners() {
        socket.on(clientEvent: .connect) { _, _ in
            Logger.debug("Socket.IO connected")
            self.onSignalingState?("connected")
            self.onSocketConnected?()
            self.processEventQueue()
        }

        socket.on(clientEvent: .disconnect) { _, _ in
            Logger.debug("Socket.IO disconnected")
            self.onSignalingState?("disconnected")
            self.handleDisconnect()
        }

        socket.on("presence") { [weak self] data, _ in
            guard let self, let eventData = data.first as? [String: Any] else { return }
            Logger.debug("Received presence: \(eventData)")
            // Cache before forwarding so getConnectionState() reflects this
            // broadcast even when no consumer listener is attached yet.
            lastPresence = eventData
            onPresence?(eventData)
        }

        socket.on("link-response") { data, _ in
            Logger.debug("Received link response: \(data)")
        }

        socket.on("error") { data, _ in
            Logger.error("Socket.IO error: \(data)")
        }
    }

    // MARK: - Handle WebSocket Messages

    private func handleOfferDescription(_ data: [String: Any]) {
        guard let sdp = data["sdp"] as? String else {
            Logger.error("Received SDP is missing or invalid.")
            return
        }
        // Tolerate a missing `type` — on this listener it is always an offer.
        let type = sdpType(from: data["type"] as? String) ?? .offer
        applyRemoteOffer(RTCSessionDescription(type: type, sdp: sdp))
    }

    /// Raw-string variant: the wire format the JavaScript and Android clients
    /// actually emit (`socket.emit('offer-description', sdp)`).
    private func handleOfferDescription(_ sdp: String) {
        applyRemoteOffer(RTCSessionDescription(type: .offer, sdp: sdp))
    }

    private func applyRemoteOffer(_ sessionDescription: RTCSessionDescription) {
        if peerClient?.peerConnection?.signalingState == .haveLocalOffer {
            Logger.error("applyRemoteOffer: cannot set remote offer while in have-local-offer state")
            return
        }

        Logger.debug("Setting remote description with session description: \(sessionDescription)")

        peerClient?.setRemoteDescription(sessionDescription, completion: { error in
            if let error {
                Logger.error("Failed to set remote description: \(error)")
            } else {
                Logger.debug("Remote description set successfully.")
                self.processBufferedCandidates()
                self.peerClient?.createAnswer { answer in
                    guard let answer else {
                        Logger.error("Failed to create answer: Answer is nil")
                        return
                    }
                    self.peerClient?.setLocalDescription(answer) { error in
                        if let error {
                            Logger.error("Failed to set local description: \(error)")
                        } else {
                            Logger.debug("Local description set successfully.")
                            // Raw string, matching the JavaScript client's
                            // `socket.once('answer-description', (sdp: string))`
                            // — a `{sdp:}` dictionary is unparseable there.
                            self.send(event: "answer-description", sdp: answer.sdp)
                        }
                    }
                }
            }
        })
    }

    private func handleAnswerDescription(_ data: [String: Any]) {
        // The peer answered: stop re-emitting the offer.
        stopOfferResend()
        guard let sdp = data["sdp"] as? String,
              let type = sdpType(from: data["type"] as? String)
        else {
            Logger.error("Received SDP is missing or invalid.")
            return
        }
        Logger.debug("handleAnswerDescription: Received SDP: \(type) : \(sdp)")
        let sessionDescription = RTCSessionDescription(type: type, sdp: sdp)

        if peerClient?.peerConnection?.signalingState != .haveLocalOffer {
            Logger.error("Cannot set remote answer unless in have-local-offer state")
            return
        }

        peerClient?.setRemoteDescription(sessionDescription, completion: { error in
            if let error {
                Logger.error("Failed to set remote description: \(error)")
            } else {
                self.processBufferedCandidates()
            }
        })
    }

    private func handleAnswerDescription(_ sdp: String) {
        // The peer answered: stop re-emitting the offer.
        stopOfferResend()
        // If you know this is always an answer, you can hardcode the type
        let sessionDescription = RTCSessionDescription(type: .answer, sdp: sdp)

        if peerClient?.peerConnection?.signalingState != .haveLocalOffer {
            Logger.error("Cannot set remote answer unless in have-local-offer state")
            return
        }

        Logger.debug("handleAnswerDescription SDP: Setting remote description with session description.")
        peerClient?.setRemoteDescription(sessionDescription, completion: { error in
            if let error {
                Logger.error("Failed to set remote description: \(error)")
            } else {
                self.processBufferedCandidates()
            }
        })
    }

    private func handleIceCandidate(_ data: [String: Any]) {
        guard let candidate = data["candidate"] as? String,
              let sdpMid = data["sdpMid"] as? String,
              let sdpMLineIndex = data["sdpMLineIndex"] as? Int else { return }
        let iceCandidate = RTCIceCandidate(sdp: candidate, sdpMLineIndex: Int32(sdpMLineIndex), sdpMid: sdpMid)
        Logger.debug("Adding ICE candidate: \(iceCandidate)")

        if let peerConnection = peerClient?.peerConnection {
            // Only add if remote description is set
            if peerConnection.remoteDescription != nil {
                peerConnection.add(iceCandidate, completionHandler: { error in
                    if let error {
                        Logger.error("handleIceCandidate: Failed to add ICE candidate: \(error)")
                    } else {
                        Logger.debug("handleIceCandidate: ICE candidate added successfully.")
                    }
                })
            } else {
                Logger.debug("Remote description not set yet, buffering ICE candidate.")
                candidatesBuffer.append(iceCandidate)
            }
        } else {
            candidatesBuffer.append(iceCandidate)
        }
    }

    // Process buffered ICE candidates once the peer connection is ready
    private func processBufferedCandidates() {
        guard let peerConnection = peerClient?.peerConnection else { return }
        for iceCandidate in candidatesBuffer {
            peerConnection.add(iceCandidate, completionHandler: { error in
                if let error {
                    Logger.error("processBufferedCandidates: Failed to add ICE candidate: \(error)")
                } else {
                    Logger.debug("processBufferedCandidates: ICE candidate added successfully.")
                }
            })
        }
        candidatesBuffer.removeAll()
    }

    // MARK: - Send Events to the Server, wth Swift Dictionary/JSON Encoding

    func send(event: String, data: [String: Any]) {
        if socket.status == .connected {
            Logger.debug("Emitting event immediately: \(event) with data: \(data)")
            socket.emit(event, data)
        } else {
            Logger.debug("Socket not connected. Queuing event: \(event)")
            eventQueue.append((event, .dictionary(data)))
        }
    }

    // Send event with data as a pure string
    func send(event: String, sdp: String) {
        if socket.status == .connected {
            Logger.debug("Emitting event immediately: \(event) with SDP string")
            socket.emit(event, sdp)
        } else {
            Logger.debug("Socket not connected. Queuing event: \(event)")
            eventQueue.append((event, .string(sdp)))
        }
    }

    private func processEventQueue() {
        guard socket.status == .connected else { return }
        Logger.debug("Processing event queue. Number of queued events: \(eventQueue.count)")
        for (event, data) in eventQueue {
            switch data {
            case let .dictionary(dict):
                Logger.debug("Emitting queued event: \(event) with data: \(dict)")
                socket.emit(event, dict)
            case let .string(sdp):
                Logger.debug("Emitting queued event: \(event) with SDP string")
                socket.emit(event, sdp)
            }
        }
        eventQueue.removeAll()
    }
}

private func sdpType(from typeString: String?) -> RTCSdpType? {
    switch typeString {
    case "offer": .offer
    case "answer": .answer
    case "pranswer": .prAnswer
    case "rollback": .rollback
    default: nil
    }
}

private func stringFromSdpType(_ type: RTCSdpType) -> String {
    switch type {
    case .offer: return "offer"
    case .answer: return "answer"
    case .prAnswer: return "pranswer"
    case .rollback: return "rollback"
    @unknown default: return ""
    }
}

// MARK: - QueuedEventData

private enum QueuedEventData {
    case dictionary([String: Any])
    case string(String)
}
