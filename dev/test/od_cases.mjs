// Overdrive cases (log past the target), run from state_test.mjs with the "gates" flag.
export async function runOD({ ev, boot, check, KEY, base, wait }) {
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(250); };
  const step = async (id, dir, n = 1) => { for (let i = 0; i < n; i++) await raw(`[data-step="${id}:${dir}"]`); };
  // 1. Read 20 PG (step 5, +15 XP): 30 pages = +50% -> tier 1; 40 = tier 2 (cap); back to 25 takes both back; uncheck reverts everything
  {
    await boot(KEY, { ...base, lvl: 5, xp: 0 });
    await raw(`[data-qopen="read"]`);
    await step("read", 1, 4); // 20 -> done
    const done = await S(`({d:!!S.done.read,xp:S.xp,t:S.train.int,c:S.cnt.read})`);
    await step("read", 1, 2); // 30
    const t1 = await S(`({xp:S.xp,t:S.train.int,od:S.od.read||0,c:S.cnt.read})`);
    await step("read", 1, 4); // tries 50, capped at 40
    const t2 = await S(`({xp:S.xp,t:S.train.int,od:S.od.read||0,c:S.cnt.read})`);
    await step("read", -1, 3); // 25
    const back = await S(`({xp:S.xp,t:S.train.int,od:S.od.read||0,c:S.cnt.read})`);
    check("overdrive tiers pay +25% XP / +1 training, cap 2x, step back reverts",
      done.d && done.c === 20 && t1.od === 1 && t1.xp === done.xp + 4 && t1.t === done.t + 1 && t1.c === 30 &&
      t2.od === 2 && t2.c === 40 && t2.xp === done.xp + 8 && back.od === 0 && back.xp === done.xp && back.t === done.t && back.c === 25,
      JSON.stringify({ done, t1, t2, back }));
    await step("read", 1, 3); // 40 again
    await raw(`[data-q="read"]`); // uncheck
    const un = await S(`({d:!!S.done.read,od:S.od.read||0,xp:S.xp,debt:S.debt,t:S.train.int})`);
    check("unchecking an overdriven quest takes all of it back", !un.d && un.od === 0 && un.t === done.t - 1, JSON.stringify(un));
  }
  // 2. yes/no quests can't be overdone; distance steps by 0.5 and a timed run records the real distance
  {
    await boot(KEY, { ...base, lvl: 5, xp: 0, m: { miles: 0 } });
    await raw(`[data-qopen="sleep"]`); await step("sleep", 1, 1); // done; the stepper closes (no overdrive)
    await raw(`[data-qopen="sleep"]`); await step("sleep", 1, 2); // reopened: + does nothing past 1
    const sl = await S(`S.cnt.sleep`);
    await raw(`[data-qopen="run"]`); await step("run", 1, 6); // 0.5 x 6 = 3 MI (target 2)
    await ev(`document.querySelector("#tin-run").value="27:00"`); await raw(`[data-tlog="run"]`);
    const r = await S(`({c:S.cnt.run,od:S.od.run||0,n:S.runs[S.runs.length-1].n,mi:S.m.miles})`);
    check("lights-out caps at 1; run steps 0.5 and logs 3 MI", sl === 1 && r.c === 3 && r.od === 1 && r.n === 3 && r.mi === 3, JSON.stringify({ sl, r }));
  }
  // 3. distance targets adapt in half steps: a strong week 2 -> 2.5 MI, a weak week 2 -> 1.5 MI
  for (const [hit, want] of [[1, 2.5], [0, 1.5]]) {
    const days = await ev(`(()=>{const d=new Date(Date.now()-4*3600e3),k=x=>{const y=new Date(d);y.setDate(y.getDate()+x);return y.getFullYear()+"-"+String(y.getMonth()+1).padStart(2,"0")+"-"+String(y.getDate()).padStart(2,"0")};return [k(-1),...[2,3,4,5,6,7].map(i=>k(-i))]})()`);
    const qlog = Object.fromEntries(days.slice(1).map(k => [k, { run: hit }]));
    const done = hit ? Object.fromEntries(base.quests.map(q => [q.id, 1])) : {};
    await boot(KEY, { ...base, day: days[0], done, qlog, adj: {} });
    const n = await S(`S.quests.find(q=>q.id==="run").n`);
    check(`distance adapts in 0.5 steps (${hit ? "strong" : "weak"} week -> ${want})`, n === want, n);
  }
  // 4. editor takes half-mile targets; the penalty rules are one tap away before any miss
  {
    await boot(KEY, base);
    await raw(`[data-edit]`); await raw(`[data-qe="edit:run"]`);
    await ev(`document.querySelector("#qe-n").value="2.5"`); await raw(`[data-qe="save"]`);
    const n = await S(`S.quests.find(q=>q.id==="run").n`);
    await ev(`(()=>{for(let i=0;i<4;i++)__ascend.closeNote()})()`); await wait(200);
    await raw(`[data-penrules]`);
    const title = await ev(`document.querySelector("#sysT").textContent`);
    check("editor saves 2.5 MI; penalty rules open from Home", n === 2.5 && title === "How penalties work", JSON.stringify({ n, title }));
  }
}
