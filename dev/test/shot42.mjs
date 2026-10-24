// Phone-width (390x844 @2x) renders of the v42 weekly-boss art, and proof its layers actually loaded.
// node dev/test/shot42.mjs <fresh-profile-dir> <url> <out-dir> <hunter|neon|ember|daylight>
//
// A missing .webp renders as nothing and throws nothing, so a pretty screenshot is not evidence.
// This asserts every <img> in the stack reached naturalWidth>0 before it captures, and that the
// particle canvas has actually drawn something.
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises"; import fs from "node:fs";
const [prof, url, outDir, skinArg] = process.argv.slice(2);
const skin = skinArg || "hunter";
fs.mkdirSync(outDir, { recursive: true });
const dk = o => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() + o); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };

const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9357", "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://127.0.0.1:9357/json")).json(); break } catch { await wait(250) } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map(), errs = [], failed = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 160));
    if (m.method === "Network.loadingFailed") failed.push(m.params.errorText);
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } };
  const s = (m, pa = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) });
  const ev = async x => { const r = await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(x.slice(0, 90) + " -> " + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result.result.value };
  await s("Runtime.enable"); await s("Page.enable"); await s("Network.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Page.navigate", { url }); await wait(3000);

  const base = await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime",prog:${JSON.stringify(dk(-20))}});delete s.tab;delete s.test;return s})()`);
  if (!base || typeof base !== "object") throw new Error("the app did not boot: __ascend.S = " + JSON.stringify(base));

  const shot = async name => { const r = await s("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, "base64")); console.log("wrote", name) };

  // every stat, so all five paintings are exercised rather than whichever one today happens to pick
  for (const stat of ["str", "vit", "agi", "int", "per"]) {
    const save = { ...base, lvl: 22, xp: 70, boss: 64, bossStat: stat, bossDown: false, wk: base.wk };
    await ev(`localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin)});localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(save))})`);
    await s("Page.reload"); await wait(1800);
    await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200);
    await ev(`document.querySelector('[data-t="quests"]').click()`); await wait(700);

    // wait for the layer images, then assert every one of them decoded
    for (let i = 0; i < 40; i++) {
      const pending = await ev(`[...document.querySelectorAll(".bx img")].filter(i=>!i.complete).length`);
      if (pending === 0) break; await wait(200);
    }
    const art = await ev(`(()=>{const imgs=[...document.querySelectorAll(".bx img")];
      return {boxes:document.querySelectorAll(".bx").length, imgs:imgs.length,
        broken:imgs.filter(i=>!i.naturalWidth).map(i=>i.getAttribute("src")),
        boss:(document.querySelector(".bx")||{}).dataset?.boss||null,
        banner:!!document.querySelector(".bbanner .bx")}})()`);
    if (art.broken.length) throw new Error(`${stat}: layers failed to load -> ${JSON.stringify(art.broken)}`);
    if (!art.boxes) throw new Error(stat + ": no boss art rendered at all");
    if (!art.banner) throw new Error(stat + ": the full card has no banner");

    await wait(900); // let the ember canvas put something down
    const drawn = await ev(`(()=>{const cv=document.querySelector(".bbanner canvas");if(!cv)return -1;
      const g=cv.getContext("2d");const d=g.getImageData(0,0,cv.width,cv.height).data;
      let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>8)n++;return n})()`);
    console.log(`${stat} -> ${art.boss}  imgs:${art.imgs} all-decoded  particles:${drawn}px`);
    const want = {str:"iron_warden",vit:"sleepless_wraith",agi:"swift_stalker",int:"hollow_scholar",per:"mirror_shade"}[stat];
    if (art.boss !== want) throw new Error(`${stat}: expected ${want}, rendered ${art.boss} -- the seeded boss did not survive the reload`);
    if (drawn === 0) throw new Error(stat + ": the ember canvas drew nothing");

    await ev(`(()=>{const b=document.querySelector(".boss");if(b)b.scrollIntoView({block:"start"});document.querySelector("#screen").scrollTop-=12})()`);
    await wait(500); await shot(`boss-${stat}`);
  }

  console.log("page errors:", errs.length ? errs : "none");
  console.log("failed requests:", failed.length ? failed : "none");
  ws.close();
} finally { c.kill() }
