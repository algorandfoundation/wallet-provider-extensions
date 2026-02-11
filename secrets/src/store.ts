import type { Store } from "@tanstack/store";
import type { Secret, SecretStoreState } from "./types.js";

// Collection of Mutations
export function addSecret({
	store,
	secret,
}: {
	store: Store<SecretStoreState>;
	secret: Secret;
}): Secret {
	store.setState((state) => {
		return {
			secrets: [secret, ...state.secrets],
			activeSecret: secret,
		};
	});
	return secret;
}

export function removeSecret({
	store,
	secretId,
}: {
	store: Store<SecretStoreState>;
	secretId: string;
}): void {
	store.setState((state) => {
		return {
			secrets: state.secrets.filter((secret) => secret.id !== secretId),
			activeSecret:
				state.activeSecret?.id === secretId ? null : state.activeSecret,
		};
	});
}

export function getSecret({
	store,
	secretId,
}: {
	store: Store<SecretStoreState>;
	secretId: string;
}): Secret | undefined {
	return store.state.secrets.find((secret) => secret.id === secretId);
}
