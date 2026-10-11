// node test/shots.mjs <outdir> [scenario] — screenshots of the popup (380×600) in Chrome.
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots";
const scenario = process.argv[3] ?? "welcome";
const dark = process.argv.includes("--dark");
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  enableExtensions: [resolve(import.meta.dirname, "../dist")],
  userDataDir: resolve(import.meta.dirname, "../.profile"),
  protocolTimeout: 900_000,
});
const attach = async (t) => {
  if (!["other", "background_page", "worker"].includes(t.type())) return;
  const s = await t.createCDPSession().catch(() => null);
  if (!s) return;
  await s.send("Runtime.enable").catch(() => {});
  s.on("Runtime.consoleAPICalled", (e) => console.log(`[${t.type()}]`, e.args.map((a) => a.value ?? a.description).join(" ")));
  s.on("Runtime.exceptionThrown", (e) => console.log(`[${t.type()} exception]`, e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
};
browser.on("targetcreated", attach);
const sw = await browser.waitForTarget((t) => t.type() === "service_worker");
for (const t of browser.targets()) attach(t);
const id = new URL(sw.url()).host;
// The welcome tab the install opens: close it.
for (const p of await browser.pages()) if (p.url().includes("app.html")) await p.close();
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
await page.setViewport({ width: 380, height: 600, deviceScaleFactor: 2 });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`chrome-extension://${id}/popup.html`);
await page.bringToFront();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};
const click = async (text) => {
  const ok = await page.evaluate((text) => {
    // The topmost layer (sheet or pushed screen) first.
    const layers = [...document.querySelectorAll("#root > div")].reverse();
    let el = null;
    for (const l of layers) {
      el = [...l.querySelectorAll("button, a")].find((b) => b.textContent.trim().includes(text) && !b.disabled);
      if (el) break;
    }
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) console.log("no button", text);
  await wait(500);
};
const type = async (sel, text) => {
  await page.focus(sel);
  await page.keyboard.type(text);
};
await wait(2500);
const steps = (await import(`./scenarios/${scenario}.mjs`)).default;
await steps({ page, shot, click, wait, type, id, browser });
await browser.close();
