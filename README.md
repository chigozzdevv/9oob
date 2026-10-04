# 9oob

Embed natural language onchain actions in your Hedera app. Configure a wallet
adapter, mount `NoobProvider`, and call `noob.run(intent)`. Users check balances,
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

**2026-10-03:** all 14 checks passed through the client API, OpenAI interpretation,
MongoDB and live testnet providers: 13 completed executions and one cancellation.
Coverage included balances, transfers, swaps, both bridge directions, combined
routes and bridge recovery during a server restart.

See the [validation summary](contract/deployments/validation.testnet.md) and
[detailed receipts](contract/deployments/validation.testnet.json). This operator
run exercised real settlement; browser extension pairing and manual wallet prompts
were not part of it.

## Setup

Requires Node.js **22.12+** and Yarn **3.2.3**. Install Foundry for contract builds
and `yarn check`; Docker Desktop is needed only for the local MongoDB option.

### 1. Install

```sh
git clone https://github.com/chigozzdevv/9oob.git
cd 9oob
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

In `client/.env.local`, set your Reown project ID:

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

Mount one provider with your app's wallet adapter and execution endpoint:

```tsx
import { NoobProvider, noob, type NoobWallet } from "@9oob/sdk";
import "@9oob/sdk/styles.css";

function App({ wallet }: { wallet: NoobWallet }) {
  return (
    <NoobProvider wallet={wallet} endpoint="/api/noob">
      <button onClick={() => void noob.run("Check my HBAR balance")}>Check balance</button>
    </NoobProvider>
  );
}
```

[`NoobWallet`](packages/sdk/src/wallet/wallet.ts) supplies identity, connection,
signing and network switching. The SDK owns chat, review, execution and recovery;
`noob.run()` resolves with the final persisted execution, including failure or
cancellation. Use a client component in Next.js.

The runnable integration is in
[`wallet-provider.tsx`](client/providers/wallet-provider.tsx) and
[`intent-input.tsx`](client/components/intent-input.tsx), using the bundled SDK
workspace.

## Testnet bridge

The shared contracts collect source USDC and pay the destination's configured
USDC from funded pools. They do not mint a new token. Destination liquidity is
checked before signing.

| Network              | Bridge                                       | Test asset                                               |
| -------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Hedera Testnet (296) | `0x827fab4b1f0059896f76a2db5e5a0f4cc4553b4a` | SaucerSwap USDC `0.0.5449`                               |
| Base Sepolia (84532) | `0x27ce1d17ad320417f7aaf15f3e4d6dff5c13d642` | Circle USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

The [deployment manifest](contract/deployments/testnet.json) records deployment
transactions and initial funding of **10 test USDC per pool**. These are distinct
test assets; Circle's Hedera token `0.0.429274` is not used in this route. Current
liquidity is shown in the demo.

<details>
<summary>Custom deployments and live validation</summary>

[`Bridge.s.sol`](contract/script/Bridge.s.sol) provides `deploy()`, `wire()` and
`fund()` using [`contract/.env.example`](contract/.env.example). Configure reciprocal
peers, LayerZero libraries, DVN and executor on both networks, then fund each
receiving pool. Set your deployed addresses in `NOOB_HEDERA_BRIDGE_ADDRESS` and
`NOOB_BASE_BRIDGE_ADDRESS` in `server/.env` and restart the server.

The local operator commands `yarn testnet:deploy --broadcast` and
`yarn testnet:validate --broadcast <case>` use ignored `contract/.secrets/` wallets
matching the [wallet manifest](contract/deployments/wallets.testnet.json). They sign
and broadcast testnet transactions and run separately from automated tests.
Available validation cases are in [`live-testnet.mts`](server/scripts/live-testnet.mts).

Keep the [operations journal](contract/deployments/operations.testnet.json) and
private validation journal when resuming interrupted runs. If a destination pool
cannot pay immediately, the bridge reserves the payout for a later claim without
repeating the source bridge.

</details>

## Reference

| Path                   | Responsibility                                                      |
| ---------------------- | ------------------------------------------------------------------- |
| `client/`              | Next.js landing page, demo, wallet setup and API proxy              |
| `packages/sdk/`        | `noob.run()`, modal, browser lifecycle and wallet adapters          |
| `packages/schema/`     | Validated intent, action, review and execution contracts            |
| `server/src/features/` | Intent, planning, actions, execution and liquidity APIs             |
| `server/src/shared/`   | Database, configuration, authorization and provider integrations    |
| `contract/`            | USDC bridge, Foundry tests, deployment scripts and testnet evidence |

MongoDB and Postgres preserve execution state, preparation context and submission
history with atomic updates. Changing `DB_MODE` or `DB_URI` selects different
storage; pending executions must be recovered from their original database.
The worker verifies existing submissions without signing new source transactions.
See [noob.md](noob.md) for the full source tree, API and recovery design.

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
