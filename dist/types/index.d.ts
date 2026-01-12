export declare enum Chain {
    ZCASH = "zcash",
    MIDEN = "miden",
    AZTEC = "aztec",
    MINA = "mina",
    FHENIX = "fhenix",
    OSMOSIS = "osmosis"
}
export declare enum PrivacyLevel {
    STANDARD = "standard",
    ENHANCED = "enhanced",
    MAXIMUM = "maximum"
}
export declare enum SwapMechanism {
    ATOMIC_SWAP = "atomic-swap",
    AMM_SWAP = "amm-swap",
    IBC_TRANSFER = "ibc-transfer",
    BRIDGE = "bridge",
    SOLVER_FILL = "solver-fill"
}
export declare enum IntentStatus {
    PENDING = "pending",
    MATCHED = "matched",
    EXECUTING = "executing",
    COMPLETED = "completed",
    FAILED = "failed",
    EXPIRED = "expired",
    CANCELLED = "cancelled"
}
export declare enum ExecutionState {
    INITIALIZING = "initializing",
    LOCKING_SOURCE = "locking_source",
    CONFIRMING_LOCK = "confirming_lock",
    RELEASING_DEST = "releasing_dest",
    CONFIRMING_RELEASE = "confirming_release",
    COMPLETING = "completing",
    COMPLETED = "completed",
    REFUNDING = "refunding",
    REFUNDED = "refunded",
    FAILED = "failed"
}
export declare enum HTLCState {
    PENDING = "pending",
    LOCKED = "locked",
    CLAIMED = "claimed",
    REFUNDED = "refunded",
    EXPIRED = "expired"
}
export interface Asset {
    symbol: string;
    name: string;
    decimals: number;
    chain: Chain;
    contractAddress?: string;
    denom?: string;
}
export interface TradingPair {
    sourceAsset: Asset;
    destAsset: Asset;
    isActive: boolean;
}
export interface UserIdentifier {
    id: string;
    addresses: Partial<Record<Chain, string>>;
}
export interface SwapRequest {
    sourceChain: Chain;
    destChain: Chain;
    sourceAsset: string;
    destAsset: string;
    sourceAmount: bigint;
    userAddress: Partial<Record<Chain, string>>;
    slippageTolerance?: number;
    privacyLevel?: PrivacyLevel;
    deadline?: number;
}
export interface SwapIntent {
    id: string;
    user: UserIdentifier;
    sourceChain: Chain;
    sourceAsset: Asset;
    sourceAmount: bigint;
    destChain: Chain;
    destAsset: Asset;
    minDestAmount: bigint;
    maxSlippage: number;
    deadline: number;
    privacyLevel: PrivacyLevel;
    preferredRoute?: string;
    excludeSolvers?: string[];
    status: IntentStatus;
    createdAt: number;
    updatedAt: number;
}
export interface RouteHop {
    fromChain: Chain;
    toChain: Chain;
    fromAsset: Asset;
    toAsset: Asset;
    mechanism: SwapMechanism;
    venue: string;
    estimatedOutput: bigint;
    fee: bigint;
}
export interface Route {
    id: string;
    hops: RouteHop[];
    estimatedOutput: bigint;
    estimatedFees: FeeBreakdown;
    estimatedTime: number;
    slippageRisk: number;
    liquidityDepth: bigint;
    priceImpact: number;
    privacyScore: number;
}
export interface FeeBreakdown {
    protocolFee: bigint;
    networkFees: Partial<Record<Chain, bigint>>;
    solverFee: bigint;
    total: bigint;
}
export interface Quote {
    id: string;
    source: string;
    route: Route;
    inputAmount: bigint;
    outputAmount: bigint;
    fees: FeeBreakdown;
    validUntil: number;
    requiredSignatures: ChainSignatureRequest[];
}
export interface ChainSignatureRequest {
    chain: Chain;
    unsignedTx: UnsignedTx;
    message?: string;
}
export interface Solver {
    id: string;
    address: Partial<Record<Chain, string>>;
    supportedPairs: TradingPair[];
    inventory: Record<string, bigint>;
    totalSwaps: number;
    successRate: number;
    averageTime: number;
    stakeAmount: bigint;
    feeRate: number;
}
export interface ExecutionStep {
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    chain: Chain;
    txHash?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
}
export interface SwapExecution {
    swapId: string;
    intentId: string;
    route: Route;
    solver?: Solver;
    state: ExecutionState;
    steps: ExecutionStep[];
    startedAt: number;
    completedAt?: number;
    actualOutput?: bigint;
    actualFees?: FeeBreakdown;
    txHashes: Partial<Record<Chain, string>>;
}
export interface SwapStatus {
    swapId: string;
    status: ExecutionState;
    steps: ExecutionStep[];
    outputAmount?: bigint;
    fees?: FeeBreakdown;
    error?: string;
}
export interface LiquidityInfo {
    pair: TradingPair;
    totalLiquidity: bigint;
    availableLiquidity: bigint;
    price: number;
    priceImpact24h: number;
}
export interface FeeEstimate {
    protocolFee: bigint;
    networkFees: Partial<Record<Chain, bigint>>;
    estimatedSolverFee: bigint;
    total: bigint;
}
export interface UnsignedTx {
    chain: Chain;
    type: string;
    to?: string;
    from?: string;
    value?: bigint;
    data?: string;
    gasLimit?: bigint;
    memo?: string;
    [key: string]: unknown;
}
export interface SignedTx {
    chain: Chain;
    rawTx: string;
    signature: string;
    publicKey?: string;
}
export interface Transaction {
    hash: string;
    chain: Chain;
    from: string;
    to: string;
    value: bigint;
    status: 'pending' | 'confirmed' | 'failed';
    confirmations: number;
    blockNumber?: number;
    timestamp?: number;
}
export interface HTLCParams {
    chain: Chain;
    sender: string;
    receiver: string;
    amount: bigint;
    hashlock: Buffer;
    timelock: number;
    asset?: Asset;
}
export interface HTLCStatus {
    id: string;
    state: HTLCState;
    txHash?: string;
    claimTxHash?: string;
    refundTxHash?: string;
    amount: bigint;
    hashlock: string;
    timelock: number;
}
export interface AtomicSwapState {
    swapId: string;
    secret: Buffer;
    hashlock: Buffer;
    sourceHTLC: HTLCStatus;
    destHTLC: HTLCStatus;
    status: 'pending' | 'completed' | 'refunded' | 'failed';
}
export type SwapCallback = (update: SwapStatusUpdate) => void;
export type TxCallback = (tx: Transaction) => void;
export type Unsubscribe = () => void;
export interface SwapStatusUpdate {
    type: 'status_change' | 'step_complete' | 'swap_complete' | 'swap_failed';
    swapId: string;
    status?: ExecutionState;
    step?: string;
    outputAmount?: bigint;
    error?: string;
    timestamp: number;
}
export interface OmniSwapConfig {
    apiKey?: string;
    apiUrl?: string;
    wsUrl?: string;
    environment: 'mainnet' | 'testnet' | 'local';
    timeout?: number;
    retries?: number;
}
export interface PrivacyConfig {
    level: PrivacyLevel;
    useRelayer: boolean;
    useMixing: boolean;
    delayBroadcast: boolean;
    useTor: boolean;
    useShieldedRoutes: boolean;
    decoyTransactions: number;
}
export interface PrivacyScore {
    overall: number;
    breakdown: {
        transactionGraphPrivacy: number;
        amountPrivacy: number;
        timingPrivacy: number;
        metadataPrivacy: number;
    };
    recommendations: string[];
}
//# sourceMappingURL=index.d.ts.map