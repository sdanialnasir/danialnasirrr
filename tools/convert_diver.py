#!/usr/bin/env python3
"""Convert the owner's Meshy diver (rigged GLB) into src/assets/models/diver.js (window.AQ_DIVER).

The game ships as one HTML file and three.js here has no GLB loader, so the model is stored compactly:
  - texture: 4096 PNG (21 MB) -> 1024 WebP with padded UV islands (~0.1 MB)
  - mesh: positions f32, normals i8, uvs u16, joints u8, weights u8, indices u16
  - skeleton: bone names (mixamorig: prefix dropped), parents, rest pose, inverse bind matrices
  - clips: rotations as i16 quaternions; only the hips keep a translation track, made in-place
    (the Swim/Push clips walk the character forward; the game moves the diver itself)
Usage: python3 tools/convert_diver.py path/to/model.glb
"""
import base64, io, json, os, struct, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'assets', 'models', 'diver.js')
KEEP = {'Swim_Idle': 'idle', 'Walking': 'walk', 'Swim_Forward': 'swim', 'Step_Forward_and_Push': 'push', 'Running': 'run'}
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

def main(path):
    raw = open(path, 'rb').read()
    jl = struct.unpack_from('<I', raw, 12)[0]; J = json.loads(raw[20:20 + jl]); bl = struct.unpack_from('<I', raw, 20 + jl)[0]; BIN = raw[28 + jl:28 + jl + bl]
    def acc(i):
        a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0)
        if stride and stride != dt.itemsize * n:
            arr = np.frombuffer(BIN, dtype=np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :dt.itemsize * n].copy().view(dt)
        else:
            arr = np.frombuffer(BIN, dtype=dt, count=a['count'] * n, offset=off).copy()
        return arr.reshape(a['count'], n) if n > 1 else arr
    nodes = J['nodes']; skin = J['skins'][0]; joints = skin['joints']; jidx = {n: k for k, n in enumerate(joints)}
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    name = lambda i: nodes[i].get('name', 'n%d' % i).replace('mixamorig:', '')
    bones = []
    for k, ni in enumerate(joints):
        n = nodes[ni]; p = parent.get(ni); bones.append({'n': name(ni), 'p': jidx.get(p, -1), 't': n.get('translation', [0, 0, 0]), 'r': n.get('rotation', [0, 0, 0, 1]), 's': n.get('scale', [1, 1, 1])})
    root_scale = 1.0
    for ni in joints:
        p = parent.get(ni)
        if p is not None and p not in jidx: root_scale = nodes[p].get('scale', [1, 1, 1])[0]
    extra = {}
    for i, n in enumerate(nodes):  # helper nodes under bones (Meshy adds 'headfront' in front of the face)
        if i not in jidx and parent.get(i) in jidx and 'mesh' not in n:
            extra[name(i)] = {'p': jidx[parent[i]], 't': n.get('translation', [0, 0, 0])}
    ibm = acc(skin['inverseBindMatrices']).astype(np.float32)
    prim = J['meshes'][0]['primitives'][0]; A = prim['attributes']
    pos = acc(A['POSITION']).astype(np.float32); nrm = acc(A['NORMAL']).astype(np.float32); uv = acc(A['TEXCOORD_0']).astype(np.float32)
    jn = acc(A['JOINTS_0']).astype(np.uint8); wt = acc(A['WEIGHTS_0']).astype(np.float32); idx = acc(prim['indices']).astype(np.uint16)
    nrm8 = np.clip(np.round(nrm / np.maximum(1e-6, np.linalg.norm(nrm, axis=1, keepdims=True)) * 127), -127, 127).astype(np.int8)
    assert uv.min() >= -0.001 and uv.max() <= 1.001, 'uvs outside 0..1'
    uv16 = np.clip(np.round(uv * 65535), 0, 65535).astype(np.uint16)
    w8 = np.round(wt / np.maximum(1e-6, wt.sum(1, keepdims=True)) * 255).astype(np.int32)
    w8[np.arange(len(w8)), w8.argmax(1)] += 255 - w8.sum(1); w8 = w8.astype(np.uint8)
    clips = []
    hips = jidx[[i for i in joints if name(i) == 'Hips'][0]]
    for a in J['animations']:
        if a['name'] not in KEEP: continue
        tracks = []; dur = 0
        for ch in a['channels']:
            ni = ch['target']['node']; path = ch['target']['path']
            if ni not in jidx: continue
            b = jidx[ni]; s = a['samplers'][ch['sampler']]; tm = acc(s['input']).astype(np.float32).ravel(); v = acc(s['output']).astype(np.float32)
            dur = max(dur, float(tm[-1]))
            if path == 'rotation':
                v = v / np.linalg.norm(v, axis=1, keepdims=True)  # then keep neighbours on the same hemisphere
                for k in range(1, len(v)):
                    if (v[k] * v[k - 1]).sum() < 0: v[k] *= -1
                tracks.append({'b': b, 'k': 'q', 't': b64(tm), 'v': b64(np.round(v * 32767).astype(np.int16))})
            elif path == 'translation' and b == hips:
                v = v.copy(); v[:, 0] = v[0, 0]; v[:, 2] = v[0, 2]  # in place: keep only the up/down bob
                tracks.append({'b': b, 'k': 'p', 't': b64(tm), 'v': b64(v.astype(np.float32))})
        clips.append({'name': KEEP[a['name']], 'src': a['name'], 'dur': round(dur, 4), 'tracks': tracks})
    # texture: pad the UV islands outward (so mip-mapping never pulls in the black gaps), then shrink to 1024 WebP
    tex_index = J['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']; img = J['images'][J['textures'][tex_index]['source']]
    bv = J['bufferViews'][img['bufferView']]; im = Image.open(io.BytesIO(BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGBA')
    im = im.resize((1024, 1024), Image.LANCZOS); rgb = np.asarray(im.convert('RGB')).astype(np.float32); al = np.asarray(im)[:, :, 3] > 8
    if al.mean() > 0.995: al = rgb.sum(2) > 24  # no alpha in the file: the gaps are black
    filled = rgb * al[:, :, None]; mask = al.astype(np.float32)
    for _ in range(12):  # push colour 12 px outward
        blur = np.asarray(Image.fromarray(filled.clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(1))).astype(np.float32)
        mb = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(1))).astype(np.float32) / 255
        grow = (mask < 0.5) & (mb > 0.01); filled[grow] = blur[grow] / np.maximum(mb[grow, None], 1e-3); mask[grow] = 1
    buf = io.BytesIO(); Image.fromarray(filled.clip(0, 255).astype(np.uint8)).save(buf, 'WEBP', quality=86, method=6)
    tex = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
    out = {'tex': tex, 'rootScale': root_scale, 'bones': bones, 'extra': extra, 'ibm': b64(ibm),
           'mesh': {'n': int(len(pos)), 'ni': int(idx.size), 'pos': b64(pos), 'nrm': b64(nrm8), 'uv': b64(uv16), 'j': b64(jn), 'w': b64(w8), 'idx': b64(idx.ravel())},
           'height': float(pos[:, 1].max() - pos[:, 1].min()), 'minY': float(pos[:, 1].min()), 'clips': clips}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('/* GENERATED by tools/convert_diver.py from the owner\'s Meshy diver. Do not edit. */\nwindow.AQ_DIVER = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB  (texture', len(buf.getvalue()) // 1024, 'KB, tris', idx.size // 3, ', bones', len(bones), ', clips', [c['name'] for c in clips], ')')

if __name__ == '__main__': main(sys.argv[1])
