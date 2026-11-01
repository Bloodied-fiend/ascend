// System day boundary cases, run from state_test.mjs with the "gates" flag.
//
// The boundary moved from 04:00 to midnight on 2026-10-24. The migration is staged rather than
// immediate, and these guard the reason why: between 00:00 and 03:59 the old boundary reports
// YESTERDAY and the new one reports today, so adopting the target inside that window advances the date,
// makes rollover close the evening in progress, and writes it to history as MISSED. That is a broken
// streak and a Penalty Quest for a day the player had not finished yet.
//
// Every case pins the page's local clock with a timezone override, so the suite gives the same answer at
// any real hour: cases 1-4 run at local noon (both boundaries agree on the date), case 5 at 02:xx.
export async function runDay({ ev, boot, check, KEY, base: base0, wait, send }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  // a fixed-offset zone whose local hour is `h` right now (Etc/GMT signs are inverted)
  const hourTZ = async h => { let n = ((h - new Date().getUTCHours()) % 24 + 24) % 24; if (n > 14) n -= 24;
    await send("Emulation.setTimezoneOverride", { timezoneId: n ? `Etc/GMT${n > 0 ? "-" : "+"}${Math.abs(n)}` : "Etc/GMT" }); };
  // the fixture's day keys, re-read from a fresh page in the pinned zone
  const today = async () => { await boot(KEY, null); return S(`({day:S.day,seen:S.day,prog:S.day,baseKey:S.day,wk:S.wk})`); };
  await hourTZ(12);
  const base = { ...base0, ...(await today()) };
  let legacy = null; // the boundary the app assumes for a save with none recorded (case 1 reads it)
  try {
  // the demo "late" control pins the wall clock to 01:30 -- exactly the dangerous window
  const at0130 = async () => { await ev(`document.querySelector('[data-demo="late"]').click()`); await wait(400); };

  // 1. a save written before the change keeps the boundary it was written under
  {
    const { dsh, ...noDsh } = { ...base, lvl: 9 };
    await boot(KEY, noDsh);
    const r = await S(`({dsh:S.dsh,day:S.day})`);
    legacy = r.dsh;
    check("a save with no boundary recorded is treated as the old 04:00 one",
      r.dsh === 4, JSON.stringify(r));
  }

  // 2. THE SAFETY PROPERTY: at 01:30, that save must still report the same day it was on.
  // Under the target boundary the date would advance here and the day in progress would be closed.
  {
    const { dsh, ...noDsh } = { ...base, lvl: 9 };
    await boot(KEY, noDsh);
    const before = await S(`S.day`);
    await at0130();
    const after = await S(`({day:S.day,dsh:S.dsh})`);
    check("at 01:30 a pre-change save does not jump a day (the streak-eating case)",
      after.day === before && after.dsh === 4, JSON.stringify({ before, after }));
  }

  // 3. once the day turns over normally, the midnight boundary is adopted and persists
  {
    const { dsh, ...noDsh } = { ...base, lvl: 9 };
    await boot(KEY, noDsh);
    await ev(`document.querySelector('[data-demo="miss"]').click()`); await wait(600);
    const r = await S(`({dsh:S.dsh})`);
    check("the midnight boundary is adopted at the next ordinary rollover", r.dsh === 0, JSON.stringify(r));
    // and it survives the reload, rather than reverting and re-staging every open
    await ev(`(()=>{const raw=localStorage.getItem(${JSON.stringify(KEY)});return JSON.parse(raw).dsh})()`);
    const persisted = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).dsh`);
    check("the adopted boundary is written to the save", persisted === 0, JSON.stringify({ persisted }));
  }

  // 4. a brand new player is on the target from the first open, with no staging
  {
    await boot(KEY, null);
    const r = await S(`S.dsh`);
    check("a new player starts on the midnight boundary", r === 0, JSON.stringify({ dsh: r }));
  }

  // 5. (audit #9) a pre-change save last opened on the previous old-boundary day, everything done, first
  // opened again at 02:xx. Under the old boundary it is still "yesterday" until 04:00. Adopting midnight in
  // this rollover would advance the date on the next tick and close that day as missed, 2-4 hours early.
  {
    await hourTZ(2);
    const k = await ev(`(()=>{const f=o=>{const d=new Date(Date.now()-${legacy}*3600e3);d.setDate(d.getDate()+o);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};return {t:f(0),y:f(-1)}})()`);
    const { dsh, ...noDsh } = { ...base, day: k.y, seen: k.y, prog: k.y, baseKey: k.y, done: Object.fromEntries(base.quests.map(q => [q.id, 1])), hist: {}, penalty: null };
    await boot(KEY, noDsh);
    await wait(2500); // several 1 s ticks
    const r = await S(`({day:S.day,dsh:S.dsh,hy:S.hist[${JSON.stringify(k.y)}],ht:S.hist[${JSON.stringify(k.t)}],pen:!!S.penalty})`);
    check("a pre-change save first opened at 02:xx keeps the old boundary until 04:00 (no early missed day)",
      r.day === k.t && r.dsh === legacy && r.hy === 1 && r.ht === undefined && !r.pen, JSON.stringify({ k, r }));
  }
  } finally { await send("Emulation.setTimezoneOverride", { timezoneId: "" }); }
}
