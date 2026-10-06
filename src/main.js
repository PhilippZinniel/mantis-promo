import { loadAssets } from './assets.js';
import { World } from './world.js';
import { Film } from './film.js';

// ?v=1 renders the native 9:16 recomposition (1080x1920); default is 16:9 (1920x1080)
const vertical = new URLSearchParams(location.search).get('v') === '1';
const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
const canvas = document.getElementById('main');
canvas.width = W; canvas.height = H; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const ready = (async () => {
  const assets = await loadAssets();
  const world = new World(assets, { W, H });
  const film = new Film(canvas, world, assets);
  window.film = film; window.world = world;
  return film;
})();
window.filmReady = ready.then(() => true).catch((e) => { console.error(e); throw e; });
