# Live testnet validation

Completed 2026-10-03T12:30:23.048Z. All 14 cases passed through the live client proxy, OpenAI interpretation, MongoDB lifecycle and actual testnet providers. Thirteen executions completed and the cancellation case cancelled as expected.

Hedera Testnet (296) and Base Sepolia (84532) only. Both bridge contracts were deployed, wired to reciprocal peers and funded with 10 test USDC each before these checks.

| Check                                   | Result            |
| --------------------------------------- | ----------------- |
| Transfer 0.0005 ETH on Base             | Passed: completed |
| Transfer 0.5 USDC on Base               | Passed: completed |
| Bridge 1 USDC: Hedera → Base            | Passed: completed |
| Bridge 1 USDC: Base → Hedera            | Passed: completed |
| Swap 0.1 HBAR → USDC on Hedera          | Passed: completed |
| Swap 0.1 HBAR → Base USDC               | Passed: completed |
| Swap 0.1 Base USDC → Hedera HBAR        | Passed: completed |
| Transfer 0.01 HBAR on Hedera            | Passed: completed |
| Transfer 0.01 USDC on Hedera            | Passed: completed |
| Read Hedera HBAR balance                | Passed: completed |
| Read Hedera USDC balance                | Passed: completed |
| Read Base ETH balance                   | Passed: completed |
| Read Base USDC balance                  | Passed: completed |
| Cancel before connection and submission | Passed: cancelled |

## Verified execution behavior

- Interpretation happened before requesting an account. Every interpreted action was checked against its authorized amount, network, asset and recipient.
- Reviewed stages produced provider-prepared transactions. Source receipts matched the signer, target, calldata and value; destination bridge receipts matched the GUID, recipient and amount.
- Repeating submission registration preserved each execution. Completed and cancelled executions refused further preparation.
- The server was stopped and restarted while the first bridge was settling. MongoDB recovery retained the original source hash and completed the destination payout. The source journal contains one submission for that bridge.
- The combined Hedera → Base route bridged the actual SaucerSwap output of 0.224177 USDC. The reverse route bridged 0.1 USDC and completed its Hedera swap.

## Receipts

### Transfer 0.0005 ETH on Base

- transfer on base: `0x823666ffc2a5ed30df24d1bd9c561c883bd5cec9dba40ae6137db0ecb1fddba7`

### Transfer 0.5 USDC on Base

- transfer on base: `0x25749f249527ca377dac6e89726ff4d016d7c6dd6ae9d9743ff17967b48dfcf1`

### Bridge 1 USDC: Hedera → Base

- approval on hedera: `0x7be83966df37432979cca44ba623805a6c029a5621c0b073197d641cdb683a15`
- bridge on hedera: `0x0d065f06bd664a64d3aabff5b17ea476fb73e43bc18e95f4493e55b6cf2a4c17` (raw amount 1000000)
- Destination payout: `0x2a4644461c2e3ce2235a07cc8cbedd0939eb3c2ebe608dbce52be5aa02928101`

### Bridge 1 USDC: Base → Hedera

- approval on base: `0xe57cb94c05ee249cbc4cbcd152fcf473ddb959aa29ad7a1c79a80f4cd0c0eb72`
- bridge on base: `0xff294a6555d25baae3b2adaad6432987abf7d2c4a03a4e15552f48f97ba73856` (raw amount 1000000)
- Destination payout: `0xb4bf0f4982d1af17cf14feac4367848979f6fd15871cd1cc91c2a5d945da9003`

### Swap 0.1 HBAR → USDC on Hedera

- swap on hedera: `0x9d3ce788b5bfdc01d9bcee550acc5262e9cbc698830294a6887918886b225e5c`

### Swap 0.1 HBAR → Base USDC

- swap on hedera: `0x268b8c1d995a0499317a7c16d228359c97a28852faf722b583a1e26cf622b45c` (raw amount 224177)
- approval on hedera: `0x0bfa24953cab112d75d51f62dfac996a505406af77d40564aae1b5d546ce73b5`
- bridge on hedera: `0x7adccda9340286a82b681be44c2f5da3df20085de3e0835c0c58301932948c65` (raw amount 224177)
- Destination payout: `0x0523d33505b7630f8651a16084c5c4af4badb44ac2ce6b4ec01a7fff32488513`

### Swap 0.1 Base USDC → Hedera HBAR

- approval on base: `0xb51e4057a11d466fd5ff1a2bdbeff9371233c131d1579b8dd920491410673f7f`
- bridge on base: `0x14665642160faa3d5d6d9d752520cc50c1477c99a4849cab7c8bc7247de86c03` (raw amount 100000)
- approval on hedera: `0x8ca564bcdc770ae403f8a9f49586cc95f481011acc2ac792e6960a7fe9500235`
- swap on hedera: `0x2b107812350686fd00ddd125165c20a6b08e3eca6949a34e274af88d4297c2be`
- Destination payout: `0x5c401899fdc098e7c113b434a30330ae5fabdab4f57739be6d2b2a6c60a2bb0c`

### Transfer 0.01 HBAR on Hedera

- transfer on hedera: `0.0.10840734@1791030290.091360024`

### Transfer 0.01 USDC on Hedera

- transfer on hedera: `0.0.10840734@1791030311.333253913`

## Final balances

Observed 2026-10-03T12:29:09.164Z.

| Wallet                            | Native gas               | Test USDC |
| --------------------------------- | ------------------------ | --------- |
| Hedera 0.0.10840734               | 2.25700715 HBAR          | 1.430104  |
| Base deployer                     | 0.002483451124587296 ETH | 9.5       |
| Shared validation address on Base | 0.000246823055997778 ETH | 0.624177  |

Available bridge liquidity: 10.134177 USDC on Hedera and 9.875823 USDC on Base.

## Repairs and automated checks

Fixed the Hedera token-balance endpoint and a concurrent receipt-reconciliation race that incorrectly returned execution-not-found. The operator runner now verifies its native fee serialization and records explicit precheck rejections separately from accepted submissions. Its rejected zero-fee attempt had no Mirror Node consensus record before a fresh ID was used.

`yarn check` passed: 86 application tests, 14 contract tests and 256 payout-conservation fuzz runs. One optional read-only provider test was skipped; live swaps were validated separately above. Automated tests never sign or broadcast real transactions.

The approved modal design was unchanged. Browser extension pairing and manual wallet prompts were not exercised by this operator run.

Detailed public evidence: [execution report](validation.testnet.json), [deployment manifest](testnet.json), [operations journal](operations.testnet.json), [balance snapshot](balances.testnet.json). Private keys and execution capabilities stay in ignored `contract/.secrets/`.
