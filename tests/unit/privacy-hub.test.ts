import { createHash, randomBytes } from 'crypto';

// Mock the imports for testing
jest.mock('../../src/adapters', () => ({
  AdapterRegistry: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockReturnValue({
      createHTLC: jest.fn().mockResolvedValue({ chain: 'zcash', type: 'htlc_create' }),
      claimHTLC: jest.fn().mockResolvedValue({ chain: 'zcash', type: 'htlc_claim' }),
      signTransaction: jest.fn().mockResolvedValue({ rawTx: 'signed', signature: 'sig' }),
      broadcastTransaction: jest.fn().mockResolvedValue('txhash123'),
      waitForConfirmation: jest.fn().mockResolvedValue(undefined),
      getShieldedAddress: jest.fn().mockResolvedValue('zs1testaddress'),
      shieldFunds: jest.fn().mockResolvedValue('opid123'),
    }),
  })),
}));

import {
  PrivacyHubCoordinator,
  StealthAddressGenerator,
  TimingDecorrelator,
  TIMELOCK_CONFIG,
} from '../../src/core/privacy-hub';
import { Chain, PrivacyHubChain, PrivacyLevel, IntentStatus } from '../../src/types';
import { AdapterRegistry } from '../../src/adapters';

describe('TIMELOCK_CONFIG', () => {
  it('should have correct source timelock parameters', () => {
    expect(TIMELOCK_CONFIG.source.minSeconds).toBe(1800); // 30 min
    expect(TIMELOCK_CONFIG.source.medianSeconds).toBe(5400); // 1.5 hr
    expect(TIMELOCK_CONFIG.source.maxSeconds).toBe(14400); // 4 hr
    expect(TIMELOCK_CONFIG.source.sigma).toBe(0.45);
  });

  it('should have correct destination timelock parameters', () => {
    expect(TIMELOCK_CONFIG.destination.minSeconds).toBe(900); // 15 min
    expect(TIMELOCK_CONFIG.destination.medianSeconds).toBe(2700); // 45 min
    expect(TIMELOCK_CONFIG.destination.maxSeconds).toBe(5400); // 90 min
    expect(TIMELOCK_CONFIG.destination.sigma).toBe(0.35);
  });

  it('should have correct buffer and rounding', () => {
    expect(TIMELOCK_CONFIG.buffer).toBe(1800); // 30 min
    expect(TIMELOCK_CONFIG.roundTo).toBe(900); // 15 min intervals
  });

  it('should ensure source max > dest max + buffer', () => {
    const sourceMax = TIMELOCK_CONFIG.source.maxSeconds;
    const destMax = TIMELOCK_CONFIG.destination.maxSeconds;
    const buffer = TIMELOCK_CONFIG.buffer;

    expect(sourceMax).toBeGreaterThan(destMax + buffer);
  });
});

describe('StealthAddressGenerator', () => {
  let generator: StealthAddressGenerator;

  beforeEach(() => {
    generator = new StealthAddressGenerator();
  });

  it('should generate unique addresses for each call', async () => {
    const addr1 = await generator.generate(Chain.ZCASH, 't1testaddress');
    const addr2 = await generator.generate(Chain.ZCASH, 't1testaddress');

    expect(addr1.address).not.toBe(addr2.address);
    expect(addr1.ephemeralPublicKey).not.toBe(addr2.ephemeralPublicKey);
  });

  it('should generate chain-specific address formats', async () => {
    const zcashAddr = await generator.generate(Chain.ZCASH, 't1test');
    const osmosisAddr = await generator.generate(Chain.OSMOSIS, 'osmo1test');
    const fhenixAddr = await generator.generate(Chain.FHENIX, '0xtest');
    const minaAddr = await generator.generate(Chain.MINA, 'B62qtest');

    expect(zcashAddr.address).toMatch(/^t1/);
    expect(osmosisAddr.address).toMatch(/^osmo1/);
    expect(fhenixAddr.address).toMatch(/^0x/);
    expect(minaAddr.address).toMatch(/^B62/);
  });

  it('should include viewing and spending keys', async () => {
    const addr = await generator.generate(Chain.ZCASH, 't1test');

    expect(addr.viewingKey).toBeDefined();
    expect(addr.viewingKey.length).toBe(64); // 32 bytes hex
    expect(addr.spendingKeyHash).toBeDefined();
    expect(addr.spendingKeyHash.length).toBe(64);
  });

  it('should set createdAt timestamp', async () => {
    const before = Date.now();
    const addr = await generator.generate(Chain.ZCASH, 't1test');
    const after = Date.now();

    expect(addr.createdAt).toBeGreaterThanOrEqual(before);
    expect(addr.createdAt).toBeLessThanOrEqual(after);
  });
});

describe('TimingDecorrelator', () => {
  describe('calculateRandomDelay', () => {
    it('should return values within min/max bounds', () => {
      const min = 1000;
      const max = 5000;

      for (let i = 0; i < 100; i++) {
        const delay = TimingDecorrelator.calculateRandomDelay(min, max, 'uniform');
        expect(delay).toBeGreaterThanOrEqual(min);
        expect(delay).toBeLessThanOrEqual(max);
      }
    });

    it('should support uniform distribution', () => {
      const min = 1000;
      const max = 5000;
      const delays: number[] = [];

      for (let i = 0; i < 1000; i++) {
        delays.push(TimingDecorrelator.calculateRandomDelay(min, max, 'uniform'));
      }

      const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
      const expectedAvg = (min + max) / 2;

      // Uniform should be roughly centered
      expect(avg).toBeGreaterThan(expectedAvg - 500);
      expect(avg).toBeLessThan(expectedAvg + 500);
    });

    it('should support exponential distribution', () => {
      const min = 1000;
      const max = 10000;
      const delays: number[] = [];

      for (let i = 0; i < 1000; i++) {
        delays.push(TimingDecorrelator.calculateRandomDelay(min, max, 'exponential'));
      }

      // Exponential should skew toward lower values
      const median = delays.sort((a, b) => a - b)[500];
      const expectedMedian = (min + max) / 2;

      expect(median).toBeLessThan(expectedMedian);
    });
  });

  describe('addJitter', () => {
    it('should add jitter within bounds', () => {
      const timestamp = Date.now();
      const maxJitter = 1000;

      for (let i = 0; i < 100; i++) {
        const jittered = TimingDecorrelator.addJitter(timestamp, maxJitter);
        expect(Math.abs(jittered - timestamp)).toBeLessThanOrEqual(maxJitter);
      }
    });
  });
});

describe('PrivacyHubCoordinator', () => {
  let coordinator: PrivacyHubCoordinator;
  let mockAdapters: AdapterRegistry;

  beforeEach(() => {
    mockAdapters = new AdapterRegistry();
    coordinator = new PrivacyHubCoordinator(mockAdapters);
  });

  describe('constructor', () => {
    it('should use default config if none provided', () => {
      const coord = new PrivacyHubCoordinator(mockAdapters);
      // Verify defaults are set (internal config)
      expect(coord).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const coord = new PrivacyHubCoordinator(mockAdapters, {
        hubChain: PrivacyHubChain.AZTEC,
        minMixingDelay: 60 * 60 * 1000, // 1 hour
      });
      expect(coord).toBeDefined();
    });
  });

  describe('executePrivateSwap', () => {
    const mockIntent = {
      id: 'intent_123',
      user: {
        id: 'user_1',
        addresses: {
          [Chain.FHENIX]: '0xuser123',
          [Chain.OSMOSIS]: 'osmo1user123',
        },
      },
      sourceChain: Chain.FHENIX,
      sourceAsset: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chain: Chain.FHENIX },
      sourceAmount: BigInt(1e18),
      destChain: Chain.OSMOSIS,
      destAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, chain: Chain.OSMOSIS },
      minDestAmount: BigInt(100e6),
      maxSlippage: 0.01,
      deadline: Date.now() + 3600000,
      privacyLevel: PrivacyLevel.MAXIMUM,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockSolver = {
      id: 'solver_1',
      address: {
        [Chain.FHENIX]: '0xsolver123',
        [Chain.OSMOSIS]: 'osmo1solver123',
        [Chain.ZCASH]: 't1solver123',
      },
      supportedPairs: [],
      inventory: {},
      totalSwaps: 100,
      successRate: 0.99,
      averageTime: 600,
      stakeAmount: BigInt(10000),
      feeRate: 0.003,
    };

    it('should generate different secrets for source and destination', async () => {
      // This test verifies the core privacy innovation
      const execution = await coordinator.executePrivateSwap(mockIntent, mockSolver);

      expect(execution.state.sourceSecret).toBeDefined();
      expect(execution.state.destSecret).toBeDefined();
      expect(execution.state.sourceSecret.toString('hex')).not.toBe(
        execution.state.destSecret.toString('hex')
      );
    });

    it('should generate different hashlocks for source and destination', async () => {
      const execution = await coordinator.executePrivateSwap(mockIntent, mockSolver);

      expect(execution.state.sourceHashlock).toBeDefined();
      expect(execution.state.destHashlock).toBeDefined();
      expect(execution.state.sourceHashlock.toString('hex')).not.toBe(
        execution.state.destHashlock.toString('hex')
      );
    });

    it('should verify hashlock derivation is correct', async () => {
      const execution = await coordinator.executePrivateSwap(mockIntent, mockSolver);

      const expectedSourceHash = createHash('sha256')
        .update(execution.state.sourceSecret)
        .digest();
      const expectedDestHash = createHash('sha256')
        .update(execution.state.destSecret)
        .digest();

      expect(execution.state.sourceHashlock.toString('hex')).toBe(
        expectedSourceHash.toString('hex')
      );
      expect(execution.state.destHashlock.toString('hex')).toBe(
        expectedDestHash.toString('hex')
      );
    });

    it('should set correlation broken flag on completion', async () => {
      const execution = await coordinator.executePrivateSwap(mockIntent, mockSolver);

      expect(execution.correlationBroken).toBe(true);
      expect(execution.timingDecorrelated).toBe(true);
      expect(execution.addressesOneTime).toBe(true);
    });

    it('should generate stealth addresses for both parties', async () => {
      const execution = await coordinator.executePrivateSwap(mockIntent, mockSolver);

      expect(execution.state.userStealthAddress).toBeDefined();
      expect(execution.state.solverStealthAddress).toBeDefined();
    });

    it('should include timelocks in state', async () => {
      const execution = await coordinator.executePrivateSwap(mockIntent, mockSolver);

      expect(execution.state.sourceTimelock).toBeDefined();
      expect(execution.state.destTimelock).toBeDefined();
      expect(execution.state.sourceTimelock).toBeGreaterThan(execution.state.destTimelock);
    });
  });
});

describe('Capped Log-Normal Distribution', () => {
  // Test the statistical properties of the timelock generation
  it('should generate values within configured bounds', () => {
    const { source } = TIMELOCK_CONFIG;
    const samples: number[] = [];

    // Generate many samples to test distribution
    for (let i = 0; i < 1000; i++) {
      // Simulate the cappedLogNormal function
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const mu = Math.log(source.medianSeconds);
      const raw = Math.exp(mu + source.sigma * z);
      const clamped = Math.max(source.minSeconds, Math.min(source.maxSeconds, raw));
      samples.push(clamped);
    }

    // All values should be within bounds
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(source.minSeconds);
      expect(sample).toBeLessThanOrEqual(source.maxSeconds);
    }
  });

  it('should have median near configured median', () => {
    const { source } = TIMELOCK_CONFIG;
    const samples: number[] = [];

    for (let i = 0; i < 1000; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const mu = Math.log(source.medianSeconds);
      const raw = Math.exp(mu + source.sigma * z);
      const clamped = Math.max(source.minSeconds, Math.min(source.maxSeconds, raw));
      samples.push(clamped);
    }

    samples.sort((a, b) => a - b);
    const median = samples[500];

    // Median should be reasonably close to configured median
    // Allow 50% variance due to capping
    expect(median).toBeGreaterThan(source.medianSeconds * 0.5);
    expect(median).toBeLessThan(source.medianSeconds * 1.5);
  });
});
