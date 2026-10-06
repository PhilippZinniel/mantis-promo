// 2D motion-graphics primitives drawn on top of / between world renders.
import { clamp, lerp, smoothstep, ease, TAU, PAL, rng, prog } from './lib/util.js';

const GREEN = PAL.green, GREEN_HI = '#9BE33A', INK = PAL.ink;

// ---------------------------------------------------------------------------------------------------
// Catmull-Rom spline sampling
// ---------------------------------------------------------------------------------------------------
export function spline(pts, n = 80) {
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const segs = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * segs, s = Math.min(Math.floor(f), segs - 1), t = f - s;
    const [p0, p1, p2, p3] = [P[s], P[s + 1], P[s + 2], P[s + 3]];
    const q = (k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    out.push([q(0), q(1), (p1[2] ?? 0) * (1 - t) + (p2[2] ?? 0) * t]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Blade-corner brackets ("reading marks") — tapered slashes rather than HUD frames
// ---------------------------------------------------------------------------------------------------
/**
 * rect in page units [x,y,w,h]; k: 0..1 snap-in progress (1 = settled); out: 0..1 fade out; hl: pulse 0..1
 */
export function brackets(ctx, world, rect, { k = 1, out = 0, pad = 16, pulse = 0, z = 0.1, color = GREEN, dark = false } = {}) {
  if (k <= 0 || out >= 1) return;
  const [x, y, w, h] = rect;
  const e = ease.outExpo(clamp(k));
  const grow = (1 - e) * 46 + pulse * 6;              // corners start far out, snap in
  const rot = (1 - e) * 0.12;
  const X0 = x - pad - grow, Y0 = y - pad - grow, X1 = x + w + pad + grow, Y1 = y + h + pad + grow;
  const corners = [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X1, Y1, -1, -1], [X0, Y1, 1, -1]];
  const L = clamp(Math.min(w, h) * 0.34, 40, 78);
  const T = 15;
  ctx.save();
  ctx.globalAlpha = clamp(k * 2.5) * (1 - out);
  ctx.lineJoin = 'miter';
  const P = (u, v) => world.project(u, v, z);
  for (const [cx, cy, sx, sy] of corners) {
    // two blades per corner: along x and along y, each a long thin triangle thick at the corner
    const m = (L * T) / (L + T);
    const base = P(cx, cy), ax = P(cx + sx * L, cy), ay = P(cx, cy + sy * L), inn = P(cx + sx * m, cy + sy * m);
    const g = ctx.createLinearGradient(base.x, base.y, inn.x, inn.y);
    g.addColorStop(0, GREEN_HI); g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(124,195,38,0.85)'; ctx.shadowBlur = 14 + pulse * 22;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y); ctx.lineTo(ax.x, ax.y); ctx.lineTo(inn.x, inn.y); ctx.lineTo(ay.x, ay.y); ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------
// Context thread — a tapering brush ribbon between regions
// ---------------------------------------------------------------------------------------------------
/**
 * pts: page-space control points [u,v,(z)]; draw: 0..1 how much of it exists; tail: 0..1 where the trail starts
 * pulse: position (0..1) of a bright travelling highlight, or -1
 */
export function thread(ctx, world, pts, { draw = 1, tail = 0, width = 9, pulse = -1, pulseW = 0.1, alpha = 1, color = GREEN, glow = 1, n = 140 } = {}) {
  if (draw <= 0.001) return;
  const S = spline(pts, n).map((p) => { const q = world.project(p[0], p[1], p[2] ?? 0.12); return { x: q.x, y: q.y, behind: q.behind }; });
  const i0 = Math.floor(tail * n), i1 = Math.floor(draw * n);
  if (i1 - i0 < 2) return;
  // local scale: pixels per world unit (so width follows perspective)
  const a = world.project(pts[0][0], pts[0][1], 0), b = world.project(pts[0][0] + 100, pts[0][1], 0);
  const ppu = Math.hypot(b.x - a.x, b.y - a.y) / 100;
  const left = [], right = [];
  for (let i = i0; i <= i1; i++) {
    const p = S[i], q = S[Math.min(i + 1, n)], r = S[Math.max(i - 1, 0)];
    let dx = q.x - r.x, dy = q.y - r.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const u = (i - i0) / Math.max(1, i1 - i0);
    const taper = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.55) * (0.35 + 0.65 * Math.min(1, u * 2.4 + 0.15));   // thin at both ends, heavier near the head
    const wpx = Math.max(width * ppu, 4.2) * 0.5 * Math.max(0.06, taper) * (1 + 0.12 * Math.sin(i * 0.7));
    left.push([p.x - dy * wpx, p.y + dx * wpx]); right.push([p.x + dy * wpx, p.y - dx * wpx]);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(124,195,38,0.9)'; ctx.shadowBlur = 18 * glow;
  const g = ctx.createLinearGradient(S[i0].x, S[i0].y, S[i1].x, S[i1].y);
  g.addColorStop(0, 'rgba(109,186,44,0.15)'); g.addColorStop(0.35, color); g.addColorStop(1, GREEN_HI);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(...left[0]); left.forEach((p) => ctx.lineTo(...p)); for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(...right[i]); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // travelling pulse
  if (pulse >= 0) {
    const pc = Math.floor(pulse * n), pw = Math.floor(pulseW * n);
    ctx.strokeStyle = 'rgba(235,255,200,0.95)'; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(200,255,120,1)'; ctx.shadowBlur = 22;
    ctx.lineWidth = Math.max(2, width * ppu * 0.32);
    ctx.beginPath();
    let started = false;
    for (let i = Math.max(i0, pc - pw); i <= Math.min(i1, pc + pw); i++) { if (!started) { ctx.moveTo(S[i].x, S[i].y); started = true; } else ctx.lineTo(S[i].x, S[i].y); }
    ctx.stroke();
  }
  ctx.restore();
  return S[i1];
}

// ---------------------------------------------------------------------------------------------------
// Slash geometry
// ---------------------------------------------------------------------------------------------------
/** line through (cx,cy) at angle a; returns half-plane polygons covering the 1920x1080 frame */
export function halfPlanes(W, H, cx, cy, a, off = 0) {
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, B = 4000;
  const ox = cx + nx * off, oy = cy + ny * off;
  const A = [ox - dx * B, oy - dy * B], Bp = [ox + dx * B, oy + dy * B];
  const pos = [A, Bp, [Bp[0] + nx * B, Bp[1] + ny * B], [A[0] + nx * B, A[1] + ny * B]];
  const neg = [A, Bp, [Bp[0] - nx * B, Bp[1] - ny * B], [A[0] - nx * B, A[1] - ny * B]];
  return { pos, neg, n: [nx, ny], d: [dx, dy] };
}
export function polyPath(pts) { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; }

/** A tapered blade streak (the Mantis "slash") from a to b with thickness w at its heaviest point. */
export function blade(ctx, a, b, w, { color = GREEN, hi = GREEN_HI, glow = 30, alpha = 1, head = 0.7 } = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const hx = a[0] + dx * head, hy = a[1] + dy * head;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(124,195,38,0.9)'; ctx.shadowBlur = glow;
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, 'rgba(109,186,44,0)'); g.addColorStop(head, hi); g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(hx + nx * w * 0.5, hy + ny * w * 0.5);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(hx - nx * w * 0.5, hy - ny * w * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------
// Post: grain, vignette, bloom
// ---------------------------------------------------------------------------------------------------
let grainTile = null;
function makeGrain() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  const id = x.createImageData(512, 512); const R = rng(1234);
  for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (R() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  x.putImageData(id, 0, 0); return c;
}
export function grain(ctx, W, H, frame, amt = 0.06) {
  if (!grainTile) grainTile = makeGrain();
  const R = rng(frame * 7919 + 13);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = amt * 2.2;
  const ox = Math.floor(R() * 512), oy = Math.floor(R() * 512);
  for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) ctx.drawImage(grainTile, x, y);
  ctx.restore();
}
export function vignette(ctx, W, H, a = 0.5, inner = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * inner, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(4,8,7,0)'); g.addColorStop(1, `rgba(4,8,7,${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
let bloomBuf = null;
export function bloom(ctx, W, H, { amt = 0.35, blur = 28, threshold = 0.0 } = {}) {
  if (!bloomBuf) { bloomBuf = document.createElement('canvas'); bloomBuf.width = W / 2; bloomBuf.height = H / 2; }
  const b = bloomBuf.getContext('2d');
  // thresholded: contrast around mid-grey drops the darks to black so only bright things glow (no milky black lift)
  b.globalCompositeOperation = 'copy'; b.filter = `blur(${blur / 2}px) brightness(0.9) contrast(2.1) saturate(1.2)`;
  b.drawImage(ctx.canvas, 0, 0, W / 2, H / 2); b.filter = 'none';
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = amt; ctx.drawImage(bloomBuf, 0, 0, W, H); ctx.restore();
}

// ---------------------------------------------------------------------------------------------------
// Kinetic type: slanted-wipe reveal / exit with a slide
// ---------------------------------------------------------------------------------------------------
/**
 * Draws a line of display type that is revealed by a slanted wipe (left→right) and exits by a second wipe.
 * (x, y) is the left baseline. reveal/out in 0..1.
 */
export function slicedText(ctx, text, x, y, { size = 150, color = '#F7F8F7', reveal = 1, out = 0, slide = 46, font, slant = 0.36, track = -3, shadow = true } = {}) {
  if (reveal <= 0 || out >= 1) return null;
  ctx.save();
  ctx.font = font ?? `900 italic ${size}px "Exo 2"`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${track}px`;
  const tw = ctx.measureText(text).width;
  const top = y - size * 1.05, bot = y + size * 0.3, s = (bot - top) * slant;
  const e = ease.outQuart(reveal), eo = ease.inOutCubic(out);
  const xr = lerp(x - 90, x + tw + 120, e), xl = lerp(x - 160, x + tw + 160, eo);
  ctx.beginPath(); ctx.moveTo(xl, top); ctx.lineTo(xr, top); ctx.lineTo(xr - s, bot); ctx.lineTo(xl - s, bot); ctx.closePath(); ctx.clip();
  ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6; }
  ctx.fillText(text, x, y + (1 - e) * slide - eo * -20);
  ctx.restore();
  return { w: tw };
}

/** A dry-brush stroke made of bristles (after the brush underline in the Mantis notice page). */
export function brushStroke(ctx, x0, y0, x1, y1, { width = 26, k = 1, color = PAL.green, seed = 3, bend = -10 } = {}) {
  if (k <= 0) return;
  const R = rng(seed), nB = 22;
  const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny); const ux = nx / nl, uy = ny / nl;
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = color;
  ctx.shadowColor = 'rgba(124,195,38,0.5)'; ctx.shadowBlur = 8;
  for (let i = 0; i < nB; i++) {
    const off = ((i + 0.5) / nB - 0.5) * width * (0.8 + R() * 0.4);
    const s0 = R() * 0.06, s1 = 0.78 + R() * 0.22 - Math.abs(off / width) * 0.35;
    const kk = clamp(k) * 1.0;
    const tEnd = Math.min(s1, lerp(s0, 1, kk) * (s1 / 1)), steps = 24;
    ctx.globalAlpha = 0.45 + R() * 0.5; ctx.lineWidth = (width / nB) * (1.5 + R() * 1.4);
    ctx.beginPath();
    for (let j = 0; j <= steps; j++) {
      const t = lerp(s0, tEnd, j / steps);
      const px = lerp(x0, x1, t) + ux * off, py = lerp(y0, y1, t) + uy * off + Math.sin(t * Math.PI) * bend + (R() - 0.5) * 0.7;
      if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** diagonal blade wipe from scene A to scene B (B revealed behind the sweeping blade) */
export function bladeWipe(ctx, A, B, k, W, H) {
  const ang = -1.08, cx = W / 2, cy = H / 2;
  const e = ease.inOutCubic(clamp(k)), o = lerp(-1500, 1500, e);
  const hp = halfPlanes(W, H, cx, cy, ang, o);
  ctx.drawImage(A, 0, 0);
  ctx.save(); ctx.clip(polyPath(hp.neg)); ctx.drawImage(B, 0, 0); ctx.restore();
  // the blade: lens-shaped, crisp on the leading edge, fading glow behind
  const [nx, ny] = hp.n;
  ctx.save();
  ctx.translate(cx + nx * o, cy + ny * o); ctx.rotate(ang);
  const L = 1900, wMax = 170 * Math.sin(Math.PI * clamp(k)) ** 0.6 + 30;
  const g = ctx.createLinearGradient(0, -wMax, 0, wMax);
  g.addColorStop(0, 'rgba(240,255,220,0.0)'); g.addColorStop(0.35, 'rgba(160,240,80,0.55)'); g.addColorStop(0.62, GREEN_HI); g.addColorStop(0.9, '#1d4a1c'); g.addColorStop(1, '#0d1f12');
  ctx.shadowColor = 'rgba(160,240,80,0.9)'; ctx.shadowBlur = 40;
  ctx.fillStyle = g; ctx.beginPath();
  const n = 40;
  for (let i = 0; i <= n; i++) { const s = i / n, x = lerp(-L, L, s), w = wMax * Math.pow(Math.sin(Math.PI * s), 0.8); i ? ctx.lineTo(x, -w * 0.9) : ctx.moveTo(x, -w * 0.9); }
  for (let i = n; i >= 0; i--) { const s = i / n, x = lerp(-L, L, s), w = wMax * Math.pow(Math.sin(Math.PI * s), 0.8); ctx.lineTo(x, w * 0.35); }
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(245,255,230,0.95)'; ctx.fillRect(-L * 0.9, -wMax * 0.04, L * 1.8, 5);
  ctx.restore();
}
