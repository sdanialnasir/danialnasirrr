// Complete solver + difficulty meter for monster-free levels, driving the REAL engine (tools/solver/engine.js). Air ignored.
// Sokoban-style reduction: while nothing is falling, the diver can swim anywhere in his pocket of open water for free, so a
// board at rest is one state per (board, pocket). From there each "decision" = swim to a pocket cell + one move into
// something (dig sand, push, take air, enter the gate). While anything is falling (or rests on the diver), every single move
// and wait is searched tick by tick, so dodges and timing are exact. The search is complete.
// Reports: solvable, decisions + moves of the shortest-decision route, reachable states, dead states (alive diver, but no
// way to win), and traps: decision points on the route where at least one choice silently loses the level.
const { Engine, T } = require('../solver/engine.js');
const DV = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }, NM = { U: 'up', D: 'down', L: 'left', R: 'right' };
const HEAVY = t => t === T.ROCK || t === T.BALL;
function hasMonsters(lv) { return lv.map.some(r => /[FJC]/.test(r)); }
function moving(e) { for (const o of e.objects.values()) if (HEAVY(o.t) && o.falling) return true; return false; }
// would anything move if the diver were not where he is? (a stone resting on him, or a roll he is blocking)
function bearing(e) { const p = e.player; const c = e.clone(); const pc = c.player; c.obj[pc.y * c.w + pc.x] = null; c.set(pc.x, pc.y, T.EMPTY); c.objects.delete(pc.id); c.player = null;
  const before = []; for (const o of c.objects.values()) if (HEAVY(o.t)) before.push(o.x * 1000 + o.y); c.tick++; c.physics(); let i = 0; for (const o of c.objects.values()) if (HEAVY(o.t) && o.x * 1000 + o.y !== before[i++]) return true; return false; }
function gridKey(e, skipPlayer) { const g = e.grid; let s = ''; for (let i = 0; i < g.length; i++) s += String.fromCharCode(48 + (skipPlayer && g[i] === T.PLAYER ? 0 : g[i])); return s; }
function pocket(e) { const W = e.w, p = e.player, seen = new Uint8Array(e.grid.length), q = [p.y * W + p.x]; seen[q[0]] = 1;
  for (let qi = 0; qi < q.length; qi++) { const c = q[qi], x = c % W, y = (c / W) | 0; for (const k in DV) { const n = (y + DV[k][1]) * W + x + DV[k][0]; if (seen[n]) continue; if (e.grid[n] === T.EMPTY) { seen[n] = 1; q.push(n); } } } return q; }
function stateOf(e) { if (moving(e) || bearing(e)) { let s = 'p' + gridKey(e, false); for (const o of e.objects.values()) if (HEAVY(o.t)) s += o.falling ? (o.fallN || 0) + (o.graced ? 'g' : '') : '_'; return { key: s + e.ballsIn, mode: 'p' }; }
  const pk = pocket(e); let m = Infinity; for (const c of pk) if (c < m) m = c; return { key: 'r' + gridKey(e, true) + '@' + m + '|' + e.ballsIn, mode: 'r', pk }; }
function teleport(e, c) { const p = e.player, W = e.w, x = c % W, y = (c / W) | 0; if (p.x === x && p.y === y) return; e.moveObj(p, x, y); }
function edges(e, st) { const out = []; // [label, newEngine]
  if (st.mode === 'p') { const opts = ['U', 'D', 'L', 'R']; if (moving(e)) opts.push('.'); for (const c of opts) { const n = e.clone(); if (c !== '.') n.press(NM[c]); n.step(); out.push([c, n]); } return out; }
  const W = e.w, P = e.player, G = (x, y) => (x === P.x && y === P.y) ? T.EMPTY : e.get(x, y); // the diver's own square is free once he swims off it
  for (const c of st.pk) { const x = c % W, y = (c / W) | 0;
    for (const k in DV) { const nx = x + DV[k][0], ny = y + DV[k][1], t = G(nx, ny);
      if (t === T.EMPTY || t === T.STEEL || t === T.WALL) continue; if (t === T.GATE && !e.gate.open) continue;
      if (HEAVY(t) && (DV[k][1] !== 0 || G(nx + DV[k][0], ny) !== T.EMPTY && !(t === T.BALL && G(nx + DV[k][0], ny) === T.GATE))) continue;
      const n = e.clone(); teleport(n, c); n.press(NM[k]); n.step(); const q = n.player; if (n.state === 'playing' && q && q.x === x && q.y === y && !moving(n)) continue; // nothing happened
      out.push([c + ':' + k, n]); } }
  return out; }
function analyse(lv, { maxStates = 400000, wantDead = true } = {}) {
  const e0 = new Engine(lv); e0.relaxed = true; e0.begun = true; const s0 = stateOf(e0);
  const G0 = e0.gate, hOf = e => { let v = (e.ballsTotal - e.ballsIn) * 40; for (const o of e.objects.values()) if (o.t === T.BALL) v += Math.abs(o.x - G0.x) * 1.2 + Math.abs(o.y - G0.y) * 2; return v; };
  const idx = new Map([[s0.key, 0]]), par = [-1], lab = [''], eng = [e0], sts = [s0], kids = [], hv = [hOf(e0)]; const wins = new Map(); let head = 0, deaths = 0, complete = true, firstWin = -1;
  while (head < eng.length) { if (eng.length > maxStates) { complete = false; break; } const i = head++, e = eng[i], st = sts[i]; eng[i] = null; sts[i] = null; const ch = [];
    for (const [l, n] of edges(e, st)) { if (n.state === 'won') { if (!wins.has(i)) wins.set(i, l); if (firstWin < 0) firstWin = i; continue; } if (n.state !== 'playing') { deaths++; continue; }
      const s = stateOf(n); let j = idx.get(s.key); if (j === undefined) { j = eng.length; idx.set(s.key, j); eng.push(n); sts.push(s); par.push(i); lab.push(l); hv.push(hOf(n)); } if (j !== i) ch.push(j); }
    kids[i] = ch; if (!wantDead && firstWin >= 0) break; }
  const N = par.length, res = { solvable: firstWin >= 0, complete, states: N, deaths };
  if (firstWin < 0) return res;
  const labs = [wins.get(firstWin)]; const chain = [firstWin]; for (let k = firstWin; k > 0; k = par[k]) { labs.push(lab[k]); chain.push(par[k]); } labs.reverse(); chain.reverse();
  res.route = expand(lv, labs); res.len = res.route ? res.route.length : 0; res.decisions = labs.filter(l => l.includes(':')).length;
  if (!wantDead || !complete) return res;
  const rev = Array.from({ length: N }, () => []); for (let i = 0; i < N; i++) if (kids[i]) for (const j of kids[i]) rev[j].push(i);
  const alive = new Uint8Array(N), q = [...wins.keys()]; for (const i of q) alive[i] = 1; for (let qi = 0; qi < q.length; qi++) for (const p of rev[q[qi]]) if (!alive[p]) { alive[p] = 1; q.push(p); }
  let dead = 0; for (let i = 0; i < N; i++) if (!alive[i]) dead++;
  const why = []; for (let ci = 0; ci < chain.length - 1 && why.length < 6; ci++) { const i = chain[ci]; const bad = []; for (const j of kids[i] || []) if (!alive[j] && hv[j] < hv[i] - 0.01) bad.push(lab[j]); if (bad.length) why.push({ step: ci, good: labs[ci + 1 - 1] === undefined ? '' : labs[ci], bad }); }
  res.why = why;
  let traps = 0, trapMoves = 0, choices = 0, tempt = 0, temptAll = 0; for (const i of chain) { let t = 0, tt = 0; for (const j of kids[i] || []) if (!alive[j]) { t++; if (hv[j] < hv[i] - 0.01) tt++; } choices += (kids[i] || []).length; if (t) traps++; trapMoves += t; if (tt) tempt++; }
  // over the whole alive region: how many "looks like progress" moves lose the level
  let prog = 0; for (let i = 0; i < N; i++) if (alive[i] && kids[i]) for (const j of kids[i]) if (hv[j] < hv[i] - 0.01) { prog++; if (!alive[j]) temptAll++; }
  return Object.assign(res, { dead, deadFrac: +(dead / N).toFixed(3), traps, trapMoves, choices, chain: chain.length, tempt, temptFrac: +(temptAll / Math.max(1, prog)).toFixed(3) }); }
// turn decision labels back into real single moves (walking paths through open water) and check the result wins
function expand(lv, labs) { const e = new Engine(lv); e.relaxed = true; e.begun = true; let out = '';
  for (const l of labs) { if (!l.includes(':')) { if (l !== '.') e.press(NM[l]); e.step(); out += l; continue; }
    const [c, k] = l.split(':'); const W = e.w, target = +c, p = e.player, start = p.y * W + p.x, prev = new Map([[start, -1]]), q = [start];
    for (let qi = 0; qi < q.length; qi++) { const cc = q[qi]; if (cc === target) break; const x = cc % W, y = (cc / W) | 0; for (const d in DV) { const n = (y + DV[d][1]) * W + x + DV[d][0]; if (prev.has(n) || e.grid[n] !== T.EMPTY) continue; prev.set(n, cc); q.push(n); } }
    if (!prev.has(target)) return null; const path = []; for (let cc = target; cc !== start; cc = prev.get(cc)) path.push(cc); path.reverse();
    let cx = start; for (const n of path) { const d = n === cx + 1 ? 'R' : n === cx - 1 ? 'L' : n > cx ? 'D' : 'U'; e.press(NM[d]); e.step(); out += d; cx = n; if (e.state !== 'playing') return null; }
    e.press(NM[k]); e.step(); out += k; if (e.state === 'won') return out; if (e.state !== 'playing') return null; }
  return e.state === 'won' ? out : null; }
// how a sensible player would fare: best-first toward the goal (pearls left, pearls' distance to the gate). Easy puzzles fall
// to it in a handful of decisions; hard ones make it wander. Returns decisions expanded until a win (or cap).
function greedy(lv, cap = 30000) { const e0 = new Engine(lv); e0.relaxed = true; e0.begun = true; const g = e0.gate;
  const h = e => { let s = (e.ballsTotal - e.ballsIn) * 40; for (const o of e.objects.values()) if (o.t === T.BALL) s += Math.abs(o.x - g.x) * 1.2 + Math.abs(o.y - g.y) * 2; if (e.gate.open && e.player) s += (Math.abs(e.player.x - g.x) + Math.abs(e.player.y - g.y)) * 0.5; return s; };
  const s0 = stateOf(e0), seen = new Set([s0.key]), open = [{ e: e0, st: s0, f: h(e0), d: 0, path: null }]; let n = 0; greedy.route = null;
  while (open.length && n < cap) { let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i; const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop(); n++;
    for (const [l, ne] of edges(cur.e, cur.st)) { const path = { l, up: cur.path }; if (ne.state === 'won') { const labs = []; for (let q = path; q; q = q.up) labs.push(q.l); greedy.route = expand(lv, labs.reverse()); greedy.decisions = labs.filter(x => x.includes(':')).length; return n; }
      if (ne.state !== 'playing') continue; const st = stateOf(ne); if (seen.has(st.key)) continue; seen.add(st.key); open.push({ e: ne, st, f: h(ne) + (cur.d + 1) * 0.5, d: cur.d + 1, path }); } }
  greedy.seen = seen.size; return cap; }
function score(r) { if (!r.solvable || !r.complete || !r.route) return -1; return r.traps * 12 + r.trapMoves * 1.5 + r.decisions * 2 + Math.log2(r.states) * 3 + r.deadFrac * 30; }
module.exports = { analyse, score, hasMonsters, expand, greedy, stateOf, edges };
if (require.main === module) { const levels = require('../solver/levels.json'); const ids = process.argv[2].split(',').map(Number), cap = +process.argv[3] || 400000;
  for (const i of ids) { const lv = levels[i - 1]; if (hasMonsters(lv)) { console.log(JSON.stringify({ level: i, name: lv.name, skipped: 'monsters' })); continue; }
    const t0 = Date.now(), r = analyse(lv, { maxStates: cap }); r.greedy = greedy(lv); const rt = r.route; delete r.route; console.log(JSON.stringify({ level: i, name: lv.name, ...r, score: +score(Object.assign({ route: rt }, r)).toFixed(1), ms: Date.now() - t0 })); } }
