// Exercise the party function locally against a real database.
//   DATABASE_URL=... node test_local.mjs   or   FN_URL=https://... node test_local.mjs   (cleans up what it creates)
import { randomBytes } from "node:crypto";
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
let E = "0".repeat(64);
const sum = (xp, lvl = 5) => ({ lvl, xp, tier: 0, streak: 3, gates: 1, red: 0, awaken: 0 });
try {
  let [s, b] = await call(A, { op: "create", name: "TestA", party: "Test Squad" });
  const code = b.parties?.[0]?.code;
  check("create party returns 8-char code", s === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(code), [s, b]);
  [s, b] = await call(B, { op: "join", name: "TestB", code: code.toLowerCase() });
  check("join with code (case-insensitive)", s === 200 && b.parties[0].members.length === 2, [s, b]);
  await call(A, { op: "sync", summary: sum(900) });
  [s, b] = await call(B, { op: "sync", summary: sum(1500, 9) });
  const m = b.parties[0].members;
  check("board ranks by total XP, marks me", m[0].name === "TestB" && m[0].me && m[1].xp === 900 && !m[1].me, m);
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
  const D = randomBytes(32).toString("hex");
  [s, b] = await call(D, { op: "create", name: "x".repeat(19) + "\u{1F525}", party: "Emoji" });
  check("name cut through an emoji still works", s === 200, [s, b]);
  await call(D, { op: "forget" });
  E = randomBytes(32).toString("hex");
  [s, b] = await call(E, { op: "sync", summary: sum(5) });
  const [s2] = await call(E, { op: "join", code: "ZZZZZZZZ" });
  const [s3] = await call(E, { op: "bogus" });
  check("unknown key: sync stores nothing; bad op rejected", s === 200 && b.parties.length === 0 && s2 === 404 && s3 === 400, [s, b, s2, s3]);
} finally {
  for (const k of [A, B, C, E]) await call(k, { op: "forget" });
  const [, b] = await call(A, { op: "board" });   // A re-registers on this call; forget again
  await call(A, { op: "forget" });
  console.log(res.join("\n"));
  process.exit(0);
}
