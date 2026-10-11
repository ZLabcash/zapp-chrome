import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, enableExtensions: [resolve(import.meta.dirname, "../dist")],
  userDataDir: resolve(import.meta.dirname, "../.profile"), protocolTimeout: 120_000,
});
const sw = await browser.waitForTarget((t) => t.type() === "service_worker");
const id = new URL(sw.url()).host;
const page = await browser.newPage();
await page.goto(`chrome-extension://${id}/popup.html`);
const r = await page.evaluate(async () => {
  const t0 = performance.now();
  const res = await fetch("https://zec.rocks/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetSubtreeRoots", {
    method: "POST", headers: { "content-type": "application/grpc" }, body: new Uint8Array([0, 0, 0, 0, 0]),
  });
  const out = { status: res.status, headers: [...res.headers].map((h) => h.join(": ")), chunks: 0, bytes: 0 };
  const reader = res.body.getReader();
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), 15000));
  for (;;) {
    const x = await Promise.race([reader.read(), timeout]);
    if (x === "timeout") { out.end = "timeout"; break; }
    if (x.done) { out.end = "done"; break; }
    out.chunks++; out.bytes += x.value.length;
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
