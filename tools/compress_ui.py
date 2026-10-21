#!/usr/bin/env python3
"""Compress the owner's UI element PNGs (from ChatGPT, ~1 MB each) into small WebPs for the game.
Usage: python tools/compress_ui.py <folder with the original PNGs> [more folders...]
Each file is matched by its number prefix (e.g. "13-energy-pearl.png"), trimmed to its visible pixels, resized to
about 2x the size it is shown at, and saved as src/assets/images/ui/<key>.webp (alpha kept). build_assets.py embeds them."""
import os, sys, glob
from PIL import Image
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'assets', 'images', 'ui')
# number prefix -> (key, longest side in px)
SPEC = {
 '01': ('logo', 900), '02': ('pill_gold', 560), '03': ('pill_gold_down', 560), '04': ('pill_mint', 560), '05': ('btn_square', 168), '06': ('btn_round', 168),
 '07': ('panel', 560), '08': ('panel_row', 560), '09': ('chip', 400), '10': ('coin', 112), '11': ('star', 128), '12': ('star_off', 128), '13': ('pearl', 112),
 '14': ('pearl_slot', 112), '15': ('gate_locked', 128), '16': ('gate_open', 128), '17': ('bubble', 96), '18': ('air_frame', 420), '19': ('bar_frame', 480),
 '20': ('node_blue', 168), '21': ('node_violet', 168), '22': ('node_navy', 168), '23': ('node_current', 184), '24': ('node_locked', 168), '25': ('node_cleared', 184),
 '26': ('chest', 200), '27': ('chest_open', 220), '28': ('gift', 176), '29': ('trophy', 176), '30': ('bag', 176), '31': ('scroll', 176), '32': ('bulb', 144),
 '33': ('sun', 128), '34': ('medal1', 112), '35': ('medal2', 112), '36': ('medal3', 112), '37': ('rib_common', 260), '38': ('rib_rare', 260), '39': ('rib_epic', 260),
 '40': ('rib_legendary', 260), '41': ('toggle', 300), '42': ('dot', 64), '43': ('hand', 168), '44': ('danger', 128), '45': ('burst', 640), '46': ('sparkle', 96),
 '47': ('coral', 150), '48': ('shell', 150), '49': ('starfish', 150), '50': ('fish', 150), '51': ('crystal', 150), '52': ('jelly', 150),
 '53-01': ('i_pause', 112), '53-02': ('i_play', 112), '53-03': ('i_undo', 112), '53-04': ('i_restart', 112), '53-05': ('i_home', 112), '53-06': ('i_settings', 112),
 '53-07': ('i_map', 112), '53-08': ('i_share', 112), '53-09': ('i_back', 112), '53-10': ('i_close', 112), '53-11': ('i_lock', 112), '53-12': ('i_sound', 112),
 '53-13': ('i_mute', 112), '53-14': ('i_question', 112), '53-15': ('i_skip', 112),
}
def main(dirs):
    os.makedirs(OUT, exist_ok=True); before = after = 0
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, '*.png'))):
            b = os.path.basename(f); pre = b[:5] if b.startswith('53-') else b[:2]
            if pre not in SPEC: print('skip', b); continue
            key, side = SPEC[pre]; im = Image.open(f).convert('RGBA')
            a = im.getchannel('A').point(lambda v: 255 if v > 8 else 0); bb = a.getbbox()
            if bb: im = im.crop((max(0, bb[0] - 4), max(0, bb[1] - 4), min(im.width, bb[2] + 4), min(im.height, bb[3] + 4)))
            if key.startswith('i_'):  # icons are used as shape masks: drop the soft blue drop shadow, keep the white body
                px = im.load()
                for y in range(im.height):
                    for x in range(im.width):
                        r, g, b_, al = px[x, y]; l = 0.3 * r + 0.59 * g + 0.11 * b_; f = min(1, max(0, (l - 185) / 45))
                        px[x, y] = (255, 255, 255, int(al * f))
                bb = im.getchannel('A').getbbox()
                if bb: im = im.crop(bb)
            k = side / max(im.size)
            if k < 1: im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            out = os.path.join(OUT, key + '.webp'); im.save(out, 'WEBP', quality=82, method=6, alpha_quality=90)
            before += os.path.getsize(f); after += os.path.getsize(out); print(f'{key:16} {im.size[0]}x{im.size[1]}  {os.path.getsize(out) // 1024} KB')
    print(f'total {before / 1e6:.1f} MB -> {after / 1e3:.0f} KB')
if __name__ == '__main__': main(sys.argv[1:])
