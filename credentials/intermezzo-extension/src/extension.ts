import type { Extension, ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { LogStoreExtension } from "@algorandfoundation/log-store";
import type { IdentityStoreExtension } from "@algorandfoundation/identities-store";
import type {
  Credential,
  CredentialStoreExtension,
  IssuanceSession,
  VerificationSession,
} from "@algorandfoundation/credentials-core";
import {
  buildCredentialProofJwt,
  buildSdJwtPresentation,
  buildVpTokenJwt,
  exchangePreAuthorizedCode,
  extractIssuedCredential,
  fetchCredentialOffer,
  fetchIssuerMetadata,
  parseAuthorizationRequestJwt,
  parseAuthorizationRequestUrl,
  parseSdJwtVc,
  PRE_AUTHORIZED_CODE_GRANT,
  requestCredential,
} from "@algorandfoundation/credentials-core";
import type { AuthorizationRequest } from "@algorandfoundation/credentials-core";
import {
  IntermezzoClient,
  type CreateCredentialOfferRequest,
  type CreatePresentationRequestRequest,
  type CredentialOfferResponse,
  type IntermezzoClientConfig,
  type PresentationRequestResponse,
  type RemoteIssuanceSession,
  type RemoteVerificationSession,
} from "@algorandfoundation/intermezzo-client";

/**
 * Options for {@link WithIntermezzoCredentials}.
 *
 * Wires the OID4VC issuer/verifier surface of `intermezzo-fresh` into
 * the credential store. Manager DID-document
 * (`/wallet/manager/identity`) endpoints live in the sibling
 * `@algorandfoundation/identities-intermezzo-extension` extension.
 */
export interface IntermezzoCredentialsExtensionOptions extends ExtensionOptions {
  intermezzo: IntermezzoClientConfig & {
    /**
     * If set, the extension will poll `/credential/issuer/sessions`
     * and `/credential/verifier/sessions` on this interval (ms) and
     * mirror them into the local credential store. Defaults to off.
     */
    pollIntervalMs?: number;
    /**
     * Optional pre-built shared client. When provided, this client
     * is reused instead of constructing a new one — this is how the
     * credentials and identities extensions share connection state
     * (auth token cache, custom `fetch`, etc.) when mounted side by
     * side.
     */
    client?: IntermezzoClient;
  };
}

/**
 * Holder-side API exposed at `provider.credential.intermezzo`.
 *
 * Every call is scoped to a specific identity (via
 * `identityAddress`). The bridge resolves `holderDidKey` from the
 * identity (its `did` / `address`) so callers don't have to plumb
 * the key material themselves.
 *
 * Manager DID-document operations live on
 * `provider.identity.intermezzo` — see
 * `@algorandfoundation/identities-intermezzo-extension`.
 */
export interface IntermezzoCredentialsApi {
  /** Raw HTTP client for advanced flows. */
  client: IntermezzoClient;

  /**
   * Asks intermezzo-fresh to create a pre-authorized credential
   * offer pinned to the given identity's `did:key`, mirrors the
   * resulting session into the local store (scoped to
   * `identityAddress`), and returns the offer (whose
   * `credentialOffer` URI can be rendered as a QR code).
   *
   * If `holderDidKey` is omitted the bridge derives it from
   * `identity.did` (or `identity.address`).
   */
  createOffer(
    req: { identityAddress: string } & Omit<CreateCredentialOfferRequest, "holderDidKey"> &
      Partial<Pick<CreateCredentialOfferRequest, "holderDidKey">>,
  ): Promise<CredentialOfferResponse>;

  /**
   * Fetches a single remote issuance session and mirrors it locally.
   */
  refreshIssuanceSession(id: string): Promise<IssuanceSession>;

  /**
   * Fetches all remote issuance sessions and mirrors them locally.
   */
  refreshIssuanceSessions(): Promise<IssuanceSession[]>;

  /**
   * Asks intermezzo-fresh to create an OID4VP presentation request
   * and mirrors the resulting verification session locally (scoped
   * to `identityAddress`, i.e. the identity expected to respond).
   */
  createPresentationRequest(
    req: { identityAddress: string } & CreatePresentationRequestRequest,
  ): Promise<PresentationRequestResponse>;

  /** Fetches a single remote verification session and mirrors it locally. */
  refreshVerificationSession(id: string): Promise<VerificationSession>;

  /** Fetches all remote verification sessions and mirrors them locally. */
  refreshVerificationSessions(): Promise<VerificationSession[]>;

  /**
   * Redeems an `openid-credential-offer://...` URI for the given
   * identity using the OID4VCI pre-authorized-code flow
   * (SEQUENCE.md §4a), persists the resulting credential locally,
   * and upserts the mirrored issuance session.
   */
  redeemOfferUri(req: {
    identityAddress: string;
    offerUri: string;
    format?: string;
    name?: string;
  }): Promise<{ credential: Credential; session: IssuanceSession }>;

  /**
   * Consumes an OID4VP authorization request URI, builds a VP token
   * signed with the given identity, and posts it to the verifier's
   * `response_uri` (OID4VP `direct_post` response mode).
   *
   * If `credentialId` is omitted, the first credential held by the
   * identity is presented. The full `presentation_definition` is
   * echoed back in `presentation_submission` for descriptor mapping.
   */
  respondToPresentationRequest(req: {
    identityAddress: string;
    authorizationRequestUri: string;
    /** Optional credential id to present. Defaults to the first one. */
    credentialId?: string;
  }): Promise<{ resolved: AuthorizationRequest; responseStatus: number; responseBody: string }>;

  /** Stops the background poll loop (if started). */
  dispose(): void;
}

/** The extension surface contributed by {@link WithIntermezzoCredentials}. */
export interface IntermezzoCredentialsExtension extends CredentialStoreExtension {
  credential: CredentialStoreExtension["credential"] & {
    intermezzo: IntermezzoCredentialsApi;
  };
}

/**
 * Wires the intermezzo-fresh OID4VC issuer/verifier into the wallet
 * provider.
 *
 * Depends on `WithCredentials` (from a credentials platform package —
 * `@algorandfoundation/credentials-web`,
 * `@algorandfoundation/react-native-credentials` — or the
 * `@algorandfoundation/credentials` meta) being already mounted on the
 * provider — issuance and verification sessions returned by the server are
 * mirrored into that store so the UI can drive everything from a single
 * tanstack store. An identities extension must be mounted as well: holder
 * `did:key` resolution goes through `provider.identity.store`.
 *
 * @example
 * ```typescript
 * const provider = new MyProvider()
 *   .extend(WithLogStore, { ... })
 *   .extend(WithCredentials, { credentials: { store, hooks } })
 *   .extend(WithIntermezzoCredentials, {
 *     intermezzo: {
 *       baseUrl: 'https://api.example.com',
 *       getAuthToken: () => keychain.get('manager-jwt'),
 *       pollIntervalMs: 5_000,
 *     },
 *   });
 * ```
 */
export const WithIntermezzoCredentials: Extension<IntermezzoCredentialsExtension> = (
  provider: CredentialStoreExtension & IdentityStoreExtension & Partial<LogStoreExtension>,
  options: IntermezzoCredentialsExtensionOptions,
) => {
  const log = provider.log;

  if (!provider.credential) {
    throw new Error(
      "WithIntermezzoCredentials requires WithCredentials to be present on the provider.",
    );
  }
  if (!options?.intermezzo?.client && !options?.intermezzo?.baseUrl) {
    throw new Error("WithIntermezzoCredentials requires options.intermezzo.baseUrl.");
  }

  const client = options.intermezzo.client ?? new IntermezzoClient(options.intermezzo);
  const credentialStore = provider.credential.store;

  /**
   * Recovers the local identity address for a session that came back
   * from the server. We prefer the existing mirror's
   * `identityAddress` (so subsequent refreshes don't clobber it),
   * then fall back to the server-reported `holderDidKey` (which is
   * the canonical did:key URL used as our identity address).
   */
  const resolveIssuanceIdentity = (remote: RemoteIssuanceSession): string => {
    const mirror = provider.issuanceSessions.find((s) => s.id === remote.id);
    if (mirror?.identityAddress) return mirror.identityAddress;
    return remote.holderDidKey ?? "";
  };

  const resolveVerificationIdentity = (remote: RemoteVerificationSession): string => {
    const mirror = provider.verificationSessions.find((s) => s.id === remote.id);
    return mirror?.identityAddress ?? "";
  };

  const toLocalIssuance = (remote: RemoteIssuanceSession): IssuanceSession => ({
    id: remote.id,
    identityAddress: resolveIssuanceIdentity(remote),
    state: remote.state,
    credentialConfigurationIds: remote.credentialConfigurationIds ?? [],
    credentialOfferUri: remote.credentialOffer,
    holderDidKey: remote.holderDidKey,
    createdAt: remote.createdAt ? Date.parse(remote.createdAt) : undefined,
    updatedAt: remote.updatedAt ? Date.parse(remote.updatedAt) : undefined,
    metadata: remote.issuanceMetadata,
  });

  const toLocalVerification = (remote: RemoteVerificationSession): VerificationSession => ({
    id: remote.id,
    identityAddress: resolveVerificationIdentity(remote),
    state: remote.state,
    authorizationRequest: remote.authorizationRequest,
    presentationDefinition: remote.presentationDefinition,
    createdAt: remote.createdAt ? Date.parse(remote.createdAt) : undefined,
    updatedAt: remote.updatedAt ? Date.parse(remote.updatedAt) : undefined,
    metadata: remote.verifiedClaims ? { verifiedClaims: remote.verifiedClaims } : undefined,
  });

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const refreshIssuanceSessions = async (): Promise<IssuanceSession[]> => {
    const remote = await client.listIssuanceSessions();
    const local = remote.map(toLocalIssuance);
    for (const session of local) {
      await credentialStore.upsertIssuanceSession(session);
    }
    return local;
  };

  const refreshIssuanceSession = async (id: string): Promise<IssuanceSession> => {
    const remote = await client.getIssuanceSession(id);
    const local = toLocalIssuance(remote);
    await credentialStore.upsertIssuanceSession(local);
    return local;
  };

  const refreshVerificationSessions = async (): Promise<VerificationSession[]> => {
    const remote = await client.listVerificationSessions();
    const local = remote.map(toLocalVerification);
    for (const session of local) {
      await credentialStore.upsertVerificationSession(session);
    }
    return local;
  };

  const refreshVerificationSession = async (id: string): Promise<VerificationSession> => {
    const remote = await client.getVerificationSession(id);
    const local = toLocalVerification(remote);
    await credentialStore.upsertVerificationSession(local);
    return local;
  };

  /**
   * Resolves the holder `did:key` for an identity, falling back to
   * `identity.address` (which for `did:key`-backed identities is the
   * canonical URL).
   */
  async function resolveHolderDidKey(identityAddress: string): Promise<string> {
    const identity = await provider.identity.store.getIdentity(identityAddress);
    if (!identity) {
      throw new Error(`WithIntermezzoCredentials: unknown identity ${identityAddress}`);
    }
    return identity.did ?? identity.address;
  }

  const intermezzoApi: IntermezzoCredentialsApi = {
    client,

    async createOffer(req) {
      // Resolve the holder did:key from the identity store if the
      // caller didn't supply one explicitly. This makes
      // `identityAddress` the canonical scoping primitive and keeps
      // wallet UI code from having to know about did:key plumbing.
      const holderDidKey = req.holderDidKey ?? (await resolveHolderDidKey(req.identityAddress));
      log?.info(
        `createOffer called: configs=${req.credentialConfigurationIds.join(",")}, identity=${req.identityAddress}`,
        {},
        "IntermezzoCredentials",
      );
      const response = await client.createOffer({
        credentialConfigurationIds: req.credentialConfigurationIds,
        holderDidKey,
        issuanceMetadata: req.issuanceMetadata,
      });
      await credentialStore.upsertIssuanceSession({
        id: response.id,
        identityAddress: req.identityAddress,
        state: response.state,
        credentialConfigurationIds: req.credentialConfigurationIds,
        credentialOfferUri: response.credentialOffer,
        holderDidKey: response.holderDidKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: req.issuanceMetadata,
      });
      return response;
    },

    refreshIssuanceSession,
    refreshIssuanceSessions,

    async createPresentationRequest(req) {
      log?.info(
        `createPresentationRequest called: identity=${req.identityAddress}`,
        {},
        "IntermezzoCredentials",
      );
      const response = await client.createPresentationRequest({
        presentationDefinition: req.presentationDefinition,
      });
      await credentialStore.upsertVerificationSession({
        id: response.id,
        identityAddress: req.identityAddress,
        state: response.state,
        authorizationRequest: response.authorizationRequest,
        presentationDefinition: req.presentationDefinition,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return response;
    },

    refreshVerificationSession,
    refreshVerificationSessions,

    async redeemOfferUri(req) {
      const holderDidKey = await resolveHolderDidKey(req.identityAddress);
      const signer = await credentialStore.getSignerForIdentity(req.identityAddress);
      if (!signer) {
        throw new Error(
          `WithIntermezzoCredentials.redeemOfferUri: identity ${req.identityAddress} has no signer`,
        );
      }

      log?.info(
        `redeemOfferUri called: identity=${req.identityAddress}`,
        {},
        "IntermezzoCredentials",
      );

      // 1. Fetch (or parse inline) the credential offer.
      const offer = await fetchCredentialOffer(req.offerUri);
      const preAuth = offer.grants?.[PRE_AUTHORIZED_CODE_GRANT];
      const preAuthorizedCode = preAuth?.["pre-authorized_code"];
      if (!preAuthorizedCode) {
        throw new Error(
          "redeemOfferUri: offer does not contain a pre-authorized_code grant — authorization-code flow is not supported yet",
        );
      }

      // 2. Discover issuer endpoints.
      const metadata = await fetchIssuerMetadata(offer.credential_issuer);
      if (!metadata.token_endpoint) {
        throw new Error("redeemOfferUri: issuer metadata is missing token_endpoint");
      }

      // 3. Exchange the pre-authorized code for an access token.
      const token = await exchangePreAuthorizedCode({
        tokenEndpoint: metadata.token_endpoint,
        preAuthorizedCode,
      });
      if (!token.c_nonce) {
        throw new Error("redeemOfferUri: token endpoint did not return c_nonce");
      }

      // 4. Build the holder proof JWT and request the credential.
      const proof = await buildCredentialProofJwt({
        signer,
        audience: offer.credential_issuer,
        nonce: token.c_nonce,
      });
      const vct = offer.credential_configuration_ids[0];
      const format = req.format ?? "vc+sd-jwt";
      const credentialResp = await requestCredential({
        credentialEndpoint: metadata.credential_endpoint,
        accessToken: token.access_token,
        format,
        vct,
        proof,
      });
      const raw = extractIssuedCredential(credentialResp);

      // 5. Persist the credential + mirrored issuance session.
      const credentialId = `${req.identityAddress}:${vct ?? format}:${Date.now()}`;
      const credential: Credential = {
        "@context": ["https://w3id.org/wallet/v1"],
        id: credentialId,
        type: ["VerifiableCredential", format],
        identityAddress: req.identityAddress,
        name: req.name ?? vct ?? "Verifiable Credential",
        configurationId: vct,
        format: format as any,
        raw,
        issuer: offer.credential_issuer,
        holder: holderDidKey,
        receivedAt: Date.now(),
      };
      await credentialStore.addCredential(credential);

      const session: IssuanceSession = {
        id: credentialId,
        identityAddress: req.identityAddress,
        state: "CredentialIssued",
        credentialConfigurationIds: offer.credential_configuration_ids,
        credentialOfferUri: req.offerUri,
        holderDidKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await credentialStore.upsertIssuanceSession(session);

      return { credential, session };
    },

    async respondToPresentationRequest(req) {
      const holderDidKey = await resolveHolderDidKey(req.identityAddress);
      const signer = await credentialStore.getSignerForIdentity(req.identityAddress);
      if (!signer) {
        throw new Error(
          `WithIntermezzoCredentials.respondToPresentationRequest: identity ${req.identityAddress} has no signer`,
        );
      }

      // 1. Resolve the authorization request (inline / JAR-by-value / JAR-by-reference).
      const parsed = parseAuthorizationRequestUrl(req.authorizationRequestUri);
      let resolved: AuthorizationRequest;
      if (parsed.kind === "value") {
        resolved = parsed.request;
      } else if (parsed.kind === "jar") {
        resolved = parsed.request;
      } else {
        const r = await fetch(parsed.uri);
        if (!r.ok) {
          throw new Error(
            `respondToPresentationRequest: failed to dereference request_uri ${parsed.uri}: ${r.status}`,
          );
        }
        const jwt = await r.text();
        resolved = parseAuthorizationRequestJwt(jwt);
      }

      const responseUri = resolved.response_uri ?? resolved.redirect_uri;
      if (!responseUri) {
        throw new Error(
          "respondToPresentationRequest: authorization request is missing response_uri / redirect_uri",
        );
      }
      if (!resolved.nonce) {
        throw new Error("respondToPresentationRequest: authorization request is missing nonce");
      }
      const audience = resolved.client_id ?? holderDidKey;

      // 2. Pick a credential to present.
      const candidates = await credentialStore.getCredentialsByIdentity(req.identityAddress);
      const cred = req.credentialId
        ? candidates.find((c) => c.id === req.credentialId)
        : candidates[0];
      if (!cred) {
        throw new Error(
          `respondToPresentationRequest: identity ${req.identityAddress} has no credentials to present`,
        );
      }
      const rawCredential =
        typeof cred.raw === "string" ? cred.raw : new TextDecoder().decode(cred.raw);

      // 3. Build the VP token. For SD-JWT VCs, the `vp_token` MUST be the
      // SD-JWT compact serialization (issuer JWT ~ disclosures ~ kb-jwt),
      // NOT a W3C JWT VP wrapper — otherwise Credo's verifier rejects
      // with "VP at path $ does not match the required format vc+sd-jwt".
      // For any other format we fall back to a W3C JWT VP.
      let vpToken: string;
      let vpFormat: string;
      if (cred.format === "vc+sd-jwt" || cred.format === "dc+sd-jwt") {
        const parsedVc = parseSdJwtVc(rawCredential);
        const disclose = parsedVc.disclosures
          .map((d) => d.name)
          .filter((n): n is string => typeof n === "string");
        vpToken = await buildSdJwtPresentation({
          parsed: parsedVc,
          disclose,
          keyBinding: {
            signer,
            audience,
            nonce: resolved.nonce,
          },
        });
        vpFormat = cred.format;
      } else {
        vpToken = await buildVpTokenJwt({
          signer,
          audience,
          nonce: resolved.nonce,
          holder: holderDidKey,
          verifiableCredential: [rawCredential],
        });
        vpFormat = cred.format ?? "jwt_vp";
      }

      // 4. Build a minimal presentation_submission echoing the PD.
      const pd = resolved.presentation_definition as
        | { id?: string; input_descriptors?: Array<{ id?: string }> }
        | undefined;
      const presentationSubmission = {
        id: `submission-${Date.now()}`,
        definition_id: pd?.id ?? "unknown",
        descriptor_map: (pd?.input_descriptors ?? []).map((d, i) => ({
          id: d.id ?? `input-${i}`,
          format: vpFormat,
          path: "$",
        })),
      };

      // 5. POST to the verifier's response_uri (OID4VP direct_post).
      const form = new URLSearchParams();
      form.set("vp_token", vpToken);
      form.set("presentation_submission", JSON.stringify(presentationSubmission));
      if (resolved.state) form.set("state", resolved.state);

      log?.info(
        `respondToPresentationRequest: posting VP to ${responseUri}`,
        {},
        "IntermezzoCredentials",
      );

      const response = await fetch(responseUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const responseBody = await response.text();
      if (!response.ok) {
        throw new Error(
          `respondToPresentationRequest: verifier rejected response (${response.status}): ${responseBody}`,
        );
      }

      return { resolved, responseStatus: response.status, responseBody };
    },

    dispose() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    },
  };

  // Optional background mirror loop.
  if (options.intermezzo.pollIntervalMs && options.intermezzo.pollIntervalMs > 0) {
    const tick = async () => {
      try {
        await refreshIssuanceSessions();
        await refreshVerificationSessions();
      } catch (error) {
        log?.warn(`intermezzo poll failed: ${error}`, {}, "IntermezzoCredentials");
      }
    };
    pollTimer = setInterval(tick, options.intermezzo.pollIntervalMs);
    void tick();
  }

  return {
    ...provider,
    credential: {
      ...provider.credential,
      intermezzo: intermezzoApi,
    },
  } as IntermezzoCredentialsExtension;
};
