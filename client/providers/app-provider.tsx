"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { LoaderCircle } from "lucide-react";

const WalletProvider = dynamic(() => import("~~/providers/wallet-provider").then(module => module.WalletProvider), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading 9oob">
      <LoaderCircle className="noob-spin" size={20} />
    </div>
  ),
});

export function AppProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return children;
  return <WalletProvider>{children}</WalletProvider>;
}
