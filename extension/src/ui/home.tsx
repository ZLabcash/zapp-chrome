// Home (ZApp's HomeView): the active wallet with its sync state, the shielded balance, Receive
// and Send, signed payments waiting to be broadcast, and the activity.

import { useEffect, useMemo, useState } from "preact/hooks";
import { t, formatFiat, formatNumber } from "../i18n";
import { call, nav, useStore } from "./store";
import { Ring, Shield, ZecLogo, Hourglass, QRCode, FlipperIcon, KindleIcon, BluetoothGlyph } from "./marks";
import { Icon } from "./icons";
import { Popover, usePopover, CopyButton, confirm } from "./kit";
import { zecAmount } from "../model/format";
import { CONFIRMATIONS, type State } from "../model/types";
import { useFlipper, flipperReady, connectFlipper, disconnectFlipper, adoptFlipperWallet, flipperNote } from "./flipper";
import { ActivityCard, BroadcastCard, explorerUrl } from "./activity";
import { SendView } from "./send";
import { SettingsView } from "./settings";
import { WalletsSheet } from "./wallets";

/** Amounts show for a browser wallet, and for a Flipper wallet while its Flipper is connected. */
export function useShowsAmounts(): boolean {
  const s = useStore();
  useFlipper();
  const w = s.wallets.find((x) => x.id === s.activeId);
  return w?.kind === "phone" || flipperReady(s.activeId);
}

export function confirmations(s: State, minedHeight: number | null): number | null {
  if (minedHeight === null || s.sync.tip < minedHeight) return null;
  return s.sync.tip - minedHeight + 1;
}

export function HomeView() {
  const s = useStore();
  const shows = useShowsAmounts();
  const w = s.wallets.find((x) => x.id === s.activeId);
  const canSign = w?.kind === "phone" || flipperReady(s.activeId);
  // Sending needs a signer, a synced wallet and something to spend. A Flipper wallet's Send
  // connects its Flipper first.
  const canSend = s.sync.synced && s.balance > 0 && (canSign || w?.kind === "flipper");
  const pendingHere = s.pendingBroadcasts.filter((p) => p.walletId === s.activeId);
  return (
    <div class="scroll" style={{ height: "100%" }}>
      <div class="stack gap-18" style={{ padding: "8px 18px 30px" }}>
        <div class="row gap-10" style={{ paddingTop: 8 }}>
          <Shield size={34} />
          <button class="row gap-4" style={{ minWidth: 0 }} onClick={() => nav.sheet(() => <WalletsSheet />)}>
            <span class="rounded ellipsis" style={{ fontSize: 22, fontWeight: 800, maxWidth: 150 }}>
              {w?.name ?? "ZApp"}
            </span>
            <Icon name="chevron-down" size={13} stroke={3} class="muted" />
          </button>
          {w?.network === 1 && <span class="cap2" style={{ fontWeight: 700, padding: "3px 6px", borderRadius: 99, background: "rgba(255,149,0,0.25)" }}>TESTNET</span>}
          <span class="spacer" />
          <SyncPill />
          <button aria-label={t("Settings")} class="muted" onClick={() => nav.push(() => <SettingsView />)}>
            <Icon name="gear" size={22} />
          </button>
        </div>
        <BalanceCard shows={shows} />
        {w?.kind === "flipper" && !flipperReady(s.activeId) && <FlipperBar />}
        <div class="row gap-12">
          <ActionTile title={t("Receive")} icon="arrow-down" onClick={() => nav.sheet(() => <ReceiveSheet />)} />
          <ActionTile title={t("Send")} icon="arrow-up" disabled={!canSend} onClick={() => nav.push(() => <SendView />)} />
        </div>
        {pendingHere.length > 0 && <BroadcastCard />}
        <ActivityCard />
      </div>
    </div>
  );
}

/** A Flipper wallet without its Flipper: one line to connect it (amounts and Send need it). */
function FlipperBar() {
  const f = useFlipper();
  const note = flipperNote();
  const busy = f.s === "connecting" || f.s === "approve";
  return (
    <div class="card stack gap-10" style={{ padding: 14, borderRadius: 18 }}>
      <div class="row gap-12">
        <FlipperIcon width={64} light={busy ? "var(--zcash)" : f.s === "failed" ? "var(--red)" : f.s === "otherWallet" ? "var(--orange)" : "#999"} pulsing={busy} />
        <span class="foot muted spacer" style={{ lineHeight: 1.35 }}>
          {note ?? t("Connect your Flipper to see your balance and send.")}
        </span>
        {busy ? (
          <button class="pill" style={{ color: "var(--text)" }} onClick={disconnectFlipper}>
            {t("Cancel")}
          </button>
        ) : (
          <button class="pill" style={{ background: "var(--zcash)", color: "#000", fontSize: 14, padding: "9px 14px" }} onClick={() => connectFlipper()}>
            <BluetoothGlyph size={14} color="#000" />
            {t("Connect")}
          </button>
        )}
      </div>
      {f.s === "otherWallet" && (
        <button class="primary" onClick={adoptFlipperWallet}>
          <Icon name="sync" size={17} />
          {t("Use this Flipper's wallet")}
        </button>
      )}
    </div>
  );
}

/** The sync state: a green dot up to date, a filling ring while syncing, orange offline. Tap for details. */
function SyncPill() {
  const s = useStore();
  const pop = usePopover();
  const sy = s.sync;
  return (
    <>
      <button ref={pop.anchor as any} class="pill" onClick={() => pop.setOpen(true)}>
        {sy.error ? (
          <>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--orange)" }} />
            {t("Offline")}
          </>
        ) : sy.synced ? (
          <>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--scan)" }} />
            {t("Synced")}
          </>
        ) : (
          <>
            <Ring progress={sy.progress} size={12} width={2.5} />
            <span class="num">{t("Syncing %lld%%", Math.floor(sy.progress * 100))}</span>
          </>
        )}
      </button>
      <Popover open={pop.open} onClose={() => pop.setOpen(false)} anchor={pop.anchor} width={270}>
        <div class="stack gap-8 sub">
          <div class="headline">{sy.synced ? t("Up to date") : sy.error ? t("Can't reach the network") : t("Syncing")}</div>
          {sy.error && <div class="foot orange">{sy.error}</div>}
          {sy.tip > 0 && <Labeled k={t("Latest block")} v={formatNumber(sy.tip)} />}
          {!sy.synced && sy.scanned > 0 && <Labeled k={t("Scanned up to")} v={formatNumber(sy.scanned)} />}
          <Labeled k={t("Server")} v={s.settings.server} />
        </div>
      </Popover>
    </>
  );
}

function Labeled({ k, v }: { k: string; v: string }) {
  return (
    <div class="row gap-12">
      <span>{k}</span>
      <span class="spacer" />
      <span class="muted num">{v}</span>
    </div>
  );
}

function BalanceCard({ shows }: { shows: boolean }) {
  const s = useStore();
  const owned = s.balance + s.change;
  const code = s.settings.currency;
  return (
    <div class="stack gap-12" style={{ padding: 22, borderRadius: 24, background: "linear-gradient(135deg, var(--card), color-mix(in srgb, var(--card) 60%, transparent))", border: "1px solid rgba(244,183,40,0.25)" }}>
      <div class="row gap-6 sub b muted">
        <Icon name="lock-shield" size={16} />
        {t("Shielded balance")}
      </div>
      <button class="stack gap-4" style={{ textAlign: "start", alignItems: "flex-start" }} onClick={() => shows && call("setSettings", { showFiat: !s.settings.showFiat })}>
        <div class="row gap-10">
          <span class="rounded num" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>
            {shows ? zecAmount(owned) : "••••••"}
          </span>
          <ZecLogo size={34} />
        </div>
        {shows && s.settings.showFiat && (
          <span class="num muted fade-in" style={{ fontSize: 20, fontWeight: 600 }}>
            {(() => {
              const f = formatFiat(owned, s.prices[code], code);
              return f ? `≈ ${f}` : t("Price unavailable");
            })()}
          </span>
        )}
      </button>
      {shows && s.pending > 0 && <ConfirmingPill />}
    </div>
  );
}

/** Incoming ZEC on its way to spendable: an hourglass turning, "+0.0001 ⓩ confirming". Tap for details. */
function ConfirmingPill() {
  const s = useStore();
  const pop = usePopover();
  const waiting = useMemo(() => {
    const list = s.activity.filter((x) => !x.sent && !x.expired && (confirmations(s, x.minedHeight) ?? 0) < CONFIRMATIONS);
    return list.sort((a, b) => (confirmations(s, a.minedHeight) ?? 0) - (confirmations(s, b.minedHeight) ?? 0))[0];
  }, [s.activity, s.sync.tip]);
  const n = waiting ? confirmations(s, waiting.minedHeight) ?? 0 : 0;
  const minutes = Math.max(1, Math.ceil(((CONFIRMATIONS - n) * 75) / 60));
  return (
    <>
      <button ref={pop.anchor as any} class="row gap-6" style={{ alignSelf: "flex-start", color: "var(--zcash)", background: "rgba(244,183,40,0.14)", padding: "8px 12px", borderRadius: 999 }} onClick={() => pop.setOpen(true)}>
        <Hourglass size={16} />
        <span class="sub num" style={{ fontWeight: 700 }}>
          +{zecAmount(s.pending)}
        </span>
        <ZecLogo size={16} />
        <span class="sub">{t("confirming")}</span>
      </button>
      <Popover open={pop.open} onClose={() => pop.setOpen(false)} anchor={pop.anchor} width={290} align="start">
        <div class="stack gap-10">
          <div class="row gap-12">
            <div style={{ position: "relative", width: 44, height: 44 }}>
              <Ring progress={n / CONFIRMATIONS} size={44} width={4} />
              <span class="rounded" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>
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

function ActionTile({ title, icon, onClick, disabled = false }: { title: string; icon: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button class="stack center gap-10" style={{ flex: 1, padding: "18px 0", background: "var(--card)", borderRadius: 22, opacity: disabled ? 0.45 : 1 }} disabled={disabled} onClick={onClick}>
      <span style={{ width: 48, height: 48, borderRadius: 24, background: "var(--zcash)", color: "#000", display: "grid", placeItems: "center" }}>
        <Icon name={icon} size={24} stroke={2.8} />
      </span>
      <span class="sub b">{title}</span>
    </button>
  );
}

/**
 * The receiving address: for a Flipper wallet the one the Flipper shows (checked against this
 * side's own derivation from the viewing key); for a browser wallet, a new one on demand.
 */
function ReceiveSheet() {
  const s = useStore();
  useFlipper();
  const w = s.wallets.find((x) => x.id === s.activeId)!;
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    call<string>("address", w.ufvk, w.addressIndex).then(setAddress);
  }, [w.ufvk, w.addressIndex]);
  const phone = w.kind === "phone";
  const ready = flipperReady(s.activeId);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && nav.closeSheet()}>
      <div class="sheet" style={{ maxHeight: "96%" }}>
        <div class="grabber" />
        <div class="scroll">
          <div class="stack center gap-16" style={{ padding: "8px 18px 22px" }}>
            <div class="title2">{t("Receive ZEC")}</div>
            {!phone && (
              <div class={`row gap-6 foot ${ready ? "green" : "muted"}`} style={{ fontWeight: 600 }}>
                <Icon name={ready ? "seal" : "clock"} size={15} />
                {ready ? t("Same address as on your Flipper") : t("Last address shown on your Flipper")}
              </div>
            )}
            {address ? (
              <>
                <div style={{ padding: 14, background: "#fff", borderRadius: 20 }}>
                  <QRCode text={address} size={200} />
                </div>
                <div class="mono cap break" style={{ textAlign: "center", padding: "0 6px", userSelect: "all" }}>
                  {address}
                </div>
                <div class="row gap-10" style={{ width: "100%" }}>
                  <CopyButton text={address} primary />
                </div>
                {phone ? (
                  <>
                    <button class="row gap-6 sub b yellow" onClick={() => call("newPhoneAddress")}>
                      <Icon name="sync" size={15} />
                      {t("New address")}
                    </button>
                    <div class="cap muted" style={{ textAlign: "center" }}>
                      {t("Every address reaches this same wallet, and nobody can link them together.")}
                    </div>
                  </>
                ) : (
                  <div class="cap muted" style={{ textAlign: "center" }}>
                    {t("A new address each time ZFlip opens, or press ▶ in Receive on the Flipper: this screen follows it.")}
                  </div>
                )}
              </>
            ) : (
              <Ring progress={0.3} size={24} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Settings → Devices: the Flipper with its Connect button; the Kindle, soon. */
export function DevicesCard() {
  const s = useStore();
  const f = useFlipper();
  const note = flipperNote();
  const ready = flipperReady(s.activeId);
  const busy = f.s === "connecting" || f.s === "approve";
  const light = ready ? "var(--scan)" : busy ? "var(--zcash)" : f.s === "otherWallet" ? "var(--orange)" : f.s === "failed" ? "var(--red)" : "#999";
  return (
    <div class="card big stack gap-18">
      <div class="row" style={{ alignItems: "flex-end" }}>
        <div class="stack gap-8">
          <span class="sub b">Flipper Zero</span>
          <FlipperIcon width={120} light={light} pulsing={busy} />
        </div>
        <span class="spacer" />
        {busy ? (
          <ConnectPill title={t("Cancel")} style="plain" onClick={disconnectFlipper} />
        ) : ready ? (
          <ConnectPill
            title={t("Connected")}
            style="connected"
            onClick={() =>
              confirm({
                title: t("Disconnect from your Flipper Zero?"),
                message: t("Your balance will be hidden and you won't be able to send until you connect again."),
                action: t("Disconnect"),
                cancel: t("Stay connected"),
                onConfirm: disconnectFlipper,
              })
            }
          />
        ) : (
          <ConnectPill title={t("Connect")} style="primary" onClick={() => connectFlipper()} />
        )}
      </div>
      {note && <div class="foot muted">{note}</div>}
      {f.s === "otherWallet" && (
        <button class="primary" onClick={adoptFlipperWallet}>
          <Icon name="sync" size={17} />
          {t("Use this Flipper's wallet")}
        </button>
      )}
      <hr class="divider" />
      <div class="row" style={{ alignItems: "flex-end", opacity: 0.45 }}>
        <div class="stack gap-8">
          <span class="sub b">Kindle</span>
          <KindleIcon width={38} />
        </div>
        <span class="spacer" />
        <ConnectPill title={t("Connect")} style="plain" onClick={() => {}} disabled />
      </div>
    </div>
  );
}

function ConnectPill({ title, style, onClick, disabled = false }: { title: string; style: "primary" | "connected" | "plain"; onClick: () => void; disabled?: boolean }) {
  const bg = style === "primary" ? "var(--zcash)" : style === "connected" ? "var(--scan)" : "var(--soft)";
  const fg = style === "plain" ? "var(--text)" : "#000";
  return (
    <button class="row gap-6" disabled={disabled} onClick={onClick} style={{ padding: "11px 16px", borderRadius: 999, background: bg, color: fg, fontWeight: 700, fontSize: 14 }}>
      {style !== "plain" && <BluetoothGlyph size={15} color={fg} />}
      {title}
    </button>
  );
}
