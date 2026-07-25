/**
 * The default composable {@link SubtleShim} set — every algorithm add-on the
 * keystore supports, wired to its concrete primitive binding, enabled out of
 * the box.
 *
 * {@link createKeyStore} uses this when the caller passes no `shims`, so a
 * keystore understands BIP32-Ed25519 (`xhd`), Falcon-1024, Deterministic-P256
 * (passkeys), BIP39 and Algo25 seeds without any wiring. Callers that want a
 * different/narrower stack (or platform-native bindings) still pass their own
 * `shims` array, which takes precedence.
 *
 * @remarks
 * Unlike the rest of `@algorandfoundation/keystore-core`, this module knows the
 * concrete primitive libraries (`@algorandfoundation/xhd-wallet-api`,
 * `falcon-1024`, `@algorandfoundation/dp256`, `@scure/bip39`) that back the
 * bundled algorithm add-ons. Those crypto libraries are **optional peer
 * dependencies** of core: the heavy `xhd`/`falcon`/`dp256` bindings are loaded
 * lazily via dynamic `import()` and are simply skipped when a downstream did
 * not install them, so a consumer only pays for the algorithms it actually
 * uses. `@scure/bip39` (and the built-in Algo25 codec) stay bundled with core.
 * This module stays tree-shakeable: consumers that supply their own `shims`
 * never reference it.
 */

import * as bip39lib from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";

import { createAlgo25Binding } from "./algo25.ts";
import {
  ALGO25_ALGORITHM,
  type Algo25Binding,
  BIP39_ALGORITHM,
  type BIP39Binding,
  DP256_ALGORITHM,
  type DP256Binding,
  FALCON_ALGORITHM,
  type Falcon1024Binding,
  type SubtleShim,
  tagShim,
  XHD_ALGORITHM,
  type XHDBinding,
  withSubtleAlgo25,
  withSubtleBIP39,
  withSubtleDP256,
  withSubtleFalcon1024,
  withSubtleXHD,
} from "./shims/index.ts";

/**
 * Per-algorithm binding overrides for {@link createDefaultShims}.
 *
 * A platform package supplies a binding here to inject its own (typically
 * native) implementation into the default shim stack instead of the bundled,
 * lazily-imported peer-dependency library. This is how React Native swaps the
 * WASM `falcon-1024` — which older React Native runtimes cannot load — for the
 * native `@joe-p/react-native-falcon` module: it passes `{ falcon: nativeBinding }`.
 *
 * Any field left unset falls back to the bundled default binding (loaded
 * lazily and skipped when its optional peer dependency is absent).
 */
export interface DefaultShimBindings {
  /** Overrides the bundled `@algorandfoundation/xhd-wallet-api` BIP32-Ed25519 binding. */
  xhd?: XHDBinding;
  /** Overrides the bundled `falcon-1024` binding (e.g. with `@joe-p/react-native-falcon`). */
  falcon?: Falcon1024Binding;
  /** Overrides the bundled `@algorandfoundation/dp256` Deterministic-P256 binding. */
  dp256?: DP256Binding;
  /** Overrides the bundled `@scure/bip39` binding. */
  bip39?: BIP39Binding;
  /** Overrides the built-in Algo25 codec binding. */
  algo25?: Algo25Binding;
}

/**
 * Builds the default {@link XHDBinding} backed by
 * `@algorandfoundation/xhd-wallet-api`'s `XHDWalletAPI`.
 *
 * The library is loaded lazily via dynamic `import()` because it is an optional
 * peer dependency of core; when it is not installed this resolves to
 * `undefined` and the XHD shim is left out of the default stack.
 *
 * @returns An {@link XHDBinding}, or `undefined` when the library is absent.
 */
export async function createXHDBinding(): Promise<XHDBinding | undefined> {
  let mod: typeof import("@algorandfoundation/xhd-wallet-api");
  try {
    mod = await import("@algorandfoundation/xhd-wallet-api");
  } catch {
    return undefined;
  }
  const { KeyContext, XHDWalletAPI, fromSeed, harden } = mod;
  const api = new XHDWalletAPI();
  return {
    fromSeed: (seed) => fromSeed(Buffer.from(seed)),
    deriveKey: (rootKey, bip44Path, isPrivate, derivationType) =>
      api.deriveKey(rootKey, bip44Path, isPrivate, derivationType),
    rawSign: (rootKey, bip44Path, data, derivationType) =>
      (
        api as unknown as {
          rawSign(
            rootKey: Uint8Array,
            bip44Path: number[],
            data: Uint8Array,
            derivationType: number,
          ): Promise<Uint8Array>;
        }
      ).rawSign(rootKey, bip44Path, data, derivationType),
    verifyWithPublicKey: (signature, message, publicKey) =>
      api.verifyWithPublicKey(signature, message, publicKey),
    ecdh: (rootKey, bip44Path, otherPartyPub, meFirst, derivationType) => {
      const context = bip44Path[1] === harden(283) ? KeyContext.Address : KeyContext.Identity;
      const account = (bip44Path[2] ?? harden(0)) & 0x7fff_ffff;
      const keyIndex = (bip44Path[4] ?? 0) & 0x7fff_ffff;
      return api.ECDH(rootKey, context, account, keyIndex, otherPartyPub, meFirst, derivationType);
    },
  };
}

/**
 * Builds the default {@link Falcon1024Binding} backed by the `falcon-1024`
 * module (whose exports already match the binding surface).
 *
 * The library is loaded lazily via dynamic `import()` because it is an optional
 * peer dependency of core; when it is not installed this resolves to
 * `undefined` and the Falcon shim is left out of the default stack.
 *
 * @returns A {@link Falcon1024Binding}, or `undefined` when the library is absent.
 */
export async function createFalconBinding(): Promise<Falcon1024Binding | undefined> {
  try {
    const falcon = await import("falcon-1024");
    return falcon as unknown as Falcon1024Binding;
  } catch {
    return undefined;
  }
}

/**
 * Builds the default {@link DP256Binding} backed by
 * `@algorandfoundation/dp256`'s `DeterministicP256`.
 *
 * The library is loaded lazily via dynamic `import()` because it is an optional
 * peer dependency of core; when it is not installed this resolves to
 * `undefined` and the Deterministic-P256 shim is left out of the default stack.
 *
 * @returns A {@link DP256Binding}, or `undefined` when the library is absent.
 */
export async function createDP256Binding(): Promise<DP256Binding | undefined> {
  let mod: typeof import("@algorandfoundation/dp256");
  try {
    mod = await import("@algorandfoundation/dp256");
  } catch {
    return undefined;
  }
  const { DeterministicP256 } = mod;
  const api = new DeterministicP256();
  return {
    genDerivedMainKey: (entropy, salt, iterationCount, keyLengthBytes) =>
      api.genDerivedMainKey(entropy, salt, iterationCount, keyLengthBytes),
    genDomainSpecificKeyPair: (mainKey, origin, userHandle, counter) =>
      api.genDomainSpecificKeyPair(mainKey, origin, userHandle, counter),
    signWithDomainSpecificKeyPair: (privateKey, payload) =>
      api.signWithDomainSpecificKeyPair(privateKey, payload),
    getPurePKBytes: (privateKey) => api.getPurePKBytes(privateKey),
  };
}

/**
 * Builds the default {@link BIP39Binding} backed by `@scure/bip39` and the
 * English wordlist.
 *
 * @returns A {@link BIP39Binding}.
 */
export function createBIP39Binding(): BIP39Binding {
  return {
    generateMnemonic: (strength) => bip39lib.generateMnemonic(englishWordlist, strength),
    entropyToMnemonic: (entropy) => bip39lib.entropyToMnemonic(entropy, englishWordlist),
    mnemonicToEntropy: (mnemonic) => bip39lib.mnemonicToEntropy(mnemonic, englishWordlist),
    mnemonicToSeed: (mnemonic, passphrase) => bip39lib.mnemonicToSeed(mnemonic, passphrase),
  };
}

/**
 * Builds the default composable shim stack — one decorator per supported
 * algorithm, each with its concrete binding applied.
 *
 * The order is irrelevant: each decorator handles only its own algorithm and
 * passes everything else through to the host.
 *
 * A platform can pass {@link DefaultShimBindings} to substitute its own
 * (typically native) binding for one or more algorithms — e.g. React Native
 * injects `@joe-p/react-native-falcon` as `{ falcon }` because it cannot load the WASM
 * `falcon-1024`. Any algorithm left unset falls back to the bundled default
 * binding (lazily imported, and skipped when its optional peer dependency is
 * absent).
 *
 * @param overrides - Optional per-algorithm binding overrides.
 * @returns The default {@link SubtleShim} array used by {@link createKeyStore}
 *   when no `shims` are supplied.
 *
 * @example
 * ```typescript
 * const keystore = createKeyStore({ driver, store }); // all shims on by default
 * // equivalent to:
 * const keystore = createKeyStore({ driver, store, shims: await createDefaultShims() });
 *
 * // React Native injects its native Falcon binding into the default set:
 * const shims = await createDefaultShims({ falcon: reactNativeFalconBinding });
 * ```
 */
export async function createDefaultShims(
  overrides: DefaultShimBindings = {},
): Promise<SubtleShim[]> {
  const shims: SubtleShim[] = [];

  // Optional peer-dependency bindings: an override takes precedence, otherwise
  // the bundled binding is loaded lazily and included only when it resolves.
  const xhd = overrides.xhd ?? (await createXHDBinding());
  if (xhd) shims.push(tagShim(XHD_ALGORITHM, (host) => withSubtleXHD(host, xhd)));
  const falconBinding = overrides.falcon ?? (await createFalconBinding());
  if (falconBinding) {
    shims.push(tagShim(FALCON_ALGORITHM, (host) => withSubtleFalcon1024(host, falconBinding)));
  }
  const dp256 = overrides.dp256 ?? (await createDP256Binding());
  if (dp256) shims.push(tagShim(DP256_ALGORITHM, (host) => withSubtleDP256(host, dp256)));

  // `@scure/bip39` and the built-in Algo25 codec ship with core, so their seed
  // shims are always available (still overridable by the caller).
  const bip39 = overrides.bip39 ?? createBIP39Binding();
  shims.push(tagShim(BIP39_ALGORITHM, (host) => withSubtleBIP39(host, bip39)));
  const algo25 = overrides.algo25 ?? createAlgo25Binding();
  shims.push(tagShim(ALGO25_ALGORITHM, (host) => withSubtleAlgo25(host, algo25)));

  return shims;
}
