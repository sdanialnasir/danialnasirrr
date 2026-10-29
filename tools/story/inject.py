# re-inject CHAPTERS + PROLOGUE into src/game.js from tools/story/story_v6.py with each line's mood: [who, text, emote, mood].  Run: python3 tools/story/inject.py
import json, re, sys
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import story_v6 as D
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'game.js'); s = open(p).read()
J = lambda v: json.dumps(v, ensure_ascii=False)
MOODS = [('sad', 'sad crying tearful teary grief grieving sniffling weak ashamed heartbroken breaking whispered fading hushed'),
         ('wide', 'scared terrified panicking nervous horrified stunned shocked startled screaming frightened trembling shaken'),
         ('angry', 'angry roaring furious defiant fierce snarling menacing sneering hissing cold gruff grumbling offended'),
         ('happy', 'excited giggling laughing joy overjoyed delighted proud playful warm cheeky grand triumphant giddy theatrical booming flattering smiling')]
EMO = {'droop': 'sad', 'laugh': 'happy', 'hop': 'happy', 'spin': 'happy', 'salute': 'happy', 'shake': 'wide', 'nod': ''}
def mood(tag, em):
    if em in EMO and EMO[em]: return EMO[em]
    w = set(re.findall(r'[a-z]+', (tag or '').lower()))
    for m, words in MOODS:
        if w & set(words.split()): return m
    return ''
def L2(L):
    out = []
    for l in L:
        em = l[3] if len(l) > 3 and l[3] else ''; md = mood(l[2], em); e = [l[0], l[1]]
        if em or md: e.append(em)
        if md: e.append(md)
        out.append(e)
    return out
def ent(c):
    e = {'t': c['t'], 'r': c['r'], 'a': c['a']}
    if 'w' in c: e['w'] = c['w']
    e['L'] = L2(c['L'])
    if 'Q' in c:
        q = dict(c['Q'])
        if q['kind'] == 'choice': q['opts'] = [[k, lab, L2(ls)] for (k, lab, ls) in q['opts']]
        else: q['ok'] = L2(q['ok']); q['no'] = L2(q['no'])
        e['Q'] = q
    return J(e)
a = s.index('const CHAPTERS = ['); b = s.index('\n  const STORY_WHO = ', a)
s = s[:a] + 'const CHAPTERS = [' + ',\n    '.join(['null'] + [ent(c) for c in D.CH[1:]]) + '];\n  const PROLOGUE = ' + ent(D.CH[0]) + ';' + s[b:]
open(p, 'w').write(s)
n = sum(1 for c in D.CH if c for l in c['L'] if mood(l[2], l[3] if len(l) > 3 else '')); t = sum(len(c['L']) for c in D.CH if c)
print('lines with a mood', n, 'of', t)
