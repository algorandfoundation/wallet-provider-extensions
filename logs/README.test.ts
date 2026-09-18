import { Provider } from "@algorandfoundation/wallet-provider";

import { describe, expect, it } from "vitest";
import { WithLogs } from "./src/index.ts";

describe("Log Store README Examples", () => {
  it("should run the 'Register the Extension' example", async () => {
    // 1) Create a provider with the Log Store extension
    const MyProvider = Provider.withExtensions([WithLogs]);
    const provider = new MyProvider({ id: "my-provider", name: "My Wallet" });

    // 2) Emit logs through the provider API
    provider.log.info("Initialized wallet", { scope: "init" });
    provider.log.warn("Low balance warning", { account: "ABC123" });
    provider.log.error("Transaction failed", { txId: "XYZ" });

    // 3) Read logs from provider state
    expect(provider.logs).toHaveLength(3);
    expect(provider.logs[0].message).toBe("Transaction failed");

    // 4) Clear all logs
    provider.log.clear();

    expect(provider.logs).toHaveLength(0);
  });
});
