"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterRegistry = exports.FhenixAdapter = exports.ZcashWasmAdapter = exports.ZcashAdapter = exports.OsmosisAdapter = exports.BaseChainAdapter = void 0;
const osmosis_1 = require("./osmosis");
const zcash_1 = require("./zcash");
const fhenix_1 = require("./fhenix");
var base_1 = require("./base");
Object.defineProperty(exports, "BaseChainAdapter", { enumerable: true, get: function () { return base_1.BaseChainAdapter; } });
var osmosis_2 = require("./osmosis");
Object.defineProperty(exports, "OsmosisAdapter", { enumerable: true, get: function () { return osmosis_2.OsmosisAdapter; } });
var zcash_2 = require("./zcash");
Object.defineProperty(exports, "ZcashAdapter", { enumerable: true, get: function () { return zcash_2.ZcashAdapter; } });
var zcash_wasm_1 = require("./zcash-wasm");
Object.defineProperty(exports, "ZcashWasmAdapter", { enumerable: true, get: function () { return zcash_wasm_1.ZcashWasmAdapter; } });
var fhenix_2 = require("./fhenix");
Object.defineProperty(exports, "FhenixAdapter", { enumerable: true, get: function () { return fhenix_2.FhenixAdapter; } });
class AdapterRegistry {
    constructor() {
        this.adapters = new Map();
        // Register default adapters
        this.register(new osmosis_1.OsmosisAdapter());
        this.register(new zcash_1.ZcashAdapter());
        this.register(new fhenix_1.FhenixAdapter());
    }
    register(adapter) {
        this.adapters.set(adapter.chain, adapter);
    }
    get(chain) {
        const adapter = this.adapters.get(chain);
        if (!adapter) {
            throw new Error(`No adapter registered for chain: ${chain}`);
        }
        return adapter;
    }
    has(chain) {
        return this.adapters.has(chain);
    }
    getSupportedChains() {
        return Array.from(this.adapters.keys());
    }
    async initializeAll(config) {
        const promises = Array.from(this.adapters.entries()).map(([chain, adapter]) => {
            const chainConfig = config[chain] || {};
            return adapter.initialize(chainConfig);
        });
        await Promise.all(promises);
    }
    async initializeChain(chain, config) {
        const adapter = this.get(chain);
        await adapter.initialize(config);
    }
}
exports.AdapterRegistry = AdapterRegistry;
//# sourceMappingURL=index.js.map