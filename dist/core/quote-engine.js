"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteEngine = void 0;
const types_1 = require("../types");
class QuoteEngine {
    constructor(adapters) {
        this.sources = [];
        this.adapters = adapters;
        // Register default quote sources
        this.sources.push(new AtomicSwapQuoteSource(adapters));
        this.sources.push(new SolverQuoteSource());
    }
    registerSource(source) {
        this.sources.push(source);
    }
    async getQuotes(request) {
        // Fetch quotes from all sources in parallel
        const quotePromises = this.sources.map(source => source.getQuote(request).catch(() => null));
        const quotes = (await Promise.all(quotePromises))
            .filter((q) => q !== null)
            .sort((a, b) => Number(b.outputAmount - a.outputAmount));
        return quotes;
    }
}
exports.QuoteEngine = QuoteEngine;
class AtomicSwapQuoteSource {
    constructor(adapters) {
        this.name = 'atomic-swap';
        this.adapters = adapters;
    }
    async getQuote(request) {
        try {
            // Calculate atomic swap route
            const route = await this.calculateRoute(request);
            const fees = await this.calculateFees(request, route);
            const outputAmount = request.sourceAmount - fees.total;
            return {
                id: `atomic_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                source: this.name,
                route,
                inputAmount: request.sourceAmount,
                outputAmount,
                fees,
                validUntil: Date.now() + 60000, // 1 minute
                requiredSignatures: [{
                        chain: request.sourceChain,
                        unsignedTx: {
                            chain: request.sourceChain,
                            type: 'htlc_create',
                        },
                    }],
            };
        }
        catch {
            return null;
        }
    }
    async calculateRoute(request) {
        const hop = {
            fromChain: request.sourceChain,
            toChain: request.destChain,
            fromAsset: this.getAsset(request.sourceAsset, request.sourceChain),
            toAsset: this.getAsset(request.destAsset, request.destChain),
            mechanism: types_1.SwapMechanism.ATOMIC_SWAP,
            venue: 'omniswap-htlc',
            estimatedOutput: request.sourceAmount,
            fee: BigInt(0),
        };
        return {
            id: `route_${Date.now()}`,
            hops: [hop],
            estimatedOutput: request.sourceAmount,
            estimatedFees: {
                protocolFee: BigInt(0),
                networkFees: {},
                solverFee: BigInt(0),
                total: BigInt(0),
            },
            estimatedTime: 1200, // 20 minutes
            slippageRisk: 0.001,
            liquidityDepth: BigInt(1000000000000),
            priceImpact: 0.001,
            privacyScore: 80,
        };
    }
    async calculateFees(request, route) {
        // Protocol fee: 0.1%
        const protocolFee = request.sourceAmount / BigInt(1000);
        // Network fees
        const networkFees = {};
        networkFees[request.sourceChain] = BigInt(10000);
        networkFees[request.destChain] = BigInt(10000);
        // Solver fee: 0.3%
        const solverFee = (request.sourceAmount * BigInt(3)) / BigInt(1000);
        const total = protocolFee + solverFee +
            Object.values(networkFees).reduce((a, b) => a + b, BigInt(0));
        return { protocolFee, networkFees, solverFee, total };
    }
    getAsset(symbol, chain) {
        return {
            symbol,
            name: symbol,
            decimals: 8,
            chain,
        };
    }
}
class SolverQuoteSource {
    constructor() {
        this.name = 'solver';
        this.solverApiUrl = 'https://api.omniswap.io/solvers';
    }
    async getQuote(request) {
        try {
            const response = await fetch(`${this.solverApiUrl}/quote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceChain: request.sourceChain,
                    destChain: request.destChain,
                    sourceAsset: request.sourceAsset,
                    destAsset: request.destAsset,
                    sourceAmount: request.sourceAmount.toString(),
                }),
            });
            if (!response.ok)
                return null;
            const data = await response.json();
            return this.parseQuote(data);
        }
        catch {
            return null;
        }
    }
    parseQuote(data) {
        return {
            id: data.id,
            source: this.name,
            route: data.route,
            inputAmount: BigInt(data.inputAmount),
            outputAmount: BigInt(data.outputAmount),
            fees: {
                protocolFee: BigInt(data.fees.protocolFee),
                networkFees: Object.fromEntries(Object.entries(data.fees.networkFees).map(([k, v]) => [k, BigInt(v)])),
                solverFee: BigInt(data.fees.solverFee),
                total: BigInt(data.fees.total),
            },
            validUntil: data.validUntil,
            requiredSignatures: data.requiredSignatures,
        };
    }
}
//# sourceMappingURL=quote-engine.js.map