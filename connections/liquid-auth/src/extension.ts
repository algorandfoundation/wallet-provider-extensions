import type { AccountStoreExtension } from "@algorandfoundation/accounts-store";
import type { ConnectionStoreExtension } from "@algorandfoundation/connections-store";
import { SignalClient } from "@algorandfoundation/liquid-client";
import type { PasskeyStoreExtension } from "@algorandfoundation/passkey-store";
import type { Extension, Provider } from "@algorandfoundation/wallet-provider";
import type {
	LiquidAuthApi,
	LiquidAuthConnection,
	LiquidAuthExtension,
	LiquidAuthOptions,
} from "./types.js";

/**
 * Extension that implements Liquid Auth connection management.
 */
export const WithLiquidAuth: Extension<LiquidAuthExtension> = (
	provider: Provider<any> &
		ConnectionStoreExtension &
		AccountStoreExtension &
		PasskeyStoreExtension,
	options: LiquidAuthOptions,
) => {
	// 1. Ensure Connection Store (Dependency) is present
	if (!provider.connection?.store) {
		throw new Error(
			"WithLiquidAuth extension requires WithConnectionStore extension to be present on the provider.",
		);
	}

	// 2. Ensure Account Store (Dependency) is present
	if (!provider.account?.store) {
		throw new Error(
			"WithLiquidAuth extension requires WithAccountStore extension to be present on the provider.",
		);
	}

	// 3. Ensure Passkey Store (Dependency) is present
	if (!provider.passkey?.store) {
		throw new Error(
			"WithLiquidAuth extension requires WithPasskeyStore extension to be present on the provider.",
		);
	}

	const connectionStore = provider.connection.store;
	const accountStore = provider.account.store;
	// @ts-expect-error - Will be used in future implementation to add new passkeys
	const passkeyStore = provider.passkey.store;
	let client: SignalClient | undefined = options?.liquidAuth
		?.client as SignalClient;

	const getPasskeyByAccount = async (address: string) => {
		const passkeys = provider.passkeys;
		return passkeys.find((p) => p.metadata?.userHandle === address);
	};

	const initClient = async (origin: string) => {
		if (client) return client;
		if (!options?.liquidAuth?.endpoint) {
			throw new Error("Liquid Auth endpoint is required");
		}
		client = new SignalClient(options.liquidAuth.endpoint, {
			query: { origin },
		} as any);
		return client;
	};

	const liquidAuth: LiquidAuthApi = {
		createOffer: async (origin: string) => {
			const signalClient = await initClient(origin);
			const requestId = SignalClient.generateRequestId();

			return {
				requestId,
				qrCode: () => signalClient.qrCode(),
				deepLink: signalClient.deepLink(requestId),
				wait: async () => {
					// 1. Wait for link (remote authentication)
					const linkMessage = await signalClient.link(requestId);

					// 2. Establish P2P connection as offer
					const channel = await signalClient.peer(requestId, "offer");

					const connection: LiquidAuthConnection = {
						id: linkMessage.wallet, // Use wallet address as ID
						address: linkMessage.wallet,
						name: linkMessage.wallet,
						channel,
					};

					await connectionStore.addConnection(connection);
					return connection;
				},
			};
		},
		joinAsAnswer: async (
			requestId: string,
			address: string,
			origin: string,
		) => {
			const signalClient = await initClient(origin);

			let parsedRequestId = requestId;
			if (requestId.includes("requestId=")) {
				const url = new URL(requestId);
				parsedRequestId = url.searchParams.get("requestId") || requestId;
			}

			// 1. Ensure account exists in the store
			const account = await accountStore.getAccount(address);
			if (!account) {
				throw new Error(
					`Account with address ${address} not found in the account store.`,
				);
			}

			// 2. Remote authentication with local passkeys
			const existingPasskey = await getPasskeyByAccount(address);

			if (existingPasskey) {
				// We have a passkey, use assertion
				await signalClient.assertion();
			} else {
				// No passkey found, create a new one using attestation
				await signalClient.attestation(async (challenge: Uint8Array) => {
					if (!account.sign) {
						throw new Error(`Account ${address} does not support signing.`);
					}
					const signed = await account.sign([challenge]);
					return signed[0];
				}, (cred)=>{
					console.log(cred)
				});
			}

			// Join the room and peer as answer
			const channel = await signalClient.peer(parsedRequestId, "answer");

			const connection: LiquidAuthConnection = {
				id: address,
				address,
				name: "Remote Peer", // We might get more info from SignalClient events
				channel,
			};

			await connectionStore.addConnection(connection);
			return connection;
		},
		disconnect: async (id: string) => {
			// Disconnect doesn't necessarily need an origin to close the client
			// but we might need one if initClient is called
			const signalClient = await initClient("system");
			signalClient.close(true);
			await connectionStore.removeConnection(id);
		},
	};

	connectionStore.hooks.before("clear", async () => {
		const connections = provider.connections.filter(
			(c) => !!(c as LiquidAuthConnection).address,
		);
		for (const c of connections) {
			await liquidAuth.disconnect(c.id);
		}
	});

	return {
		liquidAuth,
	} as LiquidAuthExtension;
};
