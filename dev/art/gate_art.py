# Procedural art for the Gate Dispatch map: an original holo continent seen through a tilted camera,
# plus looping flame-pillar sprite sheets. Output -> ../../gates/ (served next to index.html).
#   python dev/art/gate_art.py
# Pins must sit on land: PINS mirrors GPOS in dev/ascend.html (x%, y% of the map box).
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "gates"
OUT.mkdir(exist_ok=True)
PINS = {"e": (13, 86), "c": (44, 84), "a": (86, 86), "d": (27, 58), "b": (73, 58), "s": (57, 46)}
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

    # city blocks: small extruded towers on land, away from the pins
    d = ImageDraw.Draw(im, "RGBA")
    sites = [(.30, .74), (.62, .66), (.48, .58), (.66, .50)]  # each >= .08 from every pin
    for (cu, cv) in sites:
        X0, Z0 = ground(cu, cv)
        if hgt[int(cv * h), int(cu * w)] <= 0.02:  # only on land
            continue
        scale = 1 / Z0
        for i in range(int(rng.integers(3, 6))):
            ou, ov = rng.normal(0, .02), rng.normal(0, .008)
            x0, y0 = (cu + ou) * W, (cv + ov) * H
            bw = max(4, 20 * scale * rng.uniform(.7, 1.2)); bh = 64 * scale * rng.uniform(.5, 1.5)
            dep = bw * .45
            d.polygon([(x0, y0), (x0 + bw, y0), (x0 + bw, y0 - bh), (x0, y0 - bh)], fill=(40, 110, 130, 235), outline=(150, 235, 255, 220))
            d.polygon([(x0 + bw, y0), (x0 + bw + dep, y0 - dep * .6), (x0 + bw + dep, y0 - bh - dep * .6), (x0 + bw, y0 - bh)], fill=(22, 70, 88, 210))
            d.polygon([(x0, y0 - bh), (x0 + bw, y0 - bh), (x0 + bw + dep, y0 - bh - dep * .6), (x0 + dep, y0 - bh - dep * .6)], fill=(170, 240, 255, 200))
            for k in range(int(bh // 7)):
                d.point((x0 + bw * .5, y0 - 3 - k * 7), fill=(220, 250, 255, 180))
    im = im.filter(ImageFilter.UnsharpMask(1.2, 40, 2))
    im.save(OUT / "map.webp", quality=82, method=6)
    # pin land check for the record
    print("pins on land:", {k: bool(hgt[int(py / 100 * h), int(px / 100 * w)] > 0) for k, (px, py) in PINS.items()})

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
