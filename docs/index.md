# OmniSwap SDK Documentation

*Last modified: November 26, 2025*

---

> **Note**: OmniSwap SDK v1.0+ requires Node.js 18 or higher.

## 1 Introduction

The OmniSwap SDK documentation is divided into the sections described below.

:::info
- For installation and quick start, see the [Quick Start Guide](./quick-start.md).
- For details on SDK releases, check the [Release Notes](./release-notes.md).
- For API specifications, see the [API Reference](./api-reference/index.md).
:::

## 2 SDK Introduction

The OmniSwap SDK enables **cross-chain privacy swaps** across 6 heterogeneous blockchains using Hash Time-Lock Contracts (HTLCs) with a novel Privacy Hub architecture that breaks on-chain correlation.

### Supported Blockchains

| Chain | Technology | Native Currency | Privacy Level |
|-------|------------|-----------------|---------------|
| Zcash | zkSNARKs (Sapling) | ZEC | Maximum |
| Aztec | zkSNARKs (Noir) | ETH | Maximum |
| Miden | zkSTARKs | MIDEN | Maximum |
| Mina | Kimchi Proofs | MINA | High |
| Fhenix | FHE (Homomorphic) | FHE | High |
| Osmosis | Cosmos/IBC | OSMO | Standard |

### Key Features

- **Cross-chain atomic swaps** using HTLC
- **Privacy Hub architecture** for unlinkable transactions
- **Stealth addresses** for one-time use
- **CSPRNG + Log-Normal timelocks** to prevent timing analysis
- **Automated refund management**
- **Robust error handling** with retry logic

## 3 SDK Use Cases

The OmniSwap SDK supports the following primary use cases:

| Use Case | Description | Privacy Level |
|----------|-------------|---------------|
| Basic Cross-Chain Swap | Simple swap between any two chains | Standard |
| Privacy-Enhanced Swap | Swap with stealth addresses and timing delays | Enhanced |
| Maximum Privacy Swap | Full Privacy Hub with correlation breaking | Maximum |
| Multi-Hop Routing | Complex routes through multiple chains | Configurable |

For detailed use case implementations, see [SDK Use Cases](./use-cases/index.md).

## 4 SDK FAQ and Troubleshooting

Common questions and solutions for SDK integration issues.

See [FAQ and Troubleshooting](./faq.md).

## 5 SDK Reference Guide

Complete API documentation for all SDK components:

- [OmniSwap Class](./api-reference/omniswap.md)
- [Chain Adapters](./api-reference/adapters.md)
- [Privacy Hub](./api-reference/privacy-hub.md)
- [Error Handling](./api-reference/errors.md)
- [Type Definitions](./api-reference/types.md)

## 6 SDK How-tos

Step-by-step guides for common tasks:

- [How to Execute a Basic Swap](./how-to/basic-swap.md)
- [How to Execute a Privacy Swap](./how-to/privacy-swap.md)
- [How to Handle Errors and Retries](./how-to/error-handling.md)
- [How to Monitor and Refund HTLCs](./how-to/refund-monitoring.md)
- [How to Integrate with Wallets](./how-to/wallet-integration.md)

---

## Quick Links

- [GitHub Repository](https://github.com/omniswap/sdk)
- [npm Package](https://npmjs.com/package/omniswap-sdk)
- [Discord Community](https://discord.gg/omniswap)
- [Report Issues](https://github.com/omniswap/sdk/issues)
