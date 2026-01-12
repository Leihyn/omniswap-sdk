import {
  OmniSwapConfig,
  SwapRequest,
  Quote,
  SwapExecution,
  SwapStatus,
  SwapCallback,
  Chain,
  TradingPair,
  LiquidityInfo,
  FeeEstimate,
  SignedTx,
  PrivacyLevel,
  Unsubscribe,
  SwapIntent,
  IntentStatus,
  Asset,
  UserIdentifier,
  PrivacyHubConfig,
  PrivacyHubExecution,
  PrivacyHubChain,
  StealthAddress,
} from './types';
import { AdapterRegistry, AdapterConfig } from './adapters';
import {
  QuoteEngine,
  RouteOptimizer,
  HTLCCoordinator,
  IntentPool,
  ApiClient,
  PrivacyHubCoordinator,
  StealthAddressGenerator,
} from './core';

export class OmniSwap {
  private config: OmniSwapConfig;
  private adapters: AdapterRegistry;
  private quoteEngine: QuoteEngine;
  private router: RouteOptimizer;
  private htlcCoordinator: HTLCCoordinator;
  private privacyHubCoordinator: PrivacyHubCoordinator;
  private stealthGenerator: StealthAddressGenerator;
  private intentPool: IntentPool;
  private apiClient: ApiClient;
  private initialized = false;

  constructor(config: OmniSwapConfig) {
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
    this.adapters = new AdapterRegistry();
    this.quoteEngine = new QuoteEngine(this.adapters);
    this.router = new RouteOptimizer(this.adapters);
    this.htlcCoordinator = new HTLCCoordinator(this.adapters);
    this.privacyHubCoordinator = new PrivacyHubCoordinator(this.adapters);
    this.stealthGenerator = new StealthAddressGenerator();
    this.intentPool = new IntentPool();
    this.apiClient = new ApiClient({
      apiUrl: this.config.apiUrl,
      wsUrl: this.config.wsUrl,
      apiKey: this.config.apiKey,
      timeout: this.config.timeout!,
    });
  }

  // Initialization
  async initialize(chainConfigs?: Partial<Record<Chain, AdapterConfig>>): Promise<void> {
    if (chainConfigs) {
      await this.adapters.initializeAll(chainConfigs);
    }
    this.initialized = true;
  }

  // Quote and execution
  async getQuote(request: SwapRequest): Promise<Quote[]> {
    // Try local quote engine first for speed
    try {
      const localQuotes = await this.quoteEngine.getQuotes(request);
      if (localQuotes.length > 0) {
        return localQuotes;
      }
    } catch {
      // Fall through to API
    }

    // Fall back to API
    return this.apiClient.getQuotes(request);
  }

  async executeSwap(
    quote: Quote,
    signatures?: Partial<Record<Chain, SignedTx>>,
    options?: {
      privacyLevel?: PrivacyLevel;
      useLocalExecution?: boolean;
    }
  ): Promise<SwapExecution> {
    const privacyLevel = options?.privacyLevel || PrivacyLevel.STANDARD;

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
    const result = await this.apiClient.executeSwap(
      quote.id,
      signatures || {},
      privacyLevel
    );

    // Return execution object
    return {
      swapId: result.swapId,
      intentId: quote.id,
      route: quote.route,
      state: 'initializing' as any,
      steps: [],
      startedAt: Date.now(),
      txHashes: {},
    };
  }

  // Monitoring
  async getSwapStatus(swapId: string): Promise<SwapStatus> {
    return this.apiClient.getSwapStatus(swapId);
  }

  subscribeToSwap(swapId: string, callback: SwapCallback): Unsubscribe {
    return this.apiClient.subscribeToSwap(swapId, callback);
  }

  // Discovery
  getSupportedChains(): Chain[] {
    return this.adapters.getSupportedChains();
  }

  async getSupportedPairs(): Promise<TradingPair[]> {
    return this.apiClient.getSupportedPairs();
  }

  async getLiquidity(pair: TradingPair): Promise<LiquidityInfo> {
    return this.apiClient.getLiquidity(
      pair.sourceAsset.chain,
      pair.destAsset.chain,
      pair.sourceAsset.symbol,
      pair.destAsset.symbol
    );
  }

  // Fees
  async estimateFees(request: SwapRequest): Promise<FeeEstimate> {
    return this.apiClient.estimateFees(request);
  }

  // Chain adapter access
  getAdapter(chain: Chain) {
    return this.adapters.get(chain);
  }

  // Utility methods
  async getBalance(chain: Chain, address: string, asset?: string): Promise<bigint> {
    const adapter = this.adapters.get(chain);
    return adapter.getBalance(address, asset);
  }

  async waitForTransaction(chain: Chain, txHash: string): Promise<void> {
    const adapter = this.adapters.get(chain);
    await adapter.waitForConfirmation(txHash);
  }

  // Privacy features
  async shieldFunds(chain: Chain, address: string, amount: bigint): Promise<string> {
    if (chain !== Chain.ZCASH) {
      throw new Error('Shielding only supported on Zcash');
    }

    const adapter = this.adapters.get(chain) as any;
    return adapter.shieldFunds(address, amount);
  }

  /**
   * Execute a privacy-preserving swap using the Privacy Hub architecture.
   *
   * This method provides MAXIMUM privacy by:
   * 1. Using different hashlocks for source and destination (breaks on-chain correlation)
   * 2. Routing through a privacy hub (Zcash shielded pool) for mixing
   * 3. Using stealth addresses for both parties (prevents address reuse)
   * 4. Adding random delays (defeats timing analysis)
   *
   * Trade-off: Slower execution (30min - 4hr mixing delay) for unlinkability.
   */
  async executePrivateSwap(
    quote: Quote,
    options?: {
      hubConfig?: Partial<PrivacyHubConfig>;
      useLocalExecution?: boolean;
    }
  ): Promise<PrivacyHubExecution> {
    // Create intent from quote
    const intent = this.createIntentFromQuote(quote);
    intent.privacyLevel = PrivacyLevel.MAXIMUM;
    await this.intentPool.submitIntent(intent);

    // Get a solver
    const solver = {
      id: 'privacy_solver',
      address: {},
      supportedPairs: [],
      inventory: {},
      totalSwaps: 100,
      successRate: 0.99,
      averageTime: 600,
      stakeAmount: BigInt(10000),
      feeRate: 0.003,
    };

    // Configure privacy hub if custom config provided
    if (options?.hubConfig) {
      this.privacyHubCoordinator = new PrivacyHubCoordinator(
        this.adapters,
        options.hubConfig
      );
    }

    // Execute via Privacy Hub coordinator
    return this.privacyHubCoordinator.executePrivateSwap(intent, solver);
  }

  /**
   * Generate a stealth address for receiving funds privately.
   *
   * Stealth addresses are one-time addresses that prevent:
   * - Address reuse correlation
   * - Balance tracking
   * - Transaction graph analysis
   */
  async generateStealthAddress(
    chain: Chain,
    recipientAddress: string
  ): Promise<StealthAddress> {
    return this.stealthGenerator.generate(chain, recipientAddress);
  }

  /**
   * Get the Privacy Hub coordinator for advanced usage.
   */
  getPrivacyHubCoordinator(): PrivacyHubCoordinator {
    return this.privacyHubCoordinator;
  }

  // Cleanup
  disconnect(): void {
    this.apiClient.disconnect();
  }

  // Private helpers
  private getDefaultApiUrl(): string {
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

  private getDefaultWsUrl(): string {
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

  private createIntentFromQuote(quote: Quote): SwapIntent {
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
      privacyLevel: PrivacyLevel.STANDARD,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

// Export main class as default
export default OmniSwap;
