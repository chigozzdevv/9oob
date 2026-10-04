"use client";

import Link from "next/link";
import { NoobWordmark } from "@9oob/sdk";

export function Header({ address, manageWallet }: { address: string | null; manageWallet: () => void }) {
  return (
    <header className="app-header">
      <Link className="app-wordmark" href="/" aria-label="9oob home">
        <NoobWordmark />
      </Link>
      {address ? (
        <button className="app-wallet-button" type="button" onClick={manageWallet} aria-label="Manage wallet">
          {`${address.slice(0, 6)}…${address.slice(-4)}`}
        </button>
      ) : null}
    </header>
  );
}
