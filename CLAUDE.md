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
  solver/                Node tools that drive the REAL engine: macro.js (best-first solver), plan.js + plans.json
                         (hand-written plans -> exact routes; build_routes.js regenerates tests/routes.json for 12–30),
                         replay.js (check a route), extract_engine.py (regenerates engine.js + levels.json)
tests/                   Playwright tests (run against src/index.html or dist/index.html)
  smoke.py               every level starts, no page errors
  play_routes.py         plays verified winning routes (routes.json) for all 30 levels; all must win
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

**Definition of done for any change:** `build.py` succeeds, `smoke.py` passes, `play_routes.py` 30/30 won,
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
1. ~~Levels 12–30 unverified~~ — done: every level has a verified route in `tests/routes.json`.
2. Desktop: mouse drag does not move the diver (keyboard only). Add mouse-drag support.
3. ~~Closed-gate feedback~~ — done (toast).
4. ~~Undo resets fallen treasures~~ — done (`keepTreasures`).
5. Roll the painted background out to all levels (or per-world paintings) once the owner approves.
6. ~~Skins / shop / currency~~ — done (see below).
7. ~~Delete the legacy `Doodle` module~~ — done.

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

## Polish pass (audit fixes)
- **HUD:** one slim top bar (pause · level + one pearl icon per energy ball → gate · air), undo/restart as small round buttons
  bottom-left (`#hudB`), icon-only map button. Score shows only on the result screen. Level name shows once as `#lvlBanner`
  at start (plus a one-time `tip` from `LEVELS` when a new element or world first appears); no brass plaque on the stand.
- **Phone camera:** bigger cells (`innerWidth / 6.4`, 50–66 px) and the tank centred (slightly low) in the free area.
- **Sand:** sun-bleached top → amber → damp russet with depth, saturation boost, lower light response (it was clipping to
  beige). Sand blocks use polygonOffset (edge-on block sides were showing through the face as thin seams under MSAA).
  Treasures are fewer and grouped in patches.
- **Worlds:** `WORLD_STYLE` (frame lacquer, in-tank water colours, glowing specks in the deep, crystal clusters on the
  seabed for worlds 2–3) and per-world shelf mixes (sheet plank / reef coral with polyps / slate / driftwood).
- **Monsters** rebuilt in the diver's style (`monMats`, `cartoonEye`, `rimMat`); crab claws snap.
- **Gate:** beacon halo + ring that brighten per pearl delivered, one slot light per pearl, sparkles when open.
- **Juice:** `popText` floating words ("+1" treasure, "2/3" pearl, "Phew!", "Bonk!").
- **Audio:** pad a little warmer + rare far-off single chimes (still no tune).

## Level redesign (levels 2–30) + gate cue + ending
- Levels 2–11 are now a compact one-idea-per-level tutorial (stones fall, roll left first (tip on 3), two pearls, piranha, jellyfish,
  plug a hole, wall deadlock, crab, fill a shaft, counterweight). Level 1 is unchanged (the intro cinematic plays it).
- Levels 12–30 were rebuilt as constrained "thinking" puzzles (walls/shafts/pockets instead of open sand fields; monsters on the
  solution path; deliberate deadlocks so order matters). Difficulty targets: 12–15 ≥60 moves, 16–20 ≥75, 21–25 ≥90, 26–30 ≥110.
  Per-level design notes (aha, deadlocks, plan, route, blind-solver result) live in `tools/solver/redesign/<n>.json`;
  waypoint plans in `tools/solver/plans.json` (`node tools/solver/build_routes.js <n>` regenerates and checks a route).
  Air on 12 (35 s) and 23 (24 s) is deliberately tight so the capsules matter; others use ≈ route time × 3.5 + 25 s.
- Thick wall masses (a W run with W above/below) render as one merged reef-rock mesh (`massMat`, world-coloured, front faces +
  only the sides that face open water, so no seams); single-row W runs stay shelves.
- When the last pearl goes in: banner "The gate is awake! Swim in!", a bouncing "Swim in!" marker over the gate (`gateArrow`),
  and a reminder toast after 8 s if the diver hasn't entered.
- Ending: winning level 30 turns the result button into "The reef awakens ✨", which opens `#ending` (`openEnding`): story payoff,
  stars/treasures/coins, one-time +200 coin bonus (`save.finished`).

## Level-1 coach + intro film
- **Coach (level 1 only):** `COACH_ROUTE` (the verified level-1 route) is simulated once into reference states (positions of
  pearls/rocks). When the player hesitates (1.2 s first time, then 3.5 s; 6 s once level 1 has stars), it finds where they are on
  that route and shows a glowing trail (`world.setCoachTrail`) to the next spot and an animated swipe hand (`#coachHand`; a key cap
  on computers) for the next move. If the board has left the route, it points at Undo (`#btnUndo.nudge`).
- **Intro film** (`startCine`/`cineTick`): seven beats — night reef with drifting pearl-lights (`world.cineFx.glow`), storm (thunder
  SFX, `#cineFlash` lightning, grit streaks, `cineFx.storm`), darkness, helmet lamp on (`cineFx.lamp`), the first dive, the gate
  waking (`world.cineWake` shockwave + light pours back), wide shot, title on black, fade into the menu. Night is a post-pass grade
  (`night` uniform: mids sink, real lights keep glowing) + `uNight` on the sand shader + seabed tint; low tier falls back to `#cineDark`.
- **Voice-over:** lines in `CINE_LINES` (vo1…vo7); drop ElevenLabs MP3s in `src/assets/vo/<id>.mp3` and rebuild — `build_assets.py`
  embeds them as `AQ_DATA.VO`, `Audio.vo(id)` plays them with the ambience ducked. Script + timings: `docs/voiceover-script.md`.

## Performance + stage lighting
- **Static batching** (`bakeStatic`, end of `loadLevel`): every static sheet sprite, its baked shadow and contact patch is merged
  into one mesh per material; plant sway moved into the vertex shader (`aSw` attribute). Treasures, ledge plants, the gate sprite,
  the foreground fish group, photo backdrop and reef stay separate. Contact-patch materials are shared (`SPR.cm`).
- **Shadow casters:** only character/monster parts bigger than ~16% of the model's size cast real shadows (eyes, teeth, spots don't).
  Together: draw calls −40% on busy levels (845 → ~500), triangles −20%, same picture.
- **Stage lighting in play:** `MAT.lamp` (x, y, radius, strength) + `MAT.lampAmb` drive a warm pool of light around the diver in the
  sand, reef-rock, shelf (`causticify`) and in-tank water shaders, with the far corners of the tank falling gently into shade; the
  painted backdrop and seabed darken and the post vignette deepens (`vig`). Strength per world: shallows mild → the Deep strongest.

## Launch hardening (pre-publish audit)
- `disposeLevel()` (called by `clearLevel`) frees every per-level geometry/material/texture except the shared caches
  (GEO/MAT/TEX/SPR/sandGeoCache). GPU memory now stays flat across level loads, restarts and undos (it leaked ~2 MB per load).
- Undo is refused once a level is won (was an infinite-coins loop); treasures count once per cell per run (`runTreasureSet`).
- Frame loop caps tick catch-up at 300 ms (a long stall used to fast-forward the dive into "out of air"); intro dt capped at 0.1 s.
- Boot ignores taps/keys until loading ends; context restore reloads the right engine (intro/menu/level) and resumes play;
  audio resumes on the next pointerdown (iOS interruptions); SFX reuse one noise buffer; the ending has its own state.
- Saves: damaged fields are dropped; save `v: 2` resets stars/best/tips from the pre-redesign levels (coins/skins/progress kept).
- Air retuned for careful first-time players (levels 11–30; capsule levels 12 → 55 s, 23 → 40 s); hints rewritten on 9/20/22,
  dodge warnings on 4/12/23. All 30 routes re-verified.
- **Crush grace:** a stone/pearl that has dropped exactly one cell onto the diver teeters for one tick (`teeter` event: wobble +
  yelp) before crushing, so the plug-pull dodge is fair. Tracked with `o.fallN` / `o.graced` in `physics()`; monsters get no grace.
- **Phone speed / Auto quality:** recent iPhones (`strongPhone`: iOS, 3x screen) start on High and Auto never drops them below it;
  the boot benchmark warms shaders first and uses a 9-frame median; Auto ignores long gaps and the first seconds after a level or
  tier change (`aqHold`), and if a drop doesn't raise fps it reverts and stops (frame-rate cap, e.g. iOS Low Power Mode at 30 fps).
  Dynamic resolution never goes below 85%. Phones: no MSAA on the screen buffer (post anti-aliases), light rays at 1/8 res,
  standard instead of physical shading on big matte surfaces (`surfMat`), shimmer skips the bottom of the backdrop.
  Settings → Show FPS (`#fpsMeter`) shows fps · tier · resolution on the device.

## Retention + feel pass (daily dive, star map, hints, accessibility)
- **Haptics:** `feel(e)` maps engine events to vibration patterns (dig, push, near landing, teeter, pearl, gate open, bonk).
  iPhone Safari has no Vibration API: `iosTap()` clicks a hidden iOS 18 `<input type=checkbox switch>` label, which plays the
  system haptic (works on iOS 18+, silently nothing on older iOS). Unverified on a real device.
- **Reactive music:** `Audio.swell()` (gate opens: pad swells, filter opens, slow chord) and `Audio.setTension(k)` (air < 15 s:
  pad thins and darkens, chimes stop). Still no melody.
- **Accessibility (Settings):** Relaxed mode (`engine.relaxed`: no air countdown, max 1 star, no best score, not in Daily Dive),
  colour-blind markers (`World.setColorMarks`: ◆ sprite on pearls + gate via shared `MAT.cbMark`, ◆ in HUD pearls), Larger HUD (`zoom`).
- **"Show me" hint (💡 in `#hudB`):** `ROUTES` (synced from tests/routes.json by build.py) drive the coach on any level for 5 moves.
  Free every 90 s, otherwise 25 coins. Off the known route → `offRoute()` offers to rewind to the newest undo snapshot on it.
- **Stuck detector:** `deadPearl()` (pearl below the gate row, or boxed in on a solid floor) → `#stuckCard` with Undo. 0 false
  positives along all 30 verified routes.
- **Streak:** grows past 7; coins rise each week (`dailyCoins`), every 7th day = guaranteed rare item (`giftItem/grantItem`).
- **Weekly challenges:** 3 per week from `WEEK_POOL` (seeded by week number), `weekBump(id, n)` hooks; all 3 → epic item.
- **Best-run replay:** each attempt is logged as a tick route (`runLog`, truncated on undo); the fastest win that re-simulates
  (`checkRun`) is saved in `save.runs[n]` and played back at 2× (`startReplay`, state 'replay'); ▶ on result screen + star map.
- **Share card:** `shareCard()` renders the live tank + result into a 1080×1350 PNG → Web Share (files) or `#shareBox` fallback.
- **Star map:** `buildLevels()` draws a winding path through three world bands; woken gates glow, world decor lights up with the
  number of gates awake, the diver avatar travels to newly unlocked levels (`save.mapAt`).
- **Gate collection in the menu tank:** `world.reefLights` (3 drifting pearl-lights per cleared level) + `world.reefK` (fish pass more often).
- **Daily Dive:** `DAILY_LEVELS` (synced by build.py from tools/solver/daily/*.json, each with a verified route), one per day by
  `dayNum()`, unlocks after level 5. Results: time + air used, coins on the first clear per day (+ dive streak). Leaderboard tabs
  "Today: fastest / least air" read `daily/<uid>` docs (`{day,t,air,nick}`). Publish capabilities now also need
  `{path:"daily",read:"view",write:"owner"},{path:"daily/{self}",write:"interact"}`.
- **Voice lines:** `win1–3`, `lose1–2` play on the result screen if `src/assets/vo/<id>.mp3` exist (script: docs/voiceover-script.md).
- **Per-world paintings:** drop `src/assets/images/background/bg_photo_w2.jpg` / `bg_photo_w3.jpg` (2560×1435) and rebuild.

## Owner's UI art (ChatGPT-made elements)
- Originals (~1 MB PNG each) are NOT kept in the repo. `python tools/compress_ui.py <folders>` trims each one, resizes it to about
  2x its on-screen size and writes `src/assets/images/ui/<key>.webp` (67 files, ~730 KB; number prefix → key table in the script).
  Icons (`i_*`) lose their drop shadow so they work as recolourable masks.
- `build_assets.py` embeds them as `AQ_DATA.UI`; the controller's `applyUiArt()` sets `--ui-<key>` CSS variables, adds
  `body.ui-art`, swaps SVG line icons for `.ico` masks (they take the button's text colour) and puts the 3D objects
  (bag/trophy/gift/scroll/bulb/hand) on the home tiles and hint button. All styling lives in the `.ui-art` block at the end of
  the `<style>` in index.html. Pills use 9-slice `border-image` (slice 14%) so caps never stretch.
- Not used yet: panel, panel_row, chip, air_frame, bar_frame, danger, sparkle (CSS versions look cleaner at those sizes).

## UI redesign (one design system, phone + computer)
- The whole `<style>` in index.html was rewritten from scratch (~600 lines, no layered overrides). Tokens on `:root`
  (`--surface`, `--card`, `--line`, `--glass`, radii `--r-*`, `--shadow`); every size is in rem and `html` font-size steps up on
  big windows (16 → 17 → 18.5 → 21 px) so the UI scales with the screen; 14 px on short landscape phones.
- **Sheets** (levels, shop, rewards, ranks, settings, records, how to): full-screen on phones; a centred window with sticky
  header and its own scroll on ≥760×560 (`.win-tall` levels, `.win-wide` shop). **Modals** (`.sheet.modal`: intro, pause,
  result, ending, name): one card style; win/lose tint the card.
- **Home:** phone portrait = logo · live tank · Daily Dive + PLAY · bottom tab bar (`.hm-nav`, 6 items). Landscape/computer =
  menu column on the left (logo, PLAY, Daily Dive, 3×2 tiles) and the tank moved right: `homeLayout()` sets
  `world.menuShift` from the column width, World shifts the menu camera by that fraction of the view width.
- The `.ui-art` block at the end layers the owner's art on top of this system (unchanged keys).

## Mockup pass (owner's 8 reference screens: home, levels, rewards, win — phone + computer)
- **Home:** phone = logo · tank (camera centred in the free space via `world.menuLift`) · Continue pill · Daily Dive ·
  How to / Intro buttons · floating 4-tab bar (Levels/Shop/Rewards/Ranks). Computer = left column (logo, kicker, Continue ▶,
  Enter hint, Daily Dive) + tank on the right + a 6-item dock across the bottom.
- **Levels** (`#levels.lv`, no longer a sheet): one world at a time over the painted backdrop (`--bgphoto`, world tint), ‹ World ›
  arrows, path + nodes (`renderWorld`, horizontal on wide screens, vertical on phones), diver standing on the current level
  (`diverThumb()` = 3D render without the pedestal, mode 'mascot'), level card with a drawn preview of the real map
  (`drawLevelPreview`): bottom bar on phones, side panel on computers. Tap a level to select, tap again or Play to start;
  mouse drag / wheel scroll the map; Enter plays.
- **Rewards:** 4+3 day grid with the chest spanning two cells on phones, 7 across on computers; weekly challenges + a Weekly bonus
  card (gift art, progress bar, state) beside them on computers.
- **Win/lose:** phone = one card; computer = two columns (title/stars/score + diver mascot | stats with icons, coin breakdown
  rows, Next level, Enter hint, Watch best run / Share) and a Replay · Levels · Home row underneath.
