// Assessment + adaptive-difficulty cases, run from state_test.mjs with the "gates" flag.
// Both guard against the same defect class: a lost newline that lets a trailing // comment
// swallow the statements after it. Two shipped instances (v29 and v32) are pinned here.
export async function runAssess({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e)e.click()})()`); await wait(260); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  const dk = o => ev(`(()=>{const d=new Date(Date.now()-4*3600e3);d.setDate(d.getDate()+(${o}));return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")})()`);

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
