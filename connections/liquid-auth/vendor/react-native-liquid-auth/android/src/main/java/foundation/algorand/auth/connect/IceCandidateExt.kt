package foundation.algorand.auth.connect

import org.json.JSONObject
import org.webrtc.IceCandidate

fun IceCandidate.toJSON(): JSONObject {
    return JSONObject().apply {
        put("candidate", sdp)
        put("sdpMid", sdpMid)
        put("sdpMLineIndex", sdpMLineIndex)
    }
}
