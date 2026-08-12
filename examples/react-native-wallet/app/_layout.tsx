import { Stack } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AlgorandProvider, ReactNativeProvider } from "@/providers/ReactNativeProvider";
import { install, subtle } from "react-native-quick-crypto";
import { keyStore } from "@/stores/keystore";
import { keyStoreHooks, accountHooks } from "@/stores/before-after";
import { accountsStore } from "@/stores/accounts";
import { identitiesStore } from "@/stores/identities";
import { migrationsLedger } from "@/stores/migrations";
import type { ReactKeystoreOptions } from "@algorandfoundation/react-native-keystore";

install();

// The keystore engine hydrates its reactive `store` from the persisted metadata
// behind the scenes (via the storage driver) as part of `keystore.ready`, so the
// app no longer pre-loads keys here. Metadata is surfaced without unlocking any
// sealed material, and no biometric prompt fires on launch.
const biometricOptions: ReactKeystoreOptions["keystore"]["authentication"] = {
  biometrics: true,
  prompt: "Authenticate to access your wallet",
};

/**
 * The single provider instance for the application.
 *
 * Constructed at module scope, not inside the component: a new instance per
 * render would re-register every extension and re-run migrations on each pass.
 */
const provider = new ReactNativeProvider(
  {
    id: "wallet-provider",
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
    },
    identities: {
      store: identitiesStore,
      keystore: {
        autoPopulate: true,
      },
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
      </Stack>
    </AlgorandProvider>
  );
}
