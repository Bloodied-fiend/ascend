# Ascend

A habit tracker run by the System (Solo Leveling style). Installable PWA, single page, no build step.

- `index.html` is the whole app. Progress lives in this browser's storage (export with Profile > Copy backup).
- `sw.js` caches the app for offline use. Bump `V` when shipping changes.
- Icons are rendered from the in-app SVG icon by `dev/build_pwa.py`.

Install: open the hosted URL on the phone, then Share > Add to Home Screen (iOS) or Install app (Android/Chrome).
