"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteOptimizer = void 0;
const types_1 = require("../types");
class RouteOptimizer {
    constructor(adapters) {
        this.liquidityGraph = new Map();
        this.adapters = adapters;
    }
    async findRoutes(intent) {
        // 1. Build graph of all possible paths
        await this.buildLiquidityGraph(intent.sourceChain, intent.destChain);
        // 2. Find candidate paths
        const paths = this.findKShortestPaths(this.nodeKey(intent.sourceChain, intent.sourceAsset.symbol), this.nodeKey(intent.destChain, intent.destAsset.symbol), 5);
        // 3. Simulate each path for accurate quotes
        const simulatedRoutes = await Promise.all(paths.map(path => this.simulateRoute(path, intent.sourceAmount)));
        // 4. Score and rank routes
        const scoredRoutes = simulatedRoutes.map(route => ({
            ...route,
            score: this.calculateRouteScore(route, intent),
        }));
        // 5. Return top routes sorted by score
        return scoredRoutes
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }
    async findPrivateRoute(intent) {
        const routes = await this.findRoutes(intent);
        // Filter for privacy-optimized routes
        const privateRoutes = routes.filter(r => r.privacyScore >= 70);
        if (privateRoutes.length === 0) {
            throw new Error('No private routes available for this swap');
        }
        return privateRoutes[0];
    }
    async buildLiquidityGraph(sourceChain, destChain) {
        this.liquidityGraph.clear();
        // Add direct route if available
        await this.addDirectRoute(sourceChain, destChain);
        // Add intermediate routes through Osmosis (liquidity hub)
        if (sourceChain !== types_1.Chain.OSMOSIS && destChain !== types_1.Chain.OSMOSIS) {
            await this.addHubRoute(sourceChain, destChain, types_1.Chain.OSMOSIS);
        }
        // Add IBC routes for Cosmos chains
        await this.addIBCRoutes(sourceChain, destChain);
    }
    async addDirectRoute(from, to) {
        const edges = this.getDirectEdges(from, to);
        for (const edge of edges) {
            this.addEdge(edge);
        }
    }
    async addHubRoute(from, to, hub) {
        const toHub = this.getDirectEdges(from, hub);
        const fromHub = this.getDirectEdges(hub, to);
        for (const edge of [...toHub, ...fromHub]) {
            this.addEdge(edge);
        }
    }
    async addIBCRoutes(from, to) {
        // Add IBC transfer routes for Cosmos ecosystem
        if (this.isCosmosChain(from) || this.isCosmosChain(to)) {
            const ibcEdges = this.getIBCEdges(from, to);
            for (const edge of ibcEdges) {
                this.addEdge(edge);
            }
        }
    }
    getDirectEdges(from, to) {
        const edges = [];
        // Atomic swap always available
        edges.push({
            from: { chain: from, asset: 'native', liquidity: BigInt(1e18) },
            to: { chain: to, asset: 'native', liquidity: BigInt(1e18) },
            mechanism: types_1.SwapMechanism.ATOMIC_SWAP,
            venue: 'omniswap-htlc',
            fee: 0.003,
            estimatedTime: 1200,
        });
        // Add bridge routes for EVM chains
        if (this.isEVMChain(from) && this.isEVMChain(to)) {
            edges.push({
                from: { chain: from, asset: 'native', liquidity: BigInt(1e18) },
                to: { chain: to, asset: 'native', liquidity: BigInt(1e18) },
                mechanism: types_1.SwapMechanism.BRIDGE,
                venue: 'thorchain',
                fee: 0.005,
                estimatedTime: 600,
            });
        }
        return edges;
    }
    getIBCEdges(from, to) {
        if (!this.isCosmosChain(from) || !this.isCosmosChain(to)) {
            return [];
        }
        return [{
                from: { chain: from, asset: 'native', liquidity: BigInt(1e18) },
                to: { chain: to, asset: 'native', liquidity: BigInt(1e18) },
                mechanism: types_1.SwapMechanism.IBC_TRANSFER,
                venue: 'ibc',
                fee: 0.001,
                estimatedTime: 60,
            }];
    }
    addEdge(edge) {
        const key = this.nodeKey(edge.from.chain, edge.from.asset);
        const edges = this.liquidityGraph.get(key) || [];
        edges.push(edge);
        this.liquidityGraph.set(key, edges);
    }
    findKShortestPaths(startKey, endKey, k) {
        const paths = [];
        const queue = [];
        // Initialize with edges from start
        const startEdges = this.liquidityGraph.get(startKey) || [];
        for (const edge of startEdges) {
            queue.push({ path: [edge], cost: edge.fee });
        }
        // Sort by cost
        queue.sort((a, b) => a.cost - b.cost);
        while (queue.length > 0 && paths.length < k) {
            const current = queue.shift();
            const lastEdge = current.path[current.path.length - 1];
            const lastKey = this.nodeKey(lastEdge.to.chain, lastEdge.to.asset);
            if (lastKey === endKey) {
                paths.push(current.path);
                continue;
            }
            // Extend path
            const nextEdges = this.liquidityGraph.get(lastKey) || [];
            for (const edge of nextEdges) {
                // Avoid cycles
                const visited = new Set(current.path.map(e => this.nodeKey(e.from.chain, e.from.asset)));
                if (visited.has(this.nodeKey(edge.to.chain, edge.to.asset))) {
                    continue;
                }
                queue.push({
                    path: [...current.path, edge],
                    cost: current.cost + edge.fee,
                });
            }
            // Re-sort
            queue.sort((a, b) => a.cost - b.cost);
        }
        return paths;
    }
    async simulateRoute(path, inputAmount) {
        let currentAmount = inputAmount;
        const hops = [];
        let totalFees = BigInt(0);
        let totalTime = 0;
        for (const edge of path) {
            const fee = BigInt(Math.floor(Number(currentAmount) * edge.fee));
            const output = currentAmount - fee;
            hops.push({
                fromChain: edge.from.chain,
                toChain: edge.to.chain,
                fromAsset: this.createAsset(edge.from.asset, edge.from.chain),
                toAsset: this.createAsset(edge.to.asset, edge.to.chain),
                mechanism: edge.mechanism,
                venue: edge.venue,
                estimatedOutput: output,
                fee,
            });
            currentAmount = output;
            totalFees += fee;
            totalTime += edge.estimatedTime;
        }
        return {
            id: `route_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            hops,
            estimatedOutput: currentAmount,
            estimatedFees: {
                protocolFee: totalFees / BigInt(3),
                networkFees: {},
                solverFee: (totalFees * BigInt(2)) / BigInt(3),
                total: totalFees,
            },
            estimatedTime: totalTime,
            slippageRisk: this.calculateSlippageRisk(path),
            liquidityDepth: this.calculateLiquidityDepth(path),
            priceImpact: Number(totalFees) / Number(inputAmount),
            privacyScore: this.calculatePrivacyScore(path),
        };
    }
    calculateRouteScore(route, intent) {
        const outputScore = Number(route.estimatedOutput) / Number(intent.sourceAmount);
        const feeScore = 1 - Number(route.estimatedFees.total) / Number(intent.sourceAmount);
        const timeScore = 1 - route.estimatedTime / 3600;
        const privacyScore = route.privacyScore / 100;
        // Adjust weights based on privacy preference
        let privacyWeight = 0.2;
        if (intent.privacyLevel === types_1.PrivacyLevel.ENHANCED)
            privacyWeight = 0.4;
        if (intent.privacyLevel === types_1.PrivacyLevel.MAXIMUM)
            privacyWeight = 0.6;
        const outputWeight = (1 - privacyWeight) * 0.5;
        const feeWeight = (1 - privacyWeight) * 0.4;
        const timeWeight = (1 - privacyWeight) * 0.1;
        return (outputScore * outputWeight +
            feeScore * feeWeight +
            timeScore * timeWeight +
            privacyScore * privacyWeight);
    }
    calculateSlippageRisk(path) {
        return path.reduce((risk, edge) => {
            if (edge.mechanism === types_1.SwapMechanism.AMM_SWAP) {
                return risk + 0.02;
            }
            return risk + 0.001;
        }, 0);
    }
    calculateLiquidityDepth(path) {
        return path.reduce((min, edge) => edge.from.liquidity < min ? edge.from.liquidity : min, BigInt(1e18));
    }
    calculatePrivacyScore(path) {
        let score = 100;
        for (const edge of path) {
            // Deduct for non-privacy chains
            if (!this.isPrivacyChain(edge.from.chain))
                score -= 15;
            if (!this.isPrivacyChain(edge.to.chain))
                score -= 15;
            // Deduct for bridges
            if (edge.mechanism === types_1.SwapMechanism.BRIDGE)
                score -= 20;
        }
        return Math.max(0, score);
    }
    nodeKey(chain, asset) {
        return `${chain}:${asset}`;
    }
    createAsset(symbol, chain) {
        return {
            symbol,
            name: symbol,
            decimals: 8,
            chain,
        };
    }
    isCosmosChain(chain) {
        return chain === types_1.Chain.OSMOSIS;
    }
    isEVMChain(chain) {
        return chain === types_1.Chain.FHENIX || chain === types_1.Chain.AZTEC;
    }
    isPrivacyChain(chain) {
        return [types_1.Chain.ZCASH, types_1.Chain.MIDEN, types_1.Chain.AZTEC, types_1.Chain.MINA].includes(chain);
    }
}
exports.RouteOptimizer = RouteOptimizer;
//# sourceMappingURL=router.js.map