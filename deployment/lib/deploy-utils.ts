import { readFileSync } from "fs";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AssetManagerParameters } from "./asset-manager-parameters";

// same as in @openzeppelin/test-helpers, but including those in hadhat scripts breaks tests for some reason
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const Ajv = require('ajv');
const ajv = new Ajv();

class ParameterSchema<T> {
    private ajvSchema: any;
    
    constructor(ajvSchemaJson: any) {
        this.ajvSchema = ajv.compile(ajvSchemaJson);
    }

    load(filename: string): T {
        const parameters = JSON.parse(readFileSync(filename).toString());
        return this.validate(parameters);
    }

    validate(parameters: unknown): T {
        if (this.ajvSchema(parameters)) {
            return parameters as T;
        }
        throw new Error(`Invalid format of parameter file`);
    }
}

export const assetManagerParameters = new ParameterSchema<AssetManagerParameters>(require('../config/asset-manager-parameters.schema.json'));

export interface DeployAccounts {
    deployer: string;
}

export function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (value) return value;
    throw new Error(`Missing environment variable ${name}`);
}

export function loadDeployAccounts(hre: HardhatRuntimeEnvironment): DeployAccounts {
    const deployerPrivateKey = requiredEnvironmentVariable('DEPLOYER_PRIVATE_KEY');
    const deployerAccount = hre.web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
    return {
        deployer: deployerAccount.address
    };
}