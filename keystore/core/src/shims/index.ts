/**
 * @module shims
 * @packageDocumentation
 *
 * Composable decorators that extend any {@link SubtleCrypto} instance with
 * extra algorithm responsibilities, without relying on globals. Each decorator
 * takes the host Subtle plus an injected primitive binding and returns a new
 * `SubtleCrypto` that also understands one additional algorithm:
 *
 * ```typescript
 * // subtle = withSubtleXHD(hostSubtle, xhd)
 * const subtle = withSubtleFalcon1024(
 *   withSubtleXHD(crypto.subtle, xhd),
 *   falcon,
 * );
 * ```
 *
 * The concrete `xhd`/`falcon` primitives are supplied by the caller so the
 * same decorators work across platforms (Node/web via `@noble`-backed
 * libraries, React Native via native bindings) — core only depends on the
 * binding *types*.
 */

export {
  ALGO25_ALGORITHM,
  ALGO25_SEED_LENGTH,
  type Algo25Binding,
  type Algo25Params,
  withSubtleAlgo25,
} from "./algo25.ts";
export {
  BIP39_ALGORITHM,
  BIP39_DEFAULT_STRENGTH,
  type BIP39Binding,
  type BIP39Params,
  withSubtleBIP39,
} from "./bip39.ts";
export {
  DP256_ALGORITHM,
  DP256_DEFAULT_ITERATIONS,
  DP256_DEFAULT_KEY_LENGTH_BYTES,
  DP256_DEFAULT_SALT,
  type DP256Binding,
  type DP256Params,
  genDerivedMainKeyWithSubtle,
  withSubtleDerivedMainKey,
  withSubtleDP256,
} from "./dp256.ts";
export {
  FALCON_ALGORITHM,
  type Falcon1024Binding,
  type FalconParams,
  withSubtleFalcon1024,
} from "./falcon.ts";
export { consumeKeyMaterial, createKeyHandle, type SubtleShim, tagShim } from "./shim.ts";
export {
  BIP32DerivationType,
  withSubtleXHD,
  XHD_ALGORITHM,
  type XHDBinding,
  type XHDParams,
} from "./xhd.ts";
