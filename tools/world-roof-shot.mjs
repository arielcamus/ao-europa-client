// AGPL-3.0-or-later. Real VB6 server: stand in the gap between two roofs (map 1, 75,32) and on each side, screenshot the roof layer.
// Usage: AO_WEB_PORT=5785 AO_EMAIL=.. AO_PASSWORD=.. node tools/world-roof-shot.mjs
import { launch } from './world-drive.mjs';
const { page, problems, say, close } = await launch({ email: process.env.AO_EMAIL, password: process.env.AO_PASSWORD, port: process.env.AO_WEB_PORT });
for (const [x, y] of [[75, 32], [72, 33], [77, 33]]) {
  await say(`/TELEP YO 1 ${x} ${y}`); await page.waitForTimeout(2500);
  console.log(x, y, await page.locator('#position').innerText());
  await page.screenshot({ path: `artifacts/screenshots/world-roof-${x}-${y}.png` });
}
console.log('problems', problems);
await close();
