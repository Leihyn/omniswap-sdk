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

export class FhenixAdapter extends BaseChainAdapter {
  chain = Chain.FHENIX;
  nativeCurrency = 'tFHE';

  private rpcUrl = '';
  private htlcContractAddress = '';

  async initialize(config: AdapterConfig): Promise<void> {
    await super.initialize(config);
    this.rpcUrl = config.rpcUrl || 'https://api.helium.fhenix.zone';
    this.htlcContractAddress = '0x...'; // Deployed HTLC contract
  }

  getAddress(publicKey: Buffer): string {
    const hash = createHash('keccak256').update(publicKey.slice(1)).digest();
    return '0x' + hash.slice(-20).toString('hex');
  }

  async getBalance(address: string, asset?: string): Promise<bigint> {
    this.ensureInitialized();

    const result = await this.jsonRpcCall('eth_getBalance', [address, 'latest']);
    return BigInt(result);
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    const nonce = await this.jsonRpcCall('eth_getTransactionCount', [params.from, 'latest']);
    const gasPrice = await this.jsonRpcCall('eth_gasPrice', []);

    return {
      chain: this.chain,
      type: 'evm',
      from: params.from,
      to: params.to,
      value: params.amount,
      data: params.data || '0x',
      gasLimit: params.gasLimit || BigInt(21000),
      gasPrice: BigInt(gasPrice),
      nonce: parseInt(nonce, 16),
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    // Simplified - use ethers.js or web3.js for actual signing
    const txHash = createHash('keccak256')
      .update(JSON.stringify(tx))
      .digest();

    return {
      chain: this.chain,
      rawTx: '0x' + txHash.toString('hex'),
      signature: '0x...',
    };
  }

  async broadcastTransaction(tx: SignedTx): Promise<string> {
    this.ensureInitialized();
    return await this.jsonRpcCall('eth_sendRawTransaction', [tx.rawTx]);
  }

  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // ABI encode newSwap function call
    const swapId = createHash('sha256')
      .update(params.hashlock)
      .update(Date.now().toString())
      .digest('hex');

    const data = this.encodeHTLCInit(swapId, params);

    return {
      chain: this.chain,
      type: 'evm',
      from: params.sender,
      to: this.htlcContractAddress,
      value: params.amount,
      data,
      gasLimit: BigInt(200000),
    };
  }

  async claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx> {
    this.ensureInitialized();

    // ABI encode withdraw function
    const data = '0x' +
      'c0ff1c7f' + // withdraw(bytes32,bytes32)
      htlcId.padStart(64, '0') +
      preimage.toString('hex').padStart(64, '0');

    return {
      chain: this.chain,
      type: 'evm',
      to: this.htlcContractAddress,
      value: BigInt(0),
      data,
      gasLimit: BigInt(100000),
    };
  }

  async refundHTLC(htlcId: string): Promise<UnsignedTx> {
    this.ensureInitialized();

    // ABI encode refund function
    const data = '0x' +
      '7249fbb6' + // refund(bytes32)
      htlcId.padStart(64, '0');

    return {
      chain: this.chain,
      type: 'evm',
      to: this.htlcContractAddress,
      value: BigInt(0),
      data,
      gasLimit: BigInt(100000),
    };
  }

  async getHTLCStatus(htlcId: string): Promise<HTLCStatus> {
    this.ensureInitialized();

    // Call swaps(bytes32) view function
    const data = '0x' +
      'eb84e7f2' + // swaps(bytes32)
      htlcId.padStart(64, '0');

    const result = await this.jsonRpcCall('eth_call', [
      { to: this.htlcContractAddress, data },
      'latest',
    ]);

    // Decode result
    const decoded = this.decodeHTLCStatus(result);

    return {
      id: htlcId,
      state: decoded.state,
      txHash: decoded.txHash,
      amount: decoded.amount,
      hashlock: decoded.hashlock,
      timelock: decoded.timelock,
    };
  }

  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe {
    this.ensureInitialized();

    // Use eth_subscribe for pending transactions
    const ws = new WebSocket(this.rpcUrl.replace('https', 'wss'));

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_subscribe',
        params: ['logs', { address }],
      }));
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.params?.result) {
        const tx = await this.getTransaction(data.params.result.transactionHash);
        callback(tx);
      }
    };

    return () => ws.close();
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    this.ensureInitialized();

    const tx = await this.jsonRpcCall('eth_getTransactionByHash', [txHash]);
    const receipt = await this.jsonRpcCall('eth_getTransactionReceipt', [txHash]);

    return {
      hash: txHash,
      chain: this.chain,
      from: tx.from,
      to: tx.to,
      value: BigInt(tx.value),
      status: receipt?.status === '0x1' ? 'confirmed' : receipt ? 'failed' : 'pending',
      confirmations: receipt ? 1 : 0,
      blockNumber: receipt ? parseInt(receipt.blockNumber, 16) : undefined,
    };
  }

  async getBlockHeight(): Promise<number> {
    this.ensureInitialized();
    const result = await this.jsonRpcCall('eth_blockNumber', []);
    return parseInt(result, 16);
  }

  async getConfirmations(txHash: string): Promise<number> {
    this.ensureInitialized();

    const receipt = await this.jsonRpcCall('eth_getTransactionReceipt', [txHash]);
    if (!receipt) return 0;

    const currentBlock = await this.getBlockHeight();
    return currentBlock - parseInt(receipt.blockNumber, 16);
  }

  async isFinalized(txHash: string): Promise<boolean> {
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 12;
  }

  getBlockTime(): number {
    return 2000; // ~2 seconds
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();

    const result = await this.jsonRpcCall('eth_estimateGas', [{
      from: tx.from,
      to: tx.to,
      value: '0x' + (tx.value || BigInt(0)).toString(16),
      data: tx.data,
    }]);

    return BigInt(result);
  }

  // Fhenix-specific: FHE encrypted HTLC
  async createEncryptedHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // Encrypt amount using FHE
    const encryptedAmount = await this.fheEncrypt(params.amount);

    const data = this.encodeEncryptedHTLCInit(params, encryptedAmount);

    return {
      chain: this.chain,
      type: 'evm',
      from: params.sender,
      to: this.htlcContractAddress,
      value: BigInt(0), // Amount is encrypted
      data,
      gasLimit: BigInt(500000), // FHE ops cost more gas
    };
  }

  private async fheEncrypt(value: bigint): Promise<string> {
    // Use Fhenix FHE library to encrypt
    // This is a placeholder - actual implementation uses @fhenixprotocol/fhenix.js
    return '0x' + createHash('sha256').update(value.toString()).digest('hex');
  }

  private encodeHTLCInit(swapId: string, params: HTLCParams): string {
    // newSwap(bytes32,address,address,bytes32,uint256)
    return '0x' +
      'a9059cbb' + // Function selector
      swapId.padStart(64, '0') +
      params.receiver.slice(2).padStart(64, '0') +
      (params.asset?.contractAddress?.slice(2) || '0'.repeat(40)).padStart(64, '0') +
      params.hashlock.toString('hex').padStart(64, '0') +
      params.timelock.toString(16).padStart(64, '0');
  }

  private encodeEncryptedHTLCInit(params: HTLCParams, encryptedAmount: string): string {
    return '0x' +
      'encrypted_htlc_selector' +
      encryptedAmount.slice(2) +
      params.receiver.slice(2).padStart(64, '0') +
      params.hashlock.toString('hex').padStart(64, '0') +
      params.timelock.toString(16).padStart(64, '0');
  }

  private decodeHTLCStatus(result: string): {
    state: HTLCState;
    txHash?: string;
    amount: bigint;
    hashlock: string;
    timelock: number;
  } {
    // Decode ABI-encoded response
    const hex = result.slice(2);
    const withdrawn = parseInt(hex.slice(256, 320), 16) === 1;
    const refunded = parseInt(hex.slice(320, 384), 16) === 1;
    const timelock = parseInt(hex.slice(192, 256), 16);

    let state: HTLCState = HTLCState.LOCKED;
    if (withdrawn) state = HTLCState.CLAIMED;
    else if (refunded) state = HTLCState.REFUNDED;
    else if (timelock < Date.now() / 1000) state = HTLCState.EXPIRED;

    return {
      state,
      amount: BigInt('0x' + hex.slice(128, 192)),
      hashlock: '0x' + hex.slice(64, 128),
      timelock,
    };
  }

  private async jsonRpcCall(method: string, params: any[]): Promise<any> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
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
}
