// Gate + "counts as" cases, run from state_test.mjs with the "gates" flag.
export async function run({ ev, boot, click, base, check, KEY, DK, wait }) {
  const d = await ev(`(()=>{${DK}return [-5,-3,-2,-1,0,1,2,19].reduce((o,i)=>(o[i]=dk(i),o),{})})()`);
  const zero = { str50: 0, agi30: 0, vit30: 0, clear10: 0, miles: 0 };
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  const raw = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(300); };
  const allDone = Object.fromEntries(base.quests.map(q => [q.id, 1]));

  // 1. streak gate: 2 cleared days + clearing today = 3 in a row -> cleared once, reward stands after undo, cooldown till tomorrow
  await boot(KEY, { ...base, gate: { id: "e", start: d[-2], until: d[2], run: 2, failed: false, base: zero } });
  for (const q of base.quests) await click(`[data-q="${q.id}"]`);
  let r = await S(`({g:S.gate,n:S.gateClears.e,cd:S.gateCd})`);
  await click(`[data-q="${base.quests[0].id}"]`);
  const r2 = await S(`({g:S.gate,n:S.gateClears.e})`);
  check("E gate clears on the 3rd straight clear; undo doesn't reopen it", r.g === null && r.n === 1 && r.cd === d[1] && r2.g === null && r2.n === 1, JSON.stringify(r));
  await click(`[data-t="quests"]`);
  check("no gate can be entered again the same day", await ev(`document.querySelectorAll("[data-gate]").length`) === 0);

  // 2. entry: C-Rank player sees Enter on E, D, C only; entering D snapshots lifetime miles
  await boot(KEY, { ...base, lvl: 20, m: { miles: 5 } });
  await click(`[data-t="quests"]`);
  const ids = await ev(`[...document.querySelectorAll(".gpin:not(.lock)")].map(b=>b.dataset.gsel).join()`);
  await raw(`[data-gsel="d"]`); await raw(`[data-gate="d"]`); await raw(`#sysA [data-act="0"]`);
  await ev(`(()=>{if(__ascend.S.gate)__ascend.S.gate.red=false;for(let i=0;i<4;i++)__ascend.closeNote(-1)})()`); // entry rolls a 15% Red Gate; pin it for this case
  r = await S(`({id:S.gate&&S.gate.id,bm:S.gate&&S.gate.base.miles,until:S.gate&&S.gate.until,fair:S.gate&&S.gate.fair})`);
  check("C-Rank sees only D/C/B (3 each); entering D snapshots miles", ids === "d,d2,d3,c,c2,c3,b,b2,b3" && r.id === "d" && r.bm === 5 && r.fair === true, `${ids} ${JSON.stringify(r)}`);

  // 3. timed run adds miles once; re-logging the same run replaces it
  await click(`[data-t="home"]`);
  await raw(`[data-qopen="run"]`);
  await ev(`document.querySelector("#tin-run").value="16:00"`); await click(`[data-tlog="run"]`);
  await ev(`document.querySelector("#tin-run").value="15:00"`); await click(`[data-tlog="run"]`);
  r = await S(`({mi:S.m.miles,runs:S.runs.length,mk:S.runs[0]&&S.runs[0].m})`);
  check("logged run counts its miles once (re-log replaces)", r.mi === 7 && r.runs === 1 && r.mk === 1, JSON.stringify(r));

  // 4. reaching 10 miles inside the gate clears it on the next action
  await ev(`__ascend.S.gate.base.miles=__ascend.S.m.miles-10`);
  await click(`[data-t="quests"]`);
  r = await S(`({g:S.gate,n:S.gateClears.d})`);
  check("D gate clears at 10 miles", r.g === null && r.n === 1, JSON.stringify(r));

  // 5. strict gate: an unopened/missed day fails it at rollover
  await boot(KEY, { ...base, day: d[-1], gate: { id: "a", start: d[-1], until: d[19], run: 0, failed: false, base: zero } });
  r = await S(`({g:S.gate,cd:S.gateCd,n:S.gateClears.a||0})`);
  check("strict gate closes after a missed day", r.g === null && r.cd === d[1] && r.n === 0, JSON.stringify(r));

  // 6. time runs out: closed, nothing awarded
  await boot(KEY, { ...base, day: d[-1], done: allDone, gate: { id: "e", start: d[-5], until: d[-1], run: 0, failed: false, base: zero } });
  r = await S(`({g:S.gate,n:S.gateClears.e||0})`);
  check("expired gate closes without reward", r.g === null && r.n === 0, JSON.stringify(r));

  // 7. the last day of the window is counted before the gate expires
  await boot(KEY, { ...base, day: d[-1], done: allDone, gate: { id: "e", start: d[-3], until: d[-1], run: 2, failed: false, base: zero } });
  r = await S(`({g:S.gate,n:S.gateClears.e||0})`);
  check("clear on the last day counts before expiry", r.g === null && r.n === 1, JSON.stringify(r));

  // 8. a damaged gate is dropped alone
  await boot(KEY, { ...base, lvl: 9, gate: { id: "zz", start: "x" } });
  r = await S(`({g:S.gate,lvl:S.lvl})`);
  check("damaged gate dropped, rest of save loads", r.g === null && r.lvl === 9, JSON.stringify(r));

  // 9. "counts as" survives a rename, can be cleared, and can't be given to two quests
  await boot(KEY, base);
  await raw(`[data-edit]`); await raw(`[data-qe="edit:read"]`);
  await ev(`document.querySelector("#qe-q").value="Read books"`); await raw(`[data-qe="save"]`);
  const a1 = await S(`S.quests.find(q=>q.id==="read").ach`);
  await raw(`[data-qe="edit:med"]`);
  const dis = await ev(`document.querySelector('#qe-a option[value="agi30"]').disabled`);
  await raw(`[data-qe="back"]`); await raw(`[data-qe="edit:read"]`);
  await ev(`document.querySelector("#qe-a").value=""`); await raw(`[data-qe="save"]`);
  const a2 = await S(`S.quests.find(q=>q.id==="read").ach`);
  check("counts-as kept on rename, clearable, unique", a1 === "int40" && dis === true && a2 === null, `${a1} ${dis} ${a2}`);
}

// Red Gate cases (appended): sealed, goals x1.5 capped per day, double XP, penalty on timeout
export async function runRed({ ev, boot, click, base, check, KEY, DK, wait }) {
  const d = await ev(`(()=>{${DK}return [-5,-1,0,1,2,3,4,6,13].reduce((o,i)=>(o[i]=dk(i),o),{})})()`);
  const zero = { str50: 0, agi30: 0, vit30: 0, clear10: 0, miles: 0 };
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  // 1. red D gate needs 15 miles, not 10; no retreat button; clear pays 200 XP
  await boot(KEY, { ...base, lvl: 9, xp: 0, m: { miles: 0 }, gate: { id: "d", start: d[0], until: d[6], run: 0, failed: false, red: true, base: zero } });
  await click(`[data-t="quests"]`);
  const ui = await ev(`({leave:!!document.querySelector("[data-gleave]"),label:document.querySelector(".gpin.red .gst2")?.textContent})`);
  await ev(`__ascend.S.m.miles=12`); await click(`[data-t="quests"]`);
  const mid = await S(`!!S.gate`);
  await ev(`__ascend.S.m.miles=15`); await click(`[data-t="quests"]`);
  const r = await S(`({g:S.gate,lvl:S.lvl,xp:S.xp,red:S.m.red})`);
  check("red gate: sealed, 1.5x goal, double XP", !ui.leave && ui.label === "RED" && mid && r.g === null && r.lvl === 10 && r.xp === 36 && r.red === 1, JSON.stringify({ ui, mid, r }));
  // 2. red gate timing out assigns a Penalty Quest
  await boot(KEY, { ...base, day: d[-1], penalty: null, done: Object.fromEntries(base.quests.map(q => [q.id, 1])), gate: { id: "e", start: d[-5], until: d[-1], run: 0, failed: false, red: true, fair: true, base: zero } });
  const r2 = await S(`({g:S.gate,pen:!!S.penalty})`);
  check("red gate timeout -> Penalty Quest", r2.g === null && r2.pen, JSON.stringify(r2));
  // 3. per-day goals leave one spare day: red B (10 nights in 14 days) -> 13, not 15
  const cap = await ev(`(()=>{const S=__ascend.S;S.lvl=25;S.gate={id:"b",start:"${d[0]}",until:"${d[13]}",run:0,failed:false,red:true,base:${JSON.stringify(zero)}};__ascend.render();return 1})()`);
  await click(`[data-t="quests"]`); await ev(`document.querySelector('[data-gsel="b"]').click()`); await wait(300);
  const t = await ev(`document.querySelector(".gdet .gobj b")?.textContent`);
  check("red goals leave one spare day", t === "0 / 13", t);
  // 4. a red chain Gate shows its raised goal and survives a Rest Day: red E needs 4 of 5 days, and says so
  await boot(KEY, { ...base, gate: { id: "e", start: d[0], until: d[4], run: 0, failed: false, red: true, base: zero } });
  await click(`[data-t="quests"]`);
  const txt = await ev(`document.querySelector(".gdet .gobj")?.textContent`);
  check("red Gate objective text shows the raised goal", txt && txt.includes("4 days in a row") && txt.includes("0 / 4"), txt);
  // 5. still winnable with exactly enough days: stays open
  await boot(KEY, { ...base, gate: { id: "e", start: d[-1], until: d[3], run: 0, failed: false, red: true, base: zero } });
  await click(`[data-t="quests"]`);
  const open = await S(`({g:!!S.gate,pen:!!S.penalty})`);
  check("Gate with exactly enough days left stays open", open.g && !open.pen, JSON.stringify(open));
  // 6. one day too few: a red Gate closes now, with its Penalty Quest and tomorrow's cooldown
  await boot(KEY, { ...base, penalty: null, gate: { id: "e", start: d[-1], until: d[2], run: 0, failed: false, red: true, fair: true, base: zero } });
  await click(`[data-t="quests"]`);
  const dead =await S(`({g:S.gate,pen:!!S.penalty,cd:S.gateCd,n:S.gateClears.e||0})`);
  check("unwinnable red Gate closes early with its penalty", dead.g === null && dead.pen && dead.cd === d[1] && dead.n === 0, JSON.stringify(dead));
  // 6b. a red Gate entered before 1.054 closes the same way with its penalty waived; the fair mark survives a reload
  await boot(KEY, { ...base, penalty: null, gate: { id: "e", start: d[-1], until: d[2], run: 0, failed: false, red: true, base: zero } });
  await click(`[data-t="quests"]`);
  const old = await S(`({g:S.gate,pen:!!S.penalty,cd:S.gateCd})`);
  await boot(KEY, { ...base, gate: { id: "e", start: d[0], until: d[4], run: 0, failed: false, red: true, fair: true, base: zero } });
  const kept = await S(`S.gate&&S.gate.fair`);
  check("old red Gate closes with its penalty waived; fair mark is kept", old.g === null && !old.pen && old.cd === d[1] && kept === true, JSON.stringify({ old, kept }));
  // 7. an unwinnable normal Gate closes with no penalty; timed miles never count as unwinnable
  await boot(KEY, { ...base, penalty: null, gate: { id: "e", start: d[-1], until: d[1], run: 0, failed: false, base: zero } });
  await click(`[data-t="quests"]`);
  const dead2 = await S(`({g:S.gate,pen:!!S.penalty})`);
  await boot(KEY, { ...base, lvl: 9, m: { miles: 0 }, gate: { id: "d", start: d[-5], until: d[0], run: 0, failed: false, base: zero } });
  await click(`[data-t="quests"]`);
  const miles = await S(`!!S.gate`);
  check("unwinnable normal Gate closes with no penalty; miles Gate stays open", dead2.g === null && !dead2.pen && miles, JSON.stringify({ dead2, miles }));
  // 8. an active Gate outside the rank window keeps a pin and can be selected
  await boot(KEY, { ...base, lvl: 33, gate: { id: "c", start: d[0], until: d[6], run: 0, failed: false, base: { ...zero, int40: 0, per100: 0, water25: 0 } } });
  await click(`[data-t="quests"]`);
  const far = await ev(`({pin:!!document.querySelector('.gpin.active[data-gsel="c"]'),pins:document.querySelectorAll(".gpin").length,name:document.querySelector(".gdet .systitle")?.textContent})`);
  check("active Gate outside the rank window keeps its map pin", far.pin && far.pins === 9 && far.name === "Iron Mines", JSON.stringify(far));
}
