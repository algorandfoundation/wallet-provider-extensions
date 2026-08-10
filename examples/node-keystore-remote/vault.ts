/**
 * A stand-in Open Wallet Standard vault.
 *
 * The daemon in this example is meant to run in front of a **real** OWS node
 * (`resolveOwsBinding()` picks the NAPI bindings or the `ows` CLI), but the
 * example must be runnable on a machine that has never installed OWS. So it
 * ships this in-memory binding: it implements the same `OwsBinding` seam the
 * real access layers do, keeps real Ed25519 keys in memory (via `node:crypto`,
 * so the signatures the consumer receives verify for real) and enforces the one
 * behaviour that matters most for the demo — **every material-touching call is
 * authenticated**, and a wrong credential is a denial, never a silent success.
 *
 * Set `OWS_REAL=1` when running the daemon to use the real access layer instead.
 */

import { createPrivateKey, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import type { OwsBinding } from "@algorandfoundation/keystore-node";

/** One wallet of the stand-in vault: a name, a credential and one Ed25519 key. */
interface FakeWallet {
  id: string;
  name: string;
  createdAt: string;
  chainId: string;
  address: string;
  privateKeyPem: string;
}

/** The error shape the OWS surfaces raise, carrying a canonical code. */
function owsError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Mints a wallet with a fresh Ed25519 key pair. */
function mintWallet(name: string): FakeWallet {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "jwk" }).x as string;
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    // Ed25519 chain, so the keystore projects the account as an EdDSA key.
    chainId: "solana:localnet",
    address: Buffer.from(raw, "base64url").toString("hex"),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

/** Options for {@link createFakeOwsVault}. */
export interface FakeOwsVaultOptions {
  /** The credential every material-touching call must present. */
  passphrase: string;
  /** Wallets to mint up front. */
  wallets?: string[];
}

/**
 * Creates the stand-in vault binding.
 *
 * @param options - {@link FakeOwsVaultOptions}.
 * @returns An `OwsBinding` the OWS keystore engine can be pointed at.
 */
export function createFakeOwsVault(options: FakeOwsVaultOptions): OwsBinding {
  const wallets = new Map<string, FakeWallet>();
  for (const name of options.wallets ?? []) {
    const wallet = mintWallet(name);
    wallets.set(wallet.id, wallet);
  }

  /** Refuses the call unless the presented credential is the vault's. */
  const authenticate = (passphrase?: string): void => {
    if (passphrase !== options.passphrase) {
      throw owsError("INVALID_PASSPHRASE", "the presented credential is not valid for this vault");
    }
  };

  /** Looks a wallet up by id or name, the way OWS accepts either. */
  const find = (nameOrId: string): FakeWallet => {
    const wallet =
      wallets.get(nameOrId) ?? [...wallets.values()].find((entry) => entry.name === nameOrId);
    if (!wallet) throw owsError("WALLET_NOT_FOUND", `no wallet named ${nameOrId}`);
    return wallet;
  };

  /** Signs `bytes` with the wallet's key, returning a hex signature. */
  const signBytes = (wallet: FakeWallet, bytes: Uint8Array): { signature: string } => ({
    signature: nodeSign(null, bytes, createPrivateKey(wallet.privateKeyPem)).toString("hex"),
  });

  const describe = (wallet: FakeWallet) => ({
    id: wallet.id,
    name: wallet.name,
    createdAt: wallet.createdAt,
    accounts: [
      {
        chainId: wallet.chainId,
        address: wallet.address,
        derivationPath: "m/44'/501'/0'/0'",
      },
    ],
  });

  return {
    kind: "example-in-memory",
    listWallets: async () => [...wallets.values()].map(describe),
    getWallet: async (nameOrId) => describe(find(nameOrId)),
    createWallet: async ({ name, passphrase }) => {
      authenticate(passphrase);
      const wallet = mintWallet(name);
      wallets.set(wallet.id, wallet);
      return describe(wallet);
    },
    importMnemonic: async ({ name, passphrase }) => {
      authenticate(passphrase);
      // A real vault derives from the phrase; the stand-in only proves the path.
      const wallet = mintWallet(name);
      wallets.set(wallet.id, wallet);
      return describe(wallet);
    },
    importPrivateKey: async ({ name, passphrase }) => {
      authenticate(passphrase);
      const wallet = mintWallet(name);
      wallets.set(wallet.id, wallet);
      return describe(wallet);
    },
    deleteWallet: async (nameOrId) => {
      wallets.delete(find(nameOrId).id);
    },
    exportWallet: async () => {
      throw owsError("POLICY_DENIED", "this vault never reveals secret material");
    },
    signMessage: async ({ wallet, message, encoding, passphrase }) => {
      authenticate(passphrase);
      const bytes =
        encoding === "utf8" ? new TextEncoder().encode(message) : Buffer.from(message, "hex");
      return signBytes(find(wallet), bytes);
    },
    signTransaction: async ({ wallet, transactionHex, passphrase }) => {
      authenticate(passphrase);
      return signBytes(find(wallet), Buffer.from(transactionHex, "hex"));
    },
  };
}
