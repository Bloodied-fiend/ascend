// Drive headless Chrome over CDP in real time to verify the PWA (service worker, cache, manifest, layout, offline reload).
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const CH = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PROF = process.argv[2];
const URL_ = process.argv[3] || "http://127.0.0.1:47321/";
const chrome = spawn(CH, ["--headless=new", "--disable-gpu", `--user-data-dir=${PROF}`, "--remote-debugging-port=9333", "--window-size=430,900", "about:blank"], { stdio: "ignore" });
try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); break; } catch { await wait(250); } }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.navigate", { url: URL_ }); await wait(3000);
  const out = [];
  out.push("sw=" + await ev(`navigator.serviceWorker.ready.then(r=>r.active&&r.active.state)`));
  out.push("caches=" + await ev(`caches.keys().then(k=>k.join(","))`));
  out.push("shell=" + await ev(`caches.keys().then(k=>caches.open(k[0])).then(c=>c.keys()).then(x=>x.length)`));
  out.push("manifest=" + await ev(`fetch("manifest.webmanifest").then(r=>r.json()).then(m=>m.name+"/"+m.display+"/"+m.icons.length+" icons")`));
  out.push("pitchHidden=" + await ev(`getComputedStyle(document.querySelector(".pitch")).display==="none"`));
  out.push("phone=" + await ev(`(()=>{const r=document.querySelector(".phone").getBoundingClientRect();return Math.round(r.width)+"x"+Math.round(r.height)+" of "+innerWidth+"x"+innerHeight})()`));
  out.push("persist=" + await ev(`navigator.storage.persisted()`));
  // offline: cut the network and reload from the service worker cache
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send("Page.reload", { ignoreCache: false }); await wait(2500);
  out.push("offlineReload=" + await ev(`!!document.querySelector(".phone")&&typeof __ascend==="object"`));
  out.push("offlineTitle=" + await ev(`document.title`));
  console.log(out.join(" | "));
  ws.close();
} finally { chrome.kill(); }
