// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {NoobBridge} from "../src/NoobBridge.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    Origin,
    MessagingParams,
    MessagingFee,
    MessagingReceipt
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

interface TestVm {
    function chainId(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract TokenFixture is ERC20 {
    bool public chargeFee;
    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function associate() external pure returns (int64) {
        return 22;
    }

    function setFee(bool enabled) external {
        chargeFee = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (chargeFee && from != address(0) && to != address(0)) {
            super._update(from, address(0), 1);
            super._update(from, to, value - 1);
        } else {
            super._update(from, to, value);
        }
    }
}

contract EndpointFixture {
    uint64 public nonce;
    bytes public lastMessage;
    bytes32 public lastGuid;
    bool public failSend;
    function setDelegate(address) external {}

    function setFailure(bool enabled) external {
        failSend = enabled;
    }

    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) {
        return MessagingFee(100, 0);
    }

    function send(MessagingParams calldata params, address) external payable returns (MessagingReceipt memory) {
        require(!failSend && msg.value == 100, "send failed");
        lastMessage = params.message;
        lastGuid = keccak256(abi.encode(msg.sender, ++nonce, params.dstEid, params.message));
        return MessagingReceipt(lastGuid, nonce, MessagingFee(100, 0));
    }

    function deliver(NoobBridge target, Origin calldata origin, bytes32 guid, bytes calldata message) external {
        target.lzReceive(origin, guid, message, address(this), "");
    }
}

contract NoobBridgeTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    EndpointFixture private endpoint;
    TokenFixture private token;
    NoobBridge private bridge;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    bytes32 private constant PEER = bytes32(uint256(uint160(address(0x1234))));

    function setUp() public {
        vm.chainId(84532);
        endpoint = new EndpointFixture();
        token = new TokenFixture();
        bridge = new NoobBridge(address(endpoint), address(this), address(token));
        bridge.setPeer(40285, PEER);
        token.mint(address(this), 2_000_000e6);
        token.approve(address(bridge), type(uint256).max);
        token.mint(ALICE, 1_000_000e6);
        vm.prank(ALICE);
        token.approve(address(bridge), type(uint256).max);
        vm.deal(ALICE, 1 ether);
    }

    function origin() private pure returns (Origin memory) {
        return Origin(40285, PEER, 1);
    }

    function receiveMessage(bytes32 guid, uint256 amount) private {
        endpoint.deliver(bridge, origin(), guid, abi.encode(BOB, amount));
    }

    function testLocksExactSourceAmountAndSendsMessage() public {
        uint256 beforeBalance = token.balanceOf(ALICE);
        require(bridge.quoteBridge(10e6, BOB) == 100);
        vm.prank(ALICE);
        bytes32 guid = bridge.bridge{value: 100}(10e6, BOB);
        require(
            guid == endpoint.lastGuid() && token.balanceOf(ALICE) == beforeBalance - 10e6
                && token.balanceOf(address(bridge)) == 10e6
        );
        (address recipient, uint256 amount) = abi.decode(endpoint.lastMessage(), (address, uint256));
        require(recipient == BOB && amount == 10e6);
    }

    function testSourceFailureRollsBackCollectedFunds() public {
        endpoint.setFailure(true);
        uint256 beforeBalance = token.balanceOf(ALICE);
        vm.expectRevert();
        vm.prank(ALICE);
        bridge.bridge{value: 100}(10e6, BOB);
        require(token.balanceOf(ALICE) == beforeBalance && token.balanceOf(address(bridge)) == 0);
    }

    function testPaysFromFundedPoolExactlyOnce() public {
        bridge.fund(100e6);
        receiveMessage(bytes32(uint256(1)), 10e6);
        require(token.balanceOf(BOB) == 10e6 && bridge.reserved() == 0);
        (, uint256 amount, bool paid) = bridge.payouts(bytes32(uint256(1)));
        require(amount == 10e6 && paid);
        vm.expectRevert(NoobBridge.DuplicateMessage.selector);
        receiveMessage(bytes32(uint256(1)), 10e6);
        vm.expectRevert(NoobBridge.UnavailablePayout.selector);
        bridge.claim(bytes32(uint256(1)));
        require(token.balanceOf(BOB) == 10e6);
    }

    function testRejectsCallsOutsideEndpointAndConfiguredPeer() public {
        vm.expectRevert();
        bridge.lzReceive(origin(), bytes32(uint256(1)), abi.encode(BOB, 10e6), address(this), "");
        vm.expectRevert();
        endpoint.deliver(bridge, Origin(40285, bytes32(uint256(9)), 1), bytes32(uint256(1)), abi.encode(BOB, 10e6));
        vm.expectRevert();
        endpoint.deliver(bridge, Origin(40245, PEER, 1), bytes32(uint256(1)), abi.encode(BOB, 10e6));
        require(token.balanceOf(BOB) == 0 && bridge.reserved() == 0);
    }

    function testInsufficientLiquidityPreservesPermissionlessClaim() public {
        receiveMessage(bytes32(uint256(1)), 10e6);
        require(bridge.reserved() == 10e6 && bridge.availableLiquidity() == 0);
        vm.expectRevert(NoobBridge.InsufficientLiquidity.selector);
        bridge.claim(bytes32(uint256(1)));
        bridge.fund(12e6);
        require(bridge.availableLiquidity() == 2e6);
        vm.prank(ALICE);
        bridge.claim(bytes32(uint256(1)));
        require(token.balanceOf(BOB) == 10e6 && bridge.reserved() == 0);
    }

    function testOwnerCannotWithdrawReservedPayouts() public {
        receiveMessage(bytes32(uint256(1)), 10e6);
        bridge.fund(12e6);
        bridge.pause();
        vm.expectRevert(NoobBridge.InsufficientLiquidity.selector);
        bridge.withdraw(ALICE, 3e6);
        bridge.withdraw(ALICE, 2e6);
        require(token.balanceOf(address(bridge)) == 10e6);
        bridge.unpause();
        bridge.claim(bytes32(uint256(1)));
        require(token.balanceOf(BOB) == 10e6);
    }

    function testPauseStopsSendingButPreservesIncomingMessages() public {
        bridge.fund(10e6);
        bridge.pause();
        vm.expectRevert();
        vm.prank(ALICE);
        bridge.bridge{value: 100}(10e6, BOB);
        receiveMessage(bytes32(uint256(1)), 10e6);
        require(bridge.reserved() == 10e6 && token.balanceOf(BOB) == 0);
        vm.expectRevert();
        bridge.claim(bytes32(uint256(1)));
        bridge.unpause();
        bridge.claim(bytes32(uint256(1)));
        require(token.balanceOf(BOB) == 10e6);
    }

    function testRejectsInvalidAmountsRecipientsRoutesAndUnprivilegedChanges() public {
        vm.expectRevert(NoobBridge.InvalidAmount.selector);
        bridge.quoteBridge(0, BOB);
        vm.expectRevert(NoobBridge.InvalidRecipient.selector);
        bridge.quoteBridge(1, address(0));
        vm.expectRevert(NoobBridge.InvalidRecipient.selector);
        bridge.quoteBridge(1, address(bridge));
        vm.expectRevert(NoobBridge.InvalidRoute.selector);
        bridge.setPeer(40245, PEER);
        vm.expectRevert(NoobBridge.InvalidRoute.selector);
        bridge.setPeer(40285, bytes32(0));
        vm.expectRevert();
        vm.prank(ALICE);
        bridge.pause();
        vm.expectRevert();
        vm.prank(ALICE);
        bridge.setPeer(40285, bytes32(uint256(5)));
    }

    function testRejectsFeeOnTransferWithoutLosingFunds() public {
        token.setFee(true);
        uint256 beforeBalance = token.balanceOf(ALICE);
        vm.expectRevert(NoobBridge.InexactTransfer.selector);
        vm.prank(ALICE);
        bridge.bridge{value: 100}(10e6, BOB);
        require(token.balanceOf(ALICE) == beforeBalance);
    }

    function testRejectsMainnetAndAssociatesHederaToken() public {
        vm.chainId(295);
        vm.expectRevert(NoobBridge.InvalidRoute.selector);
        new NoobBridge(address(endpoint), address(this), address(token));
        vm.chainId(296);
        NoobBridge hederaBridge = new NoobBridge(address(endpoint), address(this), address(token));
        require(hederaBridge.remoteEid() == 40245);
    }

    function testOwnershipRequiresAcceptance() public {
        bridge.transferOwnership(ALICE);
        require(bridge.owner() == address(this));
        vm.prank(ALICE);
        bridge.acceptOwnership();
        require(bridge.owner() == ALICE);
        vm.expectRevert();
        bridge.pause();
    }

    function testFuzzPayoutConservesPoolBalance(uint256 input) public {
        uint256 amount = input % 1_000_000e6 + 1;
        bridge.fund(amount);
        receiveMessage(bytes32(uint256(1)), amount);
        require(token.balanceOf(BOB) == amount && token.balanceOf(address(bridge)) == 0 && bridge.reserved() == 0);
    }
}
