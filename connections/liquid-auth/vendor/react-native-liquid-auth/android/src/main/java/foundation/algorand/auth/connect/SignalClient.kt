package foundation.algorand.auth.connect

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.webrtc.PeerConnection
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaStreamTrack
import org.webrtc.SessionDescription
import qrcode.QRCode
import qrcode.color.Colors
import java.io.ByteArrayOutputStream
import java.util.*
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine


/**
 * Signal Client
 *
 * Has two modes:
 * - Offer: Create a Peer Offer
 * - Answer: Create a Peer Answer
 */
class SignalClient(
    /**
     * Origin of the Service
     */
    override val url: String,
    /**
     * Android Context
     */
    override val context: Context,
    /**
     * HTTP Client
     */
    override val client: OkHttpClient,
) : SignalInterface {
    companion object {
        const val TAG = "connect.SignalClient"

        /**
         * How often the answer-mode peer re-emits its `offer-description`
         * while waiting for the remote `answer-description`. The signaling
         * server only relays the offer to peers ALREADY in the room, so a
         * remote that (re)joins moments after the first emit (the classic
         * agent-restart race) would otherwise never see it and the
         * negotiation would stall until the caller's deadline. The remote
         * waits with a one-shot listener, so duplicates are harmless.
         */
        const val OFFER_RESEND_INTERVAL_MS = 5_000L

        fun generateRequestId(): String {
            return SignalInterface.generateRequestId()
        }
    }

    var type: String? = null
    override var socket: Socket? = null
    var peerClient: PeerApi? = null
    private val scope = CoroutineScope(Dispatchers.Main)

    /**
     * Server-broadcast `presence` updates for the current `requestId` room
     * (`{ requestId, deviceCount, online }`). Set before [peer] so the listener
     * is registered when the socket is created.
     */
    var onPresence: ((JSONObject) -> Unit)? = null

    /**
     * The most recent server `presence` broadcast, cached so a consumer that
     * (re)attaches AFTER the broadcast fired can still read it (via
     * [SignalService.getConnectionState]). The server broadcasts presence when
     * this socket joins the `requestId` room — during service start, before
     * the consumer's JS listener is attached — and then stays silent until a
     * device joins or leaves, so without this cache a launch against an
     * offline peer never learns the peer is absent. Cleared on an explicit
     * [disconnect]; kept across socket blips (the server rebroadcasts on
     * reconnect, overwriting it).
     */
    var lastPresence: JSONObject? = null
        private set

    /**
     * Signaling `exception` events (e.g. a `link-error` room refusal under the
     * two-peer lockdown, carrying `event`/`reason`/`requestId`). Set before
     * [peer] so the listener is registered when the socket is created.
     */
    var onLinkError: ((JSONObject) -> Unit)? = null

    /**
     * Forwarded to [PeerApi.onConnectionStateChange] when the peer is created,
     * so callers can observe ICE connection state without a native handle.
     */
    var onConnectionStateChange: ((String) -> Unit)? = null

    /**
     * Signaling-socket connectivity changes (`"connected"` / `"disconnected"`),
     * including socket.io auto-reconnects. Lets consumers surface a
     * "signaling offline" state that is independent of the p2p connection —
     * the data channels deliberately survive signaling disruptions.
     */
    var onSignalingState: ((String) -> Unit)? = null

    // In-flight negotiation bookkeeping, so [cancel] can abort a pending [peer].
    private var peerJob: Job? = null
    private var peerContinuation: Continuation<DataChannel?>? = null
    private var peerResumed = false

    /**
     * Resume the pending [peer] continuation at most once with [result].
     */
    private fun resumePeer(result: DataChannel?) {
        if (peerResumed) return
        peerResumed = true
        val continuation = peerContinuation
        peerContinuation = null
        continuation?.resume(result)
    }

    /**
     * Fail the pending [peer] continuation at most once with [error].
     */
    private fun failPeer(error: Throwable) {
        if (peerResumed) return
        peerResumed = true
        val continuation = peerContinuation
        peerContinuation = null
        continuation?.resumeWithException(error)
    }

    /**
     * Abort an in-flight (or established) [peer] negotiation: cancel the
     * negotiation coroutine, fail the pending continuation with a
     * [CancellationException] so the caller unblocks promptly, and destroy the
     * peer connection.
     *
     * Deliberately does NOT touch the signaling socket. Cancelling used to run
     * a full [disconnect], which closed the socket while [SignalService.start]
     * kept this client instance alive — so no further `presence` broadcasts
     * could ever arrive, and a consumer waiting for the peer to come back
     * online (presence-gated renegotiation) was left permanently deaf. The
     * socket must outlive the peer: it is the persistent presence/rendezvous
     * plane; only [disconnect] (an explicit stop) tears it down.
     */
    fun cancel() {
        peerJob?.cancel()
        peerJob = null
        failPeer(CancellationException("Peer negotiation cancelled"))
        // Drop this negotiation's socket listeners (candidates + the one-shot
        // description waiters) so a stray late frame can't hit a destroyed
        // peer, and the next negotiation on the SAME socket starts clean.
        detachNegotiationListeners()
        peerClient?.destroy()
        peerClient = null
    }

    /**
     * Remove the per-negotiation socket listeners ([peer] re-registers them on
     * each run). The persistent listeners (`presence`, `exception`, socket
     * connectivity) registered in [ensureSocket] are left untouched.
     */
    private fun detachNegotiationListeners() {
        socket?.off("offer-candidate")
        socket?.off("answer-candidate")
        socket?.off("offer-description")
        socket?.off("answer-description")
    }

    /**
     * Generate a random Request ID
     */
    override fun generateRequestId(): String {
        return SignalClient.generateRequestId()
    }

    /**
     * Generate a QR Code
     */
    override fun qrCode(
        requestId: String,
        logo: Bitmap?,
        logoSize: Int?,
        color: String?,
        backgroundColor: String?,
        ): Bitmap {
        val size = logoSize ?: 200
        val scaledLogo = logo?.let { Bitmap.createScaledBitmap(it, size, size, false) }
        val stream = ByteArrayOutputStream()
        scaledLogo?.compress(Bitmap.CompressFormat.PNG, 100, stream)
        val data = "liquid://${url.replace("https://", "")}/?requestId=$requestId"
        val image = QRCode.ofSquares()
            .withColor(Colors.css(color ?: "#9966FF"))
            .withBackgroundColor(Colors.css(backgroundColor ?: "#15121B"))
            .withLogo(stream.toByteArray(), size, size)
            .build(data)
            .render()
            .nativeImage()
        if (image !is Bitmap) {
            throw Exception("Invalid Type")
        }
        return image
    }

    /**
     * Top Level Peer Connection
     *
     * The type parameter is used to specify the type of remote peer
     */
    override suspend fun peer(
        requestId: String,
        type: String,
        iceServers: List<PeerConnection.IceServer>?,
        dataChannels: Map<String, DataChannel.Init>?,
        tracks: List<MediaStreamTrack>?
    ): DataChannel? {
        ensureSocket()
        return suspendCoroutine { continuation ->
            peerContinuation = continuation
            peerResumed = false
            peerJob = scope.launch {
                val clientType = if (type == "offer") "answer" else "offer"
                // The socket is persistent across negotiations, so clear any
                // listeners a previous (cancelled/failed) negotiation left
                // behind before re-registering this run's own.
                detachNegotiationListeners()
                // Destroy any peer a previous negotiation left behind BEFORE
                // replacing it (mirrors the iOS SignalClient). Overwriting the
                // reference alone leaks the old PeerApi (its PeerConnectionFactory
                // and native threads are never reclaimed) and leaves its
                // observers attached, so the dying peer's label-keyed state
                // events would be mis-delivered into THIS negotiation's
                // channels. destroy() detaches observers first, so the old peer
                // goes silent (see PeerApi.destroy).
                peerClient?.destroy()
                peerClient = PeerApi(context)
                peerClient?.onConnectionStateChange = onConnectionStateChange
                // Note: the peer continuation is resumed at most once via
                // resumePeer(), even though several remote data channels can
                // arrive when the peer opens multiple channels.
                // Buffer ICE Candidates if they arrive before the Peer Connection is established
                val candidatesBuffer = mutableListOf<IceCandidate>()
                // If we are waiting on an offer, create a link to the address
                if(type == "offer"){
                    link(requestId)
                } else {
                    // Offerer path: bind this requestId to the (already
                    // authenticated) server-side session BEFORE any signaling.
                    // The server routes offer/answer descriptions to the room
                    // named by the session's persisted requestId, so a session
                    // that authenticated for ANOTHER connection at the same
                    // origin must be re-bound here or the offer is routed to
                    // the wrong room. This re-bind is what lets one origin
                    // session be shared by all of its connections — switching
                    // connections needs no fresh passkey assertion. Emitted
                    // fire-and-forget: the server only acks a `link` once the
                    // peer's `auth` event fires (potentially never while the
                    // peer is offline), and the offer resend loop below
                    // already tolerates a slow re-bind.
                    emitLink(requestId)
                }
                // Listen to Remote ICE Candidates
                socket!!.on("${type}-candidate") {
                    Log.d(
                        TAG,
                        "onIce${type.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }}Candidate(${it[0]})"
                    )
                    val candidate = it[0] as JSONObject
                    // Buffer Candidates if the Peer Connection is not established
                    if (peerClient!!.peerConnection === null) {
                        candidatesBuffer.add(candidate.toIceCandidate())
                    } else {
                        peerClient?.addIceCandidate(candidate.toIceCandidate())
                    }
                }
                // Create Peer Connection
                peerClient!!.createPeerConnection(
                    // Handle Local ICECandidates
                    { iceCandidate ->
                        Log.d(
                            TAG,
                            "onIce${clientType.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }}Candidate(${iceCandidate.toJSON()})"
                        )
                        // Send Local ICECandidates to Peer
                        socket?.emit("${clientType}-candidate", iceCandidate.toJSON())
                    },{
                        // Handle a Data Channel from the Peer
                        // This only happens for a client that creates an Answer,
                        // Offer clients are responsible for creating a datachannel.
                        // A peer can open several named channels; resume with the
                        // first one (preferring `liquid`), and let the remaining
                        // channels populate `peerClient.dataChannels`.
                        resumePeer(it)
                    },
                    iceServers
                )

                // Add any local media tracks before negotiation begins
                tracks?.forEach { track ->
                    peerClient?.addTrack(track)
                }

                // Wait for Offer, then create Answer
                if (type == "offer") {
                    val sdp = signal(type)
                     Log.d(TAG, "Recieved the SDP!(${sdp})")
                    peerClient?.setRemoteDescription(sdp)
                    Log.d(TAG, "Set the SDP!(${sdp})")
                    if(candidatesBuffer.isNotEmpty()){
                        candidatesBuffer.forEach { candidate ->
                            peerClient?.addIceCandidate(candidate)
                        }
                    }
                    peerClient?.createAnswer { answerDescription ->
                        peerClient!!.setLocalDescription(answerDescription!!) { hasDescription ->
                            if(hasDescription === null) {
                                throw Exception("Failed to set local description")
                            }
                        }
                        Log.d(TAG, "createAnswer(${answerDescription.description})")
                        socket!!.emit("answer-description", answerDescription.description.toString())
                    }

                }
                // Create an Offer, wait for answer
                else if (type == "answer") {
                    // Create the DataChannel(s). Defaults to a single `liquid`
                    // channel, but callers may request several named channels.
                    val channelConfig = if (dataChannels.isNullOrEmpty()) {
                        mapOf("liquid" to DataChannel.Init())
                    } else {
                        dataChannels
                    }
                    val channels = mutableMapOf<String, DataChannel>()
                    channelConfig.forEach { (label, init) ->
                        peerClient?.createDataChannel(label, init)?.let { channels[label] = it }
                    }
                    // Prefer the `liquid` channel, otherwise fall back to the first
                    val dc = channels["liquid"] ?: channels.values.firstOrNull()
                    // Create the Peering Offer
                    val offer = peerClient?.createOffer()
                    peerClient?.setLocalDescription(offer!!) {
                        if(it === null) {
                            throw Exception("Failed to set local description")
                        }
                    }
                    Log.d(TAG, "peer.createOffer(${offer?.description})")
                    socket!!.emit("offer-description", offer?.description.toString())
                    // Re-emit the offer until the answer arrives, so a remote
                    // peer that joined the room AFTER the first emit (e.g. an
                    // agent that just restarted) still receives it instead of
                    // leaving this negotiation to stall out its deadline.
                    val offerResendJob = launch {
                        while (isActive) {
                            delay(OFFER_RESEND_INTERVAL_MS)
                            Log.d(TAG, "re-emitting offer-description (no answer yet)")
                            socket?.emit("offer-description", offer?.description.toString())
                        }
                    }
                    val sdp = try {
                        signal(type)
                    } finally {
                        offerResendJob.cancel()
                    }
                    Log.d(TAG, "peer.onAnswer(${sdp})")
                    peerClient!!.setRemoteDescription(sdp) {
                        if(it === null){
                            throw Exception("Failed to set remote description")
                        }
                        if(candidatesBuffer.isNotEmpty()){
                            candidatesBuffer.forEach { candidate ->
                                peerClient?.addIceCandidate(candidate)
                            }
                        }
                    }
                    resumePeer(dc)
                }
            }
        }
    }

    /**
     * Register observers on a single named data channel.
     */
    fun handleDataChannel(
        dataChannel: DataChannel,
        onMessage: (label: String, message: String) -> Unit,
        onStateChange: ((label: String, state: String?) -> Unit)? = null,
        onBufferedAmountChange: ((label: String, amount: Long) -> Unit)? = null
    ) {
        dataChannel.registerObserver(
            peerClient!!.createDataChannelObserver(
                dataChannel,
                dataChannel.label(),
                onMessage,
                onStateChange,
                onBufferedAmountChange
            )
        )
    }

    /**
     * Register observers on every negotiated data channel.
     */
    fun handleDataChannels(
        onMessage: (label: String, message: String) -> Unit,
        onStateChange: ((label: String, state: String?) -> Unit)? = null,
        onBufferedAmountChange: ((label: String, amount: Long) -> Unit)? = null
    ) {
        peerClient?.dataChannels?.values?.forEach { channel ->
            handleDataChannel(channel, onMessage, onStateChange, onBufferedAmountChange)
        }
    }

    /**
     * Wait for a Session Description
     */
    override suspend fun signal(type: String): SessionDescription {
        return suspendCoroutine { continuation ->
            this.socket!!.once("$type-description") {
                val description = it[0] as String
                Log.d(
                    TAG,
                    "signal.on${type.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }}Description($description)"
                )
                val sdpType = if (type == "offer") SessionDescription.Type.OFFER else SessionDescription.Type.ANSWER
                continuation.resume(SessionDescription(sdpType, description))
            }
        }
    }

    override suspend fun link(
        requestId: String
    ): LinkMessage {
        return suspendCoroutine { continuation ->
            val linkBody = JSONObject()
            linkBody.put("requestId", requestId)
            socket!!.emit("link", linkBody, Ack { args: Array<Any> ->
                val response = args[0] as JSONObject
                Log.d(TAG, "link.ack($response)")
                continuation.resume(LinkMessage.fromJson(response.toString()))
            })
        }
    }

    /**
     * Fire-and-forget `link`: binds [requestId] to this socket's authenticated
     * server-side session (the server persists it as `session.requestId`,
     * joins the socket to the request room and refreshes presence) WITHOUT
     * waiting for the acknowledgement — the server only acks once an `auth`
     * event fires for the requestId, which may never happen while the remote
     * peer is offline. Used on the offerer path, where the negotiation must
     * not block on the peer.
     */
    private fun emitLink(requestId: String) {
        val linkBody = JSONObject()
        linkBody.put("requestId", requestId)
        Log.d(TAG, "link.emit($linkBody)")
        socket!!.emit("link", linkBody)
    }

    /**
     * Whether the signaling socket is currently connected. `false` before the
     * first [ensureSocket] and while socket.io is (re)connecting.
     */
    fun isSignalingConnected(): Boolean {
        return socket?.connected() == true
    }

    /**
     * Create the signaling socket if none exists yet, or (re)connect the
     * existing one. The socket is PERSISTENT: it is reused across peer
     * negotiations (and across [cancel]) so `presence` broadcasts keep flowing
     * between chats — it is only torn down by an explicit [disconnect].
     */
    fun ensureSocket() {
        val existing = socket
        if (existing !== null) {
            // Reuse the persistent socket; revive it if it was dropped.
            if (!existing.connected()) {
                existing.connect()
            }
            return
        }

        // Configure Socket Options to use the same client
        val options = IO.Options.builder()
            .build()
        options.callFactory = client
        options.webSocketFactory = client

        // Connect to the messages origin
        socket = IO.socket(url, options)
        // Forward server-broadcast presence updates and signaling exceptions
        // (e.g. link-error room refusals) to the registered callbacks.
        socket?.on("presence") { args ->
            (args.getOrNull(0) as? JSONObject)?.let {
                // Cache before forwarding so getConnectionState() reflects this
                // broadcast even when no consumer listener is attached yet.
                lastPresence = it
                onPresence?.invoke(it)
            }
        }
        socket?.on("exception") { args ->
            (args.getOrNull(0) as? JSONObject)?.let { onLinkError?.invoke(it) }
        }
        // Surface socket connectivity (fires on every connect/auto-reconnect
        // and disconnect) so consumers can show a "signaling offline" state
        // without tying it to the p2p connection.
        socket?.on(Socket.EVENT_CONNECT) {
            Log.d(TAG, "Signaling socket connected")
            onSignalingState?.invoke("connected")
        }
        socket?.on(Socket.EVENT_DISCONNECT) {
            Log.d(TAG, "Signaling socket disconnected")
            onSignalingState?.invoke("disconnected")
        }
        socket?.connect()
    }

    fun disconnect() {
        socket?.close()
        socket?.disconnect()
        socket = null
        lastPresence = null
        peerClient?.destroy()
        peerClient = null
    }
}
