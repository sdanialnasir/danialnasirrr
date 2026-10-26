// Installs a level lineup into src/game.js (the LEVELS array) and tests/routes.json, after replaying every route on the real
// engine WITH the air clock (each route must win in time). Usage: node install.js lineup.json [--dry]
// lineup.json: array of 30 entries, each either { "keep": <old 1-based index> } (copied as-is with its verified route)
//              or { "name", "time", "hint", "tip"?, "map": [...], "route": "..." }.
const fs = require('fs'), path = require('path'); const ROOT = path.join(__dirname, '..', '..');
const { Engine } = require('../solver/engine.js'); const M = { U: 'up', D: 'down', L: 'left', R: 'right' };
const gp = path.join(ROOT, 'src', 'game.js'), g = fs.readFileSync(gp, 'utf8');
const a = g.indexOf('const LEVELS = ['), b = g.indexOf('\n];', a) + 3; const OLD = eval(g.slice(a + 'const LEVELS = '.length, b - 1));
const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'routes.json'), 'utf8'));
const lineup = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); if (lineup.length !== OLD.length) throw new Error('need ' + OLD.length + ' entries');
function wins(lv, route) { const e = new Engine(lv); for (const c of route) { if (c !== '.') e.press(M[c]); e.step(); if (e.state !== 'playing') break; } return { ok: e.state === 'won', air: +e.oxygen.toFixed(1), state: e.state, cause: e.deathCause }; }
const outL = [], outR = {}; let bad = 0;
lineup.forEach((it, i) => { const n = i + 1; let lv, rt;
  if (it.keep) { lv = OLD[it.keep - 1]; rt = routes[String(it.keep)]; } else { lv = { name: it.name, time: it.time, hint: it.hint, map: it.map }; if (it.tip) lv.tip = it.tip; rt = it.route; }
  if (it.tip !== undefined && it.keep) { lv = Object.assign({}, lv); if (it.tip) lv.tip = it.tip; else delete lv.tip; }
  if (!rt.includes('.')) rt += '.'; // exact-tick routes always contain a wait (tests treat routes without one as macro routes)
  const r = wins(lv, rt); console.log(String(n).padStart(2), (lv.name || '').padEnd(16), it.keep ? 'kept #' + it.keep : 'new', 'len', rt.length, r.ok ? 'WIN air left ' + r.air + '/' + (lv.time * 1.5) : 'FAIL ' + r.state + ' ' + r.cause);
  if (!r.ok) bad++; outL.push(lv); outR[String(n)] = rt; });
if (bad) { console.log(bad + ' route(s) failed: nothing written'); process.exit(1); }
if (process.argv.includes('--dry')) process.exit(0);
const esc = s => JSON.stringify(s);
const txt = outL.map(lv => `{ name: ${esc(lv.name)}, time: ${lv.time}, hint: ${esc(lv.hint || '')}${lv.tip ? ', tip: ' + esc(lv.tip) : ''}, map: [\n${lv.map.map(r => "'" + r + "',").join('\n')}\n]},`).join('\n');
fs.writeFileSync(gp, g.slice(0, a) + 'const LEVELS = [\n' + txt + '\n];' + g.slice(b));
fs.writeFileSync(path.join(ROOT, 'tests', 'routes.json'), JSON.stringify(outR, null, 1) + '\n');
console.log('written: src/game.js LEVELS + tests/routes.json');
