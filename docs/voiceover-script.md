# Aqua Energizer — intro voice-over script (for ElevenLabs)

The intro is an in-engine film in seven beats. Each spoken line has an id. Export each line from ElevenLabs as an
**MP3** named after its id and drop it into `src/assets/vo/` (e.g. `src/assets/vo/vo1.mp3`), then run
`python tools/build.py`. The clips are embedded into the single HTML file and play automatically, with the ambience
ducked underneath. Missing clips are fine: the subtitles still carry the story.

**Voice direction:** warm storyteller, a little hushed and wondrous, like a bedtime legend. Unhurried, but no long pauses.
Suggested ElevenLabs settings: Stability ~45, Similarity ~75, Style ~30. Keep each clip within the window below
(the picture keeps moving on its own timing).

Every line is said **at the moment the picture shows it**. Lines 1–4 run on the film's clock; lines 5–9 are triggered by
what the diver actually does in the tank (they can shift by a fraction of a second, so leave a little air at the end).

| id | starts | max length | what is on screen at that moment | line |
|---|---|---|---|---|
| vo1 | 1.0 s | 4.3 s | The reef at night, glowing pearl-lights drifting | Deep in the sea, the reef glows with magic pearls. |
| vo2 | 5.6 s | 3.2 s | Thunder, flashes, the storm hits | One night, a huge storm hits the reef… |
| vo3 | 9.0 s | 3.4 s | The lights are blown away, the reef goes dark | …and sweeps all the pearls away. The reef goes dark. |
| vo4 | 12.9 s | 3.8 s | Close on the diver; the helmet lamp clicks on at "turns on a light" (14.3 s) | But one little diver turns on a light. |
| vo5 | first dig (~17.4 s) | 3.3 s | The diver digs through the sand | Swim into the sand to dig a tunnel. |
| vo6 | diver reaches the gate (~20.8 s) | 3.3 s | The diver stands above the gate, then turns back toward the pearl | The tunnel reaches the gate. Now get behind the red pearl… |
| vo7 | first push (~24.3 s) | 1.9 s | The diver pushes the pearl along the tunnel | …and push it to the gate! |
| vo8 | gate opens (~26.2 s) | 3.2 s | Shockwave, light pours back (the diver waits until the line ends) | The gate wakes up, and the light comes back! |
| vo9 | 0.6 s after the diver swims in | 4.0 s | Wide shot + a row of 30 gates, the first one glowing | Twenty-nine gates are still dark. Can you wake them all? |

The lines live in `CINE_LINES` in `src/game.js`; change the text there if you re-record with different words.

## Diver voice lines (result screen)

Short, playful lines in the **diver's** voice (a different, younger/cheerful ElevenLabs voice from the narrator). One of
them plays at random about 0.7 s after the result screen opens. Save each as `src/assets/vo/<id>.mp3` and rebuild; any
clip that is missing is simply skipped (the diver's little synth "yay"/"oof" sounds still play).

| id | when | max length | line |
|---|---|---|---|
| win1 | level cleared | 1.8 s | Woohoo! The light's back! |
| win2 | level cleared | 1.8 s | Gate's awake. Onward! |
| win3 | level cleared | 1.8 s | Easy as bubbles! |
| lose1 | dive failed | 1.8 s | Oof… let's try that again. |
| lose2 | dive failed | 1.8 s | Hold on, I've got this! |
