# 4. SDK How-To Guides

Step-by-step tutorials for common tasks with the OmniSwap SDK.

## Table of Contents

1. [How to Perform a Basic Swap](#how-to-perform-a-basic-swap)
2. [How to Execute Privacy-Enhanced Swaps](#how-to-execute-privacy-enhanced-swaps)
3. [How to Handle Errors and Implement Retries](#how-to-handle-errors-and-implement-retries)
4. [How to Monitor Swap Progress](#how-to-monitor-swap-progress)
5. [How to Implement Automatic Refunds](#how-to-implement-automatic-refunds)
6. [How to Integrate with Wallets](#how-to-integrate-with-wallets)
7. [How to Optimize for Speed vs Cost](#how-to-optimize-for-speed-vs-cost)
8. [How to Build Custom Solvers](#how-to-build-custom-solvers)

---

## How to Perform a Basic Swap

### Prerequisites
- Node.js >= 18.0.0
- OmniSwap SDK installed
- RPC endpoints for source and destination chains

### Step 1: Install and Import

```bash
npm install omniswap-sdk
```

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';
```

### Step 2: Initialize SDK

```typescript
const omniswap = new OmniSwap({
  environment: 'mainnet',
  apiKey: process.env.OMNISWAP_API_KEY, // Optional
});

await omniswap.initialize({
  [Chain.ZCASH]: {
    rpcUrl: 'https://zcash-rpc.example.com',
  },
  [Chain.OSMOSIS]: {
    rpcUrl: 'https://osmosis-rpc.example.com',
  },
});
```

### Step 3: Get Quotes

```typescript
const quotes = await omniswap.getQuote({
  sourceChain: Chain.ZCASH,
  destChain: Chain.OSMOSIS,
  sourceAsset: 'ZEC',
  destAsset: 'OSMO',
  sourceAmount: BigInt(1e8), // 1 ZEC
  userAddress: {
    [Chain.ZCASH]: 't1YourZcashAddress',
    [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress',
  },
  slippageTolerance: 0.01, // 1%
  deadline: Date.now() + 3600000, // 1 hour
});

console.log(`Best quote: ${quotes[0].outputAmount} OSMO`);
console.log(`Total fees: ${quotes[0].fees.total}`);
console.log(`Estimated time: ${quotes[0].route.estimatedTime}s`);
```

### Step 4: Execute Swap

```typescript
const execution = await omniswap.executeSwap(quotes[0]);

console.log(`Swap initiated: ${execution.swapId}`);
console.log(`Current state: ${execution.state}`);
```

### Step 5: Monitor Completion

```typescript
const unsubscribe = omniswap.subscribeToSwap(execution.swapId, (update) => {
  console.log(`Status: ${update.status}`);

  if (update.type === 'swap_complete') {
    console.log(`✓ Swap completed! Received: ${update.outputAmount}`);
    unsubscribe();
  } else if (update.type === 'swap_failed') {
    console.error(`✗ Swap failed: ${update.error}`);
    unsubscribe();
  }
});
```

### Complete Example

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

async function performBasicSwap() {
  // Initialize
  const omniswap = new OmniSwap({ environment: 'mainnet' });
  await omniswap.initialize({
    [Chain.ZCASH]: { rpcUrl: process.env.ZCASH_RPC },
    [Chain.OSMOSIS]: { rpcUrl: process.env.OSMOSIS_RPC },
  });

  // Get quotes
  const quotes = await omniswap.getQuote({
    sourceChain: Chain.ZCASH,
    destChain: Chain.OSMOSIS,
    sourceAsset: 'ZEC',
    destAsset: 'OSMO',
    sourceAmount: BigInt(1e8),
    userAddress: {
      [Chain.ZCASH]: 't1YourAddress',
      [Chain.OSMOSIS]: 'osmo1YourAddress',
    },
  });

  // Execute
  const execution = await omniswap.executeSwap(quotes[0]);

  // Monitor
  return new Promise((resolve, reject) => {
    omniswap.subscribeToSwap(execution.swapId, (update) => {
      if (update.type === 'swap_complete') {
        resolve(update.outputAmount);
      } else if (update.type === 'swap_failed') {
        reject(new Error(update.error));
      }
    });
  });
}
```

---

## How to Execute Privacy-Enhanced Swaps

### When to Use Privacy Swaps

Use privacy swaps when:
- You want maximum anonymity
- You need to break on-chain correlation
- Address reuse is a concern
- Timing analysis is a threat

### Step 1: Configure Privacy Level

```typescript
import { OmniSwap, Chain, PrivacyLevel } from 'omniswap-sdk';

const omniswap = new OmniSwap({ environment: 'mainnet' });
await omniswap.initialize({
  [Chain.ZCASH]: { rpcUrl: process.env.ZCASH_RPC },
  [Chain.OSMOSIS]: { rpcUrl: process.env.OSMOSIS_RPC },
});
```

### Step 2: Get Privacy-Optimized Quotes

```typescript
const quotes = await omniswap.getQuote({
  sourceChain: Chain.ZCASH,
  destChain: Chain.OSMOSIS,
  sourceAsset: 'ZEC',
  destAsset: 'OSMO',
  sourceAmount: BigInt(5e8), // 5 ZEC
  userAddress: {
    [Chain.ZCASH]: 't1YourZcashAddress',
    [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress',
  },
  privacyLevel: PrivacyLevel.MAXIMUM,
});
```

### Step 3: Configure Privacy Hub

```typescript
const privacyConfig = {
  hubChain: 'zcash',           // Use Zcash shielded pool
  minMixingDelay: 30 * 60 * 1000,        // 30 min minimum
  maxMixingDelay: 4 * 60 * 60 * 1000,    // 4 hours maximum
  useSplitAmounts: true,                  // Split into smaller denominations
  splitDenominations: [
    BigInt(1e8),   // 1 ZEC
    BigInt(5e7),   // 0.5 ZEC
    BigInt(1e7),   // 0.1 ZEC
  ],
  useDecoyTransactions: true,             // Add decoy transactions
  decoyCount: 3,                          // 3 decoys
};
```

### Step 4: Execute Private Swap

```typescript
const execution = await omniswap.executePrivateSwap(quotes[0], {
  hubConfig: privacyConfig,
  useLocalExecution: true, // Execute locally for maximum privacy
});

console.log('Privacy features:');
console.log('✓ Correlation broken:', execution.correlationBroken);
console.log('✓ Timing decorrelated:', execution.timingDecorrelated);
console.log('✓ One-time addresses:', execution.addressesOneTime);
```

### Step 5: Generate Stealth Addresses (Optional)

```typescript
// Generate stealth address for receiving
const stealthAddress = await omniswap.generateStealthAddress(
  Chain.OSMOSIS,
  'osmo1YourBaseAddress'
);

console.log('Stealth address:', stealthAddress.address);
console.log('Viewing key:', stealthAddress.viewingKey);

// Use stealth address in swap
const quotesWithStealth = await omniswap.getQuote({
  // ... other params
  userAddress: {
    [Chain.ZCASH]: 't1YourZcashAddress',
    [Chain.OSMOSIS]: stealthAddress.address, // Use stealth address
  },
});
```

### Complete Privacy Swap Example

```typescript
async function executePrivacySwap() {
  const omniswap = new OmniSwap({ environment: 'mainnet' });
  await omniswap.initialize({
    [Chain.ZCASH]: { rpcUrl: process.env.ZCASH_RPC },
    [Chain.OSMOSIS]: { rpcUrl: process.env.OSMOSIS_RPC },
  });

  // Generate stealth address
  const stealth = await omniswap.generateStealthAddress(
    Chain.OSMOSIS,
    'osmo1YourAddress'
  );

  // Get quotes with maximum privacy
  const quotes = await omniswap.getQuote({
    sourceChain: Chain.ZCASH,
    destChain: Chain.OSMOSIS,
    sourceAsset: 'ZEC',
    destAsset: 'OSMO',
    sourceAmount: BigInt(5e8),
    userAddress: {
      [Chain.ZCASH]: 't1YourZcashAddress',
      [Chain.OSMOSIS]: stealth.address,
    },
    privacyLevel: PrivacyLevel.MAXIMUM,
  });

  // Execute with full privacy features
  const execution = await omniswap.executePrivateSwap(quotes[0], {
    hubConfig: {
      hubChain: 'zcash',
      minMixingDelay: 30 * 60 * 1000,
      maxMixingDelay: 4 * 60 * 60 * 1000,
      useSplitAmounts: true,
      useDecoyTransactions: true,
      decoyCount: 3,
    },
  });

  console.log('Privacy swap initiated:', execution.swapId);
  console.log('Privacy guarantees:', {
    correlationBroken: execution.correlationBroken,
    timingDecorrelated: execution.timingDecorrelated,
    addressesOneTime: execution.addressesOneTime,
  });

  return execution;
}
```

---

## How to Handle Errors and Implement Retries

### Error Types

```typescript
import {
  OmniSwapError,
  AdapterError,
  TransactionError,
  HTLCError,
  SwapError,
  NetworkError,
  isRetryableError,
  isRecoverableError,
} from 'omniswap-sdk';
```

### Basic Error Handling

```typescript
try {
  const execution = await omniswap.executeSwap(quote);
} catch (error) {
  if (error instanceof HTLCError) {
    console.error('HTLC error:', error.message);
    console.error('Error code:', error.code);
    console.error('Suggestion:', error.suggestion);
  } else if (error instanceof NetworkError) {
    console.error('Network error:', error.message);
    if (error.retryable) {
      console.log('This error is retryable');
    }
  } else if (error instanceof OmniSwapError) {
    console.error('SDK error:', error.message);
  } else {
    console.error('Unknown error:', error);
  }
}
```

### Implementing Retries

#### Using Built-in Retry Utilities

```typescript
import { withRetry, RetryPresets } from 'omniswap-sdk';

// Use standard preset (3 attempts, exponential backoff)
const execution = await withRetry(
  () => omniswap.executeSwap(quote),
  RetryPresets.standard
);

// Use aggressive preset (5 attempts, faster retries)
const execution = await withRetry(
  () => omniswap.executeSwap(quote),
  RetryPresets.aggressive
);

// Use conservative preset (2 attempts, longer delays)
const execution = await withRetry(
  () => omniswap.executeSwap(quote),
  RetryPresets.conservative
);
```

#### Custom Retry Configuration

```typescript
import { withRetry } from 'omniswap-sdk';

const execution = await withRetry(
  () => omniswap.executeSwap(quote),
  {
    maxAttempts: 5,
    delayMs: 2000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}: ${error.message}`);
    },
  }
);
```

### Circuit Breaker Pattern

```typescript
import { CircuitBreaker } from 'omniswap-sdk';

const breaker = new CircuitBreaker({
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 60000,      // Try again after 1 minute
  halfOpenRequests: 3,      // Allow 3 requests when half-open
  onStateChange: (state) => {
    console.log('Circuit breaker state:', state);
  },
});

async function executeWithCircuitBreaker(quote: Quote) {
  try {
    const execution = await breaker.execute(() =>
      omniswap.executeSwap(quote)
    );
    return execution;
  } catch (error) {
    if (error.message === 'Circuit breaker is open') {
      console.log('Too many failures, circuit breaker opened');
      // Wait or use alternative service
    }
    throw error;
  }
}
```

### Complete Error Handling Example

```typescript
import {
  OmniSwapError,
  isRetryableError,
  withRetry,
  CircuitBreaker,
  RetryPresets,
} from 'omniswap-sdk';

async function robustSwapExecution(quote: Quote) {
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 60000,
  });

  try {
    const execution = await breaker.execute(() =>
      withRetry(
        () => omniswap.executeSwap(quote),
        {
          ...RetryPresets.standard,
          onRetry: (attempt, error) => {
            console.log(`Retry ${attempt}: ${error.message}`);
            notifyUser(`Retrying swap (attempt ${attempt})...`);
          },
        }
      )
    );

    return execution;
  } catch (error) {
    if (error instanceof OmniSwapError) {
      console.error('Swap failed after retries:', error.message);
      console.error('Error code:', error.code);

      if (error.recoverable) {
        console.log('Error is recoverable:', error.suggestion);
        // Show user recovery options
      } else {
        console.log('Error is not recoverable');
        // Initiate refund if applicable
      }
    }

    throw error;
  }
}
```

---

## How to Monitor Swap Progress

### Real-Time Monitoring

```typescript
const execution = await omniswap.executeSwap(quote);

const unsubscribe = omniswap.subscribeToSwap(execution.swapId, (update) => {
  switch (update.type) {
    case 'status_change':
      console.log('New status:', update.status);
      updateUI(update.status);
      break;

    case 'step_complete':
      console.log('Step completed:', update.step);
      updateProgress(update.step);
      break;

    case 'swap_complete':
      console.log('✓ Swap completed!');
      console.log('Received:', update.outputAmount);
      showSuccess(update);
      unsubscribe();
      break;

    case 'swap_failed':
      console.error('✗ Swap failed:', update.error);
      showError(update.error);
      unsubscribe();
      break;
  }
});
```

### Polling Status

```typescript
async function pollSwapStatus(swapId: string, intervalMs: number = 5000) {
  const interval = setInterval(async () => {
    try {
      const status = await omniswap.getSwapStatus(swapId);

      console.log('Current state:', status.status);
      console.log('Steps:', status.steps);

      if (status.status === ExecutionState.COMPLETED) {
        console.log('Swap completed:', status.outputAmount);
        clearInterval(interval);
      } else if (status.status === ExecutionState.FAILED) {
        console.error('Swap failed:', status.error);
        clearInterval(interval);
      }
    } catch (error) {
      console.error('Failed to get status:', error);
    }
  }, intervalMs);

  return () => clearInterval(interval);
}

// Usage
const stopPolling = await pollSwapStatus(execution.swapId);
```

### Progress Bar UI

```typescript
interface SwapProgress {
  currentStep: number;
  totalSteps: number;
  percentage: number;
  estimatedTimeRemaining: number;
}

function createProgressTracker(execution: SwapExecution): SwapProgress {
  let currentStep = 0;
  const totalSteps = execution.steps.length;

  omniswap.subscribeToSwap(execution.swapId, (update) => {
    if (update.type === 'step_complete') {
      currentStep++;

      const progress: SwapProgress = {
        currentStep,
        totalSteps,
        percentage: (currentStep / totalSteps) * 100,
        estimatedTimeRemaining: calculateTimeRemaining(execution, currentStep),
      };

      updateProgressBar(progress);
    }
  });

  return {
    currentStep: 0,
    totalSteps,
    percentage: 0,
    estimatedTimeRemaining: execution.route.estimatedTime,
  };
}
```

---

## How to Implement Automatic Refunds

### Setting Up Refund Manager

```typescript
import { RefundManager, createRefundManager } from 'omniswap-sdk';

const refundManager = createRefundManager(omniswap.getAdapterRegistry(), {
  checkIntervalMs: 60000,        // Check every minute
  autoStart: true,               // Start monitoring automatically
  maxRetries: 3,                 // Retry failed refunds
  onRefundAttempt: (swapId, chain, success, error) => {
    if (success) {
      console.log(`✓ Refund successful for ${swapId} on ${chain}`);
      notifyUser(`Refund processed successfully`);
    } else {
      console.error(`✗ Refund failed for ${swapId}:`, error);
      notifyUser(`Refund failed, will retry`);
    }
  },
});
```

### Register Swaps for Monitoring

```typescript
// Register after executing swap
const execution = await omniswap.executeSwap(quote);
refundManager.registerSwap(execution);

console.log('Swap registered for refund monitoring');
```

### Manual Refund Trigger

```typescript
// Force immediate refund check
const success = await refundManager.forceRefund('htlc_id_12345');

if (success) {
  console.log('Manual refund successful');
} else {
  console.error('Manual refund failed');
}
```

### Get Refund Statistics

```typescript
const stats = refundManager.getStats();

console.log('Refund Statistics:');
console.log('- Pending refunds:', stats.pending);
console.log('- Successful refunds:', stats.successful);
console.log('- Failed refunds:', stats.failed);
console.log('- Success rate:', (stats.successRate * 100).toFixed(2) + '%');
```

### Complete Refund Management Example

```typescript
import { RefundManager, createRefundManager } from 'omniswap-sdk';

async function setupRefundManagement() {
  // Create refund manager
  const refundManager = createRefundManager(
    omniswap.getAdapterRegistry(),
    {
      checkIntervalMs: 60000,
      autoStart: true,
      maxRetries: 3,
      onRefundAttempt: (swapId, chain, success, error) => {
        const message = success
          ? `Refund processed for swap ${swapId}`
          : `Refund failed for swap ${swapId}: ${error}`;

        logRefund({ swapId, chain, success, error, timestamp: Date.now() });
        notifyUser(message);
      },
    }
  );

  // Execute swap
  const execution = await omniswap.executeSwap(quote);

  // Register for refund monitoring
  refundManager.registerSwap(execution);

  // Monitor swap
  omniswap.subscribeToSwap(execution.swapId, async (update) => {
    if (update.type === 'swap_complete') {
      console.log('Swap completed successfully');
      // No refund needed
    } else if (update.type === 'swap_failed') {
      console.log('Swap failed, refund will be attempted automatically');

      // Optionally force immediate refund
      const refunded = await refundManager.forceRefund(execution.swapId);
      if (refunded) {
        console.log('Immediate refund successful');
      }
    }
  });

  return refundManager;
}
```

---

## Quick Reference

### Common Patterns

```typescript
// 1. Basic swap with monitoring
const quotes = await omniswap.getQuote(request);
const execution = await omniswap.executeSwap(quotes[0]);
omniswap.subscribeToSwap(execution.swapId, callback);

// 2. Privacy swap with stealth addresses
const stealth = await omniswap.generateStealthAddress(chain, address);
const quotes = await omniswap.getQuote({ ...request, privacyLevel: PrivacyLevel.MAXIMUM });
const execution = await omniswap.executePrivateSwap(quotes[0], { hubConfig });

// 3. Error handling with retries
const execution = await withRetry(
  () => omniswap.executeSwap(quote),
  RetryPresets.standard
);

// 4. Automatic refunds
const refundManager = createRefundManager(adapters, config);
refundManager.registerSwap(execution);
```

---

## Next Steps

- **Review [API Reference](./03-api-reference.md)** for detailed API documentation
- **Check [Examples](../examples/)** for complete working examples
- **Read [FAQ](./05-faq.md)** for common questions and solutions
