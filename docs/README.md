# OmniSwap SDK Documentation

Welcome to the OmniSwap SDK documentation. This comprehensive guide will help you integrate cross-chain privacy swaps into your application.

## Documentation Structure

The OmniSwap SDK documentation is divided into the following sections:

### 1. Introduction

**[SDK Introduction](./01-introduction.md)** - Get started with OmniSwap SDK

Learn about:
- What is OmniSwap SDK
- Key features and capabilities
- Architecture overview
- Supported blockchains
- Installation and setup
- Quick start guide

### 2. SDK Introduction

**[SDK Deep Dive](./02-use-cases.md)** - Real-world applications

Discover:
- Cross-chain DEX applications
- Privacy-focused wallets
- DeFi protocols
- Payment systems
- Use case patterns
- Integration examples

### 3. SDK Use Cases

**[Use Cases](./02-use-cases.md)** - Common usage patterns

Explore:
- Simple cross-chain swaps
- Privacy-enhanced swaps
- Multi-hop routing
- Batch swaps
- MEV protection
- Integration patterns

### 4. SDK FAQ and Troubleshooting

**[FAQ & Troubleshooting](./05-faq.md)** - Common questions and solutions

Find answers to:
- Common errors and solutions
- Performance optimization
- Security best practices
- Debugging tips
- Network issues
- Chain-specific considerations

### 5. SDK Reference Guide

**[API Reference](./03-api-reference.md)** - Complete API documentation

Detailed reference for:
- OmniSwap class
- Chain adapters
- Core components
- Types and interfaces
- Error handling
- Utilities

### 6. SDK How-tos

**[How-To Guides](./04-how-to-guides.md)** - Step-by-step tutorials

Learn how to:
- Perform basic swaps
- Execute privacy swaps
- Handle errors and retries
- Monitor swap status
- Implement refunds
- Integrate with wallets
- Build custom solvers

## Quick Navigation

### For New Users
1. Start with [Introduction](./01-introduction.md)
2. Review [Use Cases](./02-use-cases.md) to find your scenario
3. Follow [Quick Start Guide](./01-introduction.md#quick-start)
4. Check [Examples](../examples/) for code samples

### For Developers
1. Review [API Reference](./03-api-reference.md)
2. Explore [How-To Guides](./04-how-to-guides.md)
3. Study [Examples](../examples/)
4. Refer to [FAQ](./05-faq.md) for troubleshooting

### For Integrators
1. Understand [Architecture](./01-introduction.md#architecture)
2. Review [Use Cases](./02-use-cases.md)
3. Implement using [How-To Guides](./04-how-to-guides.md)
4. Test with examples in [Examples](../examples/)

## Code Examples

Complete working examples are available in the [`examples/`](../examples/) directory:

- **[basic-swap.ts](../examples/basic-swap.ts)** - Simple cross-chain swap
- **[privacy-swap.ts](../examples/privacy-swap.ts)** - Maximum privacy swap
- **[error-handling.ts](../examples/error-handling.ts)** - Error handling patterns
- **[refund-monitoring.ts](../examples/refund-monitoring.ts)** - Monitoring and refunds
- **[multi-chain.ts](../examples/multi-chain.ts)** - Multi-hop swaps

## Additional Resources

### Technical Articles
- [Why HTLC for Privacy Cross-Chain](../articles/why-htlc-for-privacy-cross-chain.md)
- [Intent Blind Matching Analysis](../articles/intent-blind-matching-analysis.md)
- [Timelock Privacy with CSPRNG Log-Normal](../articles/timelock-privacy-csprng-lognormal.md)

### API Client
The SDK can be used with:
- **Local execution**: Execute swaps directly through chain adapters
- **API execution**: Use OmniSwap API for quote aggregation and solver matching
- **Hybrid mode**: Quotes from API, execution via local adapters

### Support
- **GitHub Issues**: Report bugs or request features
- **Discord**: Join our community for real-time help
- **Email**: support@omniswap.io for enterprise support

## Version Information

This documentation is for OmniSwap SDK version 1.0.0.

For older versions, see the [release notes](../CHANGELOG.md).

## Contributing to Documentation

Found an error or want to improve the docs? Contributions are welcome!

1. Fork the repository
2. Make your changes
3. Submit a pull request

See [Contributing Guide](../CONTRIBUTING.md) for more details.
