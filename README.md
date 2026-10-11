# ZApp for Chrome

> Experimental software. Not audited. Use small amounts.

ZApp, the private Zcash wallet of [ZLab](https://zlab.cash), as a Chrome extension: the same
features and the same security model as [ZApp on iOS](https://github.com/ZLabcash/zapp).

- **Wallets**: create one (24 words, checked), restore one from its words, or connect a cold
  wallet: [ZFlip](https://github.com/ZLabcash/zflip) on a Flipper Zero, over Web Bluetooth.
  Several wallets side by side, renamed, removed; send between them by name.
- **Shielded by default**: Orchard (and Ironwood) unified addresses, a new one on demand.
- **Send**: up to 5 recipients in one transaction, each with its own message or one for all;
  an address book; QR codes; the fee estimated before signing.
- **Sign offline, broadcast later**: a payment the Flipper signed without network (or with
  automatic broadcast off) waits here with a countdown, to broadcast or cancel.
- **Activity**: mempool hourglass, confirmations 1/10 to 10/10, messages, search, explorer links.
- **13 languages, 43 currencies**, light and dark, server and explorer of your choice.

## Security

Like ZApp, the wallet database only ever holds **viewing keys**.

- A Flipper wallet's keys never leave the Flipper: this side builds the transaction (PCZT) and
  its proofs; the Flipper shows each payment and the fee, and signs.
- A browser wallet's 24 words are sealed with your password (Argon2id, 64 MiB, then
  AES-256-GCM) and opened for one signature, or to show the words, then wiped: the password
  plays the part of Face ID on the phone. Nobody can reset it; the 24 words restore the wallet.
- No account, no analytics. The extension talks to the lightwalletd server you choose
  (zec.rocks by default), CoinGecko (prices) and download.z.cash (Sapling parameters, only for
  a Sapling payment).

## How it works

- `engine/`: the wallet engine in Rust, compiled to WebAssembly. The same librustzcash crates
  as the iOS SDK (zcash_client_backend 0.24, zcash_client_sqlite 0.22, pczt 0.9), SQLite on the
  browser's private file system (OPFS), and the ZFlip bridge (sign requests, signatures).
  A few crates are patched for WebAssembly: see `vendor/README.md`.
- `extension/`: Manifest V3. An offscreen document runs the engine in a worker and keeps the
  wallets syncing while Chrome is open; the popup and the full page are the app (Preact).
  lightwalletd is reached with gRPC over `fetch`.

## Build

    # once: rustup target add wasm32-unknown-unknown; brew install llvm;
    #       cargo install wasm-bindgen-cli --version 0.2.129 --locked
    scripts/build-engine.sh
    cd extension && npm install && npm run build

Then in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`.

`extension/test/` drives the built extension in Chrome with Puppeteer (engine, screenshots).

## License

MIT OR Apache-2.0, as ZApp.
