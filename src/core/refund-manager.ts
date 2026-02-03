/**
 * Refund Manager
 *
 * Automated refund logic for failed or expired HTLCs.
 * Monitors swap states and automatically triggers refunds when timelocks expire.
 */

import { createHash } from 'crypto';
import {
  Chain,
  SwapExecution,
  ExecutionState,
  HTLCStatus,
  HTLCState,
  PrivacyHubSwapState,
} from '../types';
import { AdapterRegistry } from '../adapters';
import {
  withRetry,
  RetryPresets,
  OmniSwapError,
  HTLCError,
  ErrorCode,
} from '../utils';

export interface RefundConfig {
  /** How often to check for refundable HTLCs (ms, default: 60000) */
  checkIntervalMs: number;
  /** Buffer time before attempting refund after timelock (ms, default: 300000) */
  refundBufferMs: number;
  /** Maximum concurrent refund attempts (default: 3) */
  maxConcurrentRefunds: number;
  /** Auto-start monitoring on initialization (default: false) */
  autoStart: boolean;
  /** Callback when refund is attempted */
  onRefundAttempt?: (swapId: string, chain: Chain, success: boolean) => void;
  /** Callback when refund monitoring detects an issue */
  onError?: (error: Error, context: Record<string, unknown>) => void;
}

export interface PendingRefund {
  swapId: string;
  htlcId: string;
  chain: Chain;
  timelock: number;
  amount: bigint;
  refundAddress: string;
  privateKey?: Buffer;
  attempts: number;
  lastAttempt?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export interface RefundResult {
  swapId: string;
  htlcId: string;
  chain: Chain;
  success: boolean;
  txHash?: string;
  error?: string;
  attemptedAt: number;
}

const DEFAULT_CONFIG: RefundConfig = {
  checkIntervalMs: 60000,
  refundBufferMs: 300000, // 5 minute buffer
  maxConcurrentRefunds: 3,
  autoStart: false,
};

export class RefundManager {
  private adapters: AdapterRegistry;
  private config: RefundConfig;
  private pendingRefunds: Map<string, PendingRefund> = new Map();
  private refundHistory: RefundResult[] = [];
  private monitoring = false;
  private monitorInterval?: NodeJS.Timeout;

  constructor(adapters: AdapterRegistry, config: Partial<RefundConfig> = {}) {
    this.adapters = adapters;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoStart) {
      this.startMonitoring();
    }
  }

  /**
   * Register a swap for potential refund monitoring
   */
  registerSwap(execution: SwapExecution): void {
    // Extract HTLC info from execution steps
    for (const step of execution.steps) {
      if (step.name === 'lock_source' && step.htlcId) {
        this.pendingRefunds.set(step.htlcId, {
          swapId: execution.swapId,
          htlcId: step.htlcId,
          chain: step.chain!,
          timelock: step.timelock || Math.floor(Date.now() / 1000) + 3600,
          amount: execution.route.hops[0]?.fee || BigInt(0),
          refundAddress: execution.route.hops[0]?.fromAsset?.chain && execution.solver
            ? execution.solver.address[execution.route.hops[0].fromChain] || ''
            : '',
          attempts: 0,
          status: 'pending',
        });
      }
    }
  }

  /**
   * Register a privacy-enhanced swap for refund monitoring
   */
  registerPrivateSwap(
    swapId: string,
    state: PrivacyHubSwapState,
    refundAddress: string
  ): void {
    // Register source HTLC
    if (state.sourceHTLC) {
      this.pendingRefunds.set(state.sourceHTLC.id, {
        swapId,
        htlcId: state.sourceHTLC.id,
        chain: Chain.ZCASH, // Source chain from privacy hub
        timelock: state.sourceTimelock,
        amount: state.sourceHTLC.amount,
        refundAddress,
        attempts: 0,
        status: 'pending',
      });
    }
  }

  /**
   * Manually register an HTLC for refund monitoring
   */
  registerHTLC(params: {
    swapId: string;
    htlcId: string;
    chain: Chain;
    timelock: number;
    amount: bigint;
    refundAddress: string;
    privateKey?: Buffer;
  }): void {
    this.pendingRefunds.set(params.htlcId, {
      ...params,
      attempts: 0,
      status: 'pending',
    });
  }

  /**
   * Remove an HTLC from refund monitoring (e.g., after successful claim)
   */
  unregisterHTLC(htlcId: string): void {
    this.pendingRefunds.delete(htlcId);
  }

  /**
   * Start automated refund monitoring
   */
  startMonitoring(): void {
    if (this.monitoring) return;

    this.monitoring = true;
    this.monitorInterval = setInterval(
      () => this.checkRefunds(),
      this.config.checkIntervalMs
    );

    // Run initial check
    this.checkRefunds();
  }

  /**
   * Stop automated refund monitoring
   */
  stopMonitoring(): void {
    this.monitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  /**
   * Check all pending refunds and process eligible ones
   */
  async checkRefunds(): Promise<RefundResult[]> {
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = Math.floor(this.config.refundBufferMs / 1000);
    const results: RefundResult[] = [];

    // Find eligible refunds
    const eligible: PendingRefund[] = [];
    for (const refund of this.pendingRefunds.values()) {
      if (
        refund.status === 'pending' &&
        refund.timelock + bufferSeconds <= now
      ) {
        eligible.push(refund);
      }
    }

    // Process in batches respecting concurrency limit
    for (let i = 0; i < eligible.length; i += this.config.maxConcurrentRefunds) {
      const batch = eligible.slice(i, i + this.config.maxConcurrentRefunds);
      const batchResults = await Promise.allSettled(
        batch.map((refund) => this.executeRefund(refund))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            swapId: batch[j].swapId,
            htlcId: batch[j].htlcId,
            chain: batch[j].chain,
            success: false,
            error: result.reason?.message || 'Unknown error',
            attemptedAt: Date.now(),
          });
        }
      }
    }

    // Store in history
    this.refundHistory.push(...results);

    return results;
  }

  /**
   * Execute a single refund
   */
  async executeRefund(refund: PendingRefund): Promise<RefundResult> {
    const result: RefundResult = {
      swapId: refund.swapId,
      htlcId: refund.htlcId,
      chain: refund.chain,
      success: false,
      attemptedAt: Date.now(),
    };

    try {
      // Update status
      refund.status = 'processing';
      refund.attempts++;
      refund.lastAttempt = Date.now();

      // Get adapter
      const adapter = this.adapters.get(refund.chain);

      // Check current HTLC status
      const htlcStatus = await adapter.getHTLCStatus(refund.htlcId);

      // Verify HTLC is still refundable
      if (htlcStatus.state === HTLCState.CLAIMED) {
        throw new HTLCError(
          ErrorCode.HTLC_ALREADY_CLAIMED,
          'HTLC has already been claimed',
          { htlcId: refund.htlcId }
        );
      }

      if (htlcStatus.state === HTLCState.REFUNDED) {
        // Already refunded, mark as complete
        refund.status = 'completed';
        result.success = true;
        this.pendingRefunds.delete(refund.htlcId);
        return result;
      }

      // Check timelock
      const now = Math.floor(Date.now() / 1000);
      if (htlcStatus.timelock > now) {
        throw new HTLCError(
          ErrorCode.HTLC_TIMELOCK_NOT_EXPIRED,
          `Timelock expires in ${htlcStatus.timelock - now} seconds`,
          { htlcId: refund.htlcId, timelock: htlcStatus.timelock }
        );
      }

      // Build refund transaction
      const refundTx = await withRetry(
        () => adapter.refundHTLC(refund.htlcId),
        RetryPresets.standard
      );

      // Sign transaction
      const privateKey = refund.privateKey || Buffer.alloc(32);
      const signedTx = await adapter.signTransaction(refundTx, privateKey);

      // Broadcast with retry
      const txHash = await withRetry(
        () => adapter.broadcastTransaction(signedTx),
        RetryPresets.aggressive
      );

      // Wait for confirmation
      await withRetry(
        () => adapter.waitForConfirmation(txHash, 1),
        {
          ...RetryPresets.patient,
          attemptTimeoutMs: 120000,
        }
      );

      // Success
      refund.status = 'completed';
      result.success = true;
      result.txHash = txHash;

      // Remove from pending
      this.pendingRefunds.delete(refund.htlcId);

      // Notify
      this.config.onRefundAttempt?.(refund.swapId, refund.chain, true);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.error = errorMessage;
      refund.error = errorMessage;

      // Determine if we should retry later
      if (refund.attempts >= 5) {
        refund.status = 'failed';
      } else {
        refund.status = 'pending';
      }

      // Notify
      this.config.onRefundAttempt?.(refund.swapId, refund.chain, false);
      this.config.onError?.(
        error instanceof Error ? error : new Error(errorMessage),
        { refund }
      );
    }

    return result;
  }

  /**
   * Force immediate refund attempt
   */
  async forceRefund(htlcId: string): Promise<RefundResult> {
    const refund = this.pendingRefunds.get(htlcId);
    if (!refund) {
      throw new HTLCError(
        ErrorCode.HTLC_NOT_FOUND,
        `HTLC ${htlcId} not registered for refund`,
        { htlcId }
      );
    }

    return this.executeRefund(refund);
  }

  /**
   * Get status of a pending refund
   */
  getRefundStatus(htlcId: string): PendingRefund | undefined {
    return this.pendingRefunds.get(htlcId);
  }

  /**
   * Get all pending refunds
   */
  getPendingRefunds(): PendingRefund[] {
    return Array.from(this.pendingRefunds.values());
  }

  /**
   * Get refund history
   */
  getRefundHistory(): RefundResult[] {
    return [...this.refundHistory];
  }

  /**
   * Get refunds that are currently eligible (timelock expired)
   */
  getEligibleRefunds(): PendingRefund[] {
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = Math.floor(this.config.refundBufferMs / 1000);

    return Array.from(this.pendingRefunds.values()).filter(
      (refund) =>
        refund.status === 'pending' &&
        refund.timelock + bufferSeconds <= now
    );
  }

  /**
   * Get statistics about refund operations
   */
  getStats(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    totalAttempts: number;
    successRate: number;
  } {
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let totalAttempts = 0;

    for (const refund of this.pendingRefunds.values()) {
      totalAttempts += refund.attempts;
      switch (refund.status) {
        case 'pending':
          pending++;
          break;
        case 'processing':
          processing++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    // Add history stats
    const successfulHistory = this.refundHistory.filter((r) => r.success).length;
    completed += successfulHistory;

    const total = completed + failed;
    const successRate = total > 0 ? successfulHistory / total : 0;

    return {
      pending,
      processing,
      completed,
      failed,
      totalAttempts,
      successRate,
    };
  }

  /**
   * Clear all pending refunds (use with caution)
   */
  clearPending(): void {
    this.pendingRefunds.clear();
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    pendingRefunds: PendingRefund[];
    refundHistory: RefundResult[];
  } {
    return {
      pendingRefunds: Array.from(this.pendingRefunds.values()),
      refundHistory: [...this.refundHistory],
    };
  }

  /**
   * Import state from persistence
   */
  importState(state: {
    pendingRefunds: PendingRefund[];
    refundHistory: RefundResult[];
  }): void {
    this.pendingRefunds.clear();
    for (const refund of state.pendingRefunds) {
      this.pendingRefunds.set(refund.htlcId, refund);
    }
    this.refundHistory = state.refundHistory;
  }
}

/**
 * Create a refund manager with default configuration
 */
export function createRefundManager(
  adapters: AdapterRegistry,
  config?: Partial<RefundConfig>
): RefundManager {
  return new RefundManager(adapters, config);
}
