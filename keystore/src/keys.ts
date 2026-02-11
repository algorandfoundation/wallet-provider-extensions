import type {
	BIP32DerivationType,
	KeyContext,
} from "@algorandfoundation/xhd-wallet-api";
import type { Key } from "./types.ts";

// TODO: move Algorand25Key to accounts extensions, not required for KMS
export interface Algorand25Key extends Key {
	type: "algo25";
	algorithm: "EdDSA";
	secretId: string;
	metadata: {
		curve: "ed25519";
		address: string;
	} & Record<string, any>;
}

export interface XHDDerivedKey extends Key {
	type: "xhd-derived";
	algorithm: "EdDSA";
	metadata: {
		curve: "ed25519";
		derivationPath: string;
		derivationType: BIP32DerivationType;
		context: KeyContext.Address | KeyContext.Identity;
		account: number;
		keyIndex: number;
	} & Record<string, any>;
}

export interface XHDDerivedPasskey extends Key {
	type: "xhd-passkey";
	algorithm: "ES256";
	metadata: {
		curve: "secp256r1";
		origin: string;
		userHandle: string;
		counter: number;
	} & Record<string, any>;
}
