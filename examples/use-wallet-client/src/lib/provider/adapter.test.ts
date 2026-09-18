import { beforeEach, describe, expect, it, vi } from "vitest";

import algosdk from "algosdk";
import { byteArrayToBase64 } from "@txnlab/use-wallet/adapter";
import type { WalletState } from "@txnlab/use-wallet/adapter";
import { ConnectionRpcError } from "@algorandfoundation/connections";
import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithIdentities, type IdentityStoreExtension } from "@algorandfoundation/identities";
import {
  memoryCredentialDriver,
  WithCredentials,
  type WebCredentialsExtension,
} from "@algorandfoundation/credentials";
import { WithPasskeys, type PasskeysExtension } from "@algorandfoundation/passkeys";

import {
  WALLET_ADDRESS_A,
  WALLET_ADDRESS_B,
  WALLET_CREDENTIAL,
  WALLET_IDENTITY,
  WALLET_PASSKEY,
  accountsSession,
  connectionApi,
  walletRemoteIdentity,
  type ConnectionApi,
} from "../../testing/fixtures.ts";
import { connectionsStore } from "../../stores/connectionsStore.ts";
import { dappWallet, ProviderAdapter, WALLET_ID, type DappWalletOptions } from "./adapter.ts";

// The connector OWNS its provider and app wiring (nothing is injected):
// the adapter CONSTRUCTS the provider in its constructor, so the tests
// substitute the modules it imports: the `createProvider` slot serves
// the fixture scenario per test, and the auto-resume entry points are
// spies.
const mocks = vi.hoisted(() => ({
  provider: undefined as unknown,
  createProvider: vi.fn(() => mocks.provider),
  installAutoResume: vi.fn(),
  suspendAutoResume: vi.fn(),
  kickResume: vi.fn(),
}));

vi.mock("./provider.ts", () => ({
  createProvider: mocks.createProvider,
}));

vi.mock("../connections/autoResume.ts", () => ({
  installAutoResume: mocks.installAutoResume,
  suspendAutoResume: mocks.suspendAutoResume,
  kickResume: mocks.kickResume,
}));

beforeEach(() => {
  mocks.createProvider.mockClear();
  mocks.installAutoResume.mockClear();
  mocks.suspendAutoResume.mockClear();
  mocks.kickResume.mockClear();
});

/** An official Provider with the domain stores (and their remote mirrors) mounted. */
const TestProvider = Provider.withExtensions([
  WithAccounts,
  WithIdentities,
  WithCredentials,
  WithPasskeys,
] as const);

/**
 * The provider stand-in the mocked `./provider.ts` slot serves to the
 * adapter: a real Provider with the accounts, identities, credentials,
 * and passkeys stores mounted (the full domain-store surfaces spelled
 * out because the tests read the reactive `identities`, `credentials`,
 * and `passkeys` lists), plus the fixture connection surface.
 */
type TestAdapterProvider = InstanceType<typeof TestProvider> &
  IdentityStoreExtension &
  WebCredentialsExtension &
  PasskeysExtension & { connection: ConnectionApi };

function makeProvider(connection: ConnectionApi): TestAdapterProvider {
  const provider = new TestProvider(
    { id: "test-provider", name: "Test Provider" },
    {
      // The example's own wiring: nothing persisted; the extensions
      // mount their own session-scoped remote mirrors next to the stores.
      credentials: { driver: memoryCredentialDriver() },
    },
  );
  return Object.assign(provider, { connection }) as TestAdapterProvider;
}

function makeAdapter(
  connection: ConnectionApi,
  options?: DappWalletOptions,
): {
  adapter: ProviderAdapter;
  provider: TestAdapterProvider;
  store: {
    state: WalletState | undefined;
    addWallet: ReturnType<typeof vi.fn>;
    removeWallet: ReturnType<typeof vi.fn>;
  };
} {
  const storeState: { state: WalletState | undefined } = { state: undefined };
  const addWallet = vi.fn((wallet: WalletState) => {
    storeState.state = wallet;
  });
  const removeWallet = vi.fn(() => {
    storeState.state = undefined;
  });
  const provider = makeProvider(connection);
  mocks.provider = provider;
  const params = {
    id: WALLET_ID,
    metadata: { ...ProviderAdapter.defaultMetadata },
    store: {
      getWalletState: () => storeState.state,
      getActiveWallet: () => null,
      getActiveNetwork: () => "testnet",
      getState: () => ({}) as any,
      addWallet,
      removeWallet,
      setAccounts: vi.fn(),
      setActiveAccount: vi.fn(),
      setActive: vi.fn(),
    },
    subscribe: () => () => {},
    getAlgodClient: () => ({}) as algosdk.Algodv2,
    options,
  } as unknown as ConstructorParameters<typeof ProviderAdapter>[0];
  return {
    adapter: new ProviderAdapter(params),
    provider,
    store: {
      get state() {
        return storeState.state;
      },
      addWallet,
      removeWallet,
    },
  };
}

function makePayTxn(sender: string): algosdk.Transaction {
  return new algosdk.Transaction({
    type: algosdk.TransactionType.pay,
    sender,
    paymentParams: { receiver: WALLET_ADDRESS_B, amount: 1000 },
    suggestedParams: {
      fee: 1000,
      minFee: 1000,
      firstValid: 1,
      lastValid: 1000,
      genesisID: "testnet-v1.0",
      genesisHash: new Uint8Array(32).fill(7),
      flatFee: true,
    },
  });
}

describe("ProviderAdapter", () => {
  it("constructs its provider from the adapter options and carries it as the ctx", () => {
    const options: DappWalletOptions = { signalUrl: "https://signal.example.com" };
    const { adapter, provider } = makeAdapter(connectionApi(), options);

    // The adapter options ARE the provider's construction options…
    expect(mocks.createProvider).toHaveBeenCalledExactlyOnceWith(options);
    // …the adapter carries the instance (the ctx every flow takes)…
    expect(adapter.provider).toBe(provider);
    // …and wires the app's auto-resume watcher to its connection.
    expect(mocks.installAutoResume).toHaveBeenCalledExactlyOnceWith(
      provider.connection,
      connectionsStore,
    );
  });

  it("connects through the provider connection and maps peer accounts", async () => {
    const connection = connectionApi();
    const { adapter, store } = makeAdapter(connection);

    const accounts = await adapter.connect();

    // No onFallback bridge: the ConnectModal observes the connections
    // store for the pending request (see ../ui/pendingRequest.ts).
    expect(connection.connect).toHaveBeenCalledExactlyOnceWith("liquid-auth", {
      signal: undefined,
    });
    expect(accounts).toEqual([
      { name: "Main", address: WALLET_ADDRESS_A },
      { name: "Wallet Provider Account 2", address: WALLET_ADDRESS_B },
    ]);
    expect(store.addWallet).toHaveBeenCalledOnce();
    expect(store.state?.activeAccount?.address).toBe(WALLET_ADDRESS_A);
  });

  it("lets the transmitted account type and metadata through verbatim", async () => {
    const metadata = { keyType: "falcon-1024", pqScheme: "f1", pqSalt: 1 };
    const connection = connectionApi({
      connect: vi.fn(async () =>
        accountsSession({
          peer: {
            domains: {
              accounts: [
                { address: WALLET_ADDRESS_A, name: "PQ", type: "keystore-account", metadata },
                { address: WALLET_ADDRESS_B },
              ],
            },
          },
        }),
      ),
    } as Partial<ConnectionApi>);
    const { adapter, store } = makeAdapter(connection);

    const accounts = await adapter.connect();

    // The wallet's account `type` and `metadata` are honored, not stripped;
    // untyped accounts stay bare (no empty `type`/`metadata` members).
    expect(accounts).toEqual([
      { name: "PQ", address: WALLET_ADDRESS_A, type: "keystore-account", metadata },
      { name: "Wallet Provider Account 2", address: WALLET_ADDRESS_B },
    ]);
    expect(store.state?.accounts).toEqual(accounts);
  });

  it("rejects a connect that exposes no accounts and closes the session", async () => {
    const connection = connectionApi({
      connect: vi.fn(async () => accountsSession({ peer: { domains: { accounts: [] } } })),
    } as Partial<ConnectionApi>);
    const { adapter, store } = makeAdapter(connection);

    await expect(adapter.connect()).rejects.toThrowError("no accounts");
    expect(connection.disconnect).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(store.addWallet).not.toHaveBeenCalled();
  });

  it("disconnect closes the connection and removes the wallet", async () => {
    const connection = connectionApi();
    const { adapter, store } = makeAdapter(connection);
    await adapter.connect();

    await adapter.disconnect();

    expect(connection.disconnect).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(store.removeWallet).toHaveBeenCalledOnce();
  });

  it("resumeSession is a no-op without persisted wallet state", async () => {
    const connection = connectionApi();
    const { adapter, store } = makeAdapter(connection);

    await adapter.resumeSession();

    expect(store.removeWallet).not.toHaveBeenCalled();
  });

  it("resumeSession disconnects when no session is persisted", async () => {
    const connection = connectionApi();
    const { adapter, store } = makeAdapter(connection);
    await adapter.connect(); // Persist wallet state.

    await adapter.resumeSession();

    expect(store.removeWallet).toHaveBeenCalledOnce();
    expect(connection.resume).not.toHaveBeenCalled();
  });

  it("resumeSession adopts a persisted disconnected session and kicks a background resume", async () => {
    const connection = connectionApi({
      store: {
        getSessions: async () => [
          accountsSession({ id: "session-persisted", status: "disconnected" }),
        ],
        getSession: async () => undefined,
      },
    });
    const { adapter, store } = makeAdapter(connection);
    await adapter.connect(); // Persist wallet state.

    await adapter.resumeSession();

    // Adopted optimistically: the persisted wallet state stays in place
    // and the transport re-establishes in the background.
    expect(store.removeWallet).not.toHaveBeenCalled();
    expect(store.state?.activeAccount?.address).toBe(WALLET_ADDRESS_A);
    expect(connection.resume).toHaveBeenCalledExactlyOnceWith("session-persisted");

    // Signing routes through the adopted session.
    await adapter.signTransactions([makePayTxn(WALLET_ADDRESS_A)]);
    expect(connection.signTransactions.mock.calls[0][0]).toBe("session-persisted");
  });

  it("resumeSession adopts a live connected session without resuming it", async () => {
    const connection = connectionApi({
      store: {
        getSessions: async () => [accountsSession({ id: "session-live" })],
        getSession: async () => undefined,
      },
    });
    const { adapter, store } = makeAdapter(connection);
    await adapter.connect();

    await adapter.resumeSession();
    expect(store.removeWallet).not.toHaveBeenCalled();
    expect(connection.resume).not.toHaveBeenCalled();

    // Signing now routes through the adopted session.
    await adapter.signTransactions([makePayTxn(WALLET_ADDRESS_A)]);
    expect(connection.signTransactions.mock.calls[0][0]).toBe("session-live");
  });

  it("resumeSession re-feeds the adopted session's peer records into the domain stores", async () => {
    const connection = connectionApi({
      store: {
        getSessions: async () => [
          accountsSession({
            id: "session-live",
            peer: {
              domains: {
                accounts: [{ address: WALLET_ADDRESS_A, name: "Main" }],
                identities: [WALLET_IDENTITY],
                passkeys: [WALLET_PASSKEY],
                credentials: [WALLET_CREDENTIAL],
              },
            },
          }),
        ],
        getSession: async () => undefined,
      },
    });
    const { adapter, provider } = makeAdapter(connection);
    await adapter.connect(); // Persist wallet state (default session has accounts only).
    expect(provider.identities).toEqual([]);
    expect(provider.credentials).toEqual([]);

    // The identities/passkeys mirrors are attached once the meta packages'
    // dynamic bridge imports resolve; `store.ready` settles exactly when
    // they have, so the re-feed can discover the domains.
    await provider.identity.store.ready;
    await provider.passkey.store.ready;
    expect(provider.identity.remote).toBeDefined();
    expect(provider.passkey.remote).toBeDefined();

    await adapter.resumeSession();

    // The persisted peer records were replayed through the discovered
    // domain mirrors: identities tagged with the session discriminant…
    expect(provider.identities).toEqual([walletRemoteIdentity("session-live")]);
    // …the passkey metadata riding the store's mirror source (the
    // refresh is reactive, hence the waitFor)…
    await vi.waitFor(() => expect(provider.passkeys).toEqual([WALLET_PASSKEY]));
    // …and the credential metadata with `raw` empty (payloads never
    // travel the pipe) and the session-scope tags attached.
    expect(provider.credentials).toEqual([
      {
        ...WALLET_CREDENTIAL,
        raw: "",
        receivedAt: expect.any(Number),
        metadata: { source: "connection", sessionId: "session-live" },
      },
    ]);
  });

  it("a failed background resume keeps the adopted session", async () => {
    const connection = connectionApi({
      store: {
        getSessions: async () => [
          accountsSession({ id: "session-persisted", status: "disconnected" }),
        ],
        getSession: async () => undefined,
      },
      resume: vi.fn(async () => {
        throw new Error("signaling lost");
      }),
    } as Partial<ConnectionApi>);
    const { adapter, store } = makeAdapter(connection);
    await adapter.connect();

    await adapter.resumeSession();
    await vi.waitFor(() => expect(connection.resume).toHaveBeenCalledOnce());

    // The rejection is logged, not surfaced; the adopted session stays.
    expect(store.removeWallet).not.toHaveBeenCalled();
    await adapter.signTransactions([makePayTxn(WALLET_ADDRESS_A)]);
    expect(connection.signTransactions.mock.calls[0][0]).toBe("session-persisted");
  });

  it("manual disconnect suspends auto-resume for the session", async () => {
    const connection = connectionApi();
    const { adapter } = makeAdapter(connection);
    await adapter.connect();

    await adapter.disconnect();

    // The intentional drop is exempted from auto-resume BEFORE the
    // session status flips (see ../connections/autoResume.ts).
    expect(mocks.suspendAutoResume).toHaveBeenCalledExactlyOnceWith("session-1");
  });

  it("signs decoded groups, routing only the wallet's own unsigned indexes", async () => {
    const signedBytes = new Uint8Array([9, 9]);
    const connection = connectionApi({
      signTransactions: vi.fn(async (_id: string, txns: string[], indexesToSign?: number[]) =>
        txns.map((_, i) => (indexesToSign?.includes(i) ? byteArrayToBase64(signedBytes) : null)),
      ),
    } as Partial<ConnectionApi>);
    const { adapter } = makeAdapter(connection);
    await adapter.connect();

    const own = makePayTxn(WALLET_ADDRESS_A); // WALLET_ADDRESS_A is a wallet account.
    const foreign = makePayTxn(algosdk.encodeAddress(new Uint8Array(32).fill(3)));

    const result = await adapter.signTransactions([own, foreign]);

    const [, txns, indexesToSign] = connection.signTransactions.mock.calls[0];
    expect(txns).toEqual([byteArrayToBase64(own.toByte()), byteArrayToBase64(foreign.toByte())]);
    expect(indexesToSign).toEqual([0]);
    expect(result).toEqual([signedBytes, null]);
  });

  it("skips already-signed txns in encoded groups", async () => {
    const connection = connectionApi();
    const { adapter } = makeAdapter(connection);
    await adapter.connect();

    const unsigned = makePayTxn(WALLET_ADDRESS_A);
    const presigned = algosdk.encodeMsgpack(
      new algosdk.SignedTransaction({
        txn: makePayTxn(WALLET_ADDRESS_B),
        sig: new Uint8Array(64).fill(1),
      }),
    );

    await adapter.signTransactions([unsigned.toByte(), presigned]);

    const [, , indexesToSign] = connection.signTransactions.mock.calls[0];
    expect(indexesToSign).toEqual([0]);
  });

  it("surfaces a wallet sign denial as a rejection", async () => {
    const connection = connectionApi({
      signTransactions: vi.fn(async () => {
        throw new ConnectionRpcError("rejected", "signing rejected");
      }),
    } as Partial<ConnectionApi>);
    const { adapter } = makeAdapter(connection);
    await adapter.connect();

    await expect(adapter.signTransactions([makePayTxn(WALLET_ADDRESS_A)])).rejects.toMatchObject({
      code: "rejected",
    });
  });

  it("rejects signing without an active session", async () => {
    const { adapter } = makeAdapter(connectionApi());

    await expect(adapter.signTransactions([makePayTxn(WALLET_ADDRESS_A)])).rejects.toThrowError(
      "No active connection session",
    );
  });
});

describe("dappWallet", () => {
  it("builds the adapter config with no arguments, like the other wallet factories", () => {
    const config = dappWallet();

    expect(config.id).toBe(WALLET_ID);
    expect(config.metadata.name).toBe("Wallet Provider");
    expect(config.metadata.icon).toBe(ProviderAdapter.defaultMetadata.icon);
    expect(config.Adapter).toBe(ProviderAdapter);
    // No options assembled when none are given.
    expect(config.options).toBeUndefined();
  });

  it("passes the provider-level options through and merges the metadata override", () => {
    const config = dappWallet({ protocolId: "walletconnect", metadata: { name: "My Dapp" } });

    // The metadata override merges over the defaults…
    expect(config.metadata).toEqual({
      name: "My Dapp",
      icon: ProviderAdapter.defaultMetadata.icon,
    });
    // …and only the adapter options travel to the constructor.
    expect(config.options).toEqual({ protocolId: "walletconnect" });
  });

  it("routes connects through the protocol passed at construction", async () => {
    const connection = connectionApi();
    const { adapter } = makeAdapter(connection, { protocolId: "walletconnect" });

    await adapter.connect();

    expect(connection.connect.mock.calls[0][0]).toBe("walletconnect");
  });
});
