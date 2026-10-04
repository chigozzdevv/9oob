import assert from "node:assert/strict";
import test from "node:test";
import { SaucerSwapProvider } from "../../src/shared/integration/saucerswap/saucerswap.provider.js";

test(
  "quotes a real Hedera testnet HBAR to USDC swap without signing",
  { skip: process.env.NOOB_LIVE_PROVIDER_TESTS !== "1" },
  async () => {
    const review = await new SaucerSwapProvider().review({
      kind: "swap",
      sourceNetwork: "hedera",
      destinationNetwork: "hedera",
      sourceAsset: "HBAR",
      destinationAsset: "USDC",
      amount: "10",
      recipient: "0x0000000000000000000000000000000000000001",
    });
    assert.ok(BigInt(review.quote!.amountRaw) > 0n);
    assert.equal(review.quote!.amountDecimals, 6);
    assert.ok(review.facts.includes("Hedera testnet"));
  },
);
