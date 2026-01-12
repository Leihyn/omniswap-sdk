import { Chain, UnsignedTx, SignedTx, Transaction, HTLCParams, HTLCStatus, TxCallback, Unsubscribe } from '../types';
export interface TxParams {
    to: string;
    from?: string;
    amount: bigint;
    asset?: string;
    memo?: string;
    type?: string;
    data?: string;
    gasLimit?: bigint;
}
export interface AdapterConfig {
    rpcUrl?: string;
    apiKey?: string;
    network?: 'mainnet' | 'testnet';
}
export interface ChainAdapter {
    chain: Chain;
    nativeCurrency: string;
    initialize(config: AdapterConfig): Promise<void>;
    getAddress(publicKey: Buffer): string;
    getBalance(address: string, asset?: string): Promise<bigint>;
    buildTransaction(params: TxParams): Promise<UnsignedTx>;
    signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;
    broadcastTransaction(tx: SignedTx): Promise<string>;
    createHTLC(params: HTLCParams): Promise<UnsignedTx>;
    claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx>;
    refundHTLC(htlcId: string): Promise<UnsignedTx>;
    getHTLCStatus(htlcId: string): Promise<HTLCStatus>;
    subscribeToAddress(address: string, callback: TxCallback): Unsubscribe;
    getTransaction(txHash: string): Promise<Transaction>;
    getBlockHeight(): Promise<number>;
    getConfirmations(txHash: string): Promise<number>;
    isFinalized(txHash: string): Promise<boolean>;
    getBlockTime(): number;
    estimateGas(tx: UnsignedTx): Promise<bigint>;
    waitForConfirmation(txHash: string, confirmations?: number): Promise<void>;
}
export declare abstract class BaseChainAdapter implements ChainAdapter {
    abstract chain: Chain;
    abstract nativeCurrency: string;
    protected config: AdapterConfig;
    protected initialized: boolean;
    initialize(config: AdapterConfig): Promise<void>;
    protected ensureInitialized(): void;
    abstract getAddress(publicKey: Buffer): string;
    abstract getBalance(address: string, asset?: string): Promise<bigint>;
    abstract buildTransaction(params: TxParams): Promise<UnsignedTx>;
    abstract signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;
    abstract broadcastTransaction(tx: SignedTx): Promise<string>;
    abstract createHTLC(params: HTLCParams): Promise<UnsignedTx>;
    abstract claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx>;
    abstract refundHTLC(htlcId: string): Promise<UnsignedTx>;
    abstract getHTLCStatus(htlcId: string): Promise<HTLCStatus>;
    abstract subscribeToAddress(address: string, callback: TxCallback): Unsubscribe;
    abstract getTransaction(txHash: string): Promise<Transaction>;
    abstract getBlockHeight(): Promise<number>;
    abstract getConfirmations(txHash: string): Promise<number>;
    abstract isFinalized(txHash: string): Promise<boolean>;
    abstract getBlockTime(): number;
    abstract estimateGas(tx: UnsignedTx): Promise<bigint>;
    waitForConfirmation(txHash: string, confirmations?: number): Promise<void>;
    waitForFinality(txHash: string): Promise<void>;
    protected sleep(ms: number): Promise<void>;
}
//# sourceMappingURL=base.d.ts.map