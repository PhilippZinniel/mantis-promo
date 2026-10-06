// Bakes the procedural manhua art (src/art/*) into build/art/*.png using headless Chromium.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from './serve.mjs';
const which = process.argv.slice(2);
const names = which.length ? which : ['vista'];
fs.mkdirSync('build/art', { recursive: true });
const { server, port } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/src/art/art.html`);
await page.waitForFunction(() => window.ready);
for (const n of names) {
  const t0 = Date.now();
  const res = await page.evaluate((n) => window.bake(n), n);
  for (const [k, v] of Object.entries(res)) {
    if (k === 'meta') { fs.writeFileSync(`build/art/${n}.json`, JSON.stringify(v, null, 1)); continue; }
    fs.writeFileSync(`build/art/${n}_${k}.png`, Buffer.from(v.split(',')[1], 'base64'));
  }
  console.log('baked', n, Object.keys(res).join(','), Date.now() - t0, 'ms');
}
await browser.close(); server.close();
