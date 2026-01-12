# OmniSwap SDK

A cross-chain privacy swap SDK enabling atomic swaps across 6 heterogeneous blockchains with unlinkable, untraceable transactions.

## Features

- Cross-chain atomic swaps using HTLC (Hash Time-Lock Contracts)
- Privacy Hub architecture for correlation-resistant swaps
- Stealth addresses for transaction unlinkability
- CSPRNG + Log-Normal distributed timelocks to prevent timing analysis
- Support for 6 privacy-focused blockchains
- Robust error handling with retry logic
- Automated refund management
- Can be integrated into ANY wallet or application

## Supported Blockchains

| Chain | Technology | Native Currency | Privacy Features |
|-------|------------|-----------------|------------------|
| Zcash | Sapling zkSNARKs | ZEC | Shielded transactions |
| Osmosis | Cosmos/IBC | OSMO | IBC transfers |
| Fhenix | FHE (Homomorphic) | FHE | Encrypted computation |
| Aztec | zkSNARKs/Noir | ETH | Private L2 |
| Miden | zkSTARKs | MIDEN | Note-based privacy |
| Mina | Kimchi/o1js | MINA | zkApp proofs |

## Documentation

For comprehensive documentation, visit our [documentation site](./docs/README.md) or explore the sections below:

- **[SDK Introduction](./docs/01-introduction.md)** - Overview and getting started
- **[Use Cases](./docs/02-use-cases.md)** - Real-world examples and applications
- **[API Reference](./docs/03-api-reference.md)** - Complete API documentation
- **[How-To Guides](./docs/04-how-to-guides.md)** - Step-by-step tutorials
- **[FAQ & Troubleshooting](./docs/05-faq.md)** - Common questions and solutions
- **[Examples](./examples/)** - Code examples for various use cases

## Installation

```bash
npm install omniswap-sdk
```

Requirements:
- Node.js >= 18.0.0
- TypeScript >= 5.0.0 (for TypeScript projects)

## Quick Start

```typescript
import { OmniSwap, Chain, PrivacyLevel } from 'omniswap-sdk';

// Initialize SDK
const omniswap = new OmniSwap();
await omniswap.initialize({
  [Chain.ZCASH]: { rpcUrl: 'http://localhost:8232' },
  [Chain.OSMOSIS]: { rpcUrl: 'http://localhost:26657' },
});

// Create swap intent
const intent = {
  id: 'swap_123',
  user: {
    id: 'user_1',
    addresses: {
      [Chain.ZCASH]: 't1YourZcashAddress',
      [Chain.OSMOSIS]: 'osmo1YourOsmosisAddress',
    },
  },
  sourceChain: Chain.ZCASH,
  sourceAsset: { symbol: 'ZEC', decimals: 8, chain: Chain.ZCASH },
  sourceAmount: BigInt(1e8), // 1 ZEC
  destChain: Chain.OSMOSIS,
  destAsset: { symbol: 'OSMO', decimals: 6, chain: Chain.OSMOSIS },
  minDestAmount: BigInt(100e6), // 100 OSMO
  maxSlippage: 0.01,
  deadline: Date.now() + 3600000,
  privacyLevel: PrivacyLevel.MAXIMUM,
};

// Find routes
const routes = await omniswap.findRoutes(intent);

// Execute privacy-enhanced swap
const execution = await omniswap.executePrivateSwap(intent, solver);
```

## Architecture

### Privacy Hub + HTLC

OmniSwap uses a novel Privacy Hub architecture that breaks on-chain correlation between source and destination transactions:

```
User (Chain A) ──HTLC₁──> Privacy Hub (Zcash Shielded) ──HTLC₂──> Solver (Chain B)
      │                         ▲                                      │
      │                         │ Different secrets                    │
      └─────────────────────────┴──────────────────────────────────────┘
                          No on-chain link!
```

Key privacy innovations:

1. **Different Hashlocks**: Source and destination use independent secrets, breaking hashlock correlation
2. **Stealth Addresses**: One-time addresses generated for each swap
3. **Timing Decorrelation**: CSPRNG + Log-Normal distributed delays prevent timing analysis
4. **Shielded Mixing**: Funds pass through Zcash Sapling pool for unlinkability

### HTLC Flow

1. User locks funds on source chain with HTLC₁ (secret₁)
2. Solver observes lock, creates HTLC₂ on destination (secret₂)
3. User claims destination funds (reveals secret₂)
4. Solver claims source funds (secret₁ revealed via privacy hub)
5. No on-chain link between HTLC₁ and HTLC₂

## API Reference

### OmniSwap

Main SDK entry point.

```typescript
class OmniSwap {
  // Initialize with chain configurations
  initialize(config: Record<Chain, AdapterConfig>): Promise<void>;

  // Find optimal swap routes
  findRoutes(intent: SwapIntent): Promise<Route[]>;

  // Find privacy-optimized route
  findPrivateRoute(intent: SwapIntent): Promise<Route>;

  // Execute standard swap
  executeSwap(intent: SwapIntent, solver: Solver): Promise<SwapExecution>;

  // Execute privacy-enhanced swap
  executePrivateSwap(intent: SwapIntent, solver: Solver): Promise<PrivateSwapExecution>;

  // Generate stealth address
  generateStealthAddress(chain: Chain, baseAddress: string): Promise<StealthAddress>;
}
```

### Privacy Levels

```typescript
enum PrivacyLevel {
  STANDARD = 'standard',     // Basic HTLC swap
  ENHANCED = 'enhanced',     // Stealth addresses + timing delays
  MAXIMUM = 'maximum',       // Full privacy hub with correlation breaking
}
```

### Chain Adapters

Each supported chain has a dedicated adapter implementing the `ChainAdapter` interface:

```typescript
interface ChainAdapter {
  // HTLC operations
  createHTLC(params: HTLCParams): Promise<UnsignedTx>;
  claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx>;
  refundHTLC(htlcId: string): Promise<UnsignedTx>;
  getHTLCStatus(htlcId: string): Promise<HTLCStatus>;

  // Transaction operations
  buildTransaction(params: TxParams): Promise<UnsignedTx>;
  signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;
  broadcastTransaction(tx: SignedTx): Promise<string>;

  // Monitoring
  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe;
  waitForConfirmation(txHash: string, confirmations?: number): Promise<void>;
}
```

## Timelock Configuration

Timelocks use CSPRNG + Log-Normal distribution to prevent timing correlation:

| Parameter | Source HTLC | Destination HTLC |
|-----------|-------------|------------------|
| Minimum | 30 minutes | 15 minutes |
| Median | 1.5 hours | 45 minutes |
| Maximum | 4 hours | 90 minutes |
| Sigma (σ) | 0.45 | 0.35 |

```typescript
import { TIMELOCK_CONFIG } from 'omniswap-sdk';

// Access configuration
console.log(TIMELOCK_CONFIG.source.medianSeconds); // 5400
console.log(TIMELOCK_CONFIG.destination.minSeconds); // 900
```

## Error Handling

The SDK provides typed errors with recovery suggestions:

```typescript
import {
  OmniSwapError,
  ErrorCode,
  isRetryableError,
  withRetry,
  RetryPresets
} from 'omniswap-sdk';

try {
  await omniswap.executeSwap(intent, solver);
} catch (error) {
  if (error instanceof OmniSwapError) {
    console.log('Error code:', error.code);
    console.log('Suggestion:', error.suggestion);

    if (error.retryable) {
      // Retry with exponential backoff
      await withRetry(
        () => omniswap.executeSwap(intent, solver),
        RetryPresets.standard
      );
    }
  }
}
```

### Error Categories

- **1xxx**: Adapter errors (initialization, connection)
- **2xxx**: Transaction errors (build, sign, broadcast)
- **3xxx**: HTLC errors (create, claim, refund)
- **4xxx**: Swap errors (execution, routing)
- **5xxx**: Solver errors
- **6xxx**: Privacy errors
- **9xxx**: Network errors

## Automated Refunds

The `RefundManager` monitors HTLCs and automatically triggers refunds when timelocks expire:

```typescript
import { RefundManager } from 'omniswap-sdk';

const refundManager = new RefundManager(adapters, {
  checkIntervalMs: 60000,
  autoStart: true,
  onRefundAttempt: (swapId, chain, success) => {
    console.log(`Refund ${success ? 'succeeded' : 'failed'} for ${swapId}`);
  },
});

// Register swap for monitoring
refundManager.registerSwap(execution);

// Force immediate refund
await refundManager.forceRefund(htlcId);

// Get statistics
const stats = refundManager.getStats();
console.log(`Pending: ${stats.pending}, Success rate: ${stats.successRate}`);
```

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/unit/privacy-hub.test.ts
```

## Security Considerations

1. **Secret Management**: Never expose HTLC secrets. They should only be revealed to claim funds.

2. **Timelock Safety**: Source timelock must always exceed destination timelock plus buffer (30 min minimum).

3. **Address Reuse**: Always use stealth addresses for privacy-enhanced swaps.

4. **Private Keys**: The SDK accepts private keys as Buffer. Never store or transmit in plaintext.

5. **RPC Security**: Use authenticated RPC endpoints in production.

## Chain-Specific Notes

### Zcash
- Supports both transparent (t-addr) and shielded (z-addr) transactions
- Shielded pool used for privacy hub mixing
- Requires zcashd node with wallet enabled

### Aztec
- Uses Noir smart contracts for HTLC
- Transactions are private by default on L2
- Requires PXE (Private Execution Environment)

### Miden
- Uses Miden Assembly note scripts
- STARK proofs for transaction validity
- Block height-based timelocks

### Mina
- Uses o1js zkApp for HTLC
- Poseidon hash for hashlock (native to circuits)
- Slot-based timelocks (~3 min blocks)

### Fhenix
- Fully Homomorphic Encryption (FHE) for private computation
- EVM-compatible with encrypted state
- Supports encrypted HTLC conditions

### Osmosis
- Cosmos SDK chain with IBC support
- CosmWasm for HTLC contracts
- Fast finality (~6 second blocks)

## Project Structure

```
omniswap-sdk/
├── src/
│   ├── adapters/          # Chain-specific adapters
│   │   ├── aztec.ts
│   │   ├── fhenix.ts
│   │   ├── miden.ts
│   │   ├── mina.ts
│   │   ├── osmosis.ts
│   │   └── zcash.ts
│   ├── core/              # Core logic
│   │   ├── htlc-coordinator.ts
│   │   ├── privacy-hub.ts
│   │   ├── refund-manager.ts
│   │   └── router.ts
│   ├── utils/             # Utilities
│   │   ├── errors.ts
│   │   └── retry.ts
│   ├── types/             # TypeScript types
│   └── omniswap.ts        # Main entry point
├── tests/
│   ├── unit/
│   └── integration/
└── articles/              # Technical documentation
```

## Related Articles

- [Why HTLC for Privacy Cross-Chain](./articles/why-htlc-for-privacy-cross-chain.md)
- [Intent Blind Matching Analysis](./articles/intent-blind-matching-analysis.md)
- [Timelock Privacy with CSPRNG Log-Normal](./articles/timelock-privacy-csprng-lognormal.md)

## Contributing

Contributions are welcome. Please ensure:
- All tests pass (`npm test`)
- New features include tests
- Code follows existing patterns
- Privacy implications are considered

## License

MIT
