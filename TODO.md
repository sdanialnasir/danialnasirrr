# Aqua Energizer — work queue

Read CLAUDE.md first. Rules that bite: in game.js never put a `//` comment in the middle of a one-line statement (use `/* */`);
rebuild with `python3 tools/build.py`; tests need `CHROME_PATH=/opt/pw-browsers/chromium`; publish dist/index.html to
https://claude.ai/artifact/HQL6UGenCGmT79BLXmW5A8 with `files` (manifest.json + icons/*). Live version: 78.

## Small tasks (fine for a lighter model; do them in order)
1. **Keeper feet in the prologue.** In `makeKeeper()` (game.js, near makeDiver) the two `new THREE.Box3().setFromObject(mesh, true)`
   measurements need `mesh.skeleton.update();` right before each (bone matrices are stale until a render). Goal: in the prologue the
   Keeper's feet sit at hold.y − 0.5 like the diver's (she currently measures ~1.15 too low). Check: render chapter 0 frames.
2. Run smoke + play_routes + fuzz (all must pass), commit, push, publish (v79: clam song, 3 new action scenes, even film brightness,
   Keeper in the prologue, camera punch-ins).
3. Re-measure film brightness (render every chapter's lines, mean luminance per chapter) and nudge `FILM_EXPO` toward the targets
   (prologue 92, chapters 1–10: 145, 11–20: 122, 21–30: 104).
4. Screenshot checks: chapter 12 clam song (`#simon`), runs in chapters 5 / 18 / 28 (`__dc.watch(n)`).
5. After any story line change: inject chapters (scratchpad inject_ch.py logic: CHAPTERS + PROLOGUE from tools/story/story_v5.py with
   [who, text, emote, mood]) and `python3 tools/story/gen_docs.py`.

## Big tasks (need the stronger model)
- Grimtide's Meshy model (short and wide, not an eel): a bend rig for a static mesh, or use it for close-ups only.
- Chapter 30 boss fight with Grimtide (new mini-game type).
- Film staging: listeners react to the speaker, stronger camera direction, more acting.
- Jellyfish model (not sent yet) and any new models.
- Engine / level balance changes (re-verify routes), crash-type bugs.
