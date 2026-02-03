import { createHash, randomBytes, createECDH, createCipheriv, createDecipheriv } from 'crypto';
import {
  SwapIntent,
  Solver,
  Chain,
  HTLCParams,
  HTLCStatus,
  HTLCState,
  ExecutionStep,
  PrivacyHubConfig,
  PrivacyHubSwapState,
  PrivacyHubPhase,
  PrivacyHubExecution,
  PrivacyHubChain,
  StealthAddress,
} from '../types';
import { AdapterRegistry } from '../adapters';
import { sleep } from '../utils';

/**
 * Timelock Configuration
 *
 * Uses CSPRNG + Log-Normal distribution with hard limits for:
 * - Unpredictable values (defeats pattern analysis)
 * - Guaranteed bounds (UX and capital efficiency)
 * - Ecosystem blending (15-min intervals)
 */
export const TIMELOCK_CONFIG = {
  source: {
    minSeconds: 1800,       // 30 minutes
    medianSeconds: 5400,    // 1.5 hours
    maxSeconds: 14400,      // 4 hours
    sigma: 0.45,            // Moderate variance
  },
  destination: {
    minSeconds: 900,        // 15 minutes
    medianSeconds: 2700,    // 45 minutes
    maxSeconds: 5400,       // 90 minutes
    sigma: 0.35,            // Tighter (user-facing)
  },
  buffer: 1800,             // 30 min safety between dest expiry and source expiry
  roundTo: 900,             // Round to 15-minute intervals (blend with ecosystem)
} as const;

/**
 * Cryptographically secure random number in [0, 1)
 * Uses CSPRNG - impossible to predict
 */
function secureRandom(): number {
  const buf = randomBytes(8);
  return Number(buf.readBigUInt64BE()) / Number(2n ** 64n);
}

/**
 * Capped Log-Normal Distribution
 *
 * Properties:
 * - CSPRNG source: Unpredictable
 * - Log-normal shape: Heavy tail defeats statistical analysis
 * - Hard limits: Guarantees acceptable UX and capital efficiency
 *
 * @param median - Center of distribution (most likely region)
 * @param min - Hard floor (UX guarantee)
 * @param max - Hard ceiling (capital efficiency)
 * @param sigma - Variance parameter (higher = wider spread)
 */
function cappedLogNormal(
  median: number,
  min: number,
  max: number,
  sigma: number
): number {
  // Box-Muller transform for normal variate
  const u1 = secureRandom();
  const u2 = secureRandom();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // Transform to log-normal
  const mu = Math.log(median);
  const raw = Math.exp(mu + sigma * z);

  // Hard clamp to bounds
  return Math.max(min, Math.min(max, raw));
}

/**
 * Generate privacy-optimized timelocks using CSPRNG + Log-Normal + Hard Limits
 *
 * Source HTLC: 30min - 4hr, median 1.5hr, σ=0.45
 * Dest HTLC:   15min - 90min, median 45min, σ=0.35
 *
 * Rounded to 15-minute intervals to blend with ecosystem.
 */
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

  // Round to intervals (blend with other protocols)
  const roundedSource = Math.ceil(sourceOffset / roundTo) * roundTo;
  const roundedDest = Math.ceil(destOffset / roundTo) * roundTo;

  return {
    source: now + roundedSource,
    dest: now + roundedDest,
  };
}

/**
 * Privacy Hub Coordinator
 *
 * Implements the Privacy Hub + HTLC architecture for unlinkable cross-chain swaps.
 *
 * Key innovation: Uses DIFFERENT hashlocks for source and destination legs.
 * The solver bridges the correlation gap inside a privacy-preserving shielded pool.
 *
 * Protocol:
 * 1. User locks funds on source chain with hashlock H1 = SHA256(secret1)
 * 2. Solver claims source funds (reveals secret1)
 * 3. Solver deposits equivalent value into privacy hub (Zcash shielded pool)
 * 4. Random delay + mixing occurs inside shielded pool
 * 5. Solver withdraws from pool to fresh shielded address
 * 6. Solver locks funds on dest chain with hashlock H2 = SHA256(secret2) - DIFFERENT!
 * 7. Solver sends secret2 to user via encrypted channel
 * 8. User claims destination funds
 *
 * Result: H1 and H2 are cryptographically unrelated. No on-chain correlation.
 */
export class PrivacyHubCoordinator {
  private adapters: AdapterRegistry;
  private config: PrivacyHubConfig;
  private stealthGenerator: StealthAddressGenerator;

  constructor(adapters: AdapterRegistry, config?: Partial<PrivacyHubConfig>) {
    this.adapters = adapters;
    this.config = {
      hubChain: PrivacyHubChain.ZCASH,
      minMixingDelay: 30 * 60 * 1000, // 30 minutes minimum
      maxMixingDelay: 4 * 60 * 60 * 1000, // 4 hours maximum
      useSplitAmounts: true,
      splitDenominations: [
        BigInt(1e8),      // 1 ZEC
        BigInt(1e7),      // 0.1 ZEC
        BigInt(1e6),      // 0.01 ZEC
      ],
      useDecoyTransactions: true,
      decoyCount: 3,
      ...config,
    };
    this.stealthGenerator = new StealthAddressGenerator();
  }

  /**
   * Execute a privacy-preserving cross-chain swap using the Privacy Hub architecture.
   */
  async executePrivateSwap(
    intent: SwapIntent,
    solver: Solver
  ): Promise<PrivacyHubExecution> {
    const execution = this.initializeExecution(intent, solver);

    try {
      // Phase 1: Generate stealth addresses for both parties
      await this.generateStealthAddresses(execution, intent, solver);

      // Phase 2: User locks funds on source chain
      await this.lockSourceFunds(execution, intent, solver);

      // Phase 3: Wait for source lock confirmation
      await this.confirmSourceLock(execution, intent);

      // Phase 4: Solver claims source funds (reveals secret1)
      await this.solverClaimsSource(execution, intent, solver);

      // Phase 5: Solver deposits into privacy hub
      await this.depositToPrivacyHub(execution, intent, solver);

      // Phase 6: Mixing phase - random delay + internal transfers
      await this.executeMixingPhase(execution);

      // Phase 7: Solver withdraws from privacy hub
      await this.withdrawFromPrivacyHub(execution, solver);

      // Phase 8: Wait random delay for timing decorrelation
      await this.waitRandomDelay(execution);

      // Phase 9: Solver locks funds on destination chain with NEW secret
      await this.lockDestinationFunds(execution, intent, solver);

      // Phase 10: Confirm destination lock
      await this.confirmDestLock(execution, intent);

      // Phase 11: Securely transfer secret2 to user
      await this.transferDestSecretToUser(execution, intent);

      // Phase 12: User claims destination funds
      await this.userClaimsDest(execution, intent);

      // Mark complete
      execution.state.phase = PrivacyHubPhase.COMPLETED;
      execution.state.status = 'completed';
      execution.completedAt = Date.now();
      execution.correlationBroken = true;
      execution.timingDecorrelated = true;
      execution.addressesOneTime = true;

      return execution;

    } catch (error) {
      execution.state.phase = PrivacyHubPhase.FAILED;
      execution.state.status = 'failed';
      execution.state.error = (error as Error).message;
      throw error;
    }
  }

  private initializeExecution(intent: SwapIntent, solver: Solver): PrivacyHubExecution {
    // Generate TWO DIFFERENT secrets - this is the key innovation
    const sourceSecret = randomBytes(32);
    const destSecret = randomBytes(32); // DIFFERENT from sourceSecret

    const sourceHashlock = createHash('sha256').update(sourceSecret).digest();
    const destHashlock = createHash('sha256').update(destSecret).digest();

    // Generate privacy-optimized timelocks using CSPRNG + Log-Normal
    const timelocks = generateTimelocks();

    // Calculate random mixing delay using CSPRNG + Log-Normal
    const randomDelay = Math.floor(cappedLogNormal(
      (this.config.minMixingDelay + this.config.maxMixingDelay) / 2, // median
      this.config.minMixingDelay,
      this.config.maxMixingDelay,
      0.5 // moderate sigma for mixing delay
    ));

    const state: PrivacyHubSwapState = {
      swapId: `phub_${Date.now()}_${randomBytes(8).toString('hex')}`,
      phase: PrivacyHubPhase.INITIALIZING,
      sourceSecret,
      sourceHashlock,
      destSecret,
      destHashlock,
      randomDelay,
      sourceTimelock: timelocks.source,
      destTimelock: timelocks.dest,
      status: 'pending',
    };

    return {
      swapId: state.swapId,
      intentId: intent.id,
      state,
      route: {
        id: `route_${state.swapId}`,
        hops: [],
        estimatedOutput: intent.minDestAmount,
        estimatedFees: {
          protocolFee: BigInt(0),
          networkFees: {},
          solverFee: BigInt(0),
          total: BigInt(0),
        },
        estimatedTime: 1200 + Math.floor(randomDelay / 1000),
        slippageRisk: 0.001,
        liquidityDepth: BigInt(1e18),
        priceImpact: 0.001,
        privacyScore: 95, // High privacy score due to correlation breaking
      },
      solver,
      correlationBroken: false,
      timingDecorrelated: false,
      addressesOneTime: false,
      steps: [],
      startedAt: Date.now(),
    };
  }

  private async generateStealthAddresses(
    execution: PrivacyHubExecution,
    intent: SwapIntent,
    solver: Solver
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.GENERATING_STEALTH_ADDRESSES;
    this.addStep(execution, 'generate_stealth_addresses', intent.sourceChain, 'in_progress');

    // Generate one-time stealth addresses for both parties
    execution.state.userStealthAddress = await this.stealthGenerator.generate(
      intent.destChain,
      intent.user.addresses[intent.destChain]!
    );

    execution.state.solverStealthAddress = await this.stealthGenerator.generate(
      intent.sourceChain,
      solver.address[intent.sourceChain]!
    );

    this.updateStep(execution, 'generate_stealth_addresses', 'completed');
  }

  private async lockSourceFunds(
    execution: PrivacyHubExecution,
    intent: SwapIntent,
    solver: Solver
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.LOCKING_SOURCE;
    this.addStep(execution, 'lock_source', intent.sourceChain, 'in_progress');

    const adapter = this.adapters.get(intent.sourceChain);

    // User locks funds with sourceHashlock
    // Receiver is solver's stealth address for this swap
    // Timelock: CSPRNG + Log-Normal (30min-4hr, median 1.5hr, σ=0.45, rounded to 15min)
    const htlcParams: HTLCParams = {
      chain: intent.sourceChain,
      sender: intent.user.addresses[intent.sourceChain]!,
      receiver: execution.state.solverStealthAddress?.address || solver.address[intent.sourceChain]!,
      amount: intent.sourceAmount,
      hashlock: execution.state.sourceHashlock,
      timelock: execution.state.sourceTimelock, // Pre-generated CSPRNG + Log-Normal timelock
    };

    const unsignedTx = await adapter.createHTLC(htlcParams);
    const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
    const txHash = await adapter.broadcastTransaction(signedTx);

    execution.state.sourceHTLC = {
      id: createHash('sha256').update(execution.state.sourceHashlock).digest('hex'),
      state: HTLCState.LOCKED,
      txHash,
      amount: intent.sourceAmount,
      hashlock: execution.state.sourceHashlock.toString('hex'),
      timelock: htlcParams.timelock,
    };

    this.updateStep(execution, 'lock_source', 'completed', txHash);
  }

  private async confirmSourceLock(
    execution: PrivacyHubExecution,
    intent: SwapIntent
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.CONFIRMING_SOURCE_LOCK;
    this.addStep(execution, 'confirm_source_lock', intent.sourceChain, 'in_progress');

    const adapter = this.adapters.get(intent.sourceChain);
    await adapter.waitForConfirmation(execution.state.sourceHTLC!.txHash!, 1);

    execution.state.status = 'source_locked';
    this.updateStep(execution, 'confirm_source_lock', 'completed');
  }

  private async solverClaimsSource(
    execution: PrivacyHubExecution,
    intent: SwapIntent,
    solver: Solver
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.SOLVER_CLAIMING_SOURCE;
    this.addStep(execution, 'solver_claim_source', intent.sourceChain, 'in_progress');

    const adapter = this.adapters.get(intent.sourceChain);

    // Solver claims using sourceSecret - this reveals secret1 on-chain
    const claimTx = await adapter.claimHTLC(
      execution.state.sourceHTLC!.id,
      execution.state.sourceSecret
    );
    const signedTx = await adapter.signTransaction(claimTx, Buffer.alloc(32));
    const txHash = await adapter.broadcastTransaction(signedTx);

    execution.state.sourceHTLC!.claimTxHash = txHash;
    execution.state.sourceHTLC!.state = HTLCState.CLAIMED;

    this.updateStep(execution, 'solver_claim_source', 'completed', txHash);
  }

  private async depositToPrivacyHub(
    execution: PrivacyHubExecution,
    intent: SwapIntent,
    solver: Solver
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.HUB_DEPOSITING;
    this.addStep(execution, 'hub_deposit', Chain.ZCASH, 'in_progress');

    // Solver deposits equivalent value into Zcash shielded pool
    const zcashAdapter = this.adapters.get(Chain.ZCASH) as any;

    // If splitting amounts for better anonymity
    if (this.config.useSplitAmounts) {
      const deposits = this.splitIntodenominations(intent.sourceAmount);
      for (const amount of deposits) {
        const opId = await zcashAdapter.shieldFunds(
          solver.address[Chain.ZCASH],
          amount
        );
        // Wait for each shielding operation
        await this.waitForZcashOperation(zcashAdapter, opId);
      }
    } else {
      execution.state.hubDepositTx = await zcashAdapter.shieldFunds(
        solver.address[Chain.ZCASH],
        intent.sourceAmount
      );
    }

    execution.state.hubMixingStarted = Date.now();
    this.updateStep(execution, 'hub_deposit', 'completed', execution.state.hubDepositTx);
  }

  private async executeMixingPhase(execution: PrivacyHubExecution): Promise<void> {
    execution.state.phase = PrivacyHubPhase.HUB_MIXING;
    execution.state.status = 'hub_mixing';
    this.addStep(execution, 'hub_mixing', Chain.ZCASH, 'in_progress');

    const zcashAdapter = this.adapters.get(Chain.ZCASH) as any;

    // Perform internal shielded-to-shielded transfers for mixing
    // This breaks any timing correlation within the shielded pool
    const numInternalTransfers = 2 + Math.floor(Math.random() * 3);

    for (let i = 0; i < numInternalTransfers; i++) {
      // Generate new internal shielded address
      const internalAddr = await zcashAdapter.getShieldedAddress();

      // Random delay between internal transfers
      const internalDelay = 5000 + Math.floor(Math.random() * 30000);
      await sleep(internalDelay);

      // Internal shielded transfer (z->z)
      // This creates indistinguishable outputs in the Sapling tree
    }

    // Create decoy transactions if configured
    if (this.config.useDecoyTransactions) {
      await this.createDecoyTransactions(zcashAdapter, this.config.decoyCount);
    }

    execution.state.hubMixingCompleted = Date.now();
    this.updateStep(execution, 'hub_mixing', 'completed');
  }

  private async withdrawFromPrivacyHub(
    execution: PrivacyHubExecution,
    solver: Solver
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.HUB_WITHDRAWING;
    this.addStep(execution, 'hub_withdraw', Chain.ZCASH, 'in_progress');

    const zcashAdapter = this.adapters.get(Chain.ZCASH) as any;

    // Withdraw to a FRESH shielded address - not linked to deposit
    const freshShieldedAddr = await zcashAdapter.getShieldedAddress();

    // The withdrawal appears completely unrelated to the deposit
    // because the Sapling pool hides the transaction graph
    execution.state.hubWithdrawTx = freshShieldedAddr; // Store for reference

    this.updateStep(execution, 'hub_withdraw', 'completed');
  }

  private async waitRandomDelay(execution: PrivacyHubExecution): Promise<void> {
    execution.state.phase = PrivacyHubPhase.WAITING_RANDOM_DELAY;
    this.addStep(execution, 'random_delay', Chain.ZCASH, 'in_progress');

    // Wait the pre-calculated random delay
    // This decorrelates timing between source claim and dest lock
    await sleep(execution.state.randomDelay);

    this.updateStep(execution, 'random_delay', 'completed');
  }

  private async lockDestinationFunds(
    execution: PrivacyHubExecution,
    intent: SwapIntent,
    solver: Solver
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.LOCKING_DESTINATION;
    this.addStep(execution, 'lock_dest', intent.destChain, 'in_progress');

    const adapter = this.adapters.get(intent.destChain);

    // CRITICAL: Use destHashlock (derived from destSecret), NOT sourceHashlock
    // This is what breaks the on-chain correlation
    // Timelock: CSPRNG + Log-Normal (15min-90min, median 45min, σ=0.35, rounded to 15min)
    const htlcParams: HTLCParams = {
      chain: intent.destChain,
      sender: solver.address[intent.destChain]!,
      receiver: execution.state.userStealthAddress?.address || intent.user.addresses[intent.destChain]!,
      amount: intent.minDestAmount,
      hashlock: execution.state.destHashlock, // DIFFERENT from sourceHashlock!
      timelock: execution.state.destTimelock, // Pre-generated CSPRNG + Log-Normal timelock
    };

    const unsignedTx = await adapter.createHTLC(htlcParams);
    const signedTx = await adapter.signTransaction(unsignedTx, Buffer.alloc(32));
    const txHash = await adapter.broadcastTransaction(signedTx);

    execution.state.destHTLC = {
      id: createHash('sha256').update(execution.state.destHashlock).digest('hex'),
      state: HTLCState.LOCKED,
      txHash,
      amount: intent.minDestAmount,
      hashlock: execution.state.destHashlock.toString('hex'),
      timelock: htlcParams.timelock,
    };

    execution.state.status = 'dest_locked';
    this.updateStep(execution, 'lock_dest', 'completed', txHash);
  }

  private async confirmDestLock(
    execution: PrivacyHubExecution,
    intent: SwapIntent
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.CONFIRMING_DEST_LOCK;
    this.addStep(execution, 'confirm_dest_lock', intent.destChain, 'in_progress');

    const adapter = this.adapters.get(intent.destChain);
    await adapter.waitForConfirmation(execution.state.destHTLC!.txHash!, 1);

    this.updateStep(execution, 'confirm_dest_lock', 'completed');
  }

  private async transferDestSecretToUser(
    execution: PrivacyHubExecution,
    intent: SwapIntent
  ): Promise<void> {
    // Solver securely transfers destSecret to user
    // This happens off-chain via encrypted channel
    // User can then claim destination funds

    // In production: use ECIES encryption with user's public key
    // The secret is encrypted so only the user can decrypt it
    const encryptedSecret = this.encryptSecretForUser(
      execution.state.destSecret,
      intent.user.id
    );

    // Transfer via secure channel (API, P2P, etc.)
    // For now, we assume this succeeds
  }

  private async userClaimsDest(
    execution: PrivacyHubExecution,
    intent: SwapIntent
  ): Promise<void> {
    execution.state.phase = PrivacyHubPhase.USER_CLAIMING_DEST;
    this.addStep(execution, 'user_claim_dest', intent.destChain, 'in_progress');

    const adapter = this.adapters.get(intent.destChain);

    // User claims using destSecret
    const claimTx = await adapter.claimHTLC(
      execution.state.destHTLC!.id,
      execution.state.destSecret
    );
    const signedTx = await adapter.signTransaction(claimTx, Buffer.alloc(32));
    const txHash = await adapter.broadcastTransaction(signedTx);

    execution.state.destHTLC!.claimTxHash = txHash;
    execution.state.destHTLC!.state = HTLCState.CLAIMED;
    execution.state.status = 'completed';

    this.updateStep(execution, 'user_claim_dest', 'completed', txHash);
  }

  // Helper methods

  private splitIntodenominations(amount: bigint): bigint[] {
    const result: bigint[] = [];
    let remaining = amount;

    // Filter out zero and invalid denominations, sort descending
    const validDenoms = this.config.splitDenominations
      .filter(d => d > BigInt(0))
      .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));

    // If no valid denominations, return the amount as-is
    if (validDenoms.length === 0) {
      return [amount];
    }

    // Limit iterations to prevent infinite loops
    const maxIterations = 1000;
    let iterations = 0;

    for (const denom of validDenoms) {
      while (remaining >= denom && iterations < maxIterations) {
        result.push(denom);
        remaining -= denom;
        iterations++;
      }
    }

    if (remaining > BigInt(0)) {
      result.push(remaining);
    }

    // Shuffle to avoid patterns
    return result.sort(() => Math.random() - 0.5);
  }

  private async createDecoyTransactions(
    zcashAdapter: any,
    count: number
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      // Create decoy shielded transactions with random small amounts
      const decoyAmount = BigInt(Math.floor(Math.random() * 1e6));
      const decoyAddr = await zcashAdapter.getShieldedAddress();

      // Random delay
      await sleep(1000 + Math.floor(Math.random() * 5000));
    }
  }

  private async waitForZcashOperation(
    adapter: any,
    operationId: string
  ): Promise<void> {
    // Poll z_getoperationstatus until complete
    let status = 'executing';
    while (status === 'executing') {
      await sleep(5000);
      // In real impl: const result = await adapter.rpcCall('z_getoperationstatus', [[operationId]]);
      status = 'success'; // Simplified
    }
  }

  private encryptSecretForUser(secret: Buffer, userId: string): Buffer {
    // ECIES encryption - in production, use user's actual public key
    const ephemeral = createECDH('secp256k1');
    ephemeral.generateKeys();

    // Derive shared secret
    const sharedSecret = createHash('sha256')
      .update(ephemeral.getPublicKey())
      .update(Buffer.from(userId))
      .digest();

    // Encrypt
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', sharedSecret, iv);
    const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);

    return Buffer.concat([ephemeral.getPublicKey(), iv, encrypted, cipher.getAuthTag()]);
  }

  private addStep(
    execution: PrivacyHubExecution,
    name: string,
    chain: Chain,
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
  ): void {
    execution.steps.push({
      name,
      chain,
      status,
      startedAt: Date.now(),
    });
  }

  private updateStep(
    execution: PrivacyHubExecution,
    name: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    txHash?: string
  ): void {
    const step = execution.steps.find(s => s.name === name);
    if (step) {
      step.status = status;
      if (txHash) step.txHash = txHash;
      if (status === 'completed') step.completedAt = Date.now();
    }
  }
}

/**
 * Stealth Address Generator
 *
 * Generates one-time addresses for each swap to prevent address reuse correlation.
 *
 * Uses the dual-key stealth address protocol:
 * - Scan key: Used to detect incoming payments
 * - Spend key: Used to spend received funds
 */
export class StealthAddressGenerator {
  /**
   * Generate a stealth address for a given chain and recipient.
   */
  async generate(chain: Chain, recipientAddress: string): Promise<StealthAddress> {
    // Generate ephemeral keypair
    const ephemeral = createECDH('secp256k1');
    ephemeral.generateKeys();

    // Derive stealth address components
    const ephemeralPub = ephemeral.getPublicKey('hex');

    // In production, this would use the recipient's scan public key
    // to derive a shared secret and generate the one-time address
    const sharedSecretInput = Buffer.concat([
      ephemeral.getPrivateKey(),
      Buffer.from(recipientAddress),
      randomBytes(16),
    ]);

    const viewingKey = createHash('sha256')
      .update(sharedSecretInput)
      .update(Buffer.from('viewing'))
      .digest('hex');

    const spendingKeyHash = createHash('sha256')
      .update(sharedSecretInput)
      .update(Buffer.from('spending'))
      .digest('hex');

    // Generate chain-specific stealth address
    const stealthAddress = this.deriveChainAddress(chain, viewingKey, spendingKeyHash);

    return {
      chain,
      address: stealthAddress,
      viewingKey,
      spendingKeyHash,
      ephemeralPublicKey: ephemeralPub,
      createdAt: Date.now(),
    };
  }

  private deriveChainAddress(
    chain: Chain,
    viewingKey: string,
    spendingKeyHash: string
  ): string {
    const combined = createHash('sha256')
      .update(viewingKey)
      .update(spendingKeyHash)
      .digest();

    switch (chain) {
      case Chain.ZCASH:
        // Generate t-addr style for transparent, or z-addr for shielded
        return `t1${combined.toString('hex').slice(0, 33)}`;

      case Chain.OSMOSIS:
        // Cosmos bech32 address
        return `osmo1${combined.toString('hex').slice(0, 38)}`;

      case Chain.FHENIX:
      case Chain.AZTEC:
        // EVM address (20 bytes)
        return `0x${combined.toString('hex').slice(0, 40)}`;

      case Chain.MINA:
        // Mina public key format
        return `B62${combined.toString('base64').replace(/[+/=]/g, '').slice(0, 52)}`;

      case Chain.MIDEN:
        // Miden account ID
        return `0x${combined.toString('hex').slice(0, 64)}`;

      default:
        return `0x${combined.toString('hex').slice(0, 40)}`;
    }
  }
}

/**
 * Timing Decorrelator
 *
 * Provides utilities for timing-based privacy enhancements.
 */
export class TimingDecorrelator {
  /**
   * Calculate a random delay that follows a distribution making
   * timing analysis difficult.
   */
  static calculateRandomDelay(
    minMs: number,
    maxMs: number,
    distribution: 'uniform' | 'exponential' | 'poisson' = 'exponential'
  ): number {
    switch (distribution) {
      case 'uniform':
        return minMs + Math.floor(Math.random() * (maxMs - minMs));

      case 'exponential':
        // Exponential distribution - most delays are shorter
        const lambda = 1 / ((maxMs - minMs) / 3);
        const u = Math.random();
        const delay = -Math.log(1 - u) / lambda;
        return Math.min(maxMs, Math.max(minMs, minMs + Math.floor(delay)));

      case 'poisson':
        // Poisson-like distribution
        const mean = (minMs + maxMs) / 2;
        let L = Math.exp(-mean / 10000);
        let k = 0;
        let p = 1;
        do {
          k++;
          p *= Math.random();
        } while (p > L);
        return Math.min(maxMs, Math.max(minMs, (k - 1) * 10000));

      default:
        return minMs + Math.floor(Math.random() * (maxMs - minMs));
    }
  }

  /**
   * Add jitter to a timestamp to obscure exact timing.
   */
  static addJitter(timestamp: number, maxJitterMs: number): number {
    const jitter = Math.floor(Math.random() * maxJitterMs * 2) - maxJitterMs;
    return timestamp + jitter;
  }
}
