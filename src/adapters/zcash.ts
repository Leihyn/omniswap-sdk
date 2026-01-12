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

export class ZcashAdapter extends BaseChainAdapter {
  chain = Chain.ZCASH;
  nativeCurrency = 'ZEC';

  private rpcUrl = '';
  private rpcUser = '';
  private rpcPassword = '';

  async initialize(config: AdapterConfig): Promise<void> {
    await super.initialize(config);
    this.rpcUrl = config.rpcUrl || 'http://127.0.0.1:8232';
  }

  getAddress(publicKey: Buffer): string {
    // Transparent address (t-addr) generation
    const hash = createHash('sha256').update(publicKey).digest();
    const ripemd = createHash('ripemd160').update(hash).digest();
    // Simplified - real implementation needs Base58Check with prefix
    return `t1${ripemd.toString('hex').slice(0, 33)}`;
  }

  async getBalance(address: string, asset?: string): Promise<bigint> {
    this.ensureInitialized();

    const result = await this.rpcCall('z_getbalance', [address]);
    // ZEC has 8 decimals, convert to zatoshi
    return BigInt(Math.floor(parseFloat(result) * 1e8));
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    const utxos = await this.rpcCall('listunspent', [1, 9999999, [params.from]]);

    return {
      chain: this.chain,
      type: 'send',
      from: params.from,
      to: params.to,
      value: params.amount,
      utxos,
      memo: params.memo,
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    // Use zcash-cli or librustzcash for actual signing
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

  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // Build P2SH HTLC script
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

    // Get HTLC details
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

    // Query P2SH address for HTLC state
    // This would need to track HTLCs in local storage or indexer
    return {
      id: htlcId,
      state: HTLCState.LOCKED,
      amount: BigInt(0),
      hashlock: '',
      timelock: 0,
    };
  }

  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe {
    this.ensureInitialized();

    // Poll-based subscription for Zcash
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
        } catch (e) {
          // Ignore polling errors
        }
        await this.sleep(30000); // Poll every 30 seconds
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
    // Zcash needs ~6 confirmations for finality
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 6;
  }

  getBlockTime(): number {
    return 75000; // ~75 seconds
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();
    // Zcash fees are based on tx size
    return BigInt(10000); // 0.0001 ZEC typical fee
  }

  // Zcash-specific methods
  async shieldFunds(transparentAddress: string, amount: bigint): Promise<string> {
    this.ensureInitialized();

    const shieldedAddress = await this.getShieldedAddress();
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

  async getShieldedAddress(): Promise<string> {
    this.ensureInitialized();
    return await this.rpcCall('z_getnewaddress', ['sapling']);
  }

  private buildHTLCScript(params: HTLCParams): Buffer {
    // Zcash HTLC script:
    // OP_IF
    //   OP_SHA256 <hashlock> OP_EQUALVERIFY
    //   <receiver_pubkey> OP_CHECKSIG
    // OP_ELSE
    //   <timelock> OP_CHECKLOCKTIMEVERIFY OP_DROP
    //   <sender_pubkey> OP_CHECKSIG
    // OP_ENDIF

    const OP_IF = 0x63;
    const OP_ELSE = 0x67;
    const OP_ENDIF = 0x68;
    const OP_SHA256 = 0xa8;
    const OP_EQUALVERIFY = 0x88;
    const OP_CHECKSIG = 0xac;
    const OP_CHECKLOCKTIMEVERIFY = 0xb1;
    const OP_DROP = 0x75;

    const script = Buffer.concat([
      Buffer.from([OP_IF]),
      Buffer.from([OP_SHA256]),
      Buffer.from([0x20]), // Push 32 bytes
      params.hashlock,
      Buffer.from([OP_EQUALVERIFY]),
      Buffer.from([0x14]), // Push 20 bytes (pubkey hash)
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

    return script;
  }

  private scriptToAddress(script: Buffer): string {
    const hash = createHash('sha256').update(script).digest();
    const ripemd = createHash('ripemd160').update(hash).digest();
    // Simplified - needs proper Base58Check encoding with P2SH prefix
    return `t3${ripemd.toString('hex').slice(0, 33)}`;
  }

  private encodeNumber(num: number): Buffer {
    // Encode number for script (little-endian)
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(num);
    return Buffer.concat([Buffer.from([0x04]), buf]);
  }

  private async rpcCall(method: string, params: any[]): Promise<any> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.rpcUser}:${this.rpcPassword}`).toString('base64')}`,
      },
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
