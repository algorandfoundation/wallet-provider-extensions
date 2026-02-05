import type { Store } from "@tanstack/store";
import type { SecretKey } from "./types.js";

// This store is TBD, likely will evolve to support different contexts (React Native, Web, RPC Service)
export interface KeyStoreState {
	secrets: SecretKey[];
}

export function addSecret(
	store: Store<KeyStoreState>,
	secret: SecretKey,
): void {
	store.setState((state) => {
		return {
			secrets: [secret, ...state.secrets],
		};
	});
}

export function removeSecret(
	store: Store<KeyStoreState>,
	secretKeyId: string,
): void {
	store.setState((state) => {
		return {
			secrets: state.secrets.filter((secret) => secret.id !== secretKeyId),
		};
	});
}

export function getSecret(
	store: Store<KeyStoreState>,
	secretKeyId: string,
): SecretKey | undefined {
	return store.state.secrets.find((secret) => secret.id === secretKeyId);
}
