
import type { Extension, ExtensionOptions, Provider, ProviderOptions } from '@algorandfoundation/wallet-provider'
import type { KeyStoreBackend } from './types.ts'
import { XHDKeyStoreBackend } from './xhd-backend.ts'

  export type keyStoreExtension = {
    keystore: KeyStoreBackend
  }

  const withKeystore: Extension = (provider: Provider<any>, options: ExtensionOptions): KeyStoreBackend => {



  return new XHDKeyStoreBackend()
}
