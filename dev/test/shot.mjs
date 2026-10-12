// Phone-width (390x844 @2x) render of the Guild tab with a seeded save, for Belphegor reviews.
// node dev/test/shot.mjs <fresh-profile-dir> <url> <out.png> <active|red|idle> <hunter|neon|ember|daylight> [level, default 20]
// Use a FRESH profile dir each run: a new service worker reloads the page mid-capture otherwise.
import { spawn } from "node:child_process";import { setTimeout as wait } from "node:timers/promises";import fs from "node:fs";
const [prof,url,out,mode,skin,lvArg]=process.argv.slice(2);const LV=+lvArg||20;
const c=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--disable-gpu",`--user-data-dir=${prof}`,"--remote-debugging-port=9336","--window-size=500,1000","about:blank"],{stdio:"ignore"});
try{let t;for(let i=0;i<40;i++){try{t=await(await fetch("http://127.0.0.1:9336/json")).json();break}catch{await wait(250)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const p=new Map(),errs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description?.slice(0,160));if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
const s=(m,pa={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa}))});
const ev=async x=>(await s("Runtime.evaluate",{expression:x,awaitPromise:true,returnByValue:true})).result.result.value;
await s("Runtime.enable");await s("Page.enable");await s("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});await s("Page.navigate",{url});await wait(1500);
await ev(`(()=>{const d=new Date(Date.now()-4*3600e3),k=x=>{const y=new Date(d);y.setDate(y.getDate()+x);return y.getFullYear()+"-"+String(y.getMonth()+1).padStart(2,"0")+"-"+String(y.getDate()).padStart(2,"0")};
const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:k(0),base:"Oct 1",baseKey:k(0),name:"Jaime",lvl:${LV},gateClears:{e:2,d:1},m:{miles:14},
gate:${mode==="idle"?"null":`{id:"c",start:k(-3),until:k(6),run:2,failed:false,red:${mode==="red"},base:{str50:0,agi30:0,vit30:0,clear10:0,miles:0}},ap:{...s.ap,str50:4,agi30:1}`}});
localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin||"hunter")});localStorage.setItem("ascend-v7",JSON.stringify(s))})()`);
await s("Page.reload");await wait(1500);await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`);
await ev(`document.querySelector('[data-t="quests"]').click()`);await wait(600);
await ev(`(()=>{const m=document.querySelector(".gmap");m.scrollIntoView({block:"start"});document.querySelector("#screen").scrollTop-=40})()`);await wait(1200);
const r=await s("Page.captureScreenshot",{format:"png"});fs.writeFileSync(out,Buffer.from(r.result.data,"base64"));
console.log("errors:",errs.length?errs:"none",await ev(`JSON.stringify(document.querySelector(".gmap").getBoundingClientRect())`));ws.close()}finally{c.kill()}
