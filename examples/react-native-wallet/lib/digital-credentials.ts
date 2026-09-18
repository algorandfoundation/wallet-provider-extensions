/**
 * Digital Credentials API wiring for the wallet (holder) side.
 *
 * Connects the credential store to the platform seam exposed at
 * `provider.credential.digitalProvider` (backed on Android by the
 * Digital Credentials Expo module bundled inside
 * `@algorandfoundation/react-native-credentials`):
 *
 * - **Registry sync**: every stored SD-JWT VC is mirrored into the OS
 *   credential registry (Android Credential Manager,
 *   `androidx.credentials.registry`) so it appears in the platform's
 *   credential chooser. Registration re-runs on every credential store
 *   change; an empty store clears the registry.
 * - **Presentation requests**: when the user picks one of this wallet's
 *   credentials in the chooser, the platform routes the OpenID4VP request
 *   back here. The handler answers the DCQL query with an SD-JWT VC
 *   presentation: the requested claims are selectively disclosed and a
 *   key-binding JWT (signed via the credential's holder binding) ties the
 *   presentation to the verifier's nonce and origin.
 *
 * The demo pair's verifier is `examples/use-wallet-client`, which sends an
 * unsigned OpenID4VP request (`openid4vp-v1-unsigned`) with a DCQL query
 * for the self-issued demo attestation.
 */
import {
  buildSdJwtPresentation,
  parseSdJwtVc,
  type Credential,
  type DigitalCredentialGetResponse,
  type DigitalCredentialProviderEntry,
  type DigitalCredentialProviderRequest,
  type ParsedSdJwtVc,
} from "@algorandfoundation/credentials";

import { credentialsStore } from "@/stores/credentials";
import type { ReactNativeProvider } from "@/providers/ReactNativeProvider";

/** The DCQL credential-query subset the demo verifier sends. */
interface DcqlCredentialQuery {
  id: string;
  format?: string;
  meta?: { vct_values?: string[] };
  claims?: { path?: unknown[] }[];
}

/** The OpenID4VP DC API request payload subset the handler consumes. */
interface Oid4VpDcApiRequest {
  response_type?: string;
  response_mode?: string;
  nonce?: string;
  client_id?: string;
  dcql_query?: { credentials?: DcqlCredentialQuery[] };
}

/** A stored credential paired with its parsed SD-JWT VC. */
interface SdJwtCandidate {
  credential: Credential;
  parsed: ParsedSdJwtVc;
}

/** Parses a stored credential as an SD-JWT VC, or `undefined` when it is not one. */
function parseStoredSdJwt(credential: Credential): ParsedSdJwtVc | undefined {
  if (credential.format !== "vc+sd-jwt" || typeof credential.raw !== "string") return undefined;
  try {
    return parseSdJwtVc(credential.raw);
  } catch {
    return undefined;
  }
}

/** All stored credentials that parse as SD-JWT VCs, ready for matching. */
function sdJwtCandidates(): SdJwtCandidate[] {
  return credentialsStore.state.credentials
    .map((credential) => ({ credential, parsed: parseStoredSdJwt(credential) }))
    .filter((c): c is SdJwtCandidate => c.parsed !== undefined);
}

/**
 * Maps stored SD-JWT VCs to the registry entries the platform matcher
 * pre-filters against: the `vct` plus each selectively-disclosable claim
 * (path + value) so the platform chooser only surfaces credentials that
 * can actually satisfy an incoming DCQL query.
 */
export function toDigitalCredentialEntries(
  credentials: Credential[],
): DigitalCredentialProviderEntry[] {
  const entries: DigitalCredentialProviderEntry[] = [];
  for (const credential of credentials) {
    const parsed = parseStoredSdJwt(credential);
    const vct = parsed?.payload.vct;
    if (!parsed || typeof vct !== "string") continue;
    entries.push({
      id: credential.id,
      protocols: ["openid4vp-v1-unsigned", "openid4vp-v1-signed"],
      display: {
        title: credential.name,
        ...(credential.issuer ? { subtitle: String(credential.issuer) } : {}),
      },
      metadata: {
        vct,
        claims: parsed.disclosures
          .filter((d) => d.name !== undefined)
          .map((d) => ({
            path: [d.name as string],
            value: d.value,
            displayName: d.name as string,
            displayValue: String(d.value),
            selectivelyDisclosable: true,
          })),
      },
    });
  }
  return entries;
}

/**
 * Finds the stored SD-JWT VC satisfying a DCQL credential query: the
 * platform-selected credential when the chooser reported one, otherwise
 * the first credential whose `vct` matches the query's `vct_values`.
 */
function findMatch(
  query: DcqlCredentialQuery,
  selectedCredentialId: string | undefined,
): SdJwtCandidate | undefined {
  const candidates = sdJwtCandidates();
  if (selectedCredentialId) {
    const selected = candidates.find((c) => c.credential.id === selectedCredentialId);
    if (selected) return selected;
  }
  const vcts = query.meta?.vct_values;
  return candidates.find((c) => !vcts || vcts.includes(String(c.parsed.payload.vct ?? "")));
}

/**
 * Answers a routed OpenID4VP presentation request with a `vp_token`
 * keyed by DCQL query id: an SD-JWT VC presentation disclosing exactly
 * the requested claims, key-bound to the verifier's nonce and origin.
 */
async function handlePresentationRequest(
  provider: ReactNativeProvider,
  request: DigitalCredentialProviderRequest,
): Promise<DigitalCredentialGetResponse> {
  const data = (
    typeof request.data === "string" ? JSON.parse(request.data) : request.data
  ) as Oid4VpDcApiRequest;
  const nonce = data?.nonce;
  if (typeof nonce !== "string" || nonce.length === 0) {
    throw new Error("OpenID4VP request carries no nonce");
  }
  const queries = data.dcql_query?.credentials ?? [];
  if (queries.length === 0) {
    throw new Error("OpenID4VP request carries no DCQL credential query");
  }

  // Per the OpenID4VP DC API profile the key-binding audience is the
  // verifier origin the platform attested (`origin:<origin>`).
  const audience = request.origin ? `origin:${request.origin}` : (data.client_id ?? "unknown");

  const vpToken: Record<string, string[]> = {};
  for (const query of queries) {
    const match = findMatch(query, request.selectedCredentialId);
    if (!match) {
      throw new Error(`No stored credential satisfies the DCQL query "${query.id}"`);
    }
    const signer = await provider.credential.store.getSignerForIdentity(
      match.credential.identityAddress,
    );
    if (!signer) {
      throw new Error(
        `No holder binding resolved a signer for ${match.credential.identityAddress}`,
      );
    }
    const disclose = (query.claims ?? [])
      .map((claim) => (Array.isArray(claim.path) ? String(claim.path[0]) : undefined))
      .filter((name): name is string => typeof name === "string");
    const presentation = await buildSdJwtPresentation({
      parsed: match.parsed,
      disclose,
      keyBinding: { signer, audience, nonce },
    });
    vpToken[query.id] = [presentation];
  }

  return { protocol: request.protocol, data: { vp_token: vpToken } };
}

/** Mirrors the current credential store into the platform registry. */
async function syncRegistry(provider: ReactNativeProvider): Promise<void> {
  const digital = provider.credential.digitalProvider;
  const entries = toDigitalCredentialEntries(credentialsStore.state.credentials);
  if (entries.length === 0) {
    await digital.unregisterCredentials();
  } else {
    await digital.registerCredentials(entries);
  }
}

/**
 * Installs the Digital Credentials holder wiring: the presentation
 * request handler plus registry sync on every credential change.
 *
 * No-ops (and returns a no-op cleanup) when the platform registry is
 * unavailable, e.g. on iOS, or when the bundled Digital Credentials
 * native module is missing from the build.
 *
 * @param provider - The mounted wallet provider.
 * @returns A cleanup function that stops the registry sync.
 */
export function setupDigitalCredentials(provider: ReactNativeProvider): () => void {
  const digital = provider.credential.digitalProvider;
  if (!digital.isSupported()) {
    // Loud on purpose: an unavailable registry is indistinguishable from a
    // working one at runtime (the verifier just never finds a credential), so
    // say why nothing will happen instead of no-oping in silence.
    console.warn(
      "[digital-credentials] The platform credential registry is unavailable — this wallet " +
        "will not appear in the OS credential chooser. Expected on iOS and web; on Android it " +
        "means the Digital Credentials native module (bundled with " +
        "@algorandfoundation/react-native-credentials) is missing from this build " +
        "(a JS reload is not enough — rebuild the dev client) or Google Play services is not " +
        "available on the device.",
    );
    return () => {};
  }

  digital.setRequestHandler((request) => handlePresentationRequest(provider, request));

  const sync = () => {
    syncRegistry(provider).catch((error) => {
      console.warn("Digital Credentials registry sync failed", error);
    });
  };

  // Initial sync (the store may still be hydrating; the subscription
  // below re-syncs once the persisted credentials land) plus a re-sync
  // on every change to the durable credentials slice.
  sync();
  let last = credentialsStore.state.credentials;
  const subscription = credentialsStore.subscribe(() => {
    const next = credentialsStore.state.credentials;
    if (next === last) return;
    last = next;
    sync();
  });
  return () => subscription.unsubscribe();
}
