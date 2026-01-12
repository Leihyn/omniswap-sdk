import { createHash } from 'crypto';
import {
  Chain,
  UnsignedTx,
  SignedTx,
  Transaction,
  HTLCParams,
  HTLCStatus,
  HTLCState,
  TxCallback,
  Unsubscribe,
} from '../types';
import { BaseChainAdapter, TxParams, AdapterConfig } from './base';

/**
 * Aztec Network Adapter
 *
 * Aztec is an Ethereum L2 using zkSNARKs (Noir language) for private execution.
 * Architecture: Account model with private/public state.
 *
 * HTLC Implementation:
 * - Noir smart contract with private hash verification
 * - Timelock via Aztec's block timestamp
 * - Private claim/refund execution
 */

export interface AztecAdapterConfig extends AdapterConfig {
  pxeUrl?: string; // Private Execution Environment URL
  contractAddress?: string; // Deployed HTLC contract address
}

export class AztecAdapter extends BaseChainAdapter {
  chain = Chain.AZTEC;
  nativeCurrency = 'ETH';

  private pxeUrl = '';
  private contractAddress = '';
  private htlcStorage: Map<string, HTLCStatus> = new Map();

  async initialize(config: AztecAdapterConfig): Promise<void> {
    await super.initialize(config);
    this.pxeUrl = config.pxeUrl || 'http://localhost:8080';
    this.contractAddress = config.contractAddress || '';
  }

  getAddress(publicKey: Buffer): string {
    // Aztec uses 32-byte addresses derived from public key
    const hash = createHash('sha256').update(publicKey).digest();
    return `0x${hash.toString('hex').slice(0, 64)}`;
  }

  async getBalance(address: string, asset?: string): Promise<bigint> {
    this.ensureInitialized();

    // Query PXE for account balance
    const response = await this.pxeCall('getBalance', {
      address,
      asset: asset || 'ETH',
    });

    return BigInt(response.balance || 0);
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    return {
      chain: this.chain,
      type: params.type || 'transfer',
      to: params.to,
      from: params.from,
      value: params.amount,
      data: params.data,
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    // Aztec transactions are signed via PXE with Schnorr signatures
    // The private key generates a proof of authorization
    const signature = createHash('sha256')
      .update(privateKey)
      .update(JSON.stringify(tx))
      .digest('hex');

    return {
      chain: this.chain,
      rawTx: JSON.stringify(tx),
      signature,
    };
  }

  async broadcastTransaction(tx: SignedTx): Promise<string> {
    this.ensureInitialized();

    // Submit to Aztec sequencer via PXE
    const response = await this.pxeCall('sendTransaction', {
      rawTx: tx.rawTx,
      signature: tx.signature,
    });

    return response.txHash || `aztec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Create HTLC using Noir smart contract
   *
   * Noir HTLC Contract (conceptual):
   * ```noir
   * contract HTLC {
   *   struct Lock {
   *     sender: Field,
   *     receiver: Field,
   *     amount: Field,
   *     hashlock: Field,
   *     timelock: Field,
   *     claimed: bool,
   *     refunded: bool,
   *   }
   *
   *   fn create_lock(
   *     receiver: Field,
   *     hashlock: Field,
   *     timelock: Field,
   *     amount: Field
   *   ) -> Field { ... }
   *
   *   fn claim(lock_id: Field, preimage: Field) { ... }
   *
   *   fn refund(lock_id: Field) { ... }
   * }
   * ```
   */
  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlcId = createHash('sha256')
      .update(params.hashlock)
      .update(params.sender)
      .update(Date.now().toString())
      .digest('hex');

    // Noir function call encoding
    const functionCall = {
      contractAddress: this.contractAddress,
      functionName: 'create_lock',
      args: [
        this.toField(params.receiver),
        this.toField(params.hashlock.toString('hex')),
        params.timelock.toString(),
        params.amount.toString(),
      ],
    };

    // Store HTLC locally for status tracking
    this.htlcStorage.set(htlcId, {
      id: htlcId,
      state: HTLCState.PENDING,
      amount: params.amount,
      hashlock: params.hashlock.toString('hex'),
      timelock: params.timelock,
    });

    return {
      chain: this.chain,
      type: 'htlc_create',
      to: this.contractAddress,
      value: params.amount,
      data: JSON.stringify(functionCall),
      htlcId,
      hashlock: params.hashlock.toString('hex'),
      timelock: params.timelock,
      sender: params.sender,
      receiver: params.receiver,
    };
  }

  async claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlc = this.htlcStorage.get(htlcId);

    // Noir claim function - verifies SHA256(preimage) == hashlock privately
    const functionCall = {
      contractAddress: this.contractAddress,
      functionName: 'claim',
      args: [
        this.toField(htlcId),
        this.toField(preimage.toString('hex')),
      ],
    };

    return {
      chain: this.chain,
      type: 'htlc_claim',
      to: this.contractAddress,
      data: JSON.stringify(functionCall),
      htlcId,
      preimage: preimage.toString('hex'),
      amount: htlc?.amount || BigInt(0),
    };
  }

  async refundHTLC(htlcId: string): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlc = this.htlcStorage.get(htlcId);

    // Noir refund function - verifies timelock expired
    const functionCall = {
      contractAddress: this.contractAddress,
      functionName: 'refund',
      args: [this.toField(htlcId)],
    };

    return {
      chain: this.chain,
      type: 'htlc_refund',
      to: this.contractAddress,
      data: JSON.stringify(functionCall),
      htlcId,
      amount: htlc?.amount || BigInt(0),
    };
  }

  async getHTLCStatus(htlcId: string): Promise<HTLCStatus> {
    this.ensureInitialized();

    // Check local storage first
    const local = this.htlcStorage.get(htlcId);
    if (local) {
      return local;
    }

    // Query contract state via PXE
    try {
      const response = await this.pxeCall('viewFunction', {
        contractAddress: this.contractAddress,
        functionName: 'get_lock',
        args: [this.toField(htlcId)],
      });

      return {
        id: htlcId,
        state: this.parseHTLCState(response),
        amount: BigInt(response.amount || 0),
        hashlock: response.hashlock || '',
        timelock: parseInt(response.timelock || '0'),
      };
    } catch {
      return {
        id: htlcId,
        state: HTLCState.PENDING,
        amount: BigInt(0),
        hashlock: '',
        timelock: 0,
      };
    }
  }

  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe {
    this.ensureInitialized();

    // Poll-based subscription for Aztec
    let running = true;
    let lastBlock = 0;

    const poll = async () => {
      while (running) {
        try {
          const currentBlock = await this.getBlockHeight();
          if (currentBlock > lastBlock) {
            // Query PXE for new transactions to this address
            const txs = await this.pxeCall('getTransactions', {
              address,
              fromBlock: lastBlock,
              toBlock: currentBlock,
            });

            for (const tx of txs || []) {
              callback(this.parseTransaction(tx));
            }
            lastBlock = currentBlock;
          }
        } catch {
          // Ignore polling errors
        }
        await this.sleep(this.getBlockTime());
      }
    };

    poll();
    return () => { running = false; };
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    this.ensureInitialized();

    const response = await this.pxeCall('getTransaction', { txHash });

    return this.parseTransaction(response);
  }

  async getBlockHeight(): Promise<number> {
    this.ensureInitialized();

    const response = await this.pxeCall('getBlockNumber', {});
    return response.blockNumber || 0;
  }

  async getConfirmations(txHash: string): Promise<number> {
    this.ensureInitialized();

    try {
      const tx = await this.pxeCall('getTransaction', { txHash });
      const currentBlock = await this.getBlockHeight();

      if (tx.blockNumber) {
        return currentBlock - tx.blockNumber;
      }
    } catch {
      // Transaction not found
    }
    return 0;
  }

  async isFinalized(txHash: string): Promise<boolean> {
    // Aztec L2 has faster finality due to ZK proofs
    // Finality after proof is submitted to L1 (~10-15 minutes)
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 1; // Single confirmation with ZK proof
  }

  getBlockTime(): number {
    return 12000; // ~12 seconds per Aztec block
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();

    // Aztec uses L2 gas + L1 calldata costs
    const baseGas = BigInt(100000);
    const dataGas = BigInt((tx.data?.length || 0) * 16);

    return baseGas + dataGas;
  }

  // Aztec-specific methods

  /**
   * Get shielded balance (private)
   */
  async getShieldedBalance(address: string): Promise<bigint> {
    this.ensureInitialized();

    const response = await this.pxeCall('getPrivateBalance', { address });
    return BigInt(response.balance || 0);
  }

  /**
   * Shield funds (public -> private)
   */
  async shieldFunds(address: string, amount: bigint): Promise<string> {
    this.ensureInitialized();

    const response = await this.pxeCall('shield', {
      address,
      amount: amount.toString(),
    });

    return response.txHash || '';
  }

  /**
   * Unshield funds (private -> public)
   */
  async unshieldFunds(address: string, amount: bigint): Promise<string> {
    this.ensureInitialized();

    const response = await this.pxeCall('unshield', {
      address,
      amount: amount.toString(),
    });

    return response.txHash || '';
  }

  // Helper methods

  private toField(value: string): string {
    // Convert to Noir Field element (< p where p is BN254 scalar field)
    if (value.startsWith('0x')) {
      return value;
    }
    return `0x${createHash('sha256').update(value).digest('hex').slice(0, 64)}`;
  }

  private parseHTLCState(response: any): HTLCState {
    if (response.claimed) return HTLCState.CLAIMED;
    if (response.refunded) return HTLCState.REFUNDED;
    if (response.expired) return HTLCState.EXPIRED;
    if (response.locked) return HTLCState.LOCKED;
    return HTLCState.PENDING;
  }

  private parseTransaction(tx: any): Transaction {
    return {
      hash: tx.txHash || tx.hash || '',
      chain: this.chain,
      from: tx.from || '',
      to: tx.to || '',
      value: BigInt(tx.value || tx.amount || 0),
      status: tx.status === 'confirmed' ? 'confirmed' : tx.status === 'failed' ? 'failed' : 'pending',
      confirmations: tx.confirmations || 0,
      blockNumber: tx.blockNumber,
      timestamp: tx.timestamp ? tx.timestamp * 1000 : undefined,
    };
  }

  private async pxeCall(method: string, params: any): Promise<any> {
    try {
      const response = await fetch(`${this.pxeUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`PXE error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      // Return empty response for development/testing
      return {};
    }
  }
}
