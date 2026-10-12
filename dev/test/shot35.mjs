// Phone-width (390x844 @2x) renders of the v35 surfaces: streak banner, Profile relics, relic drop.
// node dev/test/shot35.mjs <fresh-profile-dir> <url> <out-dir> <hunter|neon|ember|daylight>
// Use a FRESH profile dir each run: a new service worker reloads the page mid-capture otherwise.
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises"; import fs from "node:fs";
const [prof, url, outDir, skinArg] = process.argv.slice(2);
const skin = skinArg || "hunter";
fs.mkdirSync(outDir, { recursive: true });

// same roll the app uses, so a seed can be chosen to force a tier
const h32 = v => { let h = 2166136261; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 };
const tierAt = r => r < .005 ? "l" : r < .025 ? "r" : r < .085 ? "u" : r < .235 ? "c" : null;
const seedFor = (day, qid, want) => { for (let i = 0; i < 4e6; i++) { const s = "sd" + i.toString(36).padStart(5, "0"); if (tierAt(h32(s + "|" + day + "|" + qid)) === want) return s } throw new Error("no seed for " + want) };
const dk = o => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() + o); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };

const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9338", "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://127.0.0.1:9338/json")).json(); break } catch { await wait(250) } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 160)); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } };
  const s = (m, pa = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) });
  const ev = async x => (await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Page.navigate", { url });
  await wait(3000); // let the service worker install and do its one reload before any capture

  const base = await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime",prog:${JSON.stringify(dk(-20))}});delete s.tab;delete s.test;return s})()`);

  const seed = async (save, tab) => {
    await ev(`localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin)});localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(save))})`);
    await s("Page.reload"); await wait(1600);
    await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(250);
    if (tab) { await ev(`document.querySelector('[data-t="${tab}"]').click()`); await wait(600) }
  };
  const shot = async name => { const r = await s("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, "base64")); console.log("wrote", name) };

  // consecutive cleared days ending yesterday, with one rest day in the middle
  const hist = n => { const h = {}; for (let i = 1; i <= n; i++) h[dk(-i)] = i === 5 ? 2 : 1; return h };

  // 1. streak banner, mid-climb: 14 in a row, best 14, bar to 30
  await seed({ ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, prog: dk(-20), loot: { c: 9, u: 3, r: 1 }, m: { miles: 31 } });
  await shot("home-streak");

  // 2. streak banner, zero state (no bar)
  await seed({ ...base, lvl: 3, xp: 20, hist: {} });
  await shot("home-streak-zero");

  // 3. Profile relics, partly collected
  await seed({ ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, loot: { c: 9, u: 3, r: 1 } }, "me");
  await ev(`(()=>{const h=[...document.querySelectorAll(".sh")].find(x=>x.textContent.startsWith("Relics"));h.scrollIntoView({block:"start"});document.querySelector("#screen").scrollTop-=16})()`);
  await wait(900); await shot("profile-relics");

  // 4. a legendary drop's System window
  await seed({ ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, seed: seedFor(dk(0), "sleep", "l"), loot: { c: 9, u: 3 } });
  await ev(`document.querySelector('[data-q="sleep"]').click()`); await wait(1400);
  await shot("drop-legendary");

  // 5. a common relic chip left on the quest row
  await seed({ ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, seed: seedFor(dk(0), "read", "c"), loot: { c: 9 } });
  await ev(`document.querySelector('[data-q="read"]').click()`); await wait(900);
  await shot("relic-chip");

  // 5b. a RARE drop: the hued-window path has only been seen on legendary, where hunter's accent
  // happened to hide the chip bug
  await seed({ ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, prog: dk(-20), seed: seedFor(dk(0), "sleep", "r"), loot: { c: 9, u: 3 } });
  await ev(`document.querySelector('[data-q="sleep"]').click()`); await wait(1400);
  await shot("drop-rare");

  // 6. a broken streak on an established account - the case where BEST matters most
  const old = {}; for (let i = 4; i <= 12; i++) old[dk(-i)] = 1; // run ended 4 days ago
  await seed({ ...base, lvl: 22, xp: 70, hist: old, sMile: 0, prog: dk(-20), loot: { c: 9, u: 3 } });
  await shot("home-streak-broken");

  // 7. the risk state, driven by the real predicate rather than a forced class: late is
  // left()<PEN_MS && !allDone(). now() is wall-clock minus the 04:00 day boundary, so pinning
  // Date.now to 01:30 tomorrow puts now() at 21:30 today - under 3h left, same System day, no rollover.
  await seed({ ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, prog: dk(-20) });
  await ev(`(()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(1,30,0,0);const f=d.getTime();Date.now=()=>f;__ascend.render();return document.querySelector(".strk").className})()`);
  await wait(600);
  console.log("  risk class ->", await ev(`document.querySelector(".strk").className`));
  await shot("home-streak-risk");

  console.log("errors:", errs.length ? errs : "none");
  ws.close();
} finally { c.kill() }
