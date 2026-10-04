// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract NoobBridge is OApp, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Payout {
        address recipient;
        uint256 amount;
        bool paid;
    }

    IERC20 public immutable token;
    uint32 public immutable remoteEid;
    uint256 public reserved;
    uint256 public maxBridgeAmount = 1_000_000e6;
    mapping(bytes32 => Payout) public payouts;

    error InvalidRoute();
    error InvalidAmount();
    error InvalidRecipient();
    error UnsupportedToken();
    error DuplicateMessage();
    error UnavailablePayout();
    error InsufficientLiquidity();
    error InexactTransfer();

    event BridgeSent(
        bytes32 indexed guid, uint32 destinationEid, address indexed sender, address indexed recipient, uint256 amount
    );
    event BridgeReceived(bytes32 indexed guid, uint32 sourceEid, address indexed recipient, uint256 amount);
    event BridgePaid(bytes32 indexed guid, address indexed recipient, uint256 amount);
    event LiquidityFunded(address indexed sender, uint256 amount);
    event LiquidityWithdrawn(address indexed recipient, uint256 amount);

    constructor(address endpoint_, address owner_, address token_) payable OApp(endpoint_, owner_) Ownable(owner_) {
        if (block.chainid != 296 && block.chainid != 84532) revert InvalidRoute();
        if (IERC20Metadata(token_).decimals() != 6) revert UnsupportedToken();
        token = IERC20(token_);
        remoteEid = block.chainid == 296 ? 40245 : 40285;
        if (block.chainid == 296) {
            (bool ok, bytes memory result) = token_.call(abi.encodeWithSignature("associate()"));
            if (!ok || result.length != 32) revert UnsupportedToken();
            int64 code = abi.decode(result, (int64));
            if (code != 22 && code != 194) revert UnsupportedToken();
        }
    }

    function setPeer(uint32 eid, bytes32 peer) public override onlyOwner {
        if (eid != remoteEid || peer == bytes32(0) || uint256(peer) >> 160 != 0) revert InvalidRoute();
        super.setPeer(eid, peer);
    }

    function quoteBridge(uint256 amount, address recipient) external view returns (uint256) {
        _validate(amount, recipient);
        return _quote(remoteEid, abi.encode(recipient, amount), _options(), false).nativeFee;
    }

    function bridge(uint256 amount, address recipient)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 guid)
    {
        _validate(amount, recipient);
        _collect(msg.sender, amount);
        MessagingReceipt memory receipt = _lzSend(
            remoteEid, abi.encode(recipient, amount), _options(), MessagingFee(msg.value, 0), payable(msg.sender)
        );
        emit BridgeSent(receipt.guid, remoteEid, msg.sender, recipient, amount);
        return receipt.guid;
    }

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _collect(msg.sender, amount);
        emit LiquidityFunded(msg.sender, amount);
    }

    function claim(bytes32 guid) external nonReentrant whenNotPaused {
        Payout storage payout = payouts[guid];
        if (payout.recipient == address(0) || payout.paid) revert UnavailablePayout();
        if (token.balanceOf(address(this)) < payout.amount) revert InsufficientLiquidity();
        _pay(guid, payout);
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        return balance > reserved ? balance - reserved : 0;
    }

    function withdraw(address recipient, uint256 amount) external onlyOwner nonReentrant whenPaused {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0 || amount > availableLiquidity()) revert InsufficientLiquidity();
        token.safeTransfer(recipient, amount);
        emit LiquidityWithdrawn(recipient, amount);
    }

    function setMaxBridgeAmount(uint256 amount) external onlyOwner {
        if (amount == 0 || amount > 1_000_000e6) revert InvalidAmount();
        maxBridgeAmount = amount;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function transferOwnership(address newOwner) public override(Ownable, Ownable2Step) onlyOwner {
        Ownable2Step.transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal override(Ownable, Ownable2Step) {
        Ownable2Step._transferOwnership(newOwner);
    }

    function _validate(uint256 amount, address recipient) private view {
        if (amount == 0 || amount > maxBridgeAmount) revert InvalidAmount();
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        _getPeerOrRevert(remoteEid);
    }

    function _collect(address sender, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert InexactTransfer();
    }

    function _options() private pure returns (bytes memory) {
        return abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), uint128(400_000));
    }

    function _lzReceive(Origin calldata origin, bytes32 guid, bytes calldata message, address, bytes calldata)
        internal
        override
        nonReentrant
    {
        if (origin.srcEid != remoteEid) revert InvalidRoute();
        if (payouts[guid].recipient != address(0)) revert DuplicateMessage();
        (address recipient, uint256 amount) = abi.decode(message, (address, uint256));
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0 || amount > 1_000_000e6) revert InvalidAmount();
        payouts[guid] = Payout(recipient, amount, false);
        reserved += amount;
        emit BridgeReceived(guid, origin.srcEid, recipient, amount);
        if (!paused() && token.balanceOf(address(this)) >= amount) _pay(guid, payouts[guid]);
    }

    function _pay(bytes32 guid, Payout storage payout) private {
        payout.paid = true;
        reserved -= payout.amount;
        uint256 beforeBalance = token.balanceOf(payout.recipient);
        token.safeTransfer(payout.recipient, payout.amount);
        if (token.balanceOf(payout.recipient) - beforeBalance != payout.amount) revert InexactTransfer();
        emit BridgePaid(guid, payout.recipient, payout.amount);
    }
}
