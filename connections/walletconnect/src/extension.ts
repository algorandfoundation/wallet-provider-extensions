import {
	type ConnectionStoreExtension,
} from "@algorandfoundation/connections-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";
import SignClient from "@walletconnect/sign-client";
import type {
	WalletConnectApi,
	WalletConnectConnection,
	WalletConnectExtension,
	WalletConnectOptions,
} from "./types.js";

/**
 * Extension that implements WalletConnect connection management.
 */
export const WithWalletConnect: Extension<WalletConnectExtension> = (
	provider: Provider<any> & ConnectionStoreExtension,
	options: WalletConnectOptions,
) => {
	// 1. Ensure Connection Store (Dependency) is present
	if (!provider.connection?.store) {
		throw new Error(
			"WithWalletConnect extension requires WithConnectionStore extension to be present on the provider.",
		);
	}

	const connectionStore = provider.connection.store;
	let client: SignClient | undefined;

	const initClient = async () => {
		if (client) return client;
		if (!options?.walletconnect?.projectId) {
			throw new Error("WalletConnect projectId is required");
		}
		client = await SignClient.init({
			projectId: options.walletconnect.projectId,
			metadata: options.walletconnect.metadata,
		});

		// Setup event listeners
		client.on("session_delete", async ({ topic }) => {
			await connectionStore.removeConnection(topic);
		});

		return client;
	};

	const walletconnect: WalletConnectApi = {
		connect: async (uri: string) => {
			const signClient = await initClient();
			const { approval } = await signClient.connect({
				pairingTopic: uri.includes("?")
					? new URLSearchParams(uri.split("?")[1]).get("pairingTopic") ||
						undefined
					: undefined,
			});

			const session = await approval();

			const connection: WalletConnectConnection = {
				id: session.topic, // Use topic as ID
				topic: session.topic,
				name: session.peer.metadata.name,
				peer: {
					name: session.peer.metadata.name,
					description: session.peer.metadata.description,
					url: session.peer.metadata.url,
					icons: session.peer.metadata.icons,
				},
				metadata: {
					namespaces: session.namespaces,
				},
			};

			await connectionStore.addConnection(connection);
			return connection;
		},
		disconnect: async (topic: string) => {
			const signClient = await initClient();
			await signClient.disconnect({
				topic,
				reason: {
					code: 6000,
					message: "User disconnected",
				},
			});
			await connectionStore.removeConnection(topic);
		},
	};

	return {
		walletconnect,
	} as WalletConnectExtension;
};
