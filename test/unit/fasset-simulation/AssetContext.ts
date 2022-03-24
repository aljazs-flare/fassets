import { constants } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { IBlockChain } from "../../utils/fasset/ChainInterfaces";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { MockAttestationProvider } from "../../utils/fasset/MockAttestationProvider";
import { MockChain } from "../../utils/fasset/MockChain";
import { BNish, toBN, toBNExp, toWei } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { web3DeepNormalize } from "../../utils/web3assertions";
import { ChainInfo, NatInfo } from "./ChainInfo";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

const AMG_NATWEI_PRICE_SCALE = toBN(1e9);
const NAT_WEI = toBN(1e18);

// common context shared between several asset managers
export class CommonContext {
    constructor(
        public governance: string,
        public assetManagerController: string,
        public attestationClient: AttestationClientMockInstance,
        public ftsoRegistry: FtsoRegistryMockInstance,
        public wnat: WNatInstance,
        public natFtso: FtsoMockInstance,
    ) {}

    static async createTest(governance: string, assetManagerController: string, natInfo: NatInfo): Promise<CommonContext> {
        // create atetstation client
        const attestationClient = await AttestationClient.new();
        // create WNat token
        const wnat = await WNat.new(governance, natInfo.name, natInfo.symbol);
        await setDefaultVPContract(wnat, governance);
        // create NAT ftso
        const natFtso = await FtsoMock.new(natInfo.symbol);
        await natFtso.setCurrentPrice(toBNExp(natInfo.startPrice, 5));
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        return new CommonContext(governance, assetManagerController, attestationClient, ftsoRegistry, wnat, natFtso);
    }
}

// context, specific for each asset manager (includes common context vars)
export class AssetContext {
    constructor(
        // common context
        public governance: string,
        public assetManagerController: string,
        public attestationClient: AttestationClientMockInstance,
        public ftsoRegistry: FtsoRegistryMockInstance,
        public wnat: WNatInstance,
        public natFtso: FtsoMockInstance,
        // asset context
        public chainInfo: ChainInfo,
        public chain: IBlockChain,
        public attestationProvider: MockAttestationProvider,
        public settings: AssetManagerSettings,
        public assetManager: AssetManagerInstance,
        public fAsset: FAssetInstance,
        public assetFtso: FtsoMockInstance,
    ) {
    }

    get chainId() {
        return this.chainInfo.chainId;
    }
    
    /**
     * Convert underlying amount to base units (e.g. eth to wei)
     */
    underlyingAmount(value: number) {
        return toBNExp(value, this.chainInfo.decimals);
    }
    
    lotsSize() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }
    
    async updateUnderlyingBlock() {
        const height = await this.chain.getBlockHeight();
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists(height);
        await this.assetManager.updateCurrentBlock(proof);
    }

    async currentAmgToNATWeiPrice() {
        // Force cast here to circument architecure in original contracts 
        const {0: natPrice, } = await this.natFtso.getCurrentPrice();
        const {0: assetPrice, } = await this.assetFtso.getCurrentPrice();
        return this.amgToNATWeiPrice(natPrice, assetPrice);
    }

    amgToNATWeiPrice(natPriceUSDDec5: BNish, assetPriceUSDDec5: BNish) {
        // _natPriceUSDDec5 < 2^128 (in ftso) and assetUnitUBA, are both 64 bit, so there can be no overflow
        return toBN(assetPriceUSDDec5)
            .mul(toBN(this.settings.assetMintingGranularityUBA).mul(NAT_WEI).mul(AMG_NATWEI_PRICE_SCALE))
            .div(toBN(natPriceUSDDec5).mul(toBN(this.settings.assetUnitUBA)));
    }
    
    convertAmgToUBA(valueAMG: BNish) {
        return toBN(valueAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    convertUBAToAmg(valueUBA: BNish) {
        return toBN(valueUBA).div(toBN(this.settings.assetMintingGranularityUBA));
    }
    
    convertLotsToUBA(lots: BNish) {
        return toBN(lots).mul(this.lotsSize());
    }

    convertLotsToAMG(lots: BNish) {
        return toBN(lots).mul(toBN(this.settings.lotSizeAMG));
    }
    
    convertAmgToNATWei(valueAMG: BNish, amgToNATWeiPrice: BNish) {
        return toBN(valueAMG).mul(toBN(amgToNATWeiPrice)).div(AMG_NATWEI_PRICE_SCALE);
    }
    
    static async createTest(common: CommonContext, chainInfo: ChainInfo): Promise<AssetContext> {
        // create mock chain attestation provider
        const chain = new MockChain();
        chain.secondsPerBlock = chainInfo.blockTime;
        const attestationProvider = new MockAttestationProvider(chain, common.attestationClient, chainInfo.chainId);
        // create asset FTSO and set some price
        const assetFtso = await FtsoMock.new(chainInfo.symbol);
        await assetFtso.setCurrentPrice(toBNExp(chainInfo.startPrice, 5));
        await common.ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager
        const settings = await AssetContext.createTestSettings(common, chainInfo);
        // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
        const [assetManager, fAsset] = await newAssetManager(common.governance, common.assetManagerController,
            chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings));
        return new AssetContext(common.governance, common.assetManagerController, common.attestationClient, common.ftsoRegistry, common.wnat, common.natFtso,
            chainInfo, chain, attestationProvider, settings, assetManager, fAsset, assetFtso);
    }
    
    static async createTestSettings(ctx: CommonContext, ci: ChainInfo): Promise<AssetManagerSettings> {
        return {
            attestationClient: ctx.attestationClient.address,
            wNat: ctx.wnat.address,
            ftsoRegistry: ctx.ftsoRegistry.address,
            natFtsoIndex: await ctx.ftsoRegistry.getFtsoIndex(await ctx.wnat.symbol()),
            assetFtsoIndex: await ctx.ftsoRegistry.getFtsoIndex(ci.symbol),
            chainId: ci.chainId,
            assetUnitUBA: toBNExp(1, ci.decimals),
            assetMintingGranularityUBA: toBNExp(1, ci.amgDecimals),
            lotSizeAMG: toBNExp(ci.lotSize, ci.decimals - ci.amgDecimals),
            requireEOAAddressProof: ci.requireEOAProof,
            underlyingBlocksForPayment: ci.underlyingBlocksForPayment,
            underlyingSecondsForPayment: ci.underlyingBlocksForPayment * ci.blockTime,
            // settings that are more or less chain independent
            burnAddress: constants.ZERO_ADDRESS,            // burn address on local chain - same for all assets
            collateralReservationFeeBIPS: 100,              // 1%
            initialMinCollateralRatioBIPS: 2_1000,          // 2.1
            liquidationMinCollateralCallBandBIPS: 1_9000,   // 1.9
            liquidationMinCollateralRatioBIPS: 2_5000,      // 2.5
            redemptionFeeBips: 200,                         // 2%
            redemptionFailureFactorBIPS: 1_2000,            // 1.2
            redemptionByAnybodyAfterSeconds: 6 * 3600,      // 6 hours
            redemptionConfirmRewardNATWei: toWei(100),      // 100 NAT
            maxRedeemedTickets: 20,                         // TODO: find number that fits comfortably in gas limits
            paymentChallengeRewardBIPS: 1,
            paymentChallengeRewardNATWei: toWei(300),       // 300 NAT
            withdrawalWaitMinSeconds: 60,
            liquidationPricePremiumBIPS: 1_2500,            // 1.25
            liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
            newLiquidationStepAfterMinSeconds: 90,
        };
    }
}

export class AssetContextClient {
    constructor(
        public context: AssetContext,
    ) {}
    
    protected assetManager = this.context.assetManager;
    protected chain = this.context.chain;
    protected attestationProvider = this.context.attestationProvider;
    protected wnat = this.context.wnat;
    protected fAsset = this.context.fAsset;
}
