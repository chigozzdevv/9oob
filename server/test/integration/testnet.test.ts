import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbi,
  pad,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { TESTNET, type IntentAction } from "@9oob/schema";
import { EvmProvider, type UnsignedTransaction } from "../../src/shared/integration/evm/evm.client.js";
import { tokenAbi, tokenAddress } from "../../src/shared/integration/evm/token.js";
import {
  SaucerSwapProvider,
  SAUCER_FACTORY,
  SAUCER_ROUTER,
  saucerAbi,
} from "../../src/shared/integration/saucerswap/saucerswap.provider.js";
import { LAYERZERO_TESTNET, ulnType } from "../../src/shared/integration/layerzero/layerzero.config.js";
import { LayerZeroProvider, bridgeAbi } from "../../src/shared/integration/layerzero/layerzero.provider.js";
import { HederaProvider } from "../../src/shared/integration/hedera/hedera.client.js";
import { TestnetProvider, ReviewRequiredError } from "../../src/shared/integration/testnet.provider.js";

const metadata = {
  token: async () => ({ type: "FUNGIBLE_COMMON", decimals: "6", custom_fees: {} }),
} as unknown as HederaProvider;
const sender = `0x${"1".repeat(40)}` as Address;
const recipient = `0x${"2".repeat(40)}` as Address;
const bridges = { hedera: `0x${"3".repeat(40)}`, base: `0x${"4".repeat(40)}` } as const;
const guid = `0x${"a".repeat(64)}` as Hex;
const hash = `0x${"b".repeat(64)}` as Hex;
const swap = {
  kind: "swap",
  sourceNetwork: "hedera",
  destinationNetwork: "hedera",
  sourceAsset: "HBAR",
  destinationAsset: "USDC",
  amount: "10",
  recipient: sender,
} as const;
const bridge = {
  kind: "bridge",
  sourceNetwork: "hedera",
  destinationNetwork: "base",
  sourceAsset: "USDC",
  destinationAsset: "USDC",
  amount: "1",
  recipient,
} as const;

class FixtureRpc extends EvmProvider {
  output = 22_000_000n;
  allowance = 1_000_000_000n;
  associated = true;
  capacity = 1_000_000_000n;
  fee = 100n;
  payout: [Address, bigint, boolean] = ["0x0000000000000000000000000000000000000000", 0n, false];
  simulated: UnsignedTransaction[] = [];
  logs: Array<{ address: string; topics: [Hex, ...Hex[]]; data: Hex; transactionHash: Hex }> = [];
  wrongPeer = false;
  wrongFactory = false;
  async assertContract(_address: Address) {}
  async simulate(transaction: UnsignedTransaction) {
    this.simulated.push(transaction);
    return "0x" as const;
  }
  async read<T>(
    _address: Address,
    _abi: Abi,
    name: string,
    args: readonly unknown[] = [],
    _from?: Address,
  ): Promise<T> {
    const other = this.network === "hedera" ? "base" : "hedera";
    const values: Record<string, unknown> = {
      factory: this.wrongFactory ? recipient : SAUCER_FACTORY,
      decimals: 6,
      getPair: recipient,
      getAmountsOut: [args[0], this.output],
      allowance: this.allowance,
      isAssociated: this.associated,
      associate: 22n,
      token: tokenAddress(this.network, "USDC"),
      remoteEid: TESTNET[other].eid,
      endpoint:
        this.network === "hedera"
          ? "0xbd672d1562dd32c23b563c989d8140122483631d"
          : "0x6edce65403992e310a62460808c4b910d972f10f",
      peers: pad(this.wrongPeer ? recipient : bridges[other]),
      getSendLibrary: LAYERZERO_TESTNET[this.network].sendLibrary,
      getReceiveLibrary: [LAYERZERO_TESTNET[this.network].receiveLibrary, false],
      getConfig:
        args[3] === 1
          ? encodeAbiParameters(
              [{ type: "uint32" }, { type: "address" }],
              [10000, LAYERZERO_TESTNET[this.network].executor],
            )
          : encodeAbiParameters(ulnType, [
              {
                confirmations: 2n,
                requiredDVNCount: 1,
                optionalDVNCount: 0,
                optionalDVNThreshold: 0,
                requiredDVNs: [LAYERZERO_TESTNET[this.network].dvn],
                optionalDVNs: [],
              },
            ]),
      paused: false,
      availableLiquidity: this.capacity,
      maxBridgeAmount: 1_000_000_000n,
      quoteBridge: this.fee,
      payouts: this.payout,
      balanceOf: this.capacity,
    };
    if (!(name in values)) throw new Error(`Unexpected read ${name}`);
    return values[name] as T;
  }
  async rpc<T>(method: string, _params: unknown[]): Promise<T> {
    if (method === "eth_blockNumber") return "0x10" as T;
    if (method === "eth_getLogs") return this.logs as T;
    throw new Error(`Unexpected RPC ${method}`);
  }
  async receipt(_hash: string) {
    const sent = { guid, destinationEid: 40245, sender, recipient, amount: 1_000_000n };
    const log =
      this.network === "hedera"
        ? {
            address: bridges.hedera,
            topics: encodeEventTopics({
              abi: bridgeAbi,
              eventName: "BridgeSent",
              args: { guid, sender, recipient },
            }) as [Hex, ...Hex[]],
            data: encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }], [sent.destinationEid, sent.amount]),
          }
        : this.logs[0];
    return { status: "0x1", blockNumber: "0x10" as Hex, transactionHash: hash, logs: log ? [log] : [] };
  }
}

function layerFixture() {
  const hedera = new FixtureRpc("hedera"),
    base = new FixtureRpc("base");
  const provider = new LayerZeroProvider(
    { hedera, base },
    { NOOB_HEDERA_BRIDGE_ADDRESS: bridges.hedera, NOOB_BASE_BRIDGE_ADDRESS: bridges.base },
  );
  return { hedera, base, provider };
}

test("SaucerSwap uses exact tinybar input, RPC value scaling, slippage and bounded deadline", async () => {
  const rpc = new FixtureRpc("hedera"),
    provider = new SaucerSwapProvider(rpc, metadata);
  const review = await provider.review(swap);
  const prepared = await provider.prepare(swap, sender, review);
  assert.equal(prepared.transaction.to, SAUCER_ROUTER);
  assert.equal(prepared.transaction.value, "10000000000000000000");
  const decoded = decodeFunctionData({ abi: saucerAbi, data: prepared.transaction.data });
  assert.equal(decoded.functionName, "swapExactETHForTokens");
  assert.equal(decoded.args![0], 21_890_000n);
  assert.equal(decoded.args![2], sender);
  assert.ok(Number(decoded.args![3]) <= Math.floor(Date.now() / 1000) + 300);
  assert.equal(rpc.simulated.length, 1);
});

test("a deteriorated quote or wrong router factory cannot reach a wallet step", async () => {
  const rpc = new FixtureRpc("hedera"),
    provider = new SaucerSwapProvider(rpc, metadata);
  const review = await provider.review(swap);
  rpc.output = 20_000_000n;
  await assert.rejects(provider.prepare(swap, sender, review), ReviewRequiredError);
  assert.equal(rpc.simulated.length, 0);
  rpc.wrongFactory = true;
  await assert.rejects(provider.review(swap), /factory/);
});

test("independent swap checks run together but quoting waits for token and deployment validation", async () => {
  const rpc = new FixtureRpc("hedera");
  const reads: string[] = [];
  const read = rpc.read.bind(rpc);
  rpc.read = async (...args) => {
    reads.push(args[2]);
    return read(...args);
  };
  let finish!: (token: { type: string; custom_fees: Record<string, unknown> }) => void;
  const provider = new SaucerSwapProvider(rpc, {
    token: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  } as unknown as HederaProvider);
  const review = provider.review(swap);
  assert.deepEqual(reads, ["factory", "decimals", "getPair"]);
  assert(!reads.includes("getAmountsOut"));
  finish({ type: "FUNGIBLE_COMMON", custom_fees: {} });
  await review;
  assert.equal(reads.at(-1), "getAmountsOut");
  const invalid = provider.review(swap);
  finish({ type: "NON_FUNGIBLE_UNIQUE", custom_fees: {} });
  await assert.rejects(invalid, /active fungible token/);
  assert.equal(reads.filter(name => name === "getAmountsOut").length, 1);
  assert.equal(rpc.simulated.length, 0);
});

test("association and exact token allowance are separate steps before swapping", async () => {
  const rpc = new FixtureRpc("hedera"),
    provider = new SaucerSwapProvider(rpc, metadata);
  rpc.associated = false;
  assert.equal((await provider.prepare(swap, sender, await provider.review(swap))).phase, "association");
  await assert.rejects(
    provider.prepare({ ...swap, recipient }, sender, await provider.review({ ...swap, recipient })),
    /recipient must associate/,
  );
  rpc.associated = true;
  rpc.allowance = 0n;
  const tokenSwap = { ...swap, sourceAsset: "SAUCE", amount: "2" };
  const approval = await provider.prepare(tokenSwap, sender, await provider.review(tokenSwap));
  assert.equal(approval.phase, "approval");
  const decoded = decodeFunctionData({ abi: tokenAbi, data: approval.transaction.data });
  assert.equal(decoded.functionName, "approve");
  assert.deepEqual(decoded.args, [SAUCER_ROUTER, 2_000_000n]);
});

test("bridge preflight checks both peers, tokens, capacity and fee bounds", async () => {
  const { provider, hedera, base } = layerFixture();
  const review = await provider.review(bridge);
  const prepared = await provider.prepare(bridge, sender, review);
  assert.equal(prepared.transaction.value, "1000000000000");
  assert.equal(prepared.transaction.to, bridges.hedera);
  assert.deepEqual(decodeFunctionData({ abi: bridgeAbi, data: prepared.transaction.data }).args, [
    1_000_000n,
    recipient,
  ]);
  hedera.fee = 111n;
  await assert.rejects(provider.prepare(bridge, sender, review), ReviewRequiredError);
  hedera.fee = 100n;
  base.capacity = 999_999n;
  await assert.rejects(provider.prepare(bridge, sender, review), /capacity/);
  base.capacity = 1_000_000_000n;
  base.wrongPeer = true;
  await assert.rejects(provider.review(bridge), /configuration/);
});

test("bridge waits for a matching destination payout and verifies its receipt", async () => {
  const { provider, base } = layerFixture();
  const prepared = await provider.prepare(bridge, sender, await provider.review(bridge));
  const waiting = await provider.status(prepared.context, hash);
  assert.equal(waiting.status, "pending");
  assert.equal(waiting.context!.guid, guid);
  base.payout = [recipient, 1_000_000n, false];
  assert.equal((await provider.status(waiting.context!, hash)).claimReady, true);
  const claim = await provider.prepareClaim(waiting.context!);
  assert.equal(claim.context.stage, "claim");
  assert.equal(claim.context.sourceChainKey, "base");
  assert.equal(decodeFunctionData({ abi: bridgeAbi, data: claim.transaction.data }).functionName, "claim");
  assert.equal(claim.context.bridgeSourceHash, hash);
  base.payout = [recipient, 1_000_000n, true];
  base.rpc = async <T>(method: string) => (method === "eth_blockNumber" ? "0x11" : base.logs) as T;
  base.logs = [
    {
      address: bridges.base,
      transactionHash: hash,
      topics: encodeEventTopics({ abi: bridgeAbi, eventName: "BridgePaid", args: { guid, recipient } }) as [
        Hex,
        ...Hex[],
      ],
      data: encodeAbiParameters([{ type: "uint256" }], [1_000_000n]),
    },
  ];
  assert.equal((await provider.status(waiting.context!, hash)).destinationTxHash, hash);
  base.payout = [sender, 1_000_000n, true];
  await assert.rejects(provider.status(waiting.context!, hash), /does not match/);
});

test("unconfigured bridges and unsupported Base swaps never manufacture a route", async () => {
  await assert.rejects(new LayerZeroProvider(undefined, {}).review(bridge), /must be deployed/);
  const provider = new TestnetProvider();
  assert.throws(
    () => provider.validate({ ...swap, sourceNetwork: "base", destinationNetwork: "base", sourceAsset: "ETH" }),
    /DEX/,
  );
  assert.throws(() => provider.validate({ ...bridge, sourceAsset: "HBAR" }), /only/);
});

test("a composed route bridges the amount actually received from its swap", async () => {
  const { provider: layerzero } = layerFixture();
  const saucer = new SaucerSwapProvider(new FixtureRpc("hedera"), metadata);
  const provider = new TestnetProvider(saucer, layerzero);
  const action: IntentAction = { ...swap, destinationNetwork: "base", recipient };
  const review = await provider.review(action, sender);
  const first = await provider.prepare(action, sender, review);
  assert.equal(first.context.stage, "swap");
  const next = await provider.next(first.context, 21_950_000n, sender);
  assert.equal(next!.context.stage, "bridge");
  const second = await provider.prepare(action, sender, next!.review, next!.context);
  assert.equal(second.context.amountRaw, "21950000");
  assert.equal(second.context.stageIndex, 1);
});

test("NFTs, paused tokens and tokens with custom transfer fees cannot enter a SaucerSwap route", async () => {
  for (const token of [
    { type: "NON_FUNGIBLE_UNIQUE" },
    { type: "FUNGIBLE_COMMON", deleted: true },
    { type: "FUNGIBLE_COMMON", pause_status: "PAUSED" },
    { type: "FUNGIBLE_COMMON", custom_fees: { fractional_fees: [{}] } },
  ]) {
    const provider = new SaucerSwapProvider(new FixtureRpc("hedera"), {
      token: async () => token,
    } as unknown as HederaProvider);
    await assert.rejects(provider.review(swap), /active fungible token/);
  }
});
