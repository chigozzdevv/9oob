# 9oob execution architecture

## Ownership

The example application lives in root `client/`. Its `/` route is the landing page, with animated integration examples and reduced-motion support. Its `/demo` route supplies wallet integration and a text form that calls `noob.run(intent)`. The landing examples are inert; wallet providers load on entering the demo. The SDK owns the reusable modal, clarification, approval, signing prompts, progress, and browser recovery. An integrator can use the same SDK in another React application.

Shared public contracts live in `packages/schema`. Server behavior lives in `server/src/features`. Infrastructure used by those features lives in `server/src/shared`. OpenAI and database credentials stay on the server.

## Flow

```text
Enter intent → noob.run(intent) → SDK modal
  → interpret and validate the request
  → clarify or report unsupported actions without a wallet
  → connect a compatible wallet only when needed
  → bind the account and build a live review
  → read balance, or review and approve a transaction
  → guide the source network switch before approval
  → recheck and prepare the exact wallet step
  → persist the browser journal before signing
  → register the returned reference and preparation version
  → verify the submitted source transaction
  → reconcile settlement and show the result
```

A disconnected or incompatible wallet leaves an actionable request in `awaiting_wallet`. It cannot be approved or prepared until a compatible wallet binding succeeds. MetaMask supports all four action kinds through an EVM address. Hedera transfers also retain native signing when a native account is selected; LayerZero bridge and SaucerSwap swap actions require an EVM address. New connection prompts open the EVM chooser, and the demo prefers its EVM wallet when both connections exist. Existing native reviews can still use their bound native signer through the optional `nativeAccountId`. The review binds the action's signing account, including when both wallet kinds are connected. Binding uses the execution capability and a conditional version update; it does not sign a message or transaction. Wallet ownership remains enforced by the actual matching signing account. Connecting does not call the model again. Compatible connected accounts proceed directly to live review. The modal guides network switching before approval or signing, and requires the reviewed account when recovering an unsigned execution. Unsupported requests and clarifications do not require a wallet.

The modal is a conversation with black user messages and ghost-white responses. A spinner appears in the response while interpreting. Clarifications use a reply composer below the conversation. A submitted reply appears immediately as a user message with a response spinner; failed requests restore the reply to the composer. Review details, wallet actions, and execution progress appear inside the response. Opening the wallet picker leaves the conversation mounted; returning from it or refreshing preserves the original request and submitted replies. The server persists each question and answer with the execution, passes the full context to the interpreter, and rejects replies against a stale version. An explicit edit starts a new request context. Pasted HTML is converted to plain text at the SDK and server boundaries.

The example's native Hedera adapter discovers installed extensions through the Hedera extension protocol. Selecting a detected extension sends its WalletConnect pairing URI directly to that extension. Native discovery does not rely on an injected Ethereum provider. AppKit still owns the approved session and its recovery.

Balance reads skip signing and network switching. Hedera balances accept a native account or resolve an EVM address through the Testnet Mirror Node; Base ETH and USDC balances use an EVM address. A new EVM address reads its balance through the verified testnet RPC. A token balance is zero only when Mirror Node cannot find the account and the token RPC confirms INVALID_ACCOUNT_ID; unrelated RPC failures remain errors. Transfers require the source account to be funded with testnet HBAR. The Base provider verifies chain ID 84532 and reads native ETH through `eth_getBalance`, retaining exact wei precision. Hedera EVM transfers resolve account ID recipients to EVM aliases or their numeric addresses, preserve eight-decimal HBAR precision while encoding the RPC value with eighteen decimals, and use the actual HTS token decimals for token calls. Preparation verifies the testnet RPC and simulates the exact transaction; token calls must return success. Settlement matches the sender, destination, calldata and value, and token transfers additionally require the exact Transfer receipt event. Token approvals and source transactions use separate prepared steps. A changed quote returns to review before another signature.

Swap intents default their recipient to `self` unless another recipient is explicitly requested. That marker remains unresolved while waiting for a wallet; review resolves it to the connected EVM address and persists the concrete destination before approval. Preparation and recovery use that bound destination. Explicit Hedera account ID recipients are resolved through Mirror Node only for swaps ending on Hedera. Transfers and bridges retain explicit recipient requirements.

The client reads the current network from the connected connector on connection and browser focus to reconcile missed network events. Its signer uses that connector's chain instead of the global default. Network switching goes through AppKit, preserving its namespace state and Wagmi's connection state, and skips a switch if the wallet already reports the required chain. The SDK releases the network loading state when the matching wallet and signer are ready, or after a fifteen-second timeout so the user can retry. It never approves or signs as part of switching networks.

## Feature pattern

`execution.model.ts` defines the private persisted execution document and lifecycle status rules. `execution.repo.ts` handles storage and conditional updates. `execution.service.ts` coordinates interpretation, planning, preparation, registration, and reconciliation. `execution.controller.ts` validates HTTP inputs and capabilities. `execution.routes.ts` registers the feature's routes. `index.ts` exposes its public boundary. The worker and transaction receipt verification stay inside the execution feature.

Intent owns the model prompt and structured interpretation. Plan owns reviewed planning. Action owns supported action validation and dispatch. These internal features expose their implemented services through their public indexes; they do not contain empty HTTP controllers for nonexistent endpoints.

Shared infrastructure owns database connections/adapters, environment validation, capabilities, HTTP responses, logs, exact amounts, Hedera reads, SaucerSwap, LayerZero and verified testnet EVM integration.

## Database selection

```dotenv
DB_MODE=postgres
DB_URI=postgresql://username:password@localhost:5432/9oob
```

Or:

```dotenv
DB_MODE=mongodb
DB_URI=mongodb://localhost:27017/9oob
```

The selected database must be available. No SQLite fallback is used. Both adapters implement create, read, conditional replacement, listing, rate limiting, initialization, and close operations.

An execution document contains its public execution, capability hash, prepared context, and submission history. MongoDB replaces it conditionally using its stored revision. Postgres updates a JSONB row with the same revision condition. Preparation and submission each commit the execution state and recovery data in one atomic update. A stale or concurrent transition returns a conflict instead of overwriting the winning state. Raw bearer capabilities are not persisted.

Switching storage does not migrate execution records. Pending work must remain connected to the database in which it was created.

## Recovery

The browser saves the execution capability and journals the preparation version and network before calling a wallet. After the wallet returns, it saves the transaction reference before registering it. A lost registration response retries the same reference. An ambiguous wallet outcome requires recovery from wallet history; it never silently opens another signature request.

Transient reads preserve the capability. Restored unsigned steps are freshly prepared. Submitted steps reconcile their existing references. The worker only scans submitted and settling executions and never signs or broadcasts a new source transaction.

## API

| Method | Route                                | Responsibility                                                      |
| ------ | ------------------------------------ | ------------------------------------------------------------------- |
| GET    | `/api/noob/liquidity`                | Read the configured bridge pools and their available test USDC      |
| POST   | `/api/noob/executions`               | Interpret, validate, persist, and review if an account is available |
| POST   | `/api/noob/executions/:id/wallet`    | Bind an account and build the live review                           |
| POST   | `/api/noob/executions/:id/clarify`   | Add an answer and its question version to the original context      |
| GET    | `/api/noob/executions/:id`           | Reconcile and return state                                          |
| PATCH  | `/api/noob/executions/:id`           | Revise an editable intent                                           |
| POST   | `/api/noob/executions/:id/approve`   | Accept the current review                                           |
| POST   | `/api/noob/executions/:id/prepare`   | Recheck and prepare the next step                                   |
| POST   | `/api/noob/executions/:id/submitted` | Register the reference against its preparation version              |
| POST   | `/api/noob/executions/:id/cancel`    | Cancel an eligible unsent execution                                 |
| GET    | `/health`                            | Server health and configuration presence                            |

Routes after creation require the execution capability. Mutations require an allowed origin. Creation, revision, and clarification share a persistent rate limit. Clarification accepts `{ answer, version }`; the server supplies the question from the stored execution. The client uses a same-origin proxy; server credentials are never forwarded to the browser.

## Current scope

The application targets Hedera testnet and Base Sepolia only. It implements native/token balances and transfers on both networks, SaucerSwap Hedera swaps, and our liquidity-backed LayerZero test-USDC bridge. Cross-chain swaps execute an ordered swap/bridge or bridge/swap route with a fresh review for the remaining stage. The exact token output in the swap receipt determines the bridge amount. Each completed stage, transaction hash, preparation context and conditional transition survives refresh and background recovery. A failed lookup never causes a submitted stage to be prepared again.

Our Hedera bridge token is the liquid SaucerSwap test USDC 0.0.5449; Base uses Circle's configured Sepolia USDC. Both have six decimals. The contract collects source tokens and pays the existing receiving token from prefunded liquidity. It does not issue a new token. Both bridge contracts are deployed, reciprocally configured and initially funded with 10 test USDC each. `contract/deployments/testnet.json` records deployment state; `contract/deployments/validation.testnet.json` records live execution receipts. Missing configuration produces an unavailable route, never a simulated settlement.

`contract/src/NoobBridge.sol` authenticates endpoint/peer messages, prevents duplicate payouts, and reserves unpaid claims. Local Foundry tests cover authentication, replay, exact transfers, liquidity shortages, reserved withdrawals, pause/ownership, rollback and fuzz conservation. Deployment and wiring scripts reject mainnet and are not run by tests.

## Source tree

```text
9oob/
├── .github/
│   └── workflows/
│       └── check.yml
├── .husky/
│   └── pre-commit
├── client/
│   ├── app/
│   │   ├── api/
│   │   │   └── noob/
│   │   │       └── [...path]/
│   │   │           └── route.ts
│   │   ├── demo/
│   │   │   └── page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── not-found.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── demo.tsx
│   │   ├── footer.tsx
│   │   ├── header.tsx
│   │   ├── intent-input.tsx
│   │   ├── landing.css
│   │   └── landing.tsx
│   ├── providers/
│   │   ├── wallet/
│   │   │   ├── appkit.ts
│   │   │   ├── config.ts
│   │   │   ├── evm-network.ts
│   │   │   ├── hedera-adapter.ts
│   │   │   ├── hedera-identity.ts
│   │   │   ├── native-signer.ts
│   │   │   └── wagmi.ts
│   │   ├── app-provider.tsx
│   │   └── wallet-provider.tsx
│   ├── public/
│   │   ├── favicon.png
│   │   ├── manifest.json
│   │   └── thumbnail.jpg
│   ├── services/
│   │   ├── execution-proxy.ts
│   │   └── metadata.ts
│   ├── test/
│   │   ├── evm-network.test.ts
│   │   ├── execution-proxy.test.ts
│   │   ├── hedera-adapter.test.ts
│   │   ├── hedera-identity.test.ts
│   │   └── wallet-kit.test.ts
│   ├── .env.example
│   ├── .gitignore
│   ├── .npmrc
│   ├── next.config.ts
│   ├── package.json
│   ├── postcss.config.js
│   ├── tsconfig.json
│   └── vercel.json
├── contract/
│   ├── deployments/
│   │   ├── balances.testnet.json
│   │   ├── liquidity.testnet.json
│   │   ├── operations.testnet.json
│   │   ├── testnet.json
│   │   ├── validation.testnet.json
│   │   ├── validation.testnet.md
│   │   └── wallets.testnet.json
│   ├── script/
│   │   ├── Bridge.s.sol
│   │   └── TestnetConfig.sol
│   ├── src/
│   │   └── NoobBridge.sol
│   ├── test/
│   │   ├── NoobBridge.t.sol
│   │   └── TestnetConfig.t.sol
│   ├── .env.example
│   ├── foundry.toml
│   └── package.json
├── packages/
│   ├── schema/
│   │   ├── src/
│   │   │   ├── action.ts
│   │   │   ├── auth.ts
│   │   │   ├── errors.ts
│   │   │   ├── execution.ts
│   │   │   ├── index.ts
│   │   │   ├── intent.ts
│   │   │   ├── liquidity.ts
│   │   │   ├── network.ts
│   │   │   ├── plan.ts
│   │   │   ├── quote.ts
│   │   │   ├── text.ts
│   │   │   └── wallet.ts
│   │   ├── test/
│   │   │   └── intent.test.ts
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── tsconfig.json
│   └── sdk/
│       ├── src/
│       │   ├── execution/
│       │   │   ├── approval.ts
│       │   │   ├── session.ts
│       │   │   └── transaction.ts
│       │   ├── modal/
│       │   │   ├── clarification.tsx
│       │   │   ├── conversation.tsx
│       │   │   ├── intent-field.tsx
│       │   │   ├── journey.tsx
│       │   │   ├── loading.tsx
│       │   │   ├── modal.css
│       │   │   ├── modal.tsx
│       │   │   ├── presentation.ts
│       │   │   ├── review.tsx
│       │   │   └── wordmark.tsx
│       │   ├── transport/
│       │   │   ├── events.ts
│       │   │   └── http.ts
│       │   ├── wallet/
│       │   │   ├── evm.ts
│       │   │   ├── guide.ts
│       │   │   ├── hedera.ts
│       │   │   └── wallet.ts
│       │   ├── index.ts
│       │   ├── run.ts
│       │   └── runtime.ts
│       ├── test/
│       │   ├── clarification.test.ts
│       │   ├── presentation.test.ts
│       │   ├── run.test.ts
│       │   ├── session.test.ts
│       │   ├── transport.test.ts
│       │   ├── wallet-flow.test.ts
│       │   └── wallet.fixture.ts
│       ├── package.json
│       ├── tsconfig.build.json
│       └── tsconfig.json
├── scripts/
│   ├── build.sh
│   ├── dev.mjs
│   ├── dev.sh
│   ├── lint.sh
│   ├── setup.sh
│   ├── test.mjs
│   ├── test.sh
│   ├── typecheck.sh
│   └── workspaces.mjs
├── server/
│   ├── scripts/
│   │   ├── live-suite.mts
│   │   ├── live-testnet.mts
│   │   ├── testnet-chain.mts
│   │   └── testnet-deploy.mts
│   ├── src/
│   │   ├── features/
│   │   │   ├── action/
│   │   │   │   ├── action.registry.ts
│   │   │   │   ├── balance.service.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── transfer.service.ts
│   │   │   ├── execution/
│   │   │   │   ├── execution.controller.ts
│   │   │   │   ├── execution.model.ts
│   │   │   │   ├── execution.receipt.ts
│   │   │   │   ├── execution.repo.ts
│   │   │   │   ├── execution.routes.ts
│   │   │   │   ├── execution.service.ts
│   │   │   │   ├── execution.worker.ts
│   │   │   │   └── index.ts
│   │   │   ├── intent/
│   │   │   │   ├── index.ts
│   │   │   │   ├── intent.prompt.ts
│   │   │   │   └── intent.service.ts
│   │   │   ├── liquidity/
│   │   │   │   ├── index.ts
│   │   │   │   ├── liquidity.controller.ts
│   │   │   │   ├── liquidity.model.ts
│   │   │   │   ├── liquidity.routes.ts
│   │   │   │   └── liquidity.service.ts
│   │   │   └── plan/
│   │   │       ├── index.ts
│   │   │       └── plan.service.ts
│   │   ├── shared/
│   │   │   ├── auth/
│   │   │   │   ├── auth.middleware.ts
│   │   │   │   └── auth.service.ts
│   │   │   ├── config/
│   │   │   │   └── env.ts
│   │   │   ├── database/
│   │   │   │   ├── database.client.ts
│   │   │   │   ├── database.types.ts
│   │   │   │   ├── mongodb.client.ts
│   │   │   │   └── postgres.client.ts
│   │   │   ├── http/
│   │   │   │   └── http.response.ts
│   │   │   ├── integration/
│   │   │   │   ├── base/
│   │   │   │   │   └── base.client.ts
│   │   │   │   ├── evm/
│   │   │   │   │   ├── evm.client.ts
│   │   │   │   │   └── token.ts
│   │   │   │   ├── hedera/
│   │   │   │   │   └── hedera.client.ts
│   │   │   │   ├── layerzero/
│   │   │   │   │   ├── layerzero.config.ts
│   │   │   │   │   └── layerzero.provider.ts
│   │   │   │   ├── saucerswap/
│   │   │   │   │   └── saucerswap.provider.ts
│   │   │   │   ├── amounts.ts
│   │   │   │   ├── provider.types.ts
│   │   │   │   └── testnet.provider.ts
│   │   │   └── logging/
│   │   │       └── logger.ts
│   │   ├── app.ts
│   │   ├── index.ts
│   │   ├── server.ts
│   │   └── worker.ts
│   ├── test/
│   │   ├── database/
│   │   │   └── database.test.ts
│   │   ├── execution/
│   │   │   ├── clarification.test.ts
│   │   │   ├── execution-service.test.ts
│   │   │   ├── execution-store.test.ts
│   │   │   ├── http.test.ts
│   │   │   └── wallet.test.ts
│   │   ├── integration/
│   │   │   ├── amounts.test.ts
│   │   │   ├── base.test.ts
│   │   │   ├── hedera-evm.test.ts
│   │   │   ├── hedera.test.ts
│   │   │   ├── liquidity.test.ts
│   │   │   ├── native-fee.test.ts
│   │   │   ├── providers.live.test.ts
│   │   │   └── testnet.test.ts
│   │   └── support/
│   │       └── database.ts
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.build.json
│   └── tsconfig.json
├── .gitignore
├── .lintstagedrc.js
├── .prettierignore
├── .yarnrc.yml
├── AGENTS.md
├── LICENSE
├── README.md
├── compose.yaml
├── eslint.config.js
├── noob.md
├── package.json
├── prettier.config.js
├── template.json
├── tsconfig.base.json
└── yarn.lock
```
