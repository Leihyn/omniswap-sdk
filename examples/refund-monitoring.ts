/**
 * Refund Monitoring Example
 *
 * Demonstrates the automated refund manager that monitors
 * HTLCs and triggers refunds when timelocks expire.
 */

import { OmniSwap } from '../src/omniswap';
import { AdapterRegistry } from '../src/adapters';
import { RefundManager, createRefundManager } from '../src/core/refund-manager';
import {
  Chain,
  PrivacyLevel,
  IntentStatus,
  SwapIntent,
  Solver,
  HTLCState,
} from '../src/types';

async function main() {
  console.log('OmniSwap SDK - Refund Monitoring Example\n');
  console.log('This example demonstrates automated HTLC refund management.\n');

  // 1. Initialize the SDK and adapters
  console.log('1. Initializing SDK and adapters...');
  const omniswap = new OmniSwap();
  await omniswap.initialize({});

  const adapters = new AdapterRegistry();
  await adapters.initializeAll({});
  console.log('   SDK initialized\n');

  // 2. Create refund manager with custom configuration
  console.log('2. Creating refund manager...');
  const refundManager = createRefundManager(adapters, {
    checkIntervalMs: 10000, // Check every 10 seconds (demo)
    refundBufferMs: 5000,   // 5 second buffer after timelock
    maxConcurrentRefunds: 3,
    autoStart: false,       // We'll control monitoring manually

    onRefundAttempt: (swapId, chain, success) => {
      console.log(`   [Callback] Refund ${success ? 'SUCCESS' : 'FAILED'} for ${swapId} on ${chain}`);
    },

    onError: (error, context) => {
      console.log(`   [Error] ${error.message}`);
    },
  });
  console.log('   Refund manager created\n');

  // 3. Register some HTLCs for monitoring
  console.log('3. Registering HTLCs for monitoring...');

  // Simulate expired HTLC (timelock in the past)
  refundManager.registerHTLC({
    swapId: 'swap_expired_001',
    htlcId: 'htlc_expired_001',
    chain: Chain.ZCASH,
    timelock: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    amount: BigInt(1e8),
    refundAddress: 't1RefundAddress001',
  });
  console.log('   Registered expired HTLC (htlc_expired_001)');

  // Simulate HTLC expiring soon
  refundManager.registerHTLC({
    swapId: 'swap_soon_002',
    htlcId: 'htlc_soon_002',
    chain: Chain.OSMOSIS,
    timelock: Math.floor(Date.now() / 1000) + 10, // 10 seconds from now
    amount: BigInt(500e6),
    refundAddress: 'osmo1RefundAddress002',
  });
  console.log('   Registered soon-expiring HTLC (htlc_soon_002)');

  // Simulate future HTLC (not yet expired)
  refundManager.registerHTLC({
    swapId: 'swap_future_003',
    htlcId: 'htlc_future_003',
    chain: Chain.AZTEC,
    timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    amount: BigInt(1e18),
    refundAddress: '0xRefundAddress003',
  });
  console.log('   Registered future HTLC (htlc_future_003)\n');

  // 4. Check current status
  console.log('4. Current refund status:');
  const pending = refundManager.getPendingRefunds();
  console.log(`   Total pending: ${pending.length}`);

  for (const refund of pending) {
    const timelockDate = new Date(refund.timelock * 1000);
    const expired = refund.timelock <= Math.floor(Date.now() / 1000);
    console.log(`   - ${refund.htlcId}: ${expired ? 'EXPIRED' : 'active'} (expires: ${timelockDate.toISOString()})`);
  }

  // 5. Check eligible refunds
  console.log('\n5. Checking eligible refunds (timelock expired + buffer)...');
  const eligible = refundManager.getEligibleRefunds();
  console.log(`   Eligible for refund: ${eligible.length}`);

  for (const refund of eligible) {
    console.log(`   - ${refund.htlcId} on ${refund.chain}`);
  }

  // 6. Process eligible refunds
  console.log('\n6. Processing eligible refunds...');
  const results = await refundManager.checkRefunds();
  console.log(`   Processed: ${results.length} refund(s)`);

  for (const result of results) {
    console.log(`   - ${result.htlcId}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    if (result.txHash) {
      console.log(`     TX: ${result.txHash}`);
    }
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  }

  // 7. Get statistics
  console.log('\n7. Refund statistics:');
  const stats = refundManager.getStats();
  console.log(`   Pending: ${stats.pending}`);
  console.log(`   Processing: ${stats.processing}`);
  console.log(`   Completed: ${stats.completed}`);
  console.log(`   Failed: ${stats.failed}`);
  console.log(`   Total attempts: ${stats.totalAttempts}`);
  console.log(`   Success rate: ${(stats.successRate * 100).toFixed(1)}%`);

  // 8. Start automated monitoring
  console.log('\n8. Starting automated monitoring...');
  refundManager.startMonitoring();
  console.log('   Monitoring started (checking every 10 seconds)');

  // Let it run for a bit
  console.log('   Waiting 15 seconds for monitoring cycle...');
  await new Promise((resolve) => setTimeout(resolve, 15000));

  // 9. Stop monitoring
  console.log('\n9. Stopping monitoring...');
  refundManager.stopMonitoring();
  console.log('   Monitoring stopped');

  // 10. Final status
  console.log('\n10. Final status:');
  const finalStats = refundManager.getStats();
  console.log(`   Completed refunds: ${finalStats.completed}`);

  const history = refundManager.getRefundHistory();
  console.log(`   Total history entries: ${history.length}`);

  // 11. Cleanup
  console.log('\n11. Cleanup:');
  console.log('   Unregistering remaining HTLCs...');
  for (const refund of refundManager.getPendingRefunds()) {
    refundManager.unregisterHTLC(refund.htlcId);
    console.log(`   - Unregistered ${refund.htlcId}`);
  }

  // 12. Export state (for persistence)
  console.log('\n12. Exporting state (for persistence):');
  const state = refundManager.exportState();
  console.log(`   Pending refunds: ${state.pendingRefunds.length}`);
  console.log(`   History entries: ${state.refundHistory.length}`);

  // 13. Import state (restore from persistence)
  console.log('\n13. Importing state (restore from persistence):');
  const freshManager = createRefundManager(adapters);
  freshManager.importState(state);
  console.log(`   Restored ${freshManager.getPendingRefunds().length} pending refunds`);
  console.log(`   Restored ${freshManager.getRefundHistory().length} history entries`);

  console.log('\nRefund monitoring example complete!');
}

main().catch(console.error);
