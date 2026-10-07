// A small library of distinct synthetic manhua pages for the finale ("more worlds").
// Every page is original, procedural art: different panel layouts, different scenes (moonscape, figure, valley, focus-line burst,
// brand-green leaf, light ink-wash), different moods (night / light ink / green-heavy / mixed) and different bubbles.
// Each page is baked twice into two atlases — source language (zh) and rebuilt (en) — so the "translation wave" can turn the
// text of every page as it passes. No real manga, no repository fixtures.
import { rng, makeNoise, clamp, lerp, TAU, smoothstep } from '../lib/util.js';
import { mk, halftone, speckle, fog, pillar, ridge, blade, traveler, pine } from './landscape.js';

export const PG = { w: 1100, h: 2136 };
const INK = '#1B2523', PAPER = '#F7F8F7';
const EN = '"Barlow Condensed", "Arial Narrow", sans-serif';
const ZH = '"Noto Sans SC", "PingFang SC", sans-serif';

// ---------------------------------------------------------------------------------------------------
// Layouts: panel polygons in page units (1100 x 2136, ~36u gutters)
// ---------------------------------------------------------------------------------------------------
export const LAYOUTS = {
  A: [[[50, 40], [1050, 40], [1050, 800], [50, 800]], [[50, 836], [640, 836], [590, 1500], [50, 1500]], [[676, 836], [1050, 836], [1050, 1500], [626, 1500]], [[50, 1536], [1050, 1536], [1050, 2040], [50, 2096]]],
  B: [[[50, 40], [1050, 40], [1050, 640], [50, 720]], [[50, 756], [1050, 676], [1050, 1380], [50, 1380]], [[50, 1416], [1050, 1416], [1050, 2096], [50, 2096]]],
  C: [[[50, 40], [650, 40], [610, 1400], [50, 1400]], [[686, 40], [1050, 40], [1050, 500], [672, 500]], [[671, 536], [1050, 536], [1050, 1000], [658, 1000]], [[658, 1036], [1050, 1036], [1050, 1400], [646, 1400]], [[50, 1436], [1050, 1436], [1050, 2096], [50, 2096]]],
  D: [[[50, 40], [1050, 40], [1050, 1500], [50, 1500]], [[50, 1536], [560, 1536], [560, 2096], [50, 2096]], [[596, 1536], [1050, 1536], [1050, 2096], [596, 2096]]],
  E: [[[50, 40], [520, 40], [520, 640], [50, 640]], [[556, 40], [1050, 40], [1050, 640], [556, 640]], [[50, 676], [700, 676], [700, 1300], [50, 1300]], [[736, 676], [1050, 676], [1050, 1300], [736, 1300]], [[50, 1336], [400, 1336], [400, 2096], [50, 2096]], [[436, 1336], [1050, 1336], [1050, 2096], [436, 2096]]],
  F: [[[50, 40], [1050, 40], [1050, 700], [50, 1000]], [[50, 1036], [1050, 736], [1050, 1500], [50, 1500]], [[50, 1536], [1050, 1536], [1050, 2096], [50, 2096]]],
  G: [[[50, 40], [360, 40], [330, 2096], [50, 2096]], [[396, 40], [700, 40], [670, 2096], [366, 2096]], [[736, 40], [1050, 40], [1050, 2096], [706, 2096]]],
};
const bbox = (poly) => { const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; };

// ---------------------------------------------------------------------------------------------------
// Panel art
// ---------------------------------------------------------------------------------------------------
const sky = (x, W, H, light) => {
  const g = x.createLinearGradient(0, 0, 0, H);
  if (light) { g.addColorStop(0, '#f4f6f1'); g.addColorStop(0.6, '#e2e8e0'); g.addColorStop(1, '#ccd7cd'); }
  else { g.addColorStop(0, '#040807'); g.addColorStop(0.55, '#0b1613'); g.addColorStop(1, '#1b2e28'); }
  x.fillStyle = g; x.fillRect(0, 0, W, H);
};
const pitchFor = (W) => clamp(W / 90, 5, 9);
const moonDisc = (x, mx, my, mr, light, R) => {
  x.fillStyle = light ? '#7CC326' : '#eef3ec'; x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
  x.save(); x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.clip();
  for (let i = 0; i < 7; i++) { x.fillStyle = light ? `rgba(40,100,30,${R.range(0.05, 0.12)})` : `rgba(160,178,168,${R.range(0.05, 0.1)})`; x.beginPath(); x.ellipse(mx + R.range(-0.7, 0.7) * mr, my + R.range(-0.7, 0.7) * mr, R.range(0.14, 0.4) * mr, R.range(0.1, 0.26) * mr, R() * 3, 0, TAU); x.fill(); }
  x.restore();
};
const bodyFor = (light) => (light ? ['#55645e', '#93a39b'] : ['#0a1412', '#1b2c27']);

function artMoon(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), N = makeNoise(seed), U = W / 1000, light = tone === 'ink';
  sky(x, W, H, light);
  const mr = Math.min(W, H) * R.range(0.1, 0.22), mx = W * R.range(0.22, 0.78), my = H * R.range(0.15, 0.36);
  halftone(x, W, H, (px, py) => { const d = Math.hypot(px - mx, py - my) / mr; return d < 0.98 ? 0 : Math.pow(clamp(1 - (d - 0.98) / 3.2), 2) * 1.05; }, { pitch: pitchFor(W), color: light ? '#a9bbb0' : '#cfdcd4', maxR: 0.58 });
  moonDisc(x, mx, my, mr, light, R);
  ridge(x, W, H, N, { y: H * 0.66, amp: H * 0.1, scale: 3.1, seed: seed % 9 + 1, color: light ? ['#b6c2bb', '#9cada4'] : ['#344a43', '#243630'], fogColor: light ? [240, 244, 240] : [140, 175, 162], fogA: 0.6, S: U });
  ridge(x, W, H, N, { y: H * 0.74, amp: H * 0.15, scale: 2.2, seed: seed % 7 + 3, color: light ? ['#7f8f88', '#5f6f68'] : ['#25382f', '#16241f'], fogColor: light ? [236, 242, 236] : [130, 168, 154], fogA: 0.55, S: U });
  const n = R.int(2, 4);
  for (let i = 0; i < n; i++) pillar(x, N, R, W * R.range(0.08, 0.92), H * 1.02, W * R.range(0.045, 0.09), H * R.range(0.28, 0.52), { body: bodyFor(light), S: U * 1.2, rim: light ? '#ffffff' : '#8fb0a4', rimA: light ? 0.5 : 0.6, spires: R.int(2, 4) });
  fog(x, W, H, { y0: H * 0.62, y1: H * 0.98, color: light ? [242, 246, 242] : [112, 150, 138], a: 0.45, seed: seed + 1, blobs: 16, size: 0.35 });
  if (!light && R() < 0.65) blade(x, W * 1.02, H * 1.05, -2.0, H * 0.3, H * 0.06, { curve: -0.25, dark: '#0d2d12', mid: '#2f7a26', hi: '#7cc326' });
  speckle(x, W, H, 2500, { color: light ? '40,60,50' : '0,0,0', a: [0.03, 0.1], seed });
  return c;
}

function artFigure(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), N = makeNoise(seed), U = W / 1000, light = tone === 'ink';
  sky(x, W, H, light);
  const side = R() < 0.5 ? 0.86 : 0.14, mr = Math.min(W * 0.46, H * 0.32), mx = W * side, my = H * 0.3;
  halftone(x, W, H, (px, py) => { const d = Math.hypot(px - mx, py - my) / mr; return d < 0.98 ? 0 : Math.pow(clamp(1 - (d - 0.98) / 1.5), 1.8) * 1.1; }, { pitch: pitchFor(W), color: light ? '#a9bbb0' : '#cfdcd4', maxR: 0.58 });
  moonDisc(x, mx, my, mr, light, R);
  x.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const y = H * R.range(0.05, 0.9), x1 = W * R.range(0.4, 1.05), len = W * R.range(0.12, 0.5);
    const gg = x.createLinearGradient(x1, y, x1 - len, y); gg.addColorStop(0, 'rgba(190,215,205,0)'); gg.addColorStop(0.3, light ? `rgba(60,90,76,${R.range(0.05, 0.16)})` : `rgba(190,215,205,${R.range(0.05, 0.2)})`); gg.addColorStop(1, 'rgba(190,215,205,0)');
    x.strokeStyle = gg; x.lineWidth = R.range(0.8, 3) * U * 1.5; x.beginPath(); x.moveTo(x1, y); x.lineTo(x1 - len, y + R.range(-6, 6)); x.stroke();
  }
  pillar(x, N, R, W * R.range(0.15, 0.5), H * 1.02, W * 0.07, H * 0.4, { body: bodyFor(light), S: U * 1.2, rimA: 0.5 });
  fog(x, W, H, { y0: H * 0.5, y1: H * 0.85, color: light ? [242, 246, 242] : [112, 150, 138], a: 0.5, seed: seed + 2, blobs: 14, size: 0.5 });
  const gp = new Path2D(); gp.moveTo(0, H); gp.lineTo(0, H * 0.84);
  for (let i = 0; i <= 12; i++) gp.lineTo(W * (i / 12), H * (0.84 + 0.02 * N(i * 1.7, 2) + 0.03 * (i / 12)));
  gp.lineTo(W, H); gp.closePath(); x.fillStyle = light ? '#1f2a27' : '#030706'; x.fill(gp);
  traveler(x, W * R.range(0.3, 0.7), H * 0.865, Math.min(H * 0.0042, W * 0.0052), { wind: 1.8, color: light ? '#0b1210' : '#050908' });
  blade(x, W * 0.0, H * 1.04, -1.1, H * 0.25, H * 0.04, { curve: 0.2, dark: '#0d2d12', mid: '#2f7a26', hi: '#67b628' });
  speckle(x, W, H, 2500, { color: '0,0,0', a: [0.04, 0.1], seed });
  return c;
}

function artValley(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), N = makeNoise(seed), U = W / 1000;
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a1613'); g.addColorStop(0.5, '#16261f'); g.addColorStop(1, '#070e0c'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  halftone(x, W, H, (px, py) => Math.pow(clamp(1 - py / (H * 0.55)), 2.2) * 0.8, { pitch: pitchFor(W), color: '#9db8ad', maxR: 0.5, angle: Math.PI / 6 });
  [[0.28, 0.2, 5], [0.42, 0.26, 4], [0.58, 0.34, 4], [0.76, 0.46, 3]].forEach(([yb, hf, n], k) => {
    for (let i = 0; i < n; i++) pillar(x, N, R, (i + R.range(0.1, 0.9)) / n * W, H * (yb + 0.22), W * R.range(0.04, 0.09) * (1 + k * 0.4), H * hf * R.range(0.8, 1.2), { body: [k % 2 ? '#0b1614' : '#0e1b18', '#1b2e28'], S: U * 1.1, rimA: 0.35 + k * 0.08, hatch: 0.7, moss: 0.5 });
    fog(x, W, H, { y0: H * (yb + 0.04), y1: H * (yb + 0.24), color: [112, 150, 138], a: 0.5 - k * 0.04, seed: seed + k, size: 0.45, blobs: 10 });
  });
  const river = new Path2D(), pts = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push([W * (0.5 + 0.28 * Math.sin(t * 5.2 + R() * 0.3) * (0.3 + t * 0.8)), H * (0.5 + t * 0.52)]); }
  pts.forEach((p, i) => (i ? river.lineTo(p[0] - (4 + i * 0.9) * U * 3, p[1]) : river.moveTo(p[0] - 4 * U * 3, p[1])));
  pts.slice().reverse().forEach((p, i) => river.lineTo(p[0] + (4 + (30 - i) * 0.9) * U * 3, p[1]));
  river.closePath();
  const rg = x.createLinearGradient(0, H * 0.5, 0, H); rg.addColorStop(0, 'rgba(200,225,214,0)'); rg.addColorStop(1, 'rgba(200,225,214,0.55)'); x.fillStyle = rg; x.fill(river);
  const lp = pts[21], lg = x.createRadialGradient(lp[0], lp[1], 0, lp[0], lp[1], W * 0.12); lg.addColorStop(0, 'rgba(160,240,70,0.75)'); lg.addColorStop(1, 'rgba(120,200,40,0)');
  x.fillStyle = lg; x.fillRect(lp[0] - W * 0.13, lp[1] - W * 0.13, W * 0.26, W * 0.26);
  x.fillStyle = '#c8ff7a'; x.beginPath(); x.arc(lp[0], lp[1] - W * 0.01, W * 0.01, 0, TAU); x.fill();
  blade(x, W * 1.0, H * 1.05, -1.8, H * 0.3, H * 0.045, { curve: -0.2, dark: '#0d2d12', mid: '#2f7a26', hi: '#7cc326' });
  speckle(x, W, H, 2000, { color: '0,0,0', a: [0.04, 0.1], seed });
  return c;
}

function artBurst(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), U = W / 1000;
  x.fillStyle = '#060c0a'; x.fillRect(0, 0, W, H);
  const cx = W * R.range(0.15, 0.85), cy = H * 1.02, reach = Math.hypot(W, H);
  halftone(x, W, H, (px, py) => Math.pow(clamp(1 - Math.hypot(px - cx, py - cy) / (reach * 0.8)), 1.5), { pitch: pitchFor(W), color: '#8fb0a3', maxR: 0.6 });
  for (let i = 0; i < 110; i++) {
    const a = R.range(-Math.PI + 0.25, -0.25), l0 = reach * R.range(0.1, 0.4), l1 = l0 + reach * R.range(0.25, 0.7);
    x.strokeStyle = `rgba(228,238,232,${R.range(0.05, 0.38)})`; x.lineWidth = R.range(0.6, 3.4) * U * 1.6; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0); x.lineTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); x.stroke();
  }
  const n = 9;
  for (let i = 0; i < n; i++) { const t = i / (n - 1), ang = lerp(-2.7, -0.45, t) + R.range(-0.05, 0.05); blade(x, cx, cy, ang, Math.min(H, reach * 0.8) * R.range(0.55, 0.95), Math.min(W, H) * R.range(0.04, 0.08), { curve: R.range(-0.1, 0.2), dark: '#0b2410', mid: '#2f7a26', hi: i % 3 === 0 ? '#9be33a' : '#67b628', alpha: 0.96 }); }
  speckle(x, W, H, 2000, { color: '0,0,0', a: [0.04, 0.12], seed });
  return c;
}

function artFocus(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), N = makeNoise(seed), U = W / 1000, light = tone === 'ink';
  x.fillStyle = light ? '#eef2ec' : '#08110e'; x.fillRect(0, 0, W, H);
  const fx = W * R.range(0.3, 0.7), fy = H * R.range(0.35, 0.6), reach = Math.hypot(W, H);
  halftone(x, W, H, (px, py) => { const d = Math.hypot(px - fx, py - fy) / (reach * 0.6); return Math.pow(clamp(d), 1.3) * 0.9; }, { pitch: pitchFor(W) * 1.1, color: light ? '#94a79c' : '#6f8f82', maxR: 0.6, angle: Math.PI / 5 });
  for (let i = 0; i < 160; i++) {
    const a = R() * TAU, l0 = reach * R.range(0.07, 0.2), l1 = reach * R.range(0.5, 1.0), lw = R.range(0.5, 3.2) * U * 1.6;
    x.strokeStyle = i % 17 === 0 ? 'rgba(124,195,38,0.9)' : (light ? `rgba(27,37,35,${R.range(0.2, 0.7)})` : `rgba(228,238,232,${R.range(0.15, 0.6)})`);
    x.lineWidth = lw; x.lineCap = 'round'; x.beginPath(); x.moveTo(fx + Math.cos(a) * l0, fy + Math.sin(a) * l0); x.lineTo(fx + Math.cos(a) * l1, fy + Math.sin(a) * l1); x.stroke();
  }
  // a small figure at the focus
  traveler(x, fx, fy + H * 0.08, Math.min(H * 0.0016, W * 0.002), { color: light ? '#0b1210' : '#020504', wind: 1.2 });
  speckle(x, W, H, 2000, { color: '0,0,0', a: [0.04, 0.1], seed });
  return c;
}

function artLeaf(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), U = W / 1000, light = tone === 'ink';
  const g = x.createLinearGradient(0, 0, W, H);
  if (light) { g.addColorStop(0, '#eff4ea'); g.addColorStop(1, '#cfe3bd'); } else { g.addColorStop(0, '#07130c'); g.addColorStop(1, '#10321a'); }
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  halftone(x, W, H, (px, py) => Math.pow(clamp(1 - py / H), 1.6) * 0.9, { pitch: pitchFor(W), color: light ? '#a8c995' : '#2f6a31', maxR: 0.55, angle: Math.PI / 4 });
  const n = R.int(3, 5);
  for (let i = 0; i < n; i++) {
    const ang = R.range(-2.5, -0.65);
    blade(x, W * R.range(0.1, 0.9), H * R.range(0.85, 1.1), ang, Math.hypot(W, H) * R.range(0.55, 0.95), Math.min(W, H) * R.range(0.12, 0.26), { curve: R.range(-0.25, 0.25), dark: '#0b2a12', mid: '#2f7a26', hi: i % 2 ? '#9be33a' : '#67b628', alpha: 1 });
  }
  speckle(x, W, H, 2000, { color: '0,20,0', a: [0.04, 0.1], seed });
  return c;
}

function artInk(W, H, seed, tone) {
  const c = mk(W, H), x = c.getContext('2d'), R = rng(seed), N = makeNoise(seed), U = W / 1000;
  sky(x, W, H, true);
  halftone(x, W, H, (px, py) => Math.pow(clamp(1 - py / (H * 0.5)), 2) * 0.55, { pitch: pitchFor(W), color: '#aebdb4', maxR: 0.5, angle: Math.PI / 6 });
  const sun = [W * R.range(0.25, 0.75), H * R.range(0.16, 0.3), Math.min(W, H) * R.range(0.07, 0.13)];
  x.fillStyle = '#7CC326'; x.beginPath(); x.arc(...sun, 0, TAU); x.fill();
  const tones = [['#c3cec7', '#aab8b0'], ['#9eaca4', '#7f8f87'], ['#6f7f77', '#55655d'], ['#3f4d47', '#2b3733']];
  tones.forEach((tc, i) => {
    ridge(x, W, H, N, { y: H * (0.5 + i * 0.1), amp: H * (0.12 + i * 0.04), scale: 2 + i * 0.8, seed: seed % 11 + i * 2, color: tc, fogColor: [244, 247, 243], fogA: 0.7 - i * 0.12, S: U });
    fog(x, W, H, { y0: H * (0.52 + i * 0.1), y1: H * (0.66 + i * 0.1), color: [246, 249, 245], a: 0.5 - i * 0.07, seed: seed + i, blobs: 8, size: 0.4 });
  });
  for (let i = 0; i < 3; i++) pillar(x, N, R, W * R.range(0.1, 0.9), H * 1.03, W * R.range(0.05, 0.1), H * R.range(0.28, 0.5), { body: ['#38443f', '#7b8a83'], S: U * 1.2, rim: '#ffffff', rimA: 0.55 });
  fog(x, W, H, { y0: H * 0.72, y1: H, color: [246, 249, 245], a: 0.55, seed: seed + 9, blobs: 12, size: 0.45 });
  for (let i = 0; i < 3; i++) pine(x, R, W * R.range(0.05, 0.95), H * R.range(0.9, 1.0), H * R.range(0.1, 0.2), '#1c2723');
  speckle(x, W, H, 2500, { color: '30,50,42', a: [0.03, 0.1], seed });
  return c;
}

const ART = { moon: artMoon, figure: artFigure, valley: artValley, burst: artBurst, focus: artFocus, leaf: artLeaf, ink: artInk };
const MOODS = {
  night: [['moon', 5], ['figure', 3], ['valley', 2], ['focus', 1.5], ['burst', 1.5], ['leaf', 1]],
  ink: [['ink', 6], ['moon', 1.2], ['figure', 1], ['leaf', 1.2], ['focus', 1]],
  green: [['leaf', 4], ['burst', 3.5], ['focus', 1.5], ['moon', 2], ['valley', 1]],
};
function pickKind(R, mood, used = new Set()) {
  let tbl = MOODS[mood] ?? MOODS.night;
  const fresh = tbl.filter(([k]) => !used.has(k)); if (fresh.length) tbl = fresh;          // vary the scenes within a page
  const tot = tbl.reduce((s, e) => s + e[1], 0); let r = R() * tot;
  for (const [k, w] of tbl) { r -= w; if (r <= 0) return k; }
  return tbl[0][0];
}

// ---------------------------------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------------------------------
export const PHRASES = [
  { zh: '等等！', en: 'WAIT!', k: 'burst' }, { zh: '你是谁？', en: 'WHO ARE YOU?' }, { zh: '河水记得一切。', en: 'THE RIVER REMEMBERS EVERYTHING.' },
  { zh: '回不去了。', en: 'THERE IS NO GOING BACK.' }, { zh: '我来晚了。', en: "I'M TOO LATE." }, { zh: '别回头。', en: "DON'T LOOK BACK." },
  { zh: '月落之前。', en: 'BEFORE THE MOON SETS.' }, { zh: '又见面了。', en: 'WE MEET AGAIN.' }, { zh: '山那边有人。', en: "SOMEONE'S OUT THERE." },
  { zh: '出发吧！', en: "LET'S GO!", k: 'burst' }, { zh: '这不是梦。', en: 'THIS IS NO DREAM.' }, { zh: '终于到了。', en: 'WE MADE IT AT LAST.' },
  { zh: '听，风来了。', en: 'LISTEN. THE WIND IS COMING.' }, { zh: '快跑！', en: 'RUN!', k: 'burst' }, { zh: '这条路通向哪里？', en: 'WHERE DOES THIS ROAD LEAD?' },
  { zh: '故事才刚开始。', en: 'THE STORY HAS JUST BEGUN.' },
  { zh: '谁在那里？', en: 'WHO GOES THERE?' }, { zh: '请等我。', en: 'PLEASE WAIT FOR ME.' }, { zh: '天亮了。', en: 'IT IS DAWN.' },
  { zh: '我们赢了！', en: 'WE WON!', k: 'burst' }, { zh: '这是什么声音？', en: 'WHAT IS THAT SOUND?' }, { zh: '一切都变了。', en: 'EVERYTHING HAS CHANGED.' },
  { zh: '再走一步。', en: 'ONE MORE STEP.' }, { zh: '我听见了。', en: 'I HEAR IT.' },
];
export const ZH_ALL = [...new Set(PHRASES.map((p) => p.zh).join(''))].join('');

function wrapEn(text, max = 15) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}
function wrapZh(text, max = 6) { const out = []; for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max)); return out; }

/** geometry is computed from the English metrics, so both languages share the same bubble shape */
function layoutBubble(ctx, ph, cx, cy, scale, R) {
  const lines = wrapEn(ph.en);
  ctx.font = `600 54px ${EN}`;
  const lw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = (lw + 76) * scale, h = (lines.length * 58 + 56) * scale;
  const side = R() < 0.5 ? -1 : 1;
  return { ph, cx, cy, w, h, scale, lines, zhLines: wrapZh(ph.zh, ph.zh.length > 6 ? Math.ceil(ph.zh.length / 2) : 6), kind: ph.k ?? (R() < 0.18 ? 'caption' : 'speech'), side, seed: R.int(1, 999) };
}
function bubblePath(b) {
  const p = new Path2D(), x = b.cx - b.w / 2, y = b.cy - b.h / 2, w = b.w, h = b.h;
  if (b.kind === 'caption') { p.rect(x, y, w, h); return p; }
  if (b.kind === 'burst') {
    const n = 18, N = makeNoise(b.seed);
    for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU, sp = i % 2 ? 0.9 : 1.04, wob = 1 + N(Math.cos(a) * 2 + 3, Math.sin(a) * 2) * 0.05; const px = b.cx + Math.cos(a) * (w / 2) * sp * wob * 1.12, py = b.cy + Math.sin(a) * (h / 2) * sp * wob * 1.12; i ? p.lineTo(px, py) : p.moveTo(px, py); }
    p.closePath(); return p;
  }
  const r = Math.min(h / 2, 78 * b.scale), tx = b.cx + b.side * w * 0.28, ty = y + h + 52 * b.scale;
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.arc(x + w - r, y + r, r, -Math.PI / 2, 0); p.lineTo(x + w, y + h - r); p.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  if (b.side > 0) { p.lineTo(tx + 30 * b.scale, y + h); p.lineTo(tx + 26 * b.scale, ty); p.lineTo(tx - 20 * b.scale, y + h); }
  p.lineTo(x + r, y + h); p.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  if (b.side < 0) { /* tail on the left edge region */ }
  p.lineTo(x, y + r); p.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); p.closePath();
  if (b.side < 0) { p.moveTo(tx - 30 * b.scale, y + h - 2); p.lineTo(tx - 26 * b.scale, ty); p.lineTo(tx + 20 * b.scale, y + h - 2); p.closePath(); }
  return p;
}
function drawBubble(ctx, b, lang) {
  const path = bubblePath(b);
  ctx.save(); ctx.lineJoin = 'round';
  ctx.fillStyle = PAPER; ctx.fill(path); ctx.strokeStyle = INK; ctx.lineWidth = 5.5 * b.scale; ctx.stroke(path);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const lines = lang === 'en' ? b.lines : b.zhLines, sz = (lang === 'en' ? 54 : 50) * b.scale, lh = (lang === 'en' ? 58 : 60) * b.scale;
  ctx.font = lang === 'en' ? `600 ${sz}px ${EN}` : `700 ${sz}px ${ZH}`;
  if (lang === 'en' && 'letterSpacing' in ctx) ctx.letterSpacing = `${1.2 * b.scale}px`;
  lines.forEach((l, i) => ctx.fillText(l, b.cx, b.cy + (i - (lines.length - 1) / 2) * lh + sz * 0.34));
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------
export const SPECS = [
  { layout: 'B', mood: 'night' }, { layout: 'C', mood: 'mixed' }, { layout: 'E', mood: 'ink' }, { layout: 'F', mood: 'night' },
  { layout: 'D', mood: 'green' }, { layout: 'G', mood: 'night' }, { layout: 'A', mood: 'ink' }, { layout: 'E', mood: 'mixed' },
  { layout: 'B', mood: 'green' }, { layout: 'C', mood: 'night' }, { layout: 'F', mood: 'ink' }, { layout: 'D', mood: 'mixed' },
  // v1.2: ten more, so the library has ~5 uses per page instead of ~9
  { layout: 'A', mood: 'green' }, { layout: 'G', mood: 'ink' }, { layout: 'F', mood: 'mixed' }, { layout: 'E', mood: 'night' }, { layout: 'B', mood: 'ink' },
  { layout: 'D', mood: 'night' }, { layout: 'C', mood: 'green' }, { layout: 'G', mood: 'mixed' }, { layout: 'A', mood: 'night' }, { layout: 'F', mood: 'green' },
];

function renderPageBase(spec, i, S) {
  const R = rng(1000 + i * 77), TW = Math.round(PG.w * S), TH = Math.round(PG.h * S);
  const c = mk(TW, TH), x = c.getContext('2d');
  x.scale(S, S);
  x.fillStyle = PAPER; x.fillRect(0, 0, PG.w, PG.h);
  x.lineCap = 'round';
  for (let k = 0; k < 1800; k++) { x.strokeStyle = `rgba(120,130,120,${R.range(0.015, 0.05)})`; x.lineWidth = R.range(0.3, 0.9); const px = R() * PG.w, py = R() * PG.h, a = R() * TAU, l = R.range(3, 14); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  const polys = LAYOUTS[spec.layout], panels = [], usedKinds = new Set();
  polys.forEach((poly, pi) => {
    const bb = bbox(poly), mood = spec.mood === 'mixed' ? (pi % 3 === 1 ? 'ink' : 'night') : spec.mood;
    const kind = pickKind(R, mood, usedKinds), tone = mood === 'ink' ? 'ink' : 'night';
    usedKinds.add(kind);
    const art = ART[kind](Math.round(bb[2] * S), Math.round(bb[3] * S), 100 + i * 31 + pi * 7, tone);
    x.save(); x.beginPath(); poly.forEach(([px, py], k) => (k ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.clip();
    x.drawImage(art, bb[0], bb[1], bb[2], bb[3]); x.restore();
    x.lineJoin = 'miter'; x.miterLimit = 6; x.strokeStyle = INK; x.lineWidth = 5;
    x.beginPath(); poly.forEach(([px, py], k) => (k ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.stroke();
    panels.push({ bb, mood, kind });
  });
  // bubbles: 2-4 per page, in different panels, never overlapping the page edge
  const nB = R.int(2, 4), used = new Set(), bubbles = [], phr = [...PHRASES];
  for (let k = 0; k < nB; k++) {
    let pi = R.int(0, panels.length - 1), guard = 0; while (used.has(pi) && guard++ < 8) pi = R.int(0, panels.length - 1);
    used.add(pi);
    const bb = panels[pi].bb, ph = phr.splice(R.int(0, phr.length - 1), 1)[0];
    const sc = clamp(Math.min(bb[2] / 560, 1.15) * R.range(0.8, 1.05), 0.5, 1.1);
    const b = layoutBubble(x, ph, 0, 0, sc, R);
    b.cx = clamp(bb[0] + bb[2] * R.range(0.28, 0.72), bb[0] + b.w / 2 + 18, bb[0] + bb[2] - b.w / 2 - 18);
    b.cy = clamp(bb[1] + bb[3] * R.range(0.14, 0.34), bb[1] + b.h / 2 + 18, bb[1] + bb[3] - b.h / 2 - 70);
    if (bb[2] < b.w + 40) continue;
    if (bubbles.some((o) => Math.abs(o.cx - b.cx) < (o.w + b.w) / 2 + 30 && Math.abs(o.cy - b.cy) < (o.h + b.h) / 2 + 90)) continue;     // never let two bubbles collide
    bubbles.push(b);
  }
  return { c, bubbles, panels };
}

/** Bake the whole library into two atlases (zh / en). Returns canvases + metadata. */
export function bakeLibrary({ S = 0.7, cols = 5, gutter = 8 } = {}) {
  const TW = Math.round(PG.w * S), TH = Math.round(PG.h * S), rows = Math.ceil(SPECS.length / cols);
  const W = cols * (TW + gutter), H = rows * (TH + gutter);
  const atlas = { zh: mk(W, H), en: mk(W, H) };
  const ctxs = { zh: atlas.zh.getContext('2d'), en: atlas.en.getContext('2d') };
  for (const l of ['zh', 'en']) { ctxs[l].fillStyle = PAPER; ctxs[l].fillRect(0, 0, W, H); }
  const pages = [];
  SPECS.forEach((spec, i) => {
    const base = renderPageBase(spec, i, S), col = i % cols, row = Math.floor(i / cols), ox = col * (TW + gutter), oy = row * (TH + gutter);
    for (const lang of ['zh', 'en']) {
      const x = ctxs[lang];
      x.save(); x.translate(ox, oy); x.drawImage(base.c, 0, 0);
      x.scale(S, S); base.bubbles.forEach((b) => drawBubble(x, b, lang));
      x.restore();
    }
    const px = base.c.getContext('2d').getImageData(0, 0, TW, TH).data; let sum = 0, n = 0;
    for (let k = 0; k < px.length; k += 4 * 97) { sum += px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11; n++; }
    pages.push({ slot: i, layout: spec.layout, mood: spec.mood, luma: +(sum / n / 255).toFixed(3), kinds: base.panels.map((p) => p.kind), bubbles: base.bubbles.map((b) => b.ph.en) });
  });
  return { atlas, meta: { S, cols, rows, gutter, tw: TW, th: TH, W, H, pages } };
}
