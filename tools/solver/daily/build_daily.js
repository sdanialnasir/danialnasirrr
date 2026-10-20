// Builds a Daily Dive set from its plan file: every entry's waypoint plan (plan.js syntax) is run on the REAL engine,
// the exact-tick route is re-checked with replay.js, `time` is set to route seconds x 3 + 20 (rounded to 5) and the set
// is written WITHOUT plans to <set>.json.
//   Usage: node build_daily.js <set> [k,k,...]     e.g. node build_daily.js daily_a      (rebuild all, or only entries k)
//          node build_daily.js <set> --check       only replay the routes already in <set>.json
//   reads  tools/solver/daily/<set>_plans.json   [{ name, hint, map, plan, aha?, deadlocks? }]
//   writes tools/solver/daily/<set>.json          [{ name, time, hint, map, route }]
// To debug one entry: node ../plan.js --file daily/<set>_plans.json --index k "<plan>" -v
const fs = require('fs'), path = require('path');
const { run } = require('../plan.js'); const { replay } = require('../replay.js');
const set = process.argv[2] || 'daily_a'; const out = path.join(__dirname, set + '.json');
const fmt = (lv, rp, route) => `${lv.name.padEnd(16)} ${(lv.map[0].length + 'x' + lv.map.length).padEnd(6)} moves ${String(route.replace(/\./g, '').length).padStart(3)}  ticks ${String(route.length).padStart(3)} (${(route.length * 0.15).toFixed(1)} s)  ${rp.e.state}  pearls ${rp.e.ballsIn}/${rp.e.ballsTotal}  air left ${Math.round(rp.e.oxygen)}/${lv.time}`;

function main() {
  if (process.argv[3] === '--check') {
    const lvls = JSON.parse(fs.readFileSync(out, 'utf8')); let bad = 0;
    lvls.forEach((lv, i) => { const rp = replay(lv, lv.route); if (rp.e.state !== 'won') bad++; console.log(String(i + 1).padStart(2), fmt(lv, rp, lv.route)); });
    console.log(bad ? bad + ' FAILED' : 'all ' + lvls.length + ' won'); return bad;
  }
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, set + '_plans.json'), 'utf8'));
  const only = process.argv[3] ? process.argv[3].split(',').map(Number) : src.map((_, i) => i + 1);
  let prev = []; try { prev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
  let bad = 0; const res = src.map((s, i) => (prev[i] && prev[i].name === s.name && !only.includes(i + 1) ? prev[i] : null));
  for (const k of only) {
    const s = src[k - 1];
    const r = run({ name: s.name, time: 999, map: s.map }, s.plan, false); const route = r.route + '.';
    const time = Math.max(30, Math.round((route.length * 0.15 * 3 + 20) / 5) * 5);
    const lv = { name: s.name, time, hint: s.hint, map: s.map, route };
    const rp = replay(lv, route);
    if (!(r.ok && rp.e.state === 'won')) { bad++; console.log(String(k).padStart(2), s.name, 'FAILED:', r.msg, rp.e.state); continue; }
    res[k - 1] = lv; console.log(String(k).padStart(2), fmt(lv, rp, route));
  }
  fs.writeFileSync(out, '[\n' + res.filter(Boolean).map(l => JSON.stringify(l)).join(',\n') + '\n]\n');
  return bad;
}
process.exitCode = main() ? 1 : 0;
