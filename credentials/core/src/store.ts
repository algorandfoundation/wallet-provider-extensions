import type { Store } from "@tanstack/store";
import type {
  Credential,
  CredentialQuery,
  CredentialStoreState,
  IssuanceSession,
  QueryByExampleCredential,
  VerificationSession,
} from "./types.ts";

/**
 * Adds (or replaces by id) a credential in the store.
 *
 * @example
 * ```typescript
 * addCredential({ store, credential });
 * ```
 */
export function addCredential({
  store,
  credential,
}: {
  store: Store<CredentialStoreState>;
  credential: Credential;
}): Credential {
  store.setState((state) => {
    const filtered = state.credentials.filter((c) => c.id !== credential.id);
    return {
      ...state,
      credentials: [credential, ...filtered],
    };
  });
  return credential;
}

/**
 * Removes a credential by id.
 *
 * @example
 * ```typescript
 * removeCredential({ store, id: "cred-1" });
 * ```
 */
export function removeCredential({
  store,
  id,
}: {
  store: Store<CredentialStoreState>;
  id: string;
}): void {
  store.setState((state) => ({
    ...state,
    credentials: state.credentials.filter((c) => c.id !== id),
  }));
}

/**
 * Retrieves a credential by id.
 *
 * @example
 * ```typescript
 * const credential = getCredential({ store, id: "cred-1" });
 * ```
 */
export function getCredential({
  store,
  id,
}: {
  store: Store<CredentialStoreState>;
  id: string;
}): Credential | undefined {
  return store.state.credentials.find((c) => c.id === id);
}

/**
 * Lists all credentials currently held by the wallet.
 *
 * @example
 * ```typescript
 * const held = getCredentials({ store });
 * ```
 */
export function getCredentials({ store }: { store: Store<CredentialStoreState> }): Credential[] {
  return store.state.credentials;
}

/**
 * Resolves the `example` a {@link CredentialQuery} matches against: the
 * nested VC-API form (`credentialQuery.example`) wins over the flat form
 * (`example`); `undefined` for any other query shape.
 */
function resolveQueryExample(query: CredentialQuery): QueryByExampleCredential | undefined {
  const nested = (query as { credentialQuery?: { example?: unknown } }).credentialQuery?.example;
  const flat = (query as { example?: unknown }).example;
  const example = nested ?? flat;
  return example !== null && typeof example === "object"
    ? (example as QueryByExampleCredential)
    : undefined;
}

/**
 * Generic query over the held credentials, matching Universal Wallet 2020's
 * `query` interface. Each {@link CredentialQuery} may carry an `example`
 * (`QueryByExample`, flat or nested under `credentialQuery`) whose `type`
 * narrows the result; queries without a recognized shape match everything.
 * The union of all query results is returned, de-duplicated by id.
 *
 * @example
 * ```typescript
 * const matches = queryCredentials({
 *   store,
 *   queries: [{ type: "QueryByExample", example: { type: "DeviceAttestationCredential" } }],
 * });
 * ```
 */
export function queryCredentials({
  store,
  queries,
}: {
  store: Store<CredentialStoreState>;
  queries: CredentialQuery[];
}): Credential[] {
  const credentials = store.state.credentials;
  if (!Array.isArray(queries) || queries.length === 0) return credentials;

  const matched = new Map<string, Credential>();
  for (const query of queries) {
    const exampleTypes: string[] | undefined = (() => {
      const type = resolveQueryExample(query)?.type;
      if (typeof type === "string") return [type];
      return Array.isArray(type) ? type : undefined;
    })();

    for (const credential of credentials) {
      if (!exampleTypes || exampleTypes.every((t) => credential.type.includes(t))) {
        matched.set(credential.id, credential);
      }
    }
  }
  return [...matched.values()];
}

/**
 * Upserts an issuance session mirror.
 *
 * @example
 * ```typescript
 * upsertIssuanceSession({ store, session: { id: "offer-1", identityAddress, state: "OfferCreated", credentialConfigurationIds: [] } });
 * ```
 */
export function upsertIssuanceSession({
  store,
  session,
}: {
  store: Store<CredentialStoreState>;
  session: IssuanceSession;
}): IssuanceSession {
  store.setState((state) => {
    const filtered = state.issuanceSessions.filter((s) => s.id !== session.id);
    return {
      ...state,
      issuanceSessions: [session, ...filtered],
    };
  });
  return session;
}

/**
 * Removes an issuance session by id.
 *
 * @example
 * ```typescript
 * removeIssuanceSession({ store, id: "offer-1" });
 * ```
 */
export function removeIssuanceSession({
  store,
  id,
}: {
  store: Store<CredentialStoreState>;
  id: string;
}): void {
  store.setState((state) => ({
    ...state,
    issuanceSessions: state.issuanceSessions.filter((s) => s.id !== id),
  }));
}

/**
 * Upserts a verification session mirror.
 *
 * @example
 * ```typescript
 * upsertVerificationSession({ store, session: { id: "request-1", identityAddress, state: "RequestCreated" } });
 * ```
 */
export function upsertVerificationSession({
  store,
  session,
}: {
  store: Store<CredentialStoreState>;
  session: VerificationSession;
}): VerificationSession {
  store.setState((state) => {
    const filtered = state.verificationSessions.filter((s) => s.id !== session.id);
    return {
      ...state,
      verificationSessions: [session, ...filtered],
    };
  });
  return session;
}

/**
 * Removes a verification session by id.
 *
 * @example
 * ```typescript
 * removeVerificationSession({ store, id: "request-1" });
 * ```
 */
export function removeVerificationSession({
  store,
  id,
}: {
  store: Store<CredentialStoreState>;
  id: string;
}): void {
  store.setState((state) => ({
    ...state,
    verificationSessions: state.verificationSessions.filter((s) => s.id !== id),
  }));
}

/**
 * Clears credentials and all session mirrors.
 *
 * @example
 * ```typescript
 * clearCredentials({ store });
 * ```
 */
export function clearCredentials({ store }: { store: Store<CredentialStoreState> }): void {
  store.setState((state) => ({
    ...state,
    credentials: [],
    issuanceSessions: [],
    verificationSessions: [],
  }));
}

/**
 * Lists credentials scoped to a given identity address.
 *
 * @example
 * ```typescript
 * const mine = getCredentialsByIdentity({ store, address: "did:key:z6Mk..." });
 * ```
 */
export function getCredentialsByIdentity({
  store,
  address,
}: {
  store: Store<CredentialStoreState>;
  address: string;
}): Credential[] {
  return store.state.credentials.filter((c) => c.identityAddress === address);
}

/**
 * Lists issuance sessions scoped to a given identity address.
 *
 * @example
 * ```typescript
 * const offers = getIssuanceSessionsByIdentity({ store, address: "did:key:z6Mk..." });
 * ```
 */
export function getIssuanceSessionsByIdentity({
  store,
  address,
}: {
  store: Store<CredentialStoreState>;
  address: string;
}): IssuanceSession[] {
  return store.state.issuanceSessions.filter((s) => s.identityAddress === address);
}

/**
 * Lists verification sessions scoped to a given identity address.
 *
 * @example
 * ```typescript
 * const requests = getVerificationSessionsByIdentity({ store, address: "did:key:z6Mk..." });
 * ```
 */
export function getVerificationSessionsByIdentity({
  store,
  address,
}: {
  store: Store<CredentialStoreState>;
  address: string;
}): VerificationSession[] {
  return store.state.verificationSessions.filter((s) => s.identityAddress === address);
}

/**
 * Removes every credential and session attached to a specific identity.
 *
 * Used as a cascade when the identities extension reports an identity
 * has been removed (see `WithCredentials`).
 *
 * @example
 * ```typescript
 * removeByIdentity({ store, address: "did:key:z6Mk..." });
 * ```
 */
export function removeByIdentity({
  store,
  address,
}: {
  store: Store<CredentialStoreState>;
  address: string;
}): void {
  store.setState((state) => ({
    ...state,
    credentials: state.credentials.filter((c) => c.identityAddress !== address),
    issuanceSessions: state.issuanceSessions.filter((s) => s.identityAddress !== address),
    verificationSessions: state.verificationSessions.filter((s) => s.identityAddress !== address),
  }));
}
