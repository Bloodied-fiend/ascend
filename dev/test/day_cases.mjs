// System day boundary cases, run from state_test.mjs with the "gates" flag.
//
// The boundary moved from 04:00 to midnight on 2026-10-24. The migration is staged rather than
// immediate, and these guard the reason why: between 00:00 and 03:59 the old boundary reports
// YESTERDAY and the new one reports today, so adopting the target inside that window advances the date,
// makes rollover close the evening in progress, and writes it to history as MISSED. That is a broken
// streak and a Penalty Quest for a day the player had not finished yet.
export async function runDay({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  // the demo "late" control pins the wall clock to 01:30 -- exactly the dangerous window
  const at0130 = async () => { await ev(`document.querySelector('[data-demo="late"]').click()`); await wait(400); };

  // 1. a save written before the change keeps the boundary it was written under
  {
    const { dsh, ...noDsh } = { ...base, lvl: 9 };
    await boot(KEY, noDsh);
    const r = await S(`({dsh:S.dsh,day:S.day})`);
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
}
