# Defeating Timelock Correlation: CSPRNG + Log-Normal Distribution for Privacy-Preserving Cross-Chain Swaps

**By the OmniSwap Engineering Team**
**November 2025** · 14 min read

---

## What You'll Learn

- Why fixed timelocks leak correlation information in cross-chain swaps
- How cryptographic randomness (CSPRNG) prevents timelock prediction
- Why log-normal distribution defeats statistical pattern analysis
- The role of hard limits in balancing privacy with UX and capital efficiency
- How timelocks integrate with shielded pools for maximum unlinkability

---

Hash Time-Lock Contracts (HTLC) are the universal primitive for cross-chain atomic swaps. They work across all blockchain architectures—UTXO, account model, EVM, Cosmos, ZK-rollups. But HTLCs have a subtle privacy leak that most implementations ignore: **timelock correlation**.

This article examines how deterministic or poorly randomized timelocks enable chain analysts to correlate cross-chain transactions, and presents OmniSwap's solution using cryptographically secure pseudo-random number generation (CSPRNG) combined with log-normal distribution.

---

## The Problem: Timelocks as Fingerprints

### Standard HTLC Timelock Pattern

Most atomic swap implementations use fixed timelock durations:

```
Common Pattern:

Source Chain HTLC:       timelock = now + 2 hours
Destination Chain HTLC:  timelock = now + 1 hour

Invariant: source_timelock > dest_timelock (for safety)
```

This creates a recognizable fingerprint:

```
Chain Analyst Observation:

Source Chain (T=0):
  HTLC created
  Timelock expires at: T + 7200 seconds

Destination Chain (T=5min):
  HTLC created
  Timelock expires at: T + 3600 seconds

Analysis: "Both HTLCs follow the 2:1 timelock ratio.
          This matches OmniSwap's pattern.
          95% confidence these transactions are linked."
```

Even when hashlocks are different (via Privacy Hub), **timelock patterns can re-establish correlation**.

### The Correlation Vectors

| Vector | Description | Exploitability |
|--------|-------------|----------------|
| **Fixed duration** | Same timelock every swap | Trivial fingerprinting |
| **Ratio pattern** | Consistent source:dest ratio | Statistical correlation |
| **Round numbers** | Timelocks at hour boundaries | Reduces anonymity set |
| **Timing delta** | Time between HTLC creations | Temporal correlation |

---

## Why Simple Randomization Fails

### Uniform Random Distribution

The naive solution is uniform randomization:

```typescript
// Naive approach
const timelock = MIN_TIMELOCK + Math.random() * (MAX_TIMELOCK - MIN_TIMELOCK);
```

Problems:

1. **`Math.random()` is not cryptographically secure**
   - Based on predictable PRNG (xorshift128+ in V8)
   - Seed can be inferred from multiple samples
   - Attacker who knows approximate time can narrow possibilities

2. **Uniform distribution has obvious bounds**
   ```
   Uniform distribution between 1hr and 4hr:

      ▲ Frequency
      │ ████████████████████████████████████
      │ ████████████████████████████████████
      │ ████████████████████████████████████
      └─────────────────────────────────────► Time
        1hr                               4hr

   Analyst: "All timelocks fall between 1-4 hours.
             This is clearly an OmniSwap transaction."
   ```

3. **No heavy tail for outlier cover**
   - Every value equally likely
   - No natural "noise" from extreme values

### Weak PRNG Seeds

Some implementations seed randomness from:
- Current timestamp (predictable)
- Transaction hash (observable)
- Block number (public)

An attacker with chain visibility can reconstruct the random sequence.

---

## The Solution: CSPRNG + Log-Normal + Hard Limits

OmniSwap uses a three-layer approach:

```
Layer 1: CSPRNG
         └── Unpredictable random source (entropy-based)

Layer 2: Log-Normal Distribution
         └── Heavy tail defeats statistical analysis

Layer 3: Hard Limits
         └── Guarantees UX and capital efficiency
```

### Layer 1: Cryptographically Secure Randomness

```typescript
import { randomBytes } from 'crypto';

/**
 * Cryptographically secure random number in [0, 1)
 * Uses system entropy pool (hardware RNG, interrupt timing, etc.)
 * Impossible to predict without access to entropy source.
 */
function secureRandom(): number {
  const buf = randomBytes(8);
  return Number(buf.readBigUInt64BE()) / Number(2n ** 64n);
}
```

**Properties**:
- Based on `/dev/urandom` (Unix) or `CryptGenRandom` (Windows)
- Draws from system entropy pool
- No mathematical pattern to reverse-engineer
- Each call independent of previous calls

**Why this matters**:

```
Math.random():
  Attacker samples 10 timelocks
  → Can predict next 1000 with high accuracy

CSPRNG:
  Attacker samples 10 timelocks
  → Learns nothing about next timelock
```

### Layer 2: Log-Normal Distribution

The log-normal distribution has properties ideal for privacy:

```
Log-Normal vs. Uniform vs. Normal:

UNIFORM (bad for privacy):
   ▲
   │ ████████████████████████████
   │ ████████████████████████████
   └──────────────────────────────► Time
     (obvious bounds)


NORMAL (mediocre for privacy):
   ▲
   │        ████████
   │      ████████████
   │    ████████████████
   │  ████████████████████
   └──────────────────────────────► Time
           (clustering reveals mean)


LOG-NORMAL (good for privacy):
   ▲
   │  ████
   │ ██████
   │████████
   │██████████████
   │████████████████████████████████░░░░░░░░░░
   └──────────────────────────────────────────► Time
     (heavy tail, no obvious bounds)
```

**Log-normal properties**:

1. **Asymmetric**: Most values cluster near median, but tail extends far
2. **Memoryless-like**: Knowing current value tells little about next
3. **Natural process**: Matches many real-world phenomena (latency, file sizes)
4. **Heavy tail**: Extreme values provide cover for normal values

**Mathematical definition**:

```
If X ~ Normal(μ, σ²), then Y = e^X ~ LogNormal(μ, σ²)

For timelock generation:
  μ = ln(median_timelock)
  σ = variance parameter (0.35 - 0.45 for our use case)
```

**Implementation**:

```typescript
/**
 * Generate log-normal distributed value using Box-Muller transform.
 *
 * @param median - Center of distribution
 * @param sigma - Variance (higher = wider spread, heavier tail)
 */
function logNormal(median: number, sigma: number): number {
  const u1 = secureRandom();
  const u2 = secureRandom();

  // Box-Muller transform: uniform → normal
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // Normal → log-normal
  const mu = Math.log(median);
  return Math.exp(mu + sigma * z);
}
```

### Layer 3: Hard Limits (Capping)

Uncapped log-normal has a problem: the heavy tail can produce extreme values.

```
Uncapped log-normal (median=1hr, σ=0.5):

  0.1% of values: > 12 hours  ← Unacceptable UX
  0.01% of values: > 24 hours ← Terrible capital efficiency
```

**Solution**: Apply hard minimum and maximum bounds.

```typescript
function cappedLogNormal(
  median: number,
  min: number,
  max: number,
  sigma: number
): number {
  const raw = logNormal(median, sigma);
  return Math.max(min, Math.min(max, raw));
}
```

**Result**:

```
Capped log-normal (median=1.5hr, min=30min, max=4hr, σ=0.45):

   ▲ Frequency
   │
   │      ████
   │     ██████
   │    ████████
   │   ██████████
   │  ████████████████
   │ ████████████████████████████░░░ (tail capped at 4hr)
   └─────────────────────────────────────────────────────► Time
    30min    1hr   1.5hr   2hr   3hr   4hr
    (min)         (median)             (max)

- Unpredictable within range ✓
- Heavy tail pattern analysis defeated ✓
- No extreme outliers (UX guaranteed) ✓
- Capital efficiency maintained ✓
```

---

## OmniSwap Timelock Configuration

Based on analysis of chain finality times, user patience thresholds, capital efficiency requirements, and attack window considerations:

### Source Chain HTLC (User → Solver)

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| **Minimum** | 30 minutes | Zcash finality (~7.5min) + mixing buffer |
| **Median** | 1.5 hours | Balances privacy and UX |
| **Maximum** | 4 hours | Capital efficiency ceiling |
| **Sigma (σ)** | 0.45 | Moderate variance |

### Destination Chain HTLC (Solver → User)

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| **Minimum** | 15 minutes | Fastest chain finality buffer |
| **Median** | 45 minutes | Quick claim for user |
| **Maximum** | 90 minutes | Must be < source timelock |
| **Sigma (σ)** | 0.35 | Tighter (user-facing) |

### Additional Parameters

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| **Buffer** | 30 minutes | Safety margin: source must expire after dest |
| **Round to** | 15 minutes | Blend with ecosystem (common DeFi intervals) |

### Implementation

```typescript
// From src/core/privacy-hub.ts

export const TIMELOCK_CONFIG = {
  source: {
    minSeconds: 1800,       // 30 minutes
    medianSeconds: 5400,    // 1.5 hours
    maxSeconds: 14400,      // 4 hours
    sigma: 0.45,
  },
  destination: {
    minSeconds: 900,        // 15 minutes
    medianSeconds: 2700,    // 45 minutes
    maxSeconds: 5400,       // 90 minutes
    sigma: 0.35,
  },
  buffer: 1800,             // 30 min safety
  roundTo: 900,             // 15-minute intervals
} as const;

function generateTimelocks(): { source: number; dest: number } {
  const now = Math.floor(Date.now() / 1000);
  const { source, destination, buffer, roundTo } = TIMELOCK_CONFIG;

  // Generate destination first (shorter)
  const destOffset = cappedLogNormal(
    destination.medianSeconds,
    destination.minSeconds,
    destination.maxSeconds,
    destination.sigma
  );

  // Source must be > dest + buffer
  const minSourceOffset = destOffset + buffer;
  const sourceOffset = Math.max(
    minSourceOffset,
    cappedLogNormal(
      source.medianSeconds,
      source.minSeconds,
      source.maxSeconds,
      source.sigma
    )
  );

  // Round to 15-minute intervals (blend with ecosystem)
  const roundedSource = Math.ceil(sourceOffset / roundTo) * roundTo;
  const roundedDest = Math.ceil(destOffset / roundTo) * roundTo;

  return {
    source: now + roundedSource,
    dest: now + roundedDest,
  };
}
```

---

## Integration with Privacy Hub

The CSPRNG + Log-Normal timelocks are one component of OmniSwap's Privacy Hub architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRIVACY HUB ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LAYER 1: HASHLOCK DECORRELATION                                │
│  ───────────────────────────────                                │
│  Different secrets per leg                                      │
│  H₁ = SHA256(secret₁)  ≠  H₂ = SHA256(secret₂)                 │
│                                                                  │
│  LAYER 2: TIMELOCK DECORRELATION                                │
│  ────────────────────────────────                               │
│  CSPRNG + Log-Normal + Hard Limits                              │
│  Source: 30min-4hr, median 1.5hr, σ=0.45                        │
│  Dest: 15min-90min, median 45min, σ=0.35                        │
│  Rounded to 15-minute intervals                                  │
│                                                                  │
│  LAYER 3: TIMING DECORRELATION                                  │
│  ──────────────────────────────                                 │
│  Random delay between legs (30min - 4hr)                        │
│  Also CSPRNG + Log-Normal distributed                           │
│                                                                  │
│  LAYER 4: ADDRESS DECORRELATION                                 │
│  ──────────────────────────────                                 │
│  Stealth addresses for both parties                             │
│  One-time use, unlinkable to main addresses                     │
│                                                                  │
│  LAYER 5: SHIELDED POOL MIXING                                  │
│  ─────────────────────────────                                  │
│  Zcash Sapling pool as intermediary                             │
│  Internal z→z transfers break transaction graph                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### How Timelocks Interact with Shielded Pools

```
Timeline of Privacy Hub Swap:

T=0:        User creates source HTLC
            Timelock: T + 2hr 15min (log-normal generated)

T=5min:     Source HTLC confirmed
            Solver claims (reveals secret₁)

T=10min:    Solver deposits to Zcash shielded pool

T=10min-2hr: MIXING PHASE
             - Internal z→z transfers
             - Decoy transactions
             - Random delay (log-normal)

T=1hr 45min: Solver withdraws from shielded pool
             (Fresh shielded address, unlinkable to deposit)

T=1hr 50min: Solver creates destination HTLC
             Timelock: T + 2hr 30min (log-normal generated)
             Hashlock: H₂ (DIFFERENT from H₁)

T=2hr:       User claims destination HTLC
             (Reveals secret₂, completes swap)

Chain Analyst View:
─────────────────────
Source chain:  HTLC, hashlock=0xabc..., timelock=2hr 15min
Dest chain:    HTLC, hashlock=0xdef..., timelock=40min

- Different hashlocks (no cryptographic link)
- Different timelocks (no ratio pattern)
- Different addresses (stealth)
- 1hr 50min gap (timing decorrelated)

Conclusion: Cannot prove these are related.
```

---

## Security Analysis

### What CSPRNG + Log-Normal Protects Against

| Attack | Protection |
|--------|------------|
| **Timelock fingerprinting** | Log-normal has no obvious bounds pattern |
| **Ratio analysis** | Independent generation, no fixed source:dest ratio |
| **Prediction attacks** | CSPRNG prevents next-value prediction |
| **Timing correlation** | Combined with random delay, breaks temporal link |
| **Protocol identification** | 15-min rounding blends with ecosystem |

### What It Does Not Protect Against

| Attack | Limitation |
|--------|------------|
| **Amount correlation** | Timelocks don't hide amounts (use amount splitting) |
| **On-chain graph analysis** | Timelocks don't hide addresses (use stealth addresses) |
| **Hashlock correlation** | Different timelocks don't break same-hash link (use Privacy Hub) |
| **Global timing** | Block timestamps still visible (mitigated by random delay) |

### Entropy Requirements

```
Per swap:
  - 2 timelocks × 16 bytes entropy = 32 bytes
  - 1 mixing delay × 8 bytes entropy = 8 bytes
  - Total: ~40 bytes entropy per swap

For high-volume solver (1000 swaps/day):
  - Daily entropy: ~40 KB
  - Well within /dev/urandom capacity
  - No blocking on entropy exhaustion
```

---

## Comparison with Alternatives

| Approach | Predictability | Pattern Analysis | UX Bound | Capital Bound |
|----------|---------------|------------------|----------|---------------|
| Fixed timelock | Trivial | Trivial | ✓ Good | ✓ Good |
| Uniform random | PRNG-dependent | Obvious bounds | ✓ Good | ✓ Good |
| Normal distribution | PRNG-dependent | Mean visible | ✓ Good | ✓ Good |
| Log-normal (uncapped) | CSPRNG-secure | Defeated | ✗ Unbounded | ✗ Unbounded |
| **Capped log-normal** | **CSPRNG-secure** | **Defeated** | **✓ Bounded** | **✓ Bounded** |

---

## Usage Example

```typescript
import { OmniSwap, TIMELOCK_CONFIG } from 'omniswap-sdk';

const sdk = new OmniSwap({ environment: 'mainnet' });
await sdk.initialize();

// View timelock configuration
console.log('Source timelock range:', {
  min: `${TIMELOCK_CONFIG.source.minSeconds / 60} minutes`,
  median: `${TIMELOCK_CONFIG.source.medianSeconds / 60} minutes`,
  max: `${TIMELOCK_CONFIG.source.maxSeconds / 60} minutes`,
  sigma: TIMELOCK_CONFIG.source.sigma,
});

// Execute privacy-preserving swap
// Timelocks automatically generated using CSPRNG + Log-Normal
const execution = await sdk.executePrivateSwap(quote, {
  hubConfig: {
    minMixingDelay: 30 * 60 * 1000,  // 30 minutes
    maxMixingDelay: 2 * 60 * 60 * 1000,  // 2 hours
  },
});

// View generated timelocks
console.log('Source timelock:', new Date(execution.state.sourceTimelock * 1000));
console.log('Dest timelock:', new Date(execution.state.destTimelock * 1000));
```

---

## Conclusion

Fixed timelocks in HTLC-based swaps create a correlation fingerprint that chain analysts can exploit. Even when hashlocks are decorrelated (via Privacy Hub), consistent timelock patterns can re-establish the link.

OmniSwap's solution combines three layers:

1. **CSPRNG**: Cryptographically unpredictable random source
2. **Log-Normal Distribution**: Heavy tail defeats statistical pattern analysis
3. **Hard Limits**: Guarantees bounded UX and capital efficiency

The result is timelocks that are:
- **Unpredictable**: No mathematical pattern to exploit
- **Unidentifiable**: No obvious bounds or ratios
- **Bounded**: Never worse than 4 hours (source) or 90 minutes (dest)
- **Ecosystem-blended**: 15-minute intervals match common DeFi patterns

Combined with different hashlocks, stealth addresses, random delays, and shielded pool mixing, CSPRNG + Log-Normal timelocks complete OmniSwap's defense-in-depth approach to cross-chain privacy.

---

## Technical Reference

### Configuration

```typescript
// From src/core/privacy-hub.ts
export const TIMELOCK_CONFIG = {
  source: {
    minSeconds: 1800,       // 30 minutes
    medianSeconds: 5400,    // 1.5 hours
    maxSeconds: 14400,      // 4 hours
    sigma: 0.45,
  },
  destination: {
    minSeconds: 900,        // 15 minutes
    medianSeconds: 2700,    // 45 minutes
    maxSeconds: 5400,       // 90 minutes
    sigma: 0.35,
  },
  buffer: 1800,             // 30 min safety
  roundTo: 900,             // 15-minute intervals
};
```

### Key Functions

- `secureRandom()`: CSPRNG-based uniform random in [0, 1)
- `cappedLogNormal()`: Log-normal with hard min/max bounds
- `generateTimelocks()`: Complete timelock generation for both legs

### Related Documentation

- **Privacy Hub Coordinator**: `src/core/privacy-hub.ts`
- **HTLC Architecture**: `articles/why-htlc-for-privacy-cross-chain.md`
- **Intent Blind Matching**: `articles/intent-blind-matching-analysis.md`

---

## Further Reading

- **Box-Muller Transform**: [Wikipedia](https://en.wikipedia.org/wiki/Box%E2%80%93Muller_transform)
- **Log-Normal Distribution**: [Wikipedia](https://en.wikipedia.org/wiki/Log-normal_distribution)
- **CSPRNG Security**: [NIST SP 800-90A](https://csrc.nist.gov/publications/detail/sp/800-90a/rev-1/final)
- **Zcash Sapling Protocol**: [Protocol Specification](https://zips.z.cash/protocol/protocol.pdf)

---

**Repository**: [omniswap-sdk](https://github.com/omniswap/omniswap-sdk)

**License**: MIT
