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

export class OsmosisAdapter extends BaseChainAdapter {
  chain = Chain.OSMOSIS;
  nativeCurrency = 'OSMO';

  private rpcUrl = '';
  private htlcContractAddress = '';

  async initialize(config: AdapterConfig): Promise<void> {
    await super.initialize(config);
    this.rpcUrl = config.rpcUrl || 'https://rpc.osmosis.zone';
    // HTLC contract would be deployed on Osmosis
    this.htlcContractAddress = 'osmo1htlc...';
  }

  getAddress(publicKey: Buffer): string {
    // Bech32 encoding for Cosmos addresses
    const hash = createHash('sha256').update(publicKey).digest();
    const ripemd = createHash('ripemd160').update(hash).digest();
    // Simplified - real implementation needs bech32 encoding
    return `osmo1${ripemd.toString('hex').slice(0, 38)}`;
  }

  async getBalance(address: string, asset = 'uosmo'): Promise<bigint> {
    this.ensureInitialized();

    const response = await fetch(
      `${this.rpcUrl}/cosmos/bank/v1beta1/balances/${address}`
    );
    const data = await response.json() as any;

    const balance = data.balances?.find((b: any) => b.denom === asset);
    return BigInt(balance?.amount || '0');
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    return {
      chain: this.chain,
      type: 'cosmos-sdk/MsgSend',
      from: params.from,
      to: params.to,
      value: params.amount,
      memo: params.memo || '',
      denom: params.asset || 'uosmo',
    };
  }

  async signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    this.ensureInitialized();

    // Simplified - real implementation uses @cosmjs/stargate
    const txBytes = JSON.stringify(tx);
    const hash = createHash('sha256').update(txBytes).digest();

    return {
      chain: this.chain,
      rawTx: txBytes,
      signature: hash.toString('hex'),
    };
  }

  async broadcastTransaction(tx: SignedTx): Promise<string> {
    this.ensureInitialized();

    const response = await fetch(`${this.rpcUrl}/cosmos/tx/v1beta1/txs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_bytes: tx.rawTx,
        mode: 'BROADCAST_MODE_SYNC',
      }),
    });

    const data = await response.json() as any;
    return data.tx_response?.txhash || '';
  }

  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    this.ensureInitialized();

    // CosmWasm execute message for HTLC contract
    const executeMsg = {
      new_swap: {
        swap_id: createHash('sha256')
          .update(params.hashlock)
          .update(Date.now().toString())
          .digest('hex'),
        participant: params.receiver,
        hashlock: params.hashlock.toString('hex'),
        timelock: params.timelock,
      },
    };

    return {
      chain: this.chain,
      type: 'cosmwasm/MsgExecuteContract',
      from: params.sender,
      to: this.htlcContractAddress,
      value: params.amount,
      data: JSON.stringify(executeMsg),
      denom: params.asset?.denom || 'uosmo',
    };
  }

  async claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx> {
    this.ensureInitialized();

    const executeMsg = {
      withdraw: {
        swap_id: htlcId,
        preimage: preimage.toString('hex'),
      },
    };

    return {
      chain: this.chain,
      type: 'cosmwasm/MsgExecuteContract',
      to: this.htlcContractAddress,
      data: JSON.stringify(executeMsg),
    };
  }

  async refundHTLC(htlcId: string): Promise<UnsignedTx> {
    this.ensureInitialized();

    const executeMsg = {
      refund: {
        swap_id: htlcId,
      },
    };

    return {
      chain: this.chain,
      type: 'cosmwasm/MsgExecuteContract',
      to: this.htlcContractAddress,
      data: JSON.stringify(executeMsg),
    };
  }

  async getHTLCStatus(htlcId: string): Promise<HTLCStatus> {
    this.ensureInitialized();

    const queryMsg = {
      get_swap: { swap_id: htlcId },
    };

    const response = await fetch(
      `${this.rpcUrl}/cosmwasm/wasm/v1/contract/${this.htlcContractAddress}/smart/${Buffer.from(JSON.stringify(queryMsg)).toString('base64')}`
    );
    const data = await response.json() as any;

    let state: HTLCState = HTLCState.PENDING;
    if (data.data?.withdrawn) state = HTLCState.CLAIMED;
    else if (data.data?.refunded) state = HTLCState.REFUNDED;
    else if (data.data?.timelock < Date.now() / 1000) state = HTLCState.EXPIRED;
    else state = HTLCState.LOCKED;

    return {
      id: htlcId,
      state,
      amount: BigInt(data.data?.amount || '0'),
      hashlock: data.data?.hashlock || '',
      timelock: data.data?.timelock || 0,
    };
  }

  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe {
    this.ensureInitialized();

    // WebSocket subscription for address events
    const ws = new WebSocket(`${this.rpcUrl.replace('http', 'ws')}/websocket`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: [`tm.event='Tx' AND transfer.recipient='${address}'`],
        id: 1,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.result?.data?.value?.TxResult) {
        const tx = this.parseTransaction(data.result.data.value.TxResult);
        callback(tx);
      }
    };

    return () => ws.close();
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    this.ensureInitialized();

    const response = await fetch(
      `${this.rpcUrl}/cosmos/tx/v1beta1/txs/${txHash}`
    );
    const data = await response.json() as any;

    return this.parseTransaction(data.tx_response);
  }

  async getBlockHeight(): Promise<number> {
    this.ensureInitialized();

    const response = await fetch(`${this.rpcUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`);
    const data = await response.json() as any;

    return parseInt(data.block?.header?.height || '0');
  }

  async getConfirmations(txHash: string): Promise<number> {
    this.ensureInitialized();

    const tx = await this.getTransaction(txHash);
    if (!tx.blockNumber) return 0;

    const currentHeight = await this.getBlockHeight();
    return currentHeight - tx.blockNumber;
  }

  async isFinalized(txHash: string): Promise<boolean> {
    // Osmosis has instant finality with Tendermint
    const confirmations = await this.getConfirmations(txHash);
    return confirmations >= 1;
  }

  getBlockTime(): number {
    return 6000; // ~6 seconds
  }

  async estimateGas(tx: UnsignedTx): Promise<bigint> {
    this.ensureInitialized();
    // Cosmos uses fixed fees, return typical gas amount
    return BigInt(200000);
  }

  // Osmosis-specific methods
  async swapOnDEX(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<UnsignedTx> {
    this.ensureInitialized();

    return {
      chain: this.chain,
      type: 'osmosis/gamm/swap-exact-amount-in',
      tokenIn: { denom: tokenIn, amount: amountIn.toString() },
      tokenOutMinAmount: minAmountOut.toString(),
      routes: await this.findSwapRoute(tokenIn, tokenOut),
    };
  }

  async ibcTransfer(
    destChain: string,
    destAddress: string,
    amount: bigint,
    denom: string
  ): Promise<UnsignedTx> {
    this.ensureInitialized();

    return {
      chain: this.chain,
      type: 'ibc/MsgTransfer',
      sourcePort: 'transfer',
      sourceChannel: this.getIBCChannel(destChain),
      token: { denom, amount: amount.toString() },
      receiver: destAddress,
      timeoutTimestamp: BigInt(Date.now() + 600000) * BigInt(1000000),
    };
  }

  private async findSwapRoute(tokenIn: string, tokenOut: string): Promise<any[]> {
    // Query Osmosis pools to find optimal route
    // Simplified - returns direct route
    return [{ poolId: '1', tokenOutDenom: tokenOut }];
  }

  private getIBCChannel(destChain: string): string {
    // IBC channel mappings
    const channels: Record<string, string> = {
      cosmoshub: 'channel-0',
      juno: 'channel-42',
      // Add more as needed
    };
    return channels[destChain] || '';
  }

  private parseTransaction(txResponse: any): Transaction {
    return {
      hash: txResponse.txhash,
      chain: this.chain,
      from: '', // Parse from tx body
      to: '', // Parse from tx body
      value: BigInt(0),
      status: txResponse.code === 0 ? 'confirmed' : 'failed',
      confirmations: 1,
      blockNumber: parseInt(txResponse.height),
      timestamp: Date.parse(txResponse.timestamp),
    };
  }
}
