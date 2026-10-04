import { EvmAddressSchema, TESTNET, TESTNET_TOKENS, type IntentAction, type Network, type Review } from "@9oob/schema";
import { decodeEventLog, encodeFunctionData, parseAbi, pad, type Address, type Hex } from "viem";
import { assertLayerZeroPath, LAYERZERO_TESTNET } from "./layerzero.config.js";
import { EvmProvider, type RpcLog } from "../evm/evm.client.js";
import { association, tokenAddress, tokenApproval } from "../evm/token.js";
import { formatTokenAmount, parseTokenAmount } from "../amounts.js";
import { ReviewRequiredError, type RoutePreparation } from "../provider.types.js";

export const bridgeAbi = parseAbi([
  "function token() view returns (address)",
  "function remoteEid() view returns (uint32)",
  "function endpoint() view returns (address)",
  "function peers(uint32) view returns (bytes32)",
  "function paused() view returns (bool)",
  "function maxBridgeAmount() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function quoteBridge(uint256 amount, address recipient) view returns (uint256)",
  "function bridge(uint256 amount, address recipient) payable returns (bytes32)",
  "function claim(bytes32 guid)",
  "function payouts(bytes32) view returns (address recipient, uint256 amount, bool paid)",
  "event BridgeSent(bytes32 indexed guid, uint32 destinationEid, address indexed sender, address indexed recipient, uint256 amount)",
  "event BridgePaid(bytes32 indexed guid, address indexed recipient, uint256 amount)",
]);
type Bridge = Extract<IntentAction, { kind: "bridge" }>;
export type Settlement = {
  status: "pending" | "completed";
  destinationTxHash?: string;
  claimReady?: boolean;
  context?: Record<string, unknown>;
};

export class LayerZeroProvider {
  constructor(
    readonly clients = { hedera: new EvmProvider("hedera"), base: new EvmProvider("base") },
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  address(network: Network): Address {
    const value = this.env[network === "hedera" ? "NOOB_HEDERA_BRIDGE_ADDRESS" : "NOOB_BASE_BRIDGE_ADDRESS"];
    if (!value)
      throw new Error("The testnet USDC bridge must be deployed and configured before this route is available");
    return EvmAddressSchema.parse(value) as Address;
  }

  async check(action: Bridge) {
    if (action.sourceNetwork === action.destinationNetwork) throw new Error("A bridge requires different testnets");
    const source = this.address(action.sourceNetwork),
      destination = this.address(action.destinationNetwork);
    const amount = parseTokenAmount(action.amount, 6);
    const recipient = EvmAddressSchema.parse(action.recipient) as Address;
    if (BigInt(recipient) === 0n || recipient.toLowerCase() === destination.toLowerCase())
      throw new Error("Choose a valid recipient wallet");
    for (const network of [action.sourceNetwork, action.destinationNetwork]) {
      const rpc = this.clients[network],
        address = this.address(network);
      const other = network === "hedera" ? "base" : "hedera";
      await rpc.assertContract(address);
      const [token, eid, endpoint, peer, paused] = await Promise.all([
        rpc.read<Address>(address, bridgeAbi, "token"),
        rpc.read<number>(address, bridgeAbi, "remoteEid"),
        rpc.read<Address>(address, bridgeAbi, "endpoint"),
        rpc.read<Hex>(address, bridgeAbi, "peers", [TESTNET[other].eid]),
        rpc.read<boolean>(address, bridgeAbi, "paused"),
      ]);
      if (
        token.toLowerCase() !== tokenAddress(network, "USDC").toLowerCase() ||
        eid !== TESTNET[other].eid ||
        endpoint.toLowerCase() !== LAYERZERO_TESTNET[network].endpoint ||
        peer.toLowerCase() !== pad(this.address(other)).toLowerCase()
      )
        throw new Error("The testnet bridge token, endpoint or peer configuration is incorrect");
      if (paused) throw new Error("The testnet bridge is paused");
      await assertLayerZeroPath(rpc, network, address);
    }
    const capacity = await this.clients[action.destinationNetwork].read<bigint>(
      destination,
      bridgeAbi,
      "availableLiquidity",
    );
    const limit = await this.clients[action.sourceNetwork].read<bigint>(source, bridgeAbi, "maxBridgeAmount");
    if (capacity < amount || limit < amount)
      throw new Error("The destination bridge pool has insufficient test USDC capacity");
    const fee = await this.clients[action.sourceNetwork].read<bigint>(source, bridgeAbi, "quoteBridge", [
      amount,
      recipient,
    ]);
    if (fee <= 0n) throw new Error("LayerZero returned an invalid messaging fee");
    return { source, destination, amount, recipient, fee };
  }

  async review(action: Bridge): Promise<Review> {
    const checked = await this.check(action);
    return {
      title: `Bridge ${action.amount} USDC to USDC`,
      facts: [
        `To: ${checked.recipient}`,
        `Network fee: ${formatTokenAmount((checked.fee * 110n + 99n) / 100n, action.sourceNetwork === "hedera" ? 8 : 18)} ${action.sourceNetwork === "hedera" ? "HBAR" : "ETH"} maximum`,
        `Source token: ${action.sourceNetwork === "hedera" ? TESTNET_TOKENS.hederaUsdc : TESTNET_TOKENS.baseUsdc}`,
        `Destination token: ${action.destinationNetwork === "hedera" ? TESTNET_TOKENS.hederaUsdc : TESTNET_TOKENS.baseUsdc}`,
        "Testnet pool payout",
      ],
      quote: { amountRaw: checked.amount.toString(), amountDecimals: 6, amountSymbol: "USDC" },
    };
  }

  async prepare(action: Bridge, address: string, reviewed: Review | null): Promise<RoutePreparation> {
    const sender = EvmAddressSchema.parse(address) as Address;
    const checked = await this.check(action);
    const network = action.sourceNetwork,
      rpc = this.clients[network];
    const maximumFee = reviewed?.facts
      .find(fact => fact.startsWith("Network fee: "))
      ?.match(/^Network fee: ([\d.]+) (HBAR|ETH) maximum$/);
    if (
      !maximumFee ||
      maximumFee[2] !== (network === "hedera" ? "HBAR" : "ETH") ||
      checked.fee > parseTokenAmount(maximumFee[1], network === "hedera" ? 8 : 18)
    )
      throw new ReviewRequiredError(await this.review(action));
    const context = {
      provider: "layerzero",
      sourceNetwork: network,
      destinationNetwork: action.destinationNetwork,
      sourceBridge: checked.source,
      destinationBridge: checked.destination,
      sourceChainKey: network,
      recipient: checked.recipient,
      amountRaw: checked.amount.toString(),
      sourceAddress: sender,
      scanFrom: await this.clients[action.destinationNetwork].rpc<Hex>("eth_blockNumber", []),
    };
    const receiverAssociation = await association(
      this.clients[action.destinationNetwork],
      tokenAddress(action.destinationNetwork, "USDC"),
      checked.recipient,
    );
    if (receiverAssociation) {
      if (checked.recipient.toLowerCase() !== sender.toLowerCase())
        throw new Error("The Hedera recipient must associate the configured test USDC before bridging");
      await this.clients[action.destinationNetwork].simulate(receiverAssociation);
      return {
        phase: "association",
        label: "Enable test USDC",
        transaction: receiverAssociation,
        context: { ...context, sourceChainKey: action.destinationNetwork },
      };
    }
    const approval = await tokenApproval(rpc, tokenAddress(network, "USDC"), checked.source, sender, checked.amount);
    if (approval) {
      await rpc.simulate(approval);
      return { phase: "approval", label: "Approve test USDC", transaction: approval, context };
    }
    const transaction = {
      from: sender,
      to: checked.source,
      data: encodeFunctionData({ abi: bridgeAbi, functionName: "bridge", args: [checked.amount, checked.recipient] }),
      value: (checked.fee * (network === "hedera" ? 10n ** 10n : 1n)).toString(),
    };
    await rpc.simulate(transaction);
    return { phase: "source", label: "Confirm bridge", transaction, context };
  }

  async prepareClaim(context: Record<string, unknown>): Promise<RoutePreparation> {
    const network = context.destinationNetwork as Network;
    const transaction = {
      from: EvmAddressSchema.parse(context.sourceAddress) as Address,
      to: this.address(network),
      data: encodeFunctionData({ abi: bridgeAbi, functionName: "claim", args: [context.guid as Hex] }),
      value: "0",
    };
    await this.clients[network].simulate(transaction);
    return {
      phase: "source",
      label: "Claim bridge payout",
      transaction,
      context: { ...context, stage: "claim", sourceChainKey: network },
    };
  }

  async status(context: Record<string, unknown>, sourceHash: string): Promise<Settlement> {
    const sourceNetwork = context.sourceNetwork as Network,
      destinationNetwork = context.destinationNetwork as Network;
    let guid = context.guid as Hex | undefined;
    if (!guid) {
      const receipt = await this.clients[sourceNetwork].receipt(sourceHash);
      if (!receipt || receipt.status !== "0x1") return { status: "pending" };
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== String(context.sourceBridge).toLowerCase()) continue;
        try {
          const event = decodeEventLog({ abi: bridgeAbi, data: log.data, topics: log.topics });
          if (event.eventName !== "BridgeSent") continue;
          const args = event.args;
          if (
            args.sender.toLowerCase() !== String(context.sourceAddress).toLowerCase() ||
            args.recipient.toLowerCase() !== String(context.recipient).toLowerCase() ||
            args.amount !== BigInt(String(context.amountRaw)) ||
            args.destinationEid !== TESTNET[destinationNetwork].eid
          )
            throw new Error("Bridge source event does not match the reviewed route");
          guid = args.guid;
          break;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("Bridge source")) throw error;
        }
      }
      if (!guid) throw new Error("The bridge source receipt has no matching LayerZero message");
    }
    const rpc = this.clients[destinationNetwork],
      bridge = this.address(destinationNetwork);
    const [recipient, amount, paid] = await rpc.read<[Address, bigint, boolean]>(bridge, bridgeAbi, "payouts", [guid]);
    const nextContext = { ...context, guid, bridgeSourceHash: context.bridgeSourceHash ?? sourceHash };
    if (BigInt(recipient) === 0n) return { status: "pending", context: nextContext };
    if (
      recipient.toLowerCase() !== String(context.recipient).toLowerCase() ||
      amount !== BigInt(String(context.amountRaw))
    )
      throw new Error("The destination payout does not match the source message");
    if (!paid) {
      const balance = await rpc.read<bigint>(
        tokenAddress(destinationNetwork, "USDC"),
        parseAbi(["function balanceOf(address) view returns (uint256)"]),
        "balanceOf",
        [bridge],
      );
      const paused = await rpc.read<boolean>(bridge, bridgeAbi, "paused");
      return { status: "pending", context: nextContext, claimReady: !paused && balance >= amount };
    }
    const head = BigInt(await rpc.rpc<Hex>("eth_blockNumber", []));
    let start = BigInt(String(context.scanFrom));
    const stop = head < start + 999n ? head : start + 999n;
    if (start > head) return { status: "pending", context: nextContext };
    const logs = await rpc.rpc<RpcLog[]>("eth_getLogs", [
      { address: bridge, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${stop.toString(16)}` },
    ]);
    for (const log of logs) {
      try {
        const event = decodeEventLog({ abi: bridgeAbi, data: log.data, topics: log.topics });
        if (event.eventName !== "BridgePaid" || event.args.guid !== guid) continue;
        if (
          event.args.recipient.toLowerCase() !== recipient.toLowerCase() ||
          event.args.amount !== amount ||
          !log.transactionHash
        )
          throw new Error("Invalid destination bridge event");
        const receipt = await rpc.receipt(log.transactionHash);
        if (!receipt || receipt.status !== "0x1") return { status: "pending", context: nextContext };
        if (
          !receipt.logs.some(
            proof =>
              proof.address.toLowerCase() === bridge.toLowerCase() &&
              proof.data === log.data &&
              proof.topics.join().toLowerCase() === log.topics.join().toLowerCase(),
          )
        )
          throw new Error("Invalid destination bridge event");
        if (destinationNetwork === "base" && head < BigInt(receipt.blockNumber) + 1n)
          return { status: "pending", context: nextContext };
        return { status: "completed", destinationTxHash: log.transactionHash, context: nextContext };
      } catch (error) {
        if (error instanceof Error && error.message === "Invalid destination bridge event") throw error;
      }
    }
    start = stop + 1n;
    return { status: "pending", context: { ...nextContext, scanFrom: `0x${start.toString(16)}` } };
  }
}
