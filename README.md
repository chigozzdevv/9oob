# 9oob

9oob adds reviewed intent execution to a React application. Configure its wallet adapter once, mount `NoobProvider`, then call `noob.run(intent)`. The SDK opens the modal; the standalone server interprets requests, validates actions, prepares transactions, persists progress, and verifies settlement.

## Run locally

Use Node.js 22.12 or newer and Yarn 3.2.3.

```sh
yarn setup
```

In `server/.env`, set `OPENAI_API_KEY`. The local example uses MongoDB:

```dotenv
DB_MODE=mongodb
DB_URI=mongodb://127.0.0.1:27017/9oob
```

For local MongoDB, start Docker Desktop and run:

```sh
docker compose up -d --wait mongodb
```

The [MongoDB Docker image](https://hub.docker.com/_/mongo) stores data in the `9oob_mongodb-data` volume. The database port is available only on this computer. `docker compose stop mongodb` stops it without removing data; run the start command again to resume it. Avoid `docker compose down -v` unless you intend to delete the local database. Remote MongoDB and Postgres remain configurable through the server environment.

To use Postgres instead:

```dotenv
DB_MODE=postgres
DB_URI=postgresql://username:password@localhost:5432/9oob
```

`DB_MODE` accepts one value: `mongodb` or `postgres`. `DB_URI` contains the full connection string, including the database name and any provider-required authentication or TLS options. The selected database must be running and reachable. The server initializes its tables or collection indexes automatically. MongoDB supports standalone instances because each execution update is atomic within one document. Postgres uses an atomic update of one JSONB row.

Set the public `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` in `client/.env.local`. Setup preserves existing environment files. OpenAI and database credentials belong only in the server environment.

`server/.env.example` includes the deployed shared testnet bridge addresses recorded in `contract/deployments/testnet.json`. A new setup can use those pools without deploying contracts. Replace the addresses in `server/.env` if you deploy your own bridge.

```sh
yarn dev
```

This builds the shared packages, starts the execution server at `http://127.0.0.1:3001`, and starts the example client at `http://localhost:3000`. `yarn next:dev` remains an alias for this command.

The client proxies `/api/noob/*` to `NOOB_SERVER_URL`. If the client's address changes, set `NOOB_APP_ORIGIN` in the server environment to its exact origin.

Open `http://localhost:3000` for the landing page and `http://localhost:3000/demo` for the real testnet demo. The landing page shows the scaffold command and rotating `noob.run()` examples; those examples never execute transactions. Wallet providers load when entering the demo. The demo examples fill the composer; Send starts the existing guided chat. The page shows current available USDC in both bridge pools and links to test-token faucets. Each visitor can connect their own MetaMask wallet and use the same address on both networks, with test HBAR or ETH for gas. Fund that address with Hedera testnet HBAR to create its Hedera account before sending Hedera transactions. Use small amounts such as 0.1 HBAR for swaps or 0.1 USDC for bridges. Destination liquidity is rechecked before a bridge can be signed. No demo transaction is sent automatically.

Swaps send the output to the connected wallet by default, including swaps to the other network. The server resolves that wallet address before building the review and keeps it bound through preparation and recovery. An explicitly requested recipient is preserved; Hedera account ID recipients are resolved through Mirror Node for swaps ending on Hedera. Transfers and bridges still ask for a recipient when one is missing.

Hedera USDC comes from swapping test HBAR through this app's SaucerSwap route, which uses token `0.0.5449`. Circle's faucet supplies the configured Base Sepolia USDC. The deployed pools fund destination payouts; their balances are separate from visitors' wallet balances.

## Modal integration

```tsx
import { NoobProvider, noob, type NoobWallet } from "@9oob/sdk";
import "@9oob/sdk/styles.css";

function App({ wallet }: { wallet: NoobWallet }) {
  return (
    <NoobProvider wallet={wallet} endpoint="/api/noob">
      <button onClick={() => void noob.run("Check my HBAR balance")}>Run intent</button>
    </NoobProvider>
  );
}
```

`client/components/intent-input.tsx` is the runnable example. It submits text to `noob.run()`, opens the SDK modal, and clears page messages after 3.5 seconds.

The modal presents a chat with black user messages and ghost-white responses. A spinner appears while interpreting, and missing details use a reply composer below the conversation. Review details, wallet actions, and progress appear inside the response. The original request and submitted replies stay together when the wallet picker opens and after a refresh. Pasted HTML is converted to plain text. It connects a compatible wallet, binds the signing account, and builds the live review. MetaMask can be reused across balance, transfer, swap and bridge actions on Hedera Testnet and Base Sepolia. The chooser opens the EVM wallet list for new requests. Balance reads need no signature or network switch; Hedera resolves the EVM address to its testnet account, and Base reads ETH or USDC using the EVM address. Hedera transfers prepare an EVM HBAR or HTS token transaction for MetaMask, or a native transfer when a native account is selected. SaucerSwap swaps and LayerZero bridge steps use the same EVM wallet on the source network. If both wallet connections exist, the demo prefers the EVM wallet for new requests; existing native reviews retain their bound native signer. The modal guides network switching before approval and signing. Compatible connected wallets skip the connection step. A different connected wallet cannot sign an existing review.

`NoobWallet` supplies the current account, EVM address, connection prompt, native signer, EVM client, and chain switcher. Its `connect(requirement?)` receives the required wallet kind and source network, so the host can open the appropriate chooser. The SDK does not import Next.js, Reown, Wagmi, or the server. The example client uses one Reown AppKit instance with native Hedera and EVM adapters. Installed native Hedera extensions are discovered through their own extension protocol and receive the WalletConnect pairing directly. The chooser offers wallets without email, social login, or AppKit's separate swap, send, and buy flows. AppKit owns sessions and disconnection; the client does not clear wallet storage or rebuild sessions manually.

The promise resolves with the final persisted execution, including terminal failure or cancellation. Closing before creation rejects the promise. Closing a submitted execution minimizes the modal and preserves recovery.

## Structure

```text
contract/               testnet USDC bridge, Foundry tests, deployment and wiring scripts
client/                 runnable Next.js modal example and wallet integration
packages/schema/        shared validated intent, action, review, and execution contracts
packages/sdk/           reusable modal, browser lifecycle, transport, and wallet adapters
server/src/features/    action, intent, plan, and execution behavior
server/src/shared/      database adapters, configuration, authorization, HTTP, logging, integrations
scripts/                setup, development, build, lint, type checking, and tests
```

The execution feature has its model, repository, service, controller, routes, worker, receipts, and public index. Internal features expose their services through their own index files. Shared infrastructure contains no feature controllers or intent prompts. Complete source filenames are in [noob.md](noob.md).

## Persistence and recovery

MongoDB and Postgres implement the same database contract. Each execution persists its capability hash, current state, prepared context, and submission history together. Compare-and-swap updates prevent concurrent approvals, preparations, or submissions from advancing twice. Rate limits also use atomic database updates.

Choose the database before starting executions. Changing `DB_MODE` or `DB_URI` selects different storage; it does not migrate pending executions. Keep using the original database to recover its pending executions.

The browser journals preparation information before asking a wallet to sign and saves the returned reference before registering it with the server. Interrupted registration reuses that reference. The background worker reconciles submitted and settling executions without signing or broadcasting a new source transaction.

Driver references: [MongoDB atomic operations](https://www.mongodb.com/docs/drivers/node/current/crud/compound-operations/), [node-postgres queries](https://node-postgres.com/features/queries).

## Supported testnet actions

- HBAR and fungible HTS balances and transfers on Hedera testnet.
- ETH and configured test-USDC balances and transfers on Base Sepolia.
- Same-chain Hedera swaps through the live SaucerSwap V1 testnet router.
- A liquidity-backed test-USDC bridge using our LayerZero V2 contracts.
- Composed Hedera asset → Base USDC and Base USDC → Hedera asset routes.

Both RPC providers verify the testnet chain ID. Wallets use Hedera testnet (296) and Base Sepolia (84532). Associations, approvals, swaps, bridges and claims have separate wallet prompts when required. Every stage is rechecked before signing; the server verifies the exact submitted transaction and the destination payout. Completed stages and their receipts remain in the conversation and database.

The configured Hedera USDC is SaucerSwap's liquid test token **0.0.5449**. Base uses Circle's test USDC **0x036CbD53842c5426634e7929541eC2318f3dCF7e**. This explicit testnet pool mapping does not mint Circle tokens and does not imply these token issuers are identical. Circle's separately listed Hedera test token 0.0.429274 is not substituted into the SaucerSwap route.

The bridge is deployed, configured and initially funded with **10 test USDC per network**. [testnet.json](contract/deployments/testnet.json) records both addresses and deployment transactions. Hedera uses `0x827fab4b1f0059896f76a2db5e5a0f4cc4553b4a`; Base uses `0x27ce1d17ad320417f7aaf15f3e4d6dff5c13d642`. Same-chain swaps use deployed SaucerSwap contracts. Base-to-Base swaps require a separate DEX integration.

## Deploy the testnet bridge

The root `contract/` project uses Foundry and pinned official LayerZero and OpenZeppelin packages installed by Yarn. The contract rejects mainnet deployment. `contract/script/Bridge.s.sol` has separate `deploy()`, `wire()` and `fund()` entry points. Run each network's operations separately, using its actual RPC and reviewed environment values from `contract/.env.example`:

```sh
cd contract
forge script script/Bridge.s.sol:BridgeScript --sig 'deploy()' --rpc-url "$RPC_URL" --broadcast
forge script script/Bridge.s.sol:BridgeScript --sig 'wire()' --rpc-url "$RPC_URL" --broadcast
forge script script/Bridge.s.sol:BridgeScript --sig 'fund()' --rpc-url "$RPC_URL" --broadcast
```

Keep `BRIDGE_DEPLOYER_KEY` in the contract environment only. Deployment registers `BRIDGE_OWNER` as LayerZero delegate. Wiring must be signed by that owner/delegate; set the corresponding key when wiring. Configure reciprocal bridge peers, the pinned send/receive libraries, the LayerZero Labs testnet DVN, and executor on both networks. These scripts are never called by tests or by the execution server. Fund each receiving pool with its configured test USDC. Set `BRIDGE_DEPLOY_VALUE` to provide the Hedera contract with operational HBAR if needed; this is the RPC's 18-decimal value. `BRIDGE_FUND_AMOUNT` uses six-decimal token units.

Record deployed addresses in `contract/deployments/testnet.json`, then set `NOOB_HEDERA_BRIDGE_ADDRESS` and `NOOB_BASE_BRIDGE_ADDRESS` in `server/.env` and restart the server. Before accepting a route, the server checks both deployments, token mapping, endpoint, reciprocal peer, pause state, amount limit and available destination liquidity. If delivery arrives without sufficient liquidity, the contract reserves the payout and exposes a permissionless claim. The server prepares a destination claim only when it can succeed; it never repeats the source bridge.

The local operator command `yarn testnet:deploy --broadcast` deploys and wires both networks through their verified RPCs. It uses the private files in `contract/.secrets/` and checks their keys against the public [wallet manifest](contract/deployments/wallets.testnet.json). Use this command for Hedera when Foundry cannot simulate the HTS association precompile. The [operations journal](contract/deployments/operations.testnet.json) persists each signed transaction hash before broadcast and verifies existing submissions on resume.

## Live testnet validation

With MongoDB, the execution server and the client running, the local operator can validate real actions through the client's same-origin API:

```sh
yarn testnet:validate --broadcast balance-hbar balance-hedera-usdc balance-base-eth balance-base-usdc cancel
yarn testnet:validate --broadcast transfer-base-eth transfer-base-usdc transfer-hbar transfer-hedera-usdc swap-hedera
yarn testnet:validate --broadcast bridge-hedera-base bridge-base-hedera swap-hedera-base swap-base-hedera
```

These commands sign and broadcast **testnet transactions** and require the explicit `--broadcast` flag. They run sequentially using the generated local test wallets. Cases use small fixed amounts, check interpreted actions against those amounts, approve the actual review, sign provider-prepared transactions, repeat registration to verify idempotency, and reject further preparation after completion. They are separate from `yarn test` and `yarn check`.

Private execution capabilities and pending steps stay in ignored `contract/.secrets/live-validations.json`. The public [validation report](contract/deployments/validation.testnet.json) records execution states and receipts. Rerunning a case resumes its existing execution; it does not send completed source transactions again. Keep both journals when restarting. These checks exercise the live API and chain settlement; browser extension pairing still requires a manual wallet interaction.

The [2026-10-03 validation summary](contract/deployments/validation.testnet.md) records all 14 completed checks, including both bridge directions, both composed routes and recovery during a server restart. The [balance snapshot](contract/deployments/balances.testnet.json) records remaining gas, test USDC and pool liquidity.

## Checks and production commands

```sh
yarn check
yarn contract:build
yarn build
```

Tests cover both database adapters, durable recovery, concurrent transitions, quote and fee bounds, token approvals and associations, transaction matching, deferred wallet connection, composed route advancement, bridge authentication, replay prevention, reserved liquidity, pause behavior, ownership and payout conservation. Postgres SQL is exercised against PGlite; MongoDB tests use a temporary real MongoDB process. The first MongoDB test downloads its test binary if it is not cached. Tests do not sign or broadcast real transactions. `NOOB_LIVE_PROVIDER_TESTS=1 yarn test` additionally runs a read-only live SaucerSwap testnet quote.

After building, run `yarn server:serve` and `yarn client:serve` in separate terminals. The server runs the settlement worker. A standalone worker command is also available for deployments using an external scheduler.

The inherited MIT copyright notices remain in [LICENSE](LICENSE). `template.json` describes the repository's layout and commands.
