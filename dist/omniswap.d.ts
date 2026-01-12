import { OmniSwapConfig, SwapRequest, Quote, SwapExecution, SwapStatus, SwapCallback, Chain, TradingPair, LiquidityInfo, FeeEstimate, SignedTx, PrivacyLevel, Unsubscribe } from './types';
import { AdapterConfig } from './adapters';
export declare class OmniSwap {
    private config;
    private adapters;
    private quoteEngine;
    private router;
    private htlcCoordinator;
    private intentPool;
    private apiClient;
    private initialized;
    constructor(config: OmniSwapConfig);
    initialize(chainConfigs?: Partial<Record<Chain, AdapterConfig>>): Promise<void>;
    getQuote(request: SwapRequest): Promise<Quote[]>;
    executeSwap(quote: Quote, signatures?: Partial<Record<Chain, SignedTx>>, options?: {
        privacyLevel?: PrivacyLevel;
        useLocalExecution?: boolean;
    }): Promise<SwapExecution>;
    getSwapStatus(swapId: string): Promise<SwapStatus>;
    subscribeToSwap(swapId: string, callback: SwapCallback): Unsubscribe;
    getSupportedChains(): Chain[];
    getSupportedPairs(): Promise<TradingPair[]>;
    getLiquidity(pair: TradingPair): Promise<LiquidityInfo>;
    estimateFees(request: SwapRequest): Promise<FeeEstimate>;
    getAdapter(chain: Chain): import("./adapters").ChainAdapter;
    getBalance(chain: Chain, address: string, asset?: string): Promise<bigint>;
    waitForTransaction(chain: Chain, txHash: string): Promise<void>;
    shieldFunds(chain: Chain, address: string, amount: bigint): Promise<string>;
    disconnect(): void;
    private getDefaultApiUrl;
    private getDefaultWsUrl;
    private createIntentFromQuote;
}
export default OmniSwap;
//# sourceMappingURL=omniswap.d.ts.map