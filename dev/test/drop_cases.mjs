// Relic (drop) cases, run from state_test.mjs with the "gates" flag.
// The roll is seeded by (install seed, System day, quest id), so the test picks a seed that forces
// the tier it wants instead of grinding completions until one shows up.
const h32 = v => { let h = 2166136261; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 };
const tierAt = r => r < .005 ? "l" : r < .025 ? "r" : r < .085 ? "u" : r < .235 ? "c" : null;
const seedFor = (day, qid, want) => {
  for (let i = 0; i < 4e6; i++) { const s = "sd" + i.toString(36).padStart(5, "0"); if (tierAt(h32(s + "|" + day + "|" + qid)) === want) return s }
  throw new Error("no seed rolls " + want + " for " + qid + " on " + day);
};

export async function runDrops({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  const days = await ev(`(()=>{const d=new Date(Date.now()-4*3600e3),k=x=>{const y=new Date(d);y.setDate(y.getDate()+x);return y.getFullYear()+"-"+String(y.getMonth()+1).padStart(2,"0")+"-"+String(y.getDate()).padStart(2,"0")};return [k(0),k(-1)]})()`);

  // 1. the roll is fixed for that quest and day: toggling can't farm it, and it carries no XP
  {
    await boot(KEY, { ...base, seed: seedFor(days[0], "sleep", "c"), lvl: 5, xp: 0 });
    await raw(`[data-q="sleep"]`);
    const one = await S(`({n:S.loot.c||0,d:S.drops.sleep||null,xp:S.xp})`);
    for (let i = 0; i < 4; i++) await raw(`[data-q="sleep"]`); // undo/redo twice, ends complete again
    const same = await S(`({n:S.loot.c||0,d:S.drops.sleep||null,done:!!S.done.sleep,xp:S.xp})`);
    await raw(`[data-q="sleep"]`);
    const back = await S(`({n:S.loot.c||0,d:S.drops.sleep||null,rolls:S.rolls})`);
    check("relic roll is fixed per quest+day, toggling never farms it, undo hands it back, no XP",
      one.n === 1 && one.d === "c" && one.xp === 15 && same.n === 1 && same.d === "c" && same.done && same.xp === 15 &&
      back.n === 0 && back.d === "c" && back.rolls === 1,
      JSON.stringify({ one, same, back }));
  }
  // 2. a legendary opens a System window naming it; undo still takes it back
  {
    await boot(KEY, { ...base, seed: seedFor(days[0], "sleep", "l") });
    await raw(`[data-q="sleep"]`);
    const w = await ev(`({open:!document.querySelector("#ov").hidden,c:document.querySelector("#sysC").textContent,t:document.querySelector("#sysT").textContent})`);
    await shut();
    const got = await S(`S.loot.l||0`);
    await raw(`[data-q="sleep"]`);
    const un = await S(`({l:S.loot.l||0,d:S.drops.sleep||null})`);
    check("a legendary relic opens a [ DROP ] window and undo takes it back",
      w.open && w.c.includes("DROP") && w.t === "MONARCH'S FRAGMENT" && got === 1 && un.l === 0 && un.d === "l",
      JSON.stringify({ w, got, un }));
  }
  // 2b. CRITICAL (Alastor): the editor mints a new quest id from Date.now(), so delete-and-recreate
  // used to buy a fresh roll on the same day. The day's rolls are capped at MAXQ by a counter that
  // no amount of editor churn or reloading can reset.
  {
    await boot(KEY, { ...base, seed: seedFor(days[0], "sleep", "l"), rolls: 8 });
    await raw(`[data-q="sleep"]`);
    const capped = await S(`({loot:JSON.stringify(S.loot),d:S.drops.sleep===undefined,rolls:S.rolls,done:!!S.done.sleep})`);
    check("the day's rolls are capped, so churning quest ids can't buy more",
      capped.loot === "{}" && capped.d && capped.rolls === 8 && capped.done, JSON.stringify(capped));
  }
  // 2c. a miss is recorded, so re-completing the same quest never spends a second roll
  {
    await boot(KEY, { ...base, seed: seedFor(days[0], "sleep", null) });
    await raw(`[data-q="sleep"]`);
    const miss = await S(`({has:"sleep" in S.drops,v:S.drops.sleep,rolls:S.rolls})`);
    await raw(`[data-q="sleep"]`); await raw(`[data-q="sleep"]`);
    const after = await S(`S.rolls`);
    check("a miss is recorded and redoing the quest doesn't spend another roll",
      miss.has && miss.v === null && miss.rolls === 1 && after === 1, JSON.stringify({ miss, after }));
  }
  // 3. a roll above every band drops nothing at all
  {
    await boot(KEY, { ...base, seed: seedFor(days[0], "sleep", null) });
    await raw(`[data-q="sleep"]`);
    const r = await S(`({loot:JSON.stringify(S.loot),d:S.drops.sleep||null,done:!!S.done.sleep})`);
    check("most completions drop nothing at all", r.loot === "{}" && r.d === null && r.done, JSON.stringify(r));
  }
  // 4. garbage relic/streak fields are dropped without rejecting the rest of the save
  {
    await boot(KEY, { ...base, lvl: 9, seed: "BAD SEED!", loot: { c: -3, u: 2.5, r: "x", l: 1e9, zz: 9 },
      drops: { sleep: "zz", nosuch: "c" }, rolls: 999, sMile: 99, hist: { "abc": 1, "2026-13-99": 1, "2026-01-02": 7 } });
    const r = await S(`({lvl:S.lvl,loot:JSON.stringify(S.loot),drops:JSON.stringify(S.drops),rolls:S.rolls,sm:S.sMile,hist:JSON.stringify(S.hist),seed:/^[a-z0-9]{6,40}$/.test(S.seed)})`);
    check("invalid loot/drops/rolls/sMile/hist load as defaults, the save still loads",
      r.lvl === 9 && r.loot === '{"l":99999}' && r.drops === "{}" && r.rolls === 8 && r.sm === 0 && r.hist === "{}" && r.seed,
      JSON.stringify(r));
  }
  // 5. a new System day clears the day's rolls but never the collection
  {
    await boot(KEY, { ...base, day: days[1], drops: { sleep: "r" }, loot: { r: 1 }, done: { sleep: 1 }, cnt: { sleep: 1 } });
    const r = await S(`({d:JSON.stringify(S.drops),r:S.loot.r||0,rolled:S.day===${JSON.stringify(days[0])}})`);
    check("rollover clears today's relic rolls and keeps the collection", r.d === "{}" && r.r === 1 && r.rolled, JSON.stringify(r));
  }
  // 6. the v11 -> v12 import carries relics across
  {
    await ev(`localStorage.clear()`);
    const v11 = { ...base, ver: 11, lvl: 7, loot: { c: 4, r: 1 } };
    await ev(`localStorage.setItem("ascend-v11",${JSON.stringify(JSON.stringify(v11))})`);
    await ev(`location.reload()`); await wait(1800); await shut();
    const r = await S(`({lvl:S.lvl,c:S.loot.c||0,r:S.loot.r||0,v12:!!localStorage.getItem(${JSON.stringify(KEY)})})`);
    check("v11 save imports into v12 with relics intact", r.lvl === 7 && r.c === 4 && r.r === 1 && r.v12, JSON.stringify(r));
  }
}
