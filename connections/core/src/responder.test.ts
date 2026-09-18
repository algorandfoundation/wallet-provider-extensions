import { describe, expect, it, vi } from "vitest";

import { createDomainRegistry, defineDomain } from "./domains.ts";
import { createWalletResponder } from "./responder.ts";
import { createConnectionRpc } from "./rpc.ts";
import { createInMemoryTransportPair } from "./transport.ts";
import type { ConnectionRpc } from "./rpc.ts";

/** Encodes bytes as standard base64 (test mirror of the responder's codec). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function setupPair(): { dapp: ConnectionRpc; wallet: ConnectionRpc } {
  const { a, b } = createInMemoryTransportPair();
  return { dapp: createConnectionRpc(a), wallet: createConnectionRpc(b) };
}

describe("Wallet Responder", () => {
  it("answers connect with the registry's exposed domains and metadata", async () => {
    const { dapp, wallet } = setupPair();
    const responder = createWalletResponder({
      domains: createDomainRegistry([
        defineDomain({ id: "accounts", expose: () => [{ address: "ADDR", name: "Main" }] }),
      ]),
      signTransactions: async () => [],
      metadata: { name: "My Wallet" },
    });
    responder.attach(wallet);

    const result = await dapp.request("connect", { metadata: { name: "Dapp" } });
    expect(result).toEqual({
      domains: { accounts: [{ address: "ADDR", name: "Main" }] },
      metadata: { name: "My Wallet" },
    });
  });

  it("transmits domain records through connect verbatim", async () => {
    const { dapp, wallet } = setupPair();
    // A wallet exposing its account kinds: the keystore bridge's metadata
    // (keyType, PQ address derivation for Falcon accounts) travels the
    // handshake so the dapp can label HD vs Falcon vs watched accounts.
    const accounts = [
      {
        address: "HDADDR",
        name: "HD Account",
        type: "keystore-account",
        metadata: { keyId: "key-1", keyType: "hd-derived-ed25519", seedScheme: "bip39" },
      },
      {
        address: "FALCONADDR",
        name: "Falcon Account",
        type: "keystore-account",
        metadata: { keyId: "key-2", keyType: "falcon-1024", pqScheme: "f1", pqSalt: 1 },
      },
      { address: "WATCHEDADDR", name: "Watched", type: "watched" },
    ];
    const passkey = { credentialId: "cred-id-1", rpId: "dapp.example", userName: "main" };
    const responder = createWalletResponder({
      domains: createDomainRegistry([
        defineDomain({ id: "accounts", expose: () => accounts }),
        defineDomain({ id: "passkeys", expose: () => [passkey] }),
      ]),
      signTransactions: async () => [],
    });
    responder.attach(wallet);

    const result = await dapp.request("connect", {});
    expect(result).toEqual({ domains: { accounts, passkeys: [passkey] } });
  });

  it("announces supported domains with empty arrays when they expose nothing", async () => {
    const { dapp, wallet } = setupPair();
    const responder = createWalletResponder({
      domains: createDomainRegistry([
        defineDomain({ id: "accounts", expose: () => [] }),
        defineDomain({ id: "identities" }),
      ]),
      signTransactions: async () => [],
    });
    responder.attach(wallet);

    const result = await dapp.request("connect", {});
    expect(result).toEqual({ domains: { accounts: [], identities: [] } });
  });

  it("answers connect with an empty domains map when no registry is provided", async () => {
    const { dapp, wallet } = setupPair();
    const responder = createWalletResponder({
      signTransactions: async () => [],
    });
    responder.attach(wallet);

    const result = await dapp.request("connect", {});
    expect(result).toEqual({ domains: {} });
  });

  it("routes the dapp's inbound domains to the registry scoped by sessionId", async () => {
    const { dapp, wallet } = setupPair();
    const receive = vi.fn();
    const identity = { address: "did:key:zIDENTITY", didDocument: { id: "did:key:zIDENTITY" } };
    const responder = createWalletResponder({
      domains: createDomainRegistry([defineDomain({ id: "identities", receive })]),
      sessionId: "session-1",
      signTransactions: async () => [],
    });
    responder.attach(wallet);

    await dapp.request("connect", { domains: { identities: [identity] } });

    expect(receive).toHaveBeenCalledWith("session-1", [identity], undefined);
  });

  it("does not route inbound domains without a sessionId to scope them", async () => {
    const { dapp, wallet } = setupPair();
    const receive = vi.fn();
    const responder = createWalletResponder({
      domains: createDomainRegistry([defineDomain({ id: "identities", receive })]),
      signTransactions: async () => [],
    });
    responder.attach(wallet);

    await dapp.request("connect", { domains: { identities: [] } });

    expect(receive).not.toHaveBeenCalled();
  });

  it("rejects connect with code rejected when the approval gate denies", async () => {
    const { dapp, wallet } = setupPair();
    const receive = vi.fn();
    const responder = createWalletResponder({
      domains: createDomainRegistry([defineDomain({ id: "identities", receive })]),
      sessionId: "session-1",
      signTransactions: async () => [],
      approveConnect: () => false,
    });
    responder.attach(wallet);

    await expect(dapp.request("connect", { domains: { identities: [] } })).rejects.toMatchObject({
      code: "rejected",
    });
    // A denied handshake must not mirror the dapp's records.
    expect(receive).not.toHaveBeenCalled();
  });

  it("decodes txns, routes indexesToSign, and re-encodes signed results", async () => {
    const { dapp, wallet } = setupPair();
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5, 6]);
    const signed = new Uint8Array([9, 9, 9]);
    const signTransactions = vi.fn(
      async (txns: Uint8Array[], indexesToSign?: number[]): Promise<(Uint8Array | null)[]> => {
        expect(txns).toEqual([first, second]);
        expect(indexesToSign).toEqual([1]);
        return [null, signed];
      },
    );
    const responder = createWalletResponder({
      signTransactions,
    });
    responder.attach(wallet);

    const result = await dapp.request("sign_transactions", {
      txns: [bytesToBase64(first), bytesToBase64(second)],
      indexesToSign: [1],
    });

    expect(signTransactions).toHaveBeenCalledOnce();
    expect(result).toEqual({ stxns: [null, bytesToBase64(signed)] });
  });

  it("rejects sign_transactions with code rejected when the approval gate denies", async () => {
    const { dapp, wallet } = setupPair();
    const signTransactions = vi.fn(async (): Promise<(Uint8Array | null)[]> => []);
    const responder = createWalletResponder({
      signTransactions,
      approveSignTransactions: () => false,
    });
    responder.attach(wallet);

    await expect(dapp.request("sign_transactions", { txns: [] })).rejects.toMatchObject({
      code: "rejected",
    });
    expect(signTransactions).not.toHaveBeenCalled();
  });

  it("rejects unknown methods with method_not_found", async () => {
    const { dapp, wallet } = setupPair();
    const responder = createWalletResponder({
      signTransactions: async () => [],
    });
    responder.attach(wallet);

    await expect(dapp.request("unknown_method", {})).rejects.toMatchObject({
      code: "method_not_found",
    });
  });

  it("detaches via the function returned by attach", async () => {
    const { dapp, wallet } = setupPair();
    const responder = createWalletResponder({
      signTransactions: async () => [],
    });
    const detach = responder.attach(wallet);
    detach();

    await expect(dapp.request("connect", {})).rejects.toMatchObject({
      code: "method_not_found",
    });
  });
});
