#!/usr/bin/env python3
"""Build the game's real sound set: src/assets/sfx/*.mp3 and src/assets/music/*.mp3 (embedded by build_assets.py).

Sources (all free for commercial use; credits also in docs/audio-credits.md and the in-game Credits):
  * Kenney (kenney.nl) starter kits, CC0 sounds: git clone https://github.com/KenneyNL/Starter-Kit-{3D-Platformer,FPS,City-Builder,Match-3,Racing}
  * uiSFX (uisfx.com) 0.4.0, audio CC0: npm pack uisfx@0.4.0  (packs 'dreamy' and 'soft')
  * Music, CC BY 4.0: "Chill Wave" Kevin MacLeod (incompetech.com); "Meadow" and "Soundscape Dark" Gravity Sound
  * Bubbles: physically modelled (Minnaert resonance: each bubble rings as a decaying sine whose pitch rises as it nears the
    surface), the standard way bubble sounds are synthesised; mixed with the recordings for the underwater layers.

Usage: python3 tools/make_sounds.py <sources dir>   (expects kenney/, uisfx/package/, music/ inside it)
"""
import os, subprocess, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(ROOT, 'src', 'assets', 'sfx'); MUS = os.path.join(ROOT, 'src', 'assets', 'music')
rng = np.random.default_rng(7)
try:
    import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FF = 'ffmpeg'

def load(path, stereo=False):
    ch = 2 if stereo else 1
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    return x.reshape(-1, 2) if stereo else x

def save(name, x, folder=SFX, kbps=96, stereo=False):
    os.makedirs(folder, exist_ok=True); x = np.asarray(x, np.float32)
    pk = np.abs(x).max() or 1; x = x / pk * 0.89 if pk > 0.89 else x  # never clip
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    out = os.path.join(folder, name + '.mp3')
    subprocess.run([FF, '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2' if stereo else '1', '-i', '-', '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', out], input=pcm, check=True)
    return os.path.getsize(out)

def lp(x, hz, order=4): return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x, axis=0)
def hp(x, hz, order=2): return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x, axis=0)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x, axis=0)
def rate(x, r):  # resample = pitch + speed (like a slower, heavier recording)
    n = int(len(x) / r); return np.interp(np.arange(n) * r, np.arange(len(x)), x).astype(np.float32)
def norm(x, peak=0.8): m = np.abs(x).max(); return x / m * peak if m > 0 else x
def trim(x, thr=0.004):
    idx = np.where(np.abs(x) > thr)[0]
    return x[max(0, idx[0] - 64): idx[-1] + 2048] if len(idx) else x
def fade(x, a=0.002, b=0.04):
    x = x.copy(); na, nb = int(a * SR), int(b * SR)
    if na: x[:na] *= np.linspace(0, 1, na)
    if nb: x[-nb:] *= np.linspace(1, 0, nb) ** 2
    return x
def pad(x, n): return np.concatenate([x, np.zeros(max(0, n - len(x)), np.float32)])
def mix(*parts):  # (signal, offset_s, gain)
    n = max(int(o * SR) + len(s) for s, o, g in parts); out = np.zeros(n, np.float32)
    for s, o, g in parts: i = int(o * SR); out[i:i + len(s)] += s * g
    return out

# small underwater room: short dark reverb tail so dry recordings sit in water
_ir_t = np.arange(int(0.9 * SR)) / SR
IR = (rng.standard_normal(len(_ir_t)) * np.exp(-_ir_t * 6.5)).astype(np.float32); IR = lp(IR, 1800); IR /= np.sqrt((IR ** 2).sum())
def water(x, cut=2400, wet=0.18):
    d = lp(x, cut); w = fftconvolve(d, IR)[:len(d) + int(0.5 * SR)].astype(np.float32)
    return fade(pad(d, len(w)) * (1 - wet) + w * wet, 0, 0.12)

def bubble(r_mm, dur=None, amp=1.0, rise=0.35):
    """One bubble (Minnaert): f0 = 3.26 / r ; damped sine, pitch rising as it detaches/rises."""
    r = r_mm / 1000; f0 = 3.26 / r; damp = 0.043 * f0 + 0.0014 * f0 ** 1.5  # radiation + thermal damping (van den Doel)
    dur = dur or min(0.35, 6.0 / damp); t = np.arange(int(dur * SR)) / SR
    f = f0 * (1 + rise * t * damp / 3); ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.exp(-damp * t) * (1 - np.exp(-t * 3000))
    return (np.sin(ph) * env * amp).astype(np.float32)

def bubbles(n, span, rmin, rmax, amp=1.0, rise=0.35):
    parts = []
    for i in range(n):
        r = rmin * (rmax / rmin) ** rng.random(); parts.append((bubble(r, amp=amp * (0.4 + 0.6 * rng.random()) * (r / rmax) ** 0.3, rise=rise), span * rng.random() ** 1.4, 1))
    return mix(*parts)

def onsets(x, thr=0.25, gap=0.12):
    env = np.convolve(np.abs(x), np.ones(256) / 256, 'same'); pk = env.max(); hits = []; last = -1e9
    for i in np.where(env > thr * pk)[0]:
        if i - last > gap * SR: hits.append(i)
        last = i
    return hits

def main(src):
    K = os.path.join(src, 'kenney'); U = os.path.join(src, 'uisfx', 'package', 'sounds'); M = os.path.join(src, 'music')
    k = lambda kit, f: load(os.path.join(K, f'Starter-Kit-{kit}', 'sounds' if kit != 'Racing' else 'audio', f + '.ogg'))
    u = lambda pack, cue: load(os.path.join(U, pack, cue + '.mp3'))
    out = {}
    def put(name, x, **kw): out[name] = save(name, x, **kw)

    # dig: real footsteps on loose ground (Kenney), muffled, with a few fine sand grains/bubbles. Soft: it plays on every dig.
    steps = k('FPS', 'walking'); hits = onsets(steps)
    for i, h in enumerate(hits[:4]):
        s = fade(steps[max(0, h - 200): h + int(0.22 * SR)], 0.003, 0.08)
        grains = hp(rng.standard_normal(int(0.18 * SR)).astype(np.float32), 1200) * np.exp(-np.arange(int(0.18 * SR)) / SR * 18) * 0.05
        x = mix((norm(rate(s, 0.82 + 0.06 * i)), 0, 0.9), (lp(grains, 3500), 0.01, 1), (bubbles(2, 0.12, 1.2, 2.0, 0.12), 0.05, 1))
        put('dig' + ('' if i == 0 else f'_{i + 1}'), norm(water(x, 2600, 0.12), 0.55))
    # push: a heavy stone scraped over sand (placement thumps, slowed and darkened) + a grain hiss
    for i, f in enumerate(['placement-c', 'placement-a', 'placement-d']):
        s = norm(rate(k('City-Builder', f), 0.72)); hiss = lp(hp(rng.standard_normal(int(0.25 * SR)).astype(np.float32), 400), 2500) * np.exp(-np.arange(int(0.25 * SR)) / SR * 10) * 0.12
        put('push' + ('' if i == 0 else f'_{i + 1}'), norm(water(mix((s, 0, 1), (hiss, 0.02, 1)), 2000, 0.2), 0.7))
    # land: a stone/pearl hits the sand: a deep real impact, slowed, sand puff, a burst of bubbles kicked up
    imp = k('Racing', 'impact')
    for i, r in enumerate([0.62, 0.7]):
        s = norm(lp(rate(imp, r), 1400)); puff = lp(hp(rng.standard_normal(int(0.4 * SR)).astype(np.float32), 300), 1800) * np.exp(-np.arange(int(0.4 * SR)) / SR * 9) * 0.25
        put('land' + ('' if i == 0 else f'_{i + 1}'), norm(water(mix((s, 0, 1), (puff, 0.01, 1), (bubbles(7, 0.35, 1.5, 4.0, 0.22), 0.04, 1)), 2200, 0.25), 0.85))
    # roll: the slower tile swap, very muffled
    put('roll', norm(water(rate(k('Match-3', 'tile-swap'), 0.6), 1500, 0.3), 0.45))
    put('bump', norm(water(rate(k('City-Builder', 'placement-a'), 0.8), 1600, 0.2), 0.35))
    # bubbles / swim
    for i in range(3): put('bubble' + ('' if i == 0 else f'_{i + 1}'), norm(fade(bubbles(1 + i, 0.08, 2.0, 3.5, 1.0)), 0.5))
    for i in range(3):
        swirl = bp(rng.standard_normal(int(0.35 * SR)).astype(np.float32), 250, 900) * np.sin(np.linspace(0, np.pi, int(0.35 * SR))) * 0.12
        put('swim' + ('' if i == 0 else f'_{i + 1}'), norm(fade(mix((swirl, 0, 1), (bubbles(3 + i, 0.25, 1.8, 3.2, 0.5), 0.03, 1))), 0.4))
    # air capsule: a big bubble burst + a bright reward chime
    put('air', norm(water(mix((bubbles(26, 0.5, 1.5, 5.0, 0.6), 0, 1), (u('dreamy', 'bonus'), 0.05, 0.9)), 9000, 0.15), 0.85))
    # treasure: a real coin pickup, airy
    coin = k('3D-Platformer', 'coin')
    for i, r in enumerate([1.0, 1.06, 0.94]): put('treasure' + ('' if i == 0 else f'_{i + 1}'), norm(water(rate(coin, r), 9000, 0.22), 0.6))
    # pearl delivered / gate / win / lose: designed reward cues (uiSFX 'dreamy'), with bubbles in the water
    put('absorb', norm(water(mix((u('dreamy', 'achievement'), 0, 1), (bubbles(12, 0.6, 1.2, 3.0, 0.25), 0.05, 1)), 12000, 0.2), 0.85))
    put('gateOpen', norm(water(mix((u('dreamy', 'unlock'), 0, 1), (u('dreamy', 'success'), 0.35, 0.9), (bubbles(20, 1.2, 1.0, 4.0, 0.25), 0.1, 1)), 12000, 0.25), 0.9))
    put('gateLocked', norm(water(u('soft', 'blocked'), 6000, 0.15), 0.6))
    put('win', norm(water(mix((u('dreamy', 'level-up'), 0, 1), (u('dreamy', 'complete'), 0.45, 0.8), (bubbles(30, 1.6, 1.0, 4.5, 0.25), 0.2, 1)), 12000, 0.25), 0.9))
    # death: a soft, cartoony bloop-down (descending bubbles) over a muffled impact
    down = mix(*[(bubble(1.5 + i * 0.9, amp=0.8 - i * 0.08, rise=-0.25), i * 0.11, 1) for i in range(6)])
    put('death', norm(water(mix((down, 0, 1), (norm(lp(rate(k('FPS', 'enemy_destroy'), 0.6), 900)), 0, 0.35)), 2500, 0.3), 0.8))
    put('monsterDeath', norm(water(mix((norm(rate(k('City-Builder', 'placement-b'), 1.1)), 0, 1), (bubbles(14, 0.4, 1.2, 3.5, 0.5), 0.03, 1)), 4000, 0.2), 0.8))
    put('bite', norm(water(rate(k('FPS', 'enemy_attack'), 1.1), 3200, 0.15), 0.6))
    put('lowAir', norm(water(u('soft', 'warning'), 5000, 0.1), 0.45))
    put('click', norm(u('soft', 'press'), 0.45))
    put('pearl', norm(water(u('dreamy', 'progress-step'), 12000, 0.2), 0.75))  # pitched up per pearl in the game
    put('star', norm(water(u('dreamy', 'select'), 12000, 0.2), 0.7))  # pitched up per star
    put('hint', norm(u('dreamy', 'info'), 0.55))
    put('undo', norm(water(u('soft', 'undo'), 8000, 0.1), 0.5))

    # music: CC BY 4.0 tracks, trimmed to a loop with an equal-power crossfade so they repeat seamlessly
    def loop(path, start, length, xf=4.0):
        x = load(path, stereo=True); a, n, f = int(start * SR), int(length * SR), int(xf * SR)
        body = x[a:a + n].copy(); tail = x[a + n:a + n + f]; w = np.sqrt(np.linspace(0, 1, f))[:, None]
        body[:f] = body[:f] * w + tail * np.sqrt(1 - w ** 2); return body
    put_m = lambda name, x: out.__setitem__('music/' + name, save(name, x, folder=MUS, kbps=64, stereo=True))
    put_m('menu', loop(os.path.join(M, 'Kevin Macleod - Chill Wave.ogg'), 0, 112))
    put_m('play', loop(os.path.join(M, 'Gravity Sound - Meadow.ogg'), 6, 118))
    put_m('deep', loop(os.path.join(M, 'Gravity Sound - Soundscape Dark.ogg'), 0, 100))
    tot = sum(out.values()); print(f'{len(out)} files, {tot // 1024} KB'); [print(f'  {k:16s} {v // 1024:4d} KB') for k, v in out.items()]

if __name__ == '__main__': main(sys.argv[1])
