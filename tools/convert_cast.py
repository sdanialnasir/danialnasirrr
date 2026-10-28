#!/usr/bin/env python3
"""Convert the owner's Meshy character models (static GLBs) into src/assets/models/cast.js (window.AQ_CAST).

Usage: python3 tools/convert_cast.py <folder with Meshy_AI_<name>_*.glb files> [--preview <out dir>]
Each model: node transform baked in, positions i16 (in its own bounding box), uvs u16, indices u16 (normals are rebuilt in the game),
the base-colour texture padded around UV islands and shrunk to WebP (size per model in TEX). The originals
(5-30 MB each) are not kept in the repo.
"""
import base64, glob, io, json, os, re, struct, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'assets', 'models', 'cast.js')
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# game key <- Meshy file name part; texture size (small creatures get less)
NAMES = {'pip': 'pip', 'pip_cousin': 'cousin', 'shelly': 'shelly', 'captain_clack': 'clack', 'crab': 'crab', 'grimtide': 'grimtide',
         'murk': 'murk', 'lumen': 'lumen', 'mira': 'mira', 'snip': 'snip', 'snap': 'snap', 'piranha': 'piranha', 'bellow': 'bellow', 'jellyfish': 'jelly'}
TEX = {'pip': 512, 'cousin': 384, 'crab': 512, 'piranha': 512, 'snip': 512, 'snap': 512, 'jelly': 384}
def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

def qmat(t, r, s):
    x, y, z, w = r; R = np.array([[1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)], [2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)], [2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s)[None, :]; M[:3, 3] = t; return M

def load(path):
    raw = open(path, 'rb').read(); jl = struct.unpack_from('<I', raw, 12)[0]; J = json.loads(raw[20:20 + jl]); bl = struct.unpack_from('<I', raw, 20 + jl)[0]; BIN = raw[28 + jl:28 + jl + bl]
    def acc(i):
        a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0)
        if stride and stride != dt.itemsize * n: arr = np.frombuffer(BIN, dtype=np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :dt.itemsize * n].copy().view(dt)
        else: arr = np.frombuffer(BIN, dtype=dt, count=a['count'] * n, offset=off).copy()
        if a.get('normalized') and dt != np.float32: arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr.reshape(a['count'], n) if n > 1 else arr
    # world matrix of the (first) mesh node
    parent = {}
    for i, n in enumerate(J['nodes']):
        for c in n.get('children', []): parent[c] = i
    mi = next(i for i, n in enumerate(J['nodes']) if 'mesh' in n); M = np.eye(4); k = mi
    while k is not None:
        n = J['nodes'][k]; L = np.array(n['matrix']).reshape(4, 4).T if 'matrix' in n else qmat(n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]), n.get('scale', [1, 1, 1]))
        M = L @ M; k = parent.get(k)
    P, N, U, I = [], [], [], []; base = 0
    for prim in J['meshes'][J['nodes'][mi]['mesh']]['primitives']:
        A = prim['attributes']; p = acc(A['POSITION']).astype(np.float64); P.append(p); N.append(acc(A['NORMAL']).astype(np.float64)); U.append(acc(A['TEXCOORD_0']).astype(np.float32))
        I.append(acc(prim['indices']).astype(np.int64) + base); base += len(p)
    pos = np.concatenate(P); nrm = np.concatenate(N); uv = np.concatenate(U); idx = np.concatenate(I)
    pos = (np.c_[pos, np.ones(len(pos))] @ M.T)[:, :3]; nrm = nrm @ np.linalg.inv(M[:3, :3]); nrm /= np.maximum(1e-9, np.linalg.norm(nrm, axis=1, keepdims=True))
    mat = J['materials'][J['meshes'][J['nodes'][mi]['mesh']]['primitives'][0].get('material', 0)]; ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    img = J['images'][J['textures'][ti]['source']]; bv = J['bufferViews'][img['bufferView']]
    im = Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGBA')
    return pos.astype(np.float32), nrm.astype(np.float32), uv, idx, im

def pad_tex(im, size):
    im = im.resize((size, size), Image.LANCZOS); rgb = np.asarray(im.convert('RGB')).astype(np.float32); al = np.asarray(im)[:, :, 3] > 8
    if al.mean() > 0.995: al = rgb.sum(2) > 24
    filled = rgb * al[:, :, None]; mask = al.astype(np.float32)
    for _ in range(10):
        blur = np.asarray(Image.fromarray(filled.clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(1))).astype(np.float32)
        mb = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(1))).astype(np.float32) / 255
        grow = (mask < 0.5) & (mb > 0.01); filled[grow] = blur[grow] / np.maximum(mb[grow, None], 1e-3); mask[grow] = 1
    buf = io.BytesIO(); Image.fromarray(filled.clip(0, 255).astype(np.uint8)).save(buf, 'WEBP', quality=84, method=6); return buf.getvalue()

def preview(key, pos, uv, im, out):
    # three orthographic point-splat views (front = looking down -z, side = looking down -x, top), coloured from the texture
    t = np.asarray(im.convert('RGB').resize((256, 256))); c = t[np.clip(((1 - uv[:, 1]) * 255).astype(int), 0, 255), np.clip((uv[:, 0] * 255).astype(int), 0, 255)]
    S = 220; tiles = []
    for ax, (a, b, d) in (('front x/y', (0, 1, 2)), ('side z/y', (2, 1, 0)), ('top x/z', (0, 2, 1))):
        mn, mx = pos.min(0), pos.max(0); sc = (S - 10) / max(mx[a] - mn[a], mx[b] - mn[b]); img = np.full((S, S, 3), 30, np.uint8); zb = np.full((S, S), -1e9)
        x = ((pos[:, a] - mn[a]) * sc + 5).astype(int); y = (S - 6 - (pos[:, b] - mn[b]) * sc).astype(int) if ax[0] != 't' else ((pos[:, b] - mn[b]) * sc + 5).astype(int)
        z = pos[:, d] if ax[0] != 's' else -pos[:, d]
        for k in np.argsort(z):
            if 0 <= x[k] < S and 0 <= y[k] < S: img[max(0, y[k]-1):y[k]+2, max(0, x[k]-1):x[k]+2] = c[k]
        tiles.append(img)
    Image.fromarray(np.concatenate(tiles, 1)).save(os.path.join(out, key + '.png'))

def main(folder, prev=None):
    out = {}
    for path in sorted(glob.glob(os.path.join(folder, '*.glb'))):
        m = re.search(r'Meshy_AI_(.+?)(?:_remesh)?_\d{6,}', os.path.basename(path))
        if not m or m.group(1) not in NAMES: print('skip', os.path.basename(path)); continue
        key = NAMES[m.group(1)]; pos, nrm, uv, idx, im = load(path)
        assert len(pos) < 65536, (key, len(pos))
        mn, mx = pos.min(0), pos.max(0); q = np.round((pos - mn) / np.maximum(1e-9, mx - mn) * 65535 - 32768).astype(np.int16)
        tex = pad_tex(im, TEX.get(key, 640))
        out[key] = {'n': int(len(pos)), 'ni': int(idx.size), 'min': [round(float(v), 5) for v in mn], 'max': [round(float(v), 5) for v in mx],
                    'pos': b64(q), 'uv': b64(np.clip(np.round(np.clip(uv, 0, 1) * 65535), 0, 65535).astype(np.uint16)),
                    'idx': b64(idx.astype(np.uint16)), 'tex': 'data:image/webp;base64,' + base64.b64encode(tex).decode()}
        print(f"{key:9s} verts {len(pos):6d} tris {idx.size // 3:6d} size {np.round(mx - mn, 3)} tex {len(tex) // 1024} KB")
        if prev: preview(key, pos, uv, im, prev)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('/* GENERATED by tools/convert_cast.py from the owner\'s Meshy characters. Do not edit. */\nwindow.AQ_CAST = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB,', len(out), 'models')

if __name__ == '__main__':
    a = sys.argv[1:]; pv = a[a.index('--preview') + 1] if '--preview' in a else None
    if pv: os.makedirs(pv, exist_ok=True)
    main(a[0], pv)
