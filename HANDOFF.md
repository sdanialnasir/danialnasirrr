# Aqua Energizer: handoff for the next Claude

Read this first, then `CLAUDE.md` (the full technical guide: every system, file and past decision) and `TODO.md`.

## What this is
A Boulder Dash-style underwater puzzle game in one HTML file (Three.js). A diver digs sand and pushes red pearls into a gate, while
stones fall and monsters patrol. It has 30 levels and a story with 31 short films (a prologue plus chapters 1–30) between levels.
The owner, Noor, judges everything by playing on a phone.

- Live build: https://claude.ai/artifact/HQL6UGenCGmT79BLXmW5A8 (version 88). Publish `dist/index.html` with `files`: manifest.json and
  icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png from `dist/`. Keep the artifact's existing capabilities.
- Git: repo `sdanialnasir/danialnasirrr`, branch `claude/new-session-gkcpku`. Commit and push work there. No PRs unless asked.

## How to work (owner rules)
- Edit `src/` and `tools/`, then `python3 tools/build.py` builds `dist/index.html`. Keep it under ~16 MB (now ~15.5 MB).
- Done means: build OK, `tests/smoke.py` passes, `tests/play_routes.py` wins 30/30, `tests/fuzz_levels.py` has 0 errors,
  `tests/segments.py` passes, and you have **looked at screenshots** of what changed (phone and computer).
  Set `CHROME_PATH=/opt/pw-browsers/chromium` (or your Chromium) for the tests.
- Keep the 30 levels. Don't invent new puzzle mechanics without asking.
- The owner is short on credits: be efficient, verify before saying "done", and say plainly what is and isn't finished.
  The owner dislikes vague status updates and "ugly" work; polish and check before reporting.
- Story text lives in `tools/story/story_v6.py`. Run `python3 tools/story/inject.py`, then `python3 tools/story/gen_docs.py`.
  **The owner must not record voices until they approve the script.**
- Never commit the ElevenLabs key (`.elevenlabs-key` / `elevenlabs-key.txt` are gitignored).

## Where things stand
- Puzzle gameplay: the owner likes it. Glow gems, relics, combos, breathing at the top of the tank, danger glow, hints, and 3 undos per try.
- Films: shortened to 2–4 spoken lines each, the rest silent action beats. The camera now runs through a smooth stabiliser
  (measured on all 31 films: direction flips 46 → 2). Captions are fixed on small screens.
- Mini-games: beat (timing), catch (lanes) and sneak (hide from the eye) are in-world segments on chapters 2, 5, 6, 16, 18, 20, 21, 28.
  They replace the film there. Other chapters still have films with swim-runs, choices, the clam song and the boss fight (ch. 30).

## What the owner wants next (vision)
1. **"Finding Nemo game"-style gameplay:** varied, action-packed mini-games after each story beat, with the tank puzzle kept as each level's
   core and about 2 minutes per level. Replace long films with short in-world beats: one camera move and one line, with the story happening
   in the environment (Grimtide's searchlight, shadows, characters around the tank). Roll the segment system out from 8 to all 30 chapters,
   with no two neighbouring chapters using the same mini-game type. Add more types (escort a fish, current race through rings, dodge field).
   Make each one look polished with the game's UI art.
2. **Rigged characters:** the owner will send rigged Meshy GLBs (pip, pip_cousin, shelly, captain_clack, murk, lumen, mira, snip, snap,
   crab, piranha, grimtide). They can't animate. Convert them like `tools/convert_diver.py` does (skinned, reuse or retarget the diver's
   clips), keep the face rig / talking mouths / glow, and replace the current static cast models.
3. Cinematic quality: Disney / AAA feel, smooth camera, characters alive, a modern underwater environment. The ch. 6 wreck is still a flat
   wall, and night scenes are a bit murky.
4. Check on a real phone: segment layout and the camera's feel in motion (only checked in headless screenshots so far).

## Gotchas
- Headless rendering is software and slow; tests freeze rAF (`window.__freeze = true`) and drive frames by hand. Don't trust wall-clock timing.
- `pgrep -f`/`pkill -f` with a pattern also matches your own shell command; wait on PIDs instead.
- A `//` comment inside a one-line JS or GLSL statement swallows the rest of the line; use `/* */`.
- Debug handles: `window.__dc` (`startIndex(i)`, `watch(n)`, `seg(n)`, `segState()`, `world`, `engine`).
