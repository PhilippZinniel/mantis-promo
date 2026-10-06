// Deterministic frame renderer (add --vertical for the native 1080x1920 recomposition):  node tools/render.mjs [--from 0] [--to 1920] [--workers 4] [--out build/video.mp4] [--crf 14]
//                                node tools/render.mjs --poster 31.2 output/mantis_promo_poster.png
// Each worker owns a headless Chromium page and encodes its contiguous frame range straight into an H.264 chunk;
// chunks are then concatenated with stream copy (so the film is encoded exactly once).
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const FPS = 60;
const cues = JSON.parse(fs.readFileSync('src/cues.json', 'utf8'));
const TOTAL = Math.round(cues.duration * FPS);
const VERT = args.includes('--vertical');
const SIZE = VERT ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const LAUNCH = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/src/index.html${VERT ? '?v=1' : ''}`);
  await page.evaluate(() => window.filmReady);
  return page;
}
const grab = (page, t) => page.evaluate((t) => {
  const f = window.film;
  f.renderAt(t, { samples: f.motionSamples(t) });
  return f.canvas.toDataURL('image/png');
}, t);

const { server, port } = await serve();
const browser = await chromium.launch({ args: LAUNCH });

if (args.includes('--poster')) {
  const i = args.indexOf('--poster'); const t = parseFloat(args[i + 1]); const out = args[i + 2];
  const page = await openPage(browser, port);
  const url = await grab(page, t);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('poster', out);
  await browser.close(); server.close(); process.exit(0);
}

const from = +opt('from', 0), to = Math.min(+opt('to', TOTAL), TOTAL), W = +opt('workers', 4), crf = opt('crf', '14');
const outFile = opt('out', 'build/video.mp4');
const hashFile = opt('hash', null);          // --hash build/hashes.txt : sha1 of every rendered PNG frame (determinism check)
const hashes = new Map();
const dumpDir = opt('dump', null);           // --dump dir : also write every rendered frame as PNG (debugging / determinism analysis)
if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });
const chunkDir = 'build/chunks'; fs.rmSync(chunkDir, { recursive: true, force: true }); fs.mkdirSync(chunkDir, { recursive: true });
const per = Math.ceil((to - from) / W);
const t0 = Date.now(); let done = 0;

const worker = async (k) => {
  const a = from + k * per, b = Math.min(to, a + per);
  if (a >= b) return null;
  const page = await openPage(browser, port);
  const file = `${chunkDir}/c${String(k).padStart(2, '0')}.mp4`;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-profile:v', 'high',
    '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-bf', '3', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((res) => ff.on('close', res));
  for (let f = a; f < b; f++) {
    const url = await grab(page, f / FPS);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    if (dumpDir) fs.writeFileSync(`${dumpDir}/${String(f).padStart(5, '0')}.png`, buf);
    if (hashFile) hashes.set(f, crypto.createHash('sha1').update(buf).digest('hex'));
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    done++;
    if (done % 30 === 0) { const el = (Date.now() - t0) / 1000; console.log(`frame ${done}/${to - from}  ${el.toFixed(0)}s  eta ${(el / done * (to - from - done)).toFixed(0)}s`); }
  }
  ff.stdin.end(); await closed; await page.close();
  return file;
};
const files = (await Promise.all(Array.from({ length: W }, (_, k) => worker(k)))).filter(Boolean);
await browser.close(); server.close();
if (hashFile) fs.writeFileSync(hashFile, [...hashes.entries()].sort((a, b) => a[0] - b[0]).map(([f, h]) => `${f} ${h}`).join('\n') + '\n');
fs.writeFileSync(`${chunkDir}/list.txt`, files.map((f) => `file '${path.resolve(f)}'`).join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${chunkDir}/list.txt`, '-c', 'copy', outFile]);
console.log('video', outFile, ((Date.now() - t0) / 1000).toFixed(0) + 's');
