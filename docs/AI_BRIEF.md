# Brief for an AI assistant working on Aqua Energizer

Paste this whole file as your first message, attach or upload the project zip, then add one task from the list in part C
(one task per conversation works best).

---

## A. What this project is

**Aqua Energizer** is a finished, polished browser puzzle game (Boulder Dash / Supaplex family): a little diver digs through
sand, pushes red energy pearls into a gate, then swims into the gate. Stones fall and roll, monsters patrol, air runs out.
30 hand-made levels, a Daily Dive, shop, rewards, an intro film with ElevenLabs narration, and a finale.

- Three.js r160, plain JavaScript, no framework, no bundler. `src/index.html` (markup + all CSS), `src/game.js` (all code:
  Engine → LEVELS → Audio → World (3D) → Controller (UI, saves)).
- `python tools/build.py` inlines everything into **one file, `dist/index.html`**. That single file is the product.
- `CLAUDE.md` is the full design and engineering log: read the sections relevant to your task before changing anything.
  It records what the owner approved and what they rejected.
- The owner judges everything by **playing on a phone**. Quality bar: it should feel like a premium mobile game.

## B. Rules (non-negotiable)

1. Edit only `src/` and `tools/`. Never hand-edit `dist/`, `src/assets/art-data.js` or `src/assets/models/diver.js` (generated).
2. The output must stay a single self-contained HTML file: no network requests except Google Fonts, total under 16 MB.
3. Don't change the puzzle rules (`Engine`) or the 30 `LEVELS` unless the task says so. If you do, every level must still be winnable:
   run `python tests/play_routes.py dist/index.html` and fix `tests/routes.json` with the solver tools in `tools/solver/`.
4. Keep the approved look and feel (see "Current design" and "Things the owner explicitly does NOT want" in CLAUDE.md):
   glass aquarium tanks, warm sand, reef-rock walls, the Meshy 3D diver, glossy navy + gold UI (Fredoka/Nunito), calm low sounds,
   no melody, nothing shrill, no camera zoom on computers. Don't invent new mechanics.
5. The game is tick-based (225 ms per tick). Animations are interpolated between ticks; don't tie gameplay to frame rate.
6. Mobile GPUs: clamp every `pow()` base in shaders (negative bases give NaN on phones), avoid backdrop-filter over the moving canvas,
   test the phone layout (portrait ~390×844) and a computer layout (1280×720 and 1440×900).
7. After every change, run and report:
   ```
   python tools/build.py
   python tests/smoke.py dist/index.html          # every level loads, no page errors
   python tests/play_routes.py dist/index.html    # 30/30 levels won
   python tests/fuzz_levels.py dist/index.html 260   # 0 errors
   ```
   and show before/after screenshots of what you changed. Say plainly what you could not verify.
8. Prefer small, careful edits to rewrites. `game.js` is large: search for the function you need (names are listed in CLAUDE.md).
9. Add a short section to CLAUDE.md describing what you changed and why, so the next person can follow it.

## C. Polish list (pick one per conversation)

Ordered by how much a player would notice. "Art" items are things an image-capable AI can produce directly.

### Look (biggest impact)
1. **Art — paintings for World 2 and World 3.** World 1 uses `src/assets/images/background/bg_photo.jpg` (2560×1435, a painted
   underwater reef with sand at the bottom). Paint two more in the same style and framing: `bg_photo_w2.jpg` (Coral Caves: violet and
   magenta cave reef, glowing corals) and `bg_photo_w3.jpg` (The Deep: dark teal-navy abyss, bioluminescent cyan accents, moonlight from
   above). Same horizon height and sand band as the original so the tanks sit on the sand. Drop them in the folder and rebuild; the
   game picks them up automatically.
2. **Art — share picture and store art.** A 1200×630 `og:image` (logo, diver, a glowing tank) for link previews, plus app icons
   (512×512 and 192×192, `src/icons/`).
3. **Diver animation.** Digging reuses the push pose. Add proper dig, swim-up and a few idle variations. Needs extra clips on the same
   Mixamo rig (Meshy/Mixamo), converted with `tools/convert_diver.py`; then blend them in `glbDrive()` in game.js.
4. **Monsters.** Piranha, jellyfish and crab are built from primitives in code (`makeFish`/`makeJelly`/`makeCrab`, `monMats`). Replacing
   them with rigged GLB models in the same cute style as the diver would lift the whole game.
5. **Patterned shop suits** lose their pattern on the GLB diver (only recolours work, `aqSkin` shader). Make the patterns show
   (e.g. a pattern texture blended in the suit region).
6. **Effects pass:** dig spray, sand settling, pearl trail, gate wake. Keep it soft and calm (the owner rejected flashy).

### Sound
7. **Music variety.** Only three looped tracks (menu / play / deep). Add calm, melody-free layers per world, or longer loops with
   variation. Keep it ambient (the owner does not want tunes). Credits in Settings must be updated for any new licensed music.
8. **Voice-over retakes:** any line can be redone with `make_voices.bat` (option 4) after editing `tools/voices.json`, then
   `python tools/import_voices.py voiceovers.zip`.

### Code health (invisible to players, makes every later change safer)
9. **One clean stylesheet.** `src/index.html` has ~1,400 lines of CSS built up in layers ("UI pass 2", "Modern pass", "Glossy",
   "Cyan theme", "Expert pass"...), many with `!important` and the `html body:is(.ui-art, :not(.ui-art))` prefix to win specificity
   fights. Merge them into one tidy stylesheet with **zero visual change**: take screenshots of every screen (home, levels, level card,
   play HUD, pause, win, lose, shop, rewards, ranks, settings, how to play, daily, finale) at phone and computer sizes before and after,
   and compare them.
10. **Split `game.js` into modules** (engine, levels, audio, world, ui) that `tools/build.py` concatenates back into the single file.
    Pure refactor, no behaviour change, all tests green.
11. **Strings table.** All text is hard-coded English in game.js and index.html. Move it into one table so the game can be translated.

### Content and reach
12. **More Daily Dive levels.** There are 20 (`tools/solver/daily/daily_a.json`, `daily_b.json`, built by `build_daily.js`). Each needs
    a verified route; follow the existing files.
13. **Hosting:** when the game has a public address, set `PUBLIC_URL` in game.js (sharing section) and the `og:image` meta tag.
    The leaderboard and the "share to unlock" outfits then need a small backend (see "Social sharing" in CLAUDE.md).
14. **Gamepad support** and better screen-reader labels.

### Needs a real device (can't be tested in a desktop browser)
15. iPhone haptics (iOS 18 switch trick, `iosTap()`), audio after phone calls/interruptions, frame rate on a low-end Android phone.

## D. How to report back

For each task: what you changed (files + functions), the test results (smoke / routes / fuzz numbers), screenshots before and after,
and anything you could not verify. Keep the explanation short and in plain words.
