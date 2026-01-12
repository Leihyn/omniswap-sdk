"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
const eventemitter3_1 = __importDefault(require("eventemitter3"));
const types_1 = require("../types");
class ApiClient extends eventemitter3_1.default {
    constructor(config) {
        super();
        this.ws = null;
        this.subscriptions = new Map();
        this.config = config;
    }
    // REST API methods
    async getQuotes(request) {
        const response = await this.post('/v1/quotes', {
            sourceChain: request.sourceChain,
            destChain: request.destChain,
            sourceAsset: request.sourceAsset,
            destAsset: request.destAsset,
            sourceAmount: request.sourceAmount.toString(),
            slippageTolerance: request.slippageTolerance || 0.005,
            userAddress: request.userAddress,
        });
        return response.quotes.map(this.parseQuote);
    }
    async executeSwap(quoteId, signatures, privacyLevel = types_1.PrivacyLevel.STANDARD) {
        const signatureData = {};
        for (const [chain, tx] of Object.entries(signatures)) {
            signatureData[chain] = {
                signedTx: tx.rawTx,
                signature: tx.signature,
                publicKey: tx.publicKey,
            };
        }
        return this.post('/v1/swaps', {
            quoteId,
            signatures: signatureData,
            privacyLevel,
        });
    }
    async getSwapStatus(swapId) {
        const response = await this.get(`/v1/swaps/${swapId}`);
        return this.parseSwapStatus(response);
    }
    async getSupportedChains() {
        const response = await this.get('/v1/chains');
        return response.chains;
    }
    async getSupportedPairs() {
        const response = await this.get('/v1/pairs');
        return response.pairs;
    }
    async getLiquidity(sourceChain, destChain, sourceAsset, destAsset) {
        const response = await this.get('/v1/liquidity', {
            sourceChain,
            destChain,
            sourceAsset,
            destAsset,
        });
        return response;
    }
    async estimateFees(request) {
        const response = await this.post('/v1/fees/estimate', {
            sourceChain: request.sourceChain,
            destChain: request.destChain,
            sourceAsset: request.sourceAsset,
            destAsset: request.destAsset,
            sourceAmount: request.sourceAmount.toString(),
        });
        return {
            protocolFee: BigInt(response.protocolFee),
            networkFees: Object.fromEntries(Object.entries(response.networkFees).map(([k, v]) => [k, BigInt(v)])),
            estimatedSolverFee: BigInt(response.estimatedSolverFee),
            total: BigInt(response.total),
        };
    }
    // WebSocket methods
    subscribeToSwap(swapId, callback) {
        this.ensureWebSocket();
        this.subscriptions.set(swapId, callback);
        this.ws.send(JSON.stringify({
            type: 'subscribe',
            channel: 'swap',
            swapId,
        }));
        return () => {
            this.subscriptions.delete(swapId);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'unsubscribe',
                    channel: 'swap',
                    swapId,
                }));
            }
        };
    }
    ensureWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }
        this.ws = new WebSocket(this.config.wsUrl);
        this.ws.onopen = () => {
            this.emit('connected');
        };
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        this.ws.onclose = () => {
            this.emit('disconnected');
            // Reconnect after delay
            setTimeout(() => this.ensureWebSocket(), 5000);
        };
        this.ws.onerror = (error) => {
            this.emit('error', error);
        };
    }
    handleWebSocketMessage(data) {
        if (data.type === 'swap_update' && data.swapId) {
            const callback = this.subscriptions.get(data.swapId);
            if (callback) {
                callback({
                    type: data.updateType,
                    swapId: data.swapId,
                    status: data.status,
                    step: data.step,
                    outputAmount: data.outputAmount ? BigInt(data.outputAmount) : undefined,
                    error: data.error,
                    timestamp: data.timestamp || Date.now(),
                });
            }
        }
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.subscriptions.clear();
    }
    // HTTP helpers
    async get(path, params) {
        let url = `${this.config.apiUrl}${path}`;
        if (params) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                searchParams.append(key, String(value));
            }
            url += `?${searchParams.toString()}`;
        }
        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    async post(path, body) {
        const response = await fetch(`${this.config.apiUrl}${path}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.config.apiKey) {
            headers['X-API-Key'] = this.config.apiKey;
        }
        return headers;
    }
    parseQuote(data) {
        return {
            id: data.id,
            source: data.source,
            route: data.route,
            inputAmount: BigInt(data.inputAmount),
            outputAmount: BigInt(data.outputAmount),
            fees: {
                protocolFee: BigInt(data.fees.protocol || data.fees.protocolFee),
                networkFees: Object.fromEntries(Object.entries(data.fees.network || data.fees.networkFees || {}).map(([k, v]) => [k, BigInt(v)])),
                solverFee: BigInt(data.fees.solver || data.fees.solverFee),
                total: BigInt(data.fees.total),
            },
            validUntil: data.validUntil,
            requiredSignatures: data.requiredSignatures || [],
        };
    }
    parseSwapStatus(data) {
        return {
            swapId: data.swapId,
            status: data.status,
            steps: data.steps,
            outputAmount: data.outputAmount ? BigInt(data.outputAmount) : undefined,
            fees: data.fees ? {
                protocolFee: BigInt(data.fees.protocolFee),
                networkFees: Object.fromEntries(Object.entries(data.fees.networkFees || {}).map(([k, v]) => [k, BigInt(v)])),
                solverFee: BigInt(data.fees.solverFee),
                total: BigInt(data.fees.total),
            } : undefined,
            error: data.error,
        };
    }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=api-client.js.map