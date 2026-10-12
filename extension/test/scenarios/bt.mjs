export default async ({ browser }) => {
  const cdp = await browser.target().createCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets");
  const off = targetInfos.find((t) => t.url.includes("offscreen.html"));
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: off.targetId, flatten: true });
  const s = cdp.connection().session(sessionId);
  const r = await s.send("Runtime.evaluate", { expression: "JSON.stringify({bt: 'bluetooth' in navigator, getDevices: !!navigator.bluetooth?.getDevices, avail: null})", returnByValue: true });
  console.log("offscreen", r.result.value);
  const r2 = await s.send("Runtime.evaluate", { expression: "navigator.bluetooth.getDevices().then(d=>'devices '+d.length).catch(e=>'err '+e)", awaitPromise: true, returnByValue: true });
  console.log("offscreen getDevices", r2.result.value);
};
