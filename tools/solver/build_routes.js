// Turns the waypoint plans in plans.json into exact-tick routes, checks each with replay.js (same semantics as
// tests/play_routes.py) and writes the winners into tests/routes.json.   Usage: node build_routes.js [levels,comma,separated]
const fs = require('fs'), path = require('path');
const { run } = require('./plan.js'); const { replay } = require('./replay.js');
const plans = require('./plans.json'); const routesFile = path.join(__dirname, '..', '..', 'tests', 'routes.json');
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(plans);
let bad = 0;
for (const lv of only) {
  const r = run(+lv, plans[lv], false); let route = r.route + '.';
  if (r.picks) console.log(`level ${lv}: waits picked ${r.picks.join(',')}`);
  const rp = replay(+lv, route); const ok = r.ok && rp.e.state === 'won';
  console.log(`level ${lv}: plan ${r.ok ? 'won' : 'FAILED (' + r.msg + ')'}, replay ${rp.e.state}, ${route.length} ticks, air left ${Math.round(rp.e.oxygen)}/${rp.lv.time}`);
  if (ok) routes[lv] = route; else bad++;
}
const sorted = {}; for (const k of Object.keys(routes).sort((a, b) => a - b)) sorted[k] = routes[k];
fs.writeFileSync(routesFile, JSON.stringify(sorted) + '\n'); process.exitCode = bad ? 1 : 0;
