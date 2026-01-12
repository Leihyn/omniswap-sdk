# 3. SDK API Reference

Complete API documentation for the OmniSwap SDK.

## Table of Contents

- [OmniSwap Class](#omniswap-class)
- [Types and Interfaces](#types-and-interfaces)
- [Chain Adapters](#chain-adapters)
- [Core Components](#core-components)
- [Error Handling](#error-handling)
- [Utilities](#utilities)

---

## OmniSwap Class

The main SDK entry point providing all swap functionality.

### Constructor

```typescript
new OmniSwap(config: OmniSwapConfig)
```

#### Parameters

- **config**: `OmniSwapConfig`
  - `apiKey?`: `string` - Optional API key for hosted services
  - `apiUrl?`: `string` - Custom API URL (default: auto-detected based on environment)
  - `wsUrl?`: `string` - Custom WebSocket URL (default: auto-detected)
  - `environment`: `'mainnet' | 'testnet' | 'local'` - Network environment
  - `timeout?`: `number` - Request timeout in ms (default: 30000)
  - `retries?`: `number` - Number of retry attempts (default: 3)

#### Example

```typescript
const omniswap = new OmniSwap({
  environment: 'mainnet',
  apiKey: process.env.OMNISWAP_API_KEY,
  timeout: 60000,
  retries: 5,
});
```

---

### Methods

#### initialize

Initialize chain adapters with their configurations.

```typescript
async initialize(chainConfigs?: Partial<Record<Chain, AdapterConfig>>): Promise<void>
```

**Parameters:**
- `chainConfigs`: Optional chain-specific configurations

**Example:**
```typescript
await omniswap.initialize({
  [Chain.ZCASH]: {
    rpcUrl: 'https://zcash-rpc.example.com',
    apiKey: 'your-zcash-api-key',
  },
  [Chain.OSMOSIS]: {
    rpcUrl: 'https://osmosis-rpc.example.com',
  },
});
```

---

#### getQuote

Get swap quotes for a given request.

```typescript
async getQuote(request: SwapRequest): Promise<Quote[]>
```

**Parameters:**
- `request`: `SwapRequest`
  - `sourceChain`: `Chain` - Source blockchain
  - `destChain`: `Chain` - Destination blockchain
  - `sourceAsset`: `string` - Source asset symbol
  - `destAsset`: `string` - Destination asset symbol
  - `sourceAmount`: `bigint` - Amount to swap
  - `userAddress`: `Partial<Record<Chain, string>>` - User addresses on each chain
  - `slippageTolerance?`: `number` - Max slippage (default: 0.005 = 0.5%)
  - `privacyLevel?`: `PrivacyLevel` - Privacy level (default: STANDARD)
  - `deadline?`: `number` - Swap deadline timestamp in ms

**Returns:** Array of `Quote` objects sorted by best output amount

**Example:**
```typescript
const quotes = await omniswap.getQuote({
  sourceChain: Chain.ZCASH,
  destChain: Chain.OSMOSIS,
  sourceAsset: 'ZEC',
  destAsset: 'OSMO',
  sourceAmount: BigInt(1e8),
  userAddress: {
    [Chain.ZCASH]: 't1YourZcashAddress',
    [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress',
  },
  slippageTolerance: 0.01,
  deadline: Date.now() + 3600000,
});
```

---

#### executeSwap

Execute a swap based on a quote.

```typescript
async executeSwap(
  quote: Quote,
  signatures?: Partial<Record<Chain, SignedTx>>,
  options?: {
    privacyLevel?: PrivacyLevel;
    useLocalExecution?: boolean;
  }
): Promise<SwapExecution>
```

**Parameters:**
- `quote`: `Quote` - Quote to execute
- `signatures?`: Optional pre-signed transactions
- `options?`: Execution options
  - `privacyLevel?`: Privacy level override
  - `useLocalExecution?`: Execute via local adapters instead of API

**Returns:** `SwapExecution` object with swap details

**Example:**
```typescript
const execution = await omniswap.executeSwap(quotes[0], undefined, {
  useLocalExecution: true,
});
```

---

#### executePrivateSwap

Execute a privacy-enhanced swap using the Privacy Hub.

```typescript
async executePrivateSwap(
  quote: Quote,
  options?: {
    hubConfig?: Partial<PrivacyHubConfig>;
    useLocalExecution?: boolean;
  }
): Promise<PrivacyHubExecution>
```

**Parameters:**
- `quote`: `Quote` - Quote to execute
- `options?`: Privacy options
  - `hubConfig?`: Custom Privacy Hub configuration
  - `useLocalExecution?`: Execute locally

**Returns:** `PrivacyHubExecution` with privacy metrics

**Example:**
```typescript
const execution = await omniswap.executePrivateSwap(quote, {
  hubConfig: {
    hubChain: 'zcash',
    minMixingDelay: 30 * 60 * 1000,
    maxMixingDelay: 4 * 60 * 60 * 1000,
    useSplitAmounts: true,
    useDecoyTransactions: true,
    decoyCount: 3,
  },
});
```

---

#### getSwapStatus

Get the current status of a swap.

```typescript
async getSwapStatus(swapId: string): Promise<SwapStatus>
```

**Parameters:**
- `swapId`: Unique swap identifier

**Returns:** `SwapStatus` with current state

**Example:**
```typescript
const status = await omniswap.getSwapStatus('swap_123');
console.log('Current state:', status.status);
```

---

#### subscribeToSwap

Subscribe to real-time swap updates.

```typescript
subscribeToSwap(swapId: string, callback: SwapCallback): Unsubscribe
```

**Parameters:**
- `swapId`: Swap identifier
- `callback`: Function called on updates

**Returns:** Unsubscribe function

**Example:**
```typescript
const unsubscribe = omniswap.subscribeToSwap(execution.swapId, (update) => {
  console.log('Update:', update.type, update.status);

  if (update.type === 'swap_complete') {
    console.log('Received:', update.outputAmount);
    unsubscribe();
  }
});
```

---

#### getSupportedChains

Get list of supported blockchains.

```typescript
getSupportedChains(): Chain[]
```

**Returns:** Array of `Chain` enum values

**Example:**
```typescript
const chains = omniswap.getSupportedChains();
console.log('Supported chains:', chains);
```

---

#### getSupportedPairs

Get all supported trading pairs.

```typescript
async getSupportedPairs(): Promise<TradingPair[]>
```

**Returns:** Array of `TradingPair` objects

**Example:**
```typescript
const pairs = await omniswap.getSupportedPairs();
console.log(`${pairs.length} pairs available`);
```

---

#### getLiquidity

Get liquidity information for a trading pair.

```typescript
async getLiquidity(pair: TradingPair): Promise<LiquidityInfo>
```

**Parameters:**
- `pair`: Trading pair

**Returns:** `LiquidityInfo` with liquidity data

**Example:**
```typescript
const liquidity = await omniswap.getLiquidity(pair);
console.log('Available liquidity:', liquidity.availableLiquidity);
```

---

#### estimateFees

Estimate fees for a swap.

```typescript
async estimateFees(request: SwapRequest): Promise<FeeEstimate>
```

**Parameters:**
- `request`: Swap request

**Returns:** `FeeEstimate` with fee breakdown

**Example:**
```typescript
const fees = await omniswap.estimateFees(request);
console.log('Total fees:', fees.total);
console.log('Protocol fee:', fees.protocolFee);
console.log('Network fees:', fees.networkFees);
```

---

#### getBalance

Get balance for an address on a specific chain.

```typescript
async getBalance(chain: Chain, address: string, asset?: string): Promise<bigint>
```

**Parameters:**
- `chain`: Blockchain
- `address`: Address to check
- `asset?`: Optional asset symbol (defaults to native asset)

**Returns:** Balance as `bigint`

**Example:**
```typescript
const balance = await omniswap.getBalance(
  Chain.ZCASH,
  't1YourZcashAddress',
  'ZEC'
);
console.log('Balance:', balance.toString());
```

---

#### generateStealthAddress

Generate a one-time stealth address.

```typescript
async generateStealthAddress(
  chain: Chain,
  recipientAddress: string
): Promise<StealthAddress>
```

**Parameters:**
- `chain`: Target chain
- `recipientAddress`: Base recipient address

**Returns:** `StealthAddress` object

**Example:**
```typescript
const stealth = await omniswap.generateStealthAddress(
  Chain.ZCASH,
  't1YourZcashAddress'
);
console.log('Stealth address:', stealth.address);
console.log('Viewing key:', stealth.viewingKey);
```

---

#### disconnect

Disconnect from API and clean up resources.

```typescript
disconnect(): void
```

**Example:**
```typescript
omniswap.disconnect();
```

---

## Types and Interfaces

### Chain

Supported blockchain networks.

```typescript
enum Chain {
  ZCASH = 'zcash',
  MIDEN = 'miden',
  AZTEC = 'aztec',
  MINA = 'mina',
  FHENIX = 'fhenix',
  OSMOSIS = 'osmosis',
}
```

### PrivacyLevel

Privacy level for swaps.

```typescript
enum PrivacyLevel {
  STANDARD = 'standard',    // Basic HTLC
  ENHANCED = 'enhanced',    // Stealth + timing
  MAXIMUM = 'maximum',      // Full Privacy Hub
}
```

### Quote

Swap quote from solver or aggregator.

```typescript
interface Quote {
  id: string;
  source: string;
  route: Route;
  inputAmount: bigint;
  outputAmount: bigint;
  fees: FeeBreakdown;
  validUntil: number;
  requiredSignatures: ChainSignatureRequest[];
}
```

### Route

Swap routing path across chains.

```typescript
interface Route {
  id: string;
  hops: RouteHop[];
  estimatedOutput: bigint;
  estimatedFees: FeeBreakdown;
  estimatedTime: number;          // seconds
  slippageRisk: number;            // 0-1
  liquidityDepth: bigint;
  priceImpact: number;             // 0-1
  privacyScore: number;            // 0-100
}
```

### SwapExecution

Swap execution state.

```typescript
interface SwapExecution {
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
```

### PrivacyHubExecution

Privacy-enhanced swap execution.

```typescript
interface PrivacyHubExecution {
  swapId: string;
  intentId: string;
  state: PrivacyHubSwapState;
  route: Route;
  solver?: Solver;

  // Privacy metrics
  correlationBroken: boolean;
  timingDecorrelated: boolean;
  addressesOneTime: boolean;

  // Execution tracking
  steps: ExecutionStep[];
  startedAt: number;
  completedAt?: number;
  actualOutput?: bigint;
}
```

### FeeBreakdown

Fee structure for swaps.

```typescript
interface FeeBreakdown {
  protocolFee: bigint;
  networkFees: Partial<Record<Chain, bigint>>;
  solverFee: bigint;
  total: bigint;
}
```

### StealthAddress

One-time stealth address.

```typescript
interface StealthAddress {
  chain: Chain;
  address: string;
  viewingKey: string;
  spendingKeyHash: string;
  ephemeralPublicKey: string;
  createdAt: number;
}
```

---

## Error Handling

### Error Classes

All SDK errors extend `OmniSwapError`:

```typescript
class OmniSwapError extends Error {
  code: ErrorCode;
  retryable: boolean;
  recoverable: boolean;
  suggestion?: string;
  originalError?: Error;
}

class AdapterError extends OmniSwapError {}
class TransactionError extends OmniSwapError {}
class HTLCError extends OmniSwapError {}
class SwapError extends OmniSwapError {}
class NetworkError extends OmniSwapError {}
```

### Error Checking

```typescript
import {
  isOmniSwapError,
  isRetryableError,
  isRecoverableError
} from 'omniswap-sdk';

try {
  await omniswap.executeSwap(quote);
} catch (error) {
  if (isOmniSwapError(error)) {
    console.log('Error code:', error.code);
    console.log('Retryable:', error.retryable);
    console.log('Suggestion:', error.suggestion);
  }
}
```

---

## Utilities

### Retry Utilities

```typescript
import { withRetry, withRetryResult, RetryPresets } from 'omniswap-sdk';

// Retry with default preset
await withRetry(() => omniswap.executeSwap(quote), RetryPresets.standard);

// Custom retry config
await withRetry(
  () => omniswap.executeSwap(quote),
  {
    maxAttempts: 5,
    delayMs: 2000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
  }
);
```

### Circuit Breaker

```typescript
import { CircuitBreaker } from 'omniswap-sdk';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  halfOpenRequests: 3,
});

await breaker.execute(() => omniswap.executeSwap(quote));
```

### Helper Functions

```typescript
import {
  generateSwapId,
  generateSecret,
  hashSecret,
  formatAmount,
  parseAmount,
  calculateSlippage,
  isValidAddress,
  truncateAddress,
} from 'omniswap-sdk';

// Generate unique swap ID
const swapId = generateSwapId();

// Generate cryptographic secret
const secret = generateSecret();
const hashlock = hashSecret(secret);

// Format amounts
const formatted = formatAmount(BigInt(1e8), 8); // "1.00000000"
const parsed = parseAmount("1.5", 8); // BigInt(150000000)

// Calculate slippage
const slippage = calculateSlippage(expectedAmount, actualAmount);

// Validate address
if (isValidAddress(Chain.ZCASH, address)) {
  console.log('Valid address');
}

// Truncate for display
const short = truncateAddress(address); // "t1Abc...xyz"
```

---

## Next Steps

- **Review [How-To Guides](./04-how-to-guides.md)** for implementation tutorials
- **Check [Examples](../examples/)** for complete code samples
- **Read [FAQ](./05-faq.md)** for common questions
