import { Provider, type BaseProvider } from "@algorandfoundation/wallet-provider";
import { WithConnections, liquidAuth } from "@algorandfoundation/connections";
import { WithAccounts, type Account } from "@algorandfoundation/accounts";
import { WithIdentities } from "@algorandfoundation/identities";
import { WithCredentials, memoryCredentialDriver } from "@algorandfoundation/credentials";
import { WithPasskeys } from "@algorandfoundation/passkeys";
import { WithKeyStore } from "@algorandfoundation/keystore";
import Hook from "before-after-hook";
import { store } from "../../stores/walletStore.ts";
import { identityStore } from "../../stores/identityStore.ts";
import { credentialsStore } from "../../stores/credentialsStore.ts";
import { passkeysStore } from "../../stores/passkeysStore.ts";
import { keyStore } from "../../stores/keyStore.ts";
import { connectionsStore } from "../../stores/connectionsStore.ts";
import { type DappIdentity } from "../identities/types.ts";
import { ICE_SERVERS, SIGNAL_URL } from "../connections/config.ts";

/**
 * The dapp-side Provider class, composed through the official static
 * factory: `Provider.withExtensions` INFERS the instance type from the
 * extension list (every extension's return type is intersected onto the
 * instance), so there is no concrete subclass full of `declare` fields
 * to keep in sync: the type says exactly what the constructor installs.
 * The generic seats are pinned with instantiation expressions:
 * `WithIdentities<DappIdentity>` types the identities as the demo's
 * narrowable union, `WithAccounts<Account>` the accounts.
 */
const EXTENSIONS = [
  WithConnections,
  WithAccounts<Account>,
  WithIdentities<DappIdentity>,
  WithCredentials,
  WithPasskeys,
  WithKeyStore,
] as const;

export const DappProvider = Provider.withExtensions(EXTENSIONS);

/**
 * The provider CONTEXT: the instance type {@link createProvider}
 * returns (the upstream `BaseProvider` over the extension list). There
 * is NO global instance: the `ProviderAdapter` (the example dapp
 * connector, see `./adapter.ts`) constructs one from its adapter
 * options and carries it, and every flow that drives the provider takes
 * this context as its first parameter (`ctx`).
 */
export type DappProvider = BaseProvider<typeof EXTENSIONS>;

/**
 * The provider-level construction knobs {@link createProvider} accepts,
 * surfaced through the connector's adapter options (`dappWallet()`), so
 * the dapp configures the provider where it registers the wallet.
 */
export interface DappProviderOptions {
  /**
   * The Liquid Auth signaling service the connection protocol parks
   * requests on. Defaults to `SIGNAL_URL` (see `../connections/config.ts`).
   */
  signalUrl?: string;
  /**
   * The ICE servers the WebRTC transports negotiate through. Defaults to
   * `ICE_SERVERS` (see `../connections/config.ts`).
   */
  iceServers?: RTCIceServer[];
}

/**
 * Builds the dapp-side Provider: the browser connections engine with the
 * Liquid Auth protocol registered, plus the accounts, identities,
 * credentials, passkeys, and local keystore stores, with ONE store per
 * domain, each the single source of truth for its data.
 * `ctx.connection.connect("liquid-auth")` creates the out-of-band
 * request (parked as a peerless pending session in the connections
 * store, where the ConnectModal picks it up as a `liquid://` QR) and
 * resolves once the wallet scans it and establishes the connection.
 *
 * The identity store deliberately holds BOTH kinds of identity (the
 * wallet-synced ones the adapter records from the connect handshake and
 * the ones minted from the local browser keystore) as one narrowable
 * {@link DappIdentity} union, the same way the accounts store holds any
 * account type.
 *
 * The dapp declares NO connection domains: the connections engine
 * INFERS them from the mounted store extensions (each mounts a
 * session-scoped `remote` mirror next to its store), announces them
 * during `connect`, and mirrors the wallet's records straight into the
 * domain stores: session lifetime = inventory lifetime, so the
 * mirrors ride the in-memory stores (the credential store gets an
 * explicit memory driver: persisting a mirror would create a second
 * source of truth next to the persisted session record the adapter
 * re-feeds from).
 */
export function createProvider(options: DappProviderOptions = {}): DappProvider {
  /** Hooks for intercepting local keystore operations. */
  const keystoreHooks = new Hook.Collection<any>();

  return new DappProvider(
    {
      id: "use-wallet-client",
      name: "use-wallet Client",
    },
    {
      connections: {
        store: connectionsStore,
        protocols: [
          liquidAuth({
            url: options.signalUrl ?? SIGNAL_URL,
            rtcConfiguration: { iceServers: options.iceServers ?? ICE_SERVERS },
          }),
        ],
        metadata: {
          name: "use-wallet Client",
          url: typeof window === "undefined" ? undefined : window.location.origin,
        },
        // NO domains declared: the engine discovers them from the store
        // extensions mounted below. The identity store's `remote` mirror
        // exposes the dapp's LOCAL identities with the connect handshake
        // (public projection only; signers stay here): their DID
        // documents advertise the X25519 `keyAgreement` keys the wallet
        // derives the session's secure-messaging channel from.
      },
      accounts: { store },
      identities: { store: identityStore },
      credentials: { store: credentialsStore, driver: memoryCredentialDriver() },
      passkeys: { store: passkeysStore },
      keystore: { store: keyStore, hooks: keystoreHooks },
    },
  );
}
