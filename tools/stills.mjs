// Render many stills in one browser session: node tools/stills.mjs outDir t1 t2 t3 ...
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from './serve.mjs';
const [, , dir, ...ts] = process.argv;
fs.mkdirSync(dir, { recursive: true });
const { server, port } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/src/index.html`);
await page.evaluate(() => window.filmReady);
for (const t of ts) {
  const t0 = Date.now();
  await page.evaluate((t) => window.film.renderAt(+t), t);
  await page.locator('#main').screenshot({ path: `${dir}/t${(+t).toFixed(2).padStart(6, '0')}.png` });
  console.log('t=' + t, Date.now() - t0, 'ms');
}
await browser.close(); server.close();
