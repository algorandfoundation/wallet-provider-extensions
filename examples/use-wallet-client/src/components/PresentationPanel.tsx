import { useMemo, useState } from "react";
import {
  DigitalCredentialsUnsupportedError,
  webDigitalCredentials,
  type DigitalCredentialGetResponse,
  type DigitalCredentialRequest,
} from "@algorandfoundation/credentials";

/**
 * The credential type the `react-native-wallet` example self-issues; this
 * verifier asks for exactly that credential, completing the demo pair.
 */
const DEMO_VCT = "https://example.com/credentials/demo-attestation";

/** Generates a base64url nonce for the OpenID4VP request. */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * Builds a W3C Digital Credentials API request entry carrying an unsigned
 * OpenID4VP authorization request (the `openid4vp-v1-unsigned` protocol from
 * the Digital Credentials protocol registry).
 *
 * The DCQL query asks for the demo SD-JWT VC by `vct` and requests its three
 * selectively-disclosable claims. The platform routes this to whichever
 * wallet registered a matching credential, same-device or cross-device
 * (e.g. desktop Chrome → Android wallet via the hybrid handshake).
 */
function buildPresentationRequest(nonce: string): DigitalCredentialRequest {
  return {
    protocol: "openid4vp-v1-unsigned",
    data: {
      response_type: "vp_token",
      response_mode: "dc_api",
      nonce,
      dcql_query: {
        credentials: [
          {
            id: "demo-attestation",
            format: "dc+sd-jwt",
            meta: { vct_values: [DEMO_VCT] },
            claims: [
              { path: ["given_name"] },
              { path: ["family_name"] },
              { path: ["membership_level"] },
            ],
          },
        ],
      },
    },
  };
}

type RequestOutcome =
  | { kind: "response"; response: DigitalCredentialGetResponse }
  | { kind: "unsupported"; message: string }
  | { kind: "error"; message: string };

/**
 * The verifier side of the Digital Credentials API demo:
 * `webDigitalCredentials.get(...)` forwards the OpenID4VP request to
 * `navigator.credentials.get({ digital: { requests } })` and the browser /
 * OS takes over, showing its credential chooser and routing the request to
 * a registered wallet: the `react-native-wallet` example, whose Android
 * Credential Manager registry module answers this request.
 */
export function PresentationPanel() {
  const supported = useMemo(() => webDigitalCredentials.isSupported(), []);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RequestOutcome | null>(null);

  const nonce = useMemo(() => randomNonce(), []);
  const request = useMemo(() => buildPresentationRequest(nonce), [nonce]);

  const handleRequest = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const response = await webDigitalCredentials.get({ requests: [request] });
      setOutcome({ kind: "response", response });
    } catch (error) {
      if (error instanceof DigitalCredentialsUnsupportedError) {
        setOutcome({ kind: "unsupported", message: error.message });
      } else {
        // User cancelled, no matching credential registered, or the UA
        // rejected the request: all end up here.
        setOutcome({ kind: "error", message: (error as Error).message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>
        Credential Presentation{" "}
        <span className={supported ? "chip supported" : "chip unsupported"}>
          {supported ? "DC API available" : "DC API unavailable"}
        </span>
      </h2>
      <p className="hint">
        Request the demo attestation (an SD-JWT VC self-issued by the{" "}
        <code>react-native-wallet</code> example) over OpenID4VP through the browser's Digital
        Credentials API. Requires Chrome/Edge 141+ — and a wallet registered with the platform to
        actually answer.
      </p>

      <div className="actions">
        <button className="primary" onClick={handleRequest} disabled={busy}>
          {busy ? "Waiting for the platform…" : "Request presentation"}
        </button>
      </div>

      <h3>OpenID4VP request</h3>
      <pre className="output">{JSON.stringify(request, null, 2)}</pre>

      {outcome && (
        <>
          <h3>
            {outcome.kind === "response"
              ? "Presentation response"
              : outcome.kind === "unsupported"
                ? "Not supported"
                : "Request failed"}
          </h3>
          <pre className={outcome.kind === "response" ? "output" : "output error"}>
            {outcome.kind === "response"
              ? JSON.stringify(outcome.response, null, 2)
              : outcome.message}
          </pre>
        </>
      )}
    </section>
  );
}
