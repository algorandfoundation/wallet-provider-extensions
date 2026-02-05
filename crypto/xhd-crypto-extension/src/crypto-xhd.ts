// Requirements

// Shared Libraries
import type {
	BaseProvider,
	ExtensionOptions,
} from "@algorandfoundation/wallet-provider";
// Implementation Specifics
import { XHDWalletAPI } from "@algorandfoundation/xhd-wallet-api";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";

const xhd = new XHDWalletAPI();
export interface XHDCryptoExtension {
	crypto: XHDCryptoApi;
}

export interface XHDCryptoApi {
	xhd: XHDWalletAPI;
	sha512_256: typeof sha512_256;
	base32: typeof base32;
}
export const init = (
	provider: BaseProvider & { crypto: any },
	_: ExtensionOptions,
): XHDCryptoExtension => {
	return {
		crypto: {
			xhd,
			sha512_256,
			base32,
			...provider.crypto,
		},
	};
};
