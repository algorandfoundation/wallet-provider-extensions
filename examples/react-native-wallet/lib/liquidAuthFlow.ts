/**
 * The Liquid Auth WebAuthn ceremony the wallet runs before peering.
 *
 * A real liquid-auth service (e.g. `https://debug.liquidauth.com`) gates
 * ALL signaling on this exchange: the dapp's `link(requestId)` only acks
 * once the server sees an `auth` event for the request, and offers are
 * relayed keyed off the wallet session's `requestId`, both of which are
 * only set by `POST /attestation/response` (first visit) or
 * `POST /assertion/response` (returning credential). Skipping it makes
 * both sides hang forever.
 *
 * The ceremony here mirrors the known-good ac2-wallet flow:
 *
 * 1. Every HTTP call goes through the native module's cookie-jar
 *    `request()` (`LiquidAuth.request`), so the `connect.sid` session
 *    cookie set by the FIDO2 exchange is captured natively and
 *    authenticates the background signaling socket.
 * 2. An existing credential for the origin is looked up (passkeys store,
 *    plus the credential id remembered from the last successful
 *    ceremony) and asserted via `react-native-passkey`'s `Passkey.get`.
 * 3. Without one, or when the device lost the passkey (e.g. after a
 *    reinstall), a new passkey is registered via `Passkey.create`.
 * 4. Either response is submitted with the `liquid` client extension:
 *    the wallet's address plus an ed25519 signature of the WebAuthn
 *    challenge, produced by the keystore key backing the account.
 *
 * The system passkey ceremony routes through the device's credential
 * provider; set this wallet as the provider (Passkeys screen) so the
 * `rpId` check resolves against its own store.
 */
import algosdk from "algosdk";
import { Passkey } from "react-native-passkey";
import * as LiquidAuth from "react-native-liquid-auth";
import { toAlgorandAddress } from "@algorandfoundation/connections";

import { localStorage } from "@/stores/mmkv-local";
import { passkeysStore } from "@/stores/passkeys";

/** Where the last successfully asserted credential id per origin lives. */
const CREDENTIAL_KEY_PREFIX = "liquid-auth/credential/";

/** The wallet seams the ceremony needs (address + challenge signing). */
export interface LiquidCeremonyWallet {
  /** The Algorand address the connection authenticates as. */
  address: string;
  /** ed25519-signs the WebAuthn challenge with the key backing {@link address}. */
  signChallenge(challenge: Uint8Array): Promise<Uint8Array>;
  /** Device label shown by the liquid-auth service. */
  device?: string;
}

/** Base64url (no padding) of raw bytes. */
function toBase64Url(bytes: Uint8Array): string {
  return algosdk.bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Raw bytes of a base64url (or base64) string. */
function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return algosdk.base64ToBytes(padded);
}

/**
 * JSON request through the native cookie-jar client, so the session
 * cookie the server sets authenticates the background signaling socket.
 */
async function authFetch(
  url: string,
  method: string = "GET",
  body?: unknown,
): Promise<{ ok: boolean; status: number; statusText: string; json: unknown }> {
  const res = await LiquidAuth.request(
    url,
    method,
    { "Content-Type": "application/json" },
    body === undefined ? undefined : JSON.stringify(body),
  );
  let json: unknown = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    // Non-JSON body (error page); callers only need ok/status then.
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, json };
}

/** The parsed `/auth/session` payload (deployments vary in shape). */
export type LiquidAuthSessionData = Record<string, unknown>;

/**
 * Fetches the server's current auth session (`GET /auth/session`)
 * through the native cookie-jar client, so the answer reflects exactly
 * the origin-scoped session the background signaling socket rides.
 * Returns the parsed json, or `null` when the request fails or the
 * body is not a JSON object.
 */
export async function fetchAuthSession(origin: string): Promise<LiquidAuthSessionData | null> {
  try {
    const res = await authFetch(`${origin}/auth/session`);
    if (!res.ok || !res.json || typeof res.json !== "object") return null;
    return res.json as LiquidAuthSessionData;
  } catch {
    return null;
  }
}

/** The wallet address the auth session authenticates, if any. */
export function sessionAddressFromData(data: LiquidAuthSessionData): string | undefined {
  const user = data.user as { wallet?: unknown } | null | undefined;
  const session = data.session as { wallet?: unknown } | null | undefined;
  const address = data.address ?? user?.wallet ?? session?.wallet;
  return typeof address === "string" && address.length > 0 ? address : undefined;
}

/** The requestId the auth session is currently bound to, if any. */
export function sessionRequestIdFromData(data: LiquidAuthSessionData): string | undefined {
  const session = data.session as { requestId?: unknown } | null | undefined;
  const requestId = session?.requestId ?? data.requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

/**
 * Canonicalizes an address-ish value (a canonical Algorand address
 * passes through; a base64 public key is encoded) so comparisons don't
 * depend on how a given store keys its accounts.
 */
function canonicalAddress(value: string): string {
  try {
    return toAlgorandAddress(value);
  } catch {
    return value;
  }
}

/** Whether the auth session authenticates the given wallet address. */
export function sessionMatchesWallet(data: LiquidAuthSessionData, walletAddress: string): boolean {
  const address = sessionAddressFromData(data);
  return !!address && canonicalAddress(address) === canonicalAddress(walletAddress);
}

/**
 * Whether the server's origin-scoped cookie session ALREADY
 * authenticates this wallet, the gate the auto-resume orchestrator
 * checks before attempting a silent resume: when it is false, resuming
 * would run the passkey ceremony, and a spontaneous system passkey
 * sheet must never pop without a user action.
 */
export async function isSessionAuthenticated(
  origin: string,
  walletAddress: string,
): Promise<boolean> {
  const data = await fetchAuthSession(origin);
  return data !== null && sessionMatchesWallet(data, walletAddress);
}

/**
 * Whether a failed passkey assertion should fall back to re-registration
 * via attestation. User-driven aborts (cancellation, timeout,
 * interruption) are excluded so the user's choice is respected;
 * everything else (e.g. the device lost the credential after a
 * reinstall while the server still holds it) is recoverable.
 */
export function isRecoverableAssertionFailure(error: unknown): boolean {
  const code = (error as { error?: unknown } | null)?.error;
  return !(
    typeof code === "string" &&
    (code === "UserCancelled" || code === "TimedOut" || code === "Interrupted")
  );
}

/** Credential ids worth trying an assertion with, most specific first. */
function candidateCredentialIds(origin: string, address: string): string[] {
  const rpId = new URL(origin).hostname;
  const candidates = [
    localStorage.getString(CREDENTIAL_KEY_PREFIX + origin),
    ...passkeysStore.state.passkeys
      .filter((p) => p.rpId === rpId || p.origin === origin || p.origin === rpId)
      .map((p) => p.credentialId),
    // Legacy fallback the reference wallet also tries: some deployments
    // resolve the wallet address to its credential.
    address,
  ];
  const seen = new Set<string>();
  return candidates.filter((id): id is string => {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Fetches assertion options for the first credential the server knows. */
async function findAssertionOptions(
  origin: string,
  address: string,
): Promise<{ credentialId: string; options: Record<string, unknown> } | null> {
  for (const credentialId of candidateCredentialIds(origin, address)) {
    const res = await authFetch(
      `${origin}/assertion/request/${encodeURIComponent(credentialId)}`,
      "POST",
      { userVerification: "required" },
    );
    if (res.ok && res.json && typeof res.json === "object") {
      return { credentialId, options: res.json as Record<string, unknown> };
    }
  }
  return null;
}

/** The `liquid` client extension completing either ceremony. */
async function liquidExtension(
  wallet: LiquidCeremonyWallet,
  origin: string,
  requestId: string,
  challenge: Uint8Array,
): Promise<Record<string, unknown>> {
  return {
    type: "algorand",
    requestId,
    origin,
    address: wallet.address,
    signature: toBase64Url(await wallet.signChallenge(challenge)),
    device: wallet.device ?? "React Native Wallet",
  };
}

/** Asserts an existing passkey (`Passkey.get`) and submits the response. */
async function assertExistingPasskey(
  origin: string,
  requestId: string,
  wallet: LiquidCeremonyWallet,
  options: Record<string, unknown>,
): Promise<void> {
  const liquid = await liquidExtension(
    wallet,
    origin,
    requestId,
    fromBase64Url(options.challenge as string),
  );
  // The server's assertion options are already the base64url-string JSON
  // shape react-native-passkey consumes.
  const credential = await Passkey.get(options as unknown as Parameters<typeof Passkey.get>[0]);
  const res = await authFetch(`${origin}/assertion/response`, "POST", {
    id: credential.id,
    rawId: credential.rawId ?? credential.id,
    type: credential.type ?? "public-key",
    response: credential.response,
    clientExtensionResults: { liquid },
  });
  if (!res.ok) {
    throw new Error(`liquid-auth assertion response rejected: ${res.status} ${res.statusText}`);
  }
  localStorage.set(CREDENTIAL_KEY_PREFIX + origin, credential.id);
}

/** Registers a new passkey (`Passkey.create`) and submits the response. */
async function attestNewPasskey(
  origin: string,
  requestId: string,
  wallet: LiquidCeremonyWallet,
): Promise<void> {
  const optionsRes = await authFetch(`${origin}/attestation/request`, "POST", {
    username: wallet.address,
    displayName: wallet.address,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    // The service refuses requests without the liquid extension opt-in.
    extensions: { liquid: true },
  });
  if (!optionsRes.ok || !optionsRes.json || typeof optionsRes.json !== "object") {
    throw new Error(
      `liquid-auth attestation request rejected: ${optionsRes.status} ${optionsRes.statusText}`,
    );
  }
  const options = optionsRes.json as Record<string, unknown>;
  const liquid = await liquidExtension(
    wallet,
    origin,
    requestId,
    fromBase64Url(options.challenge as string),
  );
  // The WebAuthn user handle is the account's public key, so future
  // assertions map the credential back to the Algorand address.
  const user = {
    ...(options.user as Record<string, unknown> | undefined),
    id: toBase64Url(algosdk.decodeAddress(wallet.address).publicKey),
    name: wallet.address,
    displayName: wallet.address,
  };
  const credential = await Passkey.create({ ...options, user } as Parameters<
    typeof Passkey.create
  >[0]);
  const res = await authFetch(`${origin}/attestation/response`, "POST", {
    id: credential.id,
    rawId: credential.rawId,
    type: credential.type ?? "public-key",
    response: {
      clientDataJSON: credential.response.clientDataJSON,
      attestationObject: credential.response.attestationObject,
    },
    clientExtensionResults: { liquid },
  });
  if (!res.ok) {
    throw new Error(`liquid-auth attestation response rejected: ${res.status} ${res.statusText}`);
  }
  localStorage.set(CREDENTIAL_KEY_PREFIX + origin, credential.id);
}

/** Options tuning {@link runLiquidAuthCeremony}'s session-reuse gate. */
export interface LiquidCeremonyOptions {
  /**
   * Whether the wallet has already paired the request's session before
   * (the connections store holds a persisted session for the
   * requestId). A previously paired session may reuse the server's
   * authenticated cookie session even when it is currently bound to a
   * DIFFERENT requestId: the native offerer path re-binds it via a
   * fire-and-forget `link(requestId)` before sending the offer. A
   * first-time pairing must still run the FIDO2 ceremony, since only its
   * `auth` event resolves the dapp's initial `link`.
   */
  previouslyPaired?: boolean;
}

/**
 * Runs the full Liquid Auth ceremony against `origin` for `requestId`:
 * assertion when the server recognizes one of the wallet's credentials,
 * attestation otherwise (or when the local passkey is unusable). On
 * return, the native cookie-jar session is authenticated and the
 * signaling socket may join the request's room.
 *
 * The ceremony is SKIPPED entirely when `GET /auth/session` shows the
 * server already authenticates this wallet AND the session is bound to
 * this requestId (or the wallet previously paired it; see
 * {@link LiquidCeremonyOptions.previouslyPaired}), so reconnects never
 * re-prompt the system passkey sheet while the server session lives.
 */
export async function runLiquidAuthCeremony(
  origin: string,
  requestId: string,
  wallet: LiquidCeremonyWallet,
  opts?: LiquidCeremonyOptions,
): Promise<void> {
  const session = await fetchAuthSession(origin);
  if (session && sessionMatchesWallet(session, wallet.address)) {
    const boundRequestId = sessionRequestIdFromData(session);
    if (boundRequestId === requestId || opts?.previouslyPaired) {
      console.log(
        `liquid-auth session for ${origin} already authenticates ${wallet.address}; ` +
          "skipping the passkey ceremony",
      );
      return;
    }
  }
  const assertion = await findAssertionOptions(origin, wallet.address);
  if (assertion) {
    try {
      await assertExistingPasskey(origin, requestId, wallet, assertion.options);
      return;
    } catch (error) {
      // After an app reinstall the platform may no longer hold the
      // passkey even though the server still has the credential record.
      // Fall back to attestation to re-register instead of failing the
      // whole connection; user-driven aborts are re-thrown.
      if (!isRecoverableAssertionFailure(error)) throw error;
      console.warn("liquid-auth assertion failed; re-registering via attestation:", error);
    }
  }
  await attestNewPasskey(origin, requestId, wallet);
}
