"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NoobProvider } from "@9oob/sdk";
import { Header } from "~~/components/header";
import { createWalletLoader, type WalletConnection, type WalletProviderProps } from "~~/providers/wallet/loader";

export function AppProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return children;
  return <ExecutionProvider>{children}</ExecutionProvider>;
}

function ExecutionProvider({ children }: { children: ReactNode }) {
  const [WalletProvider, setWalletProvider] = useState<ComponentType<WalletProviderProps> | null>(null);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const mounted = useRef(true);
  const loader = useMemo(
    () =>
      createWalletLoader(
        async () => {
          setLoadFailed(false);
          const walletRuntime = await import("~~/providers/wallet-provider");
          if (mounted.current) setWalletProvider(() => walletRuntime.WalletProvider);
        },
        () => {
          if (mounted.current) setLoadFailed(true);
        },
      ),
    [],
  );
  const onChange = useCallback(
    (next: WalletConnection) => {
      loader.publish(next.wallet);
      setConnection(next);
    },
    [loader],
  );

  useEffect(() => {
    mounted.current = true;
    const preload = () => void loader.load().catch(() => undefined);
    const idle = window.requestIdleCallback?.(preload, { timeout: 500 });
    const timer = idle === undefined ? window.setTimeout(preload, 0) : undefined;
    return () => {
      mounted.current = false;
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
      loader.dispose();
    };
  }, [loader]);

  const wallet = connection?.wallet ?? { ...loader.wallet, isConnecting: !loadFailed };
  return (
    <NoobProvider wallet={wallet}>
      <div className="app-shell flex flex-col min-h-screen" data-wallet-connector={connection?.connectorId}>
        <Header address={wallet.accountId} manageWallet={() => void wallet.connect()} />
        <main className="relative flex flex-col flex-1">{children}</main>
      </div>
      {WalletProvider ? <WalletProvider onChange={onChange} /> : null}
    </NoobProvider>
  );
}
