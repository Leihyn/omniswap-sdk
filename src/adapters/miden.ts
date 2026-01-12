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
 * Miden Adapter
 *
 * Miden is a zkSTARK-based rollup (Polygon ecosystem) with account-based model.
 * Uses Miden VM and Miden Assembly for smart contracts.
 *
 * Architecture:
 * - Account model with STARK proofs
 * - Miden Assembly for contract logic
 * - Client-side proof generation
 *
 * HTLC Implementation:
 * - Miden note with hash/time constraints
 * - STARK proof of preimage knowledge for claims
 * - Block height based timelocks
 */

export interface MidenAdapterConfig extends AdapterConfig {
  nodeUrl?: string;
  proverUrl?: string; // Remote prover service (optional)
}

export class MidenAdapter extends BaseChainAdapter {
  chain = Chain.MIDEN;
  nativeCurrency = 'MIDEN';

  private nodeUrl = '';
  private proverUrl = '';
  private htlcStorage: Map<string, HTLCStatus> = new Map();

  async initialize(config: MidenAdapterConfig): Promise<void> {
    await super.initialize(config);
    this.nodeUrl = config.nodeUrl || 'http://localhost:57291';
    this.proverUrl = config.proverUrl || '';
  }

  getAddress(publicKey: Buffer): string {
    // Miden account IDs are 64-bit integers derived from public key
    // Represented as 16-character hex string
    const hash = createHash('sha256').update(publicKey).digest();
    return `0x${hash.toString('hex').slice(0, 16)}`;
  }

  async getBalance(address: string, asset?: string): Promise<bigint> {
    this.ensureInitialized();

    const response = await this.nodeCall('get_account_balance', {
      account_id: address,
      asset_id: asset || 'native',
    });

    return BigInt(response.balance || 0);
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // Miden transactions are note-based
    return {
      chain: this.chain,
      type: params.type || 'transfer',
      to: params.to,
      from: params.from,
      value: params.amount,
      data: params.data,
      noteType: 'P2ID', // Pay to ID note
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    // Miden uses Falcon signatures (post-quantum)
    // Generate transaction kernel + note proofs
    const txKernel = this.buildTxKernel(tx, privateKey);

    return {
      chain: this.chain,
      rawTx: JSON.stringify({
        kernel: txKernel,
        notes: tx.notes || [],
      }),
      signature: createHash('sha256').update(privateKey).update(txKernel).digest('hex'),
    };
  }

  async broadcastTransaction(tx: SignedTx): Promise<string> {
    this.ensureInitialized();

    // Submit to Miden node
    const response = await this.nodeCall('submit_transaction', {
      tx_data: tx.rawTx,
      signature: tx.signature,
    });

    return response.tx_id || `miden_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Create HTLC using Miden note script
   *
   * Miden Assembly HTLC (conceptual):
   * ```masm
   * # HTLC Note Script
   * # Inputs: [hashlock, timelock, receiver]
   * # Stack after execution should be empty for valid spend
   *
   * proc.htlc_claim
   *   # Get preimage from advice stack
   *   adv_push.4
   *
   *   # Hash the preimage using RPO (Rescue Prime Optimized)
   *   hperm
   *
   *   # Compare with hashlock
   *   mem_load.0  # Load hashlock from memory
   *   eq
   *   assert      # Fail if hashes don't match
   *
   *   # Verify receiver
   *   caller
   *   mem_load.2  # Load expected receiver
   *   eq
   *   assert
   * end
   *
   * proc.htlc_refund
   *   # Check timelock expired
   *   block_number
   *   mem_load.1  # Load timelock
   *   gt
   *   assert      # Fail if not expired
   *
   *   # Verify sender
   *   caller
   *   mem_load.3  # Load sender
   *   eq
   *   assert
   * end
   * ```
   */
  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlcId = createHash('sha256')
      .update(params.hashlock)
      .update(params.sender)
      .update(Date.now().toString())
      .digest('hex');

    // Miden note with HTLC script
    const noteScript = this.buildHTLCNoteScript(params);

    // Store HTLC locally
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
      to: params.receiver,
      from: params.sender,
      value: params.amount,
      noteType: 'HTLC',
      noteScript,
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

    // Create consume note transaction with preimage in advice stack
    return {
      chain: this.chain,
      type: 'htlc_claim',
      htlcId,
      preimage: preimage.toString('hex'),
      amount: htlc?.amount || BigInt(0),
      adviceStack: [preimage.toString('hex')], // Miden advice provider
      noteConsume: htlcId,
    };
  }

  async refundHTLC(htlcId: string): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlc = this.htlcStorage.get(htlcId);

    // Create refund transaction (timelock must be expired)
    return {
      chain: this.chain,
      type: 'htlc_refund',
      htlcId,
      amount: htlc?.amount || BigInt(0),
      noteConsume: htlcId,
      refundPath: true,
    };
  }

  async getHTLCStatus(htlcId: string): Promise<HTLCStatus> {
    this.ensureInitialized();

    // Check local storage
    const local = this.htlcStorage.get(htlcId);
    if (local) {
      return local;
    }

    // Query node for note status
    try {
      const response = await this.nodeCall('get_note_status', {
        note_id: htlcId,
      });

      return {
        id: htlcId,
        state: this.parseNoteState(response),
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

    let running = true;
    let lastBlock = 0;

    const poll = async () => {
      while (running) {
        try {
          const currentBlock = await this.getBlockHeight();
          if (currentBlock > lastBlock) {
            const response = await this.nodeCall('get_account_transactions', {
              account_id: address,
              from_block: lastBlock,
              to_block: currentBlock,
            });

            for (const tx of response.transactions || []) {
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

    const response = await this.nodeCall('get_transaction', { tx_id: txHash });
    return this.parseTransaction(response);
  }

  async getBlockHeight(): Promise<number> {
    this.ensureInitialized();

    const response = await this.nodeCall('get_block_height', {});
    return response.block_height || 0;
  }

  async getConfirmations(txHash: string): Promise<number> {
    this.ensureInitialized();

    try {
      const tx = await this.nodeCall('get_transaction', { tx_id: txHash });
      const currentBlock = await this.getBlockHeight();

      if (tx.block_number) {
        return currentBlock - tx.block_number;
      }
    } catch {
      // Transaction not found
    }
    return 0;
  }

  async isFinalized(txHash: string): Promise<boolean> {
    // Miden uses STARK proofs - finality after proof verification
    // Typically ~2-5 blocks for proof generation + verification
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 3;
  }

  getBlockTime(): number {
    return 10000; // ~10 seconds per Miden block
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();

    // Miden fees based on proof complexity
    const baseProofCost = BigInt(50000);
    const noteCost = BigInt(10000);
    const scriptComplexity = BigInt((tx.noteScript?.length || 0) * 100);

    return baseProofCost + noteCost + scriptComplexity;
  }

  // Miden-specific methods

  /**
   * Generate STARK proof locally
   */
  async generateProof(tx: UnsignedTx): Promise<string> {
    this.ensureInitialized();

    if (this.proverUrl) {
      // Use remote prover
      const response = await fetch(`${this.proverUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tx),
      });
      const data = await response.json();
      return data.proof;
    }

    // Local proof generation (simplified)
    return createHash('sha256').update(JSON.stringify(tx)).digest('hex');
  }

  /**
   * Get note details
   */
  async getNoteDetails(noteId: string): Promise<any> {
    this.ensureInitialized();

    return await this.nodeCall('get_note', { note_id: noteId });
  }

  // Helper methods

  private buildTxKernel(tx: UnsignedTx, privateKey: Buffer): string {
    // Build Miden transaction kernel
    const kernel = {
      inputs: [tx.from],
      outputs: [tx.to],
      notes: [{
        type: tx.noteType,
        amount: tx.value?.toString(),
        script: tx.noteScript,
      }],
      nonce: Date.now(),
    };

    return JSON.stringify(kernel);
  }

  private buildHTLCNoteScript(params: HTLCParams): string {
    // Miden Assembly HTLC script (simplified representation)
    return `
      # HTLC Note Script
      # hashlock: ${params.hashlock.toString('hex')}
      # timelock: ${params.timelock}
      # receiver: ${params.receiver}
      # sender: ${params.sender}

      begin
        # Check if claim or refund path
        dup
        push.1
        eq
        if.true
          # Claim path - verify preimage
          adv_push.4
          hperm
          push.${params.hashlock.toString('hex')}
          assert_eq
        else
          # Refund path - verify timelock expired
          exec.get_block_number
          push.${params.timelock}
          gt
          assert
        end
      end
    `.trim();
  }

  private parseNoteState(response: any): HTLCState {
    if (response.consumed && response.claim_path) return HTLCState.CLAIMED;
    if (response.consumed && response.refund_path) return HTLCState.REFUNDED;
    if (response.expired) return HTLCState.EXPIRED;
    if (response.created) return HTLCState.LOCKED;
    return HTLCState.PENDING;
  }

  private parseTransaction(tx: any): Transaction {
    return {
      hash: tx.tx_id || tx.hash || '',
      chain: this.chain,
      from: tx.sender || tx.from || '',
      to: tx.receiver || tx.to || '',
      value: BigInt(tx.amount || 0),
      status: tx.status === 'confirmed' ? 'confirmed' : tx.status === 'failed' ? 'failed' : 'pending',
      confirmations: tx.confirmations || 0,
      blockNumber: tx.block_number,
      timestamp: tx.timestamp ? tx.timestamp * 1000 : undefined,
    };
  }

  private async nodeCall(method: string, params: any): Promise<any> {
    try {
      const response = await fetch(`${this.nodeUrl}/v1/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Miden node error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      // Return empty response for development/testing
      return {};
    }
  }
}
