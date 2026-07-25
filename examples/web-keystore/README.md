# Web Keystore Example

A small, framework-free (Vite + vanilla TypeScript) demo of the **browser keystore
extension** for the Wallet Provider. It persists key metadata in IndexedDB and runs
its cryptography through the host WebCrypto `SubtleCrypto` plus composable shims.

The page has four sections: the active **capabilities**, the **actions**, the current
**keys**, and a **console** where recovery phrases, signatures and exports are printed.

## What it demonstrates

- **Provider composition** — composing a `Provider` with the `WithKeyStore` extension.
- **Capability discovery** — the active algorithms rendered as chips, tagged by source
  (host `SubtleCrypto` vs. composable shim add-ons such as `BIP32-Ed25519` and
  `Falcon-1024`).
- **Reactive UI** — a `@tanstack/store` drives the rendering; the engine hydrates it
  behind the scenes during `key.store.ready`.
- **Hierarchical wallet** — generate a BIP39 seed, derive an HD (BIP32-Ed25519) root
  key, and derive Ed25519 accounts from it.
- **Post-quantum keys** — mint a `Falcon-1024` key alongside the HD hierarchy (only
  offered when the Falcon shim is active).
- **Per-key operations** — sign & verify, export public data, and remove — surfaced
  contextually based on each key's usages and whether it is extractable.

The keystore orchestration lives in [`src/keystore.ts`](./src/keystore.ts) as pure,
dependency-injected operations (mirroring the project's "store operations" convention);
[`src/main.ts`](./src/main.ts) only wires the DOM and renders reactive state.

## Running the example

1. Install dependencies from the repository root:

   ```bash
   pnpm install
   ```

2. Start the dev server:

   ```bash
   pnpm --filter web-keystore-example dev
   ```

3. Open the URL shown in the terminal (usually `http://localhost:5173`).

## Type checking

```bash
pnpm --filter web-keystore-example typecheck
```
