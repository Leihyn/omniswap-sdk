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

// WASM module types - these would come from compiled librustzcash
interface ZcashWasm {
  init(): Promise<void>;

  // Key generation
  generate_spending_key(seed: Uint8Array): Uint8Array;
  derive_viewing_key(spending_key: Uint8Array): Uint8Array;
  derive_payment_address(viewing_key: Uint8Array, diversifier_index: number): string;

  // Shielded addresses
  generate_sapling_address(spending_key: Uint8Array): string;
  generate_orchard_address(spending_key: Uint8Array): string;

  // Transaction building
  create_shielded_transaction(params: ShieldedTxParams): Uint8Array;
  create_transparent_transaction(params: TransparentTxParams): Uint8Array;

  // Proving
  prove_sapling_spend(params: SaplingSpendParams): Uint8Array;
  prove_sapling_output(params: SaplingOutputParams): Uint8Array;
  prove_orchard_action(params: OrchardActionParams): Uint8Array;

  // Verification
  verify_sapling_proof(proof: Uint8Array, public_inputs: Uint8Array): boolean;
  verify_orchard_proof(proof: Uint8Array, public_inputs: Uint8Array): boolean;

  // Note encryption/decryption
  encrypt_note(note: Uint8Array, pk_d: Uint8Array, esk: Uint8Array): Uint8Array;
  decrypt_note(ciphertext: Uint8Array, ivk: Uint8Array): Uint8Array | null;

  // Nullifier computation
  compute_nullifier(note: Uint8Array, viewing_key: Uint8Array, position: bigint): Uint8Array;

  // Commitment computation
  compute_note_commitment(note: Uint8Array): Uint8Array;

  // Signature
  sign_transparent(message: Uint8Array, private_key: Uint8Array): Uint8Array;
  sign_sapling(message: Uint8Array, ask: Uint8Array, ar: Uint8Array): Uint8Array;
}

interface ShieldedTxParams {
  spending_key: Uint8Array;
  inputs: ShieldedInput[];
  outputs: ShieldedOutput[];
  fee: bigint;
  anchor: Uint8Array;
  memo?: string;
}

interface ShieldedInput {
  note: Uint8Array;
  witness: Uint8Array;
  position: bigint;
}

interface ShieldedOutput {
  address: string;
  amount: bigint;
  memo?: string;
}

interface TransparentTxParams {
  inputs: TransparentInput[];
  outputs: TransparentOutput[];
  fee: bigint;
}

interface TransparentInput {
  txid: string;
  vout: number;
  amount: bigint;
  script_pubkey: Uint8Array;
}

interface TransparentOutput {
  address: string;
  amount: bigint;
}

interface SaplingSpendParams {
  ak: Uint8Array;
  nsk: Uint8Array;
  diversifier: Uint8Array;
  rcm: Uint8Array;
  ar: Uint8Array;
  value: bigint;
  anchor: Uint8Array;
  witness: Uint8Array;
}

interface SaplingOutputParams {
  ovk: Uint8Array;
  to: Uint8Array;
  value: bigint;
  rcm: Uint8Array;
  memo?: Uint8Array;
}

interface OrchardActionParams {
  spend_auth_key: Uint8Array;
  note: Uint8Array;
  witness: Uint8Array;
  output_note: Uint8Array;
}

export interface ZcashWasmConfig extends AdapterConfig {
  wasmPath?: string;
  provingKeyPath?: string;
  viewingKeyPath?: string;
}

export class ZcashWasmAdapter extends BaseChainAdapter {
  chain = Chain.ZCASH;
  nativeCurrency = 'ZEC';

  private wasm: ZcashWasm | null = null;
  private rpcUrl = '';
  private spendingKey: Uint8Array | null = null;
  private viewingKey: Uint8Array | null = null;

  async initialize(config: ZcashWasmConfig): Promise<void> {
    await super.initialize(config);
    this.rpcUrl = config.rpcUrl || 'http://127.0.0.1:8232';

    // Load WASM module
    await this.loadWasm(config.wasmPath);
  }

  private async loadWasm(wasmPath?: string): Promise<void> {
    try {
      // Dynamic import of WASM module
      // In production, this would be: import('@aspect-dev/zcash-wasm')
      // or a custom compiled librustzcash WASM

      const wasmModule = await import(wasmPath || 'zcash-wasm');
      await wasmModule.default();
      this.wasm = wasmModule as unknown as ZcashWasm;
    } catch (error) {
      console.warn('WASM module not available, falling back to RPC-only mode');
      this.wasm = null;
    }
  }

  // Key Management
  async generateSpendingKey(seed: Buffer): Promise<Buffer> {
    if (!this.wasm) {
      throw new Error('WASM module required for key generation');
    }

    const spendingKey = this.wasm.generate_spending_key(new Uint8Array(seed));
    this.spendingKey = spendingKey;
    this.viewingKey = this.wasm.derive_viewing_key(spendingKey);

    return Buffer.from(spendingKey);
  }

  async deriveViewingKey(spendingKey: Buffer): Promise<Buffer> {
    if (!this.wasm) {
      throw new Error('WASM module required for key derivation');
    }

    return Buffer.from(this.wasm.derive_viewing_key(new Uint8Array(spendingKey)));
  }

  getAddress(publicKey: Buffer): string {
    if (this.wasm && this.viewingKey) {
      // Generate diversified payment address
      return this.wasm.derive_payment_address(this.viewingKey, 0);
    }

    // Fallback: transparent address
    const hash = createHash('sha256').update(publicKey).digest();
    const ripemd = createHash('ripemd160').update(hash).digest();
    return `t1${ripemd.toString('hex').slice(0, 33)}`;
  }

  async getShieldedAddress(type: 'sapling' | 'orchard' = 'sapling'): Promise<string> {
    if (!this.wasm || !this.spendingKey) {
      throw new Error('WASM module and spending key required');
    }

    if (type === 'orchard') {
      return this.wasm.generate_orchard_address(this.spendingKey);
    }
    return this.wasm.generate_sapling_address(this.spendingKey);
  }

  async getBalance(address: string, asset?: string): Promise<bigint> {
    this.ensureInitialized();
    const result = await this.rpcCall('z_getbalance', [address]);
    return BigInt(Math.floor(parseFloat(result) * 1e8));
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // Check if shielded transaction
    const isShielded = params.to?.startsWith('zs') || params.to?.startsWith('u');

    if (isShielded && this.wasm && this.spendingKey) {
      return this.buildShieldedTransaction(params);
    }

    return this.buildTransparentTransaction(params);
  }

  private async buildShieldedTransaction(params: TxParams): Promise<UnsignedTx> {
    if (!this.wasm || !this.spendingKey) {
      throw new Error('WASM module and spending key required for shielded transactions');
    }

    // Get notes and witnesses from the node
    const notes = await this.rpcCall('z_listunspent', [1, 9999999, false, [params.from]]);
    const anchor = await this.getCurrentAnchor();

    return {
      chain: this.chain,
      type: 'shielded',
      from: params.from,
      to: params.to,
      value: params.amount,
      memo: params.memo,
      notes,
      anchor,
      spendingKey: Buffer.from(this.spendingKey).toString('hex'),
    };
  }

  private async buildTransparentTransaction(params: TxParams): Promise<UnsignedTx> {
    const utxos = await this.rpcCall('listunspent', [1, 9999999, [params.from]]);

    return {
      chain: this.chain,
      type: 'transparent',
      from: params.from,
      to: params.to,
      value: params.amount,
      utxos,
      memo: params.memo,
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    if (tx.type === 'shielded' && this.wasm) {
      return this.signShieldedTransaction(tx);
    }

    return this.signTransparentTransaction(tx, privateKey);
  }

  private async signShieldedTransaction(tx: UnsignedTx): Promise<SignedTx> {
    if (!this.wasm || !this.spendingKey) {
      throw new Error('WASM module and spending key required');
    }

    // Build shielded transaction with proofs
    const shieldedTx = this.wasm.create_shielded_transaction({
      spending_key: this.spendingKey,
      inputs: (tx.notes as any[]).map(note => ({
        note: new Uint8Array(Buffer.from(note.note, 'hex')),
        witness: new Uint8Array(Buffer.from(note.witness, 'hex')),
        position: BigInt(note.position),
      })),
      outputs: [{
        address: tx.to as string,
        amount: tx.value as bigint,
        memo: tx.memo as string,
      }],
      fee: BigInt(10000),
      anchor: new Uint8Array(Buffer.from(tx.anchor as string, 'hex')),
    });

    return {
      chain: this.chain,
      rawTx: Buffer.from(shieldedTx).toString('hex'),
      signature: '',
    };
  }

  private async signTransparentTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    if (this.wasm) {
      // Use WASM for signing
      const rawTx = this.wasm.create_transparent_transaction({
        inputs: (tx.utxos as any[]).map(utxo => ({
          txid: utxo.txid,
          vout: utxo.vout,
          amount: BigInt(utxo.amount * 1e8),
          script_pubkey: new Uint8Array(Buffer.from(utxo.scriptPubKey, 'hex')),
        })),
        outputs: [{
          address: tx.to as string,
          amount: tx.value as bigint,
        }],
        fee: BigInt(10000),
      });

      const signature = this.wasm.sign_transparent(rawTx, new Uint8Array(privateKey));

      return {
        chain: this.chain,
        rawTx: Buffer.from(rawTx).toString('hex'),
        signature: Buffer.from(signature).toString('hex'),
      };
    }

    // Fallback to RPC
    const rawTx = await this.rpcCall('createrawtransaction', [
      tx.utxos,
      { [tx.to as string]: Number(tx.value) / 1e8 },
    ]);

    const signedResult = await this.rpcCall('signrawtransaction', [rawTx]);

    return {
      chain: this.chain,
      rawTx: signedResult.hex,
      signature: '',
    };
  }

  async broadcastTransaction(tx: SignedTx): Promise<string> {
    this.ensureInitialized();
    return await this.rpcCall('sendrawtransaction', [tx.rawTx]);
  }

  // Shielding operations
  async shieldFunds(transparentAddress: string, amount: bigint): Promise<string> {
    this.ensureInitialized();

    if (this.wasm && this.spendingKey) {
      // Build shielding transaction with WASM
      const shieldedAddress = await this.getShieldedAddress();
      const utxos = await this.rpcCall('listunspent', [1, 9999999, [transparentAddress]]);

      const tx = await this.buildTransaction({
        from: transparentAddress,
        to: shieldedAddress,
        amount,
      });

      const signedTx = await this.signTransaction(tx, Buffer.alloc(32));
      return this.broadcastTransaction(signedTx);
    }

    // Fallback to RPC
    const shieldedAddress = await this.rpcCall('z_getnewaddress', ['sapling']);
    const operationId = await this.rpcCall('z_sendmany', [
      transparentAddress,
      [{ address: shieldedAddress, amount: Number(amount) / 1e8 }],
    ]);

    return operationId;
  }

  async unshieldFunds(shieldedAddress: string, transparentAddress: string, amount: bigint): Promise<string> {
    this.ensureInitialized();

    const operationId = await this.rpcCall('z_sendmany', [
      shieldedAddress,
      [{ address: transparentAddress, amount: Number(amount) / 1e8 }],
    ]);

    return operationId;
  }

  // Note scanning
  async scanForNotes(viewingKey: Buffer, startHeight?: number): Promise<any[]> {
    if (!this.wasm) {
      throw new Error('WASM module required for note scanning');
    }

    // In production, this would scan the blockchain for notes
    // decryptable with the viewing key
    const notes: any[] = [];

    // Get blocks and try to decrypt notes
    const currentHeight = await this.getBlockHeight();
    const start = startHeight || currentHeight - 1000;

    for (let height = start; height <= currentHeight; height++) {
      const block = await this.rpcCall('getblock', [height.toString(), 2]);

      for (const tx of block.tx) {
        if (tx.vShieldedOutput) {
          for (const output of tx.vShieldedOutput) {
            const decrypted = this.wasm.decrypt_note(
              new Uint8Array(Buffer.from(output.encCiphertext, 'hex')),
              new Uint8Array(viewingKey)
            );

            if (decrypted) {
              notes.push({
                txid: tx.txid,
                height,
                note: Buffer.from(decrypted).toString('hex'),
              });
            }
          }
        }
      }
    }

    return notes;
  }

  // HTLC operations
  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    const redeemScript = this.buildHTLCScript(params);
    const p2shAddress = this.scriptToAddress(redeemScript);

    return {
      chain: this.chain,
      type: 'htlc_create',
      to: p2shAddress,
      value: params.amount,
      redeemScript: redeemScript.toString('hex'),
      hashlock: params.hashlock.toString('hex'),
      timelock: params.timelock,
      sender: params.sender,
      receiver: params.receiver,
    };
  }

  async claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlc = await this.getHTLCStatus(htlcId);

    return {
      chain: this.chain,
      type: 'htlc_claim',
      htlcId,
      preimage: preimage.toString('hex'),
      amount: htlc.amount,
    };
  }

  async refundHTLC(htlcId: string): Promise<UnsignedTx> {
    this.ensureInitialized();

    const htlc = await this.getHTLCStatus(htlcId);

    return {
      chain: this.chain,
      type: 'htlc_refund',
      htlcId,
      amount: htlc.amount,
    };
  }

  async getHTLCStatus(htlcId: string): Promise<HTLCStatus> {
    this.ensureInitialized();

    return {
      id: htlcId,
      state: HTLCState.LOCKED,
      amount: BigInt(0),
      hashlock: '',
      timelock: 0,
    };
  }

  // Monitoring
  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe {
    this.ensureInitialized();

    let running = true;
    let lastBlock = 0;

    const poll = async () => {
      while (running) {
        try {
          const currentBlock = await this.getBlockHeight();
          if (currentBlock > lastBlock) {
            const txs = await this.rpcCall('listtransactions', ['*', 10, 0, true]);
            for (const tx of txs) {
              if (tx.address === address && tx.blockheight > lastBlock) {
                callback(this.parseTransaction(tx));
              }
            }
            lastBlock = currentBlock;
          }
        } catch {
          // Ignore polling errors
        }
        await this.sleep(30000);
      }
    };

    poll();
    return () => { running = false; };
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    this.ensureInitialized();
    const tx = await this.rpcCall('gettransaction', [txHash]);
    return this.parseTransaction(tx);
  }

  async getBlockHeight(): Promise<number> {
    this.ensureInitialized();
    return await this.rpcCall('getblockcount', []);
  }

  async getConfirmations(txHash: string): Promise<number> {
    this.ensureInitialized();
    const tx = await this.rpcCall('gettransaction', [txHash]);
    return tx.confirmations || 0;
  }

  async isFinalized(txHash: string): Promise<boolean> {
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 6;
  }

  getBlockTime(): number {
    return 75000;
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();
    return BigInt(10000);
  }

  // Private helpers
  private async getCurrentAnchor(): Promise<string> {
    const treeState = await this.rpcCall('z_gettreestate', ['']);
    return treeState.sapling.commitments.finalRoot;
  }

  private buildHTLCScript(params: HTLCParams): Buffer {
    const OP_IF = 0x63;
    const OP_ELSE = 0x67;
    const OP_ENDIF = 0x68;
    const OP_SHA256 = 0xa8;
    const OP_EQUALVERIFY = 0x88;
    const OP_CHECKSIG = 0xac;
    const OP_CHECKLOCKTIMEVERIFY = 0xb1;
    const OP_DROP = 0x75;

    return Buffer.concat([
      Buffer.from([OP_IF]),
      Buffer.from([OP_SHA256]),
      Buffer.from([0x20]),
      params.hashlock,
      Buffer.from([OP_EQUALVERIFY]),
      Buffer.from([0x14]),
      Buffer.from(params.receiver, 'hex').slice(0, 20),
      Buffer.from([OP_CHECKSIG]),
      Buffer.from([OP_ELSE]),
      this.encodeNumber(params.timelock),
      Buffer.from([OP_CHECKLOCKTIMEVERIFY, OP_DROP]),
      Buffer.from([0x14]),
      Buffer.from(params.sender, 'hex').slice(0, 20),
      Buffer.from([OP_CHECKSIG]),
      Buffer.from([OP_ENDIF]),
    ]);
  }

  private scriptToAddress(script: Buffer): string {
    const hash = createHash('sha256').update(script).digest();
    const ripemd = createHash('ripemd160').update(hash).digest();
    return `t3${ripemd.toString('hex').slice(0, 33)}`;
  }

  private encodeNumber(num: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(num);
    return Buffer.concat([Buffer.from([0x04]), buf]);
  }

  private async rpcCall(method: string, params: any[]): Promise<any> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: Date.now(),
        method,
        params,
      }),
    });

    const data = await response.json() as any;
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.result;
  }

  private parseTransaction(tx: any): Transaction {
    return {
      hash: tx.txid,
      chain: this.chain,
      from: '',
      to: tx.address || '',
      value: BigInt(Math.abs(tx.amount) * 1e8),
      status: tx.confirmations > 0 ? 'confirmed' : 'pending',
      confirmations: tx.confirmations || 0,
      blockNumber: tx.blockheight,
      timestamp: tx.time * 1000,
    };
  }
}
