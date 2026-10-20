# Aqua Energizer — intro voice-over script (for ElevenLabs)

The intro is an in-engine film in seven beats. Each spoken line has an id. Export each line from ElevenLabs as an
**MP3** named after its id and drop it into `src/assets/vo/` (e.g. `src/assets/vo/vo1.mp3`), then run
`python tools/build.py`. The clips are embedded into the single HTML file and play automatically, with the ambience
ducked underneath. Missing clips are fine: the subtitles still carry the story.

**Voice direction:** warm storyteller, a little hushed and wondrous, like a bedtime legend. Unhurried, but no long pauses.
Suggested ElevenLabs settings: Stability ~45, Similarity ~75, Style ~30. Keep each clip within the window below
(the picture keeps moving on its own timing).

| id | starts at | max length | beat on screen | line |
|---|---|---|---|---|
| vo1 | 1.0 s | 4.5 s | The reef at night, drifting pearl-lights | Long ago, the Glow Reef shone with the light of a thousand energy pearls. |
| vo2 | 5.6 s | 3.2 s | Thunder, the storm hits | Then one night, a great storm tore through the deep… |
| vo3 | 9.0 s | 3.0 s | The lights are swept away, darkness | …scattering the pearls, until every gate went dark. |
| vo4 | 13.1 s | 3.4 s | Close on the diver, helmet lamp clicks on | But one little diver refused to let the light fade. |
| vo5 | 16.8 s | 3.5 s | The diver digs toward the pearl | Dig through the sand… and roll the pearl home. |
| vo6 | when the gate opens (~27 s) | 3.5 s | Shockwave, light pours back | One gate awakens, and light returns to the reef. |
| vo7 | 0.5 s after the diver swims in | 3.4 s | Wide shot, then fade to the title | Twenty-nine gates still sleep. The reef is counting on you. |

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
