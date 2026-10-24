// Phone-width (390x844 @2x) renders of the v40 Boss spoils section on the Trophies screen.
// node dev/test/shot40.mjs <fresh-profile-dir> <url> <out-dir> <hunter|neon|ember|daylight>
// Use a FRESH profile dir each run: a new service worker reloads the page mid-capture otherwise.
// The spoil shine is a real infinite animation, so each capture freezes it at a fixed currentTime --
// a running sweep lands at a different phase in every PNG and makes two skins impossible to compare.
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises"; import fs from "node:fs";
const [prof, url, outDir, skinArg] = process.argv.slice(2);
const skin = skinArg || "hunter";
fs.mkdirSync(outDir, { recursive: true });
const dk = o => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() + o); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };

const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9341", "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://127.0.0.1:9341/json")).json(); break } catch { await wait(250) } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 160)); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } };
  const s = (m, pa = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) });
  const ev = async x => { const r = await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(x.slice(0, 80) + " -> " + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result.result.value; };
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Page.navigate", { url });
  await wait(3000); // let the service worker install and do its one reload before any capture

  const base = await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime",prog:${JSON.stringify(dk(-20))}});delete s.tab;delete s.test;return s})()`);

  if (!base || typeof base !== "object") throw new Error("the app did not boot: __ascend.S read back as " + JSON.stringify(base));

  const seed = async save => {
    await ev(`localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin)});localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(save))})`);
    await s("Page.reload"); await wait(1600);
    await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(250);
    await ev(`document.querySelector('[data-t="trophies"]').click()`); await wait(600);
  };
  // drive the real Animation object: re-assigning animation-play-state reports a paused animation that
  // applies no keyframe values at all (the v37 harness lesson), so a "frozen" capture can silently
  // omit the sweep entirely.
  const freeze = async at => ev(`(()=>{let n=0;for(const el of document.querySelectorAll(".sp.rb .sweep")){
    for(const a of el.getAnimations()){a.currentTime=${at};a.pause();n++}}return n})()`);
  const toSection = () => ev(`(()=>{const h=[...document.querySelectorAll(".sh")].find(x=>x.textContent.startsWith("Boss spoils"));
    if(!h)return "NO SECTION";h.scrollIntoView({block:"start"});document.querySelector("#screen").scrollTop-=16;return "ok"})()`);
  const seen = new Set();
  const shot = async name => { const r = await s("Page.captureScreenshot", { format: "png" });
    const b = Buffer.from(r.result.data, "base64");
    const md5 = (await import("node:crypto")).createHash("md5").update(b).digest("hex");
    if (seen.has(md5)) throw new Error("IDENTICAL capture: " + name + " matches an earlier frame (" + md5.slice(0, 8) + ")");
    seen.add(md5); fs.writeFileSync(`${outDir}/${name}.png`, b); console.log("wrote", name, md5.slice(0, 8)) };

  const hist = n => { const h = {}; for (let i = 1; i <= n; i++) h[dk(-i)] = i === 5 ? 2 : 1; return h };
  const acct = { ...base, lvl: 22, xp: 70, hist: hist(14), sMile: 14, loot: { c: 9, u: 3, r: 1 } };

  // 1. nothing killed: five locked silhouettes, the zero state
  await seed({ ...acct, m: { miles: 31 } });
  console.log("  section ->", await toSection()); await wait(700);
  await shot("spoils-none");

  // 2. one taken, four locked -- the common mid-game state, and the one where the locked
  // treatment has to read as "not yet" rather than as a rendering fault
  await seed({ ...acct, m: { miles: 31, kills: { str: 1 } } });
  await toSection(); await freeze(900); await wait(400);
  await shot("spoils-one");

  // 3. all five, mixed counts: the full set, every piece of art visible at once
  await seed({ ...acct, lvl: 41, m: { miles: 31, kills: { str: 4, vit: 2, agi: 1, int: 3, per: 1 } } });
  await toSection(); await freeze(900); await wait(400);
  await shot("spoils-all");

  // 4. the same set with the sweep at a different phase, so the shine is actually evidenced
  await freeze(2400); await wait(400);
  await shot("spoils-all-shine");

  // 5. where the section sits on the screen: scrolled to the bottom of Trophies, in context
  await ev(`(()=>{const s=document.querySelector("#screen");s.scrollTop=s.scrollHeight})()`);
  await freeze(900); await wait(600);
  await shot("spoils-in-context");

  console.log("sweeps frozen:", await freeze(900));
  console.log("errors:", errs.length ? errs : "none");
  ws.close();
} finally { c.kill() }
