import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type {
  State,
  WalletAccount,
  WalletKey as UseWalletKey,
  WalletState as UseWalletState,
} from "@txnlab/use-wallet";
import { describe, expectTypeOf, it } from "vitest";
import type {
  Account,
  AccountsNamespace,
  AccountStoreOptions,
  AccountStoreState,
  BaseAccount,
  WalletKey,
  WalletState,
} from "./types.ts";

describe("options registry", () => {
  it("registers options.accounts as the non-generic AccountsNamespace", () => {
    expectTypeOf<ExtensionOptions["accounts"]>().toEqualTypeOf<AccountsNamespace | undefined>();
  });

  it("AccountStoreOptions narrows the accounts block without conflicting with the registry", () => {
    type Narrowed = NonNullable<AccountStoreOptions<Account, State<Account>>["accounts"]>;
    expectTypeOf<Narrowed["store"]>().toEqualTypeOf<Store<State<Account>> | undefined>();
    expectTypeOf<Narrowed["walletKey"]>().toEqualTypeOf<WalletKey | undefined>();
    expectTypeOf<AccountStoreOptions>().toExtend<Omit<ExtensionOptions, "accounts">>();
    // The generic block is a valid value for the registered namespace.
    expectTypeOf<Narrowed>().toExtend<AccountsNamespace>();
  });
});

describe("structural twin assignability with @txnlab/use-wallet", () => {
  it("BaseAccount is a structural twin of WalletAccount", () => {
    expectTypeOf<BaseAccount>().toExtend<WalletAccount>();
    expectTypeOf<WalletAccount>().toExtend<BaseAccount>();
  });

  it("Account and WalletAccount are mutually assignable in the generic seat", () => {
    expectTypeOf<Account>().toExtend<WalletAccount>();
    expectTypeOf<WalletAccount>().toExtend<Account>();
  });

  it("WalletKey is a structural twin of use-wallet's WalletKey", () => {
    expectTypeOf<WalletKey>().toEqualTypeOf<UseWalletKey>();
  });

  it("WalletState is a structural twin of use-wallet's WalletState", () => {
    expectTypeOf<WalletState<Account>>().toExtend<UseWalletState<Account>>();
    expectTypeOf<UseWalletState<Account>>().toExtend<WalletState<Account>>();
    expectTypeOf<WalletState>().toExtend<UseWalletState<Account>>();
    expectTypeOf<UseWalletState>().toExtend<WalletState<WalletAccount>>();
  });

  it("use-wallet's State<T> structurally extends AccountStoreState<T>", () => {
    expectTypeOf<State<Account>>().toExtend<AccountStoreState<Account>>();
    expectTypeOf<State>().toExtend<AccountStoreState<WalletAccount>>();
  });

  it("a Store<State<Account>> is accepted as the extension's store option", () => {
    type StoreOption = NonNullable<
      NonNullable<AccountStoreOptions<Account, State<Account>>["accounts"]>["store"]
    >;
    expectTypeOf<Store<State<Account>>>().toExtend<StoreOption>();
  });
});
