export default async ({ page, wait }) => {
  const days = Number(process.env.DAYS ?? 4);
  await page.evaluate(async (days) => {
    await chrome.runtime.sendMessage({ type: "ensure-engine" });
    const port = chrome.runtime.connect({ name: "zapp" });
    let n = 0;
    const waiting = new Map();
    window.__state = null;
    port.onMessage.addListener((m) => {
      if (m.event === "state") window.__state = m.state;
      if (m.id && waiting.has(m.id)) (waiting.get(m.id))(m);
    });
    const call = (action, ...args) => new Promise((res, rej) => { const id = ++n; waiting.set(id, (m) => (m.ok ? res(m.value) : rej(new Error(m.error)))); port.postMessage({ id, action, args }); });
    const phrase = await call("newPhrase");
    window.__t0 = performance.now();
    await call("addPhoneWallet", "Speed", phrase, Date.now() / 1000 - days * 86400 + 86400, "speedtest123");
  }, days);
  for (let i = 0; i < 400; i++) {
    await wait(3000);
    const s = await page.evaluate(() => ({ sync: window.__state?.sync, ms: Math.round(performance.now() - window.__t0) }));
    if (i % 5 === 0 || s.sync?.synced) console.log("t", s.ms, JSON.stringify(s.sync));
    if (s.sync?.synced && s.sync.progress >= 1) break;
  }
};
