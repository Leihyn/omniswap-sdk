# Why HTLC is the Right Mechanism for Privacy-Focused Cross-Chain Swaps

**By the OmniSwap Engineering Team**
**November 2025** · 20 min read

---

## What You'll Learn

- Why cross-chain interoperability between privacy chains is architecturally difficult
- How chain heterogeneity eliminates most bridging solutions
- Why Hash Time-Lock Contracts provide universal compatibility
- The specific HTLC implementation in OmniSwap SDK
- Trade-offs and limitations of the HTLC approach
- **NEW**: How the Privacy Hub architecture solves HTLC's correlation problem
- **NEW**: Achieving true unlinkability with different hashlocks per swap leg

---

A fundamental challenge in cross-chain infrastructure: how do you build a single protocol that works across blockchains with fundamentally incompatible architectures?

The common approach points to bridges, relayers, or intent-based systems. But when the target chains include Zcash, Miden, Aztec, Mina, Fhenix, and Osmosis—each with different transaction models, signature schemes, and virtual machines—these solutions fail at the architectural level.

This article examines why Hash Time-Lock Contracts (HTLC) are the correct mechanism for OmniSwap SDK's cross-chain swap infrastructure.

---

## The Problem: Extreme Chain Heterogeneity

### OmniSwap's Target Chains

The SDK targets six blockchains, each designed for privacy or confidential computation:

```
Chain        Model     Signatures        VM/Runtime      Ecosystem
─────────────────────────────────────────────────────────────────────
Zcash        UTXO      Jubjub/RedJubjub  Bitcoin Script  Bitcoin-like
Miden        Account   STARK proofs      Miden VM        Polygon
Aztec        Account   SNARK proofs      Noir            Ethereum L2
Mina         Account   Pasta curves      o1js/SnarkyJS   Standalone
Fhenix       Account   ECDSA             EVM             Ethereum L2
Osmosis      Account   Secp256k1         CosmWasm        Cosmos/IBC
```

This heterogeneity is not incidental—it's fundamental to how each chain achieves privacy or confidential computation.

### Why This Matters

Cross-chain protocols typically assume some commonality:

**Shared execution environment**: Bridges like Wormhole assume EVM compatibility
**Common signature scheme**: Adaptor signatures require Schnorr-compatible curves
**Unified ecosystem**: IBC requires Tendermint consensus
**Account model consistency**: Intent protocols assume nonce-based transactions

OmniSwap's target chains share none of these properties:

```
Compatibility Matrix:

                    Zcash   Miden   Aztec   Mina    Fhenix  Osmosis
EVM Compatible      ✗       ✗       ✗       ✗       ✓       ✗
IBC Compatible      ✗       ✗       ✗       ✗       ✗       ✓
UTXO Model          ✓       ✗       ✗       ✗       ✗       ✗
Schnorr Signatures  ~       ✗       ✗       ✗       ✗       ✗
Cosmos SDK          ✗       ✗       ✗       ✗       ✗       ✓
```

No single row has majority coverage. No existing bridge protocol can span all six chains.

---

## Why Alternative Solutions Fail

### Intent-Based Protocols (Hyperbridge, Across, etc.)

Intent systems work by having users declare desired outcomes, with fillers competing to fulfill them. Verification occurs through state proofs or optimistic mechanisms.

**Requirement**: Ability to verify destination chain state on source chain
**Problem**: No proof system spans Zcash scripts, Miden STARKs, Aztec SNARKs, and Mina's Kimchi proofs simultaneously

```
Intent Protocol Coverage:

Hyperbridge:  Fhenix ✓  |  Zcash ✗  Miden ✗  Aztec ✗  Mina ✗  Osmosis ✗
Across:       Fhenix ✓  |  Zcash ✗  Miden ✗  Aztec ✗  Mina ✗  Osmosis ✗

Coverage: 1/6 chains (16%)
```

### Adaptor Signatures (Scriptless Scripts)

Adaptor signatures enable atomic swaps without on-chain hash revelation—transactions on different chains become unlinkable. This provides superior privacy to HTLC.

**Requirement**: Schnorr-compatible signatures on both chains, UTXO model for pre-signed refunds
**Problem**: EVM chains use account model with nonces; refund transactions cannot be pre-signed

```
Adaptor Signature Compatibility:

Zcash (UTXO + Jubjub):     ✓  Jubjub is Schnorr-like
Miden (Account + STARK):   ✗  No Schnorr, account model
Aztec (Account + SNARK):   ✗  No Schnorr, account model
Mina (Account + Pasta):    ~  Pasta curves possible, but account model
Fhenix (Account + ECDSA):  ✗  ECDSA incompatible, account model
Osmosis (Account + Secp):  ✗  Account model breaks pre-signing

Coverage: 1/6 chains (16%)
```

From the cryptographic literature: "Cross-chain atomic swaps based on adaptor signatures are incompatible with Ethereum. This is because Ethereum uses the account model, not the UTXO model. Specifically, in adaptor signature-based atomic swaps, refund transactions must be pre-signed."

### Specialized Privacy Bridges

**Penumbra**: Cosmos IBC only—covers Osmosis, nothing else
**Secret Network**: TEE-based, bridges to EVM and Cosmos—no Zcash, Miden, Aztec, Mina
**RAILGUN**: Same-chain privacy only—not cross-chain

```
Privacy Bridge Coverage:

Penumbra:        Osmosis ✓  |  Others ✗     Coverage: 1/6
Secret Network:  Osmosis ✓  Fhenix ~       Coverage: 1-2/6
RAILGUN:         Fhenix ✓   |  Others ✗    Coverage: 1/6 (same-chain only)
```

### The Common Denominator Problem

Each alternative protocol optimizes for a specific architecture. When the target set includes:

- UTXO chains (Zcash)
- zkSTARK chains (Miden)
- zkSNARK chains (Aztec, Mina)
- FHE chains (Fhenix)
- Cosmos chains (Osmosis)

The intersection of compatible protocols is effectively empty.

---

## HTLC: The Universal Primitive

### Minimal Requirements

Hash Time-Lock Contracts require only two primitives:

1. **Hash function**: Ability to compute SHA256 (or equivalent)
2. **Time condition**: Ability to make funds spendable after a timestamp

These primitives exist on every programmable blockchain:

```
HTLC Primitive Availability:

Chain      Hash Function       Time Condition         Implementation
────────────────────────────────────────────────────────────────────────
Zcash      SHA256 (native)     OP_CHECKLOCKTIMEVERIFY P2SH script
Miden      SHA256 (stdlib)     Block height check     Smart contract
Aztec      SHA256 (Noir lib)   Timestamp constraint   Noir contract
Mina       SHA256 (o1js)       Slot number check      zkApp
Fhenix     SHA256 (EVM)        block.timestamp        Solidity contract
Osmosis    SHA256 (CosmWasm)   Block time             CosmWasm contract

Coverage: 6/6 chains (100%)
```

HTLC is the only mechanism that achieves full coverage.

### The Protocol

The OmniSwap SDK implements HTLC through the `HTLCCoordinator` class with defined execution states:

```typescript
// From src/types/index.ts
export enum ExecutionState {
  INITIALIZING = 'initializing',
  LOCKING_SOURCE = 'locking_source',
  CONFIRMING_LOCK = 'confirming_lock',
  RELEASING_DEST = 'releasing_dest',
  CONFIRMING_RELEASE = 'confirming_release',
  COMPLETING = 'completing',
  COMPLETED = 'completed',
  REFUNDING = 'refunding',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}
```

These states map to a five-step atomic swap:

```
Step 1: LOCKING_SOURCE
        User generates secret, creates HTLC on source chain
        Timelock: 1 hour
        Receiver: Solver

Step 2: CONFIRMING_LOCK
        Wait for source chain confirmation
        HTLC becomes immutable

Step 3: RELEASING_DEST
        Solver creates matching HTLC on destination chain
        Same hashlock, shorter timelock: 30 minutes
        Receiver: User

Step 4: CONFIRMING_RELEASE
        Wait for destination chain confirmation
        Verify amounts match expectations

Step 5: COMPLETING
        User reveals secret to claim destination funds
        Secret publication enables solver to claim source funds
```

### Atomicity Guarantee

The asymmetric timelock structure ensures atomicity:

```
Timeline:

t=0        User locks source funds (timelock: 60 min)
           │
t=5min     Solver locks destination funds (timelock: 30 min)
           │
           │  ┌─────────────────────────────────────────┐
           │  │ SAFE EXECUTION WINDOW                   │
           │  │ User can claim destination funds        │
           │  │ and reveal secret                       │
           │  └─────────────────────────────────────────┘
           │
t=30min    Solver timelock expires
           If user hasn't claimed: Solver reclaims destination funds
           │
           │  ┌─────────────────────────────────────────┐
           │  │ USER PROTECTION WINDOW                  │
           │  │ User can still reclaim source funds     │
           │  │ (secret was never revealed)             │
           │  └─────────────────────────────────────────┘
           │
t=60min    User timelock expires
           If swap incomplete: User reclaims source funds
```

**Critical property**: Solver's timelock (30 min) expires before user's (60 min). This guarantees:

- If user claims destination → solver has 30 minutes to claim source
- If user doesn't claim → solver reclaims first, then user reclaims
- No state where funds are permanently locked

From `src/core/htlc-coordinator.ts`:

```typescript
// Calculate timelocks
const userTimelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
const solverTimelock = Math.floor(Date.now() / 1000) + 1800; // 30 min
```

---

## Implementation: Chain-Specific Adapters

### The Adapter Pattern

OmniSwap SDK uses a base adapter interface that each chain implements:

```typescript
// From src/types/index.ts
export interface HTLCParams {
  chain: Chain;
  sender: string;
  receiver: string;
  amount: bigint;
  hashlock: Buffer;
  timelock: number;
  asset?: Asset;
}

export interface HTLCStatus {
  id: string;
  state: HTLCState;
  txHash?: string;
  claimTxHash?: string;
  refundTxHash?: string;
  amount: bigint;
  hashlock: string;
  timelock: number;
}
```

Each chain adapter implements: `createHTLC()`, `claimHTLC()`, `refundHTLC()`, `getHTLCStatus()`

### Zcash: P2SH Script

Zcash uses Bitcoin-style scripts. The HTLC is a Pay-to-Script-Hash address:

```typescript
// From src/adapters/zcash.ts - buildHTLCScript()
// Zcash HTLC script:
// OP_IF
//   OP_SHA256 <hashlock> OP_EQUALVERIFY
//   <receiver_pubkey> OP_CHECKSIG
// OP_ELSE
//   <timelock> OP_CHECKLOCKTIMEVERIFY OP_DROP
//   <sender_pubkey> OP_CHECKSIG
// OP_ENDIF

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
```

**Execution paths**:
- With preimage: Receiver provides secret, satisfies `OP_SHA256 <hashlock> OP_EQUALVERIFY`
- After timelock: Sender spends via `OP_CHECKLOCKTIMEVERIFY` path

### Osmosis: CosmWasm Contract

Osmosis uses Cosmos SDK with CosmWasm smart contracts:

```typescript
// From src/adapters/osmosis.ts
// CosmWasm HTLC contract methods:
// - new_swap(swap_id, participant, hashlock, timelock)
// - withdraw(swap_id, preimage)
// - refund(swap_id)

const msg = {
  create_htlc: {
    id: htlcId,
    receiver: params.receiver,
    hashlock: params.hashlock.toString('hex'),
    timelock: params.timelock,
  },
};
```

### Fhenix: EVM Contract

Fhenix is EVM-compatible, using standard Solidity HTLC patterns:

```typescript
// From src/adapters/fhenix.ts
// EVM HTLC method selectors:
// 0xa9059cbb - newSwap()
// 0xc0ff1c7f - withdraw(bytes32 swapId, bytes32 preimage)
// 0x7249fbb6 - refund(bytes32 swapId)

const data = this.encodeHTLCCall('newSwap', [
  params.hashlock,
  params.receiver,
  params.timelock,
]);
```

### The Pattern

Despite radically different underlying architectures:

| Chain | Script/Contract Language | Same HTLC Logic |
|-------|-------------------------|-----------------|
| Zcash | Bitcoin Script opcodes | ✓ |
| Miden | Miden assembly | ✓ |
| Aztec | Noir | ✓ |
| Mina | o1js/SnarkyJS | ✓ |
| Fhenix | Solidity | ✓ |
| Osmosis | CosmWasm (Rust) | ✓ |

The HTLC logic is identical; only the encoding differs.

---

## Privacy Considerations

### HTLC Privacy Properties

HTLC provides baseline privacy through decentralization:

**No central coordinator**: No single entity sees both sides of the swap
**No shared database**: Transaction data lives only on respective chains
**Solver isolation**: Solvers see individual swaps, not global patterns

From `src/types/index.ts`:

```typescript
export enum PrivacyLevel {
  STANDARD = 'standard',
  ENHANCED = 'enhanced',
  MAXIMUM = 'maximum',
}

export interface PrivacyConfig {
  level: PrivacyLevel;
  useRelayer: boolean;
  useMixing: boolean;
  delayBroadcast: boolean;
  useTor: boolean;
  useShieldedRoutes: boolean;
  decoyTransactions: number;
}
```

### Privacy Scoring

The route optimizer calculates privacy scores based on chain selection:

```typescript
// From src/core/router.ts
private calculatePrivacyScore(path: LiquidityEdge[]): number {
  let score = 100;

  for (const edge of path) {
    // Deduct for non-privacy chains
    if (!this.isPrivacyChain(edge.from.chain)) score -= 15;
    if (!this.isPrivacyChain(edge.to.chain)) score -= 15;

    // Deduct for bridges
    if (edge.mechanism === SwapMechanism.BRIDGE) score -= 20;
  }

  return Math.max(0, score);
}

private isPrivacyChain(chain: Chain): boolean {
  return [Chain.ZCASH, Chain.MIDEN, Chain.AZTEC, Chain.MINA].includes(chain);
}
```

Routes through privacy-native chains score higher. Routes involving bridges score lower due to potential metadata leakage.

### HTLC Privacy Limitation: Hash Correlation

The primary privacy weakness of HTLC: the same hashlock appears on both chains.

```
Source Chain (Zcash):
  HTLC created with hashlock: 0x7a8b9c...

Destination Chain (Osmosis):
  HTLC created with hashlock: 0x7a8b9c...  ← Same hash

Chain analysis can correlate these transactions.
```

This is a known trade-off. Adaptor signatures would solve this (transactions become unlinkable), but adaptor signatures don't work across account-model chains.

**Mitigation strategies** (configurable via `PrivacyConfig`):
- `delayBroadcast`: Randomize transaction timing
- `useTor`: Obscure IP correlation
- `decoyTransactions`: Create noise transactions
- `useShieldedRoutes`: Route through Zcash shielded pools when possible

**For true unlinkability**: See the Privacy Hub architecture below, which uses **different hashlocks per swap leg** to break on-chain correlation entirely.

### Zcash Shielding Integration

For Zcash specifically, the SDK integrates with shielded transactions:

```typescript
// From src/adapters/zcash.ts
async shieldFunds(transparentAddress: string, amount: bigint): Promise<string> {
  const shieldedAddress = await this.getShieldedAddress();
  const operationId = await this.rpcCall('z_sendmany', [
    transparentAddress,
    [{ address: shieldedAddress, amount: Number(amount) / 1e8 }],
  ]);
  return operationId;
}

async getShieldedAddress(): Promise<string> {
  return await this.rpcCall('z_getnewaddress', ['sapling']);
}
```

This enables: transparent → shielded → HTLC → shielded → transparent flows, where the middle portions are privacy-preserving.

---

## Route Optimization

### Multi-Mechanism Support

While HTLC is the universal fallback, the SDK supports multiple swap mechanisms when available:

```typescript
// From src/types/index.ts
export enum SwapMechanism {
  ATOMIC_SWAP = 'atomic-swap',    // HTLC
  AMM_SWAP = 'amm-swap',          // DEX liquidity pools
  IBC_TRANSFER = 'ibc-transfer',  // Cosmos native
  BRIDGE = 'bridge',              // Third-party bridges
  SOLVER_FILL = 'solver-fill',    // Intent matching
}
```

### Route Selection Logic

The `RouteOptimizer` builds a liquidity graph and finds optimal paths:

```typescript
// From src/core/router.ts
private getDirectEdges(from: Chain, to: Chain): LiquidityEdge[] {
  const edges: LiquidityEdge[] = [];

  // Atomic swap always available
  edges.push({
    from: { chain: from, asset: 'native', liquidity: BigInt(1e18) },
    to: { chain: to, asset: 'native', liquidity: BigInt(1e18) },
    mechanism: SwapMechanism.ATOMIC_SWAP,
    venue: 'omniswap-htlc',
    fee: 0.003,
    estimatedTime: 1200,
  });

  // Add bridge routes for EVM chains
  if (this.isEVMChain(from) && this.isEVMChain(to)) {
    edges.push({
      from: { chain: from, asset: 'native', liquidity: BigInt(1e18) },
      to: { chain: to, asset: 'native', liquidity: BigInt(1e18) },
      mechanism: SwapMechanism.BRIDGE,
      venue: 'thorchain',
      fee: 0.005,
      estimatedTime: 600,
    });
  }

  return edges;
}
```

Key insight: `ATOMIC_SWAP` (HTLC) is always added as an edge. Other mechanisms are added conditionally based on chain compatibility.

### Scoring Algorithm

Routes are scored based on user preferences:

```typescript
// From src/core/router.ts
private calculateRouteScore(route: Route, intent: SwapIntent): number {
  const outputScore = Number(route.estimatedOutput) / Number(intent.sourceAmount);
  const feeScore = 1 - Number(route.estimatedFees.total) / Number(intent.sourceAmount);
  const timeScore = 1 - route.estimatedTime / 3600;
  const privacyScore = route.privacyScore / 100;

  // Adjust weights based on privacy preference
  let privacyWeight = 0.2;
  if (intent.privacyLevel === PrivacyLevel.ENHANCED) privacyWeight = 0.4;
  if (intent.privacyLevel === PrivacyLevel.MAXIMUM) privacyWeight = 0.6;

  const outputWeight = (1 - privacyWeight) * 0.5;
  const feeWeight = (1 - privacyWeight) * 0.4;
  const timeWeight = (1 - privacyWeight) * 0.1;

  return (
    outputScore * outputWeight +
    feeScore * feeWeight +
    timeScore * timeWeight +
    privacyScore * privacyWeight
  );
}
```

When `privacyLevel` is `MAXIMUM`, privacy score accounts for 60% of route selection. This pushes routing through privacy-native chains even if slower or more expensive.

---

## Privacy Hub: Breaking the Correlation Problem

### The Core Innovation

Standard HTLC uses the same hashlock on both chains, making transactions trivially linkable. The **Privacy Hub architecture** solves this by using **different hashlocks for each leg** of the swap:

```
STANDARD HTLC (Linkable):

Source Chain:       hashlock = SHA256(secret)
                          ↓
                    [Same secret]
                          ↓
Destination Chain:  hashlock = SHA256(secret)  ← SAME HASH = LINKED

─────────────────────────────────────────────────────────

PRIVACY HUB (Unlinkable):

Source Chain:       hashlock₁ = SHA256(secret₁)
                          ↓
                    [Solver bridges through privacy hub]
                    [Secrets are UNRELATED]
                          ↓
Destination Chain:  hashlock₂ = SHA256(secret₂)  ← DIFFERENT HASH = UNLINKABLE
```

### How It Works

The Privacy Hub protocol introduces a correlation-breaking intermediary:

```
┌─────────────────────────────────────────────────────────────┐
│                   PRIVACY HUB PROTOCOL                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  PHASE 1: SOURCE LOCK                                        │
│  ─────────────────────                                       │
│  User creates HTLC on source chain                          │
│  - Hashlock: H₁ = SHA256(secret₁)                           │
│  - Receiver: Solver's stealth address                       │
│  - Timelock: 2 hours                                        │
│                                                              │
│  PHASE 2: SOLVER CLAIMS SOURCE                               │
│  ─────────────────────────────                               │
│  Solver claims HTLC (reveals secret₁ on-chain)              │
│  Solver now holds user's funds                              │
│                                                              │
│  PHASE 3: PRIVACY HUB DEPOSIT                                │
│  ─────────────────────────────                               │
│  Solver deposits equivalent value into Zcash shielded pool  │
│  Transparent → Shielded (z_sendmany)                        │
│                                                              │
│  PHASE 4: MIXING                                             │
│  ────────────────                                            │
│  Random delay (30 min - 4 hours)                            │
│  Internal shielded transfers (z→z)                          │
│  Decoy transactions for noise                               │
│                                                              │
│  PHASE 5: PRIVACY HUB WITHDRAW                               │
│  ──────────────────────────────                              │
│  Solver withdraws to FRESH shielded address                 │
│  No link to deposit transaction                             │
│                                                              │
│  PHASE 6: DESTINATION LOCK                                   │
│  ──────────────────────────                                  │
│  Solver creates HTLC on destination chain                   │
│  - Hashlock: H₂ = SHA256(secret₂)  ← DIFFERENT SECRET!      │
│  - Receiver: User's stealth address                         │
│  - Timelock: 1 hour                                         │
│                                                              │
│  PHASE 7: SECRET TRANSFER                                    │
│  ─────────────────────────                                   │
│  Solver sends secret₂ to user (encrypted, off-chain)        │
│                                                              │
│  PHASE 8: USER CLAIMS DESTINATION                            │
│  ─────────────────────────────────                           │
│  User claims destination HTLC using secret₂                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

From `src/core/privacy-hub.ts`:

```typescript
// Key innovation: TWO DIFFERENT SECRETS
const sourceSecret = randomBytes(32);
const destSecret = randomBytes(32);  // NOT derived from sourceSecret

const sourceHashlock = createHash('sha256').update(sourceSecret).digest();
const destHashlock = createHash('sha256').update(destSecret).digest();

// Source chain sees: H₁ = SHA256(sourceSecret)
// Destination chain sees: H₂ = SHA256(destSecret)
// H₁ and H₂ are cryptographically unrelated
```

The `PrivacyHubCoordinator` class manages the complete flow:

```typescript
// From src/core/privacy-hub.ts
export class PrivacyHubCoordinator {
  async executePrivateSwap(
    intent: SwapIntent,
    solver: Solver
  ): Promise<PrivacyHubExecution> {
    // Phase 1-2: Source chain HTLC with hashlock₁
    await this.lockSourceFunds(execution, intent, solver);
    await this.solverClaimsSource(execution, intent, solver);

    // Phase 3-5: Privacy Hub mixing
    await this.depositToPrivacyHub(execution, intent, solver);
    await this.executeMixingPhase(execution);
    await this.withdrawFromPrivacyHub(execution, solver);

    // Random delay for timing decorrelation
    await this.waitRandomDelay(execution);

    // Phase 6-8: Destination chain HTLC with hashlock₂ (DIFFERENT!)
    await this.lockDestinationFunds(execution, intent, solver);
    await this.transferDestSecretToUser(execution, intent);
    await this.userClaimsDest(execution, intent);

    return execution;
  }
}
```

### Why This Achieves Unlinkability

**Before Privacy Hub** (chain analyst view):
```
Source Chain:  HTLC with hash 0x7a8b9c... at time T
Dest Chain:    HTLC with hash 0x7a8b9c... at time T+5min

Conclusion: These are the same swap (100% confidence)
```

**After Privacy Hub** (chain analyst view):
```
Source Chain:  HTLC with hash 0x7a8b9c... at time T
Dest Chain:    HTLC with hash 0x3d4e5f... at time T+2hr

Conclusion: No cryptographic link. Different hashes, different times,
            different addresses. Cannot prove relationship.
```

### Additional Privacy Layers

The Privacy Hub architecture includes multiple defense-in-depth measures:

**1. Stealth Addresses**

Every swap uses one-time addresses:

```typescript
// From src/core/privacy-hub.ts
export class StealthAddressGenerator {
  async generate(chain: Chain, recipientAddress: string): Promise<StealthAddress> {
    // Generate ephemeral keypair for this swap only
    const ephemeral = createECDH('secp256k1');
    ephemeral.generateKeys();

    // Derive unique address from shared secret
    // Address is unlinkable to recipient's main address
    return {
      chain,
      address: this.deriveChainAddress(chain, viewingKey, spendingKeyHash),
      ephemeralPublicKey: ephemeral.getPublicKey('hex'),
      // ...
    };
  }
}
```

**2. Timing Decorrelation**

Random delays break temporal correlation:

```typescript
// From src/core/privacy-hub.ts
export class TimingDecorrelator {
  static calculateRandomDelay(
    minMs: number,
    maxMs: number,
    distribution: 'uniform' | 'exponential' | 'poisson' = 'exponential'
  ): number {
    // Exponential distribution makes timing analysis difficult
    // Most delays are shorter, some are very long
    const lambda = 1 / ((maxMs - minMs) / 3);
    const delay = -Math.log(1 - Math.random()) / lambda;
    return Math.min(maxMs, Math.max(minMs, minMs + Math.floor(delay)));
  }
}
```

**3. Amount Splitting**

Break amount correlation by splitting into common denominations:

```typescript
// Configuration
const config: PrivacyHubConfig = {
  useSplitAmounts: true,
  splitDenominations: [
    BigInt(1e8),   // 1 ZEC
    BigInt(1e7),   // 0.1 ZEC
    BigInt(1e6),   // 0.01 ZEC
  ],
};

// A 1.37 ZEC transfer becomes:
// [1 ZEC, 0.1 ZEC, 0.1 ZEC, 0.1 ZEC, 0.01 ZEC, ...]
// Each piece is indistinguishable from other pool transactions
```

**4. Decoy Transactions**

Create noise to obscure real activity:

```typescript
const config: PrivacyHubConfig = {
  useDecoyTransactions: true,
  decoyCount: 5,  // Generate 5 decoy txs per real swap
};
```

### Privacy Score with Hub

Routes using the Privacy Hub receive significantly higher privacy scores:

```typescript
// Privacy Hub swaps achieve 95+ privacy score
const execution = await sdk.executePrivateSwap(quote);
console.log(execution.route.privacyScore);  // 95

// vs. standard HTLC
const standardExecution = await sdk.executeSwap(quote);
console.log(standardExecution.route.privacyScore);  // 60-70
```

### Usage

```typescript
import { OmniSwap, PrivacyLevel } from 'omniswap-sdk';

const sdk = new OmniSwap({ environment: 'mainnet' });
await sdk.initialize();

// Standard swap (fast, but linkable)
const standardResult = await sdk.executeSwap(quote);

// Privacy Hub swap (slower, but unlinkable)
const privateResult = await sdk.executePrivateSwap(quote, {
  hubConfig: {
    hubChain: 'zcash',
    minMixingDelay: 30 * 60 * 1000,   // 30 minutes
    maxMixingDelay: 4 * 60 * 60 * 1000, // 4 hours
    useDecoyTransactions: true,
    decoyCount: 5,
  },
});

// Verify unlinkability metrics
console.log(privateResult.correlationBroken);    // true
console.log(privateResult.timingDecorrelated);   // true
console.log(privateResult.addressesOneTime);     // true
```

### Trade-offs

| Aspect | Standard HTLC | Privacy Hub |
|--------|--------------|-------------|
| Settlement time | 10-30 minutes | 1-5 hours |
| On-chain correlation | Yes (same hash) | No (different hashes) |
| Address reuse | Possible | Prevented (stealth) |
| Timing analysis | Vulnerable | Mitigated (random delay) |
| Solver trust | Liveness only | Liveness + secret transfer |
| Gas/fees | Lower | Higher (multiple txs) |

Privacy Hub is appropriate when **unlinkability** is more important than **speed**.

---

## Limitations

### What Standard HTLC Cannot Provide

**Unlinkable transactions** (solved by Privacy Hub): The hashlock correlation problem means chain analysts can connect source and destination transactions. Standard HTLC uses the same hashlock on both chains. **The Privacy Hub architecture solves this** by using different hashlocks per leg with a privacy-preserving intermediary. See the Privacy Hub section above.

**Sub-minute settlement**: HTLC requires waiting for confirmations on both chains. With Zcash's ~75 second block time and 6-confirmation finality requirement, minimum settlement is ~7-8 minutes even in the happy path.

```
// From src/adapters/zcash.ts
getBlockTime(): number {
  return 75000; // ~75 seconds
}

async isFinalized(txHash: string): Promise<boolean> {
  // Zcash needs ~6 confirmations for finality
  const confirmations = await this.getConfirmations(txHash);
  return confirmations >= 6;
}
```

**Instant finality**: Users must wait for blockchain confirmations. Intent-based systems can provide instant UX (filler fronts capital), but don't support the target chain set.

**General message passing**: HTLC transfers value, not arbitrary data. Cross-chain contract calls require different mechanisms.

### What HTLC Provides

**Universal compatibility**: Works on all six target chains
**Trustless execution**: No intermediaries, cryptographic guarantees only
**Self-custody**: Users maintain control throughout
**Atomic settlement**: All-or-nothing execution
**Proven security**: Battle-tested since Lightning Network (2017)
**Simple cryptography**: SHA256 and timelocks—auditable, understood

---

## Conclusion

Cross-chain interoperability between Zcash, Miden, Aztec, Mina, Fhenix, and Osmosis presents an architectural constraint that eliminates most bridging solutions. The chains share no common execution environment, signature scheme, or ecosystem.

HTLC succeeds where alternatives fail because its requirements—hash functions and time conditions—are the minimal primitives available on any programmable blockchain. This universality comes with trade-offs: hashlock correlation reduces privacy compared to adaptor signatures, and confirmation requirements prevent sub-minute settlement.

For OmniSwap SDK's specific target set, these trade-offs are acceptable. The alternative—building six separate bridge integrations with incompatible protocols—would be architecturally unsound and operationally complex.

HTLC is not the theoretically optimal solution. It is the only solution that works.

---

## Technical Reference

### Supported Chains

```typescript
// From src/types/index.ts
export enum Chain {
  ZCASH = 'zcash',
  MIDEN = 'miden',
  AZTEC = 'aztec',
  MINA = 'mina',
  FHENIX = 'fhenix',
  OSMOSIS = 'osmosis',
}
```

### HTLC State Machine

```typescript
// From src/types/index.ts
export enum HTLCState {
  PENDING = 'pending',
  LOCKED = 'locked',
  CLAIMED = 'claimed',
  REFUNDED = 'refunded',
  EXPIRED = 'expired',
}
```

### SDK Entry Point

```typescript
// From src/omniswap.ts
import { OmniSwap } from 'omniswap-sdk';

const sdk = new OmniSwap({
  environment: 'mainnet',
  timeout: 30000,
  retries: 3,
});

await sdk.initialize();
const quotes = await sdk.getQuote(request);
const execution = await sdk.executeSwap(quote);
```

---

## Further Reading

- **HTLC Coordinator**: `src/core/htlc-coordinator.ts`
- **Privacy Hub Coordinator**: `src/core/privacy-hub.ts`
- **Route Optimizer**: `src/core/router.ts`
- **Chain Adapters**: `src/adapters/`
- **Type Definitions**: `src/types/index.ts`

### Related Articles

- **[Intent Blind Matching Analysis](./intent-blind-matching-analysis.md)**: Why blind matching doesn't solve cross-chain unlinkability
- **[Timelock Privacy: CSPRNG + Log-Normal](./timelock-privacy-csprng-lognormal.md)**: Defeating timelock correlation with cryptographic randomness

---

**Repository**: [omniswap-sdk](https://github.com/omniswap/omniswap-sdk)

**License**: MIT
