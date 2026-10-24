# Per-piece verdict on the crops shine_test.mjs captured. Run by that script; also runnable alone:
#   python dev/test/shine_check.py <out-dir>
#
# Two assertions per piece:
#   SIGNAL  - lit vs unlit must brighten >=0.5% of the crop by >=8/255. A piece whose sweep never
#             crosses its artwork fails here. This is the check shot40.mjs's whole-page md5 missed.
#   CAUSALITY - the control (same seek, sweep groups visibility:hidden) must be small RELATIVE to the
#             signal. It is not zero: hiding a mix-blend-mode:screen layer changes the compositing
#             path, so the art re-rasterises with slightly different antialiasing. Measured, that is
#             scattered single pixels at mean magnitude ~10-14 against a signal of ~100-117, so the
#             CALIBRATED, not guessed: across 50 samples (5 pieces x 4 skins x multiple runs) the
#             control noise peaked at 5.2% of signal pixels and 17.2% of signal magnitude, and the
#             worst case is always the thinnest piece (stalker), whose smaller signal makes the same
#             absolute jitter a larger fraction. The bars below sit ~2.5x above that floor. A first
#             cut calibrated on ONE skin sat at 5% and failed honest runs. An absolute
#             threshold would sit under the noise floor and fail honest runs.
import sys, pathlib, json
from PIL import Image
import numpy as np

d = pathlib.Path(sys.argv[1])
pieces = [p["id"] for p in json.loads((d / "pieces.json").read_text())]
MIN_SIGNAL_PCT, MAX_CTRL_RATIO, MAX_CTRL_MAG = 0.5, 0.15, 0.45
rows, ok_all = [], True
for pid in pieces:
    a = lambda n: np.array(Image.open(d / f"{n}-{pid}.png").convert("RGB")).astype(int)
    u, l, c = a("unlit"), a("lit"), a("ctrl")
    n = u.shape[0] * u.shape[1]
    dl, dc = (l - u).max(axis=2), (c - u).max(axis=2)
    lit, ctrl = int((dl >= 8).sum()), int((dc >= 8).sum())
    lm = float(dl[dl >= 8].mean()) if lit else 0.0
    cm = float(dc[dc >= 8].mean()) if ctrl else 0.0
    pct = lit / n * 100
    ok = pct >= MIN_SIGNAL_PCT and ctrl <= lit * MAX_CTRL_RATIO and (cm <= lm * MAX_CTRL_MAG or not ctrl)
    ok_all &= ok
    rows.append((pid, lit, pct, lm, ctrl, (ctrl / lit * 100 if lit else 0), cm, ok))

print("%-12s %7s %7s %7s | %7s %7s %7s | %s" % ("piece","lit px","% crop","mag","ctrl px","% of lit","mag","verdict"))
for pid, lit, pct, lm, ctrl, cr, cm, ok in rows:
    print("%-12s %7d %6.2f%% %7.1f | %7d %6.1f%% %7.1f | %s" % (pid, lit, pct, lm, ctrl, cr, cm, "PASS" if ok else "FAIL"))
print()
print("VERDICT:", "all %d pieces render the sweep" % len(rows) if ok_all else "FAILED - a piece does not render the sweep")
sys.exit(0 if ok_all else 1)
