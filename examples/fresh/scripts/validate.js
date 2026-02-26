import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../../');
const freshRoot = path.resolve(__dirname, '../');

async function run() {
  console.log('--- Starting Fresh Example Validation ---');

  process.chdir(freshRoot);

  // 1. Backup package.json
  console.log('Backing up package.json...');
  fs.copyFileSync('package.json', 'package.orig');

  try {
    console.log('Applying the CLI (bootstrap)...');
    
    // Create a temporary script to run bootstrapProvider directly since the CLI is interactive
    const tempScript = 'temp-bootstrap.js';
    fs.writeFileSync(tempScript, `
import { bootstrapProvider, fetchRegistry } from '../../config/dist/index.js';

async function main() {
  const registry = await fetchRegistry(undefined, '../../');
  await bootstrapProvider({
    rootPath: process.cwd(),
    providerName: 'FreshProvider',
    selectedExtensions: [
      '@algorandfoundation/keystore',
      '@algorandfoundation/accounts-store',
      '@algorandfoundation/accounts-keystore-extension'
    ],
    framework: 'react',
    registry
  });
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
`);

    execSync('node ' + tempScript, { stdio: 'inherit' });
    fs.unlinkSync(tempScript);

    // 2. Validate Build
    console.log('Validating build...');
    
    // Check if artifacts exist
    if (fs.existsSync('src/provider/FreshProvider/index.ts')) {
      console.log('Artifacts generated successfully.');
    } else {
      throw new Error('Artifacts not found!');
    }

    console.log('Running tsc check...');
    execSync('npx tsc --noEmit', { stdio: 'inherit' });
    console.log('Build validated successfully!');

  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  } finally {
    // 3. Restore package.json
    console.log('Restoring original package.json...');
    if (fs.existsSync('package.orig')) {
      fs.copyFileSync('package.orig', 'package.json');
      console.log('package.json restored.');
    }
  }
}

run();
