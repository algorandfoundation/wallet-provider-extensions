import type { Connection } from "@algorandfoundation/connections-store";

/**
 * Represents a WalletConnect connection.
 */
export interface WalletConnectConnection extends Connection {
	/**
	 * The WalletConnect session topic.
	 */
	topic: string;
	/**
	 * The peer metadata.
	 */
	peer: {
		name: string;
		description: string;
		url: string;
		icons: string[];
	};
}

/**
 * Options for the WalletConnect extension.
 */
export interface WalletConnectOptions {
	walletconnect?: {
		projectId: string;
		metadata: {
			name: string;
			description: string;
			url: string;
			icons: string[];
		};
	};
}

/**
 * Interface representing the WalletConnect extension API.
 */
export interface WalletConnectApi {
	/**
	 * Connect to a dApp via WalletConnect URI.
	 * @param uri - The WalletConnect URI.
	 */
	connect: (uri: string) => Promise<WalletConnectConnection>;
	/**
	 * Disconnect a WalletConnect session.
	 * @param topic - The session topic.
	 */
	disconnect: (topic: string) => Promise<void>;
}

/**
 * The interface exposed by the WalletConnect Extension.
 */
export interface WalletConnectExtension {
	/**
	 * An object that represents additional functionality provided by this extension.
	 */
	walletconnect: WalletConnectApi;
}
