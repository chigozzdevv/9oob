import { decodeAbiParameters, parseAbi, type Address, type Hex } from "viem";
import { TESTNET, type Network } from "@9oob/schema";
import type { EvmProvider } from "../evm/evm.client.js";

export const LAYERZERO_TESTNET = {
  hedera: {
    endpoint: "0xbd672d1562dd32c23b563c989d8140122483631d",
    sendLibrary: "0x1707575f7cecdc0ad53fde9ba9bda3ed5d4440f4",
    receiveLibrary: "0xc0c34919a04d69415ef2637a3db5d637a7126cd0",
    executor: "0xe514d331c54d7339108045bf4794f8d71cad110e",
    dvn: "0xec7ee1f9e9060e08df969dc08ee72674afd5e14d",
  },
  base: {
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    sendLibrary: "0xc1868e054425d378095a003ecba3823a5d0135c9",
    receiveLibrary: "0x12523de19dc41c91f7d2093e0cfbb76b17012c8d",
    executor: "0x8a3d588d9f6ac041476b094f97ff94ec30169d3d",
    dvn: "0xe1a12515f9ab2764b887bf60b923ca494ebbb2d6",
  },
} as const;
export const endpointAbi = parseAbi([
  "function getSendLibrary(address oapp, uint32 eid) view returns (address)",
  "function getReceiveLibrary(address oapp, uint32 eid) view returns (address, bool)",
  "function getConfig(address oapp, address lib, uint32 eid, uint32 configType) view returns (bytes)",
]);
export const ulnType = [
  {
    type: "tuple",
    components: [
      { name: "confirmations", type: "uint64" },
      { name: "requiredDVNCount", type: "uint8" },
      { name: "optionalDVNCount", type: "uint8" },
      { name: "optionalDVNThreshold", type: "uint8" },
      { name: "requiredDVNs", type: "address[]" },
      { name: "optionalDVNs", type: "address[]" },
    ],
  },
] as const;
const executorType = [
  {
    type: "tuple",
    components: [
      { name: "maxMessageSize", type: "uint32" },
      { name: "executor", type: "address" },
    ],
  },
] as const;

export async function assertLayerZeroPath(rpc: EvmProvider, network: Network, bridge: Address): Promise<void> {
  const config = LAYERZERO_TESTNET[network],
    eid = TESTNET[network === "hedera" ? "base" : "hedera"].eid;
  const send = await rpc.read<Address>(config.endpoint, endpointAbi, "getSendLibrary", [bridge, eid]);
  const [receive] = await rpc.read<[Address, boolean]>(config.endpoint, endpointAbi, "getReceiveLibrary", [
    bridge,
    eid,
  ]);
  if (send.toLowerCase() !== config.sendLibrary || receive.toLowerCase() !== config.receiveLibrary)
    throw new Error("The LayerZero testnet messaging libraries are not configured correctly");
  for (const library of [send, receive]) {
    const encoded = await rpc.read<Hex>(config.endpoint, endpointAbi, "getConfig", [bridge, library, eid, 2]);
    const [uln] = decodeAbiParameters(ulnType, encoded);
    if (
      uln.confirmations !== 2n ||
      uln.requiredDVNCount !== 1 ||
      uln.requiredDVNs.length !== 1 ||
      uln.requiredDVNs[0].toLowerCase() !== config.dvn ||
      ![0, 255].includes(uln.optionalDVNCount) ||
      uln.optionalDVNs.length !== 0 ||
      uln.optionalDVNThreshold !== 0
    )
      throw new Error("The LayerZero testnet verifier configuration is incorrect");
  }
  const [executor] = decodeAbiParameters(
    executorType,
    await rpc.read<Hex>(config.endpoint, endpointAbi, "getConfig", [bridge, send, eid, 1]),
  );
  if (executor.executor.toLowerCase() !== config.executor || executor.maxMessageSize < 64)
    throw new Error("The LayerZero testnet executor configuration is incorrect");
}
