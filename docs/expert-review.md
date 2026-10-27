# Expert pre-launch review — Aqua Energizer

A full play-through on phone (430×932, iPhone) and computer (1440×900): loader → title → intro film → first run of level 1
→ tutorial → levels 9/16/22/26 → lose → win → level 30 → ending → home, levels map, Daily Dive, shop, rewards, settings.
Each item is graded by how much it hurts the first five minutes (that decides whether someone keeps playing or shares it).

Legend: **P0** = hurts first impression / looks broken · **P1** = clearly below the bar for a polished game · **P2** = polish.
Status: ✅ done in this pass · ⏳ needs the owner (assets / hosting) · — not doing (reason given).

## A. First impression (the "I must play that" moment)
| # | Pri | Problem | Fix | Status |
|---|---|---|---|---|
| A1 | P0 | **Loader** is a flat blue gradient, a progress bar and an odd empty ring next to "Ready!". It looks like a web page loading, not a game. | Painted backdrop with light rays + caustics, the logo bobbing, the waving diver, a glossy pearl-filled progress bar with a little diver swimming along it, rotating gameplay tips, a pulsing pearl instead of the empty ring. | ✅ |
| A2 | P0 | **Title screen**: the logo is stacked right on top of the live tank, so the tank, logo and button fight each other and the tank is half hidden. No hero character. | A composed title card: logo high up, the tank pushed down and framed, the waving diver in front, a glossy "Tap to dive" pill that breathes, bubbles drifting. | ✅ |
| A3 | P0 | **Intro film is too dark and muddy**: the first 15 s are a dim blue box; the storm hardly reads; the captions are small grey text that's easy to miss. | Lift the night grade (keep it moody but readable), stronger lightning flashes and storm streaks, captions in a frosted pill with bigger type that fades in word by word, a cinematic letterbox that slides in and out. | ✅ |
| A4 | P1 | The film's **Skip** button is the old cream pill (the only piece of the old UI style left). | Glossy navy pill with a progress ring that fills as the film plays. | ✅ |
| A5 | P0 | **Ending** (after level 30) is a static card: text runs into the border, no celebration for finishing the whole game. | A real finale: confetti/pearl fireworks, the 30 gate lights igniting one by one, stats counting up, a scrolling credits roll, then the card; text no longer clipped. | ✅ |
| A6 | P1 | Level-30 result button "The reef awakens ✨" wraps onto two lines on phones. | Shorter label + no wrapping. | ✅ |
| A7 | P1 | **Link previews**: sharing the game's link shows a bare URL (no title card, no picture). | `og:`/`twitter:` title, description, theme colour. A preview *picture* needs a public image URL. | ✅ text · ⏳ image when hosted |

## B. In-game look
| # | Pri | Problem | Fix | Status |
|---|---|---|---|---|
| B1 | P0 | **Reef rock walls are a flat wallpaper of identical cobbles**: on phones walls fill half the screen, so they set the look. World 2 (purple) and World 3 (grey with cyan dots) read like polka-dot tiles; there's no top edge, no depth, nothing growing. | Rock gets a lit bevel on edges that face the light and a shaded crease on the far side, sinks into shade toward the inside of a thick mass (depth from the distance to open water), broad light/dark patches, and World 3's glow spots are sparser. (A two-stone-size blend was tried and dropped: it looked pale and blobby on phones.) | ✅ |
| B2 | P0 | **The level intro card covers the board on phones** for 4–5 s (e.g. Level 9 "Crab" card sits on the crab's path), and the player can't see what they're about to play. | The card moves to the bottom of the screen above the buttons, and the first move dismisses it. | ✅ |
| B3 | P1 | Water surface at the top of the tank is a hard straight line. | Soft gradient with a bright moving meniscus. | ✅ |
| B4 | P1 | **Daily Dive card** still shows the flat drawn map (the only screen left with it). | A real photo of the day's tank, like every other level card. | ✅ |
| B5 | P2 | Daily Dive card on computers has an empty right half. | Two-column layout like the level card (photo + kit left, trick + Dive! right). | ✅ |

## C. Feel and flow
| # | Pri | Problem | Fix | Status |
|---|---|---|---|---|
| C1 | P1 | A tap on the title during the loader fade is ignored with no feedback. | The title pieces fade in once it can be used. | ✅ |
| C4 | — | Suspected bug: film Skip leaves a black screen. | Checked: Skip returns to home correctly; the black frames came from the test script, not the game. | ✅ not a bug |
| C2 | P1 | First move of every level: nothing tells you which way to go on levels without the coach. | The level-start reveal (pearl pings → gate) already does this; keep. | — already there |
| C3 | P1 | Win celebration, pearl hit-stop, combos, relics, danger glow, undo, hints | Already strong; checked, no change. | — already there |

## C+. Owner follow-up
| # | Pri | Problem | Fix | Status |
|---|---|---|---|---|
| C5 | P1 | Unlimited undo removes all tension. | 3 undos per try; the button only appears in a tight spot or after a crash, with the count on it. | ✅ |
| C6 | P1 | Night scenes in the intro look dull (flat blue wash, grey sand). | Moonlit colour grade: indigo shadows, teal mid-tones, silver moon glow, red pearls glowing warm. | ✅ |

## D. Size and speed (a 12 MB single file is a long wait on mobile data)
| # | Pri | Problem | Fix | Status |
|---|---|---|---|---|
| D1 | P1 | Sheet sprites are PNG (2.5 MB embedded). | Encode as WebP with alpha at build time (same look, ~60% smaller). | ✅ |
| D2 | P2 | Old stickman frames and unused textures are still embedded. | The old art set (0.6 MB) isn't used by any code path: dropped. The painted background is WebP too. Total 12.0 → 9.3 MB. | ✅ |
| D3 | P2 | Music is 3.9 MB. | Keep: it's the owner-approved mix; re-encoding lower would audibly hurt it. | — |

## E. Needs the owner
| # | What | Why |
|---|---|---|
| E1 | Public hosting URL → set `PUBLIC_URL` and an `og:image` | Shares then carry a link and a preview picture. |
| E2 | Voice-over MP3s (`src/assets/vo/`) | The film and tutorial are subtitle-only until then. |
| E3 | Per-world paintings (`bg_photo_w2/w3.jpg`) | Worlds 2–3 reuse World 1's painting with a tint. |
| E4 | Real-device check of haptics on iPhone (iOS 18 switch trick) | Can't be tested headless. |
