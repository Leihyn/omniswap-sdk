"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZcashWasmAdapter = void 0;
const crypto_1 = require("crypto");
const types_1 = require("../types");
const base_1 = require("./base");
class ZcashWasmAdapter extends base_1.BaseChainAdapter {
    constructor() {
        super(...arguments);
        this.chain = types_1.Chain.ZCASH;
        this.nativeCurrency = 'ZEC';
        this.wasm = null;
        this.rpcUrl = '';
        this.spendingKey = null;
        this.viewingKey = null;
    }
    async initialize(config) {
        await super.initialize(config);
        this.rpcUrl = config.rpcUrl || 'http://127.0.0.1:8232';
        // Load WASM module
        await this.loadWasm(config.wasmPath);
    }
    async loadWasm(wasmPath) {
        try {
            // Dynamic import of WASM module
            // In production, this would be: import('@aspect-dev/zcash-wasm')
            // or a custom compiled librustzcash WASM
            const wasmModule = await Promise.resolve(`${wasmPath || 'zcash-wasm'}`).then(s => __importStar(require(s)));
            await wasmModule.default();
            this.wasm = wasmModule;
        }
        catch (error) {
            console.warn('WASM module not available, falling back to RPC-only mode');
            this.wasm = null;
        }
    }
    // Key Management
    async generateSpendingKey(seed) {
        if (!this.wasm) {
            throw new Error('WASM module required for key generation');
        }
        const spendingKey = this.wasm.generate_spending_key(new Uint8Array(seed));
        this.spendingKey = spendingKey;
        this.viewingKey = this.wasm.derive_viewing_key(spendingKey);
        return Buffer.from(spendingKey);
    }
    async deriveViewingKey(spendingKey) {
        if (!this.wasm) {
            throw new Error('WASM module required for key derivation');
        }
        return Buffer.from(this.wasm.derive_viewing_key(new Uint8Array(spendingKey)));
    }
    getAddress(publicKey) {
        if (this.wasm && this.viewingKey) {
            // Generate diversified payment address
            return this.wasm.derive_payment_address(this.viewingKey, 0);
        }
        // Fallback: transparent address
        const hash = (0, crypto_1.createHash)('sha256').update(publicKey).digest();
        const ripemd = (0, crypto_1.createHash)('ripemd160').update(hash).digest();
        return `t1${ripemd.toString('hex').slice(0, 33)}`;
    }
    async getShieldedAddress(type = 'sapling') {
        if (!this.wasm || !this.spendingKey) {
            throw new Error('WASM module and spending key required');
        }
        if (type === 'orchard') {
            return this.wasm.generate_orchard_address(this.spendingKey);
        }
        return this.wasm.generate_sapling_address(this.spendingKey);
    }
    async getBalance(address, asset) {
        this.ensureInitialized();
        const result = await this.rpcCall('z_getbalance', [address]);
        return BigInt(Math.floor(parseFloat(result) * 1e8));
    }
    async buildTransaction(params) {
        this.ensureInitialized();
        // Check if shielded transaction
        const isShielded = params.to?.startsWith('zs') || params.to?.startsWith('u');
        if (isShielded && this.wasm && this.spendingKey) {
            return this.buildShieldedTransaction(params);
        }
        return this.buildTransparentTransaction(params);
    }
    async buildShieldedTransaction(params) {
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
    async buildTransparentTransaction(params) {
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
    async signTransaction(tx, privateKey) {
        this.ensureInitialized();
        if (tx.type === 'shielded' && this.wasm) {
            return this.signShieldedTransaction(tx);
        }
        return this.signTransparentTransaction(tx, privateKey);
    }
    async signShieldedTransaction(tx) {
        if (!this.wasm || !this.spendingKey) {
            throw new Error('WASM module and spending key required');
        }
        // Build shielded transaction with proofs
        const shieldedTx = this.wasm.create_shielded_transaction({
            spending_key: this.spendingKey,
            inputs: tx.notes.map(note => ({
                note: new Uint8Array(Buffer.from(note.note, 'hex')),
                witness: new Uint8Array(Buffer.from(note.witness, 'hex')),
                position: BigInt(note.position),
            })),
            outputs: [{
                    address: tx.to,
                    amount: tx.value,
                    memo: tx.memo,
                }],
            fee: BigInt(10000),
            anchor: new Uint8Array(Buffer.from(tx.anchor, 'hex')),
        });
        return {
            chain: this.chain,
            rawTx: Buffer.from(shieldedTx).toString('hex'),
            signature: '',
        };
    }
    async signTransparentTransaction(tx, privateKey) {
        if (this.wasm) {
            // Use WASM for signing
            const rawTx = this.wasm.create_transparent_transaction({
                inputs: tx.utxos.map(utxo => ({
                    txid: utxo.txid,
                    vout: utxo.vout,
                    amount: BigInt(utxo.amount * 1e8),
                    script_pubkey: new Uint8Array(Buffer.from(utxo.scriptPubKey, 'hex')),
                })),
                outputs: [{
                        address: tx.to,
                        amount: tx.value,
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
            { [tx.to]: Number(tx.value) / 1e8 },
        ]);
        const signedResult = await this.rpcCall('signrawtransaction', [rawTx]);
        return {
            chain: this.chain,
            rawTx: signedResult.hex,
            signature: '',
        };
    }
    async broadcastTransaction(tx) {
        this.ensureInitialized();
        return await this.rpcCall('sendrawtransaction', [tx.rawTx]);
    }
    // Shielding operations
    async shieldFunds(transparentAddress, amount) {
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
    async unshieldFunds(shieldedAddress, transparentAddress, amount) {
        this.ensureInitialized();
        const operationId = await this.rpcCall('z_sendmany', [
            shieldedAddress,
            [{ address: transparentAddress, amount: Number(amount) / 1e8 }],
        ]);
        return operationId;
    }
    // Note scanning
    async scanForNotes(viewingKey, startHeight) {
        if (!this.wasm) {
            throw new Error('WASM module required for note scanning');
        }
        // In production, this would scan the blockchain for notes
        // decryptable with the viewing key
        const notes = [];
        // Get blocks and try to decrypt notes
        const currentHeight = await this.getBlockHeight();
        const start = startHeight || currentHeight - 1000;
        for (let height = start; height <= currentHeight; height++) {
            const block = await this.rpcCall('getblock', [height.toString(), 2]);
            for (const tx of block.tx) {
                if (tx.vShieldedOutput) {
                    for (const output of tx.vShieldedOutput) {
                        const decrypted = this.wasm.decrypt_note(new Uint8Array(Buffer.from(output.encCiphertext, 'hex')), new Uint8Array(viewingKey));
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
    async createHTLC(params) {
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
    async claimHTLC(htlcId, preimage) {
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
    async refundHTLC(htlcId) {
        this.ensureInitialized();
        const htlc = await this.getHTLCStatus(htlcId);
        return {
            chain: this.chain,
            type: 'htlc_refund',
            htlcId,
            amount: htlc.amount,
        };
    }
    async getHTLCStatus(htlcId) {
        this.ensureInitialized();
        return {
            id: htlcId,
            state: types_1.HTLCState.LOCKED,
            amount: BigInt(0),
            hashlock: '',
            timelock: 0,
        };
    }
    // Monitoring
    subscribeToAddress(address, callback) {
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
                }
                catch {
                    // Ignore polling errors
                }
                await this.sleep(30000);
            }
        };
        poll();
        return () => { running = false; };
    }
    async getTransaction(txHash) {
        this.ensureInitialized();
        const tx = await this.rpcCall('gettransaction', [txHash]);
        return this.parseTransaction(tx);
    }
    async getBlockHeight() {
        this.ensureInitialized();
        return await this.rpcCall('getblockcount', []);
    }
    async getConfirmations(txHash) {
        this.ensureInitialized();
        const tx = await this.rpcCall('gettransaction', [txHash]);
        return tx.confirmations || 0;
    }
    async isFinalized(txHash) {
        const confirmations = await this.getConfirmations(txHash);
        return confirmations >= 6;
    }
    getBlockTime() {
        return 75000;
    }
    async estimateGas(tx) {
        this.ensureInitialized();
        return BigInt(10000);
    }
    // Private helpers
    async getCurrentAnchor() {
        const treeState = await this.rpcCall('z_gettreestate', ['']);
        return treeState.sapling.commitments.finalRoot;
    }
    buildHTLCScript(params) {
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
    scriptToAddress(script) {
        const hash = (0, crypto_1.createHash)('sha256').update(script).digest();
        const ripemd = (0, crypto_1.createHash)('ripemd160').update(hash).digest();
        return `t3${ripemd.toString('hex').slice(0, 33)}`;
    }
    encodeNumber(num) {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(num);
        return Buffer.concat([Buffer.from([0x04]), buf]);
    }
    async rpcCall(method, params) {
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
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message);
        }
        return data.result;
    }
    parseTransaction(tx) {
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
exports.ZcashWasmAdapter = ZcashWasmAdapter;
//# sourceMappingURL=zcash-wasm.js.map