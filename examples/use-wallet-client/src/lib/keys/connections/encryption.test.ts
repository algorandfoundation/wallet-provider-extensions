import { describe, expect, it } from "vitest";

import {
  createSecureChannel,
  edwardsToX25519PublicKey,
  type ConnectionMessage,
} from "@algorandfoundation/connections";

import {
  PAGE_KEY_PAIR,
  SHARED_SECRET,
  WALLET_DID,
  WALLET_DID_DOCUMENT,
  WALLET_KEY_PAIR,
  WALLET_PUBLIC_KEY,
  agreementKeystore,
  identitySession,
  messagingConnection,
  walletRemoteIdentity,
} from "../../../testing/fixtures.ts";
import type { LocalIdentity } from "../../identities/types.ts";
import type { DappProvider } from "../../provider/provider.ts";
import {
  connectedWalletPeer,
  encryptDecryptWithWallet,
  sendEncryptedMessage,
  sessionMessages,
} from "./encryption.ts";

describe("connectedWalletPeer", () => {
  it("yields nothing until a session is connected", () => {
    const identities = [walletRemoteIdentity("session-1")];
    expect(connectedWalletPeer([], identities)).toBeNull();
    expect(
      connectedWalletPeer([identitySession({ status: "disconnected" })], identities),
    ).toBeNull();
    expect(connectedWalletPeer([identitySession({ status: "connecting" })], identities)).toBeNull();
  });

  it("yields nothing while the identity store holds no identity for the session", () => {
    expect(connectedWalletPeer([identitySession()], [])).toBeNull();
    // A wallet identity mirrored for ANOTHER session doesn't count.
    expect(
      connectedWalletPeer([identitySession()], [walletRemoteIdentity("other-session")]),
    ).toBeNull();
  });

  it("ignores local identities — the peer binds to the wallet's remote identity only", () => {
    // A local keystore-minted identity carries the same DID shape but the
    // "local" source discriminant; it is never an encryption peer.
    const local: LocalIdentity = {
      address: WALLET_DID,
      did: WALLET_DID,
      didDocument: WALLET_DID_DOCUMENT,
      type: "did:key",
      metadata: { source: "local", keyId: "key-1" },
    };

    expect(connectedWalletPeer([identitySession()], [local])).toBeNull();
  });

  it("resolves the wallet's keyAgreement key from the mirrored identity", () => {
    const session = identitySession();
    const peer = connectedWalletPeer(
      [identitySession({ status: "disconnected", id: "old" }), session],
      [walletRemoteIdentity(session.id)],
    );

    expect(peer).not.toBeNull();
    expect(peer!.session.id).toBe(session.id);
    expect(peer!.identity.did).toBe(WALLET_DID);
    // The key the panel encrypts against IS the wallet identity's X25519 twin.
    expect(peer!.remotePublicKey).toEqual(edwardsToX25519PublicKey(WALLET_PUBLIC_KEY));
  });

  it("falls back to converting the did:key id when no DID document rode along", () => {
    const peer = connectedWalletPeer(
      [identitySession()],
      [walletRemoteIdentity("session-1", { didDocument: undefined })],
    );

    expect(peer).not.toBeNull();
    expect(peer!.remotePublicKey).toEqual(edwardsToX25519PublicKey(WALLET_PUBLIC_KEY));
  });

  it("prefers the most recently updated connected session", () => {
    const stale = identitySession({ id: "stale", updatedAt: 1 });
    const fresh = identitySession({ id: "fresh", updatedAt: 2 });
    const identities = [walletRemoteIdentity("stale"), walletRemoteIdentity("fresh")];

    expect(connectedWalletPeer([stale, fresh], identities)!.session.id).toBe("fresh");
  });
});

describe("encryptDecryptWithWallet", () => {
  it("seals and opens a message through the wallet-bound secure channel", () => {
    const roundTrip = encryptDecryptWithWallet(SHARED_SECRET, "hello over the shared key");

    expect(roundTrip.decrypted).toBe("hello over the shared key");
    expect(roundTrip.nonce).not.toHaveLength(0);
    expect(roundTrip.ciphertext).not.toContain("hello");
  });

  it("produces frames the wallet opens from its own identity half", () => {
    // The symmetry the demo banks on: the wallet derives the SAME secret
    // from its private key and the page's public key, so the frame the
    // page sealed from the precomputed shared secret opens on its side.
    const roundTrip = encryptDecryptWithWallet(SHARED_SECRET, "read me on the wallet");
    const walletChannel = createSecureChannel({
      privateKey: WALLET_KEY_PAIR.privateKey,
      remotePublicKey: PAGE_KEY_PAIR.publicKey,
    });

    expect(
      walletChannel.decryptText({ nonce: roundTrip.nonce, ciphertext: roundTrip.ciphertext }),
    ).toBe("read me on the wallet");
  });

  it("derives distinct frames per call (fresh random nonce)", () => {
    const first = encryptDecryptWithWallet(SHARED_SECRET, "same message");
    const second = encryptDecryptWithWallet(SHARED_SECRET, "same message");

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
});

describe("sendEncryptedMessage", () => {
  /**
   * Assembles the provider context (`ctx`) the flow takes as its first
   * parameter: the connector-carried instance, staged from the fixture
   * scenario.
   */
  function makeCtx() {
    const { connection, channels } = messagingConnection();
    const keystore = agreementKeystore();
    const ctx = { connection, key: { store: keystore } } as unknown as DappProvider;
    return { ctx, connection, channels, keystore };
  }

  it("derives once, registers the channel, and sends over it", async () => {
    const { ctx, connection, channels, keystore } = makeCtx();
    const peer = connectedWalletPeer(
      [identitySession({ id: "send-1" })],
      [walletRemoteIdentity("send-1")],
    )!;

    const sent = await sendEncryptedMessage(ctx, peer, "agreement-1", "hi");
    await sendEncryptedMessage(ctx, peer, "agreement-1", "again");

    // The ECDH ran ONCE (against the wallet's keyAgreement key); the
    // registered channel is reused for the second send.
    expect(keystore.deriveSharedSecret).toHaveBeenCalledExactlyOnceWith(
      "agreement-1",
      peer.remotePublicKey,
      true,
    );
    expect(connection.enableSecureMessaging).toHaveBeenCalledOnce();
    expect(connection.sendSecureMessage).toHaveBeenCalledTimes(2);
    expect(sent.status).toBe("delivered");

    // The registered channel seals frames the WALLET's own half opens,
    // the end-to-end property the demo banks on.
    const sealed = channels.get("send-1")!.channel.encrypt("proof");
    expect(createSecureChannel({ sharedSecret: SHARED_SECRET }).decryptText(sealed)).toBe("proof");
  });

  it("re-derives when the agreement key changed", async () => {
    const { ctx, connection, keystore } = makeCtx();
    const peer = connectedWalletPeer(
      [identitySession({ id: "send-2" })],
      [walletRemoteIdentity("send-2")],
    )!;

    await sendEncryptedMessage(ctx, peer, "agreement-1", "hi");
    await sendEncryptedMessage(ctx, peer, "agreement-2", "hi");

    expect(keystore.deriveSharedSecret).toHaveBeenCalledTimes(2);
    expect(connection.enableSecureMessaging).toHaveBeenCalledTimes(2);
  });
});

describe("sessionMessages", () => {
  it("filters to the session and sorts oldest first", () => {
    const message = (id: string, sessionId: string, createdAt: number): ConnectionMessage => ({
      id,
      sessionId,
      direction: "outgoing",
      text: id,
      status: "delivered",
      createdAt,
      updatedAt: createdAt,
    });

    const log = sessionMessages(
      [message("b", "s-1", 2), message("x", "s-2", 1), message("a", "s-1", 1)],
      "s-1",
    );

    expect(log.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
