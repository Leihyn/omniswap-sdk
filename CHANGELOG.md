# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-15

### Added
- Initial release of OmniSwap SDK
- Cross-chain atomic swaps using HTLC (Hash Time-Lock Contracts)
- Privacy Hub architecture for correlation-resistant swaps
- Stealth addresses (DKSAP) for transaction unlinkability
- CSPRNG + Log-Normal distributed timelocks for timing analysis prevention
- Support for 6 blockchains: Zcash, Osmosis, Fhenix, Aztec, Miden, Mina
- Chain-specific adapters with unified interface
- Automated refund management with RefundManager
- Comprehensive error handling with typed errors and retry logic
- 5 example implementations
- Full API documentation

### Security
- Different hashlocks for source/destination HTLCs
- Shielded mixing through Zcash Sapling pool
- Timing decorrelation to prevent transaction linking
