// Autoplay blocked: confirm music starts on the first REAL tap (trusted input via CDP).
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const [, , PROF, URL_] = process.argv;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${PROF}`, "--remote-debugging-port=9334", "--autoplay-policy=user-gesture-required", "--window-size=500,900", "about:blank"], { stdio: "ignore" });
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://127.0.0.1:9334/json")).json(); break; } catch { await wait(250); } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send("Page.enable"); await send("Page.navigate", { url: URL_ }); await wait(2500);
  const out = ["beforeTap playing=" + await ev(`!document.getElementById("aud").paused`)];
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: 250, y: 120, button: "left", clickCount: 1 });
  await wait(800);
  out.push("afterRealTap playing=" + await ev(`!document.getElementById("aud").paused`));
  out.push("track=" + await ev(`document.getElementById("ptitle").textContent`));
  console.log(out.join(" | ")); ws.close();
} finally { chrome.kill(); }
