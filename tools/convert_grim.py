#!/usr/bin/env python3
"""Convert the owner's Meshy Grimtide (a coiled sea serpent, rigged by Meshy's SmartRig but without animation) into
src/assets/models/grim.js (window.AQ_GRIM).

The game's Grimtide is a 30-segment eel posed by path functions (makeEel -> userData.pose). So instead of keeping Meshy's
15-bone rig, this tool *straightens* the model along its spine: the bone chain gives the spine (head tip -> tail tip), every
vertex is projected onto the part of the spine its own skin weights belong to (so a coil never grabs the wrong loop), and
re-expressed in a rotation-minimising frame (side, back, along). The result is a straight serpent lying along -z with the
head tip at z = 0 facing +z and its back up (+y); the game binds it to the 30 segments as a SkinnedMesh.

Usage: python3 tools/convert_grim.py <Meshy_AI_Character_output.glb> [--preview out.png]
"""
import base64, io, json, os, struct, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'assets', 'models', 'grim.js')
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# spine order, head end first (names of Meshy's bones; 'Bone_001' is the middle the two chains grow from)
SPINE = ['Bone_008', 'Bone_009', 'Bone_010', 'Bone_011', 'Bone_012', 'Bone_013', 'Bone_014', 'Bone_001', 'Bone_007', 'Bone_006', 'Bone_005', 'Bone_004', 'Bone_003', 'Bone_002']
def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

def qm(q):
    x, y, z, w = q
    return np.array([[1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)], [2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)], [2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)]])

def main(path, prev=None):
    raw = open(path, 'rb').read(); jl = struct.unpack_from('<I', raw, 12)[0]; J = json.loads(raw[20:20 + jl]); bl = struct.unpack_from('<I', raw, 20 + jl)[0]; BIN = raw[28 + jl:28 + jl + bl]
    def acc(i):
        a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0)
        if stride and stride != dt.itemsize * n: arr = np.frombuffer(BIN, dtype=np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :dt.itemsize * n].copy().view(dt)
        else: arr = np.frombuffer(BIN, dtype=dt, count=a['count'] * n, offset=off).copy()
        if a.get('normalized') and dt != np.float32: arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr.reshape(a['count'], n) if n > 1 else arr
    N = J['nodes']; par = {}
    for i, n in enumerate(N):
        for c in n.get('children', []): par[c] = i
    def world(i):
        M = np.eye(4)
        while i is not None:
            n = N[i]; L = np.eye(4); L[:3, :3] = qm(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1])); L[:3, 3] = n.get('translation', [0, 0, 0]); M = L @ M; i = par.get(i)
        return M
    name = {n.get('name'): i for i, n in enumerate(N)}
    mi = next(i for i, n in enumerate(N) if 'mesh' in n); MW = world(mi)
    prim = J['meshes'][N[mi]['mesh']]['primitives'][0]; A = prim['attributes']
    pos = acc(A['POSITION']).astype(np.float64); pos = (np.c_[pos, np.ones(len(pos))] @ MW.T)[:, :3]
    uv = acc(A['TEXCOORD_0']).astype(np.float32); idx = acc(prim['indices']).astype(np.int64)
    jn = acc(A['JOINTS_0']).astype(np.int64); wt = acc(A['WEIGHTS_0']).astype(np.float64)
    joints = J['skins'][0]['joints']; jnode = np.array(joints)
    # spine points: bone heads, plus a head tip and a tail tip reached by the farthest vertices of the end bones
    P = np.array([world(name[b])[:3, 3] for b in SPINE]); kOf = {name[b]: k for k, b in enumerate(SPINE)}
    kOf[name['Bone_000']] = SPINE.index('Bone_001')
    topj = jnode[jn[np.arange(len(jn)), wt.argmax(1)]]  # the node each vertex follows most
    def tip(end, nxt):
        d = P[end] - P[nxt]; d /= np.linalg.norm(d); m = np.array([kOf.get(j, -1) == end for j in topj]); ext = ((pos[m] - P[end]) @ d).max() if m.any() else 0.2
        return P[end] + d * max(0.05, ext * 0.98)
    P = np.vstack([tip(0, 1), P, tip(len(SPINE) - 1, len(SPINE) - 2)])  # index shift: spine k -> point k + 1
    seg = P[1:] - P[:-1]; sl = np.linalg.norm(seg, axis=1); S0 = np.r_[0, np.cumsum(sl)]; Lr = S0[-1]
    # each vertex: nearest point on the segments next to its two strongest bones
    order = np.argsort(-wt, 1)[:, :2]; s_of = np.zeros(len(pos)); C = np.zeros_like(pos)
    for v in range(len(pos)):
        cand = set()
        for c in order[v]:
            if wt[v, c] < 0.05 and c != order[v][0]: continue
            k = kOf.get(int(jnode[jn[v, c]]))
            if k is None: continue
            k += 1; cand.update([k - 1, k])
        if not cand: cand = set(range(len(seg)))
        best = (1e9, 0, None)
        for g in cand:
            if g < 0 or g >= len(seg): continue
            a = P[g]; d = seg[g]; t = np.clip((pos[v] - a) @ d / (d @ d), 0, 1); q = a + d * t; e = np.sum((pos[v] - q) ** 2)
            if e < best[0]: best = (e, S0[g] + t * sl[g], q)
        s_of[v] = best[1]; C[v] = best[2]
    # rotation-minimising frame along the spine, started at the top of the arch with "back" = world up
    T = np.zeros((len(P), 3))
    for i in range(len(P)): a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]; d = a - b; T[i] = d / np.linalg.norm(d)  # tangent toward the head
    top = int(np.argmax(P[:, 1])); Nn = np.zeros_like(T); up = np.array([0, 1.0, 0]); n0 = up - T[top] * (up @ T[top]); Nn[top] = n0 / np.linalg.norm(n0)
    def transport(i, j):  # double reflection
        v1 = P[j] - P[i]; c1 = v1 @ v1; rL = Nn[i] - (2 / c1) * (v1 @ Nn[i]) * v1; tL = T[i] - (2 / c1) * (v1 @ T[i]) * v1; v2 = T[j] - tL; c2 = v2 @ v2
        r = rL - (2 / c2) * (v2 @ rL) * v2 if c2 > 1e-12 else rL; r -= T[j] * (r @ T[j]); Nn[j] = r / np.linalg.norm(r)
    for i in range(top, len(P) - 1): transport(i, i + 1)
    for i in range(top, 0, -1): transport(i, i - 1)
    def frame_at(s):
        g = np.clip(np.searchsorted(S0, s) - 1, 0, len(seg) - 1); f = np.clip((s - S0[g]) / max(1e-9, sl[g]), 0, 1)
        t = T[g] * (1 - f) + T[g + 1] * f; t /= np.linalg.norm(t); n = Nn[g] * (1 - f) + Nn[g + 1] * f; n -= t * (n @ t); n /= np.linalg.norm(n); return t, n, np.cross(n, t)
    out = np.zeros_like(pos)
    for v in range(len(pos)):
        t, n, x = frame_at(s_of[v]); d = pos[v] - C[v]; out[v] = [d @ x, d @ n, -s_of[v] + d @ t]
    rad = np.hypot(out[:, 0], out[:, 1]); u = -out[:, 2] / Lr
    Rm = float(np.percentile(rad[(u > 0.08) & (u < 0.3)], 90))  # body radius behind the head
    print('spine length %.3f, head radius %.3f, ratio %.1f, verts %d' % (Lr, Rm, Lr / Rm, len(out)))
    # textures: base colour 1024, normal map 1024, glow mask (the gold spots and eyes) 512
    def img(ti):
        bv = J['bufferViews'][J['images'][J['textures'][ti]['source']]['bufferView']]; o = bv.get('byteOffset', 0); return Image.open(io.BytesIO(BIN[o:o + bv['byteLength']])).convert('RGB')
    mat = J['materials'][prim.get('material', 0)]; pb = mat['pbrMetallicRoughness']
    base = img(pb['baseColorTexture']['index']); nm = img(mat['normalTexture']['index']) if 'normalTexture' in mat else None
    def webp(im, size, q=84): b = io.BytesIO(); im.resize((size, size), Image.LANCZOS).save(b, 'WEBP', quality=q, method=6); return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
    a = np.asarray(base.resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255; r, g, bb = a[..., 0], a[..., 1], a[..., 2]
    glow = np.clip((np.minimum(r, g) - bb * 0.9 - 0.25) * 3.2, 0, 1) * (r > 0.55)  # warm gold/amber, bright, not the pale cream
    gi = Image.fromarray((glow * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2)).convert('RGB')
    G = {'n': int(len(out)), 'ni': int(idx.size), 'Lr': round(float(Lr), 5), 'Rm': round(Rm, 5)}
    mn, mx = out.min(0), out.max(0); q = np.round((out - mn) / np.maximum(1e-9, mx - mn) * 65535 - 32768).astype(np.int16)
    G.update({'min': [round(float(v), 5) for v in mn], 'max': [round(float(v), 5) for v in mx], 'pos': b64(q), 'uv': b64(np.clip(np.round(np.clip(uv, 0, 1) * 65535), 0, 65535).astype(np.uint16)),
              'idx': b64(idx.astype(np.uint16)), 'tex': webp(base, 1024), 'nrm': webp(nm, 1024, 80) if nm else None, 'glow': webp(gi, 512, 80)})
    open(OUT, 'w').write('/* GENERATED by tools/convert_grim.py from the owner\'s Meshy Grimtide. Do not edit. */\nwindow.AQ_GRIM = ' + json.dumps(G, separators=(',', ':')) + ';\n')
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
    if prev:  # side and top views of the straightened serpent, coloured from the texture
        t = np.asarray(base.resize((256, 256))); col = t[np.clip(((uv[:, 1]) * 255).astype(int), 0, 255), np.clip((uv[:, 0] * 255).astype(int), 0, 255)]
        W, H = 1400, 260; ims = []
        for a_, b_ in ((2, 1), (2, 0)):
            im = np.full((H, W, 3), 30, np.uint8); sc = (W - 20) / (mx[a_] - mn[a_]); xs = ((out[:, a_] - mn[a_]) * sc + 10).astype(int); ys = (H / 2 - out[:, b_] * sc).astype(int)
            for k in np.argsort(out[:, 0] if b_ == 1 else -out[:, 1]):
                if 0 <= xs[k] < W and 0 <= ys[k] < H: im[max(0, ys[k] - 1):ys[k] + 2, max(0, xs[k] - 1):xs[k] + 2] = col[k]
            ims.append(im)
        Image.fromarray(np.concatenate(ims, 0)).save(prev)

if __name__ == '__main__':
    a = sys.argv[1:]; main(a[0], a[a.index('--preview') + 1] if '--preview' in a else None)
