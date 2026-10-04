import { evmNetworks, wagmiAdapter } from "~~/providers/wallet/wagmi";
import {
  HederaChainDefinition,
  HederaProvider,
  hederaNamespace,
  createNamespaces,
} from "@hashgraph/hedera-wallet-connect";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import type UniversalProvider from "@walletconnect/universal-provider";
import walletConfig from "~~/providers/wallet/config";
import { NativeHederaAdapter } from "~~/providers/wallet/hedera-adapter";

const projectId = walletConfig.walletConnectProjectId;
const metadata = {
  name: "9oob",
  description: "Natural-language actions for Hedera and connected networks",
  url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
  icons: [],
};

const nativeNetworks = [HederaChainDefinition.Native.Testnet] as const;
let provider: HederaProvider | null = null;
let initialization: Promise<ReturnType<typeof createAppKit>> | null = null;

async function getHederaProvider(): Promise<HederaProvider> {
  if (!projectId) throw new Error("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is required to connect wallets");
  if (!provider) {
    const options = {
      projectId,
      metadata,
      // HederaProvider restores its signers from initialization namespaces.
      optionalNamespaces: createNamespaces([
        ...nativeNetworks,
        HederaChainDefinition.EVM.Testnet,
        { ...evmNetworks[1], chainNamespace: "eip155", caipNetworkId: "eip155:84532" },
      ]),
    };
    provider = await HederaProvider.init(options);
  }
  return provider;
}

async function createWalletKit() {
  if (!projectId || !wagmiAdapter)
    throw new Error("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is required to connect wallets");
  const hederaProvider = await getHederaProvider();
  const nativeAdapter = new NativeHederaAdapter({
    projectId,
    networks: [...nativeNetworks],
    namespace: hederaNamespace,
  });
  const networks = [...evmNetworks, ...nativeNetworks] as [AppKitNetwork, ...AppKitNetwork[]];
  return createAppKit({
    adapters: [wagmiAdapter, nativeAdapter],
    universalProvider: hederaProvider as unknown as UniversalProvider,
    projectId,
    metadata,
    networks,
    allowUnsupportedChain: true,
    features: { email: false, socials: false, swaps: false, onramp: false, send: false },
    defaultNetwork: evmNetworks[0],
    themeMode: "light",
    themeVariables: { "--w3m-accent": "#111217", "--w3m-border-radius-master": "2px" },
  });
}

export function initAppKit() {
  initialization ??= createWalletKit().catch(error => {
    initialization = null;
    throw error;
  });
  return initialization;
}
