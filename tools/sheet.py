"""Contact sheet: python tools/sheet.py out.png cols thumbW file1 file2 ..."""
import sys
from PIL import Image, ImageDraw
out, cols, tw, *files = sys.argv[1:]
cols, tw = int(cols), int(tw)
ims = [Image.open(f).convert('RGB') for f in files]
th = int(tw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw + (cols + 1) * 6, rows * th + (rows + 1) * 6), (36, 36, 36))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = 6 + (i % cols) * (tw + 6), 6 + (i // cols) * (th + 6)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
    d.rectangle([x, y, x + 150, y + 18], fill=(0, 0, 0)); d.text((x + 4, y + 3), f.split('/')[-1], fill=(255, 255, 255))
sheet.save(out)
