# Quick Start Guide

*Last modified: November 26, 2025*

---

Get up and running with OmniSwap SDK in minutes.

## Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager
- TypeScript 5.0+ (recommended)

## Installation

```bash
npm install omniswap-sdk
```

Or with yarn:

```bash
yarn add omniswap-sdk
```

## Basic Usage

### 1. Import and Initialize

```typescript
import { OmniSwap, Chain, PrivacyLevel } from 'omniswap-sdk';

// Create SDK instance
const omniswap = new OmniSwap();

// Initialize with chain configurations
await omniswap.initialize({
  [Chain.ZCASH]: { rpcUrl: 'http://localhost:8232' },
  [Chain.OSMOSIS]: { rpcUrl: 'http://localhost:26657' },
  [Chain.AZTEC]: { pxeUrl: 'http://localhost:8080' },
  [Chain.MIDEN]: { nodeUrl: 'http://localhost:57291' },
  [Chain.MINA]: { graphqlEndpoint: 'http://localhost:3085/graphql' },
  [Chain.FHENIX]: { rpcUrl: 'http://localhost:8545' },
});
```

### 2. Create a Swap Intent

```typescript
const intent = {
  id: `swap_${Date.now()}`,
  user: {
    id: 'user_123',
    addresses: {
      [Chain.ZCASH]: 't1YourZcashAddress...',
      [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress...',
    },
  },
  sourceChain: Chain.ZCASH,
  sourceAsset: { symbol: 'ZEC', name: 'Zcash', decimals: 8, chain: Chain.ZCASH },
  sourceAmount: BigInt(1e8), // 1 ZEC
  destChain: Chain.OSMOSIS,
  destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
  minDestAmount: BigInt(100e6), // 100 OSMO minimum
  maxSlippage: 0.01, // 1%
  deadline: Date.now() + 3600000, // 1 hour
  privacyLevel: PrivacyLevel.STANDARD,
  status: IntentStatus.PENDING,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

### 3. Find Routes

```typescript
// Find available routes
const routes = await omniswap.findRoutes(intent);

console.log(`Found ${routes.length} routes`);
console.log(`Best route output: ${routes[0].estimatedOutput}`);
console.log(`Privacy score: ${routes[0].privacyScore}/100`);
```

### 4. Execute Swap

```typescript
// Define solver (market maker)
const solver = {
  id: 'solver_1',
  address: {
    [Chain.ZCASH]: 't1SolverAddress...',
    [Chain.OSMOSIS]: 'osmo1SolverAddress...',
  },
  inventory: { OSMO: BigInt(10000e6) },
  // ... other solver properties
};

// Execute the swap
const execution = await omniswap.executeSwap(intent, solver);

console.log(`Swap completed: ${execution.state}`);
console.log(`Transaction hashes:`, execution.txHashes);
```

## Privacy-Enhanced Swap

For maximum privacy with correlation breaking:

```typescript
// Set privacy level to MAXIMUM
intent.privacyLevel = PrivacyLevel.MAXIMUM;

// Execute privacy-enhanced swap
const execution = await omniswap.executePrivateSwap(intent, solver);

// Verify privacy features
console.log(`Correlation broken: ${execution.correlationBroken}`);
console.log(`Timing decorrelated: ${execution.timingDecorrelated}`);
console.log(`One-time addresses: ${execution.addressesOneTime}`);
```

## Error Handling

```typescript
import { OmniSwapError, withRetry, RetryPresets } from 'omniswap-sdk';

try {
  await omniswap.executeSwap(intent, solver);
} catch (error) {
  if (error instanceof OmniSwapError) {
    console.log(`Error code: ${error.code}`);
    console.log(`Suggestion: ${error.suggestion}`);

    if (error.retryable) {
      // Retry with exponential backoff
      await withRetry(
        () => omniswap.executeSwap(intent, solver),
        RetryPresets.standard
      );
    }
  }
}
```

## Next Steps

- [SDK Introduction](./introduction.md) - Deep dive into SDK architecture
- [Use Cases](./use-cases/index.md) - Common integration patterns
- [API Reference](./api-reference/index.md) - Complete API documentation
- [How-to Guides](./how-to/index.md) - Step-by-step tutorials
