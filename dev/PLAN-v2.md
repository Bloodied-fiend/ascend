# Ascend v2 plan — honest systems, titles, and a shared backend

Context: single-file PWA (`dev/ascend.html`, built to repo root by `dev/build_pwa.py`, served by GitHub Pages at bloodied-fiend.github.io/ascend). Progress in localStorage (`ascend-v4`), service worker cache-versioned. Jaime shared the app with a friend (Agee), so it now has 2+ real players. Outside reviews (cold user 3/5, Codex ~2.5/5) and competitor research drive the order below.

## Part 1 — no server (ships first)

1. **Remove fake Guild content.** Delete the hardcoded "Autumn Arc" raid, "This week" challenges (fake hunter counts, no-op Join), and "Cleared" list. Guild becomes: weekly boss + Titles + (Part 2) Party.
2. **Titles.** Earned from real data, one equipped, shown under the name on Home/Profile, "[ TITLE ACQUIRED ]" System notice, cosmetic only (no stat effects). Definitions as data: `{id, name, desc, test(S) -> bool}`. Initial set: The Awakened (default), One Who Overcame Adversity (clear a Penalty Quest then 7-day streak), Unbroken (60-day program done), Road Warrior (100 mi logged run/ruck from `S.runs`), Pacesetter (5 personal-best paces, from run bonus tier 2 count), <Boss>'s Bane x5 (defeat that boss; needs a persisted boss-kill log), Early to Rise (sleep-quest 14 consecutive days from `S.qlog`), Heir to the Monarch (reach S-Rank). Persist `S.titles={id:dateEarned}`, `S.title=id`; validate on load; check after every state change that can unlock one.
3. **Re-assessment honesty.** Only allowed when due (30 days since `baseKey`) except the first one; the button shows the countdown otherwise. Stats move at most ±10 per re-assessment toward the measured result (no overwrite jump 43->97). Copy changes "measure" to "self-assessment".
4. **Backup that works on a phone.** "Save backup" downloads/shares a real `.json` file (Web Share API with files where available, else Blob download); store `S.lastBackup`; Profile shows "Last backup: N days ago"; weekly nudge notice when >7 days. Keep clipboard copy as secondary.
5. **Storage safety.** On load parse failure, keep the raw string under `ascend-v4-corrupt-<ts>` before anything saves over it, and show a notice. On `save()` failure, show a persistent warning (not just a flag).
6. **Starting quests from the assessment.** First-run defaults scale targets from the stat answers (e.g. low STR → 20 min strength, low AGI → 1 mi). XP becomes derived from target difficulty instead of user-picked (editor shows it, can't set it).
7. **Music opt-in** (default off; first-run notice offers it).
8. **Polish bugs:** trophy counters keyed by stat/kind instead of quest id (renaming broke them); boss label refresh after re-assessment; success message styled as success; "1 DAY" plural; boss deadline text says "today" on Sunday; dialog 6px horizontal overflow; music icon overlapping Profile title; week strip day-1 shows future/not-started days distinctly from missed.

## Part 2 — shared backend (Neon), code in this repo under `backend/`

**Hosting:** Neon project `ascend` (aws-us-east-1). Postgres + one Neon Function (`api`, Hono, Node 24) + one Function Trigger (cron, hourly) for reminders. App stays on GitHub Pages; function deployed from `backend/` (Neon CLI/MCP; optional GitHub Action later). CORS allow-list: `https://bloodied-fiend.github.io`.

**Identity (no email/password):** `POST /join {name}` creates a player and returns a random 32-byte secret (base64url) stored client-side; server stores only SHA-256(secret). All other calls send `Authorization: Bearer <secret>`. "Link another device" = scan/paste the secret. Rate limit `/join` per IP.

**Party (who sees whom):** a player creates a party (6-char invite code) and shares it; others join with the code. Leaderboard and feed are party-scoped — strangers who find the public app see nothing of Jaime/Agee.

**Tables:** `players(id, name, secret_hash, created_at)`, `parties(id, code, created_by)`, `party_members(party_id, player_id)`, `snapshots(player_id, state jsonb, summary jsonb, updated_at)` (full backup + derived summary: level, rank, streak, boss kills, best pace, equipped title), `events(id, player_id, kind, payload jsonb, at)` (title earned, rank up, boss defeated), `push_subs(player_id, endpoint, p256dh, auth, tz, remind_at_local, created_at)`.

**API:** `PUT /snapshot` (client sends state + summary after changes, debounced; server validates size ≤256 KB and summary shape) · `GET /snapshot` (restore on a new device) · `POST /events` · `GET /party/board` · `GET /party/feed?since=` · `POST /party` · `POST /party/join {code}` · `POST /push/subscribe` · `DELETE /push/subscribe`.

**Client:** offline-first; sync queue retried on `online`/visibility; never blocks the UI; a "Party" section in Guild (board: level, rank, streak, bosses, best pace; feed: "Agee earned the title Pacesetter"). Server data never overwrites local progress silently — restore is an explicit action.

**Reminders:** VAPID keys in function env. Hourly trigger: for each subscription whose local time equals its reminder time (default 20:00) and whose latest summary shows today's quests incomplete → Web Push "Daily Quest incomplete — N quests left". Second push 3h before the 04:00 deadline. Requires the user to enable notifications from a tap (iOS 16.4+ home-screen apps, Android Chrome).

**Known limits:** a real reminder depends on the latest synced snapshot; widgets/health auto-logging remain impossible for a PWA; reachability of Neon's function domain on the gov network is unknown (app keeps working offline).

## Open questions for the reviewer
- Bearer-secret identity vs Neon Managed Better Auth — is the simple secret acceptable for a 2–5 friend app?
- Snapshot-of-whole-state vs event log — risks of last-writer-wins across two devices of the same player?
- Anything in Part 1 that should wait for Part 2 or vice versa?
