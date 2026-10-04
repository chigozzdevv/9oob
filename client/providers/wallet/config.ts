import { hederaTestnet, baseSepolia } from "viem/chains";

const walletConfig = {
  targetNetworks: [hederaTestnet, baseSepolia] as const,

  rpcOverrides: {
    [hederaTestnet.id]: process.env.NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
    [baseSepolia.id]: process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://sepolia.base.org",
  },

  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID?.trim() || "",
} as const;

export default walletConfig;
