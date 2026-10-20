// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CryptoTraderCommunity P2P swap settlement
/// @notice Non-custodial fixed-price swaps between ERC-20 tokens.
///         A maker signs an EIP-712 order off-chain ("sell `sellAmount` of
///         `sellToken` for `buyAmount` of `buyToken`"). A taker fills it, fully
///         or partially, in one atomic transaction: both transfers happen or
///         neither does. Tokens never rest in this contract.
/// @dev No owner, no fee, no upgrade path, no admin functions.
///      Fee-on-transfer / rebasing tokens are rejected: every transfer must
///      deliver exactly the requested amount to the recipient.
contract CtcP2PSwap is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        /// @dev address(0) = anyone may fill; otherwise only this taker.
        address taker;
        uint64 expiry;
        uint256 nonce;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,address taker,uint64 expiry,uint256 nonce)"
    );

    /// @notice Amount of `buyAmount` already paid by takers, per order hash.
    mapping(bytes32 orderHash => uint256) public filledBuyAmount;
    /// @notice Orders cancelled individually by their maker.
    mapping(bytes32 orderHash => bool) public cancelled;
    /// @notice Orders with `nonce < minNonce[maker]` are invalid (bulk cancel).
    mapping(address maker => uint256) public minNonce;

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address sellToken,
        address buyToken,
        uint256 sellAmountFilled,
        uint256 buyAmountFilled
    );
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event MinNonceUpdated(address indexed maker, uint256 minNonce);

    error InvalidOrder();
    error OrderExpired();
    error OrderCancelledOrInvalidNonce();
    error NotAllowedTaker();
    error InvalidSignature();
    error FillTooLarge(uint256 remaining);
    error ZeroFill();
    error NotMaker();
    error NonceNotIncreasing();
    error InexactTransfer(address token, uint256 expected, uint256 received);

    constructor() EIP712("CTC P2P Swap", "1") {}

    function hashOrder(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    o.maker,
                    o.sellToken,
                    o.buyToken,
                    o.sellAmount,
                    o.buyAmount,
                    o.taker,
                    o.expiry,
                    o.nonce
                )
            )
        );
    }

    /// @notice Remaining `buyAmount` that can still be paid into this order.
    function remainingBuyAmount(Order calldata o) external view returns (uint256) {
        bytes32 h = hashOrder(o);
        if (cancelled[h] || o.nonce < minNonce[o.maker] || block.timestamp > o.expiry) return 0;
        return o.buyAmount - filledBuyAmount[h];
    }

    /// @notice Fill (part of) an order by paying `buyAmountToPay` of `buyToken`.
    /// @return sellAmountOut Amount of `sellToken` sent to the taker, rounded
    ///         down (rounding always favours the maker).
    function fill(Order calldata o, bytes calldata signature, uint256 buyAmountToPay)
        external
        nonReentrant
        returns (uint256 sellAmountOut)
    {
        if (
            o.maker == address(0) || o.sellToken == address(0) || o.buyToken == address(0)
                || o.sellToken == o.buyToken || o.sellAmount == 0 || o.buyAmount == 0 || msg.sender == o.maker
        ) revert InvalidOrder();
        if (block.timestamp > o.expiry) revert OrderExpired();
        if (o.taker != address(0) && o.taker != msg.sender) revert NotAllowedTaker();

        bytes32 h = hashOrder(o);
        if (cancelled[h] || o.nonce < minNonce[o.maker]) revert OrderCancelledOrInvalidNonce();
        if (!SignatureChecker.isValidSignatureNow(o.maker, h, signature)) revert InvalidSignature();

        uint256 remaining = o.buyAmount - filledBuyAmount[h];
        if (buyAmountToPay == 0) revert ZeroFill();
        if (buyAmountToPay > remaining) revert FillTooLarge(remaining);

        sellAmountOut = Math.mulDiv(buyAmountToPay, o.sellAmount, o.buyAmount);
        if (sellAmountOut == 0) revert ZeroFill();

        filledBuyAmount[h] += buyAmountToPay;

        _exactTransferFrom(IERC20(o.buyToken), msg.sender, o.maker, buyAmountToPay);
        _exactTransferFrom(IERC20(o.sellToken), o.maker, msg.sender, sellAmountOut);

        emit OrderFilled(h, o.maker, msg.sender, o.sellToken, o.buyToken, sellAmountOut, buyAmountToPay);
    }

    /// @notice Cancel one order. Only its maker can cancel it.
    function cancel(Order calldata o) external {
        if (msg.sender != o.maker) revert NotMaker();
        bytes32 h = hashOrder(o);
        cancelled[h] = true;
        emit OrderCancelled(h, msg.sender);
    }

    /// @notice Invalidate every order of the caller with a nonce below `newMinNonce`.
    function cancelUpTo(uint256 newMinNonce) external {
        if (newMinNonce <= minNonce[msg.sender]) revert NonceNotIncreasing();
        minNonce[msg.sender] = newMinNonce;
        emit MinNonceUpdated(msg.sender, newMinNonce);
    }

    function _exactTransferFrom(IERC20 token, address from, address to, uint256 amount) private {
        uint256 before = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 received = token.balanceOf(to) - before;
        if (received != amount) revert InexactTransfer(address(token), amount, received);
    }
}
