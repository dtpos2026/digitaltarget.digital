#!/usr/bin/env python3
"""Design-match board, step 3: put the package's own preview (left) next to our screenshot (right), one PNG per screen, in $BOARD_DIR/pairs/."""
import json, os
from PIL import Image, ImageDraw
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('BOARD_DIR', os.path.join(ROOT, '.design-board'))
PREV = os.path.join(ROOT, 'design-project', '02-restaurant-software', 'previews')
os.makedirs(os.path.join(OUT, 'pairs'), exist_ok=True)
n = 0
for r in sorted(json.load(open(os.path.join(OUT, 'screens.json'))), key=lambda r: r['id']):
    a, d = os.path.join(OUT, r['id'] + '-app.png'), os.path.join(PREV, r['id'].lower() + '.png')
    if not (os.path.exists(a) and os.path.exists(d)): continue
    A, D = Image.open(a).convert('RGB'), Image.open(d).convert('RGB')
    w = 900
    A = A.resize((w, int(A.height * w / A.width)), Image.LANCZOS); D = D.resize((w, int(D.height * w / D.width)), Image.LANCZOS)
    im = Image.new('RGB', (w * 2 + 12, max(A.height, D.height) + 28), (30, 30, 40)); dr = ImageDraw.Draw(im)
    dr.text((8, 8), f"DESIGN  {r['id']} {r['name']}", fill=(255, 255, 255)); dr.text((w + 20, 8), f"OURS  {r['file']}", fill=(255, 220, 120))
    im.paste(D, (0, 28)); im.paste(A, (w + 12, 28)); im.save(os.path.join(OUT, 'pairs', r['id'] + '.png')); n += 1
print(n, 'pairs ->', os.path.join(OUT, 'pairs'))
