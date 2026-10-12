// Ascend service worker: serve from cache, refresh in the background (bypassing the HTTP cache).
const V = "ascend-v31";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", ...["e","d","c","b","a","s","nl","m"].map(b => `badges/${b}.webp`), "gates/map.webp", ...["blue","cyan","amber","pink","red"].map(c => `gates/pillar-${c}.webp`)];
// cache: "reload" bypasses the HTTP cache (GitHub Pages max-age=600) so a new version never stores the old page
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(x => new Request(x, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || r.headers.has("range")) return; // audio streams with range requests go straight to the network
  const u = new URL(r.url);
  const font = u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
  if (u.origin !== location.origin && !font) return;
  let done; e.waitUntil(new Promise(ok => done = ok)); // keep the worker alive until the background refresh is written
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(r, { ignoreSearch: u.origin === location.origin });
    const net = fetch(font ? r : new Request(r.url, { cache: "reload", credentials: "same-origin" }))
      .then(async res => { if (res && (res.ok || res.type === "opaque")) await c.put(r, res.clone()); return res; }).catch(() => hit);
    net.finally(done);
    return hit || net;
  }).catch(err => { done(); throw err; }));
});
