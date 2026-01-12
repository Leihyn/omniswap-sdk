/**
 * OmniSwap SDK Error Classes
 *
 * Provides typed errors for all SDK operations with proper error codes
 * and recovery suggestions.
 */

export enum ErrorCode {
  // Adapter Errors (1xxx)
  ADAPTER_NOT_FOUND = 1001,
  ADAPTER_NOT_INITIALIZED = 1002,
  ADAPTER_INITIALIZATION_FAILED = 1003,
  ADAPTER_CONNECTION_FAILED = 1004,

  // Transaction Errors (2xxx)
  TRANSACTION_BUILD_FAILED = 2001,
  TRANSACTION_SIGN_FAILED = 2002,
  TRANSACTION_BROADCAST_FAILED = 2003,
  TRANSACTION_CONFIRMATION_TIMEOUT = 2004,
  TRANSACTION_REJECTED = 2005,
  INSUFFICIENT_BALANCE = 2006,
  INSUFFICIENT_GAS = 2007,

  // HTLC Errors (3xxx)
  HTLC_CREATE_FAILED = 3001,
  HTLC_CLAIM_FAILED = 3002,
  HTLC_REFUND_FAILED = 3003,
  HTLC_NOT_FOUND = 3004,
  HTLC_ALREADY_CLAIMED = 3005,
  HTLC_ALREADY_REFUNDED = 3006,
  HTLC_TIMELOCK_NOT_EXPIRED = 3007,
  HTLC_TIMELOCK_EXPIRED = 3008,
  HTLC_INVALID_PREIMAGE = 3009,

  // Swap Errors (4xxx)
  SWAP_EXECUTION_FAILED = 4001,
  SWAP_TIMEOUT = 4002,
  SWAP_CANCELLED = 4003,
  SWAP_INVALID_INTENT = 4004,
  SWAP_NO_ROUTE = 4005,
  SWAP_SLIPPAGE_EXCEEDED = 4006,
  SWAP_DEADLINE_EXCEEDED = 4007,

  // Solver Errors (5xxx)
  SOLVER_NOT_FOUND = 5001,
  SOLVER_INSUFFICIENT_INVENTORY = 5002,
  SOLVER_OFFLINE = 5003,

  // Privacy Errors (6xxx)
  PRIVACY_HUB_UNAVAILABLE = 6001,
  STEALTH_ADDRESS_GENERATION_FAILED = 6002,
  CORRELATION_DETECTED = 6003,

  // Network Errors (9xxx)
  NETWORK_ERROR = 9001,
  RPC_ERROR = 9002,
  TIMEOUT = 9003,
  RATE_LIMITED = 9004,
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  cause?: Error;
  context?: Record<string, unknown>;
  recoverable: boolean;
  retryable: boolean;
  suggestion?: string;
}

export class OmniSwapError extends Error {
  public readonly code: ErrorCode;
  public readonly cause?: Error;
  public readonly context?: Record<string, unknown>;
  public readonly recoverable: boolean;
  public readonly retryable: boolean;
  public readonly suggestion?: string;
  public readonly timestamp: number;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = 'OmniSwapError';
    this.code = details.code;
    this.cause = details.cause;
    this.context = details.context;
    this.recoverable = details.recoverable;
    this.retryable = details.retryable;
    this.suggestion = details.suggestion;
    this.timestamp = Date.now();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OmniSwapError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      retryable: this.retryable,
      suggestion: this.suggestion,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// Specialized error classes

export class AdapterError extends OmniSwapError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super({
      code,
      message,
      cause,
      context,
      recoverable: code !== ErrorCode.ADAPTER_NOT_FOUND,
      retryable: [
        ErrorCode.ADAPTER_CONNECTION_FAILED,
        ErrorCode.ADAPTER_INITIALIZATION_FAILED,
      ].includes(code),
      suggestion: getAdapterSuggestion(code),
    });
    this.name = 'AdapterError';
  }
}

export class TransactionError extends OmniSwapError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super({
      code,
      message,
      cause,
      context,
      recoverable: ![
        ErrorCode.INSUFFICIENT_BALANCE,
        ErrorCode.TRANSACTION_REJECTED,
      ].includes(code),
      retryable: [
        ErrorCode.TRANSACTION_BROADCAST_FAILED,
        ErrorCode.TRANSACTION_CONFIRMATION_TIMEOUT,
      ].includes(code),
      suggestion: getTransactionSuggestion(code),
    });
    this.name = 'TransactionError';
  }
}

export class HTLCError extends OmniSwapError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super({
      code,
      message,
      cause,
      context,
      recoverable: ![
        ErrorCode.HTLC_ALREADY_CLAIMED,
        ErrorCode.HTLC_ALREADY_REFUNDED,
        ErrorCode.HTLC_INVALID_PREIMAGE,
      ].includes(code),
      retryable: [
        ErrorCode.HTLC_CREATE_FAILED,
        ErrorCode.HTLC_CLAIM_FAILED,
      ].includes(code),
      suggestion: getHTLCSuggestion(code),
    });
    this.name = 'HTLCError';
  }
}

export class SwapError extends OmniSwapError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super({
      code,
      message,
      cause,
      context,
      recoverable: ![
        ErrorCode.SWAP_CANCELLED,
        ErrorCode.SWAP_DEADLINE_EXCEEDED,
      ].includes(code),
      retryable: [
        ErrorCode.SWAP_EXECUTION_FAILED,
        ErrorCode.SWAP_TIMEOUT,
      ].includes(code),
      suggestion: getSwapSuggestion(code),
    });
    this.name = 'SwapError';
  }
}

export class NetworkError extends OmniSwapError {
  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super({
      code,
      message,
      cause,
      context,
      recoverable: true,
      retryable: true,
      suggestion: getNetworkSuggestion(code),
    });
    this.name = 'NetworkError';
  }
}

// Suggestion generators

function getAdapterSuggestion(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.ADAPTER_NOT_FOUND:
      return 'Verify the chain is supported by OmniSwap SDK';
    case ErrorCode.ADAPTER_NOT_INITIALIZED:
      return 'Call adapter.initialize() before using the adapter';
    case ErrorCode.ADAPTER_CONNECTION_FAILED:
      return 'Check your RPC endpoint URL and network connectivity';
    default:
      return 'Try reinitializing the adapter';
  }
}

function getTransactionSuggestion(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.INSUFFICIENT_BALANCE:
      return 'Ensure sufficient balance including gas fees';
    case ErrorCode.INSUFFICIENT_GAS:
      return 'Increase gas limit or wait for lower network congestion';
    case ErrorCode.TRANSACTION_CONFIRMATION_TIMEOUT:
      return 'Transaction may still confirm. Check block explorer';
    case ErrorCode.TRANSACTION_REJECTED:
      return 'Review transaction parameters and try again';
    default:
      return 'Retry the transaction with updated parameters';
  }
}

function getHTLCSuggestion(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.HTLC_TIMELOCK_NOT_EXPIRED:
      return 'Wait for timelock to expire before attempting refund';
    case ErrorCode.HTLC_TIMELOCK_EXPIRED:
      return 'Timelock has expired. Claim is no longer possible';
    case ErrorCode.HTLC_INVALID_PREIMAGE:
      return 'Verify the preimage matches the hashlock';
    case ErrorCode.HTLC_ALREADY_CLAIMED:
      return 'HTLC has already been claimed successfully';
    default:
      return 'Check HTLC status and retry the operation';
  }
}

function getSwapSuggestion(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.SWAP_NO_ROUTE:
      return 'Try a different trading pair or adjust amount';
    case ErrorCode.SWAP_SLIPPAGE_EXCEEDED:
      return 'Increase slippage tolerance or try a smaller amount';
    case ErrorCode.SWAP_DEADLINE_EXCEEDED:
      return 'Create a new swap intent with a later deadline';
    default:
      return 'Retry the swap or try an alternative route';
  }
}

function getNetworkSuggestion(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.RATE_LIMITED:
      return 'Wait before retrying. Consider using a different RPC';
    case ErrorCode.TIMEOUT:
      return 'Check network connectivity and retry';
    default:
      return 'Check network status and retry the operation';
  }
}

// Error type guards

export function isOmniSwapError(error: unknown): error is OmniSwapError {
  return error instanceof OmniSwapError;
}

export function isRetryableError(error: unknown): boolean {
  if (isOmniSwapError(error)) {
    return error.retryable;
  }
  // Network-related errors are generally retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('econnrefused') ||
      message.includes('rate limit')
    );
  }
  return false;
}

export function isRecoverableError(error: unknown): boolean {
  if (isOmniSwapError(error)) {
    return error.recoverable;
  }
  return true; // Default to recoverable for unknown errors
}

// Error wrapping utility

export function wrapError(
  error: unknown,
  code: ErrorCode,
  context?: Record<string, unknown>
): OmniSwapError {
  if (isOmniSwapError(error)) {
    return error;
  }

  const cause = error instanceof Error ? error : new Error(String(error));
  const message = cause.message || 'Unknown error occurred';

  // Determine error category based on code range
  if (code >= 1000 && code < 2000) {
    return new AdapterError(code, message, context, cause);
  }
  if (code >= 2000 && code < 3000) {
    return new TransactionError(code, message, context, cause);
  }
  if (code >= 3000 && code < 4000) {
    return new HTLCError(code, message, context, cause);
  }
  if (code >= 4000 && code < 5000) {
    return new SwapError(code, message, context, cause);
  }
  if (code >= 9000) {
    return new NetworkError(code, message, context, cause);
  }

  return new OmniSwapError({
    code,
    message,
    cause,
    context,
    recoverable: true,
    retryable: false,
  });
}
