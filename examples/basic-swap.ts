/**
 * Basic Swap Example
 *
 * Demonstrates a simple cross-chain swap from Zcash to Osmosis
 * using the OmniSwap SDK.
 */

import { OmniSwap } from '../src/omniswap';
import {
  Chain,
  PrivacyLevel,
  IntentStatus,
  SwapIntent,
  Solver,
} from '../src/types';

async function main() {
  console.log('OmniSwap SDK - Basic Swap Example\n');

  // 1. Initialize the SDK
  console.log('1. Initializing SDK...');
  const omniswap = new OmniSwap();

  await omniswap.initialize({
    [Chain.ZCASH]: { rpcUrl: 'http://localhost:8232' },
    [Chain.OSMOSIS]: { rpcUrl: 'http://localhost:26657' },
  });
  console.log('   SDK initialized successfully\n');

  // 2. Create a swap intent
  console.log('2. Creating swap intent...');
  const intent: SwapIntent = {
    id: `swap_${Date.now()}`,
    user: {
      id: 'example_user',
      addresses: {
        [Chain.ZCASH]: 't1exampleZcashAddress123456789',
        [Chain.OSMOSIS]: 'osmo1exampleOsmosisAddress123456789',
      },
    },
    sourceChain: Chain.ZCASH,
    sourceAsset: {
      symbol: 'ZEC',
      name: 'Zcash',
      decimals: 8,
      chain: Chain.ZCASH,
    },
    sourceAmount: BigInt(1e8), // 1 ZEC
    destChain: Chain.OSMOSIS,
    destAsset: {
      symbol: 'OSMO',
      name: 'Osmosis',
      decimals: 6,
      chain: Chain.OSMOSIS,
    },
    minDestAmount: BigInt(100e6), // 100 OSMO minimum
    maxSlippage: 0.01, // 1% max slippage
    deadline: Date.now() + 3600000, // 1 hour deadline
    privacyLevel: PrivacyLevel.STANDARD,
    status: IntentStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  console.log(`   Intent ID: ${intent.id}`);
  console.log(`   From: ${intent.sourceAmount} ZEC`);
  console.log(`   To: ${intent.minDestAmount}+ OSMO\n`);

  // 3. Find available routes
  console.log('3. Finding routes...');
  const routes = await omniswap.findRoutes(intent);
  console.log(`   Found ${routes.length} route(s)\n`);

  if (routes.length === 0) {
    console.log('No routes available for this swap');
    return;
  }

  // Display best route
  const bestRoute = routes[0];
  console.log('   Best route:');
  console.log(`   - Estimated output: ${bestRoute.estimatedOutput} OSMO`);
  console.log(`   - Total fees: ${bestRoute.estimatedFees.total}`);
  console.log(`   - Estimated time: ${bestRoute.estimatedTime} seconds`);
  console.log(`   - Privacy score: ${bestRoute.privacyScore}/100\n`);

  // 4. Mock solver for demonstration
  const solver: Solver = {
    id: 'example_solver',
    address: {
      [Chain.ZCASH]: 't1solverZcashAddress123456789',
      [Chain.OSMOSIS]: 'osmo1solverOsmosisAddress123456789',
    },
    supportedPairs: [],
    inventory: {
      OSMO: BigInt(10000e6), // 10,000 OSMO inventory
    },
    totalSwaps: 1000,
    successRate: 0.995,
    averageTime: 600,
    stakeAmount: BigInt(100000),
    feeRate: 0.003,
  };

  // 5. Execute the swap
  console.log('4. Executing swap...');
  try {
    const execution = await omniswap.executeSwap(intent, solver);

    console.log(`   Swap completed!`);
    console.log(`   Swap ID: ${execution.swapId}`);
    console.log(`   State: ${execution.state}`);
    console.log(`   Steps completed: ${execution.steps.length}`);

    // Display transaction hashes
    console.log('\n   Transaction hashes:');
    for (const [chain, txHash] of Object.entries(execution.txHashes)) {
      console.log(`   - ${chain}: ${txHash}`);
    }
  } catch (error) {
    console.error('   Swap failed:', (error as Error).message);
  }

  console.log('\nExample complete!');
}

main().catch(console.error);
