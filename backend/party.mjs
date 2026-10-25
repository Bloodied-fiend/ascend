// Ascend party leaderboard: one Neon Function, one JSON endpoint (POST / {op,...}).
// Identity = an invisible per-player key the app keeps on the device; only its SHA-256 is stored here.
// Parties are invite-code only: you see exactly the players who share a party with you.
// Every install also checks in on open (op "ping") so Jaime's hidden admin list sees everyone, party or not.
import { createHash, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
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

const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://bloodied-fiend.github.io").split(",").map(s => s.trim());
const LOCAL = process.env.ALLOW_LOCAL === "1"; // tests from http://127.0.0.1:<port>
const MAX_PARTIES = 5, MAX_MEMBERS = 20, NEW_PLAYERS_PER_IP_DAY = 10, PER_KEY_PER_MIN = 30;
const OPS = new Set(["ping", "board", "sync", "create", "join", "leave", "forget", "kick", "psub", "poff", "ptest"]);
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
update parties set owner_id = (select player_id from members where party_id = parties.id order by joined_at, player_id limit 1) where owner_id is null;`;
let ready = null;
const init = () => (ready ??= (async () => { for (const s of SCHEMA.split(";").map(x => x.trim()).filter(Boolean)) await sql(s); })().catch(e => { ready = null; throw e; }));

// toWellFormed: a cut through an emoji would leave a lone surrogate Postgres refuses (Alastor W1)
const cleanName = (v, n = 20) => (typeof v === "string" ? v.replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, n).toWellFormed() : "") || "Hunter";
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const newCode = () => Array.from({ length: 8 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join("");

async function board(me) {
  const { rows } = await pool.query(
    `select p.code, p.name, (p.owner_id = $1) as iown,
       json_agg(json_build_object('id', pl.id, 'name', pl.name, 'me', pl.id = $1, 'lead', pl.id = p.owner_id, 'lvl', s.lvl, 'xp', s.xp_total, 'tier', s.tier,
         'streak', s.streak, 'gates', s.gates, 'red', s.red, 'awaken', s.awaken, 'title', s.title)
         order by s.xp_total desc nulls last, pl.id) as members
     from members m join parties p on p.id = m.party_id
     join members m2 on m2.party_id = p.id join players pl on pl.id = m2.player_id
     left join summaries s on s.player_id = pl.id
     where m.player_id = $1 group by p.id order by p.created_at`, [me]);
  return rows;
}

// ponytail: best-effort per-key limiter in one warm instance's memory; a scripted flood across cold starts still costs invocations
const hits = new Map();
const limited = (k, max = PER_KEY_PER_MIN) => { const now = Date.now(), h = hits.get(k); if (!h || now - h.t > 60e3) { hits.set(k, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; } return ++h.n > max; };

const asInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

// Runs every 15 minutes. A subscriber is due when their LOCAL clock has just passed their chosen
// minute, and they have not already been sent today in their own timezone -- so one nudge a day, at
// their time, wherever they are.
async function cronNudge() {
  if (!VAPID.publicKey || !VAPID.privateKey) return { error: "push not configured" };
  await init();
  const { rows } = await pool.query(
    `select key_hash, endpoint, p256dh, auth, tz_off, nudge_min from push_subs
     where enabled and nudge_min is not null
       and (((extract(epoch from now())/60)::int + tz_off) % 1440 + 1440) % 1440 >= nudge_min
       and (((extract(epoch from now())/60)::int + tz_off) % 1440 + 1440) % 1440 < nudge_min + 15
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
  if (limited("adm:" + ip, 3)) return [429, { error: "slow down" }];   // 3 guesses a minute per address
  const pw = typeof b.pw === "string" ? b.pw.slice(0, 200) : "";
  if (!timingSafeEqual(scryptSync(pw, Buffer.from(ADMIN_SALT, "hex"), 32), Buffer.from(ADMIN_KEY, "hex"))) return [403, { error: "wrong password" }];
  await init();
  const { rows } = await pool.query(
    `select coalesce(i.name, pl.name) as name, coalesce(i.lvl, s.lvl) as lvl, coalesce(i.xp, s.xp_total) as xp, coalesce(i.tier, s.tier) as tier,
       coalesce(i.streak, s.streak) as streak, coalesce(i.title, s.title) as title, greatest(i.seen, s.updated_at) as seen,
       least(i.first_seen, pl.created_at) as joined, (select count(*)::int from members m where m.player_id = pl.id) as parties
     from installs i full outer join players pl on pl.key_hash = i.key_hash left join summaries s on s.player_id = pl.id
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
  return [200, { ok: true }];
}

async function handle(req, ip) {
  const key = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!/^[a-f0-9]{64}$/.test(key)) return [401, { error: "key" }];
  if (+(req.headers.get("content-length") || 0) > 4096) return [413, { error: "too large" }];
  const raw = await req.text();
  if (raw.length > 4096) return [413, { error: "too large" }];
  let b; try { b = JSON.parse(raw); } catch { return [400, { error: "json" }]; }
  if (!b || typeof b !== "object") return [400, { error: "json" }];
  if (b.op === "ip" && LOCAL) return [200, { xff: req.headers.get("x-forwarded-for"), ip }]; // test-only: what the platform sends
  if (b.op === "admin") return adminOp(b, ip);
  if (!OPS.has(b.op)) return [400, { error: "op" }];
  if (limited(key)) return [429, { error: "slow down" }];
  await init();
  const kh = createHash("sha256").update(key).digest("hex");
  if (PUSH_OPS.has(b.op)) return pushOp(b, kh);
  if (b.op === "ping") return pingOp(b, kh, ip);
  // find or register the player (new players are rate-limited per IP)
  let me = (await pool.query("select id from players where key_hash = $1", [kh])).rows[0]?.id;
  const name = cleanName(b.name);
  if (!me) {
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
  return [200, { parties: await board(me) }];
}

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
