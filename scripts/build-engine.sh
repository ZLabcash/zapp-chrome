#!/usr/bin/env bash
# Builds the wallet engine to WebAssembly and its JS bindings into extension/src/engine/pkg.
# Needs: rustup target wasm32-unknown-unknown, LLVM clang (brew llvm) for the C parts
# (secp256k1, SQLite), wasm-bindgen-cli matching the wasm-bindgen crate in Cargo.lock.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd engine && cargo build --release)
wasm-bindgen --target web --out-dir extension/src/engine/pkg target/wasm32-unknown-unknown/release/zapp_engine.wasm
ls -la extension/src/engine/pkg/zapp_engine_bg.wasm
