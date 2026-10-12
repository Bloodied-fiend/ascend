// Party leaderboard end to end against the LIVE function (needs ALLOW_LOCAL=1 on it), run from state_test.mjs with the "party" flag.
import { randomBytes } from "node:crypto";
export async function runParty({ ev, boot, click, base, check, KEY, wait }) {
  const API = await ev(`(()=>{const m=document.documentElement.outerHTML.match(/PARTY_API="([^"]+)"/);return m&&m[1]})()`);
  const origin = await ev(`location.origin`);
  const api = (key, body) => fetch(API, { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) }).then(r => r.json());
  const S = expr => ev(`(()=>{const S=__ascend.S;return ${expr}})()`);
  await boot(KEY, { ...base, lvl: 12, xp: 40 });
  await click(`[data-t="quests"]`);
  const before = await ev(`({join:!!document.querySelector('[data-party="create"]'),key:!!localStorage.getItem("ascend-party-key")})`);
  await ev(`document.querySelector('[data-party="create"]').click()`); await wait(300);
  await ev(`(()=>{document.querySelector("#pname2").value="Test Squad";document.querySelector('#sysA [data-act="0"]').click()})()`);
  await wait(4000);
  const code = await ev(`(document.querySelector("[data-pshare]")||{}).dataset?.pshare`);
  check("create party from the app (no network before opt-in)", before.join && !before.key && /^[A-HJ-NP-Z2-9]{8}$/.test(code || ""), JSON.stringify({ before, code }));
  const friend = randomBytes(32).toString("hex");
  await api(friend, { op: "join", name: "Friend", code });
  await api(friend, { op: "sync", summary: { lvl: 30, xp: 99999, tier: 3, streak: 9, gates: 4, red: 1, awaken: 0 } });
  await ev(`__ascend.partyBoard()`); await wait(800);
  const rows = await ev(`[...document.querySelectorAll(".plist li")].map(li=>li.querySelector(".pw b").textContent+"|"+li.className)`);
  check("board shows both, ranked by XP, me marked", rows.length === 2 && rows[0].startsWith("Friend") && rows[1].includes("me"), JSON.stringify(rows));
  const exported = await ev(`JSON.stringify(__ascend.S).includes(localStorage.getItem("ascend-party-key"))`);
  check("party key never in progress/backups", exported === false, exported);
  // cleanup through the app's own delete flow, then the friend
  await click(`[data-t="me"]`);
  await ev(`document.querySelector('[data-pforget]').click()`); await wait(300);
  await ev(`document.querySelector('#sysA [data-act="1"]').click()`); await wait(3000);
  const gone = await ev(`({key:localStorage.getItem("ascend-party-key"),cache:localStorage.getItem("ascend-party-cache")})`);
  await api(friend, { op: "forget" });
  check("delete party data clears key + cache", !gone.key && !gone.cache, JSON.stringify(gone));
}
