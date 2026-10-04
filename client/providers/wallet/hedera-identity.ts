export function extractIdentity(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("hedera:") || trimmed.startsWith("eip155:")) {
    return trimmed.split(":").pop() ?? trimmed;
  }
  return trimmed;
}

export function hederaCaipId(accountIdLike: string): string {
  if (accountIdLike.startsWith("hedera:") && !accountIdLike.startsWith("hedera:testnet:")) {
    throw new Error("Connect a Hedera testnet wallet for this action");
  }
  const accountId = extractIdentity(accountIdLike);
  if (!/^0\.0\.\d+$/.test(accountId)) throw new Error("Invalid Hedera account ID");
  return `hedera:testnet:${accountId}`;
}
