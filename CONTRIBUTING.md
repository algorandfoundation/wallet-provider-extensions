# Contributing

Thank you for your interest in contributing to the Wallet Provider Extensions! We welcome contributions from the community to help enhance the Algorand wallet ecosystem.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [npm](https://www.npmjs.com/)

### Installation

>[!NOTE]
> The wallet-provider package is not yet published to npm. You must follow the linking steps

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/algorandfoundation/wallet-provider-extensions.git
   cd wallet-provider-extensions
   ```

2. Install dependencies (after linking the wallet-provider package):
   ```bash
   npm install
   ```

## Linking the Wallet Provider

If you are developing extensions that require changes to the core [@algorandfoundation/wallet-provider](https://github.com/algorandfoundation/wallet-provider), or if you want to test against a local version of it, you can use `npm link`.

### 1. Clone the Wallet Provider
In a separate directory, clone the `wallet-provider` repository:
```bash
git clone https://github.com/algorandfoundation/wallet-provider.git
cd wallet-provider
```

### 2. Prepare the Link
Inside the `wallet-provider` directory, install dependencies, build the project, and create a global link:
```bash
npm install
npm run build
npm link
```

### 3. Link to the Extensions Project
Go back to the `wallet-provider-extensions` directory and link the package:
```bash
cd path/to/wallet-provider-extensions
npm link @algorandfoundation/wallet-provider
```

Now, `wallet-provider-extensions` will use your local version of `wallet-provider`.

## Project Structure

This repository is a monorepo using npm workspaces:
- `keystore/`: Securely manage cryptographic secrets.
- `crypto/`: Cryptographic extensions (BIP-39, XHD).

## Development Workflow

### Scripts

- `npm run build`: Build all workspaces.
- `npm run lint`: Lint the codebase using Biome.
- `npm run lint:fix`: Automatically fix linting issues.
- `npm test`: Run tests using Vitest.
- `npm run test:cov`: Run tests with coverage reporting.

### Code Style

We use [Biome](https://biomejs.dev/) for formatting and linting. Please ensure your code follows the project's style by running:
```bash
npm run lint
```

### Adding a New Extension

To add a new extension:
1. Create a new directory under `crypto/` or in the root if it's a different type.
2. Initialize a `package.json` and `tsconfig.json`.
3. Follow the implementation pattern described in the [README.md](./README.md#creating-a-new-extension).
4. Add the new path to the `workspaces` array in the root `package.json` if necessary.

## Submitting Pull Requests

1. Create a new branch for your feature or bugfix.
2. Ensure all tests pass and there are no linting errors.
3. Write clear, concise commit messages.
4. Submit a Pull Request to the `main` branch.
