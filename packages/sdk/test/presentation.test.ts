import assert from "node:assert/strict";
import test from "node:test";
import type { Execution } from "@9oob/schema";
import { reviewContent } from "../src/modal/presentation.js";

const execution: Execution = {
  id: "presentation",
  intent: "Swap HBAR to USDC on Base",
  status: "awaiting_approval",
  accountId: `0x${"1".repeat(40)}`,
  evmAddress: `0x${"1".repeat(40)}`,
  interpretation: {
    outcome: "ready",
    message: "",
    action: {
      kind: "swap",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "HBAR",
      destinationAsset: "USDC",
      amount: "10",
      recipient: `0x${"2".repeat(40)}`,
    },
    review: {
      title: "Swap 10 HBAR for 1.03 USDC",
      facts: [
        "From: HBAR on hedera testnet",
        "To: USD Coin on base testnet",
        `Wallet: 0x${"1".repeat(40)}`,
        `Recipient: 0x${"2".repeat(40)}`,
        "Quoted output: 1.03 USDC",
        "The final output depends on the solver fill",
      ],
      quote: { amountRaw: "1030000", amountDecimals: 6, amountSymbol: "USDC" },
    },
  },
  sourceTxHash: null,
  destinationTxHash: null,
  error: null,
  version: 0,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
};

test("review retains provider identities and warnings without inventing fees or minimum output", () => {
  const content = reviewContent(execution)!;
  assert.ok(content.rows.some(([label, value]) => label === "Wallet" && value === execution.evmAddress));
  assert.ok(content.rows.some(([label, value]) => label === "Recipient" && value === `0x${"2".repeat(40)}`));
  assert.ok(content.rows.some(([label, value]) => label === "From" && value === "HBAR on hedera testnet"));
  assert.deepEqual(content.notes, ["The final output depends on the solver fill"]);
  assert.equal(
    content.rows.some(([label]) => /fee|minimum/i.test(label)),
    false,
  );
});

test("large reviewed quote amounts retain precision when formatted for display", () => {
  const review = execution.interpretation.review!;
  const content = reviewContent({
    ...execution,
    interpretation: {
      ...execution.interpretation,
      review: { ...review, quote: { amountRaw: "123456789012345678901234", amountDecimals: 18, amountSymbol: "USDC" } },
    },
  })!;
  assert.ok(
    content.rows.some(([label, value]) => label === "You receive" && value === "≈ 123456.789012345678901234 USDC"),
  );
});

test("completed swaps do not claim the reviewed estimate as the amount received", () => {
  const content = reviewContent({ ...execution, status: "completed" })!;
  assert.equal(content.message, "Swap completed on Base.");
  assert.deepEqual(content.rows, []);
  assert.doesNotMatch(content.message!, /1\.03/);
});

test("completed balance reads display the actual result rather than a balance heading", () => {
  const content = reviewContent({
    ...execution,
    status: "completed",
    interpretation: {
      outcome: "ready",
      message: "",
      action: { kind: "balance", network: "base", asset: "ETH" },
      review: { title: "0.000000123456789 ETH", facts: ["Base Sepolia"], quote: null },
    },
  })!;
  assert.equal(content.message, "You have 0.000000123456789 ETH on Base.");
});

test("HTS transfer review displays the verified symbol and preserves its exact amount", () => {
  const content = reviewContent({
    ...execution,
    interpretation: {
      outcome: "ready",
      message: "",
      action: { kind: "transfer", network: "hedera", asset: "0.0.123", amount: "0.123456", recipient: "0.0.456" },
      review: { title: "Send 0.123456 USDC", facts: ["To: 0.0.456", "From: 0.0.789", "Hedera testnet"], quote: null },
    },
  })!;
  assert.deepEqual(content.rows, [
    ["Amount", "0.123456 USDC"],
    ["To", "0.0.456"],
    ["From", "0.0.789"],
    ["Network", "Hedera testnet"],
  ]);
});

test("a remaining bridge review shows received USDC instead of repeating the original HBAR amount", () => {
  const content = reviewContent({
    ...execution,
    stage: "bridge",
    stageNetwork: "hedera",
    stageAction: {
      kind: "bridge",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      amount: "21.95",
      recipient: `0x${"2".repeat(40)}`,
    },
    completedSteps: [{ stage: "swap", network: "hedera", txHash: `0x${"a".repeat(64)}`, amountRaw: "21950000" }],
    interpretation: {
      ...execution.interpretation,
      review: {
        title: "Bridge 21.95 USDC to USDC",
        facts: [],
        quote: { amountRaw: "21950000", amountDecimals: 6, amountSymbol: "USDC" },
      },
    },
  })!;
  assert.ok(content.rows.some(([label, value]) => label === "You send" && value === "21.95 USDC"));
  assert.ok(!content.rows.some(([, value]) => value === "10 HBAR"));
});
