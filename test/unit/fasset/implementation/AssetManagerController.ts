import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { DAYS, HOURS, MAX_BIPS, randomAddress, toBN, toStringExp } from "../../../../lib/utils/helpers";
import { AssetManagerControllerInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WhitelistInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager, waitForTimelock } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal, web3ResultStruct } from "../../../utils/web3assertions";
import { createEncodedTestLiquidationSettings, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts } from "../test-settings";

const Whitelist = artifacts.require('Whitelist');

contract(`AssetManagerController.sol; ${getTestFile(__filename)}; Asset manager controller basic tests`, async accounts => {
    const governance = accounts[10];
    const updateExecutor = accounts[11];
    let assetManagerController: AssetManagerControllerInstance;
    let contracts: TestSettingsContracts;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerSettings;
    let collaterals: CollateralToken[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let whitelist: WhitelistInstance;

    beforeEach(async () => {
        const ci = testChainInfo.eth;
        contracts = await createTestContracts(governance);
        // save some contracts as globals
        ({ wNat } = contracts);
        usdc = contracts.stablecoins.USDC;
        // create FTSOs for nat, stablecoins and asset and set some price
        ftsos = await createTestFtsos(contracts.ftsoRegistry, ci);
        // create mock chain and attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(contracts.stateConnector, { [ci.chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, ci.chainId);
        // create whitelist
        whitelist = await Whitelist.new(contracts.governanceSettings.address, governance, false);
        await whitelist.switchToProductionMode({ from: governance });
        // create asset manager
        collaterals = createTestCollaterals(contracts);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
    });

    describe("set and update settings with controller", () => {

        it("should know about governance", async () => {
            const governance_test = await assetManagerController.governance();
            assert.equal(governance, governance_test);
        })

        it("should get asset managers and check if exist", async () => {
            const managers = await assetManagerController.getAssetManagers();
            assert.equal(assetManager.address, managers[0]);

            const manager_exists = await assetManagerController.assetManagerExists(assetManager.address)
            assert.equal(true, manager_exists);
        });

        it("should add and remove asset manager", async () => {
            let assetManager2: AssetManagerInstance;
            let fAsset2: FAssetInstance;
            const managers_current = await assetManagerController.getAssetManagers();
            [assetManager2, fAsset2] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, updateExecutor);

            const res1 = await assetManagerController.addAssetManager(assetManager2.address, { from: governance });
            await waitForTimelock(res1, assetManagerController, updateExecutor);
            const managers_add = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length + 1, managers_add.length);

            const res2 = await assetManagerController.removeAssetManager(assetManager.address, { from: governance });
            await waitForTimelock(res2, assetManagerController, updateExecutor);
            const managers_remove = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove.length);
        });

        it("should not add asset manager twice", async () => {
            const managers_current = await assetManagerController.getAssetManagers();

            await assetManagerController.addAssetManager(managers_current[0], { from: governance });
            const managers_add = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_add.length);
        });

        it("should do nothing if removing unexisting asset manager", async () => {
            let assetManager2: AssetManagerInstance;
            let fAsset2: FAssetInstance;
            const managers_current = await assetManagerController.getAssetManagers();
            [assetManager2, fAsset2] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, updateExecutor);

            await waitForTimelock(assetManagerController.addAssetManager(assetManager2.address, { from: governance }), assetManagerController, updateExecutor);
            const managers_add = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length + 1, managers_add.length);

            await waitForTimelock(assetManagerController.removeAssetManager(assetManager2.address, { from: governance }), assetManagerController, updateExecutor);
            const managers_remove = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove.length);

            await waitForTimelock(assetManagerController.removeAssetManager(assetManager2.address, { from: governance }), assetManagerController, updateExecutor);
            const managers_remove2 = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove2.length);
        });

        it("should revert setting whitelist without governance", async () => {
            let res = assetManagerController.setWhitelist([assetManager.address], randomAddress());
            await expectRevert(res, "only governance")
        });


        it("should refresh ftso indexes", async () => {
            await assetManagerController.refreshFtsoIndexes([assetManager.address], {from: updateExecutor });
        });

        it("should revert refreshing ftso indexes if asset manager not managed", async () => {
            const promise = assetManagerController.refreshFtsoIndexes([assetManager.address, accounts[2]], {from: updateExecutor });
            await expectRevert(promise, "Asset manager not managed");
        });

        it("should set whitelist address", async () => {
            let encodedCall: string = assetManagerController.contract.methods.setWhitelist([assetManager.address], whitelist.address).encodeABI();
            let res = await assetManagerController.setWhitelist([assetManager.address], whitelist.address, { from: governance });
            let allowedAfterTimestamp = (await time.latest()).addn(60);
            expectEvent(res, "GovernanceCallTimelocked", { selector: encodedCall.slice(0, 10), allowedAfterTimestamp, encodedCall })
        });

        it("should execute set whitelist", async () => {
            const res = await assetManagerController.setWhitelist([assetManager.address], whitelist.address, { from: governance });
            await waitForTimelock(res, assetManagerController, updateExecutor);
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.whitelist, whitelist.address);
        });

        it("should not execute set whitelist", async () => {
            const res1 = await assetManagerController.setWhitelist([assetManager.address], whitelist.address, { from: governance });
            const timelock = requiredEventArgs(res1, 'GovernanceCallTimelocked');
            let res = assetManagerController.executeGovernanceCall(timelock.selector, { from: updateExecutor });
            await expectRevert(res, "timelock: not allowed yet");
        });

        it("should revert setting lot size when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let lotSizeAMG_big = toBN(currentSettings.lotSizeAMG).muln(3);
            let lotSizeAMG_small = toBN(currentSettings.lotSizeAMG).divn(5);
            const res_big = assetManagerController.setLotSizeAmg([assetManager.address], lotSizeAMG_big, { from: governance });
            const res_small = assetManagerController.setLotSizeAmg([assetManager.address], lotSizeAMG_small, { from: governance });
            const res_zero = assetManagerController.setLotSizeAmg([assetManager.address], 0, { from: governance });

            await expectRevert(res_big, "lot size increase too big");
            await expectRevert(res_small, "lot size decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should revert setting payment challenge reward when increase or decrease is too big", async () => {
            let paymentChallengeRewardNATWei = toStringExp(300, 18);
            let paymentChallengeRewardBIPS = 100;
            await assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei, paymentChallengeRewardBIPS, { from: governance });

            let val = toStringExp(100, 18);
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            let paymentChallengeRewardNATWei_big = (toBN(newSettings.paymentChallengeRewardNATWei).add(toBN(val))).muln(5);
            let paymentChallengeRewardNATWei_small = toBN(newSettings.paymentChallengeRewardNATWei).divn(5);

            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res1 = assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_big, newSettings.paymentChallengeRewardBIPS, { from: governance });
            await expectRevert(res1, "increase too big");
            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res2 = assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_small, newSettings.paymentChallengeRewardBIPS, { from: governance });
            await expectRevert(res2, "decrease too big");

            let paymentChallengeRewardBIPS_big = (toBN(newSettings.paymentChallengeRewardBIPS).addn(100)).muln(5);
            let paymentChallengeRewardBIPS_small = toBN(newSettings.paymentChallengeRewardBIPS).divn(5);

            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res3 = assetManagerController.setPaymentChallengeReward([assetManager.address], newSettings.paymentChallengeRewardNATWei, paymentChallengeRewardBIPS_big, { from: governance });
            await expectRevert(res3, "increase too big");
            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res4 = assetManagerController.setPaymentChallengeReward([assetManager.address], newSettings.paymentChallengeRewardNATWei, paymentChallengeRewardBIPS_small, { from: governance });
            await expectRevert(res4, "decrease too big");
        });

        it("should set payment challenge reward", async () => {
            const currentSettings = await assetManager.getSettings();
            let paymentChallengeRewardNATWei_new = toBN(currentSettings.paymentChallengeRewardNATWei).muln(4);
            let paymentChallengeRewardBIPS_new = (toBN(currentSettings.paymentChallengeRewardBIPS).muln(4)).addn(100);

            let res = await assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_new, paymentChallengeRewardBIPS_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "paymentChallengeRewardNATWei", value: paymentChallengeRewardNATWei_new });
            expectEvent(res, "SettingChanged", { name: "paymentChallengeRewardBIPS", value: paymentChallengeRewardBIPS_new });
        });

        it("should set time for payment", async () => {
            const currentSettings = await assetManager.getSettings();
            let underlyingBlocksForPayment_new = toBN(currentSettings.underlyingBlocksForPayment).muln(2);
            let underlyingSecondsForPayment_new = toBN(currentSettings.underlyingSecondsForPayment).muln(2);
            let res = await assetManagerController.setTimeForPayment([assetManager.address], underlyingBlocksForPayment_new, underlyingSecondsForPayment_new, { from: governance });
            expectEvent(res, "GovernanceCallTimelocked");
        });

        it("should revert setting max trusted price age seconds when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxTrustedPriceAgeSeconds_big = toBN(currentSettings.maxTrustedPriceAgeSeconds).muln(60);
            let maxTrustedPriceAgeSeconds_small = toBN(currentSettings.maxTrustedPriceAgeSeconds).divn(60);
            let res_big = assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], maxTrustedPriceAgeSeconds_big, { from: governance });
            let res_small = assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], maxTrustedPriceAgeSeconds_small, { from: governance });
            let res_zero = assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], 0, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set max trusted price age seconds", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxTrustedPriceAgeSeconds_new = toBN(currentSettings.maxTrustedPriceAgeSeconds).addn(20);
            let res = await assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], maxTrustedPriceAgeSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "maxTrustedPriceAgeSeconds", value: toBN(maxTrustedPriceAgeSeconds_new) });
        });

        it("should revert setting collateral reservation fee bips when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let collateralReservationFeeBIPS_big = toBN(currentSettings.collateralReservationFeeBIPS).muln(5);
            let collateralReservationFeeBIPS_small = toBN(currentSettings.collateralReservationFeeBIPS).divn(5);
            let collateralReservationFeeBIPS_too_high = toBN(MAX_BIPS).addn(1);
            let res_big = assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_big, { from: governance });
            let res_small = assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_small, { from: governance });
            let res_too_high = assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_too_high, { from: governance });
            let res_zero = assetManagerController.setCollateralReservationFeeBips([assetManager.address], 0, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
            await expectRevert(res_too_high, "bips value too high");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set collateral reservation fee bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let collateralReservationFeeBIPS_new = toBN(currentSettings.collateralReservationFeeBIPS).muln(2);
            let res = await assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "collateralReservationFeeBIPS", value: toBN(collateralReservationFeeBIPS_new) });
        });

        it("should revert setting redemption fee bips when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let redemptionFeeBIPS_big = toBN(currentSettings.redemptionFeeBIPS).muln(5);
            let redemptionFeeBIPS_small = toBN(currentSettings.redemptionFeeBIPS).divn(5);
            let redemptionFeeBIPS_too_high = toBN(MAX_BIPS).addn(1);
            let res_big = assetManagerController.setRedemptionFeeBips([assetManager.address], redemptionFeeBIPS_big, { from: governance });
            let res_small = assetManagerController.setRedemptionFeeBips([assetManager.address], redemptionFeeBIPS_small, { from: governance });
            let res_too_high = assetManagerController.setRedemptionFeeBips([assetManager.address], redemptionFeeBIPS_too_high, { from: governance });
            let res_zero = assetManagerController.setRedemptionFeeBips([assetManager.address], 0, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
            await expectRevert(res_too_high, "bips value too high");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should revert setting confirmation by others after seconds when value too low", async () => {
            let confirmationByOthersAfterSeconds_small = 1.8 * HOURS;
            let res_big = assetManagerController.setConfirmationByOthersAfterSeconds([assetManager.address], confirmationByOthersAfterSeconds_small, { from: governance });
            await expectRevert(res_big, "must be at least two hours");
        });

        it("should set confirmation by others after seconds", async () => {
            const currentSettings = await assetManager.getSettings();
            let confirmationByOthersAfterSeconds_new = toBN(currentSettings.confirmationByOthersAfterSeconds).muln(2);
            let res = await assetManagerController.setConfirmationByOthersAfterSeconds([assetManager.address], confirmationByOthersAfterSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "confirmationByOthersAfterSeconds", value: toBN(confirmationByOthersAfterSeconds_new) });
        });

        it("should revert setting confirmation by others reward NATWei when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let confirmationByOthersRewardNATWei_big = toBN(currentSettings.confirmationByOthersRewardNATWei).muln(5);
            let confirmationByOthersRewardNATWei_small = toBN(currentSettings.confirmationByOthersRewardNATWei).divn(5);
            let res_big = assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], confirmationByOthersRewardNATWei_big, { from: governance });
            let res_small = assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], confirmationByOthersRewardNATWei_small, { from: governance });
            let res_zero = assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], 0, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set confirmation by others reward NATWei", async () => {
            const currentSettings = await assetManager.getSettings();
            let confirmationByOthersRewardNATWei_new = toBN(currentSettings.confirmationByOthersRewardNATWei).muln(2);
            let res = await assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], confirmationByOthersRewardNATWei_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "confirmationByOthersRewardNATWei", value: toBN(confirmationByOthersRewardNATWei_new) });
        });

        it("should revert setting max redeemed tickets when increase or decrease is too big or value is < 1", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxRedeemedTickets_big = toBN(currentSettings.maxRedeemedTickets).muln(3);
            let maxRedeemedTickets_small = toBN(currentSettings.maxRedeemedTickets).divn(5);
            let maxRedeemedTickets_zero = 0;

            let res_big = assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_big, { from: governance });
            let res_small = assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_small, { from: governance });
            let res_zero = assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_zero, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_small, "decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set max redeemed tickets", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxRedeemedTickets_new = toBN(currentSettings.maxRedeemedTickets).muln(2);
            let res = await assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "maxRedeemedTickets", value: toBN(maxRedeemedTickets_new) });
        });

        it("should revert setting withdrawal wait when increase is too big or value is < 1", async () => {
            const currentSettings = await assetManager.getSettings();
            let withdrawalWaitMinSeconds_big = toBN(currentSettings.withdrawalWaitMinSeconds).addn(11 * 60);
            let withdrawalWaitMinSeconds_zero = 0;

            let res_big = assetManagerController.setWithdrawalOrDestroyWaitMinSeconds([assetManager.address], withdrawalWaitMinSeconds_big, { from: governance });
            let res_zero = assetManagerController.setWithdrawalOrDestroyWaitMinSeconds([assetManager.address], withdrawalWaitMinSeconds_zero, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set withdrawal wait", async () => {
            const currentSettings = await assetManager.getSettings();
            let withdrawalWaitMinSeconds_new = toBN(currentSettings.withdrawalWaitMinSeconds).muln(2);
            let res = await assetManagerController.setWithdrawalOrDestroyWaitMinSeconds([assetManager.address], withdrawalWaitMinSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "withdrawalWaitMinSeconds", value: toBN(withdrawalWaitMinSeconds_new) });
        });

        it("should revert setting ccb time when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let ccbTimeSeconds_big = toBN(currentSettings.ccbTimeSeconds).muln(3);
            let ccbTimeSeconds_small = toBN(currentSettings.ccbTimeSeconds).divn(3);

            let res_big = assetManagerController.setCcbTimeSeconds([assetManager.address], ccbTimeSeconds_big, { from: governance });
            let res_small = assetManagerController.setCcbTimeSeconds([assetManager.address], ccbTimeSeconds_small, { from: governance });
            let res_zero = assetManagerController.setCcbTimeSeconds([assetManager.address], 0, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_small, "decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set ccb time", async () => {
            const currentSettings = await assetManager.getSettings();
            let ccbTimeSeconds_new = toBN(currentSettings.ccbTimeSeconds).muln(2);
            let res = await assetManagerController.setCcbTimeSeconds([assetManager.address], ccbTimeSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "ccbTimeSeconds", value: toBN(ccbTimeSeconds_new) });
        });

        it("should revert setting liquidation step when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationStepSeconds_big = toBN(currentSettings.liquidationStepSeconds).muln(3);
            let liquidationStepSeconds_small = toBN(currentSettings.liquidationStepSeconds).divn(3);

            let res_big = assetManagerController.setLiquidationStepSeconds([assetManager.address], liquidationStepSeconds_big, { from: governance });
            let res_small = assetManagerController.setLiquidationStepSeconds([assetManager.address], liquidationStepSeconds_small, { from: governance });
            let res_zero = assetManagerController.setLiquidationStepSeconds([assetManager.address], 0, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_small, "decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set liquidation step", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationStepSeconds_new = toBN(currentSettings.liquidationStepSeconds).muln(2);
            let res = await assetManagerController.setLiquidationStepSeconds([assetManager.address], liquidationStepSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "liquidationStepSeconds", value: toBN(liquidationStepSeconds_new) });
        });

        it("should revert setting liquidation collateral factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationCollateralFactorBIPS_empty: (string | number | import("bn.js"))[] = [];
            let liquidationCollateralFactorBIPS_tooHigh = [toBN(currentSettings.safetyMinCollateralRatioBIPS).addn(1)];
            let liquidationCollateralFactorBIPS_tooHighPending = [toBN(currentSettings.safetyMinCollateralRatioBIPS).subn(1)];
            let liquidationCollateralFactorBIPS_maxBips = [1200, MAX_BIPS+1];
            let liquidationCollateralFactorBIPS_notIncreasing = [12000, 12000];

            let res_empty = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_empty, { from: governance });
            let res_tooHigh = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_tooHigh, { from: governance });
            let res_tooMaxBips = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_maxBips, { from: governance });
            let res_notIncreasing = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_notIncreasing, { from: governance });

            await expectRevert(res_empty, "at least one factor required");
            await expectRevert(res_tooHigh, "liquidation factor too high");
            await expectRevert(res_tooMaxBips, "factor not above 1");
            await expectRevert(res_notIncreasing, "factors not increasing");
        });

        it("should set liquidation collateral factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationCollateralFactorBIPS_new = [2_0000, 2_5000];
            let res = await assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_new, { from: governance });
            expectEvent(res, "SettingArrayChanged", { name: "liquidationCollateralFactorBIPS", value: [toBN(2_0000), toBN(2_5000)] });
        });

        it("should revert setting attestation window when window is less than a day", async () => {
            let attestationWindowSeconds_small = 0.8 * DAYS;
            let res_small = assetManagerController.setAttestationWindowSeconds([assetManager.address], attestationWindowSeconds_small, { from: governance });

            await expectRevert(res_small, "window too small");
        });

        it("should revert setting announced underlying confirmation delay when setting is more than an hour", async () => {
            let announcedUnderlyingConfirmationMinSeconds_new = 2 * HOURS;
            let res_small = assetManagerController.setAnnouncedUnderlyingConfirmationMinSeconds([assetManager.address], announcedUnderlyingConfirmationMinSeconds_new, { from: governance });

            await expectRevert(res_small, "confirmation time too big");
        });

        it("should set attestation window", async () => {
            const currentSettings = await assetManager.getSettings();
            let attestationWindowSeconds_new = toBN(currentSettings.attestationWindowSeconds).muln(2);
            let res = await assetManagerController.setAttestationWindowSeconds([assetManager.address], attestationWindowSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "attestationWindowSeconds", value: toBN(attestationWindowSeconds_new) });
        });

        it("should set announced underlying confirmation min seconds", async () => {
            let announcedUnderlyingConfirmationMinSeconds_new = 100;
            let res = await assetManagerController.setAnnouncedUnderlyingConfirmationMinSeconds([assetManager.address], announcedUnderlyingConfirmationMinSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "announcedUnderlyingConfirmationMinSeconds", value: toBN(announcedUnderlyingConfirmationMinSeconds_new) });
        });

        it("should revert redemption default factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let redemptionDefaultFactorBIPS_big = toBN(currentSettings.redemptionDefaultFactorBIPS).muln(12001).divn(10_000);
            let redemptionDefaultFactorBIPS_low = MAX_BIPS;

            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res_big = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_big, { from: governance });
            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res_low = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_low, { from: governance });

            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_low, "bips value too low");

            let redemptionDefaultFactorBIPS_new = 1_3000;
            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            await assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            let redemptionDefaultFactorBIPS_small = toBN(newSettings.redemptionDefaultFactorBIPS).muln(8332).divn(10_000);;

            await time.increase(toBN(settings.minUpdateRepeatTimeSeconds).addn(1));
            let res_small = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_small, { from: governance });
            await expectRevert(res_small, "fee decrease too big");
        });

        it("should set redemption default factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let redemptionDefaultFactorBIPS_new = 1_1000;
            let res = await assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "redemptionDefaultFactorBIPS", value: toBN(redemptionDefaultFactorBIPS_new) });
        });

        it("should revert update - too close to previous update", async () => {
            let redemptionDefaultFactorBIPS_new = 1_3000;
            await assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            let update = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            await expectRevert(update, "too close to previous update");
        });

        it("should correctly set asset manager settings", async () => {
            const settings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(settings.redemptionFeeBIPS, 200);
            await assetManagerController.setRedemptionFeeBips([assetManager.address], 250, { from: governance });
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.redemptionFeeBIPS, 250);
        });

        it("should not change settings if manager not passed", async () => {
            await assetManagerController.setRedemptionFeeBips([], 250, { from: governance });
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.redemptionFeeBIPS, 200);
        });

        it("should change contracts", async () => {
            await addressUpdater.update(["AddressUpdater", "AssetManagerController", "AttestationClient", "FtsoRegistry", "WNat", "AgentVaultFactory"],
                [addressUpdater.address, assetManagerController.address, accounts[80], accounts[81], accounts[82], accounts[83]],
                [assetManagerController.address],
                { from: governance });
            const settings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(settings.assetManagerController, assetManagerController.address);
            assertWeb3Equal(settings.attestationClient, accounts[80]);
            assertWeb3Equal(settings.ftsoRegistry, accounts[81]);
            assertWeb3Equal(settings.wNat, accounts[82]);
            assertWeb3Equal(settings.agentVaultFactory, accounts[83]);
            assertWeb3Equal(await assetManagerController.replacedBy(), constants.ZERO_ADDRESS);
        });

        it("should change contracts, including asset manager controller", async () => {
            await addressUpdater.update(["AddressUpdater", "AssetManagerController", "AttestationClient", "FtsoRegistry", "WNat", "AgentVaultFactory"],
                [addressUpdater.address, accounts[79], accounts[80], accounts[81], accounts[82], accounts[83]],
                [assetManagerController.address],
                { from: governance });
            const settings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(settings.assetManagerController, accounts[79]);
            assertWeb3Equal(settings.attestationClient, accounts[80]);
            assertWeb3Equal(settings.ftsoRegistry, accounts[81]);
            assertWeb3Equal(settings.wNat, accounts[82]);
            assertWeb3Equal(settings.agentVaultFactory, accounts[83]);
            assertWeb3Equal(await assetManagerController.replacedBy(), accounts[79]);
        });

        it("should change time for payment settings after timelock", async () => {
            // change settings
            const currentSettings = await assetManager.getSettings();
            let underlyingBlocksForPayment_new = toBN(currentSettings.underlyingBlocksForPayment).muln(2);
            let underlyingSecondsForPayment_new = toBN(currentSettings.underlyingSecondsForPayment).muln(2);
            const res = await assetManagerController.setTimeForPayment([assetManager.address], underlyingBlocksForPayment_new, underlyingSecondsForPayment_new, { from: governance });
            await waitForTimelock(res, assetManagerController, updateExecutor);
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.underlyingBlocksForPayment, underlyingBlocksForPayment_new);
            assertWeb3Equal(newSettings.underlyingSecondsForPayment, underlyingSecondsForPayment_new);
        });

        it("should change collateral settings after timelock", async () => {
            // change settings
            const res = await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await waitForTimelock(res, assetManagerController, updateExecutor);
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.minCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(newSettings.ccbMinCollateralRatioBIPS, 1_8000);
            assertWeb3Equal(newSettings.safetyMinCollateralRatioBIPS, 2_4000);
        });

        it("should not set collateral", async () => {
            let res_invalid = waitForTimelock(assetManagerController.setCollateralRatios([assetManager.address], 1_8000, 2_2000, 2_4000, { from: governance }),
                assetManagerController, updateExecutor);
            await expectRevert(res_invalid, "invalid collateral ratios");
            let res_too_high = waitForTimelock(assetManagerController.setCollateralRatios([assetManager.address],  1_6000, 1_4000, 1_8000, { from: governance }),
                assetManagerController, updateExecutor);
            await expectRevert(res_too_high, "liquidation factor too high");
        });

        it("settings change should be executed by executor", async () => {
            // change settings
            const res = await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            const timelock = requiredEventArgs(res, 'GovernanceCallTimelocked');
            await expectRevert(assetManagerController.executeGovernanceCall(timelock.selector), "only executor");
            const res1 = await assetManagerController.setTimeForPayment([assetManager.address], 10, 120, { from: governance });
            const timelock1 = requiredEventArgs(res1, 'GovernanceCallTimelocked');
            await expectRevert(assetManagerController.executeGovernanceCall(timelock1.selector), "only executor");
        });

        it("shouldn't change collateral settings without timelock", async () => {
            // change settings
            const res = await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            const timelock = requiredEventArgs(res, 'GovernanceCallTimelocked');
            await expectRevert(assetManagerController.executeGovernanceCall(timelock.selector, { from: updateExecutor }),
                "timelock: not allowed yet");
            // assert no changes
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.minCollateralRatioBIPS, settings.minCollateralRatioBIPS);
            assertWeb3Equal(newSettings.ccbMinCollateralRatioBIPS, settings.ccbMinCollateralRatioBIPS);
            assertWeb3Equal(newSettings.safetyMinCollateralRatioBIPS, settings.safetyMinCollateralRatioBIPS);
        });

        it("shouldn't change time for payment settings without timelock", async () => {
            // change settings
            const currentSettings = await assetManager.getSettings();
            let underlyingBlocksForPayment_new = toBN(currentSettings.underlyingBlocksForPayment).muln(2);
            let underlyingSecondsForPayment_new = toBN(currentSettings.underlyingSecondsForPayment).muln(2);
            const res = await assetManagerController.setTimeForPayment([assetManager.address], underlyingBlocksForPayment_new, underlyingSecondsForPayment_new, { from: governance });
            const timelock = requiredEventArgs(res, 'GovernanceCallTimelocked');

            await expectRevert(assetManagerController.executeGovernanceCall(timelock.selector, { from: updateExecutor }), "timelock: not allowed yet");
            // assert no changes
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.underlyingBlocksForPayment, settings.underlyingBlocksForPayment);
            assertWeb3Equal(newSettings.underlyingSecondsForPayment, settings.underlyingSecondsForPayment);
        });

        it("should re-set update executors", async () => {
            // re-set executor
            await governanceSettings.setExecutors([accounts[1], accounts[2]], { from: governance });
            assert.isFalse(await governanceSettings.isExecutor(updateExecutor));
            assert.isTrue(await governanceSettings.isExecutor(accounts[1]));
            assert.isTrue(await governanceSettings.isExecutor(accounts[2]));
        });
    });

    describe("pause, unpause and terminate", () => {
        it("should pause and terminate only after 30 days", async () => {
            const MINIMUM_PAUSE_BEFORE_STOP = 30 * DAYS;
            assert.isFalse(await assetManager.paused());
            await assetManagerController.pause([assetManager.address], { from: governance });
            assert.isTrue(await assetManager.paused());
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP / 2);
            await assetManagerController.pause([assetManager.address], { from: governance });
            assert.isTrue(await assetManager.paused());
            await expectRevert(assetManagerController.terminate([assetManager.address], { from: governance }), "asset manager not paused enough");
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP / 2);
            assert.isFalse(await fAsset.terminated());
            await assetManagerController.terminate([assetManager.address], { from: governance })
            assert.isTrue(await fAsset.terminated());
            await expectRevert(assetManagerController.unpause([assetManager.address], { from: governance }), "f-asset terminated");
        });

        it("should unpause if not yet terminated", async () => {
            await assetManagerController.pause([assetManager.address], { from: governance });
            assert.isTrue(await assetManager.paused());
            await assetManagerController.unpause([assetManager.address], { from: governance });
            assert.isFalse(await assetManager.paused());
        });

        it("should not pause if not called from governance", async () => {
            const promise = assetManagerController.pause([assetManager.address], { from: accounts[0] });
            await expectRevert(promise, "only governance");
            assert.isFalse(await assetManager.paused());
        });

        it("should not unpause if not called from governance", async () => {
            await assetManagerController.pause([assetManager.address], { from: governance });
            assert.isTrue(await assetManager.paused());
            const promise = assetManagerController.unpause([assetManager.address], { from: accounts[0] })
            await expectRevert(promise, "only governance");
            assert.isTrue(await assetManager.paused());
        });

        it("should not terminate if not called from governance", async () => {
            const MINIMUM_PAUSE_BEFORE_STOP = 30 * DAYS;
            assert.isFalse(await assetManager.paused());
            await assetManagerController.pause([assetManager.address], { from: governance });
            assert.isTrue(await assetManager.paused());
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP);
            const promise = assetManagerController.terminate([assetManager.address], { from: accounts[0] })
            await expectRevert(promise, "only governance");
            assert.isFalse(await fAsset.terminated());
        });

    });
});
