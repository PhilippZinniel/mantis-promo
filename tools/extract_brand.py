"""Cut the corner panels (mountain ink, cloud ink, green hills) out of assets/banner.png with antialiased alpha.
Outputs build/brand/*.png. assets/ is never modified."""
import os
from PIL import Image, ImageDraw

os.makedirs('build/brand', exist_ok=True)
im = Image.open('assets/banner.png').convert('RGB')

def cut(poly, name):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    S = 4
    m = Image.new('L', ((x1 - x0) * S, (y1 - y0) * S), 0)
    ImageDraw.Draw(m).polygon([((x - x0) * S, (y - y0) * S) for x, y in poly], fill=255)
    m = m.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    c = im.crop((x0, y0, x1, y1)).convert('RGBA'); c.putalpha(m)
    c.save(f'build/brand/{name}.png')
    print(name, c.size)

cut([(0, 0), (342, 0), (208, 226), (0, 258)], 'banner_mountain')
cut([(2048, 100), (2048, 410), (1690, 508)], 'banner_cloud')
cut([(0, 276), (206, 242), (150, 330), (0, 440)], 'banner_hills')
