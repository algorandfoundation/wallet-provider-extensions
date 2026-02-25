import type { ConnectionStoreState } from "@algorandfoundation/connections-store";
import { Store } from "@tanstack/react-store";

export const connectionsStore = new Store<ConnectionStoreState>({
	connections: [],
});
