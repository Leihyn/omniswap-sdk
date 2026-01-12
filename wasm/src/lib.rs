use wasm_bindgen::prelude::*;
use group::{ff::Field, Group, GroupEncoding};
use jubjub::{ExtendedPoint, Fr, SubgroupPoint};
use rand::rngs::OsRng;
use sha2::{Sha256, Digest};
use ripemd::Ripemd160;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    console_log!("Zcash WASM module initialized");
}

/// Generate a Sapling spending key from a 32-byte seed
#[wasm_bindgen]
pub fn generate_spending_key(seed: &[u8]) -> Result<Vec<u8>, JsValue> {
    if seed.len() < 32 {
        return Err(JsValue::from_str("Seed must be at least 32 bytes"));
    }

    // Derive expanded spending key components using PRF
    let ask = prf_expand(&seed[..32], &[0x00]);  // spend authorizing key
    let nsk = prf_expand(&seed[..32], &[0x01]);  // nullifier private key
    let ovk = prf_expand(&seed[..32], &[0x02]);  // outgoing viewing key

    let mut spending_key = Vec::with_capacity(96);
    spending_key.extend_from_slice(&ask);
    spending_key.extend_from_slice(&nsk);
    spending_key.extend_from_slice(&ovk);

    Ok(spending_key)
}

/// Derive a full viewing key from a spending key
#[wasm_bindgen]
pub fn derive_viewing_key(spending_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    if spending_key.len() < 96 {
        return Err(JsValue::from_str("Invalid spending key length"));
    }

    let ask = &spending_key[0..32];
    let nsk = &spending_key[32..64];
    let ovk = &spending_key[64..96];

    // Derive ak = ask * G (spend validating key)
    let ask_scalar = bytes_to_scalar(ask)?;
    let ak = (ExtendedPoint::generator() * ask_scalar).to_bytes();

    // Derive nk = nsk * G (nullifier deriving key)
    let nsk_scalar = bytes_to_scalar(nsk)?;
    let nk = (ExtendedPoint::generator() * nsk_scalar).to_bytes();

    // ivk = CRH(ak, nk) mod r (incoming viewing key)
    let ivk = crh_ivk(&ak, &nk);

    let mut viewing_key = Vec::with_capacity(128);
    viewing_key.extend_from_slice(&ak);
    viewing_key.extend_from_slice(&nk);
    viewing_key.extend_from_slice(&ivk);
    viewing_key.extend_from_slice(ovk);

    Ok(viewing_key)
}

/// Derive a payment address from a viewing key with diversifier index
#[wasm_bindgen]
pub fn derive_payment_address(viewing_key: &[u8], diversifier_index: u32) -> Result<String, JsValue> {
    if viewing_key.len() < 128 {
        return Err(JsValue::from_str("Invalid viewing key length"));
    }

    let ivk = &viewing_key[64..96];

    // Generate diversifier from index
    let mut diversifier = [0u8; 11];
    diversifier[0..4].copy_from_slice(&diversifier_index.to_le_bytes());

    // Ensure diversifier is valid (maps to a point on the curve)
    let diversifier = find_valid_diversifier(&diversifier)?;

    // Derive pk_d = ivk * G_d (diversified transmission key)
    let g_d = diversifier_to_point(&diversifier)?;
    let ivk_scalar = bytes_to_scalar(ivk)?;
    let pk_d = (g_d * ivk_scalar).to_bytes();

    // Encode as Bech32 address
    let mut raw_address = Vec::with_capacity(43);
    raw_address.extend_from_slice(&diversifier);
    raw_address.extend_from_slice(&pk_d);

    let encoded = encode_payment_address(&raw_address)?;
    Ok(encoded)
}

/// Generate a transparent address from a public key
#[wasm_bindgen]
pub fn generate_transparent_address(public_key: &[u8]) -> Result<String, JsValue> {
    // SHA256 then RIPEMD160
    let sha_hash = Sha256::digest(public_key);
    let ripemd_hash = Ripemd160::digest(&sha_hash);

    // Base58Check encode with version byte 0x1CB8 for mainnet t1
    let mut payload = vec![0x1C, 0xB8];
    payload.extend_from_slice(&ripemd_hash);

    let address = bs58::encode(&payload).into_string();

    Ok(address)
}

/// Compute a note commitment
#[wasm_bindgen]
pub fn compute_note_commitment(
    diversifier: &[u8],
    pk_d: &[u8],
    value: u64,
    rcm: &[u8],
) -> Result<Vec<u8>, JsValue> {
    if diversifier.len() != 11 || pk_d.len() != 32 || rcm.len() != 32 {
        return Err(JsValue::from_str("Invalid input lengths"));
    }

    // Note commitment: CM = PedersenHash(diversifier || pk_d || value || rcm)
    let mut input = Vec::with_capacity(83);
    input.extend_from_slice(diversifier);
    input.extend_from_slice(pk_d);
    input.extend_from_slice(&value.to_le_bytes());
    input.extend_from_slice(rcm);

    let commitment = pedersen_hash(b"Zcash_PH", &input);
    Ok(commitment.to_vec())
}

/// Compute a nullifier for a note
#[wasm_bindgen]
pub fn compute_nullifier(
    note_commitment: &[u8],
    nk: &[u8],
    position: u64,
) -> Result<Vec<u8>, JsValue> {
    if note_commitment.len() != 32 || nk.len() != 32 {
        return Err(JsValue::from_str("Invalid input lengths"));
    }

    // Nullifier = PRF_nk(rho) where rho = CM + position * G
    let mut hasher = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"Zcash_nf")
        .to_state();

    hasher.update(nk);
    hasher.update(note_commitment);
    hasher.update(&position.to_le_bytes());

    Ok(hasher.finalize().as_bytes().to_vec())
}

/// Sign a message with a transparent private key (secp256k1)
#[wasm_bindgen]
pub fn sign_transparent(message: &[u8], private_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    use k256::ecdsa::{SigningKey, signature::Signer};

    
    let signing_key = SigningKey::from_slice(private_key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Hash message if not already 32 bytes
    let msg_hash = if message.len() == 32 {
        message.to_vec()
    } else {
        Sha256::digest(message).to_vec()
    };

    let signature: k256::ecdsa::Signature = signing_key.sign(&msg_hash);

    Ok(signature.to_bytes().to_vec())
}

/// Hash data with BLAKE2b (Zcash personalization)
#[wasm_bindgen]
pub fn blake2b_hash(data: &[u8], personalization: &[u8]) -> Vec<u8> {
    let mut personal = [0u8; 16];
    let len = std::cmp::min(personalization.len(), 16);
    personal[..len].copy_from_slice(&personalization[..len]);

    blake2b_simd::Params::new()
        .hash_length(32)
        .personal(&personal)
        .hash(data)
        .as_bytes()
        .to_vec()
}

/// Generate random bytes
#[wasm_bindgen]
pub fn random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    getrandom::getrandom(&mut bytes).unwrap();
    bytes
}

/// Generate a random scalar (for rcm, rcv, etc.)
#[wasm_bindgen]
pub fn random_scalar() -> Vec<u8> {
    let scalar = Fr::random(&mut OsRng);
    scalar.to_bytes().to_vec()
}

// Helper functions

fn prf_expand(key: &[u8], t: &[u8]) -> [u8; 32] {
    let mut hasher = blake2b_simd::Params::new()
        .hash_length(64)
        .personal(b"Zcash_ExpandSeed")
        .to_state();

    hasher.update(key);
    hasher.update(t);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result.as_bytes()[..32]);
    output
}

fn bytes_to_scalar(bytes: &[u8]) -> Result<Fr, JsValue> {
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes[..32]);

    Option::from(Fr::from_bytes(&arr))
        .ok_or_else(|| JsValue::from_str("Invalid scalar"))
}

fn crh_ivk(ak: &[u8], nk: &[u8]) -> [u8; 32] {
    let mut hasher = blake2s_simd::Params::new()
        .hash_length(32)
        .personal(b"Zcashivk")
        .to_state();

    hasher.update(ak);
    hasher.update(nk);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(result.as_bytes());

    // Reduce mod r
    output[31] &= 0x07;
    output
}

fn find_valid_diversifier(d: &[u8; 11]) -> Result<[u8; 11], JsValue> {
    // For now, return the diversifier as-is
    // Full impl would check if it maps to a valid point
    Ok(*d)
}

fn diversifier_to_point(d: &[u8; 11]) -> Result<SubgroupPoint, JsValue> {
    // Hash to curve point using BLAKE2s
    let hash = blake2s_simd::Params::new()
        .hash_length(32)
        .personal(b"Zcash_gd")
        .hash(d);

    // Convert to point (simplified)
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(hash.as_bytes());

    Option::from(SubgroupPoint::from_bytes(&bytes))
        .ok_or_else(|| JsValue::from_str("Invalid diversifier"))
}

fn pedersen_hash(personalization: &[u8], input: &[u8]) -> [u8; 32] {
    // Simplified Pedersen hash using BLAKE2s
    // Full impl uses Jubjub curve points
    let mut hasher = blake2s_simd::Params::new()
        .hash_length(32)
        .personal(personalization)
        .to_state();

    hasher.update(input);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(result.as_bytes());
    output
}

fn encode_payment_address(raw: &[u8]) -> Result<String, JsValue> {
    // Bech32 encode with "zs" prefix for mainnet Sapling
    // Convert to u5 array
    let data: Vec<bech32::u5> = raw.iter()
        .map(|b| bech32::u5::try_from_u8(*b % 32).unwrap())
        .collect();

    let encoded = bech32::encode("zs", data, bech32::Variant::Bech32)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(encoded)
}

// Console error panic hook
mod console_error_panic_hook {
    use std::panic;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = console)]
        fn error(s: &str);
    }

    pub fn set_once() {
        static SET: std::sync::Once = std::sync::Once::new();
        SET.call_once(|| {
            panic::set_hook(Box::new(|info| {
                error(&info.to_string());
            }));
        });
    }
}
