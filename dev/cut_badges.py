# Cut the 8 rank badges out of Jaime's sheet and key out the backdrop.
# Background is removed by flood-filling dark pixels connected to the crop edge,
# so the dark faces inside each shield stay opaque.
from PIL import Image, ImageFilter
from collections import deque
import os

D = os.path.dirname(os.path.abspath(__file__))
sheet = Image.open(f'{D}/badges/sheet.png').convert('RGB')
BOXES = {  # x0, y0, x1, y1 on the 1199x1312 sheet; stops above the diamond chains
    'e': (70, 10, 285, 258), 'd': (345, 15, 560, 260), 'c': (615, 8, 865, 260), 'b': (895, 8, 1140, 260),
    'a': (50, 425, 415, 698), 's': (435, 425, 765, 698), 'nl': (800, 425, 1145, 698), 'm': (365, 850, 835, 1160),
}
T = 46        # max-channel brightness still treated as backdrop (hex grid lines sit below this)
SIZE = 256
os.makedirs(f'{D}/badges', exist_ok=True)

for name, box in BOXES.items():
    im = sheet.crop(box)
    w, h = im.size
    px = im.load()
    bg = [[False] * w for _ in range(h)]
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or bg[y][x] or max(px[x, y]) > T:
            continue
        bg[y][x] = True
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if not bg[y][x]:
                mp[x, y] = 255
    # feather the cut edge so it doesn't look jagged on lighter panels
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    rgba = im.convert('RGBA')
    rgba.putalpha(mask)
    # square canvas, badge centered, fit to SIZE
    s = max(w, h)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.paste(rgba, ((s - w) // 2, (s - h) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    canvas.save(f'{D}/badges/{name}.png', optimize=True)
    print(name, os.path.getsize(f'{D}/badges/{name}.png'), 'bytes')

# preview on two panel colors
prev = Image.new('RGB', (SIZE * 8, SIZE * 2), (20, 26, 33))
for i, name in enumerate(BOXES):
    b = Image.open(f'{D}/badges/{name}.png')
    prev.paste(b, (i * SIZE, 0), b)
    tile = Image.new('RGB', (SIZE, SIZE), (58, 70, 84))
    tile.paste(b, (0, 0), b)
    prev.paste(tile, (i * SIZE, SIZE))
prev.save(f'{D}/badges/preview.png')
