export default async ({ page, shot, wait }) => {
  for (const lang of ["fr", "ar", "ja"]) {
    await page.evaluate(async (lang) => {
      const port = chrome.runtime.connect({ name: "zapp" });
      port.postMessage({ id: 1, action: "setSettings", args: [{ language: lang }] });
    }, lang);
    await wait(1200);
    await shot(`30-home-${lang}`);
  }
  await page.evaluate(() => document.querySelector("button[aria-label]")?.click());
};
