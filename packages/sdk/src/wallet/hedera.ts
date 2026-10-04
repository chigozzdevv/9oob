export function normalizeNativeAddress(address: string | undefined): string | null {
  if (!address) return null;
  if (address.startsWith("hedera:") && !address.startsWith("hedera:testnet:")) return null;
  const last = address.split(":").at(-1) ?? address;
  return /^0\.0\.\d+$/.test(last) ? last : null;
}
