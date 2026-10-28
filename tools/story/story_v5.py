# Aqua Energizer: The Thirty Gates — story v5 (the polish pass of v4: same events, same films, funnier and tighter, with choices).
# Lines: (speaker, text, delivery[, emote]). delivery = the ElevenLabs [tag]; emote = how the speaker moves on the line
# (hop, spin, shake, laugh, salute, droop, nod). A text can be a dict {brave, funny, kind}: picked by the player's style so far.
# Q = an interactive beat before line `at`: kind tap/hold/swipe (ok/no lines) or kind 'choice' (opts: [key, button label, lines]).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story_v4 import SPEAKERS, ROLES, MEM, MEM_TAG, MOOD, DEATH, B  # unchanged pieces

def C(t, r, a, mood, L, w=None, Q=None):
    d = dict(t=t, r=r, a=a, mood=mood, L=L)
    if w is not None: d['w'] = w
    if Q: d['Q'] = Q
    return d

def CHOICE(at, label, brave, funny, kind):
    return dict(at=at, kind='choice', label=label, opts=[['brave', brave[0], brave[1]], ['funny', funny[0], funny[1]], ['kind', kind[0], kind[1]]])

PROLOGUE = C('The Night the Lights Went Out', 'prologue', 'pipe', 'wonder', [
   ('', 'Once, the reef glowed every night. And the brightest light of all was the Great Lantern.', 'warm, wonder'),
   ('pip', "Ooh! Ooh! Look at me! I'm the second brightest thing here!", 'excited, showing off', 'spin'),
   ('grimtide', "Such pretty little lights. I'll take them. ALL of them.", 'silky, hungry'),
   ('', "Grimtide, the eel who drinks light, rose out of the abyss, and the reef's lights poured into his jaws.", 'tense, building'),
   ('keeper', "Not while I'm Keeper!", 'fierce, heroic'),
   ('', 'The Reef Keeper gave all her light to save the Lantern. Grimtide fled… and the whole reef went dark.', 'hushed, sad'),
   ('pip', 'Hello…? Anybody…?', 'tiny, scared, alone', 'droop')], w=0)

CH = [PROLOGUE,
 C('Through the Old Pipe', 'pipe', 'pipe', 'wonder', [
   ('', 'The first gate wakes, and its light shoots down an old pipe. With you in it.', 'amused, warm'),
   ('pip', 'AAAH! A light! A real light! Are you a light? Are you a fish? Are you a light-fish?', 'excited, rapid', 'hop'),
   ('pip', "I'm Pip! And you're a spark. That's your name now. Spark. No take-backs.", 'giggling', 'spin'),
   ('', 'Far away, in the dark, something very big opens one red eye.', 'hushed, ominous')],
   Q=CHOICE(2, 'Who are you?',
     ("I'm here to turn the lights back on.", [('you', "I'm the one who's going to turn the lights back on.", 'determined, confident'), ('pip', "Ooh. Cool. Can I come? I'm very brave. Mostly in my head.", 'excited, nervous', 'hop')]),
     ('A lost tourist. Gift shop?', [('you', 'Just a very lost tourist. Is there a gift shop?', 'playful'), ('pip', "Ha! A funny one! The reef has been SO not funny lately.", 'laughing', 'laugh')]),
     ('A friend. You okay?', [('you', 'A friend. Are you okay, little guy?', 'gentle, warm'), ('pip', "Nobody's asked me that since the storm. I'm… better now.", 'touched, soft', 'nod')]))),
 C('Pip’s Glow', 'kelp', 'swirl', 'hope', [
   ('pip', 'Real talk, Spark. I used to GLOW. People called me Pip the Bright.', 'proud', 'spin'),
   ('you', 'Who called you that?', 'teasing'),
   ('pip', '…Me. I called me that. But then the storm came, and it had EYES. Red ones. And it ate every light in the reef.', 'flustered, then scared', 'shake'),
   ('pip', 'But when your gate woke up, I sparkled! Just a teeny bit! Do it again! Do it again!', 'excited', 'hop')]),
 C('Shelly’s Tale', 'turtle', 'drop', 'dread', [
   ('shelly', 'Red eyes? Hmph. Two hundred years I have lived, and I have seen red eyes once.', 'slow, gravelly, dry'),
   ('shelly', 'Grimtide. An eel as long as a shipwreck, with an ego twice that size. He drinks light.', 'deadpan'),
   ('pip', 'Drinks it? Like a smoothie?', 'horrified', 'shake'),
   ('shelly', 'Like a smoothie. The Keeper built thirty gates to stop him. You woke one, so now he knows about you. Hop on.', 'deadpan, urgent', 'nod'),
   ('pip', "I'm not scared. My fins are just cold.", 'trembling, pretending', 'shake')]),
 C('Captain Clack', 'crabs', 'bubble', 'fun', [
   ('clack', 'HALT! In the name of the Crack Crab Crew! State your name, rank, and favourite snack!', 'booming, pompous', 'salute'),
   ('clack', 'We rescued these pearls from the sand. Grimtide’s tail took the rest. Thick as a mast! Thicker! Two masts!', 'dramatic, exaggerating', 'shake'),
   ('clack', "The Crack Crab Crew sails with you! Pip, you're promoted to Deputy Assistant Vice Captain.", 'grand', 'salute'),
   ('pip', "I've been here five seconds.", 'deadpan'),
   ('clack', 'And already a natural!', 'proud', 'laugh')],
   Q=CHOICE(1, 'Name, rank, snack?',
     ('Spark. Snacks later, heroics now.', [('you', 'Spark. Gate-waker. Snacks later, heroics now.', 'confident'), ('clack', 'HA! A diver with priorities! I like you already!', 'delighted', 'salute')]),
     ('Spark. Seaweed chips.', [('you', 'Spark. Professional tourist. Seaweed chips, extra salty.', 'playful'), ('clack', 'Seaweed chips! A diver of TASTE! Crew, this one is one of us!', 'delighted', 'laugh')]),
     ('The famous captain, I presume?', [('you', 'Spark. And you must be the famous captain everyone talks about.', 'warm, flattering'), ('clack', 'Famous? Me? Well. Yes. Obviously. Crew, did you HEAR that?', 'flustered, proud', 'hop')]))),
 C('Jelly Bounce', 'jelly', 'drop', 'fun', [
   ('', 'Five gates awake, and the jellyfish are humming. They want to help.', 'warm'),
   ('pip', "They're making a bouncy staircase! Jump, Spark! Jump!", 'excited', 'hop'),
   ('you', 'Boing… boing… whoa-ho-HO!', 'laughing'),
   ('clack', 'A captain does NOT bounce. A captain ascends. With dignity. WHEEEE!', 'pompous, then delighted', 'hop')]),
 C('The Keeper’s Map', 'wreck', 'swirl', 'discovery', [
   ('', 'Inside the old wreck: a chest with a seashell lock.', 'hushed'),
   ('pip', 'Open it! No, wait, what if it bites? Open it! No! Okay. Open it.', 'excited, nervous', 'shake'),
   ('keeper', '“If Grimtide returns, wake the gates. Shared light is the one thing he cannot drink.”', 'gentle, like a memory'),
   ('clack', 'A treasure map! Hand it here, crew. Captains are excellent with maps.', 'proud', 'salute'),
   ('pip', "You're holding it upside down.", 'deadpan')]),
 C('The Lure', 'trap', 'swirl', 'blunder', [
   ('', 'In a dark hollow, a soft light glows. A gate? It looks just like one.', 'curious'),
   ('pip', "Spark… gates don't usually wink at you.", 'nervous', 'shake'),
   ('grimtide', 'Thank you, little light. A map with every gate marked. How thoughtful.', 'silky, amused'),
   ('grimtide', "Do keep waking them. I'll be waiting at every single one.", 'menacing whisper'),
   ('pip', "Spark… my glow. It's going out again.", 'crying softly', 'droop')],
   Q=dict(at=2, kind='tap', n=8, label='Hold on to the map!',
          ok=[('you', 'Not! Letting! GO!', 'straining, through gritted teeth'), ('', 'The map tears in two. A torn corner drifts off into the dark.', 'tense')],
          no=[('you', 'No! The map!', 'desperate'), ('', 'He rips it free. A torn corner drifts off into the dark.', 'tense')])),
 C('Follow the Fish', 'school', 'bubble', 'recovery', [
   ('pip', 'This is my fault. I said “ooh, pretty light”. I literally said “ooh”.', 'sniffling', 'droop'),
   ('', 'Then the fish remember the gates. They swirl into a big silver arrow.', 'wonder'),
   ('clack', 'FISH! Of course! Exactly as I planned. I planned fish.', 'triumphant', 'salute'),
   ('pip', 'Ha! Who needs his map anyway?', 'laughing through tears', 'hop')],
   Q=CHOICE(1, 'Cheer Pip up',
     ("We'll find the gates ourselves.", [('you', "We don't need his map. We'll find the gates ourselves.", 'determined'), ('pip', 'Ourselves. Okay! I am GREAT at ourselves.', 'brave, sniffly', 'nod')]),
     ('It WAS a very pretty light.', [('you', 'In your defence, it WAS a very pretty light.', 'playful'), ('pip', 'It was SO pretty. Okay. I feel a little better.', 'laughing through tears', 'laugh')]),
     ("You warned me. We're a team.", [('you', "Hey. You warned me. I didn't listen. We're in this together.", 'gentle'), ('pip', '…Together. Okay. Together.', 'soft, grateful', 'nod')]))),
 C('The Torn Map', 'dune', 'drop', 'hope', [
   ('pip', 'Look! The torn piece of the map! It blew all the way here!', 'excited', 'hop'),
   ('you', 'It only shows one gate. On the edge of a cliff.', 'thoughtful'),
   ('clack', 'Cliffs. Of course it’s cliffs. Crabs and cliffs have a long and painful history.', 'grumbling', 'shake'),
   ('', 'Behind the dune, ink hangs in the water. Fresh ink.', 'ominous')]),
 C('The Edge of the Shallows', 'descent', 'drop', 'courage', [
   ('pip', "That's the Coral Caves down there. Maybe we take the stairs?", 'scared', 'shake'),
   ('snip', 'Ooh, look, Snap! Little light wants to take the STAIRS!', 'sneering, cackling', 'laugh'),
   ('snap', 'There are no stairs. There’s only US.', 'snarling'),
   ('clack', 'Crabs… don’t… fall… WELLLLL!', 'yelling, fading away')],
   Q=dict(at=3, kind='swipe', dir='down', label='Dive!',
          ok=[('you', 'Pip, hold on! JUMP!', 'shouting')],
          no=[('pip', "They're biting! Jump-jump-JUMP!", 'screaming')])),
 C('Voices in the Caves', 'crystals', 'bubble', 'menace', [
   ('grimtide', "Welcome to my caves, little light. Mind the echo. It's ME.", 'echoing, amused'),
   ('pip', 'He can see us! Spark, he can SEE us!', 'panicking', 'shake'),
   ('grimtide', 'Every crystal you light shows me where you are. Shine away.', 'echoing whisper'),
   ('clack', 'Crew! We came to pinch, and pinch we shall!', 'heroic', 'salute')], w=1,
   Q=CHOICE(3, 'Answer Grimtide',
     ("Then we'll light them ALL.", [('you', "Then we'll light every single one.", 'defiant'), ('grimtide', '…Bold. I like bold. Bold tastes better.', 'amused, menacing')]),
     ('Do you always talk this much?', [('you', 'Do you always talk this much in caves?', 'cheeky'), ('grimtide', 'I… That is… how RUDE.', 'offended, flustered')]),
     ('Stay close, Pip.', [('you', "Stay close, Pip. He's just trying to scare you.", 'gentle, steady'), ('pip', "It's working. But… okay. Closer.", 'small, brave', 'nod')]))),
 C('The Silent Clam', 'clams', 'swirl', 'bittersweet', [
   ('', 'Giant clams open, one by one, and sing the Keeper’s old song.', 'gently'),
   ('choir', '“Share your light, and the light comes home…”', 'singing softly'),
   ('', 'But the last clam stays shut. Grimtide stole its pearl, and its song.', 'sad'),
   ('shelly', 'Remember that tune, little ones. You’ll need it soon.', 'warm but worried')], w=1),
 C('The Dark Storm', 'storm', 'drop', 'danger', [
   ('', 'The water goes black. The storm has found you.', 'tense'),
   ('grimtide', 'Thirteen gates, little light? Thirteen too many!', 'roaring'),
   ('shelly', 'Everyone behind my shell! NOW!', 'shouting, commanding'),
   ('', 'Shelly takes the whole blow… and sinks, slowly, to the sand.', 'slow, heartbroken'),
   ('grimtide', 'One down.', 'cold, quiet')], w=1,
   Q=dict(at=3, kind='hold', label='Hold on to Pip!',
          ok=[('you', "I've got you, Pip! Don't let go!", 'straining')],
          no=[('pip', "Spark! I can't hold on!", 'screaming')])),
 C('Rest, Old Friend', 'shellyrest', 'bubble', 'sad', [
   ('pip', 'Shelly? Shelly, please wake up…', 'crying', 'droop'),
   ('shelly', 'Hush. My shell has survived worse. Clack’s singing, for one.', 'weak, dry humour'),
   ('shelly', "But I can't swim on. Promise me you'll wake every gate. Every last one.", 'weak, earnest'),
   ('clack', 'Go. I’ll stand guard. Nobody touches this turtle while Clack has claws.', 'gruff, emotional', 'salute')], w=1,
   Q=CHOICE(3, 'Promise Shelly',
     ("I promise. Then I'm coming back.", [('you', "I promise. And then I'm coming back for you.", 'determined, holding back tears'), ('shelly', 'I’ll hold you to that.', 'weak, proud', 'nod')]),
     ('Promise. You owe me a story.', [('you', 'Promise. But you owe me a bedtime story.', 'teary, smiling'), ('shelly', 'Deal. It’s a long one. Two hundred years.', 'weak laugh', 'laugh')]),
     ("Rest, Shelly. We've got this.", [('you', "Rest, Shelly. We've got this.", 'gentle, tearful'), ('shelly', 'I know you do. That’s why I can rest.', 'weak, tender', 'nod')]))),
 C('Mira', 'manta', 'drop', 'hope', [
   ('mira', 'I am Mira. The currents carried me a message from an old turtle.', 'serene'),
   ('mira', '“Don’t look back. Tell them I’m proud. And tell the crab to stop fussing.”', 'serene, amused'),
   ('pip', "That's definitely Shelly.", 'laughing, teary', 'laugh'),
   ('mira', 'Climb on. The canyon is wide, and grief is heavy. I will carry both.', 'warm')], w=1),
 C('The Prisoner', 'shadow', 'swirl', 'mystery', [
   ('pip', 'Spark… there are EYES in there. Big ones. Bigger than Shelly!', 'terrified whisper', 'shake'),
   ('murk', "Please don't scream. Everybody screams. I'm Murk. Sorry about my face.", 'deep, apologetic'),
   ('murk', 'He chains me. He makes me gather the pearls. Wait… that lamp. Where did you get that lamp?', 'startled whisper'),
   ('', 'Before you can answer, a tail yanks him back into the dark.', 'tense')], w=1),
 C('The Arch’s Secret', 'arch', 'drop', 'resolve', [
   ('', 'An old coral arch blocks the way. Its lamps went out in the storm.', 'curious'),
   ('arch', '“Grimtide fears one thing: light that is given away.”', 'ancient, echoing'),
   ('pip', "Given away? But he TAKES light. He's a light-taker. A big… taking… noodle.", 'puzzled', 'shake'),
   ('you', "That's how we beat him, Pip. And how we free Murk.", 'realizing, excited')], w=1,
   Q=dict(at=1, kind='tap', n=6, label='Light the lamps!',
          ok=[('pip', 'You did it! The arch remembers!', 'excited')],
          no=[('', 'One by one, the old lamps flicker awake on their own.', 'gentle')])),
 C('A Secret Trail', 'pearls', 'bubble', 'hope', [
   ('', 'Pearls float up from the sand like little lanterns. A trail.', 'wonder'),
   ('pip', "Murk left them! He's helping us! In secret! Like a spy! A big squishy spy!", 'excited', 'spin'),
   ('grimtide', 'Murk… Why are my pearls floating away, Murk?', 'suspicious, cold, distant'),
   ('murk', '…Currents?', 'nervous, far away')], w=1),
 C('Good News', 'race', 'swirl', 'joy', [
   ('cousin', 'PIP! PIP! Shelly woke up! She’s okay!', 'shrieking with joy', 'hop'),
   ('pip', "She's okay? SHE'S OKAY! Spark! She's okay!", 'overjoyed', 'spin'),
   ('cousin', 'And the loud crab says, quote: “Don’t save the reef without me!”', 'giggling', 'laugh')], w=1,
   Q=CHOICE(3, 'Message for home',
     ("Tell him to hurry up!", [('you', "Tell him to hurry. We're not slowing down.", 'fired up'), ('cousin', 'Ooh, intense! I’ll tell him!', 'excited', 'hop')]),
     ('We’ll save him a bit of reef.', [('you', "Tell him we'll save him a little bit of reef.", 'playful'), ('cousin', 'Ha! He’s going to HATE that!', 'cackling', 'laugh')]),
     ('Tell Shelly we love her.', [('you', 'Tell Shelly we love her.', 'warm, emotional'), ('cousin', 'She knows. She says it first, every morning.', 'sweet', 'nod')]))),
 C('The Lantern in Chains', 'coil', 'drop', 'dread', [
   ('', 'From the last cliff of the caves, you see it: the Great Lantern.', 'awed'),
   ('', 'And wrapped around it like a storm cloud: Grimtide.', 'ominous'),
   ('grimtide', 'Twenty gates! You think you’re saving the reef? You’re setting my table.', 'delighted, menacing'),
   ('pip', 'Why does he keep talking about FOOD?', 'frightened', 'shake')], w=1),
 C('Lumen', 'angler', 'bubble', 'hope', [
   ('lumen', 'Psst! Over here! Quick, before his eyes find you!', 'stage whisper'),
   ('lumen', 'Lumen’s the name, light’s the game! The Deep’s last lantern, live and in person!', 'theatrical, grand', 'spin'),
   ('lumen', 'I’ve been hiding for three weeks. In a sock. Don’t ask where I got a sock.', 'dropping the act'),
   ('lumen', 'But you’re going after him? Then my light is yours. Showtime!', 'brave, theatrical', 'hop')], w=2),
 C('Whale Song', 'whale', 'drop', 'wonder', [
   ('lumen', 'Old Bellow! He only sings when the Lantern fights back!', 'thrilled', 'spin'),
   ('clack', 'Did somebody say CAPTAIN?', 'booming', 'salute'),
   ('pip', 'CLACK!', 'overjoyed', 'hop'),
   ('clack', 'Shelly sends her love. And a VERY rude message for Grimtide. I’ll deliver it personally.', 'proud, chuckling', 'laugh')], w=2),
 C('The Mural', 'ruins', 'swirl', 'discovery', [
   ('', 'An old sea city. On its last wall: the Reef Keeper and a giant purple octopus.', 'hushed'),
   ('pip', 'Spark… look at her helmet. Look at her LAMP.', 'stunned whisper', 'shake'),
   ('you', "It's my lamp. It's the same lamp.", 'shaken, quiet'),
   ('lumen', 'Kid, I’ve been in show business a long time. That’s what we call a plot twist.', 'soft, amazed', 'nod')], w=2),
 C('Ambush', 'ambush', 'drop', 'blunder', [
   ('pip', "Twenty-four gates! We're going to make it, Spark! We're actually going to—", 'joyful', 'spin'),
   ('grimtide', 'ENOUGH!', 'roaring'),
   ('pip', 'Spaaark!', 'screaming, fading'),
   ('clack', 'Let him go, you overgrown NOODLE!', 'roaring, charging'),
   ('', 'Clack leaps at the tail. One mighty pinch… and the tail swats him into the dark.', 'slow, grave'),
   ('grimtide', 'Come to my lair, little light. Or never see your seahorse again.', 'cold, triumphant')], w=2,
   Q=dict(at=2, kind='tap', n=12, label='Grab Pip!',
          ok=[('you', "I've got you! I've got… NO!", 'desperate')],
          no=[('you', 'PIP!', 'screaming')])),
 C('The Captain’s Last Order', 'farewell', 'drop', 'grief', [
   ('clack', 'Gate-waker… did I get him? Tell me I pinched him good.', 'weak, rasping'),
   ('clack', 'Tell my crew… they were the finest crew… on the whole reef.', 'weak, fading', 'droop'),
   ('', 'And the Captain is still.', 'whispered'),
   ('shelly', 'You brave, loud, wonderful fool. Up, little one. Grimtide has Pip. And I have two hundred years of anger.', 'grieving, then fierce')], w=2,
   Q=CHOICE(1, 'Answer the Captain',
     ('You were magnificent, Captain.', [('you', 'You were magnificent, Captain.', 'crying, proud'), ('clack', 'Magnificent… put that on my shell.', 'weak, smiling')]),
     ("He'll walk funny for a week.", [('you', "He'll be walking funny for a week.", 'crying, laughing'), ('clack', 'Ha… good. Good.', 'weak laugh')]),
     ('You saved us, Captain.', [('you', 'You did, Captain. You saved us.', 'gentle, tearful'), ('clack', 'Then it was worth it.', 'weak, at peace')]))),
 C('Breaking the Chains', 'cage', 'bubble', 'rescue', [
   ('pip', 'Spark! You came! I knew you’d come! I said “Spark will come” like four hundred times!', 'crying, joyful', 'hop'),
   ('murk', "I'm sorry. He makes me guard him. If I let go, Grimtide will…", 'ashamed, deep', 'droop'),
   ('you', 'Murk. This was her lamp, wasn’t it?', 'gentle'),
   ('murk', '…She was my best friend.', 'breaking'),
   ('murk', "FREE! I'm free! Group hug! I have eight arms, everyone's included!", 'joyful roar', 'laugh')], w=2,
   Q=dict(at=4, kind='tap', n=10, label='Give your light!',
          ok=[('', 'You hold up a glowing pearl and give it away. The ink chains melt.', 'soaring')],
          no=[('', 'The pearl’s light pours out on its own, and the ink chains melt.', 'soaring')])),
 C('Over the Abyss', 'murkride', 'drop', 'resolve', [
   ('murk', 'Climb on. I know the way to his lair.', 'deep, steady'),
   ('murk', 'The night of the storm, she went to face him alone. I was too scared to follow.', 'quiet, ashamed', 'droop'),
   ('pip', "I'm not scared. My fins are just… okay, I'm scared. But I'm going anyway!", 'brave, shaky', 'shake')], w=2,
   Q=CHOICE(2, 'Answer Murk',
     ('This time, we go together.', [('you', 'This time, we all go together.', 'resolute'), ('murk', 'Together.', 'deep, resolute', 'nod')]),
     ('Eight arms. Use them ALL.', [('you', 'Well, you have eight arms now. Use them ALL.', 'playful'), ('murk', 'Eight arms of fury. I like that.', 'deep laugh', 'laugh')]),
     ("It wasn't your fault, Murk.", [('you', "It wasn't your fault, Murk.", 'gentle'), ('murk', '…She would have said that. Thank you.', 'deep, moved', 'nod')]))),
 C('The Deep Rises', 'plankton', 'bubble', 'rally', [
   ('lumen', 'Ladies and gentlefish! Wave those arms, Spark! Show the Deep it’s not alone!', 'theatrical, grand', 'spin'),
   ('', 'Every wave sets the plankton glowing. Then the jellies. Then the fish. Then everyone.', 'building, epic'),
   ('', 'Clack’s crew raise his tiny hat high.', 'proud, emotional'),
   ('grimtide', 'Light them all, little light. More for me.', 'distant, mocking')], w=2),
 C('Grimtide’s Lair', 'lair', 'drop', 'showdown', [
   ('grimtide', 'Twenty-nine gates. The Lantern is nearly full. Wake the last, and I drink it ALL.', 'hungry, rising'),
   ('pip', "THAT'S why he let us! We've been cooking his DINNER!", 'horrified', 'shake'),
   ('you', 'You’re wrong about one thing. That light isn’t yours. We’re giving it away.', 'calm, defiant'),
   ('grimtide', 'Then come, Keeper’s child. Let’s see who shines last.', 'menacing whisper')], w=2,
   Q=dict(at=2, kind='swipe', dir='left', label='Dodge!',
          ok=[('murk', 'Not this time!', 'roaring')],
          no=[('murk', "Spark! I've got you!", 'roaring')])),
 C('The Reef’s Revenge', 'victory', 'drop', 'victory', [
   ('grimtide', 'YES! Give it to me!', 'greedy, ecstatic'),
   ('', 'Every creature in the sea gives its light at once. Way too much light. Freely given.', 'soaring'),
   ('grimtide', 'No… NO! It BURNS! Too bright! Too SHARED!', 'screaming'),
   ('', 'And the mighty Grimtide shrinks… to a tiny, wriggling, very grumpy worm.', 'triumphant, amused'),
   ('snip', 'Uh… Snap? I think we work for a worm now.', 'nervous'),
   ('clack', 'Did somebody say… CAPTAIN?', 'muffled, then booming', 'salute'),
   ('pip', {'brave': 'CLACK?! You were brave the whole way, Spark. Everybody was!', 'funny': 'CLACK?! Spark, you made me laugh the whole way. And now THIS!', 'kind': 'CLACK?! Spark, you were kind the whole way. That’s why it worked.'}, 'shrieking with joy', 'spin'),
   ('', 'The Heart Pearl rises home. And the whole reef shines.', 'warm, soaring')], w=2,
   Q=dict(at=1, kind='hold', label='Give the light away!',
          ok=[('you', 'It was never yours!', 'shouting')],
          no=[('pip', 'Everybody, NOW! Give it away!', 'shouting')])),
]

# the level card: punchier
from story_v4 import LEVEL_STORY  # kept; the in-level beats below get the polish
from story_v4 import BEATS as _B4
BEATS = _B4
