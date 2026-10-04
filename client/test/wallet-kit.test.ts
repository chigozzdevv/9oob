import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
Reflect.deleteProperty(globalThis, "localStorage");

async function walletKit(init: (options: any) => Promise<unknown>) {
  const { createNamespaces, HederaChainDefinition, hederaNamespace } = createRequire(import.meta.url)(
    "@hashgraph/hedera-wallet-connect",
  );
  let kits = 0;
  const exports: Record<string, any> = {};
  const networks = [
    HederaChainDefinition.EVM.Testnet,
    { id: 84532, name: "Base", rpcUrls: { default: { http: ["https://sepolia.base.org"] } } },
  ];
  const modules: Record<string, unknown> = {
    "~~/providers/wallet/wagmi": { evmNetworks: networks, wagmiAdapter: {} },
    "~~/providers/wallet/config": { default: { walletConnectProjectId: "test-project" } },
    "~~/providers/wallet/hedera-adapter": { NativeHederaAdapter: class {} },
    "@hashgraph/hedera-wallet-connect": {
      HederaChainDefinition,
      hederaNamespace,
      createNamespaces,
      HederaProvider: { init },
      HederaAdapter: class {},
    },
    "@reown/appkit/react": {
      createAppKit: (options: any) => {
        assert.equal(options.allowUnsupportedChain, true);
        assert.equal(options.defaultNetwork.id, 296);
        kits++;
        return { id: kits };
      },
    },
  };
  const source = ts.transpileModule(readFileSync(new URL("../providers/wallet/appkit.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert(name in modules, `Unexpected import ${name}`);
      return modules[name];
    },
  });
  return { initialize: exports.initAppKit as () => Promise<unknown>, kits: () => kits };
}

test("initializes once across concurrent callers and supplies both namespaces for signer restoration", async () => {
  let starts = 0;
  let finish!: (provider: unknown) => void;
  const kit = await walletKit(async options => {
    starts++;
    assert.deepEqual(options.optionalNamespaces.hedera.chains, ["hedera:testnet"]);
    assert(options.optionalNamespaces.hedera.methods.includes("hedera_signAndExecuteTransaction"));
    assert.deepEqual(options.optionalNamespaces.eip155.chains, ["eip155:296", "eip155:84532"]);
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const first = kit.initialize();
  const second = kit.initialize();
  assert.equal(first, second);
  assert.equal(starts, 1);
  finish({});
  assert.equal(await first, await second);
  assert.equal(kit.kits(), 1);
  assert.equal(await kit.initialize(), await first);
});

test("a failed initialization can be retried without resetting wallet storage", async () => {
  let starts = 0;
  const kit = await walletKit(async () => {
    if (++starts === 1) throw new Error("Wallet service unavailable");
    return {};
  });
  await assert.rejects(kit.initialize(), /Wallet service unavailable/);
  await kit.initialize();
  assert.equal(starts, 2);
  assert.equal(kit.kits(), 1);
});
