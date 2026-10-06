"""Extract a clean RGBA matte + separable layers from assets/logo.png.

The supplied logo sits on a flat ~#F7F8F7 background. We estimate foreground colour
from nearby interior pixels and recover coverage by projecting onto the bg->fg
axis, so edges are free of white fringes and the greens stay opaque on dark
backgrounds. Nothing in assets/ is modified; outputs go to build/logo/.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SCALE = 2
src = Image.open('assets/logo.png').convert('RGB')
W, H = src.size
up = src.resize((W * SCALE, H * SCALE), Image.LANCZOS)
im = np.asarray(up).astype(np.float32)
bg = np.median(np.asarray(src).reshape(-1, 3)[:5000], axis=0).astype(np.float32)  # flat corner colour
bg = np.array([247.3, 247.6, 247.0], np.float32)

diff = im - bg
d = np.sqrt((diff ** 2).sum(-1))
certain = d > 95                      # solidly foreground
# nearest-certain colour for every pixel (edge decontamination)
idx = ndi.distance_transform_edt(~certain, return_distances=False, return_indices=True)
fg = im[idx[0], idx[1]]
fd = fg - bg
fdn = (fd ** 2).sum(-1) + 1e-6
cov = np.clip((diff * fd).sum(-1) / fdn, 0, 1)
# re-sharpen coverage after the 2x lanczos so edges stay crisp
cov = np.clip((cov - 0.12) / 0.76, 0, 1)
cov = cov * cov * (3 - 2 * cov)
cov[d < 6] = 0
rgba = np.dstack([np.where(certain[..., None], im, fg), cov * 255]).clip(0, 255).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save('build/logo/logo_full.png')

# --- components -------------------------------------------------------------
mask = cov > 0.5
lab, n = ndi.label(mask)
sizes = ndi.sum(mask, lab, range(1, n + 1))
objs = ndi.find_objects(lab)
print('components', n)
rows = []
for i in np.argsort(-sizes)[:40]:
    sl = objs[i]
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    col = im[lab == i + 1].mean(0).astype(int)
    rows.append((i + 1, int(sizes[i]), (x0 // SCALE, y0 // SCALE, x1 // SCALE, y1 // SCALE), tuple(col)))
for r in rows: print(r)
vis = np.zeros((*lab.shape, 3), np.uint8)
rng = np.random.default_rng(3)
pal = rng.integers(60, 255, (n + 1, 3)); pal[0] = 255
vis[:] = pal[lab]
Image.fromarray(vis).resize((W, H)).save('build/logo/_components.png')   # QA aid

# --- layer export -----------------------------------------------------------
import json
from skimage import measure

comp_info = {}
for i in range(1, n + 1):
    sl = objs[i - 1]
    comp_info[i] = dict(
        x0=sl[1].start / SCALE, y0=sl[0].start / SCALE, x1=sl[1].stop / SCALE, y1=sl[0].stop / SCALE,
        area=float(sizes[i - 1]),
    )

def comp_ids(pred):
    return [i for i, c in comp_info.items() if pred(c)]

big = lambda c: c['area'] > 150
by_x = lambda ids: sorted(ids, key=lambda i: comp_info[i]['x0'])
word = comp_ids(lambda c: c['y0'] >= 780 and c['y1'] <= 1045 and big(c))
tag = comp_ids(lambda c: c['y0'] >= 1050)
emb = comp_ids(lambda c: c['y1'] < 880 and c['y0'] < 780 or (c['y0'] < 780))
emb = [i for i in emb if i not in word and i not in tag]

# identify emblem parts by geometry
def pick(ids, key, rev=False):
    return sorted(ids, key=key, reverse=rev)
ring_ids = [i for i in emb if comp_info[i]['area'] > 20000 and i != 0]
# crescents are the thin tall ones; left crescent has smallest x0 among thin comps
thin = [i for i in emb if (comp_info[i]['x1'] - comp_info[i]['x0']) < 0.65 * (comp_info[i]['y1'] - comp_info[i]['y0'])]
ring_left = [i for i in thin if comp_info[i]['x1'] < 700 and comp_info[i]['area'] > 30000]
ring_right = [i for i in thin if comp_info[i]['x0'] > 800 and comp_info[i]['area'] > 20000]
arms = [i for i in emb if comp_info[i]['area'] > 30000 and i not in ring_left + ring_right]
print('ring_left', ring_left, 'ring_right', ring_right, 'emb', emb)

letters = by_x(word)
print('word', [(i, comp_info[i]['x0'], comp_info[i]['y0'], comp_info[i]['x1']) for i in letters])

def export(ids, name):
    m = np.isin(lab, ids)
    # keep soft edges: include coverage of pixels adjacent to the component
    grow = ndi.binary_dilation(m, iterations=2)
    out = rgba.copy()
    out[..., 3] = np.where(grow, rgba[..., 3], 0)
    Image.fromarray(out, 'RGBA').save(f'build/logo/{name}.png')

groups = {
    'emblem': emb,
    'wordmark': word,
    'tagline': tag,
    'ring_left': ring_left,
    'ring_right': ring_right,
}

# vector contours for every component (original-pixel coordinates)
def contour_path(ids, tol=0.35):
    m = np.isin(lab, ids)
    m = ndi.binary_closing(m, iterations=1)
    f = ndi.gaussian_filter(m.astype(np.float32), 0.8)
    cs = measure.find_contours(f, 0.5)
    parts = []
    for c in cs:
        if len(c) < 12:
            continue
        c = measure.approximate_polygon(c, tol * SCALE)
        pts = [(x / SCALE, y / SCALE) for y, x in c]
        parts.append('M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + 'Z')
    return ''.join(parts)

paths = {}
for i, c in comp_info.items():
    if c['area'] < 150:
        continue
    col = im[lab == i].mean(0)
    paths[str(i)] = dict(d=contour_path([i]), bbox=[c['x0'], c['y0'], c['x1'], c['y1']], color='#%02x%02x%02x' % tuple(col.astype(int)))
meta = dict(size=[W, H], scale=SCALE, groups={k: v for k, v in groups.items()}, paths=paths,
            letters=letters)
json.dump(meta, open('build/logo/logo_meta.json', 'w'))
print('exported', {k: len(v) for k, v in groups.items()})

# --- tight per-part crops (for the renderer) ---------------------------------
import os
os.makedirs('build/logo/parts', exist_ok=True)
for f in os.listdir('build/logo'):
    pass
PAD = 6
parts = {}
def export_crop(ids, name):
    m = np.isin(lab, ids)
    grow = ndi.binary_dilation(m, iterations=2)
    ys, xs = np.where(m)
    y0, y1, x0, x1 = max(ys.min() - PAD, 0), min(ys.max() + PAD, lab.shape[0]), max(xs.min() - PAD, 0), min(xs.max() + PAD, lab.shape[1])
    out = rgba.copy()
    out[..., 3] = np.where(grow, rgba[..., 3], 0)
    Image.fromarray(out[y0:y1, x0:x1], 'RGBA').save(f'build/logo/parts/{name}.png')
    parts[name] = dict(x=x0 / SCALE, y=y0 / SCALE, w=(x1 - x0) / SCALE, h=(y1 - y0) / SCALE)

export_crop(emb, 'emblem')
export_crop(word, 'wordmark')
export_crop(tag, 'tagline')
export_crop(ring_left, 'ring_left')
export_crop(ring_right, 'ring_right')
export_crop([i for i in emb if i not in ring_left + ring_right], 'mantis')
names = {10: 'M_body', 11: 'M_slash', 14: 'M_leg', 15: 'a', 16: 'n', 13: 't', 17: 'i', 12: 'i_leaf', 18: 's'}
for i, nme in names.items():
    export_crop([i], 'L_' + nme)
export_crop([10, 11, 14], 'L_M')
export_crop([comp_info and 7], 'arm_left')
export_crop([8], 'arm_right')
export_crop([1, 3, 4, 5], 'head')
meta['parts'] = parts
json.dump(meta, open('build/logo/logo_meta.json', 'w'))
print({k: (round(v['x']), round(v['y']), round(v['w']), round(v['h'])) for k, v in parts.items()})

# QA composites on dark / green backgrounds
for nm, colr in [('dark', (11, 18, 16)), ('green', (93, 176, 42))]:
    bgim = Image.new('RGBA', (W, H), colr + (255,))
    lg = Image.open('build/logo/logo_full.png').resize((W, H), Image.LANCZOS)
    bgim.alpha_composite(lg)
    bgim.convert('RGB').save(f'build/logo/_qa_{nm}.png')

# extra part: the small shadow triangle between the arms
export_crop([9], 'tri')
meta['parts'] = parts
json.dump(meta, open('build/logo/logo_meta.json', 'w'))
# reference geometry: the ring centre/radius (logo px) used by the renderer for wedge reveals
print('tri', parts['tri'])
