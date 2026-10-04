import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function adapterHarness() {
  let found: ((metadata: unknown, iframe: boolean) => void) | undefined;
  let discoveries = 0;
  const launches: unknown[] = [];
  const connectors: any[] = [];
  const listeners = new Set<(uri: string) => void>();
  const provider = {
    session: { namespaces: { hedera: { accounts: ["hedera:testnet:0.0.123"] } } },
    on: (_event: string, listener: (uri: string) => void) => listeners.add(listener),
    removeListener: (_event: string, listener: (uri: string) => void) => listeners.delete(listener),
  };
  let reject = false;
  class HederaAdapter {
    getCaipNetworks() {
      return [{ chainNamespace: "hedera", id: "testnet" }];
    }
    addConnector(connector: unknown) {
      connectors.push(connector);
    }
    getWalletConnectProvider() {
      return provider;
    }
    async connect(params: { type: string }) {
      assert.equal(params.type, "WALLET_CONNECT");
      for (const listener of listeners) listener("wc:approved-test-pairing");
      if (reject) throw new Error("Connection declined");
      return { id: "WALLET_CONNECT", type: "WALLET_CONNECT", address: "", provider };
    }
  }
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(
    readFileSync(new URL("../providers/wallet/hedera-adapter.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require: () => ({
      HederaAdapter,
      hederaNamespace: "hedera",
      findExtensions: (callback: typeof found) => {
        discoveries++;
        found = callback;
      },
      extensionConnect: (...args: unknown[]) => launches.push(args),
    }),
  });
  return {
    adapter: new exports.NativeHederaAdapter(),
    connectors,
    launches,
    listeners,
    provider,
    discover: (metadata: unknown, iframe = false) => found!(metadata, iframe),
    discoveries: () => discoveries,
    reject: () => {
      reject = true;
    },
  };
}

test("discovers a native Hedera extension once and launches WalletConnect instead of Ethereum injection", async () => {
  const harness = adapterHarness();
  await harness.adapter.syncConnectors();
  await harness.adapter.syncConnectors();
  harness.discover({ id: "hashpack-extension", name: "HashPack", icon: "https://example.com/hashpack.png" });
  harness.discover({ id: "hashpack-extension", name: "HashPack" });
  harness.discover({ id: "invalid:id" });
  assert.equal(harness.discoveries(), 1);
  assert.equal(harness.connectors.length, 1);
  assert.equal(harness.connectors[0].chain, "hedera");
  const connected = await harness.adapter.connect({ id: "hashpack-extension", type: "INJECTED" });
  assert.equal(connected.address, "0.0.123");
  assert.equal(connected.chainId, "testnet");
  assert.equal(
    JSON.stringify(harness.launches),
    JSON.stringify([["hashpack-extension", false, "wc:approved-test-pairing"]]),
  );
  assert.equal(harness.listeners.size, 0);
});

test("cleans up native extension launch listeners after rejection and refuses a mainnet account", async () => {
  for (const reject of [true, false]) {
    const harness = adapterHarness();
    await harness.adapter.syncConnectors();
    harness.discover({ id: "hashpack-extension", name: "HashPack" });
    if (reject) harness.reject();
    else harness.provider.session.namespaces.hedera.accounts = ["hedera:mainnet:0.0.123"];
    await assert.rejects(
      harness.adapter.connect({ id: "hashpack-extension", type: "INJECTED" }),
      /declined|testnet account/,
    );
    assert.equal(harness.listeners.size, 0);
  }
});
