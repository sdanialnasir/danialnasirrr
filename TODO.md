# Aqua Energizer — work queue

Read CLAUDE.md first. Rules that bite: in game.js never put a `//` comment in the middle of a one-line statement (use `/* */`);
rebuild with `python3 tools/build.py`; tests need `CHROME_PATH=/opt/pw-browsers/chromium`; publish dist/index.html to
https://claude.ai/artifact/HQL6UGenCGmT79BLXmW5A8 with `files` (manifest.json + icons/*). Live version: 80.

## Done
- Keeper feet in the prologue, clam song (ch 12), runs in 5 / 18 / 28, even film brightness (`FILM_EXPO`), camera punch-ins (v79).
- Chapter 30 boss fight with Grimtide (`RUN_V.boss`), listeners react to the speaker (`Story.listen`), Clack faces the camera (v80).

## Small tasks
1. After any story line change: inject chapters (scratchpad inject_ch.py logic: CHAPTERS + PROLOGUE from tools/story/story_v5.py with
   [who, text, emote, mood]) and `python3 tools/story/gen_docs.py`.

## Big tasks (waiting on the owner's models)
- Grimtide's Meshy model (short and wide, not an eel): a bend rig for a static mesh, or use it for close-ups / the boss head only.
- Jellyfish model (not sent yet) and any new models.
- Engine / level balance changes (re-verify routes), crash-type bugs.
