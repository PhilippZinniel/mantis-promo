import { loadAssets } from './assets.js';
import { World } from './world.js';
import { Film } from './film.js';

const canvas = document.getElementById('main');
const ready = (async () => {
  const assets = await loadAssets();
  const world = new World(assets);
  const film = new Film(canvas, world, assets);
  window.film = film; window.world = world;
  return film;
})();
window.filmReady = ready.then(() => true).catch((e) => { console.error(e); throw e; });
