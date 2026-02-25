import { useMemo } from 'react';
import type { Key } from "@algorandfoundation/keystore";

export const ROOT_COLORS = ['#007AFF', '#34C759', '#5856D6', '#AF52DE', '#FF9500', '#FF3B30', '#FFCC00', '#5AC8FA'];

/**
 * Hook to generate stable colors for seeds and root keys.
 *
 * @param keys - The list of keys from the provider.
 * @returns A record mapping key IDs to stable colors.
 */
export function useSeedColors(keys: Key[]) {
    return useMemo(() => {
        const seeds = keys.filter(k => k.type === 'hd-seed');
        const rootKeys = keys.filter(k => k.type === 'hd-root-key');
        const allRootKeys = [...seeds, ...rootKeys];

        return allRootKeys.reduce((acc, rootKey) => {
            // Find the top-most parent (the seed) for this root key to ensure consistent coloring
            const seedId = rootKey.type === 'hd-root-key'
                ? (rootKey.metadata?.parentKeyId || rootKey.metadata?.rootKeyId || rootKey.metadata?.parentId || rootKey.id) as string
                : rootKey.id;

            // Simple hash function for string ID
            let hash = 0;
            const idToHash = seedId || rootKey.id;
            for (let i = 0; i < idToHash.length; i++) {
                const char = idToHash.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash |= 0; // Convert to 32bit integer
            }
            acc[rootKey.id] = ROOT_COLORS[Math.abs(hash) % ROOT_COLORS.length];
            return acc;
        }, {} as Record<string, string>);
    }, [keys]);
}
