"use client";

import { normalizeNativeAddress, type NoobWallet } from "@9oob/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useWalletClient } from "wagmi";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { hederaNamespace, type HederaProvider } from "@hashgraph/hedera-wallet-connect";
import { memo, useEffect, useMemo } from "react";
import { sendNativeTransaction } from "~~/providers/wallet/native-signer";
import { initAppKit } from "~~/providers/wallet/appkit";
import { wagmiConfig } from "~~/providers/wallet/wagmi";
import walletConfig from "~~/providers/wallet/config";
import { synchronizeEvmNetwork } from "~~/providers/wallet/evm-network";
import type { WalletProviderProps } from "~~/providers/wallet/loader";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const WalletProvider = memo(function WalletProvider({ onChange }: WalletProviderProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletConnection onChange={onChange} />
      </QueryClientProvider>
    </WagmiProvider>
  );
});

function WalletConnection({ onChange }: WalletProviderProps) {
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
  const wallet = useMemo<NoobWallet>(
    () => ({
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
    }),
    [
      evm.isConnected,
      evm.address,
      evm.chainId,
      evm.status,
      evm.connector,
      accountId,
      supportedChain,
      isPending,
      client,
      clientMatches,
      provider,
    ],
  );
  useEffect(() => {
    onChange({ wallet, connectorId: evm.connector?.id });
  }, [wallet, evm.connector?.id, onChange]);
  return null;
}
