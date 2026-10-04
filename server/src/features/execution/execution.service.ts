import { prepareTransfer } from "../action/transfer.service.js";
import { readBalance } from "../action/balance.service.js";
import { PlanService } from "../plan/index.js";
import { evmSubmissionStatus } from "./execution.receipt.js";
import { IntentService } from "../intent/index.js";
import { HederaProvider } from "../../shared/integration/hedera/hedera.client.js";
import { BaseProvider } from "../../shared/integration/base/base.client.js";
import {
  ReviewRequiredError,
  type RoutePreparation,
  TestnetProvider,
} from "../../shared/integration/testnet.provider.js";
import { createCapability, hashCapability } from "../../shared/auth/auth.service.js";
import { ExecutionRepository } from "./execution.repo.js";
import { executionStatus } from "./execution.model.js";
import {
  ClarificationAnswerSchema,
  ClarificationHistorySchema,
  IntentTextSchema,
  walletIdentityFor,
  type Execution,
} from "@9oob/schema";

export class ExecutionService {
  constructor(
    private readonly store: ExecutionRepository,
    private readonly interpreter: IntentService,
    private readonly routes = new TestnetProvider(),
    private readonly hedera = new HederaProvider(),
    private readonly base = new BaseProvider(),
  ) {
    this.plan = new PlanService(hedera, routes);
  }

  private readonly plan: PlanService;

  consumeStartRateLimit(bucket: string): Promise<boolean> {
    return this.store.consumeRateLimit(bucket, 12, 60);
  }

  async start(
    intent: string,
    accountId: string | null = null,
    evmAddress: string | null = null,
  ): Promise<{ execution: Execution; accessToken: string }> {
    intent = IntentTextSchema.parse(intent);
    accountId ??= evmAddress;
    const interpretation = await this.plan.review(await this.interpreter.interpret(intent), accountId, evmAddress);
    const identity = interpretation.action ? walletIdentityFor(interpretation.action, accountId, evmAddress) : null;
    const status = executionStatus(interpretation, accountId, evmAddress);
    const capability = createCapability();
    const execution = await this.store.create({
      ...capability,
      tokenHash: capability.tokenHash,
      intent,
      accountId: identity?.accountId ?? accountId,
      evmAddress: identity?.evmAddress ?? evmAddress,
      status,
      interpretation,
    });
    return { execution, accessToken: capability.token };
  }

  async get(id: string, token: string): Promise<Execution | null> {
    return this.store.get(id, hashCapability(token));
  }

  async connectWallet(
    id: string,
    token: string,
    accountId: string,
    evmAddress: string | null,
  ): Promise<Execution | null> {
    const current = await this.get(id, token);
    if (!current || current.status !== "awaiting_wallet") return null;
    const interpretation = await this.plan.review(current.interpretation, accountId, evmAddress);
    const identity = interpretation.action ? walletIdentityFor(interpretation.action, accountId, evmAddress) : null;
    if (!identity && interpretation.outcome === "ready") return current;
    return this.store.transition(
      id,
      hashCapability(token),
      ["awaiting_wallet"],
      {
        accountId: identity?.accountId ?? accountId,
        evmAddress: identity?.evmAddress ?? evmAddress,
        interpretation,
        status: executionStatus(interpretation, accountId, evmAddress),
        error: null,
      },
      current.version,
    );
  }

  async read(id: string, token: string): Promise<{ execution: Execution; step?: Record<string, unknown> } | null> {
    const execution = await this.refresh(id, token);
    if (!execution) return null;
    if (execution.status !== "awaiting_signature") return { execution };
    const context = await this.store.getContext(id, hashCapability(token));
    const step = context?.step;
    return {
      execution,
      ...(step && typeof step === "object" ? { step: step as Record<string, unknown> } : {}),
    };
  }

  async prepare(
    id: string,
    capability: string,
  ): Promise<{ execution: Execution; step: Record<string, unknown> } | null> {
    const current = await this.get(id, capability);
    if (!current || !current.accountId) return null;
    if (current.status === "approved" && current.interpretation.action?.kind === "balance") {
      const interpretation = await readBalance(
        current.interpretation.action,
        current.interpretation,
        current.accountId,
        this.hedera,
        this.base,
      );
      const execution = await this.store.transition(
        id,
        hashCapability(capability),
        ["approved"],
        {
          status: "completed",
          interpretation,
        },
        current.version,
      );
      return execution ? { execution, step: { kind: "read" } } : null;
    }
    if (!["approved", "awaiting_signature"].includes(current.status) || !current.interpretation.action) return null;
    const hash = hashCapability(capability);
    try {
      let step: Record<string, unknown>;
      let context: Record<string, unknown>;
      const action = current.interpretation.action;
      if (action.kind === "transfer") {
        step =
          action.network === "base"
            ? await this.base.prepareTransfer(action, current.accountId)
            : await prepareTransfer(action, current.accountId, this.hedera);
        context = {
          kind:
            action.network === "base"
              ? "base-transfer"
              : step.kind === "hedera-transfer"
                ? "hedera-transfer"
                : "hedera-evm-transfer",
          sourceChainKey: action.network,
          stage: "transfer",
          phase: "source",
          step,
        };
      } else {
        if (action.kind !== "bridge" && action.kind !== "swap") throw new Error("This action is not executable");
        const prepared: RoutePreparation = await this.routes.prepare(
          action,
          current.evmAddress ?? current.accountId,
          current.interpretation.review,
          await this.store.getContext(id, hash),
        );
        step = {
          kind: prepared.phase === "association" ? "source" : prepared.phase,
          label: prepared.label,
          chainKey: prepared.context.sourceChainKey,
          transaction: {
            ...prepared.transaction,
            value: prepared.transaction.value.toString(),
          },
        };
        context = { ...prepared.context, phase: prepared.phase, step };
      }
      const execution = await this.store.commitPreparation(id, hash, current.version, context);
      return execution ? { execution, step } : null;
    } catch (error) {
      const execution = await this.store.transition(
        id,
        hash,
        [current.status],
        {
          ...(error instanceof ReviewRequiredError
            ? {
                status: "awaiting_approval" as const,
                interpretation: {
                  ...current.interpretation,
                  review: error.review,
                },
              }
            : {}),
          error: error instanceof Error ? error.message.slice(0, 240) : "Transaction preparation failed",
        },
        current.version,
        error instanceof ReviewRequiredError
          ? { ...((await this.store.getContext(id, hash)) ?? {}), stageReview: error.review }
          : undefined,
      );
      return execution ? { execution, step: { kind: "error" } } : null;
    }
  }

  async registerSubmission(
    id: string,
    token: string,
    txHash: string,
    preparationVersion: number,
  ): Promise<Execution | null> {
    const hash = hashCapability(token);
    const acknowledged = await this.store.submittedForVersion(id, hash, preparationVersion, txHash);
    if (acknowledged) return acknowledged;
    const current = await this.get(id, token);
    if (!current) return null;
    if (current.sourceTxHash === txHash && ["submitted", "settling", "completed", "failed"].includes(current.status))
      return current;
    if (current.status !== "awaiting_signature" || current.version !== preparationVersion) return null;
    const context = await this.store.getContext(id, hash);
    if (!context || typeof context.phase !== "string") throw new Error("Execution has no prepared wallet step");
    if (
      context.kind === "hedera-transfer"
        ? !/^0\.0\.\d{1,10}@\d+\.\d{1,9}$/.test(txHash)
        : !/^0x[a-fA-F0-9]{64}$/.test(txHash)
    ) {
      throw new Error("Transaction reference does not match the prepared network");
    }
    return this.store.recordSubmission(id, hash, preparationVersion, txHash);
  }

  async cancel(id: string, token: string): Promise<Execution | null> {
    return this.store.transition(
      id,
      hashCapability(token),
      ["awaiting_wallet", "awaiting_approval", "approved", "clarification_required", "unsupported"],
      { status: "cancelled" },
    );
  }

  async approve(id: string, token: string): Promise<Execution | null> {
    const current = await this.get(id, token);
    if (!current) return null;
    if (current.status === "approved") return current;
    return this.store.transition(id, hashCapability(token), ["awaiting_approval"], { status: "approved" });
  }

  async refresh(id: string, token: string): Promise<Execution | null> {
    return this.refreshStored(id, hashCapability(token));
  }

  async refreshStored(id: string, hash: string): Promise<Execution | null> {
    return (await this.reconcileStored(id, hash)) ?? this.store.get(id, hash);
  }

  private async reconcileStored(id: string, hash: string): Promise<Execution | null> {
    const execution = await this.store.get(id, hash);
    if (!execution || !["submitted", "settling"].includes(execution.status)) return execution;
    const context = await this.store.getContext(id, hash);
    if (!context || !execution.sourceTxHash) return execution;
    const network = String(context.sourceChainKey) as "hedera" | "base";
    const phase = String(context.phase);
    const completed = execution.completedSteps ?? [];
    if (execution.status === "submitted") {
      const receipt =
        context.kind === "hedera-transfer"
          ? await this.hedera.transactionStatus(
              execution.sourceTxHash,
              context.step as { accountId: string; asset: string; recipient: string; amount: string },
            )
          : await evmSubmissionStatus(network, execution.sourceTxHash, context.step);
      if (receipt === "pending") return execution;
      if (receipt !== "success")
        return this.store.transition(
          id,
          hash,
          ["submitted"],
          {
            status: "failed",
            error:
              receipt === "mismatch"
                ? "The submitted transaction does not match the reviewed step"
                : "The transaction failed on-chain",
          },
          execution.version,
        );
      if (phase === "approval" || phase === "association")
        return this.store.transition(
          id,
          hash,
          ["submitted"],
          {
            status: "approved",
            sourceTxHash: null,
            stageNetwork:
              (context.routeStages as Array<{ sourceNetwork: "hedera" | "base" }> | undefined)?.[
                Number(context.stageIndex)
              ]?.sourceNetwork ?? network,
            completedSteps: [...completed, { stage: phase, network, txHash: execution.sourceTxHash }],
          },
          execution.version,
        );
      if (["hedera-transfer", "hedera-evm-transfer", "base-transfer"].includes(String(context.kind)))
        return this.store.transition(
          id,
          hash,
          ["submitted"],
          {
            status: "completed",
            completedSteps: [...completed, { stage: "transfer", network, txHash: execution.sourceTxHash }],
          },
          execution.version,
        );
      if (context.provider === "saucerswap") {
        const hasNext = (context.routeStages as unknown[] | undefined)?.length === Number(context.stageIndex) + 2;
        const rpcReceipt = hasNext ? await this.routes.saucer.rpc.receipt(execution.sourceTxHash) : null;
        const received = rpcReceipt ? this.routes.saucer.received(context, rpcReceipt) : undefined;
        const steps = [
          ...completed,
          {
            stage: "swap" as const,
            network,
            txHash: execution.sourceTxHash,
            ...(received ? { amountRaw: received.toString() } : {}),
          },
        ];
        const next = await this.routes.next(context, received, execution.evmAddress ?? execution.accountId!);
        return this.store.transition(
          id,
          hash,
          ["submitted"],
          next
            ? {
                status: "awaiting_approval",
                sourceTxHash: null,
                stage: next.context.stage as "swap" | "bridge",
                stageNetwork: next.context.sourceChainKey as "hedera" | "base",
                stageAction: (next.context.routeStages as Array<import("@9oob/schema").IntentAction>)[
                  Number(next.context.stageIndex)
                ],
                completedSteps: steps,
                interpretation: { ...execution.interpretation, review: next.review },
                error: null,
              }
            : { status: "completed", completedSteps: steps },
          execution.version,
          next?.context,
        );
      }
      const settling = await this.store.transition(id, hash, ["submitted"], { status: "settling" }, execution.version);
      return settling;
    }
    const result = await this.routes.status(context, execution.sourceTxHash);
    if (result.status === "completed") {
      const steps = [
        ...completed,
        {
          stage: "bridge" as const,
          network: context.sourceNetwork as "hedera" | "base",
          txHash: String(context.bridgeSourceHash ?? execution.sourceTxHash),
          amountRaw: String(context.amountRaw),
        },
      ];
      const next = await this.routes.next(context, undefined, execution.evmAddress ?? execution.accountId!);
      return this.store.transition(
        id,
        hash,
        ["settling"],
        next
          ? {
              status: "awaiting_approval",
              sourceTxHash: null,
              destinationTxHash: result.destinationTxHash ?? null,
              completedSteps: steps,
              stage: next.context.stage as "swap" | "bridge",
              stageNetwork: next.context.sourceChainKey as "hedera" | "base",
              stageAction: (next.context.routeStages as Array<import("@9oob/schema").IntentAction>)[
                Number(next.context.stageIndex)
              ],
              interpretation: { ...execution.interpretation, review: next.review },
              error: null,
            }
          : { status: "completed", completedSteps: steps, destinationTxHash: result.destinationTxHash ?? null },
        execution.version,
        next?.context ?? result.context,
      );
    }
    if (result.claimReady)
      return this.store.transition(
        id,
        hash,
        ["settling"],
        {
          status: "approved",
          sourceTxHash: null,
          stage: "claim",
          stageNetwork: context.destinationNetwork as "hedera" | "base",
          error: null,
        },
        execution.version,
        { ...result.context, claimPending: true },
      );
    if (result.context) return this.store.transition(id, hash, ["settling"], {}, execution.version, result.context);
    return execution;
  }

  async revise(id: string, token: string, intent: string): Promise<Execution | null> {
    const current = await this.get(id, token);
    if (
      !current ||
      Boolean(current.completedSteps?.length) ||
      !["awaiting_wallet", "awaiting_approval", "approved", "clarification_required", "unsupported"].includes(
        current.status,
      )
    )
      return null;
    intent = IntentTextSchema.parse(intent);
    const interpretation = await this.plan.review(
      await this.interpreter.interpret(intent),
      current.accountId,
      current.evmAddress,
    );
    const identity = interpretation.action
      ? walletIdentityFor(interpretation.action, current.accountId, current.evmAddress)
      : null;
    const status = executionStatus(interpretation, current.accountId, current.evmAddress);
    return this.store.transition(
      id,
      hashCapability(token),
      ["awaiting_wallet", "awaiting_approval", "approved", "clarification_required", "unsupported"],
      {
        intent,
        clarifications: [],
        accountId: identity?.accountId ?? current.accountId,
        status,
        interpretation,
        error: null,
        stage: null,
        stageNetwork: null,
        stageAction: null,
      },
      current.version,
      {},
    );
  }

  async clarify(id: string, token: string, answer: string, version: number): Promise<Execution | null> {
    const current = await this.get(id, token);
    if (
      !current ||
      current.status !== "clarification_required" ||
      current.version !== version ||
      (current.clarifications?.length ?? 0) >= 8
    )
      return null;
    const parsed = ClarificationAnswerSchema.parse({ answer, version });
    const clarifications = ClarificationHistorySchema.parse([
      ...(current.clarifications ?? []),
      { question: current.interpretation.message, answer: parsed.answer },
    ]);
    const interpretation = await this.plan.review(
      await this.interpreter.interpret(current.intent, clarifications),
      current.accountId,
      current.evmAddress,
    );
    const identity = interpretation.action
      ? walletIdentityFor(interpretation.action, current.accountId, current.evmAddress)
      : null;
    return this.store.transition(
      id,
      hashCapability(token),
      ["clarification_required"],
      {
        clarifications,
        interpretation,
        accountId: identity?.accountId ?? current.accountId,
        evmAddress: identity?.evmAddress ?? current.evmAddress,
        status: executionStatus(interpretation, current.accountId, current.evmAddress),
        error: null,
      },
      current.version,
    );
  }
}
