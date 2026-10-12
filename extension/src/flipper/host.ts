// The Flipper's Bluetooth link, held by a visible page that stays open: the side panel (or the
// full-page app). Web Bluetooth only works in such a page, and only its first connection needs
// a click (the browser's chooser); after that the link stays up while the panel is open, and
// comes back on its own if the Flipper drops it. The wallet model asks it to connect and sign.

import { FlipperError, FlipperLink, Kind, parseInfo, type FlipperInfo } from "./link";
import type { FlipperLinkState } from "../model/wallet";
import { pack, unpack } from "../port";

export const link = new FlipperLink();
let port: chrome.runtime.Port | null = null;
let state: FlipperLinkState = { connected: false, walletId: null, name: null, awaiting: false, busy: false, error: null };
/** Waiting for the user's click to choose a Flipper (the chooser needs one). */
let wantChooser: ((d: BluetoothDevice | null) => void) | null = null;
const listeners = new Set<() => void>();
let expectedUfvk: string | null = null;

function report(patch: Partial<FlipperLinkState> = {}) {
  state = { ...state, ...patch, connected: link.connected, awaiting: link.awaiting, name: link.device?.name ?? state.name };
  port?.postMessage({ event: "flipper", state });
  listeners.forEach((l) => l());
}

export const hostState = () => state;
export const needsChooser = () => wantChooser !== null;
export function onHostChange(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The wallet whose session dropped: reconnected on its own (no click needed for a known device). */
let resume: string | null = null;
let resuming = false;

link.onChange = () => {
  if (!link.connected && state.walletId) {
    resume = state.walletId;
    state = { ...state, walletId: null };
    if (!resuming && link.device) {
      resuming = true;
      setTimeout(reconnect, 1000);
    }
  }
  report();
};

async function reconnect() {
  for (let i = 0; i < 5 && resume && !link.connected; i++) {
    try {
      await link.connect(link.device!, 15_000);
      const info = await hello();
      if (expectedUfvk && info.ufvk === expectedUfvk) {
        report({ walletId: resume, error: null });
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  resume = null;
  resuming = false;
  report();
}
link.onAddress = (index, text) => port?.postMessage({ event: "flipper", state, address: { index, text } });

/** The user clicked Connect in this page: open the browser's chooser. */
export async function chooseFlipper() {
  try {
    const d = await link.choose();
    wantChooser?.(d);
  } catch {
    wantChooser?.(null);
  }
  wantChooser = null;
  report();
}

/** HELLO → INFO (OK on the Flipper). */
export async function hello(): Promise<FlipperInfo> {
  const reply = await link.request(Kind.hello);
  if (reply.kind !== Kind.info) throw new FlipperError("protocol", "Unexpected reply from the Flipper");
  return parseInfo(reply.payload);
}

async function ensureDevice(deviceId: string | null): Promise<BluetoothDevice> {
  if (link.device && (!deviceId || link.device.id === deviceId)) return link.device;
  const known = deviceId ? await FlipperLink.known(deviceId) : null;
  if (known) return known;
  // The chooser needs a click: the page shows a Connect button until then.
  report({ busy: true, error: null });
  const d = await new Promise<BluetoothDevice | null>((resolve) => (wantChooser = resolve));
  if (!d) throw new FlipperError("cancelled");
  return d;
}

const calls: Record<string, (...a: any[]) => Promise<unknown>> = {
  /** Connects the wallet's Flipper (or this page's) and opens a session for that wallet. */
  async connect(walletId: string, ufvk: string, deviceId: string | null) {
    if (link.connected && state.walletId === walletId) return true;
    report({ busy: true, error: null });
    try {
      const device = await ensureDevice(deviceId);
      if (!link.connected) await link.connect(device, 20_000);
      expectedUfvk = ufvk;
      const info = await hello();
      if (info.ufvk !== ufvk) {
        report({ busy: false, walletId: null, error: `OTHER_WALLET:${info.deviceName}` });
        return false;
      }
      report({ busy: false, walletId, error: null });
      return true;
    } catch (e) {
      report({ busy: false, error: e instanceof FlipperError ? e.code : String(e) });
      return false;
    }
  },
  async disconnect() {
    link.disconnect();
    report({ walletId: null, error: null });
  },
  /** The SIGN frame; the reply's signatures. Reconnects first if the Flipper dropped the link. */
  async sign(request: Uint8Array) {
    if (!link.connected && link.device) {
      await link.connect(link.device, 20_000);
      const info = await hello();
      if (expectedUfvk && info.ufvk !== expectedUfvk) throw new Error("This Flipper holds another wallet.");
    }
    const reply = await link.request(Kind.sign, request, 600_000);
    if (reply.kind !== Kind.signed) throw new Error("Unexpected reply from the Flipper");
    return reply.payload;
  },
};

/** Makes this page the Flipper's host. */
export function startHost() {
  port = chrome.runtime.connect({ name: "flipper-host" });
  port.onMessage.addListener(async (m: { id: number; call: string; args: unknown[] }) => {
    try {
      const value = await calls[m.call](...(unpack(m.args) as unknown[]));
      port!.postMessage({ id: m.id, ok: true, value: pack(value) });
    } catch (e) {
      port!.postMessage({ id: m.id, ok: false, error: e instanceof FlipperError ? (e.code === "rejected" ? e.message : e.code) : e instanceof Error ? e.message : String(e) });
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(startHost, 500);
  });
  report();
}

/** The user's click in this page: choose a Flipper if none yet (the chooser needs the click). */
export async function pickDevice(): Promise<boolean> {
  if (wantChooser) {
    await chooseFlipper();
    return true;
  }
  if (link.device) return true;
  try {
    link.device = await link.choose();
    return true;
  } catch {
    return false;
  }
}

/** A new Flipper wallet was paired in this page: its session is open. */
export function sessionOpened(walletId: string, ufvk: string) {
  expectedUfvk = ufvk;
  report({ walletId, busy: false, error: null });
}
