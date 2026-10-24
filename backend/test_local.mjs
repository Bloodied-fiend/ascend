// Exercise the party function locally against a real database.
//   DATABASE_URL=... node test_local.mjs   or   FN_URL=https://... node test_local.mjs   (cleans up what it creates)
import { randomBytes, createHash } from "node:crypto";
const DB = process.env.DATABASE_URL, DB_HOST = DB && new URL(DB).hostname;
const db = async (query, params = []) => {
  const r = await fetch(`https://${DB_HOST}/sql`, { method: "POST",
    headers: { "Neon-Connection-String": DB, "content-type": "application/json" },
    body: JSON.stringify({ query, params }) });
  return r.json();
};
// FN_URL=https://... runs the same checks against the deployed function instead of the local module
const fn = process.env.FN_URL
  ? { fetch: async req => fetch(process.env.FN_URL, { method: req.method, headers: req.headers, body: req.method === "POST" ? await req.text() : undefined }) }
  : (await import("./party.mjs")).default;
const O = "https://bloodied-fiend.github.io";
const call = async (key, body, origin = O) => {
  const r = await fn.fetch(new Request("https://x/", { method: "POST", headers: { origin, authorization: "Bearer " + key, "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(body) }));
  return [r.status, await r.json(), r.headers.get("access-control-allow-origin")];
};
const res = [], check = (n, ok, info) => res.push(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(info)}`);
const A = randomBytes(32).toString("hex"), B = randomBytes(32).toString("hex"), C = randomBytes(32).toString("hex");
const KICK = [], PUSH = [];
const sha = k => createHash("sha256").update(k).digest("hex");
// read the push_subs marks straight from the DB: the only honest evidence of who was selected
const marks = async keys => {
  const { rows } = await db(`select key_hash, last_pass from push_subs where key_hash = any($1::text[])`, [keys.map(sha)]);
  const names = { [sha(keys[0])]: "L", [sha(keys[1])]: "M", [sha(keys[2])]: "N" };
  return rows.map(r => ({ who: names[r.key_hash], last_pass: r.last_pass }));
};
let E = "0".repeat(64);
const sum = (xp, lvl = 5) => ({ title: "Road Warrior", lvl, xp, tier: 0, streak: 3, gates: 1, red: 0, awaken: 0 });
try {
  let [s, b] = await call(A, { op: "create", name: "TestA", party: "Test Squad" });
  const code = b.parties?.[0]?.code;
  check("create party returns 8-char code", s === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(code), [s, b]);
  [s, b] = await call(B, { op: "join", name: "TestB", code: code.toLowerCase() });
  check("join with code (case-insensitive)", s === 200 && b.parties[0].members.length === 2, [s, b]);
  await call(A, { op: "sync", summary: sum(900) });
  [s, b] = await call(B, { op: "sync", summary: sum(1500, 9) });
  const m = b.parties[0].members;
  check("board ranks by total XP, marks me, carries title", m[0].name === "TestB" && m[0].me && m[1].xp === 900 && !m[1].me && m[0].title === "Road Warrior", m);
  [s, b] = await call(C, { op: "board", name: "Stranger" });
  check("stranger sees nothing", s === 200 && b.parties.length === 0, b);
  [s, b] = await call(C, { op: "join", code: "ZZZZZZZZ" });
  check("wrong code -> 404", s === 404, [s, b]);
  [s, b] = await call(A, { op: "sync", summary: { ...sum(10), xp: -5 } });
  check("bad summary rejected", s === 400, [s, b]);
  [s, b] = await call("nothex", { op: "board" });
  check("bad key rejected", s === 401, [s, b]);
  [s, b] = await call(A, { op: "board" }, "https://evil.example");
  check("foreign origin rejected", s === 403, [s, b]);
  const r = await fn.fetch(new Request("https://x/", { method: "OPTIONS", headers: { origin: O } }));
  check("CORS preflight", r.status === 204 && r.headers.get("access-control-allow-origin") === O, r.status);
  [s, b] = await call(A, { op: "sync", name: "<b>x</b>\u0007", summary: sum(950) });
  check("name sanitized", b.parties[0].members.some(x => x.name === "bx/b"), b.parties[0].members.map(x => x.name));
  // ---- leader removes a member (op:"kick") ----
  {
    const L = randomBytes(32).toString("hex"), M1 = randomBytes(32).toString("hex"), M2 = randomBytes(32).toString("hex");
    KICK.push(L, M1, M2);
    let [, kb] = await call(L, { op: "create", name: "Lead", party: "Kick Squad" });
    const kc = kb.parties[0].code;
    await call(M1, { op: "join", name: "Mem1", code: kc });
    [, kb] = await call(M2, { op: "join", name: "Mem2", code: kc });
    check("creator is the leader, members are not",
      kb.parties[0].members.filter(x => x.lead).length === 1 && kb.parties[0].iown === false, kb.parties[0]);
    const [, lb] = await call(L, { op: "board" });
    check("leader's own board says iown", lb.parties[0].iown === true, lb.parties[0]);
    const m1id = lb.parties[0].members.find(x => x.name === "Mem1").id;

    let [s9, b9] = await call(M2, { op: "kick", code: kc, id: m1id });
    check("a member cannot kick", s9 === 403, [s9, b9]);
    [s9, b9] = await call(L, { op: "kick", code: kc, id: lb.parties[0].members.find(x => x.me).id });
    check("the leader cannot kick themselves", s9 === 400, [s9, b9]);
    [s9, b9] = await call(L, { op: "kick", code: kc, id: 999999999 });
    check("kicking a non-member -> 404", s9 === 404, [s9, b9]);

    [s9, b9] = await call(L, { op: "kick", code: kc, id: m1id });
    const names = b9.parties[0].members.map(x => x.name);
    check("leader removes a member", s9 === 200 && !names.includes("Mem1") && names.includes("Mem2"), names);
    const nc = b9.parties[0].code;
    check("removal rotates the invite code", /^[A-HJ-NP-Z2-9]{8}$/.test(nc) && nc !== kc, [kc, nc]);
    const [s10] = await call(M1, { op: "join", code: kc });
    check("the removed member cannot rejoin with the old code", s10 === 404, s10);
    const [, b11] = await call(M1, { op: "board" });
    check("the removed member no longer sees the party", b11.parties.length === 0, b11);
    const [, b12] = await call(M2, { op: "board" });
    check("other members keep their membership through the rotation", b12.parties.length === 1, b12);

    await call(L, { op: "leave", code: nc });
    const [, b13] = await call(M2, { op: "board" });
    check("the party hands on when its leader leaves", b13.parties[0].iown === true, b13.parties[0]);
  }

  // ---- party activity pushes ----
  // These only mean anything with VAPID set: notifyPassed/notifyJoined return early without it, and
  // every assertion below would pass vacuously. The runner asserts that up front.
  {
    const vapidOn = !!process.env.VAPID_PRIVATE;
    check("VAPID is set for this run (otherwise the party-push cases are vacuous)", vapidOn,
      "set VAPID_PRIVATE and VAPID_PUBLIC before running");

    if (vapidOn) {
      const L = randomBytes(32).toString("hex"), M = randomBytes(32).toString("hex"), N = randomBytes(32).toString("hex");
      PUSH.push(L, M, N);
      // endpoints that cannot resolve: sendPush throws, pushMany swallows it, and we assert on the
      // database side effects instead -- which is what actually proves WHO would have been notified
      const fake = k => ({ op: "psub", sub: { endpoint: "https://127.0.0.1:9/" + k, p256dh: "A".repeat(80), auth: "B".repeat(20) }, tz: 0, nudge: 240 });
      let [, pb] = await call(L, { op: "create", name: "Lead", party: "Push Squad" });
      const pc = pb.parties[0].code;
      await call(M, { op: "join", name: "Mid", code: pc });
      await call(N, { op: "join", name: "Top", code: pc });
      for (const k of [L, M, N]) await call(k, fake(k));

      // first syncs: no previous total, so nobody is "passed"
      await call(M, { op: "sync", summary: sum(1000) });
      await call(N, { op: "sync", summary: sum(5000) });
      await call(L, { op: "sync", summary: sum(100) });
      let st = await marks([L, M, N]);
      check("a first sync passes nobody", st.every(x => x.last_pass === null), JSON.stringify(st));

      // L climbs past M (1000) but not N (5000)
      await call(L, { op: "sync", summary: sum(2000) });
      st = await marks([L, M, N]);
      const byKey = Object.fromEntries(st.map(x => [x.who, x.last_pass !== null]));
      check("overtaking one member notifies exactly that member",
        byKey.M === true && byKey.N === false && byKey.L === false, JSON.stringify(byKey));

      // a sync that crosses nobody must not mark anyone new
      await call(N, { op: "sync", summary: sum(5001) });
      const st2 = await marks([L, M, N]);
      const by2 = Object.fromEntries(st2.map(x => [x.who, x.last_pass !== null]));
      check("a sync that crosses nobody notifies nobody new",
        by2.M === true && by2.N === false && by2.L === false, JSON.stringify(by2));
    }
  }

  const D = randomBytes(32).toString("hex");
  [s, b] = await call(D, { op: "create", name: "x".repeat(19) + "\u{1F525}", party: "Emoji" });
  check("name cut through an emoji still works", s === 200, [s, b]);
  await call(D, { op: "forget" });
  E = randomBytes(32).toString("hex");
  [s, b] = await call(E, { op: "sync", summary: sum(5) });
  const [s2] = await call(E, { op: "join", code: "ZZZZZZZZ" });
  const [s3] = await call(E, { op: "bogus" });
  check("unknown key: sync stores nothing; bad op rejected", s === 200 && b.parties.length === 0 && s2 === 404 && s3 === 400, [s, b, s2, s3]);
} catch (e) {
  res.push("FAIL test threw " + (e && e.stack || e));   // a throw used to be swallowed by the exit(0) in finally
} finally {
  for (const k of [A, B, C, E, ...KICK, ...PUSH]) await call(k, { op: "forget" });
  const [, b] = await call(A, { op: "board" });   // A re-registers on this call; forget again
  await call(A, { op: "forget" });
  console.log(res.join("\n"));
  process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
}
