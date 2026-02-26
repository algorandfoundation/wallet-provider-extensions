#!/usr/bin/env node
import { Command } from 'commander';
import { fetchRegistry, bootstrapProvider } from '@algorandfoundation/wallet-provider-config';
import inquirer from 'inquirer';
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
            name: 'selectedExtensions',
            message: 'Select extensions to include:',
            choices: registry.extensions.map(e => ({ name: e.name, value: e.package }))
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
        selectedExtensions: answers.selectedExtensions,
        framework: answers.framework,
        registry
    });
    console.log(`Provider generated at: ${result.providerPath}`);
    console.log(`Tooling detected: ${result.tooling}`);
});
program.parse();
