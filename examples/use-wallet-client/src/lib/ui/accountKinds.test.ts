import { describe, expect, it } from "vitest";
import { accountKind } from "./accountKinds.ts";
import type { ProviderWalletAccount } from "../accounts/types.ts";

const ADDRESS = "TESTADDRESS";

function account(overrides: Partial<ProviderWalletAccount> = {}): ProviderWalletAccount {
  return { name: "Account", address: ADDRESS, ...overrides };
}

describe("accountKind", () => {
  it("labels keystore accounts by their backing key type", () => {
    expect(
      accountKind(
        account({ type: "keystore-account", metadata: { keyType: "hd-derived-ed25519" } }),
      )?.label,
    ).toBe("HD Account");
    expect(
      accountKind(account({ type: "keystore-account", metadata: { keyType: "ed25519" } }))?.label,
    ).toBe("Ed25519 Account");
    expect(
      accountKind(
        account({
          type: "keystore-account",
          metadata: { keyType: "falcon-1024", pqScheme: "f1", pqSalt: 0 },
        }),
      )?.label,
    ).toBe("Falcon Account");
  });

  it("falls back to the account type when the key type is unknown", () => {
    expect(accountKind(account({ type: "keystore-account" }))?.label).toBe("Keystore Account");
    expect(
      accountKind(account({ type: "keystore-account", metadata: { keyType: "future-scheme" } }))
        ?.label,
    ).toBe("Keystore Account");
    expect(accountKind(account({ type: "watched" }))?.label).toBe("Watched Account");
  });

  it("resolves no kind for accounts without type information", () => {
    // e.g. accounts of wallets that don't transmit type/metadata (Pera, Lute).
    expect(accountKind(account())).toBeNull();
    expect(accountKind(account({ type: "something-else" }))).toBeNull();
    expect(accountKind(account({ metadata: { keyType: 42 as unknown as string } }))).toBeNull();
  });
});
