# Aqua Energizer — project guide for Claude Code

An underwater stone-and-sand puzzle game (Boulder Dash / Supaplex family) running in the browser with
Three.js. A little diver digs through sand, pushes red **energy pearls** into the **gate**, then swims into
the gate to finish. Stones fall, pearls roll, monsters patrol, and an **oxygen** timer counts down.
30 levels. Ships as **one self-contained HTML file** (also published as a claude.ai artifact).

The owner (Noor) iterates on look-and-feel a lot and judges by **playing on a phone**. Keep the game working
at every step and always show the result (screenshot or a playable build).

---

## Layout

```
src/                     editable source (open src/index.html directly in a browser to run it)
  index.html             HTML + all CSS + UI markup (screens, HUD, sheets). Loads the 3 scripts below.
  game.js                ALL game code (engine, levels, audio, 3D renderer, UI controller) — see map below
  vendor/three.min.js    Three.js r160 UMD build (global THREE). Do not edit.
  assets/images/         the real art files (source of truth) — replace these to change art
    background/bg_photo.jpg   painted background used on photo levels (currently Level 1 only)
    sheet/*.png               cut-outs from the owner's asset sheet (corals, plants, shells, fish, goal, platform…)
    art/*.png|jpg             older cut-outs + textures (stickman frames, sand/dirt tiles, etc.)
  assets/asset-manifest.json  which file feeds which key in the game
  assets/art-data.js     GENERATED (window.AQ_DATA = base64 data URIs). Never edit by hand.
  manifest.json, icons/  PWA files
tools/
  build_assets.py        images -> src/assets/art-data.js
  build.py               build_assets + inline everything -> dist/index.html (single file) + manifest + icons
  solver/                Node tools that drive the REAL engine: macro.js (best-first solver),
                         replay.js (check a route), extract_engine.py (regenerates engine.js + levels.json)
tests/                   Playwright tests (run against src/index.html or dist/index.html)
  smoke.py               every level starts, no page errors
  play_routes.py         plays verified winning routes (routes.json) for levels 1–11; all must win
  fuzz_levels.py         random play on all 30 levels inside the real renderer; must produce 0 errors
dist/                    build output (what gets published / hosted)
```

### Commands
```bash
pip install playwright && python -m playwright install chromium     # once
python tools/build.py                       # build dist/index.html
python tests/smoke.py dist/index.html       # fast
python tests/play_routes.py dist/index.html # ~2–4 min
python tests/fuzz_levels.py dist/index.html 260
python tools/solver/extract_engine.py && node tools/solver/macro.js 12      # try solving level 12
node tools/solver/replay.js 10 "RRRRRDDD..."                                 # verify a route
```
Tests use Playwright's bundled Chromium; set `CHROME_PATH` to use another. Rendering is software (SwiftShader)
in headless mode, so it is slow: tests freeze the game's rAF loop (`window.__freeze = true`) and drive
frames manually. **Do not trust wall-clock UI timing in headless tests** (CSS animations stall there).

**Definition of done for any change:** `build.py` succeeds, `smoke.py` passes, `play_routes.py` 11/11 won,
`fuzz_levels.py` 0 errors, and you have looked at a screenshot of the affected screen/level.

---

## game.js map (approximate line numbers)
| Lines | What |
|---|---|
| 1–330 | `T` tile enum, `Engine` — pure grid simulation, no DOM (also used by the solver). Tick-based: `press(dir)`, `hold(dir)`, `step()`, `events[]`, `state` ('playing'/'won'/'dead'), `oxygen`, `ballsIn/ballsTotal`, `gate.open`. Legend: `# . W P B R E A F J C X S` (X = crate skin of a rock, S = spike). |
| 334–680 | `LEVELS` — 30 maps `{ name, time, hint, map: [...] }`. Original comment: every level verified winnable by the original author's tool. |
| 686–815 | `Audio` — WebAudio synth: calm underwater ambience (no melody, by request) + SFX (`dig` is intentionally soft/soothing). |
| 818–2270 | `World` (3D renderer, Three.js): materials/textures, `sandify` (sand shader: sheet sand texture colour-matched to the background, directional "scoop" dig mask with damp rim), models (`makeDiver` etc.), `Reef` (procedural 3D reef background), `Post` (bloom/grade/vignette), `WorldImpl` (`loadLevel`, `handleEvent`, `fitCamera`, `update`). |
| 896–930 | `SPR`, `sprTex`, `sprPlane`, `shelfFace` — helpers that turn the asset-sheet cut-outs into scene objects. |
| 1644 | `PHOTO_LEVELS` — which levels use the painted background (`bg_photo.jpg`). Currently `{'First Light'}`. |
| 1728–1790 | `buildPhotoBg` / `placePhotoBg` — painted background facing the camera + surface shimmer, bubbles, sprite fish. |
| 2275–3110 | `Doodle` — LEGACY hand-drawn 2D renderer (old intro/menu/doodle levels). Not shown any more (`DOODLE_LEVELS = 0`, `#doodle` hidden). Safe to delete later. |
| 3114–end | Controller: saves (`localStorage['dc-save']`), screens, HUD, intro cinematic (plays Level 1 by itself), touch drag stick, keyboard, undo history, frame loop. Debug handle: `window.__dc` (`startIndex(i)`, `engine`, `world`). |

---

## Current design (what the owner approved — keep it)
- **Scene:** each level is a **glass aquarium tank** (teal frame, brass caps, tinted back glass) standing on a
  stone plinth on the seabed. Camera is nearly front-on with a slight downward tilt.
- **Inside the tank:** sand (texture from the owner's sheet, colour-matched to the painted background sand),
  **coral shelves** for inner walls (`W`) — they read as anchored so nothing "should" fall — with the sheet's
  platform art on their face; **treasures** (starfish/shells/mini jellyfish sprites) embedded in sand that fall
  and settle when dug out; sea-plant sprites on sand ledges; goal sprite on the gate.
- **Diver:** 3D chibi diver, auto-fitted to exactly one cell, feet on the floor when standing, gentle float in
  open water, turns by rotating (never scale-flips), always visible.
- **Digging:** directional scoop from the diver's side, eased, damp rim, grains spray away; soft dig sound; tiny haptic tap.
- **Background:** Level 1 = the owner's painting (`bg_photo.jpg`) with live shimmer/bubbles/fish and contact
  shadows painted onto its sand (no 3D floor). Other levels = procedural 3D reef. Owner is evaluating the
  painting on Level 1 before rolling it out everywhere.
- **Foreground:** drifting specks, occasional fish passing above/below the tank (never across the playfield),
  seabed with stones/shells/starfish/grass in front of the tank; rock + coral + plant sprites along the plinth.
- **Lighting:** strong directional key light with shadows, darker deep water, sun glow at the top, punchy contrast.
- **UI:** hyper-casual 3D-game style: cream pause/undo/restart buttons top-left, level/energy bar top-centre,
  dark-navy air timer with ★★★ preview top-right, white "Hold" map button bottom-right. Menu = live 3D tank
  behind a gold "Aqua Energizer" title, gold PLAY pill, cream tiles. Intro = in-engine cinematic of Level 1
  with captions (plays once; "Watch intro" replays).
- **Camera:** computer = always the whole level, no zoom/drift. Phone = follows the diver with slight
  look-ahead and smart zoom; hold the map button to see everything.
- **Gameplay helpers:** undo (↶ / Z, up to 200 moves, also from the "Crushed!" screen), instant restart
  (⟲ / R), star thresholds on the air bar, hint on the pause screen, "stuck?" tip after 22 s, red "!" when a
  stone/pearl sits right above the diver.

## Things the owner explicitly does NOT want
- The old flat doodle / stickman style in levels or menu (tried, rejected). Notebook-doodle style: rejected.
- Boxy blue tiles inside the tank; rocks that look like they should fall; melodic music; harsh dig sounds.
- Camera zoom on desktop. Clutter crossing the playfield.
- Inventing new mechanics without asking (spikes/crate exist in the engine but are unused in current levels).

## Hard constraints
- The deliverable must stay a **single self-contained HTML file** (`dist/index.html`): no network requests
  except Google Fonts. claude.ai artifacts block other external resources. Keep it under ~16 MB.
- Engine (`Engine` class + `LEVELS`) changes can break verified routes: rerun `play_routes.py` after any.
- If you change `LEVELS`, re-verify with the solver/replay tools and update `tests/routes.json`.

## Known gaps / backlog
1. Levels 12–30 are not independently solved by our solver (it runs out of time on big open levels);
   they rely on the original author's verification + crash fuzzing. Improving `tools/solver/macro.js` is welcome.
2. Desktop: mouse drag does not move the diver (keyboard only). Add mouse-drag support.
3. Walking into a closed gate gives no feedback — add a short toast ("Deliver all energy first").
4. Undo rebuilds the level visuals: treasures that had fallen jump back into the sand.
5. Roll the painted background out to all levels (or per-world paintings) once the owner approves.
6. ~~Skins / shop / currency~~ — done (see below).
7. Delete the legacy `Doodle` module and unused CSS once nothing references them.

---

## Added in the launch pass (keep in sync)
- **Look:** every level uses the new sheet (`src/assets/images/sheet2`, `ART_SETS.new`), the painted background,
  one shader seabed in the painting's colours, and the premium tank (navy frame, teak stand, brass level plaque,
  water surface, sun shafts, air-stone bubbles). Per-world mood via `WORLD_TINT` (shallows / violet caves / deep).
- **Shadows:** baked sprite shadows (`addSprShadow`), back-wall AO + cast shadow (`buildOcclusion`), entity drop +
  contact shadows (`syncEntityShadows`). All fall down-right along `SHADOW_DIR` (the key light).
- **Sand:** 3D blocks with matching rounded corners + inner fillets (`syncSandBlocks`); a dug cell and its
  neighbours switch at the dig midpoint (k = 0.5) so nothing seams mid-dig.
- **Diver:** spring locomotion, lean, reach/push, expressive face, moods (`playerMood`), death poses
  (`animateDeath`), voice SFX (`voice()` in Audio). Skins: `SKINS` / `applySkin` / `makeHat` / `suitTex`.
- **Graphics tiers:** low/medium/high/ultra + Auto (`setQuality`, `autoQuality`; phones use dynamic resolution
  first). Post has a NaN/Inf guard — keep `pow()` bases clamped in shaders (mobile GPUs return NaN for x<0).
- **Boot:** `#loader` decodes all art (`World.ready`) and pre-builds/compiles level 1, a monster level and the
  menu (`world.warm`) before the title shows. Shop thumbnails render in idle time on the home screen.
- **Meta:** coins, shop (5 categories, rarity tiers, 3D card renders), daily treasure + achievements, leaderboard.
  Save keys in `localStorage['dc-save']`: coins, owned, equip, stats, ach, daily. Leaderboard uses the claude.ai
  artifact `db` capability (`board/<userId>` docs; rules: everyone reads, each writes own) and falls back to the
  player's own best elsewhere. Publish with capabilities
  `{db:{rules:[{path:"board",read:"view",write:"owner"},{path:"board/{self}",write:"interact"}]},user:{scopes:["profile"]}}`.
- **Tests on this machine:** headless rendering is software, so the loader takes ~50 s here (1-3 s on devices);
  tests call `startIndex` / `__dc.go`, which skip the loader.
