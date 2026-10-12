// Streak cases, run from state_test.mjs with the "gates" flag.
const h32 = v => { let h = 2166136261; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 };
const tierAt = r => r < .005 ? "l" : r < .025 ? "r" : r < .085 ? "u" : r < .235 ? "c" : null;
// a seed where no quest rolls a rare/legendary today, so only the streak's own window is on screen
const quietSeed = (day, ids) => {
  const loud = t => t === "r" || t === "l"; // "rl".includes(null||"") is true - don't use includes here
  for (let i = 0; i < 4e6; i++) { const s = "qt" + i.toString(36).padStart(5, "0"); if (ids.every(q => !loud(tierAt(h32(s + "|" + day + "|" + q))))) return s }
  throw new Error("no quiet seed for " + day);
};

export async function runStreak({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  const dk = o => ev(`(()=>{const d=new Date(Date.now()-4*3600e3);d.setDate(d.getDate()+(${o}));return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")})()`);
  const today = await dk(0), yday = await dk(-1);
  const ids = base.quests.map(q => q.id);
  const back = async (n, rest = -1) => { const h = {}; for (let i = 1; i <= n; i++) h[await dk(-i)] = i === rest ? 2 : 1; return h };

  // 1. the 7-day milestone pays once, and re-clearing the same day never pays again
  {
    await boot(KEY, { ...base, lvl: 5, xp: 0, sMile: 3, seed: quietSeed(today, ids), hist: await back(6) });
    const before = await S(`({s:__ascend.S.sMile,xp:S.xp})`);
    for (const q of ids.slice(0, -1)) await raw(`[data-q="${q}"]`);
    await raw(`[data-q="${ids[ids.length - 1]}"]`);
    const first = await ev(`document.querySelector("#sysC").textContent`);
    await ev(`__ascend.closeNote(-1)`); await wait(350);
    const second = await ev(`({c:document.querySelector("#sysC").textContent,t:document.querySelector("#sysT").textContent,open:!document.querySelector("#ov").hidden})`);
    await shut();
    const paid = await S(`({sm:S.sMile,xp:S.xp,st:${JSON.stringify(0)}})`);
    await raw(`[data-q="sleep"]`); await shut();   // undo
    await raw(`[data-q="sleep"]`); await shut();   // and redo: streak returns to 7
    const again = await S(`({sm:S.sMile,xp:S.xp})`);
    check("the 7-day streak milestone pays +35 XP once and can't be re-collected",
      before.s === 3 && before.xp === 0 && first.includes("QUEST COMPLETE") && second.open && second.c.includes("STREAK") &&
      second.t === "7 DAYS" && paid.sm === 7 && paid.xp === 130 && again.sm === 7 && again.xp === 130,
      JSON.stringify({ before, first, second, paid, again }));
  }
  // 2. a missed day resets the ladder, so the climb back is worth something again
  {
    await boot(KEY, { ...base, day: yday, sMile: 7, hist: {}, done: {}, cnt: {} });
    const r = await S(`({sm:S.sMile,pen:!!S.penalty,h:S.hist[${JSON.stringify(yday)}]})`);
    check("a missed day resets the streak milestone ladder", r.sm === 0 && r.pen && r.h === 0, JSON.stringify(r));
  }
  // 3. a Rest Day keeps a run intact; the banner shows the run and the next milestone
  {
    await boot(KEY, { ...base, hist: await back(6, 5) }); // day -5 is a Rest Day
    await raw(`[data-t="home"]`);
    const r = await ev(`({n:document.querySelector(".strk .sn").textContent,b:document.querySelector(".strk .sb").textContent,next:document.querySelector(".strk .sbar span").textContent,cls:document.querySelector(".strk").className})`);
    check("a Rest Day keeps the run; banner reads 6, NEW BEST, 1 day to 7",
      r.n === "6" && r.b === "NEW BEST" && r.next === "1 DAY TO 7" && r.cls.includes("on"), JSON.stringify(r));
  }
  // 4. a real gap breaks the run but the best-ever still remembers the longer one
  {
    const h = {}; for (const i of [1, 2, 4, 5, 6]) h[await dk(-i)] = 1; // day -3 missing
    await boot(KEY, { ...base, hist: h });
    await raw(`[data-t="home"]`);
    const r = await ev(`({n:document.querySelector(".strk .sn").textContent,b:document.querySelector(".strk .sb").textContent})`);
    check("a gap breaks the run, best-ever keeps the longer one", r.n === "2" && r.b === "BEST 3", JSON.stringify(r));
  }
  // 4b. CRITICAL (Alastor): a day with nothing scheduled finalises as hist=2, which streak() counts
  // and rollover's catch-up never counts as a miss. Setting every quest to "Optional only" therefore
  // grew the streak forever and paid every milestone for no work. A milestone now needs a real clear.
  {
    const q = base.quests.map(x => ({ ...x, days: [] })); // "Optional only" - nothing is ever due
    const h = {}; for (let i = 1; i <= 10; i++) h[await dk(-i)] = 2;
    await boot(KEY, { ...base, quests: q, hist: h, sMile: 0, lvl: 5, xp: 0 });
    await raw(`[data-t="home"]`);
    const r = await S(`({sm:S.sMile,xp:S.xp,lvl:S.lvl,streak:document.querySelector(".strk .sn").textContent})`);
    check("an all-optional schedule can't collect streak milestones",
      r.sm === 0 && r.xp === 0 && r.lvl === 5, JSON.stringify(r));
  }
  // 4c. a v11 save with a long run already going doesn't get a lump payout on first open
  {
    await ev(`localStorage.clear()`);
    const h = {}; for (let i = 1; i <= 40; i++) h[await dk(-i)] = 1;
    const v11 = { ...base, ver: 11, lvl: 5, xp: 0, hist: h };
    delete v11.sMile;
    await ev(`localStorage.setItem("ascend-v11",${JSON.stringify(JSON.stringify(v11))})`);
    await ev(`location.reload()`); await wait(1800); await shut();
    const r = await S(`({sm:S.sMile,xp:S.xp,lvl:S.lvl})`);
    check("migrating a 40-day run seeds the ladder instead of paying it out",
      r.sm === 30 && r.xp === 0 && r.lvl === 5, JSON.stringify(r));
  }
  // 4d. a broken run is its own state: the number you lost stays on screen, with its own CTA column
  // (sharing the zero state's treatment ran the label and BEST together into one sentence)
  {
    const h = {}; for (let i = 4; i <= 12; i++) h[await dk(-i)] = 1; // ended 4 days ago
    await boot(KEY, { ...base, hist: h, sMile: 0 });
    await raw(`[data-t="home"]`);
    const r = await ev(`({cls:document.querySelector(".strk").className,n:document.querySelector(".strk .sn").textContent,l:document.querySelector(".strk .sl").textContent,b:document.querySelector(".strk .sb").textContent,bar:!!document.querySelector(".strk .sbar")})`);
    check("a broken run shows the best run it lost, with its own restart CTA",
      r.cls.includes("lost") && !r.cls.includes("off") && r.n === "9" && r.l === "BEST RUN" && r.b === "CLEAR TODAY TO RESTART" && !r.bar,
      JSON.stringify(r));
  }
  // 5. zero streak renders muted with no milestone bar and no "BEST 0"
  {
    await boot(KEY, { ...base, hist: {} });
    await raw(`[data-t="home"]`);
    const r = await ev(`({cls:document.querySelector(".strk").className,bar:!!document.querySelector(".strk .sbar"),b:document.querySelector(".strk .sb").textContent})`);
    check("a zero streak is muted, with no bar and no BEST 0", r.cls.includes("off") && !r.bar && r.b === "", JSON.stringify(r));
  }
}
