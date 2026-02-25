import { Stack } from "expo-router";
import {AlgorandProvider, ReactNativeProvider} from "@/providers/ReactNativeProvider";
import {install} from "react-native-quick-crypto";
import {keyStore} from "@/stores/keystore";
import {keyStoreHooks} from "@/stores/before-after";
import {fetchSecret, getMasterKey, storage} from "@algorandfoundation/react-native-keystore";
import {initializeKeyStore, Key, KeyData, KeyStoreState, setStatus} from "@algorandfoundation/keystore";
import { Store } from "@tanstack/store";
import {accountsStore} from "@/stores/accounts";
import {passkeysStore} from "@/stores/passkeys";
import {connectionsStore} from "@/stores/connections";

install();

async function bootstrap(){
  setStatus({store: keyStore as unknown as Store<KeyStoreState>, status: "loading"})
  const secrets = await Promise.all(storage.getAllKeys().map(async keyId => fetchSecret<KeyData>({keyId, masterKey: await getMasterKey()})))
  initializeKeyStore({store: keyStore as unknown as Store<KeyStoreState>, keys: secrets.filter((k)=>k!==null).map(({privateKey, ...rest}: KeyData)=>rest) as Key[]})
}
bootstrap()
export default function RootLayout() {
  return <AlgorandProvider provider={new ReactNativeProvider({
    id: 'react-native-wallet',
    name: 'React Native Wallet',
  }, {
    logs: true,
    accounts: {
      store: accountsStore,
      keystore: {
        autoPopulate: true,
      }
    },
    keystore: {
      store: keyStore,
      hooks: keyStoreHooks
    },
    passkeys: {
      store: passkeysStore,
    },
    connections: {
      store: connectionsStore,
    },
    walletconnect: {
      projectId: '72565985012580a1380967396a40c6a2', // Placeholder
      metadata: {
        name: 'React Native Wallet',
        description: 'Algorand Wallet',
        url: 'https://algorand.foundation',
        icons: ['https://algorand.foundation/favicon.png']
      }
    },
    liquidAuth: {
      endpoint: 'https://liquid-auth.algorand.foundation'
    }
  })}><Stack screenOptions={{animation: 'none', headerShown: false}} /></AlgorandProvider>;
}
