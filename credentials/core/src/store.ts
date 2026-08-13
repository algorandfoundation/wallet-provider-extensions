import type { Store } from "@tanstack/store";
import type {
  Credential,
  CredentialStoreState,
  IssuanceSession,
  VerificationSession,
} from "./types.ts";

/**
 * Adds (or replaces by id) a credential in the store.
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
 */
export function getCredentials({ store }: { store: Store<CredentialStoreState> }): Credential[] {
  return store.state.credentials;
}

/**
 * Generic query over the held credentials, matching Universal Wallet 2020's
 * `query` interface. Each query object may carry an `example` (QueryByExample)
 * whose `type` narrows the result; queries without a recognized shape match
 * everything. The union of all query results is returned, de-duplicated by id.
 */
export function queryCredentials({
  store,
  queries,
}: {
  store: Store<CredentialStoreState>;
  queries: any[];
}): Credential[] {
  const credentials = store.state.credentials;
  if (!Array.isArray(queries) || queries.length === 0) return credentials;

  const matched = new Map<string, Credential>();
  for (const query of queries) {
    const exampleTypes: string[] | undefined = (() => {
      const type = query?.credentialQuery?.example?.type ?? query?.example?.type;
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
