# Build the installable PWA (repo root) from dev/ascend.html. Run: python dev/build_pwa.py
import os, re, shutil, subprocess

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ascend.html')
OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
CH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
os.makedirs(f'{OUT}/icons', exist_ok=True)
s = open(SRC, encoding='utf-8').read()

# ---- app mode: no pitch panel, phone fills the screen, safe areas respected ----
APP_CSS = '''
/* installed app: full screen, no pitch panel */
html.app,html.app body{margin:0;height:100%;overflow:hidden}
html.app .pitch{display:none}
html.app .stage{display:block;padding:0;min-height:0}
html.app .phone{width:100%;height:100dvh;min-height:0;border:0;border-radius:0;box-shadow:none}
html.app .screen{padding-top:calc(24px + env(safe-area-inset-top,0px))}
html.app .tabs{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
html.app .player{top:calc(18px + env(safe-area-inset-top,0px))}
'''
s = s.replace('</style>', APP_CSS + '</style>', 1)
# reset lives in Profile in the app (the pitch panel is hidden)
s = s.replace('<label class="btn chamf ghost" for="rfile" tabindex="0" style="flex:1">Restore file</label></div></div>',
              '<label class="btn chamf ghost" for="rfile" tabindex="0" style="flex:1">Restore file</label></div><button class="btn chamf ghost" data-demo="reset" style="justify-content:center;color:var(--danger);border-color:color-mix(in srgb,var(--danger) 50%,transparent)">Reset progress</button></div>')
assert 'data-demo="reset" style="justify-content:center' in s

HEAD = '''<!doctype html>
<html lang="en" class="app">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0c1015">
<meta name="description" content="A habit tracker run by the System.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Ascend">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
'''
TAIL = '''
<script>
if("serviceWorker" in navigator){
  // a new version activates (skipWaiting + claim) -> reload once so the open page runs it; skip the very first install
  const had=!!navigator.serviceWorker.controller;let reloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(had&&!reloaded){reloaded=true;location.reload()}});
  addEventListener("load",()=>navigator.serviceWorker.register("sw.js").then(reg=>{
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")reg.update().catch(()=>{})}); // check for a new version when the app comes back to the front
  }).catch(()=>{}));
}
// ask the browser not to evict saved progress
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
</script>
</body>
</html>
'''
# split prototype into head-ish (title/links/style) and body content
i = s.index('<div class="stage">')
head_part, body_part = s[:i], s[i:]
html = HEAD + head_part + '<style>body{background:#0c1015}</style>\n</head>\n<body>\n' + body_part + TAIL
open(f'{OUT}/index.html', 'w', encoding='utf-8').write(html)
# soundtrack.mp3 lives at the repo root already (Jaime's own track); nothing to copy
os.makedirs(f'{OUT}/badges', exist_ok=True)
for b in ('e','d','c','b','a','s','nl','m'):
    shutil.copy(os.path.join(os.path.dirname(SRC), 'badges', b + '.webp'), f'{OUT}/badges/{b}.webp')

open(f'{OUT}/manifest.webmanifest', 'w', encoding='utf-8').write('''{
  "name": "Ascend",
  "short_name": "Ascend",
  "description": "A habit tracker run by the System.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0c1015",
  "theme_color": "#0c1015",
  "icons": [
    {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
''')

open(f'{OUT}/sw.js', 'w', encoding='utf-8').write('''// Ascend service worker: serve from cache, refresh in the background (bypassing the HTTP cache).
const V = "ascend-v40";
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
''')

# ---- icons rendered from the prototype's own SVG app icon ----
icon = re.search(r'<svg class="appicon".*?</svg>', s, re.S).group(0).replace('class="appicon" ', '')
full_bleed = icon.replace('<rect width="1024" height="1024" rx="224"', '<rect width="1024" height="1024" rx="0"')
maskable = full_bleed.replace('viewBox="0 0 1024 1024"', 'viewBox="-128 -128 1280 1280"').replace('<rect width="1024" height="1024" rx="0"', '<rect x="-128" y="-128" width="1280" height="1280"')
for name, svg, size in (('icon-512', full_bleed, 512), ('icon-192', full_bleed, 192), ('maskable-512', maskable, 512)):
    page = f'{OUT}/icons/_render.html'
    sized = svg.replace('<svg ', '<svg width="%d" height="%d" ' % (size, size), 1)
    open(page, 'w', encoding='utf-8').write('<!doctype html><html><body style="margin:0;background:#0c1015">' + sized + '</body></html>')
    prof = f'{OUT}/icons/_prof'
    shutil.rmtree(prof, ignore_errors=True)
    subprocess.run([CH, '--headless=new', '--disable-gpu', f'--user-data-dir={prof}', '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={size},{size}', f'--screenshot={OUT}/icons/{name}.png', f'file:///{page}'], capture_output=True, timeout=60)
    shutil.rmtree(prof, ignore_errors=True)
os.remove(f'{OUT}/icons/_render.html')

open(f'{OUT}/README.md', 'w', encoding='utf-8').write('''# Ascend

A habit tracker run by the System (Solo Leveling style). Installable PWA, single page, no build step.

- `index.html` is the whole app. Progress lives in this browser's storage (export with Profile > Copy backup).
- `sw.js` caches the app for offline use. Bump `V` when shipping changes.
- Icons are rendered from the in-app SVG icon by `dev/build_pwa.py`.

Install: open the hosted URL on the phone, then Share > Add to Home Screen (iOS) or Install app (Android/Chrome).
''')
GATES = ["gates/map.webp"] + ["gates/pillar-%s.webp" % c for c in ("blue","cyan","amber","pink","red")]
BADGES = ["badges/%s.webp" % b for b in ("e","d","c","b","a","s","nl","m")]
missing = [f for f in GATES + BADGES if not os.path.exists(os.path.join(OUT, f))]
assert not missing, "service-worker SHELL lists files this build did not produce: %s -- cache.addAll() rejects as a unit, so the SW would never install" % missing

print('built', os.listdir(OUT), os.listdir(f'{OUT}/icons'))
