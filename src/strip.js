// The manhua page strip: layout (in "page units"), page texture, and the speech-bubble / caption renderer.
// All story text here is original copy written for this film.
import { PAL, TAU, clamp, lerp, smoothstep, rng, makeNoise } from './lib/util.js';

export const PAGE = { w: 1100, h: 2136 };

export const PANELS = [
  { id: 'p1', poly: [[50, 40], [1050, 40], [1050, 800], [50, 800]], art: 'vista', bbox: [50, 40, 1000, 760] },
  { id: 'p2', poly: [[50, 836], [640, 836], [590, 1500], [50, 1500]], art: 'closeup', bbox: [50, 836, 590, 664] },
  { id: 'p3', poly: [[676, 836], [1050, 836], [1050, 1500], [626, 1500]], art: 'valley', bbox: [626, 836, 424, 664] },
  { id: 'p4', poly: [[50, 1536], [1050, 1536], [1050, 2040], [50, 2096]], art: 'burst', bbox: [50, 1536, 1000, 560] },
];

const INK = PAL.ink, PAPER = '#FBFCFA';

// ---------------------------------------------------------------------------------------------------
// Page texture
// ---------------------------------------------------------------------------------------------------
export function buildPage(art, { scale = 2, withPanels = true } = {}) {
  const c = document.createElement('canvas');
  c.width = PAGE.w * scale; c.height = PAGE.h * scale;
  const x = c.getContext('2d');
  x.scale(scale, scale);
  x.fillStyle = PAL.paper; x.fillRect(0, 0, PAGE.w, PAGE.h);
  // paper fibre
  const R = rng(5);
  x.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    x.strokeStyle = `rgba(120,130,120,${R.range(0.015, 0.05)})`; x.lineWidth = R.range(0.3, 0.9);
    const px = R() * PAGE.w, py = R() * PAGE.h, a = R() * TAU, l = R.range(3, 14);
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  if (withPanels) {
    for (const p of PANELS) {
      const img = art[p.art];
      x.save();
      x.beginPath(); p.poly.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath();
      x.clip();
      x.drawImage(img, p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]);
      x.restore();
      x.lineJoin = 'miter'; x.miterLimit = 6;
      x.strokeStyle = INK; x.lineWidth = 5;
      x.beginPath(); p.poly.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.stroke();
    }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------
// Bubble definitions
// ---------------------------------------------------------------------------------------------------
const ZH = '"Noto Sans SC", "PingFang SC", sans-serif';
const ZH_SERIF = '"Noto Serif SC", "Songti SC", serif';
const EN = '"Barlow Condensed", "Arial Narrow", sans-serif';

/**
 * Each bubble has two typeset states ('zh' = source, 'en' = rebuilt) and a shape function per state.
 * Coordinates are page units; `rect` is [x, y, w, h].
 */
export const BUBBLES = {
  caption: {
    kind: 'caption', z: 0.05,
    zh: { rect: [860, 100, 132, 292], vertical: ['群山之外', '别有天地'], font: `700 50px ${ZH_SERIF}`, colGap: 60, rowGap: 56 },
    en: { rect: [648, 94, 344, 108], lines: [{ t: 'BEYOND THE MOUNTAINS,', size: 36 }, { t: 'A DIFFERENT WORLD.', size: 36 }], font: `700 36px ${EN}`, lh: 40, track: 1.2 },
  },
  q: {
    kind: 'speech', z: 0.06, tail: { base: [286, 288], tip: [262, 380] },
    zh: { rect: [92, 86, 480, 206], lines: [{ t: '山的那边，', size: 50 }, { t: '还有别的世界吗？', size: 50 }], font: `700 50px ${ZH}`, lh: 62 },
    en: { rect: [56, 58, 536, 262], lines: [{ t: 'IS THERE ANOTHER', size: 62 }, { t: 'WORLD BEYOND', size: 62 }, { t: 'THESE MOUNTAINS?', size: 62 }], font: `600 62px ${EN}`, lh: 66, track: 1.0 },
  },
  a: {
    kind: 'burst', z: 0.06,
    zh: { rect: [670, 874, 370, 286], lines: [{ t: '有。', size: 118, dy: -28 }, { t: '而且还有更多。', size: 40, dy: 66 }], font: `700 38px ${ZH}` },
    en: { rect: [670, 874, 370, 286], lines: [{ t: 'YES.', size: 160, dy: -30, weight: 800 }, { t: 'AND MANY MORE.', size: 42, dy: 62, weight: 600 }], font: `700 48px ${EN}`, track: 1.0 },
  },
};

const PAD = 34;
export function bubbleBounds(def) {
  const rs = [def.zh.rect, def.en.rect];
  let x0 = Math.min(...rs.map((r) => r[0])) - PAD, y0 = Math.min(...rs.map((r) => r[1])) - PAD;
  let x1 = Math.max(...rs.map((r) => r[0] + r[2])) + PAD, y1 = Math.max(...rs.map((r) => r[1] + r[3])) + PAD;
  if (def.tail) { x0 = Math.min(x0, def.tail.tip[0] - PAD); y1 = Math.max(y1, def.tail.tip[1] + PAD); }
  return [x0, y0, x1 - x0, y1 - y0];
}

function shapePath(def, rect, t = 1) {
  const [x, y, w, h] = rect;
  const p = new Path2D();
  if (def.kind === 'caption') { p.rect(x, y, w, h); return p; }
  if (def.kind === 'speech') {
    const r = Math.min(h / 2, 92);
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    const [bx, by] = def.tail.base, [tx, ty] = def.tail.tip;
    p.lineTo(x + w, y + h - r); p.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    p.lineTo(bx + 46, y + h); p.quadraticCurveTo(bx + 20, y + h + (ty - y - h) * 0.45, tx, ty); p.quadraticCurveTo(bx - 4, y + h + 10, bx - 14, y + h);
    p.lineTo(x + r, y + h); p.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    p.lineTo(x, y + r); p.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); p.closePath();
    return p;
  }
  // burst: jagged-but-soft emphatic shape
  const cx = x + w / 2, cy = y + h / 2, n = 26, N = makeNoise(9);
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU, sp = i % 2 ? 0.93 : 1.0;
    const wob = 1 + N(Math.cos(a) * 2 + 3, Math.sin(a) * 2) * 0.05;
    pts.push([cx + Math.cos(a) * (w / 2) * sp * wob * 1.02, cy + Math.sin(a) * (h / 2) * sp * wob * 1.02]);
  }
  p.moveTo(...pts[0]); pts.forEach((q, i) => i && p.lineTo(...q)); p.closePath();
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Bubble renderer
// ---------------------------------------------------------------------------------------------------
export class Bubble {
  constructor(id, scale = 2.5) {
    this.id = id; this.def = BUBBLES[id]; this.S = scale;
    this.bounds = bubbleBounds(this.def);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(this.bounds[2] * scale); this.canvas.height = Math.ceil(this.bounds[3] * scale);
    this.ctx = this.canvas.getContext('2d');
    this.tmp = document.createElement('canvas'); this.tmp.width = this.canvas.width; this.tmp.height = this.canvas.height;
    this.tctx = this.tmp.getContext('2d');
    this._key = '';
  }
  /** page-unit centre of the canvas, for placing the plane */
  get center() { const [x, y, w, h] = this.bounds; return [x + w / 2, y + h / 2]; }

  /**
   * state: p (0 zh .. 1 en), morph (0..1 ink-melt amount; 0 = crisp crossfade),
   *        hl (0..1 reading highlight sweep), glow (0..1 green edge pulse), alpha,
   *        gag: { text, strike (0..1), color } overrides the English line with a wrong isolated gloss
   *        rectP: override interpolation for shape (defaults to p)
   */
  draw(st) {
    const key = JSON.stringify(st);
    if (key === this._key) return false;
    this._key = key;
    const { ctx, def, S, bounds } = this;
    this._reveal = st.reveal ?? 1; this._sub = st.sub ?? 1;
    const [bx, by] = bounds;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const p = clamp(st.p ?? 0), rp = st.rectP ?? smoothstep(0.1, 0.9, p);
    ctx.setTransform(S, 0, 0, S, -bx * S, -by * S);
    ctx.globalAlpha = st.alpha ?? 1;
    // interpolated rect for caption (shape re-flows as language changes)
    const rz = def.zh.rect, re = def.en.rect;
    const rect = def.kind === 'burst' ? rz : rz.map((v, i) => lerp(v, re[i], rp));
    const path = shapePath(def, rect);
    // border + fill
    ctx.lineJoin = 'round';
    ctx.fillStyle = PAPER; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    // text content
    this._drawContent(ctx, st, p);
    // reading highlight (green marker sweep)
    if (st.hl > 0) {
      const [x, y, w, h] = rect;
      const e = x + w * st.hl;
      const g = ctx.createLinearGradient(x, 0, e, 0);
      g.addColorStop(0, 'rgba(109,186,44,0.0)'); g.addColorStop(0.5, 'rgba(109,186,44,0.30)'); g.addColorStop(1, 'rgba(160,230,70,0.55)');
      ctx.fillStyle = g; ctx.fillRect(x, y, e - x, h);
      ctx.fillStyle = 'rgba(190,255,100,0.9)'; ctx.fillRect(e - 3, y, 3, h);
    }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = def.kind === 'caption' ? 4.5 : 5.5; ctx.stroke(path);
    if (st.glow > 0) {
      ctx.save(); ctx.strokeStyle = `rgba(124,195,38,${st.glow})`; ctx.lineWidth = 9; ctx.shadowColor = 'rgba(124,195,38,0.9)'; ctx.shadowBlur = 24 * st.glow; ctx.stroke(path); ctx.restore();
    }
    ctx.globalAlpha = 1;
    return true;
  }

  _drawContent(ctx, st, p) {
    const { def } = this;
    const morph = st.morph ?? 0;
    if (st.gag) { this._drawGag(ctx, st); return; }
    const useMorph = morph > 0 && p > 0 && p < 1;
    if (!useMorph) {
      if (p < 0.5) this._lang(ctx, 'zh', 1 - (p > 0 ? p * 2 : 0)); else this._lang(ctx, 'en', (p - 0.5) * 2 + 0.0);
      if (p > 0 && p < 1 && !morph) { this._lang(ctx, p < 0.5 ? 'en' : 'zh', 0); }
      return;
    }
    // ink-melt: draw both languages as black-on-white into tmp, blur + threshold so strokes bleed into one another
    const { tctx: t, tmp, S } = this;
    const bx = this.bounds[0], by = this.bounds[1];
    t.setTransform(1, 0, 0, 1, 0, 0); t.filter = 'none';
    t.fillStyle = '#fff'; t.fillRect(0, 0, tmp.width, tmp.height);
    t.setTransform(S, 0, 0, S, -bx * S, -by * S);
    const wz = 1 - p, we = p;
    const prev = ctx; // eslint-disable-line
    this._lang(t, 'zh', wz, true); this._lang(t, 'en', we, true);
    t.setTransform(1, 0, 0, 1, 0, 0);
    const bl = Math.sin(p * Math.PI) * (3 + 9 * morph) * (S / 2.5);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sp = Math.sin(p * Math.PI);
    ctx.filter = `blur(${bl.toFixed(2)}px) brightness(${(1 - 0.34 * sp).toFixed(3)}) contrast(${(1 + 18 * sp).toFixed(2)})`;
    // threshold-ish look: contrast around mid-grey after blur keeps blobs; brightness trims the halo
    ctx.drawImage(tmp, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
  }

  _lang(ctx, lang, a, solidInk = false) {
    if (a <= 0.001) return;
    const d = this.def[lang];
    const [x, y, w, h] = d.rect;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
    if (d.vertical) {
      // vertical Chinese: columns right-to-left, glyphs top-to-bottom
      ctx.font = d.font; ctx.textAlign = 'center';
      d.vertical.forEach((col, ci) => {
        const cx = x + w - 30 - ci * d.colGap;
        [...col].forEach((ch, ri) => {
          const gi = ci * 4 + ri, k = clamp(this._reveal * 8 - gi);
          if (k <= 0) return;
          ctx.save(); ctx.globalAlpha *= k; ctx.translate(cx, y + 56 + ri * d.rowGap - 16 * (1 - k)); ctx.scale(1, 0.85 + 0.15 * k);
          ctx.fillText(ch, 0, 0); ctx.restore();
        });
      });
    } else {
      ctx.textAlign = 'center';
      const n = d.lines.length, lh = d.lh ?? 60;
      d.lines.forEach((ln, i) => {
        const wgt = ln.weight ?? '';
        const lineA = i >= 1 ? this._sub : 1;
        if (lineA <= 0.001) return;
        const fam = lang === 'en' ? EN : ZH;
        ctx.font = `${wgt || (lang === 'en' ? 600 : 700)} ${ln.size}px ${fam}`;
        if (lang === 'en' && 'letterSpacing' in ctx) ctx.letterSpacing = `${(d.track ?? 0) * (ln.size / 40)}px`;
        let dy = ln.dy ?? ((i - (n - 1) / 2) * lh);
        if (i === 0 && ln.dy !== undefined && n > 1) dy *= this._sub;      // headline centres itself until its sub line arrives
        const ty = y + h / 2 + dy + ln.size * 0.34;
        ctx.save(); ctx.globalAlpha *= lineA; ctx.fillText(ln.t, x + w / 2, ty + (1 - lineA) * 10); ctx.restore();
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      });
    }
    ctx.restore();
  }

  /**
   * The "isolated word" gloss: candidate English words scroll through the bubble like a slot reel (gray, unsure) until
   * context arrives and the right one locks in.  g = { words: [{ t, c, size }], s: reel position (index, fractional), jx, jy }
   */
  _drawGag(ctx, st) {
    const g = st.gag, [x, y, w, h] = this.def.en.rect, cx = x + w / 2, cy = y + h / 2, STEP = 150;
    ctx.save(); ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    g.words.forEach((wd, i) => {
      const o = i - g.s;
      if (Math.abs(o) > 0.95) return;
      const a = 1 - smoothstep(0.2, 0.9, Math.abs(o));
      if (a <= 0.01) return;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = wd.c;
      ctx.font = `800 ${wd.size}px ${EN}`;
      const near = Math.abs(o) < 0.5;
      ctx.fillText(wd.t, cx + (near ? (g.jx ?? 0) : 0), cy + o * STEP + wd.size * 0.34 + (near ? (g.jy ?? 0) : 0));
      ctx.restore();
    });
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
  }
}

/** Region rectangles (page units) used for the reading brackets. */
export const REGIONS = {
  caption: { zh: [860, 100, 132, 292], en: [648, 94, 344, 108] },
  q: { zh: [92, 86, 480, 206], en: [56, 58, 536, 262] },
  a: { zh: [670, 874, 370, 286], en: [670, 874, 370, 286] },
};
