"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseChainAdapter = void 0;
class BaseChainAdapter {
    constructor() {
        this.config = {};
        this.initialized = false;
    }
    async initialize(config) {
        this.config = config;
        this.initialized = true;
    }
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error(`${this.chain} adapter not initialized`);
        }
    }
    // Common implementations
    async waitForConfirmation(txHash, confirmations = 1) {
        this.ensureInitialized();
        while (true) {
            const currentConfirmations = await this.getConfirmations(txHash);
            if (currentConfirmations >= confirmations) {
                return;
            }
            await this.sleep(this.getBlockTime());
        }
    }
    async waitForFinality(txHash) {
        this.ensureInitialized();
        while (true) {
            const finalized = await this.isFinalized(txHash);
            if (finalized) {
                return;
            }
            await this.sleep(this.getBlockTime());
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.BaseChainAdapter = BaseChainAdapter;
//# sourceMappingURL=base.js.map