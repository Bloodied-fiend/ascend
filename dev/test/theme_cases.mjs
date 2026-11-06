// Theme Vault: gating, migration, the ceremony in the notification queue, and every path a theme can go stale.
export async function runThemes({ ev, boot, base, check, KEY, wait, send }) {
  const CER = 2800; // the ceremony is 2.6 s
  const save = o => ({ ...JSON.parse(JSON.stringify(base)), ap: { ...base.ap, pn: 9999 }, ...o });
  const load = async (o, skin) => {
    const sv = save(o); if (o.thSeen === undefined) delete sv.thSeen;
    await ev(`localStorage.clear();localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(sv))});${skin ? `localStorage.setItem("ascend-skin",${JSON.stringify(skin)});` : ""}`);
    await send("Page.reload"); await wait(1500);
  };
  const st = () => ev(`(()=>{const o=document.getElementById("ov");return {skin:document.documentElement.dataset.skin,th:document.documentElement.dataset.th||null,saved:localStorage.getItem("ascend-skin"),seen:__ascend.S.thSeen,lvl:__ascend.S.lvl,chip:o.hidden?null:document.getElementById("sysC").textContent,title:o.hidden?null:document.getElementById("sysT").textContent,cer:__ascend.cerOn,un:document.getElementById("phone").classList.contains("unlocking")}})()`);
  const esc = () => ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))`);
  const press = i => ev(`document.querySelector('#sysA [data-act="${i}"]').click()`);
  const drain = async () => { for (let i = 0; i < 8; i++) { await ev(`__ascend.closeNote(-1)`); await wait(40); } };
  const toNext = lvl => `(()=>{const S=__ascend.S;S.lvl=${lvl};S.xp=0;__ascend.gain(100000)})()`; // far more XP than any one rank

  // migration
  await load({ lvl: 30, thSeen: undefined });
  let s = await st();
  check("a save from before the vault gets its open themes quietly, with no ceremony", s.seen === 3 && !s.cer && s.chip !== "[ THEME UNLOCKED ]" && s.skin === "hunter", JSON.stringify(s));
  for (const bad of ["x", 99, -1, 2.5]) {
    await load({ lvl: 30, thSeen: bad }); s = await st();
    if (s.seen !== 3) { check("a corrupt thSeen is ignored", false, JSON.stringify({ bad, s })); break; }
  }
  check("a corrupt thSeen is ignored (x, 99, -1, 2.5)", s.seen === 3, JSON.stringify(s));
  await load({ lvl: 12, thSeen: 4 }); s = await st();
  check("a restored backup caps thSeen at its own level, so the theme can be earned again", s.seen === 1, JSON.stringify(s));

  // gating
  await load({ lvl: 30, thSeen: 3 });
  await ev(`__ascend.S.tab="me";__ascend.render()`); await wait(300);
  const rows = await ev(`[...document.querySelectorAll(".vault .skin")].map(b=>[b.dataset.s,b.classList.contains("lk")])`);
  check("Profile lists five vault themes, locked past the player's rank", rows.length === 5 && rows.filter(r => r[1]).length === 2 && rows[3][0] === "monarch" && rows[3][1], JSON.stringify(rows));
  await ev(`document.querySelector('.vault [data-s="monarch"]').click()`); await wait(100); s = await st();
  check("tapping a locked theme does nothing but say so", s.skin === "hunter" && s.saved !== "monarch", JSON.stringify(s));
  await ev(`document.querySelector('.vault [data-s="bloodmoon"]').click()`); await wait(200); s = await st();
  const shown = await ev(`[getComputedStyle(document.querySelector(".thplate")).backgroundImage.includes("bloodmoon"),getComputedStyle(document.querySelector(".thgl")).display,__ascend.th.state().particles>0]`);
  check("tapping an earned theme equips it, with plate, weather canvas and particles", s.skin === "bloodmoon" && s.th === "1" && s.saved === "bloodmoon" && shown[0] && shown[1] === "block" && shown[2], JSON.stringify({ s, shown }));
  await ev(`document.querySelector('.themes [data-s="ember"]').click()`); await wait(150); s = await st();
  const off = await ev(`[getComputedStyle(document.querySelector(".thgl")).display,__ascend.th.state().cur,__ascend.th.state().raf]`);
  check("a free theme turns the weather off entirely", s.skin === "ember" && s.th === null && off[0] === "none" && off[1] === null && off[2] === false, JSON.stringify({ s, off }));

  // stale themes
  await load({ lvl: 5, thSeen: 0 }, "whiteout"); s = await st();
  check("a locked theme in storage falls back to hunter at boot", s.skin === "hunter" && s.saved === "hunter", JSON.stringify(s));
  await load({ lvl: 30, thSeen: 3 }, "bloodmoon"); s = await st();
  const low = save({ lvl: 5, thSeen: 0, rev: "other" });
  await ev(`localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(low))});__ascend.gain(1)`); await wait(300); await drain(); s = await st();
  check("adopting a lower-level save from another tab drops a theme it has not earned", s.lvl === 5 && s.skin === "hunter", JSON.stringify(s));

  // the ceremony
  await load({ lvl: 8, thSeen: 0 });
  await ev(`(()=>{const S=__ascend.S;__ascend.gain(99+8*S.lvl-S.xp)})()`); await wait(300); s = await st();
  check("reaching D-Rank shows the System's windows first, not the ceremony", s.lvl >= 9 && !s.cer && s.chip !== null, JSON.stringify(s));
  for (let i = 0; i < 4 && (await st()).chip; i++) { await esc(); await wait(150); }
  s = await st();
  check("Escape on the rank window still starts the ceremony, previewing the theme without equipping it", s.cer && s.un && s.skin === "mistveil" && s.saved !== "mistveil", JSON.stringify(s));
  await ev(`__ascend.closeNote(-1)`); await wait(50); s = await st();
  check("nothing can close or open over a running ceremony", s.cer && s.un && s.chip === null, JSON.stringify(s));
  await wait(CER); s = await st();
  check("the ceremony ends in the THEME UNLOCKED window and records it", !s.cer && !s.un && s.chip === "[ THEME UNLOCKED ]" && s.title === "Mistveil" && s.seen === 1, JSON.stringify(s));
  await press(1); await wait(200); s = await st();
  check("Later puts the old theme back and leaves storage alone", s.skin === "hunter" && s.saved !== "mistveil" && s.th === null, JSON.stringify(s));
  await ev(`__ascend.gain(1)`); await wait(300); s = await st();
  check("a played ceremony does not play again", !s.cer && s.chip !== "[ THEME UNLOCKED ]", JSON.stringify(s));

  await load({ lvl: 8, thSeen: 0 });
  await ev(`(()=>{const S=__ascend.S;__ascend.gain(99+8*S.lvl-S.xp)})()`); await wait(300);
  for (let i = 0; i < 4 && (await st()).chip; i++) { await esc(); await wait(150); }
  await wait(CER); await press(0); await wait(200); s = await st();
  check("Equip keeps the theme and saves it", s.skin === "mistveil" && s.saved === "mistveil" && s.th === "1", JSON.stringify(s));

  await load({ lvl: 8, thSeen: 0 });
  await ev(`(()=>{const S=__ascend.S;__ascend.gain(99+8*S.lvl-S.xp)})()`); await wait(300);
  for (let i = 0; i < 4 && (await st()).chip; i++) { await esc(); await wait(150); }
  await wait(CER); await esc(); await wait(200); s = await st();
  check("Escape on THEME UNLOCKED counts as Later, never stranding the preview", s.skin === "hunter" && s.saved !== "mistveil", JSON.stringify(s));

  // jumps, resume, the ranks past S
  await load({ lvl: 18, thSeen: 0 });
  await wait(300); s = await st();
  const seenFirst = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 12; j++) { s = await st(); if (s.chip === "[ THEME UNLOCKED ]") break; if (s.chip) await esc(); await wait(s.cer ? 400 : 150); }
    if (s.chip !== "[ THEME UNLOCKED ]") break; seenFirst.push(s.title); await press(1); await wait(200); await send("Page.reload"); await wait(1500); // what is owed must rebuild from the save, not from memory
  }
  s = await st();
  check("a save that skipped ranks plays each owed theme in order, and resumes after a reload", seenFirst.join() === "Mistveil,Abyss" && s.seen === 2 && s.skin === "hunter", JSON.stringify({ seenFirst, s }));
  await load({ lvl: 50, thSeen: 5 });
  await ev(`(()=>{const S=__ascend.S;__ascend.gain(99+8*S.lvl-S.xp)})()`); await wait(300);
  for (let i = 0; i < 4 && (await st()).chip; i++) { await esc(); await wait(150); }
  s = await st();
  check("ranks past S play no ceremony", s.lvl >= 51 && !s.cer && s.seen === 5, JSON.stringify(s));

  // reduced motion: no ceremony, straight to the window, and the weather holds still
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await load({ lvl: 9, thSeen: 0 }); await wait(200);
  for (let i = 0; i < 4 && (await st()).chip !== "[ THEME UNLOCKED ]"; i++) { await esc(); await wait(150); }
  s = await st();
  const still = await ev(`__ascend.th.state().raf`);
  check("reduced motion skips the ceremony and runs no animation loop", s.chip === "[ THEME UNLOCKED ]" && !s.cer && !s.un && still === false, JSON.stringify({ s, still }));
  await send("Emulation.setEmulatedMedia", { features: [] });

  // shaders, where this Chrome has WebGL
  await load({ lvl: 45, thSeen: 5 }, "whiteout");
  const compiled = await ev(`__ascend.th.compileAll()`), hasGL = await ev(`__ascend.th.state().gl`);
  check("all five weather shaders compile and link", hasGL && compiled.every(c => c[1]), JSON.stringify({ hasGL, compiled }));

  // another tab swaps the save during a ceremony: it must not record or reveal a theme that save has not earned
  await load({ lvl: 9, thSeen: 0 }); await wait(100);
  for (let i = 0; i < 8 && !(await st()).cer; i++) { await ev(`__ascend.closeNote(-1)`); await wait(100); }
  const started = (await st()).cer;
  const lower = save({ lvl: 5, thSeen: 0, rev: "other-tab" });
  await ev(`window.dispatchEvent(new StorageEvent("storage",{key:${JSON.stringify(KEY)},newValue:${JSON.stringify(JSON.stringify(lower))}}))`);
  await wait(CER + 300); s = await st();
  const free = await ev(`[document.getElementById("screen").inert,document.getElementById("tabs").inert,document.getElementById("player").hidden]`);
  check("a save swapped in mid-ceremony cannot unlock what it has not earned, the preview is undone, and the app stays usable", started && s.lvl === 5 && s.seen === 0 && s.chip !== "[ THEME UNLOCKED ]" && s.skin === "hunter" && !s.cer && free.every(x => x === false), JSON.stringify({ started, s, free }));
  await ev(`localStorage.clear()`);
}
