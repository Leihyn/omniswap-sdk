/**
 * Multi-Chain Swap Example
 *
 * Demonstrates swaps between all 6 supported blockchains
 * with different privacy technologies.
 */

import { OmniSwap } from '../src/omniswap';
import { AdapterRegistry } from '../src/adapters';
import {
  Chain,
  PrivacyLevel,
  IntentStatus,
  SwapIntent,
  Solver,
} from '../src/types';

// Chain information for display
const CHAIN_INFO: Record<Chain, { name: string; tech: string; currency: string }> = {
  [Chain.ZCASH]: { name: 'Zcash', tech: 'zkSNARKs (Sapling)', currency: 'ZEC' },
  [Chain.OSMOSIS]: { name: 'Osmosis', tech: 'Cosmos/IBC', currency: 'OSMO' },
  [Chain.FHENIX]: { name: 'Fhenix', tech: 'FHE (Homomorphic)', currency: 'FHE' },
  [Chain.AZTEC]: { name: 'Aztec', tech: 'zkSNARKs (Noir)', currency: 'ETH' },
  [Chain.MIDEN]: { name: 'Miden', tech: 'zkSTARKs', currency: 'MIDEN' },
  [Chain.MINA]: { name: 'Mina', tech: 'Kimchi Proofs', currency: 'MINA' },
};

async function displayChainInfo(adapters: AdapterRegistry) {
  console.log('=== Supported Blockchains ===\n');

  for (const chain of adapters.getSupportedChains()) {
    const info = CHAIN_INFO[chain];
    const adapter = adapters.get(chain);

    console.log(`${info.name} (${chain})`);
    console.log(`  Technology: ${info.tech}`);
    console.log(`  Currency: ${info.currency}`);
    console.log(`  Block time: ${adapter.getBlockTime() / 1000}s`);
    console.log();
  }
}

async function swapBetweenChains(
  omniswap: OmniSwap,
  sourceChain: Chain,
  destChain: Chain,
  solver: Solver
) {
  const sourceInfo = CHAIN_INFO[sourceChain];
  const destInfo = CHAIN_INFO[destChain];

  console.log(`\n--- ${sourceInfo.name} -> ${destInfo.name} ---`);

  const intent: SwapIntent = {
    id: `swap_${sourceChain}_${destChain}_${Date.now()}`,
    user: {
      id: 'multi_chain_user',
      addresses: {
        [sourceChain]: `addr_${sourceChain}`,
        [destChain]: `addr_${destChain}`,
      },
    },
    sourceChain,
    sourceAsset: {
      symbol: sourceInfo.currency,
      name: sourceInfo.name,
      decimals: 8,
      chain: sourceChain,
    },
    sourceAmount: BigInt(1e8),
    destChain,
    destAsset: {
      symbol: destInfo.currency,
      name: destInfo.name,
      decimals: 8,
      chain: destChain,
    },
    minDestAmount: BigInt(1e7),
    maxSlippage: 0.02,
    deadline: Date.now() + 3600000,
    privacyLevel: PrivacyLevel.ENHANCED,
    status: IntentStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  console.log(`  Finding routes...`);
  const routes = await omniswap.findRoutes(intent);
  console.log(`  Found ${routes.length} route(s)`);

  if (routes.length > 0) {
    const best = routes[0];
    console.log(`  Best route:`);
    console.log(`    Output: ${best.estimatedOutput}`);
    console.log(`    Time: ${best.estimatedTime}s`);
    console.log(`    Privacy: ${best.privacyScore}/100`);

    try {
      console.log(`  Executing swap...`);
      const execution = await omniswap.executeSwap(intent, solver);
      console.log(`  ✓ Swap completed: ${execution.state}`);
    } catch (error) {
      console.log(`  ✗ Swap failed: ${(error as Error).message}`);
    }
  }
}

async function privacyChainComparison(omniswap: OmniSwap) {
  console.log('\n=== Privacy Chain Comparison ===\n');

  const privacyChains = [Chain.ZCASH, Chain.AZTEC, Chain.MIDEN, Chain.MINA];

  for (const chain of privacyChains) {
    const info = CHAIN_INFO[chain];

    const intent: SwapIntent = {
      id: `privacy_${chain}`,
      user: { id: 'test', addresses: { [chain]: 'addr', [Chain.OSMOSIS]: 'osmo_addr' } },
      sourceChain: chain,
      sourceAsset: { symbol: info.currency, name: info.name, decimals: 8, chain },
      sourceAmount: BigInt(1e8),
      destChain: Chain.OSMOSIS,
      destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
      minDestAmount: BigInt(1e7),
      maxSlippage: 0.01,
      deadline: Date.now() + 3600000,
      privacyLevel: PrivacyLevel.MAXIMUM,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const route = await omniswap.findPrivateRoute(intent);
      console.log(`${info.name} -> Osmosis (privacy route)`);
      console.log(`  Technology: ${info.tech}`);
      console.log(`  Privacy score: ${route.privacyScore}/100`);
      console.log(`  Route hops: ${route.hops.length}`);
      console.log();
    } catch (error) {
      console.log(`${info.name}: No privacy route available`);
      console.log();
    }
  }
}

async function main() {
  console.log('OmniSwap SDK - Multi-Chain Swap Example\n');
  console.log('This example demonstrates swaps across all 6 supported chains.\n');

  // Initialize
  const omniswap = new OmniSwap();
  await omniswap.initialize({});

  const adapters = new AdapterRegistry();
  await adapters.initializeAll({});

  // Display chain information
  await displayChainInfo(adapters);

  // Create a universal solver
  const solver: Solver = {
    id: 'universal_solver',
    address: Object.fromEntries(
      adapters.getSupportedChains().map((chain) => [chain, `solver_addr_${chain}`])
    ),
    supportedPairs: [],
    inventory: Object.fromEntries(
      Object.values(CHAIN_INFO).map((info) => [info.currency, BigInt(1000000e8)])
    ),
    totalSwaps: 10000,
    successRate: 0.998,
    averageTime: 600,
    stakeAmount: BigInt(1000000),
    feeRate: 0.003,
  };

  // Example swaps between different chain types
  console.log('=== Cross-Chain Swaps ===');

  // Privacy -> DeFi
  await swapBetweenChains(omniswap, Chain.ZCASH, Chain.OSMOSIS, solver);

  // L2 -> L2 (privacy)
  await swapBetweenChains(omniswap, Chain.AZTEC, Chain.MIDEN, solver);

  // FHE -> zkSNARK
  await swapBetweenChains(omniswap, Chain.FHENIX, Chain.AZTEC, solver);

  // zkSTARK -> Succinct
  await swapBetweenChains(omniswap, Chain.MIDEN, Chain.MINA, solver);

  // Compare privacy routes
  await privacyChainComparison(omniswap);

  // Summary
  console.log('=== Summary ===\n');
  console.log('Supported swap combinations: 30 (6 chains × 5 destinations)');
  console.log('Privacy technologies: 5 (zkSNARKs, zkSTARKs, FHE, Kimchi, shielded)');
  console.log('All swaps use HTLC for atomic execution');
  console.log('Privacy Hub breaks correlation for maximum privacy');

  console.log('\nMulti-chain example complete!');
}

main().catch(console.error);
