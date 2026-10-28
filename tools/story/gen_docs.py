# story v4 -> tools/voices.json, docs/voice-script.md, docs/story.md.  Run: python3 tools/story/gen_docs.py  (edit tools/story/story_v4.py first; the game copy of the lines lives in src/game.js)
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib; D = importlib.import_module('story_v4')
R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) + '/'
P = R + 'tools/voices.json'; d = json.load(open(P))
role = lambda w: D.SPEAKERS[w][1]
name = lambda w: D.SPEAKERS[w][0] or 'Narrator'
STORY_ID = re.compile(r'^(s\d+_(\d+|ok\d+|no\d+)|l\d+_[spmg]|k_[a-z]+_\d+|m\d+)$')
base = [l for l in d['lines'] if not STORY_ID.match(l['id'])]
for l in base: l['set'] = 'base'
new = []
def add(id, who, text, tag, when):
    new.append({'id': id, 'role': role(who), 'text': f'[{tag}] {text}', 'when': when, 'max_seconds': 0, 'set': 'story', 'who': name(who)})
for n, c in enumerate(D.CH):
    if not c: continue
    for i, (w, t, g) in enumerate(c['L']): add(f's{n}_{i+1}', w, t, g, f"Chapter {n} · {c['t']}")
    if 'Q' in c:
        q = c['Q']
        for j, (w, t, g) in enumerate(q['ok']): add(f's{n}_ok{j+1}', w, t, g, f"Chapter {n} · {c['t']} — after “{q['label']}” (done in time)")
        for j, (w, t, g) in enumerate(q['no']): add(f's{n}_no{j+1}', w, t, g, f"Chapter {n} · {c['t']} — after “{q['label']}” (missed)")
ON = {'s': 'level starts', 'p': 'first pearl in', 'm': 'after 24 s of play', 'g': 'gate opens'}
for n, lv in enumerate(D.BEATS):
    if not lv: continue
    for b in lv: add(f"l{n}_{b['on']}", b['who'], b['text'], b['tag'], f"Level {n}: {ON[b['on']]}" + (' (in-level cutscene)' if b.get('cut') else ''))
for cause, L in D.DEATH.items():
    for i, (w, t, g, lo, hi) in enumerate(L): add(f'k_{cause}_{i+1}', w, t, g, f"Dive failed ({cause}), levels {lo}–{hi}")
for n, t in enumerate(D.MEM):
    if t: add(f'm{n}', 'keeper', t, D.MEM_TAG, f"Keeper’s coin found in level {n}")
d['lines'] = base + new
d['_about'] = ("Every voice-over line in Aqua Energizer. make_voices.bat reads this file. 'set' is base (already recorded) or story (the story script). "
               "Words in [brackets] are ElevenLabs audio tags: they set the delivery and are not spoken. Script by character: docs/voice-script.md.")
used = {l['role'] for l in d['lines']}
d['pick'] = {}; d['settings'] = {}; d['audition'] = {}; d['candidates'] = {}
for r, (pick, st, aud, cands) in D.ROLES.items():
    if r not in used: continue
    d['pick'][r] = pick; d['settings'][r] = st; d['audition'][r] = aud
    d['candidates'][r] = [dict({'name': nm, 'why': why}, **({'id': vid} if vid else {})) for nm, vid, why in cands]
missing = used - set(d['pick']); assert not missing, missing
json.dump(d, open(P, 'w'), ensure_ascii=False, indent=1); open(P, 'a').write('\n')
spoken = lambda l: len(re.sub(r'\[[^\]]*\]\s*', '', l['text']))
print('lines', len(d['lines']), 'story', len(new), 'chars(story, spoken)', sum(spoken(l) for l in new), 'chars incl tags', sum(len(l['text']) for l in new))

# ---- docs/voice-script.md: the script by character, for review before recording
ORDER = ['narrator', 'diver', 'pip', 'shelly', 'clack', 'grimtide', 'murk', 'lumen', 'mira', 'cousin', 'snip', 'snap', 'keeper']
DESC = {'narrator': 'The storyteller. Warm and magical, but can turn tense and grave: this is a story with real danger.',
 'diver': 'Spark, the hero. Young, brave, kind, a little cheeky. Cries once (chapter 25). Shouts in the big moments.',
 'pip': 'A tiny seahorse. Talks fast when nervous (often), jokes to hide fear, huge heart. Arc: scared sidekick → brave friend.',
 'shelly': 'A 200-year-old sea turtle. Slow, dry, grandmotherly, with a temper. Struck down in ch. 13, returns furious in ch. 25.',
 'clack': 'Captain of the Crack Crab Crew. Loud, pompous, secretly soft. Comic relief who dies a hero in ch. 24–25.',
 'grimtide': 'The villain: a giant eel who drinks light. Silky and amused at first, then hungry, then furious. Never shouts until he does.',
 'murk': 'A giant shy octopus, the Keeper’s best friend, forced to serve Grimtide. Deep, gentle, ashamed → resolute.',
 'lumen': 'An anglerfish showman. Big theatrical voice (“Ladies and gentlefish!”) over a scared heart.',
 'mira': 'A manta ray. Serene and wise, speaks slowly.', 'cousin': 'Pip’s little cousin. Squeaky, giggly, fast.',
 'snip': 'Grimtide’s piranha, the cackling one.', 'snap': 'Grimtide’s other piranha, the snarling, slower one.',
 'keeper': 'The Reef Keeper, heard only in memories (her coins) and her journal. Gentle, wise, a little funny. She gave all her light to save the reef.'}
out = ['# Aqua Energizer — the voice script, by character', '',
 'This is everything the story needs recorded, grouped by voice so each actor’s lines can be checked in one place. '
 'The spoken text is what players read on screen; the **[delivery]** is an ElevenLabs audio tag (not spoken). '
 'Lines already recorded (intro film, tutorial, diver quips) are not listed here and are skipped by the story-only mode of `make_voices.bat`.', '',
 '## How to record without wasting credits', '',
 '1. Run `make_voices.bat` → **1) Audition**, and type only the roles you want to hear (e.g. `grimtide,clack`). Each sample costs about 120–200 credits.',
 '2. Every role uses its recommended voice automatically (change one under "pick" in voices.json). Eleven v4 only, no fallback.', '3. Choose **5) Make the story lines only**. It shows how many characters (≈ credits) it will use and asks before it starts.',
 '4. If one line comes out wrong, fix its text in `tools/voices.json` and use **4) Redo one line**.', '',
 '## Totals', '', '| role | voice (recommended) | lines | characters |', '|---|---|---|---|']
tot_l = tot_c = 0
for r in ORDER:
    L = [l for l in new if l['role'] == r]
    if not L: continue
    c = sum(spoken(l) for l in L); tot_l += len(L); tot_c += c
    out.append(f"| {r} | {d['pick'][r]} | {len(L)} | {c:,} |")
out.append(f"| **all** | | **{tot_l}** | **{tot_c:,}** |")
tot_t = sum(len(l['text']) for l in new)
out += ['', f'ElevenLabs bills by characters, and the [delivery] tags count too: the whole story is **{tot_c:,} spoken characters, about {tot_t:,} credits with tags** '
        'on a full-price model (turbo/flash models cost about half). `make_voices.bat` prints the exact number and asks before it spends anything. Auditions are extra (≈ 150 credits per sample).', '']
for r in ORDER:
    L = [l for l in new if l['role'] == r]
    if not L: continue
    out += [f"## {r} — {d['pick'][r]}", '', DESC.get(r, ''), '', '| id | when | line |', '|---|---|---|']
    for l in L:
        txt = l['text'].replace('|', '\\|')
        who = f" *({l['who']})*" if l['role'] == 'narrator' and l['who'] != 'Narrator' else ''
        out.append(f"| `{l['id']}` | {l['when']} | {txt}{who} |")
    out.append('')
open(R + 'docs/voice-script.md', 'w').write('\n'.join(out) + '\n')

# ---- docs/story.md: the story bible
ARC = {'wonder': 'wonder', 'hope': 'hope ↑', 'dread': 'dread ↓', 'fun': 'fun ↑', 'discovery': 'discovery ↑', 'blunder': 'BLUNDER ↓↓', 'recovery': 'recovery ↑',
       'courage': 'courage ↑', 'menace': 'menace ↓', 'bittersweet': 'bittersweet', 'danger': 'danger ↓↓', 'sad': 'grief ↓↓', 'grief': 'GRIEF ↓↓↓', 'mystery': 'mystery',
       'resolve': 'resolve ↑', 'joy': 'joy ↑↑', 'rescue': 'rescue ↑↑', 'rally': 'rally ↑↑', 'showdown': 'showdown ↓', 'victory': 'REVENGE ↑↑↑'}
W = lambda w: D.SPEAKERS[w][0]
o = ['# Aqua Energizer: The Thirty Gates (story v4)', '',
 '## The story in one breath',
 'Grimtide, a giant eel who drinks light, once took the reef’s brightest pearls as tribute until the Reef Keeper built thirty gates and drove him into the abyss. '
 'On the storm night (the intro film) he came back, swallowed the reef’s light, and the Keeper gave all her own light to the Great Lantern to save it. '
 'A little diver with a lamp wakes the first gate. Pip names them **Spark**. Gate by gate a ragtag crew forms (a nervous seahorse, a 200-year-old turtle, a pompous crab captain, '
 'a showman anglerfish) while Grimtide fights back: he steals the Keeper’s map, strikes down Shelly, and snatches Pip; Captain Clack dies saving him. '
 'The mural reveals that Spark wears the Keeper’s own lamp. Freed by light given away, Murk the octopus turns on his master. Grimtide lets them light the Lantern because he plans '
 'to drink it full, but thirty gates of light, freely given, burn him down to a harmless worm.', '',
 '## The cast (voice roles in brackets)',
 '- **Spark** [diver] — the hero. Brave, kind, a bit cheeky. Wears the Reef Keeper’s lamp without knowing it (revealed ch. 23).',
 '- **Pip** [pip] — a tiny seahorse whose glow the storm blew out. Talks fast when nervous. Faint after the map is lost (8–9), captured (24–26), brave at the end.',
 '- **Shelly** [shelly] — a 200-year-old sea turtle. Tells the legend (3), shields everyone and falls (13–14), returns with “two hundred years of anger” (25).',
 '- **Captain Clack** [clack] — leader of the Crack Crab Crew, in a tricorn hat. Loud comic relief who leaps at Grimtide’s tail to save Pip (24) and dies a hero (25).',
 '- **Grimtide** [grimtide] — the villain. Silky, amused, cruel. Watches from beside the tanks from level 11, attacks inside levels, and gets the reef’s revenge (30).',
 '- **Murk** [murk] — a giant shy octopus, the Keeper’s best friend, chained to Grimtide’s service. Asks about Spark’s lamp (16), drops a secret pearl trail (18), freed (26).',
 '- **Lumen** [lumen] — the Deep’s showman anglerfish. **Mira** [mira] — a serene manta. **Pip’s cousins** [cousin]. **Snip & Snap** [snip, snap] — Grimtide’s piranhas.',
 '- **The Reef Keeper** [keeper] — heard in her journal (6) and in the 30 hidden gold coins (one per level): her memories tell her own story.', '',
 '## Ups and downs', '', '| ch | chapter | feel | interactive beat |', '|---|---|---|---|']
for n, c in enumerate(D.CH):
    if c: o.append(f"| {n} | {c['t']} | {ARC.get(c['mood'], c['mood'])} | {c['Q']['label'] + ' (' + c['Q']['kind'] + ')' if 'Q' in c else ''} |")
o += ['', '## How the story is told',
 '- **Films** (after each level): every line has its speaker on screen; the camera cuts to a close-up of whoever talks and they animate as they speak. '
 'Characters who aren’t part of a scene’s action ride along (Pip at Spark’s shoulder, Lumen glowing beside, Clack at the feet).',
 '- **Interactive beats** in eight films: tap fast, hold, or swipe. The film slows to 15% while you act; success and failure each have their own line, and the story continues either way.',
 '- **Inside the levels:** the level card line, a talk bubble when the level starts / the first pearl goes in / after 24 s / the gate opens, and attacks around the tank '
 '(the tank shakes, Grimtide’s tail sweeps over it, his eyes watch, ink drifts by, the lights flicker). Levels 11, 24 and 29 open with a short in-level cutscene '
 '(the world waits, letterbox, Grimtide stares in). Each beat plays once per session.',
 '- **When a dive fails**, someone reacts: Pip panics, Snip and Snap gloat, Grimtide mocks (from level 11).',
 '- **Collecting:** the hidden gold coin in each level is the Keeper’s; it plays her memory and the journal keeps them all.', '',
 '## Chapters', '']
for n, c in enumerate(D.CH):
    if not c: continue
    o.append(f"### Level {n}: {D.LEVEL_STORY[n]}")
    for b in D.BEATS[n]:
        o.append(f"- {ON[b['on']]}{' · ' + b['fx'] if b.get('fx') else ''}{' · cutscene' if b.get('cut') else ''} (`l{n}_{b['on']}`): " + (f"**{W(b['who'])}:** " if b['who'] else '') + b['text'])
    if D.MEM[n]: o.append(f"- Keeper’s coin (`m{n}`): “{D.MEM[n]}”")
    o.append(''); o.append(f"**Chapter {n} · {c['t']}** (film `{c['r']}`, arrival `{c['a']}`, {ARC.get(c['mood'], c['mood'])})"); o.append('')
    seq = list(enumerate(c['L']))
    q = c.get('Q')
    for i, (w, t, g) in seq:
        if q and i == q['at']:
            o.append(f"- ▶ **{q['label']}** ({q['kind']}) — in time: " + ' / '.join((f"**{W(w2)}:** " if w2 else '') + t2 for w2, t2, _ in q['ok']) + ' — missed: ' + ' / '.join((f"**{W(w2)}:** " if w2 else '') + t2 for w2, t2, _ in q['no']))
        o.append(f"- `s{n}_{i+1}` " + (f"**{W(w)}:** {t}" if w else f"*{t}*"))
    o.append('')
o += ['## When a dive fails', '']
for cause, L in D.DEATH.items():
    o.append(f"- **{cause}:** " + ' · '.join(f"{W(w) or 'Narrator'} (levels {lo}–{hi}): {t}" for w, t, _, lo, hi in L))
o += ['', '---', 'Source of every line: the story data (CHAPTERS / STORY_WHO / RECIPES in the World section of src/game.js; LEVEL_STORY / LEVEL_BEATS / LEVEL_MOOD / DEATH_LINES / MEM_LINES before startLevel). '
      'This file, tools/voices.json and docs/voice-script.md are generated together from one script so they never drift apart.']
open(R + 'docs/story.md', 'w').write('\n'.join(o) + '\n')
