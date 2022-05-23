import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "./AssetManagerTypes";

export async function newAssetManager(
    governanceAddress: string,
    assetManagerController: string | AssetManagerControllerInstance,
    name: string, 
    symbol: string, 
    decimals: number,
    assetManagerSettings: AssetManagerSettings
): Promise<[AssetManagerInstance, FAssetInstance]> {
    const AssetManager = await linkAssetManager();
    const FAsset = artifacts.require('FAsset');
    const fAsset = await FAsset.new(governanceAddress, name, symbol, decimals);
    const assetManagerControllerAddress = typeof assetManagerController === 'string' ? assetManagerController : assetManagerController.address;
    assetManagerSettings = { ...assetManagerSettings, assetManagerController: assetManagerControllerAddress };
    const assetManager = await AssetManager.new(assetManagerSettings, fAsset.address);
    if (typeof assetManagerController !== 'string') {
        await assetManagerController.addAssetManager(assetManager.address, { from: governanceAddress });
    }
    await fAsset.setAssetManager(assetManager.address, { from: governanceAddress });
    return [assetManager, fAsset];
}

export async function linkAssetManager() {
    // deploy all libraries
    const SettingsUpdater = await deployLibrary('SettingsUpdater');
    const StateUpdater = await deployLibrary('StateUpdater');
    const Agents = await deployLibrary('Agents');
    const AvailableAgents = await deployLibrary('AvailableAgents');
    const CollateralReservations = await deployLibrary('CollateralReservations');
    const Liquidation = await deployLibrary('Liquidation');
    const Minting = await deployLibrary('Minting');
    const UnderlyingFreeBalance = await deployLibrary('UnderlyingFreeBalance');
    const Redemption = await deployLibrary('Redemption');
    const UnderlyingWithdrawalAnnouncements = await deployLibrary('UnderlyingWithdrawalAnnouncements');
    const Challenges = await deployLibrary('Challenges');
    const FullAgentInfo = await deployLibrary('FullAgentInfo');
    // link AssetManagerContract
    return linkDependencies(artifacts.require('AssetManager'), { 
        SettingsUpdater, StateUpdater, Agents, AvailableAgents, CollateralReservations, Liquidation, Minting, 
        UnderlyingFreeBalance, Redemption, UnderlyingWithdrawalAnnouncements, Challenges, FullAgentInfo
    });
}

export function deployLibrary(name: string, dependencies: { [key: string]: Truffle.ContractInstance } = {}): Promise<Truffle.ContractInstance> {
    // libraries don't have typechain info generated, so we have to import as 'any' (but it's no problem, since we only use them for linking)
    return linkDependencies(artifacts.require(name as any), dependencies).new();
}

export function linkDependencies<T extends Truffle.Contract<any>>(contract: T, dependencies: { [key: string]: Truffle.ContractInstance } = {}): T {
    // for some strange reason, the only way to call `link` that is supported by Hardhat, doesn't have type info by typechain
    // so the interface of this method assumes that maybe we will need linking by name in the future (that's why it accepts dictionary)
    for (const dependencyName of Object.keys(dependencies)) {
        contract.link(dependencies[dependencyName] as any);
    }
    return contract;
}
