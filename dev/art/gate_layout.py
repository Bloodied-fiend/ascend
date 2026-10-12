# Offline Gate placement (Belphegor spec): one fixed, organic layout per rank tier, checked for collisions.
#   python dev/art/gate_layout.py   -> writes dev/art/gate_layout.json and the `const GLAY=` line in dev/ascend.html
# Positions are % of the map box (366x420 css px at 390px phone width). gate_art.py reads the json.
import json, math, re
from pathlib import Path

W, H = 366, 420
TIERS = range(6)
RANK_IDS = [["e", "e2", "e3"], ["d", "d2", "d3"], ["c", "c2", "c3"], ["b", "b2", "b3"], ["a", "a2", "a3"], ["s", "s2", "s3"]]
# band: y range %, tag height tb, beam scale bs, selected tag height tb1
B3 = {1: ((34, 50), 80, .59, 108), 0: ((46, 66), 85, .63, 113), -1: ((62, 84), 88, .65, 116)}
B2 = {"hi": ((38, 58), 80, .59, 108), "lo": ((60, 84), 88, .65, 116)}
HUD = (8, 374, 206, 412)
PAD = 4

def ghash(gid):
    h = 0
    for ch in gid: h = (h * 31 + ord(ch)) % 65521
    return h

def mulberry32(a):
    def r():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return r

zof = lambda y: min(1, max(.68, .68 + (y - 34) * .32 / 50))

def boxes(x, y, tb, tb1):
    """ring, short tag, tall tag (selected/active), label plate (active only); px rects (x0,y0,x1,y1)"""
    px, py, z = x / 100 * W, y / 100 * H, zof(y)
    rw, rh = 64 * z + 12, 24 * z + 10
    ring = (px - rw / 2, py - rh / 2, px + rw / 2, py + rh / 2)
    tag = lambda h, extra=0: (px - 24, py + 12 * z - h * z - 42 - extra, px + 24, py + 12 * z - h * z)
    # tall tag = selected or active (the active one shows "BREAK"/"RED" in place of its level line)
    return {"ring": ring, "tagS": tag(tb), "tagT": tag(tb1)}

def hit(a, b, pad=PAD):
    return a[0] < b[2] + pad and b[0] < a[2] + pad and a[1] < b[3] + pad and b[1] < a[3] + pad

def shrink(b, f):
    cx, w = (b[0] + b[2]) / 2, (b[2] - b[0]) * f / 2
    return (cx - w, b[1], cx + w, b[3])

def clash(A, B):
    # Calibrated so the designer-approved v26 grid passes. Real states: any gate short or tall; only the active one
    # has a label. The nearer gate (larger y) is drawn on top, so its tag may cross a farther gate's ring or label.
    F, K = (A, B) if A["ring"][1] >= B["ring"][1] else (B, A)   # F = front, K = back
    if hit(F["ring"], K["ring"]): return True
    for tf in ("tagS", "tagT"):
        for tk in ("tagS", "tagT"):
            if hit(F[tf], K[tk], 0): return True
        if hit(K[tf], F["ring"]): return True
        # a nearer tag may graze a farther ring or label, but never cover its middle
        if hit(F[tf], shrink(K["ring"], .5), 0): return True
    return False

def valid(bx, placed):
    if bx["tagT"][1] < 40: return False   # tallest tag stays below the map top
    if any(bx[k][0] < 6 or bx[k][2] > 360 for k in ("ring", "tagS", "tagT")): return False
    if any(hit(b, HUD, 0) for b in bx.values()): return False
    return not any(clash(bx, p["bx"]) for p in placed)

# Random placement can't fit 9 gates this size at 366px: valid layouts sit near the approved grid.
# So start from that grid (known valid) and random-walk each gate; keep only moves that stay valid,
# never shrink a rank's x spread below 40%, and never bring same-rank gates closer in y.
GRID3 = {1: (40, (18, 46, 74)), 0: (60, (32, 60, 88)), -1: (80, (16, 46, 76))}
GRID2 = {"hi": (46, (32, 60, 88)), "lo": (80, (16, 46, 76))}
def samey(pl):
    return sum(max(0, 6 - abs(a["y"] - b["y"])) for i, a in enumerate(pl) for b in pl[i + 1:] if a["r"] == b["r"])
def spread_ok(pl, r):
    xs = [p["x"] for p in pl if p["r"] == r]
    return max(xs) - min(xs) >= 40
def layout(tier, steps=4000):
    ranks = [r for r in (tier - 1, tier, tier + 1) if 0 <= r <= 5]
    three = len(ranks) == 3
    key = (lambda r: r - tier) if three else (lambda r: "hi" if r == max(ranks) else "lo")
    pl = []
    for r in ranks:
        (y0, y1), tb, bs, tb1 = (B3 if three else B2)[key(r)]
        gy, gxs = (GRID3 if three else GRID2)[key(r)]
        for gid, gx in zip(sorted(RANK_IDS[r], key=ghash), gxs):
            pl.append({"id": gid, "r": r, "x": gx, "y": gy, "y0": y0, "y1": y1, "tb": tb, "bs": bs, "tb1": tb1, "bx": boxes(gx, gy, tb, tb1)})
    bad = lambda: sum(not valid(p["bx"], [q for q in pl if q is not p]) for p in pl)
    rnd = mulberry32(1000 + tier)
    for _ in range(steps):
        p = pl[int(rnd() * len(pl))]
        nx, ny = p["x"] + (rnd() * 2 - 1) * 6, p["y"] + (rnd() * 2 - 1) * 4
        if not (8 <= nx <= 92 and p["y0"] <= ny <= p["y1"]): continue
        b0, s0, old = bad(), samey(pl), (p["x"], p["y"], p["bx"])
        p["x"], p["y"], p["bx"] = nx, ny, boxes(nx, ny, p["tb"], p["tb1"])
        # keep the move only if it adds no collisions, doesn't bunch a rank in y, and keeps the rank's x spread
        if bad() > b0 or samey(pl) > s0 or not spread_ok(pl, p["r"]):
            p["x"], p["y"], p["bx"] = old
    assert bad() == 0, f"tier {tier}: collisions left after the walk"
    return 1000 + tier, pl

out, js = {}, {}
for t in TIERS:
    seed, pl = layout(t)
    out[t] = {"seed": seed, "gates": {p["id"]: [round(p["x"], 1), round(p["y"], 1)] for p in pl}, "boxes": [b for p in pl for b in p["bx"].values()]}
    js[t] = {p["id"]: [round(p["x"], 1), round(p["y"], 1), round(zof(p["y"]), 3), p["tb"], p["bs"], p["tb1"]] for p in pl}
    print(f"tier {t}: seed {seed}, {len(pl)} gates")
here = Path(__file__).resolve().parent
(here / "gate_layout.json").write_text(json.dumps(out))
html = here.parent / "ascend.html"
s = open(html, encoding="utf-8", newline="").read()
line = "const GLAY=" + json.dumps(js, separators=(",", ":")) + "; // generated by dev/art/gate_layout.py: tier -> id -> [x%,y%,z,tb,bs,tb1]"
s, n = re.subn(r"const GLAY=.*?; // generated by dev/art/gate_layout\.py[^\n]*", lambda m: line, s)
assert n == 1, "GLAY line not found in ascend.html"
open(html, "w", encoding="utf-8", newline="").write(s)
print("wrote GLAY")
