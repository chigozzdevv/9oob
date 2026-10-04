export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 100) {
    throw new Error("Invalid token amount or decimal precision");
  }
  const [whole, fractional = ""] = value.split(".");
  if (fractional.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractional.padEnd(decimals, "0") || "0");
  if (amount === 0n) throw new Error("Amount must be greater than zero");
  return amount;
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fractional = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole;
}
