# 9oob

Embed natural language onchain actions in your Hedera app. Set up the scaffold
and call `noob.run(intent)` to check balances, transfer, swap and bridge through
one guided modal.

**Networks:** Hedera Testnet and Base Sepolia. **Swaps:** SaucerSwap.
**Cross-chain messaging:** LayerZero V2.

## Setup

Requires Node.js **22.12+** and Yarn **3.2.3**. Install Foundry for contract checks;
Docker is needed only for the bundled local MongoDB.

### 1. Create your app

```sh
npm create scaffold-hbar@latest -- --template chigozzdevv/9oob
```

Enter your project name. The template selects Next.js, Foundry and Yarn.
Inside the generated folder, run:

```sh
yarn setup
```

This installs dependencies and creates missing environment files.

### 2. Configure

Set your OpenAI key and database in `server/.env`:

```dotenv
OPENAI_API_KEY=YOUR_OPENAI_KEY
DB_MODE=mongodb
DB_URI=mongodb://127.0.0.1:27017/9oob
```

For Postgres, set `DB_MODE=postgres` and `DB_URI` to its full connection string.
The server initializes the selected database.

Set your Reown project ID in `packages/nextjs/.env.local`:

```dotenv
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=YOUR_PROJECT_ID
```

Shared testnet bridge addresses are included in [server/.env.example](server/.env.example).
`NOOB_SERVER_URL` selects the execution API; `NOOB_APP_ORIGIN` sets the frontend origin.
Keep OpenAI and database credentials on the server.

### 3. Run

```sh
docker compose up -d --wait mongodb
yarn next:dev
```

Skip the Docker command when using your own MongoDB or Postgres.
Open the [demo](http://localhost:3000/demo). The app starts at port **3000** and the
execution API at **3001**.

Use MetaMask with test HBAR on Hedera and test ETH on Base Sepolia for gas.
Swap HBAR for Hedera test USDC (`0.0.5449`); get Base test USDC from
[Circle's faucet](https://faucet.circle.com/). Try **0.1 HBAR** for a swap or
**0.1 USDC** for a bridge.

## SDK integration

The scaffold includes wallet setup, the provider and modal styles. Call from a
Next.js client component:

```ts
import { noob } from "@9oob/sdk";

await noob.run("Check my HBAR balance");
```

This opens the modal for clarification, wallet connection, review, signing and
progress. Pending executions resume after refresh; the call resolves with the
final execution, including failure or cancellation. See the
[runnable example](packages/nextjs/components/intent-input.tsx).

For an existing React app, mount the provider once inside your wallet setup:

```tsx
import { NoobProvider } from "@9oob/sdk";

<NoobProvider wallet={appWallet}>
  <App />
</NoobProvider>;
```

`appWallet` implements [NoobWallet](packages/sdk/src/wallet/wallet.ts); the scaffold's
[wallet adapter](packages/nextjs/providers/wallet-provider.tsx) is the reference.
The API endpoint defaults to `/api/noob` and styles load automatically.

## Supported actions

| Action               | Hedera Testnet               | Base Sepolia                 |
| -------------------- | ---------------------------- | ---------------------------- |
| Balance and transfer | HBAR and fungible HTS tokens | ETH and configured test USDC |
| Swap                 | SaucerSwap V1 testnet pools  | Not configured               |
| Bridge               | Test USDC → Base             | Test USDC → Hedera           |
| Cross-chain swap     | Hedera asset → Base USDC     | Base USDC → Hedera asset     |

Swaps and bridges default to the connected wallet. Transfers require a recipient.
Users review live details before signing; the server verifies settlement and
recovers pending executions without repeating submitted transactions.

## Testnet evidence

**2026-10-03:** 14 live API checks passed across balances, transfers, swaps,
bridges, combined routes and recovery. See the [full receipts](packages/foundry/deployments/validation.testnet.json).

Hedera → Base bridge:
[Hedera transaction](https://hashscan.io/testnet/transaction/0x0d065f06bd664a64d3aabff5b17ea476fb73e43bc18e95f4493e55b6cf2a4c17)
→ [Base payout](https://sepolia.basescan.org/tx/0x2a4644461c2e3ce2235a07cc8cbedd0939eb3c2ebe608dbce52be5aa02928101).

The bridge collects source USDC and pays destination USDC from funded pools.
The demo shows current liquidity; [deployment details](packages/foundry/deployments/testnet.json)
record the configured contracts and distinct test assets.

## Project structure

| Path                   | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `packages/nextjs/`     | Landing page, demo, wallet setup and API proxy          |
| `packages/sdk/`        | `noob.run()`, modal and execution lifecycle             |
| `packages/schema/`     | Validated intent and execution contracts                |
| `server/src/features/` | Intent, planning, actions, execution and liquidity      |
| `server/src/shared/`   | Database, configuration, authorization and integrations |
| `packages/foundry/`    | Bridge contracts, tests, scripts and receipts           |

## Checks

```sh
yarn check
yarn next:build
```

Checks cover both database adapters, wallet flows, recovery and bridge safety.
Automated tests never sign or broadcast real transactions.

[Bridge deployment](packages/foundry/README.md) · [Deployment examples](deploy/README.md) · [Agent instructions](AGENTS.md)

[MIT license](LICENSE).
