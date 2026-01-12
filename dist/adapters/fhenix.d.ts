import { Chain, UnsignedTx, SignedTx, Transaction, HTLCParams, HTLCStatus, TxCallback, Unsubscribe } from '../types';
import { BaseChainAdapter, TxParams, AdapterConfig } from './base';
export declare class FhenixAdapter extends BaseChainAdapter {
    chain: Chain;
    nativeCurrency: string;
    private rpcUrl;
    private htlcContractAddress;
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
    createEncryptedHTLC(params: HTLCParams): Promise<UnsignedTx>;
    private fheEncrypt;
    private encodeHTLCInit;
    private encodeEncryptedHTLCInit;
    private decodeHTLCStatus;
    private jsonRpcCall;
}
//# sourceMappingURL=fhenix.d.ts.map