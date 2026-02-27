#!/usr/bin/env node
import { Command } from 'commander';
import { fetchRegistry, bootstrapProvider, discoverLocalProject, saveRegistry } from '@algorandfoundation/wallet-provider-config';
import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';


function printBanner() {
    const lines =figlet.textSync('Provi', {font: "Coder Mini", horizontalLayout: 'controlled smushing', verticalLayout: 'controlled smushing' }).split('\n')
    const derLines = figlet.textSync('DER', { font: "Coder Mini", horizontalLayout: 'controlled smushing', verticalLayout: 'controlled smushing' }).split('\n')
    const BANNER = lines.map((line, idx) => `${chalk.cyan(line)}${chalk.green(derLines[idx])}`).join('\n');

    console.log(
        BANNER
    );

    console.log(
        chalk.blue(
            "by Algorand Foundation"
        )
    );
    console.log();
}



const program = new Command();

program
  .name('wallet-foundation')
  .description('CLI to manage Wallet Provider extensions')
  .version('0.0.1');

program
  .command('bootstrap')
  .description('Bootstrap a new provider with extensions')
  .option('-c, --config <url>', 'Third-party configuration repository URL')
  .action(async (options) => {
    const rootPath = process.cwd();
    const registry = await fetchRegistry(options.config);

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'providerName',
        message: 'Enter the provider name (e.g., MyWalletProvider):',
        default: 'MyWalletProvider'
      },
      {
        type: 'checkbox',
        name: 'selectedStores',
        message: 'Select stores to include:',
        choices: registry.stores.map(s => ({ name: s.name, value: s.package }))
      }
    ]);

    const filteredExtensions = registry.extensions.filter(ext => {
      // If an extension doesn't specify what it extends, show it anyway?
      // Or should we only show extensions that match selected stores?
      // The requirement says "extensions should only be shown that relate to the stores that they relate to".
      if (!ext.provider.extendsStore || ext.provider.extendsStore.length === 0) return true;
      return ext.provider.extendsStore.some(storePkg => answers.selectedStores.includes(storePkg));
    });

    const extensionAnswers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedExtensions',
        message: 'Select extensions to include:',
        choices: filteredExtensions.map(e => ({ name: e.name, value: e.package })),
        when: filteredExtensions.length > 0
      },
      {
        type: 'list',
        name: 'framework',
        message: 'Select a framework adapter:',
        choices: ['none', 'react']
      }
    ]);

    const result = await bootstrapProvider({
      rootPath,
      providerName: answers.providerName,
      selectedExtensions: [...answers.selectedStores, ...(extensionAnswers.selectedExtensions || [])],
      framework: extensionAnswers.framework,
      registry
    });

    console.log(`Provider generated at: ${result.providerPath}`);
    console.log(`Tooling detected: ${result.tooling}`);
  });

const registryCommand = program.command('registry')
  .description('Displays the registry. Contains commands to manage the provider registry')
  .action(async () => {
    const registry = await fetchRegistry();
    console.log(JSON.stringify(registry, null, 2));
  });

registryCommand.command('generate')
  .description('Generate a registry file based on the current workspace')
  .action(async () => {
    const rootPath = process.cwd();
    const registry = await discoverLocalProject(rootPath);
    const registryPath = await saveRegistry(rootPath, registry);
    console.log(`Registry generated at: ${registryPath}`);
  });

const isRegistry = process.argv.includes('registry');

if (!isRegistry) {
  printBanner();
}

program.parse();
