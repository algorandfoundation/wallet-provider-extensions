package co.algorand.digitalcredentials

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.util.Base64
import androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtClaim
import androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtEntry
import androidx.credentials.registry.provider.digitalcredentials.VerificationEntryDisplayProperties
import androidx.credentials.registry.provider.digitalcredentials.VerificationFieldDisplayProperties
import org.json.JSONArray
import org.json.JSONObject

/**
 * Translates the JS registration payload — `JSON.stringify(RegisteredSdJwtCredential[])`,
 * see `src/ReactNativeDigitalCredentials.types.ts` — into the SD-JWT VC registry
 * entries the OpenID4VP matcher pre-filters against.
 *
 * The JS side already validated the required fields ([ReactNativeDigitalCredentialsModule]
 * only forwards validated payloads), so anything structurally unusable here is
 * skipped rather than fataled: a single bad entry must not cost the wallet its
 * whole registry.
 */
internal object RegisteredEntries {
  /**
   * Parses the JSON registration payload.
   *
   * @param entriesJson the serialized `RegisteredSdJwtCredential[]`.
   * @return the registry entries, skipping records without an `id` or a `vct`.
   */
  fun parse(entriesJson: String): List<SdJwtEntry> {
    val array = JSONArray(entriesJson)
    val entries = ArrayList<SdJwtEntry>(array.length())
    for (index in 0 until array.length()) {
      val json = array.optJSONObject(index) ?: continue
      val entry = toEntry(json) ?: continue
      entries.add(entry)
    }
    return entries
  }

  private fun toEntry(json: JSONObject): SdJwtEntry? {
    val id = json.optString("id").ifEmpty { return null }
    val vct = json.optString("vct").ifEmpty { return null }
    val title = json.optString("title").ifEmpty { id }
    val subtitle = json.optString("subtitle").ifEmpty { null }
    return SdJwtEntry(
      verifiableCredentialType = vct,
      claims = toClaims(json.optJSONArray("claims")),
      entryDisplayPropertySet = setOf(
        VerificationEntryDisplayProperties(
          title = title,
          subtitle = subtitle,
          icon = decodeIcon(json.optString("iconBase64")) ?: placeholderIcon(),
        ),
      ),
      id = id,
    )
  }

  private fun toClaims(array: JSONArray?): List<SdJwtClaim> {
    if (array == null) return emptyList()
    val claims = ArrayList<SdJwtClaim>(array.length())
    for (index in 0 until array.length()) {
      val json = array.optJSONObject(index) ?: continue
      val path = toPath(json.optJSONArray("path"))
      if (path.isEmpty()) continue
      val displayName = json.optString("displayName").ifEmpty { path.joinToString(".") }
      claims.add(
        SdJwtClaim(
          path = path,
          // `JSONObject.NULL` is a sentinel object, not `null` — pass the real
          // absence through so the matcher does not compare against it.
          value = json.opt("value").takeUnless { it == JSONObject.NULL },
          fieldDisplayPropertySet = setOf(
            VerificationFieldDisplayProperties(
              displayName = displayName,
              displayValue = json.optString("displayValue").ifEmpty { null },
            ),
          ),
          isSelectivelyDisclosable = json.optBoolean("selectivelyDisclosable", true),
        ),
      )
    }
    return claims
  }

  private fun toPath(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val path = ArrayList<String>(array.length())
    for (index in 0 until array.length()) {
      val segment = array.optString(index)
      if (segment.isEmpty()) continue
      path.add(segment)
    }
    return path
  }

  private fun decodeIcon(base64: String): Bitmap? {
    if (base64.isEmpty()) return null
    return try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  /**
   * The registry requires an icon per entry, so wallets that register without
   * one still get a neutral 32x32 swatch instead of a failed registration.
   */
  private fun placeholderIcon(): Bitmap =
    Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888).also { bitmap ->
      Canvas(bitmap).drawColor(Color.LTGRAY)
    }

  /** The entry icon size Credential Manager renders (larger icons are rescaled). */
  private const val ICON_SIZE = 32
}
