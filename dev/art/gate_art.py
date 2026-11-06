# Procedural art for the Gate Dispatch map: an original holo continent seen through a tilted camera,
# plus looping flame-pillar sprite sheets. Output -> ../../gates/ (served next to index.html).
#   python dev/art/gate_art.py
# Pins must sit on land: PINS mirrors GROW slots in dev/ascend.html (x%, y% of the map box).
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "gates"
OUT.mkdir(exist_ok=True)
# every spot a Gate can occupy = the fixed per-tier layouts from gate_layout.py
import json
LAY = json.loads((Path(__file__).resolve().parent / "gate_layout.json").read_text())
PINS = {f"{gid}@{tier}": tuple(xy) for tier, v in LAY.items() for gid, xy in v["gates"].items()}
GBOX = [b for v in LAY.values() for b in v["boxes"]]   # css px rects of every ring/tag/label in every tier
rng = np.random.default_rng(7)

# ---------- camera: screen (u,v in 0..1) <-> ground plane (X,Z) ----------
VH = 0.17          # horizon height on screen
FX = 2.2           # horizontal spread
def ground(u, v):
    z = (1 - VH) / np.maximum(v - VH, 1e-4)
    return (u - 0.5) * z * FX, z

# ---------- value noise evaluated at arbitrary points ----------
PERM = rng.permutation(4096)
def lattice(ix, iz, seed):
    return (PERM[(PERM[(ix + seed * 131) & 4095] + iz * 7) & 4095] / 4095.0)
def vnoise(x, z, seed=0):
    ix, iz = np.floor(x).astype(np.int64), np.floor(z).astype(np.int64)
    fx, fz = x - ix, z - iz
    sx, sz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a, b = lattice(ix, iz, seed), lattice(ix + 1, iz, seed)
    c, d = lattice(ix, iz + 1, seed), lattice(ix + 1, iz + 1, seed)
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz
def fbm(x, z, oct=6, seed=0):
    s, amp, f, tot = 0, 1, 1, 0
    for o in range(oct):
        s += amp * vnoise(x * f, z * f, seed + o); tot += amp; amp *= .5; f *= 2.03
    return s / tot

# ---------- map ----------
def render_map(W=760, H=740, SS=2):
    w, h = W * SS, H * SS
    v, u = np.mgrid[0:h, 0:w].astype(np.float64)
    u, v = (u + .5) / w, (v + .5) / h
    X, Z = ground(u, v)
    sky = v <= VH + 0.004
    X, Z = np.where(sky, 0, X), np.where(sky, 50, Z)

    # height: continent mask around the pins + fractal detail; a far landmass near the horizon
    hgt = fbm(X * 1.1, Z * 1.1, 6, 1) * .9
    cont = np.zeros_like(X)
    for (px, py) in PINS.values():
        gx, gz = ground(px / 100, py / 100)
        cont += np.exp(-(((X - gx) / 1.25) ** 2 + ((Z - gz) / .9) ** 2))
    cont = np.minimum(cont, 1.4)
    far = np.exp(-(((X + 2.5) / 3.5) ** 2 + ((Z - 9) / 2.5) ** 2)) * .9 + np.exp(-(((X - 4) / 2.5) ** 2 + ((Z - 6.5) / 1.6) ** 2)) * .7
    hgt = hgt * .75 + cont * .55 + far * .5 - .55
    # inland sea for interest
    hgt -= .55 * np.exp(-(((X - .35) / .32) ** 2 + ((Z - 1.75) / .22) ** 2))
    hgt += .45 * np.exp(-(((u - .5) / .42) ** 6 + ((v - .6) / .26) ** 6))   # broad lift: coast never cuts through the gate bands
    land = hgt > 0

    # screen-space derivatives -> constant-width lines
    gy, gx = np.gradient(hgt)
    gmag = np.hypot(gx, gy) + 1e-9
    def line(field, step, width):
        f = field / step
        d = np.abs(f - np.round(f)) * step / gmag_of(field)
        return np.clip(1 - d / width, 0, 1)
    def gmag_of(field):
        a, b = np.gradient(field); return np.hypot(a, b) + 1e-9

    fog = np.clip((Z - 2) / 10, 0, 1)            # fade toward the horizon
    near = 1 - fog
    img = np.zeros((h, w, 3))
    # ocean: navy with a faint world grid
    ocean = np.array([6, 13, 22]) / 255
    img[:] = ocean
    grid = np.maximum(line(X, .25, 1.1 * SS), line(Z, .25, 1.1 * SS)) * near
    img += grid[..., None] * np.array([40, 120, 140]) / 255 * .55

    # land: hillshade teal
    nx, ny = -gx / (gmag + .002), -gy / (gmag + .002)
    shade = np.clip(.55 + .45 * (nx * -.6 + ny * -.8), 0, 1)
    base = np.array([16, 52, 66]) / 255
    hi = np.array([36, 96, 112]) / 255
    lc = base + (hi - base) * (shade * .6 + np.clip(hgt * 1.5, 0, .4))[..., None]
    img = np.where(land[..., None], lc, img)
    # contours on land
    cont_l = line(hgt, .055, .9 * SS) * land * (near * .8 + .2)
    img += cont_l[..., None] * np.array([90, 200, 220]) / 255 * .22
    # land grid, fainter
    img += (grid * land)[..., None] * np.array([90, 220, 240]) / 255 * .15

    # coastline: crisp bright line + soft glow
    coast = np.clip(1 - np.abs(hgt) / gmag / (1.3 * SS), 0, 1)
    glow = np.array(Image.fromarray((coast * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7 * SS))) / 255
    cyan = np.array([130, 235, 255]) / 255
    img += (coast * (near * .7 + .3))[..., None] * cyan * .95
    img += (glow * 2.2 * (near * .7 + .3))[..., None] * cyan * .55

    # rivers: thin lines along a noise valley on land
    rv = np.abs(fbm(X * 2.2 + 9, Z * 2.2, 4, 9) - .5)
    river = np.clip(1 - rv / gmag_of(rv) / (.8 * SS), 0, 1) * land * (hgt > .05) * near
    img += river[..., None] * np.array([120, 220, 255]) / 255 * .35

    # fog, horizon haze, sky
    haze = np.array([20, 60, 78]) / 255
    img = img * (1 - fog[..., None] * .75) + haze * fog[..., None] * .55
    hz = np.exp(-((v - VH) / .035) ** 2)
    img += hz[..., None] * np.array([60, 170, 200]) / 255 * .35
    skyc = np.array([5, 9, 16]) / 255 + (np.array([18, 44, 60]) / 255 - np.array([5, 9, 16]) / 255) * (v / VH)[..., None]
    img = np.where(sky[..., None], skyc, img)
    # scanlines + vignette
    img *= (1 - .06 * (np.arange(h)[:, None, None] // SS % 3 == 0))
    vig = 1 - .45 * (((u - .5) * 1.6) ** 2 + ((v - .55) * 1.3) ** 2)
    img *= np.clip(vig, .45, 1)[..., None]

    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)

    # settlements: clusters of small muted blocks in the land's own tone, plus one larger stepped landmark.
    # Projected through the map's own camera, so their edges converge with the grid; ht = fraction of camera height.
    AA = 4
    def project(X, Z, ht=0):
        return (.5 + X / (Z * FX)) * W * AA, (VH + (1 - VH) / Z * (1 - ht)) * H * AA
    def town(cu, cv, n, landmark=False):
        """blocks as (x0, x1, z0, z1, base height, top height), far first, so nearer ones cover them"""
        X0, Z0 = ground(cu, cv)
        s = Z0 ** .7  # far towns scaled up a little so they stay readable
        r = np.random.default_rng(int(cu * 100) * 1000 + int(cv * 100) + n)
        step, out = .027 * s, []
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                dist = np.hypot(i, j) / (n + .5)
                if dist > 1 or r.random() < .06 + .3 * dist or (landmark and dist < .5): continue
                x, z = X0 + (i + r.uniform(-.2, .2)) * step, Z0 + (j + n + r.uniform(-.2, .2)) * step * .75
                wide = 1.5 if r.random() < .15 else 1  # the odd long block breaks up the rows
                out.append((x, x + step * wide * r.uniform(.65, 1), z, z + step * .75 * r.uniform(.65, 1), 0, (.012 + .03 * (1 - dist) ** 1.2 * r.uniform(.4, 1.2)) * s))
        if landmark:  # stacked tiers, each resting on the one below
            zc = Z0 + n * step * .75
            for half, ht0, ht in ((2.0, 0, .03), (1.4, .03, .06), (.85, .06, .1), (.35, .1, .15)):
                hw, hd = half * step, half * step * .75
                out.append((X0 - hw, X0 + hw, zc - hd, zc + hd, ht0 * s, ht * s))
        return sorted(out, key=lambda t: (-(t[2] + t[3]), t[4]))
    HUD = (0, 372, 190, 420)  # the CLEARED / ACTIVE readout, bottom left
    # gate_layout.py lists each gate as ring, short tag, tall tag. Tags and beams paint above the map and only one tier
    # shows at a time, so a town may pass behind them; it must never sit on a gate's ground ring in any tier.
    RINGS = [b for v in LAY.values() for b in v["boxes"][::3]]
    def clear(cu, cv, n, landmark=False, m=4):  # on the map, every block on land, clear of the HUD and every ring by m px
        pts = [p for (x0, x1, z0, z1, _, ht) in town(cu, cv, n, landmark) for p in (project(x0, z0), project(x1, z0), project(x0, z1), project(x1, z1), project(x0, z1, ht), project(x1, z1, ht))]
        if not pts: return False
        b = (min(q[0] for q in pts) / (W * AA) * 366, min(q[1] for q in pts) / (H * AA) * 420, max(q[0] for q in pts) / (W * AA) * 366, max(q[1] for q in pts) / (H * AA) * 420)
        if b[0] < 6 or b[2] > 360 or b[3] > 414: return False
        if any(hgt[min(h - 1, int(q[1] / (H * AA) * h)), min(w - 1, int(q[0] / (W * AA) * w))] <= .02 for q in pts[::6]): return False
        return not any(b[0] - m < g[2] and g[0] < b[2] + m and b[1] - m < g[3] and g[1] < b[3] + m for g in RINGS + [HUD])
    grid = [(u0 / 100, v0 / 100) for v0 in range(46, 96, 2) for u0 in range(4, 97, 2)]
    gap = lambda c, s: np.hypot((c[0] - s[0]) * 366, (c[1] - s[1]) * 420)
    # the one slot no ring, tag or beam touches in any tier, so the landmark is always seen
    LANDMARK = (.57, .96, 2, True)
    assert clear(*LANDMARK, 6), "landmark no longer fits"  # 6px: it stands right beside two rings' drawn halos
    sites = [LANDMARK]
    # spread: each new town is the free spot farthest from the ones already placed; larger towns first
    for n, count, least in ((3, 5, 70), (2, 9, 50)):
        cand = [c for c in grid if clear(*c, n)]
        while cand and len(sites) < count:
            best = max(cand, key=lambda c: min((gap(c, s) for s in sites), default=1e9))
            if sites and min(gap(best, s) for s in sites) < least: break
            sites.append((*best, n, False))
    print("towns:", [(s[0], s[1], s[2], "landmark" if s[3] else "") for s in sites])
    assert len(sites) >= 5, "too few towns placed"
    over = Image.new("RGBA", (W * AA, H * AA), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    # far towns first so a nearer town is never painted under a farther one
    for (cu, cv, n, landmark) in sorted(sites, key=lambda s: s[1]):
        blocks = town(cu, cv, n, landmark)
        lift = lambda c: tuple(min(255, int(v * (1.15 if ground(cu, cv)[1] > 2 else 1))) for v in c) + (255,)  # far towns fade under the skin filters
        for (x0, x1, z0, z1, ht0, ht) in blocks:  # shadows first, falling right, so no block is painted under one
            if ht0 == 0:
                d.polygon([project(x0, z0), project(x1 + ht * .8, z0), project(x1 + ht * .8, z1), project(x0, z1)], fill=(3, 14, 20, 130))
        for (x0, x1, z0, z1, ht0, ht) in blocks:
            front = [project(x0, z0, ht0), project(x1, z0, ht0), project(x1, z0, ht), project(x0, z0, ht)]
            xs = x0 if x0 > 0 else x1  # the side facing the camera
            side = [project(xs, z0, ht0), project(xs, z1, ht0), project(xs, z1, ht), project(xs, z0, ht)]
            top = [project(x0, z0, ht), project(x1, z0, ht), project(x1, z1, ht), project(x0, z1, ht)]
            d.polygon(side, fill=lift((18, 54, 66)))
            d.polygon(front, fill=lift((30, 82, 96)))
            d.polygon(top, fill=lift((46, 104, 118)))
            d.line(top + top[:1], fill=(84, 158, 174, 255), width=2)
    im = Image.alpha_composite(im.convert("RGBA"), over.resize((W, H), Image.LANCZOS)).convert("RGB")
    im = im.filter(ImageFilter.UnsharpMask(1.2, 40, 2))
    im.save(OUT / "map.webp", quality=82, method=6)
    # pin land check for the record
    off = [k for k, (px, py) in PINS.items() if hgt[int(py / 100 * h), int(px / 100 * w)] <= 0]
    print(f"pins on land: {len(PINS) - len(off)}/{len(PINS)}", off)

# ---------- flame pillar sprite sheets ----------
def render_pillar(name, c_lo, c_hi, FR=8, W=64, H=136, SS=2):
    w, h = W * SS, H * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    t = 1 - yy / h                       # 0 at base, 1 at top
    xc = (xx + .5) / w - .5
    frames = []
    for f in range(FR):
        ph = f / FR
        # noise scrolling upward, periodic over the loop
        # cross-faded scroll: frame FR equals frame 0, so the loop is seamless
        P = 2.5
        n = fbm(xc * 6 + 3, t * 5 - ph * P, 4, 3) * (1 - ph) + fbm(xc * 6 + 3, t * 5 - ph * P + P, 4, 3) * ph
        sway = (n - .5) * .08 * np.clip((t - .55) / .45, 0, 1)  # straight column, flame only at the top
        x = xc - sway
        width = .13 + .11 * (1 - t) ** .7
        body = np.exp(-(x / width) ** 2)
        core = np.exp(-(x / (.028 + .03 * (1 - t))) ** 2)
        vert = np.clip(1 - t, 0, 1) ** .35 * np.clip(t * 12, 0, 1)
        wisps = np.clip((n - .42) * 3, 0, 1) * np.exp(-((t - .80) / .18) ** 2) * np.exp(-(x / .16) ** 2) * 1.2
        halo = np.exp(-(x / .40) ** 2) * np.clip(1 - t, 0, 1) ** .8 * .55
        I = (body * vert * 1.15 + wisps * .9 + halo) * np.clip((1 - t) / .14, 0, 1)
        Ic = core * np.clip(1 - t * 1.15, 0, 1) ** .8
        base = np.exp(-((t) / .05) ** 2) * np.exp(-(xc / .2) ** 2) * .8
        I = np.clip(I + base, 0, 1.5)
        I *= np.clip(1 - (2 * np.abs(xc)) ** 2, 0, 1) ** 2   # taper to zero at the frame edges (no visible box)
        col = (np.array(c_lo) / 255)[None, None] * (1 - t[..., None]) + (np.array(c_hi) / 255)[None, None] * t[..., None]
        rgb = col * I[..., None] + np.clip(Ic, 0, 1)[..., None] * np.array([1, 1, 1]) * .95
        rgb = np.clip(rgb, 0, 1)
        # real alpha (glow on black -> colour + coverage) so no blend mode is needed
        m = rgb.max(axis=2)
        a = np.clip(m, 0, 1) ** .6           # soft glow keeps visible coverage over bright land
        rgba = np.dstack([rgb / np.maximum(m, 1e-4)[..., None], a])
        frames.append(Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").resize((W * 2, H * 2), Image.LANCZOS))
    sheet = Image.new("RGBA", (W * 2 * FR, H * 2), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * W * 2, 0))
    sheet.save(OUT / f"pillar-{name}.webp", quality=80, method=6)

render_map()
render_pillar("blue", (79, 184, 255), (60, 120, 255))
render_pillar("cyan", (98, 216, 230), (60, 170, 230))
render_pillar("amber", (240, 166, 48), (255, 110, 30))
render_pillar("pink", (255, 79, 216), (180, 75, 255))
render_pillar("red", (255, 45, 45), (200, 20, 60))
print("done", sorted(p.name for p in OUT.iterdir()))
