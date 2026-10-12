// The engine's home: a dedicated worker (SQLite on OPFS needs one), started by the offscreen
// document so the wallets keep syncing while the browser is open, popup closed or not.
//
// The sync loop is `zcash_client_backend::sync::run`, as the iOS SDK runs it: subtree roots,
// chain tip, verify, then each suggested range in batches (download, tree state, scan), then
// the transactions to look up in full (memos, what was sent) or to check the status of.

import init, * as zapp from "./pkg/zapp_engine.js";
import { Lwd, LwdError } from "./lwd";

export type SyncState = {
  /** 0…1 */
  progress: number;
  tip: number;
  scanned: number;
  syncing: boolean;
  upToDate: boolean;
  error: string | null;
  /** The server answered the last request. */
  reachable: boolean;
};

let engine: zapp.Engine;
let lwd = new Lwd("zec.rocks:443");
let network = 0;
const state: SyncState = { progress: 0, tip: 0, scanned: 0, syncing: false, upToDate: false, error: null, reachable: true };
let rootsLoaded = false;
let running: Promise<void> | null = null;
let again = false;

// Smaller batches scan in shorter synchronous bursts, so quick calls (deriving an address) slip
// between them instead of waiting out a whole 2000-block scan (~9 s on wasm).
const BATCH = 1000;

/** Debug trace, forwarded to the pages. */
function trace(text: string) {
  postMessage({ event: "log", text });
}

function emit() {
  postMessage({ event: "sync", state: { ...state } });
}

function changed() {
  postMessage({ event: "changed" });
}

type Fetched = { blocks: Uint8Array[]; from: Uint8Array };

function fetchRange(start: number, end: number): Promise<Fetched> {
  return Promise.all([lwd.blockRange(start, end - 1), lwd.treeState(start - 1)]).then(([blocks, from]) => ({ blocks, from }));
}

async function scanRange(start: number, end: number, priority: number, fetched?: Promise<Fetched>): Promise<{ rewoundTo?: number; rangesChanged: boolean }> {
  const { blocks, from } = await (fetched ?? fetchRange(start, end));
  return engine.scan_blocks(start, from, blocks, priority);
}

type Range = { start: number; end: number; priority: number };

/** One pass of `running`: true if the ranges changed and another pass is needed. */
async function pass(): Promise<boolean> {
  const tip = await lwd.latestHeight();
  state.reachable = true;
  state.tip = tip;
  engine.update_chain_tip(tip);

  let ranges: Range[] = engine.suggest_scan_ranges();
  while (ranges[0]?.priority === 60) {
    const r = ranges[0];
    const out = await scanRange(r.start, r.end, r.priority);
    if (!out.rangesChanged) break;
    ranges = engine.suggest_scan_ranges();
  }

  ranges = (engine.suggest_scan_ranges() as Range[]).filter((r) => r.priority > 10);
  // Batches in order, the next one downloading while this one is scanned.
  const batches: { start: number; end: number; priority: number }[] = [];
  for (const r of ranges) for (let b = r.start; b < r.end; b += BATCH) batches.push({ start: b, end: Math.min(b + BATCH, r.end), priority: r.priority });
  let next = batches[0] ? fetchRange(batches[0].start, batches[0].end) : null;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const current = next!;
    next = batches[i + 1] ? fetchRange(batches[i + 1].start, batches[i + 1].end) : null;
    next?.catch(() => {});
    const out = await scanRange(b.start, b.end, b.priority, current);
    refreshSummary();
    emit();
    changed();
    if (out.rangesChanged) return true;
  }
  return false;
}

/** Full transactions for memos and sent details; statuses of unmined ones. */
async function lookUps() {
  const requests: { kind: string; txid: string }[] = engine.data_requests();
  for (const r of requests) {
    const txid = Uint8Array.from(r.txid.match(/../g)!.map((h) => parseInt(h, 16)));
    const tx = await lwd.transaction(txid);
    if (r.kind === "enhance") {
      if (tx) engine.decrypt_and_store(tx.data, Math.max(0, tx.height));
      else engine.set_transaction_status(r.txid, -1n);
    } else {
      engine.set_transaction_status(r.txid, BigInt(tx ? (tx.height > 0 ? tx.height : 0) : -1));
    }
  }
  if (requests.length) changed();
}

function refreshSummary() {
  const s = engine.summary();
  if (!s) return;
  state.progress = s.progress;
  state.scanned = s.fullyScanned;
  if (s.chainTip) state.tip = s.chainTip;
}

async function sync() {
  state.syncing = true;
  state.error = null;
  emit();
  try {
    if (!rootsLoaded) {
      for (const p of [0, 1, 2]) {
        engine.put_subtree_roots(p, 0n, await lwd.subtreeRoots(p));
      }
      rootsLoaded = true;
    }
    while (await pass()) {}
    await lookUps();
    refreshSummary();
    state.upToDate = true;
    state.progress = 1;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    state.error = message;
    state.reachable = !(e instanceof TypeError || (e instanceof LwdError && e.code === 14));
    console.warn("[zapp] sync", e);
  } finally {
    state.syncing = false;
    emit();
    changed();
  }
}

/** Syncs now (or right after the pass under way). */
function requestSync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await sync();
    } while (again);
    running = null;
  })();
  return running;
}

// New blocks every 75 s: look again every 30 s.
setInterval(() => {
  if (engine) requestSync();
}, 30_000);

// ---- calls from the wallet model ----

const calls: Record<string, (...args: any[]) => unknown> = {
  async open(net: number, server: string) {
    network = net;
    lwd = new Lwd(server);
    await init({ module_or_path: new URL("./pkg/zapp_engine_bg.wasm", import.meta.url) });
    engine = await zapp.Engine.open(net);
    // Where the last session left off, before the first pass reports.
    refreshSummary();
    state.upToDate = state.progress >= 1 && state.scanned > 0;
    emit();
    return true;
  },
  setServer(server: string) {
    lwd = new Lwd(server);
    rootsLoaded = false;
    return requestSync();
  },
  sync: () => requestSync(),
  state: () => ({ ...state }),
  accounts: () => engine.accounts(),
  summary: () => engine.summary(),
  transactions: (account: string) => engine.transactions(account),
  outputs: (txid: string) => engine.outputs(txid),
  async latestHeight() {
    return lwd.latestHeight(AbortSignal.timeout(6000));
  },
  /** Imports a wallet; `birthday` is the first block to scan. */
  async importAccount(name: string, ufvk: string, birthday: number, fingerprint: Uint8Array, index: number, source: string) {
    const ts = await lwd.treeState(birthday - 1);
    const id = engine.import_account(name, ufvk, ts, fingerprint, index, source);
    requestSync();
    return id;
  },
  deleteAccount: (uuid: string) => engine.delete_account(uuid),
  /** The block time of `height` (to show a birthday as a date). */
  async blockTime(height: number) {
    return Lwd.treeStateTime(await lwd.treeState(height));
  },
  propose: (account: string, uri: string) => engine.propose(account, uri),
  createPczt: (account: string, proposal: Uint8Array) => engine.create_pczt(account, proposal),
  prove: (pczt: Uint8Array, spend?: Uint8Array, output?: Uint8Array) => zapp.prove_pczt(pczt, spend, output),
  signRequest: (pczt: Uint8Array, ufvk: string) => zapp.sign_request(pczt, ufvk),
  applySignatures: (pczt: Uint8Array, sigs: Uint8Array) => zapp.apply_signatures(pczt, sigs),
  extractAndStore: (proven: Uint8Array, signed: Uint8Array) => engine.extract_and_store(proven, signed),
  /** A phone wallet's payment: the sealed phrase is opened with `key` for this call only. */
  createTransactions(proposal: Uint8Array, sealed: Uint8Array, key: Uint8Array, account: number, needsSapling: boolean, spend?: Uint8Array, output?: Uint8Array) {
    const phrase = zapp.aead_open(key, sealed);
    const seed = zapp.mnemonic_seed(new TextDecoder().decode(phrase));
    phrase.fill(0);
    key.fill(0);
    return engine.create_transactions(proposal, seed, account, spend, output, needsSapling);
  },
  /** Broadcasts a stored transaction; returns the node's error or null. */
  async broadcast(txid: string) {
    const raw = engine.raw_transaction(txid);
    if (!raw) return "The transaction isn't stored.";
    const error = await lwd.send(raw);
    requestSync();
    return error;
  },
  /** Bytes of a stored transaction (kept for broadcasting later). */
  rawTransaction: (txid: string) => engine.raw_transaction(txid),
  async sendRaw(raw: Uint8Array) {
    const error = await lwd.send(raw);
    requestSync();
    return error;
  },
  proveSelftest: () => [...zapp.prove_selftest()],
  setStatus: (txid: string, height: number) => engine.set_transaction_status(txid, BigInt(height)),
  // Keys, phrases and the vault.
  mnemonicNew: () => zapp.mnemonic_new(crypto.getRandomValues(new Uint8Array(32))),
  mnemonicCheck(phrase: string) {
    const seed = zapp.mnemonic_seed(phrase);
    const fp = zapp.seed_fingerprint(seed);
    const ufvk = zapp.ufvk_from_seed(seed, network, 0);
    return { fingerprint: fp, ufvk };
  },
  // The viewing key for a given ZIP-32 account of a seed (account 0 is the first wallet; 1, 2, …
  // are further accounts of the same 24 words, as MetaMask derives accounts from one phrase).
  ufvkForAccount(phrase: string, account: number) {
    const seed = zapp.mnemonic_seed(phrase);
    return { fingerprint: zapp.seed_fingerprint(seed), ufvk: zapp.ufvk_from_seed(seed, network, account) };
  },
  isWord: (w: string) => zapp.is_mnemonic_word(w),
  address: (ufvk: string, index: number) => zapp.address(ufvk, index),
  addressKind: (text: string) => zapp.address_kind(text, network),
  kdf: (password: string, salt: Uint8Array) => zapp.kdf_password(password, salt),
  seal: (key: Uint8Array, plain: Uint8Array) => zapp.aead_seal(key, plain),
  open_: (key: Uint8Array, sealed: Uint8Array) => zapp.aead_open(key, sealed),
};

onmessage = async (e: MessageEvent<{ id: number; call: string; args: unknown[] }>) => {
  const { id, call, args } = e.data;
  try {
    const value = await calls[call](...args);
    postMessage({ id, ok: true, value });
  } catch (err) {
    postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
