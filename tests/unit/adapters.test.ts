import { createHash, randomBytes } from 'crypto';

// Mock fetch for all adapters
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
});

import { Chain, HTLCState } from '../../src/types';
import {
  AdapterRegistry,
  ZcashAdapter,
  OsmosisAdapter,
  FhenixAdapter,
  AztecAdapter,
  MidenAdapter,
  MinaAdapter,
} from '../../src/adapters';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('should register all 6 chain adapters by default', () => {
    const chains = registry.getSupportedChains();

    expect(chains).toContain(Chain.ZCASH);
    expect(chains).toContain(Chain.OSMOSIS);
    expect(chains).toContain(Chain.FHENIX);
    expect(chains).toContain(Chain.AZTEC);
    expect(chains).toContain(Chain.MIDEN);
    expect(chains).toContain(Chain.MINA);
    expect(chains).toHaveLength(6);
  });

  it('should return correct adapter for each chain', () => {
    expect(registry.get(Chain.ZCASH)).toBeInstanceOf(ZcashAdapter);
    expect(registry.get(Chain.OSMOSIS)).toBeInstanceOf(OsmosisAdapter);
    expect(registry.get(Chain.FHENIX)).toBeInstanceOf(FhenixAdapter);
    expect(registry.get(Chain.AZTEC)).toBeInstanceOf(AztecAdapter);
    expect(registry.get(Chain.MIDEN)).toBeInstanceOf(MidenAdapter);
    expect(registry.get(Chain.MINA)).toBeInstanceOf(MinaAdapter);
  });

  it('should throw error for unregistered chain', () => {
    expect(() => registry.get('unknown' as Chain)).toThrow();
  });

  it('should check if chain is registered', () => {
    expect(registry.has(Chain.ZCASH)).toBe(true);
    expect(registry.has('unknown' as Chain)).toBe(false);
  });

  it('should initialize all adapters with config', async () => {
    const config = {
      [Chain.ZCASH]: { rpcUrl: 'http://localhost:8232' },
      [Chain.OSMOSIS]: { rpcUrl: 'http://localhost:26657' },
    };

    await expect(registry.initializeAll(config)).resolves.not.toThrow();
  });

  it('should initialize single chain', async () => {
    await expect(
      registry.initializeChain(Chain.ZCASH, { rpcUrl: 'http://localhost:8232' })
    ).resolves.not.toThrow();
  });
});

describe('ZcashAdapter', () => {
  let adapter: ZcashAdapter;

  beforeEach(async () => {
    adapter = new ZcashAdapter();
    await adapter.initialize({ rpcUrl: 'http://localhost:8232' });
  });

  it('should have correct chain and currency', () => {
    expect(adapter.chain).toBe(Chain.ZCASH);
    expect(adapter.nativeCurrency).toBe('ZEC');
  });

  it('should generate t-address from public key', () => {
    const pubKey = randomBytes(32);
    const address = adapter.getAddress(pubKey);

    expect(address).toMatch(/^t1/);
    expect(address.length).toBeGreaterThan(30);
  });

  it('should build transaction correctly', async () => {
    const tx = await adapter.buildTransaction({
      to: 't1testaddress',
      amount: BigInt(1e8),
    });

    expect(tx.chain).toBe(Chain.ZCASH);
    expect(tx.to).toBe('t1testaddress');
    expect(tx.value).toBe(BigInt(1e8));
  });

  it('should create HTLC transaction', async () => {
    const hashlock = createHash('sha256').update('secret').digest();

    const tx = await adapter.createHTLC({
      chain: Chain.ZCASH,
      sender: 't1sender',
      receiver: 't1receiver',
      amount: BigInt(1e8),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(tx.type).toBe('htlc_create');
    expect(tx.htlcId).toBeDefined();
    expect(tx.hashlock).toBe(hashlock.toString('hex'));
  });

  it('should return correct block time', () => {
    expect(adapter.getBlockTime()).toBe(75000); // 75 seconds
  });
});

describe('OsmosisAdapter', () => {
  let adapter: OsmosisAdapter;

  beforeEach(async () => {
    adapter = new OsmosisAdapter();
    await adapter.initialize({ rpcUrl: 'http://localhost:26657' });
  });

  it('should have correct chain and currency', () => {
    expect(adapter.chain).toBe(Chain.OSMOSIS);
    expect(adapter.nativeCurrency).toBe('OSMO');
  });

  it('should generate osmo1 address from public key', () => {
    const pubKey = randomBytes(32);
    const address = adapter.getAddress(pubKey);

    expect(address).toMatch(/^osmo1/);
    expect(address.length).toBe(43); // bech32 format
  });

  it('should build IBC transaction', async () => {
    const tx = await adapter.buildTransaction({
      to: 'osmo1recipient',
      amount: BigInt(1e6),
      memo: 'test transfer',
    });

    expect(tx.chain).toBe(Chain.OSMOSIS);
    expect(tx.to).toBe('osmo1recipient');
  });

  it('should create HTLC with timeout height', async () => {
    const hashlock = createHash('sha256').update('secret').digest();

    const tx = await adapter.createHTLC({
      chain: Chain.OSMOSIS,
      sender: 'osmo1sender',
      receiver: 'osmo1receiver',
      amount: BigInt(1e6),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(tx.type).toBe('htlc_create');
    expect(tx.htlcId).toBeDefined();
  });

  it('should return correct block time', () => {
    expect(adapter.getBlockTime()).toBe(6000); // 6 seconds
  });
});

describe('FhenixAdapter', () => {
  let adapter: FhenixAdapter;

  beforeEach(async () => {
    adapter = new FhenixAdapter();
    await adapter.initialize({ rpcUrl: 'http://localhost:8545' });
  });

  it('should have correct chain and currency', () => {
    expect(adapter.chain).toBe(Chain.FHENIX);
    expect(adapter.nativeCurrency).toBe('FHE');
  });

  it('should generate 0x address from public key', () => {
    const pubKey = randomBytes(32);
    const address = adapter.getAddress(pubKey);

    expect(address).toMatch(/^0x/);
    expect(address.length).toBe(42); // 0x + 40 hex chars
  });

  it('should create HTLC with FHE encryption', async () => {
    const hashlock = createHash('sha256').update('secret').digest();

    const tx = await adapter.createHTLC({
      chain: Chain.FHENIX,
      sender: '0xsender',
      receiver: '0xreceiver',
      amount: BigInt(1e18),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(tx.type).toBe('htlc_create');
    expect(tx.htlcId).toBeDefined();
    expect(tx.data).toContain('createHTLC'); // Function name in calldata
  });

  it('should return correct block time', () => {
    expect(adapter.getBlockTime()).toBe(12000); // 12 seconds
  });
});

describe('AztecAdapter', () => {
  let adapter: AztecAdapter;

  beforeEach(async () => {
    adapter = new AztecAdapter();
    await adapter.initialize({ pxeUrl: 'http://localhost:8080' });
  });

  it('should have correct chain and currency', () => {
    expect(adapter.chain).toBe(Chain.AZTEC);
    expect(adapter.nativeCurrency).toBe('ETH');
  });

  it('should generate 0x address (64 chars) from public key', () => {
    const pubKey = randomBytes(32);
    const address = adapter.getAddress(pubKey);

    expect(address).toMatch(/^0x/);
    expect(address.length).toBe(66); // 0x + 64 hex chars
  });

  it('should create HTLC using Noir contract call', async () => {
    const hashlock = createHash('sha256').update('secret').digest();

    const tx = await adapter.createHTLC({
      chain: Chain.AZTEC,
      sender: '0xsender',
      receiver: '0xreceiver',
      amount: BigInt(1e18),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(tx.type).toBe('htlc_create');
    expect(tx.htlcId).toBeDefined();

    const callData = JSON.parse(tx.data || '{}');
    expect(callData.functionName).toBe('create_lock');
  });

  it('should claim HTLC with preimage', async () => {
    // First create an HTLC
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest();

    const createTx = await adapter.createHTLC({
      chain: Chain.AZTEC,
      sender: '0xsender',
      receiver: '0xreceiver',
      amount: BigInt(1e18),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    // Then claim it
    const claimTx = await adapter.claimHTLC(createTx.htlcId!, secret);

    expect(claimTx.type).toBe('htlc_claim');
    expect(claimTx.preimage).toBe(secret.toString('hex'));
  });

  it('should return correct block time', () => {
    expect(adapter.getBlockTime()).toBe(12000); // 12 seconds
  });
});

describe('MidenAdapter', () => {
  let adapter: MidenAdapter;

  beforeEach(async () => {
    adapter = new MidenAdapter();
    await adapter.initialize({ nodeUrl: 'http://localhost:57291' });
  });

  it('should have correct chain and currency', () => {
    expect(adapter.chain).toBe(Chain.MIDEN);
    expect(adapter.nativeCurrency).toBe('MIDEN');
  });

  it('should generate 0x address (16 chars) from public key', () => {
    const pubKey = randomBytes(32);
    const address = adapter.getAddress(pubKey);

    expect(address).toMatch(/^0x/);
    expect(address.length).toBe(18); // 0x + 16 hex chars (64-bit account ID)
  });

  it('should create HTLC with Miden note script', async () => {
    const hashlock = createHash('sha256').update('secret').digest();

    const tx = await adapter.createHTLC({
      chain: Chain.MIDEN,
      sender: '0xsender',
      receiver: '0xreceiver',
      amount: BigInt(1e18),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(tx.type).toBe('htlc_create');
    expect(tx.htlcId).toBeDefined();
    expect(tx.noteType).toBe('HTLC');
    expect(tx.noteScript).toContain('HTLC Note Script');
    expect(tx.noteScript).toContain(hashlock.toString('hex'));
  });

  it('should claim HTLC with preimage in advice stack', async () => {
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest();

    const createTx = await adapter.createHTLC({
      chain: Chain.MIDEN,
      sender: '0xsender',
      receiver: '0xreceiver',
      amount: BigInt(1e18),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    const claimTx = await adapter.claimHTLC(createTx.htlcId!, secret);

    expect(claimTx.type).toBe('htlc_claim');
    expect(claimTx.adviceStack).toContain(secret.toString('hex'));
  });

  it('should return correct block time', () => {
    expect(adapter.getBlockTime()).toBe(10000); // 10 seconds
  });
});

describe('MinaAdapter', () => {
  let adapter: MinaAdapter;

  beforeEach(async () => {
    adapter = new MinaAdapter();
    await adapter.initialize({ graphqlEndpoint: 'http://localhost:3085/graphql' });
  });

  it('should have correct chain and currency', () => {
    expect(adapter.chain).toBe(Chain.MINA);
    expect(adapter.nativeCurrency).toBe('MINA');
  });

  it('should generate B62 address from public key', () => {
    const pubKey = randomBytes(32);
    const address = adapter.getAddress(pubKey);

    expect(address).toMatch(/^B62/);
    expect(address.length).toBeGreaterThan(50);
  });

  it('should create HTLC using zkApp', async () => {
    const hashlock = createHash('sha256').update('secret').digest();

    const tx = await adapter.createHTLC({
      chain: Chain.MINA,
      sender: 'B62sender',
      receiver: 'B62receiver',
      amount: BigInt(1e9),
      hashlock,
      timelock: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(tx.type).toBe('htlc_create');
    expect(tx.htlcId).toBeDefined();

    const zkAppCall = JSON.parse(tx.data || '{}');
    expect(zkAppCall.methodName).toBe('createLock');
  });

  it('should return correct block time', () => {
    expect(adapter.getBlockTime()).toBe(180000); // 3 minutes (Mina slots)
  });
});

describe('Adapter HTLC Lifecycle', () => {
  const adapters = [
    { name: 'Zcash', AdapterClass: ZcashAdapter, chain: Chain.ZCASH },
    { name: 'Osmosis', AdapterClass: OsmosisAdapter, chain: Chain.OSMOSIS },
    { name: 'Fhenix', AdapterClass: FhenixAdapter, chain: Chain.FHENIX },
    { name: 'Aztec', AdapterClass: AztecAdapter, chain: Chain.AZTEC },
    { name: 'Miden', AdapterClass: MidenAdapter, chain: Chain.MIDEN },
    { name: 'Mina', AdapterClass: MinaAdapter, chain: Chain.MINA },
  ];

  adapters.forEach(({ name, AdapterClass, chain }) => {
    describe(`${name} HTLC lifecycle`, () => {
      let adapter: InstanceType<typeof AdapterClass>;
      let htlcId: string;
      let secret: Buffer;
      let hashlock: Buffer;

      beforeEach(async () => {
        adapter = new AdapterClass();
        await adapter.initialize({});

        secret = randomBytes(32);
        hashlock = createHash('sha256').update(secret).digest();
      });

      it('should create HTLC', async () => {
        const tx = await adapter.createHTLC({
          chain,
          sender: 'sender',
          receiver: 'receiver',
          amount: BigInt(1e8),
          hashlock,
          timelock: Math.floor(Date.now() / 1000) + 3600,
        });

        expect(tx.type).toBe('htlc_create');
        expect(tx.htlcId).toBeDefined();
        htlcId = tx.htlcId!;
      });

      it('should get HTLC status', async () => {
        const createTx = await adapter.createHTLC({
          chain,
          sender: 'sender',
          receiver: 'receiver',
          amount: BigInt(1e8),
          hashlock,
          timelock: Math.floor(Date.now() / 1000) + 3600,
        });

        const status = await adapter.getHTLCStatus(createTx.htlcId!);

        expect(status.id).toBe(createTx.htlcId);
        expect([HTLCState.PENDING, HTLCState.LOCKED]).toContain(status.state);
      });

      it('should create claim transaction', async () => {
        const createTx = await adapter.createHTLC({
          chain,
          sender: 'sender',
          receiver: 'receiver',
          amount: BigInt(1e8),
          hashlock,
          timelock: Math.floor(Date.now() / 1000) + 3600,
        });

        const claimTx = await adapter.claimHTLC(createTx.htlcId!, secret);

        expect(claimTx.type).toBe('htlc_claim');
        expect(claimTx.htlcId).toBe(createTx.htlcId);
      });

      it('should create refund transaction', async () => {
        const createTx = await adapter.createHTLC({
          chain,
          sender: 'sender',
          receiver: 'receiver',
          amount: BigInt(1e8),
          hashlock,
          timelock: Math.floor(Date.now() / 1000) + 3600,
        });

        const refundTx = await adapter.refundHTLC(createTx.htlcId!);

        expect(refundTx.type).toBe('htlc_refund');
        expect(refundTx.htlcId).toBe(createTx.htlcId);
      });
    });
  });
});

describe('Cross-Adapter Consistency', () => {
  const adapters: Array<{ name: string; adapter: any }> = [];

  beforeAll(async () => {
    const registry = new AdapterRegistry();

    for (const chain of registry.getSupportedChains()) {
      const adapter = registry.get(chain);
      await adapter.initialize({});
      adapters.push({ name: chain, adapter });
    }
  });

  it('all adapters should implement ChainAdapter interface', () => {
    for (const { adapter } of adapters) {
      // Core properties
      expect(adapter.chain).toBeDefined();
      expect(adapter.nativeCurrency).toBeDefined();

      // Core methods
      expect(typeof adapter.getAddress).toBe('function');
      expect(typeof adapter.getBalance).toBe('function');
      expect(typeof adapter.buildTransaction).toBe('function');
      expect(typeof adapter.signTransaction).toBe('function');
      expect(typeof adapter.broadcastTransaction).toBe('function');

      // HTLC methods
      expect(typeof adapter.createHTLC).toBe('function');
      expect(typeof adapter.claimHTLC).toBe('function');
      expect(typeof adapter.refundHTLC).toBe('function');
      expect(typeof adapter.getHTLCStatus).toBe('function');

      // Monitoring methods
      expect(typeof adapter.subscribeToAddress).toBe('function');
      expect(typeof adapter.getTransaction).toBe('function');
      expect(typeof adapter.getBlockHeight).toBe('function');
      expect(typeof adapter.getConfirmations).toBe('function');
      expect(typeof adapter.isFinalized).toBe('function');
      expect(typeof adapter.getBlockTime).toBe('function');
      expect(typeof adapter.estimateGas).toBe('function');
      expect(typeof adapter.waitForConfirmation).toBe('function');
    }
  });

  it('all adapters should generate valid addresses', () => {
    const pubKey = randomBytes(32);

    for (const { name, adapter } of adapters) {
      const address = adapter.getAddress(pubKey);

      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
      expect(address.length).toBeGreaterThan(10);
    }
  });

  it('all adapters should have positive block time', () => {
    for (const { name, adapter } of adapters) {
      const blockTime = adapter.getBlockTime();

      expect(blockTime).toBeGreaterThan(0);
      expect(blockTime).toBeLessThan(600000); // Max 10 minutes
    }
  });
});
