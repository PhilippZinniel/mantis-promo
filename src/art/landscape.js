// Procedural "night shan-shui" manhua landscape: ink pillars, halftone moon, mist and brand-green leaf blades.
// Every layer is drawn on its own transparent canvas so the film can place layers at different depths.
import { rng, makeNoise, clamp, lerp, smoothstep, TAU, hex, mix, rgb } from '../lib/util.js';

export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ------------------------------------------------------------------ helpers
/** Halftone dot screen driven by an analytic field f(x,y) -> 0..1 (dot area). */
export function halftone(ctx, W, H, f, { pitch = 10, angle = Math.PI / 4, color = '#e8efe9', maxR = 0.62, min = 0.02, clip } = {}) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const diag = Math.hypot(W, H);
  ctx.save();
  if (clip) { ctx.clip(clip); }
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let j = -diag / pitch; j < diag / pitch; j++) {
    for (let i = -diag / pitch; i < diag / pitch; i++) {
      const ux = i * pitch, uy = j * pitch;
      const x = W / 2 + ux * ca - uy * sa, y = H / 2 + ux * sa + uy * ca;
      if (x < -pitch || y < -pitch || x > W + pitch || y > H + pitch) continue;
      const v = f(x, y);
      if (v < min) continue;
      const r = Math.sqrt(clamp(v)) * pitch * maxR;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
  }
  ctx.fill();
  ctx.restore();
}

export function speckle(ctx, W, H, n, { color = '0,0,0', a = [0.05, 0.2], r = [0.5, 1.6], seed = 5, clip } = {}) {
  const R = rng(seed);
  ctx.save(); if (clip) ctx.clip(clip);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${color},${R.range(a[0], a[1])})`;
    ctx.beginPath(); ctx.arc(R() * W, R() * H, R.range(r[0], r[1]), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** soft fog band */
export function fog(ctx, W, H, { y0, y1, color = [150, 185, 172], a = 0.5, seed = 3, blobs = 26, size = 0.28 }) {
  const R = rng(seed);
  // gradient wash
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgb(color, 0)); g.addColorStop(0.55, rgb(color, a * 0.55)); g.addColorStop(1, rgb(color, a));
  ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0);
  // flattened soft blobs for organic wisps
  for (let i = 0; i < blobs; i++) {
    const cx = R() * W, cy = lerp(y0, y1, R() ** 0.7), rx = W * size * R.range(0.4, 1), ry = (y1 - y0) * R.range(0.18, 0.4);
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    rg.addColorStop(0, rgb(color, a * R.range(0.25, 0.6))); rg.addColorStop(1, rgb(color, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
  }
}

// ------------------------------------------------------------------ pillars
/**
 * Karst spire with ink-wash volume: jagged crown, ledged flanks, two-tone facets, brush strata, rim light.
 * (cx, baseY): centre of base; w: base half-width; h: height.
 */
export function pillar(ctx, N, R, cx, baseY, w, h, { tilt = 0, body = ['#0c1715', '#1d2f2a'], rim = '#8fb0a4', rimA = 0.6, hatch = 1, moss = 1, S = 1, spires = 3 }) {
  const top = baseY - h, steps = 72;
  const seed = R() * 100;
  const L = [], Rr = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;                              // 0 crown .. 1 base
    const y = lerp(top, baseY, s);
    const taper = 0.26 + 0.74 * Math.pow(s, 0.72);
    const ledge = Math.floor(s * 11), within = s * 11 - ledge;
    const step = (N(seed + ledge * 7.7, 3.1) * 0.5 + 0.1) * (0.05 + 0.08 * s) * (within < 0.18 ? within / 0.18 : 1);
    const wobL = N.fbm(seed + s * 5, 1.1, 3) * 0.22 + N.fbm(seed * 1.7 + s * 17, 2.2, 2) * 0.07;
    const wobR = N.fbm(seed * 0.6 + s * 5, 8.8, 3) * 0.22 + N.fbm(seed * 2.1 + s * 17, 3.3, 2) * 0.07;
    const sh = tilt * (baseY - y);
    L.push([cx + sh - w * (taper + wobL + step), y]);
    Rr.push([cx + sh + w * (taper * 0.96 + wobR - step * 0.4), y]);
  }
  // jagged crown: ridged profile across the top width with a few spires
  const crown = [];
  const xl = L[0][0], xr = Rr[0][0], cw = xr - xl, nc = 22;
  for (let i = 0; i <= nc; i++) {
    const u = i / nc, x = lerp(xl, xr, u);
    const env = Math.sin(Math.PI * clamp(u * 0.94 + 0.03));                 // dome envelope
    const spire = N.ridged(seed * 3 + u * spires * 1.7, 5.5, 3);
    crown.push([x, top + (1 - env * (0.55 + 0.45 * spire)) * h * 0.13 + N(seed + u * 9, 4) * h * 0.012]);
  }
  const path = new Path2D();
  path.moveTo(...L[0]);
  L.forEach((p, i) => i && path.lineTo(...p));
  Rr.slice().reverse().forEach((p) => path.lineTo(...p));
  crown.slice().reverse().forEach((p) => path.lineTo(...p));
  path.closePath();

  const bx0 = Math.min(...L.map((p) => p[0])), bx1 = Math.max(...Rr.map((p) => p[0]));
  ctx.save();
  ctx.fillStyle = body[0]; ctx.fill(path);
  ctx.clip(path);
  // light facet: a slanted ribbon down the right side, soft edge
  const fx = (s) => lerp(bx0 + (bx1 - bx0) * 0.45, bx1 - (bx1 - bx0) * 0.08, 0.5 + 0.5 * N(seed + s * 3, 6.1)) + tilt * (baseY - lerp(top, baseY, s));
  const facet = new Path2D();
  facet.moveTo(fx(0), top - 4);
  for (let i = 0; i <= steps; i += 2) facet.lineTo(fx(i / steps) + N(seed + i * 0.2, 2) * w * 0.07, lerp(top, baseY, i / steps));
  facet.lineTo(bx1 + 40, baseY); facet.lineTo(bx1 + 40, top - 4); facet.closePath();
  const fg = ctx.createLinearGradient(bx0, 0, bx1, 0);
  fg.addColorStop(0, rgb(hex(body[1]), 0)); fg.addColorStop(0.6, rgb(hex(body[1]), 0.85)); fg.addColorStop(1, rgb(hex(body[1]), 1));
  ctx.fillStyle = fg; ctx.fill(facet);
  // strata: long soft horizontal washes + long vertical brush strokes
  for (let k = 0; k < 14; k++) {
    const s = (k + R()) / 14, y = lerp(top, baseY, s), sIdx = clamp(Math.floor(s * steps), 0, steps);
    const x0 = L[sIdx][0], x1 = Rr[sIdx][0];
    const gg = ctx.createLinearGradient(0, y, 0, y + h * 0.05);
    gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.3, `rgba(0,3,2,${R.range(0.2, 0.5)})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(x0, y, x1 - x0, h * 0.05);
  }
  const nH = Math.floor(70 * hatch * (w * h) / (60 * 300) * S);
  for (let i = 0; i < nH; i++) {
    const t = R(), y = lerp(top + h * 0.05, baseY, R() ** 0.9);
    const sIdx = clamp(Math.floor(((y - top) / h) * steps), 0, steps);
    const x = lerp(L[sIdx][0], Rr[sIdx][0], t);
    const len = R.range(0.1, 0.3) * h, lw = R.range(0.8, 2.6) * S;
    const light = t > 0.5 && R() < 0.5;
    ctx.strokeStyle = light ? `rgba(160,198,184,${R.range(0.05, 0.16)})` : `rgba(1,5,4,${R.range(0.2, 0.55)})`;
    ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + R.range(-3, 3) * S, y + len * 0.5, x + R.range(-5, 5) * S + tilt * -len, y + len); ctx.stroke();
  }
  // dian dabs on crown and ledges
  const nM = Math.floor(34 * moss * (w / 60) * S);
  for (let i = 0; i < nM; i++) {
    const s = R() ** 1.8 * 0.55, y = lerp(top, baseY, s), sIdx = clamp(Math.floor(s * steps), 0, steps);
    const x = lerp(L[sIdx][0], Rr[sIdx][0], R());
    ctx.fillStyle = `rgba(0,2,2,${R.range(0.3, 0.75)})`;
    ctx.beginPath(); ctx.ellipse(x, y, R.range(1.5, 4.2) * S, R.range(0.9, 2.1) * S, R.range(-0.5, 0.5), 0, TAU); ctx.fill();
  }
  ctx.restore();

  // broken calligraphic rim light on both flanks and crown
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const rimLine = (pts, a, lw) => {
    ctx.strokeStyle = rgb(hex(rim), a); ctx.lineWidth = lw; ctx.beginPath();
    let pen = false;
    pts.forEach((p, i) => { const on = N(seed + i * 0.33, 7.7) > -0.2 && i % 13 !== 0; if (on) { if (!pen) { ctx.moveTo(...p); pen = true; } else ctx.lineTo(...p); } else pen = false; });
    ctx.stroke();
  };
  rimLine(Rr, rimA * 0.35, 3.4 * S); rimLine(Rr, rimA, 1.2 * S);
  rimLine(crown, rimA * 0.8, 1.2 * S);
  rimLine(L, rimA * 0.4, 1.0 * S);
  ctx.restore();
  return { path, top, baseY };
}

// ------------------------------------------------------------------ ridge (far layers)
export function ridge(ctx, W, H, N, { y, amp, scale, seed, color, fogColor = [140, 175, 162], fogA = 0.55, bottom = H, peaks = true, S = 1 }) {
  const p = new Path2D();
  p.moveTo(0, bottom);
  for (let x = 0; x <= W; x += 6 * S) {
    const u = x / W;
    const n = peaks ? N.ridged(u * scale + seed, seed * 0.37, 4) : N.fbm(u * scale + seed, seed, 3) * 0.5 + 0.5;
    p.lineTo(x, y - amp * Math.pow(n, peaks ? 2.1 : 1));
  }
  p.lineTo(W, bottom); p.closePath();
  const g = ctx.createLinearGradient(0, y - amp, 0, y + amp * 0.8);
  g.addColorStop(0, color[0]); g.addColorStop(1, color[1]);
  ctx.fillStyle = g; ctx.fill(p);
  ctx.save(); ctx.clip(p);
  const fg = ctx.createLinearGradient(0, y - amp * 0.5, 0, y + amp * 0.4);
  fg.addColorStop(0, rgb(fogColor, 0)); fg.addColorStop(1, rgb(fogColor, fogA));
  ctx.fillStyle = fg; ctx.fillRect(0, y - amp, W, amp * 2);
  ctx.restore();
  return p;
}

// ------------------------------------------------------------------ leaf blade (brand green)
export function blade(ctx, x0, y0, ang, len, wid, { curve = 0.25, dark = '#143d1a', mid = '#3D8A2A', hi = '#86cd2a', veins = true, alpha = 1 } = {}) {
  const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
  const pts = [], N = 28;
  for (let i = 0; i <= N; i++) {
    const s = i / N, b = curve * len * s * s;
    const x = x0 + dx * len * s + nx * b, y = y0 + dy * len * s + ny * b;
    const w = wid * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.62)), 0.9) * (1 - 0.15 * s);
    pts.push({ x, y, w, nx: nx - dy * curve * 2 * s * 0, ny });
  }
  const side = (sgn) => pts.map((p) => [p.x + nx * p.w * sgn, p.y + ny * p.w * sgn]);
  const A = side(1), B = side(-1).reverse();
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(...A[0]); A.forEach((p) => ctx.lineTo(...p)); B.forEach((p) => ctx.lineTo(...p)); ctx.closePath();
  const g = ctx.createLinearGradient(x0 + nx * wid, y0 + ny * wid, x0 - nx * wid, y0 - ny * wid);
  g.addColorStop(0, hi); g.addColorStop(0.45, mid); g.addColorStop(1, dark);
  ctx.fillStyle = g; ctx.fill();
  if (veins) {
    ctx.clip();
    ctx.strokeStyle = 'rgba(210,255,140,0.35)'; ctx.lineWidth = Math.max(1, wid * 0.05);
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,20,0,0.22)'; ctx.lineWidth = Math.max(1, wid * 0.03);
    for (let i = 3; i < N - 2; i += 3) { const p = pts[i]; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + nx * p.w * 0.9 - dx * p.w * 0.3, p.y + ny * p.w * 0.9 - dy * p.w * 0.3); ctx.stroke(); }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ traveler
export function traveler(ctx, x, y, s, { color = '#050908', rim = 'rgba(190,215,205,0.55)', wind = 1 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = color;
  // cloak + body (viewed from behind-left, facing right)
  ctx.beginPath();
  ctx.moveTo(-9, -82);
  ctx.bezierCurveTo(-18, -72, -22, -50, -24, -30);
  ctx.bezierCurveTo(-30 - 8 * wind, -22, -44 - 14 * wind, -10, -52 - 20 * wind, 0);   // cloak tail flutters back (wind from the right)
  ctx.lineTo(-20, 0);
  ctx.lineTo(16, 0);
  ctx.bezierCurveTo(18, -26, 16, -52, 13, -72);
  ctx.bezierCurveTo(12, -78, 6, -83, -9, -82);
  ctx.closePath(); ctx.fill();
  // head + conical hat
  ctx.beginPath(); ctx.ellipse(2, -84, 6.5, 7.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-26, -88); ctx.quadraticCurveTo(-8, -96, 3, -118); ctx.quadraticCurveTo(14, -96, 31, -88);
  ctx.quadraticCurveTo(2, -92, -26, -88); ctx.closePath(); ctx.fill();
  // staff
  ctx.strokeStyle = color; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(23, -96); ctx.stroke();
  ctx.beginPath(); ctx.arc(21.5, -99, 3.2, 0, TAU); ctx.fill();
  // rim light on right-facing edges
  ctx.strokeStyle = rim; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(13, -72); ctx.bezierCurveTo(16, -52, 18, -26, 16, -2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -118); ctx.quadraticCurveTo(14, -96, 31, -88); ctx.stroke();
  ctx.restore();
}

export function pine(ctx, R, x, y, h, color = '#030605') {
  ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.lineWidth = h * 0.035;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + h * 0.06 * (R() - 0.5) * 2, y - h * 0.5, x + h * 0.04, y - h); ctx.stroke();
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const s = i / tiers, ty = y - h * (0.28 + 0.7 * s), tw = h * (0.34 - 0.26 * s) * R.range(0.8, 1.15);
    ctx.beginPath(); ctx.moveTo(x - tw, ty + h * 0.05);
    ctx.quadraticCurveTo(x - tw * 0.3, ty - h * 0.02, x + h * 0.02, ty - h * 0.07);
    ctx.quadraticCurveTo(x + tw * 0.4, ty - h * 0.02, x + tw, ty + h * 0.06 * R.range(0.7, 1.1));
    ctx.quadraticCurveTo(x + tw * 0.2, ty + h * 0.02, x - tw, ty + h * 0.05); ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ the vista
/**
 * Draw the hero night vista as separate layers. `U` is the unit→pixel scale; panel is (1000 x 760) units.
 * Returns { sky, far, mid, near, leaves, mist, flat } canvases.
 */
export function drawVista({ U = 2.4, seed = 11, Wu = 1000, Hu = 760 } = {}) {
  const W = Math.round(Wu * U), H = Math.round(Hu * U), N = makeNoise(seed), R = rng(seed);
  const L = {};

  // ---- sky --------------------------------------------------------------------------------
  {
    const c = mk(W, H), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H * 0.72);
    g.addColorStop(0, '#040807'); g.addColorStop(0.55, '#0b1613'); g.addColorStop(1, '#1b2e28');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const mx = W * 0.62, my = H * 0.3, mr = W * 0.07;
    // moon halo as halftone
    halftone(x, W, H, (px, py) => { const d = Math.hypot(px - mx, py - my) / mr; if (d < 0.98) return 0; return Math.pow(clamp(1 - (d - 0.98) / 3.4), 2.0) * 1.1; },
      { pitch: 9 * U / 2.4 * 1.15, color: '#cfdcd4', maxR: 0.58 });
    // soft glow under dots
    const rg = x.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 4.4);
    rg.addColorStop(0, 'rgba(150,190,176,0.55)'); rg.addColorStop(0.25, 'rgba(120,160,146,0.28)'); rg.addColorStop(1, 'rgba(120,160,146,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    // moon disc
    x.fillStyle = '#eef3ec'; x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
    x.save(); x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.clip();
    for (let i = 0; i < 9; i++) { x.fillStyle = `rgba(160,178,168,${R.range(0.05, 0.11)})`; x.beginPath(); x.ellipse(mx + R.range(-0.7, 0.7) * mr, my + R.range(-0.7, 0.7) * mr, R.range(0.14, 0.4) * mr, R.range(0.1, 0.26) * mr, R() * 3, 0, TAU); x.fill(); }
    x.restore();
    // calligraphic cloud wisps
    x.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const y = H * R.range(0.12, 0.5), x0 = W * R.range(0.05, 0.9), len = W * R.range(0.1, 0.24);
      const gg = x.createLinearGradient(x0, y, x0 + len, y);
      gg.addColorStop(0, 'rgba(170,200,188,0)'); gg.addColorStop(0.5, `rgba(170,200,188,${R.range(0.1, 0.24)})`); gg.addColorStop(1, 'rgba(170,200,188,0)');
      x.strokeStyle = gg; x.lineWidth = R.range(1.5, 4) * U;
      x.beginPath(); x.moveTo(x0, y); x.bezierCurveTo(x0 + len * 0.3, y - 12 * U * R(), x0 + len * 0.7, y + 10 * U * R(), x0 + len, y - 4 * U); x.stroke();
    }
    // birds crossing the moon
    x.strokeStyle = '#04090a'; x.lineCap = 'round';
    [[-0.9, -0.15, 1], [0.1, -0.5, 0.75], [0.62, 0.12, 0.55]].forEach(([ox, oy, s]) => {
      const bx = mx + ox * mr, by = my + oy * mr, sz = 13 * U * s;
      x.lineWidth = 3 * U * s;
      x.beginPath(); x.moveTo(bx - sz, by + sz * 0.1); x.quadraticCurveTo(bx - sz * 0.45, by - sz * 0.6, bx, by); x.quadraticCurveTo(bx + sz * 0.45, by - sz * 0.6, bx + sz, by + sz * 0.15); x.stroke();
    });
    speckle(x, W, H, 5000, { color: '220,235,228', a: [0.02, 0.09], r: [0.4, 1.1], seed: 31 });
    L.sky = c; L.moon = { x: mx / U, y: my / U, r: mr / U };
  }

  // ---- far ridges --------------------------------------------------------------------------
  {
    const c = mk(W, H), x = c.getContext('2d');
    ridge(x, W, H, N, { y: H * 0.66, amp: H * 0.12, scale: 3.1, seed: 2, color: ['#344a43', '#243630'], fogA: 0.7, S: U });
    fog(x, W, H, { y0: H * 0.56, y1: H * 0.7, color: [140, 178, 164], a: 0.4, seed: 7, size: 0.35 });
    ridge(x, W, H, N, { y: H * 0.72, amp: H * 0.2, scale: 2.2, seed: 6, color: ['#25382f', '#16241f'], fogA: 0.6, S: U });
    fog(x, W, H, { y0: H * 0.6, y1: H * 0.78, color: [130, 168, 154], a: 0.46, seed: 9, size: 0.4 });
    speckle(x, W, H, 3000, { color: '0,0,0', a: [0.04, 0.12], seed: 41, r: [0.4, 1.2] });
    L.far = c;
  }

  // ---- mid pillars -------------------------------------------------------------------------
  {
    const c = mk(W, H), x = c.getContext('2d');
    const baseY = H * 1.02;                         // bases sink below the panel; mist hides the join
    const P = [
      // cx(units), w(units half), h(frac H), tilt, tone, spires
      [355, 40, 0.50, 0.01, ['#0a1412', '#1b2c27'], 2],
      [560, 78, 0.60, -0.02, ['#091210', '#21362f'], 4],
      [775, 50, 0.50, 0.02, ['#0b1513', '#1d312b'], 3],
      [915, 58, 0.62, -0.012, ['#09110f', '#1a2c26'], 3],
      [470, 30, 0.32, 0.01, ['#0d1816', '#1b2c27'], 2],
    ];
    P.sort((a, b) => a[2] - b[2]);
    for (const [cx, w, hf, tilt, body, sp] of P) {
      pillar(x, N, R, cx * U, baseY, w * U, H * hf, { tilt, body, S: U, hatch: 1, moss: 1, rimA: 0.62, spires: sp });
      fog(x, W, H, { y0: baseY - H * hf * 0.55, y1: baseY, color: [118, 156, 143], a: 0.34, seed: R.int(1, 99), blobs: 6, size: 0.2 });
    }
    // misty abyss: fog thickens into deep green-black at the bottom of the panel
    fog(x, W, H, { y0: H * 0.66, y1: H * 0.92, color: [112, 150, 138], a: 0.42, seed: 21, size: 0.4, blobs: 30 });
    const ab = x.createLinearGradient(0, H * 0.78, 0, H);
    ab.addColorStop(0, 'rgba(8,16,14,0)'); ab.addColorStop(0.6, 'rgba(8,16,14,0.78)'); ab.addColorStop(1, 'rgba(5,10,9,0.98)');
    x.fillStyle = ab; x.fillRect(0, H * 0.78, W, H * 0.22);
    speckle(x, W, H, 4000, { color: '0,0,0', a: [0.05, 0.15], seed: 51 });
    L.mid = c;
  }

  // ---- near cliff + traveler + pines -------------------------------------------------------
  {
    const c = mk(W, H), x = c.getContext('2d');
    const cliff = new Path2D();
    const pts = [[0, 0.585], [0.05, 0.572], [0.11, 0.58], [0.17, 0.592], [0.215, 0.608], [0.265, 0.62], [0.31, 0.645], [0.335, 0.7], [0.318, 0.74],
      [0.345, 0.79], [0.33, 0.84], [0.375, 0.9], [0.36, 0.96], [0.4, 1.0]];
    cliff.moveTo(0, H);
    pts.forEach(([u, v], i) => { const jx = N(i * 3.3, 1) * 0.006, jy = N(i * 2.1, 5) * 0.006; cliff.lineTo((u + jx) * W, (v + jy) * H); });
    cliff.lineTo(W * 0.4, H); cliff.closePath();
    x.fillStyle = '#040908'; x.fill(cliff);
    x.save(); x.clip(cliff);
    for (let i = 0; i < 90; i++) { // strata strokes (long, angled, calligraphic) — not rain
      const px = R() * W * 0.4, py = H * R.range(0.62, 1), len = R.range(30, 120) * U;
      x.strokeStyle = `rgba(90,125,110,${R.range(0.04, 0.16)})`; x.lineWidth = R.range(0.8, 2.2) * U; x.lineCap = 'round';
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + len * 0.4, py + len * 0.05 * R.range(-1, 1), px + len, py + len * R.range(0.05, 0.25)); x.stroke();
    }
    const dark = x.createLinearGradient(0, H * 0.7, 0, H); dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(1, 'rgba(0,0,0,0.9)');
    x.fillStyle = dark; x.fillRect(0, H * 0.7, W * 0.45, H * 0.3);
    const top = x.createLinearGradient(0, H * 0.58, 0, H * 0.82); top.addColorStop(0, 'rgba(70,98,88,0.0)'); top.addColorStop(1, 'rgba(0,0,0,0)');
    x.restore();
    for (let i = 0; i < 60; i++) { // grass tufts on the cliff top
      const u = R.range(0.0, 0.3), gx = u * W, gy = H * (0.58 + (u > 0.2 ? (u - 0.2) * 0.4 : 0)) + N(u * 14, 3) * H * 0.004;
      x.strokeStyle = '#030706'; x.lineWidth = R.range(1, 2.2) * U; x.lineCap = 'round';
      x.beginPath(); x.moveTo(gx, gy + 4 * U); x.quadraticCurveTo(gx + R.range(-4, 6) * U, gy - 8 * U, gx + R.range(-3, 12) * U, gy - R.range(8, 20) * U); x.stroke();
    }
    pine(x, R, W * 0.055, H * 0.585, H * 0.22);
    pine(x, R, W * 0.108, H * 0.59, H * 0.13);
    pine(x, R, W * 0.285, H * 0.632, H * 0.08);
    traveler(x, W * 0.205, H * 0.607, 1.05 * U * 0.9, {});
    x.strokeStyle = 'rgba(165,196,183,0.55)'; x.lineWidth = 1.6 * U; x.lineJoin = 'round'; x.lineCap = 'round';
    x.beginPath(); pts.slice(2, 10).forEach(([u, v], i) => (i ? x.lineTo(u * W, v * H) : x.moveTo(u * W, v * H))); x.stroke();
    L.near = c;
    L.traveler = { x: 0.205 * Wu, y: 0.607 * Hu, h: 118 * 0.9 * 1.05 };
  }

  // ---- foreground blades (brand green) --------------------------------------------------------
  {
    const c = mk(W, H), x = c.getContext('2d');
    const spec = [
      // x%, y%, angle(deg), len(units), width, curve
      [0.985, 1.04, -128, 330, 44, -0.28], [0.93, 1.05, -112, 290, 36, -0.2], [1.02, 1.03, -142, 250, 30, -0.3],
      [0.955, 1.06, -98, 210, 26, -0.15], [0.02, 1.05, -58, 180, 24, 0.22], [0.075, 1.05, -75, 130, 17, 0.18],
    ];
    spec.forEach(([bx, by, deg, len, wid, cur], i) => blade(x, bx * W, by * H, deg * Math.PI / 180, len * U, wid * U, { curve: cur, dark: '#0d2d12', mid: '#2f7a26', hi: i % 2 ? '#7cc326' : '#67b628', alpha: 0.98 }));
    L.leaves = c;
  }

  // ---- drifting mist sheets (to be used as parallax planes) -----------------------------------
  {
    const c = mk(W, Math.round(H * 0.5)), x = c.getContext('2d');
    fog(x, W, c.height, { y0: 0, y1: c.height, color: [186, 214, 202], a: 0.5, seed: 77, blobs: 44, size: 0.3 });
    // fade top and bottom edges so the sheet never shows hard borders
    x.globalCompositeOperation = 'destination-in';
    const m = x.createLinearGradient(0, 0, 0, c.height);
    m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.35, 'rgba(0,0,0,1)'); m.addColorStop(0.65, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = m; x.fillRect(0, 0, W, c.height);
    L.mist = c;
  }

  // ---- flat composite ----------------------------------------------------------------------------
  {
    const c = mk(W, H), x = c.getContext('2d');
    for (const k of ['sky', 'far', 'mid', 'near', 'leaves']) x.drawImage(L[k], 0, 0);
    x.globalAlpha = 0.5; x.drawImage(L.mist, 0, H * 0.46, W, H * 0.5); x.globalAlpha = 1;
    // global ink grain
    speckle(x, W, H, 9000, { color: '0,0,0', a: [0.03, 0.1], seed: 63, r: [0.4, 1] });
    L.flat = c;
  }
  L.W = W; L.H = H; L.U = U;
  return L;
}

// =====================================================================================================
// Additional panels for the page strip
// =====================================================================================================

/** P2 — low close-up of the traveler against a huge cropped moon. Units 570 x 664. */
export function drawCloseup({ U = 2.4, seed = 23, Wu = 570, Hu = 664 } = {}) {
  const W = Math.round(Wu * U), H = Math.round(Hu * U), N = makeNoise(seed), R = rng(seed);
  const c = mk(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#050a09'); g.addColorStop(0.6, '#0d1a16'); g.addColorStop(1, '#1b2e28');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // giant moon, cropped by the panel edge
  const mx = W * 0.86, my = H * 0.3, mr = W * 0.34;
  halftone(x, W, H, (px, py) => { const d = Math.hypot(px - mx, py - my) / mr; if (d < 0.98) return 0; return Math.pow(clamp(1 - (d - 0.98) / 1.5), 1.8) * 1.1; }, { pitch: 10.5 * U / 2.4, color: '#cfdcd4', maxR: 0.58 });
  const rg = x.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 2); rg.addColorStop(0, 'rgba(150,190,176,0.5)'); rg.addColorStop(1, 'rgba(120,160,146,0)');
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  x.fillStyle = '#eef3ec'; x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
  x.save(); x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.clip();
  for (let i = 0; i < 8; i++) { x.fillStyle = `rgba(160,178,168,${R.range(0.05, 0.1)})`; x.beginPath(); x.ellipse(mx + R.range(-0.8, 0.8) * mr, my + R.range(-0.8, 0.8) * mr, R.range(0.12, 0.3) * mr, R.range(0.08, 0.2) * mr, R() * 3, 0, TAU); x.fill(); }
  x.restore();
  // speed lines: manga wind streaks sweeping left
  x.lineCap = 'round';
  for (let i = 0; i < 38; i++) {
    const y = H * R.range(0.05, 0.9), x1 = W * R.range(0.4, 1.05), len = W * R.range(0.12, 0.5);
    const gg = x.createLinearGradient(x1, y, x1 - len, y); gg.addColorStop(0, 'rgba(190,215,205,0)'); gg.addColorStop(0.3, `rgba(190,215,205,${R.range(0.05, 0.22)})`); gg.addColorStop(1, 'rgba(190,215,205,0)');
    x.strokeStyle = gg; x.lineWidth = R.range(0.8, 3.2) * U; x.beginPath(); x.moveTo(x1, y); x.lineTo(x1 - len, y + R.range(-6, 6) * U); x.stroke();
  }
  // distant pillars in fog
  const baseY = H * 1.02;
  [[160, 36, 0.36], [470, 44, 0.46]].forEach(([cx, w, hf], i) => { pillar(x, N, R, cx * U, baseY, w * U, H * hf, { body: ['#0a1412', '#1b2c27'], S: U, rimA: 0.5 }); });
  fog(x, W, H, { y0: H * 0.5, y1: H * 0.85, color: [112, 150, 138], a: 0.5, seed: 4, size: 0.5, blobs: 20 });
  // ground
  const gp = new Path2D(); gp.moveTo(0, H); gp.lineTo(0, H * 0.84);
  for (let i = 0; i <= 12; i++) gp.lineTo(W * (i / 12), H * (0.84 + 0.02 * N(i * 1.7, 2) + 0.03 * (i / 12)));
  gp.lineTo(W, H); gp.closePath(); x.fillStyle = '#030706'; x.fill(gp);
  for (let i = 0; i < 80; i++) { const gx = W * R(), gy = H * (0.855 + 0.02 * R()); x.strokeStyle = '#030706'; x.lineWidth = R.range(1.5, 3) * U; x.lineCap = 'round'; x.beginPath(); x.moveTo(gx, gy + 6 * U); x.quadraticCurveTo(gx + R.range(-6, 8) * U, gy - 12 * U, gx + R.range(-8, 20) * U, gy - R.range(14, 32) * U); x.stroke(); }
  // the traveler, large, windswept
  traveler(x, W * 0.33, H * 0.865, 3.5 * U * 0.8, { wind: 1.8 });
  // foreground blades
  [[0.0, 1.04, -62, 300, 36, 0.2], [0.07, 1.05, -78, 230, 26, 0.18], [1.02, 1.05, -118, 260, 32, -0.22]].forEach(([bx, by, deg, len, wid, cur], i) =>
    blade(x, bx * W, by * H, deg * Math.PI / 180, len * U, wid * U, { curve: cur, dark: '#0d2d12', mid: '#2f7a26', hi: i % 2 ? '#7cc326' : '#67b628' }));
  speckle(x, W, H, 5000, { color: '0,0,0', a: [0.04, 0.12], seed: 8 });
  return { flat: c, W, H, U };
}

/** P3 — looking down into a misty valley; river carries the only warm light (brand green lantern). Units 400 x 664. */
export function drawValley({ U = 2.4, seed = 37, Wu = 400, Hu = 664 } = {}) {
  const W = Math.round(Wu * U), H = Math.round(Hu * U), N = makeNoise(seed), R = rng(seed);
  const c = mk(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a1613'); g.addColorStop(0.5, '#16261f'); g.addColorStop(1, '#070e0c');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // halftone sky glow top
  halftone(x, W, H, (px, py) => Math.pow(clamp(1 - py / (H * 0.55)), 2.2) * 0.8, { pitch: 10 * U / 2.4, color: '#9db8ad', maxR: 0.5, angle: Math.PI / 6 });
  // layered pillars descending (far → near)
  const rows = [[0.28, 0.2, 7], [0.42, 0.26, 6], [0.58, 0.34, 5], [0.76, 0.46, 4]];
  rows.forEach(([yb, hf, n], k) => {
    for (let i = 0; i < n; i++) {
      const cx = (i + R.range(0.1, 0.9)) / n * Wu, w = R.range(16, 36) * (1 + k * 0.45);
      pillar(x, N, R, cx * U, H * (yb + 0.22), w * U, H * hf * R.range(0.8, 1.2), { body: [k % 2 ? '#0b1614' : '#0e1b18', '#1b2e28'], S: U * 0.9, rimA: 0.35 + k * 0.08, hatch: 0.8, moss: 0.6 });
    }
    fog(x, W, H, { y0: H * (yb + 0.04), y1: H * (yb + 0.24), color: [112, 150, 138], a: 0.5 - k * 0.04, seed: 11 + k, size: 0.45, blobs: 14 });
  });
  // river: pale winding ribbon
  const river = new Path2D(); const pts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([W * (0.5 + 0.28 * Math.sin(t * 5.2 + 0.7) * (0.3 + t * 0.8)), H * (0.5 + t * 0.52)]); }
  pts.forEach((p, i) => (i ? river.lineTo(p[0] - (4 + i * 0.9) * U, p[1]) : river.moveTo(p[0] - 4 * U, p[1])));
  pts.slice().reverse().forEach((p, i) => river.lineTo(p[0] + (4 + (40 - i) * 0.9) * U, p[1]));
  river.closePath();
  const rgd = x.createLinearGradient(0, H * 0.5, 0, H); rgd.addColorStop(0, 'rgba(200,225,214,0.0)'); rgd.addColorStop(0.5, 'rgba(200,225,214,0.35)'); rgd.addColorStop(1, 'rgba(200,225,214,0.6)');
  x.fillStyle = rgd; x.fill(river);
  // lantern boat — spot brand green
  const lp = pts[28], lx = lp[0], ly = lp[1];
  const lg = x.createRadialGradient(lx, ly, 0, lx, ly, 46 * U); lg.addColorStop(0, 'rgba(160,240,70,0.75)'); lg.addColorStop(1, 'rgba(120,200,40,0)');
  x.fillStyle = lg; x.fillRect(lx - 50 * U, ly - 50 * U, 100 * U, 100 * U);
  x.fillStyle = '#050a08'; x.beginPath(); x.moveTo(lx - 16 * U, ly + 2 * U); x.quadraticCurveTo(lx, ly + 10 * U, lx + 16 * U, ly + 2 * U); x.lineTo(lx + 12 * U, ly - 2 * U); x.lineTo(lx - 12 * U, ly - 2 * U); x.fill();
  x.fillStyle = '#c8ff7a'; x.beginPath(); x.arc(lx, ly - 7 * U, 3.4 * U, 0, TAU); x.fill();
  // brand blades creeping in from the bottom-right
  [[1.0, 1.05, -105, 240, 28, -0.2], [0.9, 1.05, -85, 170, 20, -0.15]].forEach(([bx, by, deg, len, wid, cur], i) =>
    blade(x, bx * W, by * H, deg * Math.PI / 180, len * U, wid * U, { curve: cur, dark: '#0d2d12', mid: '#2f7a26', hi: '#7cc326' }));
  speckle(x, W, H, 4000, { color: '0,0,0', a: [0.04, 0.12], seed: 12 });
  return { flat: c, W, H, U };
}

/** P4 — blade burst with manga speed lines on halftone. Units 1000 x 560. */
export function drawBurst({ U = 2.4, seed = 53, Wu = 1000, Hu = 560 } = {}) {
  const W = Math.round(Wu * U), H = Math.round(Hu * U), R = rng(seed);
  const c = mk(W, H), x = c.getContext('2d');
  x.fillStyle = '#060c0a'; x.fillRect(0, 0, W, H);
  const cx = W * 0.22, cy = H * 1.02;
  halftone(x, W, H, (px, py) => { const d = Math.hypot(px - cx, py - cy) / (W * 0.8); return Math.pow(clamp(1 - d), 1.5) * 1.0; }, { pitch: 11 * U / 2.4, color: '#8fb0a3', maxR: 0.6, angle: Math.PI / 4 });
  // speed lines radiating from the burst centre
  for (let i = 0; i < 150; i++) {
    const a = R.range(-1.3, -0.1) - 0.1, len0 = W * R.range(0.18, 0.5), len1 = len0 + W * R.range(0.3, 0.9), lw = R.range(0.6, 3.6) * U;
    x.strokeStyle = `rgba(228,238,232,${R.range(0.05, 0.4)})`; x.lineWidth = lw; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx + Math.cos(a) * len0, cy + Math.sin(a) * len0); x.lineTo(cx + Math.cos(a) * len1, cy + Math.sin(a) * len1); x.stroke();
  }
  // blades fanning out
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), ang = lerp(-1.42, -0.1, t) + R.range(-0.04, 0.04);
    blade(x, cx - 40 * U + t * 80 * U, cy + 20 * U, ang, W * lerp(0.5, 0.95, 1 - Math.abs(t - 0.45)) * R.range(0.8, 1.05), U * lerp(26, 44, R()), { curve: R.range(-0.1, 0.18), dark: '#0b2410', mid: '#2f7a26', hi: i % 3 === 0 ? '#9be33a' : '#67b628', alpha: 0.96 });
  }
  speckle(x, W, H, 5000, { color: '0,0,0', a: [0.04, 0.14], seed: 9 });
  return { flat: c, W, H, U };
}
