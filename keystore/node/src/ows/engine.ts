/**
 * @module ows/engine
 *
 * The OWS keystore engine: a drop-in {@link KeyStore} whose custodian is an
 * [Open Wallet Standard](https://openwallet.sh/) vault.
 *
 * Unlike the OS-keychain engine, this one owns **no** material and therefore
 * drives no {@link import("@algorandfoundation/keystore-core").KeyStoreDriver}:
 * OWS keeps custody of the seed, evaluates its policies and signs, while the
 * engine only projects the vault into the reactive store and translates the
 * keystore API onto the OWS abstract operations. It is the same relationship
 * the RPC client engine has with a remote keystore service, so an OWS-backed
 * provider is configured exactly like any other — `provider.key.store.sign(id,
 * bytes)` just happens to be answered by OWS.
 *
 * What the standard forbids, the engine refuses rather than emulates:
 * `export` is gated behind an explicit opt-in, and `verify` — which OWS has no
 * operation for — throws instead of silently reporting success.
 */

import type {
  ExportOptions,
  GenerateOptions,
  Key,
  KeyData,
  KeyFormat,
  KeyId,
  KeyStoreCapability,
} from "@algorandfoundation/keystore-core";
import { InvalidKeyDataError, InvalidKeyFormatError } from "@algorandfoundation/keystore-core";
import { hex } from "@scure/base";

import { createOwsBinding } from "./binding.ts";
import { chainCurve, chainFamily } from "./chains.ts";
import { OwsUnsupportedOperationError, toKeyStoreError } from "./errors.ts";
import { parseKeyId, selectKey, setKeys, setStatus, toKeys } from "./store.ts";
import type {
  OwsBinding,
  OwsContext,
  OwsKeyStore,
  OwsKeyStoreOptions,
  OwsSignOperation,
  OwsSignResult,
  OwsWalletInfo,
} from "./types.ts";

/** The signing capabilities an OWS vault exposes, for `state.algorithms`. */
const OWS_ALGORITHMS: KeyStoreCapability[] = [
  { algorithm: "EdDSA", source: "host" },
  { algorithm: "ES256K", source: "host" },
];

/** Minimum word count that makes a string a plausible BIP-39 mnemonic. */
const MIN_MNEMONIC_WORDS = 12;

/** Decodes a hex string, tolerating a `0x` prefix and upper-case digits. */
function fromHex(value: string): Uint8Array {
  const normalized = value.replace(/^0x/i, "").toLowerCase();
  const padded = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
  return hex.decode(padded);
}

/** Maps the `algorithm` argument of `sign` onto an OWS signing operation. */
function toSignOperation(algorithm?: string): OwsSignOperation | undefined {
  switch (algorithm) {
    case "message":
      return "message";
    case "tx":
    case "transaction":
      return "transaction";
    case "hash":
      return "hash";
    default:
      return undefined;
  }
}

/**
 * Flattens an OWS signing result into signature bytes.
 *
 * secp256k1 chains report the recovery id separately; it is appended as the
 * trailing byte, yielding the customary 65-byte `r || s || v` layout callers
 * expect from an EVM/Tron signature.
 */
function toSignatureBytes(result: OwsSignResult): Uint8Array {
  const signature = fromHex(result.signature);
  if (result.recoveryId === undefined) return signature;
  const withRecovery = new Uint8Array(signature.length + 1);
  withRecovery.set(signature, 0);
  withRecovery[signature.length] = result.recoveryId & 0xff;
  return withRecovery;
}

/** Picks the account a freshly created/imported wallet should be addressed by. */
function preferredKeyId(wallet: OwsWalletInfo, keys: Key[], wanted?: string): KeyId {
  const accounts = wallet.accounts ?? [];
  const account =
    accounts.find((a) => a.chainId === wanted || chainFamily(a.chainId) === wanted) ??
    accounts.find((a) => chainCurve(a.chainId) === wanted) ??
    accounts[0];
  if (!account) {
    throw new InvalidKeyDataError(`OWS wallet ${wallet.id} exposes no accounts`);
  }
  const id = keys.find(
    (key) =>
      key.metadata?.["walletId"] === wallet.id && key.metadata?.["chainId"] === account.chainId,
  )?.id;
  if (!id) {
    throw new InvalidKeyDataError(`OWS wallet ${wallet.id} is missing from the vault listing`);
  }
  return id;
}

/**
 * Creates a keystore backed by an OWS vault.
 *
 * The reactive `store` is hydrated with one {@link Key} per OWS wallet account
 * (`ows/<walletId>/<chainId>`), carrying the account's address, chain and
 * derivation path as metadata and nothing secret. Every material-touching call
 * is authenticated by OWS itself: pass the owner passphrase — or an
 * `ows_key_…` agent token, which makes OWS evaluate the attached policies —
 * either once via {@link OwsKeyStoreOptions.passphrase} or per operation via
 * the {@link OwsContext}.
 *
 * `sign` maps onto the OWS signing interface: `"message"` (the default),
 * `"transaction"` for already-serialized transaction bytes and `"hash"` for a
 * raw 32-byte digest, selected through the `algorithm` argument or
 * {@link OwsContext.operation}.
 *
 * @param options - {@link OwsKeyStoreOptions}.
 * @returns The {@link OwsKeyStore}.
 *
 * @example
 * ```typescript
 * import { Store } from "@tanstack/store";
 * import { createOwsKeyStore } from "@algorandfoundation/keystore-node/ows";
 *
 * const store = new Store({ keys: [], status: "idle" });
 * const keystore = createOwsKeyStore({ store, passphrase: process.env.OWS_TOKEN });
 * await keystore.ready;
 *
 * const [account] = store.state.keys; // e.g. "ows/3198bc9c-.../eip155:1"
 * const signature = await keystore.sign(
 *   account.id,
 *   new TextEncoder().encode("hello world"),
 *   "message",
 *   { encoding: "utf8" },
 * );
 * ```
 */
export function createOwsKeyStore(options: OwsKeyStoreOptions): OwsKeyStore {
  const { store } = options;
  const binding: OwsBinding =
    options.binding ??
    createOwsBinding(options.vaultPath === undefined ? {} : { vaultPath: options.vaultPath });

  /** The credential for this call: the per-operation one wins over the default. */
  const credential = (ctx?: OwsContext): string | undefined =>
    ctx?.passphrase ?? options.passphrase;

  const refresh = async (): Promise<Key[]> => {
    const keys = toKeys(await binding.listWallets());
    setKeys(store, keys);
    return keys;
  };

  const ready = (async (): Promise<void> => {
    await binding.ready;
    const keys = await refresh();
    store.setState(() => ({ keys, status: "idle", algorithms: OWS_ALGORITHMS }));
  })();

  /** Resolves a key id to the OWS wallet + chain family it addresses. */
  const resolve = (id: KeyId): { wallet: string; chain: string; chainId: string; key: Key } => {
    const { walletId, chainId } = parseKeyId(id);
    return { wallet: walletId, chain: chainFamily(chainId), chainId, key: selectKey(store, id) };
  };

  /** Runs an OWS call, publishing `status` and classifying any failure. */
  const perform = async <T>(status: string, id: KeyId | undefined, fn: () => Promise<T>) => {
    setStatus(store, status);
    try {
      return await fn();
    } catch (error) {
      throw toKeyStoreError(error, id);
    } finally {
      setStatus(store, "idle");
    }
  };

  const walletName = (): string =>
    `${options.walletName ?? "keystore"}-${crypto.randomUUID().slice(0, 8)}`;

  const api: OwsKeyStore = {
    ready,
    get binding(): Promise<OwsBinding> {
      return ready.then(() => binding);
    },

    async refresh(): Promise<Key[]> {
      await ready;
      return refresh();
    },

    /**
     * Creates a **new OWS wallet** (a fresh BIP-39 mnemonic and one account per
     * supported chain) and returns the key id of the account that matches the
     * request. `params.name`, `params.words` and `params.chain` steer the OWS
     * call; the key `type`/`algorithm` act as a curve preference when no chain
     * is given.
     */
    async generate(generateOptions: GenerateOptions, ctx?: OwsContext): Promise<KeyId> {
      await ready;
      const params = generateOptions.params ?? {};
      const name = typeof params["name"] === "string" ? params["name"] : walletName();
      const passphrase = credential(ctx);
      return perform("generating", undefined, async () => {
        const wallet = await binding.createWallet({
          name,
          ...(passphrase === undefined ? {} : { passphrase }),
          ...(typeof params["words"] === "number" ? { words: params["words"] } : {}),
        });
        const keys = await refresh();
        const wanted =
          typeof params["chain"] === "string"
            ? params["chain"]
            : generateOptions.type === "ed25519"
              ? "ed25519"
              : undefined;
        return preferredKeyId(wallet, keys, wanted);
      });
    },

    /**
     * Imports an existing secret into the OWS vault as a new wallet: a BIP-39
     * mnemonic (a string of twelve words or more, or `metadata.mnemonic`) or a
     * raw private key (bytes, a hex string, or `privateKey`).
     */
    async import(
      data: (Omit<KeyData, "id"> & { id?: KeyId }) | Uint8Array | string,
      format?: KeyFormat,
      ctx?: OwsContext,
    ): Promise<KeyId> {
      await ready;
      if (format !== undefined && format !== "raw") {
        throw new InvalidKeyFormatError(format);
      }
      const passphrase = credential(ctx);
      const record = typeof data === "object" && !(data instanceof Uint8Array) ? data : undefined;
      const metadata = record?.metadata ?? {};
      const name =
        typeof metadata["name"] === "string" ? (metadata["name"] as string) : walletName();
      const chain =
        typeof metadata["chain"] === "string" ? (metadata["chain"] as string) : undefined;

      const mnemonic =
        typeof data === "string" && data.trim().split(/\s+/).length >= MIN_MNEMONIC_WORDS
          ? data.trim()
          : typeof metadata["mnemonic"] === "string"
            ? (metadata["mnemonic"] as string)
            : undefined;
      const privateKeyHex =
        data instanceof Uint8Array
          ? hex.encode(data)
          : typeof data === "string" && mnemonic === undefined
            ? data.trim()
            : record?.privateKey
              ? hex.encode(record.privateKey)
              : undefined;

      if (mnemonic === undefined && privateKeyHex === undefined) {
        throw new InvalidKeyDataError("OWS import expects a mnemonic or a private key");
      }

      return perform("importing", undefined, async () => {
        const wallet =
          mnemonic === undefined
            ? await binding.importPrivateKey({
                name,
                privateKeyHex: privateKeyHex as string,
                ...(passphrase === undefined ? {} : { passphrase }),
                ...(chain === undefined ? {} : { chain }),
              })
            : await binding.importMnemonic({
                name,
                mnemonic,
                ...(passphrase === undefined ? {} : { passphrase }),
              });
        const keys = await refresh();
        return preferredKeyId(wallet, keys, chain);
      });
    },

    /**
     * Exports the OWS wallet secret behind `id`: the mnemonic (as
     * `metadata.mnemonic`) or the curve's private key bytes.
     *
     * Refused unless {@link OwsKeyStoreOptions.allowExport} was enabled — an
     * access layer must not reveal decrypted material unless an export was
     * explicitly asked for.
     */
    async export(id: KeyId, exportOptions?: ExportOptions, ctx?: OwsContext): Promise<KeyData> {
      await ready;
      if (options.allowExport !== true) {
        throw new OwsUnsupportedOperationError(
          "export",
          "set `allowExport` to reveal an OWS wallet secret",
        );
      }
      if (exportOptions !== undefined && exportOptions.format !== "raw") {
        throw new InvalidKeyFormatError(exportOptions.format);
      }
      const { wallet, chainId, key } = resolve(id);
      const passphrase = credential(ctx);
      return perform("exporting", id, async () => {
        const secret = await binding.exportWallet(wallet, passphrase);
        const curve = chainCurve(chainId);
        let privateKey: Uint8Array | undefined;
        let mnemonic: string | undefined;
        try {
          const keys = JSON.parse(secret) as Record<string, unknown>;
          const material = keys[curve];
          if (typeof material === "string") privateKey = fromHex(material);
        } catch {
          mnemonic = secret;
        }
        return {
          ...key,
          ...(privateKey === undefined ? {} : { privateKey }),
          metadata: {
            ...key.metadata,
            ...(mnemonic === undefined ? {} : { mnemonic }),
          },
        } satisfies KeyData;
      });
    },

    /**
     * Deletes the OWS wallet behind `id`. OWS's unit of deletion is the wallet,
     * so **every** account derived from it disappears, not just this chain's.
     */
    async remove(id: KeyId): Promise<void> {
      await ready;
      const { wallet } = resolve(id);
      await perform("removing", id, async () => {
        await binding.deleteWallet(wallet);
        await refresh();
      });
    },

    /** Deletes every wallet in the OWS vault. */
    async clear(): Promise<void> {
      await ready;
      await perform("clearing", undefined, async () => {
        for (const wallet of await binding.listWallets()) {
          await binding.deleteWallet(wallet.id);
        }
        await refresh();
      });
    },

    /**
     * Signs `data` with the OWS account behind `id`.
     *
     * The OWS operation is chosen by `algorithm` (`"message"`, `"transaction"`
     * / `"tx"`, `"hash"`) or {@link OwsContext.operation}, defaulting to
     * `"message"`. Message bytes are handed to OWS hex-encoded unless
     * {@link OwsContext.encoding} is `"utf8"`, in which case they are decoded
     * as text first so the chain's message prefix applies to the intended
     * string. When the chain reports a recovery id it is appended as the
     * trailing signature byte.
     */
    async sign(
      id: KeyId,
      data: Uint8Array,
      algorithm?: string,
      ctx?: OwsContext,
    ): Promise<Uint8Array> {
      await ready;
      const { wallet, chain } = resolve(id);
      const operation = ctx?.operation ?? toSignOperation(algorithm) ?? "message";
      const passphrase = credential(ctx);
      const request = {
        wallet,
        chain,
        ...(passphrase === undefined ? {} : { passphrase }),
        ...(ctx?.index === undefined ? {} : { index: ctx.index }),
      };
      return perform("signing", id, async () => {
        if (operation === "transaction") {
          return toSignatureBytes(
            await binding.signTransaction({ ...request, transactionHex: hex.encode(data) }),
          );
        }
        if (operation === "hash") {
          if (data.length !== 32) {
            throw new InvalidKeyDataError("OWS hash signing expects a 32-byte digest");
          }
          if (!binding.signHash) {
            throw new OwsUnsupportedOperationError(
              "signHash",
              `the ${binding.kind} access layer does not expose raw digest signing`,
            );
          }
          return toSignatureBytes(
            await binding.signHash({ ...request, hashHex: hex.encode(data) }),
          );
        }
        const encoding = ctx?.encoding ?? "hex";
        return toSignatureBytes(
          await binding.signMessage({
            ...request,
            message: encoding === "utf8" ? new TextDecoder().decode(data) : hex.encode(data),
            encoding,
          }),
        );
      });
    },

    /**
     * Always throws: OWS is a custodian and signer with no verification
     * operation, and the engine holds no public key material to verify with.
     * Verify with a chain library (viem, `@solana/web3.js`, …) using the
     * account address exposed in the key metadata.
     */
    verify(): Promise<boolean> {
      return Promise.reject(
        new OwsUnsupportedOperationError(
          "verify",
          "OWS exposes no verification operation; verify against the account address instead",
        ),
      );
    },

    async batchSign(ids: KeyId[], data: Uint8Array[], ctx?: OwsContext): Promise<Uint8Array[]> {
      const signatures: Uint8Array[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        signatures.push(await api.sign(ids[i] as KeyId, data[i] as Uint8Array, undefined, ctx));
      }
      return signatures;
    },
  };

  if (!options.hooks) return api;

  // Hooks were bound at creation: wrap every operation so `before`/`after`/
  // `error` hooks can intercept it, mirroring the core orchestrator.
  const hooks = options.hooks;
  const run = hooks as unknown as (
    name: string,
    method: () => Promise<unknown>,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;

  const intercept =
    <A extends unknown[], R>(
      name: string,
      method: (...args: A) => Promise<R>,
    ): ((...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      run(name, () => method.apply(api, args), { args }) as Promise<R>;

  const wrapped = { ...api, hooks } as OwsKeyStore;
  wrapped.generate = intercept("generate", api.generate.bind(api));
  wrapped.import = intercept("import", api.import.bind(api));
  wrapped.export = intercept("export", api.export.bind(api));
  wrapped.remove = intercept("remove", api.remove.bind(api));
  wrapped.sign = intercept("sign", api.sign.bind(api));
  wrapped.verify = intercept("verify", api.verify.bind(api)) as OwsKeyStore["verify"];
  wrapped.batchSign = intercept("batchSign", api.batchSign?.bind(api) as never);
  wrapped.clear = intercept("clear", api.clear?.bind(api) as never);
  return wrapped;
}
