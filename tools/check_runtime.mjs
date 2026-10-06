// Loads the film in headless Chromium and fails on any console error, page error, failed/non-local request or missing font.
//   node tools/check_runtime.mjs
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const { server, port } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'] });
let bad = 0;
for (const vertical of [false, true]) {
  const page = await browser.newPage({ viewport: vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 } });
  const problems = [], external = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => problems.push('[requestfailed] ' + r.url()));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}/src/index.html${vertical ? '?v=1' : ''}`);
  await page.evaluate(() => window.filmReady);
  const fonts = await page.evaluate(async () => {
    const need = ['900 italic 100px "Exo 2"', '800 italic 100px "Exo 2"', '500 40px "Exo 2"', '600 50px "Barlow Condensed"', '700 50px "Barlow Condensed"', '800 50px "Barlow Condensed"', '700 50px "Noto Sans SC"', '700 50px "Noto Serif SC"'];
    return need.map((f) => [f, document.fonts.check(f)]);
  });
  for (const [f, ok] of fonts) if (!ok) problems.push('[font missing] ' + f);
  // render a sample of frames across the timeline (exercises every code path once)
  await page.evaluate(() => { for (const t of [0.5, 3.3, 8.2, 11.9, 13.0, 15, 19.8, 22.9, 26, 27.8, 29, 31.6, 33.9]) window.film.renderAt(t); });
  if (external.length) problems.push('[external requests] ' + external.join(', '));
  console.log(vertical ? '9:16' : '16:9', problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'OK: no console errors/warnings, no failed or external requests, all fonts available');
  bad += problems.length; await page.close();
}
await browser.close(); server.close(); process.exit(bad ? 1 : 0);
