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

---

## REVISION 1 (2026-10-11) — supersedes the sections above where they conflict

Codex review verdict was "revise first". Safety prerequisite shipped in v18 (non-destructive load / cross-tab sync / restore). Remaining Codex changes are listed in the vault note `05 - App/Ascend.md` → HANDOFF, items 1–9; apply them.

### Locked by Jaime (2026-10-11)
- **Identity:** invisible per-player key (option 1) — no login screens; key generated at join, kept on device, used only for writes; shown only when linking a new phone.
- **Routine in the assessment:** after the 15 questions, three screens: lift days (chips, pre-filled from the lifting answer), cardio days + Run/Ruck/Both, daily habits with targets (sleep-by time, water, reading, meditation). Quests become per-weekday schedules; an unscheduled quest cannot be missed and does not break the streak. Days editable per quest in Edit; monthly Re-Assessment offers a routine check-in. Streaks, Rest Days, weekly boss and adaptive targets must treat "not scheduled today" as neutral.
- **Do more:** stepper continues past target ("3 / 2 MI · OVERDRIVE"); each extra 50% of target = +25% XP and +1 training session, capped at 2× target; unscheduled quests appear as optional bonus quests (reward, no penalty). Title "Overachiever" for exceeding target 20 times.
- **Adaptive targets:** distance quests (MI/KM) are no longer treated as binary just because the number is < 5; they step by 0.5.
- **Penalty Quest:** state its content and the rules before a miss, not only after.
- **Title placement:** equipped title replaces the hard-coded "The Awakened" line under rank on Home; shown under the name on Profile; next to players on the party board; in the feed. New Profile "Titles" section between rank ladder and Backup: earned (lit, date, tap to equip) and locked (dimmed, rule + progress, e.g. "Road Warrior · 37 / 100 timed miles"). Unlock = "[ TITLE ACQUIRED ]" System window with Equip / Later.

---

## REVISION 2 (2026-10-11) — Titles + ranked Gates (replaces the fake raids). Build spec for review.

**State added (in fresh(), KEEP, load() validation; ver stays 5, unknown/missing -> defaults):**
- `m` lifetime milestone counters, all start at 0 at upgrade ("tracking starts now", nothing backdated): `miles` (timed run/ruck distance, KM converted to MI, +on log, -on dropRun of that run), `pb` (count of runs logged with bonus tier 2; -1 if that run is re-logged/unchecked), `kills:{str,vit,agi,int,per}` (+1 when bossDown flips true; never decremented, bossDown never reverts), `advArmed` (bool, set when a Penalty Quest is cleared), `advDays` (consecutive cleared/rest days after arming, reset on a missed day), `sleepRun` (consecutive days the quest with ach "vit30" was done; rest days neutral; reset on a day it existed and was not done), `gateClears:{0..7}` per rank tier.
- `titles:{id:dateEarned}`, `title:id|null` (equipped; default "awakened").
- `gate:{id,start,until,base:{...},run,failed}|null` (active gate), `gateCd:dateKey|null` (cooldown after a failed/expired gate, 1 day).

**Fix:** quest editor keeps `q.ach` unless the quest's stat changes (was: any change to name/target/unit cleared it, silently stopping trophy and gate counting).

**Titles (cosmetic):** awakened (default), adversity ("One Who Overcame Adversity": advDays>=7), unbroken (60 days since `prog` with >=50 days hist===1), roadwarrior (m.miles>=100), pacesetter (m.pb>=5), bane_<stat> x5 ("<Boss>'s Bane": m.kills[stat]>=1), earlyrise (m.sleepRun>=14), heir (tier >= S-Rank), gatebreaker (sum gateClears>=5). Checked once after each state change completes (end of setDone, run log, rollover, gate resolve), never mid-save; each unlock notifies once ("[ TITLE ACQUIRED ]", Equip/Later). Earned titles are never revoked. Equipped title replaces hard-coded "The Awakened" (Home rank line, Status header line) and shows on Profile; Profile gets a Titles section: earned (date, tap to equip) and locked (rule + progress).

**Gates (one per rank for now, E..S = tiers 0..5):** enter only if tier <= current tier, no active gate, not in cooldown. Progress = counter now - counter snapshot at entry (`base`), using existing symmetric per-achievement counters `S.ap` (str50 strength sessions, agi30 run sessions, vit30 sleep nights, clear10 daily clears — all +1 on complete, -1 on undo) and `m.miles`; streak-type gates use `gate.run` updated at rollover (hist 1 -> +1, 0 -> reset to 0 and for no-penalty gates set failed, 2 rest -> neutral).
- E Goblin Den: run>=3, 5 days, +60 XP
- D Flooded Cellar: miles delta>=10, 7 days, +100
- C Iron Mines: str50 delta>=6 and agi30 delta>=3, 10 days, +150
- B Wraith Halls: vit30 delta>=10, 14 days, +220
- A Scholar's Labyrinth: clear10 delta>=14 and no missed day, 21 days, +300
- S Monarch's Gate: run>=30 (rest neutral), 35 days, +500
Clear: checked after state changes; awards XP via gainXP once, increments gateClears[tier], clears `gate`, notify "[ GATE CLEARED ]". Undo after a clear does not reopen it (reward stands, same as boss). Expiry at rollover (day > until) or failed: close, notify "[ GATE CLOSED ]", cooldown 1 day, nothing lost. UI: Guild = weekly boss + Gates (active gate card with per-objective bars and days left; list E..S with rank badge, locked ones dimmed "Reach X-Rank"). Remove fake raid/challenge/cleared content, `joined` state and its handler.

### Codex review of REVISION 2 (2026-10-11): PROCEED yes-with-fixes. Apply ALL before/while building:
1. BLOCKER — old open tabs strip new fields: bump to a NEW storage key (e.g. `ascend-v6`, ver 6) with one-time import from v5; never write v5 again (same pattern as v4->v5).
2. BLOCKER — cross-tab whole-state writes race: serialize read-latest -> rollover -> mutation -> gate/title resolution -> save across tabs (Web Locks API `navigator.locks.request` or single-writer); only the committing tab announces rewards; adopting state from storage must not replay awards.
3. Gate replay farm (clear D, uncheck run, re-enter, re-log): after a successful clear, no new gate until the next System day (persisted), or persist which completions funded a gate.
4. rollover() skips days: finalize EVERY elapsed date once (unattended dates = missed, hist 0); use the saved day's quests/done/rest before applying questsNext; compute sleep outcome before clearing done; resolve last eligible date before expiring a gate; gate windows inclusive (5 days = until start+4); define cooldown during catch-up.
5. Entry baseline: allow gate entry only before today's progress begins (or track the gate's own contributions); copy baselines as scalars.
6. Legacy runs: mark runs credited to m.miles/m.pb (preserve marker in load(), which rebuilds run records); reverse only marked runs using the removed record's n/u/b; trimming the 500-run history never subtracts milestones.
7. One outer finalization boundary per user action: settle overdue days -> all mutations (run replace, completion, boss, bonus XP) -> resolve gate once (mark resolved before XP) -> titles after all XP -> persist -> enqueue notices -> render. Suppress nested finalization inside setDone when called from run logging/stepper. Cover penalty clear, trophy claim, startup/restore. Keep checks out of save()/render()/gainXP(). Record title acquisition before notifying.
8. Objective identity: q.ach isn't enough (existing edited/custom quests have ach:null; renaming sleep->water would keep counting). Define explicit objective identity, keep it on name/target edits, let the user assign it (e.g. "counts as: Sleep / Strength / Cardio / none") in the editor, never infer sleep from VIT.
9. Rest-day semantics: a fully completed rest day bumps clear10 then rollover writes hist 2 -> decide; evaluate finalized-day milestones in rollover; Unbroken = 50 clears within the 60-day window.
10. Pre-existing XP-undo farm (complete 8x20 XP, undo, keep levels): keep an XP debt across level boundaries (display levels, owe XP) or persist reward attribution. Needed before rank-gated content.
11. load() validation for every new nested field (finite non-negative numbers, known ids, booleans, valid dates, complete baselines); an invalid active gate is dropped alone without rejecting the save; equipped title must be earned.
Also: S.ap `first`/`lvl20` are not symmetric (only str50/agi30/vit30/clear10 are); bossDown DOES reset weekly — increment kills only on the false->true transition.
