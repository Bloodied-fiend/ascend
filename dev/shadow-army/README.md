# Shadow Army (demo, not in the app yet)

Playable demo: https://claude.ai/artifact/HnNQpcv4tCVpEw5rWGorsM (publish `shadow-army.html` with `sprites/*.png` as supporting files).

- `sprites/*.png` — one sheet per character, rows = idle, attack, hit, death; `meta.json` = frame size, feet line, body height, center x, frame counts (also inlined in the page).
- Art: LuizMelo, CC0 (itch.io): Martial Hero, Martial Hero 2, Huntress, Fantasy Warrior (Hunter looks); Medieval King (STR boss), Monsters Creatures Fantasy Flying Eye / Goblin (VIT / AGI), Evil Wizard 2 / 3 (INT / PER).
- Rebuild sheets: download the packs into an empty folder, `python -I tools/unpack.py <zips> <out>`, then `python -I tools/atlas.py <out> sprites > sprites/meta.json`.
