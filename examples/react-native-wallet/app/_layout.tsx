import { Stack } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AlgorandProvider, ReactNativeProvider } from "@/providers/ReactNativeProvider";
import { install, subtle } from "react-native-quick-crypto";
import { keyStore } from "@/stores/keystore";
import { keyStoreHooks, accountHooks } from "@/stores/before-after";
import { accountsStore, WALLET_KEY } from "@/stores/accounts";
import { identitiesStore } from "@/stores/identities";
import { credentialsStore, credentialsDriver } from "@/stores/credentials";
import { connectionsStore, connectionsDriver } from "@/stores/connections";
import { passkeysStore } from "@/stores/passkeys";
import {
  createLiquidAuthProtocol,
  exposeConnectionAccounts,
  setConnectionsProvider,
} from "@/lib/connections";
import { installConnectionResume } from "@/lib/connectionResume";
import { setupDigitalCredentials } from "@/lib/digital-credentials";
import * as LiquidAuth from "react-native-liquid-auth";
import PasskeyAutofill from "@algorandfoundation/react-native-passkey-autofill";
import { migrationsLedger } from "@/stores/migrations";
import type { ReactKeystoreOptions } from "@algorandfoundation/keystore";

install();

// The keystore engine hydrates its reactive `store` from the persisted metadata
// behind the scenes (via the storage driver) as part of `keystore.ready`, so the
// app no longer pre-loads keys here. Metadata is surfaced without unlocking any
// sealed material, and no biometric prompt fires on launch.
const biometricOptions: ReactKeystoreOptions["keystore"]["authentication"] = {
  biometrics: true,
  prompt: "Authenticate to access your wallet",
  // How long one successful unlock stays valid before the OS re-prompts.
  // Android bakes this into the master key at creation time (keychain's
  // default is 5s), so it only applies to master keys created after this
  // change — existing installs keep their original window. Multi-step flows
  // (e.g. seed creation → passkey-provider sync) fit inside one prompt.
  authenticationValidityDuration: 30,
};

/**
 * The single provider instance for the application.
 *
 * Constructed at module scope, not inside the component: a new instance per
 * render would re-register every extension and re-run migrations on each pass.
 */
const provider = new ReactNativeProvider(
  {
    // The account extensions scope their reads/writes to a wallet key that
    // defaults to this id — keep it in lockstep with the accounts store.
    id: WALLET_KEY,
    name: "Wallet Provider",
  },
  {
    migrations: { ledger: migrationsLedger },
    logs: {},
    accounts: {
      store: accountsStore,
      hooks: accountHooks,
      keystore: {
        autoPopulate: true,
      },
      // The accounts DOMAIN travels connections through the store's
      // session-scoped remote mirror — normalize the keystore bridge's
      // base64 addresses to canonical Algorand addresses on the way out.
      remote: { expose: exposeConnectionAccounts },
    },
    algorand: {
      network: "testnet-v1.0",
      algodConfig: {
        server: "https://testnet-api.algonode.cloud",
        port: 443,
        token: "",
      },
      indexerConfig: {
        server: "https://testnet-idx.algonode.cloud",
        port: 443,
        token: "",
      },
    },
    identities: {
      store: identitiesStore,
      keystore: {
        autoPopulate: true,
      },
    },
    credentials: {
      store: credentialsStore,
      // React Native has no universal storage primitive, so the engine's
      // key/value persistence seam is backed by MMKV here (two lines in
      // stores/credentials.ts). Without a driver nothing survives restarts.
      driver: credentialsDriver,
    },
    connections: {
      store: connectionsStore,
      // Liquid Auth as a protocol plug-in: the native SignalService
      // carries the signaling socket + WebRTC peer, and the keystore
      // signs. Connections start from a scanned/pasted `liquid://` URI
      // on the connections screen.
      protocols: [createLiquidAuthProtocol()],
      driver: connectionsDriver,
    },
    passkeys: {
      store: passkeysStore,
      // The same MMKV-backed passkey store the Android credential
      // provider serves to `navigator.credentials.get` — the wallet UI
      // and the provider share one source of truth (key material stays
      // native; only public metadata reaches JS).
      module: PasskeyAutofill,
    },
    keystore: {
      store: keyStore,
      hooks: keyStoreHooks,
      // React Native has no reliable global `crypto.subtle`, so the
      // host Subtle must be supplied explicitly. `react-native-quick-crypto`'s
      // `subtle` backs the engine's AES-256-GCM at-rest sealing (without
      // it, sealing a new seed throws "Cannot read property 'importKey'
      // of undefined").
      subtle: subtle as unknown as SubtleCrypto,
      authentication: biometricOptions,
    },
  },
);

// The liquid-auth wallet seams (keystore signing, account exposure)
// late-bind to the provider they are registered on.
setConnectionsProvider(provider);

// Presence-driven seamless resume: once the engine hydrated its persisted
// sessions, bring the signaling socket up per known origin and silently
// re-offer whenever the server reports the dapp waiting in a session's
// request room (see lib/connectionResume.ts). Lives for the app's
// lifetime, so the uninstall function is deliberately unused here.
installConnectionResume({ provider, module: LiquidAuth });

// Digital Credentials (holder side): mirror stored SD-JWT VCs into the
// Android Credential Manager registry and answer the OpenID4VP
// presentation requests the platform routes back. No-ops where the
// registry is unavailable (iOS / missing native module).
setupDigitalCredentials(provider);

export default function RootLayout() {
  return (
    <AlgorandProvider provider={provider}>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "#F8F9FA" },
          headerTitleStyle: { fontWeight: "bold" },
          animation: "slide_from_right",
          animationDuration: 250,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Wallet Provider",
            headerLeft: () => (
              <MaterialCommunityIcons
                name="shield-lock"
                size={24}
                color="#5856D6"
                style={{ marginLeft: 16, marginRight: 12 }}
              />
            ),
          }}
        />
        <Stack.Screen name="keys/index" options={{ title: "Keystore" }} />
        <Stack.Screen name="keys/[id]" options={{ title: "Key Details" }} />
        <Stack.Screen name="accounts/index" options={{ title: "Accounts" }} />
        <Stack.Screen name="accounts/[address]" options={{ title: "Account Details" }} />
        <Stack.Screen name="identities/index" options={{ title: "Identities" }} />
        <Stack.Screen name="identities/[address]" options={{ title: "Identity Details" }} />
        <Stack.Screen name="credentials/index" options={{ title: "Credentials" }} />
        <Stack.Screen name="credentials/[id]" options={{ title: "Credential Details" }} />
        <Stack.Screen name="connections/index" options={{ title: "Connections" }} />
        <Stack.Screen name="passkeys/index" options={{ title: "Passkeys" }} />
      </Stack>
    </AlgorandProvider>
  );
}
