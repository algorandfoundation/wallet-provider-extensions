package co.algorand.digitalcredentials

import android.content.Context
import android.os.Bundle
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking

/**
 * The Android half of `@algorandfoundation/react-native-digital-credentials`:
 * the holder (wallet) side of the W3C Digital Credentials API.
 *
 * Two directions cross this module:
 *
 * - **out** — `registerCredentials` / `unregisterCredentials` mirror the
 *   wallet's presentable credentials into the platform registry through
 *   [CredentialRegistry], so they appear in the system chooser.
 * - **in** — when the user picks one of those entries, the platform launches
 *   [GetCredentialActivity], which publishes the routed request to
 *   [PresentationRequestBroker]. This module forwards it to JS as an
 *   `onPresentationRequest` event and hands the JS answer (or failure) back to
 *   the broker via `completePresentationRequest` / `abortPresentationRequest`.
 *
 * The listener is attached on module creation, before JS installs its handler,
 * because the platform may launch the fulfillment activity while the RN runtime
 * is still booting — the broker queues those events and flushes them here.
 */
class ReactNativeDigitalCredentialsModule : Module() {
  private val credentialRegistry: CredentialRegistry by lazy { CredentialRegistry(requireContext()) }

  override fun definition() = ModuleDefinition {
    // The name JS resolves through `requireNativeModule("ReactNativeDigitalCredentials")`.
    Name("ReactNativeDigitalCredentials")

    Events("onPresentationRequest")

    OnCreate {
      PresentationRequestBroker.setListener { event ->
        sendEvent(
          "onPresentationRequest",
          Bundle().apply {
            putString("requestId", event.requestId)
            putString("protocol", event.protocol)
            putString("dataJson", event.dataJson)
            event.origin?.let { putString("origin", it) }
            event.selectedEntryId?.let { putString("selectedEntryId", it) }
          },
        )
      }
    }

    OnDestroy {
      PresentationRequestBroker.clearListener()
    }

    Function("isSupported") {
      try {
        credentialRegistry.isSupported()
      } catch (error: Throwable) {
        Log.w(CredentialRegistry.TAG, "isSupported failed", error)
        false
      }
    }

    // Runs off the JS thread already; `runBlocking` bridges the registry's
    // suspending API without leaking a scope the module would have to manage.
    AsyncFunction("registerCredentials") { entriesJson: String ->
      runBlocking { credentialRegistry.register(entriesJson) }
    }

    AsyncFunction("unregisterCredentials") {
      runBlocking { credentialRegistry.unregister() }
    }

    Function("completePresentationRequest") { requestId: String, responseJson: String ->
      PresentationRequestBroker.complete(requestId, responseJson)
    }

    Function("abortPresentationRequest") { requestId: String, message: String ->
      PresentationRequestBroker.abort(requestId, message)
    }
  }

  private fun requireContext(): Context =
    (appContext.reactContext ?: appContext.hostingRuntimeContext) as? Context
      ?: throw IllegalStateException("No Android context is available for the module")
}
