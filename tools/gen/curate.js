// Reads generator output (*.jsonl), keeps the best room of each run, re-checks it and reports what a player would face.
// Usage: node curate.js <dir> [minScore]
const fs = require('fs'), path = require('path'); const { Engine, T } = require('../solver/engine.js'); const { greedy, analyse } = require('./exact.js');
const M = { U: 'up', D: 'down', L: 'left', R: 'right' }; const dir = process.argv[2], minS = +process.argv[3] || 0;
const best = new Map(); for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) { if (!l.trim()) continue; const r = JSON.parse(l); const k = f + ':' + r.seed; if (!best.has(k) || best.get(k).score < r.score) best.set(k, r); }
const out = [];
for (const [k, r] of best) { if (r.score < minS) continue; const lv = { name: 'g', time: 999, map: r.map }; const e = new Engine(lv); e.relaxed = true; let fallMoves = 0, waits = 0;
  for (const c of r.route) { let falling = false; for (const o of e.objects.values()) if ((o.t === T.ROCK || o.t === T.BALL) && o.falling) falling = true; if (c === '.') waits++; else if (falling) fallMoves++; if (c !== '.') e.press(M[c]); e.step(); }
  const won = e.state === 'won'; const cnt = ch => r.map.join('').split(ch).length - 1;
  out.push({ k, score: r.score, len: r.len, dec: r.decisions, greedy: r.greedy, fallMoves, waits, won, pearls: cnt('B'), stones: cnt('R'), sand: cnt('.'), map: r.map, route: r.route }); }
out.sort((a, b) => a.score - b.score);
for (const o of out) console.log(JSON.stringify({ k: o.k, score: o.score, len: o.len, dec: o.dec, greedy: o.greedy, fallMoves: o.fallMoves, won: o.won, B: o.pearls, R: o.stones, S: o.sand }));
fs.writeFileSync(path.join(dir, 'curated.json'), JSON.stringify(out, null, 1));
