"""Single source for the narrator script: builds NARRATOR_SCRIPT.md rows, the ElevenLabs block and the SRT,
and checks every block fits its time window (max ~3.8 syllables per second)."""
import re, sys

# (start_s, end_s, scene/visual, tags, text)
B = [
 (1.0, 6.3,  "Optional intro: caterpillar in grass, Ziggy rises, Benny with tablet", "[warm, storytelling]",
  "One sunny morning, bright and new, Ziggy, Kisha… and Benny too!"),
 (7.3, 9.7,  "Benny on his tablet game", "[playful]",
  "Benny scored five stars — hooray!"),
 (10.9, 13.2, "Kisha photographs the caterpillar (snapshot ~0:12)", "[gentle]",
  "Kisha snapped a bug at play."),
 (13.2, 17.6, "Benny asks about the cake stall, Ziggy smiles", "[light, amused]",
  "\"Are we there yet?\" Benny asked. Ziggy grinned, \"Not long!\""),
 (18.0, 24.8, "Benny grumbles, Kisha waves bye to the bug, Ziggy praises her", "[cheerful]",
  "Benny huffed and puffed along… Kisha waved bye, and Ziggy cheered her on!"),
 (25.1, 29.4, "Market crowd greets Ziggy", "[excited]",
  "At the market, kids all cheered, \"Hello, Ziggy! Hooray!\""),
 (29.6, 31.8, "Benny walks right past Cake Delights, eyes on the screen", "[teasing]",
  "Past the cakes, Benny scrolled away!"),
 (32.5, 36.5, "Kisha looks at the market, raises her camera", "[amazed, then cheerful]",
  "Kisha gasped, \"What a sight! Everybody, smile!\""),
 (37.0, 39.3, "Group snapshot pops up (0:36.5), Ziggy and kids", "[happy]",
  "Click! A perfect memory."),
 (43.5, 46.5, "Benny walks into the puddle", "[building, then surprised]",
  "Eyes on his screen… SPLASH! A puddle!"),
 (47.7, 50.6, "Benny stands in the puddle", "[sympathetic, playful]",
  "Poor Benny grumbled, soaked and blue."),
 (53.1, 56.2, "Kisha snaps Benny in the puddle (snapshot 0:54)", "[giggling]",
  "Kisha laughed — click! — \"I thought you knew!\""),
 (62.3, 64.5, "Birds on Ziggy's head, Kisha photographs (snapshot 1:05)", "[delighted]",
  "Tweet! Birds on Ziggy — click, click!"),
 (66.0, 72.2, "Benny on the bench wants a high view of the market", "[wistful, then light]",
  "Benny wished for a view up high… then shrugged, \"Never mind,\" and scrolled on by."),
 (74.9, 81.7, "Ziggy towers above with a bird on his head", "[proud, warm]",
  "But tall Ziggy had the best view in town, with a birdie on top, looking all the way down!"),
 (82.8, 85.1, "Clouds roll in", "[dramatic]",
  "Pitter-patter… down came the rain!"),
 (95.5, 100.1, "Kisha spots the rainbow (snapshot 1:41)", "[wonder]",
  "A rainbow! Kisha's camera clicked again!"),
 (103.2, 110.2, "Benny peeks up, Ziggy says let's go", "[upbeat]",
  "\"Has it stopped?\" Benny peeked, then back to his screen. \"Let's go!\" smiled Ziggy, and off went the team!"),
 (111.3, 116.7, "Kids wave at Ziggy, Kisha photographs", "[cheerful]",
  "Kids waved, \"Hi, Ziggy!\" He waved hello, and Kisha snapped them in a row."),
 (117.7, 122.4, "Benny asks Ziggy about the day", "[warm]",
  "\"Good day so far?\" Benny asked. \"The best!\" Ziggy beamed."),
 (123.2, 128.6, "Evening: Kisha's photo album, Ziggy looks in", "[soft, glowing]",
  "That night, Kisha's album shone so bright… the whole day lived in every sight!"),
 (129.3, 134.9, "Benny's tablet dies", "[gentle humour]",
  "Then Benny's tablet went dark — battery dead! \"Even screens get tired,\" Kisha said."),
 (135.1, 139.5, "Benny stares at the photos", "[astonished, quiet]",
  "He stared at the photos: \"Did all that happen today?\""),
 (139.7, 144.0, "Benny realises what he missed", "[tender, reflective]",
  "He'd held his screen all day… and missed it all along the way."),
 (144.2, 148.5, "Benny wonders about tomorrow, Ziggy smiles", "[hopeful]",
  "\"Tomorrow?\" Ziggy winked. \"Something worth a snap!\""),
 (149.0, 154.5, "Captain Cyber Champ speaks to camera", "[friendly, to the viewer]",
  "Now Captain Cyber Champ asks you: what zoomed by that you nearly missed too?"),
 (156.0, 159.3, "Captain Cyber Champ gestures", "[encouraging]",
  "Put it down, look up — the good stuff's right there to see."),
 (159.5, 162.4, "Captain Cyber Champ's big finish, then The End", "[heroic, uplifting]",
  "Cyber Champions… that's you and me!"),
]

def syl(word):
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w: return 0
    n = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and not w.endswith(("le", "ee")) and n > 1: n -= 1
    elif w.endswith("ed") and not w.endswith(("ted", "ded")) and n > 1: n -= 1
    elif w.endswith("es") and not w.endswith(("ses", "zes", "ces", "ges", "shes", "ches")) and n > 1: n -= 1
    return max(1, n)

def count(t): return sum(syl(x) for x in t.split())
def ts(t): return f"{int(t//60)}:{t%60:04.1f}"
def srt(t): return f"{int(t//3600):02}:{int(t%3600//60):02}:{int(t%60):02},{int(round(t%1*1000)):03}"

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    bad = 0
    for i, (s, e, scene, tags, text) in enumerate(B):
        d = e - s; c = count(text); rate = c / d
        if mode == "check":
            flag = "  <-- TOO FAST" if rate > 3.8 else ""
            bad += bool(flag)
            print(f"{i:2} {ts(s):>7} {d:4.1f}s {c:3} syl {rate:4.1f}/s {text}{flag}")
        elif mode == "md":
            print(f"| {i} | {ts(s)} | {ts(e)} | {d:.1f} s | {scene} | **{text}** |")
        elif mode == "eleven":
            print(f"[{i} | start {ts(s)} | max {d:.1f}s] {tags} {text}\n")
        elif mode == "srt":
            print(f"{i+1}\n{srt(s)} --> {srt(e)}\n{text}\n")
    for a, b in zip(B, B[1:]):
        if a[1] > b[0]: print("OVERLAP", a[4], "|", b[4]); bad += 1
    if mode == "check": print("problems:", bad)
