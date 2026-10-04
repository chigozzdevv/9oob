// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {NoobBridge} from "../src/NoobBridge.sol";
import {TestnetConfig} from "./TestnetConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

interface ScriptVm {
    function envAddress(string calldata) external returns (address);
    function envUint(string calldata) external returns (uint256);
    function envOr(string calldata, uint256) external returns (uint256);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
}

contract BridgeScript {
    ScriptVm private constant vm = ScriptVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event Deployed(uint256 indexed chainId, address indexed bridge, address token);

    function deploy() external returns (NoobBridge bridge) {
        TestnetConfig.Network memory config = TestnetConfig.current();
        address owner = vm.envAddress("BRIDGE_OWNER");
        uint256 value = vm.envOr("BRIDGE_DEPLOY_VALUE", uint256(0));
        vm.startBroadcast(vm.envUint("BRIDGE_DEPLOYER_KEY"));
        bridge = new NoobBridge{value: value}(config.endpoint, owner, config.token);
        vm.stopBroadcast();
        emit Deployed(block.chainid, address(bridge), config.token);
    }

    function wire() external {
        TestnetConfig.Network memory config = TestnetConfig.current();
        NoobBridge bridge = NoobBridge(vm.envAddress("BRIDGE_ADDRESS"));
        address remote = vm.envAddress("REMOTE_BRIDGE_ADDRESS");
        require(
            address(bridge.endpoint()) == config.endpoint && address(bridge.token()) == config.token, "Wrong deployment"
        );
        bytes memory uln = TestnetConfig.ulnConfig(config.dvn);
        SetConfigParam[] memory send = new SetConfigParam[](2);
        send[0] = SetConfigParam(config.remoteEid, 1, abi.encode(uint32(10_000), config.executor));
        send[1] = SetConfigParam(config.remoteEid, 2, uln);
        SetConfigParam[] memory receiveConfig = new SetConfigParam[](1);
        receiveConfig[0] = SetConfigParam(config.remoteEid, 2, uln);
        vm.startBroadcast(vm.envUint("BRIDGE_DEPLOYER_KEY"));
        bridge.setPeer(config.remoteEid, bytes32(uint256(uint160(remote))));
        IMessageLibManager endpoint = IMessageLibManager(config.endpoint);
        endpoint.setSendLibrary(address(bridge), config.remoteEid, config.sendLibrary);
        endpoint.setReceiveLibrary(address(bridge), config.remoteEid, config.receiveLibrary, 0);
        endpoint.setConfig(address(bridge), config.sendLibrary, send);
        endpoint.setConfig(address(bridge), config.receiveLibrary, receiveConfig);
        vm.stopBroadcast();
    }

    function fund() external {
        TestnetConfig.Network memory config = TestnetConfig.current();
        NoobBridge bridge = NoobBridge(vm.envAddress("BRIDGE_ADDRESS"));
        uint256 amount = vm.envUint("BRIDGE_FUND_AMOUNT");
        require(address(bridge.token()) == config.token && amount > 0, "Wrong token or amount");
        vm.startBroadcast(vm.envUint("BRIDGE_DEPLOYER_KEY"));
        require(IERC20(config.token).approve(address(bridge), amount), "Approval failed");
        bridge.fund(amount);
        vm.stopBroadcast();
    }
}
