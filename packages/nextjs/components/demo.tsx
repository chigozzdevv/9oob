"use client";

import { useEffect, useRef, useState } from "react";
import { LiquiditySnapshotSchema, type LiquiditySnapshot } from "@9oob/schema";
import { ChevronDown, LoaderCircle, ExternalLink } from "lucide-react";
import { IntentInput } from "~~/components/intent-input";

const examples = [
  { label: "Balance", intent: "Check my HBAR balance on Hedera Testnet" },
  { label: "Transfer", intent: "Send 0.01 HBAR on Hedera Testnet" },
  { label: "Swap", intent: "Swap 0.1 HBAR for USDC on Hedera Testnet" },
  { label: "Bridge", intent: "Bridge 0.1 USDC from Hedera Testnet to Base Sepolia" },
  { label: "Cross-chain swap", intent: "Swap 0.1 HBAR on Hedera Testnet for USDC on Base Sepolia" },
];

export function Demo() {
  const [snapshot, setSnapshot] = useState<LiquiditySnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const funding = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = funding.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      const menu = funding.current;
      if (event.key !== "Escape" || !menu?.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/noob/liquidity", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Pool balances unavailable");
        const data = LiquiditySnapshotSchema.parse(await response.json());
        if (active) {
          setSnapshot(data);
          setUnavailable(false);
        }
      } catch {
        if (active) {
          setSnapshot(null);
          setUnavailable(true);
        }
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="demo-shell">
      <div className="demo-toolbar">
        <span className="demo-network" title="Hedera Testnet · Base Sepolia">
          Testnet · Hedera + Base
        </span>
        <details className="demo-funding" ref={funding}>
          <summary>
            Get test tokens <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="demo-funding-panel">
            <a href="https://portal.hedera.com/faucet" target="_blank" rel="noreferrer">
              Hedera HBAR <ExternalLink size={13} />
            </a>
            <a href="https://docs.base.org/get-started/get-funds" target="_blank" rel="noreferrer">
              Base Sepolia ETH <ExternalLink size={13} />
            </a>
            <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
              Base Sepolia USDC <ExternalLink size={13} />
            </a>
            <p>For Hedera USDC, swap HBAR.</p>
          </div>
        </details>
      </div>
      <IntentInput examples={examples} />
      <div className="demo-pools" aria-live="polite">
        <span>Bridge pools</span>
        {snapshot ? (
          snapshot.pools.map(pool => (
            <span key={pool.network}>
              {pool.network === "hedera" ? "Hedera" : "Base"} <strong>{pool.availableUSDC} USDC</strong>
              {pool.paused ? " · Paused" : ""}
            </span>
          ))
        ) : unavailable ? (
          <span>Live balances unavailable</span>
        ) : (
          <LoaderCircle className="noob-spin" size={14} aria-label="Loading pool balances" />
        )}
      </div>
    </section>
  );
}
