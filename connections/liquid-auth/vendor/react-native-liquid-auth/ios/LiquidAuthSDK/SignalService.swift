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

import Foundation
import WebRTC

// MARK: - SignalServiceDelegate

protocol SignalServiceDelegate: AnyObject {
    func signalService(_ service: SignalService, didReceiveStatusUpdate title: String, message: String)
}

// MARK: - SignalService

public class SignalService {
    public static let shared = SignalService()

    weak var delegate: SignalServiceDelegate?
    private var signalClient: SignalClient?
    private var peerClient: PeerApi?
    var dataChannel: RTCDataChannel?
    /// All open data channels keyed by label, so a caller can route a message
    /// to a specific named channel (e.g. `ac2-v1` / `ac2-stream`).
    private var namedDataChannels: [String: RTCDataChannel] = [:]
    private var peerConnection: RTCPeerConnection?
    private var dataChannelDelegates: [RTCDataChannel: DataChannelDelegate] = [:]

    private var messageQueue: [String] = []

    private var lastKnownReferer: String?
    private var isDeepLink: Bool = true

    // The `requestId` the live connection is bound to, so a re-attaching app
    // can hydrate which room/peer the background service is connected to. Set
    // by ``connectToPeer`` and cleared by ``stop``.
    private var connectedRequestId: String?

    var currentPeerType: LiquidAuthPeerType? // .offer or .answer

    /// Guards the one-shot `onConnected` callback so it fires exactly once per
    /// `connectToPeer`, when the first data channel reaches the `open` state.
    private var didFireConnected = false

    private init() { }

    // MARK: - Public Methods

    /// Starts the signaling service
    ///
    /// - Parameters:
    ///   - url: The signaling server URL
    ///   - httpClient: URLSession for HTTP communications
    ///   - onPresence: Callback for server-broadcast `presence` updates
    ///   - onSignalingState: Callback for signaling-socket connectivity changes
    public func start(
        url: String,
        httpClient _: URLSession,
        onPresence: (([String: Any]) -> Void)? = nil,
        onSignalingState: ((String) -> Void)? = nil
    ) {
        // Preserve an already-running client so the app re-attaching (e.g. after
        // a relaunch that reconnected to the still-running service) does NOT
        // tear down the live connection the service was keeping alive.
        if signalClient == nil {
            signalClient = SignalClient(url: url, service: self)
        }
        // (Re)bind the persistent-socket callbacks before the socket comes up so
        // the very first presence broadcast / connectivity transition is seen.
        if let onPresence = onPresence {
            signalClient?.onPresence = onPresence
        }
        if let onSignalingState = onSignalingState {
            signalClient?.onSignalingState = onSignalingState
        }
        // Bring the persistent signaling socket up NOW (not lazily on the first
        // peer negotiation) so presence and signaling connectivity flow to the
        // consumer before — and between — p2p negotiations.
        signalClient?.ensureSocket()

        delegate?.signalService(
            self,
            didReceiveStatusUpdate: "Signal Service",
            message: "Service started successfully."
        )
    }

    /// Stops the signaling service and cleans up resources
    func stop() {
        signalClient?.disconnectSocket()
        signalClient = nil
        peerClient = nil
        dataChannel = nil
        connectedRequestId = nil
        namedDataChannels.removeAll()
        peerConnection = nil
        delegate?.signalService(self, didReceiveStatusUpdate: "Signal Service", message: "Service stopped.")
    }

    /// Disconnects from the signaling service
    func disconnect() {
        signalClient?.disconnectSocket()
        delegate?.signalService(
            self,
            didReceiveStatusUpdate: "Signal Service",
            message: "Disconnected from the signaling server."
        )
    }

    /**
     * Re-attach a freshly (re)started app to the ALREADY-live connection without
     * renegotiating. Rebinds the socket/peer callbacks to the new sinks (the old
     * ones referenced a now-dead JS runtime), and re-emits each channel's current
     * state plus the peer's ICE connection state so the consumer hydrates
     * immediately — observers only fire on transitions, so a live-but-unchanged
     * channel would otherwise never notify the fresh listener. Used when
     * ``getConnectionState()`` reports a live peer.
     */
    public func attach(
        onMessage: @escaping (String, String) -> Void,
        onStateChange: @escaping (String, String?) -> Void,
        onPresence: (([String: Any]) -> Void)? = nil,
        onLinkError: ((LinkError) -> Void)? = nil,
        onConnectionStateChange: ((String) -> Void)? = nil,
        onSignalingState: ((String) -> Void)? = nil
    ) {
        // Rebind the live socket/peer callbacks to the new sinks.
        if let onPresence = onPresence {
            signalClient?.onPresence = onPresence
        }
        if let onLinkError = onLinkError {
            signalClient?.onLinkError = onLinkError
        }
        if let onSignalingState = onSignalingState {
            signalClient?.onSignalingState = onSignalingState
        }
        if let onConnectionStateChange = onConnectionStateChange {
            signalClient?.onConnectionStateChange = onConnectionStateChange
            peerClient?.onConnectionStateChange = onConnectionStateChange
        }

        // Re-register the data-channel observers with the fresh message/state
        // sinks.
        for (label, channel) in namedDataChannels {
            let delegate = DataChannelDelegate(
                signalService: self,
                onMessage: { message in onMessage(label, message) },
                onStateChange: { state in onStateChange(label, state) }
            )
            channel.delegate = delegate
            dataChannelDelegates[channel] = delegate

            // Re-emit the current channel state so the re-attached consumer
            // hydrates now (the observers only fire on future transitions).
            onStateChange(label, channel.readyState.stateDescription)
        }

        if let iceState = peerClient?.peerConnection?.iceConnectionState {
            onConnectionStateChange?(iceState.stateDescription)
        }
    }

    /// Abort an in-flight ``connectToPeer`` negotiation without fully stopping
    /// the service. Mirrors `SignalService.cancel()` in the Android SDK.
    public func cancel() {
        signalClient?.cancel()
    }

    // MARK: - Check if the signaling service is initialized

    var isPeerClientInitialized: Bool {
        peerClient != nil
    }

    /// Connects to a peer using WebRTC signaling.
    ///
    /// The parameters mirror the shared "top-level signal client" shape used by
    /// the JavaScript client and the `react-native-liquid-auth` binding: a
    /// `LiquidAuthPeerType`, an optional map of named `dataChannels`, and
    /// channel-labeled message/state callbacks.
    ///
    /// - Parameters:
    ///   - requestId: Unique identifier for the peer connection
    ///   - type: The remote peer type (`.offer` or `.answer`)
    ///   - origin: Origin domain for the connection
    ///   - iceServers: ICE servers for NAT traversal
    ///   - dataChannels: Named data channels to open when acting as the offerer
    ///     (`.answer`). Defaults to a single `liquid` channel.
    ///   - onMessage: Callback for received messages `(channel, message)`
    ///   - onStateChange: Callback for channel state changes `(channel, state)`
    ///   - onLinkError: Callback for a refused `link` (e.g. room full)
    public func connectToPeer(
        requestId: String,
        type: LiquidAuthPeerType,
        origin: String,
        iceServers: [RTCIceServer],
        dataChannels: [String: DataChannelConfig] = DataChannelConfig.defaultChannels,
        onMessage: @escaping (String, String) -> Void,
        onStateChange: @escaping (String, String?) -> Void,
        onLinkError: ((LinkError) -> Void)? = nil,
        onConnected: (() -> Void)? = nil,
        onPresence: (([String: Any]) -> Void)? = nil,
        onConnectionStateChange: ((String) -> Void)? = nil,
        onSignalingState: ((String) -> Void)? = nil
    ) {
        currentPeerType = type
        didFireConnected = false
        connectedRequestId = requestId

        namedDataChannels.removeAll()

        Logger.debug("Attempting to connect to peer with requestId: \(requestId), type: \(type.rawValue)")

        // Ensure the SignalClient exists and is pointing to the right origin
        if signalClient == nil {
            signalClient = SignalClient(url: origin, service: self)
        }
        // Register socket/peer callbacks before connecting so the socket
        // listeners (presence) are attached when the socket is created.
        signalClient?.onPresence = onPresence
        signalClient?.onConnectionStateChange = onConnectionStateChange
        if let onSignalingState = onSignalingState {
            signalClient?.onSignalingState = onSignalingState
        }

        // Wait for socket connection before starting signaling
        signalClient?.onSocketConnected = { [weak self] in
            guard let self else { return }
            Logger.debug("Socket connected, now starting WebRTC signaling.")
            _ = signalClient?.connectToPeer(
                requestId: requestId,
                type: type,
                iceServers: iceServers,
                dataChannels: dataChannels,
                onDataChannelOpen: { [weak self] dataChannel in
                    Logger.debug("SignalService: onDataChannelOpen called with: \(dataChannel.label)")
                    self?.dataChannel = dataChannel
                    self?.namedDataChannels[dataChannel.label] = dataChannel
                    Logger.debug("Data channel is open and ready: \(dataChannel.label)")
                    if dataChannel.readyState == .open {
                        self?.flushMessageQueue()
                    }
                },
                onMessage: { channel, message in
                    onMessage(channel, message)
                },
                onStateChange: { [weak self] channel, state in
                    onStateChange(channel, state)
                    // Resolve the caller's "connected" signal the first time any
                    // channel opens, on either the offerer or responder side.
                    if state == "open", self?.didFireConnected == false {
                        self?.didFireConnected = true
                        onConnected?()
                    }
                },
                onLinkError: onLinkError
            )

            peerClient = signalClient?.peerClient
            peerConnection = peerClient?.peerConnection

            if let peerConnection {
                Logger.debug("Peer connection state: \(peerConnection.connectionState.rawValue)")
            } else {
                Logger.error("Peer connection is nil.")
            }

            delegate?.signalService(
                self,
                didReceiveStatusUpdate: "Peer Connection",
                message: "Connected to peer with request ID: \(requestId)."
            )
        }

        if signalClient?.isSignalingConnected() == true {
            signalClient?.onSocketConnected?()
        } else {
            signalClient?.connectSocket()
        }

        Logger.debug("ICE servers: \(iceServers)")
        Logger.debug("Waiting for socket to connect before signaling.")
    }

    /// Sends a message through the data channel
    ///
    /// - Parameter message: The message to send
    public func sendMessage(_ message: String) {
        if let dataChannel, dataChannel.readyState == .open {
            Logger
                .debug(
                    "SignalService: Sending on channel to \(ObjectIdentifier(dataChannel)) label: \(dataChannel.label)"
                )
            let buffer = RTCDataBuffer(data: message.data(using: .utf8)!, isBinary: false)
            dataChannel.sendData(buffer)
            Logger.info("Message sent: \(message)")
        } else if let signalClient {
            // On the offerer side the primary channel is created locally and is
            // tracked by the peer client rather than `dataChannel`; route
            // through the client so sending works on both sides.
            signalClient.sendData(message)
            Logger.info("Message sent via client: \(message)")
        } else {
            Logger.error("sendMessage: Data channel is not available. Queuing message.")
            messageQueue.append(message)
        }
    }

    /// Sends a message over a specific named data channel.
    ///
    /// Mirrors `sendToChannel(label, message)` in the JavaScript client and the
    /// `react-native-liquid-auth` binding, so a caller can route to `ac2-v1` /
    /// `ac2-stream` / `ac2-heartbeat` independently of the primary channel.
    ///
    /// - Parameters:
    ///   - message: The message to send
    ///   - label: The label of the target data channel
    public func sendMessage(_ message: String, to label: String) {
        if let channel = namedDataChannels[label], channel.readyState == .open {
            let buffer = RTCDataBuffer(data: message.data(using: .utf8)!, isBinary: false)
            channel.sendData(buffer)
            Logger.info("Message sent on \(label): \(message)")
        } else if let signalClient {
            // On the offerer side named channels are created locally and tracked
            // by the peer client; route through the client so sending works on
            // both sides.
            signalClient.sendData(message, to: label)
            Logger.info("Message sent on \(label) via client: \(message)")
        } else {
            Logger.error("sendMessage: Data channel '\(label)' is not available.")
        }
    }

    /// Flushes queued messages when the data channel becomes available
    private func flushMessageQueue() {
        guard let dataChannel else { return }
        for message in messageQueue {
            let buffer = RTCDataBuffer(data: message.data(using: .utf8)!, isBinary: false)
            dataChannel.sendData(buffer)
            Logger.info("Flushed queued message: \(message)")
        }
        messageQueue.removeAll()
    }

    /**
     * Snapshot of the current live connection so a re-attaching app can hydrate
     * its UI (rather than assuming a fresh start). Reports whether a peer
     * connection exists with negotiated channels, its ICE connection state, the
     * `requestId` it is bound to, and each negotiated channel's current state
     * keyed by label. Read-only: this never mutates the connection.
     *
     * `connected` is deliberately STRICT (mirroring the Android SDK): a peer
     * object with a channel map is not proof that anything can travel over it.
     * After a long background the peer can survive as a zombie — the channels
     * still read OPEN while ICE has moved to DISCONNECTED/FAILED — and a
     * consumer that believes such a snapshot re-attaches to a dead link instead
     * of renegotiating (the "stuck reconnecting" class of bug). So we require
     * ICE to be genuinely usable (CONNECTED/COMPLETED) AND at least one
     * negotiated data channel to be OPEN. The raw `iceConnectionState` /
     * `channels` fields are reported unchanged for diagnostics.
     */
    public func getConnectionState() -> [String: Any?] {
        let peer = signalClient?.peerClient
        let channels = namedDataChannels.mapValues { $0.readyState.stateDescription }
        let iceState = peer?.peerConnection?.iceConnectionState
        let iceUsable = iceState == .connected || iceState == .completed
        let anyChannelOpen = namedDataChannels.values.contains { $0.readyState == .open }
        // The last server `presence` broadcast (`{ requestId, deviceCount,
        // online }`), or nil before the first one. The broadcast fired at
        // room join typically lands during service start — before the
        // consumer's JS listener is attached — so the snapshot is the only
        // way a launching app can learn its peer is offline.
        var lastPresence: [String: Any]?
        if let presence = signalClient?.lastPresence {
            let deviceCount = presence["deviceCount"] as? Int ?? 0
            lastPresence = [
                "requestId": presence["requestId"] as? String ?? "",
                "deviceCount": deviceCount,
                "online": presence["online"] as? Bool ?? (deviceCount > 0),
            ]
        }
        return [
            "connected": peer != nil && iceUsable && anyChannelOpen,
            "requestId": connectedRequestId,
            "iceConnectionState": peer?.peerConnection?.iceConnectionState.stateDescription,
            "channels": channels,
            // Whether the persistent signaling socket is currently connected,
            // independent of the p2p state above (data channels deliberately
            // survive signaling disruptions).
            "signalingConnected": signalClient?.isSignalingConnected() ?? false,
            "lastPresence": lastPresence,
        ]
    }
}

// MARK: - RTCDataChannelState description

extension RTCDataChannelState {
    /// Uppercase state name matching the Android SDK's
    /// `DataChannel.State.toString()` (`CONNECTING`/`OPEN`/`CLOSING`/`CLOSED`),
    /// so the `onStateChange` payload is identical across platforms.
    var stateDescription: String {
        switch self {
        case .connecting: return "CONNECTING"
        case .open: return "OPEN"
        case .closing: return "CLOSING"
        case .closed: return "CLOSED"
        @unknown default: return "UNKNOWN"
        }
    }
}
