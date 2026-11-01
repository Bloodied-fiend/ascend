// In-process check of the admin guess limiter: no database, no network, no deployed function.
//   node limit_test.mjs
// The general per-key limiter self-clears past 5000 entries. The admin limiter (3 guesses a minute per
// address) used to live in that same Map, so flooding 5000 throwaway keys reset an attacker's guess count.
import { randomBytes, scryptSync } from "node:crypto";

const salt = randomBytes(16);
process.env.ADMIN_HASH = salt.toString("hex") + ":" + scryptSync("right", salt, 32).toString("hex");
globalThis.fetch = async () => { throw new Error("no db in this test"); }; // every DB call fails fast; the limiter runs before it
const { default: fn } = await import("./party.mjs");

const ORIGIN = "https://bloodied-fiend.github.io";
const call = (body, key, ip = "203.0.113.7") => fn.fetch(new Request("https://fn.test/", { method: "POST", body: JSON.stringify(body),
  headers: { origin: ORIGIN, "content-type": "application/json", authorization: "Bearer " + key, "x-forwarded-for": ip } }));
const key = () => randomBytes(32).toString("hex");
const res = [], check = (n, ok, info = "") => res.push(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + info}`);

const k = key(), guesses = [];
for (let i = 0; i < 4; i++) guesses.push((await call({ op: "admin", pw: "wrong" + i }, k)).status);
check("admin: 3 wrong guesses, then 429", guesses.join() === "403,403,403,429", guesses.join());

const errs = console.error; console.error = () => {}; // each flood request logs the failed DB call
for (let i = 0; i < 5001; i++) await call({ op: "board" }, key(), "198.51.100." + (i % 250));
console.error = errs;
const after = (await call({ op: "admin", pw: "wrong-again" }, k)).status;
check("flooding 5001 other keys does not reset the admin guess count", after === 429, "status " + after);

console.log(res.join("\n"));
process.exitCode = res.some(r => r.startsWith("FAIL")) ? 1 : 0;
