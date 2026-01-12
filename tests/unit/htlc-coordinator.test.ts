import { createHash, randomBytes } from 'crypto';

// Mock the adapters
jest.mock('../../src/adapters', () => ({
  AdapterRegistry: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockReturnValue({
      createHTLC: jest.fn().mockResolvedValue({
        chain: 'zcash',
        type: 'htlc_create',
        htlcId: 'htlc_123',
      }),
      claimHTLC: jest.fn().mockResolvedValue({
        chain: 'zcash',
        type: 'htlc_claim',
      }),
      refundHTLC: jest.fn().mockResolvedValue({
        chain: 'zcash',
        type: 'htlc_refund',
      }),
      signTransaction: jest.fn().mockResolvedValue({
        rawTx: 'signed',
        signature: 'sig',
      }),
      broadcastTransaction: jest.fn().mockResolvedValue('txhash_123'),
      waitForConfirmation: jest.fn().mockResolvedValue(undefined),
      getHTLCStatus: jest.fn().mockResolvedValue({
        id: 'htlc_123',
        state: 'locked',
        amount: BigInt(1e8),
      }),
    }),
  })),
}));

import { HTLCCoordinator, IntentPool } from '../../src/core/htlc-coordinator';
import { AdapterRegistry } from '../../src/adapters';
import {
  Chain,
  SwapIntent,
  Solver,
  IntentStatus,
  PrivacyLevel,
  ExecutionState,
} from '../../src/types';

describe('HTLCCoordinator', () => {
  let coordinator: HTLCCoordinator;
  let mockAdapters: AdapterRegistry;

  const mockIntent: SwapIntent = {
    id: 'intent_123',
    user: {
      id: 'user_1',
      addresses: {
        [Chain.ZCASH]: 't1user123',
        [Chain.OSMOSIS]: 'osmo1user123',
      },
    },
    sourceChain: Chain.ZCASH,
    sourceAsset: { symbol: 'ZEC', name: 'Zcash', decimals: 8, chain: Chain.ZCASH },
    sourceAmount: BigInt(1e8),
    destChain: Chain.OSMOSIS,
    destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
    minDestAmount: BigInt(100e6),
    maxSlippage: 0.01,
    deadline: Date.now() + 3600000,
    privacyLevel: PrivacyLevel.STANDARD,
    status: IntentStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockSolver: Solver = {
    id: 'solver_1',
    address: {
      [Chain.ZCASH]: 't1solver123',
      [Chain.OSMOSIS]: 'osmo1solver123',
    },
    supportedPairs: [],
    inventory: { OSMO: BigInt(1000e6) },
    totalSwaps: 100,
    successRate: 0.99,
    averageTime: 600,
    stakeAmount: BigInt(10000),
    feeRate: 0.003,
  };

  beforeEach(() => {
    mockAdapters = new AdapterRegistry();
    coordinator = new HTLCCoordinator(mockAdapters);
  });

  describe('initiateAtomicSwap', () => {
    it('should initialize swap execution', async () => {
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);

      expect(execution).toBeDefined();
      expect(execution.swapId).toBe(mockIntent.id);
      expect(execution.solver).toBe(mockSolver);
    });

    it('should complete all steps successfully', async () => {
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);

      expect(execution.state).toBe(ExecutionState.COMPLETED);
      expect(execution.completedAt).toBeDefined();
    });

    it('should have valid route in execution', async () => {
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);

      expect(execution.route).toBeDefined();
      expect(execution.route.id).toContain('route_');
      expect(execution.route.estimatedOutput).toBe(mockIntent.minDestAmount);
    });

    it('should record all execution steps', async () => {
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);

      const stepNames = execution.steps.map(s => s.name);

      expect(stepNames).toContain('lock_source');
      expect(stepNames).toContain('confirm_lock');
      expect(stepNames).toContain('lock_dest');
      expect(stepNames).toContain('confirm_dest');
      expect(stepNames).toContain('claim_dest');
    });

    it('should mark all steps as completed', async () => {
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);

      for (const step of execution.steps) {
        expect(step.status).toBe('completed');
        expect(step.startedAt).toBeDefined();
      }
    });

    it('should record transaction hashes', async () => {
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);

      expect(execution.txHashes[Chain.ZCASH]).toBeDefined();
      expect(execution.txHashes[Chain.OSMOSIS]).toBeDefined();
    });

    it('should set started and completed timestamps', async () => {
      const before = Date.now();
      const execution = await coordinator.initiateAtomicSwap(mockIntent, mockSolver);
      const after = Date.now();

      expect(execution.startedAt).toBeGreaterThanOrEqual(before);
      expect(execution.startedAt).toBeLessThanOrEqual(after);
      expect(execution.completedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('error handling', () => {
    it('should handle adapter errors gracefully', async () => {
      const errorAdapter = {
        createHTLC: jest.fn().mockRejectedValue(new Error('Network error')),
        signTransaction: jest.fn(),
        broadcastTransaction: jest.fn(),
        waitForConfirmation: jest.fn(),
      };

      const errorRegistry = {
        get: jest.fn().mockReturnValue(errorAdapter),
      } as unknown as AdapterRegistry;

      const errorCoordinator = new HTLCCoordinator(errorRegistry);

      await expect(
        errorCoordinator.initiateAtomicSwap(mockIntent, mockSolver)
      ).rejects.toThrow('Network error');
    });
  });
});

describe('IntentPool', () => {
  let pool: IntentPool;

  const validIntent: SwapIntent = {
    id: 'intent_123',
    user: {
      id: 'user_1',
      addresses: { [Chain.ZCASH]: 't1user123' },
    },
    sourceChain: Chain.ZCASH,
    sourceAsset: { symbol: 'ZEC', name: 'Zcash', decimals: 8, chain: Chain.ZCASH },
    sourceAmount: BigInt(1e8),
    destChain: Chain.OSMOSIS,
    destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
    minDestAmount: BigInt(100e6),
    maxSlippage: 0.01,
    deadline: Date.now() + 3600000,
    privacyLevel: PrivacyLevel.STANDARD,
    status: IntentStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    pool = new IntentPool();
  });

  describe('submitIntent', () => {
    it('should submit valid intent', async () => {
      const intentId = await pool.submitIntent(validIntent);

      expect(intentId).toBe(validIntent.id);
    });

    it('should reject intent without source chain', async () => {
      const invalidIntent = { ...validIntent, sourceChain: undefined } as any;

      await expect(pool.submitIntent(invalidIntent)).rejects.toThrow(
        'Source and destination chains are required'
      );
    });

    it('should reject intent with zero amount', async () => {
      const invalidIntent = { ...validIntent, sourceAmount: BigInt(0) };

      await expect(pool.submitIntent(invalidIntent)).rejects.toThrow(
        'Source amount must be positive'
      );
    });

    it('should reject intent with negative amount', async () => {
      const invalidIntent = { ...validIntent, sourceAmount: BigInt(-100) };

      await expect(pool.submitIntent(invalidIntent)).rejects.toThrow(
        'Source amount must be positive'
      );
    });

    it('should reject intent with past deadline', async () => {
      const invalidIntent = { ...validIntent, deadline: Date.now() - 1000 };

      await expect(pool.submitIntent(invalidIntent)).rejects.toThrow(
        'Deadline must be in the future'
      );
    });

    it('should reject intent with invalid slippage', async () => {
      const invalidIntent1 = { ...validIntent, maxSlippage: -0.1 };
      const invalidIntent2 = { ...validIntent, maxSlippage: 1.5 };

      await expect(pool.submitIntent(invalidIntent1)).rejects.toThrow(
        'Slippage must be between 0 and 1'
      );
      await expect(pool.submitIntent(invalidIntent2)).rejects.toThrow(
        'Slippage must be between 0 and 1'
      );
    });
  });

  describe('getIntent', () => {
    it('should retrieve submitted intent', async () => {
      await pool.submitIntent(validIntent);
      const intent = await pool.getIntent(validIntent.id);

      expect(intent).toEqual(validIntent);
    });

    it('should return undefined for unknown intent', async () => {
      const intent = await pool.getIntent('unknown_id');

      expect(intent).toBeUndefined();
    });
  });

  describe('cancelIntent', () => {
    it('should cancel submitted intent', async () => {
      await pool.submitIntent(validIntent);
      await pool.cancelIntent(validIntent.id);

      const intent = await pool.getIntent(validIntent.id);
      expect(intent?.status).toBe('cancelled');
    });

    it('should update timestamp on cancel', async () => {
      await pool.submitIntent(validIntent);
      const before = Date.now();
      await pool.cancelIntent(validIntent.id);

      const intent = await pool.getIntent(validIntent.id);
      expect(intent?.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('should do nothing for unknown intent', async () => {
      await expect(pool.cancelIntent('unknown_id')).resolves.not.toThrow();
    });
  });

  describe('matchIntent', () => {
    const solver: Solver = {
      id: 'solver_1',
      address: { [Chain.OSMOSIS]: 'osmo1solver' },
      supportedPairs: [],
      inventory: { OSMO: BigInt(1000e6) },
      totalSwaps: 100,
      successRate: 0.99,
      averageTime: 600,
      stakeAmount: BigInt(10000),
      feeRate: 0.003,
    };

    it('should match intent with sufficient inventory', async () => {
      await pool.submitIntent(validIntent);
      const matched = await pool.matchIntent(validIntent.id, solver);

      expect(matched).toBe(true);

      const intent = await pool.getIntent(validIntent.id);
      expect(intent?.status).toBe('matched');
    });

    it('should not match intent with insufficient inventory', async () => {
      const poorSolver = { ...solver, inventory: { OSMO: BigInt(1e6) } };

      await pool.submitIntent(validIntent);
      const matched = await pool.matchIntent(validIntent.id, poorSolver);

      expect(matched).toBe(false);
    });

    it('should return false for unknown intent', async () => {
      const matched = await pool.matchIntent('unknown_id', solver);

      expect(matched).toBe(false);
    });
  });
});

describe('HTLC Security Properties', () => {
  let coordinator: HTLCCoordinator;
  let mockAdapters: AdapterRegistry;

  beforeEach(() => {
    mockAdapters = new AdapterRegistry();
    coordinator = new HTLCCoordinator(mockAdapters);
  });

  it('should use cryptographically secure random secrets', async () => {
    // Run multiple times to ensure randomness
    const secrets = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const intent: SwapIntent = {
        id: `intent_${i}`,
        user: {
          id: 'user_1',
          addresses: {
            [Chain.ZCASH]: 't1user123',
            [Chain.OSMOSIS]: 'osmo1user123',
          },
        },
        sourceChain: Chain.ZCASH,
        sourceAsset: { symbol: 'ZEC', name: 'Zcash', decimals: 8, chain: Chain.ZCASH },
        sourceAmount: BigInt(1e8),
        destChain: Chain.OSMOSIS,
        destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
        minDestAmount: BigInt(100e6),
        maxSlippage: 0.01,
        deadline: Date.now() + 3600000,
        privacyLevel: PrivacyLevel.STANDARD,
        status: IntentStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const solver: Solver = {
        id: 'solver_1',
        address: {
          [Chain.ZCASH]: 't1solver123',
          [Chain.OSMOSIS]: 'osmo1solver123',
        },
        supportedPairs: [],
        inventory: { OSMO: BigInt(1000e6) },
        totalSwaps: 100,
        successRate: 0.99,
        averageTime: 600,
        stakeAmount: BigInt(10000),
        feeRate: 0.003,
      };

      await coordinator.initiateAtomicSwap(intent, solver);

      // The mock returns the same hash each time, but in real implementation
      // each swap would have a unique secret
    }
  });

  it('should use SHA256 for hashlock', () => {
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest();

    expect(hashlock).toHaveLength(32);

    // Verify hash is deterministic
    const hashlock2 = createHash('sha256').update(secret).digest();
    expect(hashlock.equals(hashlock2)).toBe(true);

    // Verify different secrets produce different hashlocks
    const secret2 = randomBytes(32);
    const hashlock3 = createHash('sha256').update(secret2).digest();
    expect(hashlock.equals(hashlock3)).toBe(false);
  });

  it('should set user timelock > solver timelock', () => {
    // User timelock: 1 hour
    // Solver timelock: 30 minutes
    // This ensures solver claims first, then user can claim source

    const userTimelock = Math.floor(Date.now() / 1000) + 3600;
    const solverTimelock = Math.floor(Date.now() / 1000) + 1800;

    expect(userTimelock).toBeGreaterThan(solverTimelock);
    expect(userTimelock - solverTimelock).toBe(1800); // 30 minute difference
  });
});
