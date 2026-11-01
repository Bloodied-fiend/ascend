// Session-16 audit fixes, run from state_test.mjs with the "gates" flag. Runs LAST in that chain because
// case 3 installs a fetch stub on every new document; it is removed before returning.
//   1. S.bkill is cleared at rollover, so re-doing yesterday's killing quest today and undoing it can't revive the boss
//   2. a failed localStorage write does not advance S.rev, so the next pull() doesn't adopt the older save over the change
//   3. "Delete my party data" stops the open-time check-in (op:"ping") until the player creates/joins again
export async function runAudit({ ev, boot, check, KEY, base, wait, send }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };

  // 1. kill the boss today, roll the day over, complete the same quest again and undo it: the kill stands
  {
    await boot(KEY, { ...base, lvl: 5, boss: 10, bossStat: "str", bossDown: false, m: { miles: 0 } });
    await raw(`[data-q="str"]`); await shut();
    const k0 = await S(`({down:S.bossDown,bkill:!!S.bkill,kills:(S.m.kills||{}).str})`);
    await ev(`document.querySelector('[data-demo="miss"]').click()`); await wait(600); await shut();
    const roll = await S(`({bkill:S.bkill,down:S.bossDown})`);
    await raw(`[data-q="str"]`); await shut();   // complete again on the new day
    await raw(`[data-q="str"]`); await shut();   // and undo it
    const k1 = await S(`({down:S.bossDown,boss:S.boss,kills:(S.m.kills||{}).str})`);
    check("rollover clears bkill: undoing yesterday's killing quest today leaves the boss dead and the kill counted",
      k0.down && k0.bkill && k0.kills === 1 && roll.bkill === null && roll.down && k1.down && k1.boss === 0 && k1.kills === 1,
      JSON.stringify({ k0, roll, k1 }));
  }

  // 2. the write for one change fails (storage full); the next change must not throw the first one away
  {
    await boot(KEY, base);
    const [qa, qb] = base.quests.map(q => q.id);
    const rev0 = await S(`S.rev`);
    await ev(`(()=>{const o=Storage.prototype.setItem;window.__setItem=o;Storage.prototype.setItem=function(k,v){if(k===${JSON.stringify(KEY)})throw new DOMException("full","QuotaExceededError");return o.call(this,k,v)}})()`);
    await raw(`[data-q="${qa}"]`); await shut();
    const mid = await S(`({rev:S.rev,a:!!S.done[${JSON.stringify(qa)}]})`);
    await ev(`Storage.prototype.setItem=window.__setItem`);
    await raw(`[data-q="${qb}"]`); await shut();
    const mem = await S(`[!!S.done[${JSON.stringify(qa)}],!!S.done[${JSON.stringify(qb)}]]`);
    const disk = await ev(`(()=>{const d=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).done;return [!!d[${JSON.stringify(qa)}],!!d[${JSON.stringify(qb)}]]})()`);
    check("a failed save keeps the old rev, and the next change keeps the unsaved one (memory and disk)",
      mid.a && mid.rev === rev0 && mem.join() === "true,true" && disk.join() === "true,true",
      JSON.stringify({ rev0, mid, mem, disk }));
  }

  // 3. party API stubbed on every load; the stub records each op the app sends
  {
    const stub = `(()=>{window.__ops=[];const f=window.fetch;window.fetch=function(u,o){if(String(u).includes("neon.tech")){try{window.__ops.push(JSON.parse(o.body).op)}catch(e){}
      return Promise.resolve(new Response(JSON.stringify({parties:[]}),{status:200,headers:{"content-type":"application/json"}}))}return f.apply(this,arguments)}})()`;
    const { result: { identifier } } = await send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
    // the app checks in on visibilitychange (not on a cold load), so each load is followed by one
    const show = async () => { await ev(`document.dispatchEvent(new Event("visibilitychange"))`); await wait(300); };
    const reload = async () => { await send("Page.reload"); await wait(1500); await shut(); await show(); };
    const create = async () => { await raw(`[data-t="quests"]`); await shut(); await raw(`[data-party="create"]`);
      await ev(`(()=>{document.querySelector("#pname2").value="Stub Squad";document.querySelector('#sysA [data-act="0"]').click()})()`); await wait(800); await shut(); };
    try {
      await boot(KEY, base); await show();
      const opened = await ev(`window.__ops.slice()`);
      await create();
      await raw(`[data-t="me"]`); await shut();
      await raw(`[data-pforget]`);
      await ev(`document.querySelector('#sysA [data-act="1"]').click()`); await wait(800); await shut();
      const flag = await ev(`localStorage.getItem("ascend-no-ping")`);
      await reload();
      const afterDel = await ev(`window.__ops.slice()`);
      await create();
      const flag2 = await ev(`localStorage.getItem("ascend-no-ping")`);
      await reload();
      const again = await ev(`window.__ops.slice()`);
      check("delete party data stops the check-in across reloads; creating a party again turns it back on",
        opened.includes("ping") && flag === "1" && !afterDel.includes("ping") && flag2 === null && again.includes("ping"),
        JSON.stringify({ opened, flag, afterDel, flag2, again }));
    } finally { await send("Page.removeScriptToEvaluateOnNewDocument", { identifier }); await ev(`localStorage.clear()`); }
  }
}
