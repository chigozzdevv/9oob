export const TESTNET = {
  hedera: { chainId: 296, name: "Hedera testnet", eid: 40285, rpc: "https://testnet.hashio.io/api" },
  base: { chainId: 84532, name: "Base Sepolia", eid: 40245, rpc: "https://sepolia.base.org" },
} as const;

export const TESTNET_TOKENS = {
  hederaUsdc: "0.0.5449",
  hederaSauce: "0.0.1183558",
  hederaWhbar: "0.0.15058",
  baseUsdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;
