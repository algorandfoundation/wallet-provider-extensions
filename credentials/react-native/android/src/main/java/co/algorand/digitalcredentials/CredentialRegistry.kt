package co.algorand.digitalcredentials

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.credentials.registry.digitalcredentials.openid4vp.OpenId4VpRegistry
import androidx.credentials.registry.provider.ClearCredentialRegistryRequest
import androidx.credentials.registry.provider.RegistryManager
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/**
 * Publishes the wallet's credentials to the platform credential registry
 * (`androidx.credentials.registry`, backed by Google Play services) so they
 * show up in the system's Digital Credentials chooser.
 *
 * Registration ships two things to the platform: the credential database built
 * from the wallet's entries and the OpenID4VP matcher WASM binary
 * ([OpenId4VpRegistry] supplies the library default), which the platform runs
 * in a sandbox to pre-filter entries against an incoming DCQL query. Only the
 * pre-filtered entries reach the chooser, and only the entry the user picks is
 * routed to [GetCredentialActivity].
 */
internal class CredentialRegistry(private val context: Context) {
  /**
   * Whether the platform registry can be used on this device: Credential
   * Manager's registry APIs are delivered through Play services, so both the
   * OS version and Play services availability are checked. Never throws — the
   * JS layer feature-detects on this.
   */
  fun isSupported(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
    return try {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
        ConnectionResult.SUCCESS
    } catch (error: Throwable) {
      Log.w(TAG, "Play services availability check failed", error)
      false
    }
  }

  /**
   * Replaces this app's registry with [entriesJson] (the serialized
   * `RegisteredSdJwtCredential[]`). An empty payload clears the registry
   * instead, which is what the platform expects for "this wallet currently has
   * nothing to present".
   *
   * @throws androidx.credentials.registry.provider.RegisterCredentialsException when
   * the platform rejects the registration.
   */
  suspend fun register(entriesJson: String) {
    val entries = RegisteredEntries.parse(entriesJson)
    if (entries.isEmpty()) {
      unregister()
      return
    }
    RegistryManager.create(context).registerCredentials(
      OpenId4VpRegistry(
        credentialEntries = entries,
        id = REGISTRY_ID,
        // Only the protocols this wallet can actually answer — the JS handler
        // builds SD-JWT VC presentations for OpenID4VP 1.0 requests; the
        // multi-signed variant is deliberately left out.
        supportedProtocols = listOf(
          OpenId4VpRegistry.PROTOCOL_OPENID4VP_1_0_SIGNED,
          OpenId4VpRegistry.PROTOCOL_OPENID4VP_1_0_UNSIGNED,
        ),
      ),
    )
    Log.i(TAG, "Registered ${entries.size} digital credential entr(ies)")
  }

  /**
   * Removes every registry this app owns. The module registers exactly one
   * ([REGISTRY_ID]), so clearing all of them is equivalent to clearing ours.
   *
   * @throws androidx.credentials.registry.provider.ClearCredentialRegistryException when
   * the platform rejects the request.
   */
  suspend fun unregister() {
    RegistryManager.create(context)
      .clearCredentialRegistry(ClearCredentialRegistryRequest(isDeleteAll = true))
    Log.i(TAG, "Cleared the digital credential registry")
  }

  internal companion object {
    const val TAG = "DigitalCredentials"

    /**
     * The registry record id, part of its primary key with the registry type:
     * re-registering under the same id overwrites the previous entries instead
     * of accumulating them. Max 64 characters.
     */
    private const val REGISTRY_ID = "algorand-wallet-openid4vp"
  }
}
