# Testnet bridge

LayerZero V2 connects the Hedera Testnet and Base Sepolia contracts. Each contract
collects source USDC and pays the destination's configured USDC from a funded pool.
The bridge does not mint tokens.

See the [deployment manifest](deployments/testnet.json) for addresses, token IDs
and deployment receipts.

## Custom deployments

[`Bridge.s.sol`](script/Bridge.s.sol) provides `deploy()`, `wire()` and
`fund()` using [`packages/foundry/.env.example`](.env.example). Configure reciprocal
peers, LayerZero libraries, DVN and executor on both networks, then fund each
receiving pool. Set your deployed addresses in `NOOB_HEDERA_BRIDGE_ADDRESS` and
`NOOB_BASE_BRIDGE_ADDRESS` in `server/.env` and restart the server.

The local operator commands `yarn testnet:deploy --broadcast` and
`yarn testnet:validate --broadcast <case>` use ignored `packages/foundry/.secrets/` wallets
matching the [wallet manifest](deployments/wallets.testnet.json). They sign
and broadcast testnet transactions and run separately from automated tests.
Available validation cases are in [`live-testnet.mts`](../../server/scripts/live-testnet.mts).

Keep the [operations journal](deployments/operations.testnet.json) and
private validation journal when resuming interrupted runs. If a destination pool
cannot pay immediately, the bridge reserves the payout for a later claim without
repeating the source bridge.

## Checks

Run from the repository root:

```sh
yarn contract:build
yarn contract:test
```

Foundry tests never broadcast transactions.
