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
- **Camera:** computer = closer in (74% of the whole-level distance) and follows the diver; Map button / hold M shows the whole
  level (owner reversed the old "no zoom on desktop" rule). Phone = follows the diver with slight
  look-ahead and smart zoom; hold the map button to see everything. Since the 3D-camera pass: a wider lens (38→46° FOV, closer) and a
  slight side angle (yaw) so the tank reads as 3D; no extra up/down tilt (owner: tilting looks bad).
- **Gameplay helpers:** undo (↶ / Z, up to 200 moves, also from the "Crushed!" screen), instant restart
  (⟲ / R), star thresholds on the air bar, hint on the pause screen, "stuck?" tip after 22 s, red "!" when a
  stone/pearl sits right above the diver.

## Things the owner explicitly does NOT want
- The old flat doodle / stickman style in levels or menu (tried, rejected). Notebook-doodle style: rejected.
- Boxy blue tiles inside the tank; rocks that look like they should fall; melodic music; harsh dig sounds.
- Clutter crossing the playfield. (Camera zoom on desktop used to be on this list; the owner now wants the closer, following camera.)
- Inventing new mechanics without asking (spikes/crate exist in the engine but are unused in current levels).

## Hard constraints
- The deliverable must stay a **single self-contained HTML file** (`dist/index.html`): no network requests
  except Google Fonts. claude.ai artifacts block other external resources. Keep it under ~16 MB.
  Exception (story v4): the recorded story voices ship as optional companion packs `dist/assets/voice-1..3.js` (same origin; publish
  them with the artifact's `files`). The page must keep working without them.
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

## Volume sliders (Settings + pause screen)
- Three channels in `Audio`: **music** (the songs: `TR` tracks → `musicBus`), **amb** (the synth bed: ocean swell, hum, pad, chimes,
  far bubble trails, the optional ambience file → `ambBus`), **sfx** (`sfxBus`). `Audio.setVol(k, 0..1)`; gains are squared
  (`gMusic` 0.6·v², `gAmb` 0.6·v², `gSfx` 0.9·v²). Voice-over ducks music and amb.
- Controller: `save.settings.vol = { music, amb, sfx }` (defaults 0.55 / 0.8 / 1; old saves map the "Ambience"/"Sound effects" switches
  to 0), `applyAudio()`, `syncVolUI()`. Every `input.vol[data-vol]` slider (3 in Settings, 3 in the pause card's `.pz-vol`) stays in
  sync; releasing the effects slider plays a pearl chime as a preview. The pause "Sound" tile is now Mute all (`save.settings.mute`);
  moving any slider above 0 unmutes.
- Default mix measured: music + bed −29 dB RMS (was −23 last pass, −17.7 originally), loudest effects −7.5 dB, peak −0.6 dBFS.

## Push feel + round stones + cyan theme
- **Pushing** (entity update, ROCK/BALL branch): a pushed pearl/stone now rides at the diver's spring position + 1 cell (`follow`), so the
  gloves stay on it the whole way; switching between following and free motion is blended (`ent.offX` decays). It rolls exactly as far
  as it travels (`spin.rotation.z -= dx / r`), no fixed-rate spin and no quarter-turn snapping. The landing squash only fires after a
  real fall (`ent.fellRows`); before, every push ended in the same squash, so pearls looked like dented eggs ("distorted/broken").
  A little sand dust rolls off under a pushed object. Diver push lean 0.31 → 0.2 (the helmet sank into the pearl).
- **Stones** (`makeBoulder`): round outline (no 1.06×0.9 oval, gentler lumps, shallower chisel planes) and no baked dark underside
  (it rolled round to the top); a rolling stone no longer wobbles or lifts off the floor.
- **Cyan theme** ("Cyan theme" block at the end of the `<style>`): `--surface` runs blue → teal-cyan with a cyan sheen at the top,
  cyan lines/glass edges, modal cards / tiles / panels / HUD pills / home dock + Daily Dive get cyan borders and glows; volume sliders
  fill cyan → gold.
- Test-harness note: don't name a page global `__T` (the game sets `window.__T`), and screenshot right after driving a frame (a pause
  lets the browser drop the WebGL drawing buffer, which looks like a blank level).

## Fun pass (owner-approved): combos, hidden relics, reactions, level-start reveal
- **Combos** (`fun(e)` from `tickWorld`, controller): a stone dropped on a monster → "BONK!" (+15), two pearls delivered within 14 ticks →
  "DOUBLE!" (+20). Each = a big tilted stamp (`#comboStamp`, `comboStamp()`), a 0.4 s slow-motion beat, a star chime, a buzz, and coins
  paid on the win (result row "Combos"). Keys (`RUN.keys`, e.g. `bonk:<type>@x,y`) make each count once per run, so undo-and-repeat
  can't farm them. Not in replays or clips. Natural combos exist on the verified routes of 15 levels (bonks) and level 4 (double).
- **Hidden relic** (one per level, all 30): an ancient gold trident coin (`world.setRelic`, `MAT.relic`, `TEX.relicFace`) buried in a cell
  chosen by `relicCell(i)`: reachable (BFS over the start board plus checkpoint boards along the verified route), never visited by the
  route, not under a stone/pearl; prefers buried sand far from the route, falls back to a cell just off it, and as a last resort monster
  water (a guarded relic: levels 17, 23, 24, 26). Buried: only a soft glint on the sand every ~3 s. Dug out: it floats, sways (trident
  face always visible), glows and sparkles. Taking it (`fun` → `world.collectRelic`): burst, "Relic!", toast "Ancient relic found! n/30",
  `save.relics[n]`; +50 coins on that level's next win (`save.relicPaid`). Level card shows "A relic is hidden somewhere here" / "Hidden
  relic found"; Records shows hidden relics n/30. Found relics don't reappear. Checked: all 30 reachable alive (search from points along
  each route, `relic_reach2.js` idea).
- **Reactions**: a pearl delivered (not the last) → joy + "yay"; a monster that came adjacent and moved on → dodge hop (`world.dodge`) +
  "Close one!" (max every 2.5 s); air < 10 s → `world.lowAir`: the diver shivers and gasps bubbles.
- **Level-start reveal** (`levelReveal()` from `beginPlay`): one ring ping per pearl (left to right, rising pearl chime) then the gate
  (hint chime + "Gate" label), 0.42 s apart (`world.reveal`, `funUpdate`). Doesn't block input; no camera move (desktop camera stays still).
- Debug: `__dc.relic(i)`, `__dc.run()` (combos, relic state), `__dc.tick()` (one exact engine tick through the normal event path; use it in
  tests instead of wall-clock frames when timing matters).

## Visual polish: crisp rock, seabed depth, banner
- **Reef rock** (`massMat`): `TEX.cobbleRock` is now a crisp 1024 px tileable height map (jittered grid of rounded cobbles, dark mortar,
  small pebbles packed into the gaps, fine grain; anisotropy 4), sampled at 0.3 per world unit, with **bump lighting** from two extra
  taps (stones lit from the top-left like the key light). The old 256 px soft texture looked blurry at phone zoom.
- **Sand overhang shade** fades out at the ends of an overhang (diagonal neighbours from the mask) instead of stopping square at a cell
  edge (it left a dark notch at cavity corners).
- **Seabed depth**: a nearer, sparser prop layer (z 2.6–4.8: bigger weed clumps, shells, stones with ground shadows) so the band of
  seabed in front of the tank isn't empty on phones.
- **Level-name banner** hides on the first move (`banner.start`; banners with a new-element tip stay their full time).
- Audit tip: phone screenshots need an iPhone user agent (`isMobile` is UA-based), otherwise the camera uses the computer framing.

## Calm sound palette + water ambience (owner: "soothing, calm, clean"; the level-clear sound was annoying)
- `python3 tools/make_calm_sounds.py` (no inputs) re-makes win, star, pearl, absorb, gateOpen, gateLocked, death, monsterDeath, bite,
  lowAir, click, hint, undo, treasure(_2/_3), air, bump, land(_2) as soft mallet notes (fundamental + fast-fading 2nd/4th partial, slightly
  detuned twin) in **C major pentatonic**, warm sine pads, modelled bubbles and low filtered-noise "water" whooshes, all low-passed and put
  through a long dark stereo hall. Run it **after** `make_sounds.py` (which still makes dig/push/roll/swim/bubble from recordings).
- It also writes `src/assets/music/ambience.mp3`: a 32 s seamless stereo underwater loop (deep rumble, slow swells, moving water band
  420–1300 Hz so phone speakers carry it, panned distant bubble streams, sparse fizz). It plays on the **Ambience** channel; when it
  exists the synth swell/hum (`bgK` = 0) and synth bubble blips are off. Kept at 32 s because decoded audio is ~11 MB.
- Game side: pearl and star pitch steps are pentatonic (`[0,2,4,7,9,12,14]`, `[0,2,5]`); the level clear chimes once (the clear stamp's stars
  + the win cue: the result card's star chimes and the coin-count chime are gone); low-air pulse every 2.4 s (1.3 s under 6 s, was 1 s / 0.5 s);
  swim gain 0.2, star 0.42, lowAir 0.34. Measured mix (level, default sliders): music + ambience −26 dB RMS, ambience alone −27 dB,
  loudest effects −6.8 dB, peak −0.6 dBFS, no overs. Credits: docs/audio-credits.md (calm palette is original, no credit needed).
- **Tunnel water** (`MAT.waterBack` shader): soft slanted sun shafts that sway slowly (strongest under the surface), tiny drifting motes,
  the tunnel floor a touch deeper. A few ALU ops, no extra draws. Measured headless (software GL, level 21): within noise of before.

## Modern pass (owner: "it looks flashy; give it a modern touch, modern sound")
- **Fonts:** Google Fonts now loads **Outfit 700** (display; only one weight is loaded, so every `font-family: var(--display)` renders as
  700 even where rules say 400) and **Nunito 600–900** (text). Baloo 2 / Lilita One are gone. Canvas pop words use Outfit with a soft
  shadow instead of a thick navy outline.
- **"Modern pass" CSS blocks** (end of the `<style>`, they override everything above with `!important` where needed): deep navy-teal
  `--surface`, frosted modal cards (hairline border, soft shadow, `backdrop-filter` only on menu cards over the held backdrop — never on
  the in-game HUD), white titles without 3D shadows, muted kickers, **flat warm-gold primary buttons** (the 9-slice pill art is switched
  off: `border-image: none`), translucent secondary buttons/tiles, glass HUD buttons with white icons, glass home pieces (Daily Dive,
  tab bar, How to Play/Intro, avatar/coins), the rock ledge under Continue removed, level card with a hairline frame, shop items /
  reward days / stats / world header / coin box / sticky sheet headers as frosted cards, selected items tinted gold. Clean stamps
  (`comboIn2`: no tilt, no stroke).
- **In-game calm-down:** the white screen flash is now a faint cyan breath (`fxflash2`), camera shake ×0.5 (`sh` factor 0.25),
  no "Phew!" / "Bonk!" / "Close one!" pop words (stamps and the dodge still show), post grade saturation 1.24 → 1.08, filmic S-curve
  0.62 → 0.42, bloom ×0.85.
- **Sound:** UI and small cues are drier and tighter (hall wet 0.05–0.14, shorter tails); the click is a soft tactile tick
  (rounded 1.15 kHz tap + 320 Hz body) instead of a water drop. Level clear / gate keep their gentle space.

## Immersion pass (owner: "more immersion... aesthetically pleasing... keeps playing")
- **Underwater hearing:** music + ambience go through one low-pass (`muffF`/`muffG` in Audio, `Audio.muffle(k)`); `hearing()` (called from
  `show`/`setState`) closes it on pause (k 1), the result card (0.75) and menu sheets over home (0.4), and opens it in play/home/title.
  Effects are never muffled.
- **Living menus:** `.caus` layers (home backdrop + `#lvBg`) drift a generated caustic tile (`--caus`, 256 px Voronoi edges made once at
  boot) with `mix-blend-mode: screen`, transform-only animation. Computer home: mouse parallax (`--mx/--my` on `#home`, diver/card/corals/
  rays/logo move different amounts via the `translate` property). Off with reduced motion.
- **Quiet HUD:** `body.swim` while the diver is moving (within 1.2 s of a move/hold/drag): top bar 62%, bottom buttons 45%. Never while
  air ≤ 15 s.
- **Star chest** (`CHEST_N = 9`, `chestAdd`, `save.chest = {n, o}`): each *new* star (above the level's previous best) fills it; full = 75
  coins (result row "Star chest"), every 3rd chest also a rare item (`giftItem(300, 600)`). Shown in Rewards (`#rwChest`) and on the result.
- **Result goals** (`#resGoals`, `renderGoals`): star chest bar (animates from the old fill; pops open with `chest_open` art), world progress
  ("Coral Caves · gates awake 4/10"), and on a fail "So close! 1 of 2 pearls in". Hidden on the Daily Dive. Debug: `__dc.save`.

## Full audit pass (every screen, phone + computer)
- **Real level photos:** `levelPhoto(cv, i, locked)` renders the level's actual tank through `world.tankShot` (cached per level + size in
  `photoCache`) for the level card (`#introPrev`; the live level is shot directly), the level map panel (`#lvPrev`; locked = blurred + lock)
  and the home card (now loaded as a normal level, `e.photo`, so worlds 2–3 show their own colours; it used `e.menu` = world 1 look).
  The drawn map (`drawLevelPreview`) remains only for the Daily Dive and as a fallback. Wide level card canvas 560×490 (cover-fit).
- **How to play:** the sand and stone icons are 3D renders (`World.iconShot('stone'|'sand')`: the real boulder, an extruded block with the
  sand texture), made once when the screen first opens.
- **Reef rock:** finer cobbles (texture scale 0.3 → 0.42), per-stone tint variation (greyer/warmer), a little algae on upper faces in
  worlds 1–2. **Switches:** flat modern track (cyan when on) instead of the skeuomorphic toggle art. **Records:** relic stat icon is a gold Ψ
  coin. **Leaderboard:** no "0" score column; an empty-state card (trophy art) when online ranks aren't available.
- Headless-only artifacts (not bugs): level map not scrolled to the current level, swatch shop cards, empty shop stage, score "0" on
  the result card — they all wait on rAF / idle timers that the tests freeze.

## Glossy UI (the owner's home mockup) + reliable hints
- **Look:** the "Glossy" block at the end of the `<style>` replaces the Modern pass look everywhere (home, sheets, modals, HUD, toasts):
  Fredoka (display + buttons) / Nunito (text) from Google Fonts; glossy navy panels (`--gp`, `--gp2`) with a bright blue bevelled rim
  (`--rim`) and a dark outline (`--out`, via `--gsh`); a glossy gold pill (`--gold-g`, dark-orange outline, top gloss) for primary buttons;
  the Continue pill carries an orange glossy play button (`#btnPlay::after`); green glossy "+" on the coins; purple/orange icon tiles for
  How to Play / Intro; the level card has a thick blue frame, a navy tab and a starfish. Every selector there starts with
  `html body:is(.ui-art, :not(.ui-art))` so it outranks the older `.ui-art …` rules (specificity bug: `html body .play-big` lost to them).
- **Hints froze the world:** while a hint is planned (`findPlan`) `planHold` stops engine ticks (air paused, monsters/stones wait), like
  `undoHold`; any move cancels the search. Before, the game kept running for up to 4 s, so monsters/falling stones moved on and the answer was
  thrown away silently or arrived out of step ("it says finding a way, but it does not").
- **Exact hint search for rooms without monsters** (`xPlan`, same method as tools/gen/exact.js): resting boards are one state per
  (board, the diver's pocket of open water); each step = swim to a pocket cell + one move into something; while anything falls, every tick
  is searched. Best-first toward the goal but complete, so "No way to finish from here" is a proof. Monster levels keep the macro search
  (air ignored there now too, budget 7 s / 60k expansions).

## Generated levels: tried and reverted (owner: keep the original levels)
- Levels 13–30 were briefly replaced by solver-generated rooms (tools/gen/). The owner didn't like them (repetitive, still felt easy),
  so the original LEVELS + routes are back. **Keep the current 30 levels.** tools/gen/ (exact.js complete solver/difficulty meter,
  gen.js generator, curate.js, install.js lineup installer) stays for reference only; don't swap levels without the owner asking.

## Hint cards + rewritten hints and intros (owner: "the introduction texts look off, boring, outdated")
- **Copy:** every level `hint` was rewritten short and punchy; `**words**` mark the key idea and render gold (`rich()` in the controller
  escapes HTML, then turns `**x**` into `<b>`). The old one-line `tip` strings are gone: levels with something new now carry
  `intro: { ic, k, t, d }` (icon kind, kicker like "New creature" / "Twist" / "World 2", title, line) — levels 2, 3, 5, 6, 9, 11, 12, 14, 18, 21.
  `TUT_STEPS` lines got a label `k` ("New: piranha", "Stay safe"…) and the same `**…**` emphasis.
- **Look:** level card + pause = a "The trick" tip card (`.tipcard`: gold bulb tile, label, text); the level card's pearls/air chips became an
  "In this dive" kit row (`#introKit`: pearls, stones, piranhas, jellyfish, crabs, air capsules counted from the map, each with a 3D icon,
  then the air). The level-start banner shows the intro as a glossy card under the level name (`#lbCard`, 4.6 s, once per level via
  `tipsSeen`). Tutorial bubble = icon of what it talks about + label pill + text + step dots + gold "Next ›" / "Let's dive ›" pill.
- **3D icons:** `World.iconShot(kind)` now also renders pearl, fish, jelly, crab and air (plus stone/sand); the controller caches them as
  CSS variables `--ic-<kind>` (`needIcons`). World intro cards use the coral / crystal UI art.
- Bug fixed: a spotlight tutorial left open (e.g. restart or home during it) carried over into the next level; `startLevel`/`openHome`
  now close it. Debug: `__dc.card(i)` opens a level's card.
- Don't name a class `air` inside cards: the HUD's `.air` styles (air meter) leak onto it.

## Expert pass (pre-launch review → docs/expert-review.md)
- **The list** lives in `docs/expert-review.md` (P0/P1/P2 with status); keep it updated when items land.
- **Loader:** painted backdrop + rays + corals, glossy gold bar with stripes, the waving diver riding the bar (`--ldp` set by `prog`),
  rotating gameplay tips (`#ldHint`, cleared in `dropLoader`).
- **Title (`#splash`):** painted reef (`.ts-bg`), logo, kicker, hero = waving diver in front of a slow light burst with three glowing
  red pearls, gold "Tap to dive" pill; pieces fade in when the title is shown (so it can't be tapped "too early" unnoticed). The 3D
  scene is fully covered there, so the frame loop holds (`covered` includes splash).
- **Intro film:** night grade lifted (sand `uNight` tint, post `night` mix, exposure floor 0.36, backdrop tint, low-tier `#cineDark` 0.62);
  captions are a frosted pill whose words fade in one by one (`cap()` wraps words in spans); letterbox bars slide in; Skip is a glossy
  navy pill with a gold progress ring (`--sp` = film time / 48 s).
- **Finale** (`finale(done)`, `#finale`): after level 30 → 30 gate lights wake one by one with rising notes, fireworks + confetti on a
  2D canvas (own rAF loop), title + waving diver, then a credits roll (`.fc-roll`, keep it in step with Settings › Credits), then the
  end card (`openEndCard`). Tap / Enter / Escape skips. Reduced motion goes straight to the card.
- **Level intro card** (`#lbWrap`, moved out of `#lvlBanner`) sits at the bottom above the round buttons and the first move clears it
  (`bannerOff()`), so it never covers the board.
- **Reef rock:** two stone sizes blended by a macro pattern, broad light/dark patches, depth = distance to open water (≤ 2 cells, from
  the mask) so thick walls sink into shade, a lit bevel on top/left edges and a crease on right/bottom. Deep-world lichen spots sparser.
- **Waterline:** soft meniscus with moving glints instead of a ruled line. **Daily Dive card** uses the real tank photo
  (`levelPhoto(cv, i, false, live)`). Level-30 button "Wake the reef ✨" (no wrap). Social meta tags added (og:type, twitter card).
- **Size:** sheet sprites + the painted background are embedded as WebP (`webp()` in build_assets.py, `exact` keeps edge colours);
  the unused old art set (`ART_SRC`) is no longer embedded. dist 12.0 MB → 9.3 MB.

## Limited undo + moonlit night (owner: "unlimited undo is unwanted… it should show in a difficult spot"; "night scenes look dull")
- **Undo is a lifeline:** `UNDO_MAX = 3` per attempt (`undoLeft`, refilled by `startLevel`, so Restart gives 3 again; Relaxed mode =
  unlimited, button always shown). `#btnUndo` is hidden in calm play (its slot stays, so Restart/Hint don't move) and pops up glowing
  with a count badge (`.ub-n`, red on the last one) when `undoNeed(ms)` fires: danger glow finds a fatal cell or standing still is fatal,
  a pearl is stuck, the 22 s "stuck?" tip, the level-1 coach's "Oops", after a crash (state 'over'), and for 2.5 s after an undo.
  `undoSync()` runs from the frame loop. Z/U/Backspace only work while the button is up (otherwise a toast explains). The lose card
  reads "Undo last move (n left)" or "Try again" at 0. The hint's "Rewind N moves" is part of the paid hint: `undo(true)` is free.
- **Night grade** (post `night`): moonlit split-tone (indigo shadows, teal mids, silver highs, moon glow from the surface), strong reds
  (the pearls) kept glowing warm; sand `uNight` is now only a cool tint (the grade does the rest).

## Soft reward sounds (owner: the pearl-in and escape sounds were "shrill and annoying")
- The old cues were long ringing mallet bells, stacked: pearl-in = `absorb` bell + a pitched `pearl` chime (up to +14 semitones); gate
  opening = `gateOpen` bell pair + `Audio.swell()` opening the pad filter to 12 kHz at 2.3× gain with four extra sine notes; escape = `win`
  arpeggio + three `star` chimes.
- Now (`tools/make_calm_sounds.py win star pearl absorb gateOpen` — the script takes cue names to regenerate only those): `absorb` = one
  low water "whoomp" + bubbles; `gateOpen` = a low warm swell; `win` = a warm low chord breathing in/out + rising bubbles; `star`/`pearl` =
  soft low bloops. All low-passed at 1.2–1.5 kHz, little reverb, no bell partials. The absorb event no longer adds `Audio.pearl`; pearl
  pitch steps capped at +7; `swell()` only lifts the pad a little (≤ 2.2 kHz); GAIN absorb .42, gateOpen .45, win .48, pearl .36, star .32.
- Measured (mixed as in game): escape loudest −15.1 → −19.8 dB, energy above 800 Hz 23% → 0%; pearl-in −17.5 → −24.9 dB.

## Voice-overs: ElevenLabs generator + more lines
- **`make_voices.bat`** (repo root, Windows) → `tools/make_voices.ps1` (PowerShell 5.1-compatible, ASCII only) reads **`tools/voices.json`**
  (46 lines: 28 narrator, 18 diver; shortlist of voices with ids; model `eleven_v4` → fallbacks `eleven_v3`, `eleven_multilingual_v2`
  with [tags] stripped) and writes `src/assets/vo/<id>.mp3`, then runs `tools/build.py` if Python exists. Modes: audition (sample line per
  candidate → `voice-auditions/`), make all (skips existing), remake all, redo one. Voices resolve by name in the account (default voices),
  then the known id, then the public Voice Library (added to the account). Key: `ELEVENLABS_API_KEY` or `.elevenlabs-key` (gitignored);
  picks saved in `tools/voices.picked.json`. Defaults: narrator **Lily**, diver **Jessica**. Not run here (no PowerShell/key in the sandbox).
- **New hooks** (controller): `dvoice(kind)` plays the diver's `d_*` lines (pearl in, gate opens, relic, bonk/double combos, near miss,
  air < 10 s once per try, undo) only if the clip exists, ≤ 1 per 6 s, pearl/phew/undo by chance. Narrator: `n_world2`/`n_world3` with the
  world intro cards (levels 11, 21), `n_daily` at Daily Dive start, `n_fin1`/`n_fin2` in the finale. Tutorial `t1e` has a computer
  variant `t1e_k`. Full table: docs/voiceover-script.md (generated from voices.json).
- **The owner's clips are in** (`src/assets/vo/*.mp3`, 46 files, 1.3 MB): imported with `python3 tools/import_voices.py <voiceovers.zip|folder>`
  (trims silence, evens loudness to about −19 dB speech RMS, soft-limits peaks below −1.5 dBFS, 64 kbps mono). The raw ElevenLabs
  files varied by 22 dB. The voice maker also runs standalone from a zip (`Make_Voices.bat` + `make_voices.ps1` + `voices.json` side by side,
  key in `elevenlabs-key.txt`, output `voiceovers/` + `voiceovers.zip`).
- **Film timing with real clips:** `Audio.vo(id, max)` speeds a clip up to 12% (pitch kept) when it's longer than its slot (`CINE_MAX`, the gap to
  the next line); `say()` lets the previous line finish when it has < 1.6 s left (`Audio.voLeft()`), otherwise cuts. Clip lengths are read
  up front (`voDur`, metadata of every embedded clip). vo3 (4.6 s) and vo6 (4.0 s) are the long ones.

## 3D camera (owner: "the scene looks very 2D… no big up/down tilt… a bit more zoomed in")
- `CAM_FOV = 46` (was 28: a telephoto lens flattened everything), camera closer to match; `CAM_YAW` = 0.22 rad on computers, 0.15 on phones:
  the camera orbits sideways around its look target, so the left faces of sand blocks / rock and the tank's depth show. Pitch (`tilt`) unchanged.
- Phones: the yaw swings ±`CAM_SWING`/2 (0.09) with the diver's x across the tank (eased, `yawNow`) — parallax while moving. Computers stay still.
- Fit: `dW` widens by `1 + 0.6·sin(yaw)`; the painted backdrop's reference camera (`placePhotoBg` → `refCam`) uses the same yaw.
- Phones zoom in more: follow cells 58–76 px (`innerWidth / 5.6`), was 50–66. Near plane 2 → 1.2.
- `tankShot` (level photos) still renders front-on. A gentler version (FOV 38, yaw 0.14/0.10) was tried first; the stronger one read better.
- **Desktop closer too** (owner follow-up): `DESK_CLOSE = 0.74` × the whole-level distance, `follow` on, so the camera tracks the diver like
  on phones (no breathing zoom on computers). Level start shows the whole tank for 1.5 s on every device (`beginPlay.pk`), Map / hold M = overview.

## Reference look + diver animation (owner: "match the ChatGPT aquarium exactly"; "the diver gets inside the ball, movement feels static")
- **Sand** uses the owner's reference sand (`src/assets/images/tex/sand_ref.webp`, cut from the arrival concept by `tools/make_ref_textures.py`,
  embedded as `AQ_DATA.TEX`, loaded as `TEX.sandRef`): golden-yellow with rippling light lines; `uRef` in `sandify` switches it on (new art).
- **Reef rock (world 1)** is drawn in the reference's style (`massMat` generator): small/medium flat stones packed tightly (dart-thrown, 4 size
  classes), warm brown mottled earth, low-contrast stones with a soft dark rim + top-left light catch, a few grey-lavender ones; a colour map
  (`TEX.rockCol`) and a matching height map (`TEX.cobbleRock`) share every stone; sampled at `pt * 0.3`. Worlds 2–3 keep their tints.
- **Water** is clear bright aqua (back panel alpha 0.38–0.5, was 0.72; front glass 0.22, was 0.45) so the reef behind the tank shows;
  shallows water `lo/hi` brighter. **Post grade** saturation 1.2, filmic 0.55 (the reference is vivid). **Corals:** a coral (+ often a weed)
  on ~65% of ledge tops, standing on the top face.
- **Diver motion:** the spring chases the tick-interpolated position (k 120) → held moves glide at an even speed; walk/swim at full strength
  with stride speed from the body's speed; the push clip plays while a pearl moves; the diver faces what he pushes (yaw 0.72 → 0.22) and leans
  0.145 toward it so the gloves meet the pearl without sinking in.

## Story transition (owner's 10-image reference pack: tunnel → emergence → results → arrival)
- **Pipe** (`makePipe(world, R, L, base)`, World): open cylinder outside + BackSide inside with a generated patina texture (`pipeTex`: plates,
  rivets, rust flecks; world tints `PIPE_TINT` teal / violet / navy with cyan glow spots), chunky brass rim + bead, brass bands, inner ribs,
  instanced rivets, three porthole lamps on the rim (top/left/right) and three set into the tunnel wall (`pipeTick` pulses them), instanced
  barnacles + moss, rocks at the foot. Mouth at z = 0 facing +z.
- **Film** (`class Story`, own scene; `world.storyStart({w, tank, onFreeze})` / `storyStop()`; while on, `update()` and `render()` hand over to it):
  painted reef as a mirrored ring all round (`PHOTO_W[w]`), dune sand with `TEX.sandRef`, sun shafts, sheet corals/weeds/rocks/shells
  scattered with a clear walkway, drifting sheet fish, the **next level's real tank photo** (`levelPhoto`) on a framed tank with a teak stand.
  Shot 1 (0–2.7 s): camera inside the pipe behind the swimming diver, toward the bright mouth (warm + cool point lights inside).
  Shot 2 (2.7 s–): low camera behind-right; the diver walks out of the mouth, turns to the distant tank and waves (`aim()` points the
  RightArm/RightForeArm bones in world space after the mixer; the arms are short, so the arm goes out sideways or it hides behind the helmet).
  At 5.9 s it freezes and calls `onFreeze`. Phones: wider FOV, camera further back, `setViewOffset` lifts the picture above the card.
  `window.__SC` / `__SC1` override shot-2 / shot-1 camera numbers for tuning.
- **Controller:** on a win (`storyOK()`: not Daily, not replay, not reduced motion, not level 30) `clearStamp` is skipped; 1.25 s after the
  win a bubble wipe starts `startStory()`; the freeze runs `finishLevel()` and relabels the button "Continue ›". `body.story` CSS puts the
  card at the right (landscape) or bottom (portrait), hides the HUD, goals, extras, Home and the mascot. A tap / Enter / Space during the
  film skips to the freeze (`storySkip`). `storyEnd()` runs from `startLevel` and `openHome`.
- **Arrival:** Continue sets `arriveNext`; `beginPlay` calls `world.arrive()`: a small pipe (R 0.3) pops out of the sand in the tank's
  bottom-left corner (z 0.3, in front of the walls), the diver arcs out of it to his start cell, the pipe sinks after ~2.3 s; the first move
  ends the pop-out. A spotlight tutorial on that level waits 1.7 s for it. Debug: `__dc.story()`.

## Colour match to the reference (owner: "brighter and vibrancy… much closer comparison")
- Measured per material against `04_arrival` (sand / rock / water / sky above the tank) with a small stats script, then tuned at the source:
  sand ×1.5 golden (`uRef` path), world-1 rock = darker earth (`#5f412f`) with lumpy stones (`bp()` blob outlines), lit top-left and shaded
  bottom-right, grain; bump ×9.5; the painted backdrop gets a cyan push + sunlit lift where blue (`MAT.bgLift`, per world 1 / 0.45 / 0.2);
  stage-light dimming in world 1 much lighter (`L` table); in-tank water deeper cyan and the back panel more opaque; hazy reef silhouettes behind
  the water are distinct blue-violet with coral tufts (`silA` raises the panel alpha there); post vignette 0.58 → 0.74 and +5% exposure (day only).
  Result (ref → ours): sand 212,155,67 → 210,146,65; rock 132,96,79 → 135,101,84. More face corals and bubble streams.
- Bug to remember: a `//` comment placed before `gC.restore()` on the same line left a canvas clip active and broke the whole rock texture.

## The story: 29 chapter films (owner: "each level will have story… every cutscene different")
- `CHAPTERS[n]` (World section) = the chapter shown after level n: title `t`, two caption lines `cap` ([seconds, text]), recipe `r`, world `w`,
  arrival `a` ('pipe' | 'drop' | 'swirl' | 'bubble'). Story bible + table: `docs/story.md` (regenerate it from CHAPTERS if lines change).
- `RECIPES[r]` = `{ dur, set, setup(S, c), run(S, c, t) }`. `run` places the camera (`S.cam(pos, look)`; phones pull back ×1.4), the diver
  (`S.dv(pos, facing, pitch, yawOff, roll)`) and the cast, and returns `{ mode: swim|walk|stand|float, speed, arms, armK, face, target }`.
  Arm poses (world-space bone aiming, `Story.arms`): wave, cheer, point, reach, hold, clap, offer, grip. `K(t, keys)` = smooth keyframes.
- Set options: `dark` (0..1, plus a base darkness per world), `dune`, `cliff` (ground drops beyond z −3), `trench`. `S.tankAt(x, z, ry, y)` places
  the next level's tank photo. Before playing, the recipe is probed at 41 times to collect camera positions; decor near the camera path is removed.
- Cast (procedural, `make*` before `class Story`): Pip the seahorse (glow grows with the chapter), Shelly the turtle (glowing spots in the deep),
  manta, whale, Murk the octopus (`setSad`), clams, chest + map, crystals, columns, coral arch, wreck, the Great Lantern tower (`lit`, `heart`),
  Lumen the anglerfish. Plus the game's crab, jelly, pearls, fish sprites, sheet corals.
- Controller: `startStory` passes `ch`/`n`; captions in `#storyCap` (chapter, title, line; top on phones); the card kicker becomes
  "Chapter n · title"; Continue → `arriveNext = ch.a` → `world.arrive(kind)`. Tests: a gallery script renders every chapter at 30% / 65% / end.

## Story pass 2: a connected story with dialogue (owner: "a proper story… everything connected from level 1 to the last")
- **Story bible:** `docs/story.md` (world, cast, the five threads that run through all 30 levels, every line with its voice id). Source of the
  text: `CHAPTERS[n].L` = four `[speaker, text]` lines (speakers in `STORY_WHO`: '' narrator, you, pip, shelly, clack, mira, cousin, lumen,
  murk, note/arch/choir = the Reef Keeper's words) and `LEVEL_STORY[n]` (controller, one line per level card, `#introStory`).
- **Films fit their lines:** `Story` spreads the lines over the film (`lineT`, ≥ 2.4 s or 0.8 s + 0.2 s per word, or the voice clip's length
  + 0.45 s) and slows the recipe to fit (`k = T / dur`, `run(t / k)`); freeze at `T`. A tap shows the next line; `#storySkip` (Skip, top right;
  bottom on phones) or Escape jumps to the end. Captions show "Chapter n · title", the speaker's name in their colour, then the line.
- **Voice-ready:** each line plays `Audio.vo('s<n>_<i>')` when that clip exists (`Audio.voDur` exposes clip lengths). `tools/voices.json` has
  all 116 story lines with roles narrator / diver / pip / shelly / murk / lumen / friend, a recommended ElevenLabs voice per role and
  audition lines; `make_voices.ps1` now loops over every role in `pick` (`$Roles`). Import with `tools/import_voices.py` as before.
- **Journal** (`#journal`, Home › Story, which replaced the Intro buttons): the Prologue (the intro film) + every chapter whose level has
  stars, with its four lines and a Watch button (`watchChapter(n)`: plays the film without a result card, returns to the journal; Escape ends).
- The finale credits name the cast.

## Story v3: Grimtide (owner: "fully connected… ups and downs… blunders… in the end you get the revenge… show it in the next level")
- **Villain:** Grimtide, a giant eel who drinks light (`makeEel(len, R)`: 30 segments posed by `userData.pose(fn(u, t), t)`, `setGlow`; helpers
  `pathSweep`, `makeCage` (`open(k)`), `makeInkChains` (`melt(k)`)). Arc and every line: `docs/story.md` (generated from the CHAPTERS data;
  table of ups and downs: blunder at ch. 7 (the map stolen) and 24 (Pip snatched), grief at 13–14 (Shelly struck down), triumphs 25–26, revenge 30).
- **New films** (`RECIPES`): trap (7), storm (13), shellyrest (14), coil (20), ambush (24), cage (26), lair (29), victory (30: 30 beams, the eel
  shrinks to a worm, the Heart Pearl rises). `S.fx(key, kind)` fires one-shot controller effects (`storyFx`: flash / thunder / roar / ink),
  `S.inkBurst(pos, n, size)` drifting ink clouds (soft violet-black, ≤ 90). Chapter 30 plays before the finale (`storyOK` allows it; no tank).
- **Story inside the levels:** `LEVEL_TALK[n] = {s, g}` → `levelTalk(k)` shows `#talk` (speaker portrait colour, name, line, 4.6 s) ~3.2 s after
  the level starts and when its gate opens (replaces the diver's gate quip there); voice `l<n>_s` / `l<n>_g`. `LEVEL_MOOD[n]` →
  `world.setStoryMood`: Pip floats above the tank following the diver (`pipNod`), ink behind the tank (8–10, 13–14), Grimtide's eye pairs blink
  in the dark beside it from level 11 (`moodTick`). Pip is absent on 25–26 (captured). Debug: `__dc.talk('s'|'g')`.
- **Voices:** tools/voices.json has every story line with tags per mood (232 lines) and a `grimtide` role (Callum recommended). Regenerate the
  docs + voice list from the story data rather than editing both by hand.
- Fixed on the way: the tank waterline shader never compiled (a `//` comment swallowed `gl_FragColor`); use `/* */` inside one-line GLSL.
- Headless note: `#talk` fades by CSS transition and hides on a wall-clock timer, so screenshots need `transition: none` and a re-added `.on`.

## Story v4: the AAA story pass (owner: "story mode like PS4 games / Bug's Life… every character with charisma… engaged, waiting for the climax")
- **Screenplay source:** one Python data file `tools/story/story_v4.py` (`python3 tools/story/gen_docs.py` regenerates the docs + voices.json; the game holds its own copy of the lines in game.js, so change both): `SPEAKERS`,
  `ROLES` (voice per role), `CH` (30 chapters, lines `(who, text, delivery)`, optional `Q` interactive beat), `LEVEL_STORY`, `BEATS`, `DEATH`, `MEM`.
  docs/story.md (bible + ups/downs table), docs/voice-script.md (by character, credits) and tools/voices.json are generated from it together.
  Arc: Spark (Pip's name for the diver) + Pip, Shelly, Captain Clack (tricorn hat, `makeCapHat`), Lumen, Mira, Murk vs Grimtide and his piranhas
  Snip & Snap; map stolen (7), Shelly struck down (13–14), the lamp reveal (16 → 23), Pip snatched + Clack's sacrifice (24–25), rescue (26),
  "we've been lighting his dinner" (29), revenge (30). The Keeper's 30 coins (the relics) each play a memory (`MEM_LINES`, voice `m<n>`).
- **Films (`class Story`):** lines carry their own clock (`plan()`: `t0/t1` + recipe time `r0/r1`; narration runs the action at full speed,
  dialogue eases it to 45%); `rtAt(t)` maps clock → recipe. Close-ups: `castOf(who)` (cast object, size, facing), `dialogCam` (toward the face,
  from the scene camera's side, ±0.38 rad shot/reverse), `clearView` (raycast: try the other side, else stay wide), the speaker bobs/sways
  (Grimtide's jaw works). Companions: a speaker missing from a recipe rides along (`companions()`: Pip at the shoulder, Lumen beside, Clack at
  the feet). New films: `farewell` (25); Clack added to crabs/ambush/whale; Snip & Snap in descent (the diver dives off the cliff); crew + hat in
  plankton; Shelly in plankton/victory. Voice ids `s<n>_<i>`, outcome lines `s<n>_ok<j>` / `s<n>_no<j>`.
- **Interactive beats** (`Q = {at, kind: tap|hold|swipe, n, dir, label, ok, no}`; chapters 7, 10, 13, 17, 24, 26, 29, 30): `qteStart/qteIn/qteEnd`,
  the film runs at 15% (`sl`) and the camera trembles; 6.5 s without success = the `no` lines; both outcomes continue the story. Controller:
  `qteUI` (`#qte` ring/label/hint), pointerdown/up (swipe > 40 px), Space/Enter/arrows; taps never skip lines during a beat. Skip = `skipAll()`.
- **In-level story:** `LEVEL_BEATS[n]` = `{on: s|p|m|g, who, text, fx?, cut?}` → `beat(on)` (once per session per level): s ≈ 3.2 s after start,
  p = first pearl in, m = 24 s of play, g = gate opens. `world.storyFx(kind)`: quake (shake + falling grit), tail (Grimtide's eel sweeps over the
  tank), eyes (beside the tank) / stare (huge, in front, only in cutscenes), ink, flicker (exposure), glow (Pip), fish; screen-edge overlay `#sfx`.
  `storyCut` (levels 11, 24, 29, first attempt): `cutHold` stops engine ticks, letterbox `#cutBars`, `#talk.cine`; any move ends it.
  Death lines: `deathLine()` picks from `DEATH_LINES[cause]` by level range (`k_<cause>_<i>`), the result card waits 2.6 s.
  `talk()` queues bubbles (max 2) and times them by voice length. Debug: `__dc.talk(on)`, `__dc.cut()`, `__dc.death()`, `__dc.qte(kind)`.
- **Voices:** 335 story lines, ≈16.5k spoken characters (≈21.4k credits with tags). `make_voices.ps1`: mode 5 = story lines only, every mode
  prints the character count and asks y/n, auditions ask which roles. `tools/import_voices.py`: base clips 64 kbps, story 48 kbps.
  `build_assets.py` embeds base clips in the page and writes story clips to `src/assets/voice-<world>.js` (copied to dist/assets/);
  `AQ_DATA.VOD` / pack `VOD` = clip lengths from the MP3 headers (`mp3_seconds`), so nothing loads clips just to time lines. `loadVoice(w)`
  injects a pack when its world is near (boot: the unlocked world; startLevel: this world, and the next from x8). `window.AQ_VOICE` merges a pack. `AQ_DATA.VOP` lists the packs that exist (no request for a missing file). Checked with dummy clips: packs build, load per world, lengths right.
- Close-ups re-check the line of sight every 0.25 s (`sh.chk`): someone swims in front → cut to the other side, else back to the wide shot.
- Gotcha (again): a `//` comment inside a one-line JS statement swallowed the rest of the line twice this pass; use `/* */` mid-line.

## Story v5: the polish pass (owner: "don't scrap it, polish it": funnier, less static, more game)
- **Script:** `tools/story/story_v5.py` (imports the unchanged pieces from story_v4: speakers, roles, beats, deaths, memories). Same 30 chapters,
  same films and events; lines tightened and funny-first (running gags: Pip's "my fins are just cold", Clack's "exactly as I planned" / Deputy
  Assistant Vice Captain, Grimtide's "setting my table", Lumen's sock, Clack back alive in ch. 30). `CH[0]` = the **prologue** (intro film).
  Lines are `(who, text, delivery[, emote])`. `python3 tools/story/gen_docs.py` regenerates voices.json + docs/story.md + docs/voice-script.md;
  the game's copy (CHAPTERS / PROLOGUE in game.js) is injected from the same data (JSON shape: `[who, text, emote?]`), so change both.
- **Prologue film** (`RECIPES.prologue`, n = 0, voice ids `s0_<i>`): the festival, Grimtide rising and drinking the lights, the Keeper giving her
  light to the Lantern, darkness, Pip alone; then `cineTick` hands over to the tank part of the intro (first dig → gate). Low tier adds `#cineDark`.
- **Talking:** Pip / Shelly / Clack / Murk have a mouth (`talkMouth`) that opens with the syllables in every shot; Grimtide's jaw works;
  fish characters have both eyes. **Emotes** (`hop spin shake laugh salute droop nod`) play on the speaker over a line's first 0.9 s
  (droop holds for the line); applied in `shotCam` through `_tb` (dy / rz / ry, undone next frame).
- **Choices** (`Q.kind 'choice'`, chapters 1, 4, 8, 11, 14, 19, 25, 27): `#choice` card (prompt + brave ⚡ / funny 😄 / kind 💛 buttons, keys 1–3,
  9 s bar). No answer = the player's usual style (`topTrait()` from `save.trait`), else the first option. Each answer has its own reply lines
  (`s<n>_c<key>_<j>`). Picks count into `save.trait`; a text can be `{brave, funny, kind}` (Pip's line in ch. 30, ids `s30_7_<style>`), the
  journal shows the player's version. Tap/hold/swipe beats are unchanged (7, 10, 13, 17, 24, 26, 29, 30).
- **Story conditions in levels** (`LEVEL_COND`, look only, the board never changes): `dim` 8–9, `dark` 14/24/25 (the lamp pool is all you
  get: `world.setCond` → stronger lamp + `lampAmb`, darker backdrop, deeper vignette), `storm` 13/29/30 (every ~13 s a flicker + thunder or a
  quake), `ink` 16/18/26 (ink drifts by). The level card shows a chip (`COND_CHIP`). Not in Daily Dive / custom levels.
  The darkness itself is a screen overlay (`#lampDark`, `lampDark()` in the frame loop: radial pool ≈ 3.4 cells around the diver, alpha 0.74
  dark / 0.36 dim) because the lamp uniforms don't reach the water, sprites and corals. `world.setCond` is keyed to the level name (photos/undo reload).
- **Voices: the owner must not record until the v5 script is approved.** Voice maker is Eleven v4 only (`fallback_models: []`), no name prompts.
- Debug: `__dc.watch(n)` plays chapter n like the journal; `__dc.qte('pick', 'funny')` answers a choice.
