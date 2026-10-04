// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;
import {UlnConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";

library TestnetConfig {
    function ulnConfig(address dvn) internal pure returns (bytes memory) {
        address[] memory required = new address[](1);
        required[0] = dvn;
        return abi.encode(
            UlnConfig({
                confirmations: 2,
                requiredDVNCount: 1,
                optionalDVNCount: type(uint8).max,
                optionalDVNThreshold: 0,
                requiredDVNs: required,
                optionalDVNs: new address[](0)
            })
        );
    }

    struct Network {
        address endpoint;
        address token;
        address sendLibrary;
        address receiveLibrary;
        address executor;
        address dvn;
        uint32 remoteEid;
    }

    function current() internal view returns (Network memory config) {
        if (block.chainid == 296) {
            return Network(
                0xbD672D1562Dd32C23B563C989d8140122483631d,
                address(uint160(5449)),
                0x1707575F7cEcdC0Ad53fde9ba9bda3Ed5d4440f4,
                0xc0c34919A04d69415EF2637A3Db5D637a7126cd0,
                0xe514D331c54d7339108045bF4794F8d71cad110e,
                0xEc7Ee1f9e9060e08dF969Dc08EE72674AfD5E14D,
                40245
            );
        }
        if (block.chainid == 84532) {
            return Network(
                0x6EDCE65403992e310A62460808c4b910D972f10f,
                0x036CbD53842c5426634e7929541eC2318f3dCF7e,
                0xC1868e054425D378095A003EcbA3823a5D0135C9,
                0x12523de19dc41c91F7d2093E0CFbB76b17012C8d,
                0x8A3D588D9f6AC041476b094f97FF94ec30169d3D,
                0xe1a12515F9AB2764b887bF60B923Ca494EBbB2d6,
                40285
            );
        }
        revert("Only Hedera testnet and Base Sepolia are allowed");
    }
}
