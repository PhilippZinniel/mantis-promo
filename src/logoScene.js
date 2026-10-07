// The logo reveal. Built from the supplied logo.png (matted into parts by tools/extract_logo.py) and the corner panels
// cut from banner.png. The mark is deconstructed: ring crescents sweep, the mantis strikes into place, the wordmark rises
// through its baseline, and the leaf-slash of the "M" arrives last as the final strike.
import { clamp, lerp, ease, prog, TAU, PAL, rng, smoothstep } from './lib/util.js';

const INK = PAL.ink, GREEN = PAL.green, GREEN_HI = '#9BE33A';

// logo-space landmarks (px in assets/logo.png)
const CX0 = 630, CY0 = 588;                 // centre of the artwork's bounding box
const RING = { x: 627.5, y: 519.5, r: 293.5 };
const HEAD_C = [745, 392];

export class LogoScene {
  constructor(assets, W = 1920, H = 1080, t0 = 28.02) {
    this.t0 = t0;                       // film time at which the logo build starts (lock-up = t0 + 1.98)
    this.V = H > W;                     // 9:16 recomposition
    this.A = assets; this.W = W; this.H = H; this.P = assets.logoMeta.parts; this.L = assets.logo; this.B = assets.brand;
    const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    this.tmp = mk(); this.tctx = this.tmp.getContext('2d');
    this.paper = this.makePaper();
    this.leaves = this.makeLeaves();
  }

  makePaper() {
    const { W, H } = this;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = PAL.paper; x.fillRect(0, 0, W, H);
    const R = rng(404);
    for (let i = 0; i < Math.round(4200 * W * H / (1920 * 1080)); i++) { x.strokeStyle = `rgba(110,125,112,${R.range(0.012, 0.04)})`; x.lineWidth = R.range(0.3, 0.9); const px = R() * W, py = R() * H, a = R() * TAU, l = R.range(3, 16); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
    // soft centre light
    const R0 = Math.max(W, H) * 0.57, g = x.createRadialGradient(W / 2, H * 0.48, 100, W / 2, H * 0.5, R0); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(225,232,224,0.35)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    return c;
  }

  makeLeaves() {
    const R = rng(88), out = [];
    for (let i = 0; i < 14; i++) out.push({ x: R.range(0.04, 0.96), y0: R.range(0.2, 1.1), s: R.range(14, 40), sp: R.range(18, 60), rot: R.range(-1, 1), rs: R.range(-0.8, 0.8), ph: R(), d: R.range(2.2, 3.4) });
    return out;
  }

  // ---- projection of logo-space -> screen --------------------------------------------------------------
  frame(lt) {
    const push = 1 + 0.028 * ease.outQuad(prog(lt, 1.6, 6.0));
    const V = this.V, k = (V ? 0.88 : 0.80) * push, cx = this.W / 2 + 4, cy = V ? 1020 : 546;
    return { k, X: (lx) => cx + (lx - CX0) * k, Y: (ly) => cy + (ly - CY0) * k, cx, cy };
  }

  part(ctx, F, name, { dx = 0, dy = 0, sx = 1, sy = 1, rot = 0, alpha = 1, anchor, clip } = {}) {
    const p = this.P[name], img = this.L[name];
    const x = F.X(p.x), y = F.Y(p.y), w = p.w * F.k, h = p.h * F.k;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (clip) clip(ctx, x, y, w, h);
    const ax = anchor ? F.X(anchor[0]) : x + w / 2, ay = anchor ? F.Y(anchor[1]) : y + h / 2;
    ctx.translate(ax + dx, ay + dy); ctx.rotate(rot); ctx.scale(sx, sy); ctx.translate(-ax, -ay);
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  // ---- main ---------------------------------------------------------------------------------------------
  draw(ctx, t) {
    const lt = t - this.t0, { W, H } = this;
    const F = this.frame(lt);
    ctx.save();
    ctx.drawImage(this.paper, 0, 0, W, H);
    this.decor(ctx, lt, F);
    this.emblem(ctx, lt, F);
    this.wordmark(ctx, lt, F);
    this.tagline(ctx, lt, F);
    this.fx(ctx, lt, F);
    ctx.restore();
  }

  // ---- banner-derived decoration ---------------------------------------------------------------------------
  decor(ctx, lt, F) {
    const { W, H } = this, B = this.B;
    // faint concentric swooshes behind the mark (banner motif)
    const arcK = ease.outCubic(prog(lt, -0.05, 1.3));
    ctx.save();
    ctx.translate(F.X(RING.x), F.Y(RING.y));
    ctx.rotate(lt * 0.05 - 0.6);
    for (const [R, w, a0, a1, al] of [[470, 40, -2.4, 1.0, 0.22], [560, 22, -1.2, 2.4, 0.14], [660, 14, 0.4, 3.6, 0.10]]) {
      const n = 60; const pts1 = [], pts2 = [];
      for (let i = 0; i <= n; i++) {
        const s = i / n, a = lerp(a0, a1 * arcK + a0 * (1 - arcK), s), th = w * F.k * Math.pow(Math.sin(Math.PI * s), 0.9) * 1.25;
        pts1.push([Math.cos(a) * R * F.k, Math.sin(a) * R * F.k]); pts2.push([Math.cos(a) * (R * F.k - th), Math.sin(a) * (R * F.k - th)]);
      }
      const g = ctx.createLinearGradient(-R * F.k, -R * F.k, R * F.k, R * F.k); g.addColorStop(0, `rgba(109,186,44,${al})`); g.addColorStop(1, `rgba(109,186,44,${al * 0.2})`);
      ctx.fillStyle = g; ctx.beginPath(); pts1.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); pts2.reverse().forEach((p) => ctx.lineTo(...p)); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // --- left: mountain + hills panels with ink border lines, sliding in along their diagonal
    const kL = ease.outExpo(prog(lt, -0.4, 0.4));
    ctx.save();
    ctx.translate(-120 * (1 - kL), -90 * (1 - kL)); ctx.globalAlpha = clamp(kL * 2);
    const V = this.V, ms = V ? 1.5 : 1.3, mw = 342 * ms, mh = 258 * ms;
    // dark sliver + green band along the panel's right diagonal (banner)
    const diag = [[mw, 0], [208 * ms, 226 * ms]];
    this.band(ctx, [mw + 4, 0], [208 * ms + 4, 226 * ms], 0, -80, 20, INK, null);
    this.band(ctx, [mw + 34, 0], [208 * ms + 30, 226 * ms], 0, 0, 30, GREEN, GREEN_HI, true);
    ctx.drawImage(B.banner_mountain, 0, 0, mw, mh);
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mw, 0); ctx.lineTo(208 * ms, 226 * ms); ctx.lineTo(0, 258 * ms); ctx.stroke();
    const hs = V ? 1.3 : 1.3; ctx.drawImage(B.banner_hills, 0, V ? H - 198 * hs - 40 : 276 * hs, 206 * hs, 198 * hs);
    ctx.restore();

    // --- right: cloud panel
    const kR = ease.outExpo(prog(lt, -0.35, 0.45));
    ctx.save();
    ctx.translate(140 * (1 - kR), 80 * (1 - kR)); ctx.globalAlpha = clamp(kR * 2) * 0.9;
    const cs = V ? 0.88 : 1.1, cw = 358 * cs, ch = 408 * cs, cx0 = W - cw, cy0 = V ? 250 : 190;
    ctx.drawImage(B.banner_cloud, cx0, cy0, cw, ch);
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(W, cy0); ctx.lineTo(cx0, cy0 + ch); ctx.lineTo(W, cy0 + ch * 0.76); ctx.stroke();
    ctx.restore();

    // --- bottom-right: big green blade (banner), top-right: slim green slash
    const kB = ease.outExpo(prog(lt, -0.3, 0.5));
    ctx.save(); ctx.translate(200 * (1 - kB), 160 * (1 - kB)); ctx.globalAlpha = clamp(kB * 2);
    if (V) ctx.translate(0, -40);
    const bl = [[W - 640, H + 10], [W - 20, H - 330], [W + 10, H - 220], [W, H], [W - 330, H]];
    const gB = ctx.createLinearGradient(W - 540, H, W + 60, H - 330); gB.addColorStop(0, '#16231d'); gB.addColorStop(0.42, '#2d6a22'); gB.addColorStop(1, GREEN_HI);
    ctx.fillStyle = gB; ctx.beginPath(); ctx.moveTo(W - 600, H + 10); ctx.lineTo(W + 76, H - 340); ctx.lineTo(W + 110, H - 330); ctx.lineTo(W + 110, H + 10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(W - 640, H + 14); ctx.lineTo(W + 60, H - 360); ctx.stroke();
    ctx.restore();
    const kT = ease.outExpo(prog(lt, -0.3, 0.45));
    ctx.save(); ctx.translate(-80 * (1 - kT), -160 * (1 - kT)); ctx.globalAlpha = clamp(kT * 2);
    const gT = ctx.createLinearGradient(W - 420, 0, W - 150, 230); gT.addColorStop(0, GREEN_HI); gT.addColorStop(1, '#2d6a22');
    ctx.fillStyle = gT; ctx.beginPath(); ctx.moveTo(W - 340 + (V ? 120 : 0), 0); ctx.lineTo(W - 110 + (V ? 120 : 0), 0); ctx.lineTo(W - 330 + (V ? 120 : 0), V ? 190 : 250); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** parallel green/ink band along a segment, extended past the ends to the frame */
  band(ctx, a, b, ex0, ex1, w, c0, c1, glow = false) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const A = [a[0] - ux * 40, a[1] - uy * 40], Bb = [b[0] + ux * 520, b[1] + uy * 520];
    const g = ctx.createLinearGradient(A[0], A[1], Bb[0], Bb[1]);
    g.addColorStop(0, c1 ?? c0); g.addColorStop(1, c0);
    ctx.save(); ctx.fillStyle = c1 ? g : c0;
    if (glow) { ctx.shadowColor = 'rgba(124,195,38,0.35)'; ctx.shadowBlur = 16; }
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + nx * w, A[1] + ny * w); ctx.lineTo(Bb[0] + nx * w * 0.5, Bb[1] + ny * w * 0.5); ctx.lineTo(Bb[0], Bb[1]); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---- emblem -------------------------------------------------------------------------------------------------
  emblem(ctx, lt, F) {
    const wedge = (name, a0, a1, k, ccw) => {
      if (k <= 0) return;
      this.part(ctx, F, name, {
        clip: (c) => {
          const cx = F.X(RING.x), cy = F.Y(RING.y), R = RING.r * F.k * 1.6;
          const aEnd = lerp(a0, a1, k);
          c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a0, aEnd, a1 < a0); c.closePath(); c.clip();
        },
      });
    };
    // crescents sweep around the ring
    wedge('ring_left', -1.62, -4.9, ease.inOutCubic(prog(lt, 0.1, 0.9)), true);
    wedge('ring_right', -1.15, 0.55, ease.inOutCubic(prog(lt, 0.22, 0.82)), false);
    // arms slice in along their own diagonals
    const kL = ease.outQuart(prog(lt, 0.55, 1.05)), kR = ease.outQuart(prog(lt, 0.66, 1.15));
    const sweep = (k, dirx, diry, ox, oy, name, extra = {}) => {
      if (k <= 0) return;
      this.part(ctx, F, name, {
        dx: dirx * (1 - k) * 260 * F.k / 0.8, dy: diry * (1 - k) * 260 * F.k / 0.8, alpha: clamp(k * 3),
        clip: (c, x, y, w, h) => { c.beginPath(); c.rect(x - 6, y - 6, w + 12, h + 12); c.clip(); }, ...extra,
      });
    };
    sweep(kL, -0.7, 0.7, 0, 0, 'arm_left');
    sweep(kR, 0.7, 0.7, 0, 0, 'arm_right');
    sweep(ease.outQuart(prog(lt, 0.8, 1.2)), 0, 0.9, 0, 0, 'tri');
    // head: circular reveal from the face outward so the antennae whip out, with a small landing pop
    const kH = prog(lt, 1.0, 1.45);
    if (kH > 0) {
      const e = ease.outCubic(kH), pop = 1 + 0.05 * Math.exp(-Math.max(0, lt - 1.38) * 9) * (lt > 1.38 ? 1 : 0);
      this.part(ctx, F, 'head', {
        sx: pop, sy: pop, anchor: HEAD_C, alpha: clamp(kH * 4),
        clip: (c) => { const cx = F.X(HEAD_C[0]), cy = F.Y(HEAD_C[1]); c.beginPath(); c.arc(cx, cy, 40 + e * 760 * F.k, 0, TAU); c.clip(); },
      });
    }
  }

  // ---- wordmark -----------------------------------------------------------------------------------------------
  wordmark(ctx, lt, F) {
    const letters = [['L_M_body', 0], ['L_M_leg', 0.04], ['L_a', 0.09], ['L_n', 0.14], ['L_t', 0.19], ['L_i', 0.24], ['L_s', 0.29]];
    const T = 1.15;
    for (const [name, dly] of letters) {
      const k = prog(lt, T + dly, T + dly + 0.55);
      if (k <= 0) continue;
      const e = ease.outQuart(k), p = this.P[name];
      this.part(ctx, F, name, {
        dy: (1 - e) * p.h * F.k * 1.05, alpha: 1,
        clip: (c, x, y, w, h) => { c.beginPath(); c.rect(x - 8, y - 14, w + 16, h + 14 + 1); c.clip(); },
      });
    }
    // the M's leaf-slash: the final strike flies in along its own axis and locks into place
    const ks = prog(lt, 1.5, 1.98);
    if (ks > 0) {
      const e = ease.strike(ks), p = this.P.L_M_slash;
      const ang = -0.81, ux = Math.cos(ang), uy = Math.sin(ang);
      const dist = 1500 * (1 - e) * F.k / 0.8, sc = 1 + 1.6 * (1 - e);
      const trailN = 6;
      for (let i = trailN; i >= 0; i--) {
        const back = i * 0.045 * (1 - e) * 1500;
        this.part(ctx, F, 'L_M_slash', { dx: -ux * (dist + back * F.k / 0.8), dy: -uy * (dist + back * F.k / 0.8), sx: sc, sy: sc, alpha: i === 0 ? 1 : 0.16 * (1 - i / (trailN + 1)) * (1 - e) });
      }
      // landing flash
      const f = Math.max(0, 1 - Math.abs(lt - 1.98) * 7);
      if (f > 0) { const cx = F.X(p.x + p.w * 0.55), cy = F.Y(p.y + p.h * 0.5); const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200); g.addColorStop(0, `rgba(124,195,38,${0.5 * f})`); g.addColorStop(0.5, `rgba(124,195,38,${0.18 * f})`); g.addColorStop(1, 'rgba(124,195,38,0)'); ctx.save(); ctx.fillStyle = g; ctx.fillRect(cx - 210, cy - 210, 420, 420); ctx.restore(); }
    }
    const kl = prog(lt, 1.98, 2.5);
    if (kl > 0) { const b = ease.back(kl); this.part(ctx, F, 'L_i_leaf', { sx: b, sy: b, anchor: [930, 856], alpha: clamp(kl * 4) }); }
    // glint across the wordmark
    const kg = prog(lt, 2.7, 3.35);
    if (kg > 0 && kg < 1) this.glint(ctx, F, kg);
  }

  glint(ctx, F, k) {
    const { tctx: t, tmp, W, H } = this;
    t.clearRect(0, 0, W, H); t.globalCompositeOperation = 'source-over';
    for (const name of ['L_M_body', 'L_M_leg', 'L_a', 'L_n', 'L_t', 'L_i', 'L_s', 'L_M_slash']) this.part(t, F, name);
    t.globalCompositeOperation = 'source-atop';
    const x = lerp(F.X(60), F.X(1230), ease.inOutCubic(k));
    const g = t.createLinearGradient(x - 70, 0, x + 70, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    t.save(); t.translate(x, F.Y(900)); t.transform(1, 0, -0.36, 1, 0, 0); t.translate(-x, -F.Y(900)); t.fillStyle = g; t.fillRect(x - 120, F.Y(760), 240, F.Y(1040) - F.Y(760)); t.restore();
    t.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0);
  }

  // ---- tagline ---------------------------------------------------------------------------------------------------
  tagline(ctx, lt, F) {
    const k = ease.outCubic(prog(lt, 2.35, 3.1));
    if (k <= 0) return;
    const p = this.P.tagline, img = this.L.tagline, S = this.V ? 1.08 : 1.32;
    const w = p.w * F.k * S, h = p.h * F.k * S, cx = F.X(p.x + p.w / 2), cy = F.Y(p.y + p.h / 2) + 14;
    ctx.save();
    ctx.globalAlpha *= clamp(k * 1.4);
    const hw = (w / 2 + 12) * k; ctx.beginPath(); ctx.rect(cx - hw, cy - h / 2 - 10, hw * 2, h + 20); ctx.clip();
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  }

  // ---- ambience: shock ring, drifting leaf-shards -------------------------------------------------------------------
  fx(ctx, lt, F) {
    // pulse ring when the mark completes
    const kp = prog(lt, 1.98, 2.9);
    if (kp > 0 && kp < 1) {
      const r = lerp(140, 980, ease.outExpo(kp)), a = 0.5 * (1 - kp) ** 1.5;
      ctx.save(); ctx.strokeStyle = `rgba(124,195,38,${a})`; ctx.lineWidth = 3 + 10 * (1 - kp); ctx.beginPath(); ctx.arc(F.X(RING.x), F.Y(RING.y + 120), r, 0, TAU); ctx.stroke(); ctx.restore();
    }
    // leaf shards (banner motif), drifting upward
    const { W, H } = this;
    for (const L of this.leaves) {
      const s = lt - (2.0 + L.ph * 1.5);
      if (s < 0) continue;
      const y = H * L.y0 - s * L.sp, x = W * L.x + Math.sin(s * 0.9 + L.ph * 6) * 26;
      if (y < -60) continue;
      // keep-out: shards never cross the emblem, wordmark or tagline -- they fade out as they approach the lock-up's bounding box
      const kx0 = F.X(70), kx1 = F.X(1180), ky0 = F.Y(40), ky1 = F.Y(1110);
      const dd = Math.hypot(Math.max(kx0 - x, 0, x - kx1), Math.max(ky0 - y, 0, y - ky1));
      const a = clamp(Math.min(s / 0.6, 1)) * 0.9 * smoothstep(0, 110, dd);
      if (a <= 0.004) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(L.rot + s * L.rs * 0.6); ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(L.ph * 9));
      const g = ctx.createLinearGradient(-L.s, 0, L.s, 0); g.addColorStop(0, '#2d6a22'); g.addColorStop(1, GREEN_HI);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-L.s, 0); ctx.quadraticCurveTo(0, -L.s * 0.45, L.s, 0); ctx.quadraticCurveTo(0, L.s * 0.28, -L.s, 0); ctx.fill();
      ctx.restore();
    }
  }
}
