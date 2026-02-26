import { bootstrapProvider } from '../../packages/config/dist/index.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const registry = {
  stores: [
    {
      name: 'keystore',
      package: '@algorandfoundation/keystore',
      type: 'store',
      provider: {
        type: 'store',
        withImport: 'WithKeyStore',
        extensionInterface: 'KeyStoreExtension',
        optionsType: 'KeyStoreOptions',
        namespace: 'key',
        stateProperty: 'keys'
      }
    }
  ],
  extensions: [
    {
      name: 'accounts-keystore-extension',
      package: '@algorandfoundation/accounts-keystore-extension',
      type: 'extension',
      provider: {
        type: 'extension',
        withImport: 'WithAccountsKeystore',
        extensionInterface: 'AccountsKeystoreExtension',
        optionsType: 'AccountsKeystoreExtensionOptions',
        namespace: 'accountsKeystore'
      }
    }
  ]
};

async function test() {
  const rootPath = process.cwd();
  const providerName = 'TestProvider';
  
  try {
    await bootstrapProvider({
      rootPath,
      providerName,
      selectedExtensions: ['@algorandfoundation/keystore', '@algorandfoundation/accounts-keystore-extension'],
      framework: 'none',
      registry
    });
    
    const content = await fs.readFile(path.join(rootPath, 'src', 'provider', providerName, 'index.ts'), 'utf-8');
    console.log('--- Generated Provider Content ---');
    console.log(content);
    console.log('---------------------------------');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test();
