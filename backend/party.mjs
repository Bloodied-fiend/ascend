// Ascend party leaderboard: one Neon Function, one JSON endpoint (POST / {op,...}).
// Identity = an invisible per-player key the app keeps on the device; only its SHA-256 is stored here.
// Parties are invite-code only: you see exactly the players who share a party with you.
// The one exception is World Raid player rankings, which show display names and damage to every player.
// Every install also checks in on open (op "ping") so Jaime's hidden admin list sees everyone, party or not.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { sendPush } from "./push.mjs";

// SQL over Neon's HTTPS endpoint with plain fetch: no driver, so the deployed bundle is a few KB
const DB = process.env.DATABASE_URL, DB_HOST = DB && new URL(DB).hostname;
async function sql(query, params = []) {
  const r = await fetch(`https://${DB_HOST}/sql`, { method: "POST", headers: { "Neon-Connection-String": DB, "content-type": "application/json" }, body: JSON.stringify({ query, params }) });
  const b = await r.json();
  if (!r.ok) throw new Error(b.message || "sql " + r.status);
  return { rows: b.rows, rowCount: b.rowCount };
}
const pool = { query: sql };
// Several statements as one transaction, which the HTTPS endpoint runs all-or-nothing.
async function tx(queries) {
  const r = await fetch(`https://${DB_HOST}/sql`, { method: "POST", headers: { "Neon-Connection-String": DB, "content-type": "application/json" }, body: JSON.stringify({ queries }) });
  const b = await r.json();
  if (!r.ok) throw new Error(b.message || "tx " + r.status);
  return b.results;
}

const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://bloodied-fiend.github.io").split(",").map(s => s.trim());
const LOCAL = process.env.ALLOW_LOCAL === "1"; // tests from http://127.0.0.1:<port>
const MAX_PARTIES = 5, MAX_MEMBERS = 20, NEW_PLAYERS_PER_IP_DAY = 10, PER_KEY_PER_MIN = 30;
const MAX_BODY = 512 * 1024, MAX_OP_BODY = 4096, PIN_TRIES = 5; // only bsave carries a whole save; everything else keeps the small limit
const OPS = new Set(["ping", "board", "sync", "create", "join", "leave", "forget", "kick", "psub", "poff", "ptest", "bsave", "bpin", "brestore", "bpull"]);
const BACKUP_OPS = new Set(["bsave", "bpin", "brestore", "bpull"]);
// Push identity is the same device key, but deliberately NOT tied to a player row: the daily nudge
// has to work whether or not you are in a party, and an unknown key cannot create a player.
const PUSH_OPS = new Set(["psub", "poff", "ptest"]);
// The cron trigger invokes the function over plain HTTP with no Authorization header and no Origin,
// so the scheduled path has to bypass both checks -- which makes the path itself the only thing
// standing between a stranger and Jaime's notifications. It is a secret kept in the function env and
// in the trigger config, never in the repo. Worst case if guessed: one early nudge.
const CRON_PATH = process.env.CRON_PATH || "";
// Hidden admin list (Jaime only). ADMIN_HASH = "<salt hex>:<scrypt hex>" in the function env, never the repo.
// Unset, the op does not exist. Lists every install that has checked in, plus party players on app versions from before the check-in.
const [ADMIN_SALT, ADMIN_KEY] = (process.env.ADMIN_HASH || "").split(":");
const VAPID = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE,
  subject: process.env.VAPID_SUBJECT || "https://bloodied-fiend.github.io/ascend/" };
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

const SCHEMA = `
create table if not exists players(id bigserial primary key, key_hash text unique not null, name text not null, ip text, created_at timestamptz not null default now());
create table if not exists parties(id bigserial primary key, code text unique not null, name text not null, created_at timestamptz not null default now());
create table if not exists members(party_id bigint not null references parties(id) on delete cascade, player_id bigint not null references players(id) on delete cascade, joined_at timestamptz not null default now(), primary key(party_id, player_id));
create table if not exists summaries(player_id bigint primary key references players(id) on delete cascade, lvl int not null, xp_total bigint not null, tier int not null, streak int not null, gates int not null, red int not null, awaken int not null, updated_at timestamptz not null default now());
create index if not exists members_player on members(player_id);
create index if not exists players_ip on players(ip, created_at);
alter table summaries add column if not exists title text;
alter table parties add column if not exists owner_id bigint references players(id) on delete set null;
create table if not exists push_subs(key_hash text primary key, endpoint text not null, p256dh text not null, auth text not null, tz_off int not null default 0, nudge_min int, enabled boolean not null default true, created_at timestamptz not null default now(), last_sent timestamptz);
alter table push_subs add column if not exists last_pass timestamptz;
create table if not exists installs(key_hash text primary key, name text not null, lvl int not null, xp bigint not null, tier int not null, streak int not null, title text, ip text, first_seen timestamptz not null default now(), seen timestamptz not null default now());
update parties set owner_id = (select player_id from members where party_id = parties.id order by joined_at, player_id limit 1) where owner_id is null;
create table if not exists raids(player_id bigint not null references players(id) on delete cascade, wk text not null, dmg int not null, updated_at timestamptz not null default now(), primary key(player_id, wk));
alter table installs add column if not exists raid_wk text;
alter table installs add column if not exists raid_dmg int;
alter table installs add column if not exists raid_at timestamptz;
create table if not exists saves(key_hash text primary key, name_norm text not null, lvl int not null, gen bigint not null, save text not null, updated_at timestamptz not null default now(), restored_at timestamptz, prev text, prev_lvl int, prev_at timestamptz);
create index if not exists saves_name on saves(name_norm);
create table if not exists pins(key_hash text primary key, salt text not null, hash text not null, fails int not null default 0, locked_until timestamptz);
create table if not exists restore_codes(code_hash text primary key, key_hash text not null, expires_at timestamptz not null);`;
let ready = null;
const init = () => (ready ??= (async () => { for (const s of SCHEMA.split(";").map(x => x.trim()).filter(Boolean)) await sql(s); })().catch(e => { ready = null; throw e; }));

// toWellFormed: a cut through an emoji would leave a lone surrogate Postgres refuses (Alastor W1)
const cleanName = (v, n = 20) => (typeof v === "string" ? v.replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, n).toWellFormed() : "") || "Hunter";
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const newCode = () => Array.from({ length: 8 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join("");
// World Raid week = the player's local Monday (YYYY-MM-DD). Accept only weeks within a few days of now so a
// device can't park damage on a far-future week. ponytail: like XP, the damage itself is client-reported.
const RAID_MAX = 5000;
const raidWk = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Math.abs(Date.parse(v + "T00:00:00Z") - Date.now()) < 9 * 864e5 ? v : null;

async function board(me, wk) {
  const { rows } = await pool.query(
    `select p.code, p.name, (p.owner_id = $1) as iown,
       json_agg(json_build_object('id', pl.id, 'name', pl.name, 'me', pl.id = $1, 'lead', pl.id = p.owner_id, 'lvl', s.lvl, 'xp', s.xp_total, 'tier', s.tier,
         'streak', s.streak, 'gates', s.gates, 'red', s.red, 'awaken', s.awaken, 'title', s.title, 'rd', r.dmg)
         order by s.xp_total desc nulls last, pl.id) as members
     from members m join parties p on p.id = m.party_id
     join members m2 on m2.party_id = p.id join players pl on pl.id = m2.player_id
     left join summaries s on s.player_id = pl.id
     left join raids r on r.player_id = pl.id and r.wk = $2
     where m.player_id = $1 group by p.id order by p.created_at`, [me, wk]);
  return rows;
}

// World Raid guild rankings: every party's combined damage on this week's boss. Party names and sizes
// only -- never member names or invite codes, so a ranking leaks nothing that would let a stranger join.
// Top 25 by damage, plus any of my parties that rank lower (so you always see where you stand).
async function guildBoard(me, wk) {
  const { rows } = await pool.query(
    `with t as (
       select p.id, p.name, count(m.player_id)::int as n, coalesce(sum(r.dmg), 0)::int as dmg,
              bool_or(m.player_id = $1) as mine
         from parties p join members m on m.party_id = p.id
         left join raids r on r.player_id = m.player_id and r.wk = $2
        group by p.id),
     ranked as (select *, rank() over (order by dmg desc, n asc, id asc)::int as rk from t where dmg > 0 or mine)
     select rk, name, n, dmg, mine from ranked where rk <= 25 or mine order by rk`, [me, wk]);
  return rows;
}

// World Raid player rankings: every hunter's damage on this week's boss, party or solo. Display name and
// damage only, never a key or invite code. Top 25, plus me if I rank lower. Party players report through both
// sync (raids) and ping (installs), so the newest report wins; an undo must be able to lower the number.
async function playerBoard(kh, wk) {
  const { rows } = await pool.query(
    `with t as (
       select pl.key_hash, pl.name, r.dmg, r.updated_at as at from raids r join players pl on pl.id = r.player_id where r.wk = $2
       union all
       select key_hash, name, raid_dmg, raid_at from installs where raid_wk = $2),
     latest as (select distinct on (key_hash) key_hash, name, dmg from t order by key_hash, at desc),
     ranked as (select *, rank() over (order by dmg desc, key_hash)::int as rk from latest where dmg > 0 or key_hash = $1)
     select rk, name, dmg, key_hash = $1 as mine from ranked where rk <= 25 or key_hash = $1 order by rk`, [kh, wk]);
  return rows;
}

// ponytail: best-effort per-key limiter in one warm instance's memory; a scripted flood across cold starts still costs invocations
const hits = new Map(), admHits = new Map(); // admin guesses get their own Map: a flood of throwaway keys clearing `hits` must not reset them
const limited = (k, max = PER_KEY_PER_MIN, m = hits) => { const now = Date.now(), h = m.get(k); if (!h || now - h.t > 60e3) { m.set(k, { t: now, n: 1 }); if (m.size > 5000) m.clear(); return false; } return ++h.n > max; };

const asInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

// minutes since the subscriber's chosen minute, wrapped mod 1440 so a 23:50 nudge still fires on the 00:00 run
const nudgeDue = t => `(((extract(epoch from ${t})/60)::int + tz_off - nudge_min) % 1440 + 1440) % 1440 < 15`;

// Runs every 15 minutes. A subscriber is due when their LOCAL clock has just passed their chosen
// minute, and they have not already been sent today in their own timezone -- so one nudge a day, at
// their time, wherever they are.
async function cronNudge() {
  if (!VAPID.publicKey || !VAPID.privateKey) return { error: "push not configured" };
  await init();
  const { rows } = await pool.query(
    `select key_hash, endpoint, p256dh, auth, tz_off, nudge_min from push_subs
     where enabled and nudge_min is not null
       and ${nudgeDue("now()")}
       and (last_sent is null
            or date((last_sent + make_interval(mins => tz_off))) < date((now() + make_interval(mins => tz_off))))`);
  let sent = 0, dropped = 0;
  for (const r of rows) {
    const status = await sendPush(r, { title: "ASCEND", body: "Daily Quest is waiting.", tag: "nudge", url: "./" }, VAPID);
    if (status === 404 || status === 410) { await pool.query("delete from push_subs where key_hash = $1", [r.key_hash]); dropped++; continue; }
    if (status >= 200 && status < 300) { await pool.query("update push_subs set last_sent = now() where key_hash = $1", [r.key_hash]); sent++; }
  }
  return { due: rows.length, sent, dropped };
}

// ponytail: sends inline inside the triggering request, one fetch per recipient. Fine at the 20-member
// cap; if parties ever grow, move this to a queue so a sync does not wait on the push service.
async function pushMany(rows, payload) {
  let sent = 0;
  for (const r of rows) {
    try {
      const status = await sendPush(r, payload, VAPID);
      if (status === 404 || status === 410) await pool.query("delete from push_subs where key_hash = $1", [r.key_hash]);
      else if (status >= 200 && status < 300) sent++;
    } catch (e) { console.error("push failed", e && e.message); }
  }
  return sent;
}

// Someone overtook you on a board you share. Fires on the crossing only -- members whose total now sits
// below the mover's but was above it before -- so a sync that changes nothing notifies nobody.
async function notifyPassed(me, oldTotal, newTotal) {
  if (!VAPID.privateKey || !(newTotal > oldTotal)) return;
  const { rows } = await pool.query(
    `select distinct ps.key_hash, ps.endpoint, ps.p256dh, ps.auth, (select name from players where id = $1) as mover
       from members mine
       join members theirs on theirs.party_id = mine.party_id and theirs.player_id <> mine.player_id
       join players pl on pl.id = theirs.player_id
       join summaries s on s.player_id = pl.id
       join push_subs ps on ps.key_hash = pl.key_hash and ps.enabled
      where mine.player_id = $1 and s.xp_total < $2 and s.xp_total >= $3
        and (ps.last_pass is null or ps.last_pass < now() - interval '1 hour')`, [me, newTotal, oldTotal]);
  if (!rows.length) return;
  const mover = cleanName(rows[0].mover);
  await pushMany(rows, { title: "ASCEND", body: `${mover} just passed you.`, tag: "party", url: "./" });
  // one per hour per recipient, so two players trading places does not become a conversation
  await pool.query("update push_subs set last_pass = now() where key_hash = any($1::text[])", [rows.map(r => r.key_hash)]);
}

async function notifyJoined(partyId, joinerId) {
  if (!VAPID.privateKey) return;
  const { rows } = await pool.query(
    `select ps.key_hash, ps.endpoint, ps.p256dh, ps.auth,
            (select name from players where id = $2) as joiner, (select name from parties where id = $1) as party
       from members m join players pl on pl.id = m.player_id
       join push_subs ps on ps.key_hash = pl.key_hash and ps.enabled
      where m.party_id = $1 and m.player_id <> $2`, [partyId, joinerId]);
  if (!rows.length) return;
  await pushMany(rows, { title: "ASCEND", body: `${cleanName(rows[0].joiner)} joined ${cleanName(rows[0].party, 24)}.`, tag: "party", url: "./" });
}

async function pushOp(b, kh) {
  if (!VAPID.publicKey || !VAPID.privateKey) return [503, { error: "push not configured" }];
  if (b.op === "poff") {
    await pool.query("delete from push_subs where key_hash = $1", [kh]);
    return [200, { push: false }];
  }
  if (b.op === "psub") {
    const s = b.sub || {};
    // a push endpoint is a URL the push service gave the browser; we never construct one ourselves
    if (typeof s.endpoint !== "string" || !/^https:\/\/[^\s]{10,500}$/.test(s.endpoint)) return [400, { error: "endpoint" }];
    if (typeof s.p256dh !== "string" || typeof s.auth !== "string"
      || !/^[A-Za-z0-9_-]{20,200}$/.test(s.p256dh) || !/^[A-Za-z0-9_-]{10,100}$/.test(s.auth)) return [400, { error: "keys" }];
    await pool.query(
      `insert into push_subs(key_hash, endpoint, p256dh, auth, tz_off, nudge_min, enabled)
       values($1,$2,$3,$4,$5,$6,true)
       on conflict (key_hash) do update set endpoint=$2, p256dh=$3, auth=$4, tz_off=$5, nudge_min=$6, enabled=true`,
      [kh, s.endpoint, s.p256dh, s.auth, asInt(b.tz, -840, 840, 0), asInt(b.nudge, 0, 1439, null)]);
    return [200, { push: true }];
  }
  // ptest: prove the whole chain end to end -- keys, subscription, push service, service worker
  const r = (await pool.query("select endpoint, p256dh, auth from push_subs where key_hash = $1 and enabled", [kh])).rows[0];
  if (!r) return [404, { error: "not subscribed" }];
  const status = await sendPush(r, { title: "ASCEND", body: "Notifications are working.", tag: "test" }, VAPID);
  if (status === 404 || status === 410) { // the push service says this subscription is dead
    await pool.query("delete from push_subs where key_hash = $1", [kh]);
    return [410, { error: "subscription expired, re-enable notifications" }];
  }
  return [status >= 200 && status < 300 ? 200 : 502, { sent: status }];
}

async function adminOp(b, ip) {
  if (!ADMIN_SALT || !ADMIN_KEY) return [400, { error: "op" }];
  if (limited("adm:" + ip, 3, admHits)) return [429, { error: "slow down" }];   // 3 guesses a minute per address
  const pw = typeof b.pw === "string" ? b.pw.slice(0, 200) : "";
  if (!timingSafeEqual(scryptSync(pw, Buffer.from(ADMIN_SALT, "hex"), 32), Buffer.from(ADMIN_KEY, "hex"))) return [403, { error: "wrong password" }];
  await init();
  if (b.codeFor !== undefined) { // a one-time restore code for a player with no PIN, or a forgotten one
    const id = typeof b.codeFor === "string" && /^[a-f0-9]{16}$/.test(b.codeFor) ? b.codeFor : "";
    const t = id && (await pool.query("select key_hash from saves where left(key_hash, 16) = $1", [id])).rows[0];
    if (!t) return [404, { error: "no backup for that player" }];
    const code = newCode();
    await tx([{ query: "delete from restore_codes where key_hash = $1", params: [t.key_hash] },
      { query: "insert into restore_codes(code_hash, key_hash, expires_at) values($1, $2, now() + interval '1 day')", params: [createHash("sha256").update(code).digest("hex"), t.key_hash] }]);
    return [200, { code }];
  }
  const { rows } = await pool.query(
    `select left(coalesce(i.key_hash, pl.key_hash), 16) as id, sv.updated_at as backed, pn.key_hash is not null as pin, coalesce(i.name, pl.name) as name, coalesce(i.lvl, s.lvl) as lvl, coalesce(i.xp, s.xp_total) as xp, coalesce(i.tier, s.tier) as tier,
       coalesce(i.streak, s.streak) as streak, coalesce(i.title, s.title) as title, greatest(i.seen, s.updated_at) as seen,
       least(i.first_seen, pl.created_at) as joined, (select count(*)::int from members m where m.player_id = pl.id) as parties
     from installs i full outer join players pl on pl.key_hash = i.key_hash left join summaries s on s.player_id = pl.id
     left join saves sv on sv.key_hash = coalesce(i.key_hash, pl.key_hash) left join pins pn on pn.key_hash = coalesce(i.key_hash, pl.key_hash)
     order by 3 desc nulls last, 1`);
  return [200, { players: rows }];
}

// a check-in is not a player row: party rules (unknown keys store nothing there) are untouched
async function pingOp(b, kh, ip) {
  const s = b.summary || {};
  if (!(int(s.lvl, 1, 999) && int(s.xp, 0, 1e8) && int(s.tier, 0, 7) && int(s.streak, 0, 1e5))) return [400, { error: "summary" }];
  const known = (await pool.query("select 1 from installs where key_hash = $1", [kh])).rowCount;
  if (!known && (await pool.query("select count(*)::int c from installs where ip = $1 and first_seen > now() - interval '1 day'", [ip])).rows[0].c >= NEW_PLAYERS_PER_IP_DAY)
    return [429, { error: "slow down" }];
  await pool.query(
    `insert into installs(key_hash, name, lvl, xp, tier, streak, title, ip) values($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (key_hash) do update set name=$2, lvl=$3, xp=$4, tier=$5, streak=$6, title=$7, seen=now()`,
    [kh, cleanName(b.name), s.lvl, s.xp, s.tier, s.streak, typeof s.title === "string" ? cleanName(s.title, 40) : null, ip]);
  const rd = b.raid || {}, rwk = raidWk(rd.wk), wk = raidWk(b.wk);
  if (rwk && int(rd.dmg, 0, RAID_MAX)) await pool.query("update installs set raid_wk = $2, raid_dmg = $3, raid_at = now() where key_hash = $1", [kh, rwk, rd.dmg]);
  return [200, wk ? { ok: true, ranks: await playerBoard(kh, wk) } : { ok: true }]; // no wk: app versions from before the rankings
}

const dropBackup = kh => tx([{ query: "delete from saves where key_hash = $1", params: [kh] }, { query: "delete from pins where key_hash = $1", params: [kh] }, { query: "delete from restore_codes where key_hash = $1", params: [kh] }]);
const pinHash = (pin, salt) => scryptSync(pin, Buffer.from(salt, "hex"), 32).toString("hex");
const nameNorm = v => cleanName(v).toLowerCase();

// Which backup do these credentials open? Returns the owner's key hash, or an [status, body] refusal.
async function restoreSource(b, ip) {
  if (limited("rst:" + ip, 10, admHits)) return [429, { error: "too many tries, wait a minute" }];
  if (typeof b.code === "string") {
    const code = b.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const r = (await pool.query("select key_hash from restore_codes where code_hash = $1 and expires_at > now()", [createHash("sha256").update(code).digest("hex")])).rows[0];
    return r ? r.key_hash : [403, { error: "that code is wrong or expired" }];
  }
  const pin = typeof b.pin === "string" && /^\d{6}$/.test(b.pin) ? b.pin : null;
  if (!pin) return [400, { error: "enter your 6-digit PIN" }];
  const { rows } = await pool.query(
    `select p.key_hash, p.salt, p.hash, p.locked_until > now() as locked from pins p join saves s on s.key_hash = p.key_hash where s.name_norm = $1`, [nameNorm(b.name)]);
  const open = rows.filter(r => !r.locked);
  const hits = open.filter(r => timingSafeEqual(Buffer.from(pinHash(pin, r.salt), "hex"), Buffer.from(r.hash, "hex")));
  if (hits.length > 1) return [409, { error: "that name and PIN match two players, ask for a restore code" }]; // a rename or a race can do this; guessing would hand over someone else's save
  if (hits.length) return hits[0].key_hash;
  if (rows.length && !open.length) return [429, { error: "too many wrong PINs, try again tomorrow or ask for a restore code" }];
  if (open.length) await pool.query(
    `update pins set fails = fails + 1, locked_until = case when fails + 1 >= ${PIN_TRIES} then now() + interval '1 day' else locked_until end where key_hash = any($1::text[])`, [open.map(r => r.key_hash)]);
  return [403, { error: "that name and PIN don't match" }];
}

async function backupOp(b, kh, ip) {
  if (b.op === "bsave") {
    let sv = null; try { sv = typeof b.save === "string" ? JSON.parse(b.save) : null; } catch { /* rejected below */ }
    if (!sv || !int(sv.lvl, 1, 999) || !Array.isArray(sv.quests) || !int(b.gen, 1, 1e15)) return [400, { error: "save" }];
    // same gate as a new player: a key the IP-limited check-in has never seen stores nothing
    const known = (await pool.query("select 1 from installs where key_hash = $1 union all select 1 from players where key_hash = $1", [kh])).rowCount;
    if (!known) return [409, { error: "check in first" }];
    // A level only falls when a save was erased or replaced, so that is when the better copy moves to prev.
    const rot = `saves.prev is null or saves.prev_at < now() - interval '14 days' or (saves.lvl >= saves.prev_lvl and (saves.prev_at < now() - interval '1 day' or $3 < saves.lvl))`;
    const r = await pool.query(
      `insert into saves(key_hash, name_norm, lvl, gen, save) values($1,$2,$3,$4,$5)
       on conflict (key_hash) do update set name_norm=$2, lvl=$3, gen=$4, save=$5, updated_at=now(), restored_at=null,
         prev = case when ${rot} then saves.save else saves.prev end,
         prev_lvl = case when ${rot} then saves.lvl else saves.prev_lvl end,
         prev_at = case when ${rot} then saves.updated_at else saves.prev_at end
       where $4::bigint > saves.gen returning gen`, [kh, nameNorm(sv.name), sv.lvl, b.gen, b.save]);
    if (r.rowCount) return [200, { ok: true }];
    return [200, { ok: false, stale: true, gen: Number((await pool.query("select gen from saves where key_hash = $1", [kh])).rows[0].gen) }]; // an older upload arrived late
  }
  if (b.op === "bpin") {
    const pin = typeof b.pin === "string" && /^\d{6}$/.test(b.pin) ? b.pin : null;
    if (!pin) return [400, { error: "a PIN is 6 digits" }];
    const me = (await pool.query("select name_norm from saves where key_hash = $1", [kh])).rows[0];
    if (!me) return [409, { error: "still backing up, try again in a minute" }];
    const { rows } = await pool.query("select p.salt, p.hash from pins p join saves s on s.key_hash = p.key_hash where s.name_norm = $1 and p.key_hash <> $2", [me.name_norm, kh]);
    // name + PIN has to pick exactly one backup. shortcut: this reveals that a same-named player uses this PIN; fine among friends, not for a public app.
    if (rows.some(r => pinHash(pin, r.salt) === r.hash)) return [409, { error: "pick a different PIN" }];
    const salt = randomBytes(16).toString("hex");
    await pool.query(`insert into pins(key_hash, salt, hash) values($1,$2,$3) on conflict (key_hash) do update set salt=$2, hash=$3, fails=0, locked_until=null`, [kh, salt, pinHash(pin, salt)]);
    return [200, { ok: true }];
  }
  if (b.op === "bpull") { // a restore whose answer never arrived: the transfer happened, so the save is here under this key
    const r = (await pool.query("select s.save, p.key_hash is not null as pin from saves s left join pins p on p.key_hash = s.key_hash where s.key_hash = $1 and s.restored_at is not null", [kh])).rows[0];
    return [200, r ? { save: r.save, pin: r.pin } : {}];
  }
  // brestore: without confirm it only says what was found; with confirm it moves the identity to this device
  const src = await restoreSource(b, ip);
  if (Array.isArray(src)) return src;
  const f = (await pool.query("select lvl, updated_at, prev_lvl, prev_at from saves where key_hash = $1", [src])).rows[0];
  if (!f) return [404, { error: "no backup found" }];
  if (!b.confirm) return [200, { found: true, lvl: f.lvl, at: f.updated_at, prev_lvl: f.prev_lvl, prev_at: f.prev_at }];
  const usePrev = b.use === "prev" && f.prev_lvl !== null;
  if (src !== kh) {
    const inParty = (await pool.query("select 1 from members m join players p on p.id = m.player_id where p.key_hash = $1", [kh])).rowCount;
    if (inParty) return [409, { error: "leave your party on this phone first" }];
  }
  // Move everything or nothing. The lost phone's push subscription is deleted, not moved: its endpoint is that phone.
  const q = (query, ...params) => ({ query, params });
  await tx([
    ...(src === kh ? [] : [
      q("delete from players where key_hash = $1", kh), q("update players set key_hash = $1 where key_hash = $2", kh, src),
      q("delete from installs where key_hash = $1", kh), q("update installs set key_hash = $1 where key_hash = $2", kh, src),
      q("delete from push_subs where key_hash = $1", src),
      q("delete from saves where key_hash = $1", kh), q("delete from pins where key_hash = $1", kh),
      q("update pins set key_hash = $1 where key_hash = $2", kh, src)]),
    q("update pins set fails = 0, locked_until = null where key_hash = $1", kh),
    q("delete from restore_codes where key_hash = $1 or key_hash = $2", src, kh),
    q(`update saves set key_hash = $1, restored_at = now(),
         save = case when $3::boolean then prev else save end, lvl = case when $3::boolean then prev_lvl else lvl end,
         prev = case when $3::boolean then save else prev end, prev_lvl = case when $3::boolean then lvl else prev_lvl end
       where key_hash = $2`, kh, src, String(usePrev))]);
  const r = (await pool.query("select s.save, p.key_hash is not null as pin from saves s left join pins p on p.key_hash = s.key_hash where s.key_hash = $1", [kh])).rows[0];
  return [200, { save: r.save, pin: r.pin }];
}

async function handle(req, ip) {
  const key = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!/^[a-f0-9]{64}$/.test(key)) return [401, { error: "key" }];
  if (+(req.headers.get("content-length") || 0) > MAX_BODY) return [413, { error: "too large" }];
  const raw = await req.text();
  if (raw.length > MAX_BODY) return [413, { error: "too large" }];
  let b; try { b = JSON.parse(raw); } catch { return [400, { error: "json" }]; }
  if (!b || typeof b !== "object") return [400, { error: "json" }];
  if (b.op !== "bsave" && raw.length > MAX_OP_BODY) return [413, { error: "too large" }];
  if (b.op === "ip" && LOCAL) return [200, { xff: req.headers.get("x-forwarded-for"), ip }]; // test-only: what the platform sends
  if (b.op === "admin") return adminOp(b, ip);
  if (!OPS.has(b.op)) return [400, { error: "op" }];
  if (limited(key)) return [429, { error: "slow down" }];
  await init();
  const kh = createHash("sha256").update(key).digest("hex");
  if (PUSH_OPS.has(b.op)) return pushOp(b, kh);
  if (BACKUP_OPS.has(b.op)) return backupOp(b, kh, ip);
  if (b.op === "ping") return pingOp(b, kh, ip);
  // find or register the player (new players are rate-limited per IP)
  let me = (await pool.query("select id from players where key_hash = $1", [kh])).rows[0]?.id;
  const name = cleanName(b.name);
  if (!me) {
    if (b.op === "forget") await dropBackup(kh);
    if (b.op === "forget") await pool.query("delete from installs where key_hash = $1", [kh]); // a solo hunter has no player row, only the check-in
    if (b.op !== "create" && b.op !== "join") return [200, { parties: [] }]; // unknown key: nothing to show, nothing stored (a late sync can't resurrect a deleted player)
    if (b.op === "join") { // a wrong code must not leave a player row behind
      const code = typeof b.code === "string" ? b.code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      if (!(await pool.query("select 1 from parties where code = $1", [code])).rowCount) return [404, { error: "no party with that code" }];
    }
    const n = (await pool.query("select count(*)::int c from players where ip = $1 and created_at > now() - interval '1 day'", [ip])).rows[0].c;
    if (n >= NEW_PLAYERS_PER_IP_DAY) return [429, { error: "slow down" }];
    me = (await pool.query("insert into players(key_hash, name, ip) values($1,$2,$3) on conflict (key_hash) do update set name = excluded.name returning id", [kh, name, ip])).rows[0].id;
  } else if (typeof b.name === "string") await pool.query("update players set name = $2 where id = $1 and name <> $2", [me, name]);

  // a party outlives its leader: give it to whoever has been in it longest
  const handOn = async code => pool.query(
    "update parties set owner_id = (select player_id from members where party_id = parties.id order by joined_at, player_id limit 1) where code = $1 and not exists (select 1 from members where party_id = parties.id and player_id = parties.owner_id)", [code]);
  const myParties = async () => (await pool.query("select count(*)::int c from members where player_id = $1", [me])).rows[0].c;
  switch (b.op) {
    case "board": break;
    case "sync": {
      const s = b.summary || {};
      // ponytail: range checks only; a determined friend could still post a fake total. Server-side recompute needs full sync.
      if (!(int(s.lvl, 1, 999) && int(s.xp, 0, 1e8) && int(s.tier, 0, 7) && int(s.streak, 0, 1e5) && int(s.gates, 0, 1e5) && int(s.red, 0, 1e5) && (s.awaken === 0 || s.awaken === 1)))
        return [400, { error: "summary" }];
      const prev = (await pool.query("select xp_total from summaries where player_id = $1", [me])).rows[0];
      await pool.query(
        `insert into summaries(player_id, lvl, xp_total, tier, streak, gates, red, awaken, title) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (player_id) do update set lvl=$2, xp_total=$3, tier=$4, streak=$5, gates=$6, red=$7, awaken=$8, title=$9, updated_at=now()`,
        [me, s.lvl, s.xp, s.tier, s.streak, s.gates, s.red, s.awaken, typeof s.title === "string" ? cleanName(s.title, 40) : null]);
      const rd = b.raid || {}, rwk = raidWk(rd.wk);
      if (rwk && int(rd.dmg, 0, RAID_MAX)) {
        await pool.query(`insert into raids(player_id, wk, dmg) values($1,$2,$3) on conflict (player_id, wk) do update set dmg=$3, updated_at=now()`, [me, rwk, rd.dmg]);
        await pool.query("delete from raids where player_id = $1 and updated_at < now() - interval '60 days'", [me]);
      }
      // only on a real crossing: no previous total means a first sync, which should not notify anyone
      if (prev && Number(prev.xp_total) < s.xp) await notifyPassed(me, Number(prev.xp_total), s.xp);
      break;
    }
    // ponytail: party/member caps are check-then-insert without a transaction; simultaneous requests can overshoot by a few (friends-scale)
    case "create": {
      if ((await myParties()) >= MAX_PARTIES) return [409, { error: `you can be in ${MAX_PARTIES} parties` }];
      const pname = cleanName(b.party, 24);
      let pid;
      for (let i = 0; i < 5 && !pid; i++)
        pid = (await pool.query("insert into parties(code, name) values($1,$2) on conflict (code) do nothing returning id", [newCode(), pname])).rows[0]?.id;
      if (!pid) return [500, { error: "try again" }];
      await pool.query("insert into members(party_id, player_id) values($1,$2)", [pid, me]);
      await pool.query("update parties set owner_id = $2 where id = $1", [pid, me]);
      break;
    }
    case "join": {
      const code = typeof b.code === "string" ? b.code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return [400, { error: "code" }];
      const p = (await pool.query("select id, (select count(*)::int from members where party_id = parties.id) n from parties where code = $1", [code])).rows[0];
      if (!p) return [404, { error: "no party with that code" }];
      const already = (await pool.query("select 1 from members where party_id = $1 and player_id = $2", [p.id, me])).rowCount;
      if (!already) {
        if (p.n >= MAX_MEMBERS) return [409, { error: "party is full" }];
        if ((await myParties()) >= MAX_PARTIES) return [409, { error: `you can be in ${MAX_PARTIES} parties` }];
        await pool.query("insert into members(party_id, player_id) values($1,$2) on conflict do nothing", [p.id, me]);
        await notifyJoined(p.id, me);
      }
      break;
    }
    case "leave": {
      const code = typeof b.code === "string" ? b.code.toUpperCase() : "";
      await pool.query("delete from members where player_id = $1 and party_id = (select id from parties where code = $2)", [me, code]);
      await pool.query("delete from parties where code = $1 and not exists (select 1 from members where party_id = parties.id)", [code]);
      await handOn(code);
      break;
    }
    case "kick": {
      const code = typeof b.code === "string" ? b.code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      const target = Number(b.id);
      if (!Number.isInteger(target) || target <= 0) return [400, { error: "member" }];
      const p = (await pool.query("select id, owner_id from parties where code = $1", [code])).rows[0];
      if (!p) return [404, { error: "no party with that code" }];
      if (String(p.owner_id) !== String(me)) return [403, { error: "only the party leader can remove members" }];
      if (String(target) === String(me)) return [400, { error: "leave the party instead" }];
      const gone = (await pool.query("delete from members where party_id = $1 and player_id = $2", [p.id, target])).rowCount;
      if (!gone) return [404, { error: "not in this party" }];
      // Rotating is the point: the removed player still holds the old invite code and would otherwise
      // rejoin immediately. Everyone else keeps their membership; only the code they'd share changes.
      for (let i = 0; i < 5; i++)
        if ((await pool.query("update parties set code = $2 where id = $1 and not exists (select 1 from parties x where x.code = $2) returning id", [p.id, newCode()])).rowCount) break;
      break;
    }
    case "forget": { // remove me everywhere (credential revoke); parties I leave empty go too
      const mine = (await pool.query("select party_id from members where player_id = $1", [me])).rows.map(r => r.party_id);
      await pool.query("delete from players where id = $1", [me]);
      await dropBackup(kh);
      await pool.query("delete from installs where key_hash = $1", [kh]);   // "deletes your data on the party server" includes the check-in
      if (mine.length) {
        await pool.query("delete from parties where id = any($1::bigint[]) and not exists (select 1 from members where party_id = parties.id)", [mine]);
        // on delete set null leaves survivors leaderless; give each surviving party its longest-standing member
        await pool.query("update parties set owner_id = (select player_id from members where party_id = parties.id order by joined_at, player_id limit 1) where id = any($1::bigint[]) and owner_id is null", [mine]);
      }
      return [200, { parties: [] }];
    }
    default: return [400, { error: "op" }];
  }
  const wk = raidWk(b.wk);
  return [200, { parties: await board(me, wk), guilds: wk ? await guildBoard(me, wk) : [], ranks: wk ? await playerBoard(kh, wk) : [] }]; // guilds: the first World Raid build still reads it
}

export const _test = { nudgeDue };
export default {
  async fetch(req) {
    const origin = req.headers.get("origin") || "";
    const ok = ORIGINS.includes(origin) || (LOCAL && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
    const cors = { "Access-Control-Allow-Origin": ok ? origin : ORIGINS[0], "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
    // the scheduled trigger: no Origin, no Authorization, so it is routed before either is enforced
    if (CRON_PATH && new URL(req.url).pathname === "/" + CRON_PATH) {
      try { return new Response(JSON.stringify(await cronNudge()), { status: 200, headers: { "content-type": "application/json" } }); }
      catch (e) { console.error(e); return new Response(JSON.stringify({ error: "server" }), { status: 500, headers: { "content-type": "application/json" } }); }
    }
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (!ok) return json({ error: "origin" }, 403);
    // Neon appends the real client IP last; earlier entries are whatever the caller sent (verified live)
    const ip = (req.headers.get("x-forwarded-for") || "").split(",").pop().trim() || "?";
    try { const [s, body] = await handle(req, ip); return json(body, s); }
    catch (e) { console.error(e); return json({ error: "server" }, 500); }
  },
};
