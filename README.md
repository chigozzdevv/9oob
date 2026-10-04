# 9oob

Embed natural language onchain actions in your Hedera app. Set up the scaffold
and call `noob.run(intent)`. Users check balances,
transfer, swap and bridge through one guided conversation.

**Networks:** Hedera Testnet and Base Sepolia. **Swaps:** SaucerSwap.
**Cross-chain messaging:** LayerZero V2.

## Execution flow

1. Your app submits an intent. The server interprets and validates it; missing
   details are answered in the same chat.
2. The modal requests a compatible wallet when the action needs an account.
   Balance reads require no signature or network switch.
3. For transactions, users review live details, approve and sign the required
   steps. The SDK guides network changes, associations and allowances when needed.
4. The server verifies transactions and destination settlement. Progress survives
   refreshes and restarts without resending a submitted source transaction.

## Supported routes

| Action                   | Hedera Testnet               | Base Sepolia                        |
| ------------------------ | ---------------------------- | ----------------------------------- |
| Balance and transfer     | HBAR and fungible HTS tokens | ETH and configured test USDC        |
| Same-chain swap          | SaucerSwap V1 testnet pools  | Requires a separate DEX integration |
| Bridge                   | Test USDC → Base             | Test USDC → Hedera                  |
| Combined swap and bridge | Hedera asset → Base USDC     | Base USDC → Hedera asset            |

Swaps default to the connected wallet as recipient. Explicit recipients are
preserved; transfers and bridges ask for one when missing. MetaMask supports all
four actions across both networks. Native Hedera signing remains available for
Hedera transfers.

## Testnet evidence

**2026-10-03:** 14 live API checks passed across balances, transfers, swaps, both
bridge directions, combined routes and recovery.

The Hedera → Base bridge has a verified [Hedera transaction](https://hashscan.io/testnet/transaction/0x0d065f06bd664a64d3aabff5b17ea476fb73e43bc18e95f4493e55b6cf2a4c17)
and [Base payout](https://sepolia.basescan.org/tx/0x2a4644461c2e3ce2235a07cc8cbedd0939eb3c2ebe608dbce52be5aa02928101).
See the [full receipts](packages/foundry/deployments/validation.testnet.json).

## Setup

Requires Node.js **22.12+** and Yarn **3.2.3**. Install Foundry for contract builds
and `yarn check`; Docker Desktop is needed only for the local MongoDB option.

### 1. Create your app

```sh
npm create scaffold-hbar@latest -- --template chigozzdevv/9oob
```

Enter your project name. The template selects Next.js, Foundry and Yarn.
Enter the generated folder and run:

```sh
yarn setup
```

Setup installs dependencies and copies missing environment files while preserving
existing ones.

### 2. Configure

In `server/.env`, set your OpenAI key and database:

```dotenv
OPENAI_API_KEY=YOUR_OPENAI_KEY
DB_MODE=mongodb
DB_URI=mongodb://127.0.0.1:27017/9oob
```

For Postgres, use `DB_MODE=postgres` and a full connection string such as
`postgresql://username:password@localhost:5432/9oob`. Startup initializes the
selected database's tables or indexes.

In `packages/nextjs/.env.local`, set your Reown project ID:

```dotenv
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=YOUR_PROJECT_ID
```

The server example includes the shared testnet bridge addresses. OpenAI and database
credentials stay on the server. If the client origin changes, update
`NOOB_APP_ORIGIN`; `NOOB_SERVER_URL` selects the client's execution backend.

### 3. Start and try an intent

With Docker Desktop running, start the bundled MongoDB and app:

```sh
docker compose up -d --wait mongodb
yarn next:dev
```

Skip the Docker command when using a remote database or Postgres.
Open the [landing page](http://localhost:3000) or [demo](http://localhost:3000/demo).
The execution server runs at `http://127.0.0.1:3001`; the client proxies `/api/noob/*`
to it. The demo displays available bridge liquidity and connects your wallet when
needed.

Fund MetaMask with test HBAR on Hedera and test ETH on Base Sepolia for gas.
Fund HBAR first to create its Hedera account. Get Hedera test USDC by swapping test
HBAR through SaucerSwap; [Circle's faucet](https://faucet.circle.com/) supplies the
configured Base test USDC. Start with small amounts such as **0.1 HBAR** for a swap
or **0.1 USDC** for a bridge.

`docker compose stop mongodb` stops the local database while retaining its data.

## SDK integration

The scaffold includes wallet setup, the provider and modal styles. Call
`noob.run()` from your app to open the modal with an intent:

```ts
import { noob } from "@9oob/sdk";

await noob.run("Check my HBAR balance");
```

The SDK handles clarification, wallet connection, review, signing, progress and
recovery. Styles load automatically. `noob.run()` resolves with the final persisted
execution, including failure or cancellation. Call it from a client component in
Next.js; [`intent-input.tsx`](packages/nextjs/components/intent-input.tsx) is the runnable example.

<details>
<summary>Integrate into an existing React app</summary>

Mount the provider once inside your existing wallet setup:

```tsx
import { NoobProvider } from "@9oob/sdk";

<NoobProvider wallet={appWallet}>
  <App />
</NoobProvider>;
```

`appWallet` implements [`NoobWallet`](packages/sdk/src/wallet/wallet.ts): identity,
connection, signing and network switching. The scaffold's
[`wallet-provider.tsx`](packages/nextjs/providers/wallet-provider.tsx) supplies this adapter.
The endpoint defaults to `/api/noob`; pass `endpoint` only for a different API URL.

</details>

## Testnet bridge

The shared contracts collect source USDC and pay the destination's configured
USDC from funded pools. They do not mint a new token. Destination liquidity is
checked before signing.

| Network              | Bridge                                       | Test asset                                               |
| -------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Hedera Testnet (296) | `0x827fab4b1f0059896f76a2db5e5a0f4cc4553b4a` | SaucerSwap USDC `0.0.5449`                               |
| Base Sepolia (84532) | `0x27ce1d17ad320417f7aaf15f3e4d6dff5c13d642` | Circle USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

The [deployment manifest](packages/foundry/deployments/testnet.json) records deployment
transactions and initial funding of **10 test USDC per pool**. These are distinct
test assets; Circle's Hedera token `0.0.429274` is not used in this route. Current
liquidity is shown in the demo.

<details>
<summary>Custom deployments and live validation</summary>

[`Bridge.s.sol`](packages/foundry/script/Bridge.s.sol) provides `deploy()`, `wire()` and
`fund()` using [`packages/foundry/.env.example`](packages/foundry/.env.example). Configure reciprocal
peers, LayerZero libraries, DVN and executor on both networks, then fund each
receiving pool. Set your deployed addresses in `NOOB_HEDERA_BRIDGE_ADDRESS` and
`NOOB_BASE_BRIDGE_ADDRESS` in `server/.env` and restart the server.

The local operator commands `yarn testnet:deploy --broadcast` and
`yarn testnet:validate --broadcast <case>` use ignored `packages/foundry/.secrets/` wallets
matching the [wallet manifest](packages/foundry/deployments/wallets.testnet.json). They sign
and broadcast testnet transactions and run separately from automated tests.
Available validation cases are in [`live-testnet.mts`](server/scripts/live-testnet.mts).

Keep the [operations journal](packages/foundry/deployments/operations.testnet.json) and
private validation journal when resuming interrupted runs. If a destination pool
cannot pay immediately, the bridge reserves the payout for a later claim without
repeating the source bridge.

</details>

## Reference

| Path                   | Responsibility                                                      |
| ---------------------- | ------------------------------------------------------------------- |
| `packages/nextjs/`     | Next.js landing page, demo, wallet setup and API proxy              |
| `packages/sdk/`        | `noob.run()`, modal, browser lifecycle and wallet adapters          |
| `packages/schema/`     | Validated intent, action, review and execution contracts            |
| `server/src/features/` | Intent, planning, actions, execution and liquidity APIs             |
| `server/src/shared/`   | Database, configuration, authorization and provider integrations    |
| `packages/foundry/`    | USDC bridge, Foundry tests, deployment scripts and testnet evidence |

MongoDB and Postgres preserve execution state, preparation context and submission
history with atomic updates. Changing `DB_MODE` or `DB_URI` selects different
storage; pending executions must be recovered from their original database.
The worker verifies existing submissions without signing new source transactions.

```sh
yarn check
yarn next:build
```

Checks cover validation, both database adapters, wallet guidance, recovery,
provider transactions and bridge safety. Postgres tests use PGlite; MongoDB tests
start a temporary MongoDB process and may download its binary on first use.
Automated tests never sign or broadcast real transactions.

After building, run `yarn server:serve` and `yarn client:serve` in separate terminals.
9oob uses the [MIT license](LICENSE).
