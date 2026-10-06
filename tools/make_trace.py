"""Silhouette trace of the baked 'near' vista layer (cliff, pines, traveler) -> build/art/vista_trace.json.
Used for the green line-trace in "THE ART STAYS." """
import json
import numpy as np
from PIL import Image
from skimage import measure

a = np.asarray(Image.open('build/art/vista_near.png'))[..., 3] / 255.0
small = a[::2, ::2]
out = []
for c in sorted(measure.find_contours(small, 0.5), key=len, reverse=True)[:8]:
    c = measure.approximate_polygon(c, 1.2)
    if len(c) < 8:
        continue
    out.append([[round(50 + x * 2 / 2.4, 1), round(40 + y * 2 / 2.4, 1)] for y, x in c])   # layer px -> page units
json.dump(out, open('build/art/vista_trace.json', 'w'))
print('trace paths', [len(p) for p in out])
