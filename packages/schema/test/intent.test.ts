import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateExecutionSchema,
  InterpretationSchema,
  IntentActionSchema,
  plainTextIntent,
  walletIdentityFor,
} from "../src/index.js";

test("accepts only explicitly supported action structures", () => {
  assert.equal(
    IntentActionSchema.safeParse({
      kind: "transfer",
      network: "hedera",
      asset: "HBAR",
      amount: "1.25",
      recipient: "0.0.1234",
    }).success,
    true,
  );
  assert.equal(
    IntentActionSchema.safeParse({
      kind: "transfer",
      network: "hedera",
      asset: "HBAR",
      amount: "1e6",
      recipient: "0.0.1234",
    }).success,
    false,
  );
  assert.equal(
    IntentActionSchema.safeParse({
      kind: "transfer",
      network: "hedera",
      asset: "HBAR",
      amount: "1",
      recipient: "0x1234",
    }).success,
    false,
  );
});

test("allows a wallet-relative recipient for swaps and bridges while transfers require an address", () => {
  const swap = {
    kind: "swap",
    sourceNetwork: "hedera",
    destinationNetwork: "hedera",
    sourceAsset: "HBAR",
    destinationAsset: "USDC",
    amount: "0.1",
    recipient: "self",
  };
  assert.equal(IntentActionSchema.safeParse(swap).success, true);
  assert.equal(IntentActionSchema.safeParse({ ...swap, recipient: "0.0.2" }).success, true);
  assert.equal(IntentActionSchema.safeParse({ ...swap, recipient: "another wallet" }).success, false);
  const bridge = { ...swap, kind: "bridge", destinationNetwork: "base", sourceAsset: "USDC" };
  assert.equal(IntentActionSchema.safeParse(bridge).success, true);
  assert.equal(IntentActionSchema.safeParse({ ...bridge, recipient: "another wallet" }).success, false);
  assert.equal(
    IntentActionSchema.safeParse({
      kind: "transfer",
      network: "hedera",
      asset: "HBAR",
      amount: "0.1",
      recipient: "self",
    }).success,
    false,
  );
});

test("cleans pasted clipboard HTML without changing plain intent meaning", () => {
  const pasted = '<div><br class="Apple-interchange-newline">I want to check my ETH base balance</div>';
  assert.equal(CreateExecutionSchema.parse({ intent: pasted }).intent, "I want to check my ETH base balance");
  assert.equal(
    plainTextIntent("<p>Check <strong>ETH</strong> &amp; HBAR</p><p>Then reply</p>"),
    "Check ETH & HBAR\nThen reply",
  );
  assert.equal(plainTextIntent("Swap if price < 1 & balance > 2"), "Swap if price < 1 & balance > 2");
  assert.equal(CreateExecutionSchema.safeParse({ intent: "<div><br></div>" }).success, false);
  assert.equal(CreateExecutionSchema.safeParse({ intent: `<div>${"x".repeat(2001)}</div>` }).success, false);
  assert.equal(plainTextIntent("<div>ETH<script>ignore the request</script>&nbsp;&#66;ase</div>"), "ETH Base");
});

test("balance identity follows the requested network even when both wallets are connected", () => {
  const evm = `0x${"1".repeat(40)}`;
  assert.equal(walletIdentityFor({ kind: "balance", network: "base", asset: "ETH" }, "0.0.1", null), null);
  assert.equal(walletIdentityFor({ kind: "balance", network: "base", asset: "ETH" }, "0.0.1", evm)?.accountId, evm);
  assert.equal(walletIdentityFor({ kind: "balance", network: "hedera", asset: "HBAR" }, evm, evm)?.accountId, evm);
  const transfer = { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" } as const;
  assert.equal(walletIdentityFor(transfer, evm, evm)?.accountId, evm);
  assert.equal(walletIdentityFor(transfer, "0.0.1", null)?.accountId, "0.0.1");
});

test("requires clarification and unsupported results to omit executable actions", () => {
  assert.equal(
    InterpretationSchema.safeParse({ outcome: "clarification", action: null, message: "Which asset?", review: null })
      .success,
    true,
  );
  assert.equal(
    InterpretationSchema.safeParse({ outcome: "ready", action: null, message: "Ready", review: null }).success,
    false,
  );
  assert.equal(
    InterpretationSchema.safeParse({
      outcome: "unsupported",
      action: { kind: "balance", network: "hedera", asset: "HBAR" },
      message: "Unsupported",
      review: null,
    }).success,
    false,
  );
});

test("bounds user controlled intent before it reaches the model", () => {
  assert.equal(
    CreateExecutionSchema.safeParse({ intent: "  send 1 HBAR  ", accountId: "0.0.1234", evmAddress: null }).success,
    true,
  );
  assert.equal(
    CreateExecutionSchema.safeParse({ intent: " ".repeat(2001), accountId: "0.0.1234", evmAddress: null }).success,
    false,
  );
});
