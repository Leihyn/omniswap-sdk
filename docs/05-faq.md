# 5. SDK FAQ and Troubleshooting

Frequently asked questions and common issues with solutions.

## Table of Contents

- [General Questions](#general-questions)
- [Installation and Setup](#installation-and-setup)
- [Swaps and Execution](#swaps-and-execution)
- [Privacy Features](#privacy-features)
- [Error Handling](#error-handling)
- [Performance](#performance)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## General Questions

### What is OmniSwap SDK?

OmniSwap SDK is a cross-chain atomic swap SDK that enables trustless, privacy-preserving swaps between 6 heterogeneous blockchains: Zcash, Osmosis, Fhenix, Aztec, Miden, and Mina.

### How does OmniSwap ensure atomic swaps?

OmniSwap uses Hash Time-Locked Contracts (HTLCs) to ensure atomicity. Either both parties receive their funds, or both get refunds. There's no possibility of one party receiving funds while the other doesn't.

### What makes OmniSwap different from other cross-chain solutions?

1. **Privacy-First**: Built-in privacy features including stealth addresses, timing decorrelation, and correlation-breaking
2. **Trustless**: No intermediaries or trusted third parties required
3. **Atomic**: Guaranteed execution or refund via HTLCs
4. **Multi-Chain**: Supports 6 different blockchain networks
5. **Developer-Friendly**: Simple API abstracting complex operations

### Do I need to run my own nodes?

Not necessarily. You can:
- Use public RPC endpoints (not recommended for production)
- Use hosted RPC services (recommended)
- Run your own nodes (maximum privacy and reliability)

### Is OmniSwap audited?

The SDK is currently in development (v1.0.0) and has not been audited yet. Use at your own risk on mainnet. An audit is planned before the official production release.

---

## Installation and Setup

### Why do I get "Module not found" errors?

Make sure you've installed the SDK:
```bash
npm install omniswap-sdk
```

If using TypeScript, ensure you have types:
```bash
npm install --save-dev @types/node
```

### How do I configure the SDK for testnet?

```typescript
const omniswap = new OmniSwap({
  environment: 'testnet',
});

await omniswap.initialize({
  [Chain.ZCASH]: { rpcUrl: 'https://testnet.zcash-rpc.example.com' },
  [Chain.OSMOSIS]: { rpcUrl: 'https://testnet.osmosis-rpc.example.com' },
});
```

### Can I use the SDK without an API key?

Yes, API keys are optional. Without an API key, you can:
- Use local execution for all operations
- Access public API endpoints (rate-limited)

With an API key:
- Higher rate limits
- Access to premium solvers
- Priority support

### What Node.js version is required?

Node.js >= 18.0.0 is required for proper BigInt and crypto support.

---

## Swaps and Execution

### How long does a swap take?

Timing depends on privacy level:

- **STANDARD**: 5-15 minutes (varies by chain confirmation times)
- **ENHANCED**: 15-30 minutes (includes timing decorrelation)
- **MAXIMUM**: 30 minutes - 4 hours (Privacy Hub mixing delays)

### Why is my swap taking longer than estimated?

Common reasons:
1. **Network congestion**: Chains are experiencing high traffic
2. **Low gas/fees**: Transactions waiting in mempool
3. **Privacy mixing**: MAXIMUM privacy includes intentional delays
4. **Solver availability**: Waiting for solver to fulfill intent

Check status:
```typescript
const status = await omniswap.getSwapStatus(swapId);
console.log('Current state:', status.status);
console.log('Steps:', status.steps);
```

### Can I cancel a swap?

Once initiated, swaps cannot be canceled. However:
- If timelock expires, funds are automatically refunded
- You can monitor and claim refund manually if needed

```typescript
const refundManager = createRefundManager(adapters);
await refundManager.forceRefund(htlcId);
```

### What happens if a swap fails?

Failed swaps trigger automatic refunds:
1. Swap attempt fails
2. Timelock expires
3. RefundManager detects expired HTLC
4. Refund transaction is automatically broadcast
5. You receive your original funds back

### How do I get the best quote?

```typescript
const quotes = await omniswap.getQuote(request);

// Sort by different criteria
const bestOutput = quotes.sort((a, b) =>
  b.outputAmount > a.outputAmount ? 1 : -1
)[0];

const lowestFees = quotes.sort((a, b) =>
  a.fees.total > b.fees.total ? 1 : -1
)[0];

const fastest = quotes.sort((a, b) =>
  a.route.estimatedTime - b.route.estimatedTime
)[0];
```

### Can I perform multi-hop swaps?

Yes! The router automatically finds optimal multi-hop routes:

```typescript
// SDK automatically routes ZEC -> OSMO -> MINA if optimal
const quotes = await omniswap.getQuote({
  sourceChain: Chain.ZCASH,
  destChain: Chain.MINA,
  sourceAsset: 'ZEC',
  destAsset: 'MINA',
  sourceAmount: BigInt(1e8),
  userAddress: { ... },
});

// Check route hops
console.log('Route hops:', quotes[0].route.hops);
```

---

## Privacy Features

### What privacy level should I use?

Choose based on your needs:

**STANDARD** - Use when:
- Speed is priority
- Privacy is not a concern
- Cost is a factor

**ENHANCED** - Use when:
- Moderate privacy needed
- Address reuse is a concern
- Reasonable trade-off between privacy and speed

**MAXIMUM** - Use when:
- Maximum anonymity required
- On-chain correlation must be broken
- Time is not a constraint
- You're willing to pay higher fees

### How do stealth addresses work?

Stealth addresses are one-time addresses that prevent address reuse correlation:

```typescript
// Generate stealth address
const stealth = await omniswap.generateStealthAddress(
  Chain.ZCASH,
  't1YourBaseAddress'
);

// Use in swap
const quotes = await omniswap.getQuote({
  // ... other params
  userAddress: {
    [Chain.ZCASH]: stealth.address, // One-time address
    [Chain.OSMOSIS]: 'osmo1YourAddress',
  },
});

// Recover funds using viewing key
const funds = await recoverFromStealth(stealth.viewingKey);
```

### What is the Privacy Hub?

Privacy Hub is an advanced architecture that breaks on-chain correlation by:

1. **Different secrets**: Source and destination use different hashlocks
2. **Mixing**: Funds route through shielded pools (Zcash, Aztec, Miden)
3. **Timing decorrelation**: Random delays prevent timing analysis
4. **Stealth addresses**: One-time addresses prevent address correlation

Result: No observer can link source and destination transactions.

### Do privacy swaps cost more?

Yes, privacy swaps typically cost more due to:
- Additional mixing transactions
- Longer execution time (solver lock-up costs)
- Decoy transactions (if enabled)
- Shielded pool fees

Estimate before executing:
```typescript
const fees = await omniswap.estimateFees({
  ...request,
  privacyLevel: PrivacyLevel.MAXIMUM,
});

console.log('Total fees:', fees.total);
```

---

## Error Handling

### Common Error Codes

| Code Range | Category | Examples |
|------------|----------|----------|
| 1xxx | Adapter errors | 1001: Chain not initialized |
| 2xxx | Transaction errors | 2001: Insufficient balance |
| 3xxx | HTLC errors | 3001: HTLC creation failed |
| 4xxx | Swap errors | 4001: No route found |
| 5xxx | Solver errors | 5001: Solver unavailable |
| 6xxx | Privacy errors | 6001: Stealth address generation failed |
| 9xxx | Network errors | 9001: RPC connection failed |

### How to handle "Insufficient balance" error?

```typescript
try {
  await omniswap.executeSwap(quote);
} catch (error) {
  if (error.code === 2001) {
    const balance = await omniswap.getBalance(
      request.sourceChain,
      request.userAddress[request.sourceChain]
    );
    console.log('Your balance:', balance);
    console.log('Required:', request.sourceAmount + quote.fees.networkFees[request.sourceChain]);
  }
}
```

### What does "HTLC timelock expired" mean?

The swap took too long and the timelock expired. This triggers an automatic refund:

```typescript
// Check if refund is available
const status = await omniswap.getSwapStatus(swapId);

if (status.status === ExecutionState.REFUNDED) {
  console.log('Funds have been refunded');
} else if (status.status === ExecutionState.REFUNDING) {
  console.log('Refund in progress...');
}
```

### How to debug "RPC connection failed" errors?

1. **Check RPC URL**:
```typescript
// Test connection
const response = await fetch(rpcUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'eth_blockNumber', params: [], id: 1 }),
});
console.log('RPC status:', response.status);
```

2. **Check firewall/network**:
```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"method":"eth_blockNumber","params":[],"id":1}' \
  https://your-rpc-url.com
```

3. **Use fallback RPC**:
```typescript
await omniswap.initialize({
  [Chain.ZCASH]: {
    rpcUrl: 'https://primary-rpc.com',
    fallbackUrls: [
      'https://backup-1-rpc.com',
      'https://backup-2-rpc.com',
    ],
  },
});
```

### Should I retry failed swaps?

Depends on the error:

**Retryable errors** (network issues, temporary failures):
```typescript
import { isRetryableError, withRetry, RetryPresets } from 'omniswap-sdk';

try {
  await omniswap.executeSwap(quote);
} catch (error) {
  if (isRetryableError(error)) {
    await withRetry(() => omniswap.executeSwap(quote), RetryPresets.standard);
  }
}
```

**Non-retryable errors** (insufficient balance, invalid parameters):
- Fix the underlying issue before retrying

---

## Performance

### How can I speed up swaps?

1. **Choose fast chains**: Osmosis (6s blocks) > Zcash (2.5min blocks)
2. **Use STANDARD privacy**: Avoid Privacy Hub delays
3. **Set higher gas/fees**: Faster confirmation
4. **Use API for quotes**: Faster than local computation

```typescript
const quotes = await omniswap.getQuote({
  ...request,
  privacyLevel: PrivacyLevel.STANDARD, // Fastest
});

// Optimize for speed
const fastestRoute = quotes.sort(
  (a, b) => a.route.estimatedTime - b.route.estimatedTime
)[0];
```

### Why are quotes slow to fetch?

If quotes are slow:
1. **Use API key**: Higher priority processing
2. **Reduce chains**: Initialize only needed chains
3. **Cache results**: Cache quotes for a few seconds

```typescript
let quoteCache = null;
let cacheTime = 0;

async function getCachedQuote(request) {
  const now = Date.now();
  if (quoteCache && now - cacheTime < 10000) {
    return quoteCache;
  }

  quoteCache = await omniswap.getQuote(request);
  cacheTime = now;
  return quoteCache;
}
```

### How to optimize for low fees?

```typescript
const quotes = await omniswap.getQuote(request);

// Find cheapest route
const cheapest = quotes.sort(
  (a, b) => Number(a.fees.total - b.fees.total)
)[0];

console.log('Lowest fees:', cheapest.fees.total);
console.log('Fee breakdown:', cheapest.fees);
```

---

## Security

### Is it safe to store private keys in the SDK?

**NO!** Never store private keys in your application code. Instead:

1. **Use environment variables**:
```typescript
const privateKey = process.env.PRIVATE_KEY;
```

2. **Use hardware wallets**:
```typescript
// Sign externally, pass signed tx
const signedTx = await hardwareWallet.sign(unsignedTx);
await omniswap.executeSwap(quote, { [chain]: signedTx });
```

3. **Use key management services**:
```typescript
const key = await kms.getPrivateKey('swap-key-id');
```

### How to protect against MEV?

1. **Use privacy swaps**: Break correlation
2. **Set tight slippage**: Limit frontrunning profit
3. **Use private relayers**: Submit via private mempool

```typescript
const quotes = await omniswap.getQuote({
  ...request,
  slippageTolerance: 0.001, // 0.1% - very tight
  privacyLevel: PrivacyLevel.MAXIMUM,
});
```

### What are the risks of cross-chain swaps?

**Technical risks**:
- Smart contract bugs (HTLC implementation)
- Chain reorganizations
- Network failures

**Economic risks**:
- Price volatility during swap
- Slippage
- Failed swaps (refund only)

**Mitigation**:
- Use testnet first
- Start with small amounts
- Set appropriate deadlines
- Monitor swaps actively

---

## Troubleshooting

### Swap stuck in "LOCKING_SOURCE" state

**Possible causes**:
1. Insufficient gas/fees
2. Network congestion
3. RPC issues

**Solutions**:
```typescript
// Check transaction status
const status = await omniswap.getSwapStatus(swapId);
const txHash = status.steps.find(s => s.name === 'Lock Source')?.txHash;

if (txHash) {
  // Wait for confirmation
  await omniswap.waitForTransaction(sourceChain, txHash);
} else {
  // Transaction not yet broadcast - may need to retry
  console.log('Transaction pending broadcast');
}
```

### "Quote expired" error

Quotes have limited validity (typically 30-60 seconds). Get a fresh quote:

```typescript
try {
  await omniswap.executeSwap(quote);
} catch (error) {
  if (error.code === 4002) { // Quote expired
    const newQuotes = await omniswap.getQuote(request);
    await omniswap.executeSwap(newQuotes[0]);
  }
}
```

### WebSocket connection issues

```typescript
// Fallback to polling if WebSocket fails
let wsConnected = false;

try {
  const unsubscribe = omniswap.subscribeToSwap(swapId, callback);
  wsConnected = true;
} catch (error) {
  console.log('WebSocket failed, using polling');

  // Poll status instead
  const interval = setInterval(async () => {
    const status = await omniswap.getSwapStatus(swapId);
    callback({ type: 'status_change', status: status.status, ...status });

    if (status.status === ExecutionState.COMPLETED ||
        status.status === ExecutionState.FAILED) {
      clearInterval(interval);
    }
  }, 5000);
}
```

### High memory usage

```typescript
// Disconnect when done
omniswap.disconnect();

// Limit concurrent swaps
const MAX_CONCURRENT = 5;
const swapQueue = [];

async function executeWithLimit(quote) {
  while (swapQueue.length >= MAX_CONCURRENT) {
    await Promise.race(swapQueue);
  }

  const promise = omniswap.executeSwap(quote);
  swapQueue.push(promise);

  promise.finally(() => {
    swapQueue.splice(swapQueue.indexOf(promise), 1);
  });

  return promise;
}
```

---

## Still Need Help?

### Resources

- **Documentation**: [docs/](./README.md)
- **Examples**: [examples/](../examples/)
- **API Reference**: [03-api-reference.md](./03-api-reference.md)
- **How-To Guides**: [04-how-to-guides.md](./04-how-to-guides.md)

### Support Channels

- **GitHub Issues**: Report bugs or request features
- **Discord**: Join our community for real-time help
- **Email**: support@omniswap.io for enterprise support

### Reporting Bugs

When reporting bugs, include:
1. SDK version: `npm list omniswap-sdk`
2. Node.js version: `node --version`
3. Error message and stack trace
4. Minimal reproduction code
5. Steps to reproduce

```typescript
// Example bug report
/*
SDK version: 1.0.0
Node.js: v18.16.0
Environment: testnet

Error:
HTLCError: HTLC creation failed (code: 3001)
  at HTLCCoordinator.create (htlc-coordinator.ts:42)

Reproduction:
const omniswap = new OmniSwap({ environment: 'testnet' });
await omniswap.initialize({ [Chain.ZCASH]: { rpcUrl: '...' } });
const quotes = await omniswap.getQuote({...});
await omniswap.executeSwap(quotes[0]); // Fails here
*/
```
