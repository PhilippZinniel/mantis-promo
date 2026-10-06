"""One-frame-per-second contact sheet of a video: python tools/contact_sheet.py in.mp4 out.jpg [cols]"""
import glob, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 8
with tempfile.TemporaryDirectory() as d:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vf', 'fps=1,scale=480:-2', f'{d}/f%03d.png'], check=True)
    files = sorted(glob.glob(f'{d}/f*.png'))
    ims = [Image.open(f).convert('RGB') for f in files]
    tw, th = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * th), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for i, im in enumerate(ims):
        x, y = (i % cols) * tw, (i // cols) * th
        sheet.paste(im, (x, y)); dr.rectangle([x + 6, y + 6, x + 54, y + 22], fill=(0, 0, 0)); dr.text((x + 10, y + 9), f'{i}s', fill=(255, 255, 255))
    sheet = sheet.resize((cols * 320, int(rows * 320 * th / tw)), Image.LANCZOS)
    sheet.save(out, quality=88)
    print('contact sheet', out, sheet.size, len(ims), 'frames')
