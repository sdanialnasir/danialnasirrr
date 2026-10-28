# Aqua Energizer: the story

**The world.** The reef's light lives in the **Heart Pearl**, high in the **Great Lantern**, a coral tower at the bottom of the Deep. One night a huge storm swept the pearls away and the reef went dark (the intro film). Thirty gates still connect the Reef Keeper's old aquariums; every gate the little diver wakes sends a thread of light home.

**The cast.** **The diver** (the player). **Pip**, a tiny seahorse whose glow the storm took; he glows a little brighter after every gate. **Shelly**, an old sea turtle who gives rides. **Lumen**, a friendly anglerfish who lights the way into the Deep. **Murk**, a giant shy octopus who took the pearls because he is scared of the dark; the diver shares a light with him, and he returns the Heart Pearl. Finale (after level 30): the Lantern lights and the whole reef wakes.

**Acts.** Sunlit Shallows (chapters 1–10): meeting Pip, Shelly, the map of the thirty gates. Coral Caves (11–20): crystals, clams, glimmer jellies, the first glimpse of something big in the dark, the Great Lantern seen far below. The Deep (21–29): the whale, the sunken city, Murk's den, the gift of light, the Lantern tower, the Heart Pearl.

Each chapter plays after its level as a short 3D film (6–7.5 s, tap to skip), then holds its last frame under the result card. The next level opens with an arrival that fits the film (pipe, drop from above, a whirl of bubbles, a bubble that pops).

| After level | Chapter | Film | Story lines | Arrival |
|---|---|---|---|---|
| 1 | Through the Old Pipe | pipe | The gate’s light rushes into an old pipe… / …and carries you on. Someone tiny peeks out! | pipe |
| 2 | Pip’s Glow | kelp | “I’m Pip! The storm stole my glow.” / “Every gate you wake gives a little back. Follow me!” | swirl |
| 3 | Shelly’s Ride | turtle | Old Shelly the turtle paddles by. / “Hop on, little diver. I know the way!” | drop |
| 4 | The Crab Parade | crabs | Crabs march past with pearls the storm scattered. / They cheer you on. One gate closer! | bubble |
| 5 | Jelly Bounce | jelly | Friendly jellies make a bouncy stair… / …boing, boing, up and away! | drop |
| 6 | The Old Wreck | wreck | Inside an old wreck sits a dusty chest. / A map! Thirty gates lead to the Great Lantern. | swirl |
| 7 | The Warm Current | current | A warm current scoops you up. Wheee! / It sets you down right where you need to be. | swirl |
| 8 | Follow the Fish | school | A school of fish swirls together… / …and points the way like a silver arrow. | bubble |
| 9 | Down the Dune | dune | The biggest dune in the Shallows! / What a ride! | drop |
| 10 | The Edge of the Shallows | descent | The map points down, into the Coral Caves. / “Together?” asks Pip. “Together!” | drop |
| 11 | Sleeping Crystals | crystals | The caves are dark, but your lamp wakes the crystals. / One by one, they glow back at you. | bubble |
| 12 | The Clam Choir | clams | Giant clams open, one after another… / …and sing a thank-you song for the light. | swirl |
| 13 | Glimmer Jellies | glimmer | Tiny glimmer jellies gather round you. / They light the dark water like stars. | bubble |
| 14 | The Manta Glide | manta | A gentle manta offers a lift over the canyon. / Hold on tight! | drop |
| 15 | Something in the Dark | shadow | Something big blinks in the dark… / …and slips away. Pip hides behind you. | swirl |
| 16 | The Coral Arch | arch | The old Coral Arch still remembers the light. / Its lamps wake as you swim through. | drop |
| 17 | Pearl Lanterns | pearls | Pearls the storm buried float up from the sand… / …like little lanterns, rising home. | bubble |
| 18 | The Seahorse Race | race | Pip’s cousins want a race! / Pip is glowing brighter than ever. | swirl |
| 19 | The Great Lantern | lanternview | Far below, the Great Lantern stands dark. / “That’s where the light lives,” says Pip. | drop |
| 20 | Lumen’s Light | angler | Into the Deep. A little light bobs in the dark… / Lumen the anglerfish will light the way. | bubble |
| 21 | Whale Song | whale | A whale sings far above. / The Deep is waking up. | drop |
| 22 | The Sunken City | ruins | An old sea city sleeps in the dark. / Its columns glow as you pass. | swirl |
| 23 | Shelly Returns | turtle2 | Shelly found you, all the way down here! / “The Deep is big. Let’s go faster!” | drop |
| 24 | Murk’s Den | murkden | In a den full of pearls hides a giant octopus. / Murk took the pearls because he is scared of the dark. | bubble |
| 25 | A Gift of Light | gift | You share your light with Murk. / For the first time in ages, he smiles. | swirl |
| 26 | Over the Abyss | murkride | Murk carries you over the deepest trench. / “Thank you, little diver. Now I’ll help you.” | drop |
| 27 | The Glowing Sea | plankton | Wave your arms… the whole sea lights up! / Even the plankton is waking. | bubble |
| 28 | The Lantern Tower | tower | The Great Lantern! Twenty-eight lights glow on it. / Only two gates left. | swirl |
| 29 | The Heart Pearl | heart | Murk brings the Heart Pearl he kept safe. / One last gate, and the whole reef will shine! | drop |

Code: `CHAPTERS` and `RECIPES` in src/game.js (World section, before `class Story`). To change a line, edit `cap`; to change a scene, edit its recipe (`setup` builds the cast, `run(S, c, t)` moves camera, diver and cast at time t).
