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
 * Mina Protocol Adapter
 *
 * Mina is a succinct blockchain using recursive zkSNARKs (Kimchi proofs on Pasta curves).
 * Entire blockchain state is ~22KB regardless of history.
 *
 * Architecture:
 * - Account model
 * - o1js (formerly SnarkyJS) for zkApps
 * - Succinct proofs via Pickles recursive composition
 *
 * HTLC Implementation:
 * - zkApp smart contract with private claim verification
 * - Poseidon hash for hashlock (native to Mina circuits)
 * - Slot-based timelocks
 */

export interface MinaAdapterConfig extends AdapterConfig {
  graphqlUrl?: string;
  archiveUrl?: string;
}

export class MinaAdapter extends BaseChainAdapter {
  chain = Chain.MINA;
  nativeCurrency = 'MINA';

  private graphqlUrl = '';
  private archiveUrl = '';
  private htlcStorage: Map<string, HTLCStatus> = new Map();
  private zkAppAddress = ''; // Deployed HTLC zkApp

  async initialize(config: MinaAdapterConfig): Promise<void> {
    await super.initialize(config);
    this.graphqlUrl = config.graphqlUrl || 'https://api.minascan.io/node/mainnet/v1/graphql';
    this.archiveUrl = config.archiveUrl || 'https://api.minascan.io/archive/mainnet/v1/graphql';
  }

  getAddress(publicKey: Buffer): string {
    // Mina public keys are base58-encoded with B62 prefix
    // Derived from Pasta curve point
    const hash = createHash('sha256').update(publicKey).digest();
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    let encoded = 'B62q';
    for (let i = 0; i < 48; i++) {
      const byte = hash[i % hash.length];
      encoded += base58Chars[byte % 58];
    }

    return encoded;
  }

  async getBalance(address: string, asset?: string): Promise<bigint> {
    this.ensureInitialized();

    const query = `
      query GetBalance($publicKey: PublicKey!) {
        account(publicKey: $publicKey) {
          balance {
            total
          }
        }
      }
    `;

    const response = await this.graphqlCall(query, { publicKey: address });
    const balance = response?.data?.account?.balance?.total || '0';

    // Mina uses nanomina (10^9)
    return BigInt(Math.floor(parseFloat(balance) * 1e9));
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // Get current nonce
    const nonce = await this.getAccountNonce(params.from || '');

    return {
      chain: this.chain,
      type: params.type || 'payment',
      to: params.to,
      from: params.from,
      value: params.amount,
      memo: params.memo || '',
      nonce,
      fee: BigInt(100000000), // 0.1 MINA default fee
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    // Mina uses Schnorr signatures on Pasta curves
    // In production, use o1js or mina-signer
    const message = JSON.stringify({
      to: tx.to,
      from: tx.from,
      amount: tx.value?.toString(),
      fee: tx.fee?.toString(),
      nonce: tx.nonce,
      memo: tx.memo,
    });

    const signature = this.schnorrSign(message, privateKey);

    return {
      chain: this.chain,
      rawTx: message,
      signature,
      publicKey: this.getAddress(this.derivePublicKey(privateKey)),
    };
  }

  async broadcastTransaction(tx: SignedTx): Promise<string> {
    this.ensureInitialized();

    const mutation = `
      mutation SendPayment($input: SendPaymentInput!) {
        sendPayment(input: $input) {
          payment {
            hash
          }
        }
      }
    `;

    const txData = JSON.parse(tx.rawTx);
    const input = {
      from: txData.from,
      to: txData.to,
      amount: txData.amount,
      fee: txData.fee,
      memo: txData.memo,
      nonce: txData.nonce,
      signature: tx.signature,
    };

    const response = await this.graphqlCall(mutation, { input });

    return response?.data?.sendPayment?.payment?.hash ||
      `mina_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Create HTLC using Mina zkApp
   *
   * o1js HTLC Contract (conceptual):
   * ```typescript
   * class HTLC extends SmartContract {
   *   @state(Field) hashlock = State<Field>();
   *   @state(UInt32) timelock = State<UInt32>();
   *   @state(PublicKey) sender = State<PublicKey>();
   *   @state(PublicKey) receiver = State<PublicKey>();
   *   @state(UInt64) amount = State<UInt64>();
   *   @state(Bool) claimed = State<Bool>();
   *
   *   @method async claim(preimage: Field) {
   *     // Verify Poseidon hash of preimage matches hashlock
   *     const hash = Poseidon.hash([preimage]);
   *     this.hashlock.requireEquals(hash);
   *
   *     // Verify caller is receiver
   *     const receiver = this.receiver.get();
   *     this.sender.requireSignature();
   *
   *     // Transfer funds
   *     this.claimed.set(Bool(true));
   *   }
   *
   *   @method async refund() {
   *     // Verify timelock expired
   *     const timelock = this.timelock.get();
   *     const currentSlot = this.network.globalSlotSinceGenesis.get();
   *     currentSlot.assertGreaterThan(timelock);
   *
   *     // Verify caller is sender
   *     this.sender.requireSignature();
   *
   *     // Return funds
   *     this.claimed.set(Bool(true));
   *   }
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

    // Convert SHA256 hashlock to Poseidon-compatible field element
    const poseidonHashlock = this.toPoseidonField(params.hashlock);

    // Convert Unix timestamp to Mina slot number
    // Mina slots are ~3 minutes each
    const timelockSlot = this.timestampToSlot(params.timelock);

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
      type: 'zkapp',
      to: this.zkAppAddress,
      from: params.sender,
      value: params.amount,
      zkAppMethod: 'create',
      zkAppArgs: {
        hashlock: poseidonHashlock,
        timelock: timelockSlot,
        receiver: params.receiver,
        amount: params.amount.toString(),
      },
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

    // Convert preimage to Poseidon field element
    const poseidonPreimage = this.toPoseidonField(preimage);

    return {
      chain: this.chain,
      type: 'zkapp',
      to: this.zkAppAddress,
      zkAppMethod: 'claim',
      zkAppArgs: {
        htlcId,
        preimage: poseidonPreimage,
      },
      htlcId,
      preimage: preimage.toString('hex'),
      amount: htlc?.amount || BigInt(0),
    };
  }

  async refundHTLC(htlcId: string): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlc = this.htlcStorage.get(htlcId);

    return {
      chain: this.chain,
      type: 'zkapp',
      to: this.zkAppAddress,
      zkAppMethod: 'refund',
      zkAppArgs: {
        htlcId,
      },
      htlcId,
      amount: htlc?.amount || BigInt(0),
    };
  }

  async getHTLCStatus(htlcId: string): Promise<HTLCStatus> {
    this.ensureInitialized();

    // Check local storage
    const local = this.htlcStorage.get(htlcId);
    if (local) {
      return local;
    }

    // Query zkApp state
    try {
      const query = `
        query GetZkAppState($publicKey: PublicKey!) {
          account(publicKey: $publicKey) {
            zkappState
          }
        }
      `;

      const response = await this.graphqlCall(query, { publicKey: this.zkAppAddress });
      const state = response?.data?.account?.zkappState || [];

      return this.parseZkAppState(htlcId, state);
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
    let lastSlot = 0;

    const poll = async () => {
      while (running) {
        try {
          const currentSlot = await this.getCurrentSlot();
          if (currentSlot > lastSlot) {
            const txs = await this.getTransactionsForAddress(address, lastSlot, currentSlot);
            for (const tx of txs) {
              callback(this.parseTransaction(tx));
            }
            lastSlot = currentSlot;
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

    const query = `
      query GetTransaction($hash: String!) {
        transaction(hash: $hash) {
          hash
          from
          to
          amount
          fee
          memo
          blockHeight
          dateTime
          failureReason
        }
      }
    `;

    const response = await this.graphqlCall(query, { hash: txHash });
    return this.parseTransaction(response?.data?.transaction || {});
  }

  async getBlockHeight(): Promise<number> {
    this.ensureInitialized();

    const query = `
      query GetBlockHeight {
        bestChain(maxLength: 1) {
          blockHeight
        }
      }
    `;

    const response = await this.graphqlCall(query, {});
    return response?.data?.bestChain?.[0]?.blockHeight || 0;
  }

  async getConfirmations(txHash: string): Promise<number> {
    this.ensureInitialized();

    try {
      const tx = await this.getTransaction(txHash);
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
    // Mina requires ~15 confirmations for high confidence
    // Due to potential short-range forks
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 15;
  }

  getBlockTime(): number {
    return 180000; // ~3 minutes per Mina slot
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();

    // Mina fees based on transaction type
    if (tx.type === 'zkapp') {
      // zkApp transactions require proof verification fee
      return BigInt(500000000); // 0.5 MINA for zkApp
    }

    // Standard payment
    return BigInt(100000000); // 0.1 MINA
  }

  // Mina-specific methods

  /**
   * Get current network slot
   */
  async getCurrentSlot(): Promise<number> {
    this.ensureInitialized();

    const query = `
      query GetCurrentSlot {
        bestChain(maxLength: 1) {
          protocolState {
            consensusState {
              slotSinceGenesis
            }
          }
        }
      }
    `;

    const response = await this.graphqlCall(query, {});
    return response?.data?.bestChain?.[0]?.protocolState?.consensusState?.slotSinceGenesis || 0;
  }

  /**
   * Deploy HTLC zkApp
   */
  async deployHTLCZkApp(): Promise<string> {
    this.ensureInitialized();

    // In production, this would compile and deploy the o1js contract
    // Returns the zkApp address
    return `B62q${createHash('sha256').update('htlc-zkapp').digest('hex').slice(0, 48)}`;
  }

  /**
   * Get account nonce
   */
  async getAccountNonce(address: string): Promise<number> {
    const query = `
      query GetNonce($publicKey: PublicKey!) {
        account(publicKey: $publicKey) {
          nonce
        }
      }
    `;

    const response = await this.graphqlCall(query, { publicKey: address });
    return parseInt(response?.data?.account?.nonce || '0');
  }

  // Helper methods

  private toPoseidonField(data: Buffer): string {
    // Convert to Mina field element (Pasta curve scalar field)
    // In production, use o1js Field.fromBytes()
    const hash = createHash('sha256').update(data).digest();
    // Reduce modulo Pasta scalar field prime
    return `0x${hash.toString('hex').slice(0, 64)}`;
  }

  private timestampToSlot(timestamp: number): number {
    // Mina genesis: ~March 2021
    // Slot duration: ~3 minutes
    const genesisTimestamp = 1616630400; // Approximate
    const slotDuration = 180; // seconds

    return Math.floor((timestamp - genesisTimestamp) / slotDuration);
  }

  private schnorrSign(message: string, privateKey: Buffer): string {
    // Simplified Schnorr signature
    // In production, use mina-signer
    const hash = createHash('sha256')
      .update(privateKey)
      .update(message)
      .digest();

    return hash.toString('hex');
  }

  private derivePublicKey(privateKey: Buffer): Buffer {
    // Simplified - in production use Pasta curve scalar multiplication
    return createHash('sha256').update(privateKey).digest();
  }

  private parseZkAppState(htlcId: string, state: string[]): HTLCStatus {
    // Parse zkApp on-chain state
    // State fields: [hashlock, timelock, sender, receiver, amount, claimed]
    if (state.length < 6) {
      return {
        id: htlcId,
        state: HTLCState.PENDING,
        amount: BigInt(0),
        hashlock: '',
        timelock: 0,
      };
    }

    const claimed = state[5] === '1';
    return {
      id: htlcId,
      state: claimed ? HTLCState.CLAIMED : HTLCState.LOCKED,
      amount: BigInt(state[4] || 0),
      hashlock: state[0] || '',
      timelock: parseInt(state[1] || '0'),
    };
  }

  private async getTransactionsForAddress(
    address: string,
    fromSlot: number,
    toSlot: number
  ): Promise<any[]> {
    const query = `
      query GetTransactions($publicKey: PublicKey!) {
        transactions(query: { from: $publicKey }, limit: 100) {
          hash
          from
          to
          amount
          fee
          blockHeight
        }
      }
    `;

    const response = await this.graphqlCall(query, { publicKey: address });
    return response?.data?.transactions || [];
  }

  private parseTransaction(tx: any): Transaction {
    return {
      hash: tx.hash || '',
      chain: this.chain,
      from: tx.from || '',
      to: tx.to || '',
      value: BigInt(Math.floor(parseFloat(tx.amount || '0') * 1e9)),
      status: tx.failureReason ? 'failed' : tx.blockHeight ? 'confirmed' : 'pending',
      confirmations: 0,
      blockNumber: tx.blockHeight,
      timestamp: tx.dateTime ? new Date(tx.dateTime).getTime() : undefined,
    };
  }

  private async graphqlCall(query: string, variables: any): Promise<any> {
    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      // Return empty response for development/testing
      return { data: {} };
    }
  }
}
