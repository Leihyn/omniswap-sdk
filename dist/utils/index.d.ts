export declare function generateSwapId(): string;
export declare function generateSecret(): Buffer;
export declare function hashSecret(secret: Buffer): Buffer;
export declare function sleep(ms: number): Promise<void>;
export declare function formatAmount(amount: bigint, decimals: number): string;
export declare function parseAmount(amount: string, decimals: number): bigint;
export declare function calculateSlippage(expected: bigint, actual: bigint): number;
export declare function isValidAddress(chain: string, address: string): boolean;
export declare function truncateAddress(address: string, chars?: number): string;
export declare function retry<T>(fn: () => Promise<T>, maxRetries: number, delayMs?: number): Promise<T>;
//# sourceMappingURL=index.d.ts.map