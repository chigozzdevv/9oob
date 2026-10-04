import { existsSync } from "node:fs";
import { setDefaultResultOrder } from "node:dns";
import { resolve } from "node:path";
import { type Execution, type IntentAction, type Network } from "@9oob/schema";
import {
  root,
  wallets,
  clients,
  nativeSdk,
  signNative,
  pause,
  readJson,
  saveJson,
  send,
  safeError,
} from "./testnet-chain.mjs";
import { buildHederaTransfer } from "../../packages/sdk/src/wallet/hedera.js";
import { HederaProvider } from "../src/shared/integration/hedera/hedera.client.js";
import { parseTokenAmount } from "../src/shared/integration/amounts.js";

if (!process.argv.includes("--broadcast"))
  throw new Error("Live validation requires an explicit --broadcast flag; automated tests never invoke this command");
const requested = process.argv[process.argv.indexOf("--case") + 1];
const recipient = wallets.hedera.address;
const bridgeAccount = "0.0.10841324";
const accountId = "0.0.10840734";
type Scenario = { intent: string; owner: "hedera" | "base"; expected: IntentAction; cancel?: boolean };
const scenarios: Record<string, Scenario> = {
  "balance-hbar": {
    intent: "Check my HBAR balance on Hedera Testnet",
    owner: "hedera",
    expected: { kind: "balance", network: "hedera", asset: "HBAR" },
  },
  "balance-hedera-usdc": {
    intent: "Check my USDC balance on Hedera Testnet",
    owner: "hedera",
    expected: { kind: "balance", network: "hedera", asset: "USDC" },
  },
  "balance-base-eth": {
    intent: "Check my ETH balance on Base Sepolia",
    owner: "base",
    expected: { kind: "balance", network: "base", asset: "ETH" },
  },
  "balance-base-usdc": {
    intent: "Check my USDC balance on Base Sepolia",
    owner: "base",
    expected: { kind: "balance", network: "base", asset: "USDC" },
  },
  "transfer-base-eth": {
    intent: `Send 0.0005 ETH on Base Sepolia to ${recipient}`,
    owner: "base",
    expected: { kind: "transfer", network: "base", asset: "ETH", amount: "0.0005", recipient },
  },
  "transfer-base-usdc": {
    intent: `Send 0.5 USDC on Base Sepolia to ${recipient}`,
    owner: "base",
    expected: { kind: "transfer", network: "base", asset: "USDC", amount: "0.5", recipient },
  },
  "transfer-hbar": {
    intent: `Send 0.01 HBAR on Hedera Testnet to ${bridgeAccount}`,
    owner: "hedera",
    expected: { kind: "transfer", network: "hedera", asset: "HBAR", amount: "0.01", recipient: bridgeAccount },
  },
  "transfer-hedera-usdc": {
    intent: `Send 0.01 USDC on Hedera Testnet to ${bridgeAccount}`,
    owner: "hedera",
    expected: { kind: "transfer", network: "hedera", asset: "USDC", amount: "0.01", recipient: bridgeAccount },
  },
  "swap-hedera": {
    intent: `Swap 0.1 HBAR for USDC on Hedera Testnet and send the output to ${recipient}`,
    owner: "hedera",
    expected: {
      kind: "swap",
      sourceNetwork: "hedera",
      destinationNetwork: "hedera",
      sourceAsset: "HBAR",
      destinationAsset: "USDC",
      amount: "0.1",
      recipient,
    },
  },
  "bridge-hedera-base": {
    intent: `Bridge 1 USDC from Hedera Testnet to Base Sepolia and send the USDC to ${recipient}`,
    owner: "hedera",
    expected: {
      kind: "bridge",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      amount: "1",
      recipient,
    },
  },
  "bridge-base-hedera": {
    intent: `Bridge 1 USDC from Base Sepolia to Hedera Testnet and send the USDC to ${recipient}`,
    owner: "hedera",
    expected: {
      kind: "bridge",
      sourceNetwork: "base",
      destinationNetwork: "hedera",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      amount: "1",
      recipient,
    },
  },
  "swap-hedera-base": {
    intent: `Swap 0.1 HBAR on Hedera Testnet into USDC on Base Sepolia and send the final output to ${recipient}`,
    owner: "hedera",
    expected: {
      kind: "swap",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "HBAR",
      destinationAsset: "USDC",
      amount: "0.1",
      recipient,
    },
  },
  "swap-base-hedera": {
    intent: `Swap 0.1 USDC on Base Sepolia into HBAR on Hedera Testnet and send the final output to ${recipient}`,
    owner: "hedera",
    expected: {
      kind: "swap",
      sourceNetwork: "base",
      destinationNetwork: "hedera",
      sourceAsset: "USDC",
      destinationAsset: "HBAR",
      amount: "0.1",
      recipient,
    },
  },
  cancel: {
    intent: "Check my HBAR balance on Hedera Testnet",
    owner: "hedera",
    expected: { kind: "balance", network: "hedera", asset: "HBAR" },
    cancel: true,
  },
};
const scenario = scenarios[requested];
if (!scenario) throw new Error("Choose a supported --case name");
const privatePath = "contract/.secrets/live-validations.json";
const publicPath = "contract/deployments/validation.testnet.json";
const state = existsSync(resolve(root, privatePath)) ? readJson(privatePath) : { runs: {} };
const report = existsSync(resolve(root, publicPath))
  ? readJson(publicPath)
  : { network: "Hedera Testnet and Base Sepolia", runs: {} };
const persist = () => {
  saveJson(privatePath, state, true);
  saveJson(publicPath, report);
};
Reflect.apply(setDefaultResultOrder, undefined, ["ipv6first"]);
const base = "http://localhost:3000/api/noob";
async function api(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Execution API returned ${response.status}: ${result.error || "request failed"}`);
  return result;
}
function checkAction(actual: IntentAction | null) {
  if (!actual) throw new Error("The interpreted request has no action");
  const normalize = (action: IntentAction) =>
    Object.fromEntries(
      Object.entries(action).map(([key, value]) => [key, typeof value === "string" ? value.toLowerCase() : value]),
    );
  const a = normalize(actual),
    b = normalize(scenario.expected);
  for (const key of Object.keys(b)) {
    if (key === "amount") {
      if (parseTokenAmount(String(a[key]), 18) !== parseTokenAmount(String(b[key]), 18))
        throw new Error("The interpreted amount differs from the authorized validation amount");
    } else if (a[key] !== b[key])
      throw new Error(`The interpreted action differs at ${key}; no wallet operation was signed`);
  }
}
async function nativeSubmission(run: any, step: Record<string, unknown>) {
  if (run.pending.nativeHash) {
    const action = scenario.expected as Extract<IntentAction, { kind: "transfer" }>;
    const status = await new HederaProvider().transactionStatus(run.pending.nativeHash, {
      accountId,
      asset: String(step.asset),
      recipient: action.recipient,
      amount: String(step.amount),
    });
    if (status !== "success")
      throw new Error("A native transaction is pending or failed; its source will not be repeated");
    return run.pending.nativeHash;
  }
  const native = BigInt(await clients.hedera.rpc<string>("eth_getBalance", [recipient, "latest"]));
  const transferValue = step.asset === "HBAR" ? BigInt(String(step.amount)) * 10n ** 10n : 0n;
  if (native < transferValue + 15n * 10n ** 17n) throw new Error("Insufficient HBAR reserve for a native transfer");
  const client = nativeSdk.Client.forTestnet().setMaxAttempts(1).setMaxTransactionFee(new nativeSdk.Hbar(0.5));
  try {
    const transactionId = nativeSdk.TransactionId.generate(accountId);
    const transaction = buildHederaTransfer(step)
      .setTransactionId(transactionId)
      .setMaxTransactionFee(0.5)
      .freezeWith(client);
    if (transaction.maxTransactionFee?.toTinybars().toString() !== "50000000")
      throw new Error("The native transfer fee cap was not serialized correctly");
    const signed = (await signNative(transaction as never)) as any;
    run.pending.nativeHash = transactionId.toString();
    persist();
    try {
      await signed.execute(client);
    } catch (error) {
      if (
        error instanceof Error &&
        "status" in error &&
        String(error.status) === "INSUFFICIENT_TX_FEE" &&
        "nodeId" in error &&
        "transactionId" in error &&
        String(error.transactionId) === run.pending.nativeHash
      ) {
        (report.runs[requested].rejectedAttempts ??= []).push({
          transactionId: run.pending.nativeHash,
          reason: "INSUFFICIENT_TX_FEE",
          accepted: false,
        });
        delete run.pending.nativeHash;
        persist();
      }
      throw error;
    }
    return run.pending.nativeHash;
  } finally {
    client.close();
  }
}

try {
  let run = state.runs[requested];
  if (!run) {
    const created = await api("/executions", "POST", { intent: scenario.intent, accountId: null, evmAddress: null });
    checkAction(created.execution.interpretation.action);
    if (created.execution.status !== "awaiting_wallet")
      throw new Error(`Expected deferred wallet connection; received ${created.execution.status}`);
    run = { id: created.execution.id, token: created.accessToken, createdAt: new Date().toISOString(), pending: null };
    state.runs[requested] = run;
    report.runs[requested] = {
      intent: scenario.intent,
      id: run.id,
      status: created.execution.status,
      checks: { deferredWallet: true },
      transactions: [],
    };
    persist();
  }
  const path = `/executions/${run.id}`,
    result = report.runs[requested];
  const deadline = Date.now() + 20 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    let { execution } = (await api(path, "GET", undefined, run.token)) as { execution: Execution };
    checkAction(execution.interpretation.action);
    if (execution.status !== lastStatus) {
      console.log(
        JSON.stringify({
          case: requested,
          id: run.id,
          status: execution.status,
          stage: execution.stage,
          error: execution.error,
        }),
      );
      lastStatus = execution.status;
    }
    result.status = execution.status;
    result.execution = execution;
    persist();
    if (execution.status === "completed" || execution.status === "cancelled") {
      const forbidden = await fetch(base + path + "/prepare", {
        method: "POST",
        headers: { Origin: "http://localhost:3000", Authorization: `Bearer ${run.token}` },
      });
      if (forbidden.status !== 409) throw new Error("A terminal execution still allows transaction preparation");
      result.checks.terminalPreparationBlocked = true;
      delete result.lastError;
      result.finishedAt = new Date().toISOString();
      persist();
      console.log(
        JSON.stringify({
          case: requested,
          status: execution.status,
          sourceTxHash: execution.sourceTxHash,
          destinationTxHash: execution.destinationTxHash,
          completedSteps: execution.completedSteps,
          review: execution.interpretation.review,
        }),
      );
      break;
    }
    if (execution.status === "failed" || execution.status === "unsupported")
      throw new Error(execution.error || execution.interpretation.message || "Execution failed");
    if (execution.status === "awaiting_wallet") {
      if (scenario.cancel) {
        await api(path + "/cancel", "POST", {}, run.token);
        continue;
      }
      await api(
        path + "/wallet",
        "POST",
        {
          accountId: scenario.owner === "hedera" ? accountId : wallets.base.address,
          evmAddress: wallets[scenario.owner].address,
        },
        run.token,
      );
      continue;
    }
    if (execution.status === "awaiting_approval") {
      await api(path + "/approve", "POST", {}, run.token);
      continue;
    }
    if (execution.status === "approved" || execution.status === "awaiting_signature") {
      if (!run.pending) {
        const prepared = await api(path + "/prepare", "POST", {}, run.token);
        if (prepared.step?.kind === "error") throw new Error(prepared.execution.error || "Preparation failed");
        if (prepared.execution.status === "completed") continue;
        run.pending = { version: prepared.execution.version, step: prepared.step };
        persist();
      }
      const pending = run.pending;
      const hash =
        pending.step.kind === "hedera-transfer"
          ? await nativeSubmission(run, pending.step)
          : (
              await send(
                `execution-${run.id}-v${pending.version}`,
                pending.step.chainKey as Network,
                scenario.owner,
                pending.step.transaction,
              )
            ).transactionHash;
      const registration = { txHash: hash, preparationVersion: pending.version };
      await api(path + "/submitted", "POST", registration, run.token);
      const repeated = await api(path + "/submitted", "POST", registration, run.token);
      if (repeated.execution.id !== run.id) throw new Error("Duplicate registration changed execution identity");
      result.checks.duplicateRegistration = true;
      result.transactions.push({
        hash,
        version: pending.version,
        kind: pending.step.kind,
        network: pending.step.chainKey || "hedera",
      });
      run.pending = null;
      persist();
      continue;
    }
    await pause(5000);
  }
  if (!["completed", "cancelled"].includes(report.runs[requested].status))
    throw new Error("Settlement is still pending; the persisted run can resume without a new source submission");
} catch (error) {
  if (report.runs[requested]) {
    report.runs[requested].lastError = safeError(error);
    persist();
  }
  console.error(safeError(error));
  process.exitCode = 1;
}
