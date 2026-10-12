// The Flipper in the extension: Chrome's side panel holds its Bluetooth link (it stays open while
// you browse, and Web Bluetooth only lives in a visible page). From the popup, Connect opens the
// side panel; in the side panel (or the full page) it connects right there.

import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, context, nav, openSidePanel, useStore } from "./store";
import { BluetoothGlyph, FlipperIcon, ForgingShield } from "./marks";
import { Icon } from "./icons";
import { Note, Screen } from "./kit";
import { activeWallet } from "./home";
import { hello, link, needsChooser, onHostChange, pickDevice, sessionOpened } from "../flipper/host";
import { FlipperError, type FlipperInfo } from "../flipper/link";

const hosting = context !== "popup";

function useHost() {
  const [, set] = useState(0);
  useEffect(() => (hosting ? onHostChange(() => set((n) => n + 1)) : undefined), []);
}

export function flipperError(code: string | null): string | null {
  if (!code) return null;
  if (code.startsWith("OTHER_WALLET:")) return t("%@ holds a different wallet than this browser.", code.slice(13));
  switch (code) {
    case "unsupported":
      return t("This browser has no Bluetooth. Use Chrome on a computer with Bluetooth.");
    case "cancelled":
      return t("No Flipper chosen.");
    case "timeout":
      return t("Flipper not found. Open ZFlip on it and unlock it.");
    case "notConnected":
      return t("The Flipper is not connected.");
    case "REJECTED":
      return t("Rejected on the Flipper");
    default:
      return code;
  }
}

/** Home, for a Flipper wallet without its Flipper: one card to connect it. */
export function FlipperCard() {
  const s = useStore();
  useHost();
  const f = s.flipper;
  const busy = f.busy || f.awaiting;
  const chooser = hosting && needsChooser();
  const connect = async () => {
    if (!hosting) {
      // The popup can't keep a Bluetooth link: the side panel does.
      if (!s.flipperHost) return openSidePanel();
      return call("connectFlipper");
    }
    if (!(await pickDevice())) return;
    call("connectFlipper");
  };
  const note = f.awaiting
    ? t("Press OK on your Flipper to share the viewing key (it can see, never spend).")
    : chooser
      ? t("Choose your Flipper in the list Chrome shows.")
      : f.busy
        ? t("Open ZFlip on the Flipper and unlock it, close to this computer.")
        : flipperError(f.error) ?? (!hosting && !s.flipperHost ? t("The side panel keeps your Flipper connected while you browse.") : t("Connect your Flipper to see your balance and send."));
  return (
    <div class="banner" style={{ alignItems: "center" }}>
      <FlipperIcon width={58} light={f.awaiting ? "var(--scan)" : busy ? "var(--zcash)" : f.error ? "var(--red)" : "#999"} pulsing={busy} />
      <span class="foot muted spacer" style={{ lineHeight: 1.35 }}>
        {note}
      </span>
      {chooser ? (
        <button class="btn fill" style={{ height: 34, padding: "0 12px" }} onClick={pickDevice}>
          {t("Choose")}
        </button>
      ) : busy ? (
        <button class="btn ghost" style={{ height: 34, padding: "0 12px" }} onClick={() => call("disconnectFlipper")}>
          {t("Cancel")}
        </button>
      ) : (
        <button class="btn fill" style={{ height: 34, padding: "0 12px" }} onClick={connect}>
          {hosting || s.flipperHost ? <BluetoothGlyph size={13} color="#000" /> : <Icon name="sidebar" size={14} />}
          {t("Connect")}
        </button>
      )}
    </div>
  );
}

/** A connected Flipper, in Home's header area: its name and Disconnect. */
export function FlipperConnected() {
  const s = useStore();
  const w = activeWallet(s);
  if (!w || w.kind !== "flipper" || !(s.flipper.connected && s.flipper.walletId === w.id)) return null;
  return (
    <span class="row gap-6 cap green" style={{ fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: "var(--scan)" }} />
      {s.flipper.name ?? "Flipper"}
    </span>
  );
}

type Step = { s: "intro" } | { s: "connecting"; name: string } | { s: "approve" } | { s: "birthday"; info: FlipperInfo } | { s: "creating" };

/** Pair a Flipper as a new wallet (in the side panel or the full page, which keep the link). */
export function PairScreen({ onDone }: { onDone: () => void }) {
  const s = useStore();
  useHost();
  const [step, setStep] = useState<Step>({ s: "intro" });
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  useEffect(() => {
    if (link.awaiting && step.s === "connecting") setStep({ s: "approve" });
  });
  const search = async () => {
    setError(null);
    try {
      const device = await link.choose();
      link.device = device;
      setStep({ s: "connecting", name: device.name ?? "Flipper" });
      if (!link.connected) await link.connect(device);
      const info = await hello();
      if (info.createdAt === 0 && !s.wallets.some((w) => w.ufvk === info.ufvk)) setStep({ s: "birthday", info });
      else await create(info, null);
    } catch (e) {
      setError(flipperError(e instanceof FlipperError ? (e.code === "rejected" ? e.message : e.code) : String(e)));
      link.disconnect();
      setStep({ s: "intro" });
    }
  };
  const create = async (info: FlipperInfo, from: number | null) => {
    setStep({ s: "creating" });
    try {
      const id = await call<string>("addFlipperWallet", info, from);
      await call("rememberDevice", id, link.device?.id ?? "");
      sessionOpened(id, info.ufvk);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ s: "intro" });
    }
  };
  const headline =
    step.s === "intro" ? t("Connect your Flipper Zero") : step.s === "connecting" ? step.name : step.s === "approve" ? t("Press OK on your Flipper") : step.s === "birthday" ? t("When was this wallet made?") : t("Setting up your wallet…");
  const detail =
    step.s === "intro"
      ? t("Open ZFlip on the Flipper and unlock it.")
      : step.s === "connecting"
        ? t("If asked, type the code shown on the Flipper.")
        : step.s === "approve"
          ? t("This computer will see the wallet, never spend.")
          : step.s === "birthday"
            ? t("Its funds are looked for from that date.")
            : null;
  return (
    <Screen
      title="Flipper Zero"
      scroll={false}
      footer={
        step.s === "intro" ? (
          <button class="btn fill" onClick={search}>
            <BluetoothGlyph size={14} color="#000" />
            {error ? t("Search again") : t("Search")}
          </button>
        ) : step.s === "birthday" ? (
          <button class="btn fill" onClick={() => create(step.info, new Date(since).getTime() / 1000)}>
            {t("Continue")}
          </button>
        ) : undefined
      }
    >
      <div class="stack center gap-14" style={{ flex: 1, padding: 20, justifyContent: "center" }}>
        {step.s === "creating" ? <ForgingShield size={96} /> : <PairingStage step={step.s === "intro" ? (error ? "idle" : "scan") : step.s === "connecting" ? "link" : step.s === "approve" ? "approve" : "idle"} />}
        <div class="headline" style={{ fontSize: 18, textAlign: "center" }}>
          {headline}
        </div>
        {detail && <div class="foot muted" style={{ textAlign: "center", padding: "0 12px" }}>{detail}</div>}
        {step.s === "birthday" && (
          <div class="input" style={{ maxWidth: 260 }}>
            <span class="foot spacer">{t("Created around")}</span>
            <input type="date" value={since} max={new Date().toISOString().slice(0, 10)} min="2022-06-01" onInput={(e) => setSince((e.target as HTMLInputElement).value)} style={{ width: "auto" }} />
          </div>
        )}
        {error && <Note text={error} />}
      </div>
    </Screen>
  );
}

/** Waves while searching, dots between computer and Flipper while connecting, the light pulsing for OK. */
export function PairingStage({ step }: { step: "idle" | "scan" | "link" | "approve" }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (step === "idle") return;
    let raf = 0;
    const tick = (x: number) => {
      setNow(x);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);
  const s = now / 1000;
  return (
    <div style={{ height: 190, width: "100%", position: "relative", display: "grid", placeItems: "center", direction: "ltr" }}>
      {step === "idle" && <FlipperIcon width={160} light="#999" />}
      {step === "scan" && (
        <>
          {[0, 1, 2].map((i) => {
            const phase = (s / 2.4 + i / 3) % 1;
            const d = 100 + phase * 170;
            return <div key={i} style={{ position: "absolute", width: d, height: d, borderRadius: "50%", border: "2px solid var(--zcash)", opacity: 0.7 * (1 - phase) }} />;
          })}
          <FlipperIcon width={160} light="#2f7bf5" pulsing />
        </>
      )}
      {step === "link" && (
        <div class="row gap-10">
          <svg width="50" height="38" viewBox="0 0 58 44" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round">
            <rect x="8" y="3" width="42" height="28" rx="3" />
            <path d="M2 38h54l-4 4H6z" fill="var(--ink)" />
          </svg>
          <div class="row gap-6">
            {[0, 1, 2, 3, 4].map((i) => {
              const lit = Math.floor(s * 6) % 5 === i;
              return <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--zcash)", opacity: lit ? 1 : 0.25, transform: lit ? "scale(1.4)" : "none" }} />;
            })}
          </div>
          <FlipperIcon width={120} light="#2f7bf5" />
        </div>
      )}
      {step === "approve" && (
        <>
          <div style={{ position: "absolute", width: 200, height: 200, borderRadius: "50%", border: "2px solid rgba(244,183,40,0.35)", transform: `scale(${1 + 0.04 * Math.sin(s * 3)})` }} />
          <FlipperIcon width={160} light="var(--scan)" pulsing={Math.sin(s * 5) > 0} />
        </>
      )}
    </div>
  );
}
