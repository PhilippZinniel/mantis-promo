// Loads every raster the film uses (baked art + extracted logo parts) and waits for fonts.
const load = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'sync'; i.onload = () => res(i); i.onerror = () => rej(new Error('failed ' + src)); i.src = src; });

export const ZH_CHARS = '山的那边，还有别的世界吗？有。而且更多群山之外别天地';

export async function loadAssets() {
  const art = {};
  const names = {
    vista_sky: 'vista_sky', vista_far: 'vista_far', vista_mid: 'vista_mid', vista_near: 'vista_near', vista_leaves: 'vista_leaves', vista_mist: 'vista_mist',
    vista: 'vista_flat', closeup: 'panels_closeup', valley: 'panels_valley', burst: 'panels_burst',
  };
  await Promise.all(Object.entries(names).map(async ([k, f]) => { art[k] = await load(`/build/art/${f}.png`); }));
  const meta = await (await fetch('/build/logo/logo_meta.json')).json();
  const logo = {};
  await Promise.all(Object.keys(meta.parts).map(async (k) => { logo[k] = await load(`/build/logo/parts/${k}.png`); }));
  logo.full = await load('/build/logo/logo_full.png');
  const brand = {};
  await Promise.all(['banner_mountain', 'banner_cloud', 'banner_hills'].map(async (k) => { brand[k] = await load(`/build/brand/${k}.png`); }));
  const vistaMeta = await (await fetch('/build/art/vista.json')).json();
  const cues = await (await fetch('/src/cues.json')).json();
  const trace = await (await fetch('/build/art/vista_trace.json')).json();
  // fonts: force the CJK slices actually used to download before any canvas text is drawn
  await Promise.all([
    document.fonts.load('700 50px "Noto Sans SC"', ZH_CHARS), document.fonts.load('700 50px "Noto Serif SC"', ZH_CHARS),
    document.fonts.load('900 italic 100px "Exo 2"', 'WORDSCHANGE.THEARTSTAYS'), document.fonts.load('800 italic 100px "Exo 2"', 'WORDS'), document.fonts.load('500 40px "Exo 2"', 'TRANSLATE'), document.fonts.load('600 40px "Exo 2"', 'TRANSLATE'),
    document.fonts.load('600 50px "Barlow Condensed"', 'ABC'), document.fonts.load('700 50px "Barlow Condensed"', 'ABC'), document.fonts.load('800 50px "Barlow Condensed"', 'ABC'),
  ]);
  await document.fonts.ready;
  return { art, logo, brand, logoMeta: meta, vistaMeta, cues, trace };
}
