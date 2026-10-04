import assert from "node:assert/strict";
import test from "node:test";
import { formatTokenAmount, parseTokenAmount } from "../../src/shared/integration/amounts.js";

test("converts decimal token amounts to exact smallest units", () => {
  assert.equal(parseTokenAmount("1.00000001", 8), 100000001n);
  assert.equal(parseTokenAmount("0.000001", 6), 1n);
  assert.equal(parseTokenAmount("100", 0), 100n);
});

test("rejects zero, malformed, negative, over-precision, and unsafe decimal input", () => {
  for (const amount of ["0", "0.000", "-1", ".5", "1e6", " 1", "1.", "1.000000001"]) {
    assert.throws(() => parseTokenAmount(amount, 8), Error, amount);
  }
  assert.throws(() => parseTokenAmount("1", -1));
  assert.throws(() => parseTokenAmount("1", 101));
  assert.throws(() => parseTokenAmount("1.1", 0));
});

test("formats smallest units without floating point loss", () => {
  assert.equal(formatTokenAmount(100000001n, 8), "1.00000001");
  assert.equal(formatTokenAmount(1000000000000000001n, 18), "1.000000000000000001");
  assert.equal(formatTokenAmount(1200n, 3), "1.2");
});
