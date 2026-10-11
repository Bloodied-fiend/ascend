# dev/

Source of truth for Ascend. The repo root (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`, `badges/`) is **generated** — edit here, then build.

- `ascend.html` — the whole app as a single file, in "prototype" form (desktop pitch panel + demo controls). Also published as the claude.ai artifact `https://claude.ai/artifact/Vz2CyTPiRkkZetEyMpE4mb` (attach `soundtrack.mp3` and `badges/*.webp` as artifact files when republishing).
- `build_pwa.py` — turns `ascend.html` into the installable PWA at the repo root: app-mode CSS (no pitch panel, full screen, safe areas), manifest, service worker, icons rendered from the in-app SVG, badge copies. **Bump `V` in the service-worker template on every ship** so installed phones pick up the change.
- `badges/` — rank badge art (WebP) cut from Jaime's sheet (`sheet.png`) by `cut_badges.py`.
- `test/cdp_test.mjs` — real-time Chrome DevTools test of a served build: service worker, cache, manifest, layout, offline reload. `node dev/test/cdp_test.mjs <profile-dir> <url>`.
- `test/cdp_tap.mjs` — confirms music starts on the first real tap when autoplay is blocked.

Ship: `python dev/build_pwa.py`, commit, push. GitHub Pages serves `main` / root at https://bloodied-fiend.github.io/ascend/ (deploys in ~30s).
