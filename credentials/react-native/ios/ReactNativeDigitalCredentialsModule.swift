import ExpoModulesCore

/**
 * The iOS module: an explicit `unsupported` implementation.
 *
 * The holder side of the Digital Credentials API is Android-only for now
 * (Credential Manager's `androidx.credentials.registry`). Apple's equivalent —
 * `IdentityDocumentServices` — is future work, so this module exists to keep
 * the shared JS surface resolvable (`requireNativeModule` must not throw on
 * iOS) while never pretending to register anything: `isSupported()` returns
 * `false` and the registry functions reject instead of silently no-oping.
 */
public class ReactNativeDigitalCredentialsModule: Module {
  private static let unsupportedReason =
    "The holder-side Digital Credentials API is not implemented on iOS yet"

  public func definition() -> ModuleDefinition {
    // The module will be accessible from
    // `requireNativeModule('ReactNativeDigitalCredentials')` in JavaScript.
    Name("ReactNativeDigitalCredentials")

    Events("onPresentationRequest")

    Function("isSupported") { () -> Bool in
      false
    }

    AsyncFunction("registerCredentials") { (_: String) in
      throw ReactNativeDigitalCredentialsModule.unsupported()
    }

    AsyncFunction("unregisterCredentials") {
      throw ReactNativeDigitalCredentialsModule.unsupported()
    }

    // No platform will ever route a request here, so there is nothing to
    // complete or abort — kept for API symmetry with Android.
    Function("completePresentationRequest") { (_: String, _: String) in
    }

    Function("abortPresentationRequest") { (_: String, _: String) in
    }
  }

  private static func unsupported() -> NSError {
    NSError(
      domain: "ReactNativeDigitalCredentials",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: unsupportedReason]
    )
  }
}
