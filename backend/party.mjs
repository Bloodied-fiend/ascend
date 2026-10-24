// Ascend party leaderboard: one Neon Function, one JSON endpoint (POST / {op,...}).
// Identity = an invisible per-player key the app keeps on the device; only its SHA-256 is stored here.
// Parties are invite-code only: you see exactly the players who share a party with you.
import { createHash, randomInt } from "node:crypto";

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
const OPS = new Set(["board", "sync", "create", "join", "leave", "forget", "kick"]);
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
const limited = k => { const now = Date.now(), h = hits.get(k); if (!h || now - h.t > 60e3) { hits.set(k, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; } return ++h.n > PER_KEY_PER_MIN; };

async function handle(req, ip) {
  const key = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!/^[a-f0-9]{64}$/.test(key)) return [401, { error: "key" }];
  if (+(req.headers.get("content-length") || 0) > 4096) return [413, { error: "too large" }];
  const raw = await req.text();
  if (raw.length > 4096) return [413, { error: "too large" }];
  let b; try { b = JSON.parse(raw); } catch { return [400, { error: "json" }]; }
  if (!b || typeof b !== "object") return [400, { error: "json" }];
  if (b.op === "ip" && LOCAL) return [200, { xff: req.headers.get("x-forwarded-for"), ip }]; // test-only: what the platform sends
  if (!OPS.has(b.op)) return [400, { error: "op" }];
  if (limited(key)) return [429, { error: "slow down" }];
  await init();
  const kh = createHash("sha256").update(key).digest("hex");
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
      await pool.query(
        `insert into summaries(player_id, lvl, xp_total, tier, streak, gates, red, awaken, title) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (player_id) do update set lvl=$2, xp_total=$3, tier=$4, streak=$5, gates=$6, red=$7, awaken=$8, title=$9, updated_at=now()`,
        [me, s.lvl, s.xp, s.tier, s.streak, s.gates, s.red, s.awaken, typeof s.title === "string" ? cleanName(s.title, 40) : null]);
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
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (!ok) return json({ error: "origin" }, 403);
    // Neon appends the real client IP last; earlier entries are whatever the caller sent (verified live)
    const ip = (req.headers.get("x-forwarded-for") || "").split(",").pop().trim() || "?";
    try { const [s, body] = await handle(req, ip); return json(body, s); }
    catch (e) { console.error(e); return json({ error: "server" }, 500); }
  },
};
