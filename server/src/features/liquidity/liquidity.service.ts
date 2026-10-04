import { parseAbi, type Address } from "viem";
import { LiquiditySnapshotSchema, type LiquiditySnapshot } from "./liquidity.model.js";
import { LayerZeroProvider } from "../../shared/integration/layerzero/layerzero.provider.js";
import { tokenAddress } from "../../shared/integration/evm/token.js";
import { formatTokenAmount } from "../../shared/integration/amounts.js";

const poolAbi = parseAbi([
  "function token() view returns (address)",
  "function availableLiquidity() view returns (uint256)",
  "function reserved() view returns (uint256)",
  "function paused() view returns (bool)",
]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export class LiquidityService {
  private cached?: LiquiditySnapshot;
  private pending?: Promise<LiquiditySnapshot>;
  private expiresAt = 0;

  constructor(
    private readonly bridges = new LayerZeroProvider(),
    private readonly now = Date.now,
  ) {}

  async read(): Promise<LiquiditySnapshot> {
    if (this.cached && this.now() < this.expiresAt) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try {
      this.cached = await this.pending;
      this.expiresAt = this.now() + 15_000;
      return this.cached;
    } finally {
      this.pending = undefined;
    }
  }

  private async load(): Promise<LiquiditySnapshot> {
    const pools = await Promise.all(
      (["hedera", "base"] as const).map(async network => {
        const rpc = this.bridges.clients[network];
        const bridgeAddress = this.bridges.address(network);
        await rpc.assertContract(bridgeAddress);
        const token = await rpc.read<Address>(bridgeAddress, poolAbi, "token");
        if (token.toLowerCase() !== tokenAddress(network, "USDC").toLowerCase())
          throw new Error("The bridge pool uses an unexpected token");
        const [total, available, reserved, paused] = await Promise.all([
          rpc.read<bigint>(token, tokenAbi, "balanceOf", [bridgeAddress]),
          rpc.read<bigint>(bridgeAddress, poolAbi, "availableLiquidity"),
          rpc.read<bigint>(bridgeAddress, poolAbi, "reserved"),
          rpc.read<boolean>(bridgeAddress, poolAbi, "paused"),
        ]);
        return {
          network,
          bridgeAddress,
          tokenAddress: token,
          totalUSDC: formatTokenAmount(total, 6),
          availableUSDC: formatTokenAmount(available, 6),
          reservedUSDC: formatTokenAmount(reserved, 6),
          paused,
        };
      }),
    );
    return LiquiditySnapshotSchema.parse({ observedAt: new Date(this.now()).toISOString(), pools });
  }
}
