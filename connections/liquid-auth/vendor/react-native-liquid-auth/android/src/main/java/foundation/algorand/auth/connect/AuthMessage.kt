package foundation.algorand.auth.connect

import android.net.Uri
import android.util.Log
import org.json.JSONObject

private fun Uri.findParameterValue(parameterName: String): String? {
    return query?.split('&')?.map {
        val parts = it.split('=')
        val name = parts.firstOrNull() ?: ""
        val value = parts.drop(1).firstOrNull() ?: ""
        Pair(name, value)
    }?.firstOrNull{it.first == parameterName}?.second
}
class AuthMessage(
    var origin: String,
    val requestId: String
) {

    companion object {
        const val TAG = "connect.Message"
        fun fromUri(uri: Uri): AuthMessage {
            Log.d(TAG, "fromUri($uri)")
            val origin = "https://${uri.host}"
            val requestId = uri.findParameterValue("requestId").toString()
            return AuthMessage(origin, requestId)
        }
        /**
         * Parse the Uri string
         *
         * `liquid://<ORIGIN>/?requestId=<REQUEST_ID>`
         */
        fun fromString(stringContents: String): AuthMessage {
            Log.d(TAG, "fromString($stringContents)")
            if(stringContents.startsWith("liquid://")) {
               return fromUri(Uri.parse(stringContents))
            } else {
                // Fallback
                val json = JSONObject(stringContents)
                if (!json.has("origin")) {
                    throw IllegalArgumentException("Invalid QR code: missing 'origin' field")
                }
                if (!json.has("requestId")) {
                    throw IllegalArgumentException("Invalid QR code: missing 'requestId' field")
                }
                val origin = json.get("origin").toString()
                val requestId = json.get("requestId").toString()
                return AuthMessage(origin, requestId)
            }
        }
    }
    fun toJSON() : JSONObject {
        val result = JSONObject()
        result.put("origin", origin)
        result.put("requestId", requestId)
        return result
    }
}
