// v37 cases, run from state_test.mjs with the "gates" flag.
// From the Codex review of 2026-10-14 (findings 11, 12, 9) and Alastor's review of the fixes for them.
// The invariant most of these share: total XP published to the party is conserved across complete -> undo.

export async function runV37({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  const XPCAP = 99 + 8 * 999;  // xpNeed(999) - 1, the ceiling load() clamps xp to

  // 1. an ordinary undo leaves XP debt behind; the board must not count XP that was taken back
  {
    await boot(KEY, { ...base, lvl: 1, xp: 95, debt: 0 });
    const q = await ev(`(()=>__ascend.S.quests.find(x=>x.xp>=15).id)()`);
    const before = await ev(`__ascend.totalXP()`);
    await raw(`[data-q="${q}"]`); await shut();
    const up = await S(`({lvl:S.lvl,xp:S.xp,t:__ascend.totalXP()})`);
    await raw(`[data-q="${q}"]`); await shut();
    const back = await S(`({lvl:S.lvl,xp:S.xp,debt:S.debt,t:__ascend.totalXP()})`);
    check("undoing a level-up doesn't inflate the XP sent to the party",
      before === 95 && up.lvl === 2 && up.t > before && back.debt > 0 && back.t === before,
      JSON.stringify({ before, up, back }));
  }

  // 2. lvl:1e308 is a finite number, so it passed isSave and then looped forever in totalXP/gainXP.
  // xp is pinned to the exact cap, not a floor: 1e6 of slack let a restored save launder 1M XP into 489 levels.
  {
    await boot(KEY, { ...base, lvl: 1e308, xp: 1e308, boss: 1e9, debt: 1e308 });
    const r = await S(`({lvl:S.lvl,xp:S.xp,boss:S.boss,debt:S.debt})`);
    const sane = r.lvl === 999 && r.xp === XPCAP && r.boss === 100 && r.debt === 1e6;
    const t = sane ? await ev(`__ascend.totalXP()`) : null; // only safe to call once the clamp is proven
    check("an absurd lvl/xp/debt in a restored save is clamped to exact bounds, not just made finite",
      sane && Number.isFinite(t), JSON.stringify({ ...r, t }));
  }

  // 3. a restored save can't launder XP into levels on the first tap either
  {
    await boot(KEY, { ...base, lvl: 1, xp: 1e7 });
    const loaded = await S(`({lvl:S.lvl,xp:S.xp,t:__ascend.totalXP()})`);
    const q = await ev(`(()=>__ascend.S.quests.find(x=>x.xp>=15).id)()`);
    await raw(`[data-q="${q}"]`); await shut();
    const after = await S(`({lvl:S.lvl,t:__ascend.totalXP()})`);
    check("1e7 XP at level 1 is capped on load and can't become hundreds of levels on one tap",
      loaded.lvl === 1 && loaded.xp === 107 && after.lvl <= 2, JSON.stringify({ loaded, after }));
  }

  // 4. the boss died, then the activity that killed it was undone: reward, kill and title all go back,
  // and the HP returns to exactly what it was before the blow (overkill is not refunded as real HP)
  {
    await boot(KEY, { ...base, lvl: 5, xp: 0, boss: 10, bossStat: "str", bossDown: false });
    const before = await ev(`__ascend.totalXP()`);
    await raw(`[data-q="str"]`); await shut();
    const dead = await S(`({boss:S.boss,down:S.bossDown,k:(S.m.kills||{}).str,e:!!S.titles.bane_str,t:__ascend.totalXP()})`);
    await ev(`__ascend.S.title="bane_str"`); // equip it, so the unequip branch is actually covered
    await raw(`[data-q="str"]`); await shut();
    const r = await S(`({boss:S.boss,down:S.bossDown,k:(S.m.kills||{}).str,e:!!S.titles.bane_str,title:S.title,t:__ascend.totalXP()})`);
    check("undoing the kill restores the boss's exact HP and takes back its 150 XP, kill and Bane title",
      dead.down && dead.k === 1 && dead.e && r.boss === 10 && r.down === false && !r.k && !r.e
      && r.title === "awakened" && r.t === before,
      JSON.stringify({ before, dead, r }));
  }

  // 5. undoing a quest that was NOT the killing blow must leave the kill alone.
  // Pre-Alastor this healed unconditionally, crossed 0 and destroyed a kill whose killer was still complete.
  {
    await boot(KEY, { ...base, lvl: 5, xp: 0, boss: 10, bossStat: "str", bossDown: false });
    await raw(`[data-q="med"]`); await shut();   // 5 dmg, boss 10 -> 5
    await raw(`[data-q="str"]`); await shut();   // 15 dmg, the killing blow
    const dead = await S(`({boss:S.boss,down:S.bossDown,k:(S.m.kills||{}).str})`);
    await raw(`[data-q="med"]`); await shut();   // undo the sibling
    const r = await S(`({boss:S.boss,down:S.bossDown,k:(S.m.kills||{}).str,e:!!S.titles.bane_str,done:Object.keys(S.done).join()})`);
    check("undoing a quest that didn't land the kill leaves the boss dead and the kill intact",
      dead.down && dead.k === 1 && r.down === true && r.boss === 0 && r.k === 1 && r.e,
      JSON.stringify({ dead, r }));
  }

  // 6. a restored save that claims the boss is dead while it still has HP must not let an ordinary
  // completion strip a kill (and an equipped title) earned in an earlier week
  {
    await boot(KEY, {
      ...base, lvl: 5, xp: 0, boss: 60, bossDown: true, bossStat: "str",
      m: { miles: 0, kills: { str: 1 } }, titles: { bane_str: base.day }, title: "bane_str"
    });
    const loaded = await S(`({boss:S.boss,down:S.bossDown,k:(S.m.kills||{}).str,title:S.title})`);
    const before = await ev(`__ascend.totalXP()`);
    await raw(`[data-q="read"]`); await shut();  // an ordinary int quest, 5 dmg
    const r = await S(`({boss:S.boss,k:(S.m.kills||{}).str,e:!!S.titles.bane_str,title:S.title,t:__ascend.totalXP()})`);
    check("a restored 'dead at 60 HP' save keeps its kill and title when the next quest is completed",
      loaded.down === false && loaded.k === 1 && loaded.title === "bane_str"
      && r.boss === 55 && r.k === 1 && r.e && r.title === "bane_str" && r.t > before,
      JSON.stringify({ loaded, before, r }));
  }
}
