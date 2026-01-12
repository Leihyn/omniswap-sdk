# SDK Introduction

*Last modified: November 26, 2025*

---

## Overview

OmniSwap SDK is a TypeScript/JavaScript library for executing **cross-chain atomic swaps** with **privacy guarantees** across 6 heterogeneous blockchains. The SDK abstracts the complexity of different blockchain architectures, cryptographic proof systems, and privacy technologies into a unified API.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        OmniSwap SDK                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  OmniSwap   │  │   Router    │  │    Privacy Hub          │  │
│  │   (Main)    │  │  Optimizer  │  │    Coordinator          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    HTLC     │  │   Refund    │  │      Quote              │  │
│  │ Coordinator │  │   Manager   │  │      Engine             │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      Adapter Registry                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│  │ Zcash  │ │Osmosis │ │ Fhenix │ │ Aztec  │ │ Miden  │ │  Mina  │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Description |
|-----------|-------------|
| **OmniSwap** | Main entry point; orchestrates all operations |
| **Router Optimizer** | Finds optimal routes across chains |
| **Privacy Hub Coordinator** | Manages privacy-enhanced swaps |
| **HTLC Coordinator** | Handles atomic swap execution |
| **Refund Manager** | Monitors and auto-refunds expired HTLCs |
| **Quote Engine** | Provides price quotes from multiple sources |
| **Adapter Registry** | Manages chain-specific adapters |

## Privacy Hub Architecture

The Privacy Hub is the core innovation that enables **unlinkable cross-chain swaps**.

### The Problem

Traditional atomic swaps use the same hashlock on both chains:

```
Chain A: HTLC(hashlock=H, amount=X)
Chain B: HTLC(hashlock=H, amount=Y)  ← Same H links the transactions!
```

An observer can trivially correlate these transactions by matching hashlocks.

### The Solution

OmniSwap uses **different hashlocks** for source and destination:

```
Chain A: HTLC₁(hashlock=H₁, amount=X)
    │
    ▼
Privacy Hub (Zcash Shielded Pool)
    │
    ▼
Chain B: HTLC₂(hashlock=H₂, amount=Y)  ← Different hashlock!
```

### Privacy Features

1. **Different Hashlocks**: Source and destination use independent secrets
2. **Stealth Addresses**: One-time addresses for each swap
3. **Timing Decorrelation**: CSPRNG + Log-Normal distributed delays
4. **Shielded Mixing**: Funds pass through Zcash Sapling pool

## HTLC (Hash Time-Lock Contract)

HTLCs are the atomic primitive that ensures swap atomicity across chains.

### How HTLCs Work

```
┌─────────────────────────────────────────────────────────────────┐
│                         HTLC Lifecycle                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CREATE                                                      │
│     User locks funds with hashlock H and timelock T             │
│     Funds can only be claimed with preimage P where SHA256(P)=H │
│                                                                 │
│  2. CLAIM (before timelock)                                     │
│     Receiver reveals preimage P to claim funds                  │
│     Preimage is now public and can be used on other chain       │
│                                                                 │
│  3. REFUND (after timelock)                                     │
│     If unclaimed, sender can refund after timelock expires      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Timelock Configuration

Timelocks use CSPRNG + Log-Normal distribution to prevent timing analysis:

| Parameter | Source HTLC | Destination HTLC |
|-----------|-------------|------------------|
| Minimum | 30 minutes | 15 minutes |
| Median | 1.5 hours | 45 minutes |
| Maximum | 4 hours | 90 minutes |
| Sigma (σ) | 0.45 | 0.35 |

**Important**: Source timelock must always exceed destination timelock + buffer to ensure atomic execution.

## Chain Adapters

Each blockchain has a dedicated adapter implementing the `ChainAdapter` interface:

### Adapter Capabilities

| Chain | HTLC Type | Hash Function | Timelock | Privacy |
|-------|-----------|---------------|----------|---------|
| Zcash | Script | SHA256 | Block height | Shielded pool |
| Osmosis | CosmWasm | SHA256 | Block height | - |
| Fhenix | Solidity + FHE | SHA256 | Timestamp | Encrypted state |
| Aztec | Noir contract | SHA256 | Block number | Private execution |
| Miden | Note script | RPO Hash | Block height | STARK proofs |
| Mina | zkApp | Poseidon | Slot number | zkProofs |

## Error Handling

The SDK provides typed errors with recovery suggestions:

### Error Categories

| Code Range | Category | Example |
|------------|----------|---------|
| 1xxx | Adapter | `ADAPTER_NOT_FOUND` |
| 2xxx | Transaction | `INSUFFICIENT_BALANCE` |
| 3xxx | HTLC | `HTLC_TIMELOCK_EXPIRED` |
| 4xxx | Swap | `SWAP_NO_ROUTE` |
| 5xxx | Solver | `SOLVER_INSUFFICIENT_INVENTORY` |
| 6xxx | Privacy | `PRIVACY_HUB_UNAVAILABLE` |
| 9xxx | Network | `NETWORK_ERROR` |

## Next Steps

- [Quick Start](./quick-start.md) - Get started in minutes
- [Use Cases](./use-cases/index.md) - Common patterns
- [API Reference](./api-reference/index.md) - Complete API docs
