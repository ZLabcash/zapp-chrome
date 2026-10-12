// A real click on "Open in side panel" opens sidepanel.html, which becomes the Flipper host.
export default async ({ page, wait, browser }) => {
  await page.waitForSelector(".hdr, input[type=password]");
  if (await page.$("input[type=password]")) {
    await page.type("input[type=password]", "correct horse 42");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".hdr");
  }
  await wait(800);
  await page.click("button[aria-label=Menu]");
  await wait(400);
  const [btn] = await page.$$("xpath/.//button[contains(., 'side panel') or contains(., 'latéral')]");
  await btn.click();
  await wait(2500);
  console.log("panel targets:", browser.targets().filter((t) => t.url().includes("sidepanel")).length);
};
