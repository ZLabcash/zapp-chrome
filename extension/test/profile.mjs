// Profiles the engine worker during a restore sync and prints the hottest functions.
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, enableExtensions: [resolve(import.meta.dirname, "../dist")],
  userDataDir: resolve(import.meta.dirname, "../.profile"), protocolTimeout: 900_000,
});
const sw = await browser.waitForTarget((t) => t.type() === "service_worker");
const id = new URL(sw.url()).host;
const page = await browser.newPage();
await page.goto(`chrome-extension://${id}/popup.html`);
await new Promise((r) => setTimeout(r, 3000));
const cdp = await browser.target().createCDPSession();
const { targetInfos } = await cdp.send("Target.getTargets");
console.log(targetInfos.map((t) => `${t.type} ${t.url}`).join("\n"));
const worker = targetInfos.find((t) => t.type === "worker" && t.url.includes("worker"));
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
const ws = cdp.connection().session(sessionId);
await ws.send("Profiler.enable");
await ws.send("Profiler.setSamplingInterval", { interval: 500 });
await ws.send("Profiler.start");
await page.evaluate(async () => {
  await chrome.runtime.sendMessage({ type: "ensure-engine" });
  const port = chrome.runtime.connect({ name: "zapp" });
  let n = 0;
  const waiting = new Map();
  port.onMessage.addListener((m) => { if (m.id && waiting.has(m.id)) waiting.get(m.id)(m); });
  const call = (action, ...args) => new Promise((res, rej) => { const id = ++n; waiting.set(id, (m) => (m.ok ? res(m.value) : rej(new Error(m.error)))); port.postMessage({ id, action, args }); });
  const phrase = await call("newPhrase");
  await call("addPhoneWallet", "P", phrase, Date.now() / 1000 - 86400, "profiletest1");
});
await new Promise((r) => setTimeout(r, 20000));
const { profile } = await ws.send("Profiler.stop");
writeFileSync(process.argv[2] ?? "/tmp/zapp.cpuprofile", JSON.stringify(profile));
// self time per function
const self = new Map();
const total = profile.samples.length;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (const s of profile.samples) {
  const n = byId.get(s);
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}`;
  self.set(k, (self.get(k) ?? 0) + 1);
}
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log((v / total * 100).toFixed(1).padStart(5), k);
await browser.close();
