// The 3D world: the manhua strip floating in a dark void. Everything is a textured plane; all graphics
// (threads, brackets, type masks) are 2D overlays computed from this camera so they stay locked to the art.
import * as THREE from 'three';
import { PAGE, PANELS, Bubble, BUBBLES, buildPage } from './strip.js';
import { clamp, lerp, TAU, PAL, rng, hex } from './lib/util.js';

const S = 0.01;                                   // page unit -> world unit
export const wx = (u) => (u - PAGE.w / 2) * S;
export const wy = (v) => -v * S;

const VOID = new THREE.Color(PAL.inkDeep);

function tex(img, { aniso = 16, srgb = true, repeat = false, mip = true } = {}) {
  const t = img.isTexture ? img : new THREE.Texture(img);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = mip;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

export class World {
  constructor(assets, { W = 1920, H = 1080 } = {}) {
    this.W = W; this.H = H; this.A = assets;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(VOID, 1);
    this.aniso = r.capabilities.getMaxAnisotropy();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 600);
    this.v = new THREE.Vector3();
    this.build();
  }

  build() {
    const { A } = this, sc = this.scene;
    const basic = (map, o = {}) => new THREE.MeshBasicMaterial({ map, toneMapped: false, ...o });

    // ---- the page (all panels baked in) ----
    this.pageCanvas = buildPage(A.art, { scale: 2 });
    this.pageTex = tex(this.pageCanvas, { aniso: this.aniso });
    this.page = new THREE.Mesh(new THREE.PlaneGeometry(PAGE.w * S, PAGE.h * S), basic(this.pageTex, { transparent: true }));
    this.page.position.set(0, wy(PAGE.h / 2), 0);
    sc.add(this.page);

    // soft drop shadow of the page onto the void
    const sh = document.createElement('canvas'); sh.width = 256; sh.height = 512; const sx = sh.getContext('2d');
    const g = sx.createRadialGradient(128, 256, 10, 128, 256, 250); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = g; sx.fillRect(0, 0, 256, 512);
    this.shadowTex = tex(sh, { mip: false });
    this.pageShadow = new THREE.Mesh(new THREE.PlaneGeometry(PAGE.w * S * 1.5, PAGE.h * S * 1.15), basic(this.shadowTex, { transparent: true, depthWrite: false, opacity: 0.8 }));
    this.pageShadow.position.set(0.25, wy(PAGE.h / 2) - 0.3, -0.6); this.pageShadow.renderOrder = -1;
    sc.add(this.pageShadow);

    // ---- vista layers (parallax planes over panel 1) ----
    const p1 = PANELS[0].bbox;
    this.vistaCenter = [p1[0] + p1[2] / 2, p1[1] + p1[3] / 2];
    this.layers = [];
    const OS = 1.8;
    const L = [['sky', 0.0], ['far', 0.55], ['mid', 1.2], ['near', 2.1], ['leaves', 3.4]];
    L.forEach(([name, z], i) => {
      const lt = tex(A.art['vista_' + name], { aniso: this.aniso });
      lt.wrapS = lt.wrapT = THREE.ClampToEdgeWrapping; lt.repeat.set(OS, OS); lt.offset.set((1 - OS) / 2, (1 - OS) / 2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p1[2] * S * OS, p1[3] * S * OS), basic(lt, { transparent: i > 0, depthWrite: false }));
      m.renderOrder = 10 + i; m.userData.z = z; m.userData.base = new THREE.Vector3(wx(this.vistaCenter[0]), wy(this.vistaCenter[1]), 0);
      sc.add(m); this.layers.push(m);
    });
    // mist sheets for atmosphere / parallax
    this.mists = [];
    [[0.9, 0.3, 1.6, 0.0], [1.7, 0.2, 1.3, 0.5], [2.8, 0.14, 1.1, 0.25]].forEach(([z, op, sc2, ph], i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p1[2] * S * sc2, p1[3] * S * 0.5 * sc2), basic(tex(A.art.vista_mist, { aniso: 4 }), { transparent: true, opacity: op, depthWrite: false }));
      m.renderOrder = 15 + i; m.userData = { z, op, phase: ph, y: -0.1 - i * 0.35 };
      sc.add(m); this.mists.push(m);
    });

    // ---- bubbles (separate planes so the "text layer" can lift off the art) ----
    this.bubbles = {};
    for (const id of Object.keys(BUBBLES)) {
      const b = new Bubble(id, 3);
      const t = tex(b.canvas, { aniso: this.aniso });
      const [bx, by, bw, bh] = b.bounds;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw * S, bh * S), basic(t, { transparent: true, depthWrite: false }));
      m.renderOrder = 30; m.position.set(wx(bx + bw / 2), wy(by + bh / 2), BUBBLES[id].z);
      // shadow
      const shM = new THREE.Mesh(new THREE.PlaneGeometry(bw * S * 1.15, bh * S * 1.2), basic(this.shadowTex, { transparent: true, depthWrite: false, opacity: 0 }));
      shM.renderOrder = 29; shM.position.set(m.position.x, m.position.y, 0.02);
      sc.add(shM); sc.add(m);
      this.bubbles[id] = { b, mesh: m, tex: t, shadow: shM, base: m.position.clone(), z0: BUBBLES[id].z };
    }

    // ---- fog / void ----
    this.fog = [];
    const wisp = document.createElement('canvas'); wisp.width = 1024; wisp.height = 256; const wx2 = wisp.getContext('2d'); const FR = rng(31);
    for (let i = 0; i < 46; i++) {
      const cx = FR() * 1024, cy = 128 + (FR() - 0.5) * 120, rx = FR.range(70, 260), ry = FR.range(8, 34);
      wx2.save(); wx2.translate(cx, cy); wx2.scale(1, ry / rx);
      const g2 = wx2.createRadialGradient(0, 0, 0, 0, 0, rx); g2.addColorStop(0, `rgba(190,220,208,${FR.range(0.1, 0.32)})`); g2.addColorStop(1, 'rgba(190,220,208,0)');
      wx2.fillStyle = g2; wx2.beginPath(); wx2.arc(0, 0, rx, 0, TAU); wx2.fill(); wx2.restore();
    }
    wx2.globalCompositeOperation = 'destination-in';
    const mk1 = wx2.createLinearGradient(0, 0, 1024, 0); mk1.addColorStop(0, 'rgba(0,0,0,0)'); mk1.addColorStop(0.18, 'rgba(0,0,0,1)'); mk1.addColorStop(0.82, 'rgba(0,0,0,1)'); mk1.addColorStop(1, 'rgba(0,0,0,0)');
    wx2.fillStyle = mk1; wx2.fillRect(0, 0, 1024, 256);
    const mk2 = wx2.createLinearGradient(0, 0, 0, 256); mk2.addColorStop(0, 'rgba(0,0,0,0)'); mk2.addColorStop(0.3, 'rgba(0,0,0,1)'); mk2.addColorStop(0.7, 'rgba(0,0,0,1)'); mk2.addColorStop(1, 'rgba(0,0,0,0)');
    wx2.fillStyle = mk2; wx2.fillRect(0, 0, 1024, 256);
    const wispTex = tex(wisp, { aniso: 2 });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), basic(wispTex, { transparent: true, opacity: 0, depthWrite: false }));
      m.renderOrder = 20 + i; sc.add(m); this.fog.push(m);
    }

    // ---- 3D typography planes (filled lazily) ----
    this.type = {};

    // ---- wall of strips (finale) ----
    this.wall = new THREE.Group(); this.wall.visible = false; sc.add(this.wall);
    this.wallPages = [];
    this.buildWall(this.A.wallMeta);
    this.noDepth();
  }

  /** All ordering is explicit via renderOrder; depth testing off avoids Apple-GPU tile artifacts with stacked alpha planes. */
  noDepth() {
    this.scene.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.depthWrite = false; } });
  }

  /** Creates a plane of text, in world space, with crisp mip-mapped canvas texture. */
  addType(name, { text, font, size = 200, color = '#F7F8F7', letterSpacing = 0, height, stroke, lineHeight = 1.0, align = 'left', pad = 40, z = -3, scale = 1 }) {
    const lines = Array.isArray(text) ? text : [text];
    const c = document.createElement('canvas'); const x = c.getContext('2d');
    const fontStr = font.replace('{size}', size);
    x.font = fontStr; if ('letterSpacing' in x) x.letterSpacing = `${letterSpacing}px`;
    const wmax = Math.max(...lines.map((l) => x.measureText(l).width));
    const lh = size * lineHeight;
    c.width = Math.ceil(wmax + pad * 2); c.height = Math.ceil(lh * lines.length + pad * 2 + size * 0.2);
    const y2 = c.getContext('2d');
    y2.font = fontStr; if ('letterSpacing' in y2) y2.letterSpacing = `${letterSpacing}px`;
    y2.textBaseline = 'alphabetic'; y2.textAlign = align; y2.fillStyle = color;
    lines.forEach((l, i) => {
      const px = align === 'left' ? pad : align === 'center' ? c.width / 2 : c.width - pad;
      const py = pad + size * 0.82 + i * lh;
      if (stroke) { y2.strokeStyle = stroke.color; y2.lineWidth = stroke.w; y2.lineJoin = 'round'; y2.strokeText(l, px, py); }
      if (!stroke || stroke.fill !== false) y2.fillText(l, px, py);
    });
    const t = tex(c, { aniso: this.aniso });
    const wWorld = c.width * 0.01 * scale;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: t }, reveal: { value: 1 }, alpha: { value: 1 }, slant: { value: 0.35 }, tint: { value: new THREE.Color(1, 1, 1) }, tintA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D map; uniform float reveal; uniform float alpha; uniform float slant; uniform vec3 tint; uniform float tintA; varying vec2 vUv;
        void main(){ vec4 c = texture2D(map, vUv); float u = (vUv.x + (1.0 - vUv.y) * slant) / (1.0 + slant);
          float m = 1.0 - smoothstep(reveal - 0.015, reveal + 0.0001, u); if (reveal >= 1.0) m = 1.0; if (reveal <= 0.0) m = 0.0;
          gl_FragColor = vec4(mix(c.rgb, tint, tintA), c.a * m * alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wWorld, c.height * 0.01 * scale), mat);
    m.renderOrder = z < 0 ? -10 : 40; m.position.z = z;
    this.scene.add(m);
    m.material.depthTest = false;
    this.type[name] = { mesh: m, w: wWorld, h: c.height * 0.01 * scale, canvas: c };
    return this.type[name];
  }

  /**
   * The finale: a library of pages. A scatter (not a grid) of the distinct synthetic pages baked in src/art/pages.js, in three
   * depth layers (mid wall / far wall / a few soft foreground pages). Each page shows its source-language text until the
   * translation wave scans through it, then turns to English.
   */
  buildWall(meta) {
    const A = this.A, sw = PAGE.w * S, sh = PAGE.h * S;
    const zhTex = tex(A.art.wall_zh, { aniso: this.aniso }), enTex = tex(A.art.wall_en, { aniso: this.aniso });
    const mat = (slot, size, bias, dimK) => new THREE.ShaderMaterial({
      uniforms: { zh: { value: zhTex }, en: { value: enTex }, slot: { value: new THREE.Vector4(...slot) }, size: { value: new THREE.Vector2(...size) },
        wave: { value: 0 }, fade: { value: 1 }, dir: { value: 1 }, bias: { value: bias }, dimK: { value: dimK } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D zh; uniform sampler2D en; uniform vec4 slot; uniform vec2 size; uniform float wave; uniform float fade; uniform float dir; uniform float bias; uniform float dimK;
        varying vec2 vUv;
        void main(){
          vec2 uv = slot.xy + vUv * slot.zw;
          float yy = dir > 0.0 ? vUv.y : 1.0 - vUv.y;
          float front = 1.0 - wave * 1.1;
          float lit = smoothstep(front - 0.012, front + 0.012, yy) * step(0.0001, wave);
          vec3 cz = texture2D(zh, uv, bias).rgb;
          vec3 ce = texture2D(en, uv, bias).rgb;
          vec3 col = mix(cz, ce, lit);
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          vec3 dim = mix(vec3(lum), col, 0.3) * vec3(0.56, 0.7, 0.63) * 0.66;
          col = mix(dim, col, lit);
          float band = exp(-abs(yy - front) * 30.0) * step(0.0001, wave) * (1.0 - step(0.9999, wave));
          vec2 e = min(vUv, vec2(1.0) - vUv) * size;
          float rim = smoothstep(0.5, 0.0, min(e.x, e.y));
          col += vec3(0.30, 0.72, 0.12) * rim * (0.2 + 0.85 * lit);
          col += vec3(0.42, 0.9, 0.2) * band * 0.8;
          gl_FragColor = vec4(col * dimK, fade);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: false,
    });
    const R = rng(77);
    const hero = [0, wy(PAGE.h / 2)], deck = [];
    const draw = () => { if (!deck.length) { const d = Array.from({ length: meta.pages.length }, (_, i) => i); for (let i = d.length - 1; i > 0; i--) { const j = R.int(0, i); [d[i], d[j]] = [d[j], d[i]]; } deck.push(...d); } return deck.pop(); };
    const layers = [
      { n: 40, z: [-1.4, -5.5], sc: [0.88, 1.16], xr: 72, yr: 50, gap: 1.4, dimK: 1.0, alpha: 1.0, bias: 0 },
      { n: 70, z: [-9, -24], sc: [0.9, 1.45], xr: 120, yr: 78, gap: 1.0, dimK: 0.72, alpha: 1.0, bias: 0.6 },
      { n: 3, z: [3.0, 6.5], sc: [1.0, 1.35], xr: 95, yr: 55, gap: 10.0, dimK: 0.55, alpha: 0.42, bias: 2.2 },
    ];
    layers.forEach((L, li) => {
      const placed = li === 0 ? [{ x: hero[0], y: hero[1], w: sw * 1.0, h: sh * 1.0 }] : [];
      let tries = 0;
      while (placed.length - (li === 0 ? 1 : 0) < L.n && tries++ < 9000) {
        const sc = R.range(...L.sc), crop = R() < 0.24 ? 0.62 : 1, w = sw * sc, h = sh * sc * crop;
        const x = R.range(-L.xr, L.xr), y = hero[1] + R.range(-L.yr, L.yr);
        if (li === 2 && Math.abs(x) < 34) continue;                                                  // foreground pages stay at the frame edges
        if (placed.some((q) => Math.abs(x - q.x) < (w + q.w) / 2 + L.gap && Math.abs(y - q.y) < (h + q.h) / 2 + L.gap)) continue;
        placed.push({ x, y, w, h, sc, crop });
      }
      placed.slice(li === 0 ? 1 : 0).forEach((q) => {
        const slot = draw(), col = slot % meta.cols, row = Math.floor(slot / meta.cols);
        const tx = col * (meta.tw + meta.gutter), ty = row * (meta.th + meta.gutter);
        const top = q.crop < 1 && R() < 0.5;                                                     // crop: top part or bottom part of the page
        const u0 = tx / meta.W, uw = meta.tw / meta.W, vh = (meta.th / meta.H) * q.crop;
        const v1 = 1 - ty / meta.H, v0 = top ? v1 - vh : 1 - (ty + meta.th) / meta.H;           // atlas v runs bottom-up
        const size = [sw * q.sc, sh * q.sc * q.crop];
        const m = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat([u0, top ? v0 : v0, uw, vh], size, L.bias, L.dimK * R.range(0.92, 1.05)));
        m.material.uniforms.dir.value = R() < 0.7 ? 1 : -1;
        const z = R.range(...L.z);
        m.position.set(q.x, q.y, z);
        m.rotation.set(R.range(-0.05, 0.05), R.range(-0.14, 0.14), R.range(-0.045, 0.045));
        m.userData = { cx: q.x, cy: q.y, rz: m.rotation.z, dist: Math.hypot(q.x - hero[0], q.y - hero[1]) + (li === 2 ? 20 : 0), phase: R(), alpha: L.alpha, delay: R.range(0, 0.35), dur: R.range(0.7, 1.3), layer: li, slot };
        m.renderOrder = -40 + Math.round(z * 2);
        this.wall.add(m); this.wallPages.push(m);
      });
    });
  }

  setCamera({ u = PAGE.w / 2, v = 400, z = 0, d = 10.5, yaw = 0, pitch = 0, roll = 0, fov = 30, sx = 0, sy = 0 }) {
    const cam = this.camera; cam.fov = fov;
    if (sx || sy) cam.setViewOffset(this.W, this.H, -sx * this.W, -sy * this.H, this.W, this.H); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const ty = THREE.MathUtils.degToRad(yaw), tp = THREE.MathUtils.degToRad(pitch);
    const tgt = new THREE.Vector3(wx(u), wy(v), z);
    cam.position.set(tgt.x + d * Math.sin(ty) * Math.cos(tp), tgt.y + d * Math.sin(tp), tgt.z + d * Math.cos(ty) * Math.cos(tp));
    cam.up.set(0, 1, 0);
    cam.lookAt(tgt);
    cam.rotateZ(THREE.MathUtils.degToRad(roll));
    cam.updateMatrixWorld(true);
    this.camState = { u, v, z, d, yaw, pitch, roll, fov };
  }

  /** lift the text layer (bubbles) above the art with a soft shadow */
  liftBubbles(z, shadow = 1) {
    for (const o of Object.values(this.bubbles)) {
      o.mesh.position.z = o.z0 + z;
      o.shadow.position.set(o.base.x + 0.07 * z, o.base.y - 0.16 * z, 0.02);
      o.shadow.scale.setScalar(1 + 0.05 * z);
      o.shadow.material.opacity = clamp(z / 1.1) * 0.7 * shadow;
    }
  }

  /** page-space (u,v) + height z -> screen pixels */
  project(u, v, z = 0) {
    this.v.set(wx(u), wy(v), z).project(this.camera);
    return { x: (this.v.x + 1) / 2 * this.W, y: (1 - this.v.y) / 2 * this.H, behind: this.v.z > 1 };
  }

  /** apply the fold/unfold of the vista layers; d0 is the camera distance at which the stack is edge-matched */
  setLayers(spread, { d0 = 10.5, c0 = [0, -3.2], zs = null } = {}) {
    this.layers.forEach((m, i) => {
      const z = (zs ? zs[i] : m.userData.z) * spread;
      const s = (d0 - z) / d0;
      m.position.set(c0[0] + (m.userData.base.x - c0[0]) * s, c0[1] + (m.userData.base.y - c0[1]) * s, z + 0.001 * i);
      m.scale.set(s, s, 1);
      m.visible = true;
    });
    this.layerSpread = spread;
  }
  setLayersVisible(v) { this.layers.forEach((m) => (m.visible = v)); this.mists.forEach((m) => (m.visible = v)); }

  render() { this.renderer.render(this.scene, this.camera); }
}
