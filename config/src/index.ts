import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readPackage } from 'read-pkg';
import { execa } from 'execa';

export interface ProviderInfo {
  type: 'store' | 'extension';
  withImport: string;
  extensionInterface: string;
  optionsType: string;
  namespace: string;
  stateProperty?: string;
}

export interface ExtensionInfo {
  name: string;
  package: string;
  version: string;
  type: 'store' | 'extension';
  dependencies?: string[];
  extendsStore?: string[];
  provider: ProviderInfo;
}

export interface Registry {
  stores: ExtensionInfo[];
  extensions: ExtensionInfo[];
}

export const HARDCODED_REGISTRY: Registry = {
  stores: [
    {
      name: 'passkey-store',
      package: '@algorandfoundation/passkey-store',
      version: '1.0.0-canary.0',
      type: 'store',
      provider: {
        type: 'store',
        withImport: 'WithPasskeyStore',
        extensionInterface: 'PasskeyStoreExtension',
        optionsType: 'PasskeyStoreOptions',
        namespace: 'passkey',
        stateProperty: 'passkeys'
      }
    },
    {
      name: 'log-store',
      package: '@algorandfoundation/log-store',
      version: '1.0.0-canary.2',
      type: 'store',
      provider: {
        type: 'store',
        withImport: 'WithLogStore',
        extensionInterface: 'LogStoreExtension',
        optionsType: 'LogStoreExtensionOptions',
        namespace: 'log',
        stateProperty: 'logs'
      }
    },
    {
      name: 'accounts-store',
      package: '@algorandfoundation/accounts-store',
      version: '0.0.1',
      type: 'store',
      provider: {
        type: 'store',
        withImport: 'WithAccountStore',
        extensionInterface: 'AccountStoreExtension',
        optionsType: 'AccountStoreOptions',
        namespace: 'account',
        stateProperty: 'accounts'
      }
    },
    {
      name: 'keystore',
      package: '@algorandfoundation/keystore',
      version: '1.0.0-canary.7',
      type: 'store',
      provider: {
        type: 'store',
        withImport: 'WithKeyStore',
        extensionInterface: 'KeyStoreExtension',
        optionsType: 'KeyStoreOptions',
        namespace: 'key',
        stateProperty: 'keys'
      }
    },
    {
      name: 'connections-store',
      package: '@algorandfoundation/connections-store',
      version: '1.0.0-canary.0',
      type: 'store',
      provider: {
        type: 'store',
        withImport: 'WithConnectionStore',
        extensionInterface: 'ConnectionStoreExtension',
        optionsType: 'ConnectionStoreOptions',
        namespace: 'connection',
        stateProperty: 'connections'
      }
    }
  ],
  extensions: [
    {
      name: 'passkeys-keystore-extension',
      package: '@algorandfoundation/passkeys-keystore-extension',
      version: '0.0.1',
      type: 'extension',
      extendsStore: ['@algorandfoundation/passkey-store', '@algorandfoundation/keystore'],
      provider: {
        type: 'extension',
        withImport: 'WithPasskeysKeystore',
        extensionInterface: 'PasskeysKeystoreExtension',
        optionsType: 'PasskeysKeystoreExtensionOptions',
        namespace: 'passkey.keystore'
      }
    },
    {
      name: 'accounts-keystore-extension',
      package: '@algorandfoundation/accounts-keystore-extension',
      version: '0.0.1',
      type: 'extension',
      extendsStore: ['@algorandfoundation/accounts-store', '@algorandfoundation/keystore'],
      provider: {
        type: 'extension',
        withImport: 'WithAccountsKeystore',
        extensionInterface: 'AccountsKeystoreExtension',
        optionsType: 'AccountsKeystoreExtensionOptions',
        namespace: 'account.keystore'
      }
    },
    {
      name: 'react-native-keystore',
      package: '@algorandfoundation/react-native-keystore',
      version: '1.0.0-canary.1',
      type: 'extension',
      extendsStore: ['@algorandfoundation/keystore'],
      provider: {
        type: 'extension',
        withImport: 'WithKeyStore',
        extensionInterface: 'KeyStoreExtension',
        optionsType: 'KeyStoreOptions',
        namespace: 'key',
        stateProperty: 'keys'
      }
    },
    {
      name: 'walletconnect-connection-extension',
      package: '@algorandfoundation/walletconnect-connection-extension',
      version: '1.0.0-canary.0',
      type: 'extension',
      extendsStore: ['@algorandfoundation/connections-store'],
      provider: {
        type: 'extension',
        withImport: 'WithWalletConnect',
        extensionInterface: 'WalletConnectExtension',
        optionsType: 'WalletConnectOptions',
        namespace: 'walletconnect'
      }
    },
    {
      name: 'liquid-auth-connection-extension',
      package: '@algorandfoundation/liquid-auth-connection-extension',
      version: '1.0.0-canary.0',
      type: 'extension',
      extendsStore: ['@algorandfoundation/connections-store', '@algorandfoundation/accounts-store', '@algorandfoundation/passkey-store'],
      provider: {
        type: 'extension',
        withImport: 'WithLiquidAuth',
        extensionInterface: 'LiquidAuthExtension',
        optionsType: 'LiquidAuthOptions',
        namespace: 'liquidAuth'
      }
    }
  ]
};

export async function fetchRegistry(configRepoUrl?: string, rootPath: string = process.cwd()): Promise<Registry> {
  if (!configRepoUrl) {
    // Priority: hardcoded registry for now
    return HARDCODED_REGISTRY;
  }

  try {
      const response = await fetch(`${configRepoUrl.replace(/\/$/, '')}/registry.json`);
      if (!response.ok) throw new Error(`Failed to fetch registry from ${configRepoUrl}`);
      return await response.json() as Registry;
  } catch (error) {
      console.error('Error fetching remote registry, falling back to local discovery.');
      return await discoverLocalProject(rootPath);
  }
}

async function discoverLocalProject(rootPath: string): Promise<Registry> {
  const rootPkg = await readPackage({ cwd: rootPath });
  let workspaces = rootPkg.workspaces;

  if (!workspaces || !Array.isArray(workspaces)) {
    // Try to find root package.json if we are in a subdirectory
    try {
      const parentRootPath = path.resolve(rootPath, '..');
      const parentRootPkg = await readPackage({ cwd: parentRootPath });
      if (parentRootPkg.workspaces && Array.isArray(parentRootPkg.workspaces)) {
         workspaces = parentRootPkg.workspaces;
         rootPath = parentRootPath;
      }
    } catch (e) {}
  }

  if (!workspaces || !Array.isArray(workspaces)) {
    throw new Error('No workspaces found in package.json at ' + rootPath);
  }

  const stores: ExtensionInfo[] = [];
  const extensions: ExtensionInfo[] = [];

  for (const workspace of workspaces) {
    const workspacePath = path.join(rootPath, workspace);
    try {
        const pkg = await readPackage({ cwd: workspacePath }) as any;
        
        if (pkg.provider) {
            const info: ExtensionInfo = { 
                name: pkg.name!.split('/').pop()!, 
                package: pkg.name!,
                version: pkg.version,
                type: pkg.provider.type,
                provider: pkg.provider,
                extendsStore: pkg.provider.extendsStore,
                dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : []
            };

            if (info.type === 'store') {
                stores.push(info);
            } else {
                extensions.push(info);
            }
        }
    } catch (e) {
    }
  }

  return { stores, extensions };
}

export async function detectTooling(cwd: string) {
  if (await fs.access(path.join(cwd, 'yarn.lock')).then(() => true).catch(() => false)) {
    return 'yarn';
  }
  if (await fs.access(path.join(cwd, 'pnpm-lock.yaml')).then(() => true).catch(() => false)) {
    return 'pnpm';
  }
  return 'npm';
}

export async function bootstrapProvider(options: {
  rootPath: string;
  providerName: string;
  selectedExtensions: string[];
  framework: 'react' | 'none';
  registry: Registry;
}) {
  const { rootPath, providerName, selectedExtensions, framework, registry } = options;
  const providerDir = path.join(rootPath, 'src', 'provider', providerName);
  await fs.mkdir(providerDir, { recursive: true });

  const tooling = await detectTooling(rootPath);
  
  // Resolve all packages to install (including store dependencies if mentioned in registry)
  const packagesToInstall = new Set<string>();
  for (const extName of selectedExtensions) {
      const ext = [...registry.extensions, ...registry.stores].find(e => e.package === extName);
      if (ext) {
          packagesToInstall.add(ext.package);
          if (ext.dependencies) {
              ext.dependencies.forEach(d => packagesToInstall.add(d));
          }
      }
  }

  if (framework === 'react') {
      packagesToInstall.add('@tanstack/react-store');
  } else {
      packagesToInstall.add('@tanstack/store');
  }

  packagesToInstall.add('@algorandfoundation/wallet-provider');

  // Check local package.json
  const pkgPath = path.join(rootPath, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
  pkg.dependencies = pkg.dependencies || {};

  const missingDeps = Array.from(packagesToInstall).filter(dep => !pkg.dependencies[dep]);

  if (missingDeps.length > 0) {
      console.log(`Installing missing dependencies: ${missingDeps.join(', ')}`);
      
      // Check if we are in a workspace and use workspace:* for local packages
      const rootPkgPath = path.join(rootPath, 'package.json');
      const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf-8'));
      
      // If we are in a monorepo, we might want to use workspace:* protocols
      // But for simplicity and to follow the user's request "use local linking", 
      // let's check if the packages exist in the registry and if they are local.
      
      const monorepoRoot = await findMonorepoRoot(rootPath);
      let localPackageVersions: Record<string, string> = {};
      if (monorepoRoot) {
          const localRegistry = await discoverLocalProject(monorepoRoot);
          [...localRegistry.stores, ...localRegistry.extensions].forEach(e => {
              localPackageVersions[e.package] = e.version;
          });
      }

      const depsToInstall = missingDeps.map(dep => {
          if (localPackageVersions[dep]) {
              return `${dep}@${localPackageVersions[dep]}`;
          }
          return dep;
      });

      if (tooling === 'yarn') {
          await execa('yarn', ['add', ...depsToInstall], { cwd: rootPath });
      } else if (tooling === 'pnpm') {
          await execa('pnpm', ['add', ...depsToInstall], { cwd: rootPath });
      } else {
          // For npm, we first add them to package.json with their version if they are local, 
          // then run npm install for the rest or for all.
          
          for (const dep of missingDeps) {
              if (localPackageVersions[dep]) {
                  rootPkg.dependencies[dep] = localPackageVersions[dep];
              }
          }
          await fs.writeFile(rootPkgPath, JSON.stringify(rootPkg, null, 2));

          const nonLocalDeps = missingDeps.filter(d => !localPackageVersions[d]);
          if (nonLocalDeps.length > 0) {
              await execa('npm', ['install', ...nonLocalDeps, '--legacy-peer-deps'], { cwd: rootPath });
          } else {
              await execa('npm', ['install', '--legacy-peer-deps'], { cwd: rootPath });
          }
      }
  }

  // Generate provider file
  const providerFile = path.join(providerDir, 'index.ts');
  const selectedInfos = Array.from(packagesToInstall).map(pkgName => {
      return [...registry.extensions, ...registry.stores].find(e => e.package === pkgName);
  }).filter((e): e is ExtensionInfo => !!e);

  const content = generateProviderContent(providerName, selectedInfos, framework);
  await fs.writeFile(providerFile, content);

  return { providerPath: providerFile, tooling };
}

async function findMonorepoRoot(startPath: string): Promise<string | null> {
    let currentPath = startPath;
    while (currentPath !== path.parse(currentPath).root) {
        try {
            const pkg = await readPackage({ cwd: currentPath });
            if (pkg.workspaces) {
                return currentPath;
            }
        } catch (e) {}
        currentPath = path.dirname(currentPath);
    }
    return null;
}

function generateProviderContent(name: string, extensions: ExtensionInfo[], framework: string) {
    const imports = extensions.map(ext => {
        return `import { ${ext.provider.withImport} } from '${ext.package}';
import type { ${ext.provider.extensionInterface}, ${ext.provider.optionsType} } from '${ext.package}';`;
    }).join('\n');

    const extensionList = extensions.map(ext => ext.provider.withImport).join(', ');
    
    const interfaceMerge = extensions.map(ext => ext.provider.extensionInterface).join('\n  & ');
    const optionsMerge = extensions.map(ext => ext.provider.optionsType).join('\n  & ');

    return `
import { Provider } from '@algorandfoundation/wallet-provider';
${imports}

/**
 * Merged interface of all selected extensions.
 */
export type SelectedExtensions = 
  & ${interfaceMerge || 'object'};

/**
 * Merged options of all selected extensions.
 */
export type SelectedExtensionsOptions = 
  & ${optionsMerge || 'object'};

/**
 * ${name} is a customized wallet provider with the following extensions:
 * ${extensions.map(e => `- ${e.package}`).join('\n * ')}
 */
export class ${name} extends Provider<any> implements SelectedExtensions {
    static EXTENSIONS = [${extensionList}] as const;

    ${(() => {
        const namespaces = new Map<string, ExtensionInfo[]>();
        const stateProperties = new Map<string, ExtensionInfo[]>();
        
        extensions.forEach(ext => {
            const baseNamespace = ext.provider.namespace.split('.')[0];
            if (!namespaces.has(baseNamespace)) {
                namespaces.set(baseNamespace, []);
            }
            namespaces.get(baseNamespace)!.push(ext);
            
            if (ext.provider.stateProperty) {
                if (!stateProperties.has(ext.provider.stateProperty)) {
                    stateProperties.set(ext.provider.stateProperty, []);
                }
                stateProperties.get(ext.provider.stateProperty)!.push(ext);
            }
        });

        const declarations: string[] = [];
        
        namespaces.forEach((exts, name) => {
            const types = exts.map(e => `${e.provider.extensionInterface}['${name}']`).join(' & ');
            declarations.push(`declare ${name}: ${types};`);
        });
        
        stateProperties.forEach((exts, name) => {
            const types = exts.map(e => `${e.provider.extensionInterface}['${name}']`).join(' & ');
            declarations.push(`declare ${name}: ${types};`);
        });

        return declarations.join('\n    ');
    })()}
}
`;
}
