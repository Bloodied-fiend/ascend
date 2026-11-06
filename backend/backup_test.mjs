// Backup, PIN and restore against a deployed function on a THROWAWAY Neon branch (never production: it needs ALLOW_LOCAL=1 and a test admin password).
//   FN_URL=https://... ADMIN_PW=... node backup_test.mjs
// Optional all-or-nothing check: first add to that branch
//   alter table saves add constraint txboom check (key_hash <> '271a413bd339c5709fdceaec41f14f11e9fbfb5042d72d331c65f32b284cd09a')
// which makes a restore onto the key "ab" x 32 fail on its last statement.
import { randomBytes } from "node:crypto";
const FN = process.env.FN_URL, PW = process.env.ADMIN_PW, O = "http://127.0.0.1:8799", TX_KEY = "ab".repeat(32);
if (!FN) throw new Error("set FN_URL");
const key = () => randomBytes(32).toString("hex"), uniq = () => "T" + randomBytes(5).toString("hex");
const call = async (k, body) => { const r = await fetch(FN, { method: "POST", headers: { origin: O, authorization: "Bearer " + k, "content-type": "application/json" }, body: JSON.stringify(body) }); return [r.status, await r.json().catch(() => ({}))]; };
const res = [], check = (n, ok, info) => { res.push(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(info)}`); console.log(res.at(-1)); };
const pause = () => new Promise(r => setTimeout(r, 61e3)); // restore has a limit of 10 a minute per address, admin 3
const sum = (lvl = 5) => ({ title: "T", lvl, xp: lvl * 100, tier: 0, streak: 1, gates: 0, red: 0, awaken: 0 });
const sv = (name, lvl, pad = "") => JSON.stringify({ name, lvl, quests: [{ id: "q" }], pad });
const ping = (k, name, lvl) => call(k, { op: "ping", name, summary: sum(lvl) });
const made = [];
const player = async (name, lvl) => { const k = key(); made.push(k); await ping(k, name, lvl); return k; };
const pinOf = () => String(100000 + Math.floor(Math.random() * 899999));
try {
  // uploads
  const k = key(), name = uniq(); made.push(k);
  let [s, b] = await call(k, { op: "bsave", gen: 1, save: sv(name, 3) });
  check("an unknown key stores nothing", s === 409, [s, b]);
  await ping(k, name, 3);
  [s, b] = await call(k, { op: "bsave", gen: 1, save: "{not json" });
  check("a broken save is refused", s === 400, [s, b]);
  [s, b] = await call(k, { op: "bsave", gen: 10, save: sv(name, 3) });
  check("a checked-in player can upload", s === 200 && b.ok === true, [s, b]);
  [s, b] = await call(k, { op: "bsave", gen: 9, save: sv(name, 99) });
  check("an older upload arriving late is refused and reports the newer one", s === 200 && b.ok === false && b.stale && b.gen === 10, [s, b]);
  [s, b] = await call(k, { op: "bsave", gen: 11, save: sv(name, 4, "x".repeat(300 * 1024)) });
  check("a 300 KB save fits", s === 200 && b.ok === true, [s, b]);
  [s, b] = await call(k, { op: "bsave", gen: 12, save: sv(name, 4, "x".repeat(600 * 1024)) });
  check("a 600 KB save is refused", s === 413, [s, b]);
  [s, b] = await call(k, { op: "board", name: "x".repeat(5000) });
  check("other requests keep the 4 KB limit", s === 413, [s, b]);
  await call(k, { op: "bsave", gen: 13, save: sv(name, 4) });

  // PINs
  const noSave = await player(uniq(), 1);
  [s, b] = await call(noSave, { op: "bpin", pin: "123456" });
  check("a PIN needs a backup first", s === 409, [s, b]);
  [s, b] = await call(k, { op: "bpin", pin: "12345" });
  check("a PIN must be 6 digits", s === 400, [s, b]);
  const pin = pinOf();
  [s, b] = await call(k, { op: "bpin", pin });
  check("setting a PIN works", s === 200 && b.ok, [s, b]);
  const twin = await player(name, 2); await call(twin, { op: "bsave", gen: 1, save: sv(name, 2) });
  [s, b] = await call(twin, { op: "bpin", pin });
  check("a same-named player cannot pick the same PIN", s === 409, [s, b]);
  const pin2 = String((+pin + 1) % 900000 + 100000);
  [s, b] = await call(twin, { op: "bpin", pin: pin2 });
  check("a same-named player can pick another PIN", s === 200, [s, b]);

  // restore: identity moves
  const stranger = await player(uniq(), 1);
  [s, b] = await call(stranger, { op: "brestore", name, pin: "000000" });
  check("a wrong PIN is refused", s === 403, [s, b]);
  [s, b] = await call(stranger, { op: "brestore", name: name.toUpperCase(), pin });
  check("name + PIN finds the right player, ignoring case, and reveals only the summary", s === 200 && b.lvl === 4 && !("save" in b), [s, b]);
  [s, b] = await call(stranger, { op: "brestore", name, pin: pin2 });
  check("the PIN picks between two players with one name", s === 200 && b.lvl === 2, [s, b]);
  await pause();

  const oldK = key(), newK = key(), who = uniq(), wkPin = pinOf(); made.push(oldK, newK);
  [, b] = await call(oldK, { op: "create", name: who, party: "Backup Squad" });
  const code = b.parties[0].code;
  await call(oldK, { op: "sync", name: who, summary: sum(7) });
  await call(oldK, { op: "psub", sub: { endpoint: "https://127.0.0.1:9/" + oldK, p256dh: "A".repeat(80), auth: "B".repeat(20) }, tz: 0, nudge: 240 });
  await ping(oldK, who, 7); await call(oldK, { op: "bsave", gen: 5, save: sv(who, 7) }); await call(oldK, { op: "bpin", pin: wkPin });
  await ping(newK, who, 1); await call(newK, { op: "bsave", gen: 1, save: sv(who, 1) });
  [s, b] = await call(newK, { op: "brestore", name: who, pin: wkPin, confirm: true });
  check("restore returns the old save", s === 200 && JSON.parse(b.save).lvl === 7 && b.pin === true, [s, b]);
  [s, b] = await call(newK, { op: "board", name: who });
  check("the new phone is now in the old party, with no duplicate", s === 200 && b.parties[0]?.code === code && b.parties[0].members.length === 1 && b.parties[0].members[0].me && b.parties[0].iown, [s, b]);
  [s, b] = await call(oldK, { op: "board", name: who });
  check("the old key no longer has that identity", s === 200 && b.parties.length === 0, [s, b]);
  [s, b] = await call(oldK, { op: "bsave", gen: 99, save: sv(who, 1) });
  check("the old phone cannot overwrite the restored save", s === 409, [s, b]);
  [s, b] = await call(newK, { op: "bpull" });
  check("a lost restore answer can be fetched again", s === 200 && JSON.parse(b.save).lvl === 7, [s, b]);
  await call(newK, { op: "bsave", gen: 6, save: sv(who, 8) });
  [s, b] = await call(newK, { op: "bpull" });
  check("after the next upload there is nothing pending to pull", s === 200 && !b.save, [s, b]);
  [s, b] = await call(oldK, { op: "ptest" });
  check("the lost phone's push subscription is gone", s === 404 || s === 503, [s, b]);

  // a phone already in a party must leave it first
  const cross = await player(uniq(), 1), crossName = (await call(cross, { op: "create", name: "CrossP", party: "Other" }))[1];
  [s, b] = await call(cross, { op: "brestore", name: who, pin: wkPin, confirm: true });
  check("a phone in its own party cannot restore over it", s === 409 && crossName.parties.length === 1, [s, b]);
  await pause();

  // an erased save does not take the good copy with it
  const wiped = await player(uniq(), 40); const wn = uniq(), wp = pinOf();
  await call(wiped, { op: "bsave", gen: 1, save: sv(wn, 5) }); await call(wiped, { op: "bsave", gen: 2, save: sv(wn, 40) });
  await call(wiped, { op: "bpin", pin: wp });
  await call(wiped, { op: "bsave", gen: 3, save: sv(wn, 1) });
  const again = key(); made.push(again); await ping(again, wn, 1);
  [s, b] = await call(again, { op: "brestore", name: wn, pin: wp });
  check("after an erase, restore offers the older, higher copy", s === 200 && b.lvl === 1 && b.prev_lvl === 40, [s, b]);
  [s, b] = await call(again, { op: "brestore", name: wn, pin: wp, confirm: true, use: "prev" });
  check("choosing the older copy returns it", s === 200 && JSON.parse(b.save).lvl === 40, [s, b]);
  [s, b] = await call(again, { op: "bpull" });
  check("the older copy is what the server now holds", JSON.parse(b.save).lvl === 40, [s, b]);

  // a rename can make one name + PIN match two players: refuse rather than guess
  {
    const shared = pinOf(), n1 = uniq(), n2 = uniq(), p1 = await player(n1, 3), p2 = await player(n2, 3);
    await call(p1, { op: "bsave", gen: 1, save: sv(n1, 3) }); await call(p1, { op: "bpin", pin: shared });
    await call(p2, { op: "bsave", gen: 1, save: sv(n2, 3) }); await call(p2, { op: "bpin", pin: shared });
    await call(p2, { op: "bsave", gen: 2, save: sv(n1, 3) });
    [s, b] = await call(stranger, { op: "brestore", name: n1, pin: shared, confirm: true });
    check("a rename that makes name + PIN match two players restores neither", s === 409 && !b.save, [s, b]);
  }

  // lockout, stored in the database
  const lk = await player(uniq(), 3), ln = uniq(), lp = pinOf();
  await call(lk, { op: "bsave", gen: 1, save: sv(ln, 3) }); await call(lk, { op: "bpin", pin: lp });
  const wrong = lp === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++) await call(stranger, { op: "brestore", name: ln, pin: wrong });
  [s, b] = await call(stranger, { op: "brestore", name: ln, pin: lp });
  check("after 5 wrong PINs even the right one is refused", s === 429, [s, b]);
  await pause();

  // admin code
  if (PW) {
    const an = uniq(), ad = await player(an, 6); await call(ad, { op: "bsave", gen: 1, save: sv(an, 6) });
    [s, b] = await call(stranger, { op: "admin", pw: PW });
    const row = b.players?.find(p => p.name === an);
    check("the admin list shows who has a backup", s === 200 && row?.backed && row.pin === false && /^[a-f0-9]{16}$/.test(row.id), [s, row]);
    const id = row.id;
    [s, b] = await call(stranger, { op: "admin", pw: "wrong", codeFor: id });
    check("a code needs the admin password", s === 403 || s === 429, [s, b]);
    await pause();
    [s, b] = await call(stranger, { op: "admin", pw: PW, codeFor: "f".repeat(16) });
    check("no code for a player with no backup", s === 404, [s, b]);
    [s, b] = await call(stranger, { op: "admin", pw: PW, codeFor: id });
    const rc = b.code; check("the admin can issue a code", s === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(rc), [s, b]);
    const c2 = key(); made.push(c2); await ping(c2, an, 1);
    [s, b] = await call(c2, { op: "brestore", code: "ZZZZZZZZ" });
    check("a wrong code is refused", s === 403, [s, b]);
    [s, b] = await call(c2, { op: "brestore", code: rc.toLowerCase(), confirm: true });
    check("the code restores the save with no PIN", s === 200 && JSON.parse(b.save).lvl === 6 && b.pin === false, [s, b]);
    const c3 = key(); made.push(c3);
    [s, b] = await call(c3, { op: "brestore", code: rc, confirm: true });
    check("the code works once", s === 403, [s, b]);
    await pause();
  } else res.push("SKIP admin (set ADMIN_PW)");

  // all or nothing: the last statement of the transfer fails
  {
    const src = key(), sn = uniq(), sp = pinOf(); made.push(src, TX_KEY);
    const [, cb] = await call(src, { op: "create", name: sn, party: "Tx Squad" });
    await ping(src, sn, 5); await call(src, { op: "bsave", gen: 1, save: sv(sn, 5) }); await call(src, { op: "bpin", pin: sp });
    await ping(TX_KEY, sn, 1);
    [s, b] = await call(TX_KEY, { op: "brestore", name: sn, pin: sp, confirm: true });
    if (s === 500) {
      const [, on] = await call(src, { op: "board", name: sn }), [, onNew] = await call(TX_KEY, { op: "board", name: sn }), [sv2, up] = await call(src, { op: "bsave", gen: 2, save: sv(sn, 5) });
      check("a transfer that fails half way changes nothing", on.parties[0]?.code === cb.parties[0].code && onNew.parties.length === 0 && sv2 === 200 && up.ok, [on, onNew, sv2, up]);
    } else res.push(`SKIP all-or-nothing (txboom constraint not installed: ${s})`);
  }

  // delete my data
  [s] = await call(newK, { op: "forget" });
  const [fs, fb] = await call(stranger, { op: "brestore", name: who, pin: wkPin });
  check("Delete my party data removes the backup and PIN", s === 200 && fs === 403, [s, fs, fb]);
} catch (e) { res.push("FAIL test threw " + (e && e.stack || e)); console.log(res.at(-1)); }
const failed = res.filter(r => r.startsWith("FAIL")).length;
console.log(`${res.filter(r => r.startsWith("PASS")).length} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
