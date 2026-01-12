import EventEmitter from 'eventemitter3';
import {
  SwapRequest,
  Quote,
  SwapStatus,
  SwapStatusUpdate,
  Chain,
  TradingPair,
  LiquidityInfo,
  FeeEstimate,
  SignedTx,
  PrivacyLevel,
} from '../types';

export interface ApiClientConfig {
  apiUrl: string;
  wsUrl: string;
  apiKey?: string;
  timeout: number;
}

export class ApiClient extends EventEmitter {
  private config: ApiClientConfig;
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, (update: SwapStatusUpdate) => void> = new Map();

  constructor(config: ApiClientConfig) {
    super();
    this.config = config;
  }

  // REST API methods
  async getQuotes(request: SwapRequest): Promise<Quote[]> {
    const response = await this.post('/v1/quotes', {
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      sourceAsset: request.sourceAsset,
      destAsset: request.destAsset,
      sourceAmount: request.sourceAmount.toString(),
      slippageTolerance: request.slippageTolerance || 0.005,
      userAddress: request.userAddress,
    });

    return response.quotes.map(this.parseQuote);
  }

  async executeSwap(
    quoteId: string,
    signatures: Partial<Record<Chain, SignedTx>>,
    privacyLevel: PrivacyLevel = PrivacyLevel.STANDARD
  ): Promise<{ swapId: string; status: string; websocket: string }> {
    const signatureData: Record<string, any> = {};
    for (const [chain, tx] of Object.entries(signatures)) {
      signatureData[chain] = {
        signedTx: tx.rawTx,
        signature: tx.signature,
        publicKey: tx.publicKey,
      };
    }

    return this.post('/v1/swaps', {
      quoteId,
      signatures: signatureData,
      privacyLevel,
    });
  }

  async getSwapStatus(swapId: string): Promise<SwapStatus> {
    const response = await this.get(`/v1/swaps/${swapId}`);
    return this.parseSwapStatus(response);
  }

  async getSupportedChains(): Promise<Chain[]> {
    const response = await this.get('/v1/chains');
    return response.chains;
  }

  async getSupportedPairs(): Promise<TradingPair[]> {
    const response = await this.get('/v1/pairs');
    return response.pairs;
  }

  async getLiquidity(
    sourceChain: Chain,
    destChain: Chain,
    sourceAsset: string,
    destAsset: string
  ): Promise<LiquidityInfo> {
    const response = await this.get('/v1/liquidity', {
      sourceChain,
      destChain,
      sourceAsset,
      destAsset,
    });
    return response;
  }

  async estimateFees(request: SwapRequest): Promise<FeeEstimate> {
    const response = await this.post('/v1/fees/estimate', {
      sourceChain: request.sourceChain,
      destChain: request.destChain,
      sourceAsset: request.sourceAsset,
      destAsset: request.destAsset,
      sourceAmount: request.sourceAmount.toString(),
    });

    return {
      protocolFee: BigInt(response.protocolFee),
      networkFees: Object.fromEntries(
        Object.entries(response.networkFees).map(([k, v]) => [k, BigInt(v as string)])
      ),
      estimatedSolverFee: BigInt(response.estimatedSolverFee),
      total: BigInt(response.total),
    };
  }

  // WebSocket methods
  subscribeToSwap(swapId: string, callback: (update: SwapStatusUpdate) => void): () => void {
    this.ensureWebSocket();

    this.subscriptions.set(swapId, callback);

    this.ws!.send(JSON.stringify({
      type: 'subscribe',
      channel: 'swap',
      swapId,
    }));

    return () => {
      this.subscriptions.delete(swapId);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'unsubscribe',
          channel: 'swap',
          swapId,
        }));
      }
    };
  }

  private ensureWebSocket(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(this.config.wsUrl);

    this.ws.onopen = () => {
      this.emit('connected');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };

    this.ws.onclose = () => {
      this.emit('disconnected');
      // Reconnect after delay
      setTimeout(() => this.ensureWebSocket(), 5000);
    };

    this.ws.onerror = (error) => {
      this.emit('error', error);
    };
  }

  private handleWebSocketMessage(data: any): void {
    if (data.type === 'swap_update' && data.swapId) {
      const callback = this.subscriptions.get(data.swapId);
      if (callback) {
        callback({
          type: data.updateType,
          swapId: data.swapId,
          status: data.status,
          step: data.step,
          outputAmount: data.outputAmount ? BigInt(data.outputAmount) : undefined,
          error: data.error,
          timestamp: data.timestamp || Date.now(),
        });
      }
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }

  // HTTP helpers
  private async get(path: string, params?: Record<string, any>): Promise<any> {
    let url = `${this.config.apiUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.append(key, String(value));
      }
      url += `?${searchParams.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async post(path: string, body: any): Promise<any> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    return headers;
  }

  private parseQuote(data: any): Quote {
    return {
      id: data.id,
      source: data.source,
      route: data.route,
      inputAmount: BigInt(data.inputAmount),
      outputAmount: BigInt(data.outputAmount),
      fees: {
        protocolFee: BigInt(data.fees.protocol || data.fees.protocolFee),
        networkFees: Object.fromEntries(
          Object.entries(data.fees.network || data.fees.networkFees || {}).map(
            ([k, v]) => [k, BigInt(v as string)]
          )
        ),
        solverFee: BigInt(data.fees.solver || data.fees.solverFee),
        total: BigInt(data.fees.total),
      },
      validUntil: data.validUntil,
      requiredSignatures: data.requiredSignatures || [],
    };
  }

  private parseSwapStatus(data: any): SwapStatus {
    return {
      swapId: data.swapId,
      status: data.status,
      steps: data.steps,
      outputAmount: data.outputAmount ? BigInt(data.outputAmount) : undefined,
      fees: data.fees ? {
        protocolFee: BigInt(data.fees.protocolFee),
        networkFees: Object.fromEntries(
          Object.entries(data.fees.networkFees || {}).map(
            ([k, v]) => [k, BigInt(v as string)]
          )
        ),
        solverFee: BigInt(data.fees.solverFee),
        total: BigInt(data.fees.total),
      } : undefined,
      error: data.error,
    };
  }
}
