import assert from "node:assert/strict";
import test from "node:test";
import type { Execution } from "@9oob/schema";
import { providerHarness } from "./wallet.fixture.js";
import { walletGuide } from "../src/wallet/guide.js";
import { walletSender, type NoobWallet } from "../src/wallet/wallet.js";

const initial: Execution = {
  id: "wallet-flow",
  intent: "Check my HBAR balance",
  accountId: null,
  evmAddress: null,
  status: "awaiting_wallet",
  interpretation: {
    outcome: "ready",
    message: "",
    review: null,
    action: { kind: "balance", network: "hedera", asset: "HBAR" },
  },
  sourceTxHash: null,
  destinationTxHash: null,
  error: null,
  version: 0,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
};

test("interprets before the wallet prompt, binds the selected account, and reads without signing", async () => {
  let connects = 0,
    signatures = 0;
  const calls: string[] = [];
  let state = initial;
  const harness = providerHarness({
    connected: false,
    connect: () => {
      connects++;
    },
    nativeSend: async () => {
      signatures++;
      throw new Error("Unexpected signature");
    },
    fetch: async (url, init) => {
      calls.push(url);
      if (url === "/api/noob/executions") {
        assert.equal(JSON.parse(String(init?.body)).accountId, null);
        return Response.json({ execution: state, accessToken: "x".repeat(43) });
      }
      if (url.endsWith("/wallet")) {
        assert.equal(JSON.parse(String(init?.body)).accountId, "0.0.1");
        state = { ...state, accountId: "0.0.1", status: "approved", version: 1 };
        return Response.json({ execution: state });
      }
      if (url.endsWith("/prepare")) {
        state = { ...state, status: "completed", version: 2 };
        return Response.json({ execution: state, step: { kind: "read" } });
      }
      throw new Error(`Unexpected request ${url}`);
    },
  });
  await harness.flush();
  const result = harness.start("Check my HBAR balance");
  await harness.flush();
  assert.deepEqual(calls, ["/api/noob/executions"]);
  assert.equal(connects, 0);
  assert.equal(harness.state()?.execution?.status, "awaiting_wallet");
  assert.match(harness.text(), /Connect a Hedera testnet wallet to read its balance/);
  assert.doesNotMatch(harness.text(), /Review your intent/);
  await harness.click("Connect wallet");
  assert.equal(connects, 1);
  await harness.setWallet("0.0.1");
  assert.deepEqual(calls, [
    "/api/noob/executions",
    "/api/noob/executions/wallet-flow/wallet",
    "/api/noob/executions/wallet-flow/prepare",
  ]);
  assert.equal(result.resolved?.status, "completed");
  assert.equal(signatures, 0);
  harness.unmount();
});

test("clarification appears without requesting a wallet", async () => {
  let connects = 0;
  const harness = providerHarness({
    connected: false,
    connect: () => {
      connects++;
    },
    fetch: async () =>
      Response.json({
        execution: {
          ...initial,
          status: "clarification_required",
          interpretation: { outcome: "clarification", action: null, review: null, message: "Which asset and amount?" },
        },
        accessToken: "x".repeat(43),
      }),
  });
  await harness.flush();
  harness.start("Send something");
  await harness.flush();
  assert.match(harness.text(), /Which asset and amount/);
  assert.equal(
    harness.buttons().some(button => button.props.children?.includes?.("Connect wallet")),
    false,
  );
  assert.equal(connects, 0);
  harness.unmount();
});

test("connecting during interpretation does not restart the intent request", async () => {
  let created = 0;
  let respond!: (response: Response) => void;
  const harness = providerHarness({
    connected: false,
    fetch: async url => {
      if (url === "/api/noob/executions") {
        created++;
        return new Promise(resolve => {
          respond = resolve;
        });
      }
      if (url.endsWith("/wallet"))
        return Response.json({ execution: { ...initial, accountId: "0.0.1", status: "approved", version: 1 } });
      if (url.endsWith("/prepare"))
        return Response.json({
          execution: { ...initial, accountId: "0.0.1", status: "completed", version: 2 },
          step: { kind: "read" },
        });
      throw new Error(`Unexpected request ${url}`);
    },
  });
  await harness.flush();
  harness.start("Check my HBAR balance");
  await harness.flush();
  await harness.setWallet("0.0.1");
  assert.equal(created, 1);
  assert.doesNotMatch(harness.text(), /Understanding/);
  assert.equal(
    harness.nodes().some(node => node.props.role === "status" && node.props["aria-label"] === "Loading intent"),
    true,
  );
  respond(Response.json({ execution: initial, accessToken: "x".repeat(43) }));
  await harness.flush();
  assert.equal(created, 1);
  assert.equal(harness.state()?.execution?.status, "completed");
  harness.unmount();
});

const address = `0x${"1".repeat(40)}`;
const swap: Execution = {
  ...initial,
  intent: "Swap 10 HBAR to USDC on Base",
  interpretation: {
    outcome: "ready",
    message: "",
    review: null,
    action: {
      kind: "swap",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "HBAR",
      destinationAsset: "USDC",
      amount: "10",
      recipient: address,
    },
  },
};

test("a native connection prompts for an EVM wallet and binds it once before guiding the network switch", async () => {
  const requirements: unknown[] = [];
  const calls: string[] = [];
  const switches: number[] = [];
  const harness = providerHarness({
    connected: false,
    nativeAccount: "0.0.1",
    connect: requirement => {
      requirements.push(requirement);
    },
    switchChain: async chainId => {
      switches.push(chainId);
    },
    fetch: async (url, init) => {
      calls.push(url);
      if (url.endsWith("/wallet")) {
        const identity = JSON.parse(String(init?.body));
        assert.deepEqual(identity, { accountId: address, evmAddress: address });
        return Response.json({
          execution: {
            ...swap,
            ...identity,
            status: "awaiting_approval",
            version: 1,
            interpretation: { ...swap.interpretation, review: { title: "Swap 10 HBAR", facts: [], quote: null } },
          },
        });
      }
      if (url === "/api/noob/executions") return Response.json({ execution: swap, accessToken: "x".repeat(43) });
      throw new Error(`Unexpected request ${url}`);
    },
  });
  await harness.flush();
  harness.start(swap.intent);
  await harness.flush();
  assert.deepEqual(calls, ["/api/noob/executions"]);
  assert.match(harness.text(), /Connect a wallet for this swap on Hedera/);
  await harness.click("Connect wallet");
  assert.equal(JSON.stringify(requirements), JSON.stringify([{ kind: "evm", network: "hedera" }]));
  await harness.setWallet("0.0.1", address);
  assert.equal(calls.filter(url => url.endsWith("/wallet")).length, 1);
  assert.match(harness.text(), /Switch to Hedera/);
  assert.doesNotMatch(harness.text(), /Approve and continue/);
  await harness.click("Switch to Hedera testnet");
  assert.deepEqual(switches, [296]);
  assert.equal(calls.length, 2);
  await harness.setChain(296);
  assert.match(harness.text(), /Approve and continue/);
  assert.equal(calls.length, 2);
  harness.unmount();
});

test("network rejection stays retryable and a changed account must reconnect before approval", async () => {
  let switches = 0;
  const reviewed = { ...swap, accountId: address, evmAddress: address, status: "awaiting_approval", version: 1 };
  const harness = providerHarness({
    switchChain: async () => {
      switches++;
      if (switches === 1) throw new Error("Network switch declined");
    },
    fetch: async url => {
      assert.equal(url, "/api/noob/executions");
      return Response.json({ execution: reviewed, accessToken: "x".repeat(43) });
    },
  });
  await harness.flush();
  harness.start(swap.intent);
  await harness.flush();
  await harness.click("Switch to Hedera testnet");
  assert.match(harness.text(), /Network switch declined/);
  await harness.click("Switch to Hedera testnet");
  assert.equal(switches, 2);
  await harness.setChain(296);
  assert.match(harness.text(), /Approve and continue/);
  await harness.setWallet(`0x${"2".repeat(40)}`, `0x${"2".repeat(40)}`);
  assert.match(harness.text(), /Reconnect 0x111/);
  assert.doesNotMatch(harness.text(), /Approve and continue/);
  await harness.click("Switch wallet");
  harness.unmount();
});

test("a stalled network request unlocks after confirmation or timeout, without approving or signing", async () => {
  let switches = 0;
  const reviewed = { ...swap, accountId: address, evmAddress: address, status: "awaiting_approval", version: 1 };
  const harness = providerHarness({
    switchChain: async () => {
      switches++;
      await new Promise(() => undefined);
    },
    fetch: async url => {
      assert.equal(url, "/api/noob/executions");
      return Response.json({ execution: reviewed, accessToken: "x".repeat(43) });
    },
  });
  await harness.flush();
  harness.start(swap.intent);
  await harness.flush();
  await harness.click("Switch to Hedera testnet");
  assert.equal(harness.state()?.busy, true);
  await harness.tick();
  assert.equal(harness.state()?.busy, false);
  assert.match(harness.text(), /network switch timed out/);
  await harness.setChain(296);
  assert.match(harness.text(), /Approve and continue/);
  assert.doesNotMatch(harness.text(), /network switch timed out/);
  await harness.setChain(84532);
  await harness.click("Switch to Hedera testnet");
  assert.equal(harness.state()?.busy, true);
  await harness.setChain(296);
  assert.equal(harness.state()?.busy, false);
  assert.match(harness.text(), /Approve and continue/);
  assert.doesNotMatch(harness.text(), /network switch timed out/);
  assert.equal(switches, 2);
  assert.equal(harness.state()?.execution?.status, "awaiting_approval");
  harness.unmount();
});

test("a disconnected transfer requests an EVM wallet and preserves connection errors for retry", async () => {
  const requirements: unknown[] = [];
  const harness = providerHarness({
    connected: false,
    connect: requirement => {
      requirements.push(requirement);
      throw new Error("Connection cancelled");
    },
    fetch: async url => {
      assert.equal(url, "/api/noob/executions");
      return Response.json({
        execution: {
          ...initial,
          interpretation: {
            outcome: "ready",
            message: "",
            review: null,
            action: { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" },
          },
        },
        accessToken: "x".repeat(43),
      });
    },
  });
  await harness.flush();
  harness.start("Send 1 HBAR to 0.0.2");
  await harness.flush();
  assert.match(harness.text(), /Connect a wallet for this transfer on Hedera/);
  await harness.click("Connect wallet");
  assert.match(harness.text(), /Connection cancelled/);
  await harness.click("Connect wallet");
  assert.equal(JSON.stringify(requirements), JSON.stringify(Array(2).fill({ kind: "evm", network: "hedera" })));
  harness.unmount();
});

test("changing wallets during binding preserves the reviewed account and never leaves the modal busy", async () => {
  let finish!: (response: Response) => void;
  let bindings = 0;
  const harness = providerHarness({
    connected: false,
    fetch: async url => {
      if (url === "/api/noob/executions") return Response.json({ execution: swap, accessToken: "x".repeat(43) });
      if (url.endsWith("/wallet")) {
        bindings++;
        return new Promise(resolve => {
          finish = resolve;
        });
      }
      throw new Error(`Unexpected request ${url}`);
    },
  });
  await harness.flush();
  harness.start(swap.intent);
  await harness.flush();
  await harness.setWallet(address, address);
  assert.equal(harness.state()?.busy, true);
  await harness.setChain(296);
  await harness.setWallet(`0x${"2".repeat(40)}`, `0x${"2".repeat(40)}`);
  finish(
    Response.json({
      execution: { ...swap, accountId: address, evmAddress: address, status: "awaiting_approval", version: 1 },
    }),
  );
  await harness.flush();
  assert.equal(bindings, 1);
  assert.equal(harness.state()?.busy, false);
  assert.match(harness.text(), /Reconnect 0x111/);
  assert.doesNotMatch(harness.text(), /Approve and continue/);
  harness.unmount();
});

test("wallet restoration waits for the signer before binding or prompting another connection", async () => {
  let bindings = 0;
  const harness = providerHarness({
    isConnecting: true,
    chainId: 296,
    fetch: async url => {
      if (url.endsWith("/wallet")) {
        bindings++;
        return Response.json({
          execution: { ...swap, accountId: address, evmAddress: address, status: "awaiting_approval", version: 1 },
        });
      }
      return Response.json({ execution: swap, accessToken: "x".repeat(43) });
    },
  });
  await harness.flush();
  harness.start(swap.intent);
  await harness.flush();
  assert.equal(
    harness
      .nodes()
      .some(node => node.props.role === "status" && /Getting your wallet ready/.test(node.props["aria-label"] ?? "")),
    true,
  );
  assert.doesNotMatch(harness.text(), /Connect wallet/);
  assert.equal(bindings, 0);
  await harness.setConnecting(false);
  assert.equal(bindings, 1);
  assert.match(harness.text(), /Approve and continue/);
  harness.unmount();
});

test("one EVM wallet is reused for balances, transfers, swaps and bridges without a native connection", async () => {
  const actions: NonNullable<Execution["interpretation"]["action"]>[] = [
    { kind: "balance", network: "hedera", asset: "HBAR" },
    { kind: "balance", network: "base", asset: "ETH" },
    { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" },
    { kind: "transfer", network: "base", asset: "USDC", amount: "1", recipient: `0x${"2".repeat(40)}` },
    swap.interpretation.action!,
    {
      kind: "bridge",
      sourceNetwork: "hedera",
      destinationNetwork: "base",
      sourceAsset: "USDC",
      destinationAsset: "USDC",
      amount: "1",
      recipient: address,
    },
  ];
  for (const action of actions) {
    let connects = 0,
      switches = 0,
      signatures = 0;
    const network = action.kind === "balance" || action.kind === "transfer" ? action.network : action.sourceNetwork;
    const state: Execution = {
      ...initial,
      accountId: address,
      evmAddress: address,
      status: action.kind === "balance" ? "approved" : "awaiting_approval",
      interpretation: { outcome: "ready", action, message: "", review: { title: "Review", facts: [], quote: null } },
    };
    const harness = providerHarness({
      chainId: action.kind === "balance" || network === "hedera" ? 296 : 84532,
      evmReady: action.kind !== "balance",
      connect: () => {
        connects++;
      },
      switchChain: async () => {
        switches++;
      },
      nativeSend: async () => {
        signatures++;
        throw new Error("Unexpected native signature");
      },
      evmSend: async () => {
        signatures++;
        throw new Error("Unexpected EVM signature");
      },
      fetch: async (url, init) => {
        if (url === "/api/noob/executions") {
          assert.equal(JSON.parse(String(init?.body)).accountId, address);
          return Response.json({ execution: state, accessToken: "x".repeat(43) });
        }
        assert.equal(action.kind, "balance");
        assert(url.endsWith("/prepare"));
        return Response.json({ execution: { ...state, status: "completed" }, step: { kind: "read" } });
      },
    });
    await harness.flush();
    const result = harness.start(`Run ${action.kind}`);
    await harness.flush();
    assert.equal(connects, 0);
    assert.equal(switches, 0);
    assert.equal(signatures, 0);
    if (action.kind === "balance") assert.equal(result.resolved?.status, "completed");
    else assert.match(harness.text(), /Approve and continue/);
    harness.unmount();
  }
});

test("an existing native review still uses its bound Hedera account when MetaMask is also connected", () => {
  const execution: Execution = {
    ...initial,
    accountId: "0.0.1",
    evmAddress: address,
    status: "awaiting_signature",
    interpretation: {
      outcome: "ready",
      message: "",
      review: null,
      action: {
        kind: "transfer",
        network: "hedera",
        asset: "HBAR",
        amount: "1",
        recipient: "0.0.2",
      },
    },
  };
  const wallet: NoobWallet = {
    accountId: address,
    nativeAccountId: "0.0.1",
    evmAddress: address,
    connect: () => undefined,
    nativeSend: async () => {
      throw new Error("No signing in this test");
    },
    switchChain: async () => undefined,
  };
  const step = {
    kind: "hedera-transfer",
    accountId: "0.0.1",
    asset: "HBAR",
    recipient: "0.0.2",
    amount: "100000000",
    network: "testnet",
  };
  assert.equal(walletGuide(execution, wallet, step)?.state, "ready");
  assert.equal(typeof walletSender(step, wallet), "function");
  assert.throws(() => walletSender(step, { ...wallet, nativeAccountId: "0.0.9" }), /account changed/);
});

test("a connected MetaMask on an unconfigured network is guided to switch without another connection", () => {
  const execution: Execution = { ...swap, accountId: address, evmAddress: address, status: "awaiting_approval" };
  const wallet: NoobWallet = {
    accountId: address,
    evmAddress: address,
    chainId: 1,
    connect: () => {
      throw new Error("No new connection needed");
    },
    nativeSend: async () => {
      throw new Error("No signing in this test");
    },
    switchChain: async () => undefined,
  };
  assert.equal(walletGuide(execution, wallet)?.state, "switch");
  assert.equal(walletGuide(execution, { ...wallet, isConnecting: true })?.state, "switch");
  assert.equal(walletGuide(execution, wallet)?.chainId, 296);
  assert.equal(walletGuide(execution, { ...wallet, chainId: 296 })?.state, "connect");
  const balance: Execution = { ...execution, interpretation: { ...initial.interpretation } };
  assert.equal(walletGuide(balance, wallet)?.state, "ready");
});
