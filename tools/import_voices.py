#!/usr/bin/env python3
"""Bring ElevenLabs clips into the game: python3 tools/import_voices.py <voiceovers.zip | folder>
For every line id in tools/voices.json: trims silence at both ends, evens out loudness (speech at about -19 dB RMS, peaks
soft-limited below -1.5 dBFS) and saves a 64 kbps mono MP3 to src/assets/vo/<id>.mp3. Then run python3 tools/build.py."""
import io, json, os, subprocess, sys, zipfile
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SR = 44100
OUT = os.path.join(ROOT, 'src', 'assets', 'vo'); TARGET = -19.0

def decode(data):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], input=data, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()

def tidy(x):
    env = np.convolve(np.abs(x), np.ones(441) / 441, 'same'); on = np.where(env > 10 ** (-45 / 20))[0]
    if not len(on): return x
    a = max(0, on[0] - int(0.03 * SR)); b = min(len(x), on[-1] + int(0.18 * SR)); x = x[a:b].copy()
    f = int(0.012 * SR); x[:f] *= np.linspace(0, 1, f); x[-f * 4:] *= np.linspace(1, 0, f * 4)   # no clicks at the cut
    act = np.abs(x) > 0.02 * np.abs(x).max(); rms = np.sqrt((x[act] ** 2).mean()) if act.any() else 1e-4
    x = x * 10 ** ((TARGET - 20 * np.log10(rms + 1e-9)) / 20)
    lim = 10 ** (-1.5 / 20); return (np.tanh(x / lim) * lim).astype(np.float32)   # soft limit, never above -1.5 dBFS

def main():
    src = sys.argv[1]; ids = [l['id'] for l in json.load(open(os.path.join(ROOT, 'tools', 'voices.json'), encoding='utf-8'))['lines']]
    if src.endswith('.zip'):
        z = zipfile.ZipFile(src); files = {os.path.basename(n)[:-4]: z.read(n) for n in z.namelist() if n.lower().endswith('.mp3')}
    else:
        files = {f[:-4]: open(os.path.join(src, f), 'rb').read() for f in os.listdir(src) if f.lower().endswith('.mp3')}
    os.makedirs(OUT, exist_ok=True); done = 0
    for i in ids:
        if i not in files: print('missing', i); continue
        x = tidy(decode(files[i]))
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', 'pipe:0', '-b:a', '64k', os.path.join(OUT, i + '.mp3')], input=x.tobytes(), check=True)
        done += 1; print(f'{i:9s} {len(x) / SR:5.2f}s')
    print(f'{done} clips -> {OUT}; extra files ignored: {sorted(set(files) - set(ids))}')

if __name__ == '__main__': main()
