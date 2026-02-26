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
  type: 'store' | 'extension';
  dependencies?: string[];
  provider: ProviderInfo;
}

export interface Registry {
  stores: ExtensionInfo[];
  extensions: ExtensionInfo[];
}

export async function fetchRegistry(configRepoUrl?: string, rootPath: string = process.cwd()): Promise<Registry> {
  if (!configRepoUrl) {
      // Fallback to local discovery if no remote config is provided
      return await discoverLocalProject(rootPath);
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
  const workspaces = rootPkg.workspaces;

  if (!workspaces || !Array.isArray(workspaces)) {
    throw new Error('No workspaces found in root package.json');
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
                type: pkg.provider.type,
                provider: pkg.provider,
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
      if (tooling === 'yarn') {
          await execa('yarn', ['add', ...missingDeps], { cwd: rootPath });
      } else if (tooling === 'pnpm') {
          await execa('pnpm', ['add', ...missingDeps], { cwd: rootPath });
      } else {
          await execa('npm', ['install', ...missingDeps, '--legacy-peer-deps'], { cwd: rootPath });
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
export class ${name} extends Provider implements SelectedExtensions {
    static EXTENSIONS = [${extensionList}] as const;

    ${extensions.map(ext => {
        const stateProp = ext.provider.stateProperty ? `\n    declare ${ext.provider.stateProperty}: ${ext.provider.extensionInterface}['${ext.provider.stateProperty}'];` : '';
        return `declare ${ext.provider.namespace}: ${ext.provider.extensionInterface}['${ext.provider.namespace}'];${stateProp}`;
    }).join('\n    ')}
}
`;
}
