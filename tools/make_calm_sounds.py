#!/usr/bin/env python3
"""Calm sound palette (owner: "very soothing, calm, clean"). Synthesised here, no source files needed:
  * reward / UI cues as soft mallet notes (marimba / kalimba-like: a sine with a few quickly fading upper partials, gentle attack)
    in C major pentatonic, so any two cues that overlap still sound consonant;
  * a lush, dark underwater reverb on every cue; everything low-passed so nothing is sharp or bright;
  * the underwater ambience loop (src/assets/music/ambience.mp3): deep water rumble, slow swells, distant bubble streams.
Replaces the brighter UI-pack cues written by make_sounds.py (dig/push/land/roll/swim/bubble recordings are kept, land is softened).

Usage: python3 tools/make_calm_sounds.py
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sounds import SR, SFX, MUS, save, lp, hp, bp, norm, fade, pad, mix, bubble, load  # shared helpers
from scipy.signal import fftconvolve

rng = np.random.default_rng(11)
C4 = 261.63
def hz(semi, base=C4): return base * 2 ** (semi / 12)
# C major pentatonic degrees (semitones above C4)
P = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]

# a long, dark, smooth hall: the "inside a big calm sea" tail for the chimes
_t = np.arange(int(2.6 * SR)) / SR
HALL = (rng.standard_normal((len(_t), 2)) * np.exp(-_t * 2.3)[:, None]).astype(np.float32)
HALL = lp(HALL, 2600); HALL[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]; HALL /= np.sqrt((HALL ** 2).sum(0))
def hall(x, wet=0.3, cut=4200):
    """mono dry cue -> mono (summed) cue with a soft stereo hall folded back in; low-passed so it never gets bright"""
    d = lp(x, cut); w = np.stack([fftconvolve(d, HALL[:, c])[: len(d) + int(1.6 * SR)] for c in (0, 1)], 1).mean(1).astype(np.float32)
    return fade(pad(d, len(w)) * (1 - wet) + w * wet * 1.6, 0, 0.4)

def mallet(f, dur=1.6, amp=1.0, bright=0.22, decay=2.6, attack=0.006):
    """soft mallet note: fundamental + a quiet 2nd and 4th partial (kalimba/marimba colour) that die away fast; slightly detuned twin"""
    t = np.arange(int(dur * SR)) / SR; env = (1 - np.exp(-t / attack))
    x = np.zeros_like(t)
    for k, a, dk in ((1, 1.0, 1.0), (2, bright, 2.4), (4, bright * 0.25, 4.5)):
        for det in (1.0, 1.0016): x += a * np.sin(2 * np.pi * f * k * det * t) * np.exp(-t * decay * dk) * 0.5
    return (x * env * amp).astype(np.float32)

def pad_tone(fs, dur=2.6, amp=1.0, attack=0.45, release=1.6):
    """warm sine pad chord with a slow swell (no shimmer)"""
    t = np.arange(int(dur * SR)) / SR; env = np.minimum(1, t / attack) * np.where(t > dur - release, (dur - t) / release, 1) ** 2
    x = sum(np.sin(2 * np.pi * f * t + i) + 0.12 * np.sin(4 * np.pi * f * t) for i, f in enumerate(fs)) / len(fs)
    return (lp(x * env, 1800) * amp).astype(np.float32)

def soft_bubbles(n, span, rmin=1.4, rmax=3.2, amp=0.2):
    parts = []
    for i in range(n):
        r = rmin * (rmax / rmin) ** rng.random(); parts.append((bubble(r, amp=amp * (0.4 + 0.6 * rng.random()), rise=0.3), span * rng.random() ** 1.3, 1))
    return lp(mix(*parts), 2600)

def whoosh(dur, f0, f1, amp=0.3):
    """filtered noise sweeping gently (water moving), no hiss: band kept low"""
    n = int(dur * SR); x = rng.standard_normal(n).astype(np.float32); out = np.zeros(n, np.float32); blk = 2048
    for i in range(0, n, blk):
        k = i / n; c = f0 * (f1 / f0) ** k; out[i:i + blk] = bp(x[max(0, i - 4096):i + blk], max(60, c * 0.6), c * 1.4)[-len(x[i:i + blk]):]
    env = np.sin(np.linspace(0, np.pi, n)) ** 1.5
    return (out * env * amp).astype(np.float32)

def main():
    out = {}
    def put(name, x, peak=0.7): out[name] = save(name, norm(x, peak))
    # level clear: a gently rolled C-major-pentatonic arpeggio of soft mallets over a warm low pad, a few far bubbles. Calm, not a fanfare.
    arp = mix(*[(mallet(hz(s), 2.2, 0.9 - i * 0.08, bright=0.18), i * 0.16, 1) for i, s in enumerate([12, 16, 19, 24])])
    put('win', hall(mix((arp, 0, 1), (pad_tone([hz(0), hz(7), hz(16)], 3.2, 0.55), 0.05, 1), (soft_bubbles(10, 1.6, amp=0.12), 0.2, 1)), 0.34), 0.68)
    # star (pitched per star in the game, pentatonic steps): one soft kalimba note
    put('star', hall(mallet(hz(19), 1.0, 1.0, bright=0.2, decay=4.2), 0.14), 0.62)
    # pearl delivered (pitched per pearl): a warm marimba "plop" with a bubble
    put('pearl', hall(mix((mallet(hz(16), 1.0, 1.0, bright=0.14, decay=4.4), 0, 1), (soft_bubbles(3, 0.15, amp=0.12), 0.02, 1)), 0.14), 0.62)
    # pearl absorbed into the gate: water drawn in (a soft low whoosh) and a low bell
    put('absorb', hall(mix((whoosh(0.7, 900, 260, 0.35), 0, 1), (mallet(hz(7), 1.8, 0.8, bright=0.12, decay=2.2), 0.28, 1), (soft_bubbles(6, 0.5, amp=0.12), 0.1, 1)), 0.32), 0.66)
    # the gate wakes: a slow warm swell chord, a soft rising pair of notes, bubbles
    put('gateOpen', hall(mix((pad_tone([hz(0), hz(4), hz(7), hz(14)], 3.0, 0.8, attack=0.8), 0, 1), (mallet(hz(16), 2.0, 0.55, bright=0.14), 0.6, 1), (mallet(hz(21), 2.0, 0.45, bright=0.14), 0.85, 1), (soft_bubbles(12, 1.4, amp=0.12), 0.2, 1)), 0.36), 0.7)
    # swim into a closed gate: a muted wooden double "tok", low
    put('gateLocked', hall(mix((mallet(hz(-5), 0.5, 1.0, bright=0.05, decay=9), 0, 1), (mallet(hz(-8), 0.5, 0.8, bright=0.05, decay=9), 0.12, 1)), 0.08, 2200), 0.5)
    # lose: three soft falling notes (not a buzzer, not a cartoon), with bubbles drifting up
    put('death', hall(mix((mallet(hz(7), 1.2, 0.8, bright=0.1, decay=3), 0, 1), (mallet(hz(4), 1.2, 0.7, bright=0.1, decay=3), 0.22, 1), (mallet(hz(0), 1.8, 0.7, bright=0.1, decay=2.4), 0.44, 1), (soft_bubbles(9, 1.0, amp=0.14), 0.05, 1)), 0.3, 2800), 0.66)
    # a stone lands on a monster: a soft round "pop" of bubbles and a muffled low tok
    put('monsterDeath', hall(mix((soft_bubbles(14, 0.35, 1.2, 3.0, 0.3), 0, 1), (mallet(hz(-12), 0.6, 0.8, bright=0.04, decay=7), 0, 1), (mallet(hz(12), 0.9, 0.35, bright=0.1, decay=4), 0.08, 1)), 0.22, 2600), 0.6)
    # piranha snap: a short muted pluck, low
    put('bite', hall(mallet(hz(-3), 0.35, 1.0, bright=0.08, decay=12), 0.06, 2000), 0.5)
    # low air (repeats): a very soft low double pulse, like a heartbeat under water
    put('lowAir', hall(mix((pad_tone([hz(-12)], 0.32, 1.0, attack=0.03, release=0.25), 0, 1), (pad_tone([hz(-12)], 0.32, 0.7, attack=0.03, release=0.25), 0.26, 1)), 0.15, 900), 0.45)
    # UI: a single clean water drop
    tk = np.arange(int(0.09 * SR)) / SR  # UI: a soft, tactile tick (a short rounded wood/glass tap), not a long chime
    tick = (np.sin(2 * np.pi * 1150 * tk) * np.exp(-tk * 90) * 0.55 + np.sin(2 * np.pi * 320 * tk) * np.exp(-tk * 55)) * (1 - np.exp(-tk * 4000))
    put('click', hall(lp(tick.astype(np.float32), 3200), 0.05, 3400), 0.42)
    # hint: two soft rising notes; undo: a short reversed swirl + a soft falling note
    put('hint', hall(mix((mallet(hz(12), 0.8, 0.8, bright=0.15, decay=4.5), 0, 1), (mallet(hz(19), 0.9, 0.7, bright=0.15, decay=4.0), 0.11, 1)), 0.14), 0.55)
    put('undo', hall(mix((whoosh(0.26, 300, 900, 0.22), 0, 1), (mallet(hz(7), 0.7, 0.7, bright=0.1, decay=5), 0.15, 1)), 0.1), 0.5)
    # treasure dug out: a tiny soft twinkle (two high mallet notes, low-passed so it doesn't sting)
    for i, s in enumerate([(19, 24), (21, 26), (16, 21)]):
        put('treasure' + ('' if i == 0 else f'_{i + 1}'), hall(mix((mallet(hz(s[0]), 0.9, 0.6, bright=0.1, decay=4.5), 0, 1), (mallet(hz(s[1]), 0.9, 0.45, bright=0.1, decay=4.5), 0.07, 1)), 0.12, 3600), 0.5)
    # air capsule: a soft burst of bubbles and a warm chord
    put('air', hall(mix((soft_bubbles(22, 0.45, 1.4, 4.5, 0.3), 0, 1), (mallet(hz(12), 1.4, 0.5, bright=0.12), 0.06, 1), (mallet(hz(16), 1.4, 0.45, bright=0.12), 0.1, 1), (mallet(hz(19), 1.4, 0.4, bright=0.12), 0.14, 1)), 0.3), 0.66)
    # bump into a wall: barely there
    put('bump', hall(mallet(hz(-10), 0.25, 1.0, bright=0.02, decay=16), 0.05, 1200), 0.32)
    # land: the recorded impact is kept but rounded off (it had a hard crack): re-made from the existing file, darker and softer
    for i, nm in enumerate(('land', 'land_2')):  # a stone settling in sand: a deep rounded thud, a soft sand puff, a few bubbles kicked up
        th = np.arange(int(0.5 * SR)) / SR; thud = np.sin(2 * np.pi * (70 - 25 * th) * th) * np.exp(-th * 11) * (1 - np.exp(-th * 900))
        puff = lp(hp(rng.standard_normal(len(th)).astype(np.float32), 200), 900) * np.exp(-th * 9) * 0.25
        put(nm, hall(mix((thud.astype(np.float32), 0, 1), (puff, 0.005, 1), (soft_bubbles(5, 0.3, 1.6, 3.5, 0.18), 0.03, 1)), 0.14, 1200), 0.62)

    # ---- the water ambience: 32 s seamless stereo loop (decoded it is ~11 MB of memory, so not longer)
    L = 36; n = L * SR; t = np.arange(n) / SR; amb = np.zeros((n, 2), np.float32)
    def brown(n):
        w = rng.standard_normal(n).astype(np.float32); b = np.cumsum(w); b -= np.convolve(b, np.ones(4096) / 4096, 'same'); return b / (np.abs(b).max() + 1e-9)
    for c in range(2):
        rumble = lp(brown(n), 160) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.06 * t + c))                      # deep water body
        swell = bp(rng.standard_normal(n).astype(np.float32), 180, 620) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.045 * t + c * 1.7)) ** 2.2  # slow waves far above
        wash = bp(rng.standard_normal(n).astype(np.float32), 420, 1300) * (0.35 + 0.65 * np.sin(2 * np.pi * 0.032 * t + c * 2.3 + 0.7) ** 2) ** 2  # moving water, soft (audible on phone speakers)
        amb[:, c] = rumble * 0.3 + swell * 0.17 + wash * 0.05
    for k in range(int(L / 3.5)):                                                                          # distant bubble streams, panned
        at = rng.uniform(0, L - 3); pan = rng.uniform(-0.8, 0.8); s = soft_bubbles(int(rng.integers(5, 14)), rng.uniform(0.8, 2.2), 1.0, 2.6, amp=0.09)
        i = int(at * SR); amb[i:i + len(s), 0] += s * (1 - pan) * 0.5; amb[i:i + len(s), 1] += s * (1 + pan) * 0.5
    for k in range(int(L * 1.2)):                                                                          # very sparse tiny fizz
        at = rng.uniform(0, L - 1); s = lp(bubble(rng.uniform(0.6, 1.0), amp=0.012, rise=0.5), 3000); i = int(at * SR); c = int(rng.integers(0, 2)); amb[i:i + len(s), c] += s
    xf = 4 * SR; body = amb[: n - xf].copy(); w = np.sqrt(np.linspace(0, 1, xf))[:, None]
    body[:xf] = body[:xf] * w + amb[n - xf:] * np.sqrt(1 - w ** 2)                                         # seamless loop
    body = body / np.abs(body).max() * 0.62
    out['music/ambience'] = save('ambience', body, folder=MUS, kbps=64, stereo=True)
    tot = sum(out.values()); print(f'{len(out)} files, {tot // 1024} KB'); [print(f'  {k:16s} {v // 1024:4d} KB') for k, v in out.items()]

if __name__ == '__main__': main()
