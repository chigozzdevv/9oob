# Agent instructions

9oob is a Next.js app and SDK for reviewed intent execution on Hedera and Base. Use Yarn 3.2.3 and Node.js 22.12 or newer.

## Commands

```sh
yarn install
yarn check
yarn next:dev
yarn next:build
```

## Workspaces

- `packages/schema` defines the validated intent and execution contracts.
- `server` interprets requests with OpenAI, reads Hedera Mirror Node state, prepares SaucerSwap and LayerZero testnet transactions, persists lifecycle state, and verifies settlement.
- `packages/sdk` provides `noob.run()` and its review, signing, and progress UI.
- `client` is the demo app, wallet setup, environment example, and same-origin proxy to the execution server.

Keep server behavior in `server/src/features` and reusable infrastructure in `server/src/shared`. An API feature owns its model, repository, service, controller, routes, and public index. Internal features expose the services they implement without empty controller or route files.

Integrators select one database using `DB_MODE=mongodb` or `DB_MODE=postgres` and its full connection string in `DB_URI`. Both adapters must preserve atomic lifecycle updates, preparation context, submission history, and rate limiting.

## Execution boundaries

- Keep OpenAI and remote database credentials on the server.
- Interpret requests before asking for a wallet; request an account only when the validated action needs it.
- Never sign or broadcast transactions in tests.
- Build wallet transactions only from validated actions and provider-prepared data.
- Recheck provider data before signing and verify the submitted transaction before marking it complete.
- Keep pending executions recoverable; do not rebroadcast an already submitted source transaction.
- The configured routes target Hedera testnet and Base Sepolia only.
- `contract` contains the liquidity-backed test-USDC bridge, Foundry tests and deployment scripts.
- Bridge deployments and liquidity must be real and configured; never fabricate addresses, receipts or settlement.

Use the `~~` alias for imports inside `client`. Prefer code without comments; add only short, single-line comments when they explain non-obvious behavior.
