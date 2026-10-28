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
| narrator | Lily | 55 | 3,367 |
| diver | Jessica | 27 | 967 |
| pip | Laura | 92 | 3,935 |
| shelly | Matilda | 23 | 1,167 |
| clack | Bill | 27 | 1,445 |
| grimtide | Callum | 32 | 1,380 |
| murk | Brian | 17 | 733 |
| lumen | Charlie | 13 | 726 |
| mira | Sarah | 4 | 250 |
| cousin | Aria | 4 | 226 |
| snip | Liam | 7 | 227 |
| snap | Eric | 3 | 146 |
| keeper | Alice | 31 | 1,930 |
| **all** | | **335** | **16,499** |

ElevenLabs bills by characters, and the [delivery] tags count too: the whole story is **16,499 spoken characters, about 21,426 credits with tags** on a full-price model (turbo/flash models cost about half). `make_voices.bat` prints the exact number and asks before it spends anything. Auditions are extra (≈ 150 credits per sample).

## narrator — Lily

The storyteller. Warm and magical, but can turn tense and grave: this is a story with real danger.

| id | when | line |
|---|---|---|
| `s1_1` | Chapter 1 · Through the Old Pipe | [softly, amazed] The first gate wakes. Its light races into an old pipe… and takes you with it. |
| `s1_6` | Chapter 1 · Through the Old Pipe | [hushed, ominous] Far away, in the dark, two red eyes open. |
| `s5_1` | Chapter 5 · Jelly Bounce | [warm] The jellies hum whenever a gate wakes. Five gates, and now they’re singing. |
| `s5_5` | Chapter 5 · Jelly Bounce | [curious] From the top of the jelly stair you see a shipwreck. And something glinting inside. |
| `s6_1` | Chapter 6 · The Keeper’s Map | [hushed] Inside the wreck sits a chest with a seashell clasp. |
| `s6_3` | Chapter 6 · The Keeper’s Map | [amazed] Inside: a map of all thirty gates, drawn in the Reef Keeper’s own hand. |
| `s7_1` | Chapter 7 · The Lure | [curious] In a dark hollow, a soft light glows. A gate? It looks just like one. |
| `s7_3` | Chapter 7 · The Lure | [urgent] The light snaps shut. It was a lure! The water explodes into ink! |
| `s7_ok2` | Chapter 7 · The Lure — after “Hold on to the map!” (done in time) | [tense] The map tears in two. A torn piece drifts away into the dark. |
| `s7_no2` | Chapter 7 · The Lure — after “Hold on to the map!” (missed) | [tense] Grimtide rips it free. A torn corner drifts away into the dark. |
| `s8_4` | Chapter 8 · Follow the Fish | [wonder] The fish remember the gates. They swirl together into a silver arrow. |
| `s9_1` | Chapter 9 · The Torn Map | [curious] On top of the great dune, something flutters in the sand. |
| `s9_5` | Chapter 9 · The Torn Map | [ominous] Behind the dune, ink hangs in the water. Fresh ink. |
| `s10_1` | Chapter 10 · The Edge of the Shallows | [awed] The map ends at a cliff. Far below, the Coral Caves glow violet in the dark. |
| `s11_1` | Chapter 11 · Voices in the Caves | [hushed] The Coral Caves. Your lamp wakes the crystals, one by one. |
| `s12_1` | Chapter 12 · The Silent Clam | [gently] Giant clams open, one by one, and sing the Keeper’s old song. |
| `s12_2` | Chapter 12 · The Silent Clam | [singing softly] “Share your light, and the light comes home…” *(The Clam Choir)* |
| `s12_3` | Chapter 12 · The Silent Clam | [sad] But the last clam stays shut. Its pearl was stolen. |
| `s13_1` | Chapter 13 · The Dark Storm | [tense] The water turns black. The storm has found you. |
| `s13_4` | Chapter 13 · The Dark Storm | [slow, grave] Shelly takes the whole blow on her old shell… |
| `s13_5` | Chapter 13 · The Dark Storm | [whispered, heartbroken] …and sinks, slowly, to the sand. |
| `s14_7` | Chapter 14 · Rest, Old Friend | [tender] The glimmer jellies gather round her, glowing softly, to keep her warm. |
| `s15_1` | Chapter 15 · Mira | [somber] With heavy hearts, you swim on. At the Great Canyon, a manta waits. |
| `s16_1` | Chapter 16 · The Prisoner | [ominous] Deep in the caves, something huge blinks in the dark. |
| `s16_3` | Chapter 16 · The Prisoner | [hushed] A giant octopus, its arms bound in chains of ink. |
| `s16_6` | Chapter 16 · The Prisoner | [tense] Before you can answer, a cruel tail drags him back into the black. |
| `s17_1` | Chapter 17 · The Arch’s Secret | [curious] An old coral arch blocks the way. Its lamps went dark in the storm. |
| `s17_2` | Chapter 17 · The Arch’s Secret | [ancient, echoing] “Grimtide fears one thing: light that is given away.” *(The Coral Arch)* |
| `s17_no1` | Chapter 17 · The Arch’s Secret — after “Light the lamps!” (missed) | [gentle] One by one, the old lamps flicker awake on their own. |
| `s18_1` | Chapter 18 · A Secret Trail | [wonder] Pearls float up from the sand like lanterns, a trail leading deeper. |
| `s19_1` | Chapter 19 · Good News | [bright] Pip’s cousins race in from the Shallows, glowing with news. |
| `s20_1` | Chapter 20 · The Lantern in Chains | [awed] From the last cliff of the caves, you see it at last: the Great Lantern. |
| `s20_2` | Chapter 20 · The Lantern in Chains | [ominous] And coiled around it like a storm cloud lies Grimtide. |
| `s21_1` | Chapter 21 · Lumen | [hushed] The Deep. Where the sun has never reached. |
| `s22_1` | Chapter 22 · Whale Song | [wonder] High above, a whale sings for the first time since the storm. |
| `s22_6` | Chapter 22 · Whale Song | [ominous] Far below, an angry roar shakes the Deep. |
| `s23_1` | Chapter 23 · The Mural | [hushed] An old sea city sleeps in the dark. On its last wall, a mural. |
| `s23_2` | Chapter 23 · The Mural | [awed] The Reef Keeper and a great purple octopus, driving Grimtide into the abyss. |
| `s24_1` | Chapter 24 · Ambush | [joyful] Your gate wakes, and for one moment everything shines. |
| `s24_6` | Chapter 24 · Ambush | [slow, grave] Clack leaps at the tail. One mighty pinch… and the tail swats him into the dark. |
| `s25_1` | Chapter 25 · The Captain’s Last Order | [heartbroken] In the sand lies a battered shell. A tiny captain’s hat beside it. |
| `s25_5` | Chapter 25 · The Captain’s Last Order | [whispered] And the Captain is still. |
| `s26_1` | Chapter 26 · Breaking the Chains | [tense] In a den of stolen pearls hangs a cage, with Pip inside. Murk, in chains, guards it. |
| `s26_ok1` | Chapter 26 · Breaking the Chains — after “Give your light!” (done in time) | [soaring] You hold up a glowing pearl and give it away. The ink chains melt. |
| `s26_no1` | Chapter 26 · Breaking the Chains — after “Give your light!” (missed) | [soaring] The pearl’s light pours out on its own, and the ink chains melt. |
| `s27_2` | Chapter 27 · Over the Abyss | [epic] Murk carries you over the deepest trench in the sea. |
| `s28_2` | Chapter 28 · The Deep Rises | [building] Every wave sets the plankton glowing. Then the jellies. Then the fish. |
| `s28_3` | Chapter 28 · The Deep Rises | [proud, emotional] Clack’s crew raise his tiny hat high, their claws shining. |
| `s29_1` | Chapter 29 · Grimtide’s Lair | [tense] At the foot of the Great Lantern, Grimtide waits, the Heart Pearl in his coils. |
| `s30_1` | Chapter 30 · The Reef’s Revenge | [epic] The last gate wakes. Thirty beams of light rush to the Lantern. |
| `s30_3` | Chapter 30 · The Reef’s Revenge | [soaring] Every creature in the sea gives its light at once. Too much light, freely given. |
| `s30_5` | Chapter 30 · The Reef’s Revenge | [triumphant, amused] All the light he stole pours out of him… and the great eel shrinks to a tiny, wriggling worm. |
| `s30_9` | Chapter 30 · The Reef’s Revenge | [warm, soaring] The Heart Pearl rises home. And for the first time since the storm, the whole reef shines. |
| `l1_s` | Level 1: level starts | [gently] Dig into the sand. Push the red pearl into the gate. |
| `l1_g` | Level 1: gate opens | [excited] The gate is awake! Swim in! |

## diver — Jessica

Spark, the hero. Young, brave, kind, a little cheeky. Cries once (chapter 25). Shouts in the big moments.

| id | when | line |
|---|---|---|
| `s1_4` | Chapter 1 · Through the Old Pipe | [warm, curious] Just a diver with a lamp. Who are you? |
| `s2_3` | Chapter 2 · Pip’s Glow | [gently] Storms don’t have eyes, Pip. |
| `s2_6` | Chapter 2 · Pip’s Glow | [determined, smiling] Then let’s wake another one. And another. |
| `s4_2` | Chapter 4 · Captain Clack | [amused] Uh… a diver? Waking gates? |
| `s5_3` | Chapter 5 · Jelly Bounce | [laughing] Boing… boing… whoa-ho-HO! |
| `s7_ok1` | Chapter 7 · The Lure — after “Hold on to the map!” (done in time) | [straining, through gritted teeth] Let… GO! |
| `s7_no1` | Chapter 7 · The Lure — after “Hold on to the map!” (missed) | [desperate] No! The map! |
| `s8_2` | Chapter 8 · Follow the Fish | [softly] Hey. You DID see it. You warned me. I didn’t listen. |
| `s9_3` | Chapter 9 · The Torn Map | [thoughtful] It shows one gate. The last gate of the Shallows… on the edge of a cliff. |
| `s10_3` | Chapter 10 · The Edge of the Shallows | [determined] Then he’ll see us coming. With our lights on. |
| `s10_ok1` | Chapter 10 · The Edge of the Shallows — after “Dive!” (done in time) | [shouting] Pip, hold on! JUMP! |
| `s11_5` | Chapter 11 · Voices in the Caves | [calm, brave] Let him look, Pip. We didn’t come here to hide. |
| `s12_5` | Chapter 12 · The Silent Clam | [quiet promise] Then we bring it back. Every pearl. Every song. |
| `s13_ok1` | Chapter 13 · The Dark Storm — after “Hold on to Pip!” (done in time) | [straining] I’ve got you, Pip! Don’t let go! |
| `s14_5` | Chapter 14 · Rest, Old Friend | [holding back tears] I promise, Shelly. |
| `s17_4` | Chapter 17 · The Arch’s Secret | [realizing, excited] That’s it, Pip. That’s how we beat him. And how we free that octopus. |
| `s18_4` | Chapter 18 · A Secret Trail | [determined] Hold on, big guy. We’re coming for you. |
| `s19_5` | Chapter 19 · Good News | [laughing] Ha! Wouldn’t dream of it, Captain. |
| `s20_6` | Chapter 20 · The Lantern in Chains | [uneasy, determined] I don’t know. But we’re not stopping now. |
| `s23_5` | Chapter 23 · The Mural | [shaken, quiet] It’s… my lamp. It’s the same lamp. |
| `s24_ok1` | Chapter 24 · Ambush — after “Grab Pip!” (done in time) | [desperate] I’ve got you! I’ve got… NO! |
| `s24_no1` | Chapter 24 · Ambush — after “Grab Pip!” (missed) | [screaming] PIP! |
| `s25_3` | Chapter 25 · The Captain’s Last Order | [crying] You got him, Captain. You got him good. |
| `s26_4` | Chapter 26 · Breaking the Chains | [gentle] Murk. This was her lamp, wasn’t it? The Keeper’s. |
| `s27_6` | Chapter 27 · Over the Abyss | [warm] That’s what brave is, Pip. |
| `s29_5` | Chapter 29 · Grimtide’s Lair | [calm, defiant] You’re wrong about one thing. That light isn’t yours. We’re giving it away. |
| `s30_ok1` | Chapter 30 · The Reef’s Revenge — after “Give the light away!” (done in time) | [shouting] It was never yours! |

## pip — Laura

A tiny seahorse. Talks fast when nervous (often), jokes to hide fear, huge heart. Arc: scared sidekick → brave friend.

| id | when | line |
|---|---|---|
| `s1_2` | Chapter 1 · Through the Old Pipe | [excited, breathless] Whoa, whoa, WHOA! Somebody just woke a gate! |
| `s1_3` | Chapter 1 · Through the Old Pipe | [excited] Nobody’s done that since the storm. Nobody! Who ARE you? |
| `s1_5` | Chapter 1 · Through the Old Pipe | [giggles] I’m Pip! And you… you’re a spark. I’m calling you Spark. |
| `s2_1` | Chapter 2 · Pip’s Glow | [wistful] See this? I used to glow like a lantern. Then the storm came. |
| `s2_2` | Chapter 2 · Pip’s Glow | [scared, whispering] It wasn’t a normal storm, Spark. It had eyes. Red ones. |
| `s2_4` | Chapter 2 · Pip’s Glow | [trembling] This one did. And it was hungry. It ate every light in the reef. |
| `s2_5` | Chapter 2 · Pip’s Glow | [excited] But when your gate woke… look! I sparkled! Just a little! |
| `s3_5` | Chapter 3 · Shelly’s Tale | [small, scared voice] And… now he’s back? |
| `s4_6` | Chapter 4 · Captain Clack | [whispering, amused] Is he… always this loud? |
| `s5_2` | Chapter 5 · Jelly Bounce | [excited] They want to help! Jump, Spark! Jump! |
| `s6_2` | Chapter 6 · The Keeper’s Map | [excited, nervous] Open it! Open it! No, wait, what if it bites? Open it! |
| `s6_6` | Chapter 6 · The Keeper’s Map | [happy] With this we’ll never get lost. Not ever! |
| `s7_2` | Chapter 7 · The Lure | [nervous] Spark, wait. Gates don’t flicker like that… |
| `s7_6` | Chapter 7 · The Lure | [crying softly] Spark… my glow. It’s going out again. |
| `s8_1` | Chapter 8 · Follow the Fish | [sniffling] This is all my fault. I should’ve seen it was a trap. |
| `s8_6` | Chapter 8 · Follow the Fish | [laughing through tears] They’re showing us the way! Hah! Who needs his map? |
| `s9_2` | Chapter 9 · The Torn Map | [excited] The torn piece of the map! It drifted all the way here! |
| `s9_6` | Chapter 9 · The Torn Map | [whispering] He was here. Not long ago. |
| `s10_2` | Chapter 10 · The Edge of the Shallows | [scared] Grimtide went down there. What if he’s waiting for us? |
| `s10_no1` | Chapter 10 · The Edge of the Shallows — after “Dive!” (missed) | [screaming] Aaah! They’re biting! Jump, jump, JUMP! |
| `s11_3` | Chapter 11 · Voices in the Caves | [panicking] He can see us! Spark, he can SEE us! |
| `s12_4` | Chapter 12 · The Silent Clam | [sad] He took its song too. That’s the saddest thing I’ve ever seen. |
| `s13_no1` | Chapter 13 · The Dark Storm — after “Hold on to Pip!” (missed) | [screaming] Spark! I can’t hold on! |
| `s14_1` | Chapter 14 · Rest, Old Friend | [crying] Shelly? Shelly, please… wake up… |
| `s15_4` | Chapter 15 · Mira | [sniffling, hopeful] She’s… proud of us? |
| `s15_6` | Chapter 15 · Mira | [determined, soft] Fifteen gates. This one’s for you, Shelly. |
| `s16_2` | Chapter 16 · The Prisoner | [terrified whisper] Spark… there are EYES. Big ones. Bigger than Shelly! |
| `s17_3` | Chapter 17 · The Arch’s Secret | [puzzled] Given away? But he TAKES light. He never gives it. |
| `s17_5` | Chapter 17 · The Arch’s Secret | [laughing] You’re crazy. I love it. |
| `s17_ok1` | Chapter 17 · The Arch’s Secret — after “Light the lamps!” (done in time) | [excited] You did it! The arch remembers the light! |
| `s18_2` | Chapter 18 · A Secret Trail | [excited] The octopus dropped them! He’s helping us. In secret! |
| `s19_3` | Chapter 19 · Good News | [overjoyed, happy tears] She’s okay? She’s OKAY! Spark, she’s okay! |
| `s19_6` | Chapter 19 · Good News | [excited] Nineteen gates! Come on, come on, faster! |
| `s20_5` | Chapter 20 · The Lantern in Chains | [frightened] Spark… what does he mean? |
| `s21_6` | Chapter 21 · Lumen | [whispering, delighted] I like him. |
| `s22_4` | Chapter 22 · Whale Song | [overjoyed] CLACK! You came! |
| `s23_4` | Chapter 23 · The Mural | [stunned whisper] Spark… look at her helmet. Look at her LAMP. |
| `s24_2` | Chapter 24 · Ambush | [joyful] Twenty-four! We’re going to make it, Spark! We’re actually going to… |
| `s24_4` | Chapter 24 · Ambush | [screaming, fading] Spaaark! Heeelp! |
| `s26_2` | Chapter 26 · Breaking the Chains | [crying, joyful] Spark! You came! I knew you’d come! |
| `s26_7` | Chapter 26 · Breaking the Chains | [ecstatic] Best. Rescue. EVER! |
| `s27_5` | Chapter 27 · Over the Abyss | [brave, shaky] Neither will I. Okay, a little. But I’m going anyway! |
| `s28_5` | Chapter 28 · The Deep Rises | [triumphant] Twenty-eight gates… and a whole sea behind us! |
| `s29_4` | Chapter 29 · Grimtide’s Lair | [horrified] That’s why he let us… We’ve been lighting his dinner! |
| `s30_8` | Chapter 30 · The Reef’s Revenge | [fierce, tearful] And THAT’S for Captain Clack! |
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
| `s3_1` | Chapter 3 · Shelly’s Tale | [slow, gravelly] Red eyes, you say? Hmph. Then my old bones were right. |
| `s3_2` | Chapter 3 · Shelly’s Tale | [grave] His name is Grimtide. An eel as long as a shipwreck, who drinks light. |
| `s3_3` | Chapter 3 · Shelly’s Tale | [bitter] Every season he took his tribute: our brightest pearls, or he’d take everything. |
| `s3_4` | Chapter 3 · Shelly’s Tale | [proud] The Reef Keeper said no. She built thirty gates and drove him into the abyss. |
| `s3_6` | Chapter 3 · Shelly’s Tale | [urgent] Now he’s back. And you just woke his gates. Hop on, little ones. Quickly. |
| `s12_6` | Chapter 12 · The Silent Clam | [warm but worried] Brave words. Keep them close, little one. You’ll need them soon. |
| `s13_3` | Chapter 13 · The Dark Storm | [shouting, commanding] Everyone behind me! NOW! |
| `s14_2` | Chapter 14 · Rest, Old Friend | [weak, trying to smile] Hush now. My shell’s seen worse storms than that. Mostly. |
| `s14_3` | Chapter 14 · Rest, Old Friend | [weak, sad] But I can’t swim on with you. Not this time. |
| `s14_4` | Chapter 14 · Rest, Old Friend | [weak, earnest] Promise me you’ll wake every gate. Every last one. |
| `s25_6` | Chapter 25 · The Captain’s Last Order | [firm, warm] Did someone call for an old turtle? |
| `s25_7` | Chapter 25 · The Captain’s Last Order | [grieving] Oh… oh, Clack. You brave, loud, wonderful fool. |
| `s25_8` | Chapter 25 · The Captain’s Last Order | [fierce] Wipe your eyes, little one. Grimtide has Pip. And I have two hundred years of anger. |
| `s28_4` | Chapter 28 · The Deep Rises | [moved] Everyone who ever hid from Grimtide. All of them, shining for you. |
| `s30_6` | Chapter 30 · The Reef’s Revenge | [satisfied] That’s for my shell. |
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
| `s4_1` | Chapter 4 · Captain Clack | [booming, pompous] HALT! Who goes there? State your name and your business! |
| `s4_3` | Chapter 4 · Captain Clack | [proud] Gate-wakers! Crew, stand down! Captain Clack, at your service! |
| `s4_4` | Chapter 4 · Captain Clack | [dramatic] We dug these pearls out of the sand. Grimtide’s tail dragged off the rest. Thick as a mast, it was! |
| `s4_5` | Chapter 4 · Captain Clack | [heroic] The Crack Crab Crew sails with you. Nobody pinches pearls on MY reef! |
| `s4_7` | Chapter 4 · Captain Clack | [shouting proudly] ALWAYS! |
| `s5_4` | Chapter 5 · Jelly Bounce | [flustered] Steady there! A captain never bounces without permission! |
| `s6_5` | Chapter 6 · The Keeper’s Map | [thrilled] A treasure map! Every captain’s dream! |
| `s8_3` | Chapter 8 · Follow the Fish | [blustering] Chins up, crew! A captain doesn’t need a map. A captain needs… uh… |
| `s8_5` | Chapter 8 · Follow the Fish | [triumphant] …FISH! A captain needs fish! Exactly as I planned! |
| `s9_4` | Chapter 9 · The Torn Map | [grumbling] Cliffs. I hate cliffs. Crabs don’t fall well. |
| `s10_6` | Chapter 10 · The Edge of the Shallows | [yelling, fading away] Crabs… don’t… fall… WELLLL! |
| `s11_6` | Chapter 11 · Voices in the Caves | [brave, flustered] Aye! We came to pinch! Er… to win. To win. |
| `s14_6` | Chapter 14 · Rest, Old Friend | [gruff, emotional] Go. I’ll stand guard. Nobody touches this turtle while Clack has claws. |
| `s22_3` | Chapter 22 · Whale Song | [booming] Did somebody say CAPTAIN? Clack, reporting for duty! |
| `s22_5` | Chapter 22 · Whale Song | [proud, chuckling] A captain never leaves his crew. Shelly sends her love. And a very rude message for Grimtide. |
| `s24_5` | Chapter 24 · Ambush | [roaring, charging] Let him go, you overgrown noodle! |
| `s25_2` | Chapter 25 · The Captain’s Last Order | [weak, rasping] Gate-waker… did I get him? Tell me I pinched him good. |
| `s25_4` | Chapter 25 · The Captain’s Last Order | [weak, fading] Then tell my crew… they were the finest crew… on the whole… reef. |
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
| `s7_4` | Chapter 7 · The Lure | [silky, amused] Thank you for the map, little light. I know where every gate is now. |
| `s7_5` | Chapter 7 · The Lure | [menacing whisper] Wake them if you like. I’ll be waiting at every one. |
| `s11_2` | Chapter 11 · Voices in the Caves | [echoing, amused] Little light… you came all the way down here. For me? |
| `s11_4` | Chapter 11 · Voices in the Caves | [echoing whisper] Every crystal you light shows me where you are. So shine. Shine for me. |
| `s13_2` | Chapter 13 · The Dark Storm | [roaring] Thirteen gates, little light? That’s thirteen too many! |
| `s13_6` | Chapter 13 · The Dark Storm | [cold, quiet] One down. |
| `s18_5` | Chapter 18 · A Secret Trail | [suspicious, cold, distant] Murk… What are you doing, Murk? |
| `s20_3` | Chapter 20 · The Lantern in Chains | [delighted, menacing] Twenty gates. Twenty little lights, all lit… just for me. |
| `s20_4` | Chapter 20 · The Lantern in Chains | [laughs darkly] You think you’re saving the reef? You’re setting the table. |
| `s24_3` | Chapter 24 · Ambush | [roaring] ENOUGH! |
| `s24_7` | Chapter 24 · Ambush | [cold, triumphant] Come to my lair, little light. Bring me the last gates. Or never see him again. |
| `s28_6` | Chapter 28 · The Deep Rises | [distant, mocking] Light them all, little light. It only makes my feast sweeter. |
| `s29_2` | Chapter 29 · Grimtide’s Lair | [silky] You did it, little light. Twenty-nine gates. The Lantern is nearly full. |
| `s29_3` | Chapter 29 · Grimtide’s Lair | [hungry, rising] Wake the last one, and the Heart will blaze. And then I drink it ALL. |
| `s29_6` | Chapter 29 · Grimtide’s Lair | [menacing whisper] Then come, Keeper’s child. Let’s see who shines last. |
| `s30_2` | Chapter 30 · The Reef’s Revenge | [greedy, ecstatic] Yes… YES! Give it to me! |
| `s30_4` | Chapter 30 · The Reef’s Revenge | [screaming] No… NO! It burns! It BURNS! |
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
| `s16_4` | Chapter 16 · The Prisoner | [whispering, broken] Please… don’t be afraid. He makes me gather the pearls. I don’t want to. |
| `s16_5` | Chapter 16 · The Prisoner | [startled whisper] That lamp… Where did you get that lamp? |
| `s18_3` | Chapter 18 · A Secret Trail | [faint, distant whisper] This way… hurry… before he notices… |
| `s26_3` | Chapter 26 · Breaking the Chains | [ashamed, deep] I’m sorry. He makes me guard him. If I let him go, Grimtide will… |
| `s26_5` | Chapter 26 · Breaking the Chains | [breaking] …She was my best friend. I’ve been so afraid since she was gone. |
| `s26_6` | Chapter 26 · Breaking the Chains | [joyful roar] Free… I’m FREE! Hold on, little seahorse! |
| `s27_1` | Chapter 27 · Over the Abyss | [deep, steady] Climb on. I know the way to his lair. |
| `s27_3` | Chapter 27 · Over the Abyss | [quiet, ashamed] The night of the storm, the Keeper went to face him alone. I was too afraid to follow. |
| `s27_4` | Chapter 27 · Over the Abyss | [resolute] I won’t be afraid again. |
| `s29_ok1` | Chapter 29 · Grimtide’s Lair — after “Dodge!” (done in time) | [roaring] Not this time, Grimtide! |
| `s29_no1` | Chapter 29 · Grimtide’s Lair — after “Dodge!” (missed) | [roaring] Spark! I’ve got you! |
| `s30_7` | Chapter 30 · The Reef’s Revenge | [deep, quiet] And that’s for the Keeper. |
| `l18_s` | Level 18: level starts | [faint whisper] This way… the pearls will guide you… |
| `l27_m` | Level 27: after 24 s of play | [deep, calm] The undertow pulls hard here. Trust it, and you’ll find the way. |
| `l27_g` | Level 27: gate opens | [resolute] Twenty-seven. His lair is near. |
| `l29_m` | Level 29: after 24 s of play | [deep, urgent] He’s afraid. I can feel it. Keep going! |
| `l29_g` | Level 29: gate opens | [resolute] One gate left. Let’s end this. |

## lumen — Charlie

An anglerfish showman. Big theatrical voice (“Ladies and gentlefish!”) over a scared heart.

| id | when | line |
|---|---|---|
| `s21_2` | Chapter 21 · Lumen | [stage whisper] Psst! Over here! Quick, before his eyes find you! |
| `s21_3` | Chapter 21 · Lumen | [theatrical, grand] Lumen’s the name, light’s the game! The Deep’s last lantern, at your service! |
| `s21_4` | Chapter 21 · Lumen | [dropping the act, scared] Truth is, I’ve been hiding for weeks. He hunts every glow down here. |
| `s21_5` | Chapter 21 · Lumen | [brave, theatrical] But you’re going after him? Then my little light is yours. Showtime! |
| `s22_2` | Chapter 22 · Whale Song | [thrilled] Old Bellow! He only sings when the Lantern fights back! |
| `s23_3` | Chapter 23 · The Mural | [solemn] That octopus is Murk. The Keeper’s best friend. |
| `s23_6` | Chapter 23 · The Mural | [soft, amazed] Then the light didn’t find you by accident, kid. |
| `s28_1` | Chapter 28 · The Deep Rises | [theatrical, grand] Ladies and gentlefish! Wave those arms, Spark! Show the Deep it isn’t alone! |
| `l21_s` | Level 21: level starts | [stage whisper] Shh! Sleeping piranhas. Tiptoe, my friends. Tippy-tippy-toe. |
| `l21_g` | Level 21: gate opens | [theatrical] Twenty-one! Bravo! Bravissimo! |
| `l22_p` | Level 22: first pearl in | [thrilled] Listen! Old Bellow sings louder with every pearl! |
| `l23_s` | Level 23: level starts | [serious] The pressure’s strong down here. Watch your air, Keeper. |
| `l28_s` | Level 28: level starts | [thrilled] Look behind you! The whole Deep is glowing! |

## mira — Sarah

A manta ray. Serene and wise, speaks slowly.

| id | when | line |
|---|---|---|
| `s15_2` | Chapter 15 · Mira | [serene] I am Mira. The currents carried me a message from an old turtle. |
| `s15_3` | Chapter 15 · Mira | [serene, tender] She said: “Don’t look back. Tell them I’m proud.” |
| `s15_5` | Chapter 15 · Mira | [warm] Climb on, little ones. The canyon is wide, and grief is heavy. I will carry both. |
| `l15_m` | Level 15: after 24 s of play | [serene] Steady, little one. Every gate you wake reaches her too. |

## cousin — Aria

Pip’s little cousin. Squeaky, giggly, fast.

| id | when | line |
|---|---|---|
| `s19_2` | Chapter 19 · Good News | [shrieking with joy] Pip! PIP! Shelly woke up! She’s going to be okay! |
| `s19_4` | Chapter 19 · Good News | [giggling] And the loud crab says he’s coming to find you. Quote: “Don’t start without me!” |
| `l19_s` | Level 19: level starts | [giggling] Race you to the gate, Pip! Last one in is a sea slug! |
| `l19_g` | Level 19: gate opens | [laughing] Nooo, you won! Okay, rematch at the Lantern! |

## snip — Liam

Grimtide’s piranha, the cackling one.

| id | when | line |
|---|---|---|
| `s10_4` | Chapter 10 · The Edge of the Shallows | [sneering] Oh, he’s waiting all right! |
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
| `s10_5` | Chapter 10 · The Edge of the Shallows | [snarling laugh] And the boss says nobody leaves the Shallows! |
| `l10_s` | Level 10: level starts | [snarling] Last gate of the Shallows, little light. Shame you won’t reach it. |
| `k_monster_1` | Dive failed (monster), levels 4–30 | [snarling laugh] Grimtide says thanks for the snack! |

## keeper — Alice

The Reef Keeper, heard only in memories (her coins) and her journal. Gentle, wise, a little funny. She gave all her light to save the reef.

| id | when | line |
|---|---|---|
| `s6_4` | Chapter 6 · The Keeper’s Map | [gentle, like a memory] “If Grimtide ever returns, wake the gates. Shared light is the one thing he cannot drink.” |
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

