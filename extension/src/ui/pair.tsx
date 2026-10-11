// Connect a Flipper Zero (ZApp's PairView): find it over Bluetooth, pair, get its viewing key.
// Each step is an animation around the Flipper with one short line, not a block of text.

import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, flipperSession, link, useLink, useStore } from "./store";
import { FlipperIcon, BluetoothGlyph, ForgingShield } from "./marks";
import { Note, Screen } from "./kit";
import { FlipperError, Kind, parseInfo, type FlipperInfo } from "../flipper/link";

type Step = { s: "intro" } | { s: "connecting"; name: string } | { s: "approve" } | { s: "birthday"; info: FlipperInfo } | { s: "creating" };

export function flipperMessage(e: unknown): string {
  if (e instanceof FlipperError) {
    switch (e.code) {
      case "unsupported":
        return t("This browser has no Bluetooth. Use Chrome on a computer with Bluetooth.");
      case "cancelled":
        return t("No Flipper chosen.");
      case "timeout":
        return t("The Flipper did not answer in time.");
      case "notConnected":
        return t("The Flipper is not connected.");
      case "rejected":
        return e.message === "REJECTED" ? t("Rejected on the Flipper") : e.message;
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** HELLO → INFO: the user approves sharing the viewing key on the Flipper. */
export async function requestInfo(): Promise<FlipperInfo> {
  const reply = await link.request(Kind.hello);
  if (reply.kind !== Kind.info) throw new FlipperError("protocol", "Unexpected reply from the Flipper");
  return parseInfo(reply.payload);
}

export function PairView({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const l = useLink();
  const [step, setStep] = useState<Step>({ s: "intro" });
  const [error, setError] = useState<string | null>(null);
  const [restoredFrom, setRestoredFrom] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });

  useEffect(() => {
    if (l.awaiting && step.s === "connecting") setStep({ s: "approve" });
  }, [l.awaiting]);

  const search = async () => {
    setError(null);
    try {
      const device = await link.choose();
      setStep({ s: "connecting", name: device.name ?? "Flipper" });
      await link.connect(device);
      const info = await requestInfo();
      if (info.createdAt === 0 && !s.wallets.some((w) => w.ufvk === info.ufvk)) {
        setStep({ s: "birthday", info });
      } else {
        await create(info, null);
      }
    } catch (e) {
      setError(flipperMessage(e));
      link.disconnect();
      setStep({ s: "intro" });
    }
  };

  const create = async (info: FlipperInfo, since: number | null) => {
    setStep({ s: "creating" });
    try {
      const id = await call<string>("addFlipperWallet", info, since);
      flipperSession.walletId = id;
      await call("rememberDevice", id, link.device?.id ?? "").catch(() => {});
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ s: "intro" });
    }
  };

  const stage = step.s === "intro" ? (error ? "idle" : "scan") : step.s === "connecting" ? "link" : step.s === "approve" ? "approve" : "done";
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
    <Screen title="" scroll={false}>
      <div class="stack center gap-16" style={{ flex: 1, padding: 20 }}>
        <div class="spacer" />
        <PairingStage step={stage} />
        <div class="title2" style={{ textAlign: "center" }}>
          {headline}
        </div>
        {detail && (
          <div class="sub muted" style={{ textAlign: "center", padding: "0 24px" }}>
            {detail}
          </div>
        )}
        {error && <Note text={error} />}
        <div class="spacer" />
        {step.s === "intro" && (
          <button class="primary" onClick={search}>
            <BluetoothGlyph size={16} color="#000" />
            {error ? t("Search again") : t("Search")}
          </button>
        )}
        {step.s === "birthday" && (
          <div class="stack gap-14" style={{ width: "100%" }}>
            <div class="field">
              <span class="sub" style={{ flex: 1 }}>{t("Created around")}</span>
              <input type="date" value={restoredFrom} max={new Date().toISOString().slice(0, 10)} min="2022-06-01" onInput={(e) => setRestoredFrom((e.target as HTMLInputElement).value)} style={{ width: "auto" }} />
            </div>
            <button class="primary" onClick={() => create(step.info, new Date(restoredFrom).getTime() / 1000)}>
              {t("Continue")}
            </button>
          </div>
        )}
      </div>
    </Screen>
  );
}

/**
 * The pairing animation: waves sweep out from the Flipper while searching, dots run between the
 * computer and the Flipper while connecting, the Flipper's light pulses while it waits for OK,
 * and the shield draws itself when it's done.
 */
export function PairingStage({ step }: { step: "idle" | "scan" | "link" | "approve" | "done" }) {
  const [t0] = useState(() => performance.now());
  const [now, setNow] = useState(t0);
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
  const s = (now - t0) / 1000;
  return (
    <div style={{ height: 240, width: "100%", position: "relative", display: "grid", placeItems: "center", direction: "ltr" }}>
      {step === "idle" && <FlipperIcon width={200} light="#999" />}
      {step === "scan" && (
        <>
          {[0, 1, 2].map((i) => {
            const phase = (s / 2.4 + i / 3) % 1;
            const d = 120 + phase * 220;
            return <div key={i} style={{ position: "absolute", width: d, height: d, borderRadius: "50%", border: "2px solid var(--zcash)", opacity: 0.7 * (1 - phase) }} />;
          })}
          <FlipperIcon width={200} light="#2f7bf5" pulsing />
          <div style={{ position: "absolute", top: 120 - 78 - 12, color: "var(--zcash)" }}>
            <BluetoothGlyph size={24} />
          </div>
        </>
      )}
      {step === "link" && (
        <div class="row gap-10">
          <svg width="58" height="44" viewBox="0 0 58 44" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round">
            <rect x="8" y="3" width="42" height="28" rx="3" />
            <path d="M2 38h54l-4 4H6z" fill="var(--ink)" />
          </svg>
          <div class="row gap-8">
            {[0, 1, 2, 3, 4].map((i) => {
              const lit = Math.floor(s * 6) % 5 === i;
              return <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--zcash)", opacity: lit ? 1 : 0.25, transform: lit ? "scale(1.4)" : "none" }} />;
            })}
          </div>
          <FlipperIcon width={150} light="#2f7bf5" />
        </div>
      )}
      {step === "approve" && (
        <>
          <div style={{ position: "absolute", width: 250, height: 250, borderRadius: "50%", border: "2px solid rgba(244,183,40,0.35)", transform: `scale(${1 + 0.04 * Math.sin(s * 3)})` }} />
          <FlipperIcon width={200} light="var(--scan)" pulsing={Math.sin(s * 5) > 0} />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(${59 - 14}px, ${-58 - 5 * Math.abs(Math.sin(s * 3)) - 12}px)`,
              background: "var(--zcash)",
              color: "#000",
              fontWeight: 900,
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 999,
            }}
          >
            OK
          </div>
        </>
      )}
      {step === "done" && <ForgingShield size={120} />}
    </div>
  );
}
