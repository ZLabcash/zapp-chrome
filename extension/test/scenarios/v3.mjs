export default async ({ page, shot, click, wait, id }) => {
  // Onboard in the full page.
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

  // Popup.
  await page.setViewport({ width: 360, height: 600, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForSelector(".hdr");
  await wait(1500);
  await shot("50-home");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await wait(400);
  await shot("51-home-dark");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.click("button[aria-label=Menu]");
  await wait(500);
  await shot("52-drawer");
  await page.mouse.click(30, 300);
  await wait(400);
  // NFT tab
  await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => /NFT/i.test(b.textContent)).click());
  await wait(400);
  await shot("53-nft");
  await page.evaluate(() => [...document.querySelectorAll(".tab")][0].click());
  await click("Receive");
  await wait(1000);
  await shot("54-receive");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /New address/i.test(b.textContent))?.click());
  await wait(150);
  await shot("55-receive-busy");
  await wait(2500);
  await shot("56-receive-after");
};
