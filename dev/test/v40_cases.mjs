// v40 cases, run from state_test.mjs with the "gates" flag.
// Boss spoils. The whole feature is a DERIVED read of S.m.kills -- there is no trophy field in the save --
// so these cases exist to prove the derivation holds at the three places a second copy of the state would
// have drifted: the kill, the undo of the kill, and the undo of a sibling quest while the boss is dead.
// Case 6 guards the other failure mode: a <use> pointing at a missing <symbol> renders NOTHING, silently.

export async function runV40({ ev, boot, click, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  // read the rendered Trophies screen rather than the state, so a broken template is caught too
  const rows = async () => { await click(`[data-t="trophies"]`);
    return ev(`(()=>[...document.querySelectorAll(".relic.spoil")].map(r=>({
      none:r.classList.contains("none"),
      lk:!!r.querySelector(".sp.lk"), shine:!!r.querySelector(".sp.rb .sweep"),
      n:(r.querySelector(".rn")||{}).textContent||"",
      name:r.querySelector("b").textContent})))()`); };

  // 1. nothing killed yet: five rows, every one a locked silhouette with no shine
  {
    await boot(KEY, { ...base, m: { miles: 0 } });
    const r = await rows(), n = await ev(`__ascend.S&&(()=>0)()`);
    check("no bosses killed: all five spoils render as locked silhouettes, none shining",
      r.length === 5 && r.every(x => x.none && x.lk && !x.shine && x.n === ""),
      JSON.stringify({ len: r.length, r: r.map(x => [x.none, x.lk, x.shine]) }));
  }

  // 2. kill the str boss: exactly that spoil unlocks, and it is the only one
  {
    await boot(KEY, { ...base, lvl: 5, boss: 10, bossStat: "str", bossDown: false, m: { miles: 0 } });
    await raw(`[data-q="str"]`); await shut();
    const k = await S(`({down:S.bossDown,kills:S.m.kills})`);
    const r = await rows();
    const got = r.filter(x => !x.none);
    check("killing the Iron Warden takes exactly one spoil, shining, counted x1",
      k.down && got.length === 1 && got[0].name === "Warden's Gear Tooth" && got[0].shine
      && !got[0].lk && got[0].n.includes("1") && r.filter(x => x.none).length === 4,
      JSON.stringify({ k, got, locked: r.filter(x => x.none).length }));
  }

  // 3. undo the killing blow: the spoil goes back with the kill, with no code of its own to do it
  {
    await boot(KEY, { ...base, lvl: 5, boss: 10, bossStat: "str", bossDown: false, m: { miles: 0 } });
    await raw(`[data-q="str"]`); await shut();
    const before = (await rows()).filter(x => !x.none).length;
    await click(`[data-t="home"]`);
    await raw(`[data-q="str"]`); await shut();
    const after = await rows();
    check("undoing the killing blow returns the spoil with the kill",
      before === 1 && after.every(x => x.none && x.lk),
      JSON.stringify({ before, after: after.map(x => x.none) }));
  }

  // 4. the v37 sibling-caller bug class: undoing some OTHER quest while the boss is dead must not
  // strip a legitimately taken spoil
  {
    await boot(KEY, { ...base, lvl: 5, boss: 10, bossStat: "str", bossDown: false, m: { miles: 0 } });
    await raw(`[data-q="str"]`); await shut();
    const other = await ev(`(()=>{const q=__ascend.S.quests.find(x=>x.s!=="str");return q&&q.id})()`);
    await raw(`[data-q="${other}"]`); await shut();   // complete a different quest
    await raw(`[data-q="${other}"]`); await shut();   // and undo it
    const r = await rows(), k = await S(`(S.m.kills||{}).str`);
    check("undoing an unrelated quest while the boss is dead leaves the spoil standing",
      k === 1 && r.filter(x => !x.none).length === 1 && !r.find(x => !x.none).lk,
      JSON.stringify({ other, k, got: r.filter(x => !x.none).length }));
  }

  // 5. the spoil survives a reload on the OLD storage key -- proof the feature needed no save-format bump
  {
    await boot(KEY, { ...base, lvl: 5, m: { miles: 0, kills: { vit: 2 } } });
    const r = await rows();
    const got = r.filter(x => !x.none);
    check("a spoil restored from S.m.kills survives a reload with no new save field",
      got.length === 1 && got[0].name === "Wraith's Hollow Eye" && got[0].n.includes("2"),
      JSON.stringify({ got }));
  }

  // 6. every <use> resolves. A href at a missing id throws nothing and draws nothing, so assert the
  // symbol is in the document AND that the rendered box is non-empty.
  {
    await boot(KEY, { ...base, lvl: 5, m: { miles: 0, kills: { str: 1, vit: 1 } } });
    await click(`[data-t="trophies"]`);
    const art = await ev(`(()=>[...document.querySelectorAll(".relic.spoil .sp use")].map(u=>{
      const id=(u.getAttribute("href")||"").slice(1), sym=document.getElementById(id);
      let w=0,h=0; try{const b=u.getBBox();w=Math.round(b.width);h=Math.round(b.height)}catch(e){}
      return {id,sym:!!sym&&sym.tagName.toLowerCase()==="symbol",w,h}}))()`);
    const uses = art.filter(a => a.id.startsWith("sp-"));
    const earned = uses.filter(a => a.id === "sp-warden" || a.id === "sp-wraith");
    check("every spoil symbol resolves and draws, on the earned AND the locked branch",
      new Set(uses.map(a => a.id)).size === 5 && earned.length === 4 // 2 earned rows x (mask + visible)
      && uses.length === 7 && uses.every(a => a.sym && a.w > 0 && a.h > 0),
      JSON.stringify({ n: uses.length, earned: earned.length, uses }));
  }
}
