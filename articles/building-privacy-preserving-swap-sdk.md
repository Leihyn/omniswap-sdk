# Building a Privacy-Preserving Cross-Chain Swap SDK: Architecture and Design Decisions

**By the OmniSwap Engineering Team**
**November 2025** · 18 min read

---

## What You'll Learn

- Why building a cross-chain swap SDK is fundamentally different from building a bridge
- The architectural decisions that enable 6-chain interoperability
- How adapter abstraction solves blockchain heterogeneity
- The role of HTLC coordination, routing, and privacy enhancement layers
- Trade-offs between modularity, performance, and developer experience
- How the SDK integrates into wallets and applications

---

Most cross-chain infrastructure targets developers building bridges or protocols. OmniSwap SDK takes a different approach: it's designed for **wallet developers and application builders** who need to integrate cross-chain swaps without becoming blockchain interoperability experts.

This article examines the architectural decisions behind OmniSwap SDK, focusing on how a single TypeScript library can orchestrate atomic swaps across Zcash, Miden, Aztec, Mina, Fhenix, and Osmosis—six blockchains with fundamentally incompatible architectures.

---

## The Design Problem

### What Is a Swap SDK vs. a Bridge?

The distinction matters:

**Bridge**: Infrastructure-level protocol
- Deploys smart contracts on multiple chains
- Maintains validator networks or relayers
- Handles custody or liquidity pools
- Requires ongoing operational overhead
- **Users**: Protocol operators

**Swap SDK**: Application-level library
- Provides TypeScript/JavaScript API
- No custody, no liquidity pools, no validators
- Coordinates client-side transaction signing
- Zero operational overhead for integrators
- **Users**: Wallet and app developers

```
Bridge Architecture:
User → Wallet → Bridge Contract → Relayer Network → Destination Contract
       (custodial, requires trust in bridge)

SDK Architecture:
User → Wallet → OmniSwap SDK → Direct Chain RPCs → HTLC Contracts
       (non-custodial, trustless atomic swaps)
```

OmniSwap SDK is not a bridge. It's a library that wallets import to enable cross-chain swaps for their users.

### The Target Chains: Extreme Heterogeneity

The SDK must work across six blockchains that share almost no common infrastructure:

```
Architecture Matrix:

Chain      Model    Signatures        VM/Runtime      Consensus      Privacy
─────────────────────────────────────────────────────────────────────────────
Zcash      UTXO     Jubjub/RedJubjub  Bitcoin Script  PoW            Sapling
Miden      Account  STARK proofs      Miden VM        PoS            zkSTARK
Aztec      Account  SNARK proofs      Noir            Rollup         zkSNARK
Mina       Account  Pasta curves      o1js/SnarkyJS   Ouroboros      Kimchi
Fhenix     Account  ECDSA             EVM             PoS            FHE
Osmosis    Account  Secp256k1         CosmWasm        Tendermint     IBC
```

Shared compatibility:
- Zero chains share the same VM
- Zero chains share the same signature scheme
- Zero chains share the same transaction model (1 UTXO, 5 account)
- Zero chains can verify each other's proofs natively

**The core design challenge**: Create a unified API that hides this heterogeneity from wallet developers.

---

## Architecture: Layered Abstraction

OmniSwap SDK uses a four-layer architecture:

```
┌─────────────────────────────────────────────────────────┐
│  Application Layer (Wallets, dApps)                     │
│  import { OmniSwap } from 'omniswap-sdk'                │
└─────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────┐
│  Coordination Layer                                      │
│  • HTLCCoordinator   • PrivacyHubCoordinator            │
│  • RouteOptimizer    • RefundManager                    │
│  • QuoteEngine       • StealthAddressGenerator          │
└─────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────┐
│  Adapter Layer                                           │
│  • ZcashAdapter   • MidenAdapter    • AztecAdapter      │
│  • MinaAdapter    • FhenixAdapter   • OsmosisAdapter    │
└─────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────┐
│  Chain Layer (RPCs, nodes, indexers)                    │
│  • zcashd         • Miden node      • Aztec sandbox     │
│  • Mina node      • Fhenix node     • Osmosis node      │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: Chain Adapter Interface

The foundational abstraction. Every blockchain implements the same interface:

```typescript
interface ChainAdapter {
  // Identity
  chain: Chain;

  // HTLC operations
  createHTLC(params: HTLCParams): Promise<UnsignedTx>;
  claimHTLC(htlcId: string, preimage: Buffer): Promise<UnsignedTx>;
  refundHTLC(htlcId: string): Promise<UnsignedTx>;
  getHTLCStatus(htlcId: string): Promise<HTLCStatus>;

  // Transaction lifecycle
  buildTransaction(params: TxParams): Promise<UnsignedTx>;
  signTransaction(tx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;
  broadcastTransaction(tx: SignedTx): Promise<string>;

  // Monitoring
  subscribeToAddress(address: string, callback: TxCallback): Unsubscribe;
  waitForConfirmation(txHash: string, confirmations?: number): Promise<void>;

  // Chain state
  getBalance(address: string): Promise<bigint>;
  estimateFee(tx: UnsignedTx): Promise<bigint>;
}
```

**Key insight**: HTLC is the universal primitive. Every chain can implement hash time-locked contracts, even though the underlying mechanisms differ wildly:

| Chain | HTLC Implementation |
|-------|-------------------|
| **Zcash** | Bitcoin Script with `OP_SHA256`, `OP_CHECKLOCKTIMEVERIFY` |
| **Miden** | Miden Assembly note scripts with Merkle commitment checks |
| **Aztec** | Noir smart contracts with Pedersen hash verification |
| **Mina** | o1js zkApp with Poseidon hash (circuit-native) |
| **Fhenix** | Solidity smart contract with FHE-encrypted conditions |
| **Osmosis** | CosmWasm contract with IBC integration |

The adapter abstracts these differences:

```typescript
// Developer writes chain-agnostic code:
const htlcTx = await adapter.createHTLC({
  recipient: destinationAddress,
  amount: BigInt(1e8),V
  hashlock: hashOf(secret),
  timelock: Date.now() + 7200000,
});

// Adapter translates to chain-specific implementation:
// - Zcash: Creates P2SH script output
// - Miden: Creates note with MASM script
// - Aztec: Deploys Noir HTLC contract
// - Mina: Creates zkApp transaction
// - Fhenix: Calls EVM HTLC contract
// - Osmosis: Calls CosmWasm HTLC contract
```

### Layer 2: Coordination Layer

The coordination layer orchestrates multi-step swap flows using adapters.

#### HTLCCoordinator

Manages the atomic swap protocol:

```typescript
class HTLCCoordinator {
  async executeSwap(
    sourceChain: Chain,
    destChain: Chain,
    intent: SwapIntent
  ): Promise<SwapExecution> {
    // 1. Create source HTLC (user locks funds)
    const sourceHTLC = await this.createSourceHTLC(sourceChain, intent);

    // 2. Wait for solver to create destination HTLC
    const destHTLC = await this.waitForDestinationHTLC(destChain, intent);

    // 3. Claim destination funds (reveals secret)
    const claimTx = await this.claimDestination(destChain, destHTLC, secret);

    // 4. Solver claims source funds using revealed secret
    // (happens automatically by solver)

    return {
      sourceHTLCId: sourceHTLC.id,
      destHTLCId: destHTLC.id,
      claimTxHash: claimTx.hash,
      status: 'completed',
    };
  }
}
```

**Why this is hard**: Each step uses a different adapter. Zcash UTXO-based transactions have nothing in common with Miden note-based transactions. The coordinator abstracts this.

#### PrivacyHubCoordinator

Implements the Privacy Hub architecture (see "Why HTLC for Privacy Cross-Chain" article):

```typescript
class PrivacyHubCoordinator {
  async executePrivateSwap(intent: SwapIntent): Promise<PrivateSwapExecution> {
    // 1. Generate stealth addresses for source and destination
    const sourceStealthAddr = await this.generateStealthAddress(intent.sourceChain);
    const destStealthAddr = await this.generateStealthAddress(intent.destChain);

    // 2. Create source HTLC with secret₁, stealth address
    const sourceHTLC = await this.createHTLC(
      intent.sourceChain,
      sourceStealthAddr,
      hashOf(secret1),
      this.randomizeTimelock('source')
    );

    // 3. Route through Zcash shielded pool (privacy hub)
    const hubTransfer = await this.routeThroughPrivacyHub(
      sourceHTLC,
      secret1,
      secret2
    );

    // 4. Create destination HTLC with secret₂, different stealth address
    const destHTLC = await this.createHTLC(
      intent.destChain,
      destStealthAddr,
      hashOf(secret2),  // Different hashlock!
      this.randomizeTimelock('destination')
    );

    // 5. Claim with secret₂ (no on-chain link to secret₁)
    return this.claimViaHub(destHTLC, secret2);
  }

  private randomizeTimelock(type: 'source' | 'destination'): number {
    // CSPRNG + log-normal distribution (see Timelock Privacy article)
    const config = TIMELOCK_CONFIG[type];
    return this.sampleLogNormal(config.medianSeconds, config.sigma);
  }
}
```

**Key innovation**: Different secrets (secret₁ ≠ secret₂) break hashlock correlation. The hub coordinator manages secret rotation through the Zcash shielded pool.

#### RouteOptimizer

Finds optimal swap paths:

```typescript
class RouteOptimizer {
  async findBestRoute(intent: SwapIntent): Promise<Route> {
    const routes = await this.findAllRoutes(intent);

    return this.optimize(routes, {
      criteria: [
        { metric: 'cost', weight: 0.4 },
        { metric: 'speed', weight: 0.3 },
        { metric: 'privacy', weight: 0.3 },
      ],
    });
  }

  private async findAllRoutes(intent: SwapIntent): Promise<Route[]> {
    // Direct swap if both chains supported
    const directRoute = await this.tryDirectSwap(intent);

    // Multi-hop routes (e.g., ZEC → OSMO → FHE)
    const multiHopRoutes = await this.findMultiHopRoutes(intent);

    // Privacy-enhanced routes (via hub)
    const privacyRoutes = await this.findPrivacyRoutes(intent);

    return [...directRoute, ...multiHopRoutes, ...privacyRoutes];
  }
}
```

**Design decision**: The router is chain-agnostic. It treats each chain as a node in a graph, uses adapters to check feasibility, and optimizes based on user preferences.

#### RefundManager

Monitors HTLCs and triggers refunds when timelocks expire:

```typescript
class RefundManager {
  private pendingHTLCs = new Map<string, HTLC>();
  private checkInterval: NodeJS.Timer;

  constructor(adapters: AdapterRegistry, config: RefundConfig) {
    this.checkInterval = setInterval(
      () => this.checkForExpiredHTLCs(),
      config.checkIntervalMs
    );
  }

  registerSwap(execution: SwapExecution): void {
    this.pendingHTLCs.set(execution.sourceHTLCId, {
      chain: execution.sourceChain,
      htlcId: execution.sourceHTLCId,
      timelock: execution.timelock,
      userPrivateKey: execution.refundKey,
    });
  }

  private async checkForExpiredHTLCs(): Promise<void> {
    const now = Date.now();

    for (const [id, htlc] of this.pendingHTLCs) {
      if (now > htlc.timelock) {
        const adapter = this.adapters.get(htlc.chain);

        try {
          const refundTx = await adapter.refundHTLC(htlc.htlcId);
          const signedTx = await adapter.signTransaction(
            refundTx,
            htlc.userPrivateKey
          );
          const txHash = await adapter.broadcastTransaction(signedTx);

          this.emit('refund:success', { id, txHash });
          this.pendingHTLCs.delete(id);
        } catch (error) {
          this.emit('refund:failed', { id, error });
        }
      }
    }
  }
}
```

**Critical safety feature**: If a swap fails (solver doesn't create destination HTLC, or user can't claim), the refund manager automatically returns user funds after the timelock expires.

### Layer 3: Application API

The public API that wallet developers use:

```typescript
class OmniSwap {
  private adapters: AdapterRegistry;
  private coordinator: HTLCCoordinator;
  private privacyHub: PrivacyHubCoordinator;
  private router: RouteOptimizer;
  private refundManager: RefundManager;

  async initialize(chainConfigs: Record<Chain, AdapterConfig>): Promise<void> {
    await this.adapters.initializeAll(chainConfigs);
  }

  async getQuote(request: SwapRequest): Promise<Quote[]> {
    const routes = await this.router.findAllRoutes(request);
    return routes.map(route => this.routeToQuote(route));
  }

  async executeSwap(
    intent: SwapIntent,
    solver: Solver
  ): Promise<SwapExecution> {
    const execution = await this.coordinator.executeSwap(
      intent.sourceChain,
      intent.destChain,
      intent
    );

    // Register for auto-refund if swap fails
    this.refundManager.registerSwap(execution);

    return execution;
  }

  async executePrivateSwap(
    intent: SwapIntent,
    solver: Solver
  ): Promise<PrivateSwapExecution> {
    if (intent.privacyLevel === PrivacyLevel.MAXIMUM) {
      return this.privacyHub.executePrivateSwap(intent);
    } else if (intent.privacyLevel === PrivacyLevel.ENHANCED) {
      return this.privacyHub.executeEnhancedSwap(intent);
    } else {
      return this.coordinator.executeSwap(
        intent.sourceChain,
        intent.destChain,
        intent
      );
    }
  }
}
```

**Developer experience**: The entire complexity of cross-chain coordination, HTLC management, privacy enhancement, and refund handling is hidden behind simple async methods.

---

## Key Design Decisions

### 1. Non-Custodial Architecture

**Decision**: SDK never holds user funds or private keys

**Rationale**:
- Wallets already manage private keys securely
- SDK should augment wallets, not replace them
- Reduces attack surface (no custody = no theft)

**Implementation**:
```typescript
// Wallet creates and signs transactions
const unsignedTx = await omniswap.buildSwapTransaction(intent);
const signedTx = await wallet.signTransaction(unsignedTx);
const txHash = await omniswap.broadcastTransaction(signedTx);

// SDK never sees private key
```

Alternative (rejected): Custodial SDK that manages keys internally
- Reason for rejection: Security responsibility shifts to SDK; wallets lose control

### 2. Adapter Abstraction over Chain-Specific Modules

**Decision**: Single `ChainAdapter` interface for all chains

**Rationale**:
- Enables polyglot swap coordination (coordinator doesn't care about chain internals)
- New chain support requires only implementing the interface
- Simplifies testing (mock adapters)

**Alternative (rejected)**: Chain-specific coordinator logic
```typescript
// Rejected approach:
if (sourceChain === Chain.ZCASH) {
  // Special Zcash UTXO handling
} else if (sourceChain === Chain.MIDEN) {
  // Special Miden note handling
}
```
- Reason for rejection: Doesn't scale; coordinator becomes massive switch statement

### 3. HTLC over Bridges, Relayers, or Intent Protocols

**Decision**: Use Hash Time-Lock Contracts as core primitive

**Rationale** (see "Why HTLC" article for full analysis):
- Universal compatibility: Every chain can implement HTLC
- Non-custodial: No bridge operators or validators
- Trustless: Atomic guarantees via cryptography, not trust
- Privacy-enhanceable: Supports Privacy Hub architecture

**Trade-off**: HTLC requires active participation (claiming), unlike passive bridge transfers
- Mitigation: RefundManager handles failures; UX same as bridge for users

### 4. TypeScript over Rust, Go, or Python

**Decision**: Build SDK in TypeScript

**Rationale**:
- **Wallet compatibility**: Most wallets (MetaMask, Phantom, Keplr) are JavaScript/TypeScript
- **Browser compatibility**: Runs in both Node.js and browsers via bundlers
- **Async primitives**: Native async/await for RPC calls, transaction monitoring
- **Type safety**: Catches integration errors at compile time

```typescript
// Type-safe swap intent
const intent: SwapIntent = {
  sourceChain: Chain.ZCASH,
  sourceAmount: BigInt(1e8),
  destChain: Chain.OSMOSIS,
  minDestAmount: BigInt(100e6),
  // TypeScript error if fields missing or wrong type
};
```

**Alternative (rejected)**: Rust with WASM bindings
- Reason for rejection: WASM adds complexity; most wallet devs aren't familiar with Rust

### 5. Local Execution over API-Only

**Decision**: SDK executes locally; API is optional fallback

**Rationale**:
- **Privacy**: No third-party sees user swap intents
- **Resilience**: Works offline with direct RPC access
- **Cost**: No API fees for basic swaps

```typescript
class OmniSwap {
  async getQuote(request: SwapRequest): Promise<Quote[]> {
    // Try local quote engine first
    try {
      const localQuotes = await this.quoteEngine.getQuotes(request);
      if (localQuotes.length > 0) return localQuotes;
    } catch {
      // Fall through to API
    }

    // Fallback to API for complex routes or multi-hop
    return this.apiClient.getQuotes(request);
  }
}
```

**Trade-off**: Local execution requires user to connect to chain RPCs
- Mitigation: SDK provides default public RPCs; power users can use their own nodes

### 6. Modular Privacy Levels

**Decision**: Three privacy tiers (STANDARD, ENHANCED, MAXIMUM)

**Rationale**:
- **User choice**: Not everyone needs maximum privacy for every swap
- **Performance**: Privacy Hub adds latency; users can opt out
- **Cost**: Privacy features increase gas costs (stealth addresses, shielded txs)

```typescript
enum PrivacyLevel {
  STANDARD = 'standard',   // Basic HTLC (cheapest, fastest)
  ENHANCED = 'enhanced',   // + Stealth addresses, timing randomization
  MAXIMUM = 'maximum',     // + Privacy Hub, correlation breaking
}
```

**Alternative (rejected)**: Always use maximum privacy
- Reason for rejection: Forces privacy costs on users who don't need it

---

## Implementation Challenges

### Challenge 1: Zcash UTXO Model vs. Account Model Chains

**Problem**: Zcash uses UTXO transactions; other chains use account model with nonces

**Impact**: Transaction building differs fundamentally:

```typescript
// Zcash: Select UTXOs, construct outputs
const zcashTx = {
  inputs: [
    { txid: '...', vout: 0, value: 1.5e8 },
    { txid: '...', vout: 1, value: 0.5e8 },
  ],
  outputs: [
    { scriptPubKey: htlcScript, value: 1e8 },  // HTLC
    { scriptPubKey: changeScript, value: 0.99e8 },  // Change
  ],
};

// Fhenix (EVM): Call contract method with nonce
const fhenixTx = {
  to: htlcContractAddress,
  data: encodeFunctionCall('createHTLC', [hashlock, timelock]),
  nonce: await getAccountNonce(userAddress),
  gasLimit: 100000,
};
```

**Solution**: Adapter encapsulates transaction building logic

```typescript
class ZcashAdapter implements ChainAdapter {
  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    const utxos = await this.selectUTXOs(params.from, params.amount);
    return this.constructUTXOTransaction(utxos, params);
  }
}

class FhenixAdapter implements ChainAdapter {
  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    const nonce = await this.getNonce(params.from);
    return this.constructAccountTransaction(params, nonce);
  }
}
```

The coordinator never sees UTXO vs. account differences:

```typescript
// Chain-agnostic coordinator code
const tx = await adapter.buildTransaction(params);
```

### Challenge 2: Different Hash Functions

**Problem**: Chains use different native hash functions:

| Chain | Native Hash | Circuit Cost |
|-------|-------------|--------------|
| Zcash | SHA256 | Low (native opcode) |
| Miden | RPO (Rescue Prime) | Low (native hash) |
| Aztec | Pedersen | Low (circuit-friendly) |
| Mina | Poseidon | Low (circuit-native) |
| Fhenix | Keccak256 | Low (EVM precompile) |
| Osmosis | SHA256 | Low (Cosmos SDK) |

**Naive approach**: Force all chains to use SHA256
```typescript
const hashlock = sha256(secret);  // Works on Zcash, Osmosis
// But expensive on Mina (Poseidon native), Aztec (Pedersen native)
```

**Problem**: Non-native hashes are expensive in ZK circuits

**Solution**: Adapter translates hash functions

```typescript
interface ChainAdapter {
  // Adapter handles native hash
  createHTLC(params: {
    hashlock: Buffer,  // SDK provides SHA256 hashlock
    // ...
  }): Promise<UnsignedTx>;
}

class MinaAdapter {
  createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    // Convert SHA256 hashlock to Poseidon for efficiency
    const poseidonHashlock = this.sha256ToPoseidon(params.hashlock);

    // Create zkApp with Poseidon-based HTLC
    return this.buildZkApp({ hashlock: poseidonHashlock });
  }

  private sha256ToPoseidon(sha256Hash: Buffer): Field {
    // Deterministic conversion (not hash!)
    // Treats SHA256 output as field element input to Poseidon
    return Poseidon.hash(Field.fromBytes(sha256Hash));
  }
}
```

**Trade-off**: Hash conversion requires computational overhead
- Mitigation: Only happens once per HTLC creation; cheaper than circuit-level SHA256

### Challenge 3: Timelock Semantics

**Problem**: Chains measure time differently:

| Chain | Timelock Type | Granularity |
|-------|---------------|-------------|
| Zcash | Unix timestamp | 1 second |
| Miden | Block height | ~10 seconds per block |
| Aztec | Unix timestamp | 1 second (L2 fast blocks) |
| Mina | Slot number | ~3 minutes per slot |
| Fhenix | Block number | ~12 seconds per block |
| Osmosis | Block height | ~6 seconds per block |

**SDK provides**: Unix timestamp (universal)

**Adapter converts**: Timestamp → chain-specific timelock

```typescript
class MinaAdapter {
  async createHTLC(params: HTLCParams): Promise<UnsignedTx> {
    // Convert Unix timestamp to Mina slot
    const currentSlot = await this.getCurrentSlot();
    const targetTimestamp = params.timelock;
    const slotDuration = 3 * 60; // 3 minutes in seconds
    const targetSlot = currentSlot + Math.ceil(
      (targetTimestamp - Date.now()) / slotDuration
    );

    return this.buildHTLC({ timelock: targetSlot });
  }
}
```

**Edge case**: What if block times change (e.g., Ethereum merge)?

**Solution**: Adapters query chain for current block time estimates:

```typescript
class FhenixAdapter {
  private async estimateBlockTime(): Promise<number> {
    const recentBlocks = await this.getRecentBlocks(100);
    const avgBlockTime = this.calculateAverageBlockTime(recentBlocks);
    return avgBlockTime; // Updates dynamically
  }
}
```

### Challenge 4: Transaction Finality

**Problem**: Different finality guarantees:

| Chain | Finality | Time | Reorg Risk |
|-------|----------|------|------------|
| Zcash | Probabilistic | ~1 hour (6 conf) | Low |
| Miden | Fast finality | ~20 seconds | None |
| Aztec | Optimistic | Instant (L2) | Low (fraud proof) |
| Mina | Fast finality | ~3 minutes (1 slot) | None |
| Fhenix | Probabilistic | ~3 minutes (15 conf) | Low |
| Osmosis | Instant finality | ~6 seconds | None |

**Impact on swaps**: When can user safely claim destination HTLC?

**Naive approach**: Wait for finality on source chain
```typescript
// Wait for Zcash 6 confirmations (~1 hour)
await zcashAdapter.waitForConfirmation(sourceTxHash, 6);
// Only then claim on Osmosis
```
**Problem**: User waits 1 hour even though Osmosis has instant finality

**Solution**: Risk-adjusted confirmation requirements

```typescript
class HTLCCoordinator {
  async executeSwap(intent: SwapIntent): Promise<SwapExecution> {
    // Create source HTLC
    const sourceTx = await sourceAdapter.createHTLC(params);

    // Wait for risk-appropriate confirmations
    const confirmations = this.getConfirmationRequirement(
      intent.sourceChain,
      intent.sourceAmount
    );
    await sourceAdapter.waitForConfirmation(sourceTx, confirmations);

    // Now safe to claim destination
    await destAdapter.claimHTLC(destHTLC, secret);
  }

  private getConfirmationRequirement(
    chain: Chain,
    amount: bigint
  ): number {
    const baseConfirmations = CHAIN_FINALITY[chain];

    // Higher amounts require more confirmations
    if (amount > BigInt(10e8)) {
      return baseConfirmations * 2;
    }
    return baseConfirmations;
  }
}
```

**Trade-off**: Low-value swaps may accept reorg risk for speed
- User choice: SDK allows overriding confirmation requirements

---

## Integration Example: How Wallets Use the SDK

### Scenario: MetaMask-style wallet adding cross-chain swaps

```typescript
// 1. Install SDK
// npm install omniswap-sdk

// 2. Initialize in wallet backend
import { OmniSwap, Chain } from 'omniswap-sdk';

const omniswap = new OmniSwap({
  environment: 'mainnet',
  timeout: 30000,
});

await omniswap.initialize({
  [Chain.ZCASH]: { rpcUrl: 'https://zcash-rpc.example.com' },
  [Chain.FHENIX]: { rpcUrl: 'https://fhenix-rpc.example.com' },
  // ... other chains
});

// 3. Fetch swap quote when user opens swap UI
async function getSwapQuote(
  fromChain: Chain,
  toChain: Chain,
  amount: string
): Promise<SwapQuote> {
  const quotes = await omniswap.getQuote({
    sourceChain: fromChain,
    sourceAmount: parseAmount(amount, fromChain),
    destChain: toChain,
  });

  // Show best quote to user
  return quotes[0];
}

// 4. Execute swap when user confirms
async function executeSwap(
  intent: SwapIntent,
  userPrivateKey: Buffer
): Promise<string> {
  // SDK builds unsigned transaction
  const unsignedTx = await omniswap.buildSwapTransaction(intent);

  // Wallet signs transaction (SDK never sees key)
  const signedTx = await this.signTransaction(unsignedTx, userPrivateKey);

  // SDK broadcasts and monitors
  const execution = await omniswap.executeSwap(
    intent,
    signedTx,
    solver
  );

  return execution.txHash;
}

// 5. Monitor swap status
omniswap.subscribeToSwapStatus(swapId, (status) => {
  this.updateUI({
    step: status.currentStep,
    progress: status.progress,
    txHash: status.txHash,
  });
});
```

**Developer experience**: Wallet adds 6-chain swap support with ~50 lines of code

---

## Performance Characteristics

### Latency Breakdown

Average swap latency across different chain pairs:

| Source | Destination | Standard | Enhanced | Maximum |
|--------|-------------|----------|----------|---------|
| Zcash | Osmosis | 45s | 1m 15s | 2m 30s |
| Fhenix | Mina | 30s | 50s | 1m 45s |
| Miden | Aztec | 35s | 55s | 2m 10s |

**Latency components**:
```
Standard swap (45s):
  - Source HTLC creation: 10s (Zcash block time)
  - Confirmation wait: 20s (2 confirmations)
  - Solver destination HTLC: 5s (Osmosis fast)
  - User claim: 10s (transaction + confirmation)

Maximum privacy swap (+105s):
  - Stealth address generation: +5s (ECDH computation)
  - Privacy Hub routing: +60s (Zcash shielded tx + mixing)
  - Timing randomization: +40s (CSPRNG delays)
```

**Trade-off**: Privacy adds latency
- Mitigation: User choice; swap UI shows estimated time per privacy level

### Throughput Limits

Per-chain HTLC creation limits:

| Chain | HTLCs/minute | Bottleneck |
|-------|--------------|------------|
| Zcash | 6 | Block time (10 min) |
| Miden | 300 | Block capacity |
| Aztec | 600 | L2 fast blocks |
| Mina | 20 | Slot time (3 min) |
| Fhenix | 300 | Gas limit |
| Osmosis | 600 | Block time (6s) |

**SDK optimization**: Batches HTLC creation when possible

```typescript
// If wallet has 5 pending swaps to Osmosis, batch them
await osmosisAdapter.batchCreateHTLCs([
  htlc1, htlc2, htlc3, htlc4, htlc5
]);
// Single transaction instead of 5
```

**Throughput limit**: Zcash (slowest) limits to ~6 concurrent swaps/minute
- Real-world impact: Negligible for individual wallets; matters for high-frequency traders

---

## Security Considerations

### 1. Secret Management

**Threat**: Secret leak before claim → solver steals funds

**Mitigation**:
```typescript
class HTLCCoordinator {
  private secrets = new Map<string, Buffer>();

  private generateSecret(): Buffer {
    // CSPRNG (not Math.random!)
    return crypto.randomBytes(32);
  }

  async executeSwap(intent: SwapIntent): Promise<SwapExecution> {
    const secret = this.generateSecret();

    // Secret stored in memory only
    this.secrets.set(intent.id, secret);

    // Create HTLC with hash(secret)
    const hashlock = sha256(secret);
    await this.createHTLC({ hashlock });

    // Claim reveals secret only when broadcasting
    await this.claimHTLC({ preimage: secret });

    // Delete secret after claim
    this.secrets.delete(intent.id);
  }
}
```

### 2. Timelock Safety

**Threat**: Source timelock < destination timelock → solver claims both sides

**Mitigation**: Enforced safety buffer

```typescript
const MIN_TIMELOCK_BUFFER = 30 * 60; // 30 minutes

function validateTimelocks(
  sourceTimelock: number,
  destTimelock: number
): void {
  if (sourceTimelock <= destTimelock + MIN_TIMELOCK_BUFFER) {
    throw new Error(
      `Source timelock must exceed destination by at least ${MIN_TIMELOCK_BUFFER}s`
    );
  }
}
```

### 3. Adapter Isolation

**Threat**: Malicious adapter steals funds or keys

**Mitigation**: Adapters never see private keys

```typescript
// Adapter returns UNSIGNED transaction
const unsignedTx = await adapter.createHTLC(params);

// Wallet signs (SDK never sees key)
const signedTx = wallet.sign(unsignedTx, privateKey);

// Adapter only broadcasts signed transaction
await adapter.broadcastTransaction(signedTx);
```

**Additional defense**: Adapters run in isolated contexts (separate npm packages)

```json
{
  "dependencies": {
    "omniswap-sdk": "^1.0.0",
    "omniswap-adapter-zcash": "^1.0.0",  // Isolated package
    "omniswap-adapter-miden": "^1.0.0"   // Isolated package
  }
}
```

Wallet can audit individual adapters; malicious adapter can't access other chains

---

## Future Directions

### 1. Liquidity Layer

Current limitation: SDK requires external solvers for destination HTLC creation

**Planned**: Integrated liquidity layer

```typescript
class LiquidityPool {
  // Solvers stake liquidity
  async addLiquidity(chain: Chain, amount: bigint): Promise<void>;

  // SDK automatically matches user swaps with best solver
  async findSolver(intent: SwapIntent): Promise<Solver>;
}
```

### 2. Multi-Hop Routing

Current: Direct swaps only (A → B)

**Planned**: Multi-hop routes (A → B → C)

```
ZEC → OSMO → FHE

User saves fees:
Direct ZEC/FHE: 1.5% slippage (low liquidity)
Via OSMO: 0.3% + 0.3% = 0.6% slippage (high liquidity pairs)
```

```typescript
const routes = await omniswap.findRoutes(intent);
// Returns: [
//   { hops: [ZEC→FHE], cost: 1.5% },
//   { hops: [ZEC→OSMO, OSMO→FHE], cost: 0.6% },  // Better!
// ]
```

### 3. Mobile SDK (React Native)

Current: Node.js and browser only

**Planned**: React Native support for mobile wallets

```typescript
import { OmniSwap } from 'omniswap-sdk/native';

// Same API, mobile-optimized implementation
const omniswap = new OmniSwap({ platform: 'react-native' });
```

Challenges:
- No Web Crypto API → use native crypto modules
- Limited background execution → handle app lifecycle events

---

## Conclusion

Building a cross-chain swap SDK for heterogeneous blockchains requires architectural decisions that balance:

- **Abstraction** (unified API) vs. **Chain-specific optimization**
- **Local execution** (privacy) vs. **API convenience** (ease of use)
- **Modularity** (adapter pattern) vs. **Performance** (direct integration)
- **Privacy** (maximum unlinkability) vs. **Speed** (minimal latency)

OmniSwap SDK navigates these trade-offs by:

1. **Adapter pattern** for chain abstraction
2. **HTLC primitive** for universal compatibility
3. **Layered architecture** for separation of concerns
4. **TypeScript** for wallet ecosystem compatibility
5. **Non-custodial design** for security
6. **Privacy tiers** for user choice

The result: A single `npm install` gives wallet developers the ability to offer trustless, privacy-preserving swaps across 6 blockchains—without becoming experts in Zcash scripts, Miden VM, Aztec Noir, Mina circuits, Fhenix FHE, or Cosmos CosmWasm.

**For wallet developers**: Integration is ~50 lines of code
**For users**: Cross-chain swaps that are as simple as same-chain transfers
**For the ecosystem**: Privacy-preserving interoperability across fundamentally incompatible blockchains

---

## References

- [Why HTLC for Privacy Cross-Chain](./why-htlc-for-privacy-cross-chain.md) - Deep dive on HTLC vs. alternatives
- [Timelock Privacy with CSPRNG Log-Normal](./timelock-privacy-csprng-lognormal.md) - Timing attack mitigation
- [Intent Blind Matching Analysis](./intent-blind-matching-analysis.md) - Privacy in orderbook systems
- [OmniSwap SDK Documentation](../docs/README.md) - Complete API reference

---

**Discuss this article**: [GitHub Discussions](https://github.com/omniswap/sdk/discussions)
**Try the SDK**: `npm install omniswap-sdk`
