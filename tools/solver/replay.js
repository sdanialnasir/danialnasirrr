const { Engine } = require('./engine.js'); const levels = require('./levels.json');
const [, , idx, seq] = process.argv; const lv = levels[+idx - 1]; const e = new Engine(lv);
const M = { U: 'up', D: 'down', L: 'left', R: 'right' }; let n = 0;
for (const c of seq) { e.press(M[c]); e.step(); n++; for (let k = 0; k < 6 && e.state === 'playing'; k++) { let mv = false; for (const o of e.objects.values()) if (o.falling) mv = true; if (!mv) break; e.step(); n++; } if (e.state !== 'playing') break; }
for (let k = 0; k < 8 && e.state === 'playing'; k++) e.step();
console.log(lv.name, e.state, e.deathCause || '', 'balls', e.ballsIn + '/' + e.ballsTotal, 'player', e.player ? [e.player.x, e.player.y] : null, 'ticks', n, 'air', Math.round(e.oxygen) + '/' + lv.time);
