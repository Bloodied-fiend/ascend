// Session-17 audit fixes (should-fix items 4, 5, 8, 10, 11 + the open-time check-in), run from
// state_test.mjs with the "gates" flag, after audit_cases. Every party/push call is stubbed in the page:
// nothing here reaches the deployed function.
//   4. returning to the app re-syncs the party board even when this player's summary hasn't changed
//   5. a push subscription the server refused to register is unsubscribed again, not left orphaned
//   8. a save naming a prototype key ("toString") as a stat is rejected instead of crashing boot
//  10. undoing an Overdrive tier at the stat cap does not cost a real stat point
//  11. a tap in the first second of a new day goes to the new day, not yesterday
//   +  the check-in (op "ping") fires on a cold open, not only on a visibility change
export async function runAudit2({ ev, boot, check, KEY, base, wait, send }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(250); };
  const shut = async () => { await ev(`(()=>{for(let i=0;i<8;i++)__ascend.closeNote(-1)})()`); await wait(200); };
  const step = async (id, dir, n = 1) => { for (let i = 0; i < n; i++) await raw(`[data-step="${id}:${dir}"]`); };
  const STATK = Object.keys(base.stats);

  // 8. prototype keys as stat names: the boss stat and a quest's stat
  {
    const quests = base.quests.map((q, i) => i === 0 ? { ...q, s: "constructor" } : q);
    await boot(KEY, { ...base, bossStat: "toString", quests });
    const r = await ev(`(()=>{try{const S=__ascend.S;return {boss:S.bossStat,qs:S.quests.map(q=>q.s),home:!!document.querySelector("[data-q]")}}catch(e){return {err:String(e)}}})()`);
    check("a save with bossStat \"toString\" / a quest stat \"constructor\" loads with real stats and renders Home",
      STATK.includes(r.boss) && r.qs && r.qs.every(s => STATK.includes(s)) && r.home, JSON.stringify(r));
  }

  // 10. Read (Intelligence, 20 PG, step 5): one Overdrive tier is +1 training
  {
    const at = async (int, train) => {
      await boot(KEY, { ...base, lvl: 5, xp: 0, stats: { ...base.stats, int }, train: { ...base.train, int: train } });
      await raw(`[data-qopen="read"]`); await step("read", 1, 4); // 20 = done (+1 training)
      const done = await S(`({s:S.stats.int,t:S.train.int})`);
      await step("read", 1, 2);  // 30 = Overdrive tier 1 (+1 training)
      const od = await S(`({s:S.stats.int,t:S.train.int,od:S.od.read||0})`);
      await step("read", -1, 1); // 25 = tier taken back
      const back = await S(`({s:S.stats.int,t:S.train.int,od:S.od.read||0})`);
      return { done, od, back };
    };
    const cap = await at(99, 2);   // the tier lands on a +1 boundary while already at the cap: nothing to raise
    const up = await at(98, 2);    // same boundary one below the cap: the tier really raises 98 -> 99
    check("at the stat cap, undoing an Overdrive tier keeps the stat (99 stays 99); below it, undo still takes the raise back",
      cap.od.od === 1 && cap.od.s === 99 && cap.back.od === 0 && cap.back.s === 99 && cap.back.t === cap.done.t &&
      up.od.s === 99 && up.back.s === 98 && up.back.t === up.done.t,
      JSON.stringify({ cap, up }));
  }

  // 11. the clock has crossed into a new day but the 1 s tick hasn't noticed yet, and the player taps
  {
    await boot(KEY, base);
    const q = base.quests[0].id;
    const r0 = await ev(`(()=>{const S=__ascend.S,today=S.day,d=new Date(today+"T12:00");d.setDate(d.getDate()-1);
      const y=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      const sv=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));sv.day=y;sv.done={};localStorage.setItem(${JSON.stringify(KEY)},JSON.stringify(sv)); // same rev, so pull() keeps memory
      S.day=y;S.done={};document.querySelector('[data-q="${q}"]').click();return {today,y}})()`);
    await wait(1500); await shut();
    const r = await S(`({day:S.day,done:!!S.done[${JSON.stringify(q)}],ylog:(S.qlog[${JSON.stringify(r0.y)}]||{})[${JSON.stringify(q)}]})`);
    check("a tap just after the day turns is credited to the new day",
      r.day === r0.today && r.done && r.ylog !== 1, JSON.stringify({ ...r0, ...r }));
  }

  // 5. push: permission granted, the browser subscribes, the server refuses to register it
  {
    await boot(KEY, base);
    await ev(`(()=>{window.__unsub=0;const sub={endpoint:"https://push.invalid/x",toJSON:()=>({keys:{p256dh:"p",auth:"a"}}),unsubscribe:async()=>{window.__unsub++;return true}};
      Object.defineProperty(Notification,"permission",{get:()=>"granted",configurable:true});
      Object.defineProperty(navigator,"serviceWorker",{value:{ready:Promise.resolve({pushManager:{subscribe:async()=>sub,getSubscription:async()=>sub}})},configurable:true});
      localStorage.setItem("ascend-party-key","a".repeat(64));
      window.fetch=async()=>new Response(JSON.stringify({error:"server"}),{status:500,headers:{"content-type":"application/json"}});
      const b=document.createElement("button");b.dataset.pushon="1";document.body.appendChild(b);b.click()})()`);
    await wait(800); await shut();
    const r = await ev(`({unsub:window.__unsub})`);
    check("a push subscription the server failed to register is unsubscribed", r.unsub === 1, JSON.stringify(r));
  }

  // 4 + ping: the party API stubbed on every load; the stub records each op the app sends
  {
    const stub = `(()=>{window.__ops=[];window.fetch=function(u,o){if(String(u).includes("neon.tech")){try{window.__ops.push(JSON.parse(o.body).op)}catch(e){}
      return Promise.resolve(new Response(JSON.stringify({parties:[{code:"STUB2345",name:"Stub",iown:true,members:[]}]}),{status:200,headers:{"content-type":"application/json"}}))}return Promise.reject(new Error("offline"))}})()`;
    const { result: { identifier } } = await send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
    try {
      await ev(`localStorage.clear();localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(base))});
        localStorage.setItem("ascend-party-key","b".repeat(64));localStorage.setItem("ascend-party-cache",JSON.stringify({parties:[{code:"STUB2345",name:"Stub",iown:true,members:[]}],at:0}))`);
      await send("Page.reload"); await wait(5000); await shut(); // check-in at 3 s; open-time sync at ~4 s (act() re-debounces the 1.5 s one)
      const opened = await ev(`window.__ops.slice()`);
      const show = async () => { await ev(`document.dispatchEvent(new Event("visibilitychange"))`); await wait(900); };
      await show();
      const back = await ev(`window.__ops.filter(o=>o==="sync").length`);
      check("a cold open checks in (op ping) without any visibility change", opened.includes("ping"), JSON.stringify({ opened }));
      check("returning to the app re-syncs the board even with an unchanged summary",
        opened.filter(o => o === "sync").length === 1 && back === 2, JSON.stringify({ opened, back }));
    } finally { await send("Page.removeScriptToEvaluateOnNewDocument", { identifier }); await ev(`localStorage.clear()`); }
  }
}
