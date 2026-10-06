// The director: maps film time -> pixels. Shots draw into a 2D context; transitions composite two shots.
// All story timing comes from the shared cue sheet (src/cues.json) so picture and sound cannot drift apart.
import { clamp, lerp, smoothstep, ease, prog, seg, TAU, PAL, rng } from './lib/util.js';
import { REGIONS, PANELS, PAGE, BUBBLES } from './strip.js';
import { brackets, thread, halfPlanes, polyPath, blade, grain, vignette, bloom, slicedText, brushStroke, bladeWipe } from './fx.js';
import { LogoScene } from './logoScene.js';
import { wx, wy } from './world.js';

// ---------------------------------------------------------------------------------------------------
// Camera track: monotone cubic Hermite (PCHIP) through the keys, so the camera flows through keyframes instead of
// stopping at each one. Zoom is interpolated in log space (constant perceived zoom speed). A key can be `rest: true`
// (zero velocity: a real hold), and a segment can carry a legacy easing `e` (used only for the opening landing).
// ---------------------------------------------------------------------------------------------------
const CH = ['u', 'v', 'yaw', 'pitch', 'roll', 'sx', 'ld'];
export function makeTrack(rawKeys) {
  const keys = rawKeys.map((k) => ({ sx: 0, ...k, ld: Math.log(k.d) }));
  const n = keys.length;
  keys.forEach((k, i) => {
    k.m = {};
    for (const c of CH) {
      const frozen = k.rest || i === 0 || i === n - 1 || keys[i - 1].e || k.e;
      if (frozen) { k.m[c] = 0; continue; }
      const h0 = k.t - keys[i - 1].t, h1 = keys[i + 1].t - k.t;
      const s0 = (k[c] - keys[i - 1][c]) / h0, s1 = (keys[i + 1][c] - k[c]) / h1;
      if (s0 * s1 <= 0) { k.m[c] = 0; continue; }
      const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;                   // Fritsch-Butland weighted harmonic mean
      k.m[c] = (w1 + w2) / (w1 / s0 + w2 / s1);
    }
  });
  return (t) => {
    if (t <= keys[0].t) return finish(keys[0]);
    if (t >= keys[n - 1].t) return finish(keys[n - 1]);
    let i = 0; while (keys[i + 1].t < t) i++;
    const a = keys[i], b = keys[i + 1], h = b.t - a.t, x = (t - a.t) / h, out = {};
    if (a.e) { const k = a.e(x); for (const c of CH) out[c] = lerp(a[c], b[c], k); out.d = lerp(a.d, b.d, k); return { z: 0, ...out, ld: undefined }; }
    const x2 = x * x, x3 = x2 * x, h00 = 2 * x3 - 3 * x2 + 1, h10 = x3 - 2 * x2 + x, h01 = -2 * x3 + 3 * x2, h11 = x3 - x2;
    for (const c of CH) out[c] = h00 * a[c] + h10 * h * a.m[c] + h01 * b[c] + h11 * h * b.m[c];
    return finish(out);
  };
  function finish(k) { const o = { z: 0 }; for (const c of ['u', 'v', 'yaw', 'pitch', 'roll', 'sx']) o[c] = k[c]; o.d = Math.exp(k.ld); return o; }
}

const expDecay = (t, t0, rate = 6) => (t < t0 ? 0 : Math.exp(-(t - t0) * rate));
const GLOSS = [
  { t: 'HAVE.', c: '#6a7a75', size: 112 }, { t: 'OWN.', c: '#6a7a75', size: 112 }, { t: 'EXIST.', c: '#6a7a75', size: 112 },
  { t: 'YES.', c: PAL.ink, size: 160 },
];

export class Film {
  constructor(canvas, world, assets) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.world = world; this.A = assets;
    this.K = assets.cues.t;
    this.W = canvas.width; this.H = canvas.height; this.fps = assets.cues.fps; this.dur = assets.cues.duration;
    const mk = () => { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; return c; };
    this.bufA = mk(); this.bufB = mk(); this.accum = mk(); this.bufS = mk();
    this.ca = this.bufA.getContext('2d'); this.cb = this.bufB.getContext('2d');
    this.trace = assets.trace;
    this.logo = new LogoScene(assets, this.W, this.H, this.K.lock - 1.98);
    this.camera = makeTrack(this.camKeys());
    this.setupType();
  }

  setupType() {
    const w = this.world, F = '900 italic {size}px "Exo 2"';
    const mk = (name, text, x, y, color = '#F7F8F7', align = 'left') => {
      const T = w.addType(name, { text, font: F, size: 400, color, z: -4, align, pad: 40, letterSpacing: -5 });
      T.mesh.position.set(x(T.w), y, -4);
      T.mesh.visible = false;
      return T;
    };
    mk('read', 'READ', (tw) => -6.9 - tw / 2, -8.6);
    mk('the', 'THE', (tw) => -6.9 - tw / 2, -12.2);
    mk('whole', 'WHOLE', (tw) => 6.9 + tw / 2, -8.6, '#7CC326');
    mk('page', 'PAGE.', (tw) => 6.9 + tw / 2, -12.2);
  }

  // =================================================================================================
  // public
  // =================================================================================================
  /** render film time t (seconds) to the main canvas, optionally with temporal supersampling for motion blur */
  renderAt(t, { samples = 1, shutter } = {}) {
    const frame = Math.round(t * this.fps), K = this.K;
    if (shutter === undefined) shutter = (t >= K.wipe - 0.05 && t < K.wipe + 0.75) ? 0.22 : 0.5;     // crisper blade on the wipe
    if (samples <= 1) { this.compose(this.ctx, t); this.post(this.ctx, t, frame); return; }
    const ac = this.accum.getContext('2d');
    for (let i = 0; i < samples; i++) {
      const ts = t + ((i + 0.5) / samples - 0.5) * shutter / this.fps;
      this.compose(this.ctx, ts);
      ac.globalAlpha = i === 0 ? 1 : 1 / (i + 1);
      ac.drawImage(this.canvas, 0, 0);
    }
    ac.globalAlpha = 1;
    this.ctx.drawImage(this.accum, 0, 0);
    this.post(this.ctx, t, frame);
  }

  /** adaptive motion-blur sample count from on-screen camera velocity */
  motionSamples(t) {
    const K = this.K;
    if (t < K.slash - 0.2) return 1;
    if (t >= K.wipe - 0.05 && t < K.wipe + 0.75) return 10;
    if (t >= K.wipe + 0.75) return 1;
    const w = this.world, d = 1 / 120;
    const pts = [[550, 600], [150, 300], [950, 1400]];
    const P = (tt) => { const C = this.cameraAt(tt); w.setCamera(C); return pts.map(([u, v]) => w.project(u, v, 0)); };
    const a = P(t - d), b = P(t + d);
    let m = 0; for (let i = 0; i < 3; i++) m = Math.max(m, Math.hypot(b[i].x - a[i].x, b[i].y - a[i].y) / 2);   // px per frame
    return clamp(Math.ceil(m / 7), 1, 12);
  }

  /** debug: render the world with an explicit state */
  debug(s) {
    const w = this.world;
    w.setCamera(s.cam ?? {});
    w.setLayers(s.spread ?? 0, s.layerOpts ?? {});
    for (const [id, st] of Object.entries(s.bubbles ?? {})) { const o = w.bubbles[id]; if (o.b.draw(st)) o.tex.needsUpdate = true; }
    w.render();
    this.ctx.drawImage(w.renderer.domElement, 0, 0);
  }

  // =================================================================================================
  // compositor
  // =================================================================================================
  /** camera shake from the film's impacts (decaying, deterministic) — reserved for the genuinely big beats */
  shakeAt(t) {
    const K = this.K;
    const hits = [[K.slash, 12], [K.titleRead, 6], [K.titlePage, 6], [K.strike, 16], [K.stays, 6], [K.paper, 12], [K.lock, 8]];
    let x = 0, y = 0, k = 0;
    for (const [h, a] of hits) {
      const dt = t - h; if (dt < 0 || dt > 0.6) continue;
      const e = Math.exp(-dt * 11);
      x += a * e * Math.sin(dt * 95 + h * 3.1); y += a * 0.7 * e * Math.sin(dt * 83 + h * 1.7 + 1);
      k = Math.max(k, e * a / 16);
    }
    return { x, y, k };
  }

  compose(ctx, t) {
    const { W, H, K } = this;
    const sh = this.shakeAt(t);
    if (Math.abs(sh.x) + Math.abs(sh.y) > 0.4) {
      // render the frame normally into a buffer, then place it with the shake offset (slight over-scale hides the edges)
      const tgt = this.bufS;
      this._compose(tgt.getContext('2d'), t);
      ctx.fillStyle = '#050a09'; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2 + sh.x, H / 2 + sh.y); ctx.scale(1 + 0.012 + 0.008 * sh.k, 1 + 0.012 + 0.008 * sh.k); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(tgt, 0, 0); ctx.restore();
    } else this._compose(ctx, t);
    // manga impact frame: two inverted frames on the film's biggest strike
    if (t >= K.strike - 1e-6 && t < K.strike + 2.0 / this.fps - 1e-6) {
      const tmp = this.bufS;
      const x = tmp.getContext('2d'); x.clearRect(0, 0, W, H); x.drawImage(ctx.canvas, 0, 0);
      ctx.save(); ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.05)'; ctx.drawImage(tmp, 0, 0); ctx.filter = 'none';
      ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
  }

  _compose(ctx, t) {
    const { W, H, K } = this;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    if (t < K.slash) { this.shotVista(ctx, t); this.slashHairline(ctx, t); return; }
    if (t < K.slash + 0.75) {
      this.shotWorld(this.cb, t); this.shotVista(this.ca, Math.min(t, K.slash + 0.1));
      ctx.drawImage(this.bufB, 0, 0);
      this.slashSplit(ctx, this.bufA, t);
      return;
    }
    if (t >= K.wipe) {
      if (t < K.wipe + 0.7) { this.shotWorld(this.ca, t); this.logo.draw(this.cb, t); bladeWipe(ctx, this.bufA, this.bufB, prog(t, K.wipe, K.wipe + 0.65), W, H); }
      else this.logo.draw(ctx, t);
      return;
    }
    this.shotWorld(ctx, t);
    this.strikeFlash(ctx, t);
  }

  post(ctx, t, frame) {
    const { W, H, K } = this;
    const paper = prog(t, K.wipe + 0.15, K.wipe + 0.65);   // 0 = ink world, 1 = paper scene
    bloom(ctx, W, H, { amt: (window.__bloomK ?? 1) * lerp(0.2, 0.1, paper), blur: 30 });
    vignette(ctx, W, H, lerp(0.5, 0.0, paper), 0.62);
    grain(ctx, W, H, frame, lerp(0.04, 0.03, paper));
    const fi = 1 - prog(t, 0, 0.5);
    if (fi > 0) { ctx.fillStyle = `rgba(4,8,7,${fi})`; ctx.fillRect(0, 0, W, H); }
  }

  // =================================================================================================
  // S1 — the vista, layered in depth
  // =================================================================================================
  shotVista(ctx, t) {
    const w = this.world, K = this.K, p = prog(t, 0, K.slash + 0.2);
    const cam = { u: 560, v: 322, d: lerp(10.2, 9.9, ease.inOutQuad(p)), yaw: lerp(1.2, -1.0, ease.inOutQuad(p)), pitch: lerp(-0.6, 0.8, p), roll: 0 };
    w.setCamera(cam);
    w.setLayers(1, { d0: 10.5, c0: [0, -3.18] });
    const reveal = [[0.2, 1.8], [0.7, 2.1], [0.9, 2.4], [1.2, 2.6], [1.0, 2.0]];
    w.layers.forEach((m, i) => { m.material.opacity = ease.outQuad(prog(t, reveal[i][0], reveal[i][1])); });
    w.mists.forEach((m, i) => {
      m.visible = true;
      m.position.set(Math.sin(t * 0.18 + m.userData.phase * 6) * 0.9 + (i - 1) * 0.4, -4.2 + m.userData.y + 0.7 * i - 0.2, m.userData.z + 0.001);
      m.material.opacity = m.userData.op * ease.outQuad(prog(t, 0.8 + i * 0.3, 2.6));
    });
    w.page.visible = false; w.pageShadow.visible = false; w.wall.visible = false; w.fog.forEach((f) => (f.visible = false));
    Object.values(w.type).forEach((o) => (o.mesh.visible = false));
    w.liftBubbles(0);
    // the caption box and its first glyph arrive together (no empty box)
    const capIn = ease.outCubic(prog(t, K.captionIn, K.captionIn + 0.3));
    this.bubbleStates({ caption: { p: 0, alpha: capIn, reveal: prog(t, K.captionIn + 0.12, K.slash - 0.1) }, q: { p: 0, alpha: 0 }, a: { p: 0, alpha: 0 } });
    w.render();
    ctx.filter = 'contrast(1.14) brightness(0.9) saturate(1.08)';
    ctx.drawImage(w.renderer.domElement, 0, 0);
    ctx.filter = 'none';
  }

  bubbleStates(map) {
    const w = this.world;
    for (const [id, st] of Object.entries(map)) {
      const o = w.bubbles[id];
      if (o.b.draw(st)) o.tex.needsUpdate = true;
      o.mesh.visible = (st.alpha ?? 1) > 0.002;
      o.shadow.visible = o.mesh.visible;
    }
  }

  slashHairline(ctx, t) {
    const { W, H, K } = this;
    const a = prog(t, K.slash - 0.2, K.slash - 0.04);
    if (a <= 0) return;
    const ang = -1.05, cx = W * 0.58, cy = H * 0.5, hp = halfPlanes(W, H, cx, cy, ang);
    const L = 1500, d = hp.d;
    const x0 = cx - d[0] * L, y0 = cy - d[1] * L, x1 = cx + d[0] * L, y1 = cy + d[1] * L;
    const e = ease.strike(a);
    ctx.save();
    ctx.shadowColor = 'rgba(160,240,80,0.95)'; ctx.shadowBlur = 24;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(160,240,80,0)'); g.addColorStop(Math.max(0.01, e), 'rgba(235,255,210,1)'); g.addColorStop(Math.min(1, e + 0.001), 'rgba(160,240,80,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  /** the old shot (buf) splits along the blade line and its halves fly apart, revealing what is behind */
  slashSplit(ctx, buf, t) {
    const { W, H, K } = this, T = K.slash;
    const ang = -1.05, cx = W * 0.58, cy = H * 0.5;
    const open = 120 * ease.outExpo(prog(t, T, T + 0.16)) + 1500 * ease.inCubic(prog(t, T + 0.14, T + 0.75));
    const slide = 60 * ease.outExpo(prog(t, T, T + 0.3));
    const hp = halfPlanes(W, H, cx, cy, ang);
    const [nx, ny] = hp.n, [dx, dy] = hp.d;
    const glowA = 1 - prog(t, T, T + 0.55);
    for (const sgn of [1, -1]) {
      ctx.save();
      const off = sgn * open, sl = sgn * slide;
      const poly = (sgn > 0 ? halfPlanes(W, H, cx + dx * sl, cy + dy * sl, ang, off).pos : halfPlanes(W, H, cx - dx * sl, cy - dy * sl, ang, -open).neg);
      ctx.clip(polyPath(poly));
      ctx.translate(nx * off + dx * sl, ny * off + dy * sl);
      ctx.drawImage(buf, 0, 0);
      ctx.restore();
    }
    if (glowA > 0) {
      const gap = Math.max(open * 2, 6);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, -gap / 2 - 26, 0, gap / 2 + 26);
      g.addColorStop(0, 'rgba(124,195,38,0)'); g.addColorStop(0.42, `rgba(160,240,80,${0.65 * glowA})`); g.addColorStop(0.5, `rgba(240,255,220,${glowA})`); g.addColorStop(0.58, `rgba(160,240,80,${0.65 * glowA})`); g.addColorStop(1, 'rgba(124,195,38,0)');
      ctx.fillStyle = g; ctx.globalCompositeOperation = 'lighter'; ctx.fillRect(-2600, -gap / 2 - 26, 5200, gap + 52);
      ctx.restore();
    }
  }

  /** the strike: context arrives, a diagonal flash + shock line, and the page is rebuilt */
  strikeFlash(ctx, t) {
    const { W, H, K } = this;
    const k = prog(t, K.strike, K.strike + 0.55);
    if (k <= 0 || k >= 1) return;
    const fl = Math.exp(-(t - K.strike) / 0.06) * 0.55;
    ctx.save(); ctx.fillStyle = `rgba(214,255,160,${fl})`; ctx.fillRect(0, 0, W, H); ctx.restore();
    const ang = -1.05, cx = W * 0.5, cy = H * 0.5;
    const a = 1 - k;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.globalCompositeOperation = 'lighter';
    const spread = 40 + 260 * ease.outExpo(k);
    const g = ctx.createLinearGradient(0, -spread, 0, spread);
    g.addColorStop(0, 'rgba(124,195,38,0)'); g.addColorStop(0.46, `rgba(160,240,80,${0.5 * a})`); g.addColorStop(0.5, `rgba(240,255,220,${0.95 * a})`); g.addColorStop(0.54, `rgba(160,240,80,${0.5 * a})`); g.addColorStop(1, 'rgba(124,195,38,0)');
    ctx.fillStyle = g; ctx.fillRect(-2400, -spread, 4800, spread * 2);
    ctx.restore();
  }

  // =================================================================================================
  // S2+ — the page strip in the void
  // =================================================================================================
  camKeys() {
    const K = this.K;
    return [
      // S2 — land on the page, read it, glide down to the answer
      { t: K.slash, u: 560, v: 520, d: 38, yaw: -18, pitch: 10, roll: -8, e: ease.cam },
      { t: 4.3, u: 600, v: 250, d: 12.6, yaw: -10, pitch: 4, roll: -3 },
      { t: 5.4, u: 566, v: 278, d: 11.5, yaw: -7, pitch: 2.4, roll: -1.8 },
      { t: 6.3, u: 730, v: 760, d: 11.2, yaw: 0.5, pitch: 0.4, roll: 0.2 },
      { t: K.pullback, u: 848, v: 1005, d: 8.8, yaw: 5, pitch: -1, roll: 0.5, rest: true },
      // S3 — pull back; the whole page, with room to read the title
      { t: K.titleRead, u: 555, v: 1066, d: 42, yaw: -1, pitch: 0, roll: -5, rest: true },
      { t: K.titlePage, u: 556, v: 1066, d: 44, yaw: -1.6, pitch: 0, roll: -5.6 },
      { t: K.titleEnd, u: 556, v: 1058, d: 41.5, yaw: -1.0, pitch: 0, roll: -4.4 },
      // S4 — down to the question + answer; context arrives; the page is rebuilt; read it
      { t: K.glossHave + 0.1, u: 552, v: 640, d: 24.4, yaw: -3, pitch: 1, roll: -1.2 },
      { t: K.strike, u: 552, v: 628, d: 22.2, yaw: -2.4, pitch: 0.8, roll: -0.9 },
      { t: K.strike + 1.4, u: 516, v: 274, d: 15.4, yaw: -3, pitch: 1.4, roll: -0.5 },
      { t: K.toAnswer, u: 534, v: 266, d: 12.9, yaw: -2.2, pitch: 1.1, roll: -0.4 },
      { t: K.andMore + 0.55, u: 846, v: 1008, d: 8.3, yaw: 3.5, pitch: -0.6, roll: 0.4, rest: true },
      { t: K.s5Pull, u: 846, v: 1008, d: 8.1, yaw: 3.5, pitch: -0.6, roll: 0.4, rest: true },
      // S5 — WORDS CHANGE. THE ART STAYS.: three-quarter view with the type on the left
      { t: K.words, u: 560, v: 330, d: 22.5, yaw: -38, pitch: 9, roll: 1.5, sx: 0.19, rest: true },
      { t: K.words + 1.4, u: 560, v: 340, d: 21.5, yaw: -27, pitch: 7, roll: 1, sx: 0.19 },
      { t: K.words + 2.6, u: 560, v: 400, d: 22, yaw: -14, pitch: 3, roll: 0, sx: 0.15 },
      // S6 — back out into the library; the camera never settles until the wipe
      { t: K.wallIn, u: 552, v: 760, d: 24.5, yaw: -8, pitch: 5, roll: -2, sx: 0.1 },
      { t: K.wallIn + 2.1, u: 550, v: 1000, d: 72, yaw: -6, pitch: 7, roll: -3.5, sx: 0 },
      { t: K.wipe - 0.6, u: 548, v: 1050, d: 122, yaw: -4.5, pitch: 8, roll: -4 },
      { t: K.wipe + 0.6, u: 548, v: 1056, d: 128, yaw: -4.2, pitch: 8, roll: -4.2, rest: true },
    ];
  }
  cameraAt(t) { return this.camera(t); }

  shotWorld(ctx, t) {
    const w = this.world, { W, H, K } = this;
    const C = this.cameraAt(t);
    w.setCamera(C);
    w.setLayersVisible(false);                         // the page texture already carries the flat vista
    w.page.visible = true; w.pageShadow.visible = true;
    this.wallState(t);
    // drifting fog between camera and page
    w.fog.forEach((f, i) => {
      f.visible = t < K.wallIn + 0.3;
      f.position.set(Math.sin(t * 0.07 + i * 2.1) * 6 + (i - 1.5) * 5, -(C.v / 100) + Math.cos(t * 0.05 + i) * 2.5, 1.5 + i * 1.7);
      f.material.opacity = 0.13 * ease.outQuad(prog(t, K.slash, K.slash + 1.3));
    });
    const B = this.bubbleTimeline(t);
    this.bubbleStates(B.states);
    w.liftBubbles(B.lift);
    for (const [id, pop] of Object.entries(B.pop)) w.bubbles[id].mesh.scale.setScalar(1 + pop);
    this.typeState(t);
    w.render();
    ctx.filter = 'contrast(1.1) saturate(1.06) brightness(0.97)';
    ctx.drawImage(w.renderer.domElement, 0, 0);
    ctx.filter = 'none';
    this.overlaysWorld(ctx, t, B);
  }

  // ---- the four-word title behind the strip (S3) ---------------------------------------------------
  typeState(t) {
    const w = this.world, T = w.type, K = this.K;
    const words = [['read', K.titleRead], ['the', K.titleThe], ['whole', K.titleWhole], ['page', K.titlePage]];
    const out = ease.inOutCubic(prog(t, K.titleEnd, K.titleEnd + 0.55));
    words.forEach(([name, t0]) => {
      const o = T[name], u = o.mesh.material.uniforms;
      const k = prog(t, t0, t0 + 0.55);
      o.mesh.visible = k > 0 && out < 1;
      u.reveal.value = ease.outQuart(k);
      u.alpha.value = 1 - out;
      o.mesh.position.y = (name === 'read' || name === 'whole' ? -8.6 : -12.2) - (1 - ease.outQuart(k)) * 0.9;
    });
  }

  // ---- bubbles over time --------------------------------------------------------------------------------
  bubbleTimeline(t) {
    const K = this.K;
    const hl = (a, b) => { const k = prog(t, a, b); return k > 0 && k < 1 ? k : 0; };
    const E = ease.inOutCubic;
    // S5: for a beat the text layer flickers back to the source language ("words change")
    const f0 = K.change + 0.63;
    const flick = (t >= f0 && t < f0 + 0.12) || (t >= f0 + 0.24 && t < f0 + 0.36);
    const capP = flick ? 0 : E(prog(t, K.morphCaption, K.morphCaption + 0.8));
    const qP = flick ? 0 : E(prog(t, K.morphQ, K.morphQ + 0.8));

    // the answer bubble: source (有。) -> isolated word gloss reel -> context arrives -> YES.
    let aState;
    if (t < K.glossHave) aState = { p: 0, alpha: 1, hl: hl(K.readA + 0.05, K.readA + 0.6) };
    else if (t < K.strike) {
      const step = (t0, rate = 0.1) => ease.outCubic(prog(t, t0 - rate, t0));
      const s = step(K.glossOwn) + step(K.glossExist) + step(K.strike, 0.14);     // ...and locks onto the right word as context arrives
      const jit = (1 - prog(t, K.glossHave, K.glossHave + 0.1)) * ((Math.round(t * 60) % 2) ? 6 : -6);
      aState = { p: 1, alpha: 1, glow: 0, gag: { words: GLOSS, s, jx: jit, jy: -jit * 0.4 } };
    } else {
      aState = { p: flick ? 0 : 1, alpha: 1, sub: flick ? 1 : ease.outCubic(prog(t, K.andMore, K.andMore + 0.45)),
        glow: expDecay(t, K.strike, 4) * 0.8 + expDecay(t, K.andMore, 5) * 0.6 };
    }
    const pops = { a: expDecay(t, K.strike, 9) * 0.06 + expDecay(t, K.andMore, 9) * 0.03, q: expDecay(t, K.morphQ + 0.8, 9) * 0.03, caption: expDecay(t, K.morphCaption + 0.8, 9) * 0.04 };
    // text layer lifts off the art during S5 (so the art is visibly "untouched" underneath)
    const lift = 3.2 * E(prog(t, K.s5Pull + 0.4, K.words)) - 3.15 * E(prog(t, K.stays + 0.3, K.stays + 1.2));
    const qGlow = Math.max(expDecay(t, K.morphQ + 0.8, 5) * 0.8, 0.9 * Math.max(0, 1 - Math.abs(t - (K.glossExist - 0.05)) * 7));
    return {
      lift: Math.max(lift, 0),
      pop: pops,
      states: {
        caption: { p: capP, morph: capP > 0 && capP < 1 ? 1 : 0, alpha: 1, hl: hl(K.readCaption + 0.05, K.readCaption + 0.55), glow: expDecay(t, K.morphCaption + 0.8, 5) * 0.8 },
        q: { p: qP, morph: qP > 0 && qP < 1 ? 1 : 0, alpha: 1, hl: hl(K.readQ + 0.1, K.readQ + 0.7), glow: qGlow },
        a: aState,
      },
    };
  }

  // ---- overlays: reading marks, context threads, art trace ---------------------------------------------
  overlaysWorld(ctx, t, B) {
    const w = this.world, K = this.K;
    const snap = (t0, dur = 0.3) => prog(t, t0, t0 + dur);
    const P = (id) => (B.states[id].p > 0.5 ? REGIONS[id].en : REGIONS[id].zh);
    const sched = [
      ['caption', K.readCaption, K.pullback + 1.3], ['q', K.readQ, K.pullback + 1.3], ['a', K.readA, K.titleEnd],
      ['a', K.glossHave, K.strike - 0.05],
      ['q', K.strike + 0.05, K.toAnswer - 0.3], ['caption', K.strike + 0.2, K.toAnswer - 0.3], ['a', K.toAnswer + 0.3, K.s5Pull + 0.1],
    ];
    for (const [id, t0, t1] of sched) {
      if (t < t0 || t > t1 + 0.4) continue;
      brackets(ctx, w, P(id), { k: snap(t0), out: prog(t, t1, t1 + 0.35), pulse: Math.max(0, 1 - Math.abs(t - t0 - 0.05) * 4) });
    }
    this.threads(ctx, t);
    this.artTrace(ctx, t);
    this.s5Type(ctx, t);
  }

  /** S5 headline: WORDS CHANGE. / THE ART STAYS. */
  s5Type(ctx, t) {
    const K = this.K;
    if (t < K.words - 0.1 || t > K.textOut + 0.4) return;
    const x = 96, y1 = 410, y2 = 560, SZ = 136;
    const g = '#7CC326';
    slicedText(ctx, 'WORDS', x, y1, { size: SZ, reveal: prog(t, K.words, K.words + 0.35), out: prog(t, K.wordsOut, K.wordsOut + 0.35) });
    slicedText(ctx, 'CHANGE.', x, y2, { size: SZ, reveal: prog(t, K.change, K.change + 0.4), out: prog(t, K.wordsOut + 0.05, K.wordsOut + 0.4) });
    if (t < K.theArt) brushStroke(ctx, x - 6, y2 + 28, x + 730, y2 + 20, { k: ease.outCubic(prog(t, K.change + 0.4, K.change + 0.9)), width: 24, seed: 4 });
    slicedText(ctx, 'THE ART', x, y1, { size: SZ, reveal: prog(t, K.theArt, K.theArt + 0.35), out: prog(t, K.textOut - 0.05, K.textOut + 0.3) });
    slicedText(ctx, 'STAYS.', x, y2, { size: SZ, reveal: prog(t, K.stays, K.stays + 0.4), out: prog(t, K.textOut, K.textOut + 0.35), color: g });
    if (t >= K.stays + 0.1 && t < K.textOut + 0.4) brushStroke(ctx, x - 6, y2 + 28, x + 580, y2 + 22, { k: ease.outCubic(prog(t, K.stays + 0.4, K.stays + 0.9)), width: 22, seed: 9, color: '#F7F8F7' });
  }

  threads(ctx, t) {
    const w = this.world, K = this.K;
    const cq = [[858, 240, 0.12], [770, 270, 0.2], [660, 250, 0.2], [576, 196, 0.12]];
    const qa = [[500, 296, 0.12], [610, 440, 0.25], [740, 640, 0.25], [800, 790, 0.2], [820, 880, 0.12]];
    const d1 = ease.inOutCubic(prog(t, 5.6, 6.3)), d2 = ease.inOutCubic(prog(t, 7.0, 7.9));
    const fade = 1 - prog(t, K.strike + 0.3, K.strike + 0.9);
    if (fade <= 0) return;
    const idle = (t0) => (t > t0 ? ((t - t0) / 1.2) % 1.6 : -1);
    thread(ctx, w, cq, { draw: d1, alpha: fade, pulse: t > K.titleThe && t < K.titleEnd ? idle(K.titleThe + 0.1) : -1 });
    // context travels from the question to the answer exactly as the reel locks onto the right word
    const send = prog(t, K.glossExist - 0.05, K.strike);
    const sending = t >= K.glossExist - 0.05 && t < K.strike + 0.2;
    thread(ctx, w, qa, {
      draw: d2, alpha: fade, width: sending ? 15 : 9, glow: sending ? 1.8 : 1,
      pulse: sending ? ease.inOutCubic(send) : (t > K.titleWhole && t < K.glossHave ? idle(K.titleWhole) : -1), pulseW: sending ? 0.14 : 0.1,
    });
  }

  /** green line-trace over the art's silhouette (S5: "the art stays") */
  artTrace(ctx, t) {
    const K = this.K;
    const k = ease.inOutCubic(prog(t, K.change + 1.0, K.change + 2.6)), out = prog(t, K.textOut - 0.2, K.textOut + 0.4);
    if (k <= 0 || out >= 1 || !this.trace) return;
    const w = this.world;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(124,195,38,0.95)'; ctx.shadowBlur = 16;
    ctx.strokeStyle = `rgba(150,235,70,${1 - out})`; ctx.lineWidth = 3;
    for (const path of this.trace) {
      const n = Math.max(2, Math.floor(path.length * k));
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const q = w.project(path[i][0], path[i][1], 0.03); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
      ctx.stroke();
    }
    // moon ring
    const m = this.A.vistaMeta.moon, mc = w.project(50 + m.x, 40 + m.y, 0.03), me = w.project(50 + m.x + m.r, 40 + m.y, 0.03);
    const mr = Math.hypot(me.x - mc.x, me.y - mc.y);
    ctx.beginPath(); ctx.arc(mc.x, mc.y, mr, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.restore();
  }

  // ---- the library of pages (the finale) ----------------------------------------------------------------------
  wallState(t) {
    const w = this.world, K = this.K;
    const on = t > K.wallIn - 0.1;
    w.wall.visible = on;
    if (!on) return;
    for (const m of w.wallPages) {
      const u = m.material.uniforms, ud = m.userData;
      u.fade.value = ease.outQuad(prog(t, K.wallIn + ud.dist * 0.012, K.wallIn + 1.0 + ud.dist * 0.012)) * ud.alpha;
      const t0 = K.wave + ud.dist * 0.026 + ud.delay;
      u.wave.value = ease.inOutQuad(prog(t, t0, t0 + ud.dur));
      m.position.y = ud.cy + Math.sin(t * 0.55 + ud.phase * 6.28) * 0.28;
      m.rotation.z = ud.rz + Math.sin(t * 0.31 + ud.phase * 5) * 0.012;
    }
  }
}
