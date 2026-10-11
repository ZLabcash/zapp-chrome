// The app, in the popup and in the full page: the welcome flow without a wallet, Home with one
// (after ZApp's opening animation), screens pushed over it, sheets on top.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./theme.css";
import { start, useNav, useStore, nav, isPopup } from "./store";
import { WelcomeView } from "./onboarding";
import { HomeView } from "./home";
import { PairView } from "./pair";
import { SendView } from "./send";
import { DrawingShield } from "./marks";
import { connectFlipper } from "./flipper";

function Splash({ onDone }: { onDone: () => void }) {
  const [wordmark, setWordmark] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setWordmark(true), 700);
    const b = setTimeout(onDone, 1400);
    return () => (clearTimeout(a), clearTimeout(b));
  }, []);
  return (
    <div class="screen stack center" style={{ justifyContent: "center", gap: 14, zIndex: 80, animation: "none" }}>
      <DrawingShield size={112} />
      <div class="rounded appear" style={{ fontSize: 44, fontWeight: 800, opacity: wordmark ? 1 : 0, transform: wordmark ? "none" : "translateY(8px)" }}>
        ZApp
      </div>
    </div>
  );
}

function App() {
  const s = useStore();
  const { stack, sheets, popped } = useNav();
  const [splash, setSplash] = useState(true);
  const [fading, setFading] = useState(false);
  const hasWallet = s.wallets.length > 0;

  // The app page opened for something the popup can't do (Bluetooth chooser, camera).
  useEffect(() => {
    if (!s.ready || isPopup) return;
    const h = location.hash;
    if (h === "#pair") nav.push(() => <PairView onDone={() => nav.root()} />);
    if (h === "#connect") connectFlipper();
    if (h === "#send") nav.push(() => <SendView />);
    if (h) history.replaceState(null, "", location.pathname);
  }, [s.ready]);

  if (!s.ready) return <div class="screen" />;
  const root = hasWallet ? <HomeView /> : <WelcomeView />;
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
      {splash && hasWallet && (
        <div style={{ position: "absolute", inset: 0, zIndex: 80, transition: "opacity 0.35s", opacity: fading ? 0 : 1 }}>
          <Splash
            onDone={() => {
              setFading(true);
              setTimeout(() => setSplash(false), 350);
            }}
          />
        </div>
      )}
    </>
  );
}

export function mount() {
  start();
  render(<App />, document.getElementById("root")!);
}
