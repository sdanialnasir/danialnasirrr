# ElevenLabs Setup: Narrator Version

One voice tells the whole story. Use **Eleven v3**, which understands the `[audio tags]` below.

---

## 1. Narrator voice (Voice Design prompt)

Paste this into **Voices → Voice Design**, generate a few takes, and save the best one as "Benny Narrator":

> A warm, magical storyteller voice for a children's animated rhyming story, like a beloved bedtime-story narrator on a kids' TV show. Friendly and expressive, with a gentle smile in every line and a playful, musical bounce on the rhymes. Clear, crisp diction at a calm storytelling pace. Can go hushed and tender for emotional moments, and bright and excited for fun ones. Mid-range, neutral English accent, studio quality, no background noise or music.

*If you'd rather pick a ready-made voice: search the Voice Library for "storyteller", "children's narrator" or "bedtime story".*

---

## 2. Settings

| Setting | Value |
|---|---|
| Model | Eleven v3 |
| Stability | **Natural** (try **Creative** on blocks 9, 23 and 27 for extra emotion) |
| Speed | 1.0. Raise to 1.05–1.1 only if a clip runs past its Max |
| Output | 44.1 kHz WAV or MP3 |

---

## 3. Story script

**How to use it:**
1. Generate **each block as its own clip**: one paragraph per block in Studio, or one generation each in Text to Speech. Separate clips are the only way to land each line exactly on its start time in Unity.
2. Before generating, **delete the label in front of each block** (`[n | start … | max …]`). Keep the `[audio tags]`.
3. **Check every clip's length against its Max.** If one runs over, regenerate it or nudge the speed up. Never move the start time.

```
[0 | start 0:01.0 | max 5.3s] [warm, storytelling] One sunny morning, bright and new, Ziggy, Kisha… and Benny too!

[1 | start 0:07.3 | max 2.4s] [playful] Benny scored five stars — hooray!

[2 | start 0:10.9 | max 2.3s] [gentle] Kisha snapped a bug at play.

[3 | start 0:13.2 | max 4.4s] [light, amused] "Are we there yet?" Benny asked. Ziggy grinned, "Not long!"

[4 | start 0:18.0 | max 6.8s] [cheerful] Benny huffed and puffed along… Kisha waved bye, and Ziggy cheered her on!

[5 | start 0:25.1 | max 4.3s] [excited] At the market, kids all cheered, "Hello, Ziggy! Hooray!"

[6 | start 0:29.6 | max 2.2s] [teasing] Past the cakes, Benny scrolled away!

[7 | start 0:32.5 | max 4.0s] [amazed, then cheerful] Kisha gasped, "What a sight! Everybody, smile!"

[8 | start 0:37.0 | max 2.3s] [happy] Click! A perfect memory.

[9 | start 0:43.5 | max 3.0s] [building, then surprised] Eyes on his screen… SPLASH! A puddle!

[10 | start 0:47.7 | max 2.9s] [sympathetic, playful] Poor Benny grumbled, soaked and blue.

[11 | start 0:53.1 | max 3.1s] [giggling] Kisha laughed — click! — "I thought you knew!"

[12 | start 1:02.3 | max 2.2s] [delighted] Tweet! Birds on Ziggy — click, click!

[13 | start 1:06.0 | max 6.2s] [wistful, then light] Benny wished for a view up high… then shrugged, "Never mind," and scrolled on by.

[14 | start 1:14.9 | max 6.8s] [proud, warm] But tall Ziggy had the best view in town, with a birdie on top, looking all the way down!

[15 | start 1:22.8 | max 2.3s] [dramatic] Pitter-patter… down came the rain!

[16 | start 1:35.5 | max 4.6s] [wonder] A rainbow! Kisha's camera clicked again!

[17 | start 1:43.2 | max 7.0s] [upbeat] "Has it stopped?" Benny peeked, then back to his screen. "Let's go!" smiled Ziggy, and off went the team!

[18 | start 1:51.3 | max 5.4s] [cheerful] Kids waved, "Hi, Ziggy!" He waved hello, and Kisha snapped them in a row.

[19 | start 1:57.7 | max 4.7s] [warm] "Good day so far?" Benny asked. "The best!" Ziggy beamed.

[20 | start 2:03.2 | max 5.4s] [soft, glowing] That night, Kisha's album shone so bright… the whole day lived in every sight!

[21 | start 2:09.3 | max 5.6s] [gentle humour] Then Benny's tablet went dark — battery dead! "Even screens get tired," Kisha said.

[22 | start 2:15.1 | max 4.4s] [astonished, quiet] He stared at the photos: "Did all that happen today?"

[23 | start 2:19.7 | max 4.3s] [tender, reflective] He'd held his screen all day… and missed it all along the way.

[24 | start 2:24.2 | max 4.3s] [hopeful] "Tomorrow?" Ziggy winked. "Something worth a snap!"

[25 | start 2:29.0 | max 5.5s] [friendly, to the viewer] Now Captain Cyber Champ asks you: what zoomed by that you nearly missed too?

[26 | start 2:36.0 | max 3.3s] [encouraging] Put it down, look up — the good stuff's right there to see.

[27 | start 2:39.5 | max 2.9s] [heroic, uplifting] Cyber Champions… that's you and me!

```

---

## 4. Getting the wow factor

- **Keep the original music** and lower it about 3 dB under each narration clip.
- **Add a camera click** on every snapshot pop-up (0:12, 0:36.5, 0:54, 1:05, 1:41). The narration says "click" right there.
- **Add a splash** at 0:45 under "SPLASH! A puddle!"
- **The emotional turn at 2:19:** "He'd held his screen all day… and missed it all along the way." Generate it 3–4 times and keep the softest, most sincere take.
- **The finale:** pick the most triumphant take of "Cyber Champions… that's you and me!" so it rings out into "The End" card.
