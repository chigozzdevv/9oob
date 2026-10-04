"use client";

import { NoobProvider, normalizeNativeAddress, type NoobWallet } from "@9oob/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useWalletClient } from "wagmi";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { hederaNamespace, type HederaProvider } from "@hashgraph/hedera-wallet-connect";
import { useEffect } from "react";
import { Header } from "~~/components/header";
import { sendNativeTransaction } from "~~/providers/wallet/native-signer";
import { initAppKit } from "~~/providers/wallet/appkit";
import { wagmiConfig } from "~~/providers/wallet/wagmi";
import walletConfig from "~~/providers/wallet/config";
import { synchronizeEvmNetwork } from "~~/providers/wallet/evm-network";

const AppShell = ({
  children,
  wallet,
  connectorId,
}: {
  children: React.ReactNode;
  wallet: NoobWallet;
  connectorId?: string;
}) => {
  return (
    <>
      <div className="app-shell flex flex-col min-h-screen" data-wallet-connector={connectorId}>
        <Header address={wallet.accountId} manageWallet={() => void wallet.connect()} />
        <main className="relative flex flex-col flex-1">{children}</main>
      </div>
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NoobWalletProvider>{children}</NoobWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

function NoobWalletProvider({ children }: { children: React.ReactNode }) {
  const native = useAppKitAccount({ namespace: hederaNamespace });
  const { walletProvider: provider } = useAppKitProvider<HederaProvider>(hederaNamespace);
  const evm = useAccount();
  const { data: client, isPending } = useWalletClient({ chainId: evm.chainId, connector: evm.connector });
  useEffect(() => {
    void initAppKit().catch(() => undefined);
  }, []);
  useEffect(() => {
    const connector = evm.connector;
    if (!evm.isConnected || !connector) return;
    let disposed = false;
    let checking = false;
    const synchronize = async () => {
      if (disposed || checking) return;
      checking = true;
      try {
        await synchronizeEvmNetwork(
          {
            getChainId: () => connector.getChainId(),
            onChainChanged: chainId => {
              if (!disposed) connector.onChainChanged(chainId);
            },
          },
          evm.chainId,
        );
      } catch {
        return;
      } finally {
        checking = false;
      }
    };
    void synchronize();
    const onFocus = () => {
      void synchronize();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [evm.isConnected, evm.connector, evm.chainId]);
  const nativeAccount = normalizeNativeAddress(native.address);
  const nativeReady =
    native.isConnected &&
    nativeAccount &&
    provider?.nativeProvider &&
    provider.session?.namespaces.hedera?.accounts.some(account => account === `hedera:testnet:${nativeAccount}`);
  const accountId = nativeReady ? nativeAccount : null;
  const clientMatches =
    client &&
    client.chain &&
    client.account.address.toLowerCase() === evm.address?.toLowerCase() &&
    client.chain.id === evm.chainId;
  const supportedChain = walletConfig.targetNetworks.some(network => network.id === evm.chainId);
  const wallet: NoobWallet = {
    accountId: evm.isConnected ? (evm.address ?? null) : accountId,
    nativeAccountId: accountId,
    evmAddress: evm.isConnected ? (evm.address ?? null) : null,
    chainId: evm.isConnected ? evm.chainId : undefined,
    isConnecting:
      evm.status === "connecting" ||
      evm.status === "reconnecting" ||
      (evm.isConnected && supportedChain && (isPending || Boolean(client && !clientMatches))),
    connect: async requirement => {
      const kit = await initAppKit();
      const namespace = requirement?.kind === "native" ? hederaNamespace : "eip155";
      return kit.open({ view: requirement ? "Connect" : undefined, namespace });
    },
    nativeSend: transaction => sendNativeTransaction(provider ?? null, accountId, transaction),
    evmClient: clientMatches
      ? { chain: client.chain, sendTransaction: transaction => client.sendTransaction(transaction) }
      : undefined,
    switchChain: async chainId => {
      const network = walletConfig.targetNetworks.find(network => network.id === chainId);
      if (!network) throw new Error("This testnet network is not supported");
      if (!evm.connector) throw new Error("Connect your wallet before switching networks");
      if ((await synchronizeEvmNetwork(evm.connector, evm.chainId)) === chainId) return;
      const kit = await initAppKit();
      await kit.switchNetwork(network, { throwOnFailure: true });
      if ((await synchronizeEvmNetwork(evm.connector, evm.chainId)) !== chainId)
        throw new Error(`The wallet has not switched to ${network.name}. Check your wallet and try again.`);
    },
  };
  return (
    <NoobProvider wallet={wallet}>
      <AppShell wallet={wallet} connectorId={evm.connector?.id}>
        {children}
      </AppShell>
    </NoobProvider>
  );
}
