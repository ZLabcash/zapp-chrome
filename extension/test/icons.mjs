// Renders ZApp's shield mark (the bold rounded Z, as the app icon) to transparent PNGs, so the
// toolbar icon matches the app: Z in ink on a light toolbar, white on a dark one.
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage();
for (const [variant, ink] of [["", "#212529"], ["-dark", "#ffffff"]]) {
  for (const size of [16, 32, 48, 128]) {
    await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const small = size <= 16;
    await p.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="M16 2.6 27.6 7.1v8.5c0 7-4.8 11.9-11.6 13.9C9.2 27.5 4.4 22.6 4.4 15.6V7.1L16 2.6Z" stroke="#f4b728" stroke-width="${small ? 2.8 : 2.4}"/>
<path d="M11 11.2h10L11 20.8h10" stroke="${ink}" stroke-width="${small ? 3.4 : 3.1}"/>
${small ? "" : '<path d="M7.6 16h16.8" stroke="#1baf7a" stroke-width="1.4" stroke-dasharray="2.4 2.4" opacity=".9" stroke-linecap="butt"/>'}
</svg></body></html>`);
    await p.screenshot({ path: `public/icons/icon${size}${variant}.png`, omitBackground: true });
  }
}
await b.close();
console.log("icons rendered");
