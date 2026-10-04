// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {TestnetConfig} from "../script/TestnetConfig.sol";
import {UlnConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";

interface ConfigVm {
    function chainId(uint256) external;
    function expectRevert() external;
}

contract TestnetConfigTest {
    ConfigVm private constant VM = ConfigVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testConfigEncodingMatchesLayerZeroUlnDecoder() public pure {
        address dvn = address(0x1234);
        UlnConfig memory config = abi.decode(TestnetConfig.ulnConfig(dvn), (UlnConfig));
        require(config.confirmations == 2 && config.requiredDVNCount == 1);
        require(config.requiredDVNs.length == 1 && config.requiredDVNs[0] == dvn);
        require(
            config.optionalDVNCount == type(uint8).max && config.optionalDVNs.length == 0
                && config.optionalDVNThreshold == 0
        );
    }

    function testNetworkTokenAndEndpointMappings() public {
        VM.chainId(296);
        TestnetConfig.Network memory hedera = TestnetConfig.current();
        require(hedera.remoteEid == 40245 && hedera.token == address(uint160(5449)));
        VM.chainId(84532);
        TestnetConfig.Network memory base = TestnetConfig.current();
        require(base.remoteEid == 40285 && base.token == 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        require(base.endpoint != hedera.endpoint && base.dvn != hedera.dvn);
        VM.chainId(1);
        VM.expectRevert();
        this.readConfig();
    }

    function readConfig() external view returns (TestnetConfig.Network memory) {
        return TestnetConfig.current();
    }
}
