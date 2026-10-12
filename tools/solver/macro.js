// Macro-level best-first solver driving the real Engine (physics, monsters, oxygen are all simulated).
const { Engine, T, MONSTERS } = require('./engine.js');
const levels = require('./levels.json');
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }, LETTER = { up: 'U', down: 'D', left: 'L', right: 'R' };
function clone(e) { const n = Object.create(Engine.prototype); Object.assign(n, e); n.grid = e.grid.slice(); n.water = e.water.slice(); const map = new Map(); n.objects = new Map();
  for (const [id, o] of e.objects) { const c = { ...o }; map.set(o, c); n.objects.set(id, c); } n.obj = e.obj.map(o => (o ? map.get(o) || null : null)); n.player = e.player ? map.get(e.player) : null; n.gate = e.gate ? { ...e.gate } : null; n.events = []; n.moveQueue = []; n.held = null; return n; }
const heavy = o => o.t === T.ROCK || o.t === T.BALL;
function key(e) { let k = e.grid.join(''); for (const o of e.objects.values()) if (heavy(o) || o.t === T.PLAYER) k += '|' + o.t + ',' + o.x + ',' + o.y; return k + '|' + e.ballsIn; }
function walkable(e, x, y) { if (x < 0 || y < 0 || x >= e.w || y >= e.h) return false; const t = e.get(x, y); const o = e.obj[y * e.w + x];
  if (o && o.t !== T.PLAYER) return false; return t === T.EMPTY || t === T.SAND || t === T.AIR || t === T.PLAYER || (t === T.GATE && e.gate && e.gate.open); }
function path(e, tx, ty) { const p = e.player; const W = e.w, prev = new Map(), q = [[p.x, p.y]]; prev.set(p.y * W + p.x, null);
  while (q.length) { const [x, y] = q.shift(); if (x === tx && y === ty) break; for (const d in DIRS) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1], k = ny * W + nx; if (prev.has(k) || !walkable(e, nx, ny)) continue;
      if (e.get(nx, ny) === T.GATE && !(nx === tx && ny === ty)) continue; prev.set(k, [y * W + x, d]); q.push([nx, ny]); } }
  if (!prev.has(ty * W + tx)) return null; const out = []; let k = ty * W + tx; while (prev.get(k)) { const [pk, d] = prev.get(k); out.push(d); k = pk; } return out.reverse(); }
function settle(e, max = 10, log = []) { for (let i = 0; i < max; i++) { let moving = false; for (const o of e.objects.values()) if (heavy(o) && o.falling) moving = true; if (!moving && i > 1) break; e.step(); log.push('.'); if (e.state !== 'playing') return; } }
function exec(e, dirs, log) { for (const d of dirs) { const p = e.player, x0 = p.x, y0 = p.y; e.press(d); e.step(); log.push(LETTER[d]); if (e.state === 'won') return true; if (e.state !== 'playing') return false;
    if (e.player.x === x0 && e.player.y === y0) { e.step(); log.push('.'); if (e.state !== 'playing') return e.state === 'won'; if (e.player.x === x0 && e.player.y === y0) return false; } } return true; }
function macros(e) { const out = [], p = e.player; if (!p) return out;
  if (e.gate && e.gate.open) out.push({ kind: 'gate', tx: e.gate.x, ty: e.gate.y });
  for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) if (e.get(x, y) === T.AIR) out.push({ kind: 'air', tx: x, ty: y });
  for (const o of e.objects.values()) { if (!heavy(o)) continue;
    for (const d of ['left', 'right']) { const dx = DIRS[d][0], sx = o.x - dx, tt = e.get(o.x + dx, o.y); if ((tt === T.EMPTY && !e.obj[o.y * e.w + o.x + dx]) || (tt === T.GATE && o.t === T.BALL)) out.push({ kind: 'push', tx: sx, ty: o.y, then: d });
      for (let k = 1; k <= 12; k++) { const cx = o.x + dx * k, t2 = e.get(cx, o.y); if (t2 === T.EMPTY && !e.obj[o.y * e.w + cx]) continue; if (t2 === T.SAND) out.push({ kind: 'dig', tx: cx, ty: o.y }); break; } }
    for (let k = 1; k <= 8; k++) { const t2 = e.get(o.x, o.y + k); if (t2 === T.EMPTY && !e.obj[(o.y + k) * e.w + o.x]) continue; if (t2 === T.SAND) out.push({ kind: 'dig', tx: o.x, ty: o.y + k }); break; }
    for (const [cx, cy] of [[o.x - 1, o.y], [o.x + 1, o.y], [o.x - 1, o.y + 1], [o.x + 1, o.y + 1]]) if (e.get(cx, cy) === T.SAND) out.push({ kind: 'dig', tx: cx, ty: cy }); }
  if (e.gate) for (const [cx, cy] of [[e.gate.x - 1, e.gate.y], [e.gate.x + 1, e.gate.y], [e.gate.x, e.gate.y - 1]]) if (e.get(cx, cy) === T.SAND) out.push({ kind: 'dig', tx: cx, ty: cy });
  return out; }
function apply(e, m) { const n = clone(e), log = []; const pth = path(n, m.tx, m.ty); if (!pth) return null;
  if (m.kind === 'dig' && pth.length === 0) return null;
  if (!exec(n, pth, log)) return n.state === 'won' ? { e: n, log } : null; if (n.state === 'won') return { e: n, log };
  if (m.kind === 'push') { if (!exec(n, [m.then], log)) return null; }
  if (m.kind === 'dig' && pth.length) { const back = { up: 'down', down: 'up', left: 'right', right: 'left' }[pth[pth.length - 1]]; const bx = n.player.x + DIRS[back][0], by = n.player.y + DIRS[back][1]; if (walkable(n, bx, by)) { if (!exec(n, [back], log)) return null; } }
  settle(n, 10, log); if (n.state === 'dead') return null; return { e: n, log }; }
function h(e) { let s = (e.ballsTotal - e.ballsIn) * 60; const g = e.gate; for (const o of e.objects.values()) if (o.t === T.BALL && g) s += Math.abs(o.x - g.x) + Math.abs(o.y - g.y) * 1.5; if (e.gate && e.gate.open && e.player) s += Math.abs(e.player.x - g.x) + Math.abs(e.player.y - g.y); return s; }
function solve(lv, budget = +process.env.BUDGET || 40000) { const start = new Engine(lv); const seen = new Set([key(start)]); let open = [{ e: start, log: '', f: h(start) }]; let exp = 0;
  while (open.length && exp < budget) { open.sort((a, b) => a.f - b.f); const cur = open.shift(); exp++;
    for (const m of macros(cur.e)) { const r = apply(cur.e, m); if (!r) continue; const log = cur.log + r.log.join('');
      if (r.e.state === 'won') return { ok: true, moves: log, steps: log.length, oxygenLeft: Math.round(r.e.oxygen), time: lv.time, exp };
      const k = key(r.e); if (seen.has(k)) continue; seen.add(k); open.push({ e: r.e, log, f: h(r.e) + log.length * 0.02 }); }
    if (open.length > 6000) { open.sort((a, b) => a.f - b.f); open.length = 3000; } }
  return { ok: false, exp }; }
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : levels.map((_, i) => i + 1);
for (const i of only) { const t0 = Date.now(); const r = solve(levels[i - 1]); console.log(JSON.stringify({ level: i, name: levels[i - 1].name, ...r, ms: Date.now() - t0 })); }
