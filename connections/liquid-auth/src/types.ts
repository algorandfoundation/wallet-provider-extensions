import type { Connection } from "@algorandfoundation/connections-store";

/**
 * Represents a Liquid Auth connection.
 */
export interface LiquidAuthConnection extends Connection {
	/**
	 * The address of the account associated with the connection.
	 */
	address: string;
	/**
	 * The WebRTC data channel.
	 */
	channel?: RTCDataChannel;
}

/**
 * Options for the Liquid Auth extension.
 */
export interface LiquidAuthOptions {
	liquidAuth?: {
		apiKey?: string;
		endpoint?: string;
		/**
		 * Optionally provide a pre-configured client.
		 * This allows consumers to inject an instance of `SignalClient` from `@algorandfoundation/liquid-client`
		 */
		client?: any;
	};
}

/**
 * Interface representing the Liquid Auth extension API.
 */
export interface LiquidAuthApi {
	/**
	 * Create an offer (QR code/deep link).
	 * The client who creates the offer is the one displaying the QR code.
	 * @param origin - The origin of the dApp.
	 */
	createOffer: (origin: string) => Promise<{
		requestId: string;
		qrCode: () => Promise<any>;
		deepLink: string;
		wait: () => Promise<LiquidAuthConnection>;
	}>;
	/**
	 * Join as an answer client using a requestId (from QR code/deep link).
	 * @param requestId - The requestId from the offer.
	 * @param address - The address of the account to use for this connection.
	 * @param origin - The origin of the dApp.
	 */
	joinAsAnswer: (
		requestId: string,
		address: string,
		origin: string,
	) => Promise<LiquidAuthConnection>;
	/**
	 * Disconnect a Liquid Auth session.
	 * @param id - The connection ID.
	 */
	disconnect: (id: string) => Promise<void>;
}

/**
 * The interface exposed by the Liquid Auth Extension.
 */
export interface LiquidAuthExtension {
	/**
	 * An object that represents additional functionality provided by this extension.
	 */
	liquidAuth: LiquidAuthApi;
}
