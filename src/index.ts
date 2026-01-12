// Main SDK export
export { OmniSwap, default } from './omniswap';

// Types
export * from './types';

// Adapters
export {
  ChainAdapter,
  BaseChainAdapter,
  AdapterConfig,
  TxParams,
  AdapterRegistry,
  OsmosisAdapter,
  ZcashAdapter,
  ZcashWasmAdapter,
  FhenixAdapter,
  AztecAdapter,
  MidenAdapter,
  MinaAdapter,
} from './adapters';

// Core components
export {
  QuoteEngine,
  QuoteSource,
  RouteOptimizer,
  HTLCCoordinator,
  IntentPool,
  ApiClient,
  ApiClientConfig,
  PrivacyHubCoordinator,
  StealthAddressGenerator,
  TimingDecorrelator,
  TIMELOCK_CONFIG,
  RefundManager,
  createRefundManager,
} from './core';

// Utilities
export {
  OmniSwapError,
  AdapterError,
  TransactionError,
  HTLCError,
  SwapError,
  NetworkError,
  ErrorCode,
  isOmniSwapError,
  isRetryableError,
  isRecoverableError,
  wrapError,
  withRetry,
  withRetryResult,
  withTimeout,
  CircuitBreaker,
  RetryPresets,
  generateSwapId,
  generateSecret,
  hashSecret,
  formatAmount,
  parseAmount,
  calculateSlippage,
  isValidAddress,
  truncateAddress,
} from './utils';
