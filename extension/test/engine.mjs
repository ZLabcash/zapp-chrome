// node test/engine.mjs — loads dist/ in Chrome and drives the engine: a new phrase, its
// viewing key imported from a recent birthday, a sync against zec.rocks, the summary.
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../dist");
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  enableExtensions: [dist],
  userDataDir: resolve(import.meta.dirname, "../.profile"),
  args: ["--no-first-run"],
  protocolTimeout: 900_000,
});
const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("background.js"));
const id = new URL(sw.url()).host;
browser.on("targetcreated", async (t) => {
  if (t.type() === "other" || t.type() === "worker" || t.type() === "page") {
    const s = await t.createCDPSession().catch(() => null);
    if (!s) return;
    await s.send("Runtime.enable").catch(() => {});
    s.on("Runtime.consoleAPICalled", (e) => console.log(`[${t.type()}]`, e.args.map((a) => a.value ?? a.description).join(" ")));
    s.on("Runtime.exceptionThrown", (e) => console.log(`[${t.type()} exception]`, e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
  }
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
await page.goto(`chrome-extension://${id}/popup.html`);
const out = await page.evaluate(async () => {
  await chrome.runtime.sendMessage({ type: "ensure-engine" });
  const port = chrome.runtime.connect({ name: "zapp" });
  let n = 0;
  const waiting = new Map();
  const log = [];
  port.onMessage.addListener((m) => {
    if (m.event === "sync") console.log(`sync ${JSON.stringify(m.state)}`);
    if (m.event === "log") console.log(m.text);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    }
  });
  const pack = (v) => (v instanceof Uint8Array ? { $u8: btoa(String.fromCharCode(...v)) } : Array.isArray(v) ? v.map(pack) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)])) : v);
  const unpack = (v) => (Array.isArray(v) ? v.map(unpack) : v && typeof v === "object" ? (typeof v.$u8 === "string" ? Uint8Array.from(atob(v.$u8), (c) => c.charCodeAt(0)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]))) : v);
  const call = (...args) =>
    new Promise((res, rej) => {
      const id = ++n;
      waiting.set(id, (m) => (m.ok ? res(unpack(m.value)) : rej(new Error(m.error))));
      port.postMessage({ id, action: "engine", args: pack(args) });
    });
  const t0 = performance.now();
  const step = (s) => console.log(`step ${s} ${Math.round(performance.now() - t0)}ms`);
  const phrase = await call("mnemonicNew");
  step("phrase");
  const { fingerprint, ufvk } = await call("mnemonicCheck", phrase);
  step("ufvk");
  const tip = await call("latestHeight");
  step(`tip ${tip}`);
  const accounts = await call("accounts");
  let account = accounts[0]?.uuid;
  if (!account) account = await call("importAccount", "Test", ufvk, tip - 300, fingerprint, 0, "zapp");
  step(`imported ${account}`);
  await call("sync");
  step("synced");
  const summary = await call("summary");
  const address = await call("address", ufvk, 0);
  return { words: phrase.split(" ").length, tip, account, summary, address: address.slice(0, 20), ms: Math.round(performance.now() - t0), log: log.slice(-4) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
