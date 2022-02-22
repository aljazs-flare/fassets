// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./PaymentVerification.sol";
import "./AssetManagerState.sol";
import "./Liquidation.sol";
import "./PaymentReference.sol";


library UnderlyingFreeBalance {
    using SignedSafeMath for int256;
    using PaymentVerification for PaymentVerification.State;

    function updateFreeBalance(
        AssetManagerState.State storage _state, 
        address _agentVault,
        int256 _balanceChange
    ) 
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        int256 newBalance = agent.freeUnderlyingBalanceUBA + _balanceChange;
        if (newBalance < 0) {
            emit AMEvents.UnderlyingFreeBalanceNegative(_agentVault, newBalance);
            Liquidation.startLiquidation(_state, _agentVault, false);
        }
        agent.freeUnderlyingBalanceUBA = SafeCast.toInt128(newBalance);
    }

    function increaseFreeBalance(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _balanceIncrease
    ) 
        internal
    {
        updateFreeBalance(_state, _agentVault, SafeCast.toInt256(_balanceIncrease));
    }

    function confirmTopupPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.underlyingAddressHash == _paymentInfo.sourceAddressHash, 
            "not underlying address");
        require(_paymentInfo.paymentReference == PaymentReference.addressTopup(_agentVault),
            "not a topup payment");
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        increaseFreeBalance(_state, _agentVault, _paymentInfo.deliveredUBA);
    }
}
