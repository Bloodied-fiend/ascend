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
}
