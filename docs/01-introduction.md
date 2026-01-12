# 1. SDK Introduction

## Overview

OmniSwap SDK is a comprehensive cross-chain swap SDK that enables developers to build applications with seamless, secure, and private atomic swaps across multiple heterogeneous blockchain networks.

### What is OmniSwap SDK?

OmniSwap SDK provides:

- **Cross-Chain Swaps**: Trade assets between 6 different blockchain networks
- **Privacy Features**: Built-in privacy preservation using advanced cryptographic techniques
- **Atomic Guarantees**: HTLC-based swaps ensuring trustless execution
- **Developer-Friendly API**: Simple, intuitive interfaces for complex operations
- **Production Ready**: Robust error handling, retry logic, and monitoring

### Key Capabilities

#### Cross-Chain Support

| Chain | Technology | Privacy Features | Transaction Speed |
|-------|------------|------------------|-------------------|
| **Zcash** | Sapling zkSNARKs | Shielded transactions | ~2.5 min blocks |
| **Osmosis** | Cosmos/IBC | IBC transfers | ~6 sec blocks |
| **Fhenix** | FHE | Encrypted computation | ~12 sec blocks |
| **Aztec** | zkSNARKs/Noir | Private L2 | L2 instant |
| **Miden** | zkSTARKs | Note-based privacy | ~4 sec blocks |
| **Mina** | Kimchi/o1js | zkApp proofs | ~3 min blocks |

#### Privacy Levels

The SDK offers three privacy levels:

1. **STANDARD** - Basic HTLC atomic swaps
   - Fast execution (5-15 minutes)
   - Standard timelock correlation
   - Suitable for most use cases

2. **ENHANCED** - Stealth addresses + timing decorrelation
   - Moderate execution (15-30 minutes)
   - One-time addresses
   - Basic timing randomization

3. **MAXIMUM** - Privacy Hub architecture
   - Slower execution (30 min - 4 hours)
   - Broken on-chain correlation
   - Different hashlocks source/destination
   - Extensive timing randomization
   - Maximum anonymity

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   OmniSwap SDK                           │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Intent Pool  │  │ Quote Engine │  │   Router     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │     HTLC     │  │ Privacy Hub  │  │   Refund     │  │
│  │ Coordinator  │  │ Coordinator  │  │   Manager    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
├─────────────────────────────────────────────────────────┤
│               Chain Adapter Registry                     │
├─────────────────────────────────────────────────────────┤
│  Zcash  │  Aztec  │  Miden  │  Mina  │ Fhenix │ Osmosis│
└─────────────────────────────────────────────────────────┘
          │         │         │         │         │
          ▼         ▼         ▼         ▼         ▼
    Blockchain Networks
```

### Core Components

#### 1. Intent Pool
Manages user swap intents and matches them with solvers.

```typescript
class IntentPool {
  submitIntent(intent: SwapIntent): Promise<void>
  getIntent(id: string): SwapIntent | undefined
  matchIntents(): Promise<IntentMatch[]>
}
```

#### 2. Quote Engine
Aggregates quotes from multiple sources and solvers.

```typescript
class QuoteEngine {
  getQuotes(request: SwapRequest): Promise<Quote[]>
  getBestQuote(quotes: Quote[]): Quote
}
```

#### 3. Route Optimizer
Finds optimal routes across chains considering fees, time, and privacy.

```typescript
class RouteOptimizer {
  findRoutes(intent: SwapIntent): Promise<Route[]>
  optimizeForSpeed(routes: Route[]): Route
  optimizeForCost(routes: Route[]): Route
  optimizeForPrivacy(routes: Route[]): Route
}
```

#### 4. HTLC Coordinator
Manages Hash Time-Locked Contract creation, monitoring, and claiming.

```typescript
class HTLCCoordinator {
  initiateAtomicSwap(intent: SwapIntent, solver: Solver): Promise<SwapExecution>
  monitorHTLC(htlcId: string): void
  claimHTLC(htlcId: string, secret: Buffer): Promise<string>
}
```

#### 5. Privacy Hub Coordinator
Implements advanced privacy features with broken correlation.

```typescript
class PrivacyHubCoordinator {
  executePrivateSwap(intent: SwapIntent, solver: Solver): Promise<PrivacyHubExecution>
  generateStealthAddress(chain: Chain, baseAddress: string): Promise<StealthAddress>
}
```

#### 6. Refund Manager
Automatically monitors and executes refunds for expired HTLCs.

```typescript
class RefundManager {
  registerSwap(execution: SwapExecution): void
  checkRefunds(): Promise<void>
  forceRefund(htlcId: string): Promise<boolean>
}
```

### Privacy Hub Architecture

The Privacy Hub is the most advanced privacy feature, breaking on-chain correlation:

```
Step 1: User locks on Source Chain
User ────HTLC₁(secret₁, timelock₁)───> Source Chain

Step 2: Solver deposits to Privacy Hub (Zcash shielded)
Solver ────Shielded Tx────> Privacy Hub (Zcash)

Step 3: Random delay (30min - 4hr, log-normal distributed)
Privacy Hub: ░░░░░░░░░░░░ (mixing) ░░░░░░░░░░░░

Step 4: Solver withdraws from Privacy Hub
Privacy Hub ────Shielded Tx────> Solver (different stealth address)

Step 5: Solver locks on Dest Chain with DIFFERENT secret
Solver ────HTLC₂(secret₂, timelock₂)───> Dest Chain

Result: No on-chain link between Source and Dest!
```

**Privacy Guarantees:**
- Different hashlocks prevent correlation
- Stealth addresses prevent address reuse analysis
- Random delays prevent timing correlation
- Shielded mixing provides unlinkability

## Installation

### Requirements

- **Node.js**: >= 18.0.0
- **TypeScript**: >= 5.0.0 (optional, for TypeScript projects)
- **npm** or **yarn**

### Install via npm

```bash
npm install omniswap-sdk
```

### Install via yarn

```bash
yarn add omniswap-sdk
```

### Verify Installation

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

console.log('OmniSwap SDK installed successfully!');
```

## Quick Start

### Basic Example

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

// 1. Initialize SDK
const omniswap = new OmniSwap({
  environment: 'mainnet', // or 'testnet', 'local'
  apiKey: 'your-api-key', // optional
});

// 2. Initialize chain adapters
await omniswap.initialize({
  [Chain.ZCASH]: {
    rpcUrl: 'https://zcash-rpc.example.com'
  },
  [Chain.OSMOSIS]: {
    rpcUrl: 'https://osmosis-rpc.example.com'
  },
});

// 3. Get quotes
const quotes = await omniswap.getQuote({
  sourceChain: Chain.ZCASH,
  destChain: Chain.OSMOSIS,
  sourceAsset: 'ZEC',
  destAsset: 'OSMO',
  sourceAmount: BigInt(1e8), // 1 ZEC
  userAddress: {
    [Chain.ZCASH]: 't1YourZcashAddress',
    [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress',
  },
});

console.log(`Best quote: ${quotes[0].outputAmount} OSMO`);

// 4. Execute swap
const execution = await omniswap.executeSwap(quotes[0]);

// 5. Monitor status
omniswap.subscribeToSwap(execution.swapId, (update) => {
  console.log('Status:', update.status);
});
```

### Privacy-Enhanced Example

```typescript
import { OmniSwap, Chain, PrivacyLevel } from 'omniswap-sdk';

const omniswap = new OmniSwap({
  environment: 'mainnet',
});

await omniswap.initialize({
  [Chain.ZCASH]: { rpcUrl: 'https://zcash-rpc.example.com' },
  [Chain.OSMOSIS]: { rpcUrl: 'https://osmosis-rpc.example.com' },
});

// Get quotes with maximum privacy
const quotes = await omniswap.getQuote({
  sourceChain: Chain.ZCASH,
  destChain: Chain.OSMOSIS,
  sourceAsset: 'ZEC',
  destAsset: 'OSMO',
  sourceAmount: BigInt(5e8), // 5 ZEC
  userAddress: {
    [Chain.ZCASH]: 't1YourZcashAddress',
    [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress',
  },
  privacyLevel: PrivacyLevel.MAXIMUM,
});

// Execute with Privacy Hub
const execution = await omniswap.executePrivateSwap(quotes[0], {
  hubConfig: {
    hubChain: 'zcash',
    minMixingDelay: 30 * 60 * 1000, // 30 minutes
    maxMixingDelay: 4 * 60 * 60 * 1000, // 4 hours
    useSplitAmounts: true,
    useDecoyTransactions: true,
  },
});

console.log('Privacy features:');
console.log('- Correlation broken:', execution.correlationBroken);
console.log('- Timing decorrelated:', execution.timingDecorrelated);
console.log('- One-time addresses:', execution.addressesOneTime);
```

## Next Steps

- **Explore [Use Cases](./02-use-cases.md)** to see real-world applications
- **Review [API Reference](./03-api-reference.md)** for detailed API documentation
- **Follow [How-To Guides](./04-how-to-guides.md)** for step-by-step tutorials
- **Check [Examples](../examples/)** for complete code samples
- **Read [FAQ](./05-faq.md)** for common questions and solutions

## Support

Need help getting started?

- **Documentation**: You're reading it!
- **Examples**: Check the [`examples/`](../examples/) directory
- **GitHub Issues**: Report bugs or request features
- **Discord**: Join our community for real-time help
- **Email**: support@omniswap.io
