export default async ({ page }) => {
  const r = await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: "ensure-engine" });
    const port = chrome.runtime.connect({ name: "zapp" });
    return new Promise((res) => {
      port.onMessage.addListener((m) => m.id === 1 && res(m));
      port.postMessage({ id: 1, action: "proveSelftest", args: [] });
    });
  });
  console.log("selftest", JSON.stringify(r));
};
