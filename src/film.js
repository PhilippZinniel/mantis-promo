// The director: maps film time -> pixels. Shots draw into a 2D context; transitions composite two shots.
import { clamp, lerp, smoothstep, ease, prog, seg, TAU, PAL, rng } from './lib/util.js';
import { REGIONS, PANELS, PAGE, BUBBLES } from './strip.js';
import { brackets, thread, halfPlanes, polyPath, blade, grain, vignette, bloom, slicedText, brushStroke, bladeWipe } from './fx.js';
import { LogoScene, LOGO_T0 } from './logoScene.js';
import { wx, wy } from './world.js';

/** piecewise interpolation of numeric camera/state keys; each key may carry `e` (easing of the segment that follows it) */
export function track(keys, t) {
  if (t <= keys[0].t) return { ...keys[0] };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { ...last };
  let i = 0; while (keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1], k = (a.e ?? ease.cam)(prog(t, a.t, b.t));
  const out = {};
  for (const key of Object.keys(b)) if (key !== 't' && key !== 'e') out[key] = lerp(a[key] ?? b[key], b[key], k);
  return out;
}

const WHIP = ease.inOutExpo;
const expDecay = (t, t0, rate = 6) => (t < t0 ? 0 : Math.exp(-(t - t0) * rate));

export class Film {
  constructor(canvas, world, assets) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.world = world; this.A = assets;
    this.W = canvas.width; this.H = canvas.height; this.fps = assets.cues.fps; this.dur = assets.cues.duration;
    const mk = () => { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; return c; };
    this.bufA = mk(); this.bufB = mk(); this.accum = mk();
    this.ca = this.bufA.getContext('2d'); this.cb = this.bufB.getContext('2d');
    this.trace = assets.trace;
    this.logo = new LogoScene(assets, this.W, this.H);
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
    const frame = Math.round(t * this.fps);
    if (shutter === undefined) shutter = (t >= 25.5 && t < 26.3) ? 0.22 : 0.5;     // crisper blade on the wipe
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
    if (t < 3.0) return 1;
    if (t >= 25.5 && t < 26.3) return 10;
    if (t >= 26.3) return 1;
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
  /** camera shake from the film's impacts (decaying, deterministic) */
  shakeAt(t) {
    const hits = [[3.2, 15], [8.0, 11], [9.5, 8], [10.8, 13], [12.0, 24], [13.75, 5], [19.8, 8], [26.0, 15], [28.0, 11]];
    let x = 0, y = 0, k = 0;
    for (const [h, a] of hits) {
      const dt = t - h; if (dt < 0 || dt > 0.6) continue;
      const e = Math.exp(-dt * 11);
      x += a * e * Math.sin(dt * 95 + h * 3.1); y += a * 0.7 * e * Math.sin(dt * 83 + h * 1.7 + 1);
      k = Math.max(k, e * a / 24);
    }
    return { x, y, k };
  }

  compose(ctx, t) {
    const { W, H } = this;
    const sh = this.shakeAt(t);
    if (Math.abs(sh.x) + Math.abs(sh.y) > 0.4) {
      // render the frame normally into a buffer, then place it with the shake offset (slight over-scale hides the edges)
      const tgt = this.bufS ?? (this.bufS = (() => { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; return c; })());
      this._compose(tgt.getContext('2d'), t);
      ctx.fillStyle = '#050a09'; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2 + sh.x, H / 2 + sh.y); ctx.scale(1 + 0.012 + 0.008 * sh.k, 1 + 0.012 + 0.008 * sh.k); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(tgt, 0, 0); ctx.restore();
    } else this._compose(ctx, t);
    // manga impact frame: two inverted frames on the film's biggest strike
    if (t >= 12.0 - 1e-6 && t < 12.0 + 2.0 / this.fps - 1e-6) {
      const tmp = this.bufS ?? (this.bufS = (() => { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; return c; })());
      const x = tmp.getContext('2d'); x.clearRect(0, 0, W, H); x.drawImage(ctx.canvas, 0, 0);
      ctx.save(); ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.05)'; ctx.drawImage(tmp, 0, 0); ctx.filter = 'none';
      ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
  }

  _compose(ctx, t) {
    const { W, H } = this;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    if (t < 3.2) { this.shotVista(ctx, t); this.slashHairline(ctx, t); return; }
    if (t < 3.95) {
      this.shotWorld(this.cb, t); this.shotVista(this.ca, Math.min(t, 3.3));
      ctx.drawImage(this.bufB, 0, 0);
      this.slashSplit(ctx, this.bufA, t);
      return;
    }
    if (t >= 25.55) {
      if (t < 26.25) { this.shotWorld(this.ca, t); this.logo.draw(this.cb, t); bladeWipe(ctx, this.bufA, this.bufB, prog(t, 25.55, 26.2), W, H); }
      else this.logo.draw(ctx, t);
      return;
    }
    this.shotWorld(ctx, t);
    this.strikeFlash(ctx, t);
  }

  post(ctx, t, frame) {
    const { W, H } = this;
    const paper = prog(t, 25.7, 26.2);                     // 0 = ink world, 1 = paper scene
    bloom(ctx, W, H, { amt: lerp(0.22, 0.1, paper), blur: 30 });
    vignette(ctx, W, H, lerp(0.5, 0.0, paper), 0.62);
    grain(ctx, W, H, frame, lerp(0.042, 0.03, paper));
    const fi = 1 - prog(t, 0, 0.5);
    if (fi > 0) { ctx.fillStyle = `rgba(4,8,7,${fi})`; ctx.fillRect(0, 0, W, H); }
  }

  // =================================================================================================
  // S1 — the vista, layered in depth
  // =================================================================================================
  shotVista(ctx, t) {
    const w = this.world, p = prog(t, 0, 3.4);
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
    const capIn = ease.outCubic(prog(t, 2.0, 2.5));
    this.bubbleStates({ caption: { p: 0, alpha: capIn, reveal: prog(t, 2.35, 3.1) }, q: { p: 0, alpha: 0 }, a: { p: 0, alpha: 0 } });
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
    const { W, H } = this;
    const a = prog(t, 3.0, 3.16);
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
    const { W, H } = this;
    const ang = -1.05, cx = W * 0.58, cy = H * 0.5;
    const open = 120 * ease.outExpo(prog(t, 3.2, 3.36)) + 1500 * ease.inCubic(prog(t, 3.34, 3.95));
    const slide = 60 * ease.outExpo(prog(t, 3.2, 3.5));
    const hp = halfPlanes(W, H, cx, cy, ang);
    const [nx, ny] = hp.n, [dx, dy] = hp.d;
    const glowA = 1 - prog(t, 3.2, 3.75);
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

  /** the second strike (12.0): a diagonal flash + shock line as the page is "read" and rebuilt */
  strikeFlash(ctx, t) {
    const { W, H } = this;
    const k = prog(t, 12.0, 12.55);
    if (k <= 0 || k >= 1) return;
    const fl = Math.exp(-(t - 12.0) / 0.06) * 0.55;
    ctx.save(); ctx.fillStyle = `rgba(214,255,160,${fl})`; ctx.fillRect(0, 0, this.W, this.H); ctx.restore();
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
    return [
      { t: 3.2, u: 560, v: 520, d: 38, yaw: -18, pitch: 10, roll: -8 },
      { t: 4.3, u: 600, v: 250, d: 12.6, yaw: -10, pitch: 4, roll: -3, e: ease.land },
      { t: 5.8, u: 540, v: 292, d: 11, yaw: -6, pitch: 2, roll: -1.5, e: ease.inOutCubic },
      { t: 6.5, u: 790, v: 880, d: 10.8, yaw: 3, pitch: 0, roll: 0.8, e: ease.cam },
      { t: 7.1, u: 850, v: 1010, d: 8.8, yaw: 5, pitch: -1, roll: 0.5, e: ease.inOutQuart },
      { t: 8.0, u: 555, v: 1065, d: 42, yaw: -1, pitch: 0, roll: -5, e: ease.cam },
      { t: 9.8, u: 550, v: 1070, d: 47, yaw: -2, pitch: 0, roll: -6, e: ease.inOutCubic },
      { t: 10.8, u: 850, v: 1010, d: 8.4, yaw: 0, pitch: 0, roll: 0, e: ease.inOutExpo },
      { t: 12.0, u: 850, v: 1010, d: 7.8, yaw: 0, pitch: 0, roll: 0, e: WHIP },
      { t: 12.45, u: 325, v: 196, d: 7.2, yaw: 0, pitch: 0, roll: 0, e: ease.cam },
      { t: 14.0, u: 335, v: 200, d: 6.9, yaw: 0, pitch: 0, roll: 0, e: WHIP },
      { t: 14.45, u: 800, v: 218, d: 6.9, yaw: 0, pitch: 0, roll: 0, e: ease.cam },
      { t: 14.95, u: 806, v: 220, d: 6.7, yaw: 0, pitch: 0, roll: 0, e: WHIP },
      { t: 15.4, u: 852, v: 1010, d: 7.4, yaw: 0, pitch: 0, roll: 0, e: ease.cam },
      { t: 15.9, u: 852, v: 1010, d: 7.6, yaw: 0, pitch: 0, roll: 0, e: ease.inOutCubic },
      { t: 17.0, u: 550, v: 480, d: 22, yaw: 0, pitch: 0, roll: 0, e: ease.inOutCubic },
      { t: 18.1, u: 560, v: 330, d: 22.5, yaw: -38, pitch: 9, roll: 1.5, sx: 0.19, e: ease.cam },
      { t: 19.5, u: 560, v: 340, d: 21.5, yaw: -27, pitch: 7, roll: 1, sx: 0.19, e: ease.cam },
      { t: 20.5, u: 560, v: 400, d: 22, yaw: -14, pitch: 3, roll: 0, sx: 0.15, e: ease.inOutCubic },
      { t: 21.4, u: 550, v: 900, d: 40, yaw: -8, pitch: 6, roll: -2, sx: 0, e: ease.inOutCubic },
      { t: 25.3, u: 550, v: 1060, d: 150, yaw: -5, pitch: 8, roll: -4, sx: 0, e: ease.cam },
      { t: 26.4, u: 550, v: 1060, d: 160, yaw: -4, pitch: 8, roll: -4, sx: 0 },
    ].map((k) => ({ sx: 0, ...k }));
  }
  cameraAt(t) { return track(this.camKeys(), t); }

  shotWorld(ctx, t) {
    const w = this.world, { W, H } = this;
    const C = this.cameraAt(t);
    w.setCamera(C);
    w.setLayersVisible(false);                         // the page texture already carries the flat vista
    w.page.visible = true; w.pageShadow.visible = true;
    // wall of strips (finale) — visible only once the camera backs out
    this.wallState(t);
    // drifting fog between camera and page
    w.fog.forEach((f, i) => {
      f.visible = t < 21.5;
      f.position.set(Math.sin(t * 0.07 + i * 2.1) * 6 + (i - 1.5) * 5, -(C.v / 100) + Math.cos(t * 0.05 + i) * 2.5, 1.5 + i * 1.7);
      f.material.opacity = 0.13 * ease.outQuad(prog(t, 3.2, 4.5));
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
    const w = this.world, T = w.type;
    const words = [['read', 8.0], ['the', 8.5], ['whole', 9.0], ['page', 9.5]];
    const out = ease.inOutCubic(prog(t, 10.0, 10.55));
    words.forEach(([name, t0], i) => {
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
    const hl = (a, b) => { const k = prog(t, a, b); return k > 0 && k < 1 ? k : 0; };
    const E = ease.inOutCubic;
    // caption: reads at 4.55, rebuilt 14.1–14.9
    const flick = (t >= 18.28 && t < 18.4) || (t >= 18.52 && t < 18.64);
    const capP = flick ? 0 : E(prog(t, 14.1, 14.95));
    // q: reads at 5.1, rebuilt 12.5–13.7
    const qP = flick ? 0 : E(prog(t, 12.5, 13.75));
    // a: gag 11.0–11.55, YES at 11.55, sub line at 15.0
    let aState;
    const gagOn = t >= 10.98 && t < 11.55;
    if (gagOn) {
      const jit = (1 - prog(t, 11.0, 11.14)) * ((Math.round(t * 60) % 2) ? 7 : -7);
      aState = { p: 1, alpha: 1, gag: { l1: 'HAVE.', l2: 'STILL HAVE MORE.', color: '#6a7a75', dx: jit, dy: -jit * 0.4, strike: ease.outCubic(prog(t, 11.2, 11.38)) }, glow: 0 };
    } else if (t < 10.98) aState = { p: 0, alpha: 1, hl: hl(6.55, 7.1) };
    else aState = { p: flick ? 0 : 1, alpha: 1, sub: flick ? 1 : ease.outCubic(prog(t, 15.0, 15.45)), glow: expDecay(t, 11.55, 4) * 0.8 + expDecay(t, 15.0, 5) * 0.6 };
    const pops = { a: expDecay(t, 11.55, 9) * 0.05 + expDecay(t, 15.0, 9) * 0.03, q: expDecay(t, 13.75, 9) * 0.03, caption: expDecay(t, 14.95, 9) * 0.04 };
    // text-layer lift (S5)
    const lift = 3.2 * ease.inOutCubic(prog(t, 17.0, 18.0)) - 3.15 * ease.inOutCubic(prog(t, 19.5, 20.4));
    return {
      lift: Math.max(lift, 0),
      pop: pops,
      states: {
        caption: { p: capP, morph: capP > 0 && capP < 1 ? 1 : 0, alpha: 1, hl: hl(4.55, 5.05), glow: expDecay(t, 14.95, 5) * 0.8 },
        q: { p: qP, morph: qP > 0 && qP < 1 ? 1 : 0, alpha: 1, hl: hl(5.1, 5.7), glow: expDecay(t, 13.75, 5) * 0.8 },
        a: aState,
      },
    };
  }

  // ---- overlays: reading marks, context threads, art trace ---------------------------------------------
  overlaysWorld(ctx, t, B) {
    const w = this.world;
    const snap = (t0, dur = 0.3) => prog(t, t0, t0 + dur);
    const P = (id) => (B.states[id].p > 0.5 ? REGIONS[id].en : REGIONS[id].zh);
    const sched = [
      ['caption', 4.5, 8.4], ['q', 5.0, 8.4], ['a', 6.5, 11.0],
      ['q', 12.3, 13.9], ['caption', 13.95, 15.2], ['a', 15.0, 15.9],
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
    if (t < 17.4 || t > 21.4) return;
    const x = 96, y1 = 410, y2 = 560, SZ = 136;
    const g = '#7CC326';
    slicedText(ctx, 'WORDS', x, y1, { size: SZ, reveal: prog(t, 17.45, 17.8), out: prog(t, 19.15, 19.5) });
    const cw = slicedText(ctx, 'CHANGE.', x, y2, { size: SZ, reveal: prog(t, 17.65, 18.05), out: prog(t, 19.2, 19.55) });
    if (t < 19.6) brushStroke(ctx, x - 6, y2 + 28, x + 730, y2 + 20, { k: ease.outCubic(prog(t, 18.05, 18.55)), width: 24, seed: 4 });
    slicedText(ctx, 'THE ART', x, y1, { size: SZ, reveal: prog(t, 19.6, 19.95), out: prog(t, 20.95, 21.3) });
    slicedText(ctx, 'STAYS.', x, y2, { size: SZ, reveal: prog(t, 19.8, 20.2), out: prog(t, 21.0, 21.35), color: g });
    if (t >= 19.9 && t < 21.4) brushStroke(ctx, x - 6, y2 + 28, x + 580, y2 + 22, { k: ease.outCubic(prog(t, 20.2, 20.7)), width: 22, seed: 9, color: '#F7F8F7' });
  }

  threads(ctx, t) {
    const w = this.world;
    const cq = [[858, 240, 0.12], [770, 270, 0.2], [660, 250, 0.2], [576, 196, 0.12]];
    const qa = [[500, 296, 0.12], [610, 440, 0.25], [740, 640, 0.25], [800, 790, 0.2], [820, 880, 0.12]];
    const d1 = ease.inOutCubic(prog(t, 5.6, 6.3)), d2 = ease.inOutCubic(prog(t, 7.0, 7.9));
    const fade = 1 - prog(t, 11.6, 12.1);
    if (fade <= 0) return;
    const idle = (t0) => (t > t0 ? ((t - t0) / 1.2) % 1.6 : -1);
    thread(ctx, w, cq, { draw: d1, alpha: fade, pulse: t > 8.6 && t < 10.9 ? idle(8.6) : -1 });
    thread(ctx, w, qa, { draw: d2, alpha: fade, pulse: t > 11.0 ? clamp(prog(t, 11.0, 11.45)) : (t > 8.9 ? idle(8.9) : -1) });
  }

  /** green line-trace over the art's silhouette (S5: "the art stays") */
  artTrace(ctx, t) {
    const k = ease.inOutCubic(prog(t, 18.6, 20.2)), out = prog(t, 20.4, 20.9);
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

  // ---- wall of strips ---------------------------------------------------------------------------------------
  wallState(t) {
    const w = this.world;
    const on = t > 20.8;
    w.wall.visible = on;
    if (!on) return;
    for (const m of w.wallStrips) {
      const u = m.material.uniforms;
      const dist = Math.hypot(m.userData.cx, m.userData.cy + 10.68);
      u.fade.value = ease.outQuad(prog(t, 20.9 + dist * 0.012, 21.9 + dist * 0.012));
      const t0 = 22.0 + dist * 0.028;
      u.wave.value = ease.inOutQuad(prog(t, t0, t0 + 1.0));
      u.flash.value = 0;
      u.bright.value = 1;
      m.position.y = m.userData.cy + Math.sin(t * 0.55 + m.userData.phase * 6.28) * 0.28;
    }
  }
}
