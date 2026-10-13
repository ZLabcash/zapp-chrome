// node test/nft.mjs [outdir] — the NFTs tab in the popup: the zkSNARKs grid with real images,
// search, the detail with its traits, and Mine signed out (a fresh profile, never signed in on
// zilkroad). Also checks that Chrome sends zilkroad.com's cookies (Lax, Strict, None) with the
// extension's /api/me request, using throwaway probe cookies that are removed afterwards.
import puppeteer from "puppeteer-core";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const out = process.argv[2] ?? "shots-nft";
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "zapp-nft-"));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  enableExtensions: [resolve(import.meta.dirname, "../dist")],
  userDataDir: profile,
  protocolTimeout: 900_000,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failed++;
};

try {
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker");
  const id = new URL(sw.url()).host;
  await wait(1500);
  for (const p of await browser.pages()) if (p.url().includes("app.html")) await p.close();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const click = async (text) => {
    const ok = await page.evaluate((text) => {
      const layers = [...document.querySelectorAll("#root > div")].reverse();
      for (const l of layers) {
        const el = [...l.querySelectorAll("button, a")].find((b) => b.textContent.trim().includes(text) && !b.disabled);
        if (el) return el.click(), true;
      }
      return false;
    }, text);
    if (!ok) throw new Error(`no button "${text}"`);
    await wait(500);
  };

  // A wallet first: Home (and its tabs) shows with one.
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  await page.goto(`chrome-extension://${id}/app.html`);
  await wait(3500);
  await click("Start");
  await click("Create a new wallet");
  await wait(800);
  await click("Tap to show the words");
  const words = await page.evaluate(() => [...document.querySelectorAll(".mono.ellipsis")].map((e) => e.textContent.trim()));
  await click("I wrote them down");
  const asked = await page.evaluate(() => [...[...document.querySelectorAll("#root > div")].pop().querySelectorAll("input")].map((i) => Number(i.placeholder.replace(/\D/g, "")) - 1));
  const inputs = await page.$$("#root > div:last-of-type input");
  for (let k = 0; k < 3; k++) await inputs[k].type(words[asked[k]]);
  await click("Continue");
  await click("Continue");
  const pw = await page.$$("input[type=password]");
  await pw[0].type("correct horse 42");
  await pw[1].type("correct horse 42");
  await click("Create the wallet");
  await wait(5000);

  // Watch the /api/me requests: the Cookie header Chrome actually sends.
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const meRequests = new Map();
  cdp.on("Network.requestWillBeSent", (e) => e.request.url.startsWith("https://zilkroad.com/api/me") && meRequests.set(e.requestId, { url: e.request.url }));
  cdp.on("Network.requestWillBeSentExtraInfo", (e) => {
    const r = meRequests.get(e.requestId) ?? {};
    meRequests.set(e.requestId, { ...r, cookie: e.headers.cookie ?? e.headers.Cookie ?? "", blocked: e.associatedCookies.filter((c) => c.blockedReasons.length).map((c) => `${c.cookie.name}:${c.blockedReasons.join("+")}`) });
  });
  const zilkroadRequests = [];
  cdp.on("Network.requestWillBeSent", (e) => e.request.url.includes("zilkroad.com") && zilkroadRequests.push(e.request.url));

  // The popup, NFTs tab: Mine, signed out.
  await page.setViewport({ width: 360, height: 600, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForSelector(".hdr");
  await wait(1000);
  await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => /NFT/i.test(b.textContent)).click());
  await page.waitForSelector(".signed-out", { timeout: 15000 });
  const signedOut = await page.evaluate(() => document.querySelector(".signed-out").textContent);
  check(/Sign in on zilkroad/.test(signedOut), "Mine signed out shows “Sign in on zilkroad”");
  check(meRequests.size >= 1, "Mine asked zilkroad /api/me");
  await page.evaluate(() => document.querySelector(".scroll").scrollTo(0, 400));
  await wait(400);
  await shot("nft-1-mine-signed-out");

  // Cookies from the extension page: probe cookies of each SameSite kind, then a re-check on focus.
  for (const sameSite of ["Lax", "Strict", "None"])
    await cdp.send("Network.setCookie", { name: `zapp_probe_${sameSite.toLowerCase()}`, value: "1", url: "https://zilkroad.com/", secure: true, httpOnly: true, sameSite });
  const before = meRequests.size;
  await wait(3200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await wait(2500);
  const last = [...meRequests.values()].slice(before).pop();
  check(!!last, "focus re-checks /api/me");
  for (const k of ["lax", "strict", "none"]) check(last?.cookie?.includes(`zapp_probe_${k}=1`), `SameSite=${k} cookie sent to zilkroad from the extension`);
  if (last?.blocked?.length) console.log("blocked:", last.blocked.join(", "));
  for (const sameSite of ["lax", "strict", "none"]) await cdp.send("Network.deleteCookies", { name: `zapp_probe_${sameSite}`, url: "https://zilkroad.com/" });
  check(await page.evaluate(() => !!document.querySelector(".signed-out")), "still signed out (probe cookies aren't a session)");

  // All 10,000: real images, loaded lazily.
  await page.evaluate(() => [...document.querySelectorAll(".seg button")][1].click());
  await page.waitForSelector(".snark-tile", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll(".snark-tile img.on").length >= 6, { timeout: 30000 });
  const grid = await page.evaluate(() => ({
    tiles: document.querySelectorAll(".snark-tile").length,
    started: document.querySelectorAll(".snark-tile img").length,
    images: [...document.querySelectorAll(".snark-tile img.on")].map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight, pixelated: getComputedStyle(i).imageRendering })),
    first: document.querySelector(".snark-tile").textContent,
  }));
  check(grid.tiles === 60 && grid.first.includes("#1"), `grid shows the first page (${grid.tiles} tiles from #1)`);
  check(grid.started < grid.tiles, `images load lazily (${grid.started} of ${grid.tiles} started)`);
  check(grid.images.every((i) => i.w > 0 && i.h === i.w && i.src.startsWith("https://api.zscan.cash/v1/collections/zksnarks/items/")), `real zkSNARK images decoded (${grid.images.length}, ${grid.images[0]?.w}px)`);
  check(grid.images.every((i) => i.pixelated === "pixelated"), "image-rendering: pixelated");
  await shot("nft-2-all");
  // Scrolling to the end of the page loads the next one.
  await page.evaluate(() => {
    const s = document.querySelector(".scroll");
    s.scrollTo(0, s.scrollHeight);
  });
  await wait(1200);
  check((await page.evaluate(() => document.querySelectorAll(".snark-tile").length)) === 120, "scrolling down shows 60 more");

  // Search by number, then the detail.
  await page.evaluate(() => document.querySelector(".scroll").scrollTo(0, 0));
  await page.type(".input input", "42");
  await wait(400);
  const firstFound = await page.evaluate(() => document.querySelector(".snark-tile")?.textContent);
  check(firstFound === "#42", `search 42 puts #42 first (${firstFound})`);
  await page.evaluate(() => document.querySelector(".snark-tile").click());
  await page.waitForFunction(() => document.querySelector(".snark-big img.on") && document.querySelectorAll(".snark-detail .kv").length >= 3, { timeout: 20000 });
  const detail = await page.evaluate(() => ({
    title: document.querySelector(".snark-detail .headline").textContent,
    kv: [...document.querySelectorAll(".snark-detail .kv")].map((r) => [...r.children].map((c) => c.textContent)),
    link: [...document.querySelectorAll("a")].find((a) => /zilkroad/.test(a.textContent))?.href,
    img: document.querySelector(".snark-big img").naturalWidth,
  }));
  check(detail.title.startsWith("zkSNARKs #42"), "detail title");
  check(detail.kv.some(([k]) => k === "Rank") && detail.kv.some(([k]) => k === "Eyes") && detail.kv.some(([k]) => k === "Head"), `traits shown (${detail.kv.map((x) => x.join(": ")).join(", ")})`);
  check(detail.link === "https://zilkroad.com/#/42", "Open on zilkroad links to the item");
  check(detail.img > 0, "detail image loaded");
  await shot("nft-3-detail");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await wait(300);
  await shot("nft-4-detail-dark");
  await page.evaluate(() => document.querySelector("button[aria-label=Back]").click());
  await wait(600);
  await shot("nft-5-search-dark");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

  // zilkroad: only /api/me, never its sign-in endpoints.
  check(zilkroadRequests.every((u) => u.startsWith("https://zilkroad.com/api/me")), `only /api/me on zilkroad (${zilkroadRequests.length} requests)`);
} catch (e) {
  console.log("FAIL", e.message);
  failed++;
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
