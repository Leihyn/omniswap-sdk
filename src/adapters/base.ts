import {
  Chain,
  UnsignedTx,
  SignedTx,
  Transaction,
  HTLCParams,
  HTLCStatus,
  TxCallback,
  Unsubscribe,
} from '../types';

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

  // Initialization
  initialize(config: AdapterConfig): Promise<void>;

  // Account operations
  getAddress(publicKey: Buffer): string;
  getBalance(address: string, asset?: string): Promise<bigint>;

  // Transaction operations
  buildTransaction(params: TxParams): Promise<UnsignedTx>;
  signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;
  broadcastTransaction(tx: SignedTx): Promise<string>;

  // HTLC operations
  createHTLC(params: HTLCParams): Promise<UnsignedTx>;
  claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx>;
  refundHTLC(htlcId: string): Promise<UnsignedTx>;
  getHTLCStatus(htlcId: string): Promise<HTLCStatus>;

  // Monitoring
  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe;
  getTransaction(txHash: string): Promise<Transaction>;
  getBlockHeight(): Promise<number>;

  // Finality
  getConfirmations(txHash: string): Promise<number>;
  isFinalized(txHash: string): Promise<boolean>;
  getBlockTime(): number;

  // Chain-specific
  estimateGas(tx: UnsignedTx): Promise<bigint>;

  // Common operations
  waitForConfirmation(txHash: string, confirmations?: number): Promise<void>;
}

export abstract class BaseChainAdapter implements ChainAdapter {
  abstract chain: Chain;
  abstract nativeCurrency: string;

  protected config: AdapterConfig = {};
  protected initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.chain} adapter not initialized`);
    }
  }

  // Must be implemented by each adapter
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

  // Common implementations
  async waitForConfirmation(txHash: string, confirmations = 1): Promise<void> {
    this.ensureInitialized();

    while (true) {
      const currentConfirmations = await this.getConfirmations(txHash);
      if (currentConfirmations >= confirmations) {
        return;
      }
      await this.sleep(this.getBlockTime());
    }
  }

  async waitForFinality(txHash: string): Promise<void> {
    this.ensureInitialized();

    while (true) {
      const finalized = await this.isFinalized(txHash);
      if (finalized) {
        return;
      }
      await this.sleep(this.getBlockTime());
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
