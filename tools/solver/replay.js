// Replays a route against the real engine with EXACTLY the semantics of tests/play_routes.py:
//   - if the route contains '.', it is an exact-tick route: every char is one tick ('.' = wait, U/D/L/R = move);
//   - otherwise every move is followed by up to 6 settle ticks while anything is still falling;
//   - after the route, up to 10 more ticks run (so a final step into the gate can complete).
// Usage: node replay.js <level 1-30> "<ROUTE>"   |   node replay.js <level> --routes   (route from tests/routes.json)
const { Engine } = require('./engine.js'); const levels = require('./levels.json');
function replay(idx, seq) {
  const lv = levels[idx - 1]; const e = new Engine(lv);
  const M = { U: 'up', D: 'down', L: 'left', R: 'right' }; let n = 0; const exact = seq.includes('.');
  for (const c of seq) {
    if (c !== '.') e.press(M[c]); e.step(); n++;
    if (!exact) for (let k = 0; k < 6 && e.state === 'playing'; k++) { let mv = false; for (const o of e.objects.values()) if (o.falling) mv = true; if (!mv) break; e.step(); n++; }
    if (e.state !== 'playing') break;
  }
  for (let k = 0; k < 10 && e.state === 'playing'; k++) e.step();
  return { lv, e, n };
}
module.exports = { replay };
if (require.main === module) {
  let [, , idx, seq] = process.argv;
  if (seq === '--routes') seq = require('../../tests/routes.json')[idx];
  const { lv, e, n } = replay(+idx, seq);
  console.log(lv.name, e.state, e.deathCause || '', 'balls', e.ballsIn + '/' + e.ballsTotal, 'player', e.player ? [e.player.x, e.player.y] : null, 'ticks', n, 'air', Math.round(e.oxygen) + '/' + lv.time);
  process.exitCode = e.state === 'won' ? 0 : 1;
}
