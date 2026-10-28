# Aqua Energizer: The Thirty Gates (story v3)

## The story in one breath
The reef’s light lives in the **Heart Pearl**, high in the **Great Lantern**. Long ago the **Reef Keeper** built thirty gates to carry that light to every corner of the reef, and chased **Grimtide**, a giant eel who drinks light, into the abyss. On the storm night (the intro film) Grimtide came back, swallowed the reef’s light and took the Heart Pearl. A little diver turns on a lamp and wakes the first gate. Every gate woken sends a thread of light home and weakens Grimtide, so he fights back: he tricks you, steals the Keeper’s map, hurts Shelly, chains Murk and finally snatches Pip. In the end the thirty gates pour their light into his lair together, he shrinks to a tiny harmless worm, and the Heart Pearl rises home.

## The cast
- **You, the diver.** Brave and kind. By the end the reef calls you the new Keeper.
- **Pip**, a tiny seahorse whose glow the storm blew out. Brighter after every gate; dims when things go wrong (ch. 7–9); snatched by Grimtide (ch. 24), rescued (ch. 26).
- **Shelly**, a 200-year-old turtle. Tells the legend (ch. 3), is struck down shielding the little ones in Grimtide’s storm (ch. 13–14), and comes back healed to lead the rescue (ch. 25–26).
- **Grimtide**, the villain: a giant eel with red eyes who drinks light. His eyes watch from the dark beside the tanks from level 11 on, he talks to you inside levels, and he gets the revenge he deserves in chapter 30.
- **Murk**, a giant shy octopus Grimtide keeps in ink chains. Freed by the gift of light, he becomes your guide and carries you to the lair.
- **Lumen** the anglerfish (lights the Deep), **Captain Clack** and his crabs, **Mira** the manta, Pip’s cousins, Old Bellow the whale, the Clam Choir.

## Ups and downs
| ch | after level | chapter | feel |
|---|---|---|---|
| 1 | 1 | Through the Old Pipe | wonder |
| 2 | 2 | Pip’s Glow | hope ↑ |
| 3 | 3 | Shelly’s Tale | dread ↓ |
| 4 | 4 | The Crab Parade | fun ↑ |
| 5 | 5 | Jelly Bounce | fun ↑ |
| 6 | 6 | The Keeper’s Map | discovery ↑ |
| 7 | 7 | The Lure | BLUNDER ↓↓ |
| 8 | 8 | Follow the Fish | recovery ↑ |
| 9 | 9 | The Torn Map | hope ↑ |
| 10 | 10 | The Edge of the Shallows | courage ↑ |
| 11 | 11 | Voices in the Caves | menace ↓ |
| 12 | 12 | The Silent Clam | bittersweet |
| 13 | 13 | The Dark Storm | danger ↓↓ |
| 14 | 14 | Rest, Old Friend | grief ↓↓ |
| 15 | 15 | Shelly’s Message | hope ↑ |
| 16 | 16 | The Prisoner | mystery |
| 17 | 17 | The Arch’s Secret | resolve ↑ |
| 18 | 18 | A Secret Trail | hope ↑ |
| 19 | 19 | Good News | joy ↑↑ |
| 20 | 20 | The Lantern in Chains | dread ↓ |
| 21 | 21 | Lumen | hope ↑ |
| 22 | 22 | Whale Song | wonder |
| 23 | 23 | The Mural | discovery ↑ |
| 24 | 24 | Ambush | BLUNDER ↓↓ |
| 25 | 25 | Shelly Returns | triumph ↑↑ |
| 26 | 26 | Breaking the Chains | rescue ↑↑ |
| 27 | 27 | Over the Abyss | resolve ↑ |
| 28 | 28 | The Deep Rises | rally ↑↑ |
| 29 | 29 | Grimtide’s Lair | showdown ↓ |
| 30 | 30 | The Reef’s Revenge | REVENGE ↑↑↑ |

## The story inside the levels
- **Level card:** one line that says where you are and why this tank matters (`LEVEL_STORY`).
- **Talk bubble** (`#talk`): a story line soon after the level starts and one when its gate opens (`LEVEL_TALK`, voice ids `l<n>_s` / `l<n>_g`). Pip nods along.
- **What you see** (`LEVEL_MOOD` → `world.setStoryMood`): Pip floats above the tank (his glow follows the story: faint on levels 8–9 after the map is lost, missing on 25–26 while Grimtide holds him); ink drifts behind the tank on levels 8–10 and 13–14; Grimtide’s red eyes blink in the dark beside the tank from level 11, brighter toward the end.

## Chapters

### Level 1: The storm has left the reef dark. Wake the very first gate.
- In the level (`l1_s`): Dig into the sand, push the red pearl into the gate.
- Gate opens (`l1_g`): The gate is awake! Swim in.

**Chapter 1 · Through the Old Pipe** (film: `pipe`, arrival: `pipe`, feel: wonder)

- `s1_1` *The first gate wakes, and its light rushes into an old pipe.*
- `s1_2` *The pipe carries you out onto the sand, toward the next glass tank.*
- `s1_3` **Pip:** Psst! Down here! You woke a gate? Nobody’s done that since the storm!
- `s1_4` **You:** I just followed the light. Who are you?

### Level 2: Pip saw red eyes in the storm. Find the next gate under the falling stones.
- In the level (`l2_s`): **Pip:** Red eyes… I can’t stop thinking about them.
- Gate opens (`l2_g`): **Pip:** Two gates! I can feel my glow coming back!

**Chapter 2 · Pip’s Glow** (film: `kelp`, arrival: `swirl`, feel: hope ↑)

- `s2_1` **Pip:** I’m Pip! The storm blew out my glow, and every light in the reef.
- `s2_2` **Pip:** But when your gate woke, I sparkled. Look, just a little!
- `s2_3` **Pip:** That storm wasn’t normal. I saw two red eyes inside it… and then everything went black.
- `s2_4` **You:** Then let’s bring the light back. Every last bit of it.

### Level 3: Shelly says the gates were built to stop Grimtide. This one hides behind a deep shaft.
- In the level (`l3_s`): **Pip:** A giant eel who drinks light… Let’s be quick.
- Gate opens (`l3_g`): **Pip:** Three! Shelly’s waiting for us!

**Chapter 3 · Shelly’s Tale** (film: `turtle`, arrival: `drop`, feel: dread ↓)

- `s3_1` **Shelly:** Red eyes, you say? Then the old tale is true. Grimtide is back.
- `s3_2` **Shelly:** A giant eel who drinks light. The Reef Keeper chased him into the abyss, long ago.
- `s3_3` **Shelly:** He wants the Heart Pearl inside the Great Lantern. With it, the whole sea would be his.
- `s3_4` **Shelly:** Thirty gates guard the way. Wake them all, and his storm can’t hold. Hop on!

### Level 4: The crabs saw a dark tail drag pearls this way. Two roads lead on. Choose well.
- In the level (`l4_s`): **Pip:** Watch for that dark tail the crabs saw.
- Gate opens (`l4_g`): **Pip:** Four gates. Take that, Grimtide!

**Chapter 4 · The Crab Parade** (film: `crabs`, arrival: `bubble`, feel: fun ↑)

- `s4_1` *A parade of crabs marches past, each one carrying a rescued pearl.*
- `s4_2` **Captain Clack:** We dug ’em out of the sand! The storm dropped ’em like hailstones.
- `s4_3` **Captain Clack:** The rest were dragged off by a long, dark tail. Thicker than a shipwreck!
- `s4_4` **Pip:** Grimtide… He’s collecting them.

### Level 5: Grimtide’s piranha guards this gate. Five gates will make the jellies sing.
- In the level (`l5_s`): **Pip:** A piranha! Be careful down there!
- Gate opens (`l5_g`): **Pip:** Five! Hear the jellies hum?

**Chapter 5 · Jelly Bounce** (film: `jelly`, arrival: `drop`, feel: fun ↑)

- `s5_1` *The jellies remember the gates. They hum whenever one wakes.*
- `s5_2` **Pip:** Five gates! Listen, the jellies are humming!
- `s5_3` *They make a bouncy stair to lift you on your way.*
- `s5_4` **You:** Boing… boing… whoa! Thank you, jellies!

### Level 6: The jellies lifted you here. The Keeper’s chest is somewhere past this gate.
- In the level (`l6_s`): **Pip:** The jellies say the Keeper’s chest is close!
- Gate opens (`l6_g`): **Pip:** Six gates! The wreck should be just ahead.

**Chapter 6 · The Keeper’s Map** (film: `wreck`, arrival: `swirl`, feel: discovery ↑)

- `s6_1` *Inside an old shipwreck sits a chest with a seashell clasp.*
- `s6_2` *In it: a map of all thirty gates, and a page from the Reef Keeper’s journal.*
- `s6_3` **The Reef Keeper:** “If Grimtide ever returns, wake the gates. Shared light is the one thing he cannot drink.”
- `s6_4` **Pip:** With this map, we can never get lost!

### Level 7: You have the Keeper’s map! It marks this gate with a keystone. Something glows in the dark nearby…
- In the level (`l7_s`): **Pip:** The map says this gate has a keystone. Careful!
- Gate opens (`l7_g`): **Pip:** Seven! Hey… do you see that glow over there?

**Chapter 7 · The Lure** (film: `trap`, arrival: `swirl`, feel: BLUNDER ↓↓)

- `s7_1` *In a dark hollow, a soft light glows. A gate? It looks just like one…*
- `s7_2` **Pip:** Wait! Gates don’t flicker like that…
- `s7_3` *The light snaps shut. It was a lure, and the water bursts into ink!*
- `s7_4` **Grimtide:** Thank you for the map, little light. Now you’ll never find your way.
- `s7_5` **Pip:** He took the map… and my glow… it’s going out again.

### Level 8: The map is gone and Pip’s glow is fading. You’ll have to find this gate on your own.
- In the level (`l8_s`): **Pip:** My glow is so faint… stay close to me.
- Gate opens (`l8_g`): **Pip:** We did it without the map!

**Chapter 8 · Follow the Fish** (film: `school`, arrival: `bubble`, feel: recovery ↑)

- `s8_1` **Pip:** Without the map we’re lost. This is all my fault…
- `s8_2` **You:** It isn’t, Pip. We’ll find the way. Look!
- `s8_3` *The fish remember the gates. They swirl together into a silver arrow.*
- `s8_4` **Pip:** They’re showing us the way! We don’t need his map!

### Level 9: The fish led you here. A piece of the torn map is out there, if you can get past the claws.
- In the level (`l9_s`): **Pip:** Ink everywhere… He came this way.
- Gate opens (`l9_g`): **Pip:** Nine! A torn piece of the map is near, I can feel it!

**Chapter 9 · The Torn Map** (film: `dune`, arrival: `drop`, feel: hope ↑)

- `s9_1` *At the top of the great dune, something flutters in the sand.*
- `s9_2` **Pip:** A piece of the map! Grimtide tore it in his hurry!
- `s9_3` *Half a map is better than none. And it points down. Way down!*
- `s9_4` **You:** Hold on, Pip!

### Level 10: Half a map, an ink trail, and the last gate of the Shallows. Then down the cliff.
- In the level (`l10_s`): **Pip:** The last gate of the Shallows. Then the cliff.
- Gate opens (`l10_g`): **Pip:** Ten gates. Down we go, together!

**Chapter 10 · The Edge of the Shallows** (film: `descent`, arrival: `drop`, feel: courage ↑)

- `s10_1` *The torn map ends at a cliff. Far below, the Coral Caves glow violet.*
- `s10_2` **Pip:** Grimtide went down there. What if he’s waiting for us?
- `s10_3` **You:** Then he’ll see us coming, with our lights on. Together?
- `s10_4` **Pip:** …Together!

### Level 11: Grimtide’s voice echoes in the Coral Caves. Keep your balance, and keep going.
- In the level (`l11_s`): **Grimtide:** (echoing) Little light… turn back.
- Gate opens (`l11_g`): **Pip:** Eleven! Ha! He can echo all he likes.

**Chapter 11 · Voices in the Caves** (film: `crystals`, arrival: `bubble`, feel: menace ↓)

- `s11_1` *The Coral Caves are dark. Your lamp wakes the crystals, one by one.*
- `s11_2` **Grimtide:** (echoing) Turn back, little light… The dark is mine.
- `s11_3` **Pip:** He can see us…
- `s11_4` **You:** Let him look. Eleven gates, Pip. We’re not turning back.

### Level 12: The clams sing of a stolen pearl. Air is short in this deep cave, so plan your breaths.
- In the level (`l12_s`): **Pip:** The silent clam… We’ll get its pearl back.
- Gate opens (`l12_g`): **Pip:** Twelve. Why does the water feel so heavy?

**Chapter 12 · The Silent Clam** (film: `clams`, arrival: `swirl`, feel: bittersweet)

- `s12_1` *Giant clams open, one after another, and sing the Keeper’s old song.*
- `s12_2` **The Clam Choir:** “Share your light, and the light comes home…”
- `s12_3` *But the last clam stays shut. Grimtide has stolen its pearl.*
- `s12_4` **Pip:** Then we’ll take it back. All of them.

### Level 13: The water feels heavy… like a storm is coming. Find the trapdoor before it hits.
- In the level (`l13_s`): **Pip:** Something’s wrong… the water is going dark.
- Gate opens (`l13_g`): **Pip:** Thirteen… Wait. Do you hear that?

**Chapter 13 · The Dark Storm** (film: `storm`, arrival: `drop`, feel: danger ↓↓)

- `s13_1` *Without warning, the water turns black. Grimtide’s storm has found you.*
- `s13_2` **Grimtide:** Thirteen gates? That’s thirteen too many!
- `s13_3` **Shelly:** Get behind me, little ones!
- `s13_4` *Shelly takes the whole blow on her old shell… and sinks slowly to the sand.*

### Level 14: Shelly is hurt. The glimmer jellies keep her warm while you wake the next gate.
- In the level (`l14_s`): **Pip:** (quietly) Shelly would want us to keep going.
- Gate opens (`l14_g`): **Pip:** Fourteen. Rest well, Shelly.

**Chapter 14 · Rest, Old Friend** (film: `shellyrest`, arrival: `bubble`, feel: grief ↓↓)

- `s14_1` **Pip:** Shelly? Shelly, please wake up…
- `s14_2` **Shelly:** (weakly) My old shell has seen worse storms… but I can’t swim on with you.
- `s14_3` **Shelly:** Promise me you’ll wake every gate. Every last one.
- `s14_4` **You:** We promise, Shelly.
- `s14_5` *The glimmer jellies gather round her, glowing softly, to keep her warm.*

### Level 15: Mira carried you over the canyon. Shelly said not to look back.
- In the level (`l15_s`): **Pip:** For Shelly. Let’s go!
- Gate opens (`l15_g`): **Pip:** Fifteen gates! She’d be so proud.

**Chapter 15 · Shelly’s Message** (film: `manta`, arrival: `drop`, feel: hope ↑)

- `s15_1` *With heavy hearts, you swim on. At the Great Canyon, a manta waits.*
- `s15_2` **Mira the manta:** Shelly sent word through the currents. Climb on, little ones.
- `s15_3` **Mira the manta:** She said: “Tell them not to look back. Tell them I’m proud.”
- `s15_4` **Pip:** Fifteen gates… This one’s for you, Shelly.

### Level 16: Something in chains was dragged through here. The vault is full of stones.
- In the level (`l16_s`): **Pip:** That prisoner… those chains… Hurry.
- Gate opens (`l16_g`): **Pip:** Sixteen! The old arch is just ahead.

**Chapter 16 · The Prisoner** (film: `shadow`, arrival: `swirl`, feel: mystery)

- `s16_1` *Deep in the caves, something huge blinks in the dark.*
- `s16_2` *Two great eyes, and arms wrapped in chains of ink.*
- `s16_3` **Murk:** (whispering) Help me… He makes me gather the pearls…
- `s16_4` *A cruel tail drags the shape back into the black.*

### Level 17: The arch told you how to beat Grimtide. The path to the gate winds back and forth.
- In the level (`l17_s`): **Pip:** Light that’s given away. Remember that.
- Gate opens (`l17_g`): **Pip:** Seventeen! Look, pearls rising from the sand!

**Chapter 17 · The Arch’s Secret** (film: `arch`, arrival: `drop`, feel: resolve ↑)

- `s17_1` *The old Coral Arch still remembers the light. Its lamps wake as you swim through.*
- `s17_2` **The Coral Arch:** “Grimtide fears one thing: light that is given away.”
- `s17_3` **Pip:** That poor creature in chains… Grimtide is using him.
- `s17_4` **You:** Then we’ll free him too.

### Level 18: The prisoner’s pearl trail leads into a cave full of crabs.
- In the level (`l18_s`): **Pip:** Follow the pearls. He’s helping us.
- Gate opens (`l18_g`): **Pip:** Eighteen! Someone’s coming. My cousins?

**Chapter 18 · A Secret Trail** (film: `pearls`, arrival: `bubble`, feel: hope ↑)

- `s18_1` *Pearls float up from the sand like lanterns, a trail leading deeper.*
- `s18_2` **Pip:** The prisoner dropped them! He’s showing us the way, in secret!
- `s18_3` *Somewhere in the dark, someone is brave enough to help.*
- `s18_4` **You:** Hold on, whoever you are. We’re coming.

### Level 19: Shelly is okay! Pip’s cousins race you to the bottom of the pit.
- In the level (`l19_s`): **Pip’s cousin:** Shelly says hi! Race you to the gate!
- Gate opens (`l19_g`): **Pip:** Nineteen! Shelly’s okay, I’m so happy!

**Chapter 19 · Good News** (film: `race`, arrival: `swirl`, feel: joy ↑↑)

- `s19_1` *Pip’s cousins race in from the Shallows, glowing with news.*
- `s19_2` **Pip’s cousin:** Pip! Shelly woke up! She’s resting, and she’s going to be okay!
- `s19_3` **Pip:** She’s okay! She’s okay!
- `s19_4` **Pip:** Nineteen gates. Come on, even faster now!

### Level 20: Grimtide is coiled around the Great Lantern. Wake the last gate of the caves.
- In the level (`l20_s`): **Pip:** He’s wrapped around the Lantern… Hurry!
- Gate opens (`l20_g`): **Pip:** Twenty. The Deep is next. Stay close.

**Chapter 20 · The Lantern in Chains** (film: `coil`, arrival: `drop`, feel: dread ↓)

- `s20_1` *From the last cliff of the caves, you see it at last: the Great Lantern.*
- `s20_2` *Around it, coiled like a storm cloud, lies Grimtide.*
- `s20_3` **Grimtide:** Come closer, little light. The Heart is almost mine.
- `s20_4` **Pip:** Twenty lights on the tower… and he’s trying to drink them!

### Level 21: Lumen lights your way into the Deep, past a shoal of sleeping piranhas.
- In the level (`l21_s`): **Lumen:** Sleeping piranhas. Shh… tiptoe.
- Gate opens (`l21_g`): **Lumen:** Twenty-one! The Deep felt that one.

**Chapter 21 · Lumen** (film: `angler`, arrival: `bubble`, feel: hope ↑)

- `s21_1` *Into the Deep, where the sun has never reached.*
- `s21_2` **Lumen:** Over here! Quick, before his eyes find you.
- `s21_3` **Lumen:** I’m Lumen. Grimtide hunts every light in the Deep. I’ve been hiding for weeks.
- `s21_4` **Lumen:** But if you’re going after him… my little light is yours.

### Level 22: Old Bellow’s song echoes through a tank shaped like an hourglass.
- In the level (`l22_s`): **Lumen:** Old Bellow is singing for you. Keep going!
- Gate opens (`l22_g`): **Pip:** Twenty-two! He’s getting weaker!

**Chapter 22 · Whale Song** (film: `whale`, arrival: `drop`, feel: wonder)

- `s22_1` *High above, a whale sings for the first time since the storm.*
- `s22_2` **Lumen:** That’s Old Bellow. His song means the Lantern is fighting back.
- `s22_3` **Pip:** Twenty-one gates. Grimtide is getting weaker!
- `s22_4` *Far away, an angry roar shakes the Deep. Grimtide heard it too.*

### Level 23: The mural showed Murk and the Keeper. The Deep presses in; air is short.
- In the level (`l23_s`): **Lumen:** The pressure is strong down here. Watch your air.
- Gate opens (`l23_g`): **Pip:** Twenty-three. Poor Murk… we’re coming.

**Chapter 23 · The Mural** (film: `ruins`, arrival: `swirl`, feel: discovery ↑)

- `s23_1` *An old sea city sleeps in the dark. Its columns glow as you pass.*
- `s23_2` *On the last wall, a mural: the Reef Keeper and a purple octopus, driving Grimtide into the abyss.*
- `s23_3` **Lumen:** That octopus is Murk, the Keeper’s best friend.
- `s23_4` **Pip:** The prisoner! Grimtide took him… to get his revenge.

### Level 24: Grimtide is angry now. A gauntlet of stones guards the sunken city’s gate.
- In the level (`l24_s`): **Grimtide:** I see you, little light.
- Gate opens (`l24_g`): **Pip:** Twenty-four! Look how bright it… wait, what’s that shadow?

**Chapter 24 · Ambush** (film: `ambush`, arrival: `drop`, feel: BLUNDER ↓↓)

- `s24_1` *Your gate wakes, and for one moment everything shines.*
- `s24_2` **Grimtide:** ENOUGH!
- `s24_3` *A great tail smashes through the water. The light goes out, and Pip is torn away into the dark.*
- `s24_4` **Pip:** (far away) Heeelp!
- `s24_5` **You:** PIP!

### Level 25: Pip is gone. Shelly is here. Wake this gate and follow the chain of light to him.
- In the level (`l25_s`): **Shelly:** We’ll find him. Wake this gate and follow the light.
- Gate opens (`l25_g`): **Shelly:** Hold on, Pip. We’re coming!

**Chapter 25 · Shelly Returns** (film: `turtle2`, arrival: `drop`, feel: triumph ↑↑)

- `s25_1` **Shelly:** Did someone call for an old turtle?
- `s25_2` **You:** Shelly! You’re all right! But Grimtide took Pip…
- `s25_3` **Shelly:** Then we go and get him back. Hold on tight, little one.
- `s25_4` **Shelly:** Two hundred years I’ve waited to give that eel a piece of my mind.

### Level 26: Murk’s den is close, and so is Pip. The citadel of stones is the hardest yet.
- In the level (`l26_s`): **Shelly:** Murk’s den is close. I can feel it.
- Gate opens (`l26_g`): **Shelly:** Twenty-six. Now, to Pip!

**Chapter 26 · Breaking the Chains** (film: `cage`, arrival: `bubble`, feel: rescue ↑↑)

- `s26_1` *In a den of stolen pearls sits Murk, in chains of ink. Beside him hangs a cage… with Pip inside.*
- `s26_2` **Murk:** You came… I’m sorry. He made me guard your friend.
- `s26_3` *You hold up a glowing pearl. Light, given away, and the ink chains melt.*
- `s26_4` **Murk:** Free… I’m free! Now let’s get your friend out.
- `s26_5` **Pip:** I knew you’d come! I knew it!

### Level 27: Pip is free and Murk is on your side. The undertow pulls everything down.
- In the level (`l27_s`): **Pip:** Thank you for coming for me. Now, let’s finish this!
- Gate opens (`l27_g`): **Murk:** Twenty-seven. His lair is near.

**Chapter 27 · Over the Abyss** (film: `murkride`, arrival: `drop`, feel: resolve ↑)

- `s27_1` **Murk:** Climb on. I know the way to his lair.
- `s27_2` *Murk carries you all over the deepest trench in the sea.*
- `s27_3` **Murk:** He took my home, my freedom, and the Keeper’s light. Now he’ll answer for it.
- `s27_4` **Pip:** Twenty-seven gates. We’re coming, Grimtide!

### Level 28: The whole Deep is waking up behind you. It’s a long way down.
- In the level (`l28_s`): **Lumen:** Look behind you. The whole Deep is glowing!
- Gate opens (`l28_g`): **Pip:** Twenty-eight! Everyone is with us!

**Chapter 28 · The Deep Rises** (film: `plankton`, arrival: `bubble`, feel: rally ↑↑)

- `s28_1` **Lumen:** Wave your arms, little Keeper! Show the Deep it isn’t alone!
- `s28_2` *Every wave sets the plankton glowing. Then the jellies, the crabs, the fish…*
- `s28_3` *Every creature that hid from Grimtide lights up, all at once.*
- `s28_4` **Pip:** Twenty-eight gates! The whole sea is with us!

### Level 29: Grimtide holds the Heart Pearl in his coils. The energizer gate waits for its pearls.
- In the level (`l29_s`): **Grimtide:** Turn back, or lose everything.
- Gate opens (`l29_g`): **Murk:** One gate left. Let’s end this.

**Chapter 29 · Grimtide’s Lair** (film: `lair`, arrival: `drop`, feel: showdown ↓)

- `s29_1` *At the foot of the Great Lantern, Grimtide waits, the Heart Pearl clutched in his coils.*
- `s29_2` **Grimtide:** One gate left, little light. Wake it, and I’ll drink every drop.
- `s29_3` **Murk:** Not this time.
- `s29_4` **You:** Twenty-nine gates are shining, Grimtide. One more, and it’s over.

### Level 30: The last gate. Wake it, and the light will finish Grimtide.
- In the level (`l30_s`): **Pip:** This is it. The last gate!
- Gate opens (`l30_g`): **Pip:** Now! Swim in and light it up!

**Chapter 30 · The Reef’s Revenge** (film: `victory`, arrival: `drop`, feel: REVENGE ↑↑↑)

- `s30_1` *The last gate wakes. Thirty beams of light rush down to the Lantern.*
- `s30_2` **Grimtide:** No… NO! It burns!
- `s30_3` *All the light he stole pours out of him, and the great eel shrinks… to a tiny, wriggling worm.*
- `s30_4` **Murk:** That’s for every pearl you stole.
- `s30_5` **Shelly:** And that’s for my shell!
- `s30_6` *The Heart Pearl rises home, and the whole reef shines again.*

After chapter 30 the finale plays: thirty gate lights wake one by one, the Lantern shines, fireworks, the credits name the cast.

---
Code: `CHAPTERS` / `STORY_WHO` / `RECIPES` (World section of src/game.js), `LEVEL_STORY` / `LEVEL_TALK` / `LEVEL_MOOD` (controller, before `startLevel`). This file is generated from those lines; voice lines with tags live in `tools/voices.json`.
