import { useContext, useEffect, useMemo } from "react";
import { useStore } from "@tanstack/react-store";

import { AlgorandContext } from "@/providers/ReactNativeProvider";
import { keyStore } from "@/stores/keystore";
import { accountsStore } from "@/stores/accounts";
import { identitiesStore } from "@/stores/identities";
import { selectionStore } from "@/stores/selection";
import { buildKeyColorMap, colorForKeyId, FALLBACK_COLOR } from "@/utils/rootColors";

/**
 * Hook to access the Algorand Provider context.
 * This hook is non-reactive to store changes.
 */
export function useProvider() {
  const provider = useContext(AlgorandContext);
  if (provider === null) throw new Error("No Provider Found");
  return provider;
}

/**
 * Hook to access all keys.
 */
export function useKeys() {
  const provider = useProvider();

  useEffect(() => {
    function beforeGenerate() {
      console.log("Hooking into before generate");
    }
    provider.key.store.hooks?.before("generate", beforeGenerate);

    return () => {
      provider.key.store.hooks?.remove("generate", beforeGenerate);
    };
  }, [provider]);

  return useStore(keyStore, (state) => state.keys);
}

/**
 * Hook to access the keystore status.
 */
export function useKeystoreStatus() {
  return useStore(keyStore, (state) => state.status);
}

/**
 * Hook to access the active keystore algorithm add-ons ("shims"), e.g.
 * `"BIP32-Ed25519"`, `"Falcon-1024"`. The list reflects what the engine
 * resolved at runtime, so optional add-ons only appear when available.
 */
export function useShims() {
  return useStore(keyStore, (state) => state.algorithms ?? []);
}

/**
 * Hook to access a specific key by its ID.
 */
export function useKeyByID(id: string | null) {
  return useStore(keyStore, (state) => (id ? state.keys.find((k) => k.id === id) : undefined));
}

/**
 * Hook to access all accounts.
 */
export function useAccounts() {
  return useStore(accountsStore, (state) => state.accounts);
}

/**
 * Hook to access a specific account by its address.
 */
export function useAccountByAddress(address: string | null) {
  return useStore(accountsStore, (state) =>
    address ? state.accounts.find((a) => a.address === address) : undefined,
  );
}

/**
 * Hook to access all identities.
 */
export function useIdentities() {
  return useStore(identitiesStore, (state) => state.identities);
}

/**
 * Hook to access a specific identity by its address.
 */
export function useIdentityByAddress(address: string | null) {
  return useStore(identitiesStore, (state) =>
    address ? state.identities.find((i) => i.address === address) : undefined,
  );
}

/**
 * Hook to access the full UI selection state (selected seed/root key).
 */
export function useSelection() {
  return useStore(selectionStore, (state) => state);
}

/**
 * Hook to access the currently selected seed ID.
 */
export function useSelectedSeedId() {
  return useStore(selectionStore, (state) => state.selectedSeedId);
}

/**
 * Hook to access the currently selected root key ID.
 */
export function useSelectedRootKeyId() {
  return useStore(selectionStore, (state) => state.selectedRootKeyId);
}

/**
 * Reactive map of `keyId -> hex color`. Each key is colored by the
 * top-most ancestor (seed/root) it descends from, so derived keys,
 * accounts, and identities all visually inherit the same color as
 * the seed they trace back to.
 *
 * @example
 * ```tsx
 * const { byKeyId, colorFor } = useRootColors();
 * const color = colorFor(account.metadata?.keyId);
 * ```
 */
export function useRootColors() {
  const keys = useKeys();
  return useMemo(() => {
    const byKeyId = buildKeyColorMap(keys);
    return {
      byKeyId,
      colorFor: (keyId: string | undefined | null) => colorForKeyId(keyId, byKeyId),
      fallback: FALLBACK_COLOR,
    };
  }, [keys]);
}
