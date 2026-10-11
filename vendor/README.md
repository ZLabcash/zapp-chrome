# Vendored crates (patched for WebAssembly)

Released crates with the smallest changes that let them run in the browser. Each change is
marked `ZApp for Chrome` in the source.

- `zcash_client_sqlite` 0.22.0: rusqlite 0.38 (the first with wasm32-unknown-unknown support,
  through sqlite-wasm-rs) with `fallible_uint`; a `conn()` accessor for the views the iOS SDK reads.
- `schemerz-rusqlite` 0.370.0: rusqlite 0.38.
- `zcash_client_backend` 0.24.0: batch scanning runs its decryption tasks inline on wasm32
  (rayon has no threads there and would never run them).
- `pasta_curves` 0.5.2: on wasm32, `mac` (the field multiply's 64×64→128 step) uses four
  32×32→64 multiplies instead of a `u128` product, which compiles to a slow `__multi3` call.
- `orchard` 0.15.5: the Merkle hash's Sinsemilla domain is made once instead of for every node
  (its Q is a hash-to-curve).
