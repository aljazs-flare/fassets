import {
    AddressUpdaterEvents, AgentVaultFactoryEvents, AssetManagerControllerEvents, AttestationClientSCEvents, CollateralPoolFactoryEvents,
    ERC20Events, FtsoManagerMockEvents, FtsoMockEvents, FtsoRegistryMockEvents, StateConnectorMockEvents, WNatEvents
} from "../../../lib/fasset/IAssetContext";
import { ContractWithEvents } from "../../../lib/utils/events/truffle";
import {
    AddressUpdaterInstance, AgentVaultFactoryInstance, AssetManagerControllerInstance, AttestationClientSCInstance, CollateralPoolFactoryInstance,
    ERC20MockInstance, FtsoManagerMockInstance, FtsoMockInstance, FtsoRegistryMockInstance, GovernanceSettingsInstance, StateConnectorMockInstance, WNatInstance
} from "../../../typechain-truffle";
import { createFtsoMock } from "../../unit/fasset/test-settings";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../utils/constants";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { testChainInfo, testNatInfo } from "./TestChainInfo";

const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const AttestationClient = artifacts.require('AttestationClientSC');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const ERC20Mock = artifacts.require("ERC20Mock");
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const FtsoManagerMock = artifacts.require('FtsoManagerMock');
const StateConnector = artifacts.require('StateConnectorMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');

// common context shared between several asset managers

export type TestContextFtsoKey = 'nat' | 'usdc' | 'usdt' | keyof (typeof testChainInfo);

export type TestContextFtsos = Record<TestContextFtsoKey, ContractWithEvents<FtsoMockInstance, FtsoMockEvents>>
    & { bySymbol: Record<string, ContractWithEvents<FtsoMockInstance, FtsoMockEvents>> };

export class CommonContext {
    constructor(
        public governance: string,
        public governanceSettings: GovernanceSettingsInstance,
        public addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>,
        public assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>,
        public stateConnector: ContractWithEvents<StateConnectorMockInstance, StateConnectorMockEvents>,
        public agentVaultFactory: ContractWithEvents<AgentVaultFactoryInstance, AgentVaultFactoryEvents>,
        public collateralPoolFactory: ContractWithEvents<CollateralPoolFactoryInstance, CollateralPoolFactoryEvents>,
        public attestationClient: ContractWithEvents<AttestationClientSCInstance, AttestationClientSCEvents>,
        public ftsoRegistry: ContractWithEvents<FtsoRegistryMockInstance, FtsoRegistryMockEvents>,
        public ftsoManager: ContractWithEvents<FtsoManagerMockInstance, FtsoManagerMockEvents>,
        public wNat: ContractWithEvents<WNatInstance, WNatEvents>,
        public stablecoins: Record<string, ContractWithEvents<ERC20MockInstance, ERC20Events>>,
        public ftsos: TestContextFtsos
    ) { }

    static async createTest(governance: string): Promise<CommonContext> {
        // create governance settings
        const governanceSettings = await GovernanceSettings.new();
        await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
        // create state connector
        const stateConnector = await StateConnector.new();
        // create attestation client
        const attestationClient = await AttestationClient.new(stateConnector.address);
        // create address updater
        const addressUpdater = await AddressUpdater.new(governance); // don't switch to production
        // create WNat token
        const wNat = await WNat.new(governance, testNatInfo.name, testNatInfo.symbol);
        await setDefaultVPContract(wNat, governance);
        // create stablecoins
        const stablecoins = {
            USDC: await ERC20Mock.new("USDCoin", "USDC"),
            USDT: await ERC20Mock.new("Tether", "USDT"),
        };
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        // create ftsos
        const ftsos = await createTestFtsos(ftsoRegistry);
        // create FTSO manager mock (just for notifying about epoch finalization)
        const ftsoManager = await FtsoManagerMock.new();
        // create agent vault factory
        const agentVaultFactory = await AgentVaultFactory.new();
        // create collateral pool factory
        const collateralPoolFactory = await CollateralPoolFactory.new();
        // create asset manager controller
        const assetManagerController = await AssetManagerController.new(governanceSettings.address, governance, addressUpdater.address);
        await assetManagerController.switchToProductionMode({ from: governance });
        // collect
        return new CommonContext(governance, governanceSettings, addressUpdater, assetManagerController, stateConnector,
            agentVaultFactory, collateralPoolFactory, attestationClient, ftsoRegistry, ftsoManager, wNat, stablecoins, ftsos);
    }
}

async function createTestFtsos(ftsoRegistry: FtsoRegistryMockInstance): Promise<TestContextFtsos> {
    const res: Partial<TestContextFtsos> = { bySymbol: {} };
    res.nat = res.bySymbol![testNatInfo.symbol] = await createFtsoMock(ftsoRegistry, "NAT", testNatInfo.startPrice);
    res.usdc = res.bySymbol!["USDC"] = await createFtsoMock(ftsoRegistry, "USDC", 1.01);
    res.usdt = res.bySymbol!["USDT"] = await createFtsoMock(ftsoRegistry, "USDT", 0.99);
    for (const [key, ci] of Object.entries(testChainInfo)) {
        res[key as TestContextFtsoKey] = res.bySymbol![ci.symbol] = await createFtsoMock(ftsoRegistry, ci.symbol, ci.startPrice);
    }
    return res as TestContextFtsos;
}