"use client";

import type { ReactNode } from "react";
import { ArrowRight, X } from "lucide-react";
import { useNoobRuntime } from "../runtime.js";
import type { NoobWallet } from "../wallet/wallet.js";
import { Clarification } from "./clarification.js";
import { AssistantMessage, Conversation } from "./conversation.js";
import { Journey } from "./journey.js";
import { Review } from "./review.js";
import { Loading } from "./loading.js";
import { NoobWordmark } from "./wordmark.js";
import { progressMessage } from "./presentation.js";

export type NoobProviderProps = { children: ReactNode; wallet: NoobWallet; endpoint?: string };

export function NoobProvider({ children, wallet, endpoint }: NoobProviderProps) {
  const {
    active,
    guide,
    update,
    close,
    revise,
    clarify,
    recover,
    continueRun,
    recoverReference,
    switchNetwork,
    connect,
  } = useNoobRuntime(wallet, endpoint);
  const loading = Boolean(active && !active.error && (!active.execution || active.execution.status === "interpreting"));
  const checkingWallet = active?.busy || guide?.state === "loading";
  return (
    <>
      {children}
      {active?.visible ? (
        <div
          className="noob-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) void close();
          }}
        >
          <section
            className="noob-modal"
            role="dialog"
            aria-modal="true"
            aria-label="9oob"
            data-wallet-chain-id={wallet.chainId}
            data-wallet-client-chain-id={wallet.evmClient?.chain.id}
            data-required-chain-id={guide?.chainId}
          >
            <header className="noob-chat-header">
              <button className="noob-close" onClick={() => void close()} aria-label="Close" type="button">
                <X size={18} />
              </button>
            </header>
            <Conversation active={active} update={update} revise={revise}>
              <AssistantMessage>
                {loading ? (
                  <Loading ariaLabel="Loading intent" />
                ) : active.execution?.status === "clarification_required" ? (
                  <p className="noob-message">{active.execution.interpretation.message}</p>
                ) : null}
                {active.execution?.status === "awaiting_wallet" ? (
                  <>
                    {checkingWallet ? (
                      <Loading ariaLabel={guide?.state === "loading" ? guide.message : "Checking account"} />
                    ) : (
                      <p className="noob-message">{guide?.message || "Preparing your review…"}</p>
                    )}
                    {guide?.state === "ready" && active.error ? (
                      <button
                        className="noob-primary"
                        onClick={() => {
                          void recover(active).then(() => update({ retryCreation: active.retryCreation + 1 }));
                        }}
                        type="button"
                        disabled={active.busy}
                      >
                        Try again
                      </button>
                    ) : null}
                  </>
                ) : active.execution?.status === "unsupported" ? (
                  <p className="noob-message">{active.execution.interpretation.message}</p>
                ) : null}
                <Review execution={active.execution} />
                {!active.pendingSubmission &&
                active.execution &&
                ["awaiting_wallet", "awaiting_approval", "approved", "awaiting_signature"].includes(
                  active.execution.status,
                ) &&
                guide &&
                guide.state !== "ready" ? (
                  <>
                    {active.execution.status !== "awaiting_wallet" ? (
                      guide.state === "loading" ? (
                        <Loading ariaLabel={guide.message} />
                      ) : (
                        <p className="noob-message">{guide.message}</p>
                      )
                    ) : null}
                    {!checkingWallet ? (
                      <button
                        className="noob-primary"
                        onClick={() => void (guide.state === "switch" ? switchNetwork() : connect())}
                        type="button"
                      >
                        {guide.label}
                        <ArrowRight size={16} />
                      </button>
                    ) : null}
                  </>
                ) : null}
                {active.execution &&
                !["interpreting", "awaiting_wallet", "clarification_required", "unsupported"].includes(
                  active.execution.status,
                ) ? (
                  <Journey
                    status={active.execution.status}
                    kind={active.execution.interpretation.action?.kind ?? "intent"}
                  />
                ) : null}
                {active.execution && ["submitted", "settling"].includes(active.execution.status) ? (
                  <Loading label={progressMessage(active.execution)} />
                ) : null}
                {active.busy &&
                guide?.state !== "loading" &&
                active.execution &&
                ["awaiting_approval", "approved", "awaiting_signature"].includes(active.execution.status) ? (
                  <Loading
                    label={active.execution.status === "awaiting_signature" ? "Continue in your wallet" : undefined}
                  />
                ) : null}
                {active.execution?.status === "cancelled" ? <p className="noob-message">Execution cancelled.</p> : null}
                {active.execution?.status === "failed" && !active.error && !active.execution.error ? (
                  <p className="noob-error" role="status">
                    This execution could not be completed.
                  </p>
                ) : null}
                {active.error || active.execution?.error ? (
                  <p className="noob-error" role="status">
                    {active.error ?? active.execution?.error}
                  </p>
                ) : null}
                {!active.execution && active.restoredId && active.error && !active.busy ? (
                  <button
                    className="noob-primary"
                    onClick={() => void recover(active)}
                    disabled={active.busy}
                    type="button"
                  >
                    Try again
                  </button>
                ) : null}
                {!active.execution && !active.restoredId && active.error ? (
                  <button
                    className="noob-primary"
                    onClick={() => update({ retryCreation: active.retryCreation + 1 })}
                    disabled={active.busy}
                    type="button"
                  >
                    Try again
                  </button>
                ) : null}
                {active.pendingSubmission && !active.pendingSubmission.txHash && !active.busy ? (
                  <>
                    <p className="noob-message">
                      Check your wallet history before continuing. If it sent the transaction, enter its reference to
                      recover progress.
                    </p>
                    <div className="noob-intent">
                      <textarea
                        value={active.transactionReference}
                        onChange={event => update({ transactionReference: event.target.value })}
                        maxLength={160}
                        rows={2}
                        aria-label="Wallet transaction reference"
                        placeholder="Transaction hash or Hedera transaction ID"
                      />
                    </div>
                    <button
                      className="noob-primary"
                      onClick={recoverReference}
                      disabled={!active.transactionReference.trim()}
                      type="button"
                    >
                      Recover transaction
                    </button>
                  </>
                ) : null}
                {active.pendingSubmission?.txHash && !active.busy ? (
                  <button className="noob-primary" onClick={() => void recover(active)} type="button">
                    Check progress
                  </button>
                ) : null}
                {!active.pendingSubmission &&
                active.execution &&
                !active.busy &&
                guide?.state === "ready" &&
                ["awaiting_approval", "approved"].includes(active.execution.status) ? (
                  <button className="noob-primary" onClick={continueRun} type="button">
                    {active.execution.status === "approved" ? "Continue" : "Approve and continue"}
                    <ArrowRight size={16} />
                  </button>
                ) : null}
                {!active.pendingSubmission &&
                active.execution?.status === "awaiting_signature" &&
                !active.busy &&
                guide?.state === "ready" ? (
                  <button className="noob-primary" onClick={continueRun} type="button">
                    {active.step?.kind === "approval" ? "Sign approval" : "Sign transaction"}
                    <ArrowRight size={16} />
                  </button>
                ) : null}
                {active.step?.label && active.execution?.status === "awaiting_signature" ? (
                  <p className="noob-step-label">{String(active.step.label)}</p>
                ) : null}
                {active.execution && ["completed", "failed", "cancelled"].includes(active.execution.status) ? (
                  <button className="noob-primary" onClick={() => void close()} type="button">
                    Done
                  </button>
                ) : null}
              </AssistantMessage>
            </Conversation>
            <Clarification active={active} update={update} clarify={clarify} />
            <footer className="noob-brand" aria-hidden="true">
              <NoobWordmark className="noob-brand-name" />
            </footer>
          </section>
        </div>
      ) : active ? (
        <button className="noob-minimized" onClick={() => update({ visible: true })} type="button">
          Continue chat
        </button>
      ) : null}
    </>
  );
}
