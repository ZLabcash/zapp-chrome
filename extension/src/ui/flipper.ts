// This page's session with the active wallet's Flipper (ZApp's flipperState / connectFlipper).

import { useEffect, useState } from "preact/hooks";
import { call, flipperSession, getState, isPopup, link, openApp } from "./store";
import { FlipperLink, FlipperError } from "../flipper/link";
import { requestInfo, flipperMessage } from "./pair";
import { t } from "../i18n";

export type FlipperState =
  | { s: "idle" }
  | { s: "connecting" }
  | { s: "approve" }
  | { s: "ready" }
  | { s: "otherWallet"; name: string }
  | { s: "failed"; message: string };

let fs: FlipperState = { s: "idle" };
const listeners = new Set<() => void>();
const set = (x: FlipperState) => {
  fs = x;
  listeners.forEach((l) => l());
};

const prevChange = link.onChange;
link.onChange = () => {
  prevChange();
  if (link.state === "idle" && (fs.s === "ready" || fs.s === "connecting" || fs.s === "approve")) {
    flipperSession.walletId = null;
    set({ s: "idle" });
  }
  if (link.awaiting && fs.s === "connecting") set({ s: "approve" });
};

export function useFlipper(): FlipperState {
  const [, n] = useState(0);
  useEffect(() => {
    const l = () => n((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return fs;
}

/** The active Flipper wallet's Flipper is connected with a session open. */
export function flipperReady(walletId: string | null): boolean {
  return fs.s === "ready" && link.connected && flipperSession.walletId === walletId;
}

/**
 * Connects to the active wallet's Flipper and opens a session (OK on the Flipper). A Flipper
 * this browser already knows connects without the chooser; otherwise the chooser opens (in the
 * app page: it would close the popup).
 */
export async function connectFlipper(): Promise<boolean> {
  const st = getState();
  const w = st.wallets.find((x) => x.id === st.activeId);
  if (!w || w.kind !== "flipper") return false;
  if (flipperReady(w.id)) return true;
  set({ s: "connecting" });
  try {
    if (!link.connected) {
      let device = w.deviceId ? await FlipperLink.known(w.deviceId) : null;
      if (!device) {
        if (isPopup) {
          openApp("#connect");
          return false;
        }
        device = await link.choose();
      }
      await link.connect(device, 20_000);
    }
    const info = await requestInfo();
    if (info.ufvk !== w.ufvk) {
      const known = st.wallets.find((x) => x.ufvk === info.ufvk);
      if (known) {
        await call("activate", known.id);
        flipperSession.walletId = known.id;
        set({ s: "ready" });
        return true;
      }
      set({ s: "otherWallet", name: info.deviceName });
      pendingOther = info;
      return false;
    }
    flipperSession.walletId = w.id;
    await call("rememberIndex", w.id, info.addressIndex);
    if (link.device && link.device.id !== w.deviceId) await call("rememberDevice", w.id, link.device.id);
    set({ s: "ready" });
    return true;
  } catch (e) {
    link.disconnect();
    set({ s: "failed", message: e instanceof FlipperError && e.code === "timeout" ? t("Flipper not found. Open ZFlip on it and unlock it.") : flipperMessage(e) });
    return false;
  }
}

let pendingOther: Awaited<ReturnType<typeof requestInfo>> | null = null;

/** Replaces this browser's wallet with the one on the connected Flipper. */
export async function adoptFlipperWallet() {
  if (!pendingOther) return;
  const info = pendingOther;
  pendingOther = null;
  try {
    const id = await call<string>("addFlipperWallet", info, null);
    if (link.device) await call("rememberDevice", id, link.device.id);
    flipperSession.walletId = id;
    set({ s: "ready" });
  } catch (e) {
    set({ s: "failed", message: e instanceof Error ? e.message : String(e) });
  }
}

export function disconnectFlipper() {
  link.disconnect();
  flipperSession.walletId = null;
  set({ s: "idle" });
}

/** Switching wallets: the link stays up; another Flipper's wallet needs its own Flipper. */
export function walletSwitched(id: string) {
  if (flipperSession.walletId === id && link.connected) set({ s: "ready" });
  else if (fs.s === "ready" || fs.s === "failed" || fs.s === "otherWallet") set({ s: "idle" });
}

export function flipperNote(): string | null {
  switch (fs.s) {
    case "connecting":
      return t("Open ZFlip on the Flipper and unlock it, close to this computer.");
    case "approve":
      return t("Press OK on your Flipper to share the viewing key (it can see, never spend).");
    case "otherWallet":
      return t("%@ holds a different wallet than this browser.", fs.name);
    case "failed":
      return fs.message;
    default:
      return null;
  }
}
