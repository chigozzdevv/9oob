import assert from "node:assert/strict";
import test from "node:test";
import type { Execution } from "@9oob/schema";
import { transactionLinks } from "../src/modal/transaction-links.js";

const source = `0x${"a".repeat(64)}`;
const destination = `0x${"b".repeat(64)}`;
const swap = `0x${"c".repeat(64)}`;
const execution: Execution = {
  id: "links",
  intent: "Bridge USDC to Base",
  accountId: `0x${"1".repeat(40)}`,
  evmAddress: `0x${"1".repeat(40)}`,
  status: "completed",
  interpretation: {
    outcome: "ready",
    message: "",
    review: null,
    action: {
      kind: "bridge",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      amount: "1",
      recipient: `0x${"2".repeat(40)}`,
    },
  },
  sourceTxHash: source,
  destinationTxHash: destination,
  error: null,
  version: 1,
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
};

test("bridge links bind source and payout receipts to their own testnet explorers", () => {
  assert.deepEqual(
    transactionLinks(execution).map(link => link.href),
    [`https://hashscan.io/testnet/transaction/${source}`, `https://sepolia.basescan.org/tx/${destination}`],
  );
  const claimed = transactionLinks({
    ...execution,
    stage: "claim",
    stageNetwork: "base",
    sourceTxHash: destination,
    completedSteps: [{ stage: "bridge", network: "hedera", txHash: source }],
  });
  assert.equal(claimed.length, 2);
  assert.equal(claimed[0].label, "Bridge · Hedera");
  assert.equal(claimed[1].label, "Payout · Base");
});

test("swaps and transfers deduplicate persisted receipts and retain the full reference", () => {
  const transfer: Execution = {
    ...execution,
    stage: "transfer",
    stageNetwork: "base",
    destinationTxHash: null,
    interpretation: {
      ...execution.interpretation,
      action: { kind: "transfer", network: "base", asset: "ETH", amount: "0.01", recipient: `0x${"2".repeat(40)}` },
    },
    completedSteps: [{ stage: "transfer", network: "base", txHash: source }],
  };
  assert.deepEqual(transactionLinks(transfer), [
    { label: "Base", hash: source, href: `https://sepolia.basescan.org/tx/${source}` },
  ]);
  const native = {
    ...transfer,
    stageNetwork: "hedera" as const,
    sourceTxHash: "0.0.123@1800000000.1",
    completedSteps: [],
  };
  assert.deepEqual(transactionLinks(native), [
    {
      label: "Hedera",
      hash: native.sourceTxHash,
      href: "https://hashscan.io/testnet/transaction/0.0.123-1800000000-000000001",
    },
  ]);
});

test("composed swaps retain approvals, bridge receipts, payouts and the final swap without duplicates", () => {
  const result = transactionLinks({
    ...execution,
    stage: "swap",
    stageNetwork: "hedera",
    sourceTxHash: swap,
    interpretation: {
      ...execution.interpretation,
      action: {
        kind: "swap",
        sourceNetwork: "base",
        destinationNetwork: "hedera",
        sourceAsset: "USDC",
        destinationAsset: "HBAR",
        amount: "1",
        recipient: `0x${"2".repeat(40)}`,
      },
    },
    completedSteps: [
      { stage: "approval", network: "base", txHash: `0x${"d".repeat(64)}` },
      { stage: "bridge", network: "base", txHash: source },
      { stage: "swap", network: "hedera", txHash: swap },
    ],
  });
  assert.equal(result.length, 4);
  assert.deepEqual(
    result.map(link => link.label),
    ["Approval · Base", "Bridge · Base", "Swap · Hedera", "Payout · Hedera"],
  );
  assert.equal(result[3].href, `https://hashscan.io/testnet/transaction/${destination}`);
});

test("sent references are visible during registration failures and stay on the current signing chain", () => {
  const pending = { preparationVersion: 2, network: "evm" as const, txHash: swap };
  const result = transactionLinks(
    {
      ...execution,
      status: "awaiting_signature",
      stage: "claim",
      stageNetwork: "base",
      sourceTxHash: null,
      destinationTxHash: null,
    },
    pending,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].href, `https://sepolia.basescan.org/tx/${swap}`);
  assert.deepEqual(transactionLinks(undefined, pending), []);
});

test("missing and malformed references never produce explorer links, and balance reads have none", () => {
  assert.deepEqual(
    transactionLinks({ ...execution, sourceTxHash: "javascript:alert(1)", destinationTxHash: "0x123" }),
    [],
  );
  assert.deepEqual(
    transactionLinks({
      ...execution,
      stageNetwork: "base",
      sourceTxHash: "0.0.1@1800000000.1",
      destinationTxHash: null,
    }),
    [],
  );
  assert.deepEqual(
    transactionLinks({
      ...execution,
      interpretation: { ...execution.interpretation, action: { kind: "balance", network: "hedera", asset: "HBAR" } },
    }),
    [],
  );
});
