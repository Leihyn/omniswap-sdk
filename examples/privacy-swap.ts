/**
 * Privacy-Enhanced Swap Example
 *
 * Demonstrates a maximum privacy swap using the Privacy Hub architecture
 * with stealth addresses and timing decorrelation.
 */

import { OmniSwap } from '../src/omniswap';
import {
  PrivacyHubCoordinator,
  StealthAddressGenerator,
  TIMELOCK_CONFIG,
} from '../src/core/privacy-hub';
import { AdapterRegistry } from '../src/adapters';
import {
  Chain,
  PrivacyLevel,
  IntentStatus,
  SwapIntent,
  Solver,
} from '../src/types';

async function main() {
  console.log('OmniSwap SDK - Privacy-Enhanced Swap Example\n');
  console.log('This example demonstrates the Privacy Hub architecture');
  console.log('that breaks on-chain correlation between transactions.\n');

  // 1. Initialize the SDK
  console.log('1. Initializing SDK...');
  const omniswap = new OmniSwap();

  await omniswap.initialize({
    [Chain.ZCASH]: { rpcUrl: 'http://localhost:8232' },
    [Chain.OSMOSIS]: { rpcUrl: 'http://localhost:26657' },
  });
  console.log('   SDK initialized\n');

  // 2. Display timelock configuration
  console.log('2. Timelock Configuration (CSPRNG + Log-Normal):');
  console.log('   Source HTLC:');
  console.log(`   - Min: ${TIMELOCK_CONFIG.source.minSeconds}s (${TIMELOCK_CONFIG.source.minSeconds / 60} min)`);
  console.log(`   - Median: ${TIMELOCK_CONFIG.source.medianSeconds}s (${TIMELOCK_CONFIG.source.medianSeconds / 60} min)`);
  console.log(`   - Max: ${TIMELOCK_CONFIG.source.maxSeconds}s (${TIMELOCK_CONFIG.source.maxSeconds / 60} min)`);
  console.log(`   - Sigma: ${TIMELOCK_CONFIG.source.sigma}`);
  console.log('   Destination HTLC:');
  console.log(`   - Min: ${TIMELOCK_CONFIG.destination.minSeconds}s (${TIMELOCK_CONFIG.destination.minSeconds / 60} min)`);
  console.log(`   - Median: ${TIMELOCK_CONFIG.destination.medianSeconds}s (${TIMELOCK_CONFIG.destination.medianSeconds / 60} min)`);
  console.log(`   - Max: ${TIMELOCK_CONFIG.destination.maxSeconds}s (${TIMELOCK_CONFIG.destination.maxSeconds / 60} min)`);
  console.log(`   - Sigma: ${TIMELOCK_CONFIG.destination.sigma}\n`);

  // 3. Generate stealth addresses
  console.log('3. Generating stealth addresses...');
  const stealthGenerator = new StealthAddressGenerator();

  const userStealth = await stealthGenerator.generate(Chain.ZCASH, 't1baseUserAddress');
  const solverStealth = await stealthGenerator.generate(Chain.OSMOSIS, 'osmo1baseSolverAddress');

  console.log('   User stealth address (Zcash):');
  console.log(`   - Address: ${userStealth.address}`);
  console.log(`   - Ephemeral key: ${userStealth.ephemeralPublicKey.slice(0, 32)}...`);

  console.log('   Solver stealth address (Osmosis):');
  console.log(`   - Address: ${solverStealth.address}`);
  console.log(`   - Ephemeral key: ${solverStealth.ephemeralPublicKey.slice(0, 32)}...\n`);

  // 4. Create privacy-enhanced swap intent
  console.log('4. Creating privacy-enhanced swap intent...');
  const intent: SwapIntent = {
    id: `private_swap_${Date.now()}`,
    user: {
      id: 'privacy_user',
      addresses: {
        [Chain.ZCASH]: 't1userPrivateAddress',
        [Chain.OSMOSIS]: 'osmo1userPrivateAddress',
      },
    },
    sourceChain: Chain.ZCASH,
    sourceAsset: {
      symbol: 'ZEC',
      name: 'Zcash',
      decimals: 8,
      chain: Chain.ZCASH,
    },
    sourceAmount: BigInt(5e8), // 5 ZEC
    destChain: Chain.OSMOSIS,
    destAsset: {
      symbol: 'OSMO',
      name: 'Osmosis',
      decimals: 6,
      chain: Chain.OSMOSIS,
    },
    minDestAmount: BigInt(500e6), // 500 OSMO minimum
    maxSlippage: 0.01,
    deadline: Date.now() + 7200000, // 2 hour deadline
    privacyLevel: PrivacyLevel.MAXIMUM, // <-- Maximum privacy
    status: IntentStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  console.log(`   Intent ID: ${intent.id}`);
  console.log(`   Privacy Level: ${intent.privacyLevel}`);
  console.log(`   From: ${intent.sourceAmount} ZEC`);
  console.log(`   To: ${intent.minDestAmount}+ OSMO\n`);

  // 5. Find privacy-optimized route
  console.log('5. Finding privacy-optimized route...');
  const privateRoute = await omniswap.findPrivateRoute(intent);
  console.log(`   Privacy score: ${privateRoute.privacyScore}/100`);
  console.log(`   Route hops: ${privateRoute.hops.length}\n`);

  // 6. Mock solver
  const solver: Solver = {
    id: 'privacy_solver',
    address: {
      [Chain.ZCASH]: 't1solverPrivateAddress',
      [Chain.OSMOSIS]: 'osmo1solverPrivateAddress',
    },
    supportedPairs: [],
    inventory: { OSMO: BigInt(50000e6) },
    totalSwaps: 5000,
    successRate: 0.999,
    averageTime: 900,
    stakeAmount: BigInt(500000),
    feeRate: 0.005, // Higher fee for privacy
  };

  // 7. Execute privacy-enhanced swap
  console.log('6. Executing privacy-enhanced swap...');
  try {
    const execution = await omniswap.executePrivateSwap(intent, solver);

    console.log('   Privacy swap completed!');
    console.log(`   Swap ID: ${execution.swapId}`);

    // Display privacy features
    console.log('\n   Privacy features verified:');
    console.log(`   ✓ Correlation broken: ${execution.correlationBroken}`);
    console.log(`   ✓ Timing decorrelated: ${execution.timingDecorrelated}`);
    console.log(`   ✓ One-time addresses: ${execution.addressesOneTime}`);

    // Display state
    console.log('\n   Swap state:');
    console.log(`   - Source hashlock: ${execution.state.sourceHashlock.toString('hex').slice(0, 32)}...`);
    console.log(`   - Dest hashlock: ${execution.state.destHashlock.toString('hex').slice(0, 32)}...`);
    console.log(`   - Hashlocks different: ${
      execution.state.sourceHashlock.toString('hex') !== execution.state.destHashlock.toString('hex')
    }`);

    console.log(`\n   Source timelock: ${new Date(execution.state.sourceTimelock * 1000).toISOString()}`);
    console.log(`   Dest timelock: ${new Date(execution.state.destTimelock * 1000).toISOString()}`);

  } catch (error) {
    console.error('   Privacy swap failed:', (error as Error).message);
  }

  // 8. Explain privacy guarantees
  console.log('\n7. Privacy Guarantees:');
  console.log('   - Different hashlocks prevent on-chain correlation');
  console.log('   - Stealth addresses prevent address reuse analysis');
  console.log('   - Random delays prevent timing correlation');
  console.log('   - Zcash shielded pool provides mixing');
  console.log('   - No observer can link source and destination transactions');

  console.log('\nPrivacy example complete!');
}

main().catch(console.error);
