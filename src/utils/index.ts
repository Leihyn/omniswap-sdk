import { createHash, randomBytes } from 'crypto';

// Re-export error and retry utilities
export * from './errors';
export { withRetry, withRetryResult, withTimeout, CircuitBreaker, RetryPresets } from './retry';
export type { RetryOptions, RetryResult } from './retry';

export function generateSwapId(): string {
  return `swap_${Date.now()}_${randomBytes(8).toString('hex')}`;
}

export function generateSecret(): Buffer {
  return randomBytes(32);
}

export function hashSecret(secret: Buffer): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatAmount(amount: bigint, decimals: number): string {
  const str = amount.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, -decimals) || '0';
  const decPart = str.slice(-decimals);
  return `${intPart}.${decPart}`;
}

export function parseAmount(amount: string, decimals: number): bigint {
  const [intPart, decPart = ''] = amount.split('.');
  const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart + paddedDec);
}

export function calculateSlippage(
  expected: bigint,
  actual: bigint
): number {
  if (expected === BigInt(0)) return 0;
  return Number(expected - actual) / Number(expected);
}

export function isValidAddress(chain: string, address: string): boolean {
  switch (chain) {
    case 'zcash':
      return address.startsWith('t1') || address.startsWith('t3') || address.startsWith('zs');
    case 'osmosis':
      return address.startsWith('osmo1');
    case 'fhenix':
    case 'aztec':
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    case 'mina':
      return address.startsWith('B62');
    default:
      return true;
  }
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number = 1000
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    let lastError: Error;

    for (let i = 0; i <= maxRetries; i++) {
      try {
        const result = await fn();
        return resolve(result);
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries) {
          await sleep(delayMs * Math.pow(2, i));
        }
      }
    }

    reject(lastError!);
  });
}
