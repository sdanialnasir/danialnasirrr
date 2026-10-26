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
2. ~~Desktop mouse drag~~ — done (left-drag on the canvas moves the diver; How to play says so).
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
- **Phone speed / Auto quality:** (the old iPhone "never below High" floor was removed — see Graphics tuning below); Auto ignores long gaps and the first seconds after a level or
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

## Speed pass (no quality change)
- **Held frames:** while a screen covers the scene (level map, any sheet/modal: rewards, shop, pause, results…) the frame loop
  draws one fresh frame for the blurred backdrop and then stops rendering (`heldFrame`/`heldDirty`, re-drawn on resize).
- **Level start:** `disposeLevel` no longer disposes materials (that deleted their compiled shader programs, so every level
  recompiled the same shaders), and its shared-resource scan only walks plain objects/arrays/Maps (it used to walk pixel buffers).
  The tank-shadow textures are drawn once (`TEX.tankShadow`, `TEX.shadowBlob`). Level setup 400–700 ms → 30–60 ms (headless).
- **Boot warm-up** loads levels 2, 6, 9, 12 and 21 behind the loader: between them they hold every shader variant the 30 levels use,
  so no level compiles shaders on first visit. `renderer.debug.checkShaderErrors` is off for players (on under webdriver / `?debug`).
- HUD glass no longer uses backdrop blur over the moving canvas; shine animations use transforms; HUD text/attribute writes only on change.
- **Input feel:** a fresh tap runs the next tick early when ≥60% of a tick has passed (less wait before the diver moves); the drag
  stick reaches full speed sooner (`stepInterval`: 470 ms → tick, full at 85% of the ring).

## UI pass 2 (HUD, cards, lose screen, menus, motion)
- All styles are in the "UI pass 2" block at the end of the `<style>` in index.html.
- **HUD:** gold "LV" badge (`.node.lvn`), "AIR" label, bigger round buttons with labels (`.hb-l`: Undo/Restart/Hint/Map). `#btnMap` must
  stay `position: fixed` (a shared rule once made it relative and it jumped to the top-left).
- **Level start (`#intro.lvl-card`):** drawn map preview (`#introPrev` via `drawLevelPreview`), hint, pearls/air chips, star goals
  (`#introGoals`: ★★★ at 60% air left, ★★ at 30%, ★ finish), best badge. Two columns on computers (selector needs `.sheet.modal.lvl-card`).
- **Pause:** level name, stats chips (`#pauseStats`), hint box, 4 tiles: Show me (`#btnPauseHint` → resume + `showMe`), Restart, Sound, Home.
- **Lose:** violet card, danger icon, cause line (`#resCause` from deathCause), score/stars hidden; big button = "Undo last move" when possible.
- **Settings** grouped with coloured icons; **Records** stats with icons + per-world progress (`#profWorlds`); **How to play** art icons,
  2 columns on computers; **Leaderboard** top-3 tinted rows (`data-rank`); **Shop** segmented tabs, glowing stage
  (`.shop-grid` needs `grid-auto-rows: max-content`, cards clip overflow and otherwise get squashed).
- **Motion:** press scale/hover lift on buttons, modals pop in, rows stagger in (`rowIn`), level banner pops.

## Graphics tuning at load (Auto)
- Boot (Auto only) first loads level 21 (one of the heaviest) and runs `world.benchmark(start)`: from the device ceiling
  (`deviceCeiling()`: phones High, computers Ultra; Medium for weak GPUs by renderer string, <4 GB `deviceMemory` or ≤4 cores on phones;
  Low under 2 GB) it times frames with a pixel read-back (CPU+GPU) and steps down until the median fits 15 ms (phone) / 13 ms (computer).
  Slightly over on a phone → same tier at 88% resolution; still very slow on Low → 85%. The loader shows "Tuning graphics: …".
- Then every warm-up level is compiled at the chosen tier (so no shader compiles mid-game).
- When Auto changes tier during play, `world.onAutoTier` saves it (`save.settings.aqTier`); the next launch starts tuning one tier above it.
- No tier floor for iPhones any more (it kept slow phones stuck on High). Phones cap MSAA at 2x on every tier.
- Tests seed `settings.gfx: 'low'`, so they skip the tuning; `tour`-style scripts must do the same or wait ~1 min for the loader.
- **Computers:** pixel budget per tier in `resize()` (low 1.3 / medium 2.2 / high 3.4 / ultra 5.2 megapixels; `prBase` is the tier's
  ratio, the budget and `resScale` are applied on every resize). Big/retina monitors used to draw 8–19 MP per frame. Auto lowers
  resolution on computers too (down to 70%) before dropping a tier, and in play reacts below 50 fps (phones 38). The FPS meter
  also shows the canvas size.

## Resolution setting + visual polish (launch polish)
- **Settings → Resolution:** Auto / 100% / 75% / 50% (`save.settings.res`, `applyRes()` → `world.resLock`). A fixed value overrides
  Auto's `resScale` (Auto then only changes the tier). `#resNow` shows the current % and canvas size. Graphics now also offers Med.
  On phones (≤520 px) setting rows with a `.seg` put the buttons on their own line.
- **One wall look:** every inner wall (`W`), including single-row shelves, is now the world-coloured reef rock (`massMat`) — the random
  plank / purple sponge / slate / driftwood box mix is gone (the shelf code still exists for the old art set only).
  Rock tops/sides sample the cobble texture in their own plane (no more stretched dashes) and tops are a calm sunlit ledge.
- **Sand:** less candy saturation (1.3 instead of 1.5), more of the sheet texture's grain plus fine noise; ledge undersides get a soft
  shade instead of the dotted pebble band.
- Flat placeholder kelp strips / primitive coral fans behind the play plane → the sheet's painted weeds (baked, shader sway).
- In-tank sun shafts halved and softer; the deep's seabed dims under stage lighting but never below 62%.

## Intro film sync + spotlight tutorial + release fixes
- **Intro film lines** (`CINE_LINES` vo1–vo9) are short and plain, and each is said when the picture shows it: 1–4 on the film clock
  (lamp clicks on during "turns on a light"), 5–9 on real events in the tank (first dig, diver above the gate, first pearl push, gate
  opens — the diver then waits 3.3 s at the gate — and the win, with `#cineGates`: 30 gate dots, one lit). In `cineTick`, `T` is the
  clock, so tile types use `T_BALL`. Events must be read before `world.onTick` (it consumes them). Script table: docs/voiceover-script.md.
- **Spotlight tutorial** (`TUT_STEPS`, `startTut` from `beginPlay`, state `'tut'`): the first time levels 1, 2, 3, 5, 6, 9, 12 start, the
  game waits, dims, and a ring circles the thing each line talks about (diver, pearl, gate, air meter, stone, piranha, jellyfish, crab,
  air bubble); phones glide the camera there (`world.focus`). Tap / Enter = next, Skip / Escape = end. `save.tutSeen[idx]`. Voice ids
  t1a… play from `src/assets/vo/<id>.mp3` if present. `__dc.startIndex` skips it (tests); `__dc.tut(i)` forces it.
- **Level-1 coach** shows words beside the hand (`coachSay`: Dig! / Push the pearl! / Swim in! / Swim this way).
- **Release fixes:** Daily Dive build skipped `*_plans.json` (half the days showed "undefineds of air"); favicon/apple icon inlined as data
  URIs by build.py; one name "pearls" everywhere (HUD, results, pop-ups); Click/Press wording on computers; leaderboard text off claude.ai;
  Erase progress = tap twice (no `confirm()`); no auto-fullscreen on computers; `REDUCED_MOTION` disables shake and lightning; Escape goes
  back from menus; ledge/rock plants only grow into empty cells; short laptop screens compact the home column and dock; landscape
  phones keep the bottom buttons off the tank; `--ink-3` contrast raised. Ledge plants no longer grow inside air bubbles/stones/pearls.
- Publish the artifact with `files` for manifest.json and icons/ so the PWA manifest resolves.

## The owner's Meshy diver (skinned model)
- Source: the owner's rigged Meshy GLB (21.7 MB; not kept in the repo). `python3 tools/convert_diver.py <file.glb>` writes
  `src/assets/models/diver.js` (`window.AQ_DIVER`, ~0.6 MB): texture 4096 PNG → 1024 WebP with padded islands, mesh quantised
  (3,142 triangles, 23 Mixamo bones, `mixamorig:` dropped), clips idle/walk/swim/push/run with i16 rotations and in-place hips.
  index.html loads it before game.js; to swap the character, drop in a new GLB and re-run the converter (same rig names).
- `makeDiver()` builds the SkinnedMesh when `AQ_DIVER` exists (else `makeDiverProc()`, the old procedural diver, which also still
  creates the shared skin materials). Bind with an **identity** bind matrix (the inverse binds are in model space). The model is turned
  to face +x and scaled ×0.54 (`GLB_K`) so it matches the old diver's frame: cell fit, shop preview, mascot, death poses unchanged.
- `glbDrive()` (called from the player update) blends stand (walk @0.569 s, paused) / walk (×0.55, it hunches) / swim / float idle /
  push (@0.65 s, paused, also used for digging) so the weights always sum to 1. Procedural lean is scaled ×0.4 for the GLB; turn
  angle 0.72 (more toward the camera) instead of 0.35. Limb/face code writes to dummies; scarf and lamp glow ride on bones (`glue`).
- Shop suits recolour the texture in the shader (`aqSkin`: purple → helmet, yellow → suit, pink → fins, shading kept; default
  Violet Star = untouched texture). Patterned suits lose their pattern on this model. Hats sit on the Head bone.
- Cost (level 2, high): the diver went from 70 draw calls / 35.5k triangles (59 parts) to 9 draw calls / 7.5k triangles.

## Safe undo + live hints
- **Undo** (`undo()`): after popping a snapshot it keeps stepping back (up to 12 more) while `doomed(snap)` — the diver dies within
  10 ticks whether he stays put or makes any single move (oxygen deaths ignored). Then `undoHold`: the frame loop doesn't step the
  engine (stones hang, air paused) until the player presses a move. Toast "Rewound N moves to a safe spot" when it went further.
- **Hints are planned from the live board** (`planFrom`, async, ~14 ms slices, up to 4 s / 20k expansions): first the verified route
  is replayed on a hidden copy from where the diver stands (walk to the route's spot, then the route) and only used if it *wins*
  (`plRoute`); otherwise a best-first search (port of tools/solver/macro.js: walk/dig/push/air macros) looks for a win or a state
  back on the route. The coach then follows that plan (`COACH.plan` = route string + `planRefs`). Coins are charged only when a plan
  exists. Leaving the plan re-plans for free. No plan → `noWayForward`: "No way to finish from here." (search exhausted, no pruning)
  or "I couldn't find a way from here." (budget hit), with "Rewind N moves" to the newest history snapshot whose route still wins.
- Checked: 85 off-route boards (all 30 levels, route prefix + 8 random moves): every plan found replays to a win; the 8 with no plan
  were confirmed hopeless by a 60k-node offline search except one hard level-22 board.
- Plan checks ignore the air clock (a hint is about the path). `plRoute` tries several matching route positions and, on monster
  levels, 0–28 ticks of waiting so the route's timing lines up with where the piranhas/jellyfish/crabs are now (without this,
  levels 6, 18, 20, 25, 26 said "No way to finish" right at the start). All 30 levels give a hint after 0/7/25 s of idling;
  off-route boards: 83/85 planned (the other 2 are truly lost).
- Debug: `__dc.plan(cb)`, `__dc.planCheck(plan)`, `__dc.doomed()`, `__dc.undo()`.

## Game speed (slower, smoother)
- One engine tick is now **225 ms** (was 150): the diver, falling stones/pearls and every monster move 1.5× slower together, so
  every escape and timing puzzle works exactly as before (routes are tick-based; all 30 still win). `Engine.tscale = tickMs / 150`
  scales each level's air (`time`) and the air capsule (+45 s) so the air budget in ticks is unchanged. The intro film keeps 150 ms
  ticks (its voice-over beats); the best-run replay runs at half the tick. Drag stick: slowest step `max(470, tick × 2.1)` ms.
  The diver's glide spring is softer (k 70, damping 0.8) to fill the longer step. Tap = one smooth step, hold = one cell per tick.

## Wow pass (feel + transitions)
- **Win:** `clearStamp()` — a big "Level clear!" / "Perfect!" / "Dive complete!" stamp with stars that chime in (`Audio.star(i)`) over the
  tank; the gate fires a big light ring (`world.ringAt(11)`) and a fountain of pearl-light; the result card follows after 2.1 s (lose: 1.4 s).
- **Pearl delivered:** 0.23 s slow-motion beat (`slowMo`, counted on the frame clock — never wall time), a ring at the gate
  (`ringAt(3.2)`), a higher note per pearl (`Audio.pearl(n)`), the HUD pearl pops (`.pop`). Gate opening: ring `ringAt(7)`.
  `ringAt` reuses the intro film's wake ring (`wakePlay` lets it show outside the film).
- **Transitions:** `wipeTo(fn, ev)` — a bubble wipe (`#wipe`, circle reveal from the tap point + rising bubbles) around level start,
  next level and going home/levels from the result or pause screens; it also hides the level build. Off with reduced motion.
- **Phones, level start:** the camera shows the whole tank for ~1.5 s with the level name, then glides to the diver (first move ends it).
- Title: logo floats, "Tap to start" pulses, bubbles drift up behind. Level-1 coach drops its "Swim in!" word when the gate is open
  (the gate marker already says it). Result card (computers): the diver stands beside the score.

## AAA pass: props + real-audio drop-in
- **Stones** (`makeBoulder`): sculpted sphere (lumps + a few chisel planes, smooth normals), the sheet rocks' cyan vein pattern
  (`rockWebTex`: tiling Voronoi, veins fade in and out) sampled triplanar in the stone's own space so it rolls with it, darker
  underside (vertex colour), three flat barnacles merged into the same mesh. Still one mesh + one material for every stone.
- **Air capsules** (`makeAir`): glass soap-bubble shell (`MAT.airShell`: fresnel rim, clear middle, iridescence), window highlight
  sprite, cyan inner glow, crisp O₂ badge, three tiny bubbles rising inside; bob + jelly wobble in the update loop.
- **Real sound files:** `src/assets/sfx/<name>.mp3` (variants `<name>_2.mp3` …) replace that synthesized sound (random variant,
  ±4% pitch); `src/assets/music/ambience.mp3` loops instead of the synth chords (swell/tension still act through `padF`).
  `build_assets.py` embeds them as `AQ_DATA.SFX` / `AQ_DATA.MUSIC`. Names + prompts: `docs/sound-list.md`. Debug: `__dc.aud.files`.
- Close-up audits must set `camera.near` low (the game camera's near plane is 2, so a camera closer than that cuts through objects).
- **Win moment:** the diver dashes to the gate (it starts ~1 cell behind because of the glide), hops, then spins down into the light
  in front of the gate (z 0.75) with a sparkle trail; the win ring and fountain fire at the gate (the `win` event carries the diver's
  old cell). The gate/win ring is a soft glowing texture (`TEX.ringGlow`) with a second ring trailing it (`wakeRing2`).
- No "All pearls in!" pop on the last pearl (it sat on the "Swim in!" marker); the clear stamp hides the gate banner.
- **SFX reverb:** a generated stereo impulse response (2.4 s, unit energy, darker as it decays) through a ConvolverNode at 0.32 wet,
  plus a faint short echo; replaces the old slap-back delay.
- **Crush:** the diver flattens *in front of* the stone (z 0.14 → 0.5), turned to face the camera so the squash spreads sideways;
  the red "!" is hidden on death; dizzy stars a bit bigger.
- **The Deep (world 3):** sparse, slowly pulsing cyan lichen spots on the front faces of the reef rock (`massMat`, world 2 only).
- **Feedback:** air capsule pickup shows "+45s air" + a cyan burst; undo blinks the screen edge blue (`#fx.rewind`) and puffs bubbles
  around the diver; the result score rolls up (1 s ease-out, after a 0.25 s beat). "Watch best run" button label is now "Best run"
  (aria-label keeps the full text) so it fits on one line on phones.

## Launch-readiness pass (first-run audit)
- **Air starts on the first move** (`Engine.begun`, set when a move is queued or held): reading the level card, the spotlight tutorial
  or the coach no longer costs air (a new player lost 10 s on level 1 before moving). Daily Dive race time counts from the first move
  too (`begunAt`). Routes are unaffected (they move at tick 0); `tools/solver/engine.js` regenerated. Tutorial air line says so.
- **Boot guard** (inline script before the game scripts in index.html): no WebGL → a plain message + Reload on the loader (the test
  context is released at once); an uncaught error while the loader is up → "Something went wrong while loading" + Reload.
- Low-tier film night overlay (`#cineDark`) multiplies deep blue instead of a flat navy wash.

## Home v3 = the owner's phone mockup (phone portrait) + cyan water
- **Phone portrait home** (`@media (max-width: 760px) and (orientation: portrait)`, "Home v3" block at the end of the `<style>`): painted
  backdrop (`--bgphoto`, cyan haze, CSS light rays + rising bubbles, blurred corals in the bottom corners), the logo, the owner's waving
  diver (`ui/home_diver.webp`, cut out of the mockup with rembg isnet-anime; `#hmDiver`, floats), a **level card** (`#hmCard`: "Level N"
  tab, glowing cyan frame, a photo of the next level's tank in `#hmCardCv` taken by `world.tankShot(cv)` through the shared context;
  `homeCard()` loads that level for one frame and restores the menu scene; cached per level in `cardKey`), a two-line gold
  "Continue / — Level N —" pill (`#playMain`, `#playLv`; `#playSub` is the one-line version for other sizes) on a rock ledge, navy Daily
  Dive bar, purple How to Play + blue Intro, navy tab bar. The 3D scene is fully covered there, so the frame loop holds (`HM3`).
  Other sizes keep their layout but take the mockup's colours (navy Daily Dive, purple/gold avatar, navy nav).
- **Title tap ghost click fixed:** the title opens on pointerup and the following click used to hit the menu button under the finger
  (it started a level). `clickGuard` swallows exactly that one click.
- **Water toward cyan:** `WORLD_STYLE` lo/hi shifted (shallows lo .04,.42,.64 / hi .2,.84,.97; caves and the deep a touch cyan too),
  scene background 0x138ccf, fog 0x0a5a8f.

## Social sharing + VIP suit
- **One share sheet** (`#shareBox`, `openShare(title, {blob, name, text})`): `drawCard(L)` draws the 1080×1350 picture (a result when `L`
  is given, otherwise a "Can you wake all 30 gates?" card). Opened from the result screen (`shareCard`), the Rewards banner (`#rwVip`)
  and the VIP shop card (`shareGame`). Brand buttons open each composer prefilled (`netUrl`: X intent, Facebook sharer, WhatsApp,
  Telegram, Reddit submit, Threads intent; text + link + #AquaEnergizer); "More" = the phone's share menu with the picture (Instagram,
  TikTok…). If a popup is blocked the text is copied instead. **`PUBLIC_URL`** (game.js, sharing section) must be set to the hosted
  address once the game is public; until then shares carry no link (Facebook then copies the text and opens facebook.com).
- **VIP Black Gold suit** (`SKINS.suit` id `vip`, `vip: true`, rarity 'vip'): never sold or gifted (`giftItem` skips it, `owns` doesn't
  treat price 0 as owned). Claim = paste a link to a single post on a public network; `POST_RX` checks its shape (X status, Facebook
  post/permalink/share/reel, Reddit comments, Threads post, Instagram p/reel, TikTok video, LinkedIn post). WhatsApp/Telegram chats
  don't count. Stored as `save.owned['suit:vip']`, `save.vip`, `save.vipPosts` (no reuse of a link). A web page can't see whether a
  post is public or mentions the game: real checking needs a small server (e.g. X/Threads/Instagram/TikTok oEmbed answer only for
  public posts) once the game is hosted.
- **Home spacing (phone):** bigger gaps between Continue, Daily Dive, How to Play/Intro and the tab bar (1–1.05 rem; tighter on short phones).

## Share clips + premium outfits
- **Clips** (`shareMoment` → `makeClip(lastRun)`): every finished run (win or fail, `lastRun` = level + `runLog` + cause) can become a
  ~10 s 720×1280 video: the last ~4.5 s re-simulated from the move log (`simTo`) and played live, then an **INSTANT REPLAY** of the
  ending at 0.35× with a tighter crop, then an end card. Fun captions per outcome (`CAPS`: crushed / monster / oxygen / win / bonk) so
  fails are shareable, not braggy. State `'clip'` runs `clipFrame` from the frame loop; the world camera is held on the whole tank
  (`world.peek`, `peekK = 1`) and `clipDraw` crops around the diver/gate (framed on the tank's screen rect). Recorded with
  `canvas.captureStream(30)` + `MediaRecorder` (mp4 when supported, else webm) with the game sound from `Audio.capture()`
  (MediaStreamDestination on the master bus). `#clipBox` shows the recording live with a progress bar and Cancel. The result opens the
  share sheet with the video (`#shareVid`, "Save video", "More" shares the file). No MediaRecorder → picture card fallback.
  The result screen's Share button reads "Share clip" / "Share this fail 😂" (shown on fails too).
- **Premium outfits** (`vip: true`, rarity 'premium', unlock by sharing only — one public post link = one outfit, the player picks
  which in the share sheet chips `#vipChips`; the shop's "Share to unlock" preselects it): VIP Black Gold, **Shark Suit**, **Merdiver**,
  **Robo Diver**, **Kraken**, **Abyss Angler**. Each = recolour + real geometry from `makeKit(id)` glued to bones in `makeDiver`
  (shark jaws/teeth framing the face + head fin + tail + side fins; mermaid tail + shell crown; jetpack with flickering flames + antenna +
  shoulder lights; octopus hood with eyes + 6 swaying tentacles; angler lure with glowing bulb + glowing dots + fangs). Measured frame:
  feet y −0.556, helmet −0.08…0.395, hips −0.23, Spine2 −0.12, face front x ≈ 0.2. **Animate an inner child, never the glued object**
  (its rotation holds the bone-space offset). Head-piece outfits hide hats. The shop preview rebuilds the diver when the kit changes.

## Real sound + music (replaces the synth)
- `tools/make_sounds.py <sources>` builds `src/assets/sfx/*.mp3` (37 files incl. variants) and `src/assets/music/{menu,play,deep}.mp3`
  (looped excerpts with an equal-power crossfade, 64 kbps stereo). Sources + licences: `docs/audio-credits.md` (Kenney CC0 recordings,
  uiSFX CC0 'dreamy'/'soft' cues, physically modelled bubbles; music CC BY 4.0: Kevin MacLeod "Chill Wave", Gravity Sound "Meadow" /
  "Soundscape Dark" → **Settings › Credits** must stay). The source packs are not in the repo (fetched with git/npm, see the script header).
  Everything gets an underwater treatment (low-pass, short dark reverb) baked in; the runtime reverb is lighter when files exist.
- `Audio.playFile(name, rate, gain)` uses per-sound levels (`GAIN`); `pearl(n)` / `star(i)` pitch the recorded cue up per step.
  Synth voice squeaks (`VOICE`) are off when recordings exist. Synth chords/chimes are muted when music tracks exist.
- **Music** streams through two `<audio>` elements (crossfade 1.6–2.2 s) → low-pass `TR.f` (tension muffles it) → music bus.
  `Audio.music('menu'|'play'|'deep'|null)`: home = menu, levels 1–20 + Daily = play, 21–30 = deep, intro film = none. iOS: both
  elements are primed on the first tap (`primeTracks`).
- **Limiter** (DynamicsCompressor) after the master; share clips and tests capture *after* it (`outNode`). Measured on a level-2 run:
  peak −1.5 dBFS, no clipped samples, effects ~10 dB over the music.

## Danger glow (fair deaths)
- `dangerScan()` (controller) runs after every play tick when a monster, or a stone/pearl within 2 columns above the diver, is
  near: each of the 4 neighbour cells is tried on a hidden copy of the board; the cell glows red (`world.setDanger`, pooled
  sprites, `dangerUpdate`) if that move kills him or leaves no escape (`escapes`: breadth-first, ≤ 6 moves, waiting allowed,
  ≤ 400 boards, budget out = "safe"). If standing still is fatal but a move saves him, the "!" over his head lights too. Air ignored.
- Checked: 0 red cells stepped into along all 30 verified routes (no false alarms); random play: 83% of monster deaths and ~47%
  of crushes were warned on the fatal input. ≤ 6.5 ms per tick headless. Settings → Danger glow (`save.settings.danger`, default on).
  Debug: `__dc.danger()`.

## Home v3 on computers (the phone mockup, laid out for wide screens)
- `@media (orientation: landscape) and (min-width: 760px) and (min-height: 521px)` ("Home v3 for computers" block at the end of the
  `<style>`): same painted backdrop / rays / bubbles / corals as the phone; `.hm-col` becomes a two-column grid (logo + CTA column on the
  left: gold two-line Play/Continue pill on its rock ledge, navy Daily Dive, purple How to Play + blue Intro; the stage on the right:
  waving diver beside a big glowing level card, sized with container units so it never overflows); a floating 4-tab bar centred at the
  bottom (6 tabs on screens ≤ 660 px tall, where How to / Intro leave the column). Steps for ≤ 820 px, 821–999 px and ≥ 1800×1000 px.
  The Enter hint only shows on ≥ 1000 px tall screens. Short landscape phones (≤ 520 px tall) keep the older column + live tank.
- JS: `HM3` is now phone portrait (`HM3P`) OR this computer query (`HM3D`); both get the tank photo card and hold the frame loop.
  `homeCard()` draws the photo at the card's real pixel size (160 px steps, up to 1440 wide; re-shot 250 ms after a resize).
  `tankShot` now fits the whole tank in the card (diver, pearls and gate visible) instead of cropping.
- `ui/home_diver.webp` cleaned: the see-through ghost hand (bottom right) removed; the cut air-tank edge on the left fades out.

## Mix: music lower, gameplay louder (owner request)
- Music tracks `TR.g` 0.62 → 0.55, and the synth bed under them (ocean swell noise + hum in `startMusic`) × 0.4 when music files
  exist (`bgK`) — that bed was most of the "background" loudness. Effects × 1.35 in `playFile`.
- Limiter threshold −12 → −6 dB (ratio 12, knee 6): at −12 it was flattening the effects back down. A soft clipper (WaveShaper, linear
  below −3 dBFS, tanh above) follows it and is now `outNode`, so stacked big cues can't overshoot.
- Measured (raw samples after the clipper, level 1 menu → play music + a burst of effects + 6 big cues stacked ×3): music −17.7 → −23.0 dB
  RMS, loudest effects −10.0 → −6.9 dB, peak −0.6 dBFS, 0 samples over full scale. Script idea: tap `capture()`'s destination with a
  ScriptProcessor via an init script (Opus-encoded recordings show false overs).
