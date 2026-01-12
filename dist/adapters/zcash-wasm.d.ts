import { Chain, UnsignedTx, SignedTx, Transaction, HTLCParams, HTLCStatus, TxCallback, Unsubscribe } from '../types';
import { BaseChainAdapter, TxParams, AdapterConfig } from './base';
export interface ZcashWasmConfig extends AdapterConfig {
    wasmPath?: string;
    provingKeyPath?: string;
    viewingKeyPath?: string;
}
export declare class ZcashWasmAdapter extends BaseChainAdapter {
    chain: Chain;
    nativeCurrency: string;
    private wasm;
    private rpcUrl;
    private spendingKey;
    private viewingKey;
    initialize(config: ZcashWasmConfig): Promise<void>;
    private loadWasm;
    generateSpendingKey(seed: Buffer): Promise<Buffer>;
    deriveViewingKey(spendingKey: Buffer): Promise<Buffer>;
    getAddress(publicKey: Buffer): string;
    getShieldedAddress(type?: 'sapling' | 'orchard'): Promise<string>;
    getBalance(address: string, asset?: string): Promise<bigint>;
    buildTransaction(params: TxParams): Promise<UnsignedTx>;
    private buildShieldedTransaction;
    private buildTransparentTransaction;
    signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;
    private signShieldedTransaction;
    private signTransparentTransaction;
    broadcastTransaction(tx: SignedTx): Promise<string>;
    shieldFunds(transparentAddress: string, amount: bigint): Promise<string>;
    unshieldFunds(shieldedAddress: string, transparentAddress: string, amount: bigint): Promise<string>;
    scanForNotes(viewingKey: Buffer, startHeight?: number): Promise<any[]>;
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
    private getCurrentAnchor;
    private buildHTLCScript;
    private scriptToAddress;
    private encodeNumber;
    private rpcCall;
    private parseTransaction;
}
//# sourceMappingURL=zcash-wasm.d.ts.map