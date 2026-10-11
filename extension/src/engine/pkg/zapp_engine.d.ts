/* tslint:disable */
/* eslint-disable */

export class Engine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The accounts: one per wallet, found by its viewing key.
     */
    accounts(): any;
    /**
     * The PCZT of a one-step proposal (for the Flipper to sign).
     */
    create_pczt(account: string, proposal: Uint8Array): Uint8Array;
    /**
     * A phone wallet's payment: the seed (64 bytes) is used for this call and wiped.
     */
    create_transactions(proposal: Uint8Array, seed: Uint8Array, account_index: number, spend_params: Uint8Array | null | undefined, output_params: Uint8Array | null | undefined, needs_sapling: boolean): any;
    /**
     * Transactions to look up in full (memos, sent details) or to check the status of.
     */
    data_requests(): any;
    /**
     * A full transaction from lightwalletd (GetTransaction): decrypts what is ours and stores
     * it. `mined_height` 0 while in the mempool.
     */
    decrypt_and_store(raw: Uint8Array, mined_height: number): void;
    delete_account(uuid_str: string): void;
    /**
     * Combines the proven and the signed PCZT, extracts the transaction and stores it as
     * sent. Returns the txid (as stored); its bytes then come from `raw_transaction`.
     */
    extract_and_store(proven: Uint8Array, signed: Uint8Array): string;
    /**
     * Height scanned without gaps from the earliest birthday, or 0.
     */
    fully_scanned_height(): number;
    /**
     * Imports a wallet by its viewing key, as ZApp does for both kinds: "spending" with the
     * seed fingerprint and ZIP 32 index, so PCZT spends carry the path a signer needs.
     * `treestate` is lightwalletd's TreeState at the block before the birthday.
     */
    import_account(name: string, ufvk: string, treestate: Uint8Array, seed_fingerprint: Uint8Array, account_index: number, key_source: string): string;
    /**
     * Re-runs migrations (after an engine update), as the SDK does on every open.
     */
    migrate(): void;
    /**
     * Opens (creating or migrating) the wallet database of `network_id` (0 mainnet, 1 testnet).
     * Must run in a dedicated worker: OPFS sync access handles only exist there.
     */
    static open(network_id: number): Promise<Engine>;
    /**
     * Who a transaction paid, with each output's message.
     */
    outputs(txid_hex: string): any;
    /**
     * Proposes paying a ZIP 321 request (one payment or several, each with its memo) from
     * `account`, with the SDK's default confirmations policy.
     */
    propose(account: string, uri: string): any;
    /**
     * Stores the note commitment tree's subtree roots (GetSubtreeRoots); `protocol` 0 Sapling,
     * 1 Orchard, 2 Ironwood, as lightwalletd numbers them.
     */
    put_subtree_roots(protocol: number, start_index: bigint, list: Array<any>): void;
    /**
     * A stored transaction's bytes, to (re)submit it.
     */
    raw_transaction(txid_hex: string): Uint8Array | undefined;
    /**
     * Scans `blocks` (CompactBlock protobufs, from `start`) on top of `from_state` (the
     * TreeState of block `start - 1`). On a chain fork it rewinds 10 blocks, as the SDK does.
     */
    scan_blocks(start: number, from_state: Uint8Array, blocks: Array<any>, priority: number): any;
    /**
     * `height` > 0: mined there; 0: not in the main chain; -1: the server doesn't know it.
     */
    set_transaction_status(txid_hex: string, height: bigint): void;
    /**
     * What to scan next, most urgent first.
     */
    suggest_scan_ranges(): any;
    /**
     * Tip, scan progress and every account's balance (ZIP 315 default: 3 confirmations for
     * the wallet's own change, 10 for what others send).
     */
    summary(): any;
    /**
     * An account's transactions, newest first (unmined at the top).
     */
    transactions(account: string): any;
    update_chain_tip(height: number): void;
    /**
     * Erases everything (the last wallet removed).
     */
    wipe(): void;
}

/**
 * The Orchard unified address at diversifier index `index` (the Flipper's "Address #index").
 */
export function address(ufvk: string, index: number): string;

/**
 * What kind of address `text` is on `network_id`: "unified", "sapling", "transparent", "tex",
 * or "" if it isn't one.
 */
export function address_kind(text: string, network_id: number): string;

/**
 * The plaintext, or an error if the key is wrong or the data was altered.
 */
export function aead_open(key: Uint8Array, sealed: Uint8Array): Uint8Array;

/**
 * nonce (12) || ciphertext + tag.
 */
export function aead_seal(key: Uint8Array, plain: Uint8Array): Uint8Array;

/**
 * The PCZT with the Flipper's signatures (the SIGNED frame's payload) applied.
 */
export function apply_signatures(pczt: Uint8Array, signatures: Uint8Array): Uint8Array;

/**
 * Whether `word` is one of the 2048 BIP 39 words (to flag a typo as it is typed).
 */
export function is_mnemonic_word(word: string): boolean;

/**
 * A 32-byte key from a password and a 16-byte salt.
 */
export function kdf_password(password: string, salt: Uint8Array): Uint8Array;

/**
 * 24 words from 32 bytes of entropy (`crypto.getRandomValues`).
 */
export function mnemonic_new(entropy: Uint8Array): string;

/**
 * The 64-byte seed of a phrase; an error if a word or the checksum is wrong.
 */
export function mnemonic_seed(phrase: string): Uint8Array;

/**
 * Adds the zero-knowledge proofs to a PCZT (Orchard and Ironwood with Halo 2, no parameters;
 * Sapling with the parameters, when the transaction has any).
 */
export function prove_pczt(pczt: Uint8Array, spend_params?: Uint8Array | null, output_params?: Uint8Array | null): Uint8Array;

/**
 * Builds and proves a 2-action Orchard bundle (an output and a dummy spend), to measure how
 * long a proof takes in this browser. Returns milliseconds: [proving key, proof].
 */
export function prove_selftest(): Float64Array;

export function seed_fingerprint(seed: Uint8Array): Uint8Array;

/**
 * The compact request the Flipper checks and signs (`Bridge.signRequest`).
 */
export function sign_request(pczt: Uint8Array, ufvk: string): Uint8Array;

export function start(): void;

/**
 * The UFVK of a phone wallet's seed (ZIP 32 account `account`), as the SDK derives it.
 */
export function ufvk_from_seed(seed: Uint8Array, network_id: number, account: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly address: (a: number, b: number, c: number) => [number, number, number, number];
    readonly address_kind: (a: number, b: number, c: number) => [number, number];
    readonly aead_open: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly aead_seal: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly apply_signatures: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly engine_accounts: (a: number) => [number, number, number];
    readonly engine_create_pczt: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly engine_create_transactions: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly engine_data_requests: (a: number) => [number, number, number];
    readonly engine_decrypt_and_store: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_delete_account: (a: number, b: number, c: number) => [number, number];
    readonly engine_extract_and_store: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly engine_fully_scanned_height: (a: number) => [number, number, number];
    readonly engine_import_account: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number, number];
    readonly engine_migrate: (a: number) => [number, number];
    readonly engine_open: (a: number) => any;
    readonly engine_outputs: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_propose: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly engine_put_subtree_roots: (a: number, b: number, c: bigint, d: any) => [number, number];
    readonly engine_raw_transaction: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_scan_blocks: (a: number, b: number, c: number, d: number, e: any, f: number) => [number, number, number];
    readonly engine_set_transaction_status: (a: number, b: number, c: number, d: bigint) => [number, number];
    readonly engine_suggest_scan_ranges: (a: number) => [number, number, number];
    readonly engine_summary: (a: number) => [number, number, number];
    readonly engine_transactions: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_update_chain_tip: (a: number, b: number) => [number, number];
    readonly engine_wipe: (a: number) => [number, number];
    readonly is_mnemonic_word: (a: number, b: number) => number;
    readonly kdf_password: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly mnemonic_new: (a: number, b: number) => [number, number, number, number];
    readonly mnemonic_seed: (a: number, b: number) => [number, number, number, number];
    readonly prove_pczt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly prove_selftest: () => [number, number, number, number];
    readonly seed_fingerprint: (a: number, b: number) => [number, number, number, number];
    readonly sign_request: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly start: () => void;
    readonly ufvk_from_seed: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly zflip_address: (a: number, b: number, c: number) => number;
    readonly zflip_apply_signatures: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly zflip_free: (a: number) => void;
    readonly zflip_mnemonic_new: (a: number, b: number) => number;
    readonly zflip_mnemonic_seed: (a: number, b: number) => number;
    readonly zflip_seed_fingerprint: (a: number, b: number, c: number) => number;
    readonly zflip_sign_request: (a: number, b: number, c: number, d: number) => number;
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly rust_sqlite_wasm_abort: () => void;
    readonly rust_sqlite_wasm_assert_fail: (a: number, b: number, c: number, d: number) => void;
    readonly rust_sqlite_wasm_calloc: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_free: (a: number) => void;
    readonly rust_sqlite_wasm_getentropy: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_localtime: (a: number) => number;
    readonly rust_sqlite_wasm_malloc: (a: number) => number;
    readonly rust_sqlite_wasm_realloc: (a: number, b: number) => number;
    readonly sqlite3_os_end: () => number;
    readonly sqlite3_os_init: () => number;
    readonly wasm_bindgen_6574bad6551acc69___convert__closures_____invoke___js_sys_44e02b69d732429a___Function_fn_wasm_bindgen_6574bad6551acc69___JsValue_____wasm_bindgen_6574bad6551acc69___sys__Undefined___js_sys_44e02b69d732429a___Function_fn_wasm_bindgen_6574bad6551acc69___JsValue_____wasm_bindgen_6574bad6551acc69___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_6574bad6551acc69___convert__closures_____invoke___wasm_bindgen_6574bad6551acc69___JsValue__core_f0fd674eaa06beef___result__Result_____wasm_bindgen_6574bad6551acc69___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
