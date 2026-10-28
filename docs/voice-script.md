# Aqua Energizer — the voice script, by character

This is everything the story needs recorded, grouped by voice so each actor’s lines can be checked in one place. The spoken text is what players read on screen; the **[delivery]** is an ElevenLabs audio tag (not spoken). Lines already recorded (intro film, tutorial, diver quips) are not listed here and are skipped by the story-only mode of `make_voices.bat`.

## How to record without wasting credits

1. Run `make_voices.bat` → **1) Audition**, and type only the roles you want to hear (e.g. `grimtide,clack`). Each sample costs about 120–200 credits.
2. Every role uses its recommended voice automatically (change one under "pick" in voices.json). Eleven v4 only, no fallback.
3. Choose **5) Make the story lines only**. It shows how many characters (≈ credits) it will use and asks before it starts.
4. If one line comes out wrong, fix its text in `tools/voices.json` and use **4) Redo one line**.

## Totals

| role | voice (recommended) | lines | characters |
|---|---|---|---|
| narrator | Lily | 36 | 2,261 |
| diver | Jessica | 38 | 1,413 |
| pip | Laura | 100 | 4,689 |
| shelly | Matilda | 19 | 1,013 |
| clack | Bill | 32 | 1,696 |
| grimtide | Callum | 35 | 1,452 |
| murk | Brian | 18 | 772 |
| lumen | Charlie | 12 | 711 |
| mira | Sarah | 6 | 379 |
| cousin | Aria | 7 | 298 |
| snip | Liam | 9 | 350 |
| snap | Eric | 4 | 173 |
| keeper | Alice | 32 | 1,946 |
| **all** | | **348** | **17,153** |

ElevenLabs bills by characters, and the [delivery] tags count too: the whole story is **17,153 spoken characters, about 22,539 credits with tags** on a full-price model (turbo/flash models cost about half). `make_voices.bat` prints the exact number and asks before it spends anything. Auditions are extra (≈ 150 credits per sample).

## narrator — Lily

The storyteller. Warm and magical, but can turn tense and grave: this is a story with real danger.

| id | when | line |
|---|---|---|
| `s0_1` | Prologue · The Night the Lights Went Out | [warm, wonder] Once, the reef glowed every night. And the brightest light of all was the Great Lantern. |
| `s0_4` | Prologue · The Night the Lights Went Out | [tense, building] Grimtide, the eel who drinks light, rose out of the abyss, and the reef's lights poured into his jaws. |
| `s0_6` | Prologue · The Night the Lights Went Out | [hushed, sad] The Reef Keeper gave all her light to save the Lantern. Grimtide fled… and the whole reef went dark. |
| `s1_1` | Chapter 1 · Through the Old Pipe | [amused, warm] The first gate wakes, and its light shoots down an old pipe. With you in it. |
| `s1_4` | Chapter 1 · Through the Old Pipe | [hushed, ominous] Far away, in the dark, something very big opens one red eye. |
| `s5_1` | Chapter 5 · Jelly Bounce | [warm] Five gates awake, and the jellyfish are humming. They want to help. |
| `s6_1` | Chapter 6 · The Keeper’s Map | [hushed] Inside the old wreck: a chest with a seashell lock. |
| `s7_1` | Chapter 7 · The Lure | [curious] In a dark hollow, a soft light glows. A gate? It looks just like one. |
| `s7_ok2` | Chapter 7 · The Lure — after “Hold on to the map!” (done in time) | [tense] The map tears in two. A torn corner drifts off into the dark. |
| `s7_no2` | Chapter 7 · The Lure — after “Hold on to the map!” (missed) | [tense] He rips it free. A torn corner drifts off into the dark. |
| `s8_2` | Chapter 8 · Follow the Fish | [wonder] Then the fish remember the gates. They swirl into a big silver arrow. |
| `s9_4` | Chapter 9 · The Torn Map | [ominous] Behind the dune, ink hangs in the water. Fresh ink. |
| `s12_1` | Chapter 12 · The Silent Clam | [gently] Giant clams open, one by one, and sing the Keeper’s old song. |
| `s12_2` | Chapter 12 · The Silent Clam | [singing softly] “Share your light, and the light comes home…” *(The Clam Choir)* |
| `s12_3` | Chapter 12 · The Silent Clam | [sad] But the last clam stays shut. Grimtide stole its pearl, and its song. |
| `s13_1` | Chapter 13 · The Dark Storm | [tense] The water goes black. The storm has found you. |
| `s13_4` | Chapter 13 · The Dark Storm | [slow, heartbroken] Shelly takes the whole blow… and sinks, slowly, to the sand. |
| `s16_4` | Chapter 16 · The Prisoner | [tense] Before you can answer, a tail yanks him back into the dark. |
| `s17_1` | Chapter 17 · The Arch’s Secret | [curious] An old coral arch blocks the way. Its lamps went out in the storm. |
| `s17_2` | Chapter 17 · The Arch’s Secret | [ancient, echoing] “Grimtide fears one thing: light that is given away.” *(The Coral Arch)* |
| `s17_no1` | Chapter 17 · The Arch’s Secret — after “Light the lamps!” (missed) | [gentle] One by one, the old lamps flicker awake on their own. |
| `s18_1` | Chapter 18 · A Secret Trail | [wonder] Pearls float up from the sand like little lanterns. A trail. |
| `s20_1` | Chapter 20 · The Lantern in Chains | [awed] From the last cliff of the caves, you see it: the Great Lantern. |
| `s20_2` | Chapter 20 · The Lantern in Chains | [ominous] And wrapped around it like a storm cloud: Grimtide. |
| `s23_1` | Chapter 23 · The Mural | [hushed] An old sea city. On its last wall: the Reef Keeper and a giant purple octopus. |
| `s24_5` | Chapter 24 · Ambush | [slow, grave] Clack leaps at the tail. One mighty pinch… and the tail swats him into the dark. |
| `s25_3` | Chapter 25 · The Captain’s Last Order | [whispered] And the Captain is still. |
| `s26_ok1` | Chapter 26 · Breaking the Chains — after “Give your light!” (done in time) | [soaring] You hold up a glowing pearl and give it away. The ink chains melt. |
| `s26_no1` | Chapter 26 · Breaking the Chains — after “Give your light!” (missed) | [soaring] The pearl’s light pours out on its own, and the ink chains melt. |
| `s28_2` | Chapter 28 · The Deep Rises | [building, epic] Every wave sets the plankton glowing. Then the jellies. Then the fish. Then everyone. |
| `s28_3` | Chapter 28 · The Deep Rises | [proud, emotional] Clack’s crew raise his tiny hat high. |
| `s30_2` | Chapter 30 · The Reef’s Revenge | [soaring] Every creature in the sea gives its light at once. Way too much light. Freely given. |
| `s30_4` | Chapter 30 · The Reef’s Revenge | [triumphant, amused] And the mighty Grimtide shrinks… to a tiny, wriggling, very grumpy worm. |
| `s30_8` | Chapter 30 · The Reef’s Revenge | [warm, soaring] The Heart Pearl rises home. And the whole reef shines. |
| `l1_s` | Level 1: level starts | [gently] Dig into the sand. Push the red pearl into the gate. |
| `l1_g` | Level 1: gate opens | [excited] The gate is awake! Swim in! |

## diver — Jessica

Spark, the hero. Young, brave, kind, a little cheeky. Cries once (chapter 25). Shouts in the big moments.

| id | when | line |
|---|---|---|
| `s1_cbrave_1` | Chapter 1 · Through the Old Pipe — choice “Who are you?”: brave answer “I'm here to turn the lights back on.” | [determined, confident] I'm the one who's going to turn the lights back on. |
| `s1_cfunny_1` | Chapter 1 · Through the Old Pipe — choice “Who are you?”: funny answer “A lost tourist. Gift shop?” | [playful] Just a very lost tourist. Is there a gift shop? |
| `s1_ckind_1` | Chapter 1 · Through the Old Pipe — choice “Who are you?”: kind answer “A friend. You okay?” | [gentle, warm] A friend. Are you okay, little guy? |
| `s2_2` | Chapter 2 · Pip’s Glow | [teasing] Who called you that? |
| `s4_cbrave_1` | Chapter 4 · Captain Clack — choice “Name, rank, snack?”: brave answer “Spark. Snacks later, heroics now.” | [confident] Spark. Gate-waker. Snacks later, heroics now. |
| `s4_cfunny_1` | Chapter 4 · Captain Clack — choice “Name, rank, snack?”: funny answer “Spark. Seaweed chips.” | [playful] Spark. Professional tourist. Seaweed chips, extra salty. |
| `s4_ckind_1` | Chapter 4 · Captain Clack — choice “Name, rank, snack?”: kind answer “The famous captain, I presume?” | [warm, flattering] Spark. And you must be the famous captain everyone talks about. |
| `s5_3` | Chapter 5 · Jelly Bounce | [laughing] Boing… boing… whoa-ho-HO! |
| `s7_ok1` | Chapter 7 · The Lure — after “Hold on to the map!” (done in time) | [straining, through gritted teeth] Not! Letting! GO! |
| `s7_no1` | Chapter 7 · The Lure — after “Hold on to the map!” (missed) | [desperate] No! The map! |
| `s8_cbrave_1` | Chapter 8 · Follow the Fish — choice “Cheer Pip up”: brave answer “We'll find the gates ourselves.” | [determined] We don't need his map. We'll find the gates ourselves. |
| `s8_cfunny_1` | Chapter 8 · Follow the Fish — choice “Cheer Pip up”: funny answer “It WAS a very pretty light.” | [playful] In your defence, it WAS a very pretty light. |
| `s8_ckind_1` | Chapter 8 · Follow the Fish — choice “Cheer Pip up”: kind answer “You warned me. We're a team.” | [gentle] Hey. You warned me. I didn't listen. We're in this together. |
| `s9_2` | Chapter 9 · The Torn Map | [thoughtful] It only shows one gate. On the edge of a cliff. |
| `s11_cbrave_1` | Chapter 11 · Voices in the Caves — choice “Answer Grimtide”: brave answer “Then we'll light them ALL.” | [defiant] Then we'll light every single one. |
| `s11_cfunny_1` | Chapter 11 · Voices in the Caves — choice “Answer Grimtide”: funny answer “Do you always talk this much?” | [cheeky] Do you always talk this much in caves? |
| `s11_ckind_1` | Chapter 11 · Voices in the Caves — choice “Answer Grimtide”: kind answer “Stay close, Pip.” | [gentle, steady] Stay close, Pip. He's just trying to scare you. |
| `s13_ok1` | Chapter 13 · The Dark Storm — after “Get everyone through the storm!” (done in time) | [straining] I've got you, Pip! Don't let go! |
| `s13_no2` | Chapter 13 · The Dark Storm — after “Get everyone through the storm!” (missed) | [desperate] Shelly! Where are you?! |
| `s14_cbrave_1` | Chapter 14 · Rest, Old Friend — choice “Promise Shelly”: brave answer “I promise. Then I'm coming back.” | [determined, holding back tears] I promise. And then I'm coming back for you. |
| `s14_cfunny_1` | Chapter 14 · Rest, Old Friend — choice “Promise Shelly”: funny answer “Promise. You owe me a story.” | [teary, smiling] Promise. But you owe me a bedtime story. |
| `s14_ckind_1` | Chapter 14 · Rest, Old Friend — choice “Promise Shelly”: kind answer “Rest, Shelly. We've got this.” | [gentle, tearful] Rest, Shelly. We've got this. |
| `s17_4` | Chapter 17 · The Arch’s Secret | [realizing, excited] That's how we beat him, Pip. And how we free Murk. |
| `s19_cbrave_1` | Chapter 19 · Good News — choice “Message for home”: brave answer “Tell him to hurry up!” | [fired up] Tell him to hurry. We're not slowing down. |
| `s19_cfunny_1` | Chapter 19 · Good News — choice “Message for home”: funny answer “We’ll save him a bit of reef.” | [playful] Tell him we'll save him a little bit of reef. |
| `s19_ckind_1` | Chapter 19 · Good News — choice “Message for home”: kind answer “Tell Shelly we love her.” | [warm, emotional] Tell Shelly we love her. |
| `s23_3` | Chapter 23 · The Mural | [shaken, quiet] It's my lamp. It's the same lamp. |
| `s24_ok1` | Chapter 24 · Ambush — after “Chase Grimtide! Save Pip!” (done in time) | [desperate] I've got you! I've got… NO! |
| `s24_no1` | Chapter 24 · Ambush — after “Chase Grimtide! Save Pip!” (missed) | [screaming] PIP! |
| `s25_cbrave_1` | Chapter 25 · The Captain’s Last Order — choice “Answer the Captain”: brave answer “You were magnificent, Captain.” | [crying, proud] You were magnificent, Captain. |
| `s25_cfunny_1` | Chapter 25 · The Captain’s Last Order — choice “Answer the Captain”: funny answer “He'll walk funny for a week.” | [crying, laughing] He'll be walking funny for a week. |
| `s25_ckind_1` | Chapter 25 · The Captain’s Last Order — choice “Answer the Captain”: kind answer “You saved us, Captain.” | [gentle, tearful] You did, Captain. You saved us. |
| `s26_3` | Chapter 26 · Breaking the Chains | [gentle] Murk. This was her lamp, wasn’t it? |
| `s27_cbrave_1` | Chapter 27 · Over the Abyss — choice “Answer Murk”: brave answer “This time, we go together.” | [resolute] This time, we all go together. |
| `s27_cfunny_1` | Chapter 27 · Over the Abyss — choice “Answer Murk”: funny answer “Eight arms. Use them ALL.” | [playful] Well, you have eight arms now. Use them ALL. |
| `s27_ckind_1` | Chapter 27 · Over the Abyss — choice “Answer Murk”: kind answer “It wasn't your fault, Murk.” | [gentle] It wasn't your fault, Murk. |
| `s29_3` | Chapter 29 · Grimtide’s Lair | [calm, defiant] You’re wrong about one thing. That light isn’t yours. We’re giving it away. |
| `s30_ok1` | Chapter 30 · The Reef’s Revenge — after “Give the light away!” (done in time) | [shouting] It was never yours! |

## pip — Laura

A tiny seahorse. Talks fast when nervous (often), jokes to hide fear, huge heart. Arc: scared sidekick → brave friend.

| id | when | line |
|---|---|---|
| `s0_2` | Prologue · The Night the Lights Went Out | [excited, showing off] Ooh! Ooh! Look at me! I'm the second brightest thing here! |
| `s0_7` | Prologue · The Night the Lights Went Out | [tiny, scared, alone] Hello…? Anybody…? |
| `s1_2` | Chapter 1 · Through the Old Pipe | [excited, rapid] AAAH! A light! A real light! Are you a light? Are you a fish? Are you a light-fish? |
| `s1_3` | Chapter 1 · Through the Old Pipe | [giggling] I'm Pip! And you're a spark. That's your name now. Spark. No take-backs. |
| `s1_cbrave_2` | Chapter 1 · Through the Old Pipe — choice “Who are you?”: brave answer “I'm here to turn the lights back on.” | [excited, nervous] Ooh. Cool. Can I come? I'm very brave. Mostly in my head. |
| `s1_cfunny_2` | Chapter 1 · Through the Old Pipe — choice “Who are you?”: funny answer “A lost tourist. Gift shop?” | [laughing] Ha! A funny one! The reef has been SO not funny lately. |
| `s1_ckind_2` | Chapter 1 · Through the Old Pipe — choice “Who are you?”: kind answer “A friend. You okay?” | [touched, soft] Nobody's asked me that since the storm. I'm… better now. |
| `s2_1` | Chapter 2 · Pip’s Glow | [proud] Real talk, Spark. I used to GLOW. People called me Pip the Bright. |
| `s2_3` | Chapter 2 · Pip’s Glow | [flustered, then scared] …Me. I called me that. But then the storm came, and it had EYES. Red ones. And it ate every light in the reef. |
| `s2_4` | Chapter 2 · Pip’s Glow | [excited] But when your gate woke up, I sparkled! Just a teeny bit! Do it again! Do it again! |
| `s3_3` | Chapter 3 · Shelly’s Tale | [horrified] Drinks it? Like a smoothie? |
| `s3_5` | Chapter 3 · Shelly’s Tale | [trembling, pretending] I'm not scared. My fins are just cold. |
| `s4_4` | Chapter 4 · Captain Clack | [deadpan] I've been here five seconds. |
| `s5_2` | Chapter 5 · Jelly Bounce | [excited] They're making a bouncy staircase! Jump, Spark! Jump! |
| `s6_2` | Chapter 6 · The Keeper’s Map | [excited, nervous] Open it! No, wait, what if it bites? Open it! No! Okay. Open it. |
| `s6_5` | Chapter 6 · The Keeper’s Map | [deadpan] You're holding it upside down. |
| `s7_2` | Chapter 7 · The Lure | [nervous] Spark… gates don't usually wink at you. |
| `s7_5` | Chapter 7 · The Lure | [crying softly] Spark… my glow. It's going out again. |
| `s8_1` | Chapter 8 · Follow the Fish | [sniffling] This is my fault. I said “ooh, pretty light”. I literally said “ooh”. |
| `s8_4` | Chapter 8 · Follow the Fish | [laughing through tears] Ha! Who needs his map anyway? |
| `s8_cbrave_2` | Chapter 8 · Follow the Fish — choice “Cheer Pip up”: brave answer “We'll find the gates ourselves.” | [brave, sniffly] Ourselves. Okay! I am GREAT at ourselves. |
| `s8_cfunny_2` | Chapter 8 · Follow the Fish — choice “Cheer Pip up”: funny answer “It WAS a very pretty light.” | [laughing through tears] It was SO pretty. Okay. I feel a little better. |
| `s8_ckind_2` | Chapter 8 · Follow the Fish — choice “Cheer Pip up”: kind answer “You warned me. We're a team.” | [soft, grateful] …Together. Okay. Together. |
| `s9_1` | Chapter 9 · The Torn Map | [excited] Look! The torn piece of the map! It blew all the way here! |
| `s10_1` | Chapter 10 · The Edge of the Shallows | [scared] That's the Coral Caves down there. Maybe we take the stairs? |
| `s10_ok1` | Chapter 10 · The Edge of the Shallows — after “Escape Snip & Snap!” (done in time) | [breathless, giddy] We lost them! Did we lose them? WE LOST THEM! |
| `s10_no1` | Chapter 10 · The Edge of the Shallows — after “Escape Snip & Snap!” (missed) | [whiny, relieved] Ow! Ow! They nibbled my tail! …But we're alive! Mostly! |
| `s11_2` | Chapter 11 · Voices in the Caves | [panicking] He can see us! Spark, he can SEE us! |
| `s11_ckind_2` | Chapter 11 · Voices in the Caves — choice “Answer Grimtide”: kind answer “Stay close, Pip.” | [small, brave] It's working. But… okay. Closer. |
| `s13_ok2` | Chapter 13 · The Dark Storm — after “Get everyone through the storm!” (done in time) | [panicking] I'm holding! I'm holding! Where's Shelly?! |
| `s13_no1` | Chapter 13 · The Dark Storm — after “Get everyone through the storm!” (missed) | [screaming] Spark! I can't hold on! |
| `s14_1` | Chapter 14 · Rest, Old Friend | [crying] Shelly? Shelly, please wake up… |
| `s15_3` | Chapter 15 · Mira | [laughing, teary] That's definitely Shelly. |
| `s15_ok1` | Chapter 15 · Mira — after “Ride the canyon with Mira!” (done in time) | [giddy, then soft] WHEEEE! Again! AGAIN! Shelly would have LOVED that! |
| `s15_no1` | Chapter 15 · Mira — after “Ride the canyon with Mira!” (missed) | [queasy] I think I swallowed a jellyfish. Is that bad? It feels bad. |
| `s16_1` | Chapter 16 · The Prisoner | [terrified whisper] Spark… there are EYES in there. Big ones. Bigger than Shelly! |
| `s17_3` | Chapter 17 · The Arch’s Secret | [puzzled] Given away? But he TAKES light. He's a light-taker. A big… taking… noodle. |
| `s17_ok1` | Chapter 17 · The Arch’s Secret — after “Light the lamps!” (done in time) | [excited] You did it! The arch remembers! |
| `s18_2` | Chapter 18 · A Secret Trail | [excited] Murk left them! He's helping us! In secret! Like a spy! A big squishy spy! |
| `s19_2` | Chapter 19 · Good News | [overjoyed] She's okay? SHE'S OKAY! Spark! She's okay! |
| `s20_4` | Chapter 20 · The Lantern in Chains | [frightened] Why does he keep talking about FOOD? |
| `s22_3` | Chapter 22 · Whale Song | [overjoyed] CLACK! |
| `s23_2` | Chapter 23 · The Mural | [stunned whisper] Spark… look at her helmet. Look at her LAMP. |
| `s24_1` | Chapter 24 · Ambush | [joyful] Twenty-four gates! We're going to make it, Spark! We're actually going to— |
| `s24_3` | Chapter 24 · Ambush | [screaming, fading] Spaaark! |
| `s24_ok2` | Chapter 24 · Ambush — after “Chase Grimtide! Save Pip!” (done in time) | [screaming, fading] Spaaark! Don’t let go of the reef! |
| `s26_1` | Chapter 26 · Breaking the Chains | [crying, joyful] Spark! You came! I knew you’d come! I said “Spark will come” like four hundred times! |
| `s27_3` | Chapter 27 · Over the Abyss | [brave, shaky] I'm not scared. My fins are just… okay, I'm scared. But I'm going anyway! |
| `s29_2` | Chapter 29 · Grimtide’s Lair | [horrified] THAT'S why he let us! We've been cooking his DINNER! |
| `s29_no2` | Chapter 29 · Grimtide’s Lair — after “Through the coils! Reach the Lantern!” (missed) | [shrieking, relieved] Eight arms! Best seatbelt EVER! |
| `s30_7_brave` | Chapter 30 · The Reef’s Revenge (if the player is mostly brave) | [shrieking with joy] CLACK?! You were brave the whole way, Spark. Everybody was! |
| `s30_7_funny` | Chapter 30 · The Reef’s Revenge (if the player is mostly funny) | [shrieking with joy] CLACK?! Spark, you made me laugh the whole way. And now THIS! |
| `s30_7_kind` | Chapter 30 · The Reef’s Revenge (if the player is mostly kind) | [shrieking with joy] CLACK?! Spark, you were kind the whole way. That’s why it worked. |
| `s30_no1` | Chapter 30 · The Reef’s Revenge — after “Give the light away!” (missed) | [shouting] Everybody, NOW! Give it away! |
| `l2_s` | Level 2: level starts | [urgent, cheeky] Psst, Spark! Stones fall if you dig under them. Don’t be under them! |
| `l2_p` | Level 2: first pearl in | [giggling] Ooh, I felt that! My glow tickles! |
| `l2_g` | Level 2: gate opens | [overjoyed] Two gates! Look, look, I’m sparkling! |
| `l3_s` | Level 3: level starts | [nervous, fast] A giant eel who drinks light… Nope. Not thinking about it. Digging! |
| `l3_m` | Level 3: after 24 s of play | [scared whisper] Did… did something just blink out there? |
| `l4_g` | Level 4: gate opens | [cheeky] Four gates! Take that, Grimtide! |
| `l5_p` | Level 5: first pearl in | [fierce] Don’t listen to them, Spark! Drop a stone on them! |
| `l6_s` | Level 6: level starts | [focused] Jellyfish float up and down. Wait for the gap… then go! |
| `l6_g` | Level 6: gate opens | [excited] Six! The wreck is right there! |
| `l7_s` | Level 7: level starts | [careful] The map says this gate has a keystone. Careful where you dig. |
| `l7_m` | Level 7: after 24 s of play | [dreamy] Spark… do you see that glow over there? It’s so pretty… |
| `l8_s` | Level 8: level starts | [sniffling] My glow is so faint… Stay close to me, okay? |
| `l8_g` | Level 8: gate opens | [amazed] We found it without the map! We actually did it! |
| `l9_s` | Level 9: level starts | [whispering] Ink everywhere… He came this way. |
| `l9_g` | Level 9: gate opens | [excited] Nine! The torn map piece is close. I can feel it! |
| `l10_g` | Level 10: gate opens | [scared, brave] Ten gates. Hold my fin, Spark. Here comes the cliff… |
| `l11_m` | Level 11: after 24 s of play | [defiant] Every crystal we light, he sees us. So let’s light them ALL. |
| `l11_g` | Level 11: gate opens | [cheeky] Eleven! Ha! He can echo all he likes! |
| `l12_p` | Level 12: first pearl in | [soft] That pearl is for the silent clam. I just know it. |
| `l12_g` | Level 12: gate opens | [uneasy] Twelve. Why does the water feel so heavy? |
| `l13_s` | Level 13: level starts | [scared] Something’s wrong. The water’s going dark… |
| `l14_s` | Level 14: level starts | [quiet, sad] Shelly would want us to keep going. So we keep going. |
| `l14_g` | Level 14: gate opens | [soft, tearful] Fourteen. Rest well, Shelly. |
| `l15_s` | Level 15: level starts | [determined] For Shelly. Let’s go! |
| `l15_g` | Level 15: gate opens | [happy, tearful] Fifteen gates! She’d be so proud of us. |
| `l16_s` | Level 16: level starts | [worried] That poor octopus… and why did he ask about your lamp? |
| `l16_g` | Level 16: gate opens | [determined] Sixteen. Whatever it takes, Spark. We free him. |
| `l17_s` | Level 17: level starts | [thinking aloud] Light that’s given away… How do you give light away? |
| `l17_p` | Level 17: first pearl in | [realizing, excited] Wait. Every pearl we give the gate… is light, given away! |
| `l17_g` | Level 17: gate opens | [excited] Seventeen! Look, pearls rising from the sand! |
| `l18_g` | Level 18: gate opens | [curious, excited] Eighteen! Someone’s coming… my cousins? |
| `l19_p` | Level 19: first pearl in | [joyful] Shelly’s okay! I can’t stop smiling! |
| `l20_s` | Level 20: level starts | [uneasy] He’s wrapped around the Lantern… What did he mean, “setting the table”? |
| `l20_g` | Level 20: gate opens | [brave] Twenty. The Deep is next. Stay close. |
| `l23_m` | Level 23: after 24 s of play | [awed] Your lamp, Spark… it’s really hers. That’s amazing. And kind of scary. |
| `l23_g` | Level 23: gate opens | [determined] Twenty-three. Murk, we’re coming! |
| `l24_m` | Level 24: after 24 s of play | [uneasy] Stay close, Spark. Something feels wrong today. |
| `l24_g` | Level 24: gate opens | [joyful, then scared] Twenty-four! Look how bright it is! Wait… what’s that shadow? |
| `l26_m` | Level 26: after 24 s of play | [faint, echoing, crying] Spark? Is that you? Hurry! |
| `l27_s` | Level 27: level starts | [brave] Thank you for coming for me. Now let’s finish this! |
| `l28_g` | Level 28: gate opens | [triumphant] Twenty-eight! Everyone is with us! |
| `l30_s` | Level 30: level starts | [nervous, brave] This is it. The last gate. Ready, Spark? |
| `l30_g` | Level 30: gate opens | [shouting] Now! Swim in, and give the light away! |
| `k_crushed_1` | Dive failed (crushed), levels 1–30 | [panicked] Spark! No, no, no… Undo it! Please! |
| `k_monster_3` | Dive failed (monster), levels 1–30 | [screaming] Spark! Get away from it! |
| `k_oxygen_1` | Dive failed (oxygen), levels 1–30 | [panicked] Spark, your air! Hold on! |

## shelly — Matilda

A 200-year-old sea turtle. Slow, dry, grandmotherly, with a temper. Struck down in ch. 13, returns furious in ch. 25.

| id | when | line |
|---|---|---|
| `s3_1` | Chapter 3 · Shelly’s Tale | [slow, gravelly, dry] Red eyes? Hmph. Two hundred years I have lived, and I have seen red eyes once. |
| `s3_2` | Chapter 3 · Shelly’s Tale | [deadpan] Grimtide. An eel as long as a shipwreck, with an ego twice that size. He drinks light. |
| `s3_4` | Chapter 3 · Shelly’s Tale | [deadpan, urgent] Like a smoothie. The Keeper built thirty gates to stop him. You woke one, so now he knows about you. Hop on. |
| `s12_4` | Chapter 12 · The Silent Clam | [warm but worried] Remember that tune, little ones. You’ll need it soon. |
| `s13_3` | Chapter 13 · The Dark Storm | [shouting, commanding] Everyone behind my shell! NOW! |
| `s14_2` | Chapter 14 · Rest, Old Friend | [weak, dry humour] Hush. My shell has survived worse. Clack’s singing, for one. |
| `s14_3` | Chapter 14 · Rest, Old Friend | [weak, earnest] But I can't swim on. Promise me you'll wake every gate. Every last one. |
| `s14_cbrave_2` | Chapter 14 · Rest, Old Friend — choice “Promise Shelly”: brave answer “I promise. Then I'm coming back.” | [weak, proud] I’ll hold you to that. |
| `s14_cfunny_2` | Chapter 14 · Rest, Old Friend — choice “Promise Shelly”: funny answer “Promise. You owe me a story.” | [weak laugh] Deal. It’s a long one. Two hundred years. |
| `s14_ckind_2` | Chapter 14 · Rest, Old Friend — choice “Promise Shelly”: kind answer “Rest, Shelly. We've got this.” | [weak, tender] I know you do. That’s why I can rest. |
| `s25_4` | Chapter 25 · The Captain’s Last Order | [grieving, then fierce] You brave, loud, wonderful fool. Up, little one. Grimtide has Pip. And I have two hundred years of anger. |
| `l3_g` | Level 3: gate opens | [warm, dry] Well done, little one. Now swim in, before my old bones get cold. |
| `l12_s` | Level 12: level starts | [calm, slow] Breathe slow, little one. Air is precious this deep. |
| `l13_g` | Level 13: gate opens | [urgent] Swim in, quickly! Something huge is coming! |
| `l25_s` | Level 25: level starts | [fierce, grieving] For Clack. For Pip. Wake this gate. |
| `l25_g` | Level 25: gate opens | [fierce] Hold on, Pip. We’re coming! |
| `l26_s` | Level 26: level starts | [tense] Murk’s den is close. I can hear Pip. |
| `l26_g` | Level 26: gate opens | [fierce] Twenty-six. Now, to Pip! |
| `k_oxygen_2` | Dive failed (oxygen), levels 3–13 | [worried] Too deep, too long. Come back up, child. |

## clack — Bill

Captain of the Crack Crab Crew. Loud, pompous, secretly soft. Comic relief who dies a hero in ch. 24–25.

| id | when | line |
|---|---|---|
| `s4_1` | Chapter 4 · Captain Clack | [booming, pompous] HALT! In the name of the Crack Crab Crew! State your name, rank, and favourite snack! |
| `s4_2` | Chapter 4 · Captain Clack | [dramatic, exaggerating] We rescued these pearls from the sand. Grimtide’s tail took the rest. Thick as a mast! Thicker! Two masts! |
| `s4_3` | Chapter 4 · Captain Clack | [grand] The Crack Crab Crew sails with you! Pip, you're promoted to Deputy Assistant Vice Captain. |
| `s4_5` | Chapter 4 · Captain Clack | [proud] And already a natural! |
| `s4_cbrave_2` | Chapter 4 · Captain Clack — choice “Name, rank, snack?”: brave answer “Spark. Snacks later, heroics now.” | [delighted] HA! A diver with priorities! I like you already! |
| `s4_cfunny_2` | Chapter 4 · Captain Clack — choice “Name, rank, snack?”: funny answer “Spark. Seaweed chips.” | [delighted] Seaweed chips! A diver of TASTE! Crew, this one is one of us! |
| `s4_ckind_2` | Chapter 4 · Captain Clack — choice “Name, rank, snack?”: kind answer “The famous captain, I presume?” | [flustered, proud] Famous? Me? Well. Yes. Obviously. Crew, did you HEAR that? |
| `s5_4` | Chapter 5 · Jelly Bounce | [pompous, then delighted] A captain does NOT bounce. A captain ascends. With dignity. WHEEEE! |
| `s6_4` | Chapter 6 · The Keeper’s Map | [proud] A treasure map! Hand it here, crew. Captains are excellent with maps. |
| `s8_3` | Chapter 8 · Follow the Fish | [triumphant] FISH! Of course! Exactly as I planned. I planned fish. |
| `s9_3` | Chapter 9 · The Torn Map | [grumbling] Cliffs. Of course it’s cliffs. Crabs and cliffs have a long and painful history. |
| `s10_4` | Chapter 10 · The Edge of the Shallows | [yelling, fading away] Crabs… don’t… fall… WELLLLL! |
| `s11_4` | Chapter 11 · Voices in the Caves | [heroic] Crew! We came to pinch, and pinch we shall! |
| `s14_4` | Chapter 14 · Rest, Old Friend | [gruff, emotional] Go. I’ll stand guard. Nobody touches this turtle while Clack has claws. |
| `s22_2` | Chapter 22 · Whale Song | [booming] Did somebody say CAPTAIN? |
| `s22_4` | Chapter 22 · Whale Song | [proud, chuckling] Shelly sends her love. And a VERY rude message for Grimtide. I’ll deliver it personally. |
| `s24_4` | Chapter 24 · Ambush | [roaring, charging] Let him go, you overgrown NOODLE! |
| `s25_1` | Chapter 25 · The Captain’s Last Order | [weak, rasping] Gate-waker… did I get him? Tell me I pinched him good. |
| `s25_2` | Chapter 25 · The Captain’s Last Order | [weak, fading] Tell my crew… they were the finest crew… on the whole reef. |
| `s25_cbrave_2` | Chapter 25 · The Captain’s Last Order — choice “Answer the Captain”: brave answer “You were magnificent, Captain.” | [weak, smiling] Magnificent… put that on my shell. |
| `s25_cfunny_2` | Chapter 25 · The Captain’s Last Order — choice “Answer the Captain”: funny answer “He'll walk funny for a week.” | [weak laugh] Ha… good. Good. |
| `s25_ckind_2` | Chapter 25 · The Captain’s Last Order — choice “Answer the Captain”: kind answer “You saved us, Captain.” | [weak, at peace] Then it was worth it. |
| `s30_6` | Chapter 30 · The Reef’s Revenge | [muffled, then booming] Did somebody say… CAPTAIN? |
| `l4_s` | Level 4: level starts | [booming] Crew! Escort the gate-waker! Eyes sharp, claws sharper! |
| `l4_p` | Level 4: first pearl in | [proud] A fine push! I taught you that. I didn’t. But I would have. |
| `l5_g` | Level 5: gate opens | [triumphant] HA! Five gates! Hear that? The jellies are singing! |
| `l6_m` | Level 6: after 24 s of play | [wise, pompous] Patience, gate-waker. A good captain waits for the tide. |
| `l8_m` | Level 8: after 24 s of play | [blustering] No map, no problem! I have an excellent sense of direction. Mostly. |
| `l14_m` | Level 14: after 24 s of play | [distant, shouting] She’s sleeping sound, gate-waker! I’ve got her! |
| `l22_s` | Level 22: level starts | [booming] Captain on deck! Now, where’s this gate I keep hearing about? |
| `l22_g` | Level 22: gate opens | [triumphant] Twenty-two! Grimtide’s getting weaker, crew! |
| `k_crushed_3` | Dive failed (crushed), levels 4–24 | [shouting] Man down! MAN DOWN! |

## grimtide — Callum

The villain: a giant eel who drinks light. Silky and amused at first, then hungry, then furious. Never shouts until he does.

| id | when | line |
|---|---|---|
| `s0_3` | Prologue · The Night the Lights Went Out | [silky, hungry] Such pretty little lights. I'll take them. ALL of them. |
| `s7_3` | Chapter 7 · The Lure | [silky, amused] Thank you, little light. A map with every gate marked. How thoughtful. |
| `s7_4` | Chapter 7 · The Lure | [menacing whisper] Do keep waking them. I'll be waiting at every single one. |
| `s11_1` | Chapter 11 · Voices in the Caves | [echoing, amused] Welcome to my caves, little light. Mind the echo. It's ME. |
| `s11_3` | Chapter 11 · Voices in the Caves | [echoing whisper] Every crystal you light shows me where you are. Shine away. |
| `s11_cbrave_2` | Chapter 11 · Voices in the Caves — choice “Answer Grimtide”: brave answer “Then we'll light them ALL.” | [amused, menacing] …Bold. I like bold. Bold tastes better. |
| `s11_cfunny_2` | Chapter 11 · Voices in the Caves — choice “Answer Grimtide”: funny answer “Do you always talk this much?” | [offended, flustered] I… That is… how RUDE. |
| `s13_2` | Chapter 13 · The Dark Storm | [roaring] Thirteen gates, little light? Thirteen too many! |
| `s13_5` | Chapter 13 · The Dark Storm | [cold, quiet] One down. |
| `s18_3` | Chapter 18 · A Secret Trail | [suspicious, cold, distant] Murk… Why are my pearls floating away, Murk? |
| `s20_3` | Chapter 20 · The Lantern in Chains | [delighted, menacing] Twenty gates! You think you’re saving the reef? You’re setting my table. |
| `s24_2` | Chapter 24 · Ambush | [roaring] ENOUGH! |
| `s24_6` | Chapter 24 · Ambush | [cold, triumphant] Come to my lair, little light. Or never see your seahorse again. |
| `s24_no2` | Chapter 24 · Ambush — after “Chase Grimtide! Save Pip!” (missed) | [cold, amused] Too slow, little light. Much too slow. |
| `s28_4` | Chapter 28 · The Deep Rises | [distant, mocking] Light them all, little light. More for me. |
| `s29_1` | Chapter 29 · Grimtide’s Lair | [hungry, rising] Twenty-nine gates. The Lantern is nearly full. Wake the last, and I drink it ALL. |
| `s29_4` | Chapter 29 · Grimtide’s Lair | [menacing whisper] Then come, Keeper’s child. Let’s see who shines last. |
| `s29_ok2` | Chapter 29 · Grimtide’s Lair — after “Through the coils! Reach the Lantern!” (done in time) | [hissing, furious] Clever little light. It will not save you. |
| `s30_1` | Chapter 30 · The Reef’s Revenge | [greedy, ecstatic] YES! Give it to me! |
| `s30_3` | Chapter 30 · The Reef’s Revenge | [screaming] No… NO! It BURNS! Too bright! Too SHARED! |
| `l7_g` | Level 7: gate opens | [silky whisper] Yes, little light. Come and see the pretty glow… |
| `l9_m` | Level 9: after 24 s of play | [distant, amused] I can smell your little lamp from here. |
| `l11_s` | Level 11: level starts (in-level cutscene) | [echoing whisper] Little light… turn back. |
| `l13_m` | Level 13: after 24 s of play | [menacing, close] I’m coming for you, little light. |
| `l16_m` | Level 16: after 24 s of play | [roaring, distant] Murk! Back to work! |
| `l18_m` | Level 18: after 24 s of play | [suspicious, cold] Murk… who are you whispering to? |
| `l20_m` | Level 20: after 24 s of play | [hungry whisper] Hurry, little light. I’m hungry. |
| `l24_s` | Level 24: level starts (in-level cutscene) | [cold whisper] I see you, little light. |
| `l25_m` | Level 25: after 24 s of play | [cruel, amused] Your little seahorse is crying for you. How sweet. |
| `l28_m` | Level 28: after 24 s of play | [mocking] Shine, little lights. Shine for my feast. |
| `l29_s` | Level 29: level starts (in-level cutscene) | [menacing] Turn back, Keeper’s child. Or lose everything. |
| `l30_m` | Level 30: after 24 s of play | [greedy, roaring] Faster, little light! Give me my Heart! |
| `k_crushed_4` | Dive failed (crushed), levels 11–30 | [amused] Careful, little light. The reef is so very heavy. |
| `k_monster_4` | Dive failed (monster), levels 11–30 | [silky] My pets were hungry. |
| `k_oxygen_3` | Dive failed (oxygen), levels 11–30 | [mocking] Breathe, little light. Oh… you can’t. |

## murk — Brian

A giant shy octopus, the Keeper’s best friend, forced to serve Grimtide. Deep, gentle, ashamed → resolute.

| id | when | line |
|---|---|---|
| `s16_2` | Chapter 16 · The Prisoner | [deep, apologetic] Please don't scream. Everybody screams. I'm Murk. Sorry about my face. |
| `s16_3` | Chapter 16 · The Prisoner | [startled whisper] He chains me. He makes me gather the pearls. Wait… that lamp. Where did you get that lamp? |
| `s18_4` | Chapter 18 · A Secret Trail | [nervous, far away] …Currents? |
| `s26_2` | Chapter 26 · Breaking the Chains | [ashamed, deep] I'm sorry. He makes me guard him. If I let go, Grimtide will… |
| `s26_4` | Chapter 26 · Breaking the Chains | [breaking] …She was my best friend. |
| `s26_5` | Chapter 26 · Breaking the Chains | [joyful roar] FREE! I'm free! Group hug! I have eight arms, everyone's included! |
| `s27_1` | Chapter 27 · Over the Abyss | [deep, steady] Climb on. I know the way to his lair. |
| `s27_2` | Chapter 27 · Over the Abyss | [quiet, ashamed] The night of the storm, she went to face him alone. I was too scared to follow. |
| `s27_cbrave_2` | Chapter 27 · Over the Abyss — choice “Answer Murk”: brave answer “This time, we go together.” | [deep, resolute] Together. |
| `s27_cfunny_2` | Chapter 27 · Over the Abyss — choice “Answer Murk”: funny answer “Eight arms. Use them ALL.” | [deep laugh] Eight arms of fury. I like that. |
| `s27_ckind_2` | Chapter 27 · Over the Abyss — choice “Answer Murk”: kind answer “It wasn't your fault, Murk.” | [deep, moved] …She would have said that. Thank you. |
| `s29_ok1` | Chapter 29 · Grimtide’s Lair — after “Through the coils! Reach the Lantern!” (done in time) | [roaring] Not this time, Grimtide! |
| `s29_no1` | Chapter 29 · Grimtide’s Lair — after “Through the coils! Reach the Lantern!” (missed) | [roaring] Spark! I've got you! Grab my arm! |
| `l18_s` | Level 18: level starts | [faint whisper] This way… the pearls will guide you… |
| `l27_m` | Level 27: after 24 s of play | [deep, calm] The undertow pulls hard here. Trust it, and you’ll find the way. |
| `l27_g` | Level 27: gate opens | [resolute] Twenty-seven. His lair is near. |
| `l29_m` | Level 29: after 24 s of play | [deep, urgent] He’s afraid. I can feel it. Keep going! |
| `l29_g` | Level 29: gate opens | [resolute] One gate left. Let’s end this. |

## lumen — Charlie

An anglerfish showman. Big theatrical voice (“Ladies and gentlefish!”) over a scared heart.

| id | when | line |
|---|---|---|
| `s21_1` | Chapter 21 · Lumen | [stage whisper] Psst! Over here! Quick, before his eyes find you! |
| `s21_2` | Chapter 21 · Lumen | [theatrical, grand] Lumen’s the name, light’s the game! The Deep’s last lantern, live and in person! |
| `s21_3` | Chapter 21 · Lumen | [dropping the act] I’ve been hiding for three weeks. In a sock. Don’t ask where I got a sock. |
| `s21_4` | Chapter 21 · Lumen | [brave, theatrical] But you’re going after him? Then my light is yours. Showtime! |
| `s22_1` | Chapter 22 · Whale Song | [thrilled] Old Bellow! He only sings when the Lantern fights back! |
| `s23_4` | Chapter 23 · The Mural | [soft, amazed] Kid, I’ve been in show business a long time. That’s what we call a plot twist. |
| `s28_1` | Chapter 28 · The Deep Rises | [theatrical, grand] Ladies and gentlefish! Wave those arms, Spark! Show the Deep it’s not alone! |
| `l21_s` | Level 21: level starts | [stage whisper] Shh! Sleeping piranhas. Tiptoe, my friends. Tippy-tippy-toe. |
| `l21_g` | Level 21: gate opens | [theatrical] Twenty-one! Bravo! Bravissimo! |
| `l22_p` | Level 22: first pearl in | [thrilled] Listen! Old Bellow sings louder with every pearl! |
| `l23_s` | Level 23: level starts | [serious] The pressure’s strong down here. Watch your air, Keeper. |
| `l28_s` | Level 28: level starts | [thrilled] Look behind you! The whole Deep is glowing! |

## mira — Sarah

A manta ray. Serene and wise, speaks slowly.

| id | when | line |
|---|---|---|
| `s15_1` | Chapter 15 · Mira | [serene] I am Mira. The currents carried me a message from an old turtle. |
| `s15_2` | Chapter 15 · Mira | [serene, amused] “Don’t look back. Tell them I’m proud. And tell the crab to stop fussing.” |
| `s15_4` | Chapter 15 · Mira | [warm] Climb on. The canyon is wide, and grief is heavy. I will carry both. |
| `s15_ok2` | Chapter 15 · Mira — after “Ride the canyon with Mira!” (done in time) | [serene, warm] You fly like a manta, little one. She would be proud. |
| `s15_no2` | Chapter 15 · Mira — after “Ride the canyon with Mira!” (missed) | [calm] The canyon is rough tonight. Hold on tight. We are almost there. |
| `l15_m` | Level 15: after 24 s of play | [serene] Steady, little one. Every gate you wake reaches her too. |

## cousin — Aria

Pip’s little cousin. Squeaky, giggly, fast.

| id | when | line |
|---|---|---|
| `s19_1` | Chapter 19 · Good News | [shrieking with joy] PIP! PIP! Shelly woke up! She’s okay! |
| `s19_3` | Chapter 19 · Good News | [giggling] And the loud crab says, quote: “Don’t save the reef without me!” |
| `s19_cbrave_2` | Chapter 19 · Good News — choice “Message for home”: brave answer “Tell him to hurry up!” | [excited] Ooh, intense! I’ll tell him! |
| `s19_cfunny_2` | Chapter 19 · Good News — choice “Message for home”: funny answer “We’ll save him a bit of reef.” | [cackling] Ha! He’s going to HATE that! |
| `s19_ckind_2` | Chapter 19 · Good News — choice “Message for home”: kind answer “Tell Shelly we love her.” | [sweet] She knows. She says it first, every morning. |
| `l19_s` | Level 19: level starts | [giggling] Race you to the gate, Pip! Last one in is a sea slug! |
| `l19_g` | Level 19: gate opens | [laughing] Nooo, you won! Okay, rematch at the Lantern! |

## snip — Liam

Grimtide’s piranha, the cackling one.

| id | when | line |
|---|---|---|
| `s10_2` | Chapter 10 · The Edge of the Shallows | [sneering, cackling] Ooh, look, Snap! Little light wants to take the STAIRS! |
| `s10_ok2` | Chapter 10 · The Edge of the Shallows — after “Escape Snip & Snap!” (done in time) | [dizzy, furious] This isn't over, little light! …Snap, which way is up? |
| `s30_5` | Chapter 30 · The Reef’s Revenge | [nervous] Uh… Snap? I think we work for a worm now. |
| `l5_s` | Level 5: level starts | [sneering] Well, well. A little light. Snap, look! A snack! |
| `l10_m` | Level 10: after 24 s of play | [cackling] Boss says hurry it up, Snap! Shake the tank! |
| `l21_m` | Level 21: after 24 s of play | [groggy, sniffing] Huh? Snap… do you smell lamp? |
| `l30_p` | Level 30: first pearl in | [nervous] Uh… Snap? I think we picked the wrong side. |
| `k_crushed_2` | Dive failed (crushed), levels 4–20 | [cackling] Ooh! Flat as a flounder! |
| `k_monster_2` | Dive failed (monster), levels 4–30 | [cackling] Crunchy! Ha! |

## snap — Eric

Grimtide’s other piranha, the snarling, slower one.

| id | when | line |
|---|---|---|
| `s10_3` | Chapter 10 · The Edge of the Shallows | [snarling] There are no stairs. There’s only US. |
| `s10_no2` | Chapter 10 · The Edge of the Shallows — after “Escape Snip & Snap!” (missed) | [snarling, fading] Next time, little light. NEXT TIME. |
| `l10_s` | Level 10: level starts | [snarling] Last gate of the Shallows, little light. Shame you won’t reach it. |
| `k_monster_1` | Dive failed (monster), levels 4–30 | [snarling laugh] Grimtide says thanks for the snack! |

## keeper — Alice

The Reef Keeper, heard only in memories (her coins) and her journal. Gentle, wise, a little funny. She gave all her light to save the reef.

| id | when | line |
|---|---|---|
| `s0_5` | Prologue · The Night the Lights Went Out | [fierce, heroic] Not while I'm Keeper! |
| `s6_3` | Chapter 6 · The Keeper’s Map | [gentle, like a memory] “If Grimtide returns, wake the gates. Shared light is the one thing he cannot drink.” |
| `m1` | Keeper’s coin found in level 1 | [gentle, like an old memory] If you’re hearing this, someone found my first coin. Hello, little diver. |
| `m2` | Keeper’s coin found in level 2 | [gentle, like an old memory] I hid thirty coins across the reef. Each one remembers something. |
| `m3` | Keeper’s coin found in level 3 | [gentle, like an old memory] I was afraid of the dark once, too. So I made a lamp. |
| `m4` | Keeper’s coin found in level 4 | [gentle, like an old memory] Clack’s grandmother was a captain too. Twice as loud. |
| `m5` | Keeper’s coin found in level 5 | [gentle, like an old memory] The jellies taught me to sing. Terrible teachers. Wonderful singers. |
| `m6` | Keeper’s coin found in level 6 | [gentle, like an old memory] I left a map in an old wreck. Just in case. |
| `m7` | Keeper’s coin found in level 7 | [gentle, like an old memory] Never follow a light that flickers. Real light holds steady. |
| `m8` | Keeper’s coin found in level 8 | [gentle, like an old memory] When I felt lost, I followed the fish. They always know the way home. |
| `m9` | Keeper’s coin found in level 9 | [gentle, like an old memory] Every map tears, sooner or later. Your heart is the better map. |
| `m10` | Keeper’s coin found in level 10 | [gentle, like an old memory] Jumping is easy. It’s the deciding that’s hard. |
| `m11` | Keeper’s coin found in level 11 | [gentle, like an old memory] The caves echo your fear back at you. So I sang to them instead. |
| `m12` | Keeper’s coin found in level 12 | [gentle, like an old memory] The clams sang to me the night I built the first gate. |
| `m13` | Keeper’s coin found in level 13 | [gentle, like an old memory] Grimtide’s storms are loud. But they never last. |
| `m14` | Keeper’s coin found in level 14 | [gentle, like an old memory] Old Shelly carried me when I was small. She’ll carry you too. |
| `m15` | Keeper’s coin found in level 15 | [gentle, like an old memory] Grief is heavy. Share it, and it gets lighter. Just like light. |
| `m16` | Keeper’s coin found in level 16 | [gentle, like an old memory] I met a little octopus who was scared of everything. His name was Murk. |
| `m17` | Keeper’s coin found in level 17 | [gentle, like an old memory] Murk and I learned the secret together: light given away comes back brighter. |
| `m18` | Keeper’s coin found in level 18 | [gentle, like an old memory] Murk always left me pearls to find. A trail, so I’d never get lost. |
| `m19` | Keeper’s coin found in level 19 | [gentle, like an old memory] Good news travels fastest in a school of fish. |
| `m20` | Keeper’s coin found in level 20 | [gentle, like an old memory] I built the Lantern to hold the reef’s light. I never thought he’d come for it. |
| `m21` | Keeper’s coin found in level 21 | [gentle, like an old memory] The Deep is dark, but it’s never empty. Someone is always shining. |
| `m22` | Keeper’s coin found in level 22 | [gentle, like an old memory] Old Bellow sang the day the Lantern was lit. Listen for him. |
| `m23` | Keeper’s coin found in level 23 | [gentle, like an old memory] They painted me on a wall once. I looked much taller. |
| `m24` | Keeper’s coin found in level 24 | [gentle, like an old memory] If he takes someone you love, don’t give up. That’s what he wants. |
| `m25` | Keeper’s coin found in level 25 | [gentle, like an old memory] Brave isn’t not being scared. Brave is going anyway. |
| `m26` | Keeper’s coin found in level 26 | [gentle, like an old memory] If you find Murk, tell him it wasn’t his fault. It never was. |
| `m27` | Keeper’s coin found in level 27 | [gentle, like an old memory] The trench is deep, but friends make good bridges. |
| `m28` | Keeper’s coin found in level 28 | [gentle, like an old memory] One light alone is easy to drink. A thousand lights are not. |
| `m29` | Keeper’s coin found in level 29 | [gentle, like an old memory] The night of the storm, I gave all my light to the Lantern. It was worth it. |
| `m30` | Keeper’s coin found in level 30 | [gentle, like an old memory] Whoever wears my lamp now: thank you. The reef is yours to keep shining. |

