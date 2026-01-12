import { createHash, randomBytes } from 'crypto';
import {
  SwapIntent,
  Solver,
  AtomicSwapState,
  HTLCParams,
  HTLCStatus,
  HTLCState,
  ExecutionState,
  SwapExecution,
  ExecutionStep,
  Chain,
} from '../types';
import { AdapterRegistry } from '../adapters';

export class HTLCCoordinator {
  private adapters: AdapterRegistry;

  constructor(adapters: AdapterRegistry) {
    this.adapters = adapters;
  }

  async initiateAtomicSwap(
    intent: SwapIntent,
    solver: Solver
  ): Promise<SwapExecution> {
    const execution: SwapExecution = {
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
      state: ExecutionState.INITIALIZING,
      steps: [],
      startedAt: Date.now(),
      txHashes: {},
    };

    try {
      // Generate secret and hash
      const secret = randomBytes(32);
      const hashlock = createHash('sha256').update(secret).digest();

      // Calculate timelocks
      const userTimelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const solverTimelock = Math.floor(Date.now() / 1000) + 1800; // 30 min

      // Step 1: Create HTLC on source chain
      execution.state = ExecutionState.LOCKING_SOURCE;
      execution.steps.push({
        name: 'lock_source',
        status: 'in_progress',
        chain: intent.sourceChain,
        startedAt: Date.now(),
      });

      const sourceHTLC = await this.createSourceHTLC({
        chain: intent.sourceChain,
        sender: intent.user.addresses[intent.sourceChain]!,
        receiver: solver.address[intent.sourceChain]!,
        amount: intent.sourceAmount,
        hashlock,
        timelock: userTimelock,
      });

      execution.txHashes[intent.sourceChain] = sourceHTLC.txHash;
      this.updateStep(execution, 'lock_source', 'completed', sourceHTLC.txHash);

      // Step 2: Wait for source HTLC confirmation
      execution.state = ExecutionState.CONFIRMING_LOCK;
      execution.steps.push({
        name: 'confirm_lock',
        status: 'in_progress',
        chain: intent.sourceChain,
        startedAt: Date.now(),
      });

      await this.waitForConfirmation(intent.sourceChain, sourceHTLC.txHash!);
      this.updateStep(execution, 'confirm_lock', 'completed');

      // Step 3: Solver creates HTLC on destination chain
      execution.state = ExecutionState.RELEASING_DEST;
      execution.steps.push({
        name: 'lock_dest',
        status: 'in_progress',
        chain: intent.destChain,
        startedAt: Date.now(),
      });

      const destHTLC = await this.createDestHTLC({
        chain: intent.destChain,
        sender: solver.address[intent.destChain]!,
        receiver: intent.user.addresses[intent.destChain]!,
        amount: intent.minDestAmount,
        hashlock,
        timelock: solverTimelock,
      });

      execution.txHashes[intent.destChain] = destHTLC.txHash;
      this.updateStep(execution, 'lock_dest', 'completed', destHTLC.txHash);

      // Step 4: Wait for dest HTLC confirmation
      execution.state = ExecutionState.CONFIRMING_RELEASE;
      execution.steps.push({
        name: 'confirm_dest',
        status: 'in_progress',
        chain: intent.destChain,
        startedAt: Date.now(),
      });

      await this.waitForConfirmation(intent.destChain, destHTLC.txHash!);
      this.updateStep(execution, 'confirm_dest', 'completed');

      // Step 5: User claims destination funds
      execution.state = ExecutionState.COMPLETING;
      execution.steps.push({
        name: 'claim_dest',
        status: 'in_progress',
        chain: intent.destChain,
        startedAt: Date.now(),
      });

      const claimTx = await this.claimDestHTLC(
        intent.destChain,
        destHTLC.id,
        secret,
        intent.user.addresses[intent.destChain]!
      );

      this.updateStep(execution, 'claim_dest', 'completed', claimTx);

      // Complete
      execution.state = ExecutionState.COMPLETED;
      execution.completedAt = Date.now();
      execution.actualOutput = intent.minDestAmount;

      return execution;

    } catch (error) {
      execution.state = ExecutionState.FAILED;
      const currentStep = execution.steps[execution.steps.length - 1];
      if (currentStep) {
        currentStep.status = 'failed';
        currentStep.error = (error as Error).message;
      }
      throw error;
    }
  }

  async refundSwap(execution: SwapExecution): Promise<void> {
    execution.state = ExecutionState.REFUNDING;

    // Wait for timelock to expire
    const sourceAdapter = this.adapters.get(execution.route.hops[0].fromChain);

    // Refund source HTLC
    const refundTx = await sourceAdapter.refundHTLC(execution.swapId);
    const signedTx = await sourceAdapter.signTransaction(refundTx, Buffer.alloc(32));
    await sourceAdapter.broadcastTransaction(signedTx);

    execution.state = ExecutionState.REFUNDED;
  }

  private async createSourceHTLC(params: HTLCParams): Promise<HTLCStatus> {
    const adapter = this.adapters.get(params.chain);

    const unsignedTx = await adapter.createHTLC(params);

    // In real implementation, user would sign this
    const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
    const txHash = await adapter.broadcastTransaction(signedTx);

    return {
      id: createHash('sha256').update(params.hashlock).digest('hex'),
      state: HTLCState.LOCKED,
      txHash,
      amount: params.amount,
      hashlock: params.hashlock.toString('hex'),
      timelock: params.timelock,
    };
  }

  private async createDestHTLC(params: HTLCParams): Promise<HTLCStatus> {
    const adapter = this.adapters.get(params.chain);

    const unsignedTx = await adapter.createHTLC(params);

    // Solver signs and broadcasts
    const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
    const txHash = await adapter.broadcastTransaction(signedTx);

    return {
      id: createHash('sha256').update(params.hashlock).digest('hex'),
      state: HTLCState.LOCKED,
      txHash,
      amount: params.amount,
      hashlock: params.hashlock.toString('hex'),
      timelock: params.timelock,
    };
  }

  private async claimDestHTLC(
    chain: Chain,
    htlcId: string,
    secret: Buffer,
    claimerAddress: string
  ): Promise<string> {
    const adapter = this.adapters.get(chain);

    const unsignedTx = await adapter.claimHTLC(htlcId, secret);
    const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));

    return adapter.broadcastTransaction(signedTx);
  }

  private async waitForConfirmation(chain: Chain, txHash: string): Promise<void> {
    const adapter = this.adapters.get(chain);
    await adapter.waitForConfirmation(txHash, 1);
  }

  private updateStep(
    execution: SwapExecution,
    stepName: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    txHash?: string
  ): void {
    const step = execution.steps.find(s => s.name === stepName);
    if (step) {
      step.status = status;
      if (txHash) step.txHash = txHash;
      if (status === 'completed') step.completedAt = Date.now();
    }
  }
}

export class IntentPool {
  private intents: Map<string, SwapIntent> = new Map();

  async submitIntent(intent: SwapIntent): Promise<string> {
    this.validateIntent(intent);
    this.intents.set(intent.id, intent);
    return intent.id;
  }

  async getIntent(intentId: string): Promise<SwapIntent | undefined> {
    return this.intents.get(intentId);
  }

  async cancelIntent(intentId: string): Promise<void> {
    const intent = this.intents.get(intentId);
    if (intent) {
      intent.status = 'cancelled' as any;
      intent.updatedAt = Date.now();
    }
  }

  async matchIntent(intentId: string, solver: Solver): Promise<boolean> {
    const intent = this.intents.get(intentId);
    if (!intent) return false;

    if (!this.canSolverFill(solver, intent)) {
      return false;
    }

    intent.status = 'matched' as any;
    intent.updatedAt = Date.now();

    return true;
  }

  private validateIntent(intent: SwapIntent): void {
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

  private canSolverFill(solver: Solver, intent: SwapIntent): boolean {
    // Check if solver has the required inventory
    const inventory = solver.inventory[intent.destAsset.symbol];
    return inventory >= intent.minDestAmount;
  }
}
