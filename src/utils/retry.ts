/**
 * Retry Logic with Exponential Backoff
 *
 * Provides robust retry mechanisms for network operations,
 * with configurable strategies and circuit breaker pattern.
 */

import { isRetryableError, NetworkError, ErrorCode } from './errors';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter: boolean;
  /** Custom predicate to determine if error is retryable */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback for each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Timeout for each attempt in milliseconds */
  attemptTimeoutMs?: number;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Execute a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Wrap with timeout if specified
      if (opts.attemptTimeoutMs) {
        return await withTimeout(fn(), opts.attemptTimeoutMs);
      }
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetry = opts.shouldRetry
        ? opts.shouldRetry(error, attempt)
        : isRetryableError(error);

      if (!shouldRetry || attempt === opts.maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const baseDelay = opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
      const delay = Math.min(baseDelay, opts.maxDelayMs);
      const jitteredDelay = opts.jitter
        ? delay * (0.5 + Math.random() * 0.5)
        : delay;

      // Notify about retry
      if (opts.onRetry) {
        opts.onRetry(error, attempt, jitteredDelay);
      }

      // Wait before retry
      await sleep(jitteredDelay);
    }
  }

  throw lastError || new Error('Retry failed with no error');
}

/**
 * Execute a function with retry and return detailed result
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const result = await withRetry(async () => {
      attempts++;
      return fn();
    }, options);

    return {
      success: true,
      result,
      attempts,
      totalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts,
      totalTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new NetworkError(
        ErrorCode.TIMEOUT,
        `Operation timed out after ${timeoutMs}ms`,
        { timeoutMs }
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Circuit Breaker Pattern
 *
 * Prevents cascading failures by stopping requests to failing services.
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly options: {
      /** Number of failures before opening circuit (default: 5) */
      failureThreshold: number;
      /** Time in ms before attempting to close circuit (default: 30000) */
      resetTimeoutMs: number;
      /** Callback when circuit state changes */
      onStateChange?: (state: 'closed' | 'open' | 'half-open') => void;
    } = { failureThreshold: 5, resetTimeoutMs: 30000 }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.setState('half-open');
      } else {
        throw new NetworkError(
          ErrorCode.NETWORK_ERROR,
          'Circuit breaker is open',
          { state: this.state, failures: this.failures }
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state !== 'closed') {
      this.setState('closed');
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.setState('open');
    }
  }

  private setState(state: 'closed' | 'open' | 'half-open'): void {
    if (this.state !== state) {
      this.state = state;
      this.options.onStateChange?.(state);
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.setState('closed');
  }
}

/**
 * Retry with circuit breaker
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  breaker: CircuitBreaker,
  retryOptions?: Partial<RetryOptions>
): Promise<T> {
  return breaker.execute(() => withRetry(fn, retryOptions));
}

/**
 * Batch operations with concurrency limit and retry
 */
export async function batchWithRetry<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  options: {
    concurrency?: number;
    retryOptions?: Partial<RetryOptions>;
    stopOnError?: boolean;
  } = {}
): Promise<{ results: R[]; errors: Array<{ item: T; error: Error }> }> {
  const { concurrency = 3, retryOptions, stopOnError = false } = options;
  const results: R[] = [];
  const errors: Array<{ item: T; error: Error }> = [];

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((item) =>
        withRetry(() => fn(item), retryOptions)
      )
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const error = result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason));
        errors.push({ item: batch[j], error });

        if (stopOnError) {
          return { results, errors };
        }
      }
    }
  }

  return { results, errors };
}

// Utility functions

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a retry options preset for different scenarios
 */
export const RetryPresets = {
  /** Quick retries for time-sensitive operations */
  fast: {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 1.5,
    jitter: true,
  } as Partial<RetryOptions>,

  /** Standard retry for most operations */
  standard: {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
  } as Partial<RetryOptions>,

  /** Aggressive retry for critical operations */
  aggressive: {
    maxAttempts: 10,
    initialDelayMs: 500,
    maxDelayMs: 60000,
    backoffMultiplier: 1.5,
    jitter: true,
  } as Partial<RetryOptions>,

  /** Patient retry for slow operations */
  patient: {
    maxAttempts: 5,
    initialDelayMs: 5000,
    maxDelayMs: 120000,
    backoffMultiplier: 2,
    jitter: true,
  } as Partial<RetryOptions>,
};
