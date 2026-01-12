/**
 * Error Handling Example
 *
 * Demonstrates robust error handling with retry logic
 * and the circuit breaker pattern.
 */

import { OmniSwap } from '../src/omniswap';
import { AdapterRegistry } from '../src/adapters';
import {
  OmniSwapError,
  ErrorCode,
  isRetryableError,
  isRecoverableError,
  withRetry,
  withRetryResult,
  withTimeout,
  CircuitBreaker,
  RetryPresets,
} from '../src/utils';
import {
  Chain,
  PrivacyLevel,
  IntentStatus,
  SwapIntent,
  Solver,
} from '../src/types';

async function basicErrorHandling() {
  console.log('=== Basic Error Handling ===\n');

  const omniswap = new OmniSwap();
  await omniswap.initialize({});

  const intent: SwapIntent = {
    id: 'error_test',
    user: { id: 'test', addresses: {} },
    sourceChain: Chain.ZCASH,
    sourceAsset: { symbol: 'ZEC', name: 'Zcash', decimals: 8, chain: Chain.ZCASH },
    sourceAmount: BigInt(1e8),
    destChain: Chain.OSMOSIS,
    destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
    minDestAmount: BigInt(100e6),
    maxSlippage: 0.01,
    deadline: Date.now() + 3600000,
    privacyLevel: PrivacyLevel.STANDARD,
    status: IntentStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const solver: Solver = {
    id: 'test_solver',
    address: {},
    supportedPairs: [],
    inventory: {},
    totalSwaps: 0,
    successRate: 0,
    averageTime: 0,
    stakeAmount: BigInt(0),
    feeRate: 0,
  };

  try {
    await omniswap.executeSwap(intent, solver);
  } catch (error) {
    if (error instanceof OmniSwapError) {
      console.log('Caught OmniSwapError:');
      console.log(`  Code: ${error.code}`);
      console.log(`  Message: ${error.message}`);
      console.log(`  Recoverable: ${error.recoverable}`);
      console.log(`  Retryable: ${error.retryable}`);
      if (error.suggestion) {
        console.log(`  Suggestion: ${error.suggestion}`);
      }
    } else {
      console.log('Caught generic error:', (error as Error).message);
    }
  }

  console.log();
}

async function retryWithBackoff() {
  console.log('=== Retry with Exponential Backoff ===\n');

  let attempts = 0;
  const maxAttempts = 3;

  const simulatedOperation = async () => {
    attempts++;
    console.log(`  Attempt ${attempts}/${maxAttempts}...`);

    if (attempts < maxAttempts) {
      throw new Error('Simulated network error');
    }
    return 'Success!';
  };

  try {
    const result = await withRetry(simulatedOperation, {
      maxAttempts,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      onRetry: (error, attempt, delay) => {
        console.log(`  Retry ${attempt} after ${Math.round(delay)}ms`);
      },
    });
    console.log(`  Result: ${result}\n`);
  } catch (error) {
    console.log(`  Failed after ${attempts} attempts\n`);
  }
}

async function retryWithResult() {
  console.log('=== Retry with Detailed Result ===\n');

  let attempts = 0;

  const result = await withRetryResult(
    async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Temporary failure');
      }
      return { data: 'Important data', timestamp: Date.now() };
    },
    RetryPresets.fast
  );

  console.log(`  Success: ${result.success}`);
  console.log(`  Attempts: ${result.attempts}`);
  console.log(`  Total time: ${result.totalTimeMs}ms`);

  if (result.success) {
    console.log(`  Result: ${JSON.stringify(result.result)}`);
  } else {
    console.log(`  Error: ${result.error?.message}`);
  }

  console.log();
}

async function timeoutExample() {
  console.log('=== Timeout Handling ===\n');

  const slowOperation = () =>
    new Promise<string>((resolve) => {
      setTimeout(() => resolve('Slow result'), 2000);
    });

  try {
    console.log('  Attempting slow operation with 500ms timeout...');
    await withTimeout(slowOperation(), 500);
  } catch (error) {
    if (error instanceof OmniSwapError && error.code === ErrorCode.TIMEOUT) {
      console.log('  Operation timed out as expected');
      console.log(`  Suggestion: ${error.suggestion}`);
    }
  }

  try {
    console.log('\n  Attempting slow operation with 3000ms timeout...');
    const result = await withTimeout(slowOperation(), 3000);
    console.log(`  Result: ${result}`);
  } catch (error) {
    console.log('  Unexpected timeout');
  }

  console.log();
}

async function circuitBreakerExample() {
  console.log('=== Circuit Breaker Pattern ===\n');

  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 2000,
    onStateChange: (state) => {
      console.log(`  Circuit breaker state changed to: ${state}`);
    },
  });

  let callCount = 0;
  const unstableService = async () => {
    callCount++;
    if (callCount <= 4) {
      throw new Error(`Service unavailable (call ${callCount})`);
    }
    return 'Service recovered!';
  };

  // Make calls that will trip the breaker
  console.log('  Making calls to unstable service...');

  for (let i = 0; i < 5; i++) {
    try {
      const result = await breaker.execute(unstableService);
      console.log(`  Call ${i + 1}: ${result}`);
    } catch (error) {
      console.log(`  Call ${i + 1} failed: ${(error as Error).message}`);
    }
    console.log(`  Breaker state: ${breaker.getState()}, failures: ${breaker.getFailures()}`);
  }

  // Wait for reset timeout
  console.log('\n  Waiting for circuit breaker reset...');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // Try again after reset
  console.log('  Attempting call after reset...');
  try {
    const result = await breaker.execute(unstableService);
    console.log(`  Call succeeded: ${result}`);
  } catch (error) {
    console.log(`  Call failed: ${(error as Error).message}`);
  }
  console.log(`  Final state: ${breaker.getState()}\n`);
}

async function retryPresetsExample() {
  console.log('=== Retry Presets ===\n');

  console.log('  Available presets:');
  console.log('  - fast: Quick retries for time-sensitive operations');
  console.log(`    maxAttempts: ${RetryPresets.fast.maxAttempts}`);
  console.log(`    initialDelayMs: ${RetryPresets.fast.initialDelayMs}`);

  console.log('\n  - standard: Default for most operations');
  console.log(`    maxAttempts: ${RetryPresets.standard.maxAttempts}`);
  console.log(`    initialDelayMs: ${RetryPresets.standard.initialDelayMs}`);

  console.log('\n  - aggressive: For critical operations');
  console.log(`    maxAttempts: ${RetryPresets.aggressive.maxAttempts}`);
  console.log(`    initialDelayMs: ${RetryPresets.aggressive.initialDelayMs}`);

  console.log('\n  - patient: For slow operations');
  console.log(`    maxAttempts: ${RetryPresets.patient.maxAttempts}`);
  console.log(`    initialDelayMs: ${RetryPresets.patient.initialDelayMs}`);

  console.log();
}

async function errorCategoriesExample() {
  console.log('=== Error Categories ===\n');

  const errorExamples = [
    { code: ErrorCode.ADAPTER_NOT_FOUND, category: 'Adapter (1xxx)' },
    { code: ErrorCode.TRANSACTION_BUILD_FAILED, category: 'Transaction (2xxx)' },
    { code: ErrorCode.HTLC_TIMELOCK_EXPIRED, category: 'HTLC (3xxx)' },
    { code: ErrorCode.SWAP_NO_ROUTE, category: 'Swap (4xxx)' },
    { code: ErrorCode.SOLVER_INSUFFICIENT_INVENTORY, category: 'Solver (5xxx)' },
    { code: ErrorCode.PRIVACY_HUB_UNAVAILABLE, category: 'Privacy (6xxx)' },
    { code: ErrorCode.NETWORK_ERROR, category: 'Network (9xxx)' },
  ];

  console.log('  Error code ranges:');
  for (const { code, category } of errorExamples) {
    console.log(`  - ${code}: ${category}`);
  }

  console.log();
}

async function main() {
  console.log('OmniSwap SDK - Error Handling Example\n');
  console.log('This example demonstrates error handling patterns.\n');

  await basicErrorHandling();
  await retryWithBackoff();
  await retryWithResult();
  await timeoutExample();
  await circuitBreakerExample();
  await retryPresetsExample();
  await errorCategoriesExample();

  console.log('Error handling example complete!');
}

main().catch(console.error);
