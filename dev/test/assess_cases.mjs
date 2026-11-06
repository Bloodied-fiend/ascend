// Assessment + adaptive-difficulty cases, run from state_test.mjs with the "gates" flag.
// Both guard against the same defect class: a lost newline that lets a trailing // comment
// swallow the statements after it. Three shipped instances are pinned here: v29, v32, and the
// bossStat restore that had been dead since v28 (found 2026-10-24 while wiring the boss art).
// A fourth, S.rev in load() (dead since 1.037, found 2026-11-01), added the static scan below.
import { readFileSync } from "node:fs";

// Flags a // comment whose text runs straight into code: a lowercase/closing char glued to
// `Name.prop=` or `if(`/`for(`/`const(`/`let(`. Catches the S.rev instance at both commits that
// had it and is clean on the commit before. shortcut: regex, not a JS parser; upgrade if it ever false-positives.
export function swallowedCode(src) {
  const hits = [];
  src.split("\n").forEach((l, i) => {
    const m = l.match(/(?:^|[\s;{}])\/\/(.*)$/);
    if (m && /[a-z0-9.)\]]([A-Z]\w*\.[\w$]+\s*=[^=]|(?:if|for|const|let)\()/.test(m[1])) hits.push(i + 1);
  });
  return hits;
}

export async function runAssess({ ev, boot, check, KEY, base, wait }) {
  {
    const hits = swallowedCode(readFileSync(new URL("../ascend.html", import.meta.url), "utf8"));
    check("no // comment in ascend.html swallows the code after it", hits.length === 0, JSON.stringify(hits));
  }
  // S.rev instance: the debt-ceiling comment ran into `S.rev=...`, so load() never restored the
  // save's revision and every pull() re-adopted a save it already had.
  // Boot saves (and mints a new rev), so drive load() through the cross-tab storage path,
  // which adopts and renders without saving.
  {
    await boot(KEY, base);
    const rev = await ev(`(()=>{const sv=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));sv.rev="pinrev123";
      dispatchEvent(new StorageEvent("storage",{key:${JSON.stringify(KEY)},newValue:JSON.stringify(sv)}));return __ascend.S.rev})()`);
    check("a save adopted from another tab keeps its rev", rev === "pinrev123", JSON.stringify(rev));
  }
  // v28 instance: the comment on the bossDown line ran straight into `S.bossStat=STATS[...]`, so the
  // saved boss was never restored and bossK() fell back to weakest() on every load -- the weekly boss
  // was not fixed for the week at all.
  {
    const live = await ev(`__ascend.S.wk`);
    // seed a boss on a stat that is NOT the weakest, so the saved value and weakest() disagree
    await boot(KEY, { ...base, lvl: 22, boss: 64, bossStat: "per", bossDown: false, wk: live,
      stats: { str: 20, vit: 60, agi: 60, int: 60, per: 60 } });
    const r = await ev(`(()=>({saved:__ascend.S.bossStat,weakest:Object.keys(__ascend.S.stats).reduce((a,b)=>__ascend.S.stats[a]<=__ascend.S.stats[b]?a:b)}))()`);
    check("a saved weekly boss survives a reload instead of being re-picked from the weakest stat",
      r.saved === "per" && r.weakest === "str", JSON.stringify(r));
  }

  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e)e.click()})()`); await wait(260); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  const dk = o => ev(`(()=>{const d=new Date(Date.now()-__ascend.S.dsh*3600e3);d.setDate(d.getDate()+(${o}));return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")})()`);

  // 1. finishing the Player Assessment records the baseline AND unlocks its trophy.
  // Regression guard for v29: the three statements after the "a lower score is honest" comment
  // were swallowed by it, so S.ap.first / S.base / S.baseKey were never set. Stats still applied,
  // which is why it looked like it worked.
  {
    await boot(KEY, { ...base, base: null, baseKey: null, ap: { ...base.ap, first: 0 } });
    const before = await S(`({first:S.ap.first,base:S.base,baseKey:S.baseKey})`);
    await raw(`[data-start="1"]`); await shut();
    for (let i = 0; i < 15; i++) await raw(`[data-a="2"]`);
    const onRoutine = await ev(`!!document.querySelector('[data-rnext="1"]')`);
    for (let i = 0; i < 3; i++) await raw(`[data-rnext="1"]`);
    const sawSave = await ev(`!!document.querySelector('[data-save="1"]')`);
    await raw(`[data-save="1"]`); await shut();
    const after = await S(`({first:S.ap.first,base:S.base,baseKey:S.baseKey,tab:S.tab,str:S.stats.str})`);
    const today = await dk(0);
    check("finishing the assessment records the baseline and unlocks its trophy",
      before.first === 0 && onRoutine && sawSave &&
      after.first === 1 && typeof after.base === "string" && after.base.length > 0 && after.baseKey === today && after.str > 0,
      JSON.stringify({ before, onRoutine, sawSave, after, today }));
  }
  // 1b. a Re-Assessment judges the stat. Answers per stat: str 3,3,3 = 9 points (scores 57).
  // [training-built stat, answers] -> expected: inside +-1 point keeps it, outside moves at most 10.
  {
    const due = await dk(-30);
    const judge = async (stats, a) => {
      await boot(KEY, { ...base, base: "Oct 1", baseKey: due, stats, train: { str: 0, vit: 0, agi: 0, int: 0, per: 0 } });
      await ev(`(()=>{__ascend.S.test={i:15,a:${JSON.stringify(a)},r:null};__ascend.S.tab="test";__ascend.render();__ascend.S.test.i=18;__ascend.render()})()`); await wait(200);
      const screen = await ev(`document.querySelector('[data-save="1"]')?.textContent`);
      await raw(`[data-save="1"]`); await shut();
      return { screen, ...(await S(`({...S.stats,baseKey:S.baseKey,first:S.ap.first})`)) };
    };
    //                 str              vit         agi         int         per
    const a = [3, 3, 3, 4, 4, 4, 3, 3, 3, 1, 1, 1, 4, 4, 3];
    const r = await judge({ str: 64, vit: 70, agi: 90, int: 20, per: 88 }, a);
    const today = await dk(0);
    check("Re-Assessment: a stat within one answer point stands, a stat outside moves at most 10",
      r.screen === "Record result" && r.str === 64 && r.vit === 80 && r.agi === 80 && r.int === 20 && r.per === 88 && r.baseKey === today,
      JSON.stringify(r));
    const low = await judge({ str: 120, vit: 30, agi: 45, int: 30, per: 30 }, [4, 4, 3, 1, 1, 1, 3, 3, 1, 1, 1, 1, 1, 1, 1]);
    check("Re-Assessment: one answer below top costs a past-99 stat 10, not the 36 the overwrite took",
      low.str === 110 && low.vit === 30 && low.agi === 45, JSON.stringify(low));
  }
  // 1c. the 30-day lock: not due means no way in, even if the button's disabled attribute is removed.
  {
    await boot(KEY, { ...base, base: "Oct 1", baseKey: await dk(-29) });
    await ev(`(()=>{__ascend.S.tab="stats";__ascend.render()})()`); await wait(200);
    const locked = await ev(`document.querySelector('[data-start="1"]')?.disabled===true`);
    const label = await ev(`document.querySelector('[data-start="1"]')?.textContent`);
    await ev(`(()=>{const b=document.querySelector('[data-start="1"]');b.disabled=false;b.click()})()`); await wait(200);
    const tab = await S(`S.tab`);
    await boot(KEY, { ...base, base: "Oct 1", baseKey: await dk(-30) }); await shut();
    await ev(`(()=>{__ascend.S.tab="stats";__ascend.render()})()`); await wait(200);
    const open = await ev(`document.querySelector('[data-start="1"]')?.disabled===false`);
    await raw(`[data-start="1"]`);
    const tab30 = await S(`S.tab`);
    check("the Re-Assessment is locked at day 29 and opens at day 30",
      locked && tab === "stats" && /Next in 1 day ·/.test(label) && open && tab30 === "test", JSON.stringify({ locked, tab, label, open, tab30 }));
  }
  // 1d. a player who missed more than one update can page back to the note they skipped.
  {
    const v = +/const PATCH=\[\s*\{v:(\d+)/.exec(readFileSync(new URL("../ascend.html", import.meta.url), "utf8"))[1];
    const shown = async pn => {
      await boot(KEY, base);
      await ev(`(()=>{addEventListener("pagehide",e=>e.stopImmediatePropagation(),true);const s=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));s.ap.pn=${pn};localStorage.setItem(${JSON.stringify(KEY)},JSON.stringify(s));location.reload()})()`);
      await wait(2500);
      return ev(`document.querySelector("#sysA")?.textContent||""`);
    };
    const one = await shown(v - 1), two = await shown(v - 2);
    check("the update screen offers Older only when more than one update was missed", !/Older/.test(one) && /Accept/.test(one) && /Older/.test(two), JSON.stringify({ one, two }));
  }
  // 2. an adaptive target that moved today can't move again for a week.
  // Regression guard for v32: the cooldown `if(S.adj[q.id]&&daysSince(S.adj[q.id])<7)continue;`
  // was swallowed by the comment above it, so targets could drift every single day.
  {
    const qlog = {};
    for (let i = 8; i >= 2; i--) qlog[await dk(-i)] = { read: 1 }; // 7 clean days: enough to trigger a raise
    const today = await dk(0);
    await boot(KEY, { ...base, day: await dk(-1), done: { read: 1 }, cnt: { read: 20 }, qlog, adj: { read: today } });
    const r = await S(`({n:S.quests.find(q=>q.id==="read").n,adj:S.adj.read,rolled:S.day===${JSON.stringify(today)}})`);
    check("a target adjusted today is on a 7-day cooldown and doesn't move again",
      r.rolled && r.n === 20 && r.adj === today, JSON.stringify(r));
  }
}
