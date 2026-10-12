// Activity: the transactions as compact rows, signed payments waiting to be broadcast, and the
// detail of each (ZApp's ActivityViews, laid out as an extension).

import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t, formatDate, formatFiat } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { ConfirmingRing, Hourglass, ZecLogo } from "./marks";
import { CopyButton, Note, Screen, confirm } from "./kit";
import { zec, zecAmount, shortAddress } from "../model/format";
import { CONFIRMATIONS, type ActivityItem, type PendingBroadcast, type State } from "../model/types";
import { confirmations, showsAmounts } from "./home";

export function explorerUrl(s: State, txid: string): string {
  const tpl = s.settings.explorer.includes("{txid}") ? s.settings.explorer : s.settings.explorer + "{txid}";
  return tpl.replace("{txid}", txid);
}

// ---- names: your contacts and your own wallets ----

let own: Record<string, string> = {};
let ownFor = "";

/** The contact or own wallet an address belongs to. */
export function useNames(): (address: string) => string | null {
  const s = useStore();
  const [, set] = useState(0);
  const key = s.wallets.map((w) => w.id + ":" + w.addressIndex).join(",");
  useEffect(() => {
    if (ownFor === key) return;
    call<Record<string, string>>("ownAddresses").then((m) => {
      own = m;
      ownFor = key;
      set((n) => n + 1);
    });
  }, [key]);
  return (address: string) => {
    const a = address.trim();
    const c = s.contacts.find((x) => x.address === a);
    if (c) return c.name;
    const id = a.length > 20 ? own[a] : undefined;
    return id ? s.wallets.find((w) => w.id === id)?.name ?? null : null;
  };
}

// ---- status ----

export function statusShort(s: State, tx: ActivityItem): string {
  if (tx.expired) return t("Expired");
  const n = confirmations(s, tx.minedHeight);
  if (n === null) return t("Pending · in the mempool");
  if (n < CONFIRMATIONS) return t("Confirming %lld/10", n);
  return tx.blockTime ? formatDate(tx.blockTime, "short") : t("Confirmed");
}

function statusLong(s: State, tx: ActivityItem): string {
  if (tx.expired) return t("Expired, never mined");
  const n = confirmations(s, tx.minedHeight);
  if (n === null) return t("Pending, in the mempool");
  if (n < CONFIRMATIONS) return t("Confirming, %lld of 10 confirmations", n);
  return t("Confirmed · %@ confirmations", new Intl.NumberFormat().format(n));
}

/** By where it is: an hourglass in the mempool, a check with a turning arc while it confirms, then the arrow. */
export function TxIcon({ tx, size }: { tx: ActivityItem; size: number }) {
  const s = useStore();
  const color = tx.sent ? "#bfbfbf" : "var(--zcash)";
  const n = confirmations(s, tx.minedHeight);
  const disc = (child: preact.ComponentChildren, bg: string, fg = "#000") => (
    <span style={{ width: size, height: size, borderRadius: size / 2, background: bg, color: fg, display: "grid", placeItems: "center", flexShrink: 0 }}>{child}</span>
  );
  if (tx.expired) return disc(<Icon name="x" size={size * 0.42} stroke={3} />, "rgba(255,59,48,0.8)", "#fff");
  if (n !== null && n >= CONFIRMATIONS) return disc(<Icon name={tx.sent ? "arrow-up" : "arrow-down"} size={size * 0.46} stroke={3} />, color);
  if (n !== null) return <ConfirmingRing color={color} size={size} />;
  return disc(<Hourglass size={size * 0.48} color="#000" />, color);
}

// ---- lists ----

export function ActivityList() {
  const s = useStore();
  const shows = showsAmounts(s);
  const code = s.settings.currency;
  if (!s.activity.length) {
    return (
      <div class="foot muted" style={{ padding: "28px 16px", textAlign: "center" }}>
        {s.sync.synced ? t("No transactions yet.") : t("Transactions appear here as the wallet syncs.")}
      </div>
    );
  }
  return (
    <div class="stack" style={{ padding: "4px 0 12px" }}>
      {s.activity.map((tx) => (
        <button key={tx.id} class="list-row" onClick={() => nav.push(() => <TxScreen id={tx.id} />)}>
          <TxIcon tx={tx} size={34} />
          <div class="stack gap-2 spacer" style={{ minWidth: 0 }}>
            <span class="sub b">{tx.sent ? t("Sent") : t("Received")}</span>
            <span class="cap muted ellipsis">{tx.memos[0] ? `“${tx.memos[0]}”` : statusShort(s, tx)}</span>
          </div>
          <div class="stack" style={{ alignItems: "flex-end" }}>
            <span class="sub b num">{(tx.sent ? "−" : "+") + (shows ? zec(tx.zatoshi) : "•••• ZEC")}</span>
            {shows && <span class="cap muted num">{formatFiat(tx.zatoshi, s.prices[code], code)}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

export function PendingList() {
  const s = useStore();
  const here = s.pendingBroadcasts.filter((p) => p.walletId === s.activeId);
  return (
    <div class="stack" style={{ padding: "4px 0 12px" }}>
      {here.map((p) => (
        <button key={p.id} class="list-row" onClick={() => nav.push(() => <PendingScreen id={p.id} />)}>
          <PendingRow p={p} />
        </button>
      ))}
    </div>
  );
}

export function expired(s: State, p: PendingBroadcast): boolean {
  return (s.sync.tip > 0 && s.sync.tip >= p.expiryHeight) || Date.now() > deadline(p) + 10 * 60_000;
}

function deadline(p: PendingBroadcast) {
  return p.created + (p.expiryHeight - p.signedHeight) * 75_000;
}

/** Seconds left to broadcast, by the clock, pulled in if the chain is ahead of it. */
function secondsLeft(s: State, p: PendingBroadcast): number {
  const byClock = Math.floor((deadline(p) - Date.now()) / 1000);
  if (s.sync.tip <= 0 || !s.online) return Math.max(0, byClock);
  return Math.max(0, Math.min(byClock, (p.expiryHeight - s.sync.tip) * 75));
}

function windowLeft(s: State, p: PendingBroadcast): number {
  const total = (deadline(p) - p.created) / 1000;
  return total > 0 ? Math.min(1, Math.max(0, secondsLeft(s, p) / total)) : 0;
}

/** "Sent to …", the amount, and the time left to broadcast. */
function PendingRow({ p }: { p: PendingBroadcast }) {
  const s = useStore();
  const name = useNames();
  const first = p.payments[0]?.address ?? "";
  const to = (name(first) ?? first.slice(0, 7) + "…") + (p.payments.length > 1 ? ` +${p.payments.length - 1}` : "");
  const total = p.payments.reduce((a, x) => a + x.zatoshi, 0);
  return (
    <div class="stack gap-8" style={{ flex: 1, minWidth: 0 }}>
      <div class="row gap-12">
        <span style={{ width: 34, height: 34, borderRadius: 17, background: expired(s, p) ? "var(--red)" : "var(--orange)", color: "#000", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon name="antenna" size={17} stroke={2.4} />
        </span>
        <span class="sub b ellipsis spacer">{t("Sent to %@", to)}</span>
        <span class="sub b num">−{zec(total)}</span>
      </div>
      <BroadcastTimer p={p} />
    </div>
  );
}

/** The time left to broadcast: a line that empties, and the countdown beside it, live. */
function BroadcastTimer({ p }: { p: PendingBroadcast }) {
  const s = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const left = secondsLeft(s, p);
  const ex = expired(s, p) || left === 0;
  const frac = windowLeft(s, p);
  const color = ex ? "var(--red)" : frac < 0.25 ? "var(--orange)" : "var(--zcash)";
  return (
    <div class="row gap-10" style={{ direction: "ltr" }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--muted) 25%, transparent)", position: "relative" }}>
        <div style={{ position: "absolute", insetBlock: 0, left: 0, width: `${frac * 100}%`, borderRadius: 2, background: color, transition: "width 1s linear" }} />
      </div>
      <span class={`cap num ${ex ? "red" : "ink"}`} style={{ fontWeight: 600, minWidth: 40, textAlign: "right" }}>
        {ex ? t("Expired") : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
      </span>
    </div>
  );
}

// ---- details ----

function Kv({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div class="kv" style={{ borderBottom: "1px solid var(--line)" }}>
      <span>{k}</span>
      <span class={mono ? "mono cap" : ""} style={{ userSelect: "text" }}>
        {v}
      </span>
    </div>
  );
}

/** A recipient: name when known, short address; click to see it whole and copy it. */
export function AddressKv({ label, address }: { label: string; address: string }) {
  const name = useNames();
  const [open, setOpen] = useState(false);
  const n = name(address);
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <button class="kv" style={{ width: "100%", textAlign: "start" }} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <span class="stack" style={{ alignItems: "flex-end" }}>
          {n && <span class="b" style={{ fontWeight: 600 }}>{n}</span>}
          <span class="mono cap muted row gap-4">
            {shortAddress(address)}
            <Icon name={open ? "chevron-up" : "chevron-down"} size={11} stroke={3} />
          </span>
        </span>
      </button>
      {open && (
        <div class="stack gap-6" style={{ paddingBottom: 10 }}>
          <span class="mono cap2 break" style={{ userSelect: "all" }}>
            {address}
          </span>
          <span style={{ alignSelf: "flex-end" }}>
            <CopyButton text={address} small />
          </span>
        </div>
      )}
    </div>
  );
}

/** The detail of one transaction: who, how much, status, message, date, id, explorer. */
function TxScreen({ id }: { id: string }) {
  const s = useStore();
  const tx = s.activity.find((x) => x.id === id);
  const shows = showsAmounts(s);
  const [recipients, setRecipients] = useState<string[]>([]);
  useEffect(() => {
    if (tx?.sent) call<string[]>("recipients", tx.id).then(setRecipients);
  }, [id]);
  if (!tx) return <Screen title="">{null}</Screen>;
  const url = explorerUrl(s, tx.txid);
  return (
    <Screen
      title={tx.sent ? t("Sent") : t("Received")}
      footer={
        <a class="btn line wide" href={url} target="_blank">
          <Icon name="external" size={16} />
          {t("View on %@", new URL(url).host)}
        </a>
      }
    >
      <div class="stack gap-14" style={{ padding: 16 }}>
        <div class="stack center gap-8" style={{ padding: "6px 0" }}>
          <TxIcon tx={tx} size={46} />
          <div class="row gap-8">
            <span class="rounded num" style={{ fontSize: 30, fontWeight: 700 }}>
              {(tx.sent ? "−" : "+") + (shows ? zecAmount(tx.zatoshi) : "••••")}
            </span>
            <ZecLogo size={24} />
          </div>
          <span class="foot muted">{statusLong(s, tx)}</span>
        </div>
        <div class="stack">
          {tx.sent ? (
            <>
              {recipients.length === 0 && <Kv k={t("To")} v={t("Shielded recipient")} />}
              {recipients.map((r, i) => (
                <AddressKv key={i} label={recipients.length > 1 ? t("To (%lld)", i + 1) : t("To")} address={r} />
              ))}
              {tx.fee !== null && <Kv k={t("Network fee")} v={zec(tx.fee)} />}
            </>
          ) : (
            <Kv k={t("From")} v={t("Shielded sender")} />
          )}
          {tx.blockTime && <Kv k={t("Date")} v={formatDate(tx.blockTime)} />}
          {tx.memos.length === 0 ? <Kv k={t("Message")} v={t("None")} /> : tx.memos.map((m, i) => <Kv key={i} k={tx.memos.length > 1 ? t("Message (%lld)", i + 1) : t("Message")} v={m} />)}
          <div class="stack gap-6" style={{ padding: "10px 0" }}>
            <div class="row">
              <span class="foot muted">{t("Transaction ID")}</span>
              <span class="spacer" />
              <CopyButton text={tx.txid} small />
            </div>
            <span class="mono cap break" style={{ userSelect: "all" }}>
              {tx.txid}
            </span>
          </div>
        </div>
        {!tx.sent && (
          <div class="cap muted" style={{ textAlign: "center" }}>
            {t("Zcash shielded payments don't reveal who sent them, to anyone, including this app.")}
          </div>
        )}
      </div>
    </Screen>
  );
}

/** A signed payment laid out like a sent one, with the decision at the bottom: Cancel or Broadcast. */
export function PendingScreen({ id, afterSigning = false }: { id: string; afterSigning?: boolean }) {
  return (
    <Screen title={t("Signed · not broadcast")} back={!afterSigning}>
      <PendingBody id={id} onClose={() => (afterSigning ? nav.root() : nav.pop())} showsLater={afterSigning} />
    </Screen>
  );
}

function PendingBody({ id, onClose, showsLater }: { id: string; onClose: () => void; showsLater: boolean }) {
  const s = useStore();
  const p = s.pendingBroadcasts.find((x) => x.id === id);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!p) return null;
  const ex = expired(s, p);
  const total = p.payments.reduce((a, x) => a + x.zatoshi, 0);
  const broadcast = async () => {
    setWorking(true);
    setError(null);
    const e = await call<string | null>("broadcast", p.id);
    setWorking(false);
    if (!e) return onClose();
    setError(
      e === "EXPIRED"
        ? t("It expired: the network won't take it any more. Discard it and send again.")
        : e === "UNREACHABLE"
          ? t("The Zcash network can't be reached. It stays saved here: try again when you're back online.")
          : e.replace(/^NETWORK:/, ""),
    );
  };
  return (
    <div class="stack gap-14" style={{ padding: 16 }}>
      <div class="stack center gap-8">
        <span style={{ width: 46, height: 46, borderRadius: 23, background: ex ? "var(--red)" : "var(--orange)", color: "#000", display: "grid", placeItems: "center" }}>
          <Icon name="antenna" size={22} stroke={2.4} />
        </span>
        <span class="foot muted">{ex ? t("Expired") : t("Signed · not broadcast")}</span>
        <div class="row gap-8">
          <span class="rounded num" style={{ fontSize: 30, fontWeight: 700 }}>
            −{zecAmount(total)}
          </span>
          <ZecLogo size={24} />
        </div>
      </div>
      <div class="stack">
        {p.payments.map((pay, i) => (
          <Fragment key={i}>
            <AddressKv label={p.payments.length > 1 ? t("To (%lld)", i + 1) : t("To")} address={pay.address} />
            {p.payments.length > 1 && <Kv k={t("Amount")} v={zec(pay.zatoshi)} />}
            {pay.memo && <Kv k={t("Message")} v={pay.memo} />}
          </Fragment>
        ))}
        <Kv k={t("Network fee")} v={zec(p.fee)} />
        <Kv k={t("Signed")} v={formatDate(p.created / 1000) + (p.signer ? ` · ${p.signer}` : "")} />
        <div class="stack gap-8" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          <span class="foot muted">{t("Broadcast before")}</span>
          <BroadcastTimer p={p} />
        </div>
        <div class="kv">
          <span>{t("Network")}</span>
          <span class="row gap-6">
            <span style={{ width: 8, height: 8, borderRadius: 4, background: s.online ? "var(--scan)" : "#999" }} />
            {s.online ? t("Online") : t("Offline: saved in this browser")}
          </span>
        </div>
      </div>
      {error && <Note text={error} />}
      <div class="row gap-10">
        <button
          class="btn red"
          style={{ flex: 1 }}
          onClick={() =>
            confirm({
              title: t("Cancel this payment?"),
              message: t("It was never broadcast: nothing is sent and your balance doesn't change."),
              action: t("Cancel payment"),
              cancel: t("Keep it"),
              onConfirm: () => {
                call("discard", p.id);
                onClose();
              },
            })
          }
        >
          {ex ? t("Remove") : t("Cancel")}
        </button>
        {!ex && (
          <button class="btn fill" style={{ flex: 1 }} disabled={working || !s.online} onClick={broadcast}>
            {working ? t("Broadcasting…") : t("Broadcast")}
          </button>
        )}
      </div>
      {showsLater && (
        <button class="sub b muted" style={{ alignSelf: "center" }} onClick={onClose}>
          {t("Decide later")}
        </button>
      )}
    </div>
  );
}
