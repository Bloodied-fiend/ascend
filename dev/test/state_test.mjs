// State-safety checks over CDP: v5->v6 import, XP-undo debt, rollover catch-up, stale-tab write.
// node dev/test/state_test.mjs <profile-dir> <url> <storage-key>
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const CH = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [PROF, URL_, KEY, PREV] = process.argv.slice(2);
const chrome = spawn(CH, ["--headless=new", "--disable-gpu", `--user-data-dir=${PROF}`, "--remote-debugging-port=9334", "--window-size=430,900", "about:blank"], { stdio: "ignore" });
const res = [];
const check = (name, ok, info = "") => res.push(`${ok ? "PASS" : "FAIL"} ${name}${info ? " (" + info + ")" : ""}`);
try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9334/json")).json(); break; } catch { await wait(250); } }
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(expr + " -> " + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result.result.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: URL_ }); await wait(2500);

  // a clean onboarded save built from the page's own fresh state; day keys use the page's 04:00 boundary
  const DK = `const dk=i=>{const d=new Date(Date.now()-4*3600e3);d.setDate(d.getDate()+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};`;
  const base = await ev(`(()=>{${DK}const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:dk(0),base:"Oct 1",baseKey:dk(0),name:"Test"});delete s.tab;delete s.test;return s})()`);
  const boot = async (key, save) => {
    await ev(`localStorage.clear();${save ? `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify(save))})` : ""}`);
    await send("Page.reload"); await wait(1500);
    await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`); await wait(200);
  };
  const click = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(250); await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`); await wait(150); };

  // A: an older v5 save is imported; v5 itself is left as it was
  if (PREV) {
    const v5 = { ...base, ver: +PREV.slice(-1), lvl: 7 };
    await boot(PREV, v5);
    const r = await ev(`({lvl:__ascend.S.lvl,v6:!!localStorage.getItem(${JSON.stringify(KEY)}),v5same:localStorage.getItem(${JSON.stringify(PREV)})===${JSON.stringify(JSON.stringify(v5))}})`);
    check(`${PREV} save imported into ${KEY}, ${PREV} untouched`, r.lvl === 7 && r.v6 && r.v5same, JSON.stringify(r));
  }

  // B: complete -> undo -> complete across a level-up must end where the first complete ended
  {
    await boot(KEY, { ...base, lvl: 3, xp: 90 });
    const q = await ev(`(()=>{const q=__ascend.S.quests.find(x=>x.xp>=15);return q.id})()`);
    await click(`[data-q="${q}"]`);
    const a = await ev(`[__ascend.S.lvl,__ascend.S.xp]`);
    await click(`[data-q="${q}"]`); await click(`[data-q="${q}"]`);
    const b = await ev(`[__ascend.S.lvl,__ascend.S.xp]`);
    check("undo/redo across a level-up gains nothing", a[0] === 4 && a.join() === b.join(), `first ${a} after cycle ${b}`);
  }

  // C: last opened 4 days ago with everything done: that day cleared, the 3 unopened days missed, penalty set
  {
    const s0 = await ev(`(()=>{${DK}return {day:dk(-4),d:[dk(-4),dk(-3),dk(-2),dk(-1)]}})()`);
    const done = Object.fromEntries(base.quests.map(q => [q.id, 1]));
    await boot(KEY, { ...base, day: s0.day, done, hist: {}, prog: s0.day, wk: base.wk });
    const r = await ev(`(()=>{const S=__ascend.S;return {h:${JSON.stringify(s0.d)}.map(k=>S.hist[k]),pen:!!S.penalty,day:S.day}})()`);
    check("rollover finalizes every unopened day as missed", r.h.join() === "1,0,0,0" && r.pen, JSON.stringify(r));
  }

  // D: another copy saved (storage event not delivered yet); this copy's next change must keep that save
  {
    await boot(KEY, base);
    const [qa, qb] = base.quests.map(q => q.id);
    await ev(`(()=>{const s=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));s.done={${JSON.stringify(qa)}:1};s.cnt={${JSON.stringify(qa)}:s.quests[0].n};s.rev="other-tab";localStorage.setItem(${JSON.stringify(KEY)},JSON.stringify(s))})()`);
    await click(`[data-q="${qb}"]`);
    const r = await ev(`Object.keys(JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).done).sort().join()`);
    check("stale copy keeps the other copy's save", r === [qa, qb].sort().join(), "done=" + r);
  }
  if (process.argv[6] === "gates") { const m = await import("./gates_cases.mjs"); await m.run({ ev, boot, click, base, check, KEY, DK, wait }); await m.runRed({ ev, boot, click, base, check, KEY, DK, wait }); await (await import("./sched_cases.mjs")).runSched({ ev, boot, click, base, check, KEY, DK, wait }); }
  console.log(res.join("\n"));
  ws.close();
} finally { chrome.kill(); }
