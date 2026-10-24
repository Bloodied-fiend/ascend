// Can a run time actually be logged with a touchscreen? Drives REAL key events and REAL taps under
// mobile+touch emulation, because the bug reported was "I can't log my times on the phone" and a
// synthetic .click() would not reproduce whatever the touch path does differently.
//   node dev/test/runlog_test.mjs <fresh-profile-dir> <url>
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises";
const [prof, url] = process.argv.slice(2);
const dk = o => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() + o); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
const res = [], check = (n, ok, info = "") => { res.push(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(info)}`); };

const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9361", "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://127.0.0.1:9361/json")).json(); break } catch { await wait(250) } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } };
  const s = (m, pa = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) });
  const ev = async x => { const r = await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(x.slice(0, 80) + " -> " + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result.result.value };
  await s("Runtime.enable"); await s("Page.enable");
  // a real phone: touch events, no mouse
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
  await s("Page.navigate", { url }); await wait(3000);

  const base = await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime"});delete s.tab;delete s.test;return s})()`);
  const boot = async () => {
    await ev(`localStorage.clear();localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify({ ...base, lvl: 12, runs: [] }))})`);
    await s("Page.reload"); await wait(1800);
    await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(250);
  };
  // a real tap: touchStart/touchEnd at the element's centre, which is what a finger sends
  const tap = async sel => {
    const b = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!b) throw new Error("no element for " + sel);
    const pt = [{ x: b.x, y: b.y, radiusX: 12, radiusY: 12, force: 1, id: 1 }];
    await s("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt });
    await wait(60);
    await s("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(450);
  };
  // real keystrokes, the way a soft numeric keypad delivers them
  const type = async str => { for (const ch of str) {
    await s("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
    await s("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await wait(40); } };

  const distQ = async () => ev(`(()=>{const q=__ascend.S.quests.find(x=>x.u==="MI"||x.u==="KM");return q&&q.id})()`);
  const logged = async () => ev(`(()=>{const r=__ascend.S.runs;return r.length?{n:r.length,t:r[r.length-1].t,k:r[r.length-1].k}:null})()`);

  // ---- 1. the plain path: open the row, tap the field, type digits, tap Log time
  await boot();
  const q = await distQ();
  await tap(`[data-qopen="${q}"]`);
  const hasInput = await ev(`!!document.querySelector("#tin-${q}")`);
  check("opening a distance quest shows the time field", hasInput);
  await tap(`#tin-${q}`);
  const focused = await ev(`document.activeElement&&document.activeElement.id==="tin-${q}"`);
  check("tapping the time field focuses it", focused);
  await type("2830");
  const typed = await ev(`(document.querySelector("#tin-${q}")||{}).value`);
  check("digits land in the field", typed === "2830", typed);
  await tap(`[data-tlog="${q}"]`);
  const r1 = await logged();
  check("tapping Log time records the run", !!r1 && r1.t === 28 * 60 + 30, { r1, typed });

  // ---- 2. the realistic path: pick Ruck AFTER typing the time, then log
  await boot();
  await tap(`[data-qopen="${q}"]`);
  await tap(`#tin-${q}`);
  await type("2830");
  const before = await ev(`(document.querySelector("#tin-${q}")||{}).value`);
  await tap(`[data-tkind="ruck"]`);
  const after = await ev(`(document.querySelector("#tin-${q}")||{}).value`);
  check("choosing Run/Ruck after typing keeps the time you entered", after === before, { before, after });
  await tap(`[data-tlog="${q}"]`);
  const r2 = await logged();
  check("logging after switching to Ruck records the run", !!r2 && r2.t === 28 * 60 + 30 && r2.k === "ruck", { r2, before, after });

  // ---- 3. stepping the distance after typing (adding the extra mile you actually ran)
  await boot();
  await tap(`[data-qopen="${q}"]`);
  await tap(`#tin-${q}`);
  await type("2830");
  const b3 = await ev(`(document.querySelector("#tin-${q}")||{}).value`);
  await tap(`[data-step="${q}:1"]`);
  const a3 = await ev(`(document.querySelector("#tin-${q}")||{}).value`);
  check("adding distance after typing keeps the time you entered", a3 === b3, { b3, a3 });

  console.log(res.join("\n"));
  ws.close();
  process.exitCode = res.some(r => r.startsWith("FAIL")) ? 1 : 0;
} finally { c.kill() }
