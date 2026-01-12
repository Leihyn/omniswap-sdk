# 2. SDK Use Cases

This document explores real-world use cases and application scenarios for the OmniSwap SDK.

## Overview

The OmniSwap SDK can be integrated into various types of applications:

- Cross-chain DEX platforms
- Privacy-focused wallets
- DeFi protocols and aggregators
- Payment processors
- Liquidity management tools
- DAO treasuries
- Trading bots

## Use Case Categories

### 1. Cross-Chain DEX Applications

Build decentralized exchanges that support trading between different blockchains.

#### Scenario: Multi-Chain DEX

**Description**: A DEX that allows users to trade assets across Zcash, Osmosis, and other supported chains without leaving the platform.

**Implementation**:

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

class MultiChainDEX {
  private omniswap: OmniSwap;

  constructor() {
    this.omniswap = new OmniSwap({
      environment: 'mainnet',
      apiKey: process.env.OMNISWAP_API_KEY,
    });
  }

  async initialize() {
    await this.omniswap.initialize({
      [Chain.ZCASH]: { rpcUrl: process.env.ZCASH_RPC },
      [Chain.OSMOSIS]: { rpcUrl: process.env.OSMOSIS_RPC },
      [Chain.AZTEC]: { rpcUrl: process.env.AZTEC_RPC },
    });
  }

  async getAvailablePairs() {
    return await this.omniswap.getSupportedPairs();
  }

  async quoteTrade(from: Chain, to: Chain, fromAsset: string, toAsset: string, amount: bigint) {
    const quotes = await this.omniswap.getQuote({
      sourceChain: from,
      destChain: to,
      sourceAsset: fromAsset,
      destAsset: toAsset,
      sourceAmount: amount,
      userAddress: {
        [from]: this.getUserAddress(from),
        [to]: this.getUserAddress(to),
      },
    });

    return quotes;
  }

  async executeTrade(quote: Quote) {
    const execution = await this.omniswap.executeSwap(quote);

    // Monitor progress
    this.omniswap.subscribeToSwap(execution.swapId, (update) => {
      this.notifyUser(update);
    });

    return execution;
  }
}
```

**Benefits**:
- Unified liquidity across chains
- No bridging required
- Atomic execution guarantees
- Built-in monitoring

---

### 2. Privacy-Focused Wallets

Integrate privacy-preserving cross-chain swaps into cryptocurrency wallets.

#### Scenario: Privacy Wallet with Anonymous Swaps

**Description**: A wallet that allows users to swap assets between chains while preserving maximum privacy.

**Implementation**:

```typescript
import { OmniSwap, Chain, PrivacyLevel } from 'omniswap-sdk';

class PrivacyWallet {
  private omniswap: OmniSwap;

  async swapWithPrivacy(
    fromChain: Chain,
    toChain: Chain,
    fromAsset: string,
    toAsset: string,
    amount: bigint,
    privacyLevel: PrivacyLevel = PrivacyLevel.MAXIMUM
  ) {
    // Get quotes with privacy options
    const quotes = await this.omniswap.getQuote({
      sourceChain: fromChain,
      destChain: toChain,
      sourceAsset: fromAsset,
      destAsset: toAsset,
      sourceAmount: amount,
      userAddress: {
        [fromChain]: await this.getPrivateAddress(fromChain),
        [toChain]: await this.getPrivateAddress(toChain),
      },
      privacyLevel,
    });

    // Execute with privacy hub
    const execution = await this.omniswap.executePrivateSwap(quotes[0], {
      hubConfig: {
        hubChain: 'zcash',
        minMixingDelay: 30 * 60 * 1000,
        maxMixingDelay: 4 * 60 * 60 * 1000,
        useSplitAmounts: true,
        useDecoyTransactions: true,
        decoyCount: 3,
      },
    });

    // Show privacy metrics to user
    this.displayPrivacyScore({
      correlationBroken: execution.correlationBroken,
      timingDecorrelated: execution.timingDecorrelated,
      addressesOneTime: execution.addressesOneTime,
    });

    return execution;
  }

  private async getPrivateAddress(chain: Chain): Promise<string> {
    // Generate stealth address for this swap
    const baseAddress = this.wallet.getAddress(chain);
    const stealthAddress = await this.omniswap.generateStealthAddress(chain, baseAddress);
    return stealthAddress.address;
  }
}
```

**Benefits**:
- Maximum anonymity
- Broken on-chain correlation
- Stealth addresses
- Timing decorrelation

---

### 3. DeFi Protocol Integration

Integrate cross-chain swaps into DeFi protocols for yield farming, lending, or liquidity provision.

#### Scenario: Cross-Chain Yield Aggregator

**Description**: A yield aggregator that automatically moves user funds to the highest-yielding opportunities across different chains.

**Implementation**:

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

class YieldAggregator {
  private omniswap: OmniSwap;

  async rebalanceToOptimalChain(
    currentChain: Chain,
    currentAsset: string,
    amount: bigint,
    targetChain: Chain,
    targetAsset: string
  ) {
    // Check if rebalancing is profitable
    const quotes = await this.omniswap.getQuote({
      sourceChain: currentChain,
      destChain: targetChain,
      sourceAsset: currentAsset,
      destAsset: targetAsset,
      sourceAmount: amount,
      userAddress: {
        [currentChain]: this.contractAddress[currentChain],
        [targetChain]: this.contractAddress[targetChain],
      },
    });

    const bestQuote = quotes[0];
    const fees = await this.omniswap.estimateFees({
      sourceChain: currentChain,
      destChain: targetChain,
      sourceAsset: currentAsset,
      destAsset: targetAsset,
      sourceAmount: amount,
      userAddress: {
        [currentChain]: this.contractAddress[currentChain],
        [targetChain]: this.contractAddress[targetChain],
      },
    });

    // Calculate profit
    const projectedYield = this.calculateYield(targetChain, targetAsset, bestQuote.outputAmount);
    const costOfSwap = fees.total;

    if (projectedYield > costOfSwap) {
      // Execute swap
      const execution = await this.omniswap.executeSwap(bestQuote);

      // Monitor and stake on arrival
      this.omniswap.subscribeToSwap(execution.swapId, async (update) => {
        if (update.type === 'swap_complete') {
          await this.stakeOnTargetChain(targetChain, targetAsset, update.outputAmount);
        }
      });

      return execution;
    }

    return null; // Not profitable
  }
}
```

**Benefits**:
- Automated cross-chain strategies
- Cost-aware rebalancing
- Atomic execution
- Yield optimization

---

### 4. Payment Processing

Enable cross-chain payment solutions for merchants and payment processors.

#### Scenario: Multi-Chain Payment Gateway

**Description**: A payment gateway that accepts payments in various cryptocurrencies and settles in the merchant's preferred currency/chain.

**Implementation**:

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

class PaymentGateway {
  private omniswap: OmniSwap;

  async processPayment(
    payment: {
      chain: Chain;
      asset: string;
      amount: bigint;
      from: string;
    },
    merchantSettlement: {
      chain: Chain;
      asset: string;
      address: string;
    }
  ) {
    // If payment is in different chain/asset than merchant prefers
    if (payment.chain !== merchantSettlement.chain || payment.asset !== merchantSettlement.asset) {
      // Swap to merchant's preferred currency
      const quotes = await this.omniswap.getQuote({
        sourceChain: payment.chain,
        destChain: merchantSettlement.chain,
        sourceAsset: payment.asset,
        destAsset: merchantSettlement.asset,
        sourceAmount: payment.amount,
        userAddress: {
          [payment.chain]: payment.from,
          [merchantSettlement.chain]: merchantSettlement.address,
        },
      });

      // Execute swap with tight slippage tolerance
      const execution = await this.omniswap.executeSwap(quotes[0]);

      // Return payment confirmation
      return {
        paymentId: execution.swapId,
        status: 'processing',
        expectedAmount: quotes[0].outputAmount,
        estimatedTime: quotes[0].route.estimatedTime,
      };
    }

    // Direct payment (same chain/asset)
    return this.processDirectPayment(payment, merchantSettlement);
  }

  async getPaymentStatus(paymentId: string) {
    return await this.omniswap.getSwapStatus(paymentId);
  }
}
```

**Benefits**:
- Accept multiple currencies
- Auto-conversion to preferred currency
- Atomic settlements
- Real-time status tracking

---

### 5. Liquidity Management

Manage liquidity across multiple chains efficiently.

#### Scenario: Multi-Chain Liquidity Provider

**Description**: A liquidity management tool that helps LPs optimize their positions across different chains.

**Implementation**:

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

class LiquidityManager {
  private omniswap: OmniSwap;

  async rebalanceLiquidity(positions: LiquidityPosition[]) {
    // Analyze current positions
    const optimalDistribution = this.calculateOptimalDistribution(positions);

    // Execute rebalancing swaps
    const swaps = [];
    for (const move of optimalDistribution.moves) {
      const quotes = await this.omniswap.getQuote({
        sourceChain: move.fromChain,
        destChain: move.toChain,
        sourceAsset: move.asset,
        destAsset: move.asset,
        sourceAmount: move.amount,
        userAddress: {
          [move.fromChain]: this.lpAddress[move.fromChain],
          [move.toChain]: this.lpAddress[move.toChain],
        },
      });

      swaps.push(this.omniswap.executeSwap(quotes[0]));
    }

    return await Promise.all(swaps);
  }

  async getLiquidityInfo(chain: Chain, pair: TradingPair) {
    return await this.omniswap.getLiquidity(pair);
  }
}
```

**Benefits**:
- Optimal liquidity distribution
- Minimize idle capital
- Cross-chain rebalancing
- Maximize yield

---

### 6. DAO Treasury Management

Enable DAOs to manage multi-chain treasuries efficiently.

#### Scenario: DAO Multi-Chain Treasury

**Description**: A DAO that holds assets across multiple chains and needs to rebalance or execute payments.

**Implementation**:

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

class DAOTreasury {
  private omniswap: OmniSwap;

  async executeProposal(proposal: TreasuryProposal) {
    // Proposal: Swap 100 ZEC to OSMO for funding development
    if (proposal.type === 'swap') {
      const quotes = await this.omniswap.getQuote({
        sourceChain: proposal.sourceChain,
        destChain: proposal.destChain,
        sourceAsset: proposal.sourceAsset,
        destAsset: proposal.destAsset,
        sourceAmount: proposal.amount,
        userAddress: {
          [proposal.sourceChain]: this.daoAddress[proposal.sourceChain],
          [proposal.destChain]: this.daoAddress[proposal.destChain],
        },
      });

      // Require multi-sig approval
      const signatures = await this.getMultiSigApprovals(quotes[0]);

      // Execute with signatures
      const execution = await this.omniswap.executeSwap(quotes[0], signatures);

      // Log to governance system
      await this.logGovernanceAction({
        proposalId: proposal.id,
        executionId: execution.swapId,
        timestamp: Date.now(),
      });

      return execution;
    }
  }

  async getTreasuryBalance() {
    const balances = {};
    const chains = this.omniswap.getSupportedChains();

    for (const chain of chains) {
      balances[chain] = await this.omniswap.getBalance(
        chain,
        this.daoAddress[chain]
      );
    }

    return balances;
  }
}
```

**Benefits**:
- Multi-chain treasury management
- Governance integration
- Transparent execution
- Multi-sig support

---

### 7. Arbitrage Trading Bots

Build automated arbitrage bots that exploit price differences across chains.

#### Scenario: Cross-Chain Arbitrage Bot

**Description**: A bot that monitors prices across chains and executes profitable arbitrage trades.

**Implementation**:

```typescript
import { OmniSwap, Chain } from 'omniswap-sdk';

class ArbitrageBot {
  private omniswap: OmniSwap;

  async scanForOpportunities() {
    const pairs = await this.omniswap.getSupportedPairs();

    for (const pair of pairs) {
      // Get prices on both chains
      const price1 = await this.getPrice(pair.sourceAsset.chain, pair.sourceAsset.symbol);
      const price2 = await this.getPrice(pair.destAsset.chain, pair.destAsset.symbol);

      // Calculate arbitrage opportunity
      const spread = Math.abs(price1 - price2) / Math.min(price1, price2);

      if (spread > 0.02) { // 2% spread threshold
        await this.executeArbitrage(pair, price1, price2);
      }
    }
  }

  private async executeArbitrage(pair: TradingPair, price1: number, price2: number) {
    const amount = this.calculateOptimalAmount(pair, price1, price2);

    // Get quote
    const quotes = await this.omniswap.getQuote({
      sourceChain: pair.sourceAsset.chain,
      destChain: pair.destAsset.chain,
      sourceAsset: pair.sourceAsset.symbol,
      destAsset: pair.destAsset.symbol,
      sourceAmount: amount,
      userAddress: {
        [pair.sourceAsset.chain]: this.botAddress[pair.sourceAsset.chain],
        [pair.destAsset.chain]: this.botAddress[pair.destAsset.chain],
      },
    });

    // Calculate expected profit
    const fees = await this.omniswap.estimateFees({
      sourceChain: pair.sourceAsset.chain,
      destChain: pair.destAsset.chain,
      sourceAsset: pair.sourceAsset.symbol,
      destAsset: pair.destAsset.symbol,
      sourceAmount: amount,
      userAddress: {
        [pair.sourceAsset.chain]: this.botAddress[pair.sourceAsset.chain],
        [pair.destAsset.chain]: this.botAddress[pair.destAsset.chain],
      },
    });

    const expectedProfit = this.calculateProfit(quotes[0], fees, price1, price2);

    if (expectedProfit > 0) {
      // Execute arbitrage
      await this.omniswap.executeSwap(quotes[0]);
    }
  }
}
```

**Benefits**:
- Automated trading
- Cross-chain arbitrage
- Real-time monitoring
- Profit optimization

---

## Integration Patterns

### Pattern 1: API-First Integration

Use OmniSwap API for quotes and solver matching, execute locally.

```typescript
const omniswap = new OmniSwap({
  environment: 'mainnet',
  apiKey: 'your-api-key',
});

// Get quotes from API
const quotes = await omniswap.getQuote(request);

// Execute via local adapters
const execution = await omniswap.executeSwap(quotes[0], signatures, {
  useLocalExecution: true,
});
```

### Pattern 2: Fully Local Execution

Execute everything locally without API.

```typescript
const omniswap = new OmniSwap({
  environment: 'local',
});

await omniswap.initialize(chainConfigs);

// Everything runs locally
const quotes = await omniswap.getQuote(request);
const execution = await omniswap.executeSwap(quotes[0], signatures);
```

### Pattern 3: Hybrid Mode

Use API for aggregation, local for sensitive operations.

```typescript
// Use API for quotes
const quotes = await omniswap.getQuote(request);

// Execute privacy swaps locally
const execution = await omniswap.executePrivateSwap(quotes[0], {
  useLocalExecution: true,
  hubConfig: customPrivacyConfig,
});
```

## Best Practices

### 1. Always Monitor Swap Status

```typescript
const unsubscribe = omniswap.subscribeToSwap(execution.swapId, (update) => {
  if (update.type === 'swap_failed') {
    handleFailure(update);
  } else if (update.type === 'swap_complete') {
    handleSuccess(update);
    unsubscribe();
  }
});
```

### 2. Implement Timeout and Retry Logic

```typescript
import { withRetry, RetryPresets } from 'omniswap-sdk';

const execution = await withRetry(
  () => omniswap.executeSwap(quote),
  RetryPresets.standard
);
```

### 3. Validate User Inputs

```typescript
function validateSwapRequest(request: SwapRequest) {
  if (request.sourceAmount <= 0) {
    throw new Error('Amount must be positive');
  }
  if (!request.deadline || request.deadline < Date.now()) {
    throw new Error('Invalid deadline');
  }
  // ... more validations
}
```

### 4. Handle Refunds Gracefully

```typescript
import { RefundManager } from 'omniswap-sdk';

const refundManager = new RefundManager(adapters, {
  autoStart: true,
  onRefundAttempt: (swapId, chain, success) => {
    notifyUser(`Refund ${success ? 'succeeded' : 'failed'} for ${swapId}`);
  },
});

refundManager.registerSwap(execution);
```

## Next Steps

- **Review [API Reference](./03-api-reference.md)** for detailed API documentation
- **Follow [How-To Guides](./04-how-to-guides.md)** for implementation tutorials
- **Check [Examples](../examples/)** for complete code samples
- **Read [FAQ](./05-faq.md)** for common questions
