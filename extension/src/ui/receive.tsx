// Receive: the QR code and the address (for a Flipper wallet the one the Flipper shows, for a
// browser wallet a new one on demand).

import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n";
import { call, useStore } from "./store";
import { Icon } from "./icons";
import { QRCode, Ring } from "./marks";
import { CopyButton, Screen } from "./kit";
import { activeWallet } from "./home";

export function ReceiveScreen() {
  const s = useStore();
  const w = activeWallet(s)!;
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    call<string>("address", w.ufvk, w.addressIndex).then((a) => {
      if (!alive) return;
      setAddress(a);
      setBusy(false);
    });
    return () => void (alive = false);
  }, [w.ufvk, w.addressIndex]);
  const newAddress = async () => {
    setBusy(true);
    await call("newPhoneAddress");
  };
  const phone = w.kind === "phone";
  const ready = s.flipper.connected && s.flipper.walletId === w.id;
  return (
    <Screen title={t("Receive ZEC")} footer={address ? <CopyButton text={address} primary /> : undefined}>
      <div class="stack center gap-14" style={{ padding: "18px 16px" }}>
        {!phone && (
          <div class={`row gap-6 foot ${ready ? "green" : "muted"}`} style={{ fontWeight: 600 }}>
            <Icon name={ready ? "seal" : "clock"} size={15} />
            {ready ? t("Same address as on your Flipper") : t("Last address shown on your Flipper")}
          </div>
        )}
        {address ? (
          <>
            <div style={{ position: "relative", padding: 12, background: "#fff", borderRadius: 16, border: "1px solid var(--line)", opacity: busy ? 0.4 : 1, transition: "opacity 0.15s" }}>
              <QRCode text={address} size={190} />
              {busy && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <Ring progress={0.3} size={28} />
                </div>
              )}
            </div>
            <div class="mono cap break" style={{ textAlign: "center", userSelect: "all", padding: "0 4px", lineHeight: 1.5, opacity: busy ? 0.4 : 1 }}>
              {address}
            </div>
            {phone ? (
              <>
                <button class="btn ghost" disabled={busy} onClick={newAddress}>
                  <Icon name="sync" size={15} />
                  {busy ? t("New address…") : t("New address")}
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
    </Screen>
  );
}
