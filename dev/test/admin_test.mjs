// Hidden admin list: the open-time check-in, the 5-taps-on-Guild trigger, the password box and the list.
// Server calls are faked in the page (no live function needed). Fresh profile dir every run.
// node dev/test/admin_test.mjs <fresh-profile-dir> <url> [out.png]
import { spawn } from "node:child_process";import { setTimeout as wait } from "node:timers/promises";import fs from "node:fs";
const [prof,url,out]=process.argv.slice(2);
const c=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new","--disable-gpu",`--user-data-dir=${prof}`,"--remote-debugging-port=9339","--window-size=500,1000","about:blank"],{stdio:"ignore"});
const res=[],check=(n,ok,info)=>res.push(`${ok?"PASS":"FAIL"} ${n}${ok?"":" "+JSON.stringify(info)}`);
try{let t;for(let i=0;i<40;i++){try{t=await(await fetch("http://127.0.0.1:9339/json")).json();break}catch{await wait(250)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const p=new Map(),errs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description?.slice(0,160));if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
const s=(m,pa={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pa}))});
const ev=async x=>(await s("Runtime.evaluate",{expression:x,awaitPromise:true,returnByValue:true})).result.result.value;
await s("Runtime.enable");await s("Page.enable");await s("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
// fake the party server: record every body, answer admin with two players (one name tries to inject markup)
await s("Page.addScriptToEvaluateOnNewDocument",{source:`(()=>{const real=fetch;window.__calls=[];window.fetch=async(u,o)=>{if(String(u).includes("party.compute")){const b=JSON.parse(o.body);__calls.push(b);
  if(b.op==="admin")return new Response(JSON.stringify(b.pw==="right"?{players:[{name:"Jaime",lvl:45,xp:98765,streak:12,parties:2,seen:new Date().toISOString()},{name:"<img src=x onerror=alert(1)>",lvl:3,xp:120,streak:0,parties:0,seen:null}]}:{error:"wrong password"}),{status:b.pw==="right"?200:403});
  return new Response(JSON.stringify({ok:true,parties:[]}),{status:200})}return real(u,o)}})()`});
await s("Page.navigate",{url});await wait(1500);
await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,name:"Jaime",lvl:20});localStorage.clear();localStorage.setItem("ascend-v12",JSON.stringify(s))})()`);
await s("Page.reload");await wait(4500);await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`);
const ping=await ev(`JSON.stringify(__calls.filter(b=>b.op==="ping"))`);const pg=JSON.parse(ping);
check("check-in fires once on open with name, level and XP", pg.length===1&&pg[0].name==="Jaime"&&pg[0].summary.lvl===20&&Number.isInteger(pg[0].summary.xp),pg);
const guild=`document.querySelector('[data-t="quests"]')`;
const open=()=>ev(`!document.getElementById("ov").hidden&&document.getElementById("sysT").textContent`);
await ev(`(async()=>{for(let i=0;i<4;i++){${guild}.click();await new Promise(r=>setTimeout(r,150))}})()`);await wait(400);
check("4 taps on Guild do nothing",!(await open()),await open());
await wait(1000);
await ev(`(async()=>{for(let i=0;i<5;i++){${guild}.click();await new Promise(r=>setTimeout(r,1000))}})()`);await wait(400);
check("5 slow taps (1s apart) do nothing",!(await open()),await open());
await ev(`(async()=>{for(let i=0;i<5;i++){${guild}.click();await new Promise(r=>setTimeout(r,150))}})()`);await wait(500);
check("5 quick taps open the password box",(await open())==="Restricted",await open());
await ev(`document.getElementById("apw").value="wrong";document.querySelector('#sysA [data-act="0"]').click()`);await wait(600);
check("wrong password: box closes, no list, toast says so",!(await open())&&/WRONG PASSWORD/.test(await ev(`document.getElementById("toast").textContent`)),[await open(),await ev(`document.getElementById("toast").textContent`)]);
await ev(`(async()=>{for(let i=0;i<5;i++){${guild}.click();await new Promise(r=>setTimeout(r,150))}})()`);await wait(500);
await ev(`document.getElementById("apw").value="right";document.querySelector('#sysA [data-act="0"]').click()`);await wait(900);
const rows=await ev(`JSON.stringify([...document.querySelectorAll(".admr")].map(r=>r.innerText.split(String.fromCharCode(10)).join(" ")))`);
check("right password lists players with level and XP",(await open())==="2 players"&&/Jaime Lv 45 · 98,765 XP/.test(rows),[await open(),rows]);
check("player names are escaped, not rendered as markup",!(await ev(`!!document.querySelector(".admr img")`))&&/<img src=x/.test(rows),rows);
check("password is sent to the server, never checked in the app",JSON.parse(await ev(`JSON.stringify(__calls.filter(b=>b.op==="admin").map(b=>b.pw))`)).join()==="wrong,right");
if(out){const r=await s("Page.captureScreenshot",{format:"png"});fs.writeFileSync(out,Buffer.from(r.result.data,"base64"))}
check("no page errors",!errs.length,errs);
console.log(res.join("\n"));ws.close();process.exitCode=res.some(r=>r.startsWith("FAIL"))?1:0}finally{c.kill()}
