export default async ({ page, shot, wait, id }) => {
  await page.evaluate(() => {
    const port = chrome.runtime.connect({ name: "zapp" });
    port.postMessage({ id: 1, action: "setSettings", args: [{ language: "en", appearance: 0 }] });
  });
  await page.setViewport({ width: 1100, height: 860, deviceScaleFactor: 1 });
  await page.goto(`chrome-extension://${id}/app.html#pair`);
  await page.bringToFront();
  await wait(3500);
  await shot("40-app-pair");
};
