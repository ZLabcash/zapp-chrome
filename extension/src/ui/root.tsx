// The app, in the popup, the side panel and the full page: unlock when locked, the welcome
// flow without a wallet (in the full page, as wallet extensions onboard), Home with one;
// screens pushed over it, sheets on top.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./theme.css";
import { call, context, nav, openApp, start, useNav, useStore } from "./store";
import { t } from "../i18n";
import { WelcomeView, AddWalletScreen } from "./onboarding";
import { HomeScreen } from "./home";
import { PairScreen } from "./flipper";
import { DrawingShield, Shield } from "./marks";
import { Note } from "./kit";
import { startHost } from "../flipper/host";

/** As wallet extensions: the password once, then the wallet stays open until it locks itself. */
function UnlockScreen() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await call("unlock", password);
    } catch {
      setError(t("Wrong password."));
      setBusy(false);
    }
  };
  return (
    <div class="stack center" style={{ height: "100%", padding: "24px 28px 36px" }}>
      <div class="spacer" />
      <DrawingShield size={92} duration={800} />
      <div class="rounded" style={{ fontSize: 34, fontWeight: 800, marginTop: 14 }}>
        ZApp
      </div>
      <div class="spacer" />
      <div class="stack center gap-12" style={{ width: "100%", maxWidth: 320 }}>
        <div class="input" style={{ width: "100%" }}>
          <input
            ref={ref}
            type="password"
            placeholder={t("Enter your ZApp password")}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            style={{ textAlign: "center" }}
          />
        </div>
        {error && <Note text={error} />}
        <button class="btn fill" style={{ width: "100%" }} disabled={!password || busy} onClick={unlock}>
          {t("Unlock")}
        </button>
        <button class="link-btn" onClick={() => setShowForgot(true)}>
          {t("Forgot password?")}
        </button>
      </div>
      {/* The locked screen renders alone (before the nav sheet layer), so its own overlay. */}
      {showForgot && (
        <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setShowForgot(false)}>
          <div class="sheet">
            <div class="grabber" />
            <div class="stack gap-14" style={{ padding: "4px 20px 24px" }}>
              <div class="headline" style={{ fontSize: 18 }}>{t("Forgot password?")}</div>
              <div class="foot muted" style={{ lineHeight: 1.5 }}>
                {t("Your password can't be recovered. To get back in, remove ZApp from Chrome, add it again, and restore each wallet from its 24-word recovery phrase.")}
              </div>
              <button class="btn fill" style={{ marginTop: 4 }} onClick={() => setShowForgot(false)}>
                {t("Got it")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The popup without a wallet: onboarding happens in the full page. */
function PopupWelcome() {
  return (
    <div class="stack center" style={{ height: "100%", padding: "56px 24px 24px", gap: 14 }}>
      <Shield size={84} />
      <div class="rounded" style={{ fontSize: 30, fontWeight: 800 }}>
        ZApp
      </div>
      <div class="sub muted">{t("Private by default.")}</div>
      <div class="spacer" />
      <button class="btn fill wide" onClick={() => openApp()}>
        {t("Start")}
      </button>
    </div>
  );
}

function App() {
  const s = useStore();
  const { stack, sheets, popped } = useNav();

  // The full page opened for something the popup can't do.
  useEffect(() => {
    if (!s.ready || context === "popup" || s.locked) return;
    const h = location.hash;
    if (h === "#pair") nav.push(() => <PairScreen onDone={() => nav.root()} />);
    if (h === "#add") nav.push(() => <AddWalletScreen onDone={() => nav.root()} />);
    if (h) history.replaceState(null, "", location.pathname);
  }, [s.ready, s.locked]);

  if (!s.ready) return <div class="screen" />;
  if (s.locked) return <UnlockScreen />;
  const root = s.wallets.length ? <HomeScreen /> : context === "popup" ? <PopupWelcome /> : <WelcomeView />;
  return (
    <>
      <div class="screen" style={{ animation: "none" }}>
        {root}
      </div>
      {stack.map((e, i) => (
        <div class={`screen ${popped && i === stack.length - 1 ? "back" : ""}`} key={e.key}>
          {e.render()}
        </div>
      ))}
      {sheets.map((e) => (
        <div key={e.key} style={{ position: "absolute", inset: 0, zIndex: 50 }}>
          {e.render()}
        </div>
      ))}
    </>
  );
}

export function mount() {
  start();
  // The side panel and the full page keep the Flipper's Bluetooth link.
  if (context !== "popup") startHost();
  render(<App />, document.getElementById("root")!);
}
