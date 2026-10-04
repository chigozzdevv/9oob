import {
  HederaAdapter,
  extensionConnect,
  findExtensions,
  hederaNamespace,
  type ExtensionData,
} from "@hashgraph/hedera-wallet-connect";
import type { AdapterBlueprint } from "@reown/appkit-controllers";

export class NativeHederaAdapter extends HederaAdapter {
  private readonly extensions = new Map<string, ExtensionData>();
  private discoveryStarted = false;

  async syncConnectors() {
    if (this.discoveryStarted) return;
    this.discoveryStarted = true;
    findExtensions((metadata, isIframe) => {
      if (
        !metadata ||
        typeof metadata.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(metadata.id) ||
        this.extensions.has(metadata.id)
      )
        return;
      this.extensions.set(metadata.id, { ...metadata, availableInIframe: isIframe });
      this.addConnector({
        id: metadata.id,
        name: typeof metadata.name === "string" ? metadata.name.slice(0, 60) || "Hedera wallet" : "Hedera wallet",
        type: "INJECTED",
        chain: hederaNamespace,
        imageUrl: typeof metadata.icon === "string" ? metadata.icon : undefined,
        chains: this.getCaipNetworks(),
      });
    });
  }

  async connect(params: AdapterBlueprint.ConnectParams): Promise<AdapterBlueprint.ConnectResult> {
    const extension = this.extensions.get(params.id);
    if (!extension) return super.connect(params);
    const provider = this.getWalletConnectProvider();
    const launch = (uri: string) => extensionConnect(extension.id, extension.availableInIframe, uri);
    provider.on("display_uri", launch);
    try {
      const result = await super.connect({ ...params, type: "WALLET_CONNECT" });
      const account = provider.session?.namespaces.hedera?.accounts.find(value =>
        /^hedera:testnet:0\.0\.\d+$/.test(value),
      );
      if (!account) throw new Error("Choose a Hedera testnet account in your wallet");
      return { ...result, address: account.split(":")[2], chainId: "testnet" };
    } finally {
      provider.removeListener("display_uri", launch);
    }
  }

  async writeSolanaTransaction(): Promise<never> {
    throw new Error("This wallet adapter only supports Hedera");
  }
}
