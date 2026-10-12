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
Known limits (ponytail comments in code): a member can post a fake XP total; party/member caps can overshoot under simultaneous requests; the per-key limiter is per warm instance.
