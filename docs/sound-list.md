# Sound list (drop-in real audio)

Every sound in the game is synthesized in code today. To swap in real recordings:

1. Make the sound (e.g. ElevenLabs → Sound Effects, 0.5–2 s, then export MP3).
2. Save it as `src/assets/sfx/<name>.mp3`. For variety, add variants: `<name>_2.mp3`, `<name>_3.mp3` (one is picked at random, with a slight pitch change).
3. Run `python tools/build.py`. Any sound without a file keeps its synthesized version.

Ambience loop (optional): `src/assets/music/ambience.mp3`, 60–120 s, seamless loop. It replaces the synth chords. Keep it calm and with **no melody** (owner's rule).
Keep the whole set small (mono, 64–96 kbps): the game must stay one file under ~16 MB.

| name | when it plays | prompt idea |
|---|---|---|
| dig | diver digs one cell of sand (very frequent) | soft muffled underwater sand scoop, gentle whoosh, soothing, no sharp transient |
| push | diver pushes a stone or pearl | heavy stone sliding on wet sand underwater, short, muffled |
| land | stone/pearl lands after falling | deep muffled underwater thud of a rock landing on sand, small sand puff |
| roll | stone rolls off another | short underwater stone roll, low rumble |
| bump | diver bumps a wall | tiny soft underwater bonk |
| swim | diver swims one cell through open water | small fin kick with a couple of bubbles, quiet |
| bubble | spawn / small bubble pop | single cute underwater bubble pop |
| air | diver grabs an air capsule | big satisfying bubble burst plus a bright refreshing chime |
| treasure | a starfish/shell is dug out | tiny sparkly pickup chime, cute |
| absorb | pearl enters the gate | magical energy absorb, rising shimmer, glassy |
| gateOpen | last pearl in, gate wakes | magical portal awakening, warm swell, sparkling, 2 s |
| gateLocked | swim into a closed gate | muffled metallic clunk, locked door underwater |
| win | level finished | bright magical underwater sparkle swell, 2 s, no tune |
| death | diver crushed / caught | soft cartoon defeat, muffled underwater bloop down, not scary |
| monsterDeath | stone drops on a monster | cartoon bonk with bubble burst |
| bite | piranha snaps | small cartoon fish snap, cute |
| lowAir | air under 15 s (repeats) | soft underwater warning beep, gentle |
| click | UI buttons | soft bubbly UI click |
| hup / yay / eep / oof / hi / hmm / woohoo / aww | diver's voice | cute chibi character voice, wordless: "hup!", "yay!", "eep!", "oof", "hi!", "hmm?", "woo-hoo!", "aww" |
| thunder / stormWind / lampOn / wake / riser | intro film only | storm thunder underwater; storm wind; flashlight click; magical reef awakening; rising tension swell |

Not replaced by files (they are tuned per pearl / star): the rising pearl notes and the star chimes on the result screen.
