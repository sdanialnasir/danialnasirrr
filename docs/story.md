# Aqua Energizer: The Thirty Gates

## The world
The reef’s light lives in the **Heart Pearl**, high in the **Great Lantern**, a coral tower at the bottom of the Deep. Long ago the **Reef Keeper**, a diver with a lamp on her helmet, built thirty gates in glass tanks to carry the Lantern’s light to every corner of the reef. One night a huge storm swept the Lantern’s pearls away and the reef went dark (the intro film). A little diver turns on a lamp and wakes the first gate. Every gate woken sends a thread of light back home.

## The cast
- **You, the diver.** Brave, curious, kind. By the end the reef calls you the new Keeper.
- **Pip**, a tiny seahorse. The storm blew out his glow; he gets brighter after every gate. Scared of the dark at first, braver every world.
- **Old Shelly**, a 200-year-old sea turtle. She tells the legend of the Lantern (ch. 3) and comes back in the Deep with the truth about the storm night (ch. 23).
- **Captain Clack** and his crabs, who rescue pearls from the sand and first warn about "a shadow" (ch. 4).
- **Mira**, a gentle manta (ch. 14). **Old Bellow**, a whale who only sings when the Lantern wakes (ch. 21).
- **Lumen**, an anglerfish who lights the way through the Deep and is the first to call the diver "Keeper" (ch. 20, 21, 27).
- **Murk**, a giant shy octopus: the "shadow". The Keeper’s best friend. On the storm night he grabbed every pearl he could to save them, got lost in the dark and was too scared and ashamed to go back. He kept the Heart Pearl safe.

## The threads (what connects level 1 to level 30)
1. **The gate count.** Pip or the Keeper’s map keeps count: "Five gates!", "Eleven gates!", "Twenty-six gates!"
2. **Pip’s glow and courage.** Dim and scared (ch. 2, 8, 10) → glowing (ch. 11, 18) → brave enough to speak to Murk (ch. 24).
3. **The Reef Keeper’s words.** The journal page in the wreck (ch. 6), the clams’ song (ch. 12), the glimmer jellies’ memory of her lamp (ch. 13), the arch inscription (ch. 16), the mural of the Keeper with a little octopus (ch. 22), her last note on the Lantern door (ch. 28). Together: *share your light, and the light comes home*.
4. **The shadow.** Crab rumours (ch. 4) → ink in the dune (ch. 9) → the ink trail to the cliff (ch. 10) → ink in the caves (ch. 11) → an eye in the dark (ch. 15) → a trail of dropped pearls (ch. 17) → Lumen names him (ch. 20) → the mural (ch. 22) → Shelly remembers the storm night (ch. 23) → Murk’s den (ch. 24) → the gift of light (ch. 25) → Murk helps (ch. 26, 28, 29).
5. **The Great Lantern.** A legend (ch. 2, 3) → seen far below (ch. 19) → reached (ch. 28) → its Heart returned (ch. 29) → lit in the finale.

## How it plays
Each level card has a story line that says where you are and why this tank matters. After each level a short 3D film plays its chapter (four lines, with speaker names; tap for the next line, **Skip** to jump to the end), then freezes under the result card. **Home › Story** is the journal: every chapter reached, to read or watch again (the intro film is the Prologue). Every line has a voice-over id (`s<chapter>_<line>`) in `tools/voices.json`; make_voices.bat records them with one voice per character.

## Chapters

### Level 1: The storm has left the reef dark. Wake the very first gate.
**Chapter 1 · Through the Old Pipe** (film: `pipe`, arrival in level 2: `pipe`)

- `s1_1` *The first gate wakes, and its light rushes into an old pipe.*
- `s1_2` *The pipe carries you out onto the sand, toward the next glass tank.*
- `s1_3` **Pip:** Psst! Down here! You woke a gate? Nobody’s done that since the storm!
- `s1_4` **You:** I just followed the light. Who are you?

### Level 2: Pip has a hunch: the next gate is buried under a pile of stones.
**Chapter 2 · Pip’s Glow** (film: `kelp`, arrival in level 3: `swirl`)

- `s2_1` **Pip:** I’m Pip! The storm blew out my glow, and every light in the reef.
- `s2_2` **Pip:** But when your gate woke, I sparkled. Look, just a little!
- `s2_3` **Pip:** Old stories say thirty gates carry light down to the Great Lantern.
- `s2_4` **You:** Then let’s wake all thirty. Lead the way, Pip!

### Level 3: Pip leads you to a tank with a deep stone shaft. Mind your head!
**Chapter 3 · Shelly’s Ride** (film: `turtle`, arrival in level 4: `drop`)

- `s3_1` *Old Shelly the turtle has swum these waters for two hundred years.*
- `s3_2` **Shelly:** The Lantern, little one? It stands in the Deep. Its Heart Pearl lights the whole reef.
- `s3_3` **Shelly:** The storm scattered the Lantern’s pearls. Without them, the gates fall asleep.
- `s3_4` **Shelly:** Hop on. I’ll take you as far as my old flippers go.

### Level 4: Shelly drops you at a tank with two roads. Which one leads to the gate?
**Chapter 4 · The Crab Parade** (film: `crabs`, arrival in level 5: `bubble`)

- `s4_1` *A parade of crabs marches past, each one carrying a pearl.*
- `s4_2` **Captain Clack:** Found ’em in the sand after the storm! We’re taking ’em back to the gates.
- `s4_3` **Captain Clack:** But most of the pearls were dragged away… by a shadow. Deep and wide, it was.
- `s4_4` **Pip:** A shadow? I don’t like the sound of that.

### Level 5: The crabs warn you: a hungry piranha guards this gate.
**Chapter 5 · Jelly Bounce** (film: `jelly`, arrival in level 6: `drop`)

- `s5_1` *The jellies remember the gates. They hum whenever one wakes.*
- `s5_2` **Pip:** Five gates! Listen, the jellies are humming!
- `s5_3` *They make a bouncy stair to lift you to the next tank.*
- `s5_4` **You:** Boing… boing… whoa! Thank you, jellies!

### Level 6: The jellies bounced you here. One of them lives in this tank too.
**Chapter 6 · The Old Wreck** (film: `wreck`, arrival in level 7: `swirl`)

- `s6_1` *Inside an old shipwreck sits a chest with a seashell clasp.*
- `s6_2` *In it: a map of all thirty gates, and a page from the Reef Keeper’s journal.*
- `s6_3` **The Reef Keeper:** “If the Lantern ever fades, wake the gates one by one. The light will find its way home.”
- `s6_4` **Pip:** The Reef Keeper! I thought that was just a bedtime story!

### Level 7: The Keeper’s map marks this gate with a keystone. Don’t let it fall the wrong way.
**Chapter 7 · The Warm Current** (film: `current`, arrival in level 8: `swirl`)

- `s7_1` *Seven gates glow on the Keeper’s map now.*
- `s7_2` *A warm current, flowing again for the first time since the storm, scoops you up.*
- `s7_3` **You:** Wheeeee!
- `s7_4` **Pip:** The reef is helping us! It wants its light back.

### Level 8: The current set you down beside a tank full of pits.
**Chapter 8 · Follow the Fish** (film: `school`, arrival in level 9: `bubble`)

- `s8_1` *Since the storm, the fish have swum in lost little circles.*
- `s8_2` *As your gate wakes, they remember the way, and form a silver arrow.*
- `s8_3` **Pip:** They’re pointing to the edge of the Shallows.
- `s8_4` **Pip:** Past it are the Coral Caves… I’ve never been that far.

### Level 9: The fish point here. Something with claws is hiding in this tank.
**Chapter 9 · Down the Dune** (film: `dune`, arrival in level 10: `drop`)

- `s9_1` *At the top of the great dune, you spot dark streaks in the sand.*
- `s9_2` **Pip:** Ink… Something big came this way, dragging pearls behind it.
- `s9_3` *There’s only one way to follow it. Down!*
- `s9_4` **You:** Hold on, Pip!

### Level 10: The last gate of the Shallows. The ink trail leads past it, toward the cliff.
**Chapter 10 · The Edge of the Shallows** (film: `descent`, arrival in level 11: `drop`)

- `s10_1` *The ink trail ends at a cliff. Far below, the Coral Caves glow violet.*
- `s10_2` **Pip:** It’s so dark down there… What if the shadow is waiting?
- `s10_3` **You:** Then we’ll bring our own light. Together?
- `s10_4` **Pip:** …Together!

### Level 11: Your first gate in the Coral Caves. Stones and pearls are balanced on a knife’s edge.
**Chapter 11 · Sleeping Crystals** (film: `crystals`, arrival in level 12: `bubble`)

- `s11_1` *The Coral Caves have been dark since the storm.*
- `s11_2` *Your lamp wakes the crystals one by one, and they glow back like old friends.*
- `s11_3` **Pip:** Eleven gates! Look, I’m brighter than the crystals!
- `s11_4` **Pip:** And there, more ink… The shadow went deeper.

### Level 12: This cave is deep. Air bubbles will keep you going, so plan your breaths.
**Chapter 12 · The Clam Choir** (film: `clams`, arrival in level 13: `swirl`)

- `s12_1` *Giant clams open, one after another…*
- `s12_2` *…and sing an old song the Reef Keeper taught them, long ago.*
- `s12_3` **The Clam Choir:** “Share your light, and the light comes home…”
- `s12_4` **Pip:** Those are the words from the journal!

### Level 13: The clams sang of a trapdoor in this tank. Open it at the right moment.
**Chapter 13 · Glimmer Jellies** (film: `glimmer`, arrival in level 14: `bubble`)

- `s13_1` *Tiny glimmer jellies gather round you, curious.*
- `s13_2` *They have never met a diver. Only the Keeper, long, long ago.*
- `s13_3` **Pip:** They say the Keeper had a lamp just like yours.
- `s13_4` **You:** Just like mine…?

### Level 14: The glimmer jellies light the way, but piranhas cross this tank from both sides.
**Chapter 14 · The Manta Glide** (film: `manta`, arrival in level 15: `drop`)

- `s14_1` *The Great Canyon splits the caves in two.*
- `s14_2` *A gentle manta named Mira offers you a ride across.*
- `s14_3` **Mira the manta:** Hold on tight, little one. The current here is strong!
- `s14_4` **Pip:** Woohoo! Fourteen gates, and flying!

### Level 15: Across the canyon, a wall of stones waits to come tumbling down.
**Chapter 15 · Something in the Dark** (film: `shadow`, arrival in level 16: `swirl`)

- `s15_1` *Deep in the caves, something huge blinks in the dark.*
- `s15_2` *Two great eyes, and a long arm wrapped around a bundle of pearls…*
- `s15_3` **Pip:** Th-that’s the shadow!
- `s15_4` *Before you can say hello, it slips away into the black.*

### Level 16: The shadow passed through here. Its vault is still full of stones.
**Chapter 16 · The Coral Arch** (film: `arch`, arrival in level 17: `drop`)

- `s16_1` *The old Coral Arch still remembers the light.*
- `s16_2` *Its lamps wake as you swim through, and words glow in the stone:*
- `s16_3` **The Coral Arch:** “The light remembers those who share it.”
- `s16_4` **Pip:** Share it… even with the shadow?

### Level 17: The arch lit a winding path. Switch back and forth to reach the gate.
**Chapter 17 · Pearl Lanterns** (film: `pearls`, arrival in level 18: `bubble`)

- `s17_1` *Pearls the shadow dropped float up from the sand like lanterns.*
- `s17_2` **Pip:** It dropped them on purpose… It’s leaving us a trail!
- `s17_3` *Maybe the shadow wants to be found.*
- `s17_4` **You:** Then let’s find it.

### Level 18: The pearl trail ends at a cave of crabs.
**Chapter 18 · The Seahorse Race** (film: `race`, arrival in level 19: `swirl`)

- `s18_1` *Pip’s cousins have swum all the way from the Shallows.*
- `s18_2` **Pip’s cousin:** Pip! You’re glowing! Race you to the next gate!
- `s18_3` **Pip:** Eighteen gates, and the fastest seahorse in the caves!
- `s18_4` **Pip:** (softly) Thank you for giving my glow back.

### Level 19: Pip’s cousins wait at the finish, at the bottom of a deep pit.
**Chapter 19 · The Great Lantern** (film: `lanternview`, arrival in level 20: `drop`)

- `s19_1` *From the last cliff of the caves, you see it for the first time…*
- `s19_2` *…the Great Lantern, standing dark at the bottom of the Deep.*
- `s19_3` **Pip:** Nineteen of its lights are on. Because of you!
- `s19_4` **Pip:** But its Heart is still missing. The shadow must have it.

### Level 20: The last gate of the caves. Below it, the Great Lantern waits in the dark.
**Chapter 20 · Lumen’s Light** (film: `angler`, arrival in level 21: `bubble`)

- `s20_1` *Into the Deep, where the sun has never reached.*
- `s20_2` *A little light bobs toward you. It’s Lumen, the anglerfish.*
- `s20_3` **Lumen:** Twenty gates! The whole Deep felt that. I’ll light your way.
- `s20_4` **Lumen:** The big one you’re following? His name is Murk. He isn’t mean… just scared.

### Level 21: Lumen’s light shows a shoal of piranhas, sleeping… for now.
**Chapter 21 · Whale Song** (film: `whale`, arrival in level 22: `drop`)

- `s21_1` *High above, a whale sings for the first time since the storm.*
- `s21_2` **Lumen:** That’s Old Bellow. He only sings when the Lantern is waking.
- `s21_3` **Pip:** Twenty-one gates. More than halfway!
- `s21_4` *The song rolls through the Deep, and the dark feels a little smaller.*

### Level 22: Old Bellow’s song echoes through a tank shaped like an hourglass.
**Chapter 22 · The Sunken City** (film: `ruins`, arrival in level 23: `swirl`)

- `s22_1` *An old sea city sleeps in the dark. Its columns glow as you pass.*
- `s22_2` *On the last wall, a mural: the Reef Keeper, and a little purple octopus.*
- `s22_3` **Lumen:** Murk was the Keeper’s best friend.
- `s22_4` **Pip:** Then why did he take all the pearls?

### Level 23: The pressure of the Deep presses on you. Air is short here, so be quick.
**Chapter 23 · Shelly Returns** (film: `turtle2`, arrival in level 24: `drop`)

- `s23_1` **Shelly:** There you are! I had to see the Lantern with my own old eyes.
- `s23_2` **Shelly:** I remember the storm. A big octopus grabbed every pearl he could, to save them from the waves.
- `s23_3` **Pip:** He wasn’t stealing them. He was protecting them!
- `s23_4` **Shelly:** Hold on tight. The Deep is big, and we’re nearly there.

### Level 24: A gauntlet of stones guards the sunken city’s gate.
**Chapter 24 · Murk’s Den** (film: `murkden`, arrival in level 25: `bubble`)

- `s24_1` *In a den full of pearls hides a giant octopus.*
- `s24_2` **Murk:** Go away… I got lost in the storm. It’s so dark, I can’t find the Lantern.
- `s24_3` **Murk:** I kept the pearls safe. But I’m too scared to go back.
- `s24_4` **Pip:** We’re not here to take them. We’re here to help.

### Level 25: Shelly carried you to a tank where one push sets off a chain.
**Chapter 25 · A Gift of Light** (film: `gift`, arrival in level 26: `swirl`)

- `s25_1` *You give Murk one glowing pearl from the gates.*
- `s25_2` **Murk:** It’s warm… I’d forgotten what light feels like.
- `s25_3` **Murk:** The Keeper always said: share your light, and the light comes home.
- `s25_4` *For the first time in a very long time, Murk smiles.*

### Level 26: Murk’s den is close. His citadel of stones is the hardest yet.
**Chapter 26 · Over the Abyss** (film: `murkride`, arrival in level 27: `drop`)

- `s26_1` **Murk:** Climb on, little diver. I know the way now.
- `s26_2` *Murk carries you over the deepest trench in the sea.*
- `s26_3` **Murk:** The Keeper left something for whoever came back. I’ll show you.
- `s26_4` **Pip:** Twenty-six gates! I can feel the Lantern humming!

### Level 27: Murk shows you a tank where the undertow pulls everything down.
**Chapter 27 · The Glowing Sea** (film: `plankton`, arrival in level 28: `bubble`)

- `s27_1` **Lumen:** Wave your arms, little Keeper! The Deep is listening.
- `s27_2` *Every wave sets the plankton glowing, brighter and brighter.*
- `s27_3` **Pip:** Did Lumen just call you… Keeper?
- `s27_4` **Lumen:** Who else could light up a whole sea?

### Level 28: The plankton lights the abyss. Count your steps, it’s a long way down.
**Chapter 28 · The Lantern Tower** (film: `tower`, arrival in level 29: `swirl`)

- `s28_1` *At last, the foot of the Great Lantern. Twenty-eight lights glow on its tower.*
- `s28_2` *On its door, the Keeper left one last note:*
- `s28_3` **The Reef Keeper:** “Murk, keep the Heart safe, until someone kind comes back.”
- `s28_4` **Murk:** That someone… is you.

### Level 29: At the foot of the Lantern, the energizer gate waits for its pearls.
**Chapter 29 · The Heart Pearl** (film: `heart`, arrival in level 30: `drop`)

- `s29_1` *Murk brings out the Heart Pearl he has guarded since the storm.*
- `s29_2` **Murk:** I kept it safe for you. Light it with the last gate.
- `s29_3` **Pip:** Twenty-nine gates… One more, and the whole reef wakes up!
- `s29_4` **You:** Let’s bring the light home.

### Level 30: The Heart Pearl is ready. Wake the last gate, and the whole reef shines!
**Finale:** the thirty gate lights wake one by one, the Heart Pearl lights the Great Lantern, and the whole reef shines. The credits name the new Reef Keeper, Pip, Shelly, Lumen, Murk and Captain Clack.

---
Code: `CHAPTERS` / `STORY_WHO` / `RECIPES` (World section of src/game.js) and `LEVEL_STORY` (controller, before `startLevel`). This file is generated from those lines.
