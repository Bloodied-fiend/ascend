// Level curve + Second Awakening cases, run from state_test.mjs with the "gates" flag.
export async function runAwaken({ ev, boot, click, base, check, KEY, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  // 1. reaching Monarch offers the Second Awakening; accepting keeps stats and raises the ceiling
  {
    await boot(KEY, { ...base, lvl: 60, xp: 0, stats: { str: 99, vit: 80, agi: 99, int: 70, per: 60 }, train: { str: 3, vit: 0, agi: 0, int: 0, per: 0 } });
    await ev(`(()=>{const S=__ascend.S;S.xp=572-1;__ascend.render()})()`);
    await raw(`[data-q="str"]`); // +20 XP -> Lv61 Monarch; training 4/4 at the 99 ceiling (raw click: closing notes would press "Awaken")
    const before = await S(`({lvl:S.lvl,str:S.stats.str,awaken:S.awaken})`);
    const offer = await ev(`[...document.querySelectorAll("#sysC")].map(x=>x.textContent).join()`);
    await ev(`(()=>{for(let i=0;i<6;i++){const c=document.querySelector("#sysC").textContent;if(c.includes("SECOND AWAKENING")){document.querySelector('#sysA [data-act="0"]').click();break}__ascend.closeNote()}})()`); await wait(400);
    const after = await S(`({awaken:S.awaken,str:S.stats.str,vit:S.stats.vit})`);
    check("Monarch -> Second Awakening keeps stats", before.lvl === 61 && before.str === 99 && before.awaken === 0 && after.awaken === 1 && after.str === 99 && after.vit === 80, JSON.stringify({ before, after, offer }));
  }
  // 2. after awakening, training goes past 99; a top re-assessment keeps it, a low one is honest
  {
    await boot(KEY, { ...base, lvl: 61, awaken: 1, stats: { str: 120, vit: 99, agi: 99, int: 70, per: 110 }, train: { str: 0, vit: 3, agi: 0, int: 0, per: 0 } });
    await click(`[data-q="sleep"]`);
    const vit = await S(`S.stats.vit`);
    await ev(`(()=>{__ascend.S.test={i:15,a:[4,4,4,1,1,1,4,4,4,4,4,4,4,4,4],r:null};__ascend.S.tab="test";__ascend.render()})()`); await wait(200);
    await ev(`(()=>{__ascend.S.test.i=18;__ascend.render()})()`); await wait(200);
    await raw(`[data-save]`); await ev(`(()=>{for(let i=0;i<6;i++)__ascend.closeNote()})()`);
    const r = await S(`({str:S.stats.str,vit:S.stats.vit,int:S.stats.int,per:S.stats.per})`);
    check("past 99 by training; re-assessment keeps it at top, drops when lower", vit === 100 && r.str === 120 && r.vit < 99 && r.int === 95 && r.per === 110, JSON.stringify({ vit, r }));
  }
}
