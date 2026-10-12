// Schedule + routine cases, run from state_test.mjs with the "gates" flag.
export async function runSched({ ev, boot, click, base, check, KEY, DK, wait }) {
  const d = await ev(`(()=>{${DK}return {y:dk(-1),wy:(new Date(dk(-1)+"T12:00").getDay()+6)%7,w0:(new Date(dk(0)+"T12:00").getDay()+6)%7}})()`);
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  // 1. yesterday: everything scheduled was done, strength wasn't scheduled -> cleared, no penalty
  {
    const quests = base.quests.map(q => q.id === "str" ? { ...q, days: [(d.wy + 1) % 7] } : q);
    const done = Object.fromEntries(base.quests.filter(q => q.id !== "str").map(q => [q.id, 1]));
    await boot(KEY, { ...base, quests, day: d.y, done, penalty: null, hist: {} });
    const r = await S(`({h:S.hist[${JSON.stringify(d.y)}],pen:!!S.penalty,logged:"str" in (S.qlog[${JSON.stringify(d.y)}]||{})})`);
    check("unscheduled quest can't be missed", r.h === 1 && !r.pen && !r.logged, JSON.stringify(r));
  }
  // 2. a day with nothing scheduled is neutral (like a Rest Day)
  {
    const quests = base.quests.map(q => ({ ...q, days: [] }));
    await boot(KEY, { ...base, quests, day: d.y, done: {}, penalty: null, hist: {} });
    const r = await S(`({h:S.hist[${JSON.stringify(d.y)}],pen:!!S.penalty})`);
    check("nothing scheduled -> neutral day", r.h === 2 && !r.pen, JSON.stringify(r));
  }
  // 3. today: optional quests render apart and don't block the clear
  {
    const quests = base.quests.map(q => q.id === "read" ? { ...q, days: [(d.w0 + 1) % 7] } : q);
    await boot(KEY, { ...base, quests });
    const opt = await ev(`[...document.querySelectorAll(".optq [data-row]")].map(x=>x.dataset.row).join()`);
    for (const q of base.quests.filter(q => q.id !== "read")) await click(`[data-q="${q.id}"]`);
    const r = await S(`({h:S.hist[S.day],read:!!S.done.read})`);
    check("optional quest listed apart, clear without it", opt === "read" && r.h === 1 && !r.read, JSON.stringify({ opt, r }));
  }
  // 4. routine screens -> quests get days, names and targets
  {
    await boot(KEY, base);
    await ev(`(()=>{__ascend.S.test={i:15,a:Array(15).fill(2)};__ascend.S.tab="test";__ascend.render()})()`); await wait(200);
    // lift: turn Wednesday off (default M W F)
    await raw(`[data-dc="lift:2"]`); await raw(`[data-rnext]`);
    await raw(`[data-rk="ruck"]`); await raw(`[data-rnext]`);
    await ev(`(()=>{document.querySelector("#rh-sleep").value="23:00";document.querySelector("#rh-read").value="30"})()`);
    await raw(`[data-rh="water"]`); await raw(`[data-rnext]`); await raw(`[data-save]`);
    await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`);
    const r = await S(`(()=>{const L=S.questsNext||S.quests,f=a=>L.find(q=>q.ach===a);return {str:f("str50").days,run:[f("agi30").q,f("agi30").days],sleep:[f("vit30").q,f("vit30").days],water:f("water25").days,read:f("int40").n}})()`);
    // existing quests with no days run every day, so lift starts as all 7 (Wednesday toggled off) and cardio stays daily
    check("routine -> schedule", JSON.stringify(r) === JSON.stringify({ str: [0, 1, 3, 4, 5, 6], run: ["Run or ruck".replace("Run or ruck","Ruck"), undefined], sleep: ["Lights out by 23:00", undefined], water: [], read: 30 }), JSON.stringify(r));
  }
  // 4b. clicking through the routine changes nothing the player customized (Alastor W1-W4)
  {
    const quests = base.quests.filter(q => q.id !== "med").map(q => q.id === "run" ? { ...q, q: "Swim" } : q.id === "read" ? { ...q, days: [0, 1, 2, 3, 4] } : q);
    await boot(KEY, { ...base, quests });
    await ev(`(()=>{__ascend.S.test={i:15,a:Array(15).fill(2)};__ascend.S.tab="test";__ascend.render()})()`); await wait(200);
    await raw(`[data-rnext]`); await raw(`[data-rnext]`); await raw(`[data-rnext]`); await raw(`[data-save]`);
    await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`);
    const r = await S(`(()=>{const L=S.questsNext||S.quests;return {n:L.length,swim:L.find(q=>q.id==="run").q,read:L.find(q=>q.id==="read").days,med:L.some(q=>q.ach==="per100"),str:L.find(q=>q.id==="str").days}})()`);
    check("routine keeps custom names, partial days, deleted quests", r.n === 5 && r.swim === "Swim" && JSON.stringify(r.read) === "[0,1,2,3,4]" && !r.med && r.str === undefined, JSON.stringify(r));
  }
  // 5. editor day chips save a schedule; all seven = daily
  {
    await boot(KEY, base);
    await raw(`[data-edit]`); await raw(`[data-qe="edit:med"]`);
    await raw(`[data-dc="qd:5"]`); await raw(`[data-dc="qd:6"]`); await raw(`[data-qe="save"]`);
    const r = await S(`S.quests.find(q=>q.id==="med").days`);
    check("editor days saved", JSON.stringify(r) === "[0,1,2,3,4]", JSON.stringify(r));
  }
}
