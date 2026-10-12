// Level-up overflow on Home: bar holds the old fill while the popup is open, then fills to 100%, level ticks over, bar refills.
// node dev/test/lvup_test.mjs <fresh-profile-dir> <url> [frames-dir] [skin]   (frames-dir: phone-width PNGs for Belphegor)
import { spawn } from "node:child_process";import { setTimeout as wait } from "node:timers/promises";import fs from "node:fs";
const [prof,url,frames,skin]=process.argv.slice(2); // skin: hunter|neon|ember|daylight
let fails=0;
const check=(n,ok,d)=>{console.log(`${ok?"PASS":"FAIL"} ${n} (${d})`);if(!ok)fails++};
const c=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--disable-gpu",`--user-data-dir=${prof}`,"--remote-debugging-port=9337","--window-size=500,1000","about:blank"],{stdio:"ignore"});
try{let t;for(let i=0;i<40;i++){try{t=await(await fetch("http://127.0.0.1:9337/json")).json();break}catch{await wait(250)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const p=new Map(),errs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description?.slice(0,160));if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
const s=(m,pa={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa}))});
const ev=async x=>(await s("Runtime.evaluate",{expression:x,awaitPromise:true,returnByValue:true})).result.result.value;
const shot=async n=>{if(!frames)return;fs.mkdirSync(frames,{recursive:true});const r=await s("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`${frames}/${n}.png`,Buffer.from(r.result.data,"base64"))};
const st=()=>ev(`({w:+document.querySelector("#xpbar").style.width.replace("%",""),lv:document.querySelector(".lvl").textContent,lb:document.querySelector(".barlbl").textContent,ov:!document.querySelector("#ov").hidden,over:document.querySelector(".bar").classList.contains("over")})`);
const up=`(()=>{document.querySelector('[data-demo="lvl"]').click();return __ascend.S.lvl})()`; // demo button = gainXP(rest of the level)
await s("Runtime.enable");await s("Page.enable");await s("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});await s("Page.navigate",{url});await wait(1500);
if(skin){await ev(`localStorage.setItem("ascend-skin",${JSON.stringify(skin)})`);await s("Page.reload");await wait(1500)}
await ev(`(()=>{const S=__ascend.S;S.onboarded=true;S.name="Jaime";S.lvl=12;for(let i=0;i<6;i++)__ascend.closeNote(-1);S.tab="home";S.xp=60;__ascend.render()})()`);await wait(600);
// 1) level up while on Home: popup covers it, bar must NOT snap yet
// Lv12 60/188 XP -> Lv13; leftover set to 80/196 (41%) so the refill actually moves. Fill time = 300+3*(100-32) = 504ms
await ev(up);await ev(`__ascend.S.xp=80`);await wait(300);const lv=await ev(`__ascend.S.lvl`);let a=await st();await shot("0-popup");
check("popup open: Home holds old level, fill and label",a.ov&&a.lv==="Lv. 12"&&a.w>25&&lv===13&&a.lb.startsWith("60 / 188")&&a.lb.includes("to Lv. 13"),JSON.stringify({...a,lv}));
await ev(`__ascend.closeNote(-1)`);await wait(250);let b=await st();await shot("1-filling");
check("after close: bar filling toward 100, old level",!b.ov&&b.lv==="Lv. 12"&&b.w===100&&!b.over,JSON.stringify(b));
await wait(310);let c2=await st();await shot("2-overflow");
check("overflow: level, label tick over and bar flashes",c2.lv==="Lv. 13"&&c2.over&&c2.lb.startsWith("80 / 196"),JSON.stringify(c2));
await wait(800);let d=await st();await shot("3-settled");
check("settled: bar refilled to leftover XP",d.lv==="Lv. 13"&&Math.abs(d.w-80/196*100)<1,JSON.stringify(d));
// 2) level up on Quests, close popup there, then open Home: plays on arrival
await ev(`document.querySelector('[data-t="quests"]').click()`);await wait(400);await ev(up);await wait(200);await ev(`__ascend.closeNote(-1)`);
await ev(`document.querySelector('[data-t="home"]').click()`);await wait(150);let e2=await st();await wait(1100);let f=await st();
check("level-up elsewhere plays when Home opens",e2.lv==="Lv. 13"&&f.lv==="Lv. 14",JSON.stringify({e2,f}));
check("no page errors",!errs.length,errs.join(" | ")||"none");
ws.close()}finally{c.kill()}
process.exit(fails?1:0);
