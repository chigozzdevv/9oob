import type { NoobRequest } from "../src/transport/events.js";
import * as session from "../src/execution/session.js";
import type { Execution, WalletRequirement } from "@9oob/schema";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@9oob/schema";
import ts from "typescript";

export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Storage unavailable");
    this.data.set(key, value);
  }
}

type Element = { type: string; props: Record<string, any> };
export type RunState = {
  execution?: Execution;
  pendingSubmission?: session.PendingSubmission;
  busy: boolean;
  error?: string;
  visible: boolean;
};

export function providerHarness(options: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  storage?: MemoryStorage;
  connected?: boolean;
  nativeAccount?: string;
  evmSend?: () => Promise<string>;
  nativeSend?: (transaction: unknown) => Promise<{ transactionId: string }>;
  connect?: (requirement?: WalletRequirement) => void | Promise<unknown>;
  chainId?: number;
  switchChain?: (chainId: number) => Promise<unknown>;
  evmReady?: boolean;
  isConnecting?: boolean;
}) {
  const slots: Array<Record<string, any>> = [];
  let index = 0,
    dirty = true,
    effects: Array<() => void> = [],
    tree: unknown;
  let accept: ((request: NoobRequest) => void) | undefined;
  const timers: Array<{ id: number; run: () => void }> = [];
  let timerSequence = 0;
  const storage = options.storage ?? new MemoryStorage();
  const equal = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useMemo(fn: () => unknown, deps: unknown[]) {
      const i = index++;
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useState(initial: unknown) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: initial };
      return [
        slots[i].value,
        (value: any) => {
          slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
          dirty = true;
        },
      ];
    },
    useRef(initial: unknown) {
      const i = index++;
      if (!slots[i]) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = index++;
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn: () => (() => void) | undefined, deps: unknown[]) {
      const i = index++,
        previous = slots[i];
      if (!previous || !equal(previous.deps, deps)) {
        slots[i] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[i].cleanup?.();
          slots[i].cleanup = fn();
        });
      }
    },
  };
  const jsx = (type: any, props: any) => (typeof type === "function" ? type(props) : { type, props });
  class UnsignedTransfer {
    addHbarTransfer() {
      return this;
    }
    addTokenTransfer() {
      return this;
    }
  }
  const native = {
    sendTransaction:
      options.nativeSend ??
      (async () => {
        throw new Error("Unexpected native wallet call");
      }),
  };
  const wallet = {
    chain: { id: options.chainId ?? 84532 },
    sendTransaction:
      options.evmSend ??
      (async () => {
        throw new Error("Unexpected EVM wallet call");
      }),
  };
  const modules: Record<string, unknown> = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "@hiero-ledger/sdk": {
      AccountId: { fromString: (value: string) => value },
      TokenId: { fromString: (value: string) => value },
      Hbar: { fromTinybars: (value: string) => value },
      TransferTransaction: UnsignedTransfer,
    },
    "lucide-react": Object.fromEntries(
      ["ArrowRight", "ArrowUp", "ChevronDown", "Circle", "LoaderCircle", "Pencil", "Send", "X"].map(name => [
        name,
        name,
      ]),
    ),
    "@9oob/schema": schema,
    "./transport/events.js": {
      delay: (ms: number) =>
        new Promise(resolve => {
          timers.push({ id: ++timerSequence, run: () => resolve(undefined) });
        }),
      subscribeToNoobRequests: (fn: typeof accept) => {
        accept = fn;
        return () => {
          accept = undefined;
        };
      },
    },
    "./execution/session.js": session,
  };
  const cache = new Map<string, any>();
  const load = (filename: string): any => {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports,
      require: (name: string) => {
        if (name in modules) return modules[name];
        if (!name.startsWith(".")) throw new Error(`Unexpected import ${name}`);
        const base = resolve(dirname(filename), name.replace(/\.js$/, ""));
        let file = `${base}.ts`;
        try {
          readFileSync(file);
        } catch {
          file = `${base}.tsx`;
        }
        return load(file);
      },
      fetch: options.fetch,
      sessionStorage: storage,
      AbortController,
      setTimeout: (fn: () => void) => {
        const id = ++timerSequence;
        timers.push({ id, run: fn });
        return id;
      },
      clearTimeout: (id: number) => {
        const index = timers.findIndex(timer => timer.id === id);
        if (index !== -1) timers.splice(index, 1);
      },
    });
    return exports;
  };
  const provider = load(fileURLToPath(new URL("../src/modal/modal.tsx", import.meta.url)));
  const adapter = {
    accountId: options.nativeAccount ?? (options.connected === false ? null : `0x${"1".repeat(40)}`),
    nativeAccountId: options.nativeAccount,
    evmAddress: options.connected === false ? null : `0x${"1".repeat(40)}`,
    chainId: options.chainId ?? 84532,
    isConnecting: options.isConnecting,
    connect: options.connect ?? (() => undefined),
    nativeSend: native.sendTransaction,
    evmClient: options.evmReady === false ? undefined : wallet,
    switchChain: options.switchChain ?? (async () => undefined),
  };
  const render = () => {
    dirty = false;
    index = 0;
    effects = [];
    tree = provider.NoobProvider({ children: null, wallet: adapter });
    for (const effect of effects) effect();
  };
  const flush = async () => {
    for (let phase = 0; phase < 3; phase++) {
      for (let i = 0; i < 40; i++) {
        if (dirty) render();
        await Promise.resolve();
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  };
  const elements = (node: any, found: Element[] = []): Element[] => {
    if (Array.isArray(node)) node.forEach(value => elements(value, found));
    else if (node && typeof node === "object") {
      found.push(node);
      elements(node.props?.children, found);
    }
    return found;
  };
  const text = (node: any): string =>
    Array.isArray(node)
      ? node.map(text).join(" ")
      : node && typeof node === "object"
        ? text(node.props?.children)
        : typeof node === "string"
          ? node
          : "";
  return {
    storage,
    flush,
    async setWallet(accountId: string | null, evmAddress: string | null = null) {
      adapter.accountId = accountId;
      adapter.evmAddress = evmAddress;
      dirty = true;
      await flush();
    },
    async setChain(chainId: number) {
      wallet.chain.id = chainId;
      adapter.chainId = chainId;
      dirty = true;
      await flush();
    },
    async setConnecting(isConnecting: boolean) {
      adapter.isConnecting = isConnecting;
      dirty = true;
      await flush();
    },
    start(intent = "Bridge 1 USDC") {
      const result = {
        resolved: undefined as Execution | undefined,
        rejected: undefined as Error | undefined,
      };
      accept!({
        intent,
        resolve: value => {
          result.resolved = value;
        },
        reject: value => {
          result.rejected = value;
        },
      });
      return result;
    },
    state: () => slots.find(slot => slot?.value?.key !== undefined)?.value as RunState | undefined,
    nodes: () => elements(tree),
    buttons: () => elements(tree).filter(node => node.type === "button"),
    text: () => text(tree),
    async click(label: string) {
      const button = elements(tree).find(
        node => node.type === "button" && (text(node).trim() === label || node.props["aria-label"] === label),
      );
      if (!button || button.props.disabled) throw new Error(`Button unavailable: ${label}`);
      if (button.props.type === "submit") {
        const form = elements(tree).find(node => node.type === "form");
        form?.props.onSubmit({ preventDefault() {} });
      } else button.props.onClick();
      await flush();
    },
    async fillReply(value: string) {
      const input = elements(tree).find(node => node.type === "textarea" && node.props.id === "noob-reply");
      if (!input || input.props.disabled) throw new Error("Reply field unavailable");
      input.props.onChange({ target: { value } });
      await flush();
    },
    async tick() {
      timers.shift()?.run();
      await flush();
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}
