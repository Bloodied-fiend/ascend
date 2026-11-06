// node backup_e2e.mjs <scratch> <fnUrl>: two fresh "phones" (browser profiles) against the throwaway Neon branch. The served copy is index.html with the API URL swapped.
import { spawn } from "node:child_process"; import { setTimeout as wait } from "node:timers/promises"; import fs from "node:fs";
const [scratch, FN] = process.argv.slice(2), REPO = "S:/projects/ascend", dir = `${scratch}/e2e-site`, PORT = 8799, shots = `${scratch}/e2e-shots`;
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true }); fs.cpSync(REPO, dir, { recursive: true, filter: f => !/[\\/](\.git|backend|dev|node_modules)([\\/]|$)/.test(f) });
const html = fs.readFileSync(`${dir}/index.html`, "utf8"), LIVE = "https://br-red-haze-b7b2z47p-party.compute.c-13.us-east-1.aws.neon.tech/";
if (!html.includes(LIVE)) throw new Error("API url not found"); fs.writeFileSync(`${dir}/index.html`, html.replaceAll(LIVE, FN));
let bad = 0; const check = (n, ok, x = "") => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", n, ok ? "" : x) };
const srv = spawn("python", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" }); await wait(1000);
const NAME = "E2E" + Date.now().toString(36), PIN = String(100000 + Math.floor(Math.random() * 899999));
async function phone(label, port) {
  const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--user-data-dir=${scratch}/e2e-prof-${label}-${Date.now()}`, `--remote-debugging-port=${port}`, "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
  let t; for (let i = 0; i < 80; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await wait(250) } }
  const ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map(), errs = [], hits = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (m.method === "Network.requestWillBeSent" && m.params.request.method === "POST") hits.push(m.params.request.url); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } };
  const s = (m, pa = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })) });
  const ev = async x => { const r = await s("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) errs.push(r.result.exceptionDetails.exception?.description?.slice(0, 200)); return r.result?.result?.value };
  await s("Runtime.enable"); await s("Page.enable"); await s("Network.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s("Page.navigate", { url: `http://127.0.0.1:${PORT}/` }); await wait(6000);
  const shot = async n => { const r = await s("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${shots}/${n}.png`, Buffer.from(r.result.data, "base64")) };
  const close = async () => { await s("Browser.close").catch(() => {}); ws.close() };
  return { ev, s, errs, hits, shot, close };
}
const btn = (P, label) => P.ev(`(()=>{const b=[...document.querySelectorAll("#sysA button")].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`);
const note = P => P.ev(`(()=>{const o=document.getElementById("ov");return o.hidden?null:{t:document.getElementById("sysT").textContent,btn:[...document.querySelectorAll("#sysA button")].map(x=>x.textContent.trim()),err:(document.querySelector("#ov .qe-err")||{}).textContent}})()`);
const drain = P => P.ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`);
const typeIn = (P, id, v) => P.ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(v)}`);
try {
  // phone A: a real player
  const A = await phone("a", 9371);
  const seed = await A.ev(`(()=>{const x=JSON.parse(JSON.stringify(__ascend.S));Object.assign(x,{onboarded:true,seen:x.day,base:"Oct 1",baseKey:x.day,name:${JSON.stringify(NAME)},lvl:12,xp:40,stats:{str:61,vit:62,agi:63,int:64,per:65},thSeen:1});x.ap.pn=9999;delete x.tab;return x})()`);
  await A.ev(`localStorage.setItem("ascend-v12",${JSON.stringify(JSON.stringify(seed))})`); await A.s("Page.reload"); await wait(3500); await drain(A); await wait(1000);
  await A.ev(`document.querySelector('[data-t="me"]').click()`); await wait(400); await drain(A);
  const lineBefore = await A.ev(`[...document.querySelectorAll(".card small")].map(x=>x.textContent).find(x=>/ack/.test(x)&&/\\.$/.test(x)&&/(Waiting for first|Backed up)/.test(x))`);
  check("before the first upload, Profile says it isn't backed up", /Waiting for first backup/.test(lineBefore || ""), lineBefore);
  await A.ev(`document.querySelector('[data-bpin]')?.scrollIntoView({block:"center"})`); await wait(300); await A.shot("profile-nopin");
  await wait(3500); await A.ev(`__ascend.backup()`); await wait(2500);
  const st = await A.ev(`__ascend.bk()`);
  check("phone A uploaded its save", !!st.at && st.rev === (await A.ev(`__ascend.S.rev`)), JSON.stringify(st));
  await A.ev(`document.querySelector('[data-bpin]').click()`); await wait(3000); await A.shot("pin-dialog");
  await typeIn(A, "bpin", "12"); await btn(A, "Save PIN"); await wait(1500);
  check("a short PIN keeps the dialog open and says why", (await note(A))?.err === "A PIN is 6 digits.", JSON.stringify(await note(A)));
  await typeIn(A, "bpin", PIN); await btn(A, "Save PIN"); await wait(3000);
  check("the PIN saves", (await A.ev(`localStorage.getItem("ascend-pin-set")`)) === "1", JSON.stringify(await note(A)));
  await A.ev(`document.querySelector('[data-bpin]')?.scrollIntoView({block:"center"})`); await wait(300); await A.shot("profile-pin");
  await A.close(); await wait(800);

  // phone B: a brand-new phone, first screen
  const B = await phone("b", 9372);
  const first = await note(B);
  check("a new phone offers Restore progress on the first screen", first?.btn.includes("Restore progress"), JSON.stringify(first)); await wait(1500); await B.shot("first-run");
  await btn(B, "Restore progress"); await wait(1500); await B.shot("restore-dialog");
  await typeIn(B, "rname", NAME); await typeIn(B, "rsec", String((+PIN + 1) % 900000 + 100000)); await btn(B, "Continue"); await wait(3000);
  check("a wrong PIN says so and stays open, keeping the typed name", /match/.test((await note(B))?.err || "") && (await B.ev(`document.getElementById("rname").value`)) === NAME, JSON.stringify(await note(B)));
  await wait(600); await B.shot("restore-error");
  await typeIn(B, "rname", NAME); await typeIn(B, "rsec", PIN); await btn(B, "Continue"); await wait(3000);
  const found = await note(B); check("it shows what it found before touching anything", found?.t === "Level 12 found" && !(await B.ev(`__ascend.S.onboarded`)), JSON.stringify(found)); await wait(800); await B.shot("restore-confirm");
  await btn(B, "Restore level 12"); await wait(3500);
  const got = await B.ev(`(()=>{const S=__ascend.S;return {lvl:S.lvl,xp:S.xp,name:S.name,str:S.stats.str,per:S.stats.per,onb:S.onboarded,pend:__ascend.bk().pend,pin:localStorage.getItem("ascend-pin-set")}})()`);
  check("the new phone has the whole save", got.lvl === 12 && got.xp === 40 && got.name === NAME && got.str === 61 && got.per === 65 && got.onb && !got.pend && got.pin === "1", JSON.stringify(got));
  await drain(B); await B.s("Page.reload"); await wait(3500);
  check("it survives a reload", (await B.ev(`__ascend.S.lvl`)) === 12);
  await drain(B); await wait(500); await B.ev(`__ascend.backup()`); await wait(2500);
  const bst = await B.ev(`__ascend.bk()`); check("the new phone backs up under its own key", !!bst.at, JSON.stringify(bst));

  // lost answer: the transfer happens but this phone never hears back
  await B.ev(`localStorage.setItem("ascend-backup",JSON.stringify({pend:1,rev:"x",at:1}))`);
  const preRev = await B.ev(`__ascend.S.rev`); await B.ev(`__ascend.backup()`); await wait(1500);
  check("while a restore is unfinished, this phone uploads nothing", (await B.ev(`__ascend.bk().rev`)) === "x" && preRev);
  await B.ev(`__ascend.bk`); await B.ev(`__ascend.restoreResume()`); await wait(2500);
  check("an unfinished restore resolves and uploads resume", !(await B.ev(`__ascend.bk().pend`)), JSON.stringify(await B.ev(`__ascend.bk()`)));
  // erase on a phone with a backup
  await B.ev(`localStorage.setItem("ascend-party-key","d".repeat(64))`);
  check("no script errors", A.errs.length + B.errs.length === 0, JSON.stringify([A.errs, B.errs]));
  await B.close(); await wait(800);
  // the same dialogs in the skins most at risk (stills for review, forced skin)
  const C = await phone("c", 9373); await wait(1500);
  for (const sk of ["daylight", "bloodmoon", "abyss", "whiteout"]) { await C.ev(`document.documentElement.dataset.skin=${JSON.stringify(sk)}`); await wait(400); await C.shot(`first-run-${sk}`) }
  await btn(C, "Restore progress"); await wait(2500);
  await typeIn(C, "rname", NAME);
  for (const sk of ["daylight", "bloodmoon", "abyss", "whiteout"]) { await C.ev(`document.documentElement.dataset.skin=${JSON.stringify(sk)}`); await wait(400); await C.shot(`restore-${sk}`) }
  await C.close();
} catch (e) { bad++; console.log("FAIL threw", e && e.stack || e) }
finally { await wait(800); srv.kill() }
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
