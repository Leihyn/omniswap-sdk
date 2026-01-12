import { Chain } from '../types';
import { ChainAdapter, AdapterConfig } from './base';
export { ChainAdapter, BaseChainAdapter, AdapterConfig, TxParams } from './base';
export { OsmosisAdapter } from './osmosis';
export { ZcashAdapter } from './zcash';
export { ZcashWasmAdapter, ZcashWasmConfig } from './zcash-wasm';
export { FhenixAdapter } from './fhenix';
export declare class AdapterRegistry {
    private adapters;
    constructor();
    register(adapter: ChainAdapter): void;
    get(chain: Chain): ChainAdapter;
    has(chain: Chain): boolean;
    getSupportedChains(): Chain[];
    initializeAll(config: Partial<Record<Chain, AdapterConfig>>): Promise<void>;
    initializeChain(chain: Chain, config: AdapterConfig): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map