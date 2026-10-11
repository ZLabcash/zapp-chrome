//! Sealing phone wallets' phrases at rest (as ZKindle does): a password becomes a key with
//! Argon2id (64 MiB, 3 passes), and AES-256-GCM seals with it. A browser has no Keychain, so
//! this is what stands between a copy of the extension's storage and the phrases; a passkey
//! (Touch ID) can unlock the same vault key instead of the password.

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use wasm_bindgen::prelude::*;

use crate::err;

/// A 32-byte key from a password and a 16-byte salt.
#[wasm_bindgen]
pub fn kdf_password(password: &str, salt: &[u8]) -> Result<Vec<u8>, JsError> {
    let params = Params::new(64 * 1024, 3, 1, Some(32)).map_err(err)?;
    let mut out = vec![0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(err)?;
    Ok(out)
}

/// nonce (12) || ciphertext + tag.
#[wasm_bindgen]
pub fn aead_seal(key: &[u8], plain: &[u8]) -> Result<Vec<u8>, JsError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(err)?;
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce).map_err(err)?;
    let ct = cipher.encrypt((&nonce).into(), plain).map_err(err)?;
    Ok([nonce.as_slice(), &ct].concat())
}

/// The plaintext, or an error if the key is wrong or the data was altered.
#[wasm_bindgen]
pub fn aead_open(key: &[u8], sealed: &[u8]) -> Result<Vec<u8>, JsError> {
    if sealed.len() < 12 + 16 {
        return Err(err("sealed data too short"));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(err)?;
    let (nonce, ct) = sealed.split_at(12);
    cipher.decrypt(nonce.into(), ct).map_err(|_| err("WRONG_KEY"))
}
