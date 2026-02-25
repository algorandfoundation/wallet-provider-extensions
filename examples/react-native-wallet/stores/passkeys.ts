import type { PasskeyStoreState } from "@algorandfoundation/passkey-store";
import { Store } from "@tanstack/react-store";

export const passkeysStore = new Store<PasskeyStoreState>({
	passkeys: [],
});
