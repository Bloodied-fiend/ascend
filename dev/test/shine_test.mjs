// Proves the specular sweep actually RENDERS on every spoil, per piece.
// node dev/test/shine_test.mjs <fresh-profile-dir> <url> <skin> <out-dir>
//
// Why this exists: shot40.mjs asserted whole-page md5 distinctness and passed while 4 of 5 pieces
// were byte-identical between its two "phases". Whole-page hashing is the wrong predicate -- one
// piece changing by 241px satisfies it. This captures each icon on its own and requires a
// sweep-shaped brightening on EACH of them.
//
// The timing trap it was built around: `Animation.currentTime` is local time measured from the
// animation's origin and INCLUDES animation-delay. The five spoils carry delays 0/0.5/1.0/1.5/2.0s,
// so one shared currentTime puts each piece at a different point -- and the badge keyframes hold
// translateX(0) until 18% then run to 520px by 62%, so most shared values land the band off the art
// entirely. Seek per animation by its OWN delay plus the active time you want.
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises"; import fs from "node:fs";
const [prof, url, skinArg, outDir] = process.argv.slice(2);
const skin = skinArg || "hunter";
fs.mkdirSync(outDir, { recursive: true });
const dk = o => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() + o); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
const ACTIVE_LIT = 1235;  // active time whose band crosses the central artwork
const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new","--disable-gpu",`--user-data-dir=${prof}`,"--remote-debugging-port=9347","--window-size=500,1000","about:blank"],{stdio:"ignore"});
try {
  let t; for (let i=0;i<40;i++){try{t=await (await fetch("http://127.0.0.1:9347/json")).json();break}catch{await wait(250)}}
  const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const p=new Map(), errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description?.slice(0,160)); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
  const s=(m,pa={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa}))});
  const ev=async x=>{const r=await s("Runtime.evaluate",{expression:x,awaitPromise:true,returnByValue:true});
    if(r.result.exceptionDetails)throw new Error(x.slice(0,90)+" -> "+JSON.stringify(r.result.exceptionDetails.exception?.description));return r.result.result.value};
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await s("Page.navigate",{url}); await wait(3000);

  const base=await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime"});delete s.tab;delete s.test;return s})()`);
  if(!base||typeof base!=="object")throw new Error("app did not boot: __ascend.S = "+JSON.stringify(base));

  const save={...base,lvl:41,m:{miles:0,kills:{str:1,vit:1,agi:1,int:1,per:1}}};
  await ev(`localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin)});localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(save))})`);
  await s("Page.reload"); await wait(1800);
  await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(250);
  await ev(`document.querySelector('[data-t="trophies"]').click()`); await wait(600);
  // the skin argument is only a storage write until the DOM confirms it
  const live=await ev(`document.documentElement.dataset.skin||"hunter"`);
  if(live!==skin)throw new Error(`skin not applied: asked ${skin}, got ${live}`);
  await ev(`(()=>{const h=[...document.querySelectorAll(".sh")].find(x=>x.textContent.startsWith("Boss spoils"));if(!h)throw new Error("no Boss spoils section");h.scrollIntoView({block:"start"});document.querySelector("#screen").scrollTop-=16})()`);
  await wait(700);

  // one named sweep animation per earned piece, with its own delay -- a bare count of 5 is not enough
  const pieces=await ev(`(()=>[...document.querySelectorAll(".sp.rb")].map((sv,i)=>{
    const g=sv.querySelector(".sweep"),as=g?g.getAnimations():[];
    const sw=as.filter(a=>a.animationName==="sweep");
    const u=sv.querySelector("use"),r=sv.getBoundingClientRect();
    return {i,id:(u&&u.getAttribute("href")||"").slice(1),n:sw.length,
      delay:sw[0]?sw[0].effect.getTiming().delay:null,dur:sw[0]?sw[0].effect.getTiming().duration:null,
      x:r.x,y:r.y,w:r.width,h:r.height}}))()`);
  if(pieces.length!==5)throw new Error("expected 5 earned spoils, got "+pieces.length);
  for(const q of pieces){
    if(q.n!==1)throw new Error(`${q.id}: expected exactly 1 sweep animation, got ${q.n}`);
    if(q.dur!==3400)throw new Error(`${q.id}: duration ${q.dur}, expected 3400`);
    if(q.w<=0||q.h<=0)throw new Error(`${q.id}: zero-size box`);
    if(q.y<0||q.y+q.h>844)throw new Error(`${q.id}: not fully on screen (y=${q.y} h=${q.h})`);
  }
  console.log("pieces:",pieces.map(q=>`${q.id} delay=${q.delay}ms`).join("  "));

  // seek EACH animation to its own delay + the requested active time
  const seek=async active=>ev(`(()=>{const out=[];
    for(const g of document.querySelectorAll(".sp.rb .sweep")){
      for(const a of g.getAnimations()){ if(a.animationName!=="sweep")continue;
        const d=a.effect.getTiming().delay; a.currentTime=d+${active}; a.pause();
        out.push({d,ct:a.currentTime,st:a.playState,tr:getComputedStyle(g).transform})}}
    return out})()`);
  const hide=async v=>ev(`(()=>{for(const g of document.querySelectorAll(".sp.rb .sweep"))g.style.visibility=${v?'"hidden"':'""'};return 1})()`);
  const shot=async (name,clip)=>{const r=await s("Page.captureScreenshot",{format:"png",clip:{...clip,scale:2}});
    fs.writeFileSync(`${outDir}/${name}.png`,Buffer.from(r.result.data,"base64"))};

  const states=[["unlit",0],["lit",ACTIVE_LIT]];
  for(const [label,active] of states){
    const st=await seek(active); await wait(2/60*1000+200);
    if(st.some(x=>x.st!=="paused"))throw new Error(label+": an animation did not pause");
    console.log(`${label}: `+st.map(x=>x.tr.replace(/matrix\(1, 0, 0, 1, |\)/g,"").split(",")[0]).map(v=>(+v).toFixed(1)).join(" / ")+"  (translateX px)");
    for(const q of pieces)await shot(`${label}-${q.id}`,{x:q.x,y:q.y,width:q.w,height:q.h});
  }
  // causal control: same lit seek, sweep groups hidden. Must equal unlit, or something else moved.
  await seek(ACTIVE_LIT); await hide(true); await wait(250);
  for(const q of pieces)await shot(`ctrl-${q.id}`,{x:q.x,y:q.y,width:q.w,height:q.h});
  await hide(false);

  fs.writeFileSync(`${outDir}/pieces.json`,JSON.stringify(pieces,null,1));
  if(errs.length)throw new Error("page runtime exceptions: "+JSON.stringify(errs));
  console.log("captured",pieces.length*3,"crops ->",outDir);
  ws.close();
  // one command, one verdict -- the comparison is not optional homework
  const { status } = (await import("node:child_process")).spawnSync("python",["dev/test/shine_check.py",outDir],{stdio:"inherit"});
  if(status!==0)process.exitCode=1;
} finally { c.kill() }
