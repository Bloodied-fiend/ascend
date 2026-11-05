# Ascend party backend

One Neon Function (`party.mjs`) behind the Guild-tab party leaderboard. Neon project `ascend` (`quiet-truth-45540782`), branch `br-red-haze-b7b2z47p`, function slug `party`:
https://br-red-haze-b7b2z47p-party.compute.c-13.us-east-1.aws.neon.tech/

- POST `/` with `{op}`: `board`, `sync`, `create`, `join`, `leave`, `forget`. Bearer = a 64-hex key the app generates and keeps in localStorage (`ascend-party-key`, never in backups); the server stores only its SHA-256.
- Talks to Postgres over Neon's HTTPS SQL endpoint with plain `fetch` (no driver, so the deploy zip is ~3 KB). `DATABASE_URL` is injected by Neon. Tables are created on first request.
- Only parties you're in are visible. Unknown keys can't store anything except via `create`/`join` with a real code.

Build + test + deploy:
```
cd backend && npm install && node build.mjs          # dist/index.mjs -> dist/party.zip(.b64)
DATABASE_URL=... node test_local.mjs                 # 12 checks against the real DB, cleans up after itself
FN_URL=<url> node test_local.mjs                     # same checks against the deployed function (needs ALLOW_LOCAL=1 on it)
```
Deploy = Neon `deploy_function` (zip as base64). Production runs with no env vars; set `ALLOW_LOCAL=1` only while running live tests from 127.0.0.1, then clear it (`{"ALLOW_LOCAL":""}`).
World Raid (v51): every request carries `wk` (the player's local Monday, YYYY-MM-DD; refused if more than 9 days from now). `sync` takes an optional `raid: {wk, dmg}` stored in `raids(player_id, wk, dmg)`. The board answers with each member's `rd` (damage this week) plus `guilds`: every party's combined damage this week, top 25 by damage plus any of the caller's parties ranked lower. Rankings carry party name, size and damage only, never member names or invite codes. Apps that send no `wk` get `rd: null` and `guilds: []`, so older versions keep working.

Known limits (ponytail comments in code): a member can post a fake XP total; party/member caps can overshoot under simultaneous requests; the per-key limiter is per warm instance.

Player damage list (v52): `ping` also takes `raid: {wk, dmg}`, stored on `installs` so solo hunters count. Both `ping` (when it carries `wk`) and the board answer with `ranks`: every hunter's display name and damage this week, top 25 plus the caller. These names are visible to all players. `forget` removes a solo hunter's check-in too. `guilds` stays for installs on the first World Raid build.
