// Titles cases, run from state_test.mjs with the "gates" flag.
export async function runTitles({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const days = await ev(`(()=>{const d=new Date(Date.now()-4*3600e3),k=x=>{const y=new Date(d);y.setDate(y.getDate()+x);return y.getFullYear()+"-"+String(y.getMonth()+1).padStart(2,"0")+"-"+String(y.getDate()).padStart(2,"0")};return [k(0),k(-1)]})()`);
  // 1. real data already earned it: popup on open, Equip shows it on Home/Status
  {
    await ev(`localStorage.clear()`);
    const save = { ...base, gateClears: { e: 3, d: 2 } };
    await ev(`localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(save))})`);
    await ev(`location.reload()`); await wait(1800);
    const chip = await ev(`(()=>{for(let i=0;i<6;i++){const c=document.querySelector("#sysC").textContent;if(c.includes("TITLE ACQUIRED"))return document.querySelector("#sysT").textContent;__ascend.closeNote(-1)}return ""})()`);
    await raw(`#sysA [data-act="0"]`);
    await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote(-1)})()`); await wait(200);
    const r = await S(`({t:S.title,earned:!!S.titles.gatebreaker,home:document.querySelector(".cls").textContent})`);
    check("Gatebreaker earned from 5 clears, Equip shows it on Home", chip === "Gatebreaker" && r.t === "gatebreaker" && r.earned && r.home.startsWith("Gatebreaker"), JSON.stringify({ chip, r }));
  }
  // 2. locked titles show progress; earned titles are never revoked
  {
    await boot(KEY, { ...base, m: { miles: 37 }, titles: { redgate: days[1] }, title: "redgate" });
    await raw(`[data-t="me"]`);
    const prog = await ev(`[...document.querySelectorAll(".tcard.lock")].map(c=>c.querySelector("b").textContent+"="+c.querySelector(".tst").textContent).find(s=>s.startsWith("Road Warrior"))`);
    const kept = await S(`({t:S.title,e:!!S.titles.redgate})`);
    check("locked title shows 37 / 100; Red Gate Survivor kept with no Red Gate count", prog === "Road Warrior=37 / 100" && kept.t === "redgate" && kept.e, JSON.stringify({ prog, kept }));
  }
  // 3. One Who Overcame Adversity: penalty cleared, then the 7th straight clear day earns it at rollover
  {
    const done = Object.fromEntries(base.quests.map(q => [q.id, 1]));
    await boot(KEY, { ...base, day: days[1], done, m: { miles: 0, advOn: 1, adv: 6 } });
    const r = await S(`({adv:S.m.adv,e:!!S.titles.adversity})`);
    check("adversity: 7th clear day after a penalty earns it", r.adv === 7 && r.e, JSON.stringify(r));
  }
  // 4. defeating the weekly boss earns its Bane; an unearned equipped title in a save falls back
  {
    await boot(KEY, { ...base, boss: 10, bossStat: "str", bossDown: false, title: "heir" });
    const fallback = await S(`S.title`);
    await raw(`[data-q="str"]`);
    await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote(-1)})()`); await wait(200);
    const r = await S(`({k:(S.m.kills||{}).str,e:!!S.titles.bane_str})`);
    check("boss kill earns Iron Warden's Bane; unearned equipped title falls back", fallback === "awakened" && r.k === 1 && r.e, JSON.stringify({ fallback, r }));
  }
}
