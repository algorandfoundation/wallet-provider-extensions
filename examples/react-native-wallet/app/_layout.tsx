import { Stack } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AlgorandProvider, ReactNativeProvider } from "@/providers/ReactNativeProvider";
import { install } from "react-native-quick-crypto";
import { keyStore } from "@/stores/keystore";
import { keyStoreHooks, accountHooks } from "@/stores/before-after";
import { fetchSecret, storage } from "@algorandfoundation/react-native-keystore";
import {
  initializeKeyStore,
  Key,
  KeyData,
  KeyStoreState,
  setStatus,
} from "@algorandfoundation/keystore";
import { Store } from "@tanstack/store";
import { accountsStore } from "@/stores/accounts";
import { identitiesStore } from "@/stores/identities";
import type { ReactKeystoreOptions } from "@algorandfoundation/react-native-keystore";

install();

const biometricOptions: ReactKeystoreOptions["keystore"]["authentication"] = {
  biometrics: true,
  prompt: "Authenticate to access your wallet",
};
async function bootstrap() {
  setStatus({ store: keyStore as unknown as Store<KeyStoreState>, status: "loading" });
  const secrets = await Promise.all(
    storage
      .getAllKeys()
      .map(async (keyId) => fetchSecret<KeyData>({ keyId, options: biometricOptions })),
  );
  initializeKeyStore({
    store: keyStore as unknown as Store<KeyStoreState>,
    keys: secrets
      .filter((k) => k !== null)
      .map(({ privateKey, ...rest }: KeyData) => rest) as Key[],
  });
}
bootstrap();
export default function RootLayout() {
  return (
    <AlgorandProvider
      provider={
        new ReactNativeProvider(
          {
            id: "wallet-provider",
            name: "Wallet Provider",
          },
          {
            logs: {},
            accounts: {
              store: accountsStore,
              hooks: accountHooks,
              keystore: {
                autoPopulate: true,
              },
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
            keystore: {
              store: keyStore,
              hooks: keyStoreHooks,
              authentication: biometricOptions,
            },
          },
        )
      }
    >
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
