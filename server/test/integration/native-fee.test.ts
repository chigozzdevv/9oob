import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildHederaTransfer } from "../../../packages/sdk/src/wallet/hedera.js";

test("the native runner serializes its fee cap across SDK module formats without signing", () => {
  const require = createRequire(new URL("../../../packages/sdk/package.json", import.meta.url));
  const sdk = require("@hiero-ledger/sdk");
  const { proto } = require("@hiero-ledger/proto");
  const transaction = buildHederaTransfer({
    network: "testnet",
    accountId: "0.0.1",
    recipient: "0.0.2",
    asset: "HBAR",
    amount: "1000000",
  })
    .setTransactionId(sdk.TransactionId.fromString("0.0.1@1000000000.000000001"))
    .setNodeAccountIds([sdk.AccountId.fromString("0.0.3")])
    .setMaxTransactionFee(0.5)
    .freeze();
  const list = proto.TransactionList.decode(transaction.toBytes());
  const signed = proto.SignedTransaction.decode(list.transactionList[0].signedTransactionBytes);
  const body = proto.TransactionBody.decode(signed.bodyBytes);
  assert.equal(body.transactionFee.toString(), "50000000");
  assert.equal(signed.sigMap.sigPair.length, 0);
  assert.deepEqual(
    body.cryptoTransfer.transfers.accountAmounts.map((row: { amount: { toString(): string } }) =>
      row.amount.toString(),
    ),
    ["-1000000", "1000000"],
  );
});
