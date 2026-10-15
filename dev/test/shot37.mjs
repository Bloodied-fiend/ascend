// Phone-width (390x844 @2x) renders of the v37 SYSTEM UPDATE screen.
// node dev/test/shot37.mjs <fresh-profile-dir> <url> <out-dir> <hunter|neon|ember|daylight>
// Use a FRESH profile dir each run: a new service worker reloads the page mid-capture otherwise.
// Three captures per skin:
//   patch-settled  the window as it rests, after the tear finishes  <- layout + contrast live here
//   patch-torn     the tear frozen at 32% of the keyframe, so the RGB split is judgeable in a still
//   profile-system the Profile row that reopens the notes once dismissed
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
  const ev = async x => (await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Page.navigate", { url });
  await wait(3000); // let the service worker install and do its one reload before any capture

  const shot = async name => { const r = await s("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, "base64")); console.log("wrote", name) };

  // a lived-in save one version behind, so the update screen fires on startup
  const save = await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));
    Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime",
      lvl:23,xp:140,rest:2,prog:${JSON.stringify(dk(-20))},sMile:14,loot:{c:6,u:3,r:1}});
    s.ap.pn=36; s.hist={}; for(let i=1;i<=18;i++){const d=new Date(Date.now()-4*3600e3);d.setDate(d.getDate()-i);
      s.hist[d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")]=1}
    delete s.tab;delete s.test;return s})()`);

  await ev(`localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin)});localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(save))})`);
  await s("Page.reload"); await wait(2200);  // the window is left OPEN on purpose: it is the subject

  const open = await ev(`(()=>{const ov=document.getElementById("ov");return ov.hidden?"(closed)":document.getElementById("sysC").textContent})()`);
  if (open !== "[ SYSTEM UPDATE ]") throw new Error("update window did not open first, got: " + JSON.stringify(open));
  await shot(`${skin}-patch-settled`);

  // Freeze the tear. Re-assigning element.style.animation on a finished run reports the right
  // animationName/playState to getComputedStyle but applies NO keyframe values -- getAnimations() is
  // empty and the capture is pixel-identical to the settled one. Restart the class and drive the real
  // Animation object instead.
  await ev(`(()=>{const el=document.getElementById("ov").querySelector(".sys");
    el.classList.remove("gl");void el.offsetWidth;el.classList.add("gl");
    const T=document.getElementById("sysT");T.classList.remove("glitch");void T.offsetWidth;T.classList.add("glitch");
    for(const[node,name,t]of[[el,"sysgl",200],[T,"glitch",100]]){
      const a=node.getAnimations().find(x=>x.animationName===name);
      if(!a)throw new Error("no running animation: "+name);
      a.currentTime=t;a.pause()}
    return getComputedStyle(el).clipPath})()`);
  await wait(300);
  await shot(`${skin}-patch-torn`);

  // clip-path clips the OUTPUT of filter, so at 200ms the chromatic fringe is already cut away.
  // 0ms is the only frame that shows the split itself; one still cannot carry both.
  // the tear is three bursts over 2.4s (A 0%, B 28%, C 58%) -- capture one frame inside each of the
  // later two, or a review only ever sees burst A and cannot tell whether B and C actually fire
  for (const [ms, name] of [[700, "burst2"], [1430, "burst3"]]) {
    await ev(`(()=>{for(const[sel,n]of[["#ov .sys","sysgl"],["#sysT","pnhero"]]){
      const node=document.querySelector(sel),a=node&&node.getAnimations().find(x=>x.animationName===n);
      if(a){a.currentTime=${ms};a.pause()}}})()`);
    await wait(250);
    await shot(`${skin}-patch-${name}`);
  }

  await ev(`(()=>{for(const[sel,name]of[["#ov .sys","sysgl"],["#sysT","glitch"]]){
    const node=document.querySelector(sel),a=node.getAnimations().find(x=>x.animationName===name);
    if(a){a.currentTime=0;a.pause()}}})()`);
  await wait(300);
  await shot(`${skin}-patch-split`);

  // dismissed, then reopened from Profile
  await ev(`(()=>{const el=document.getElementById("ov").querySelector(".sys");el.style.animation="";el.style.animationDelay="";
    for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(300);
  await ev(`document.querySelector('[data-t="me"]').click()`); await wait(700);
  await ev(`(()=>{const b=document.querySelector('[data-patch]');if(!b)throw new Error("no Profile patch row");b.scrollIntoView({block:"center"})})()`);
  await wait(400);
  await shot(`${skin}-profile-system`);

  if (errs.length) console.log("PAGE ERRORS:", errs.join(" | "));
  ws.close();
} finally { c.kill() }
