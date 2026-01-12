import { SwapIntent, Solver, SwapExecution } from '../types';
import { AdapterRegistry } from '../adapters';
export declare class HTLCCoordinator {
    private adapters;
    constructor(adapters: AdapterRegistry);
    initiateAtomicSwap(intent: SwapIntent, solver: Solver): Promise<SwapExecution>;
    refundSwap(execution: SwapExecution): Promise<void>;
    private createSourceHTLC;
    private createDestHTLC;
    private claimDestHTLC;
    private waitForConfirmation;
    private updateStep;
}
export declare class IntentPool {
    private intents;
    submitIntent(intent: SwapIntent): Promise<string>;
    getIntent(intentId: string): Promise<SwapIntent | undefined>;
    cancelIntent(intentId: string): Promise<void>;
    matchIntent(intentId: string, solver: Solver): Promise<boolean>;
    private validateIntent;
    private canSolverFill;
}
//# sourceMappingURL=htlc-coordinator.d.ts.map