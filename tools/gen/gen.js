// Puzzle generator: builds compact rock rooms (few sand plugs, stones, pearls, a gate) and hill-climbs them toward
// "hard but fair": proven solvable by the complete solver (exact.js), many trap moments on the shortest route.
// Usage: node gen.js <seed> <W> <H> <pearls> <iters> <outfile.jsonl>
const { Engine, T } = require('../solver/engine.js'); const { analyse, greedy } = require('./exact.js'); const fs = require('fs');
const [seed0, W, H, NB, ITERS, OUT] = [+process.argv[2] || 1, +process.argv[3] || 13, +process.argv[4] || 8, +process.argv[5] || 2, +process.argv[6] || 300, process.argv[7] || 'gen_out.jsonl'];
let sd = seed0 * 7919 + 13; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647, ri = n => Math.floor(rnd() * n), pick = a => a[ri(a.length)];
const toMap = g => g.map(r => r.join(''));
function fresh() { // a trivially winnable room to grow from: solid floor with the gate, pearls on the floor beside it, a few ledges
  const g = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? '#' : ' '));
  for (let x = 1; x < W - 1; x++) g[H - 2][x] = 'W'; const gx = 2 + ri(W - 4); g[H - 2][gx] = 'E';
  const side = []; for (let x = 1; x < W - 1; x++) if (x !== gx) side.push(x); let placed = 0;
  for (const x of side.sort(() => rnd() - 0.5)) { if (placed >= NB) break; g[H - 3][x] = 'B'; placed++; }
  for (let k = 0; k < 4 + ri(4); k++) { const y = 2 + ri(H - 5), x = 1 + ri(W - 4), L = 2 + ri(5); for (let i = 0; i < L && x + i < W - 1; i++) if (g[y][x + i] === ' ') g[y][x + i] = 'W'; }
  for (let k = 0; k < 2 + ri(3); k++) { const cs = []; for (let y = 1; y < H - 3; y++) for (let x = 1; x < W - 1; x++) if (g[y][x] === ' ' && g[y + 1][x] === 'W') cs.push([x, y]); if (cs.length) { const [x, y] = pick(cs); g[y][x] = 'R'; } }
  g[1][1 + ri(W - 2)] = 'P'; return g; }
// a board must be at rest at the start (nothing drops before the player moves) and keep its pieces
function stable(g) { const lv = { name: 'g', time: 999, map: toMap(g) }; const e = new Engine(lv); e.relaxed = true; const n0 = e.objects.size, b0 = e.ballsTotal; if (!e.player || !e.gate || b0 !== NB) return false;
  for (let i = 0; i < 3; i++) { e.step(); if (e.state !== 'playing') return false; for (const o of e.objects.values()) if (o.falling) return false; } return e.objects.size === n0 && e.ballsIn === 0; }
function mutate(g0) { const g = g0.map(r => r.slice()); const n = 1 + ri(3);
  for (let k = 0; k < n; k++) { const x = 1 + ri(W - 2), y = 1 + ri(H - 2), c = g[y][x]; if (c === 'P' || c === 'E' || c === 'B') { if (c === 'B' && rnd() < 0.5) { // move a pearl
        const cs = []; for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) if (g[yy][xx] === ' ') cs.push([xx, yy]); if (cs.length) { const [nx, ny] = pick(cs); g[y][x] = ' '; g[ny][nx] = 'B'; } } continue; }
    g[y][x] = pick(y === H - 2 ? ['W', 'W', ' ', '.'] : [' ', 'W', 'W', 'W', '.', 'R']); }
  if (rnd() < 0.08) { // move the gate along the floor
    let gx = -1; for (let x = 1; x < W - 1; x++) if (g[H - 2][x] === 'E') gx = x; const nx = 1 + ri(W - 2); if (gx >= 0 && g[H - 2][nx] !== 'P') { g[H - 2][gx] = 'W'; g[H - 2][nx] = 'E'; } }
  return g; }
function evalG(g) { if (!stable(g)) return { s: -1 }; const lv = { name: 'g', time: 999, map: toMap(g) };
  const r = analyse(lv, { maxStates: 70000 }); if (!r.solvable || !r.complete || !r.route) return { s: -1 };
  // what the solution really asks for: stones moved on purpose, pearls pushed AWAY from the gate, stones dropped by digging,
  // and how much of it happens while things fall (timing-heavy solutions are unfair on a phone)
  const e = new Engine(lv); e.relaxed = true; let fm = 0, sp = 0, away = 0, drops = 0; const gx = e.gate.x;
  for (const c of r.route) { let f = false; for (const o of e.objects.values()) if ((o.t === T.ROCK || o.t === T.BALL) && o.falling) f = true; if (c !== '.' && f) fm++;
    if (c !== '.') e.press({ U: 'up', D: 'down', L: 'left', R: 'right' }[c]); e.step();
    for (const ev of e.events) { if (ev.type === 'push') { if (ev.t === T.ROCK) sp++; else { const ox = c === 'L' ? ev.x + 1 : ev.x - 1; if (Math.abs(ev.x - gx) > Math.abs(ox - gx)) away++; } }
      if (ev.type === 'land' && ev.t === T.ROCK) drops++; } }
  r.fallMoves = fm; r.stonePushes = sp; r.away = away; r.drops = drops; r.greedy = 0;
  const kinds = (sp > 0) + (away > 0) + (drops > 0) + (r.tempt > 2);
  return { s: Math.min(r.tempt, 6) * 6 + r.temptFrac * 30 + Math.min(sp, 8) * 7 + Math.min(away, 6) * 9 + Math.min(drops, 6) * 5 + kinds * 12 + r.decisions * 1.2 + Math.min(r.len, 120) * 0.08 - Math.max(0, fm - 3) * 6 - (r.len < 28 ? 30 : 0), r }; }
let best = null, cur = null, tries = 0;
while (!cur && tries < 400) { tries++; const g = fresh(); const v = evalG(g); if (v.s > 0) cur = { g, ...v }; }
if (!cur) { console.log('no start'); process.exit(0); }
best = cur; const t0 = Date.now();
for (let it = 0; it < ITERS; it++) { const g = mutate(cur.g), v = evalG(g); if (v.s < 0) continue;
  const temp = 6 * (1 - it / ITERS); if (v.s >= cur.s || rnd() < Math.exp((v.s - cur.s) / Math.max(0.3, temp))) { cur = { g, ...v }; if (cur.s > best.s) { best = cur;
      const rec = { seed: seed0, W, H, NB, it, score: +best.s.toFixed(1), len: best.r.len, traps: best.r.traps, stonePushes: best.r.stonePushes, away: best.r.away, drops: best.r.drops, tempt: best.r.tempt, temptFrac: best.r.temptFrac, fallMoves: best.r.fallMoves, greedy: best.r.greedy, decisions: best.r.decisions, trapMoves: best.r.trapMoves, states: best.r.states, deadFrac: best.r.deadFrac, route: best.r.route, map: toMap(best.g) };
      fs.appendFileSync(OUT, JSON.stringify(rec) + '\n'); } } }
console.log(JSON.stringify({ seed: seed0, best: +best.s.toFixed(1), len: best.r.len, traps: best.r.traps, stonePushes: best.r.stonePushes, away: best.r.away, drops: best.r.drops, tempt: best.r.tempt, temptFrac: best.r.temptFrac, fallMoves: best.r.fallMoves, greedy: best.r.greedy, decisions: best.r.decisions, secs: (Date.now() - t0) / 1000 })); console.log(toMap(best.g).join('\n'));
