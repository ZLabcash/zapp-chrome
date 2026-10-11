// Activity (ZApp's ActivityViews): today's transactions on Home, signed payments to broadcast,
// a transaction's detail, and every transaction by day.

import { useEffect, useState } from "preact/hooks";
import { t, formatDate } from "../i18n";
import { call, nav, useStore } from "./store";
import { Icon } from "./icons";
import { ConfirmingRing, Hourglass, ZecLogo } from "./marks";
import { CopyButton, Note, Screen, confirm } from "./kit";
import { zec, zecAmount, shortAddress } from "../model/format";
import { CONFIRMATIONS, type ActivityItem, type PendingBroadcast, type State } from "../model/types";
import { confirmations, useShowsAmounts } from "./home";

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

// ---- Home: activity ----

function isToday(seconds: number) {
  return new Date(seconds * 1000).toDateString() === new Date().toDateString();
}

export function ActivityCard() {
  const s = useStore();
  const today = s.activity.filter((x) => x.blockTime === null || isToday(x.blockTime));
  const [title, items] = today.length ? [t("Today"), today] : [t("Recent activity"), s.activity.slice(0, 3)];
  return (
    <div class="card big stack gap-12">
      <div class="row">
        <span class="headline">{title}</span>
        <span class="spacer" />
        {s.activity.length > 0 && (
          <button class="sub b yellow" onClick={() => nav.push(() => <AllActivityView />)}>
            {t("See all")}
          </button>
        )}
      </div>
      {s.activity.length === 0 && <div class="foot muted">{s.sync.synced ? t("No transactions yet.") : t("Transactions appear here as the wallet syncs.")}</div>}
      {items.map((tx, i) => (
        <>
          <button key={tx.id} style={{ textAlign: "start" }} onClick={() => nav.sheet(() => <TxDetailSheet tx={tx} />)}>
            <ActivityRow tx={tx} />
          </button>
          {i < items.length - 1 && <hr class="divider" />}
        </>
      ))}
    </div>
  );
}

/** Home, between Receive/Send and the activity: signed payments waiting for a decision. */
export function BroadcastCard() {
  const s = useStore();
  const here = s.pendingBroadcasts.filter((p) => p.walletId === s.activeId);
  return (
    <div class="card big stack gap-12">
      <div class="row gap-8">
        <span class="headline">{t("To broadcast")}</span>
        <span class="badge-count">{here.length}</span>
      </div>
      {here.map((p, i) => (
        <>
          <button key={p.id} style={{ textAlign: "start" }} onClick={() => nav.sheet(() => <PendingSheet id={p.id} />)}>
            <PendingRow p={p} />
          </button>
          {i < here.length - 1 && <hr class="divider" />}
        </>
      ))}
    </div>
  );
}

export function expired(s: State, p: PendingBroadcast): boolean {
  const deadline = p.created + (p.expiryHeight - p.signedHeight) * 75_000;
  return (s.sync.tip > 0 && s.sync.tip >= p.expiryHeight) || Date.now() > deadline + 10 * 60_000;
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

/** A signed payment in the broadcast block: "Sent to …", the amount, and the time left. */
function PendingRow({ p }: { p: PendingBroadcast }) {
  const s = useStore();
  const name = useNames();
  const first = p.payments[0]?.address ?? "";
  const to = (name(first) ?? first.slice(0, 7) + "…") + (p.payments.length > 1 ? ` +${p.payments.length - 1}` : "");
  const total = p.payments.reduce((a, x) => a + x.zatoshi, 0);
  return (
    <div class="stack gap-8">
      <div class="row gap-12">
        <span style={{ width: 34, height: 34, borderRadius: 17, background: expired(s, p) ? "var(--red)" : "var(--orange)", color: "#000", display: "grid", placeItems: "center" }}>
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
      <span class={`cap num ${ex ? "red" : "ink"}`} style={{ fontWeight: 600, minWidth: 44, textAlign: "right" }}>
        {ex ? t("Expired") : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
      </span>
    </div>
  );
}

function PendingSheet({ id }: { id: string }) {
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet">
        <div class="grabber" />
        <div class="scroll">
          <div style={{ padding: "18px 18px 22px" }}>
            <PendingPanel id={id} onClose={() => nav.closeSheet()} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The signed payment laid out like a Sent transaction, with the decision at the bottom: Cancel
 * or Broadcast. It stays saved here until then (or until it expires).
 */
export function PendingPanel({ id, onClose, showsLater = false }: { id: string; onClose: () => void; showsLater?: boolean }) {
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
    <div class="stack gap-18">
      <div class="stack center gap-8">
        <span style={{ width: 54, height: 54, borderRadius: 27, background: ex ? "var(--red)" : "var(--orange)", color: "#000", display: "grid", placeItems: "center" }}>
          <Icon name="antenna" size={26} stroke={2.4} />
        </span>
        <span class="headline muted">{ex ? t("Expired") : t("Signed · not broadcast")}</span>
        <div class="row gap-8">
          <span class="rounded num" style={{ fontSize: 36, fontWeight: 700 }}>
            −{zecAmount(total)}
          </span>
          <ZecLogo size={28} />
        </div>
      </div>
      <div class="card" style={{ padding: "0 16px" }}>
        {p.payments.map((pay, i) => (
          <>
            <AddressRow label={p.payments.length > 1 ? t("To (%lld)", i + 1) : t("To")} address={pay.address} />
            {p.payments.length > 1 && <Row k={t("Amount")} v={zec(pay.zatoshi)} />}
            {pay.memo && <Row k={t("Message")} v={pay.memo} />}
          </>
        ))}
        <Row k={t("Network fee")} v={zec(p.fee)} />
        <Row k={t("Signed")} v={formatDate(p.created / 1000) + (p.signer ? ` · ${p.signer}` : "")} />
        <div class="stack gap-8" style={{ padding: "12px 0" }}>
          <span class="sub muted">{t("Broadcast before")}</span>
          <BroadcastTimer p={p} />
        </div>
        <hr class="divider" />
        <div class="row gap-8" style={{ padding: "12px 0" }}>
          <span class="sub muted">{t("Network")}</span>
          <span class="spacer" />
          <span style={{ width: 8, height: 8, borderRadius: 4, background: s.online ? "var(--scan)" : "#999" }} />
          <span class="sub">{s.online ? t("Online") : t("Offline: saved in this browser")}</span>
        </div>
      </div>
      {error && <Note text={error} />}
      <div class="row gap-12">
        <button
          class="danger"
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
          <button class="primary" disabled={working || !s.online} onClick={broadcast}>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div class="row gap-16" style={{ padding: "12px 0", alignItems: "flex-start" }}>
        <span class="sub muted">{k}</span>
        <span class="spacer" />
        <span class="sub" style={{ textAlign: "end", userSelect: "text", wordBreak: "break-word" }}>
          {v}
        </span>
      </div>
      <hr class="divider" />
    </>
  );
}

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

/** One transaction: direction, status (or its message), amount. */
function ActivityRow({ tx, showMemo = false }: { tx: ActivityItem; showMemo?: boolean }) {
  const s = useStore();
  const shows = useShowsAmounts();
  return (
    <div class="row gap-12">
      <TxIcon tx={tx} size={34} />
      <div class="stack gap-2 spacer" style={{ minWidth: 0 }}>
        <span class="sub b">{tx.sent ? t("Sent") : t("Received")}</span>
        <span class="cap muted">{statusShort(s, tx)}</span>
        {showMemo && tx.memos[0] && (
          <span class="cap ink" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            “{tx.memos[0]}”
          </span>
        )}
      </div>
      <span class="sub b num">{(tx.sent ? "−" : "+") + (shows ? zec(tx.zatoshi) : "•••• ZEC")}</span>
    </div>
  );
}

/** By where it is: an hourglass in the mempool, a check with a turning arc while it confirms, then the arrow. */
function TxIcon({ tx, size }: { tx: ActivityItem; size: number }) {
  const s = useStore();
  const color = tx.sent ? "#bfbfbf" : "var(--zcash)";
  const n = confirmations(s, tx.minedHeight);
  const disc = (child: preact.ComponentChildren, bg: string, fg = "#000") => (
    <span style={{ width: size, height: size, borderRadius: size / 2, background: bg, color: fg, display: "grid", placeItems: "center", flexShrink: 0 }}>{child}</span>
  );
  if (tx.expired) return disc(<Icon name="x" size={size * 0.42} stroke={3} />, "rgba(255,59,48,0.8)", "#fff");
  if (n !== null && n >= CONFIRMATIONS) return disc(<Icon name={tx.sent ? "arrow-up" : "arrow-down"} size={size * 0.48} stroke={3} />, color);
  if (n !== null) return <ConfirmingRing color={color} size={size} />;
  return disc(<Hourglass size={size * 0.48} color="#000" />, color);
}

/** The detail of one transaction: who, how much, status, message, date, id, explorer. */
function TxDetailSheet({ tx: first }: { tx: ActivityItem }) {
  const s = useStore();
  const shows = useShowsAmounts();
  const tx = s.activity.find((x) => x.id === first.id) ?? first;
  const [recipients, setRecipients] = useState<string[]>([]);
  useEffect(() => {
    if (tx.sent) call<string[]>("recipients", tx.id).then(setRecipients);
  }, [tx.id]);
  const url = explorerUrl(s, tx.txid);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet">
        <div class="grabber" />
        <div class="scroll">
          <div class="stack gap-18" style={{ padding: "18px 18px 22px" }}>
            <div class="stack center gap-8">
              <TxIcon tx={tx} size={54} />
              <span class="headline muted">{tx.sent ? t("Sent") : t("Received")}</span>
              <div class="row gap-8">
                <span class="rounded num" style={{ fontSize: 36, fontWeight: 700 }}>
                  {(tx.sent ? "−" : "+") + (shows ? zecAmount(tx.zatoshi) : "••••")}
                </span>
                <ZecLogo size={28} />
              </div>
            </div>
            <div class="card" style={{ padding: "0 16px" }}>
              {tx.sent ? (
                <>
                  {recipients.length === 0 && <Row k={t("To")} v={t("Shielded recipient")} />}
                  {recipients.map((r, i) => (
                    <AddressRow key={i} label={recipients.length > 1 ? t("To (%lld)", i + 1) : t("To")} address={r} />
                  ))}
                  {tx.fee !== null && <Row k={t("Network fee")} v={zec(tx.fee)} />}
                </>
              ) : (
                <Row k={t("From")} v={t("Shielded sender")} />
              )}
              <Row k={t("Status")} v={statusLong(s, tx)} />
              {tx.blockTime && <Row k={t("Date")} v={formatDate(tx.blockTime)} />}
              {tx.memos.length === 0 ? <Row k={t("Message")} v={t("None")} /> : tx.memos.map((m, i) => <Row key={i} k={tx.memos.length > 1 ? t("Message (%lld)", i + 1) : t("Message")} v={m} />)}
              <div class="stack gap-6" style={{ padding: "12px 0" }}>
                <div class="row">
                  <span class="sub muted">{t("Transaction ID")}</span>
                  <span class="spacer" />
                  <CopyButton text={tx.txid} small />
                </div>
                <span class="mono cap break" style={{ userSelect: "all" }}>
                  {tx.txid}
                </span>
              </div>
            </div>
            <a class="primary" href={url} target="_blank">
              <Icon name="external" size={18} />
              {t("View on %@", new URL(url).host)}
            </a>
            {!tx.sent && (
              <div class="cap muted" style={{ textAlign: "center" }}>
                {t("Zcash shielded payments don't reveal who sent them, to anyone, including this app.")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every transaction by day, with its messages, searchable. */
export function AllActivityView() {
  const s = useStore();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const items = s.activity.filter((tx) => !q || tx.memos.some((m) => m.toLowerCase().includes(q)) || tx.txid.startsWith(q) || zec(tx.zatoshi).includes(q));
  const days: [string, ActivityItem[]][] = [];
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const tx of items) {
    const day =
      tx.blockTime === null
        ? t("Pending")
        : isToday(tx.blockTime)
          ? t("Today")
          : new Date(tx.blockTime * 1000).toDateString() === yesterday
            ? t("Yesterday")
            : formatDate(tx.blockTime, "day");
    if (days.length && days[days.length - 1][0] === day) days[days.length - 1][1].push(tx);
    else days.push([day, [tx]]);
  }
  return (
    <Screen title={t("All activity")}>
      <div class="pad stack gap-18">
        <div class="field">
          <Icon name="search" size={17} class="muted" />
          <input placeholder={t("Search messages, amounts, transaction IDs")} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </div>
        {days.length === 0 && <div class="foot muted">{query ? t("Nothing matches “%@”.", query) : t("No transactions yet.")}</div>}
        {days.map(([day, list]) => (
          <div class="stack gap-8" key={day}>
            <span class="cap muted upper" style={{ fontWeight: 600, paddingInlineStart: 4 }}>
              {day}
            </span>
            <div class="card stack gap-10" style={{ padding: 16, borderRadius: 20 }}>
              {list.map((tx, i) => (
                <>
                  <button key={tx.id} style={{ textAlign: "start" }} onClick={() => nav.sheet(() => <TxDetailSheet tx={tx} />)}>
                    <ActivityRow tx={tx} showMemo />
                  </button>
                  {i < list.length - 1 && <hr class="divider" />}
                </>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

/** A recipient address, short (with the contact's name when known); tap to see it whole and copy it. */
export function AddressRow({ label, address }: { label: string; address: string }) {
  const name = useNames();
  const [open, setOpen] = useState(false);
  const n = name(address);
  return (
    <>
      <button style={{ width: "100%", padding: open ? "12px 0 6px" : "12px 0", textAlign: "start" }} onClick={() => setOpen(!open)}>
        <div class="row gap-16" style={{ alignItems: "baseline" }}>
          <span class="sub muted">{label}</span>
          <span class="spacer" />
          <div class="stack" style={{ alignItems: "flex-end" }}>
            {n && <span class="sub b">{n}</span>}
            <span class="mono cap muted">{shortAddress(address)}</span>
          </div>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={12} stroke={3} class="muted" />
        </div>
        {open && (
          <div class="mono cap2 break" style={{ marginTop: 6, userSelect: "all" }}>
            {address}
          </div>
        )}
      </button>
      {open && (
        <div class="row" style={{ justifyContent: "flex-end", paddingBottom: 12 }}>
          <CopyButton text={address} small />
        </div>
      )}
      <hr class="divider" />
    </>
  );
}
