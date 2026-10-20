// Waypoint plan executor: turns a short human/solver plan into an exact-tick route, running the REAL engine tick by tick.
// Usage: node plan.js <level> "<plan>" [-v]      (-v prints the board after every command)
//        node plan.js --file <levels.json> --index <k 1-based> "<plan>" [-v]   (level object from a file)
// Plan commands (space separated):
//   X,Y      walk/dig to cell (X,Y) (shortest path, recomputed every tick; prefers to keep its direction, horizontal first)
//   X,Y!v    same but prefers vertical moves first
//   m:SEQ    raw moves, one char per tick (U D L R, '.' = wait)
//   w:N      wait N ticks
//   s        wait until nothing is falling
//   R:N/L:N  push (or walk) N times in that direction; fails if the diver does not move
// Prints the exact-tick route (always contains '.') and the final board.
const { Engine, T, MONSTERS } = require('./engine.js'); const levels = require('./levels.json');
const D = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }, NAME = { U: 'up', D: 'down', L: 'left', R: 'right' };
const CH = { [T.EMPTY]: ' ', [T.STEEL]: '#', [T.WALL]: 'W', [T.SAND]: '.', [T.ROCK]: 'R', [T.BALL]: 'B', [T.GATE]: 'E', [T.AIR]: 'A', [T.PLAYER]: 'P', [T.FISH]: 'F', [T.JELLY]: 'J', [T.CRAB]: 'C', [T.SPIKE]: 'S' };
function show(e) { const rows = []; for (let y = 0; y < e.h; y++) { let s = ''; for (let x = 0; x < e.w; x++) { let c = CH[e.get(x, y)]; if (c === 'E' && e.gate.open) c = 'O'; s += c; } rows.push(s + '  ' + y); }
  let hdr = ''; for (let x = 0; x < e.w; x++) hdr += x % 10; return hdr + '\n' + rows.join('\n') + `\ntick ${e.tick} air ${e.oxygen.toFixed(1)} balls ${e.ballsIn}/${e.ballsTotal} state ${e.state} ${e.deathCause || ''}`; }
function passable(e, x, y, tx, ty) { const t = e.get(x, y); if (t === T.EMPTY || t === T.SAND || t === T.AIR || t === T.PLAYER) return true; if (t === T.GATE) return e.gate.open && x === tx && y === ty; return false; }
function nextDir(e, tx, ty, last, vfirst) {
  const W = e.w, H = e.h, dist = new Int32Array(W * H).fill(-1); const q = [ty * W + tx]; dist[ty * W + tx] = 0; let qi = 0;
  while (qi < q.length) { const c = q[qi++], cx = c % W, cy = (c / W) | 0; for (const k in D) { const nx = cx + D[k][0], ny = cy + D[k][1]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (dist[n] >= 0 || !passable(e, nx, ny, tx, ty)) continue; dist[n] = dist[c] + 1; q.push(n); } }
  const p = e.player, pd = dist[p.y * W + p.x]; if (pd < 0) return null; if (pd === 0) return '';
  const order = vfirst ? ['U', 'D', 'L', 'R'] : ['L', 'R', 'U', 'D']; if (last) order.unshift(last);
  for (const k of order) { const nx = p.x + D[k][0], ny = p.y + D[k][1]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; if (dist[ny * W + nx] === pd - 1) return k; }
  return null; }
const falling = e => { for (const o of e.objects.values()) if (o.falling) return true; return false; };
function run(level, plan, verbose) {
  const toks = plan.trim().split(/\s+/); const qi = toks.findIndex(t => /^w:\?/.test(t));
  if (qi >= 0) { let best = null, evals = 0;
    // depth-first over the '?' waits: each choice must get through its segment (up to the next '?') alive
    const dfs = (t, picks) => { const i = t.findIndex(x => /^w:\?/.test(x)); if (i < 0) return null; const m = t[i].match(/^w:\?(\d+)-(\d+)$/);
      let j = t.findIndex((x, n) => n > i && /^w:\?/.test(x)); const last = j < 0; if (last) j = t.length;
      for (let k = +m[1]; k <= +m[2] && evals < 200000; k++) { const t2 = t.slice(); t2[i] = 'w:' + k; evals++;
        const r = run(level, t2.slice(0, j).join(' '), false); r.picks = picks.concat([k]);
        if (!best || score(r) > score(best)) best = r;
        if (last) { if (r.ok) return r; continue; }
        if (r.done !== j || r.e.state === 'dead') continue;
        if (r.e.state === 'won') return r;
        const sub = dfs(t2, r.picks); if (sub) return sub; }
      return null; };
    best = dfs(toks, []) || best;
    if (verbose) { const t2 = toks.slice(); let j = 0; for (let i = 0; i < t2.length; i++) if (/^w:\?/.test(t2[i])) t2[i] = 'w:' + best.picks[j++]; console.log('picked waits', best.picks.join(','), '->', t2.join(' ')); return Object.assign(run(level, t2.join(' '), true), { picks: best.picks }); }
    return best; }
  const e = new Engine(typeof level === 'object' ? level : levels[level - 1]); let route = ''; const tick = c => { if (c !== '.') e.press(NAME[c]); e.step(); route += c; return e.state; };
  let done = 0; const fail = (msg) => ({ ok: false, msg, route, e, done });
  for (const cmd of toks) {
    if (e.state !== 'playing') break;
    let m;
    if ((m = cmd.match(/^(\d+),(\d+)(!v)?$/))) { const tx = +m[1], ty = +m[2]; let last = null, stuck = 0;
      for (let guard = 0; guard < 400 && e.state === 'playing'; guard++) { const p = e.player; if (p.x === tx && p.y === ty) break;
        const d = nextDir(e, tx, ty, last, !!m[3]); if (d === null) { if (++stuck > 12) return fail(`no path to ${tx},${ty} from ${p.x},${p.y}`); tick('.'); continue; }
        const x0 = p.x, y0 = p.y; tick(d); last = d; if (e.state === 'playing' && e.player.x === x0 && e.player.y === y0) { if (++stuck > 12) return fail(`stuck going to ${tx},${ty}`); } }
    } else if ((m = cmd.match(/^m:([UDLR.]+)$/))) { for (const c of m[1]) { if (tick(c) !== 'playing') break; } }
    else if ((m = cmd.match(/^w:(\d+)$/))) { for (let i = 0; i < +m[1] && tick('.') === 'playing'; i++); }
    else if (cmd === 's') { for (let i = 0; i < 30 && falling(e) && tick('.') === 'playing'; i++); }
    else if ((m = cmd.match(/^([UDLR]):(\d+)$/))) { for (let i = 0; i < +m[2]; i++) { const x0 = e.player.x, y0 = e.player.y; if (tick(m[1]) !== 'playing') break; if (e.player.x === x0 && e.player.y === y0) return fail(`${cmd}: did not move at step ${i}`); } }
    else return fail('bad command ' + cmd);
    if (verbose) console.log('after ' + cmd + '\n' + show(e) + '\n');
    if (e.state === 'dead') return fail(`died (${e.deathCause}) during ${cmd}`);
    done++;
  }
  if (e.state === 'playing') { for (let k = 0; k < 10 && e.state === 'playing'; k++) e.step(); }
  return { ok: e.state === 'won', msg: e.state, route, e, done };
}
function score(r) { let mon = 0; for (const o of r.e.objects.values()) if (MONSTERS.has(o.t)) mon++; return (r.ok ? 1e9 : 0) + r.done * 1e5 + r.e.ballsIn * 1e3 - mon * 10 - r.route.length * 1e-3; }
module.exports = { run, show };
if (require.main === module) {
  let [, , lv, plan, flag] = process.argv;
  if (lv === '--file') { const [, , , file, , k, p2, f2] = process.argv; lv = JSON.parse(require('fs').readFileSync(file, 'utf8'))[+k - 1]; plan = p2; flag = f2; } else lv = +lv;
  const r = run(lv, plan, flag === '-v');
  console.log(show(r.e)); console.log(r.ok ? 'WON' : 'FAIL: ' + r.msg); if (r.picks) { let j = 0; console.log('waits', r.picks.join(','), '\nresolved plan:', plan.trim().split(/\s+/).map(t => /^w:\?/.test(t) ? 'w:' + r.picks[j++] : t).join(' ')); } console.log('route(' + (r.route + '.').length + '): ' + r.route + '.');
}
