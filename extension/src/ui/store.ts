// The page's link to the wallet model (in the offscreen document), the navigation stack and the
// Flipper link of this page.

import { useEffect, useState } from "preact/hooks";
import type { ComponentChild } from "preact";
import { pack, unpack } from "../port";
import type { State } from "../model/types";
import { DEFAULT_SETTINGS } from "../model/types";
import { FlipperLink } from "../flipper/link";
import { effective, setLanguage } from "../i18n";

const empty: State = {
  ready: false,
  wallets: [],
  activeId: null,
  balances: {},
  balance: 0,
  pending: 0,
  change: 0,
  sync: { progress: 0, tip: 0, scanned: 0, synced: false, error: null, reachable: true },
  activity: [],
  pendingBroadcasts: [],
  contacts: [],
  settings: DEFAULT_SETTINGS,
  prices: {},
  vault: { exists: false, passkey: false },
  send: { step: "idle" },
  online: true,
};

let state: State = empty;
const listeners = new Set<() => void>();
let port: chrome.runtime.Port | null = null;
let next = 1;
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let connecting: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function applyLook() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.appearance === 1) root.dataset.theme = "light";
  else if (s.appearance === 2) root.dataset.theme = "dark";
  else delete root.dataset.theme;
  setLanguage(effective(s.language));
}

async function connect(): Promise<void> {
  // The engine runs in the offscreen document, which the service worker creates.
  await chrome.runtime.sendMessage({ type: "ensure-engine" }).catch(() => {});
  port = chrome.runtime.connect({ name: "zapp" });
  port.onMessage.addListener((m) => {
    if (m.event === "state") {
      state = m.state;
      applyLook();
      emit();
      return;
    }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    m.ok ? w.resolve(unpack(m.value)) : w.reject(new Error(m.error));
  });
  port.onDisconnect.addListener(() => {
    port = null;
    connecting = null;
    waiting.forEach((w) => w.reject(new Error("The wallet engine restarted.")));
    waiting.clear();
    setTimeout(() => (connecting = connect()), 300);
  });
}

export function start() {
  connecting ??= connect();
  return connecting;
}

/** Calls an action of the wallet model. */
export async function call<T = any>(action: string, ...args: unknown[]): Promise<T> {
  await (connecting ?? start());
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    port!.postMessage({ id, action, args: pack(args) });
  });
}

export function getState() {
  return state;
}

export function useStore(): State {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}

// ---- navigation: a stack of screens, and sheets over them ----

type Entry = { key: number; render: () => ComponentChild };
let stack: Entry[] = [];
let sheets: Entry[] = [];
let popped = false;
let keys = 1;
const navListeners = new Set<() => void>();
const navEmit = () => navListeners.forEach((l) => l());

export const nav = {
  push(render: () => ComponentChild) {
    popped = false;
    stack = [...stack, { key: keys++, render }];
    navEmit();
  },
  pop() {
    popped = true;
    stack = stack.slice(0, -1);
    navEmit();
  },
  /** Back to the root screen. */
  root() {
    popped = true;
    stack = [];
    sheets = [];
    navEmit();
  },
  /** Replaces the whole stack with one screen. */
  reset(render?: () => ComponentChild) {
    popped = false;
    stack = render ? [{ key: keys++, render }] : [];
    navEmit();
  },
  sheet(render: () => ComponentChild) {
    sheets = [...sheets, { key: keys++, render }];
    navEmit();
  },
  closeSheet() {
    sheets = sheets.slice(0, -1);
    navEmit();
  },
  get depth() {
    return stack.length;
  },
};

export function useNav() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    navListeners.add(l);
    return () => void navListeners.delete(l);
  }, []);
  return { stack, sheets, popped };
}

// ---- this page's Flipper ----

export const link = new FlipperLink();
const linkListeners = new Set<() => void>();
link.onChange = () => linkListeners.forEach((l) => l());
link.onAddress = (index, address) => void call("flipperShows", index, address);

export function useLink() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    linkListeners.add(l);
    return () => void linkListeners.delete(l);
  }, []);
  return link;
}

/** Which wallet the connected Flipper's session belongs to (HELLO accepted). */
export const flipperSession: { walletId: string | null } = { walletId: null };

/** Whether this page runs as the toolbar popup (Bluetooth choosers close it: use the app tab). */
export const isPopup = document.body.classList.contains("popup");

/** Opens the full-page app (for Bluetooth pairing, the camera, or more room). */
export function openApp(hash = "") {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") + hash });
  if (isPopup) window.close();
}
