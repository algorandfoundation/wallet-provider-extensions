package co.algorand.digitalcredentials

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.credentials.DigitalCredential
import androidx.credentials.ExperimentalDigitalCredentialApi
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetDigitalCredentialOption
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.credentials.registry.provider.selectedEntryId
import androidx.lifecycle.lifecycleScope
import java.util.UUID
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The fulfillment activity Credential Manager launches (through the
 * `androidx.credentials.registry.provider.action.GET_CREDENTIAL` intent action
 * declared in the manifest) once the user picked one of the entries this app
 * registered via [CredentialRegistry].
 *
 * It is invisible on purpose — the platform already showed the chooser and
 * collected the user's consent, so the only work left is protocol work, which
 * lives in JS (the credential store holds the SD-JWT VCs and the holder
 * binding). The activity therefore publishes the request to
 * [PresentationRequestBroker], awaits the JS answer and translates it into the
 * platform result.
 *
 * If JS never answers — most likely because the wallet process was cold-started
 * for this request and no handler was installed — the wait ends after
 * [REQUEST_TIMEOUT_MS] and the flow fails with a readable error instead of
 * hanging the system chooser.
 */
@OptIn(ExperimentalDigitalCredentialApi::class)
class GetCredentialActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val request = try {
      PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
    } catch (error: Throwable) {
      Log.e(TAG, "Failed to retrieve the provider request", error)
      null
    }
    if (request == null) {
      fail("The Digital Credentials request could not be read from the platform intent")
      return
    }

    val option = request.credentialOptions.filterIsInstance<GetDigitalCredentialOption>()
      .firstOrNull()
    if (option == null) {
      fail("The platform request carries no digital credential option")
      return
    }

    val routed = try {
      RoutedRequest.parse(option.requestJson)
    } catch (error: Throwable) {
      Log.e(TAG, "Failed to parse the digital credential request", error)
      null
    }
    if (routed == null) {
      fail("The digital credential request payload is not a protocol request this wallet handles")
      return
    }

    val event = PresentationRequestBroker.Event(
      requestId = UUID.randomUUID().toString(),
      protocol = routed.protocol,
      dataJson = routed.dataJson,
      origin = resolveOrigin(),
      selectedEntryId = request.selectedEntryId,
    )

    val pending = PresentationRequestBroker.publish(event)
    lifecycleScope.launch {
      val result = withTimeoutOrNull(REQUEST_TIMEOUT_MS) { pending.await() }
      PresentationRequestBroker.forget(event.requestId)
      when (result) {
        is PresentationRequestBroker.Result.Success -> succeed(result.responseJson, request)
        is PresentationRequestBroker.Result.Failure -> fail(result.message)
        null -> fail(
          "The wallet did not answer the presentation request within " +
            "${REQUEST_TIMEOUT_MS / 1000} seconds",
        )
      }
    }
  }

  /** Hands the protocol response JSON back to the platform. */
  private fun succeed(responseJson: String, request: ProviderGetCredentialRequest) {
    val resultIntent = Intent()
    try {
      PendingIntentHandler.setGetCredentialResponse(
        resultIntent,
        GetCredentialResponse(DigitalCredential(responseJson)),
        request,
      )
    } catch (error: Throwable) {
      // An invalid response JSON would otherwise surface as a silent cancel.
      Log.e(TAG, "The wallet produced an unusable protocol response", error)
      fail("The wallet produced an unusable protocol response: ${error.message}")
      return
    }
    setResult(Activity.RESULT_OK, resultIntent)
    finish()
  }

  /**
   * Fails the platform flow with [message]. The result code stays `RESULT_OK`
   * because the exception *is* the (valid) result — `RESULT_CANCELED` would
   * re-surface the chooser and invite the user into the same dead end.
   */
  private fun fail(message: String) {
    Log.w(TAG, "Digital Credentials request failed: $message")
    val resultIntent = Intent()
    PendingIntentHandler.setGetCredentialException(
      resultIntent,
      GetCredentialUnknownException(message),
    )
    setResult(Activity.RESULT_OK, resultIntent)
    finish()
  }

  /**
   * The verifier origin the platform attested, used by the wallet as the
   * key-binding audience. Only privileged callers (browsers) supply it; when
   * absent the JS handler falls back to the protocol's own client id.
   */
  private fun resolveOrigin(): String? {
    val origin = if (Build.VERSION.SDK_INT >= 34) {
      // API 34+: the platform request object carries the calling app info.
      @Suppress("DEPRECATION")
      val frameworkRequest = intent.getParcelableExtra(
        EXTRA_GET_CREDENTIAL_REQUEST,
      ) as? android.service.credentials.GetCredentialRequest
      frameworkRequest?.callingAppInfo?.origin
    } else {
      // Pre-34: androidx serializes the calling app info into the request
      // bundle, origin included.
      intent.getBundleExtra(EXTRA_GET_CREDENTIAL_REQUEST)?.getString(EXTRA_CALLING_APP_ORIGIN)
    }
    return origin?.takeIf { it.isNotEmpty() }
  }

  /** A protocol request routed to this wallet, normalized for the JS layer. */
  private data class RoutedRequest(val protocol: String, val dataJson: String) {
    companion object {
      /**
       * Extracts the routed protocol request from the Digital Credentials API
       * request JSON. Both shapes the platform may hand over are accepted: a
       * single `{ protocol, data }` entry and the multi-request
       * `{ requests: [{ protocol, data }, …] }` envelope (first entry — the
       * platform only routes a request it already matched).
       */
      fun parse(requestJson: String): RoutedRequest? {
        val json = JSONObject(requestJson)
        val entry = json.optJSONArray("requests")?.optJSONObject(0) ?: json
        val protocol = entry.optString("protocol").ifEmpty { return null }
        val data = entry.opt("data") ?: return null
        // `data` arrives as an object normally, but a protocol may pass an
        // already-serialized payload — JS parses the string either way.
        val dataJson = if (data is String) data else data.toString()
        return RoutedRequest(protocol, dataJson)
      }
    }
  }

  private companion object {
    const val TAG = "DigitalCredentials"

    /** How long the platform flow waits for the JS layer to answer. */
    const val REQUEST_TIMEOUT_MS = 60_000L

    /**
     * Platform extra holding the get-credential request; on API 34+ a
     * `android.service.credentials.GetCredentialRequest`, below that the
     * androidx-serialized request bundle.
     */
    const val EXTRA_GET_CREDENTIAL_REQUEST =
      "android.service.credentials.extra.GET_CREDENTIAL_REQUEST"

    /** Key androidx uses for the calling app origin inside that bundle. */
    const val EXTRA_CALLING_APP_ORIGIN =
      "androidx.credentials.provider.extra.CREDENTIAL_REQUEST_ORIGIN"
  }
}
