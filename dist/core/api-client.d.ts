import EventEmitter from 'eventemitter3';
import { SwapRequest, Quote, SwapStatus, SwapStatusUpdate, Chain, TradingPair, LiquidityInfo, FeeEstimate, SignedTx, PrivacyLevel } from '../types';
export interface ApiClientConfig {
    apiUrl: string;
    wsUrl: string;
    apiKey?: string;
    timeout: number;
}
export declare class ApiClient extends EventEmitter {
    private config;
    private ws;
    private subscriptions;
    constructor(config: ApiClientConfig);
    getQuotes(request: SwapRequest): Promise<Quote[]>;
    executeSwap(quoteId: string, signatures: Partial<Record<Chain, SignedTx>>, privacyLevel?: PrivacyLevel): Promise<{
        swapId: string;
        status: string;
        websocket: string;
    }>;
    getSwapStatus(swapId: string): Promise<SwapStatus>;
    getSupportedChains(): Promise<Chain[]>;
    getSupportedPairs(): Promise<TradingPair[]>;
    getLiquidity(sourceChain: Chain, destChain: Chain, sourceAsset: string, destAsset: string): Promise<LiquidityInfo>;
    estimateFees(request: SwapRequest): Promise<FeeEstimate>;
    subscribeToSwap(swapId: string, callback: (update: SwapStatusUpdate) => void): () => void;
    private ensureWebSocket;
    private handleWebSocketMessage;
    disconnect(): void;
    private get;
    private post;
    private getHeaders;
    private parseQuote;
    private parseSwapStatus;
}
//# sourceMappingURL=api-client.d.ts.map