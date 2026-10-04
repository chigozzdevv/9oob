import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbi,
  pad,
  type Hex,
  type Address,
  type Abi,
} from "viem";
import { TESTNET, type Network } from "@9oob/schema";
import { clients, wallets, root, readJson, saveJson, send, safeError } from "./testnet-chain.mjs";
import {
  LAYERZERO_TESTNET,
  endpointAbi,
  ulnType,
  assertLayerZeroPath,
} from "../src/shared/integration/layerzero/layerzero.config.js";
import { bridgeAbi } from "../src/shared/integration/layerzero/layerzero.provider.js";
import { tokenAbi, tokenAddress } from "../src/shared/integration/evm/token.js";
import { formatTokenAmount } from "../src/shared/integration/amounts.js";

const networks = ["hedera", "base"] as const;
if (!process.argv.includes("--broadcast")) throw new Error("Deployment requires an explicit --broadcast flag");
const adminAbi = parseAbi([
  "function setPeer(uint32 eid, bytes32 peer)",
  "function fund(uint256 amount)",
  "function owner() view returns (address)",
]);
const managerAbi = parseAbi([
  "function setSendLibrary(address oapp, uint32 eid, address lib)",
  "function setReceiveLibrary(address oapp, uint32 eid, address lib, uint256 gracePeriod)",
  "function setConfig(address oapp, address lib, (uint32 eid, uint32 configType, bytes config)[] params)",
]);
const manifest = readJson("contract/deployments/testnet.json");
const artifact = JSON.parse(readFileSync(resolve(root, "contract/out/NoobBridge.sol/NoobBridge.json"), "utf8"));
const updateEnv = (network: Network, address: string, remote: string) => {
  const path = resolve(root, `contract/.secrets/${network}.env`);
  let content = readFileSync(path, "utf8");
  for (const [key, value] of Object.entries({
    BRIDGE_ADDRESS: address,
    REMOTE_BRIDGE_ADDRESS: remote,
    BRIDGE_FUND_AMOUNT: "10000000",
    BRIDGE_DEPLOY_VALUE: network === "hedera" ? "1000000000000000000" : "0",
  }))
    content = content.match(new RegExp(`^${key}=`, "m"))
      ? content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
      : `${content}\n${key}=${value}\n`;
  writeFileSync(path, content, { mode: 0o600 });
};

try {
  for (const network of networks) {
    const config = LAYERZERO_TESTNET[network],
      rpc = clients[network];
    if (!manifest[network].bridgeAddress) {
      const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
        args: [config.endpoint, wallets[network].address, tokenAddress(network, "USDC")],
      });
      const receipt = await send(`deploy-${network}`, network, network, {
        data,
        value: network === "hedera" ? "1000000000000000000" : "0",
      });
      if (!receipt.contractAddress) throw new Error(`Deployment receipt has no contract address: ${network}`);
      manifest[network].bridgeAddress = receipt.contractAddress;
      manifest[network].deploymentTxHash = receipt.transactionHash;
      manifest.status = "deployed-partial";
      saveJson("contract/deployments/testnet.json", manifest);
    }
    const bridge = manifest[network].bridgeAddress as Address;
    await rpc.assertContract(bridge);
    const [token, endpoint, owner] = await Promise.all([
      rpc.read<Address>(bridge, bridgeAbi, "token"),
      rpc.read<Address>(bridge, bridgeAbi, "endpoint"),
      rpc.read<Address>(bridge, adminAbi, "owner"),
    ]);
    if (
      token.toLowerCase() !== tokenAddress(network, "USDC").toLowerCase() ||
      endpoint.toLowerCase() !== config.endpoint ||
      owner.toLowerCase() !== wallets[network].address.toLowerCase()
    )
      throw new Error(`Deployment configuration mismatch: ${network}`);
    console.log(JSON.stringify({ network, bridge, status: "deployed-and-verified" }));
  }
  for (const network of networks) {
    const other = network === "hedera" ? "base" : "hedera";
    const bridge = manifest[network].bridgeAddress as Address,
      remote = manifest[other].bridgeAddress as Address;
    const config = LAYERZERO_TESTNET[network],
      eid = TESTNET[other].eid;
    updateEnv(network, bridge, remote);
    const call = async (id: string, to: Address, abi: Abi, name: string, args: unknown[]) =>
      send(`${network}-${id}`, network, network, {
        to,
        data: encodeFunctionData({ abi, functionName: name, args }),
        value: "0",
      });
    await call("peer", bridge, adminAbi, "setPeer", [eid, pad(remote)]);
    await call("send-library", config.endpoint, managerAbi, "setSendLibrary", [bridge, eid, config.sendLibrary]);
    await call("receive-library", config.endpoint, managerAbi, "setReceiveLibrary", [
      bridge,
      eid,
      config.receiveLibrary,
      0n,
    ]);
    const uln = encodeAbiParameters(ulnType, [
      {
        confirmations: 2n,
        requiredDVNCount: 1,
        optionalDVNCount: 255,
        optionalDVNThreshold: 0,
        requiredDVNs: [config.dvn],
        optionalDVNs: [],
      },
    ]);
    const executor = encodeAbiParameters([{ type: "uint32" }, { type: "address" }], [10000, config.executor]);
    await call("send-config", config.endpoint, managerAbi, "setConfig", [
      bridge,
      config.sendLibrary,
      [
        { eid, configType: 1, config: executor },
        { eid, configType: 2, config: uln },
      ],
    ]);
    await call("receive-config", config.endpoint, managerAbi, "setConfig", [
      bridge,
      config.receiveLibrary,
      [{ eid, configType: 2, config: uln }],
    ]);
    await assertLayerZeroPath(clients[network], network, bridge);
    const peer = await clients[network].read<Hex>(bridge, bridgeAbi, "peers", [eid]);
    if (peer.toLowerCase() !== pad(remote).toLowerCase()) throw new Error("Reciprocal peer verification failed");
    manifest[network].configured = true;
    saveJson("contract/deployments/testnet.json", manifest);
    await call("fund-approval", tokenAddress(network, "USDC"), tokenAbi, "approve", [bridge, 10_000_000n]);
    await call("fund-pool", bridge, adminAbi, "fund", [10_000_000n]);
    const liquidity = await clients[network].read<bigint>(bridge, bridgeAbi, "availableLiquidity");
    if (liquidity < 10_000_000n) throw new Error("Funded pool balance is insufficient");
    manifest[network].initialFundingUSDC = "10";
    manifest[network].funded = true;
    saveJson("contract/deployments/testnet.json", manifest);
    console.log(
      JSON.stringify({
        network,
        bridge,
        availableUSDC: formatTokenAmount(liquidity, 6),
        status: "configured-and-funded",
      }),
    );
  }
  manifest.status = "configured-and-funded";
  manifest.updatedAt = new Date().toISOString();
  saveJson("contract/deployments/testnet.json", manifest);
  const envPath = resolve(root, "server/.env");
  let content = readFileSync(envPath, "utf8");
  for (const [key, value] of Object.entries({
    NOOB_HEDERA_BRIDGE_ADDRESS: manifest.hedera.bridgeAddress,
    NOOB_BASE_BRIDGE_ADDRESS: manifest.base.bridgeAddress,
  }))
    content = content.match(new RegExp(`^${key}=`, "m"))
      ? content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
      : `${content}\n${key}=${value}\n`;
  writeFileSync(envPath, content, { mode: 0o600 });
  console.log("Both testnet deployments are configured and funded; server bridge addresses saved.");
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
