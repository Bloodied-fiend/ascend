// Phone-width (390x844 @2x) renders of the v41 party board: leader tag, remove control, confirm dialog.
// node dev/test/shot41.mjs <fresh-profile-dir> <url> <out-dir> <hunter|neon|ember|daylight>
//
// The board is seeded straight into the party CACHE (localStorage "ascend-party-cache"), which is the
// same shape the server's board() returns. That renders the real UI without any call to the live Neon
// function, so capturing costs nothing on the backend and needs no party key.
// Use a FRESH profile dir each run: a new service worker reloads the page mid-capture otherwise.
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises"; import fs from "node:fs";
const [prof, url, outDir, skinArg] = process.argv.slice(2);
const skin = skinArg || "hunter";
fs.mkdirSync(outDir, { recursive: true });
const dk = o => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() + o); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };

const mem = (id, name, lvl, xp, o = {}) => ({ id, name, lvl, xp, tier: o.tier ?? 2, streak: o.streak ?? 9, gates: 3, red: 0, awaken: o.awaken ?? 0, title: o.title ?? null, me: !!o.me, lead: !!o.lead });
const CACHE = {
  at: Date.now(),
  parties: [
    { code: "K7PMQ2VT", name: "Dawn Raiders", iown: true, members: [
      mem(1, "Jaime", 22, 18400, { me: true, lead: true, tier: 3, title: "Road Warrior" }),
      mem(2, "Agee", 19, 15120, { tier: 2, streak: 14 }),
      mem(3, "Coop", 17, 11980, { tier: 2, awaken: 1 }),
      mem(4, "Ice", 12, 6400, { tier: 1, streak: 2 }),
    ] },
    { code: "B4XRN8WD", name: "Night Shift", iown: false, members: [
      mem(9, "Rook", 31, 41200, { lead: true, tier: 4, title: "Unrelenting" }),
      mem(1, "Jaime", 22, 18400, { me: true, tier: 3, title: "Road Warrior" }),
      mem(7, "Vex", 8, 2100, { tier: 1 }),
    ] },
  ],
};

const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9353", "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
try {
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch("http://127.0.0.1:9353/json")).json(); break } catch { await wait(250) } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 160)); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } };
  const s = (m, pa = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) });
  const ev = async x => { const r = await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(x.slice(0, 90) + " -> " + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result.result.value };
  await s("Runtime.enable"); await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Page.navigate", { url }); await wait(3000);

  const base = await ev(`(()=>{const s=JSON.parse(JSON.stringify(__ascend.S));Object.assign(s,{onboarded:true,seen:${JSON.stringify(dk(0))},base:"Oct 1",baseKey:${JSON.stringify(dk(0))},name:"Jaime",prog:${JSON.stringify(dk(-20))}});delete s.tab;delete s.test;return s})()`);
  if (!base || typeof base !== "object") throw new Error("the app did not boot: __ascend.S = " + JSON.stringify(base));
  const save = { ...base, lvl: 22, xp: 70 };
  const KEY = "a".repeat(64); // a party key only has to exist and be 64 hex for the UI to treat us as enrolled
  await ev(`localStorage.clear();localStorage.setItem("ascend-skin",${JSON.stringify(skin)});`
    + `localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(save))});`
    + `localStorage.setItem("ascend-party-key",${JSON.stringify(KEY)});`
    + `localStorage.setItem("ascend-party-cache",${JSON.stringify(JSON.stringify(CACHE))})`);
  await s("Page.reload"); await wait(1800);
  await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(250);
  await ev(`document.querySelector('[data-t="quests"]').click()`); await wait(700);

  const live = await ev(`document.documentElement.dataset.skin||"hunter"`);
  if (live !== skin) throw new Error(`skin not applied: asked ${skin}, got ${live}`);

  const seen = new Set();
  const shot = async name => { const r = await s("Page.captureScreenshot", { format: "png" });
    const b = Buffer.from(r.result.data, "base64");
    const md5 = (await import("node:crypto")).createHash("md5").update(b).digest("hex");
    if (seen.has(md5)) throw new Error("IDENTICAL capture: " + name + " matches an earlier frame");
    seen.add(md5); fs.writeFileSync(`${outDir}/${name}.png`, b); console.log("wrote", name) };

  const probe = async () => ev(`(()=>{const own=document.querySelector(".plist.own");
    const li=document.querySelector(".plist li.me"), sm=li&&li.querySelector(".pw small");
    return {boards:document.querySelectorAll(".pboard").length, managing:!!own,
      kicks:document.querySelectorAll("button.pkick").length,
      leads:document.querySelectorAll(".plist .pw em.ld").length,
      manageBtn:!!document.querySelector("[data-pmanage]"),
      subNeeded:sm?Math.round(sm.scrollWidth):0, subShown:sm?Math.round(sm.clientWidth):0}})()`);

  const toParty = () => ev(`(()=>{const b=[...document.querySelectorAll(".sh")].find(x=>x.textContent.startsWith("Party"));if(b)b.scrollIntoView({block:"start"});document.querySelector("#screen").scrollTop-=12})()`);

  // 1. the normal board: no remove controls, full-width text
  let pr = await probe();
  console.log("plain:", JSON.stringify(pr));
  if (pr.boards !== 2) throw new Error("expected 2 party boards, got " + pr.boards);
  if (pr.kicks !== 0) throw new Error("plain board should carry no remove controls, got " + pr.kicks);
  if (!pr.manageBtn) throw new Error("leader has no Manage control");
  await toParty(); await wait(600); await shot("party-board");

  // 2. managing: the leader opened the remove controls
  await ev(`document.querySelector("[data-pmanage]").click()`); await wait(600);
  pr = await probe();
  console.log("managing:", JSON.stringify(pr));
  if (pr.kicks !== 3) throw new Error("expected 3 remove controls while managing, got " + pr.kicks);
  await toParty(); await wait(500); await shot("party-managing");

  // 2b. the foot of the list, where a player with a party can now create another as well as join one
  await ev(`document.querySelector("[data-pmanage]").click()`); await wait(400); // back out of manage
  await ev(`(()=>{const s=document.querySelector("#screen");s.scrollTop=s.scrollHeight})()`); await wait(600);
  const foot = await ev(`(()=>{const r=document.querySelector(".acts.pmore2");
    return r?[...r.querySelectorAll("button")].map(b=>b.textContent):null})()`);
  console.log("foot controls:", JSON.stringify(foot));
  if (!foot || foot.length !== 2) throw new Error("expected create+join controls at the foot, got " + JSON.stringify(foot));
  await shot("party-foot");
  await ev(`document.querySelector("[data-pmanage]").click()`); await wait(400);

  // 3. the confirm, which is where the code-rotation consequence is stated
  await ev(`document.querySelector("button.pkick").click()`); await wait(500);
  for (let i = 0; i < 40; i++) {
    const done = await ev(`(()=>{const el=document.querySelector("#ov .typed");if(!el)return true;
      const g=el.querySelector(".ghost");if(!g)return true;
      const vis=[...el.childNodes].filter(n=>n!==g).map(n=>n.textContent||"").join("");
      return vis.length>=(g.textContent||"").length})()`);
    if (done) break; await wait(150);
  }
  await wait(400);
  await shot("party-kick-confirm");

  console.log("errors:", errs.length ? errs : "none");
  ws.close();
} finally { c.kill() }
