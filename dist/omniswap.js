"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmniSwap = void 0;
const types_1 = require("./types");
const adapters_1 = require("./adapters");
const core_1 = require("./core");
class OmniSwap {
    constructor(config) {
        this.initialized = false;
        this.config = {
            ...config,
            environment: config.environment || 'mainnet',
            timeout: config.timeout || 30000,
            retries: config.retries || 3,
        };
        // Set default URLs based on environment
        if (!this.config.apiUrl) {
            this.config.apiUrl = this.getDefaultApiUrl();
        }
        if (!this.config.wsUrl) {
            this.config.wsUrl = this.getDefaultWsUrl();
        }
        // Initialize components
        this.adapters = new adapters_1.AdapterRegistry();
        this.quoteEngine = new core_1.QuoteEngine(this.adapters);
        this.router = new core_1.RouteOptimizer(this.adapters);
        this.htlcCoordinator = new core_1.HTLCCoordinator(this.adapters);
        this.intentPool = new core_1.IntentPool();
        this.apiClient = new core_1.ApiClient({
            apiUrl: this.config.apiUrl,
            wsUrl: this.config.wsUrl,
            apiKey: this.config.apiKey,
            timeout: this.config.timeout,
        });
    }
    // Initialization
    async initialize(chainConfigs) {
        if (chainConfigs) {
            await this.adapters.initializeAll(chainConfigs);
        }
        this.initialized = true;
    }
    // Quote and execution
    async getQuote(request) {
        // Try local quote engine first for speed
        try {
            const localQuotes = await this.quoteEngine.getQuotes(request);
            if (localQuotes.length > 0) {
                return localQuotes;
            }
        }
        catch {
            // Fall through to API
        }
        // Fall back to API
        return this.apiClient.getQuotes(request);
    }
    async executeSwap(quote, signatures, options) {
        const privacyLevel = options?.privacyLevel || types_1.PrivacyLevel.STANDARD;
        // If signatures provided or local execution requested
        if (signatures || options?.useLocalExecution) {
            // Create intent
            const intent = this.createIntentFromQuote(quote);
            await this.intentPool.submitIntent(intent);
            // Get a solver (simplified - in real impl this would be from API)
            const solver = {
                id: 'default_solver',
                address: {},
                supportedPairs: [],
                inventory: {},
                totalSwaps: 100,
                successRate: 0.99,
                averageTime: 600,
                stakeAmount: BigInt(10000),
                feeRate: 0.003,
            };
            // Execute via HTLC coordinator
            return this.htlcCoordinator.initiateAtomicSwap(intent, solver);
        }
        // Otherwise use API
        const result = await this.apiClient.executeSwap(quote.id, signatures || {}, privacyLevel);
        // Return execution object
        return {
            swapId: result.swapId,
            intentId: quote.id,
            route: quote.route,
            state: 'initializing',
            steps: [],
            startedAt: Date.now(),
            txHashes: {},
        };
    }
    // Monitoring
    async getSwapStatus(swapId) {
        return this.apiClient.getSwapStatus(swapId);
    }
    subscribeToSwap(swapId, callback) {
        return this.apiClient.subscribeToSwap(swapId, callback);
    }
    // Discovery
    getSupportedChains() {
        return this.adapters.getSupportedChains();
    }
    async getSupportedPairs() {
        return this.apiClient.getSupportedPairs();
    }
    async getLiquidity(pair) {
        return this.apiClient.getLiquidity(pair.sourceAsset.chain, pair.destAsset.chain, pair.sourceAsset.symbol, pair.destAsset.symbol);
    }
    // Fees
    async estimateFees(request) {
        return this.apiClient.estimateFees(request);
    }
    // Chain adapter access
    getAdapter(chain) {
        return this.adapters.get(chain);
    }
    // Utility methods
    async getBalance(chain, address, asset) {
        const adapter = this.adapters.get(chain);
        return adapter.getBalance(address, asset);
    }
    async waitForTransaction(chain, txHash) {
        const adapter = this.adapters.get(chain);
        await adapter.waitForConfirmation(txHash);
    }
    // Privacy features
    async shieldFunds(chain, address, amount) {
        if (chain !== types_1.Chain.ZCASH) {
            throw new Error('Shielding only supported on Zcash');
        }
        const adapter = this.adapters.get(chain);
        return adapter.shieldFunds(address, amount);
    }
    // Cleanup
    disconnect() {
        this.apiClient.disconnect();
    }
    // Private helpers
    getDefaultApiUrl() {
        switch (this.config.environment) {
            case 'mainnet':
                return 'https://api.omniswap.io';
            case 'testnet':
                return 'https://testnet-api.omniswap.io';
            case 'local':
                return 'http://localhost:3000';
            default:
                return 'https://api.omniswap.io';
        }
    }
    getDefaultWsUrl() {
        switch (this.config.environment) {
            case 'mainnet':
                return 'wss://api.omniswap.io/ws';
            case 'testnet':
                return 'wss://testnet-api.omniswap.io/ws';
            case 'local':
                return 'ws://localhost:3000/ws';
            default:
                return 'wss://api.omniswap.io/ws';
        }
    }
    createIntentFromQuote(quote) {
        const firstHop = quote.route.hops[0];
        const lastHop = quote.route.hops[quote.route.hops.length - 1];
        return {
            id: `intent_${quote.id}_${Date.now()}`,
            user: {
                id: 'user',
                addresses: {},
            },
            sourceChain: firstHop.fromChain,
            sourceAsset: firstHop.fromAsset,
            sourceAmount: quote.inputAmount,
            destChain: lastHop.toChain,
            destAsset: lastHop.toAsset,
            minDestAmount: quote.outputAmount,
            maxSlippage: 0.005,
            deadline: quote.validUntil,
            privacyLevel: types_1.PrivacyLevel.STANDARD,
            status: types_1.IntentStatus.PENDING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }
}
exports.OmniSwap = OmniSwap;
// Export main class as default
exports.default = OmniSwap;
//# sourceMappingURL=omniswap.js.map