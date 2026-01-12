"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentPool = exports.HTLCCoordinator = void 0;
const crypto_1 = require("crypto");
const types_1 = require("../types");
class HTLCCoordinator {
    constructor(adapters) {
        this.adapters = adapters;
    }
    async initiateAtomicSwap(intent, solver) {
        const execution = {
            swapId: intent.id,
            intentId: intent.id,
            route: {
                id: `route_${intent.id}`,
                hops: [],
                estimatedOutput: intent.minDestAmount,
                estimatedFees: {
                    protocolFee: BigInt(0),
                    networkFees: {},
                    solverFee: BigInt(0),
                    total: BigInt(0),
                },
                estimatedTime: 1200,
                slippageRisk: 0.001,
                liquidityDepth: BigInt(1e18),
                priceImpact: 0.001,
                privacyScore: 80,
            },
            solver,
            state: types_1.ExecutionState.INITIALIZING,
            steps: [],
            startedAt: Date.now(),
            txHashes: {},
        };
        try {
            // Generate secret and hash
            const secret = (0, crypto_1.randomBytes)(32);
            const hashlock = (0, crypto_1.createHash)('sha256').update(secret).digest();
            // Calculate timelocks
            const userTimelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
            const solverTimelock = Math.floor(Date.now() / 1000) + 1800; // 30 min
            // Step 1: Create HTLC on source chain
            execution.state = types_1.ExecutionState.LOCKING_SOURCE;
            execution.steps.push({
                name: 'lock_source',
                status: 'in_progress',
                chain: intent.sourceChain,
                startedAt: Date.now(),
            });
            const sourceHTLC = await this.createSourceHTLC({
                chain: intent.sourceChain,
                sender: intent.user.addresses[intent.sourceChain],
                receiver: solver.address[intent.sourceChain],
                amount: intent.sourceAmount,
                hashlock,
                timelock: userTimelock,
            });
            execution.txHashes[intent.sourceChain] = sourceHTLC.txHash;
            this.updateStep(execution, 'lock_source', 'completed', sourceHTLC.txHash);
            // Step 2: Wait for source HTLC confirmation
            execution.state = types_1.ExecutionState.CONFIRMING_LOCK;
            execution.steps.push({
                name: 'confirm_lock',
                status: 'in_progress',
                chain: intent.sourceChain,
                startedAt: Date.now(),
            });
            await this.waitForConfirmation(intent.sourceChain, sourceHTLC.txHash);
            this.updateStep(execution, 'confirm_lock', 'completed');
            // Step 3: Solver creates HTLC on destination chain
            execution.state = types_1.ExecutionState.RELEASING_DEST;
            execution.steps.push({
                name: 'lock_dest',
                status: 'in_progress',
                chain: intent.destChain,
                startedAt: Date.now(),
            });
            const destHTLC = await this.createDestHTLC({
                chain: intent.destChain,
                sender: solver.address[intent.destChain],
                receiver: intent.user.addresses[intent.destChain],
                amount: intent.minDestAmount,
                hashlock,
                timelock: solverTimelock,
            });
            execution.txHashes[intent.destChain] = destHTLC.txHash;
            this.updateStep(execution, 'lock_dest', 'completed', destHTLC.txHash);
            // Step 4: Wait for dest HTLC confirmation
            execution.state = types_1.ExecutionState.CONFIRMING_RELEASE;
            execution.steps.push({
                name: 'confirm_dest',
                status: 'in_progress',
                chain: intent.destChain,
                startedAt: Date.now(),
            });
            await this.waitForConfirmation(intent.destChain, destHTLC.txHash);
            this.updateStep(execution, 'confirm_dest', 'completed');
            // Step 5: User claims destination funds
            execution.state = types_1.ExecutionState.COMPLETING;
            execution.steps.push({
                name: 'claim_dest',
                status: 'in_progress',
                chain: intent.destChain,
                startedAt: Date.now(),
            });
            const claimTx = await this.claimDestHTLC(intent.destChain, destHTLC.id, secret, intent.user.addresses[intent.destChain]);
            this.updateStep(execution, 'claim_dest', 'completed', claimTx);
            // Complete
            execution.state = types_1.ExecutionState.COMPLETED;
            execution.completedAt = Date.now();
            execution.actualOutput = intent.minDestAmount;
            return execution;
        }
        catch (error) {
            execution.state = types_1.ExecutionState.FAILED;
            const currentStep = execution.steps[execution.steps.length - 1];
            if (currentStep) {
                currentStep.status = 'failed';
                currentStep.error = error.message;
            }
            throw error;
        }
    }
    async refundSwap(execution) {
        execution.state = types_1.ExecutionState.REFUNDING;
        // Wait for timelock to expire
        const sourceAdapter = this.adapters.get(execution.route.hops[0].fromChain);
        // Refund source HTLC
        const refundTx = await sourceAdapter.refundHTLC(execution.swapId);
        const signedTx = await sourceAdapter.signTransaction(refundTx, Buffer.alloc(32));
        await sourceAdapter.broadcastTransaction(signedTx);
        execution.state = types_1.ExecutionState.REFUNDED;
    }
    async createSourceHTLC(params) {
        const adapter = this.adapters.get(params.chain);
        const unsignedTx = await adapter.createHTLC(params);
        // In real implementation, user would sign this
        const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
        const txHash = await adapter.broadcastTransaction(signedTx);
        return {
            id: (0, crypto_1.createHash)('sha256').update(params.hashlock).digest('hex'),
            state: types_1.HTLCState.LOCKED,
            txHash,
            amount: params.amount,
            hashlock: params.hashlock.toString('hex'),
            timelock: params.timelock,
        };
    }
    async createDestHTLC(params) {
        const adapter = this.adapters.get(params.chain);
        const unsignedTx = await adapter.createHTLC(params);
        // Solver signs and broadcasts
        const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
        const txHash = await adapter.broadcastTransaction(signedTx);
        return {
            id: (0, crypto_1.createHash)('sha256').update(params.hashlock).digest('hex'),
            state: types_1.HTLCState.LOCKED,
            txHash,
            amount: params.amount,
            hashlock: params.hashlock.toString('hex'),
            timelock: params.timelock,
        };
    }
    async claimDestHTLC(chain, htlcId, secret, claimerAddress) {
        const adapter = this.adapters.get(chain);
        const unsignedTx = await adapter.claimHTLC(htlcId, secret);
        const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
        return adapter.broadcastTransaction(signedTx);
    }
    async waitForConfirmation(chain, txHash) {
        const adapter = this.adapters.get(chain);
        await adapter.waitForConfirmation(txHash, 1);
    }
    updateStep(execution, stepName, status, txHash) {
        const step = execution.steps.find(s => s.name === stepName);
        if (step) {
            step.status = status;
            if (txHash)
                step.txHash = txHash;
            if (status === 'completed')
                step.completedAt = Date.now();
        }
    }
}
exports.HTLCCoordinator = HTLCCoordinator;
class IntentPool {
    constructor() {
        this.intents = new Map();
    }
    async submitIntent(intent) {
        this.validateIntent(intent);
        this.intents.set(intent.id, intent);
        return intent.id;
    }
    async getIntent(intentId) {
        return this.intents.get(intentId);
    }
    async cancelIntent(intentId) {
        const intent = this.intents.get(intentId);
        if (intent) {
            intent.status = 'cancelled';
            intent.updatedAt = Date.now();
        }
    }
    async matchIntent(intentId, solver) {
        const intent = this.intents.get(intentId);
        if (!intent)
            return false;
        if (!this.canSolverFill(solver, intent)) {
            return false;
        }
        intent.status = 'matched';
        intent.updatedAt = Date.now();
        return true;
    }
    validateIntent(intent) {
        if (!intent.sourceChain || !intent.destChain) {
            throw new Error('Source and destination chains are required');
        }
        if (intent.sourceAmount <= BigInt(0)) {
            throw new Error('Source amount must be positive');
        }
        if (intent.deadline <= Date.now()) {
            throw new Error('Deadline must be in the future');
        }
        if (intent.maxSlippage < 0 || intent.maxSlippage > 1) {
            throw new Error('Slippage must be between 0 and 1');
        }
    }
    canSolverFill(solver, intent) {
        // Check if solver has the required inventory
        const inventory = solver.inventory[intent.destAsset.symbol];
        return inventory >= intent.minDestAmount;
    }
}
exports.IntentPool = IntentPool;
//# sourceMappingURL=htlc-coordinator.js.map