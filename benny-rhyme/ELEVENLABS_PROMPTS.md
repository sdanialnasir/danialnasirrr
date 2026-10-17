# ElevenLabs Setup: Benny Spent ONE Day (Rhyming Version)

Use **ElevenLabs v3** (it understands the `[audio tags]` below) in **Studio** with a project for the story, or in **Text to Speech** if you'd rather make clips one at a time.

---

## 1. Voice Design prompts (one per character)

Paste each into **Voices → Voice Design**, generate, pick the best take, and save it with the character's name. Each prompt describes a stylised cartoon voice. If Voice Design won't produce a young-sounding voice, search the **Voice Library** for "cartoon" or "animated character" voices.

**Benny (bunny with the tablet)**
> A bright, bouncy cartoon bunny voice for a children's animated show. Youthful, slightly high-pitched, playful and a little cheeky, quick to giggle. Clear American accent, crisp diction, sing-song rhythm, as if he's always half-distracted by a game. Studio quality, no background noise.

**Kisha (girl with the camera)**
> A warm, cheerful cartoon girl voice for a children's animated show. Bright, curious and kind, with a gentle musical lilt, like she's delighted by every little thing she sees. Clear American accent, clean articulation, light and friendly. Studio quality, no background noise.

**Ziggy (tall green dinosaur)**
> A big, gentle, friendly cartoon dinosaur voice. Warm mid-low tone, slow and soothing, a soft rumble with a smile in it, like a kind older friend. Playful but patient, slightly goofy charm. Clear American accent. Studio quality, no background noise.

**Kids (market crowd)**
> A small group of cheerful cartoon children calling out together, excited and happy, slightly overlapping, playful energy for an animated children's show. Studio quality.
> *(Tip: if a group voice comes out odd, record the line 2–3 times with different voices and layer them in Unity.)*

**Captain Cyber Champ (the bear host)**
> A confident, heroic but friendly cartoon bear voice, the host of a kids' digital-safety show. Warm, upbeat, encouraging, with a big-hearted "superhero coach" energy. Medium-deep, rich and clear, speaks straight to the viewer with a smile. Clear American accent. Studio quality, no background noise.

---

## 2. Recommended v3 settings

| Setting | Value | Why |
|---|---|---|
| Model | Eleven v3 | Audio tags + expressive delivery |
| Stability | **Natural** (switch to **Creative** for laughs and "Wow!" lines) | Keeps the rhyme rhythm steady |
| Speed | 1.0 (raise to 1.05–1.10 only if a clip runs over its Max) | Fit the slot without chipmunking |
| Output | 44.1 kHz WAV/MP3 | Drops straight into Unity |

---

## 3. The story script for Studio

**How to use it:**
1. Create a Studio project and paste the block below.
2. Give each paragraph the voice named before the colon, then **delete the name and the time code** from the text. They are only labels.
3. Generate per paragraph. Each paragraph is one clip, so you can place it at its exact start time in Unity.
4. **Check every clip's length against "Max" in `RHYME_SCRIPT.md`.** If one runs over, regenerate it, raise the speed slightly, or trim silence at the end.

```
[0:07.3 | max 1.0s] BENNY: [excited] Five stars! Hooray!
[0:08.9 | max 0.8s] BENNY: [giggles]
[0:10.9 | max 1.5s] KISHA: [whispers] Hold still, little one…
[0:12.6 | max 0.6s] KISHA: [happy] Done!
[0:13.3 | max 1.8s] BENNY: [impatient] Are we near the cake stall yet?
[0:15.2 | max 1.0s] ZIGGY: [warmly] Almost. Don't fret!
[0:18.0 | max 1.6s] BENNY: [sighs] That's what you said before!
[0:19.9 | max 0.9s] KISHA: [softly] Bye-bye, bug!
[0:21.4 | max 1.8s] ZIGGY: [cheerful] You're doing great. Let's explore!

[0:25.1 | max 3.3s] KIDS: [shouting happily] Hello, Ziggy! Hip, hip, hooray!
[0:30.0 | max 1.5s] BENNY: [excited] Come on, let's play! [laughs]
[0:32.5 | max 2.0s] KISHA: [amazed] Oh, what a lovely sight to see…
[0:34.7 | max 1.7s] KISHA: [cheerful] Everybody, smile for me!
[0:37.0 | max 2.2s] KISHA: [happy] Thank you, one and all, with glee!

[0:44.8 | max 1.7s] BENNY: [shocked] Oh no! A puddle!
[0:47.7 | max 0.9s] KISHA: [laughing] What a muddle!
[0:48.9 | max 1.7s] BENNY: [grumpy] You could have said!
[0:53.1 | max 0.9s] KISHA: [playful] Say cheese!
[0:54.0 | max 2.2s] KISHA: [innocently] I thought you looked ahead!

[1:02.8 | max 1.6s] KISHA: [delighted] Aww, birdies… tweet!
[1:06.0 | max 2.4s] BENNY: [curious] Is there a spot with a view up high,
[1:08.6 | max 1.8s] BENNY: [excited] to snap the market from the sky?
[1:10.5 | max 1.5s] BENNY: [laughs] Oh, never mind!
[1:14.9 | max 3.9s] ZIGGY: [proudly] Well! Up here, the view's divine!
[1:19.1 | max 1.5s] KISHA: [curious] Found a view spot, Ziggy dear?
[1:20.7 | max 1.0s] ZIGGY: [happy] Yes, right here!

[1:22.8 | max 2.3s] KISHA: [surprised] Oh no! Here comes the rain!
[1:35.5 | max 2.7s] KISHA: [amazed] Wow! A rainbow, bright and bold!
[1:38.4 | max 1.7s] ZIGGY: [dreamy] Mmm… pure gold.
[1:43.2 | max 1.1s] BENNY: [hopeful] Rain all gone?
[1:45.1 | max 1.2s] BENNY: [upbeat] Right! Carry on?
[1:46.6 | max 3.7s] ZIGGY: [cheerful] Yes! Let's go, the sun is glowing!

[1:51.3 | max 1.7s] KIDS: [shouting happily] Hi, Ziggy, hi!
[1:53.0 | max 1.4s] ZIGGY: [warmly] Hello! Wave high!
[1:55.2 | max 1.5s] KISHA: [playful] Smile, Ziggy, smile!
[1:57.7 | max 1.9s] BENNY: [casual] Good day so far?
[2:00.0 | max 0.7s] ZIGGY: [happy] Yes!
[2:01.2 | max 1.2s] ZIGGY: [proudly] Best by a mile!

[2:03.2 | max 1.9s] KISHA: [amazed] Wow, what a day!
[2:05.1 | max 3.4s] ZIGGY: [warmly] The whole bright day is living here to stay!
[2:09.3 | max 1.8s] BENNY: [dismayed] Oh no! My battery's dead!
[2:11.6 | max 0.9s] KISHA: [gently] Yep!
[2:13.5 | max 1.4s] KISHA: [teasing] Even screens need bed!
[2:15.1 | max 1.4s] BENNY: [stunned] Was that all real?
[2:17.0 | max 0.5s] KISHA: [nodding] Yes!
[2:17.5 | max 1.0s] BENNY: [shocked] Today?!
[2:18.6 | max 0.9s] KISHA: [smiling] For real!
[2:19.7 | max 4.3s] BENNY: [sad, reflective] I held my screen from dawn till night… [sighs] and missed the whole day's light!
[2:24.2 | max 1.3s] BENNY: [hopeful] What's tomorrow's plan?
[2:26.0 | max 2.1s] ZIGGY: [warm, wise] Real-life fun. Snap all you can!

[2:29.0 | max 5.4s] CAPTAIN CYBER CHAMP: [friendly, to the viewer] Hey! When did something great zoom right by… and you almost missed it, 'cause your screen caught your eye?
[2:36.0 | max 3.3s] CAPTAIN CYBER CHAMP: [encouraging] Put it down, look up, and see: the best stuff's right here, for free!
[2:39.5 | max 2.9s] CAPTAIN CYBER CHAMP: [heroic, uplifting] Cyber Champions… that's you and me!
```

---

## 4. Getting the wow factor

- **Under-music bed:** keep the original music. Drop it about 3 dB under each line so the rhyme sits on top.
- **Sync the snapshots:** Kisha's "Done!", "Smile for me!", "Say cheese!", "tweet!" and "pure gold" land just before a photo pops up. Add a soft camera *click* SFX on each pop for extra punch.
- **The turn at 2:19:** Benny's "dawn till night… whole day's light" is the emotional beat. Generate it 3–4 times and keep the most sincere take.
- **The finale:** for "Cyber Champions… that's you and me!", try *Creative* stability and pick the most triumphant take. It closes on the "The End" card.
- **Never stretch a clip** past its Max. If it runs over, regenerate it or nudge the speed up. Don't move the start time.
