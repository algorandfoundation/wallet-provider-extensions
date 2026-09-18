import { describe, expect, it } from "vitest";

import { WithAccounts } from "./extension.ts";
import type { Account } from "./types.ts";

describe("WithAccounts", () => {
  it("mounts the account store scoped to the extension's wallet key", async () => {
    const provider = { id: "wallet-1" } as any;
    const extension = WithAccounts<Account>(provider, { accounts: {} });

    expect(extension.account.store).toBeDefined();

    await extension.account.store.addAccount({ address: "ADDR", name: "Main" });
    expect(extension.accounts).toEqual([{ address: "ADDR", name: "Main" }]);
  });

  it("mounts no remote member: the connections mirror lives in the bridge package", () => {
    const provider = { id: "wallet-1" } as any;
    const extension = WithAccounts<Account>(provider, { accounts: {} });

    expect("remote" in extension.account).toBe(false);
  });
});
