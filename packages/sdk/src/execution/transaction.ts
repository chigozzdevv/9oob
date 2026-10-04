export function isUnsubmittedWalletError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as { code?: unknown; name?: string; cause?: unknown };
    if (
      value.code === 4001 ||
      value.code === 5000 ||
      value.name === "UserRejectedRequestError" ||
      value.name === "CapabilityError" ||
      value.name === "WalletUnavailableError"
    )
      return true;
    current = value.cause;
  }
  return false;
}

export function isValidTransactionReference(network: "hedera" | "evm", value: string): boolean {
  return network === "hedera" ? /^0\.0\.\d{1,10}@\d+\.\d{1,9}$/.test(value) : /^0x[a-fA-F0-9]{64}$/.test(value);
}
