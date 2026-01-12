import { Chain } from '../types';
import { ChainAdapter, AdapterConfig } from './base';
import { OsmosisAdapter } from './osmosis';
import { ZcashAdapter } from './zcash';
import { FhenixAdapter } from './fhenix';
import { AztecAdapter } from './aztec';
import { MidenAdapter } from './miden';
import { MinaAdapter } from './mina';

export { ChainAdapter, BaseChainAdapter, AdapterConfig, TxParams } from './base';
export { OsmosisAdapter } from './osmosis';
export { ZcashAdapter } from './zcash';
export { ZcashWasmAdapter, ZcashWasmConfig } from './zcash-wasm';
export { FhenixAdapter } from './fhenix';
export { AztecAdapter, AztecAdapterConfig } from './aztec';
export { MidenAdapter, MidenAdapterConfig } from './miden';
export { MinaAdapter, MinaAdapterConfig } from './mina';

export class AdapterRegistry {
  private adapters: Map<Chain, ChainAdapter> = new Map();

  constructor() {
    // Register all 6 chain adapters
    this.register(new ZcashAdapter());
    this.register(new OsmosisAdapter());
    this.register(new FhenixAdapter());
    this.register(new AztecAdapter());
    this.register(new MidenAdapter());
    this.register(new MinaAdapter());
  }

  register(adapter: ChainAdapter): void {
    this.adapters.set(adapter.chain, adapter);
  }

  get(chain: Chain): ChainAdapter {
    const adapter = this.adapters.get(chain);
    if (!adapter) {
      throw new Error(`No adapter registered for chain: ${chain}`);
    }
    return adapter;
  }

  has(chain: Chain): boolean {
    return this.adapters.has(chain);
  }

  getSupportedChains(): Chain[] {
    return Array.from(this.adapters.keys());
  }

  async initializeAll(config: Partial<Record<Chain, AdapterConfig>>): Promise<void> {
    const promises = Array.from(this.adapters.entries()).map(([chain, adapter]) => {
      const chainConfig = config[chain] || {};
      return adapter.initialize(chainConfig);
    });

    await Promise.all(promises);
  }

  async initializeChain(chain: Chain, config: AdapterConfig): Promise<void> {
    const adapter = this.get(chain);
    await adapter.initialize(config);
  }
}
