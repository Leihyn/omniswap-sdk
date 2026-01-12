# zcash-wasm

WASM bindings for Zcash cryptography, enabling client-side key generation, note encryption, and proof verification.

## Building

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### Build

```bash
# For Node.js
wasm-pack build --target nodejs --out-dir ../pkg/node

# For browser
wasm-pack build --target web --out-dir ../pkg/web

# For bundlers (webpack, etc.)
wasm-pack build --target bundler --out-dir ../pkg/bundler
```

## Usage

### Node.js

```javascript
const zcash = require('./pkg/node/zcash_wasm');

// Generate keys
const seed = crypto.randomBytes(32);
const spendingKey = zcash.generate_spending_key(seed);
const viewingKey = zcash.derive_viewing_key(spendingKey);
const address = zcash.derive_payment_address(viewingKey, 0);

console.log('Address:', address);
```

### Browser

```javascript
import init, {
  generate_spending_key,
  derive_viewing_key,
  derive_payment_address
} from './pkg/web/zcash_wasm';

await init();

const seed = crypto.getRandomValues(new Uint8Array(32));
const spendingKey = generate_spending_key(seed);
const viewingKey = derive_viewing_key(spendingKey);
const address = derive_payment_address(viewingKey, 0);
```

## API

### Key Generation

- `generate_spending_key(seed: Uint8Array): Uint8Array`
- `derive_viewing_key(spending_key: Uint8Array): Uint8Array`
- `derive_payment_address(viewing_key: Uint8Array, index: number): string`
- `generate_sapling_address(spending_key: Uint8Array): string`

### Note Operations

- `compute_note_commitment(diversifier, pk_d, value, rseed): Uint8Array`
- `compute_nullifier(note_commitment, viewing_key, position): Uint8Array`
- `encrypt_note(diversifier, pk_d, value, rseed, memo, ovk): Uint8Array`

### Signing

- `sign_transparent(message: Uint8Array, private_key: Uint8Array): Uint8Array`

### Utilities

- `blake2b_hash(data: Uint8Array, personalization: Uint8Array): Uint8Array`
- `verify_sapling_proof(proof: Uint8Array, public_inputs: Uint8Array): boolean`
- `get_network_params(network: string): object`

## Notes

- This requires proving parameters for full transaction building
- Download Sapling params from: https://download.z.cash/downloads/
- Place in `~/.zcash-params/` or specify path in config

## License

MIT
