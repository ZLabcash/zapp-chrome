// ZApp's WalletModel, in the offscreen document: the wallets, one active at a time, all synced
// together (one engine database, one account each).
//
// - A Flipper wallet is watch-only here: this side syncs, builds the PCZT and proves; the
//   Flipper (over Web Bluetooth, from the page) checks and signs.
// - A browser wallet's phrase is sealed by the user's password (Argon2id + AES-256-GCM) and
//   opened for one signature at a time, as ZApp opens the Keychain with Face ID.

import type { EngineClient, SyncState } from "../engine/client";
import {
  type ActivityItem,
  type Contact,
  DEFAULT_SETTINGS,
  type Payment,
  type PendingBroadcast,
  type SendStep,
  type Settings,
  type State,
  type Wallet,
} from "./types";
import { toB64, fromB64, hexReverse, uuid } from "./util";
import { PriceService } from "./prices";

/** 2026-10-01: no ZFlip wallet is older (a Flipper whose clock was never set stamps years back). */
const ZFLIP_EPOCH = 1_790_812_800;
/** NU5 (June 2022), the Orchard pool: the oldest a wallet here can hold funds in. */
const NU5_TIME = 1_654_041_600;
const NU5_HEIGHT = [1_687_104, 1_842_420];
const DAY = 86_400;

type Stored = {
  wallets: Wallet[];
  activeId: string | null;
  pending: PendingBroadcast[];
  contacts: Contact[];
  settings: Settings;
  /** Vault: salt (b64), a check value sealed with the key, phrases sealed with it by wallet id. */
  vault: { salt: string; check: string; phrases: Record<string, string>; passkey?: { id: string; wrapped: string; salt: string } } | null;
};

export class WalletModel {
  private stored: Stored = { wallets: [], activeId: null, pending: [], contacts: [], settings: { ...DEFAULT_SETTINGS }, vault: null };
  private sync: SyncState = { progress: 0, tip: 0, scanned: 0, syncing: false, upToDate: false, error: null, reachable: true };
  private balances: Record<string, { spendable: number; change: number; pending: number }> = {};
  private activity: ActivityItem[] = [];
  private send: SendStep = { step: "idle" };
  /** Proofs being made while the Flipper checks a payment, by send id. */
  private proving = new Map<string, { pczt: Uint8Array; proofs: Promise<Uint8Array>; payments: Payment[]; fee: number; walletId: string }>();
  readonly prices = new PriceService();
  private online = navigator.onLine;
  private opened = false;
  onChange: () => void = () => {};

  constructor(private engine: EngineClient) {
    engine.onSync = (s) => {
      this.sync = s;
      this.online = navigator.onLine;
      this.refresh();
    };
    engine.onChanged = () => this.refresh();
    this.prices.onChange = () => this.onChange();
    addEventListener("online", () => ((this.online = true), this.onChange()));
    addEventListener("offline", () => ((this.online = false), this.onChange()));
  }

  // ---- lifecycle ----

  async open() {
    if (this.opened) return;
    // Offscreen documents have no chrome.storage: the extension origin's localStorage (on disk too).
    const raw = localStorage.getItem("zapp");
    const saved = raw ? (JSON.parse(raw) as Partial<Stored>) : undefined;
    if (saved) this.stored = { ...this.stored, ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
    await this.engine.call("open", 0, this.stored.settings.server);
    this.opened = true;
    await this.ensureAccounts();
    this.prices.start(() => this.stored.settings.currency);
    await this.refresh();
    if (this.stored.wallets.length) this.engine.call("sync");
  }

  /** Every wallet has its account (re-imported if the database was lost). */
  private async ensureAccounts() {
    const accounts: { uuid: string; ufvk: string }[] = await this.engine.call("accounts");
    for (const w of this.stored.wallets) {
      const found = accounts.find((a) => a.ufvk === w.ufvk);
      if (found) {
        w.accountUuid = found.uuid;
        continue;
      }
      w.accountUuid = await this.engine.call("importAccount", w.name, w.ufvk, w.birthday, new Uint8Array(w.seedFingerprint), w.account, w.kind === "phone" ? "zapp" : "zflip");
    }
    await this.save();
  }

  private async save() {
    localStorage.setItem("zapp", JSON.stringify(this.stored));
  }

  get active(): Wallet | null {
    return this.stored.wallets.find((w) => w.id === this.stored.activeId) ?? this.stored.wallets[0] ?? null;
  }

  state(): State {
    const a = this.active;
    const b = a ? this.balances[a.accountUuid] : undefined;
    return {
      ready: this.opened,
      wallets: this.stored.wallets,
      activeId: a?.id ?? null,
      balances: Object.fromEntries(this.stored.wallets.map((w) => {
        const x = this.balances[w.accountUuid];
        return [w.id, x ? x.spendable + x.change : 0];
      })),
      balance: b?.spendable ?? 0,
      pending: b?.pending ?? 0,
      change: b?.change ?? 0,
      sync: {
        progress: this.sync.progress,
        tip: this.sync.tip,
        scanned: this.sync.scanned,
        synced: this.sync.upToDate && !this.sync.syncing ? true : this.sync.upToDate && this.sync.progress >= 1,
        error: this.sync.error,
        reachable: this.sync.reachable,
      },
      activity: this.activity,
      pendingBroadcasts: this.stored.pending,
      contacts: this.stored.contacts,
      settings: this.stored.settings,
      prices: this.prices.prices,
      vault: { exists: !!this.stored.vault, passkey: !!this.stored.vault?.passkey },
      send: this.send,
      online: this.online,
    };
  }

  /** Balances and the active wallet's activity, after a sync step. */
  private refreshing = false;
  private async refresh() {
    if (!this.opened || this.refreshing) return this.onChange();
    this.refreshing = true;
    try {
      const summary = await this.engine.call("summary");
      if (summary) {
        this.balances = summary.balances;
        if (summary.chainTip) this.sync.tip = summary.chainTip;
      }
      await this.loadActivity();
    } catch (e) {
      console.warn("[zapp] refresh", e);
    } finally {
      this.refreshing = false;
      this.onChange();
    }
  }

  private async loadActivity() {
    const a = this.active;
    if (!a) {
      this.activity = [];
      return;
    }
    const txs: any[] = await this.engine.call("transactions", a.accountUuid);
    const items: ActivityItem[] = [];
    for (const t of txs) {
      const sent = t.delta < 0;
      const fee = sent ? t.fee ?? 0 : null;
      let memos: string[] = [];
      if (t.memoCount > 0) {
        const outs: any[] = await this.engine.call("outputs", t.txid);
        memos = outs.filter((o) => o.memo && (sent ? o.fromAccount === a.accountUuid && !o.isChange : o.toAccount === a.accountUuid)).map((o) => o.memo);
        memos = [...new Set(memos)];
      }
      items.push({
        id: t.txid,
        txid: hexReverse(t.txid),
        sent,
        zatoshi: Math.abs(t.delta) - (fee ?? 0),
        fee,
        minedHeight: t.minedHeight ?? null,
        expired: t.expiredUnmined,
        blockTime: t.blockTime ?? null,
        memos,
      });
    }
    this.activity = items;
  }

  // ---- wallets ----

  /** Height of a date, between NU5 and the tip (75 s blocks). */
  private async heightAt(time: number): Promise<number> {
    const tip = this.sync.tip || (await this.engine.call<number>("latestHeight"));
    const now = Date.now() / 1000;
    const h0 = NU5_HEIGHT[0];
    const est = Math.round(h0 + ((time - NU5_TIME) * (tip - h0)) / (now - NU5_TIME));
    return Math.max(h0, Math.min(tip, est));
  }

  private async add(w: Omit<Wallet, "accountUuid">): Promise<Wallet> {
    const known = this.stored.wallets.find((x) => x.ufvk === w.ufvk);
    if (known) {
      this.stored.activeId = known.id;
      await this.save();
      await this.refresh();
      return known;
    }
    const accountUuid = await this.engine.call<string>("importAccount", w.name, w.ufvk, w.birthday, new Uint8Array(w.seedFingerprint), w.account, w.kind === "phone" ? "zapp" : "zflip");
    const wallet = { ...w, accountUuid };
    this.stored.wallets.push(wallet);
    this.stored.activeId = wallet.id;
    await this.save();
    await this.refresh();
    return wallet;
  }

  async activate(id: string) {
    if (!this.stored.wallets.some((w) => w.id === id)) return;
    this.stored.activeId = id;
    this.activity = [];
    await this.save();
    await this.refresh();
  }

  async rename(id: string, name: string) {
    const w = this.stored.wallets.find((x) => x.id === id);
    if (!w) return;
    w.name = name.trim() || w.deviceName;
    await this.save();
    this.onChange();
  }

  /** Removes a wallet (its account, and its sealed phrase for a browser wallet). Funds stay on chain. */
  async remove(id: string) {
    const w = this.stored.wallets.find((x) => x.id === id);
    if (!w) return;
    await this.engine.call("deleteAccount", w.accountUuid).catch(() => {});
    if (this.stored.vault) delete this.stored.vault.phrases[id];
    this.stored.wallets = this.stored.wallets.filter((x) => x.id !== id);
    this.stored.pending = this.stored.pending.filter((p) => p.walletId !== id);
    if (this.stored.activeId === id) this.stored.activeId = this.stored.wallets[0]?.id ?? null;
    if (!this.stored.wallets.length && this.stored.vault && !Object.keys(this.stored.vault.phrases).length) this.stored.vault = null;
    await this.save();
    await this.refresh();
  }

  /** A Flipper's INFO: the watch-only wallet for it (or switch to it when already here). */
  async addFlipperWallet(info: { network: number; account: number; seedFingerprint: number[]; ufvk: string; createdAt: number; deviceName: string; addressIndex: number }, restoredFrom: number | null) {
    let since: number;
    if (info.createdAt > 0) since = Math.max(info.createdAt, ZFLIP_EPOCH);
    else since = Math.max(restoredFrom ?? NU5_TIME, NU5_TIME);
    const birthday = Math.max(await this.heightAt(since - DAY), NU5_HEIGHT[info.network === 1 ? 1 : 0]);
    const known = this.stored.wallets.find((w) => w.kind === "flipper" && w.ufvk === info.ufvk);
    if (known) {
      known.deviceName = info.deviceName;
      known.addressIndex = info.addressIndex;
      this.stored.activeId = known.id;
      await this.save();
      await this.refresh();
      return known.id;
    }
    const w = await this.add({
      id: uuid(),
      kind: "flipper",
      name: info.deviceName,
      deviceName: info.deviceName,
      network: info.network,
      ufvk: info.ufvk,
      seedFingerprint: info.seedFingerprint,
      account: info.account,
      birthday,
      addressIndex: info.addressIndex,
    });
    return w.id;
  }

  /** The Flipper shows another receiving address: follow it once checked against the UFVK. */
  async flipperShows(index: number, address: string) {
    const w = this.active;
    if (!w || w.kind !== "flipper") return;
    if ((await this.engine.call("address", w.ufvk, index)) !== address) return;
    w.addressIndex = index;
    await this.save();
    this.onChange();
  }

  async rememberDevice(walletId: string, deviceId: string) {
    const w = this.stored.wallets.find((x) => x.id === walletId);
    if (!w || !deviceId) return;
    w.deviceId = deviceId;
    await this.save();
  }

  async rememberIndex(walletId: string, index: number) {
    const w = this.stored.wallets.find((x) => x.id === walletId);
    if (!w || w.addressIndex === index) return;
    w.addressIndex = index;
    await this.save();
    this.onChange();
  }

  // ---- browser wallets and the vault ----

  newPhrase(): Promise<string> {
    return this.engine.call("mnemonicNew");
  }

  isWord(w: string): Promise<boolean> {
    return this.engine.call("isWord", w);
  }

  /** The vault key from the password, checked; creates the vault on first use. */
  private async vaultKey(password: string): Promise<Uint8Array> {
    const v = this.stored.vault;
    if (!v) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key: Uint8Array = await this.engine.call("kdf", password, salt);
      const check: Uint8Array = await this.engine.call("seal", key, new TextEncoder().encode("zapp"));
      this.stored.vault = { salt: toB64(salt), check: toB64(check), phrases: {} };
      return key;
    }
    const key: Uint8Array = await this.engine.call("kdf", password, fromB64(v.salt));
    try {
      await this.engine.call("open_", key, fromB64(v.check));
    } catch {
      throw new Error("WRONG_PASSWORD");
    }
    return key;
  }

  async checkPassword(password: string): Promise<boolean> {
    if (!this.stored.vault) return true;
    try {
      await this.vaultKey(password);
      return true;
    } catch {
      return false;
    }
  }

  /** Creates (`since` null: from today) or restores a browser wallet; the phrase is sealed by `password`. */
  async addPhoneWallet(name: string, phrase: string, since: number | null, password: string) {
    const clean = phrase.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
    const { fingerprint, ufvk } = await this.engine.call<{ fingerprint: Uint8Array; ufvk: string }>("mnemonicCheck", clean).catch(() => {
      throw new Error("BAD_PHRASE");
    });
    if (this.stored.wallets.some((w) => w.ufvk === ufvk)) throw new Error("ALREADY_HERE");
    const key = await this.vaultKey(password);
    const birthday =
      since === null
        ? Math.max(this.sync.tip || (await this.engine.call<number>("latestHeight")), NU5_HEIGHT[0])
        : Math.max(await this.heightAt(since - DAY), NU5_HEIGHT[0]);
    const id = uuid();
    const sealed: Uint8Array = await this.engine.call("seal", key, new TextEncoder().encode(clean));
    key.fill(0);
    this.stored.vault!.phrases[id] = toB64(sealed);
    try {
      await this.add({ id, kind: "phone", name, deviceName: name, network: 0, ufvk, seedFingerprint: [...fingerprint], account: 0, birthday, addressIndex: 0 });
    } catch (e) {
      delete this.stored.vault!.phrases[id];
      await this.save();
      throw e;
    }
  }

  /** The active browser wallet's words, after the password. */
  async recoveryPhrase(password: string): Promise<string> {
    const w = this.active;
    if (!w || w.kind !== "phone") throw new Error("ON_DEVICE");
    const key = await this.vaultKey(password);
    const plain: Uint8Array = await this.engine.call("open_", key, fromB64(this.stored.vault!.phrases[w.id]));
    key.fill(0);
    const words = new TextDecoder().decode(plain);
    plain.fill(0);
    return words;
  }

  async newPhoneAddress() {
    const w = this.active;
    if (!w || w.kind !== "phone") return;
    w.addressIndex += 1;
    await this.save();
    this.onChange();
  }

  address(ufvk: string, index: number): Promise<string> {
    return this.engine.call("address", ufvk, index);
  }

  /** Every address each wallet has shown, to name payments between your own wallets. */
  async ownAddresses(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const w of this.stored.wallets) {
      for (let i = 0; i <= w.addressIndex; i++) out[await this.address(w.ufvk, i)] = w.id;
    }
    return out;
  }

  addressKind(text: string): Promise<string> {
    return this.engine.call("addressKind", text);
  }

  // ---- contacts and settings ----

  async saveContact(c: Contact) {
    const clean = { ...c, id: c.id || uuid(), name: c.name.trim(), address: c.address.trim() };
    const i = this.stored.contacts.findIndex((x) => x.id === clean.id);
    if (i >= 0) this.stored.contacts[i] = clean;
    else this.stored.contacts.push(clean);
    this.stored.contacts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    await this.save();
    this.onChange();
  }

  async deleteContact(id: string) {
    this.stored.contacts = this.stored.contacts.filter((c) => c.id !== id);
    await this.save();
    this.onChange();
  }

  async setSettings(patch: Partial<Settings>) {
    const before = this.stored.settings;
    this.stored.settings = { ...before, ...patch };
    await this.save();
    if (patch.server && patch.server !== before.server) this.engine.call("setServer", patch.server);
    if (patch.currency && patch.currency !== before.currency) this.prices.refresh();
    this.onChange();
  }

  syncNow() {
    return this.engine.call("sync");
  }

  // ---- sending ----

  /** ZIP 321: zcash:?address=…&amount=…&memo=…&address.1=… (memos base64url, shielded only). */
  static paymentUri(payments: Payment[]): string {
    const params: string[] = [];
    payments.forEach((p, i) => {
      const s = i === 0 ? "" : `.${i}`;
      params.push(`address${s}=${p.address}`);
      params.push(`amount${s}=${decimalZec(p.zatoshi)}`);
      if (p.memo && !p.address.startsWith("t")) {
        const b64 = toB64(new TextEncoder().encode(p.memo)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        params.push(`memo${s}=${b64}`);
      }
    });
    return "zcash:?" + params.join("&");
  }

  /** The fee of paying `payments` now, or null if it can't be built. */
  async proposalFee(payments: Payment[]): Promise<number | null> {
    const w = this.active;
    if (!w) return null;
    try {
      const p = await this.engine.call("propose", w.accountUuid, WalletModel.paymentUri(payments.map((x) => ({ ...x, memo: "" }))));
      return p.fee;
    } catch {
      return null;
    }
  }

  setSend(s: SendStep) {
    this.send = s;
    this.onChange();
  }

  private explain(e: unknown, payments: Payment[]): string {
    const m = e instanceof Error ? e.message : String(e);
    if (/insufficient/i.test(m)) return `INSUFFICIENT:${payments.reduce((a, p) => a + p.zatoshi, 0)}`;
    return m;
  }

  /** A browser wallet's payment: the password opens its phrase for this one signature. */
  async sendFromBrowser(payments: Payment[], password: string) {
    const w = this.active;
    if (!w || w.kind !== "phone") return;
    this.setSend({ step: "preparing" });
    try {
      const key = await this.vaultKey(password);
      const p = await this.engine.call("propose", w.accountUuid, WalletModel.paymentUri(payments));
      const params = p.needsSapling ? await this.saplingParams() : [undefined, undefined];
      const txids: string[] = await this.engine.call("createTransactions", p.proposal, fromB64(this.stored.vault!.phrases[w.id]), key, w.account, p.needsSapling, ...params);
      this.setSend({ step: "broadcasting" });
      let error: string | null = null;
      for (const t of txids) error ??= await this.engine.call("broadcast", t);
      this.setSend(error ? { step: "failed", message: `NETWORK:${error}` } : { step: "sent", txid: hexReverse(txids[txids.length - 1]) });
      await this.refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "WRONG_PASSWORD") {
        this.setSend({ step: "idle" });
        throw e;
      }
      this.setSend({ step: "failed", message: this.explain(e, payments) });
    }
  }

  /**
   * A Flipper wallet's payment, first half: the PCZT and the request the Flipper checks; the
   * proofs start now, while the user checks it on the Flipper.
   */
  async prepareFlipperSend(payments: Payment[]): Promise<{ id: string; request: Uint8Array }> {
    const w = this.active;
    if (!w || w.kind !== "flipper") throw new Error("not a Flipper wallet");
    this.setSend({ step: "preparing" });
    try {
      const p = await this.engine.call("propose", w.accountUuid, WalletModel.paymentUri(payments));
      const pczt: Uint8Array = await this.engine.call("createPczt", w.accountUuid, p.proposal);
      const request: Uint8Array = await this.engine.call("signRequest", pczt, w.ufvk);
      const params = p.needsSapling ? await this.saplingParams() : [];
      const proofs = this.engine.call<Uint8Array>("prove", pczt, ...params);
      proofs.catch(() => {});
      const id = uuid();
      this.proving.set(id, { pczt, proofs, payments, fee: p.fee, walletId: w.id });
      this.setSend({ step: "confirmOnDevice" });
      return { id, request };
    } catch (e) {
      this.setSend({ step: "failed", message: this.explain(e, payments) });
      throw e;
    }
  }

  /** Second half: the Flipper's signatures; broadcast now, or keep it to broadcast later. */
  async finishFlipperSend(id: string, signatures: Uint8Array) {
    const job = this.proving.get(id);
    if (!job) return;
    this.proving.delete(id);
    const w = this.stored.wallets.find((x) => x.id === job.walletId)!;
    try {
      const signed: Uint8Array = await this.engine.call("applySignatures", job.pczt, signatures);
      const proofs = await job.proofs;
      const reachable = this.stored.settings.autoBroadcast ? await this.serverReachable() : false;
      if (!reachable) {
        const tip = this.sync.tip;
        const p: PendingBroadcast = {
          id: uuid(),
          created: Date.now(),
          payments: job.payments,
          expiryHeight: tip + 40,
          signedHeight: tip,
          walletId: w.id,
          fee: job.fee,
          signer: w.deviceName,
          proofs: toB64(proofs),
          sigs: toB64(signed),
        };
        this.stored.pending.push(p);
        await this.save();
        this.setSend({ step: "signedOffline", pendingId: p.id });
        return;
      }
      this.setSend({ step: "broadcasting" });
      const txid: string = await this.engine.call("extractAndStore", proofs, signed);
      const error = await this.engine.call<string | null>("broadcast", txid);
      this.setSend(error ? { step: "failed", message: `NETWORK:${error}` } : { step: "sent", txid: hexReverse(txid) });
      await this.refresh();
    } catch (e) {
      this.setSend({ step: "failed", message: this.explain(e, job.payments) });
    }
  }

  cancelFlipperSend(id: string, message?: string) {
    this.proving.delete(id);
    this.setSend(message ? { step: "failed", message } : { step: "idle" });
  }

  /** Whether lightwalletd answers now (a route to the internet isn't enough). */
  async serverReachable(): Promise<boolean> {
    if (!navigator.onLine) return false;
    try {
      await this.engine.call("latestHeight");
      return true;
    } catch {
      return false;
    }
  }

  expired(p: PendingBroadcast): boolean {
    const deadline = p.created + (p.expiryHeight - p.signedHeight) * 75_000;
    return (this.sync.tip > 0 && this.sync.tip >= p.expiryHeight) || Date.now() > deadline + 10 * 60_000;
  }

  /** Hands a kept transaction to the network; returns the error to show, or null once sent. */
  async broadcast(id: string): Promise<string | null> {
    const p = this.stored.pending.find((x) => x.id === id);
    if (!p) return null;
    if (this.expired(p)) return "EXPIRED";
    if (!(await this.serverReachable())) return "UNREACHABLE";
    try {
      const txid: string = await this.engine.call("extractAndStore", fromB64(p.proofs), fromB64(p.sigs));
      const error = await this.engine.call<string | null>("broadcast", txid);
      // Stored by the engine now, which keeps track of it: it no longer waits here.
      this.stored.pending = this.stored.pending.filter((x) => x.id !== id);
      await this.save();
      if (!error) this.setSend(this.send.step === "signedOffline" ? { step: "sent", txid: hexReverse(txid) } : this.send);
      await this.refresh();
      return error ? `NETWORK:${error}` : null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  async discard(id: string) {
    this.stored.pending = this.stored.pending.filter((x) => x.id !== id);
    await this.save();
    this.onChange();
  }

  /** Who a payment went to (not this wallet's own change). */
  async recipients(txHex: string): Promise<string[]> {
    const a = this.active;
    const outs: any[] = await this.engine.call("outputs", txHex);
    return outs.filter((o) => o.fromAccount === a?.accountUuid && !o.isChange && o.toAddress && o.toAccount !== a?.accountUuid).map((o) => o.toAddress);
  }

  /** The Sapling parameters (only for a Sapling recipient or note), downloaded once and kept. */
  private async saplingParams(): Promise<[Uint8Array, Uint8Array]> {
    const dir = await navigator.storage.getDirectory();
    const get = async (name: string) => {
      try {
        const f = await (await dir.getFileHandle(name)).getFile();
        if (f.size > 0) return new Uint8Array(await f.arrayBuffer());
      } catch {}
      const bytes = new Uint8Array(await (await fetch(`https://download.z.cash/downloads/${name}`)).arrayBuffer());
      const h = await dir.getFileHandle(name, { create: true });
      const wr = await h.createWritable();
      await wr.write(bytes);
      await wr.close();
      return bytes;
    };
    return [await get("sapling-spend.params"), await get("sapling-output.params")];
  }
}

/** 12345 zatoshis → "0.00012345". */
export function decimalZec(z: number): string {
  const whole = Math.floor(z / 1e8);
  let frac = String(z % 1e8).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
