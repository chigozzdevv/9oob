import type { Connector } from "wagmi";

export async function synchronizeEvmNetwork(
  connector: Pick<Connector, "getChainId" | "onChainChanged">,
  reportedChainId?: number,
): Promise<number> {
  const chainId = await connector.getChainId();
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("The wallet returned an invalid network");
  if (chainId !== reportedChainId) connector.onChainChanged(`0x${chainId.toString(16)}`);
  return chainId;
}
