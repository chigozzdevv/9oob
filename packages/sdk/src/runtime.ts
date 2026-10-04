"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Execution,
  type ExecutionState,
  errorMessage as messageOf,
  isTerminalExecution as terminal,
  walletIdentityFor,
  IntentTextSchema,
} from "@9oob/schema";
import { type ActiveRun, type PendingSubmission, clearSession, readSession, saveSession } from "./execution/session.js";
import { isUnsubmittedWalletError, isValidTransactionReference } from "./execution/transaction.js";
import { prepareApprovedExecution } from "./execution/approval.js";
import { type NoobRequest, subscribeToNoobRequests, delay } from "./transport/events.js";
import { createHttpTransport } from "./transport/http.js";
import { type NoobWallet, walletSender } from "./wallet/wallet.js";
import { walletGuide } from "./wallet/guide.js";

export function useNoobRuntime(wallet: NoobWallet, endpoint = "/api/noob") {
  const apiCall = useMemo(() => createHttpTransport(endpoint), [endpoint]);
  const [active, setActive] = useState<ActiveRun | null>(null);
  const activeRef = useRef<ActiveRun | null>(null);
  const restoredRef = useRef(false);
  const sequenceRef = useRef(0);
  const operationRef = useRef(false);
  const networkSwitchRef = useRef<{ key: number; chainId: number; complete: () => void; error?: string } | null>(null);
  const advanceRef = useRef<((execution: Execution, token: string) => Promise<void>) | null>(null);
  const { accountId, evmAddress } = wallet;
  const hasEvmClient = Boolean(wallet.evmClient);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const update = useCallback((patch: Partial<ActiveRun>, key?: number) => {
    const current = activeRef.current;
    if (!current || (key !== undefined && current.key !== key)) return;
    const next = { ...current, ...patch };
    activeRef.current = next;
    setActive(next);
  }, []);

  const persist = useCallback((run: ActiveRun) => {
    const id = run.execution?.id ?? run.restoredId;
    if (!id || !run.accessToken) throw new Error("Execution recovery information is missing");
    saveSession(sessionStorage, {
      id,
      accessToken: run.accessToken,
      intent: run.intent,
      pendingSubmission: run.pendingSubmission,
    });
  }, []);

  const applyState = useCallback(
    (state: ExecutionState, key: number) => {
      const current = activeRef.current;
      if (!current || current.key !== key || (current.execution && state.execution.version < current.execution.version))
        return;
      update(
        {
          execution: state.execution,
          restoredId: undefined,
          step: state.step,
          intent: state.execution.intent,
          editedIntent: state.execution.intent,
          busy: false,
          pendingClarification: undefined,
          error: undefined,
        },
        key,
      );
      if (terminal(state.execution) && !current.settled) {
        update({ settled: true, pendingSubmission: undefined }, key);
        clearSession();
        current.resolve(state.execution);
      }
    },
    [update],
  );

  const registerPending = useCallback(
    async (run: ActiveRun): Promise<Execution | null> => {
      const id = run.execution?.id ?? run.restoredId;
      const pending = run.pendingSubmission;
      if (!id || !run.accessToken || !pending?.txHash) return null;
      const result = await apiCall<ExecutionState>(`/executions/${id}/submitted`, run.accessToken, {
        method: "POST",
        body: JSON.stringify({
          txHash: pending.txHash,
          preparationVersion: pending.preparationVersion,
        }),
      });
      if (activeRef.current?.key !== run.key) return null;
      update({ pendingSubmission: undefined, busy: false }, run.key);
      applyState(result, run.key);
      const current = activeRef.current!;
      if (current.execution && !terminal(current.execution)) persist(current);
      return current.execution ?? result.execution;
    },
    [applyState, persist, update, apiCall],
  );

  const recover = useCallback(
    async (run: ActiveRun) => {
      const id = run.execution?.id ?? run.restoredId;
      if (!id || !run.accessToken || operationRef.current) return;
      operationRef.current = true;
      update({ busy: true, error: undefined }, run.key);
      try {
        if (run.pendingSubmission?.txHash) await registerPending(run);
        const state = await apiCall<ExecutionState>(`/executions/${id}`, run.accessToken);
        applyState(state, run.key);
      } catch (error) {
        update({ busy: false, error: messageOf(error) }, run.key);
      } finally {
        operationRef.current = false;
      }
    },
    [applyState, registerPending, update, apiCall],
  );

  const close = useCallback(async () => {
    const current = activeRef.current;
    if (!current) return;
    if (
      current.pendingSubmission ||
      (current.busy && current.execution) ||
      (current.restoredId && !current.execution)
    ) {
      update({ visible: false }, current.key);
      return;
    }
    if (!current.execution) {
      activeRef.current = null;
      setActive(null);
      current.reject(new Error("Execution cancelled before submission"));
      return;
    }
    if (terminal(current.execution)) {
      clearSession();
      activeRef.current = null;
      setActive(null);
      return;
    }
    if (
      current.accessToken &&
      ["awaiting_wallet", "awaiting_approval", "clarification_required", "unsupported", "approved"].includes(
        current.execution.status,
      )
    ) {
      update({ busy: true }, current.key);
      try {
        const cancelled = await apiCall<ExecutionState>(
          `/executions/${current.execution.id}/cancel`,
          current.accessToken,
          { method: "POST" },
        );
        applyState(cancelled, current.key);
        if (activeRef.current?.key === current.key) {
          activeRef.current = null;
          setActive(null);
        }
      } catch (error) {
        update({ busy: false, error: messageOf(error) }, current.key);
      }
      return;
    }
    update({ visible: false }, current.key);
  }, [applyState, update, apiCall]);

  const accept = useCallback((request: NoobRequest) => {
    if (activeRef.current) {
      request.reject(new Error("Finish or close the active 9oob execution before starting another"));
      return;
    }
    const run: ActiveRun = {
      key: ++sequenceRef.current,
      intent: request.intent,
      editedIntent: request.intent,
      clarificationReply: "",
      resolve: request.resolve,
      reject: request.reject,
      retryCreation: 0,
      transactionReference: "",
      settled: false,
      busy: false,
      editing: false,
      visible: true,
    };
    activeRef.current = run;
    setActive(run);
  }, []);

  useEffect(() => subscribeToNoobRequests(accept), [accept]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let stored;
    try {
      stored = readSession(sessionStorage);
    } catch {
      return;
    }
    if (!stored) return;
    const run: ActiveRun = {
      key: ++sequenceRef.current,
      intent: stored.intent ?? "",
      editedIntent: stored.intent ?? "",
      clarificationReply: "",
      resolve: () => undefined,
      reject: () => undefined,
      restoredId: stored.id,
      accessToken: stored.accessToken,
      pendingSubmission: stored.pendingSubmission,
      retryCreation: 0,
      transactionReference: "",
      settled: false,
      busy: false,
      editing: false,
      visible: true,
    };
    activeRef.current = run;
    setActive(run);
    void recover(run);
  }, [recover]);

  const signPrepared = useCallback(
    async (execution: Execution, accessToken: string, step: Record<string, unknown>) => {
      const run = activeRef.current;
      if (!run || run.pendingSubmission) return;
      let attempted = false;
      update({ busy: true, error: undefined }, run.key);
      try {
        const network = step.kind === "hedera-transfer" ? "hedera" : "evm";
        if (walletGuide(execution, walletRef.current, step)?.state !== "ready") {
          update({ busy: false }, run.key);
          return;
        }
        const send = await walletSender(step, walletRef.current);
        if (activeRef.current?.key !== run.key) return;
        if (walletGuide(execution, walletRef.current, step)?.state !== "ready") {
          update({ busy: false }, run.key);
          return;
        }
        const pendingSubmission: PendingSubmission = {
          preparationVersion: execution.version,
          network,
        };
        persist({ ...run, execution, accessToken, pendingSubmission });
        update({ pendingSubmission }, run.key);
        attempted = true;
        const txHash = await send();
        update({ pendingSubmission: { ...pendingSubmission, txHash } }, run.key);
        persist(activeRef.current!);
        await registerPending(activeRef.current!);
      } catch (error) {
        if (attempted && isUnsubmittedWalletError(error) && !activeRef.current?.pendingSubmission?.txHash) {
          update({ pendingSubmission: undefined }, run.key);
          persist(activeRef.current!);
        }
        update({ busy: false, error: messageOf(error) }, run.key);
      }
    },
    [persist, registerPending, update],
  );

  const advance = useCallback(
    async (execution: Execution, accessToken: string) => {
      const run = activeRef.current;
      if (!run || operationRef.current || run.pendingSubmission || terminal(execution)) return;
      if (
        execution.interpretation.action?.kind !== "balance" &&
        walletGuide(execution, walletRef.current, run.step)?.state !== "ready"
      )
        return;
      operationRef.current = true;
      update({ busy: true, error: undefined }, run.key);
      try {
        const prepared = await prepareApprovedExecution(execution, accessToken, apiCall, ready =>
          update({ execution: ready }, run.key),
        );
        applyState(prepared, run.key);
        if (terminal(prepared.execution) || prepared.step?.kind === "error") return;
        if (!prepared.step) throw new Error("The wallet transaction could not be prepared");
        await signPrepared(prepared.execution, accessToken, prepared.step);
      } catch (error) {
        update({ busy: false, error: messageOf(error) }, run.key);
      } finally {
        operationRef.current = false;
      }
    },
    [applyState, signPrepared, update, apiCall],
  );
  advanceRef.current = advance;

  useEffect(() => {
    const run = activeRef.current;
    if (!run || run.execution || run.restoredId) return;
    const { accountId, evmAddress } = walletRef.current;
    let disposed = false;
    const controller = new AbortController();
    update({ busy: true, error: undefined }, run.key);
    void apiCall<ExecutionState & { accessToken: string }>("/executions", undefined, {
      method: "POST",
      body: JSON.stringify({ intent: run.intent, accountId, evmAddress }),
      signal: controller.signal,
    })
      .then(result => {
        if (disposed || activeRef.current?.key !== run.key) return;
        update(
          {
            execution: result.execution,
            accessToken: result.accessToken,
            busy: false,
          },
          run.key,
        );
        persist(activeRef.current!);
        if (result.execution.status === "approved") void advanceRef.current?.(result.execution, result.accessToken);
      })
      .catch(error => {
        if (!disposed) update({ busy: false, error: messageOf(error) }, run.key);
      });
    return () => {
      disposed = true;
      controller.abort();
      if (activeRef.current?.key === run.key && !activeRef.current.execution) update({ busy: false }, run.key);
    };
  }, [active?.key, active?.intent, active?.retryCreation, persist, update, apiCall]);

  useEffect(() => {
    const run = activeRef.current;
    if (!run?.execution || run.execution.status !== "awaiting_wallet" || !run.accessToken || run.busy) return;
    const action = run.execution.interpretation.action;
    const guide = walletGuide(run.execution, walletRef.current);
    if (!action || !guide || ["connect", "loading"].includes(guide.state)) return;
    const identity = walletIdentityFor(action, accountId, evmAddress);
    if (!identity) return;
    update({ busy: true, error: undefined }, run.key);
    void apiCall<ExecutionState>(`/executions/${run.execution.id}/wallet`, run.accessToken, {
      method: "POST",
      body: JSON.stringify(identity),
    })
      .then(state => {
        if (activeRef.current?.key !== run.key) return;
        applyState(state, run.key);
        persist(activeRef.current!);
        if (state.execution.status === "approved") void advanceRef.current?.(state.execution, run.accessToken!);
      })
      .catch(error => {
        update({ busy: false, error: messageOf(error) }, run.key);
      });
  }, [
    active?.key,
    active?.execution?.status,
    active?.execution?.interpretation.action,
    active?.accessToken,
    active?.retryCreation,
    accountId,
    evmAddress,
    hasEvmClient,
    wallet.chainId,
    wallet.isConnecting,
    apiCall,
    applyState,
    persist,
    update,
  ]);

  useEffect(() => {
    const run = activeRef.current;
    if (
      !run ||
      run.busy ||
      !run.accessToken ||
      !run.execution ||
      (!run.pendingSubmission?.txHash && !["submitted", "settling"].includes(run.execution.status))
    )
      return;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        await delay(2500);
        if (stopped) return;
        try {
          if (run.pendingSubmission?.txHash) {
            await registerPending(run);
            return;
          }
          const state = await apiCall<ExecutionState>(`/executions/${run.execution!.id}`, run.accessToken);
          if (stopped) return;
          applyState(state, run.key);
          if (terminal(state.execution) || state.execution.status === "approved") return;
        } catch {
          if (!stopped)
            update(
              {
                error: run.pendingSubmission?.txHash
                  ? "Transaction sent. Retrying progress registration…"
                  : "Checking progress…",
              },
              run.key,
            );
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [
    active?.key,
    active?.execution?.id,
    active?.execution?.status,
    active?.accessToken,
    active?.pendingSubmission?.txHash,
    active?.busy,
    applyState,
    registerPending,
    update,
    apiCall,
  ]);

  const revise = useCallback(async () => {
    const run = activeRef.current;
    if (!run || run.busy || run.pendingSubmission || run.editedIntent.trim() === run.intent.trim()) return;
    const parsed = IntentTextSchema.safeParse(run.editedIntent);
    if (!parsed.success) {
      update({ error: "Intent must contain 1 to 2,000 characters" }, run.key);
      return;
    }
    if (!run.execution) {
      update({ intent: parsed.data, editing: false, error: undefined }, run.key);
      return;
    }
    if (!run.accessToken) return;
    update({ busy: true, error: undefined }, run.key);
    try {
      const state = await apiCall<ExecutionState>(`/executions/${run.execution.id}`, run.accessToken, {
        method: "PATCH",
        body: JSON.stringify({ intent: parsed.data }),
      });
      applyState(state, run.key);
      update({ editing: false, clarificationReply: "" }, run.key);
      if (activeRef.current?.key === run.key && !terminal(state.execution)) persist(activeRef.current);
      if (state.execution.status === "approved") void advance(state.execution, run.accessToken);
    } catch (error) {
      update({ busy: false, error: messageOf(error) }, run.key);
    }
  }, [advance, applyState, persist, update, apiCall]);

  const clarify = useCallback(async () => {
    const run = activeRef.current;
    if (
      !run?.execution ||
      run.execution.status !== "clarification_required" ||
      !run.accessToken ||
      run.busy ||
      run.pendingSubmission
    )
      return;
    const parsed = IntentTextSchema.safeParse(run.clarificationReply);
    if (!parsed.success) {
      update({ error: "Reply must contain 1 to 2,000 characters" }, run.key);
      return;
    }
    update({ busy: true, error: undefined, pendingClarification: parsed.data }, run.key);
    try {
      const state = await apiCall<ExecutionState>(`/executions/${run.execution.id}/clarify`, run.accessToken, {
        method: "POST",
        body: JSON.stringify({ answer: parsed.data, version: run.execution.version }),
      });
      applyState(state, run.key);
      update({ clarificationReply: "" }, run.key);
      if (activeRef.current?.key === run.key && !terminal(state.execution)) persist(activeRef.current);
      if (state.execution.status === "approved") void advance(state.execution, run.accessToken);
    } catch (error) {
      update({ busy: false, error: messageOf(error), pendingClarification: undefined }, run.key);
    }
  }, [advance, applyState, persist, update, apiCall]);

  const continueRun = useCallback(() => {
    const run = activeRef.current;
    if (!run?.execution || !run.accessToken || run.busy) return;
    if (run.pendingSubmission) {
      void recover(run);
      return;
    }
    if (["approved", "awaiting_approval", "awaiting_signature"].includes(run.execution.status))
      void advance(run.execution, run.accessToken);
    else if (["unsupported", "clarification_required"].includes(run.execution.status))
      update({ editing: true }, run.key);
  }, [advance, recover, update]);

  const recoverReference = useCallback(() => {
    const run = activeRef.current;
    if (!run?.pendingSubmission || !run.transactionReference.trim() || run.busy) return;
    const txHash = run.transactionReference.trim();
    const valid = isValidTransactionReference(run.pendingSubmission.network, txHash);
    if (!valid) {
      update({ error: "Enter a valid transaction reference from your wallet" }, run.key);
      return;
    }
    try {
      const next = {
        ...run,
        pendingSubmission: { ...run.pendingSubmission, txHash },
      };
      persist(next);
      update({ pendingSubmission: next.pendingSubmission }, run.key);
      void recover(next);
    } catch (error) {
      update({ error: messageOf(error) }, run.key);
    }
  }, [persist, recover, update]);

  useEffect(() => {
    const pending = networkSwitchRef.current;
    const run = activeRef.current;
    const guide = walletGuide(run?.execution, walletRef.current, run?.step);
    if (pending && pending.key === run?.key && guide?.state === "ready" && guide.chainId === pending.chainId) {
      pending.complete();
      networkSwitchRef.current = null;
      if (pending.error && run.error === pending.error) update({ error: undefined }, run.key);
    }
  }, [
    wallet.chainId,
    wallet.evmClient?.chain.id,
    wallet.accountId,
    wallet.nativeAccountId,
    wallet.evmAddress,
    wallet.isConnecting,
    active?.key,
    update,
  ]);

  const switchNetwork = useCallback(async () => {
    const run = activeRef.current;
    const guide = walletGuide(run?.execution, walletRef.current, run?.step);
    if (!run || run.busy || guide?.state !== "switch" || !guide.chainId) return;
    let complete!: () => void;
    const confirmed = new Promise<void>(resolve => {
      complete = resolve;
    });
    const pending: NonNullable<typeof networkSwitchRef.current> = { key: run.key, chainId: guide.chainId, complete };
    networkSwitchRef.current = pending;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("The wallet network switch timed out. Check your wallet, then try again.")),
        15_000,
      );
    });
    update({ busy: true, error: undefined }, run.key);
    try {
      await Promise.race([walletRef.current.switchChain(guide.chainId), confirmed, timeout]);
      update({ busy: false }, run.key);
    } catch (error) {
      pending.error = messageOf(error);
      update({ busy: false, error: pending.error }, run.key);
    } finally {
      clearTimeout(timer!);
      if (
        networkSwitchRef.current === pending &&
        walletGuide(run.execution, walletRef.current, run.step)?.state === "ready"
      )
        networkSwitchRef.current = null;
    }
  }, [update]);

  const connect = useCallback(async () => {
    const run = activeRef.current;
    if (!run || run.busy) return;
    const guide = walletGuide(run.execution, walletRef.current, run.step);
    update({ error: undefined }, run.key);
    try {
      await walletRef.current.connect(guide?.requirement);
    } catch (error) {
      update({ error: messageOf(error) }, run.key);
    }
  }, [update]);

  return {
    active,
    guide: walletGuide(active?.execution, wallet, active?.step),
    update,
    close,
    revise,
    clarify,
    recover,
    continueRun,
    recoverReference,
    switchNetwork,
    connect,
  };
}
export type NoobRuntime = ReturnType<typeof useNoobRuntime>;
