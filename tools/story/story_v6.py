# Aqua Energizer story v6 = story v5, cut short and punchy (owner: "shorter punchier cutscenes… not just talking… add the gameplay").
# Every film keeps only its 2-3 best lines; the other lines stay in the data as *silent action beats* (text starts with '~'):
# no caption, no voice, ~1.1 s on the wide shot, so the animation keyed to them still plays and the journal still reads them.
# Choice replies: the diver's echo of the button is silent, the other character's reaction stays.
# Every film without a playable moment gets a short swim-run at its end (Q.at = number of lines, so no line moves).
#   python3 tools/story/gen_docs.py   -> voices.json / docs (silent lines are skipped)
#   python3 tools/story/inject.py     -> the game's copy (CHAPTERS / PROLOGUE in src/game.js)
import copy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import story_v5 as V5
from story_v5 import *  # noqa: F401,F403  (everything gen_docs reads; CH / PROLOGUE are replaced below)

CH = copy.deepcopy(V5.CH)

# chapter -> (silent line indices, {index: shorter text})
CUT = {
  1: ([0], {1: 'AAAH! A light! Are you a light? A fish? A light-fish?', 2: "I'm Pip! And you're Spark now. No take-backs."}),
  2: ([1], {0: 'Real talk, Spark. I used to GLOW. Pip the Bright!', 2: 'Then the storm came. It had red EYES. It ate every light in the reef.', 3: 'But your gate made me sparkle! A teeny bit! Do it again!'}),
  3: ([0], {1: 'Grimtide. An eel as long as a shipwreck. He drinks light.', 2: 'Drinks it? Like a smoothie?', 3: 'Like a smoothie. And now he knows about you. Hop on!'}),
  4: ([1], {0: 'HALT! Crack Crab Crew! Name, rank, and favourite snack!', 2: "Pip, you're promoted! Deputy Assistant Vice Captain!"}),
  5: ([0, 2], {1: "A bouncy staircase! Jump, Spark! Jump!", 3: 'A captain does NOT bounce. A captain ascends. WHEEEE!'}),
  6: ([0], {1: 'Open it! No, what if it bites? …Open it!', 2: '“Wake the gates. Shared light is the one thing he cannot drink.”', 3: 'A map! Hand it here. Captains are excellent with maps.'}),
  7: ([0], {1: "Spark… gates don't usually wink.", 2: 'Thank you, little light. A map with every gate marked.', 3: "Keep waking them. I'll be waiting at every one.", 4: 'Spark… my glow is going out.'}),
  8: ([1], {0: 'This is my fault. I said “ooh, pretty light”. I literally said “ooh”.', 2: 'FISH! Exactly as I planned.', 3: 'Who needs his map anyway?'}),
  9: ([3], {0: 'Look! The torn piece of the map!', 1: 'One gate. On the edge of a cliff.', 2: 'Cliffs. Crabs and cliffs have a long and painful history.'}),
  10: ([0], {1: 'Ooh, Snap! Little light wants the STAIRS!', 2: 'There are no stairs. Only US.', 3: 'Crabs… don’t… fall… WELLLLL!'}),
  11: ([3], {0: 'Welcome to my caves, little light. Mind the echo. It’s ME.', 1: 'He can SEE us!', 2: 'Every crystal you light shows me where you are.'}),
  12: ([0], {2: 'But the last clam stays shut. Grimtide stole its song.', 3: 'Remember that tune, little ones.'}),
  13: ([0], {1: 'Thirteen gates, little light? Thirteen too many!', 2: 'Everyone behind my shell! NOW!', 3: 'Shelly takes the whole blow… and sinks to the sand.'}),
  14: ([1], {0: 'Shelly? Shelly, please wake up…', 2: "I can't swim on. Promise me you'll wake every gate.", 3: 'Go. Nobody touches this turtle while Clack has claws.'}),
  15: ([3], {0: 'I am Mira. An old turtle sent me a message.', 1: '“Tell them I’m proud. And tell the crab to stop fussing.”'}),
  16: ([3], {0: 'Spark… EYES in there. Bigger than Shelly!', 1: "Please don't scream. I'm Murk. Sorry about my face.", 2: 'Wait… that lamp. Where did you get that lamp?'}),
  17: ([0], {1: '“Grimtide fears one thing: light that is given away.”', 2: 'But he TAKES light. He’s a big… taking… noodle.', 3: "That's how we beat him, Pip."}),
  18: ([0], {1: 'Murk left them! He’s a spy! A big squishy spy!', 2: 'Murk… why are my pearls floating away?'}),
  19: ([], {0: 'PIP! Shelly woke up! She’s okay!', 1: "SHE'S OKAY! Spark! She's okay!", 2: 'And the loud crab says: “Don’t save the reef without me!”'}),
  20: ([0], {1: 'Wrapped around the Great Lantern like a storm cloud: Grimtide.', 2: 'Twenty gates! You’re not saving the reef. You’re setting my table.', 3: 'Why does he keep talking about FOOD?'}),
  21: ([0], {1: 'Lumen’s the name, light’s the game!', 2: 'I’ve been hiding for three weeks. In a sock. Don’t ask.', 3: 'Going after him? Then my light is yours. Showtime!'}),
  22: ([0], {3: 'Shelly sends her love. And a VERY rude message for Grimtide.'}),
  23: ([0], {1: 'Spark… look at her helmet. Her LAMP.', 2: "It's my lamp.", 3: 'Kid, in show business we call that a plot twist.'}),
  24: ([2, 4], {0: 'Twenty-four gates! We’re actually going to—', 3: 'Let him go, you overgrown NOODLE!', 5: 'Come to my lair, little light. Or never see your seahorse again.'}),
  25: ([2], {0: 'Did I get him? Tell me I pinched him good.', 1: 'Tell my crew… finest crew… on the whole reef.', 3: 'You brave, loud, wonderful fool. Up, little one. Grimtide has Pip.'}),
  26: ([1], {0: 'Spark! You came! I said “Spark will come” like four hundred times!', 2: 'Murk. This was her lamp, wasn’t it?', 4: "FREE! Group hug! I have eight arms, everyone's included!"}),
  27: ([0], {1: 'The night of the storm, she faced him alone. I was too scared to follow.', 2: "I'm not scared. My fins are just… okay, I'm scared. Going anyway!"}),
  28: ([1, 2], {0: 'Ladies and gentlefish! Wave those arms, Spark! Show the Deep it’s not alone!'}),
  29: ([], {0: 'Twenty-nine gates. Wake the last, and I drink it ALL.', 1: "We've been cooking his DINNER!", 2: 'That light isn’t yours. We’re giving it away.', 3: 'Then come, Keeper’s child.'}),
  30: ([1], {2: 'No… NO! It BURNS! Too SHARED!', 3: 'And mighty Grimtide shrinks… to a tiny, very grumpy worm.'}),
}
# tap / run outcomes: (silent ok indices, silent no indices)
QCUT = {5: ([0], [1]), 10: ([0], [0]), 13: ([0], [1]), 15: ([1], [1]), 24: ([1], [0]), 29: ([1], [])}

# new playable runs at the end of the films that had none (short: 16 s)
def RUN(v, label, ok, no, dur=16): return dict(kind='run', v=v, label=label, dur=dur, ok=ok, no=no)
NEW_Q = {
  2: RUN('kelp', 'Catch the sparkles!', [('pip', "I'm GLOWING! A teeny bit! Okay, a medium bit!", 'overjoyed', 'spin')], [('pip', 'Still sparkly! Teeny, but sparkly!', 'brave, cheerful', 'hop')]),
  3: RUN('shell', "Ride on Shelly! Dodge the rocks!", [('shelly', 'Hmph. Not bad, for a light-fish.', 'dry, secretly pleased', 'nod')], [('shelly', 'Bumpy. My shell has had worse.', 'dry, unbothered')]),
  6: RUN('wreck', 'Turn the crank on the beat!', [('clack', 'Exactly as I planned! The map is safe!', 'booming, proud', 'salute')], [('pip', 'We made it! Mostly! The map is a bit soggy.', 'breathless', 'shake')]),
  9: RUN('dune', 'Outrun the ink cloud!', [('pip', 'Ha! Ink can’t catch us!', 'cheeky, giddy', 'laugh')], [('clack', 'I have ink in places a crab should never have ink.', 'grumbling', 'shake')]),
  16: RUN('shadow', 'Hide from the searchlight!', [('pip', "He's gone… but he saw your lamp, Spark.", 'whispered, worried', 'droop')], [('pip', 'Too dark… we lost him.', 'sad, whispered', 'droop')]),
  20: RUN('coil', 'Hide from the eye!', [('pip', "He didn't even see us! …Did he?", 'giddy, then nervous', 'hop')], [('grimtide', 'Run along, little light. I can wait.', 'silky, menacing')]),
  21: RUN('angler', 'Hit Lumen’s beat!', [('lumen', 'Standing ovation! You two are naturals!', 'theatrical, delighted', 'spin')], [('lumen', 'Little stage fright. Happens to the best of us!', 'theatrical, warm')]),
  22: RUN('whale', 'Swim with Bellow’s song!', [('clack', 'WHEEE! I mean… dignified whee.', 'giddy, then gruff', 'hop')], [('pip', 'Bumpy song! Still pretty!', 'cheerful')]),
  23: RUN('ruins', 'The ruins are falling! Swim!', [('lumen', 'And THAT is how you exit a scene!', 'theatrical, triumphant', 'spin')], [('lumen', 'A bit of rubble. The show goes on!', 'theatrical, shaken')]),
}

MUTE = lambda l: (l[0], '~' + l[1]) + tuple(l[2:]) if isinstance(l[1], str) and not l[1].startswith('~') else l
for n, (mute, short) in CUT.items():
    c = CH[n]; L = [list(l) for l in c['L']]
    for i, t in short.items(): L[i][1] = t
    c['L'] = [MUTE(tuple(l)) if i in mute else tuple(l) for i, l in enumerate(L)]
    q = c.get('Q')
    if q and q['kind'] == 'choice':  # the diver's spoken echo of the button goes silent; the reaction stays
        q['opts'] = [[k, lab, [MUTE(l) if l[0] == 'you' and len(ls) > 1 else l for l in ls]] for (k, lab, ls) in q['opts']]
    if q and n in QCUT:
        a, b = QCUT[n]; q['ok'] = [MUTE(l) if i in a else l for i, l in enumerate(q['ok'])]; q['no'] = [MUTE(l) if i in b else l for i, l in enumerate(q['no'])]
for n, q in NEW_Q.items():
    assert 'Q' not in CH[n], n
    q['at'] = len(CH[n]['L']); CH[n]['Q'] = q
PROLOGUE = CH[0]

# story v6 mini-games: each film gets a different game than the swim-run it used to have
# beat = timing (tap on the gold), catch = lanes (steer to catch pearls), sneak = stealth (tap to hide before the eye sweeps)
REKIND = {2: 'catch', 5: 'beat', 6: 'beat', 16: 'sneak', 18: 'catch', 20: 'sneak', 21: 'beat', 28: 'beat'}
LABEL = {2: 'Catch the sparkles!', 5: 'Bounce on the beat!', 6: 'Turn the crank on the beat!', 16: 'Hide from the searchlight!',
         18: "Catch Murk's floating pearls!", 20: "Hide from Grimtide's eye!", 21: "Hit Lumen's beat!", 28: 'Wave to the beat!'}
for n, k in REKIND.items():
    CH[n]['Q']['kind'] = k; CH[n]['Q']['label'] = LABEL[n]
    CH[n]['Q'].pop('v', None); CH[n]['Q'].pop('dur', None)
