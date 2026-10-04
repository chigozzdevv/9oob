import { hederaCaipId } from "../providers/wallet/hedera-identity";
import assert from "node:assert/strict";
import test from "node:test";

test("native signing always uses the configured testnet route", () => {
  assert.equal(hederaCaipId("0.0.123"), "hedera:testnet:0.0.123");
  assert.equal(hederaCaipId("hedera:testnet:0.0.123"), "hedera:testnet:0.0.123");
  assert.throws(() => hederaCaipId("hedera:mainnet:0.0.123"), /testnet/);
  assert.throws(() => hederaCaipId("0x123"), /Invalid/);
});
