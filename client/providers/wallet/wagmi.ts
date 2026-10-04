import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { baseSepolia, hederaTestnet } from "viem/chains";
import { createConfig, http, injected } from "wagmi";
import walletConfig from "~~/providers/wallet/config";

export const evmNetworks = walletConfig.targetNetworks;
const projectId = walletConfig.walletConnectProjectId;
const transports = {
  [hederaTestnet.id]: http(walletConfig.rpcOverrides[hederaTestnet.id]),
  [baseSepolia.id]: http(walletConfig.rpcOverrides[baseSepolia.id]),
};

export const wagmiAdapter = projectId
  ? new WagmiAdapter({ projectId, networks: [...evmNetworks], transports })
  : undefined;

export const wagmiConfig =
  wagmiAdapter?.wagmiConfig ??
  createConfig({
    chains: [...evmNetworks],
    connectors: [injected()],
    transports,
  });
