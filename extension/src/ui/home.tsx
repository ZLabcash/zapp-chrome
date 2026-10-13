// Home, as Chrome wallet extensions lay it out: the wallet picker and menu on top, the address
// to copy, the balance, round actions, then Activity, NFTs (zkSNARKs) and To broadcast as tabs.

import { useEffect, useState } from "preact/hooks";
import { t, formatFiat, formatNumber } from "../i18n";
import { call, context, nav, openApp, openSidePanel, useStore } from "./store";
import { Icon } from "./icons";
import { FlipperIcon, Hourglass, Ring, ZecLogo } from "./marks";
import { Drawer, Popover, usePopover, useCopy } from "./kit";
import { zec, zecAmount, shortAddress } from "../model/format";
import { CONFIRMATIONS, type State, type Wallet } from "../model/types";
import { ActivityList, PendingList, explorerUrl } from "./activity";
import { SendFlow } from "./send";
import { ReceiveScreen } from "./receive";
import { SettingsScreen } from "./settings";
import { ContactsScreen } from "./contacts";
import { WalletPicker } from "./wallets";
import { FlipperCard, FlipperConnected } from "./flipper";
import { NftsTab } from "./nfts";

export function activeWallet(s: State): Wallet | undefined {
  return s.wallets.find((w) => w.id === s.activeId);
}

/** A Flipper wallet's amounts show while its Flipper is connected (privacy from onlookers, as ZApp). */
export function showsAmounts(s: State): boolean {
  const w = activeWallet(s);
  return w?.kind === "phone" || (s.flipper.connected && s.flipper.walletId === w?.id);
}

export function confirmations(s: State, minedHeight: number | null): number | null {
  if (minedHeight === null || s.sync.tip < minedHeight) return null;
  return s.sync.tip - minedHeight + 1;
}

export function WalletAvatar({ w, size = 28 }: { w?: Wallet; size?: number }) {
  if (w?.kind === "flipper")
    return (
      <span class="avatar" style={{ width: size, height: size, background: "#ff8c1a" }}>
        <FlipperMini size={size * 0.62} />
      </span>
    );
  return (
    <span class="avatar" style={{ width: size, height: size }}>
      <Icon name="wallet" size={size * 0.55} stroke={2.2} />
    </span>
  );
}

/** A tiny Flipper silhouette for avatars. */
function FlipperMini({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2">
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <rect x="5" y="9.5" width="8" height="5" rx="1" fill="#000" />
      <circle cx="17.5" cy="12" r="2" />
    </svg>
  );
}

export function HomeScreen() {
  const s = useStore();
  const w = activeWallet(s);
  const [tab, setTab] = useState<"activity" | "nft" | "pending">("activity");
  const pending = s.pendingBroadcasts.filter((p) => p.walletId === s.activeId);
  useEffect(() => {
    if (!pending.length && tab === "pending") setTab("activity");
  }, [pending.length]);
  const shows = showsAmounts(s);
  const flipperReady = s.flipper.connected && s.flipper.walletId === w?.id;
  const canSend = s.sync.synced && s.balance > 0 && (w?.kind === "phone" || w?.kind === "flipper");
  return (
    <div class="stack" style={{ height: "100%" }}>
      <Header w={w} />
      <div class="scroll">
        <div class="stack center gap-16" style={{ padding: "18px 16px 18px" }}>
          <Balance shows={shows} />
          <div class="actions" style={{ marginTop: 2 }}>
            <button class="action" onClick={() => nav.push(() => <ReceiveScreen />)}>
              <span class="disc">
                <Icon name="arrow-down" size={17} stroke={2.6} />
              </span>
              {t("Receive")}
            </button>
            <button class="action" disabled={!canSend} onClick={() => nav.push(() => <SendFlow />)}>
              <span class="disc">
                <Icon name="arrow-up" size={17} stroke={2.6} />
              </span>
              {t("Send")}
            </button>
            <button class="action" disabled title={t("Coming soon")}>
              <span class="soon">{t("Soon")}</span>
              <span class="disc">
                <Icon name="swap" size={18} stroke={2.4} />
              </span>
              {t("Swap")}
            </button>
          </div>
        </div>
        {w?.kind === "flipper" && !flipperReady && (
          <div style={{ padding: "0 16px 14px" }}>
            <FlipperCard />
          </div>
        )}
        <div class="tabs">
          <button class={`tab ${tab === "activity" ? "on" : ""}`} onClick={() => setTab("activity")}>
            {t("Activity")}
          </button>
          <button class={`tab ${tab === "nft" ? "on" : ""}`} onClick={() => setTab("nft")}>
            {t("NFTs")}
          </button>
          {pending.length > 0 && (
            <button class={`tab ${tab === "pending" ? "on" : ""}`} onClick={() => setTab("pending")}>
              {t("To broadcast")}
              <span class="badge-count">{pending.length}</span>
            </button>
          )}
        </div>
        <div key={tab} class="rise-in">
          {tab === "activity" ? <ActivityList /> : tab === "nft" ? <NftsTab /> : <PendingList />}
        </div>
      </div>
    </div>
  );
}

function Header({ w }: { w?: Wallet }) {
  return (
    <div class="header">
      <div class="hdr">
        <button class="wallet-pick" onClick={() => nav.sheet(() => <WalletPicker />)}>
          <WalletAvatar w={w} size={26} />
          <span class="b ellipsis" style={{ fontSize: 15, maxWidth: context === "popup" ? 160 : 230 }}>
            {w?.name ?? "ZApp"}
          </span>
          <Icon name="chevron-down" size={15} stroke={2.6} class="muted" />
        </button>
        <span class="spacer" />
        <SyncDot />
        <button class="icon-btn" aria-label={t("Menu")} onClick={() => nav.sheet(() => <MenuDrawer />)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>
      {w && (
        <div class="hdr-addr">
          <AddressChip w={w} />
          <FlipperConnected />
        </div>
      )}
    </div>
  );
}

/** The burger's panel: the views and wallet actions, sliding in from the side. */
function MenuDrawer() {
  const s = useStore();
  const go = (fn: () => void) => () => (nav.closeSheet(), fn());
  return (
    <Drawer title={t("Menu")}>
      {context !== "app" && (
        <button class="menu-row" onClick={go(() => openApp())}>
          <Icon name="maximize" size={17} />
          {t("Expand view")}
        </button>
      )}
      {context !== "panel" && (
        <button class="menu-row" onClick={go(() => openSidePanel())}>
          <Icon name="sidebar" size={17} />
          {t("Open in side panel")}
        </button>
      )}
      <button class="menu-row" onClick={go(() => nav.push(() => <ContactsScreen />))}>
        <Icon name="people" size={17} />
        {t("Address book")}
      </button>
      <button class="menu-row" onClick={go(() => nav.push(() => <SettingsScreen />))}>
        <Icon name="gear" size={17} />
        {t("Settings")}
      </button>
      {s.vault.exists && (
        <button class="menu-row" onClick={go(() => call("lock"))}>
          <Icon name="lock" size={17} />
          {t("Lock ZApp")}
        </button>
      )}
    </Drawer>
  );
}

/** The sync state as a dot (green up to date, ring while syncing, orange offline); hover or click for details. */
function SyncDot() {
  const s = useStore();
  const pop = usePopover();
  const sy = s.sync;
  return (
    <>
      <button ref={pop.anchor as any} class="icon-btn" aria-label={t("Synced")} title={sy.synced ? t("Up to date") : sy.error ? t("Offline") : t("Syncing")} onClick={() => pop.setOpen(true)}>
        {sy.error ? (
          <span style={{ width: 9, height: 9, borderRadius: 5, background: "var(--orange)" }} />
        ) : sy.synced ? (
          <span style={{ width: 9, height: 9, borderRadius: 5, background: "var(--scan)" }} />
        ) : (
          <Ring progress={sy.progress} size={16} width={2.5} />
        )}
      </button>
      <Popover open={pop.open} onClose={() => pop.setOpen(false)} anchor={pop.anchor} width={250}>
        <div class="stack gap-6 sub">
          <div class="headline">{sy.synced ? t("Up to date") : sy.error ? t("Can't reach the network") : `${t("Syncing")} ${Math.floor(sy.progress * 100)}%`}</div>
          {sy.error && <div class="foot orange">{sy.error}</div>}
          {sy.tip > 0 && <Kv k={t("Latest block")} v={formatNumber(sy.tip)} />}
          {!sy.synced && sy.scanned > 0 && <Kv k={t("Scanned up to")} v={formatNumber(sy.scanned)} />}
          <Kv k={t("Server")} v={s.settings.server.split(":")[0]} />
        </div>
      </Popover>
    </>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div class="kv">
      <span>{k}</span>
      <span class="num">{v}</span>
    </div>
  );
}

/** The receiving address, short, copied with a click. */
function AddressChip({ w }: { w: Wallet }) {
  const [address, setAddress] = useState("");
  const [copied, copy] = useCopy();
  useEffect(() => {
    call<string>("address", w.ufvk, w.addressIndex).then(setAddress);
  }, [w.ufvk, w.addressIndex]);
  if (!address) return <span class="addr-chip">…</span>;
  return (
    <button class="addr-chip mono" title={address} onClick={() => copy(address)}>
      {copied ? t("Copied") : shortAddress(address, 8, 6)}
      <Icon name={copied ? "check" : "copy"} size={13} />
    </button>
  );
}

function Balance({ shows }: { shows: boolean }) {
  const s = useStore();
  const owned = s.balance + s.change;
  const code = s.settings.currency;
  const fiat = formatFiat(owned, s.prices[code], code);
  return (
    <div class="stack center gap-4">
      <div class="row gap-8">
        <span class="rounded num" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>
          {shows ? zecAmount(owned) : "••••••"}
        </span>
        <ZecLogo size={28} />
      </div>
      <span class="num muted" style={{ fontSize: 15, minHeight: 20 }}>
        {shows ? (fiat ? `≈ ${fiat}` : "") : t("Connect your Flipper to see your balance and send.")}
      </span>
      {shows && s.pending > 0 && <ConfirmingPill />}
    </div>
  );
}

/** Incoming ZEC on its way to spendable: an hourglass turning; hover or click for the confirmations. */
function ConfirmingPill() {
  const s = useStore();
  const pop = usePopover();
  const waiting = s.activity
    .filter((x) => !x.sent && !x.expired && (confirmations(s, x.minedHeight) ?? 0) < CONFIRMATIONS)
    .sort((a, b) => (confirmations(s, a.minedHeight) ?? 0) - (confirmations(s, b.minedHeight) ?? 0))[0];
  const n = waiting ? confirmations(s, waiting.minedHeight) ?? 0 : 0;
  const minutes = Math.max(1, Math.ceil(((CONFIRMATIONS - n) * 75) / 60));
  return (
    <>
      <button ref={pop.anchor as any} class="row gap-6 foot" style={{ color: "var(--zcash)", background: "rgba(244,183,40,0.14)", padding: "5px 10px", borderRadius: 999, marginTop: 4 }} onClick={() => pop.setOpen(true)}>
        <Hourglass size={14} />
        <span class="num" style={{ fontWeight: 700 }}>
          +{zec(s.pending)}
        </span>
        {t("confirming")}
      </button>
      <Popover open={pop.open} onClose={() => pop.setOpen(false)} anchor={pop.anchor} width={280} align="start">
        <div class="stack gap-10">
          <div class="row gap-12">
            <div style={{ position: "relative", width: 40, height: 40 }}>
              <Ring progress={n / CONFIRMATIONS} size={40} width={4} />
              <span class="rounded" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700 }}>
                {n}/{CONFIRMATIONS}
              </span>
            </div>
            <div class="stack gap-2">
              <span class="headline">{t("Confirming")}</span>
              <span class="foot muted">{n === 0 ? t("Waiting for its first block · about 13 min") : t("%lld of %lld · spendable in about %lld min", n, CONFIRMATIONS, minutes)}</span>
            </div>
          </div>
          <div class="foot muted" style={{ lineHeight: 1.4 }}>
            {t("Received ZEC can be spent after %lld confirmations, one per block (about 75 s).", CONFIRMATIONS)}
          </div>
          {waiting && (
            <a class="row gap-6 sub b yellow" href={explorerUrl(s, waiting.txid)} target="_blank">
              <Icon name="external" size={15} />
              {t("View on the explorer")}
            </a>
          )}
        </div>
      </Popover>
    </>
  );
}
