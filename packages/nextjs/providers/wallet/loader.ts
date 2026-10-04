import type { NoobWallet } from "@9oob/sdk";

export type WalletConnection = { wallet: NoobWallet; connectorId?: string };
export type WalletProviderProps = { onChange: (connection: WalletConnection) => void };

export function createWalletLoader(start: () => Promise<void>, onError: () => void, timeoutMs = 30_000) {
  let current: NoobWallet | null = null;
  let pending: {
    promise: Promise<NoobWallet>;
    resolve: (wallet: NoobWallet) => void;
    reject: (error: unknown) => void;
  } | null = null;

  function load(): Promise<NoobWallet> {
    if (current) return Promise.resolve(current);
    if (pending) return pending.promise;
    let resolve!: (wallet: NoobWallet) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<NoobWallet>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const timer = setTimeout(() => fail(new Error("Wallet loading timed out. Please try again.")), timeoutMs);
    pending = {
      promise,
      resolve: wallet => {
        clearTimeout(timer);
        resolve(wallet);
      },
      reject: error => {
        clearTimeout(timer);
        reject(error);
      },
    };
    function fail(error: unknown) {
      if (pending?.promise !== promise) return;
      pending.reject(error);
      pending = null;
      onError();
    }
    void start().catch(fail);
    return promise;
  }

  const wallet: NoobWallet = {
    accountId: null,
    evmAddress: null,
    isConnecting: true,
    connect: async requirement => (await load()).connect(requirement),
    nativeSend: async transaction => (await load()).nativeSend(transaction),
    switchChain: async chainId => (await load()).switchChain(chainId),
  };

  return {
    load,
    publish(wallet: NoobWallet) {
      current = wallet;
      pending?.resolve(wallet);
      pending = null;
    },
    dispose() {
      pending?.reject(new Error("Wallet loading cancelled"));
      pending = null;
      current = null;
    },
    wallet,
  };
}
