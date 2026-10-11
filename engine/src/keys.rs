//! Keys and addresses: the same bridge functions ZApp calls (`Bridge.swift`).

use wasm_bindgen::prelude::*;
use zcash_client_backend::keys::UnifiedSpendingKey;
use zcash_keys::address::Address;
use zeroize::Zeroize;

use crate::{err, network};

/// 24 words from 32 bytes of entropy (`crypto.getRandomValues`).
#[wasm_bindgen]
pub fn mnemonic_new(entropy: &[u8]) -> Result<String, JsError> {
    let e: [u8; 32] = entropy.try_into().map_err(|_| err("entropy must be 32 bytes"))?;
    Ok(zflip_bridge::mnemonic_new(&e))
}

/// The 64-byte seed of a phrase; an error if a word or the checksum is wrong.
#[wasm_bindgen]
pub fn mnemonic_seed(phrase: &str) -> Result<Vec<u8>, JsError> {
    zflip_bridge::mnemonic_seed(phrase).map(|s| s.to_vec()).map_err(err)
}

/// Whether `word` is one of the 2048 BIP 39 words (to flag a typo as it is typed).
#[wasm_bindgen]
pub fn is_mnemonic_word(word: &str) -> bool {
    let list = zflip_core::mnemonic::Packed::new(zflip_core::mnemonic::ENGLISH).expect("embedded list");
    use zflip_core::mnemonic::WordList;
    list.find(&word.to_lowercase()).is_some()
}

#[wasm_bindgen]
pub fn seed_fingerprint(seed: &[u8]) -> Result<Vec<u8>, JsError> {
    zflip_bridge::seed_fingerprint(seed).map(|f| f.to_vec()).map_err(err)
}

/// The UFVK of a phone wallet's seed (ZIP 32 account `account`), as the SDK derives it.
#[wasm_bindgen]
pub fn ufvk_from_seed(mut seed: Vec<u8>, network_id: u8, account: u32) -> Result<String, JsError> {
    let params = network(network_id);
    let result = (|| {
        let index = zip32::AccountId::try_from(account).map_err(|_| err("bad account index"))?;
        let usk = UnifiedSpendingKey::from_seed(&params, &seed, index).map_err(err)?;
        Ok(usk.to_unified_full_viewing_key().encode(&params))
    })();
    seed.zeroize();
    result
}

/// The Orchard unified address at diversifier index `index` (the Flipper's "Address #index").
#[wasm_bindgen]
pub fn address(ufvk: &str, index: u32) -> Result<String, JsError> {
    zflip_bridge::address(ufvk, index).map_err(err)
}

/// What kind of address `text` is on `network_id`: "unified", "sapling", "transparent", "tex",
/// or "" if it isn't one.
#[wasm_bindgen]
pub fn address_kind(text: &str, network_id: u8) -> String {
    match Address::decode(&network(network_id), text.trim()) {
        Some(Address::Unified(_)) => "unified",
        Some(Address::Sapling(_)) => "sapling",
        Some(Address::Transparent(_)) => "transparent",
        Some(Address::Tex(_)) => "tex",
        None => "",
    }
    .into()
}

/// The compact request the Flipper checks and signs (`Bridge.signRequest`).
#[wasm_bindgen]
pub fn sign_request(pczt: &[u8], ufvk: &str) -> Result<Vec<u8>, JsError> {
    zflip_bridge::sign_request(pczt, ufvk).map(|r| r.encode()).map_err(err)
}

/// The PCZT with the Flipper's signatures (the SIGNED frame's payload) applied.
#[wasm_bindgen]
pub fn apply_signatures(pczt: &[u8], signatures: &[u8]) -> Result<Vec<u8>, JsError> {
    let sigs = zflip_core::request::decode_signatures(signatures).ok_or_else(|| err("malformed signature list"))?;
    zflip_bridge::apply_signatures(pczt, &sigs).map_err(err)
}
