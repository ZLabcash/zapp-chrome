// The offscreen document: runs the engine worker and the wallet model while the browser is
// open, and serves the popup and the app page over runtime ports (state pushed on every change).

import { EngineClient } from "../engine/client";
import { WalletModel } from "../model/wallet";
import { pack, unpack } from "../port";

const engine = new EngineClient();
const model = new WalletModel(engine);
const ports = new Set<chrome.runtime.Port>();
const opened = model.open().catch((e) => console.error("[zapp] open", e));

let scheduled = false;
model.onChange = () => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const state = model.state();
    ports.forEach((p) => p.postMessage({ event: "state", state }));
  });
};

/** What the pages may ask of the model. */
const actions: Record<string, (...a: any[]) => unknown> = {
  state: () => model.state(),
  activate: (id: string) => model.activate(id),
  rename: (id: string, name: string) => model.rename(id, name),
  remove: (id: string) => model.remove(id),
  addFlipperWallet: (info: any, restoredFrom: number | null) => model.addFlipperWallet(info, restoredFrom),
  flipperShows: (i: number, a: string) => model.flipperShows(i, a),
  rememberIndex: (id: string, i: number) => model.rememberIndex(id, i),
  rememberDevice: (id: string, d: string) => model.rememberDevice(id, d),
  newPhrase: () => model.newPhrase(),
  isWord: (w: string) => model.isWord(w),
  checkPassword: (p: string) => model.checkPassword(p),
  addPhoneWallet: (name: string, phrase: string, since: number | null, password: string) => model.addPhoneWallet(name, phrase, since, password),
  addAccount: (walletId: string, name: string) => model.addAccount(walletId, name),
  recoveryPhrase: (password: string) => model.recoveryPhrase(password),
  newPhoneAddress: () => model.newPhoneAddress(),
  address: (ufvk: string, i: number) => model.address(ufvk, i),
  ownAddresses: () => model.ownAddresses(),
  addressKind: (t: string) => model.addressKind(t),
  saveContact: (c: any) => model.saveContact(c),
  deleteContact: (id: string) => model.deleteContact(id),
  setSettings: (s: any) => model.setSettings(s),
  syncNow: () => model.syncNow(),
  proposalFee: (p: any[]) => model.proposalFee(p),
  setSend: (s: any) => model.setSend(s),
  sendFromBrowser: (p: any[]) => model.sendFromBrowser(p),
  sendWithFlipper: (p: any[]) => model.sendWithFlipper(p),
  connectFlipper: () => model.connectFlipper(),
  disconnectFlipper: () => model.disconnectFlipper(),
  unlock: (password: string) => model.unlock(password),
  lock: () => model.lock(),
  changePassword: (a: string, b: string) => model.changePassword(a, b),
  prepareFlipperSend: (p: any[]) => model.prepareFlipperSend(p),
  finishFlipperSend: (id: string, sigs: Uint8Array) => model.finishFlipperSend(id, sigs),
  cancelFlipperSend: (id: string, m?: string) => model.cancelFlipperSend(id, m),
  broadcast: (id: string) => model.broadcast(id),
  discard: (id: string) => model.discard(id),
  recipients: (tx: string) => model.recipients(tx),
  refreshPrices: () => model.prices.refresh(),
  /** How long an Orchard proof takes here (diagnostics). */
  proveSelftest: () => engine.call("proveSelftest"),
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "flipper-host") {
    opened.then(() => model.attachHost(port));
    return;
  }
  if (port.name !== "zapp") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  opened.then(() => port.postMessage({ event: "state", state: model.state() }));
  port.onMessage.addListener(async (m: { id: number; action: string; args: unknown[] }) => {
    try {
      await opened;
      if (m.action !== "state") model.touch();
      const fn = actions[m.action];
      if (!fn) throw new Error(`unknown action ${m.action}`);
      const value = await fn(...(unpack(m.args) as unknown[]));
      port.postMessage({ id: m.id, ok: true, value: pack(value) });
    } catch (e) {
      port.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
});

// The toolbar icon: the ZLab mark with a dark Z on a light toolbar, a white Z on a dark one.
const dark = matchMedia("(prefers-color-scheme: dark)");
const theme = () => chrome.runtime.sendMessage({ type: "theme", dark: dark.matches }).catch(() => {});
dark.addEventListener("change", theme);
theme();
