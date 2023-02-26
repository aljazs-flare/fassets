// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../data/AssetManagerState.sol";
import "./LiquidationStrategySettings.sol";

library LiquidationStrategy {
    function initialize(bytes memory _encodedSettings) external {
        LiquidationStrategySettings.verifyAndUpdate(_encodedSettings);
    }

    function updateSettings(bytes memory _encodedSettings) external {
        LiquidationStrategySettings.verifyAndUpdate(_encodedSettings);
    }

    function getSettings() external view returns (bytes memory) {
        return LiquidationStrategySettings.getEncoded();
    }

    // Liquidation premium step (depends on time, but is capped by the current collateral ratio)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function currentLiquidationFactorBIPS(
        address _agentVault,
        uint256 _class1CR,
        uint256 _poolCR
    )
        external view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        LiquidationStrategySettings.Data storage settings = LiquidationStrategySettings.get();
        Agent.State storage agent = Agent.get(_agentVault);
        uint256 step = _currentLiquidationStep(agent);
        uint256 factorBIPS = settings.liquidationCollateralFactorBIPS[step];
        // All premiums are expressed as factor BIPS.
        // Current algorithm for splitting payment: use liquidationCollateralFactorBIPS for class1 and
        // pay the rest from pool. If any factor exceeeds the CR of that collateral, pay that collateral at
        // its CR and pay more of the other. If both collaterals exceed CR, limit both to their CRs.
        _c1FactorBIPS = Math.min(settings.liquidationFactorClass1BIPS[step], factorBIPS);
        if (_c1FactorBIPS > _class1CR) {
            _c1FactorBIPS = _class1CR;
        }
        _poolFactorBIPS = factorBIPS - _c1FactorBIPS;
        if (_poolFactorBIPS > _poolCR) {
            _poolFactorBIPS = _poolCR;
            _c1FactorBIPS = Math.min(factorBIPS - _poolFactorBIPS, _class1CR);
        }
    }

    // Liquidation premium step (depends on time since CCB or liquidation was started)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _currentLiquidationStep(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        AssetManagerSettings.Data storage globalSettings = AssetManagerState.getSettings();
        LiquidationStrategySettings.Data storage settings = LiquidationStrategySettings.get();
        // calculate premium step based on time since liquidation started
        bool startedInCCB = _agent.status == Agent.Status.LIQUIDATION
            && _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB;
        uint256 ccbTime = startedInCCB ? globalSettings.ccbTimeSeconds : 0;
        uint256 liquidationStart = _agent.liquidationStartedAt + ccbTime;
        uint256 step = (block.timestamp - liquidationStart) / settings.liquidationStepSeconds;
        return Math.min(step, settings.liquidationCollateralFactorBIPS.length - 1);
    }
}