//! ZApp for Chrome: the wallet engine.
//!
//! The same librustzcash calls the ZApp iOS SDK makes (`zcash-swift-wallet-sdk/rust/src/lib.rs`),
//! on the same SQLite wallet database, compiled to WebAssembly. The extension fetches from
//! lightwalletd and hands the bytes here; this side scans, stores, proposes, builds PCZTs,
//! proves and signs.
//!
//! Like ZApp, the database only ever holds viewing keys. A phone wallet's seed comes in sealed,
//! is opened for one signature and wiped.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use wasm_bindgen::prelude::*;

mod db;
mod history;
mod keys;
mod send;
mod sync;
mod vault;

pub use db::Engine;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// The wall clock, from JavaScript (`SystemTime::now` panics on wasm32-unknown-unknown).
#[derive(Clone, Copy)]
pub struct JsClock;

impl zcash_client_sqlite::util::Clock for JsClock {
    fn now(&self) -> SystemTime {
        UNIX_EPOCH + Duration::from_millis(js_sys::Date::now() as u64)
    }
}

/// Errors cross into JavaScript as plain `Error`s with the message.
pub(crate) fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

pub(crate) fn network(id: u8) -> zcash_protocol::consensus::Network {
    if id == 1 {
        zcash_protocol::consensus::Network::TestNetwork
    } else {
        zcash_protocol::consensus::Network::MainNetwork
    }
}

pub(crate) fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible()).map_err(err)
}
