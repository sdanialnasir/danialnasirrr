;(function(){
// Deep Current — core grid simulation (Boulder Dash family rules, underwater flavour)
// Pure logic, no DOM. Runs in Node (tests/solver) and in the browser (game).

const T = {
  EMPTY: 0, STEEL: 1, WALL: 2, SAND: 3, ROCK: 4, BALL: 5, GATE: 6, AIR: 7, PLAYER: 8, FISH: 9, JELLY: 10, CRAB: 11, SPIKE: 12,
};
const LEGEND = {
  ' ': T.EMPTY, '#': T.STEEL, 'W': T.WALL, '.': T.SAND, 'R': T.ROCK, 'B': T.BALL, 'E': T.GATE, 'A': T.AIR,
  'P': T.PLAYER, 'F': T.FISH, 'J': T.JELLY, 'C': T.CRAB, 'X': T.ROCK, 'S': T.SPIKE,
};
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// Cells that a falling object slides off (rounded tops)
const ROUNDED = new Set([T.ROCK, T.BALL, T.GATE, T.WALL]);
const HEAVY = new Set([T.ROCK, T.BALL]);
const MONSTERS = new Set([T.FISH, T.JELLY, T.CRAB]);

let NEXT_ID = 1;

class Engine {
  constructor(level) {
    this.load(level);
  }

  load(level) {
    const rows = level.map;
    this.w = Math.max(...rows.map(r => r.length));
    this.h = rows.length;
    this.name = level.name || '';
    this.tickMs = level.tickMs || 225;  // one game tick (was 150 ms): diver, stones and monsters all share it
    this.tscale = this.tickMs / 150;     // level air times were tuned for 150 ms ticks: scale them so difficulty stays the same
    this.time = (level.time || 120) * this.tscale;      // oxygen in seconds
    this.oxygen = this.time;
    this.grid = new Array(this.w * this.h).fill(T.EMPTY);
    this.water = new Uint8Array(this.w * this.h); // 1 = open water at level start (monsters stay in open water)
    this.obj = new Array(this.w * this.h).fill(null); // dynamic object per cell
    this.objects = new Map();
    this.ballsTotal = 0; this.ballsIn = 0;
    this.player = null;
    this.gate = null;
    this.tick = 0;
    this.state = 'playing'; // playing | won | dead
    this.deathCause = null;
    this.events = [];   // transient events for the renderer (sounds, particles)
    this.moveQueue = [];
    this.held = null;
    this.playerDir = 1; // facing (1 right, -1 left)
    this.lastMoved = false;
    this.diedAt = -1;
    this.wonAt = -1;
    this.score = 0;
    this.dug = 0;
    for (let y = 0; y < this.h; y++) {
      const row = rows[y];
      for (let x = 0; x < this.w; x++) {
        const ch = row[x] ?? '#';
        const t = LEGEND[ch] ?? T.STEEL;
        this.set(x, y, t);
        if (t === T.ROCK || t === T.BALL || MONSTERS.has(t) || t === T.PLAYER) {
          const o = { id: NEXT_ID++, t, x, y, px: x, py: y, falling: false, dir: t === T.FISH ? 2 : 0, age: 0, dead: false, moved: 0, skin: ch === 'X' ? 'crate' : null };
          if (t === T.BALL) this.ballsTotal++;
          if (t === T.PLAYER) { this.player = o; }
          if (t === T.JELLY) o.dir = 1; // 1 down, 3 up
          if (t === T.CRAB) o.dir = 0;  // 0 right, 2 left
          this.objects.set(o.id, o);
          this.obj[y * this.w + x] = o;
        }
        if (t === T.GATE) this.gate = { x, y, open: false };
      }
    }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const t = this.get(x, y);
      if (t === T.EMPTY || MONSTERS.has(t)) this.water[y * this.w + x] = 1;
    }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const t = this.get(x, y);
      if ((t === T.BALL || t === T.ROCK || t === T.PLAYER) && (this.isWater(x - 1, y) || this.isWater(x + 1, y) || this.isWater(x, y - 1) || this.isWater(x, y + 1))) this.water[y * this.w + x] = 1;
    }
    if (this.ballsTotal === 0 && this.gate) this.gate.open = true;
  }

  isWater(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false; return this.water[y * this.w + x] === 1; }
  get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.STEEL; return this.grid[y * this.w + x]; }
  set(x, y, t) { this.grid[y * this.w + x] = t; }
  objAt(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null; return this.obj[y * this.w + x]; }
  emit(type, data) { this.events.push(Object.assign({ type }, data)); }

  moveObj(o, nx, ny) {
    this.obj[o.y * this.w + o.x] = null;
    this.set(o.x, o.y, T.EMPTY);
    o.px = o.x; o.py = o.y; o.x = nx; o.y = ny; o.moved = this.tick;
    this.obj[ny * this.w + nx] = o;
    this.set(nx, ny, o.t);
  }
  removeObj(o) {
    if (this.obj[o.y * this.w + o.x] === o) { this.obj[o.y * this.w + o.x] = null; this.set(o.x, o.y, T.EMPTY); }
    o.dead = true; this.objects.delete(o.id);
  }

  // ---- input -------------------------------------------------------------
  // dir: 'up'|'down'|'left'|'right'|null. `queue` = one-shot press, `held` = continuous.
  press(dir) { if (!this.moveQueue) this.moveQueue = []; if (this.moveQueue.length < 3) this.moveQueue.push(dir); }
  hold(dir) { this.held = dir; }

  selfDestruct() { if (this.state === 'playing') this.die('self'); }

  die(cause) {
    if (this.state !== 'playing') return;
    this.state = 'dead'; this.deathCause = cause; this.diedAt = this.tick;
    if (this.player) { this.emit('playerDeath', { x: this.player.x, y: this.player.y, cause }); this.removeObj(this.player); this.player = null; }
  }

  // ---- step --------------------------------------------------------------
  step() {
    this.events.length = 0;
    this.tick++;
    if (this.state !== 'playing') { this.physics(); this.monsters(); return; }

    // oxygen (relaxed mode, an accessibility option, never runs out)
    // the air clock starts with the player's first move, so reading the level (or a tutorial) costs nothing
    if (!this.begun && (this.moveQueue.length || this.held)) { this.begun = true; this.begunAt = this.tick - 1; }
    if (!this.relaxed && this.begun) this.oxygen -= this.tickMs / 1000;
    if (this.oxygen <= 0) { this.oxygen = 0; this.die('oxygen'); return; }

    // player
    const dir = (this.moveQueue && this.moveQueue.shift()) || this.held;
    this.lastMoved = false;
    const p = this.player;
    p.px = p.x; p.py = p.y;
    if (dir) this.movePlayer(dir);

    this.physics();
    this.monsters();
  }

  movePlayer(dir) {
    const p = this.player;
    const [dx, dy] = DIRS[dir];
    if (dx) this.playerDir = dx;
    const nx = p.x + dx, ny = p.y + dy;
    const t = this.get(nx, ny);
    if (t === T.EMPTY) { this.moveObj(p, nx, ny); this.lastMoved = true; return; }
    if (t === T.SAND) { this.set(nx, ny, T.EMPTY); this.dug++; this.score += 1; this.emit('dig', { x: nx, y: ny }); this.moveObj(p, nx, ny); this.lastMoved = true; return; }
    if (t === T.AIR) { this.set(nx, ny, T.EMPTY); this.oxygen = Math.min(this.time, this.oxygen + 30 * this.tscale); this.score += 50; this.emit('air', { x: nx, y: ny }); this.moveObj(p, nx, ny); this.lastMoved = true; return; }
    if (t === T.GATE) {
      if (this.gate.open) { this.state = 'won'; this.wonAt = this.tick; this.score += Math.round(this.oxygen) * 10 + 500; this.emit('win', { x: nx, y: ny }); this.moveObj(p, nx, ny); }
      else this.emit('gateLocked', { x: nx, y: ny });
      return;
    }
    if (MONSTERS.has(t)) { this.die('monster'); return; }
    if (t === T.SPIKE) { this.die('spiked'); return; }
    if (HEAVY.has(t) && dy === 0) {
      const o = this.objAt(nx, ny);
      if (o.falling || this.get(nx, ny + 1) === T.EMPTY) return; // can't push something that is falling / unsupported
      const bx = nx + dx, by = ny;
      const bt = this.get(bx, by);
      if (bt === T.EMPTY) {
        this.moveObj(o, bx, by); this.emit('push', { x: bx, y: by, t: o.t });
        this.moveObj(p, nx, ny); this.lastMoved = true;
      } else if (bt === T.GATE && o.t === T.BALL) {
        this.absorb(o, bx, by);
        this.moveObj(p, nx, ny); this.lastMoved = true;
      }
      return;
    }
    // blocked
    this.emit('bump', { x: nx, y: ny });
  }

  absorb(ball, gx, gy) {
    this.emit('absorb', { x: gx, y: gy, fromX: ball.x, fromY: ball.y, id: ball.id });
    this.removeObj(ball);
    this.ballsIn++; this.score += 200;
    if (this.ballsIn >= this.ballsTotal) { this.gate.open = true; this.emit('gateOpen', { x: gx, y: gy }); }
  }

  // Boulder-dash style physics, scanned bottom-up so a column of rocks falls together.
  physics() {
    const w = this.w;
    for (let y = this.h - 2; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        const o = this.obj[y * w + x];
        if (!o || !HEAVY.has(o.t) || o.moved === this.tick) continue;
        o.px = o.x; o.py = o.y;
        const below = this.get(x, y + 1);
        if (below === T.EMPTY) { o.fallN = o.falling ? (o.fallN || 0) + 1 : 1; o.falling = true; this.moveObj(o, x, y + 1); continue; }
        if (o.falling) {
          // landing on something
          const victim = this.objAt(x, y + 1);
          // grace: something that has dropped only one cell onto the diver teeters for one tick first, so a quick sideways
          // step (e.g. right after pulling a plug from below) saves you. Monsters get no grace.
          if (victim && victim.t === T.PLAYER && o.fallN === 1 && !o.graced) { o.graced = true; this.emit('teeter', { x, y, id: o.id }); continue; }
          if (victim && (victim.t === T.PLAYER || MONSTERS.has(victim.t))) {
            if (victim.t === T.PLAYER) { this.die('crushed'); }
            else { this.emit('monsterDeath', { x: victim.x, y: victim.y, t: victim.t }); this.score += 100; this.removeObj(victim); }
            this.moveObj(o, x, y + 1);
            continue;
          }
        }
        if (below === T.GATE && o.t === T.BALL) { o.falling = false; this.absorb(o, x, y + 1); continue; }
        // roll off rounded things
        if (ROUNDED.has(below) || (below === T.GATE)) {
          if (this.get(x - 1, y) === T.EMPTY && this.get(x - 1, y + 1) === T.EMPTY && !this.objAt(x - 1, y + 1)) {
            o.falling = true; o.fallN = 0; this.moveObj(o, x - 1, y); this.emit('roll', { x: x - 1, y }); continue;
          }
          if (this.get(x + 1, y) === T.EMPTY && this.get(x + 1, y + 1) === T.EMPTY && !this.objAt(x + 1, y + 1)) {
            o.falling = true; o.fallN = 0; this.moveObj(o, x + 1, y); this.emit('roll', { x: x + 1, y }); continue;
          }
        }
        if (o.falling) { o.falling = false; o.fallN = 0; o.graced = false; this.emit('land', { x, y, t: o.t }); }
      }
    }
  }

  monsters() {
    for (const o of Array.from(this.objects.values())) {
      if (!MONSTERS.has(o.t) || o.dead) continue;
      o.age++;
      o.px = o.x; o.py = o.y;
      if (o.t === T.FISH) {
        // piranha: patrols along walls; when it sees the diver down a clear row or column it charges at full speed
        // it patrols its home water; it only leaves when it charges you down a clear row
        const p = this.player; let charge = null;
        if (p && p.y === o.y) {
          const dx = Math.sign(p.x - o.x); const dist = Math.abs(p.x - o.x);
          if (dist <= 9) { charge = dx; for (let k = 1; k < dist; k++) if (this.get(o.x + dx * k, o.y) !== T.EMPTY) { charge = null; break; } }
        }
        if (charge && !(o.cool > 0)) {
          o.hunting = true; o.dir = charge === 1 ? 0 : 2;
          if (this.tryMonsterStep(o, o.x + charge, o.y)) { if (!this.isWater(o.x, o.y)) o.escaped = true; }
          else o.cool = 8; // something is in the way: give up and patrol for a while
        } else {
          if (o.cool > 0) o.cool--;
          o.hunting = false;
          if (o.age % 2) continue;
          this.fishMove(o);
        }
      } else if (o.t === T.JELLY) {
        // drifts up/down; when the diver is in its column with clear water between, it surges toward them
        const p = this.player; let surge = false;
        if (p && p.x === o.x && Math.abs(p.y - o.y) <= 6) { const d = Math.sign(p.y - o.y); surge = true; for (let y = o.y + d; y !== p.y; y += d) if (this.get(o.x, y) !== T.EMPTY) { surge = false; break; } if (surge) o.dir = d > 0 ? 1 : 3; }
        if (o.age % (surge ? 2 : 3)) continue;
        this.bounce(o, [1, 3]);
      } else if (o.t === T.CRAB) {
        const p = this.player; let rush = false;
        if (p && p.y === o.y && Math.abs(p.x - o.x) <= 7) { const d = Math.sign(p.x - o.x); rush = true; for (let x = o.x + d; x !== p.x; x += d) if (this.get(x, o.y) !== T.EMPTY) { rush = false; break; } if (rush) o.dir = d > 0 ? 0 : 2; }
        if (!rush && o.age % 2) continue;
        this.bounce(o, [0, 2]);
      }
    }
  }

  // BFS through open water from a monster to the diver; returns the list of cells to step through (excluding start)
  huntPath(o, maxLen) {
    const p = this.player; const W = this.w;
    const start = o.y * W + o.x, goal = p.y * W + p.x;
    const prev = new Int32Array(this.grid.length).fill(-1); prev[start] = start;
    const q = [start]; let qi = 0; const dist = new Int32Array(this.grid.length); 
    while (qi < q.length) {
      const c = q[qi++]; if (c === goal) break;
      if (dist[c] >= maxLen) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= this.h) continue;
        const n = ny * W + nx; if (prev[n] !== -1) continue;
        const t = this.grid[n]; if (t !== T.EMPTY && n !== goal) continue;
        prev[n] = c; dist[n] = dist[c] + 1; q.push(n);
      }
    }
    if (prev[goal] === -1) return null;
    const path = []; for (let c = goal; c !== start; c = prev[c]) path.push([c % W, (c / W) | 0]);
    return path.reverse();
  }

  // Player is killed when a monster is adjacent-and-moving-in, or shares the cell.
  tryMonsterStep(o, nx, ny) {
    const t = this.get(nx, ny);
    if (t === T.PLAYER) { this.die('monster'); this.moveObj(o, nx, ny); return true; }
    if (t !== T.EMPTY) return false;
    this.moveObj(o, nx, ny);
    return true;
  }

  // wall-follower (keeps a wall on its right), like a Boulder Dash firefly
  fishMove(o) {
    const D = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up (clockwise)
    const right = (o.dir + 1) % 4;
    const tryDir = d => this.tryMonsterStep(o, o.x + D[d][0], o.y + D[d][1]);
    const free = d => { const x = o.x + D[d][0], y = o.y + D[d][1]; const t = this.get(x, y); return t === T.PLAYER || (t === T.EMPTY && (o.escaped || this.isWater(x, y))); };
    if (free(right)) { o.dir = right; tryDir(right); return; }
    if (free(o.dir)) { tryDir(o.dir); return; }
    const left = (o.dir + 3) % 4;
    if (free(left)) { o.dir = left; tryDir(left); return; }
    o.dir = (o.dir + 2) % 4;
    if (free(o.dir)) tryDir(o.dir);
  }

  bounce(o, axes) {
    const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    if (!this.tryMonsterStep(o, o.x + D[o.dir][0], o.y + D[o.dir][1])) {
      o.dir = axes[0] === o.dir ? axes[1] : axes[0];
      this.tryMonsterStep(o, o.x + D[o.dir][0], o.y + D[o.dir][1]);
    }
  }

  // Compact serialisation of the static+dynamic state for solvers (ignores monsters' age)
  key() {
    let s = '';
    for (let i = 0; i < this.grid.length; i++) s += String.fromCharCode(48 + this.grid[i]);
    return s + '|' + this.ballsIn;
  }
}

function parseLevels(src) { return src; }

Engine.prototype.clone = function () {
  const e = Object.create(Engine.prototype);
  Object.assign(e, this);
  e.grid = this.grid.slice();
  e.moveQueue = (this.moveQueue || []).slice();
  e.obj = new Array(this.obj.length).fill(null);
  e.objects = new Map();
  e.events = [];
  for (const [id, o] of this.objects) { const c = Object.assign({}, o); e.objects.set(id, c); e.obj[c.y * e.w + c.x] = c; }
  e.player = this.player ? e.objects.get(this.player.id) : null;
  e.gate = this.gate ? Object.assign({}, this.gate) : null;
  return e;
};
Engine.prototype.fullKey = function () {
  let s = this.key();
  for (const o of this.objects.values()) if (o.t >= 9) s += '|' + o.id + ':' + o.dir + ':' + (o.age % 6);
  return s;
};

// Deep Current — 30 levels
// Legend: # steel  W rock wall  . sand  (space) water  R stone  B energy ball  E energizer gate
//         P diver  F piranha (hunts)  J jellyfish (vertical)  C crab (horizontal)  A air capsule
// `time` is oxygen in seconds. Every level is verified winnable by tools/verify.js.
const LEVELS = [
{ name: "First Light", time: 60, hint: "Dig a **tunnel to the gate** first, then roll the pearl along it and swim in after it.", map: [
'############',
'#P.........#',
'#..........#',
'#...B......#',
'#....WW....#',
'#.........E#',
'############',
]},
{ name: "Pinned", time: 45, hint: "Dig **under** the pearl, then **step aside** at once. Never wait below anything that can fall.", intro: { ic: 'stone', k: 'New', t: 'Falling stones', d: 'Dig the sand away and they drop. **Never stand right under one!**' }, map: [
'##############',
'#P.......WWWW#',
'#WWWW....RWWW#',
'#WWWW....BWWW#',
'#  W......WWW#',
'#  W.WWWW WWW#',
'#  W.....EWWW#',
'##############',
]},
{ name: "The Shaft", time: 45, hint: "Whatever drops first rolls **left into the pit**. Decide which one you want down there.", intro: { ic: 'stone', k: 'Good to know', t: 'Round tops roll', d: 'Falling stones and pearls slide off round things, **left first**.' }, map: [
'##############',
'#P...........#',
'#...B   R....#',
'#WWWWW WWWWWW#',
'#WWWW   WWWWW#',
'#WWWW W WWWWW#',
'#WWWWWWEWWWWW#',
'##############',
]},
{ name: "Two Roads", time: 45, hint: "Open the **low road** first. Pulled a plug from below? **Step aside** at once!", map: [
'##############',
'#P.....  ....#',
'#.WW...B...W #',
'#.WWWWW.WWWW #',
'#..B        E#',
'#WWWWWWWWWWWW#',
'##############',
]},
{ name: "Piranha Pit", time: 55, hint: "Time it: drop the **stone down the shaft** just as the piranha swims underneath.", intro: { ic: 'fish', k: 'New creature', t: 'Piranha', d: 'Patrols the water and **charges** the moment it sees you.' }, map: [
'################',
'#....   ..   ..#',
'#.......WW....P#',
'#W R.B..WWWWWWW#',
'#W .W.W.WWWWWWW#',
'#W F ...      E#',
'#WWWWWWWWWWWWWW#',
'################',
]},
{ name: "Jelly Shaft", time: 50, hint: "The jellyfish **surges** when you're in its column. Wait until it's **far away**, then cross.", intro: { ic: 'jelly', k: 'New creature', t: 'Jellyfish', d: 'Drifts up and down its shaft, and **surges** when you line up with it.' }, map: [
'##############',
'#P....WJW....#',
'#...... W....#',
'#WWWWWW .....#',
'#WWWWWW WWWW.#',
'#WWWWWW WWWW.#',
'#E         B.#',
'##############',
]},
{ name: "Keystone", time: 55, hint: "The road has a **hole**. Anything pushed over it drops in, so **fill it first**.", map: [
'################',
'#P....WRW......#',
'#.WWW.W.W.WWWW.#',
'#.B           E#',
'#WWWWWWWW WWWWW#',
'#WWWWWWWWWWWWWW#',
'################',
]},
{ name: "Pitfall", time: 55, hint: "A pearl pressed **against a wall** can never be pushed again. Choose where it lands.", map: [
'################',
'#WW..........WW#',
'#W   B        P#',
'#W WWWWWWW WWWW#',
'#W WW....W ....#',
'#W WWWWWWW ....#',
'#W            E#',
'#WWWWWWWWWWWWWW#',
'################',
]},
{ name: "Ambush", time: 70, hint: "Push the pearl ahead **as a shield**, then slip down the hole while the crab is **at the far end**.", intro: { ic: 'crab', k: 'New creature', t: 'Crab', d: 'Scuttles back and forth along the open water. **Stay out of its path.**' }, map: [
'##################',
'#W...B..........P#',
'#......W....W....#',
'# WWW WWWWWWWWWWW#',
'#             C  #',
'#WWWWWWWWW WWWWWW#',
'#WWW...... ......#',
'#E         ......#',
'#WWWWWWWWWWWWWWWW#',
'##################',
]},
{ name: "Stone Bridge", time: 75, hint: "**Three stones** fill the shaft. The pearl crosses **last**.", map: [
'#################',
'#P.....R...WWWWW#',
'#.....W.W.......#',
'#WW...W.W. R....#',
'#.....W.W..WW...#',
'# B  R         E#',
'#WWWWWWWW WWWWWW#',
'#WWWWWWWW WWWWWW#',
'#WWWWWWWW WWWWWW#',
'#################',
]},
{ name: "Counterweight", time: 75, hint: "Every stone sits on **sand**. Dig only under the stones you **really need**.", intro: { ic: 'world2', k: 'World 2', t: 'The Coral Caves', d: 'Tighter caves and trickier drops. **Plan before you dig.**' }, map: [
'##################',
'#               P#',
'#WW.WWRWWWRWWRW.W#',
'#................#',
'# W WW WWW WW WWW#',
'# B           EWW#',
'#WWWWWWWWW WWWWWW#',
'#WWWWWWWWW WWWWWW#',
'##################',
]},
{ name: "Air Supply", time: 55, hint: "Take capsules **after** the pearls pass. Pulled a plug from below? **Step aside!**", intro: { ic: 'air', k: 'New', t: 'Air capsules', d: 'Swim into one for **+45 seconds** of air.' }, map: [
'######################',
'#....WWWWWWWWWWWWW...#',
'#P.B.B             ..#',
'#WWWWWWWWAWWWWWWWW W.#',
'#WWWWWWWW W.WRW... W.#',
'#W.......W...A.... W.#',
'#W.                ..#',
'#WA WWWWWWWWWWWWWWWWW#',
'#W.                 E#',
'######################',
]},
{ name: "Trapdoor", time: 110, hint: "When the trapdoor opens, the **stones beside it follow** the pearl down. Decide where they go.", map: [
'####################',
'#P.................#',
'#...RBR.WWWWWWWWW..#',
'#WW.W.W.WWWWWWWWW..#',
'#WW W WWWWWWWWWWW..#',
'#WW W WWWWWBWWWWW..#',
'#WWWW  ............#',
'#WWWWE WWWWWWWWWWWW#',
'####################',
]},
{ name: "Crossfire", time: 115, hint: "The left well holds **exactly two stones**. Pick the right two before you drop any.", intro: { ic: 'fish', k: 'Twist', t: 'Two piranhas', d: 'Two hunters at once: **watch both rows.**' }, map: [
'####################',
'#P....R..W.........#',
'#............W.....#',
'#.B..R ...R.. ..B..#',
'#WWWWW WWWWWW WWWWW#',
'#WWWWWFWWWWWW WWWWW#',
'#WWWWWWWWWWWW WWWWW#',
'#WWWWWWWWWWWWFWWWWW#',
'#WWWWWWWWWWWWEWWWWW#',
'####################',
]},
{ name: "Avalanche", time: 190, hint: "Every stone needs **a home of its own**. Count them before you empty a silo.", map: [
'####################',
'#P.................#',
'#........WWW.......#',
'#WW.WWWW.WBW.WWWWWW#',
'#WW.WWBW.WRW.WWWWWW#',
'#WW.WWRW.WRW.WWWWWW#',
'#W....R...R......WW#',
'#WEW WWW WWWW WWWWW#',
'####################',
]},
{ name: "Vault", time: 140, hint: "Two doors, one way out: only one lets the stone escape **without sealing the gate**.", map: [
'####################',
'#P...........R WWWW#',
'#.....WWWWWWWW WWWW#',
'#.WWW.W......W WWWW#',
'#.WWW.W.BW...W WWWW#',
'#.WWW.W.R....WJWWWW#',
'#.....WWWW.W.W WWWW#',
'#.....WWWW W   WWWW#',
'#..B.....  WWW WWWW#',
'#WWWWWWWWWEWWWWWWWW#',
'####################',
]},
{ name: "Switchback", time: 140, hint: "**Two holes** in the road. Stones fill them, but you can only push **from behind**.", map: [
'####################',
'#P..B         R   .#',
'#.WWWWWWWW WWWWWW .#',
'#.WWWWWWRWWWWWWWW .#',
'#       .          #',
'#. WWWWWWWWWWW WWWW#',
'#. WWWWWWWWWWWWWWWW#',
'#.                E#',
'#WWWWWWWWWWWWWWWWWW#',
'####################',
]},
{ name: "Crab Cave", time: 115, hint: "Stones **crush crabs** too. Learn its rhythm, then pull the plug.", intro: { ic: 'crab', k: 'Twist', t: 'Stones crush crabs', d: 'Drop one **as it passes underneath**.' }, map: [
'########################',
'#.................WWWWW#',
'#.WWWWWWWWWWWWWWW.WWWWW#',
'#.WWBWWWWWWWWWWWW.WWWWW#',
'#.WW.WWRWWWWWWWWW.WRWWW#',
'#.WW WW.WWWWWWWWW...WWW#',
'#P................C  EW#',
'#WWWWWWWWWWW WWWWWWW WW#',
'########################',
]},
{ name: "The Pit", time: 130, hint: "The shaft **bends twice**. What drops first decides where the next one rolls.", map: [
'####################',
'#P.................#',
'#.B.R.R....R....B..#',
'#WWWWWWWW WWW WWWWW#',
'#WWWWWWWW WWWWWWWWW#',
'#WWWWWWW   WWWWWWWW#',
'#WWWWWWW W WWWWWWWW#',
'#WWWWWWWW   WWWWWWW#',
'#WWWWWWWW W WWWWWWW#',
'#WWWWWWWWWW WWWWWWW#',
'#WWWWWWWWWWEWWWWWWW#',
'####################',
]},
{ name: "Lockstep", time: 180, hint: "Push the bottom pearl **left, out the back**, so the stone drops in front of you.", map: [
'####################',
'#P.......... ......#',
'#W.WWW.WBWWW WWWW.W#',
'#W.WWW.WBWWWJWWWW.W#',
'#W.WWW.WRWWW WWWW.W#',
'#W......B.........E#',
'#WWWWWWWWWW WWWWWWW#',
'#WWWWWWWWWWWWWWWWWW#',
'####################',
]},
{ name: "Night Shoal", time: 170, hint: "Three piranhas, two stones. **The pearl is a weapon too**, and order is everything.", intro: { ic: 'world3', k: 'World 3', t: 'The Deep', d: 'Darker water, longer dives, **no easy roads**.' }, map: [
'########################',
'#...  R...R  W  B.....P#',
'#WWW WW...WW W WWWWWWW.#',
'#WWWFWWWW.WWFW WWWWWWW.#',
'#WWW WWWW.WW WFWWWWWWW.#',
'#WWW WWWW.WW W WWWWWWW.#',
'#E.....................#',
'#WWW WWWWWWW WWWWWWWWWW#',
'########################',
]},
{ name: "Hourglass", time: 185, hint: "Open the **gate-side valve** first. The near pearl goes **before any stone**.", map: [
'####################',
'#P                 #',
'#  R  B     R B  R #',
'#.WWWWWWWW WWWWWWW.#',
'#..WWWWWWWJWWWWWW..#',
'#W..WWWWWW WWWWW..W#',
'#WW..WWWWW WWWW..WW#',
'#WWW...... .....WWW#',
'#WWWWWWWW W WWWWWWW#',
'#WWWWWWWW WEWWWWWWW#',
'####################',
]},
{ name: "Deep Pressure", time: 40, hint: "Each capsule **props up a stone**. Grab it, step aside at once, and mind where it lands.", map: [
'########################',
'#                      #',
'#W.WRWWWRWRWWRWWWWRWWW #',
'#W.WAWWWAWAWWAWWWWAWWW #',
'#P B                   #',
'#.WWWWWWWW WWWWWWWWWWW #',
'#.WWWWRWWWWWRWWWWRWWWW #',
'#.WWWWAWWWWWAWWWWAWWWW #',
'#  B                  E#',
'#WWWWWWWWWWWWWWWWWWWWWW#',
'########################',
]},
{ name: "Gauntlet", time: 150, hint: "Some shafts sink **below the road**. Not every stone has to fall where it starts.", map: [
'######################',
'#P                  W#',
'#.WWR.WWWWWWR.WWR.W.W#',
'#.WWWJWWW WWWJWWW W.W#',
'#.WWW WWWJWWW WWWJW.W#',
'# B                 E#',
'#WWWW WWWWWWW WWWWWWW#',
'#WWWW WWWWWWWWWWWWWWW#',
'######################',
]},
{ name: "Chain Reaction", time: 175, hint: "**Count each pit.** Leaning stones topple in after their neighbour.", map: [
'######################',
'#P                   #',
'#.WWWW.WBW.WWWW.WWWWW#',
'#.WRRW.WRW.WRRW.WWRWW#',
'#.WRRW.WRW.WRRW.WWRWW#',
'#........W.........WW#',
'#.B       F         E#',
'#WWW WWW WWW WWWWWWWW#',
'#WWW WWW WWW WWWWWWWW#',
'#WWW WWWWWWW WWWWWWWW#',
'######################',
]},
{ name: "Citadel", time: 220, hint: "The vault **tips left** unless that side is sealed. Count every pit before a drop.", map: [
'########################',
'#P                     #',
'#.WWBWW.WWWWWW.WWWWWWW.#',
'#.WWRWW.WWWWWW.WWWWWWW.#',
'#.WW....WWWWWW.WWWWWBW.#',
'#... ...WRWWWW.W RWWRW.#',
'#WW W W.WRWWWW.WRRWWRW.#',
'#WW WWW...WWWW....WW...#',
'#WWE   .. F ... C .   .#',
'#WWWWWWWW WWWWWW WWW WW#',
'#WWWWWWWW WWWWWW WWW WW#',
'########################',
]},
{ name: "Undertow", time: 195, hint: "Falling things crush what's below. **Wait for the monster**, then step out of the notch.", map: [
'########################',
'#P.....................#',
'#............R.........#',
'#.B......R...B.....R...#',
'#.W WWWW.W WW.WWWW WWWW#',
'#. C ..        .     FE#',
'#WWWWWWWWW WWWWWWW WWWW#',
'#WWWWWWWWWWWWWWWWWWWWWW#',
'########################',
]},
{ name: "Abyss", time: 225, hint: "Two deep jellyfish shafts. **Stones go down first**, and count **how deep** each one is.", map: [
'########################',
'#P.....W........W......#',
'#...B.. .R.R.B.. ...R..#',
'#.WWWWW WWWWWWWW WWWWWW#',
'#.WW  WJWW   WWW WW  WW#',
'#.WWWWW WWWWWWWWJWWWWWW#',
'#...... ........ ..... #',
'#WWWWWW WWWWWWWW WWWWW #',
'#WWWWWW WWWWWWWWWWWWWWE#',
'########################',
]},
{ name: "The Energizer", time: 270, hint: "Everything you've learned. Prepare **the deep road** before a single pearl drops.", map: [
'########################',
'#P.....................#',
'#......................#',
'#.B.........R....R...B.#',
'#.W WWWWWWW WWWWWW W W.#',
'#. C ..         .     F#',
'#.WWWWWWWWW WWWWWW WWWW#',
'#.WWWWWWWWWJWWWWWWWWWWW#',
'#.WWWWWWWWW WWWWWWWWWWW#',
'#.......... .....A....E#',
'#WWWWWWWWWW WWWWWWWWWWW#',
'########################',
]},
{ name: "Deep Current", time: 270, hint: "Three pearls, one shaft: **fill it to the road**, free the vault, and **mind the order**.", map: [
'######################',
'#P...................#',
'#.....R.B..R.R.R.B...#',
'#W.WW WWWW.W WWWWWWWW#',
'#W BC  ..W.W WWWWWWWW#',
'#WWWW WW.W.WJWWWWWWWW#',
'#WWWWWW..W.W WWWWWWWW#',
'#WWWWWW..... ...A...E#',
'#WWWWWWWWWWW WWWWWWWW#',
'#WWWWWWWWWWW WWWWWWWW#',
'#WWWWWWWWWWW WWWWWWWW#',
'######################',
]},
];

// Deep Current — procedural audio (no sample files). Ambient bed, generative music, synthesized SFX.
const Audio = (() => {
  let ctx = null, master, musicBus, sfxBus, ambBus, outNode = null; // outNode: what reaches the speakers (after the limiter)
  let started = false, muted = false, musicOn = true;
  let muffF = null, muffG = null, muffK = 0;
  let musicTimer = null, musicStep = 0, sandBuf = null, padBus = null, padF = null, padLayer = null, tension = 0;
  const settings = { music: 0.6, sfx: 0.9 };
  // three player volumes (0..1, the sliders in Settings and on the pause screen): music = the songs, amb = the soft underwater bed
  // (ocean swell, hum, pad, far bubbles), sfx = everything the game does. Squared so the slider feels even to the ear.
  const vol = { music: 0.55, amb: 0.8, sfx: 1 };
  const gMusic = () => musicOn ? 0.6 * vol.music * vol.music : 0, gAmb = () => 0.6 * vol.amb * vol.amb, gSfx = () => 0.9 * vol.sfx * vol.sfx;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 1;
    try { const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.25; master.connect(lim);
      // a soft clipper after it: transparent below -3 dBFS, rounds off anything the limiter's attack lets through (stacked big cues)
      const sc = ctx.createWaveShaper(), N = 2048, cv = new Float32Array(N), K = 0.708; for (let i = 0; i < N; i++) { const x = i / (N - 1) * 2 - 1, a = Math.abs(x); cv[i] = Math.sign(x) * (a <= K ? a : K + (1 - K) * Math.tanh((a - K) / (1 - K))); }
      sc.curve = cv; sc.oversample = '2x'; lim.connect(sc); sc.connect(ctx.destination); outNode = sc; } // a limiter: stacked cues (pearl + gate + swell) never crackle on phone speakers
    catch (er) { master.connect(ctx.destination); }
    // "underwater hearing": music + ambience pass through one low-pass that closes a little while a menu covers the game
    muffF = ctx.createBiquadFilter(); muffF.type = 'lowpass'; muffF.frequency.value = 20000; muffF.Q.value = 0.5; muffG = ctx.createGain(); muffG.gain.value = 1; muffF.connect(muffG); muffG.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = gMusic(); musicBus.connect(muffF);
    sfxBus = ctx.createGain(); sfxBus.gain.value = gSfx(); sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = gAmb(); ambBus.connect(muffF); if (muffK) muffle(muffK);
    // underwater space: a soft generated reverb (stereo decaying noise, darker as it fades) under every sound effect,
    // plus a faint short echo off the tank glass
    try { const n = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lpv = 0, e = 0;
        for (let i = 0; i < n; i++) { const t = i / ctx.sampleRate, a = 0.9 - 0.75 * Math.min(1, t / 1.8); lpv += (Math.random() * 2 - 1 - lpv) * a; d[i] = lpv * Math.exp(-t * 2.6) * Math.min(1, t * 90); e += d[i] * d[i]; }
        const g = 1 / Math.sqrt(e || 1); for (let i = 0; i < n; i++) d[i] *= g; } /* unit energy: the wet level is set by 'wet' alone */
      const conv = ctx.createConvolver(); conv.buffer = ir; const pre = ctx.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 2600;
      const wet = ctx.createGain(); wet.gain.value = (window.AQ_DATA && AQ_DATA.SFX) ? 0.16 : 0.32; sfxBus.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(master); } catch (er) {}
    const delay = ctx.createDelay(0.5); delay.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.12;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1000;
    sfxBus.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
    ambient(); loadFiles();
  }
  // real recordings: src/assets/sfx/<name>.mp3 (variants <name>_2.mp3 ...) replace the synthesized sound of that name (made by
  // tools/make_sounds.py from Kenney + uiSFX recordings, see docs/audio-credits.md). Music: src/assets/music/{menu,play,deep}.mp3,
  // streamed through <audio> elements (decoding whole songs would cost phones ~40 MB each) into the music bus.
  const FILES = {}; let ambSrc = null;
  const GAIN = { dig: 0.42, push: 0.55, land: 0.7, roll: 0.4, bump: 0.32, swim: 0.2, bubble: 0.35, air: 0.7, treasure: 0.5, absorb: 0.42, gateOpen: 0.45, gateLocked: 0.5,
    win: 0.48, death: 0.7, monsterDeath: 0.65, bite: 0.55, lowAir: 0.34, click: 0.35, pearl: 0.36, star: 0.32, hint: 0.45, undo: 0.45 };
  const VOICE = new Set(['hup', 'yay', 'eep', 'oof', 'hi', 'hmm', 'woohoo', 'aww']); // the synthesized squeaks are off unless a recorded voice exists
  function b64buf(u) { const b = atob(u.slice(u.indexOf(',') + 1)), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; }
  function loadFiles() { const D = window.AQ_DATA || {};
    for (const [k, u] of Object.entries(D.SFX || {})) { const name = k.replace(/_\d+$/, ''); ctx.decodeAudioData(b64buf(u)).then(buf => (FILES[name] = FILES[name] || []).push(buf)).catch(() => {}); }
    const m = D.MUSIC && D.MUSIC.ambience; if (m) ctx.decodeAudioData(b64buf(m)).then(buf => { FILES.__amb = buf; if (started) startAmb(); }).catch(() => {});
    initTracks(); }
  function startAmb() { if (!FILES.__amb || ambSrc || !musicBus) return; ambSrc = ctx.createBufferSource(); ambSrc.buffer = FILES.__amb; ambSrc.loop = true;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 3); ambSrc.connect(g); g.connect(padF || ambBus); ambSrc.start();
    if (padLayer) padLayer.gain.setTargetAtTime(0, ctx.currentTime, 1.5); } /* the recording replaces the synth chords (swell / tension still shape it through padF) */
  function playFile(name, r, gain) { const L = FILES[name]; if (!L || !L.length) return false; const src = ctx.createBufferSource(); src.buffer = L[(Math.random() * L.length) | 0];
    src.playbackRate.value = r || (0.96 + Math.random() * 0.08); const g = ctx.createGain(); g.gain.value = 1.35 * (gain ?? 1) * (GAIN[name] ?? 0.6); src.connect(g); g.connect(sfxBus); src.start(); return true; }
  // ---- music tracks: two <audio> elements crossfade; a low-pass on the way in lets the game muffle it (low air) or open it (gate wakes)
  const TR = { on: false, els: [], cur: -1, name: '', want: null, f: null, g: null };
  function initTracks() { const M = (window.AQ_DATA || {}).MUSIC || {}; if (!M.menu && !M.play && !M.deep) return; TR.on = true; TR.src = M;
    TR.f = ctx.createBiquadFilter(); TR.f.type = 'lowpass'; TR.f.frequency.value = 18000; TR.g = ctx.createGain(); TR.g.gain.value = 0.55; /* music sits well under the gameplay sounds (owner: music lower, game sounds louder) */ TR.f.connect(TR.g); TR.g.connect(musicBus);
    for (let i = 0; i < 2; i++) { const el = new window.Audio(); el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; let node = null; try { node = ctx.createMediaElementSource(el); } catch (er) {}
      const g = ctx.createGain(); g.gain.value = 0; if (node) { node.connect(g); g.connect(TR.f); } TR.els.push({ el, g, node }); }
    if (padLayer) padLayer.gain.setTargetAtTime(0, ctx.currentTime, 1); if (TR.want !== null) music(TR.want); }
  function music(name) { TR.want = name; if (!TR.on || !ctx) return; if (name === TR.name) return; const t = ctx.currentTime;
    if (TR.cur >= 0) { const o = TR.els[TR.cur]; o.g.gain.cancelScheduledValues(t); o.g.gain.setValueAtTime(o.g.gain.value, t); o.g.gain.linearRampToValueAtTime(0, t + 1.6); const el = o.el; setTimeout(() => { if (TR.els[TR.cur] !== o) el.pause(); }, 1800); }
    TR.name = name; if (!name || !TR.src[name]) { TR.cur = -1; return; }
    const ni = TR.cur === 0 ? 1 : 0, n = TR.els[ni]; TR.cur = ni; if (n.el.src !== TR.src[name]) n.el.src = TR.src[name]; n.el.currentTime = 0;
    n.g.gain.cancelScheduledValues(t); n.g.gain.setValueAtTime(0, t); n.g.gain.linearRampToValueAtTime(1, t + 2.2); const p = n.el.play(); if (p && p.catch) p.catch(() => {}); }
  // iOS lets an <audio> element play from code only after it played once inside a tap: prime both on the first tap
  function primeTracks() { if (!TR.on || TR.primed) return; TR.primed = true; for (const o of TR.els) { if (!o.el.src && TR.src.menu) o.el.src = TR.src.menu; const p = o.el.play(); if (p && p.then) p.then(() => { if (TR.els[TR.cur] !== o) o.el.pause(); }).catch(() => {}); } }
  function resume() { if (!ctx) init(); if (ctx && ctx.state === 'suspended') ctx.resume(); primeTracks(); if (!started) { started = true; startMusic(); } if (TR.on && TR.want !== null && TR.cur < 0) { TR.name = ''; music(TR.want); } }

  const noiseCache = {};
  function noiseBuffer(seconds = 2) { if (noiseCache[seconds]) return noiseCache[seconds]; // one buffer per length, reused (it was re-made on every sound effect)
    const b = noiseCache[seconds] = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function brownBuffer(seconds = 6) {
    const b = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
      // crossfade the loop seam
      const f = Math.floor(ctx.sampleRate * 0.25); for (let i = 0; i < f; i++) { const k = i / f; d[d.length - f + i] = d[d.length - f + i] * (1 - k) + d[i] * k; } }
    return b;
  }
  function ambient() { /* the soundscape lives on the music bus; see startMusic */ }

  // ---- soundscape: a calm, continuous underwater ambience (a soft pad and far-off chimes, no tune) ----------------
  // layers: slow ocean swell, a deep warm hum, a soft sustained pad that drifts very slowly,
  // and the occasional distant bubble trail.
  function startMusic() {
    if (!ctx || musicTimer) return;
    const t0 = ctx.currentTime, bgK = (window.AQ_DATA && AQ_DATA.MUSIC && AQ_DATA.MUSIC.ambience) ? 0 : (window.AQ_DATA && AQ_DATA.MUSIC && (AQ_DATA.MUSIC.play || AQ_DATA.MUSIC.menu)) ? 0.4 : 1; // with real music the synth bed only adds a little water air under it
    // ocean swell: brown noise, low-passed, breathing in and out like slow waves
    const sw = ctx.createBufferSource(); sw.buffer = brownBuffer(8); sw.loop = true;
    const swLp = ctx.createBiquadFilter(); swLp.type = 'lowpass'; swLp.frequency.value = 420; swLp.Q.value = 0.4;
    const swG = ctx.createGain(); swG.gain.value = 0.0; swG.gain.linearRampToValueAtTime(0.22 * bgK, t0 + 3);
    const waveL = ctx.createOscillator(); waveL.frequency.value = 0.11; const waveG = ctx.createGain(); waveG.gain.value = 0.09 * bgK; waveL.connect(waveG); waveG.connect(swG.gain); waveL.start();
    const cutL = ctx.createOscillator(); cutL.frequency.value = 0.045; const cutG = ctx.createGain(); cutG.gain.value = 160; cutL.connect(cutG); cutG.connect(swLp.frequency); cutL.start();
    sw.connect(swLp); swLp.connect(swG); swG.connect(ambBus); sw.start();
    // deep hum: what pressure sounds like
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 49;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 73.5;
    const humG = ctx.createGain(); humG.gain.value = 0; humG.gain.linearRampToValueAtTime(0.06 * bgK, t0 + 4);
    hum.connect(humG); hum2.connect(humG); humG.connect(ambBus); hum.start(); hum2.start();
    // soft pad: pure sines through a dark filter, one chord fading into the next every ~14s
    padBus = ctx.createGain(); padBus.gain.value = 1; padBus.connect(ambBus); padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 12000; padF.connect(padBus); // mood layer: swells / thins with the game
    padLayer = ctx.createGain(); padLayer.gain.value = 1; padLayer.connect(padF);
    const padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 700; padLp.Q.value = 0.3; padLp.connect(padLayer);
    const CH = [[0, 7, 15, 19], [-2, 5, 14, 17], [-4, 3, 12, 19], [-5, 7, 14, 17]], ROOT = 110;
    let ci = 0, nextPad = t0 + 0.5;
    const padChord = (t) => { const ch = CH[ci++ % CH.length]; const dur = 18;
      ch.forEach((st, k) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = ROOT * Math.pow(2, st / 12); o.detune.value = (Math.random() - 0.5) * 8;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(k === 0 ? 0.05 : 0.032, t + 6); g.gain.setValueAtTime(k === 0 ? 0.05 : 0.032, t + dur - 6); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); g.connect(padLp); o.start(t); o.stop(t + dur + 0.1);
        if (k > 0) { const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = ROOT * 2 * Math.pow(2, st / 12); o2.detune.value = (Math.random() - 0.5) * 12; // a warm shimmer layer an octave up
          const g2 = ctx.createGain(); g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.009, t + 8); g2.gain.linearRampToValueAtTime(0, t + dur); o2.connect(g2); g2.connect(padLp); o2.start(t); o2.stop(t + dur + 0.1); } });
      lastChord = ch; };
    let lastChord = CH[0];
    { const sweep = ctx.createOscillator(); sweep.frequency.value = 0.03; const sg = ctx.createGain(); sg.gain.value = 260; sweep.connect(sg); sg.connect(padLp.frequency); sweep.start(); padLp.frequency.value = 900; }
    // now and then one soft, far-away chime from the current chord (single notes with long tails: colour, not a tune)
    const chime = (t) => { const st = lastChord[1 + (Math.random() * 3 | 0)] + 24, f = ROOT * Math.pow(2, st / 12);
      for (const [mul, a] of [[1, 0.02], [2.76, 0.005]]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul; const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0003, t + 4.5); o.connect(g); g.connect(padF || ambBus); o.start(t); o.stop(t + 4.6); } };
    let nextChime = t0 + 6;
    // distant bubble trail: a few soft rising blips, panned
    const bubbleTrail = (t) => { const n = 3 + (Math.random() * 6 | 0); const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(ambBus); }
      for (let i = 0; i < n; i++) { const tt = t + i * (0.06 + Math.random() * 0.12); const f = 300 + Math.random() * 500;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.9, tt + 0.07);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.018, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.12);
        o.connect(g); g.connect(pan || ambBus); o.start(tt); o.stop(tt + 0.15); } };
    let nextBub = t0 + 3;
    const tick = () => {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now + 1 > nextPad) { padChord(nextPad); nextPad += 14; }
      if (now + 1 > nextBub) { if (!FILES.__amb) bubbleTrail(nextBub); nextBub += 4 + Math.random() * 7; }
      if (now + 1 > nextChime && tension < 0.3 && !TR.on) { chime(nextChime); nextChime += 7 + Math.random() * 9; } else if (now + 1 > nextChime) nextChime += 4;
      musicTimer = setTimeout(tick, 400);
    };
    tick(); startAmb();
  }

  // ---- SFX ------------------------------------------------------------
  function burst(dur, freq, q, vol, t = ctx.currentTime, type = 'bandpass') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(1);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus); src.start(t); src.stop(t + dur + 0.02);
  }
  function note(freq, t, dur, type, vol, dest) { // a single soft tone with a quick attack and gentle decay
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function thump(freq, dur, vol, t = ctx.currentTime) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  // a tiny cartoon 'voice': a soft triangle tone with a pitch contour, gentle vibrato and two vowel formants
  // pts = [[time, Hz], ...]; vowel formants: a ~ [850,1250], i ~ [320,2300], u/o ~ [420,850]
  function voice(t, pts, dur, vol, formants = [[850, 5], [1250, 7]]) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(pts[0][1], t); for (let i = 1; i < pts.length; i++) o.frequency.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
    const vib = ctx.createOscillator(); vib.frequency.value = 8.5; const vg = ctx.createGain(); vg.gain.value = pts[0][1] * 0.018; vib.connect(vg); vg.connect(o.frequency);
    const mix = ctx.createGain(), dry = ctx.createGain(); dry.gain.value = 0.35; o.connect(dry); dry.connect(mix);
    formants.forEach(([f, q]) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; o.connect(bp); bp.connect(mix); });
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.018); g.gain.setValueAtTime(vol, t + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    mix.connect(g); g.connect(sfxBus); o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }
  const SFX = {
    // ---- intro cinematic
    thunder() { const t = ctx.currentTime; burst(1.8, 120, 0.6, 0.5, t, 'lowpass'); burst(0.25, 900, 0.8, 0.25, t); thump(70, 1.6, 0.55, t + 0.02); burst(2.4, 60, 0.5, 0.35, t + 0.25, 'lowpass'); },
    stormWind() { const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(900, t + 1.6); f.frequency.linearRampToValueAtTime(380, t + 4.5); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.8); g.gain.setValueAtTime(0.22, t + 3.6); g.gain.linearRampToValueAtTime(0, t + 5);
      src.connect(f); f.connect(g); g.connect(sfxBus); src.start(t); src.stop(t + 5.1); },
    lampOn() { const t = ctx.currentTime; burst(0.05, 2400, 3, 0.25, t); note(1320, t + 0.03, 0.5, 'sine', 0.07); note(1980, t + 0.06, 0.6, 'sine', 0.04); },
    wake() { const t = ctx.currentTime; [0, 4, 7, 12, 16, 19, 24].forEach((st, i) => note(220 * Math.pow(2, st / 12), t + i * 0.07, 2.6, 'sine', 0.06)); burst(1.6, 3000, 0.7, 0.06, t + 0.1, 'highpass'); thump(110, 1.2, 0.35, t); },
    riser() { const t = ctx.currentTime, o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(440, t + 2.2); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 2.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 2); g.gain.linearRampToValueAtTime(0, t + 2.3); o.connect(f); f.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 2.4); thump(60, 1.4, 0.5, t + 2.2); note(330, t + 2.2, 2.4, 'triangle', 0.05); note(495, t + 2.2, 2.4, 'triangle', 0.04); },
    // ---- the diver's cute sounds
    swim() { const t = ctx.currentTime, f = 230 + Math.random() * 70; // a soft double 'blub' of fin bubbles
      for (const [d, k] of [[0, 1], [0.045, 1.35]]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * k, t + d); o.frequency.exponentialRampToValueAtTime(f * k * 2.1, t + d + 0.07);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.045, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + d + 0.1); o.connect(g); g.connect(sfxBus); o.start(t + d); o.stop(t + d + 0.12); } },
    hup() { voice(ctx.currentTime, [[0, 520], [0.1, 690]], 0.14, 0.32, [[720, 5], [1150, 7]]); },                       // 'hup!' while shoving
    yay() { const t = ctx.currentTime; voice(t, [[0, 640], [0.12, 900]], 0.17, 0.3); voice(t + 0.16, [[0, 900], [0.16, 1280]], 0.26, 0.3); },
    eep() { voice(ctx.currentTime, [[0, 950], [0.07, 1550]], 0.13, 0.22, [[330, 4], [2300, 7]]); },                      // a stone/pearl right overhead
    oof() { voice(ctx.currentTime, [[0, 430], [0.13, 260]], 0.17, 0.3, [[440, 5], [860, 6]]); },                        // something heavy lands right next to him
    hi() { voice(ctx.currentTime, [[0, 720], [0.09, 980], [0.2, 840]], 0.27, 0.2, [[340, 5], [2250, 7]]); },              // idle wave
    hmm() { voice(ctx.currentTime + 0.05, [[0, 400], [0.2, 330]], 0.25, 0.18, [[320, 4], [880, 5]]); },                  // walked into a locked gate
    woohoo() { const t = ctx.currentTime + 0.12; voice(t, [[0, 520], [0.18, 1050]], 0.24, 0.3, [[420, 5], [850, 6]]); voice(t + 0.26, [[0, 760], [0.12, 1180], [0.3, 1000]], 0.36, 0.3, [[420, 5], [850, 6]]); },
    aww() { voice(ctx.currentTime + 0.1, [[0, 620], [0.45, 300]], 0.55, 0.26, [[800, 5], [1150, 6]]); },
    dig() { // soothing: a soft, low underwater 'whff' and a warm muted thump
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = sandBuf || (sandBuf = brownBuffer(1));
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(520 + Math.random() * 120, t); lp.frequency.exponentialRampToValueAtTime(220, t + 0.4); lp.Q.value = 0.3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      src.connect(lp); lp.connect(g); g.connect(sfxBus); src.start(t, Math.random() * 0.5); src.stop(t + 0.48);
      const o = ctx.createOscillator(); o.type = 'sine'; const f = 150 + Math.random() * 30; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.25);
      const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.045, t + 0.02); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(og); og.connect(sfxBus); o.start(t); o.stop(t + 0.32);
    },
    push() { thump(140, 0.18, 0.35); burst(0.12, 400, 1, 0.1); },
    land() { thump(70, 0.35, 0.8); burst(0.2, 250, 0.7, 0.25, ctx.currentTime, 'lowpass'); },
    roll() { burst(0.2, 320, 0.7, 0.08, ctx.currentTime, 'lowpass'); },
    bump() { thump(220, 0.08, 0.15); },
    treasure() { const t = ctx.currentTime, r = 880 * Math.pow(2, ((Math.random() * 3) | 0) * 2 / 12); [0, 7, 12].forEach((d, i) => note(r * Math.pow(2, d / 12), t + i * 0.055, 0.35, 'sine', 0.06, sfxBus)); },
    bubble() { const t = ctx.currentTime; const f = 600 + Math.random() * 900; note(f, t, 0.12, 'sine', 0.05, sfxBus); note(f * 1.5, t + 0.03, 0.08, 'sine', 0.03, sfxBus); },
    air() { const t = ctx.currentTime; [0, 4, 7, 12].forEach((d, i) => note(523 * Math.pow(2, d / 12), t + i * 0.06, 0.5, 'sine', 0.12, sfxBus)); burst(0.5, 2000, 0.5, 0.15); },
    absorb() { const t = ctx.currentTime; for (let i = 0; i < 10; i++) note(300 * Math.pow(2, i / 6), t + i * 0.04, 0.3, 'sine', 0.1, sfxBus); note(880, t + 0.4, 1.2, 'triangle', 0.12, sfxBus); },
    gateOpen() { const t = ctx.currentTime; [0, 7, 12, 19, 24].forEach((d, i) => note(220 * Math.pow(2, d / 12), t + i * 0.09, 1.6, 'sine', 0.14, sfxBus)); },
    gateLocked() { thump(160, 0.2, 0.3); thump(120, 0.3, 0.3, ctx.currentTime + 0.12); },
    monsterDeath() { burst(0.3, 900, 0.8, 0.3); thump(90, 0.3, 0.5); },
    death() { const t = ctx.currentTime; for (let i = 0; i < 6; i++) note(330 * Math.pow(2, -i / 5), t + i * 0.12, 0.5, 'sawtooth', 0.08, sfxBus); burst(1.2, 300, 0.5, 0.3, t, 'lowpass'); },
    win() { const t = ctx.currentTime; [0, 4, 7, 12, 16, 19, 24].forEach((d, i) => { note(392 * Math.pow(2, d / 12), t + i * 0.1, 1.2, 'sine', 0.14, sfxBus); note(392 * Math.pow(2, d / 12), t + i * 0.1, 0.6, 'triangle', 0.04, sfxBus); }); },
    click() { note(1200, ctx.currentTime, 0.06, 'sine', 0.08, sfxBus); },
    lowAir() { thump(880, 0.12, 0.12); },
    bite() { burst(0.1, 1500, 2, 0.3); thump(200, 0.1, 0.3); },
  };
  // the soundscape reacts (still no tune): a warm swell with an open filter when the gate wakes; the pad thins and darkens as air runs out
  function swell() { if (!ctx || !padBus) return; const t = ctx.currentTime, g = padBus.gain, f = padF.frequency;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1.35, t + 1.6); g.linearRampToValueAtTime(1 - tension * 0.65, t + 7); // a gentle lift only:
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(Math.min(2200, Math.max(f.value, 900)), t + 1.2); } // it used to open to 12 kHz at 2.3x with extra notes (shrill)
  // k 0 = open (playing), 1 = muffled (pause / result / sheets during a level): a soft shelf, not a wall
  function muffle(k) { muffK = k; if (!ctx || !muffF) return; const t = ctx.currentTime; muffF.frequency.cancelScheduledValues(t); muffF.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, k), t, k ? 0.18 : 0.35); muffG.gain.cancelScheduledValues(t); muffG.gain.setTargetAtTime(1 - 0.28 * k, t, 0.3); }
  function setTension(k) { k = Math.max(0, Math.min(1, k)); if (!ctx || !padBus || Math.abs(k - tension) < 0.02) return; tension = k; const t = ctx.currentTime; if (TR.f) { TR.f.frequency.cancelScheduledValues(t); TR.f.frequency.setTargetAtTime(18000 * Math.pow(0.05, k), t, 0.8); }
    padBus.gain.cancelScheduledValues(t); padBus.gain.setTargetAtTime(1 - k * 0.65, t, 0.8); padF.frequency.cancelScheduledValues(t); padF.frequency.setTargetAtTime(12000 * Math.pow(0.04, k), t, 0.8); }
  function play(name) { if (!ctx || muted) return; try { if (!playFile(name) && !(VOICE.has(name) && FILES.click)) SFX[name] && SFX[name](); } catch {} }
  // voice-over: plays an embedded clip (src/assets/vo/<id>.mp3, baked in by build_assets.py) and ducks the ambience under it.
  // Returns the clip length in seconds (0 when no clip exists yet, so the captions keep their own timing).
  // `max` (seconds): a clip longer than its slot plays up to 12% faster (pitch kept), so a timed line ends before the next one.
  let voEl = null; const voDur = {};
  // story voice packs (assets/voice-<world>.js, made by tools/build_assets.py) call this when they load
  window.AQ_VOICE = P => { try { window.AQ_DATA = window.AQ_DATA || {}; AQ_DATA.VO = Object.assign(AQ_DATA.VO || {}, P.VO || {}); Object.assign(voDur, P.VOD || {}); } catch (er) {} };
  try { const V = (window.AQ_DATA && AQ_DATA.VO) || {}, VD = (window.AQ_DATA && AQ_DATA.VOD) || {}; for (const id in V) { if (VD[id]) { voDur[id] = VD[id]; continue; } const a = new window.Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => { voDur[id] = a.duration; }; a.src = V[id]; } } catch (er) {} // clip lengths, known up front (measured by the build; metadata only as a fallback)
  function voLeft() { return voEl && !voEl.paused && !voEl.ended && isFinite(voEl.duration) ? Math.max(0, (voEl.duration - voEl.currentTime) / (voEl.playbackRate || 1)) : 0; }
  function vo(id, max) { const src = window.AQ_DATA && AQ_DATA.VO && AQ_DATA.VO[id]; if (!src || muted) return 0;
    try { if (voEl) voEl.pause(); voEl = new window.Audio(src); voEl.volume = Math.min(1, vol.sfx * vol.sfx); const d = voDur[id] || 0;
      if (max && d > max) { voEl.playbackRate = Math.min(1.12, d / max); try { voEl.preservesPitch = true; } catch (er) {} } voEl.play().catch(() => {});
      if (musicBus && ctx) { musicBus.gain.setTargetAtTime(gMusic() * 0.35, ctx.currentTime, 0.2); ambBus.gain.setTargetAtTime(gAmb() * 0.35, ctx.currentTime, 0.2); voEl.onended = () => { musicBus.gain.setTargetAtTime(gMusic(), ctx.currentTime, 0.6); ambBus.gain.setTargetAtTime(gAmb(), ctx.currentTime, 0.6); }; }
      return d / (voEl.playbackRate || 1); } catch { return 0; } }
  function stopVo() { if (voEl) { voEl.pause(); voEl = null; } if (musicBus && ctx) { musicBus.gain.setTargetAtTime(gMusic(), ctx.currentTime, 0.4); ambBus.gain.setTargetAtTime(gAmb(), ctx.currentTime, 0.4); } }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 1; }
  function setMusic(on) { musicOn = on; if (musicBus && ctx) musicBus.gain.setTargetAtTime(gMusic(), ctx.currentTime, 0.6); }
  function setVolumes(music, sfx) { if (sfx === 0) setVol('sfx', 0); }
  function setVol(k, v) { if (!(k in vol)) return; vol[k] = Math.max(0, Math.min(1, +v || 0)); if (!ctx) return; const t = ctx.currentTime;
    if (k === 'music' && musicBus) musicBus.gain.setTargetAtTime(gMusic(), t, 0.05); if (k === 'amb' && ambBus) ambBus.gain.setTargetAtTime(gAmb(), t, 0.05); if (k === 'sfx' && sfxBus) sfxBus.gain.setTargetAtTime(gSfx(), t, 0.05); }
  function pearl(n) { if (!ctx || muted) return; if (playFile('pearl', Math.pow(2, [0, 2, 4, 5, 7, 7, 7][Math.min(6, Math.max(0, n - 1))] / 12))) return; /* pentatonic steps: overlapping cues stay consonant */ const t = ctx.currentTime + 0.05, f = 523 * Math.pow(2, (n - 1) * 4 / 12); note(f, t, 0.9, 'triangle', 0.13, sfxBus); note(f * 2, t + 0.07, 0.6, 'sine', 0.06, sfxBus); } // each pearl a step higher
  function star(i) { if (!ctx || muted) return; if (playFile('star', Math.pow(2, [0, 2, 5][Math.min(2, Math.max(0, i))] / 12))) return; const t = ctx.currentTime, f = 784 * Math.pow(2, i * 5 / 12); note(f, t, 0.7, 'triangle', 0.14, sfxBus); note(f * 1.5, t + 0.03, 0.5, 'sine', 0.06, sfxBus); thump(110, 0.12, 0.18); }
  // share clips: the mixed game sound as a MediaStream for the recorder
  let capDest = null;
  function capture() { if (!ctx || !master || !ctx.createMediaStreamDestination) return null; try { capDest = ctx.createMediaStreamDestination(); (outNode || master).connect(capDest); return capDest.stream; } catch (er) { capDest = null; return null; } }
  function release() { if (capDest) { try { (outNode || master).disconnect(capDest); } catch (er) {} capDest = null; } }
  return { init, resume, play, vo, voLeft, stopVo, voDur: id => voDur[id] || 0, swell, setTension, muffle, setMuted, setMusic, setVolumes, setVol, vol, settings, pearl, star, capture, release, music, get musicOn() { return TR.on; }, get ctx() { return ctx; }, get files() { return FILES; } };
})();

// Deep Current — renderer v3: clean, bright, front-on puzzle board built from premium primitives.
// Expects global THREE and T (tile enum).
/* global THREE, T */
const REDUCED_MOTION = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (er) { return false; } })(); // players who ask for less motion: no shake, no lightning
const World = (() => {
  // camera lens + angle: a wider lens closer in (real perspective: block sides and tank depth show) and a slight side angle instead of
  // dead-on, so the tank reads as a 3D object. No extra up/down tilt. Phones also swing gently with the diver (parallax).
  const DESK_CLOSE = 0.74, CAM_FOV = 46, CAM_YAW = isMobileUA() ? 0.15 : 0.22, CAM_SWING = 0.09;
  function isMobileUA() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100); }
  const V3 = THREE.Vector3;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  // big, mostly-matte surfaces (tank frame, stand, shelves, side glass): full physical shading on computers, the cheaper standard
  // model on phones (clearcoat/sheen/iridescence are barely visible at phone size but cost a lot per pixel)
  const PHYS_ONLY = ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'iridescence', 'iridescenceIOR', 'specularIntensity', 'transmission', 'ior', 'thickness'];
  function surfMat(o) { if (!isMobile) return new THREE.MeshPhysicalMaterial(o); const q = Object.assign({}, o); PHYS_ONLY.forEach(k => delete q[k]); return new THREE.MeshStandardMaterial(q); }
  const col = h => new THREE.Color(h);

  // ---------------------------------------------------------------- canvas helpers
  function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function tex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  const TEX = {};
  function buildTextures() {
    { const R = (window.AQ_DATA && AQ_DATA.TEX) || {}; if (R.sand_ref && !TEX.sandRef) { TEX.sandRef = new THREE.TextureLoader().load(R.sand_ref); TEX.sandRef.wrapS = TEX.sandRef.wrapT = THREE.RepeatWrapping; TEX.sandRef.colorSpace = THREE.SRGBColorSpace; TEX.sandRef.anisotropy = 4; } } // the owner's reference sand
    // soft dot + bubble sprites
    { const [c, g] = canvas(64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); TEX.dot = tex(c, false); }
    { const [c, g] = canvas(64); const ig = g.createRadialGradient(32, 32, 10, 32, 32, 28); ig.addColorStop(0, 'rgba(200,240,255,0.08)'); ig.addColorStop(1, 'rgba(220,245,255,0.45)'); g.fillStyle = ig; g.beginPath(); g.arc(32, 32, 27, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.5; g.beginPath(); g.arc(32, 32, 27, 0, 7); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(22, 21, 7, 4.5, -0.7, 0, 7); g.fill(); TEX.bubble = tex(c, false); }
    // clean candy-style tile faces: soft vertical light, a glossy top-left sheen, and a light inner rim. no noise, no cracks.
    const face = (S, draw) => { const [c, g] = canvas(S);
      const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#e9ecf8'); gr.addColorStop(1, '#c7cdea'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
      if (draw) draw(g, S);
      const sh = g.createRadialGradient(S * 0.3, S * 0.22, 2, S * 0.3, S * 0.22, S * 0.55); sh.addColorStop(0, 'rgba(255,255,255,0.55)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = S * 0.025; rrect(g, S * 0.1, S * 0.1, S * 0.8, S * 0.8, S * 0.16); g.stroke();
      return tex(c); };
    TEX.blocks = [0, 1, 2, 3].map(v => face(256, (g, S) => { if (v === 3) { g.fillStyle = 'rgba(80,90,150,0.10)'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.16, 0, 7); g.fill(); } }));
    TEX.block = TEX.blocks[0];
    // wall tile: same clean face with a soft "pillow" inset so it reads differently from the frame blocks
    TEX.cobble = face(256, (g, S) => { const ig = g.createLinearGradient(0, S * 0.24, 0, S * 0.76); ig.addColorStop(0, 'rgba(70,90,140,0.22)'); ig.addColorStop(1, 'rgba(255,255,255,0.35)');
      g.fillStyle = ig; rrect(g, S * 0.24, S * 0.24, S * 0.52, S * 0.52, S * 0.12); g.fill(); });
    // exit panel screen
    TEX.gate = (() => { const S = 256; const [c, g] = canvas(S);
      const gr = g.createRadialGradient(S / 2, S * 0.55, 10, S / 2, S * 0.55, S * 0.6); gr.addColorStop(0, '#5fd0ff'); gr.addColorStop(0.5, '#1a7fe6'); gr.addColorStop(1, '#0b3f9e'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(160,230,255,0.35)'; g.lineWidth = 3; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, i * 34 + 6); g.lineTo(S, i * 34 + 6); g.stroke(); }
      g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(160,240,255,1)'; g.shadowBlur = 18;
      g.beginPath(); g.moveTo(S * 0.42, S * 0.3); g.lineTo(S * 0.58, S * 0.3); g.lineTo(S * 0.58, S * 0.55); g.lineTo(S * 0.72, S * 0.55); g.lineTo(S * 0.5, S * 0.8); g.lineTo(S * 0.28, S * 0.55); g.lineTo(S * 0.42, S * 0.55); g.closePath(); g.fill();
      return tex(c); })();
    // O2 label
    { const [c, g] = canvas(128); g.font = '700 64px Fredoka, "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,80,160,0.8)'; g.shadowBlur = 8; g.fillText('O₂', 64, 68); TEX.o2 = tex(c); }
    TEX.backdrop = paintBackdrop();
  }

  // ---------------------------------------------------------------- painted undersea backdrop
  function paintBackdrop() {
    const W = 1536, H = 768; const [c, g] = canvas(W, H);
    const soft = (k, draw) => { const [lc, lg] = canvas(Math.ceil(W / k), Math.ceil(H / k)); lg.scale(1 / k, 1 / k); draw(lg); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(lc, 0, 0, W, H); };
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#3fc4f5'); sky.addColorStop(0.16, '#1186dc'); sky.addColorStop(0.5, '#0a4f9e'); sky.addColorStop(1, '#03204d'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    soft(3, g2 => { g2.globalAlpha = 0.35; g2.fillStyle = '#d8f6ff'; for (let i = 0; i < 70; i++) { g2.beginPath(); g2.ellipse(rnd() * W, rnd() * 40, 30 + rnd() * 70, 2 + rnd() * 4, 0, 0, 7); g2.fill(); } });
    soft(10, g2 => { g2.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) { const x0 = W * (0.25 + rnd() * 0.5), spread = (rnd() - 0.5) * 1.4, w0 = 15 + rnd() * 35, w1 = 90 + rnd() * 140;
        const gr = g2.createLinearGradient(0, 0, 0, H * 0.85); gr.addColorStop(0, 'rgba(225,250,255,0.55)'); gr.addColorStop(1, 'rgba(200,245,255,0)'); g2.fillStyle = gr;
        g2.beginPath(); g2.moveTo(x0 - w0, -10); g2.lineTo(x0 + w0, -10); g2.lineTo(x0 + spread * W * 0.5 + w1, H); g2.lineTo(x0 + spread * W * 0.5 - w1, H); g2.closePath(); g2.fill(); } });
    // sun glowing through the surface: a few soft hot spots at the top
    soft(4, g2 => { g2.globalCompositeOperation = 'lighter'; for (const [fx, r, a] of [[0.38, 210, 0.75], [0.6, 150, 0.55], [0.22, 110, 0.4], [0.78, 120, 0.4]]) { const gr = g2.createRadialGradient(W * fx, 0, 0, W * fx, 0, r); gr.addColorStop(0, `rgba(255,252,225,${a})`); gr.addColorStop(0.4, `rgba(200,240,255,${a * 0.45})`); gr.addColorStop(1, 'rgba(200,240,255,0)'); g2.fillStyle = gr; g2.fillRect(W * fx - r, 0, r * 2, r); } });
    // distant, hazy reef hills only; the near reef is real 3D
    soft(12, g2 => { for (let L = 0; L < 2; L++) { g2.fillStyle = L ? 'rgba(16,86,170,0.55)' : 'rgba(24,104,190,0.4)'; g2.beginPath(); g2.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) g2.lineTo(x, H * (L ? 0.74 : 0.66) - Math.sin(x * 0.006 + L * 2) * 40 - Math.sin(x * 0.017 + L) * 22); g2.lineTo(W, H); g2.closePath(); g2.fill(); } });
    soft(2, g2 => { const gr = g2.createLinearGradient(0, H * 0.7, 0, H); gr.addColorStop(0, 'rgba(10,60,140,0)'); gr.addColorStop(1, 'rgba(8,46,110,0.6)'); g2.fillStyle = gr; g2.fillRect(0, H * 0.7, W, H * 0.3); });
    g.strokeStyle = 'rgba(220,245,255,0.5)'; g.lineWidth = 1.5; for (let i = 0; i < 36; i++) { g.beginPath(); g.arc(rnd() * W, rnd() * H, 2 + rnd() * 7, 0, 7); g.stroke(); }
    return tex(c);
  }

  // ---------------------------------------------------------------- geometry
  // sand cell blocks: a 1x1 prism whose corners (bit 1 TL, 2 TR, 4 BR, 8 BL) are rounded with the same radius the
  // sand-front shader uses, plus the matching concave fillet that fills an inner corner of a dug hole
  const SAND_R = 0.2, SAND_Z0 = -0.39, SAND_D = 0.74, sandGeoCache = {};
  function sandBlockGeo(fl) { if (sandGeoCache[fl]) return sandGeoCache[fl];
    const s = new THREE.Shape(), a = 0.5, r = SAND_R, P = Math.PI;
    s.moveTo(-a, -a + (fl & 8 ? r : 0));
    if (fl & 1) { s.lineTo(-a, a - r); s.absarc(-a + r, a - r, r, P, P / 2, true); } else s.lineTo(-a, a);
    if (fl & 2) { s.lineTo(a - r, a); s.absarc(a - r, a - r, r, P / 2, 0, true); } else s.lineTo(a, a);
    if (fl & 4) { s.lineTo(a, -a + r); s.absarc(a - r, -a + r, r, 0, -P / 2, true); } else s.lineTo(a, -a);
    if (fl & 8) { s.lineTo(-a + r, -a); s.absarc(-a + r, -a + r, r, -P / 2, -P, true); } else s.lineTo(-a, -a);
    const g = new THREE.ExtrudeGeometry(s, { depth: SAND_D, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, SAND_Z0); return (sandGeoCache[fl] = g); }
  function sandFilletGeo() { if (sandGeoCache.fillet) return sandGeoCache.fillet; // top-left inner corner; rotated for the others
    const s = new THREE.Shape(), a = 0.5, r = SAND_R; s.moveTo(-a, a); s.lineTo(-a + r, a); s.absarc(-a + r, a - r, r, Math.PI / 2, Math.PI, false); s.lineTo(-a, a);
    const g = new THREE.ExtrudeGeometry(s, { depth: SAND_D, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, SAND_Z0); return (sandGeoCache.fillet = g); }
  function roundedBox(w, h, d, r, seg = 3) {
    const sh = new THREE.Shape(); const x = -w / 2 + r, y = -h / 2 + r, iw = w - 2 * r, ih = h - 2 * r;
    sh.moveTo(x, y - r * 0); sh.lineTo(x + iw, y); sh.lineTo(x + iw, y + ih); sh.lineTo(x, y + ih); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: seg, curveSegments: 1 });
    g.translate(0, 0, -(d - 2 * r) / 2);
    // front/back caps get 0..1 uvs across the full face
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
    g.computeVertexNormals(); return g;
  }

  // ---------------------------------------------------------------- materials
  const MAT = {};
const SHEET_SPR = window.AQ_DATA.SHEET_SPR;
  // ---------------------------------------------------------------- your asset-sheet sprites
  const SPR = { tex: {}, img: {} };
  function sprTex(n) { if (SPR.tex[n]) return SPR.tex[n]; const t = new THREE.TextureLoader().load(SHEET_SPR[n][0]); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (n === 'sand') { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return (SPR.tex[n] = t); }
  for (const n in SHEET_SPR) { const im = new Image(); im.src = SHEET_SPR[n][0]; SPR.img[n] = im; }
  // a flat cut-out standing in the scene (bottom-anchored or centred), lit softly so it sits in the water light
  // `shadow` = fake (baked) shadow options, or false for none: { k: offset as a fraction of height, dz: gap to the surface behind, op: opacity, ground: contact patch under the base }
  function sprPlane(n, height, anchorBottom = false, shadow = {}) { const [, w, h] = SHEET_SPR[n], wd = height * w / h; const g = new THREE.PlaneGeometry(wd, height); if (anchorBottom) g.translate(0, height / 2, 0);
    const m = (SPR.mat || (SPR.mat = {}))[n] || (SPR.mat[n] = new THREE.MeshStandardMaterial({ map: sprTex(n), transparent: true, alphaTest: 0.25, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveMap: sprTex(n), emissiveIntensity: 0.35, side: THREE.DoubleSide, depthWrite: true }));
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = false; if (shadow) addSprShadow(mesh, n, wd, height, anchorBottom, shadow); return mesh; }
  // ---- fake sprite shadows: a blurred dark silhouette of the sprite, cast onto the surface behind it along the key light
  // (the key light sits up-left-front of the tank, so shadows fall down-right), plus a soft contact patch under standing sprites.
  const SHADOW_DIR = new THREE.Vector2(5, -9).normalize(), SHADOW_COL = '#06142b';
  SPR.sh = {};
  function sprShadowTex(n) { if (SPR.sh[n]) return SPR.sh[n];
    const [, w, h] = SHEET_SPR[n], k = Math.max(2, Math.round(Math.max(w, h) / 34)), p = Math.ceil(k * 2), W = w + 2 * p, H = h + 2 * p;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.pad = [W / w, H / h]; SPR.sh[n] = t;
    const draw = () => { const im = SPR.img[n]; // shrink -> grow twice = a cheap, smooth blur that works on every browser
      const s0 = document.createElement('canvas'); s0.width = Math.ceil(W / k); s0.height = Math.ceil(H / k); const g0 = s0.getContext('2d'); g0.drawImage(im, p / k, p / k, w / k, h / k);
      g0.globalCompositeOperation = 'source-in'; g0.fillStyle = SHADOW_COL; g0.fillRect(0, 0, s0.width, s0.height);
      const s1 = document.createElement('canvas'); s1.width = Math.ceil(W / 2); s1.height = Math.ceil(H / 2); const g1 = s1.getContext('2d'); g1.imageSmoothingQuality = 'high'; g1.drawImage(s0, 0, 0, s1.width, s1.height);
      const gc = c.getContext('2d'); gc.imageSmoothingQuality = 'high'; gc.drawImage(s1, 0, 0, W, H); t.needsUpdate = true; };
    const im = SPR.img[n]; if (im.complete && im.naturalWidth) draw(); else im.addEventListener('load', draw, { once: true }); return t; }
  let contactTex = null;
  function getContactTex() { if (contactTex) return contactTex; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(6,20,43,0.9)'); gr.addColorStop(0.45, 'rgba(6,20,43,0.45)'); gr.addColorStop(1, 'rgba(6,20,43,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    contactTex = new THREE.CanvasTexture(c); return contactTex; }
  const _shM = new THREE.Matrix3(), _shV = new THREE.Vector3();
  function addSprShadow(sp, n, wd, height, anchorBottom, o) {
    const k = o.k ?? 0.12, dz = o.dz ?? 0.06, op = o.op ?? 0.5, ground = o.ground ?? anchorBottom, off = height * k, wx = SHADOW_DIR.x * off, wy = SHADOW_DIR.y * off;
    if (o.drop === false) { addContact(sp, wd, op, true); return; }
    const t = sprShadowTex(n), [px, py] = t.userData.pad, g = new THREE.PlaneGeometry(wd * px, height * py); if (anchorBottom) g.translate(0, height / 2, 0);
    // standing sprites: the shadow starts at the base and leans away from the light (sheared + slightly squashed), so it never slips below the feet
    const lean = anchorBottom ? (o.lean ?? 0.4) : 0; if (lean) { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const y = Math.max(0, P.getY(i)); P.setX(i, P.getX(i) + y * lean); P.setY(i, P.getY(i) * 0.86); } }
    const smk = n + '|' + op; const sh = new THREE.Mesh(g, (SPR.shm || (SPR.shm = {}))[smk] || (SPR.shm[smk] = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }))); sh.renderOrder = sp.renderOrder; sh.userData.fakeShadow = true; sp.add(sh); sp.userData.shadow = sh;
    // keep the shadow offset fixed in world space however the sprite is flipped, swayed, spun or carried by its parents
    sh.onBeforeRender = () => { _shM.setFromMatrix4(sp.matrixWorld).invert(); if (lean) _shV.set(0.02, 0, -dz); else _shV.set(wx, wy, -dz); _shV.applyMatrix3(_shM); sh.position.copy(_shV);
      if (lean) sh.scale.x = sp.matrixWorld.elements[0] < 0 ? -1 : 1; // un-mirror so a flipped sprite still leans away from the light
      sh.updateMatrixWorld(); };
    if (ground) addContact(sp, wd, op, false);
  }
  // soft patch on the ground under a standing sprite; `cast` stretches it back-right along the light like a low-sun shadow
  function addContact(sp, wd, op, cast) { const ck = 'c' + (op * 1.1).toFixed(3); const cp = new THREE.Mesh(new THREE.PlaneGeometry(wd * (cast ? 1.25 : 1.05), Math.min(cast ? 0.55 : 0.4, wd * (cast ? 0.6 : 0.4))), (SPR.cm || (SPR.cm = {}))[ck] || (SPR.cm[ck] = new THREE.MeshBasicMaterial({ map: getContactTex(), transparent: true, opacity: op * 1.1, depthWrite: false })));
    cp.rotation.x = -Math.PI / 2; if (cast) cp.rotation.z = -0.5; cp.position.set(wd * (cast ? 0.22 : 0.06), 0.012, cast ? -0.12 : -0.04); cp.renderOrder = sp.renderOrder; cp.userData.fakeShadow = true; sp.add(cp); sp.userData.contact = cp; }
  // the movable-platform sprite as a 3-slice face for one coral shelf of `len` cells
  function shelfFace(len, nm = 'platform') { const im = SPR.img[nm]; if (!im || !im.complete || !im.naturalWidth) return null; const W = Math.round(len * 128), H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const iw = im.naturalWidth, ih = im.naturalHeight, cap = Math.round(iw * 0.18), capW = Math.round(cap * H / ih), mid = iw - 2 * cap, midW = Math.round(mid * H / ih);
    g.drawImage(im, 0, 0, cap, ih, 0, 0, capW, H); g.drawImage(im, iw - cap, 0, cap, ih, W - capW, 0, capW, H);
    for (let x = capW; x < W - capW; x += midW) { const ww = Math.min(midW, W - capW - x); g.drawImage(im, cap, 0, mid * ww / midW, ih, x, 0, ww, H); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
  function sandify(m, mask) {
    // world-space wavy dune bands, a bright lip on top faces, darker sides
    m.onBeforeCompile = (sh) => {
      if (mask) { sh.uniforms.uMask = mask.tex; sh.uniforms.uSize = mask.size; }
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vNo;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWp = (modelMatrix * wp4).xyz; vNo = normal; }');
      sh.uniforms.uCausticT = MAT.causticT; sh.uniforms.uSandTex = { value: sprTex('sand') }; sh.uniforms.uSandRef = { value: TEX.sandRef || sprTex('sand') }; sh.uniforms.uRef = { value: TEX.sandRef ? 1 : 0 }; sh.uniforms.uNew = MAT.sandNew; sh.uniforms.uNight = MAT.sandNight; sh.uniforms.uLamp = MAT.lamp; sh.uniforms.uLampAmb = MAT.lampAmb;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCausticT, uNew, uNight, uLampAmb; uniform vec4 uLamp; uniform sampler2D uSandTex, uSandRef; uniform float uRef; varying vec3 vWp; varying vec3 vNo; float vEdge = 0.0; float vBotOpen = 0.0; float vLine = 0.0; float vWet = 0.0; float vTopOpen = 0.0; vec2 vLc = vec2(0.5); vec3 vGlint = vec3(0.0);' + (mask ? '\nuniform sampler2D uMask; uniform vec2 uSize;' : ''))
        .replace('#include <clipping_planes_fragment>', mask ? `#include <clipping_planes_fragment>
        { vec2 cell = vec2(floor(vWp.x + 0.5), floor(-vWp.y + 0.5)); vec2 lc = vec2(vWp.x + 0.5, -vWp.y + 0.5) - cell;
          if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uSize.x || cell.y >= uSize.y) discard;
          float k = texture2D(uMask, (cell + 0.5) / uSize).r;
          if (k < 0.004) { // empty cell: keep only the concave fillets where three sand cells meet, so inner corners round like outer ones
            float r = 0.2; bool fill = false; float fd = 1.0;
            #define SM(o) texture2D(uMask, (cell + o + 0.5) / uSize).r
            float mU = SM(vec2(0.0, -1.0)), mD = SM(vec2(0.0, 1.0)), mL = SM(vec2(-1.0, 0.0)), mR = SM(vec2(1.0, 0.0));
            if (mU > 0.5 && mL > 0.5 && SM(vec2(-1.0, -1.0)) > 0.5 && lc.x < r && lc.y < r) { float d = length(lc - vec2(r)) - r; if (d > 0.0) { fill = true; fd = d; } }
            if (mU > 0.5 && mR > 0.5 && SM(vec2(1.0, -1.0)) > 0.5 && lc.x > 1.0 - r && lc.y < r) { float d = length(lc - vec2(1.0 - r, r)) - r; if (d > 0.0) { fill = true; fd = d; } }
            if (mD > 0.5 && mL > 0.5 && SM(vec2(-1.0, 1.0)) > 0.5 && lc.x < r && lc.y > 1.0 - r) { float d = length(lc - vec2(r, 1.0 - r)) - r; if (d > 0.0) { fill = true; fd = d; } }
            if (mD > 0.5 && mR > 0.5 && SM(vec2(1.0, 1.0)) > 0.5 && lc.x > 1.0 - r && lc.y > 1.0 - r) { float d = length(lc - vec2(1.0 - r)) - r; if (d > 0.0) { fill = true; fd = d; } }
            if (!fill) discard;
            vEdge = smoothstep(0.1, 0.0, fd) * 0.8; vLc = vec2(0.5); }
          else {
          if (k < 0.56) { float code = floor(texture2D(uMask, (cell + 0.5) / uSize).g * 255.0 / 50.0 + 0.5);
            if (code < 0.5) { vec2 d = abs(lc - 0.5) * 2.0; if (max(d.x, d.y) > k) discard; }
            else { float a = code < 1.5 ? lc.x : code < 2.5 ? 1.0 - lc.x : code < 3.5 ? lc.y : 1.0 - lc.y; float pp = code < 2.5 ? lc.y : lc.x;
              float eaten = 1.0 - k; float edge = eaten * 1.3 - 0.18 - pow(abs(pp - 0.5) * 2.0, 2.0) * 0.2;
              if (a < edge) discard; vWet = smoothstep(0.09, 0.0, a - edge); } }
          float nU = texture2D(uMask, (cell + vec2(0.0, -1.0) + 0.5) / uSize).r, nD = texture2D(uMask, (cell + vec2(0.0, 1.0) + 0.5) / uSize).r;
          float nL = texture2D(uMask, (cell + vec2(-1.0, 0.0) + 0.5) / uSize).r, nR = texture2D(uMask, (cell + vec2(1.0, 0.0) + 0.5) / uSize).r;
          if (cell.y < 0.5) nU = 0.0;
          { float r = 0.2; bool oU = nU < 0.5, oD = nD < 0.5, oL = nL < 0.5, oR = nR < 0.5;
            if (oU && oL && lc.x < r && lc.y < r && length(lc - vec2(r)) > r) discard;
            if (oU && oR && lc.x > 1.0 - r && lc.y < r && length(lc - vec2(1.0 - r, r)) > r) discard;
            if (oD && oL && lc.x < r && lc.y > 1.0 - r && length(lc - vec2(r, 1.0 - r)) > r) discard;
            if (oD && oR && lc.x > 1.0 - r && lc.y > 1.0 - r && length(lc - vec2(1.0 - r)) > r) discard; }
          // shade: 0..1 darkening near exposed sides/bottom, scaled into the dug cell when it shrinks
          float e = uNew > 0.5 ? 0.17 : 0.1;
          float sh = 0.0;
          sh = max(sh, (1.0 - step(0.5, nL)) * smoothstep(e, 0.0, lc.x));
          sh = max(sh, (1.0 - step(0.5, nR)) * smoothstep(e, 0.0, 1.0 - lc.x));
          sh = max(sh, (1.0 - step(0.5, nD)) * smoothstep(e * 1.6, 0.0, 1.0 - lc.y));
          { float aa = fwidth(vWp.x) * 0.75, w = 0.042, ln = 0.0;
            ln = max(ln, (1.0 - step(0.5, nL)) * (1.0 - smoothstep(w - aa, w + aa, lc.x)));
            ln = max(ln, (1.0 - step(0.5, nR)) * (1.0 - smoothstep(w - aa, w + aa, 1.0 - lc.x)));
            ln = max(ln, (1.0 - step(0.5, nD)) * (1.0 - smoothstep(w - aa, w + aa, 1.0 - lc.y)));
            ln = max(ln, (1.0 - step(0.5, nU)) * (1.0 - smoothstep(w - aa, w + aa, lc.y)));
            vLine = 0.0; }
          vEdge = sh; vTopOpen = 1.0 - step(0.5, nU); vBotOpen = (1.0 - step(0.5, nD)) * (1.0 - step(0.5, texture2D(uMask, (cell + vec2(0.0, 1.0) + 0.5) / uSize).b));
            { /* the underside shade fades out at the ends of an overhang instead of stopping square at a cell edge (it left a dark notch) */
              vec4 dl = texture2D(uMask, (cell + vec2(-1.0, 1.0) + 0.5) / uSize), dr = texture2D(uMask, (cell + vec2(1.0, 1.0) + 0.5) / uSize);
              float dLo = (1.0 - step(0.5, dl.r)) * (1.0 - step(0.5, dl.b)), dRo = (1.0 - step(0.5, dr.r)) * (1.0 - step(0.5, dr.b));
              float fl = nL < 0.5 ? 1.0 : mix(smoothstep(0.0, 0.55, lc.x), 1.0, dLo), fr = nR < 0.5 ? 1.0 : mix(smoothstep(0.0, 0.55, 1.0 - lc.x), 1.0, dRo);
              vBotOpen *= fl * fr; }
            vLc = lc; } }` : '#include <clipping_planes_fragment>')
        .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 p = vWp.xy;
          // warm golden base with a gentle large-scale light/dark drift
          float drift = sin(p.x * 0.35 + p.y * 0.5) * 0.5 + 0.5;
          vec3 hi = vec3(1.0, 0.78, 0.33), mid = vec3(0.97, 0.63, 0.2), dark = vec3(0.7, 0.36, 0.06), lip = vec3(1.0, 0.88, 0.48);
          vec3 c = mix(mid, hi, drift * 0.6);
          { vec3 tl = pow(texture2D(uSandTex, p * 0.3).rgb, vec3(2.2)); float det = dot(tl, vec3(0.2126, 0.7152, 0.0722)) / 0.464; vec3 base = vec3(1.16, 0.84, 0.2);
            if (uNew > 0.5) { float dd = clamp((-p.y - 0.5) / 8.0, 0.0, 1.0); // sun-bleached sand on top -> warm amber -> damp russet deep down
              base = mix(vec3(1.12, 0.84, 0.42), vec3(0.98, 0.58, 0.22), smoothstep(0.0, 0.45, dd)); base = mix(base, vec3(0.58, 0.29, 0.15), smoothstep(0.45, 1.0, dd));
              float bl = sin(p.x * 0.62 + sin(p.y * 0.9) * 1.4) * sin(p.y * 0.75 + p.x * 0.28 + 1.3); base *= 1.0 + bl * 0.1; }
            c = base * mix(1.0, det, 0.58);
            if (uRef > 0.5 && uNew > 0.5) { float dd = clamp((-p.y - 0.5) / 10.0, 0.0, 1.0); // the reference's golden sand (with its rippling light lines), a touch deeper amber far down
              c = texture2D(uSandRef, p * 0.62 + vec2(0.13, 0.37)).rgb * 1.5 * vec3(1.03, 1.06, 0.82) * mix(vec3(1.0), vec3(0.95, 0.85, 0.75), dd); c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.92); } } // golden-yellow like the reference, not orange
          // sediment strata: soft wavy layers of slightly different sand, like a cut through the seabed
          float st = -p.y * 1.15 + sin(p.x * 0.45) * 0.28 + sin(p.x * 1.3 + 2.0) * 0.08;
          float band = floor(st), fb = fract(st), bh = fract(sin(band * 91.7) * 43758.5);
          c *= uNew > 0.5 ? mix(vec3(0.9, 0.86, 0.84), vec3(1.06, 1.02, 0.96), bh) : vec3(0.95 + bh * 0.08);
          c = mix(c, c * 0.8, smoothstep(0.1, 0.0, fb) * 0.8);          // thin darker seam at the top of each layer
          c = mix(c, c * 1.08, smoothstep(0.12, 0.3, fb) * smoothstep(0.5, 0.3, fb) * 0.6); // light catch just under it
          // depth: deeper sand is a touch darker and cooler
          float deep = clamp(-p.y / 11.0, 0.0, 1.0); c *= 1.0 - deep * (uNew > 0.5 ? 0.1 : 0.24); c = mix(c, c * vec3(0.92, 0.95, 1.05), deep * 0.5);
          // the odd smooth pebble
          vec2 pc = floor(p * 1.6); float ph = fract(sin(dot(pc, vec2(41.3, 289.1))) * 43758.5);
          if (ph < (uNew > 0.5 ? 0.03 : 0.09)) { vec2 q = fract(p * 1.6) - vec2(0.3 + ph * 4.0, 0.5); float d = length(q * vec2(1.0, 1.4));
            c = mix(c, vec3(0.62, 0.5, 0.42), smoothstep(0.075, 0.06, d)); c = mix(c, vec3(0.86, 0.78, 0.68), smoothstep(0.035, 0.0, length(q - vec2(-0.02, 0.025)))); }
          // very soft dune waves
          c = mix(c, hi, smoothstep(-0.6, 0.6, sin(p.x * 0.21 - p.y * 0.17)) * 0.25);
          // underwater caustic net
          float a = sin(p.x * 3.1 + uCausticT * 0.9 + sin(p.y * 2.3 + uCausticT * 0.6) * 1.5);
          float b = sin(p.y * 2.7 - uCausticT * 0.7 + sin(p.x * 2.9 - uCausticT * 0.8) * 1.5);
          float cau = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 8.0);
          c += vec3(1.0, 0.85, 0.45) * cau * 0.06;
          // glitter: sparse grains that twinkle in the light
          vec2 gc = floor(p * 26.0); float gs = fract(sin(dot(gc, vec2(127.1, 311.7))) * 43758.5453); float gph = fract(sin(dot(gc, vec2(269.5, 183.3))) * 43758.5453);
          float tw = pow(max(0.0, sin(uCausticT * (1.5 + gph * 2.0) + gph * 40.0)), 16.0);
          vec2 gl = fract(p * 26.0) - 0.5; float gd = smoothstep(0.32, 0.0, length(gl));
          vGlint = vec3(1.0, 0.96, 0.82) * step(0.985, gs) * tw * gd * 0.8 * (1.0 - vEdge);
          float speck = fract(sin(dot(floor(p * 48.0), vec2(12.9898, 78.233))) * 43758.5453);
          
          c = mix(c, uNew > 0.5 ? vec3(0.42, 0.22, 0.09) : dark * 0.75, vEdge * 0.75);
          if (uNew > 0.5 && vBotOpen > 0.001) { float band = smoothstep(0.5, 1.0, vLc.y); c = mix(c, c * vec3(0.7, 0.62, 0.58), band * band * vBotOpen); } // underside of a sand ledge: soft shade, no hard band
          c = mix(c, lip, vTopOpen * smoothstep(0.15, 0.06, vLc.y));
          c = mix(c, vec3(0.008, 0.016, 0.066) * 1.9, vLine);
          // shells, starfish and pebbles pressed into the sand face (they go away with the sand when dug)
          { vec2 dp = p * 0.5; vec2 dc = floor(dp); float hd = fract(sin(dot(dc, vec2(17.31, 91.73))) * 43758.5453);
            if (hd < 0.24 && uNew < 0.5) { float ang = hd * 61.0; mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
              vec2 q = R * ((fract(dp) - vec2(0.28 + hd * 1.8, 0.5)) / 0.5) * 0.78; vec2 qs = R * ((fract(dp) - vec2(0.28 + hd * 1.8 + 0.025, 0.5 + 0.035)) / 0.5) * 0.78;
              float a = atan(q.y, q.x), r = length(q), as = atan(qs.y, qs.x), rs = length(qs);
              if (false) {}
              else { // a pair of smooth pebbles
                for (int k = 0; k < 2; k++) { vec2 o = vec2(float(k) * 0.09 - 0.04, float(k) * 0.03); float d = length((q - o) * vec2(1.0, 1.35)) - 0.055 + float(k) * 0.012; float ds = length((qs - o) * vec2(1.0, 1.35)) - 0.055 + float(k) * 0.012;
                  c = mix(c, c * 0.75, smoothstep(0.01, -0.01, ds) * 0.7); vec3 pc = mix(vec3(0.5, 0.52, 0.58), vec3(0.78, 0.76, 0.72), float(k)) * (0.8 + 0.35 * smoothstep(0.0, 0.06, (q - o).y + 0.03));
                  c = mix(c, pc, smoothstep(0.006, -0.004, d)); } } } }
          { float g1 = fract(sin(dot(floor(p * 90.0), vec2(12.9898, 78.233))) * 43758.5453), g2 = fract(sin(dot(floor(p * 37.0), vec2(39.3, 11.7))) * 43758.5453);
            c *= 0.95 + g1 * 0.06 + (g2 - 0.5) * 0.05; }
          c = mix(c, c * vec3(0.72, 0.62, 0.5), vWet * 0.75); c += vec3(0.25, 0.2, 0.12) * smoothstep(0.03, 0.0, abs(vWet - 0.75)) * vWet;
          if (uNew > 0.5) { float l = dot(c, vec3(0.299, 0.587, 0.114)); c = max(vec3(0.0), mix(vec3(l), c, uRef > 0.5 ? 1.0 : 1.3)); } // richer, warmer sand (the lights were greying it out)
          c = mix(c, c * vec3(0.55, 0.66, 0.9), uNight); // the intro's night: a cool tint here, the moonlight grade is done in post
          { float d = length(vWp.xy - uLamp.xy), pool = smoothstep(uLamp.z * 1.9, 0.0, d), core = smoothstep(uLamp.z, 0.0, d); // the diver's lamp
            c *= 1.0 - uLampAmb * (1.0 - pool); c += c * vec3(0.75, 0.5, 0.22) * core * uLamp.w; }
          diffuseColor.rgb = c; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vNo.z > 0.5) { vec2 p = vWp.xy; float w = p.y * 7.0 + sin(p.x * 1.7) * 1.4; float cw = cos(w);
          vec3 pert = vec3(0.0);
          normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz); }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (uNew > 0.5 ? 0.24 : 0.36) + vGlint; diffuseColor.rgb *= (uNew > 0.5 ? 0.4 : 0.5);');
    };
    return m;
  }
  // moving caustic light from the water surface, added on top of a lit material
  function causticify(m, k = 0.12) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCausticT = MAT.causticT; sh.uniforms.uLamp = MAT.lamp;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpC;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWpC = (modelMatrix * wp4).xyz; }');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCausticT; uniform vec4 uLamp; varying vec3 vWpC;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec2 p = vWpC.xy * 0.8 + vWpC.z * 0.3;
          float a = sin(p.x * 3.1 + uCausticT * 0.9 + sin(p.y * 2.3 + uCausticT * 0.6) * 1.5);
          float b = sin(p.y * 2.7 - uCausticT * 0.7 + sin(p.x * 2.9 - uCausticT * 0.8) * 1.5);
          float cau = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 6.0);
          totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * cau * ${k.toFixed(3)} * (0.4 + diffuseColor.rgb);
          { float core = smoothstep(uLamp.z, 0.0, length(vWpC.xy - uLamp.xy)) * step(abs(vWpC.z), 1.2); totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.38) * core * core * uLamp.w * 0.45; } }`);
    };
    m.customProgramCacheKey = () => 'caustic' + k;
    return m;
  }
  function buildMaterials() {
    const phys = o => new THREE.MeshPhysicalMaterial(o);
    MAT.blocks = TEX.blocks.map(t => causticify(phys({ map: t, color: 0x6470e0, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.38, specularIntensity: 0.7 })));
    MAT.block = MAT.blocks[0];
    MAT.blockSide = causticify(phys({ color: 0x4c50c8, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.75 }));
    MAT.cobble = causticify(phys({ map: TEX.cobble, color: 0x38c9b6, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.4 }));
    MAT.cobbleSide = causticify(phys({ color: 0x1f9c90, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.75 }));
    MAT.boulder = causticify(phys({ map: TEX.blocks[0], color: 0xc9cfee, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 0.55 }));
    MAT.boulderSide = causticify(phys({ color: 0x8890c8, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.95 }));
    MAT.backing = new THREE.MeshBasicMaterial({ color: 0x232a78 });
    MAT.caveWall = causticify(new THREE.MeshStandardMaterial({ color: 0x2a62c8, roughness: 0.85, envMapIntensity: 0.3 }), 0.1);
    MAT.causticT = { value: 0 };
    MAT.sand = sandify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6 })); // offset: edge-on block sides were winning the depth test through the sand face (thin seams under MSAA)
    MAT.sandMask = { tex: { value: null }, size: { value: new THREE.Vector2(1, 1) } }; MAT.sandNew = { value: 0 }; MAT.sandNight = { value: 0 }; MAT.lamp = { value: new THREE.Vector4(0, 0, 2.6, 0) }; MAT.lampAmb = { value: 0 }; // the diver's lamp: (x, y, radius, strength) + how much the tank falls into shade away from it
    MAT.sandFront = sandify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, envMapIntensity: 0.2, toneMapped: false }), MAT.sandMask);
    MAT.stone = phys({ color: 0x0f52d8, roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 });
    MAT.ball = phys({ color: 0xff2200, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xc81800, emissiveIntensity: 0.45, envMapIntensity: 1.1, sheen: 0.6, sheenColor: 0xff9a60, sheenRoughness: 0.35 });
    MAT.ballCore = new THREE.SpriteMaterial({ map: TEX.dot, color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
    MAT.ballGlow = new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff4a18, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
    MAT.gateFrame = phys({ color: 0x2a3f7a, roughness: 0.22, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6 });
    MAT.gateScreen = new THREE.MeshBasicMaterial({ map: TEX.gate, toneMapped: false });
    MAT.lampRed = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2010, emissiveIntensity: 3.5 });
    MAT.lampGreen = new THREE.MeshStandardMaterial({ color: 0x3aff7a, emissive: 0x20ff60, emissiveIntensity: 3.5 });
    MAT.cyanGlow = new THREE.SpriteMaterial({ map: TEX.dot, color: 0x5fd8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 });
    // characters
    MAT.helmet = phys({ color: 0x1f6fe0, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.7 });
    MAT.yellow = phys({ color: 0xffc416, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.5 });
    MAT.navy = phys({ color: 0x1a2f66, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.2 });
    MAT.visor = phys({ color: 0xdff4ff, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.0, transparent: true, opacity: 0.3, envMapIntensity: 2.6, depthWrite: false, iridescence: 0.35, iridescenceIOR: 1.3 });
    MAT.white = phys({ color: 0xffffff, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 });
    MAT.skin = phys({ color: 0xffd9b8, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: 0xffb090 });
    MAT.cheek = new THREE.MeshStandardMaterial({ color: 0xff8a9a, roughness: 0.6 });
    MAT.black = phys({ color: 0x111827, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
    MAT.fish = phys({ color: 0x8a4dff, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6, iridescence: 0.4, iridescenceIOR: 1.4 });
    MAT.fishBelly = phys({ color: 0xffd447, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 });
    MAT.fin = phys({ color: 0xff5fa8, roughness: 0.3, clearcoat: 0.8, envMapIntensity: 1.2, side: THREE.DoubleSide });
    MAT.redEye = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1010, emissiveIntensity: 2.2 });
    MAT.jelly = phys({ color: 0xff8fd8, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.75, emissive: 0xff4fc0, emissiveIntensity: 0.55, envMapIntensity: 1.6, iridescence: 0.6, iridescenceIOR: 1.3, side: THREE.DoubleSide, depthWrite: false });
    MAT.tentacle = new THREE.MeshStandardMaterial({ color: 0xffa8e6, emissive: 0xff50c8, emissiveIntensity: 0.7, transparent: true, opacity: 0.85 });
    MAT.crab = phys({ color: 0xff7a1f, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 });
    MAT.bubbleShell = phys({ color: 0xd8f4ff, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.0, transparent: true, opacity: 0.4, envMapIntensity: 2.6, depthWrite: false, iridescence: 1, iridescenceIOR: 1.33, iridescenceThicknessRange: [200, 700] });
    MAT.o2 = new THREE.SpriteMaterial({ map: TEX.o2, transparent: true, depthWrite: false });
    MAT.kelp = phys({ color: 0x29b860, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 1.1, side: THREE.DoubleSide, emissive: 0x0a3a1a, emissiveIntensity: 0.3, sheen: 0.5, sheenColor: 0x9affc0 });
    MAT.coralPink = phys({ color: 0xff6fb2, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.1 });
    MAT.coralPurple = phys({ color: 0xa35cff, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.1 });
    MAT.coralOrange = phys({ color: 0xff8a3a, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.1 });
    MAT.lip = phys({ color: 0xffd23a, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, emissive: 0x8a5a00, emissiveIntensity: 0.35, envMapIntensity: 1 });
    MAT.shadow = new THREE.MeshBasicMaterial({ map: TEX.dot, color: 0x0a2050, transparent: true, opacity: 0.35, depthWrite: false });
  }
  class Particles {
    constructor(scene, max = 1500) {
      this.max = max; this.n = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.kind = new Uint8Array(max); this.baseSize = new Float32Array(max);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
      this.mat = new THREE.ShaderMaterial({ uniforms: { tex: { value: TEX.dot }, scale: { value: 300 } }, vertexShader: `attribute float size; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`, fragmentShader: `uniform sampler2D tex; varying vec3 vC; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true });
      this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
      // bubbles use a separate, non-additive layer
      this.bub = { n: 0, pos: new Float32Array(400 * 3), vel: new Float32Array(400 * 3), life: new Float32Array(400), size: new Float32Array(400) };
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(this.bub.pos, 3)); bg.setAttribute('size', new THREE.BufferAttribute(this.bub.size, 1));
      this.bubMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: TEX.bubble }, scale: { value: 300 } }, vertexShader: `attribute float size; uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`, fragmentShader: `uniform sampler2D tex; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85, 0.95, 1.0), t.a * 0.8); }`, transparent: true, depthWrite: false });
      this.bubPoints = new THREE.Points(bg, this.bubMat); this.bubPoints.frustumCulled = false; scene.add(this.bubPoints);
    }
    emit(x, y, z, count, opts) {
      for (let k = 0; k < count; k++) {
        if (this.n >= this.max) return;
        const i = this.n++;
        const a = Math.random() * Math.PI * 2, sp = (opts.speed || 1) * (0.4 + Math.random() * 0.8);
        this.pos[i * 3] = x + (Math.random() - 0.5) * (opts.spread || 0.4); this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * (opts.spread || 0.4); this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
        this.vel[i * 3] = Math.cos(a) * sp + (opts.vx || 0); this.vel[i * 3 + 1] = Math.sin(a) * sp + (opts.vy || 0); this.vel[i * 3 + 2] = (Math.random() - 0.5) * sp * 0.5;
        const c = opts.color; const v = 0.7 + Math.random() * 0.3;
        this.col[i * 3] = c.r * v; this.col[i * 3 + 1] = c.g * v; this.col[i * 3 + 2] = c.b * v;
        this.life[i] = this.maxLife[i] = (opts.life || 0.8) * (0.6 + Math.random() * 0.8);
        this.baseSize[i] = (opts.size || 0.12) * (0.6 + Math.random() * 0.8); this.kind[i] = opts.kind || 0;
      }
    }
    bubbles(x, y, z, count, size = 0.1, spread = 0.3) {
      const b = this.bub;
      for (let k = 0; k < count; k++) {
        if (b.n >= 400) return; const i = b.n++;
        b.pos[i * 3] = x + (Math.random() - 0.5) * spread; b.pos[i * 3 + 1] = y + (Math.random() - 0.5) * spread; b.pos[i * 3 + 2] = z + 0.2 + Math.random() * 0.3;
        b.vel[i * 3] = (Math.random() - 0.5) * 0.3; b.vel[i * 3 + 1] = 0.6 + Math.random() * 0.8; b.vel[i * 3 + 2] = 0;
        b.life[i] = 1.2 + Math.random() * 1.5; b.size[i] = size * (0.5 + Math.random());
      }
    }
    update(dt, time) {
      let n = this.n;
      for (let i = 0; i < n; i++) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) { n--; const j = n; // swap-remove
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.baseSize[i] = this.baseSize[j]; this.kind[i] = this.kind[j]; i--; continue; }
        const k = this.kind[i];
        const drag = k === 1 ? 0.9 : 0.96;
        this.vel[i * 3] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + (k === 1 ? -1.5 * dt : k === 2 ? 0.8 * dt : 0.15 * dt); this.vel[i * 3 + 2] *= drag;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        const t = this.life[i] / this.maxLife[i]; this.size[i] = this.baseSize[i] * (k === 1 ? t : Math.sin(t * Math.PI) + 0.2);
      }
      this.n = n;
      const g = this.points.geometry; g.setDrawRange(0, n); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
      const b = this.bub; let m = b.n;
      for (let i = 0; i < m; i++) {
        b.life[i] -= dt;
        if (b.life[i] <= 0 || b.pos[i * 3 + 1] > this.top + 1) { m--; const j = m; for (let k = 0; k < 3; k++) { b.pos[i * 3 + k] = b.pos[j * 3 + k]; b.vel[i * 3 + k] = b.vel[j * 3 + k]; } b.life[i] = b.life[j]; b.size[i] = b.size[j]; i--; continue; }
        b.pos[i * 3] += (b.vel[i * 3] + Math.sin(time * 5 + i) * 0.25) * dt; b.pos[i * 3 + 1] += b.vel[i * 3 + 1] * dt; b.vel[i * 3 + 1] += 0.4 * dt;
      }
      b.n = m; const bg = this.bubPoints.geometry; bg.setDrawRange(0, m); bg.attributes.position.needsUpdate = true; bg.attributes.size.needsUpdate = true;
    }
  }


  // ---------------------------------------------------------------- models
  const GEO = {};
  function buildGeometry() {
    GEO.block = roundedBox(0.95, 0.95, 0.9, 0.17, 5);
    GEO.boulder = roundedBox(0.84, 0.84, 0.8, 0.2, 5);
    GEO.sand = new THREE.BoxGeometry(1.0, 1.0, 0.74); GEO.sand.translate(0, 0, -0.02); GEO.sandFront = new THREE.PlaneGeometry(1.012, 1.012);
    GEO.backing = new THREE.PlaneGeometry(1.02, 1.02);
    GEO.sphere = new THREE.SphereGeometry(0.43, 40, 28);
    GEO.ball = new THREE.SphereGeometry(0.41, 40, 28);
    GEO.shadow = new THREE.PlaneGeometry(1, 0.35);
    GEO.lip = new THREE.CapsuleGeometry(0.06, 0.94, 4, 8); GEO.lip.rotateZ(Math.PI / 2);
  }
  function withShadow(g) { g.userData.shadow = { visible: false }; return g; }

  // ---------------------------------------------------------------- outlines (inverted hull)
  // A dark copy of each shape, pushed outward along smoothed normals and drawn back-faces only, sits behind the
  // object: a clean, anti-aliased border of constant thickness that follows the real silhouette.
  const INK = 0x16204a, INK_W = 0.042;
  const hullCache = new Map();
  function hullGeo(geo) {
    if (hullCache.has(geo.uuid)) return hullCache.get(geo.uuid);
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); const P = g.attributes.position, N = g.attributes.normal; const acc = new Map(), key = i => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
    for (let i = 0; i < P.count; i++) { const k = key(i); const a = acc.get(k) || [0, 0, 0]; a[0] += N.getX(i); a[1] += N.getY(i); a[2] += N.getZ(i); acc.set(k, a); }
    const sn = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; sn[i * 3] = a[0] / l; sn[i * 3 + 1] = a[1] / l; sn[i * 3 + 2] = a[2] / l; }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', g.attributes.position); out.setAttribute('normal', new THREE.BufferAttribute(sn, 3)); out.computeBoundingSphere();
    hullCache.set(geo.uuid, out); return out;
  }
  const hullMat = new THREE.ShaderMaterial({ uniforms: { uW: { value: INK_W }, uC: { value: new THREE.Color(INK) } }, side: THREE.BackSide, toneMapped: false, fog: false,
    vertexShader: `uniform float uW; void main(){
      #ifdef USE_INSTANCING
        mat4 mm = modelMatrix * instanceMatrix;
      #else
        mat4 mm = modelMatrix;
      #endif
      vec3 wn = normalize(mat3(mm) * normal);
      vec4 wp = mm * vec4(position, 1.0); wp.xyz += wn * uW;
      gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uC; void main(){ gl_FragColor = vec4(uC, 1.0); }` });
  const hullThin = hullMat.clone(); hullThin.uniforms.uW.value = 0.016; hullThin.uniforms.uC.value = new THREE.Color(0x1c2a5e);
  // give every opaque, not-tiny mesh in a group its own hull
  function outline(root, minR = 0.055, mat = hullThin) {
    const meshes = []; root.traverse(o => { if (o.isMesh && !o.userData.isHull && !o.userData.noOutline) meshes.push(o); });
    for (const m of meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some(x => x.transparent || x === MAT.shadow)) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const ws = new THREE.Vector3(); m.getWorldScale(ws); const r = m.geometry.boundingSphere.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
      if (r < minR) continue;
      const h = new THREE.Mesh(hullGeo(m.geometry), mat); h.userData.isHull = true; h.renderOrder = -1; m.add(h); m.castShadow = true;
    }
    return root;
  }
  function outlineInst(im, parent) {
    const h = new THREE.InstancedMesh(hullGeo(im.geometry), hullMat, im.count || 1); h.castShadow = false; h.count = im.count; h.instanceMatrix.copy(im.instanceMatrix); h.instanceMatrix.needsUpdate = true; h.userData.isHull = true; h.renderOrder = -1; parent.add(h); return h;
  }

  // new look: a sculpted blue reef boulder like the sheet's rocks: soft chiselled facets, the sheet's cyan "web" veins
  // (a tiling Voronoi texture sampled triplanar in the stone's own space, so it rolls with the stone), crevices
  // darkened, a few barnacles. One mesh + one material for every stone.
  function rockWebTex() { const S = 256, G = 8, cs = S / G, [c, g] = canvas(S), im = g.createImageData(S, S), D = im.data; let sd = 99;
    const R = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const pts = [], tone = []; for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { pts.push([(i + 0.15 + R() * 0.7) * cs, (j + 0.15 + R() * 0.7) * cs]); tone.push(R()); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const gi = (x / cs) | 0, gj = (y / cs) | 0; let f1 = 1e9, f2 = 1e9, id = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = (gi + di + G) % G, jj = (gj + dj + G) % G, q = pts[jj * G + ii];
        const px = q[0] + (gi + di - ii) * cs, py = q[1] + (gj + dj - jj) * cs, d = Math.hypot(px - x, py - y);
        if (d < f1) { f2 = f1; f1 = d; id = jj * G + ii; } else if (d < f2) f2 = d; }
      const e = Math.max(0, 1 - (f2 - f1) / 2.4), e2 = Math.max(0, 1 - (f2 - f1) / 7), cen = Math.min(1, f1 / (cs * 0.75)), t = tone[id], n = Math.random() * 0.06;
      // cell: deep blue, a touch lighter toward the middle; veins: bright cyan with a soft halo
      let r = 0.13 + t * 0.06 - cen * 0.05 + n, gg = 0.30 + t * 0.10 - cen * 0.08 + n, bb = 0.62 + t * 0.12 - cen * 0.08 + n;
      const TP = Math.PI * 2 / S, br = 0.55 + 0.45 * Math.sin(x * TP * 2 + Math.sin(y * TP * 3) * 2) * Math.sin(y * TP * 2 + 1.3); /* veins fade in and out (tiles: whole periods) */
      const ve = e * br, ve2 = e2 * br; r *= 0.92; gg *= 0.92; bb *= 0.95;
      r += ve2 * 0.04 + ve * 0.15; gg += ve2 * 0.1 + ve * 0.28; bb += ve2 * 0.1 + ve * 0.22;
      const k = (y * S + x) * 4; D[k] = Math.min(255, r * 255); D[k + 1] = Math.min(255, gg * 255); D[k + 2] = Math.min(255, bb * 255); D[k + 3] = 255; }
    g.putImageData(im, 0, 0); const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
  function makeBoulder() {
    if (!GEO.rockN) { const g = new THREE.SphereGeometry(0.43, 36, 26), P = g.attributes.position, v = new THREE.Vector3();
      const planes = [[0.2, 0.9, 0.3, 0.405], [0.85, 0.2, 0.45, 0.41], [-0.8, 0.35, 0.5, 0.41], [0.1, 0.2, 1, 0.415], [-0.3, -0.5, 0.8, 0.415], [0.6, -0.4, -0.7, 0.41], [-0.6, 0.6, -0.5, 0.41], [0.3, -0.9, 0.2, 0.41], [-0.7, -0.6, -0.3, 0.41]].map(([x, y, z, d]) => [new THREE.Vector3(x, y, z).normalize(), d]);
      const col = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); const n = Math.sin(v.x * 7.1 + v.y * 3.3) * 0.5 + Math.sin(v.y * 5.7 - v.z * 4.9) * 0.4 + Math.sin(v.z * 6.3 + v.x * 5.1) * 0.3;
        v.multiplyScalar(1 + n * 0.028); // gentle lumps: the outline stays round, so a rolling stone never wobbles or lifts off the floor
        for (const [pn, d] of planes) { const h = v.dot(pn); if (h > d) v.addScaledVector(pn, (d - h) * 0.85); } // chisel: flatten toward a few planes
        P.setXYZ(i, v.x, v.y, v.z);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1; } // no baked underside shade (it rolled round to the top); the key light shades it
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
      // barnacles: small cream domes merged into the same geometry (vertex colour), on the upper front
      const parts = [g], bp = [[0.16, 0.25, 0.27, 0.032], [0.23, 0.19, 0.27, 0.022], [-0.24, 0.1, 0.31, 0.026]];
      for (const [x, y, z, r] of bp) { const b = new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); const dir = new THREE.Vector3(x, y, z).normalize();
        b.scale(1, 0.45, 1); b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)); b.translate(x, y, z);
        const bc = new Float32Array(b.attributes.position.count * 3); for (let i = 0; i < bc.length; i += 3) { bc[i] = 3.2; bc[i + 1] = 3.0; bc[i + 2] = 2.4; } b.setAttribute('color', new THREE.BufferAttribute(bc, 3)); parts.push(b); }
      let nv = 0, ni = 0; for (const q of parts) { nv += q.attributes.position.count; ni += q.index.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cl = new Float32Array(nv * 3), idx = new Uint32Array(ni); let ov = 0, oi = 0;
      for (const q of parts) { pos.set(q.attributes.position.array, ov * 3); nor.set(q.attributes.normal.array, ov * 3); cl.set(q.attributes.color.array, ov * 3);
        for (let i = 0; i < q.index.count; i++) idx[oi + i] = q.index.array[i] + ov; ov += q.attributes.position.count; oi += q.index.count; }
      const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      m.setIndex(new THREE.BufferAttribute(idx, 1)); m.computeBoundingSphere(); GEO.rockN = m;
      TEX.rockWeb = rockWebTex();
      const mat = causticify(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: 0x6fd8ff, sheenRoughness: 0.5, envMapIntensity: 0.7 }), 0.14);
      const prev = mat.onBeforeCompile; mat.onBeforeCompile = (sh, r) => { prev(sh, r); sh.uniforms.uWeb = { value: TEX.rockWeb };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOp; varying vec3 vOn;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = position; vOn = normal;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uWeb; varying vec3 vOp; varying vec3 vOn;')
          .replace('#include <map_fragment>', `{ vec3 w = pow(abs(normalize(vOn)), vec3(4.0)); w /= (w.x + w.y + w.z);
            vec3 p = vOp * 0.72;
            vec3 tc = texture2D(uWeb, p.yz).rgb * w.x + texture2D(uWeb, p.xz + 0.37).rgb * w.y + texture2D(uWeb, p.xy + 0.71).rgb * w.z;
            float barn = step(1.5, vColor.r);
            diffuseColor.rgb = mix(tc * vColor.rgb, vec3(0.78, 0.8, 0.82) * (0.8 + 0.2 * tc.g), barn); }`)
          .replace('#include <color_fragment>', ''); };
      mat.customProgramCacheKey = () => 'rockWeb4'; MAT.rockN = mat; }
    const g = new THREE.Group(); const spin = new THREE.Group(); g.add(spin); const m = new THREE.Mesh(GEO.rockN, MAT.rockN); m.castShadow = true; spin.add(m);
    g.userData.spin = spin; return withShadow(g);
  }
  function makeStone(newArt) {
    if (newArt) return makeBoulder();
    const g = new THREE.Group(); const spin = new THREE.Group(); g.add(spin);
    const m = new THREE.Mesh(GEO.boulder, [MAT.boulder, MAT.boulderSide]); spin.add(m);
    const boss = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 12, 32), MAT.boulderSide); boss.position.z = 0.4; boss.userData.noOutline = true; spin.add(boss);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.boulder); cap.rotation.x = Math.PI / 2; cap.scale.y = 0.35; cap.position.z = 0.4; cap.userData.noOutline = true; spin.add(cap);
    g.userData.spin = spin; return withShadow(g);
  }
  // colour-blind markers: one shared material, so the Settings switch shows/hides every marker at once
  function cbMark() { if (!MAT.cbMark) { const [c, g] = canvas(128); g.translate(64, 64); g.lineJoin = 'round';
      g.beginPath(); g.moveTo(0, -44); g.lineTo(38, 0); g.lineTo(0, 44); g.lineTo(-38, 0); g.closePath(); g.lineWidth = 16; g.strokeStyle = '#10213f'; g.stroke(); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fillStyle = '#10213f'; g.fill();
      MAT.cbMark = new THREE.SpriteMaterial({ map: tex(c, false), transparent: true, depthWrite: false }); MAT.cbMark.visible = !!CB.on; }
    const sp = new THREE.Sprite(MAT.cbMark); sp.renderOrder = 5; return sp; }
  const CB = { on: false };
  function makeBall(newArt) {
    // new look: a deep ruby glass pearl (the sheet's energy pearl) rather than an orange plastic ball
    if (newArt && !MAT.pearl) MAT.pearl = new THREE.MeshPhysicalMaterial({ color: 0xb00410, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x9a0010, emissiveIntensity: 0.7, envMapIntensity: 1.2 });
    const g = new THREE.Group(); const m = new THREE.Mesh(GEO.ball, newArt ? MAT.pearl : MAT.ball); g.add(m);
    const glow = new THREE.Sprite(MAT.ballGlow); glow.scale.set(1.75, 1.75, 1); glow.position.z = -0.1; g.add(glow);
    const core = new THREE.Sprite(MAT.ballCore); core.scale.set(0.55, 0.55, 1); core.position.set(-0.04, 0.02, 0.3); g.add(core); g.userData = { core };
    Object.assign(g.userData, { spin: m, glow }); const mk = cbMark(); mk.scale.set(0.36, 0.36, 1); mk.position.set(0, 0, 0.55); g.add(mk); return withShadow(g);
  }
  function makeGate() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(roundedBox(0.96, 0.96, 0.9, 0.11), [MAT.gateFrame, MAT.gateFrame]); g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.6), MAT.gateScreen); screen.position.set(0, -0.06, 0.452); g.add(screen);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), MAT.lampRed); lamp.position.set(0, 0.33, 0.45); g.add(lamp);
    const glow = new THREE.Sprite(MAT.cyanGlow.clone()); glow.scale.set(1.4, 1.4, 1); glow.position.z = 0.5; glow.material.opacity = 0.25; g.add(glow);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff3a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 })); lampGlow.scale.set(0.35, 0.35, 1); lampGlow.position.set(0, 0.33, 0.5); g.add(lampGlow);
    const mk = cbMark(); mk.scale.set(0.42, 0.42, 1); mk.position.set(0, -0.06, 0.62); g.add(mk);
    g.userData = { screen, lamp, glow, lampGlow }; return g;
  }
  function makeDiverProc() {
    // chibi deep-sea diver: big glossy helmet with a brass porthole, cute face behind glass, headlamp,
    // twin air tanks with a hose, chunky gloves and long swim fins. Built facing +x, face turned toward camera.
    if (!MAT.brass) {
      MAT.brass = new THREE.MeshPhysicalMaterial({ color: 0xffb93a, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 });
      MAT.chrome = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f5, metalness: 0.9, roughness: 0.18, clearcoat: 1, envMapIntensity: 1.6 });
      MAT.finMat = new THREE.MeshPhysicalMaterial({ color: 0xff5a3c, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2, side: THREE.DoubleSide, sheen: 0.4, sheenColor: 0xffb090 });
      MAT.glass = new THREE.MeshPhysicalMaterial({ color: 0xe8f8ff, roughness: 0.0, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.18, envMapIntensity: 3, depthWrite: false });
      MAT.lampOn = new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xfff0b0, emissiveIntensity: 3 });
      MAT.mouth = new THREE.MeshStandardMaterial({ color: 0x7a2030, roughness: 0.5 });
    }
    if (!MAT.dHelm) { // signature look: glossy violet helmet + gloves, sunny suit, electric-cyan fins, all with a soft cyan rim glow so the diver pops off any background
      const rimify = (m, col, k) => { m.onBeforeCompile = (sh) => { sh.uniforms.uRim = { value: new THREE.Color(col).multiplyScalar(k) };
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;').replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n{ float rim = pow(max(0.0, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)))), 2.6); totalEmissiveRadiance += uRim * rim; }'); };
        m.customProgramCacheKey = () => 'rim' + col + k; return m; };
      MAT.dHelm = rimify(new THREE.MeshPhysicalMaterial({ color: 0x5a12f0, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.9, emissive: 0x1c0060, emissiveIntensity: 1 }), 0x3fe8ff, 0.45);
      MAT.dSuit = rimify(new THREE.MeshPhysicalMaterial({ color: 0xffb800, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9, emissive: 0x4a2a00, emissiveIntensity: 1 }), 0x3fe8ff, 0.3);
      MAT.dFin = rimify(new THREE.MeshPhysicalMaterial({ color: 0x00a8ff, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.8, side: THREE.DoubleSide, emissive: 0x003a66, emissiveIntensity: 1 }), 0x9ff6ff, 0.3);
      MAT.dScarf = new THREE.MeshPhysicalMaterial({ color: 0xff1f6e, roughness: 0.4, side: THREE.DoubleSide, emissive: 0x6a0828, emissiveIntensity: 1, envMapIntensity: 0.6 });
    }
    const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
    // ---- helmet + head
    const head = new THREE.Group(); head.position.set(0.02, 0.14, 0); body.add(head);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.27, 40, 28), MAT.dHelm); head.add(shell);
    for (const sz of [-1, 1]) { const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), MAT.brass); bolt.position.set(-0.05, 0.02, sz * 0.265); head.add(bolt); }
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 16), MAT.brass); lampBase.position.set(0.05, 0.27, 0.02); lampBase.rotation.z = -0.3; head.add(lampBase);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 10), MAT.lampOn); lamp.position.set(0.075, 0.3, 0.02); head.add(lamp);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xfff0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 })); lampGlow.scale.setScalar(0.35); lampGlow.position.copy(lamp.position); head.add(lampGlow);
    const face = new THREE.Group(); face.rotation.y = 1.05; head.add(face);
    const port = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.045, 18, 48), MAT.brass); port.position.z = 0.215; face.add(port);
    const skin = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), MAT.skin); skin.scale.set(1, 0.96, 0.52); skin.position.z = 0.19; face.add(skin);
    // ---- expressive face: eyes in their own groups (blink / squint / widen / glance), happy ^^ eyes, brows, three mouths, cheeks
    if (!MAT.eyeDeep) { MAT.eyeDeep = new THREE.MeshStandardMaterial({ color: 0x1b1036, roughness: 0.25 }); MAT.eyeGlint = new THREE.MeshBasicMaterial({ color: 0x7ff3ff });
      MAT.brow = new THREE.MeshStandardMaterial({ color: 0x5a3220, roughness: 0.6 }); MAT.tongue = new THREE.MeshStandardMaterial({ color: 0xff7a8e, roughness: 0.5 });
      MAT.visorShine = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }); }
    const eyes = [], happy = [], brows = [], cheeks = [];
    for (const sx of [-0.065, 0.065]) {
      const eg = new THREE.Group(); eg.position.set(sx, 0.02, 0.268); face.add(eg); eg.userData.base = eg.position.clone();
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.048, 24, 16), MAT.eyeDeep); eye.scale.set(0.9, 1.15, 0.5); eg.add(eye);
      const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), MAT.white); h1.position.set(0.016, 0.026, 0.022); eg.add(h1);
      const h2 = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), MAT.white); h2.position.set(-0.014, -0.018, 0.022); eg.add(h2);
      const h3 = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 6), MAT.eyeGlint); h3.scale.set(1.6, 0.6, 0.4); h3.position.set(0.0, -0.034, 0.018); eg.add(h3); // the lower cyan glint
      eyes.push(eg);
      const hp = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.009, 8, 18, Math.PI), MAT.eyeDeep); hp.position.set(sx, 0.005, 0.272); hp.visible = false; face.add(hp); happy.push(hp);
      const br = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.034, 4, 8), MAT.brow); br.rotation.z = Math.PI / 2; br.position.set(sx, 0.088, 0.268); br.userData.base = br.position.clone(); face.add(br); brows.push(br);
      const ck = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), MAT.cheek); ck.scale.set(1.2, 0.7, 0.3); ck.position.set(sx * 1.6, -0.055, 0.262); face.add(ck); cheeks.push(ck);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI), MAT.mouth); smile.rotation.z = Math.PI; smile.position.set(0, -0.045, 0.275); face.add(smile);
    const mouthO = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), MAT.mouth); mouthO.scale.set(1, 1.25, 0.4); mouthO.position.set(0, -0.055, 0.272); mouthO.visible = false; face.add(mouthO);
    const mouthJoy = new THREE.Group(); mouthJoy.position.set(0, -0.04, 0.274); mouthJoy.visible = false; face.add(mouthJoy);
    { const d = new THREE.Mesh(new THREE.CircleGeometry(0.042, 20, Math.PI, Math.PI), MAT.mouth); mouthJoy.add(d); const tg = new THREE.Mesh(new THREE.CircleGeometry(0.02, 14, Math.PI, Math.PI), MAT.tongue); tg.position.set(0.006, -0.02, 0.002); mouthJoy.add(tg); }
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.175, 32, 20), MAT.glass); glass.scale.set(1, 1, 0.6); glass.position.z = 0.22; face.add(glass);
    { const sh1 = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.01, 6, 24, 1.0), MAT.visorShine); sh1.rotation.z = 1.75; sh1.position.z = 0.3; face.add(sh1);
      const sh2 = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), MAT.visorShine); sh2.position.set(-0.1, 0.1, 0.3); face.add(sh2); }
    for (let i = 0; i < 3; i++) { const v = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), MAT.brass); v.position.set(-0.24, 0.07 - i * 0.06, 0.0); head.add(v); } // side vent rivets
    { const crest = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.014, 8, 40, Math.PI * 0.9), MAT.brass); crest.rotation.set(Math.PI / 2, 0, 0.1); crest.position.y = 0.0; head.add(crest); } // brass band round the helmet
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 14, 36), MAT.brass); collar.rotation.x = Math.PI / 2; collar.position.set(0.0, -0.11, 0); head.add(collar);
    // ---- torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.1, 10, 20), MAT.dSuit); torso.position.set(-0.01, -0.17, 0); body.add(torso);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.028, 10, 28), MAT.navy); belt.rotation.x = Math.PI / 2; belt.position.set(-0.01, -0.23, 0); body.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), MAT.brass); buckle.position.set(0.13, -0.23, 0.03); body.add(buckle);
    { const badge = new THREE.Mesh(new THREE.CircleGeometry(0.035, 5), MAT.dFin); badge.position.set(0.1, -0.15, 0.1); badge.rotation.y = 0.9; body.add(badge); } // little star badge on the chest
    // ---- twin tanks + hose
    for (const sz of [-0.055, 0.055]) { const tk = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.17, 8, 16), MAT.chrome); tk.position.set(-0.18, -0.13, sz); body.add(tk);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), MAT.dFin); cap.position.set(-0.18, 0.0, sz); body.add(cap); }
    { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.18, 0.02, 0), new THREE.Vector3(-0.25, 0.12, 0), new THREE.Vector3(-0.2, 0.25, 0.05), new THREE.Vector3(-0.08, 0.3, 0.1)]);
      const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.018, 8), MAT.navy); body.add(hose); }
    // ---- arms (shoulder pivots)
    const arm = (z, back) => { const sh = new THREE.Group(); sh.position.set(0.0, -0.1, z); body.add(sh);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 6, 12), MAT.dSuit); up.position.y = -0.08; sh.add(up);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), MAT.dHelm); glove.scale.set(1, 0.9, 0.9); glove.position.y = -0.17; sh.add(glove);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 18), MAT.brass); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.128; sh.add(cuff);
      return sh; };
    const armF = arm(0.14), armB = arm(-0.14);
    // ---- legs with fins (hip pivots)
    const finGeo = (() => { const sh = new THREE.Shape(); sh.moveTo(0, -0.035); sh.lineTo(0.2, -0.07); sh.quadraticCurveTo(0.26, 0, 0.2, 0.07); sh.lineTo(0, 0.035); sh.closePath();
      const gg = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 }); gg.rotateX(Math.PI / 2); gg.translate(0, 0, 0); return gg; })();
    const leg = (z) => { const hip = new THREE.Group(); hip.position.set(-0.01, -0.29, z); body.add(hip);
      const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.1, 6, 12), MAT.dSuit); th.position.y = -0.07; hip.add(th);
      const boot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), MAT.navy); boot.scale.set(1.2, 0.8, 1); boot.position.set(0.01, -0.16, 0); hip.add(boot);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), MAT.navy); knee.scale.set(1, 1, 0.7); knee.position.set(0.04, -0.08, 0); hip.add(knee);
      const finPivot = new THREE.Group(); finPivot.position.set(0.03, -0.175, 0); hip.add(finPivot);
      const fin = new THREE.Mesh(finGeo, MAT.dFin); finPivot.add(fin); finPivot.rotation.z = -0.25;
      return { hip, finPivot }; };
    const LF = leg(0.065), LB = leg(-0.065);
    // signature scarf: two pink tails streaming from the collar (animated in update)
    const scarf = []; { const knot = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 10, 28), MAT.dScarf); knot.rotation.x = Math.PI / 2; knot.position.set(0.0, 0.03, 0); body.add(knot);
      for (const [z, len] of [[0.07, 0.42], [-0.04, 0.34]]) { const gg = new THREE.PlaneGeometry(len, 0.1, 8, 1); gg.translate(-len / 2, 0, 0); const P = gg.attributes.position; for (let i = 0; i < P.count; i++) { const x = -P.getX(i) / len; P.setY(i, P.getY(i) * (1 - x * 0.45)); }
        const piv = new THREE.Group(); piv.position.set(-0.12, 0.03, z); body.add(piv); const rib = new THREE.Mesh(gg, MAT.dScarf); piv.add(rib); scarf.push({ piv, geo: gg, base: Float32Array.from(P.array), len }); } }
    if (SKIN.scarf === 'none') body.children.forEach(c => { if (c.material === MAT.dScarf) c.visible = false; }), scarf.forEach(sc => { sc.piv.visible = false; });
    const hat = makeHat(SKIN.hat); if (hat) head.add(hat);
    g.userData = { body, head, face, armF, armB, legF: LF.hip, legB: LB.hip, finF: LF.finPivot, finB: LB.finPivot, lampGlow, scarf, eyes, happy, brows, cheeks, smile, mouthO, mouthJoy, hat };
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return withShadow(g);
  }

  // ---------------------------------------------------------------- the owner's Meshy diver (skinned, 3.1k triangles, 23 bones)
  // src/assets/models/diver.js is generated by tools/convert_diver.py from the rigged GLB (texture shrunk to 1024 WebP, clips made
  // in-place). Built facing +x and sized like the old procedural diver (feet at y -0.5, helmet top ~0.42), so the cell fit, hats,
  // the shop preview and every procedural move (spring glide, lean, turn, squash, death poses) work unchanged. The limbs come from
  // the clips: stand / walk / swim / float idle / push, blended by what the diver is doing (see GLB.drive).
  const GLB = { ready: null };
  const GLB_POSE = { stand: ['walk', 0.569], push: ['push', 0.65] }, GLB_K = 0.54; // model metres -> old diver units
  function glbData() {
    if (GLB.ready !== null) return GLB.ready ? GLB : null; const D = window.AQ_DIVER; GLB.ready = !!D; if (!D) return null;
    const dec = (b, T) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); };
    const M = D.mesh, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dec(M.pos, Float32Array), 3)); g.setAttribute('normal', new THREE.BufferAttribute(dec(M.nrm, Int8Array), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(dec(M.uv, Uint16Array), 2, true)); g.setAttribute('skinIndex', new THREE.BufferAttribute(dec(M.j, Uint8Array), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(dec(M.w, Uint8Array), 4, true)); g.setIndex(new THREE.BufferAttribute(dec(M.idx, Uint16Array), 1)); g.computeBoundingBox(); g.computeBoundingSphere();
    GLB.geo = g; GLB.ibm = dec(D.ibm, Float32Array); GLB.D = D;
    const img = new Image(), tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4; img.onload = () => { tex.needsUpdate = true; }; img.src = D.tex; GLB.tex = tex;
    GLB.clips = {}; for (const c of D.clips) GLB.clips[c.name] = new THREE.AnimationClip(c.name, c.dur, c.tracks.map(t => { const bn = D.bones[t.b].n, tm = dec(t.t, Float32Array);
      if (t.k === 'q') { const q = dec(t.v, Int16Array), f = new Float32Array(q.length); for (let i = 0; i < q.length; i++) f[i] = q[i] / 32767; return new THREE.QuaternionKeyframeTrack(bn + '.quaternion', tm, f); }
      return new THREE.VectorKeyframeTrack(bn + '.position', tm, dec(t.v, Float32Array)); }));
    // shop suits: the purple / yellow / pink areas of the painted texture take the suit's helmet / suit / fin colours (shading kept)
    GLB.uni = { uSkinOn: { value: 0 }, uHelm: { value: new V3() }, uSuit: { value: new V3() }, uFin: { value: new V3() } };
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, envMapIntensity: 0.55, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16, side: THREE.DoubleSide }); // the model is double-sided (thin helmet shell)
    m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, GLB.uni);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSkinOn; uniform vec3 uHelm, uSuit, uFin;\nvec3 aqSkin(vec3 lin) { if (uSkinOn < 0.5) return lin; vec3 c = pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2));\n float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn, s = d / max(mx, 1e-4), h = 0.0;\n if (d > 1e-4) { if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0; h /= 6.0; }\n float wP = smoothstep(0.3, 0.45, s) * (1.0 - smoothstep(0.045, 0.07, abs(h - 0.725)));\n float wY = smoothstep(0.4, 0.55, s) * smoothstep(0.45, 0.55, mx) * (1.0 - smoothstep(0.03, 0.05, abs(h - 0.125)));\n float wK = smoothstep(0.3, 0.45, s) * (1.0 - smoothstep(0.035, 0.06, abs(h - 0.915)));\n vec3 r = mix(c, uHelm * (mx / 0.573), wP); r = mix(r, uSuit * (mx / 0.792), wY); r = mix(r, uFin * (mx / 0.796), wK);\n return pow(clamp(r, 0.0, 1.0), vec3(2.2)); }')
        .replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture2D( map, vMapUv ); sampledDiffuseColor.rgb = aqSkin(sampledDiffuseColor.rgb); diffuseColor *= sampledDiffuseColor;\n#endif')
        .replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP\n vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv ); emissiveColor.rgb = aqSkin(emissiveColor.rgb); totalEmissiveRadiance *= emissiveColor.rgb;\n#endif\n{ float rim = pow(max(0.0, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)))), 2.6); totalEmissiveRadiance += vec3(0.25, 0.9, 1.0) * rim * 0.35; }'); };
    m.customProgramCacheKey = () => 'aqDiverGLB'; GLB.mat = m;
    return GLB; }
  function glbSkin(s) { if (!glbData()) return; const v = (hex, o) => o.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    GLB.uni.uSkinOn.value = s.id === 'violet' ? 0 : 1; v(s.helm, GLB.uni.uHelm.value); v(s.suit, GLB.uni.uSuit.value); v(s.fin, GLB.uni.uFin.value); }
  function makeDiver() {
    const G = glbData(); if (!G) return makeDiverProc(); const D = G.D;
    if (!MAT.dHelm) makeDiverProc(); // shop materials (scarf colour etc.) live on the procedural diver's materials
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body); // body = the lean pivot, like the old diver's
    const turn = new THREE.Group(); turn.rotation.y = Math.PI / 2; turn.scale.setScalar(GLB_K); turn.position.y = -0.5 - D.minY * GLB_K; body.add(turn); // model faces +z: turn it to +x
    const rig = new THREE.Group(); rig.scale.setScalar(D.rootScale); turn.add(rig);
    const bones = D.bones.map(b => { const o = new THREE.Bone(); o.name = b.n; o.position.fromArray(b.t); o.quaternion.fromArray(b.r); o.scale.fromArray(b.s); return o; });
    D.bones.forEach((b, i) => (b.p >= 0 ? bones[b.p] : rig).add(bones[i]));
    const mesh = new THREE.SkinnedMesh(G.geo, G.mat); mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false; mesh.userData.noOutline = true; turn.add(mesh);
    g.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones, bones.map((b, i) => new THREE.Matrix4().fromArray(G.ibm, i * 16))), new THREE.Matrix4()); // identity: the inverse binds are in model space and the bones already carry the turn/scale
    const mixer = new THREE.AnimationMixer(rig), act = {};
    for (const k of ['idle', 'walk', 'swim']) { act[k] = mixer.clipAction(G.clips[k]); act[k].play(); act[k].setEffectiveWeight(0); }
    for (const [k, [clip, at]] of Object.entries(GLB_POSE)) { const a = act[k] = mixer.clipAction(G.clips[clip].clone()); a.play(); a.time = at; a.paused = true; a.setEffectiveWeight(0); }
    act.stand.setEffectiveWeight(1); mixer.update(0); g.updateMatrixWorld(true);
    // things that ride on the head / neck: placed in the old diver's frame at the standing pose, then parented to the bone
    const B = n => bones.find(b => b.name === n), headB = B('Head'), neckB = B('Spine2') || B('Neck');
    const glue = (obj, bone, pos, sc) => { const want = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new V3(sc, sc, sc)), inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
      inv.multiply(g.matrixWorld).multiply(want).decompose(obj.position, obj.quaternion, obj.scale); bone.add(obj); };
    const top = 1.7 * GLB_K - 0.5 + (D.minY < 0 ? 0 : 0);
    const hat = ['sharky', 'mermaid', 'kraken'].includes(skinOf('suit', SKIN.suit).kit) ? null : makeHat(SKIN.hat); if (hat) { const hg = new THREE.Group(); hat.position.set(0, 0, 0); hg.add(hat); glue(hg, headB, new V3(-0.02, top - 0.06, 0), 0.92); }
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xfff0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45 })); lampGlow.scale.setScalar(0.16);
    { const lg = new THREE.Group(); lg.add(lampGlow); glue(lg, headB, new V3(0.2, top - 0.07, 0.02), 1); }
    // the shop scarf: a knot round the neck and two tails streaming behind (same animation hooks as before)
    const scarf = []; if (SKIN.scarf !== 'none') { const sg = new THREE.Group(); glue(sg, neckB, new V3(-0.02, -0.17, 0), 0.62);
      const knot = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 10, 28), MAT.dScarf); knot.rotation.x = Math.PI / 2; sg.add(knot);
      for (const [z, len] of [[0.07, 0.42], [-0.04, 0.34]]) { const gg = new THREE.PlaneGeometry(len, 0.1, 8, 1); gg.translate(-len / 2, 0, 0); const P = gg.attributes.position; for (let i = 0; i < P.count; i++) { const x = -P.getX(i) / len; P.setY(i, P.getY(i) * (1 - x * 0.45)); }
        const piv = new THREE.Group(); piv.position.set(-0.12, 0, z); sg.add(piv); piv.add(new THREE.Mesh(gg, MAT.dScarf)); scarf.push({ piv, geo: gg, base: Float32Array.from(P.array), len }); } }
    { const kit = makeKit(skinOf('suit', SKIN.suit).kit); for (const [obj, bn, pos, sc] of kit) { const bone = B(bn); if (!bone) continue; if (pos) glue(obj, bone, pos, sc); else { obj.scale.setScalar(sc / GLB_K / D.rootScale); bone.add(obj); } } }
    const dummy = () => new THREE.Object3D();
    g.userData = { glb: { mixer, act, mesh, w: { stand: 1 } }, body, head: dummy(), armF: dummy(), armB: dummy(), legF: dummy(), legB: dummy(), finF: dummy(), finB: dummy(), lampGlow, scarf: scarf.length ? scarf : null, hat };
    return withShadow(g); }
  // ---- premium outfit pieces: real geometry glued to bones so they ride every animation. Positions are in the diver's own frame
  // (faces +x, feet at y -0.5, helmet top ~0.42, back = -x). Each entry: [object, bone name, position, scale]. Animated parts use onBeforeRender.
  function makeKit(id) { if (!id) return []; const out = [], P = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.35, clearcoat: 0.7, envMapIntensity: 0.9 }, o));
    const glow = (col, sc) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 })); sp.scale.setScalar(sc); return sp; };
    const fin = (pts, depth, mat) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i += 2) sh.quadraticCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: depth * 0.6, bevelSegments: 3, curveSegments: 14 }); g.translate(0, 0, -depth / 2); return new THREE.Mesh(g, mat); };
    const t = () => performance.now() / 1000;
    if (id === 'sharky') { const grey = P({ color: 0x6d84a3, roughness: 0.4 }), white = P({ color: 0xffffff, roughness: 0.3 }), gum = P({ color: 0xff8fa8, roughness: 0.5 });
      // a shark costume: the diver's face peeks out of the open jaws (upper + lower jaw with teeth), fin on top, eyes on the sides, tail
      const jaw = new THREE.Group();
      for (const [up, r] of [[1, 0.235], [-1, 0.2]]) { const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 12, 30, Math.PI * 0.9), grey); arc.rotation.set(0, Math.PI / 2, up > 0 ? Math.PI * 0.05 : Math.PI * 1.05); jaw.add(arc);
        for (let k = 0; k < 7; k++) { const a = (up > 0 ? 0.25 : Math.PI + 0.25) + k / 6 * (Math.PI * 0.9 - 0.5), tooth = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.055, 6), white);
          tooth.position.set(0.02, Math.sin(a) * (r - 0.035), Math.cos(a) * (r - 0.035)); tooth.lookAt(0.02, 0, 0); tooth.rotateX(Math.PI / 2); jaw.add(tooth); } }
      for (const z of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), P({ color: 0x0c0c12, roughness: 0.05 })); eye.position.set(-0.04, 0.2, z * 0.22); jaw.add(eye); const hl = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), white); hl.position.set(-0.02, 0.215, z * 0.235); jaw.add(hl); }
      out.push([jaw, 'Head', new V3(0.16, 0.12, 0), 1]);
      const dorsal = fin([[-0.14, 0], [-0.04, 0.05], [0.0, 0.24], [0.06, 0.07], [0.11, 0]], 0.03, grey); out.push([dorsal, 'Head', new V3(-0.06, 0.34, 0), 1]);
      const tg = new THREE.Group(), tail = fin([[0, 0], [-0.1, 0.04], [-0.17, 0.17], [-0.1, 0.02], [-0.05, 0], [-0.1, -0.02], [-0.15, -0.12], [-0.08, -0.03], [0, 0]], 0.03, grey); tg.add(tail);
      tail.onBeforeRender = () => { tail.rotation.y = Math.sin(t() * 5) * 0.4; }; out.push([tg, 'Hips', new V3(-0.12, -0.25, 0), 1.1]);
      for (const z of [-1, 1]) { const pf = fin([[0, 0], [-0.03, -0.03], [-0.12, -0.09], [-0.04, 0.01], [0, 0.02]], 0.018, grey); pf.rotation.x = z * 1.1; out.push([pf, 'Spine2', new V3(0.0, -0.15, z * 0.14), 1]); } }
    if (id === 'mermaid') { const scaleTex = (() => { const [c, g] = canvas(128); g.fillStyle = '#127a9c'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { const cx = x * 16 + (y % 2) * 8, cy = y * 16; const gr = g.createRadialGradient(cx, cy - 4, 2, cx, cy, 12); gr.addColorStop(0, '#b8fff6'); gr.addColorStop(0.55, '#2ad6c6'); gr.addColorStop(1, '#16879f'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI); g.fill(); } const tx = tex(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(2, 2); return tx; })();
      const tailMat = P({ map: scaleTex, color: 0xffffff, roughness: 0.25, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.4, sheen: 0.6, sheenColor: 0xff9ad8 }), finMat = P({ color: 0xff7ac8, roughness: 0.3, transparent: true, opacity: 0.94, side: THREE.DoubleSide, sheen: 1, sheenColor: 0xffd0f0 });
      // a mermaid tail sweeping down behind the legs to a big two-lobed fin
      const tgo = new THREE.Group(), tg = new THREE.Group(); tgo.add(tg); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.04, 0.36, 18, 4), tailMat); body.rotation.z = -1.05; body.position.set(-0.15, -0.09, 0); tg.add(body);
      const fl = fin([[0, 0], [0.02, 0.1], [-0.08, 0.2], [-0.06, 0.05], [-0.03, 0], [-0.06, -0.05], [-0.08, -0.2], [0.02, -0.1], [0, 0]], 0.018, finMat); const fp = new THREE.Group(); fp.position.set(-0.31, -0.18, 0); fp.rotation.z = -1.05 + Math.PI / 2; fp.add(fl); tg.add(fp);
      body.onBeforeRender = () => { tg.rotation.z = Math.sin(t() * 2.6) * 0.1; fp.rotation.y = Math.sin(t() * 2.6 + 1) * 0.35; }; out.push([tgo, 'Hips', new V3(-0.05, -0.22, 0), 1.05]); /* the glued parent keeps its bone-space rotation; the swish lives on the child */
      const crown = new THREE.Group(); for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.34, sh = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.11, 6), P({ color: [0xffd6e8, 0xfff1d6][i % 2], roughness: 0.3, clearcoat: 1 })); sh.position.set(0, 0.05, Math.sin(a) * 0.13); sh.rotation.x = -a * 0.7; crown.add(sh); }
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 8, 28, Math.PI), P({ color: 0xffd6e8 })); band.rotation.set(Math.PI / 2, 0, Math.PI / 2); band.position.y = 0.0; crown.add(band);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), P({ color: 0xffffff, roughness: 0.05, clearcoat: 1, iridescence: 1 })); pearl.position.set(0.02, 0.07, 0); crown.add(pearl); { const gl = glow(0xffd6f0, 0.18); gl.position.copy(pearl.position); crown.add(gl); }
      out.push([crown, 'Head', new V3(0.0, 0.33, 0), 1.1]); }
    if (id === 'robo') { const chrome = P({ color: 0xdfe8f5, metalness: 0.9, roughness: 0.18 }), dark = P({ color: 0x2a3144, metalness: 0.7, roughness: 0.3 }), neon = new THREE.MeshBasicMaterial({ color: 0x24f0ff });
      const pack = new THREE.Group(); for (const z of [-0.07, 0.07]) { const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.16, 6, 16), chrome); c.position.set(0, 0, z); pack.add(c);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.01, 6, 20), neon); ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.04, z); pack.add(ring);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 12), new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); flame.rotation.x = Math.PI; flame.position.set(0, -0.19, z); pack.add(flame);
        flame.onBeforeRender = () => { const k = 0.8 + Math.sin(t() * 40 + z * 50) * 0.2; flame.scale.set(k, 0.7 + Math.random() * 0.5, k); }; { const gl = glow(0xffa040, 0.3); gl.position.set(0, -0.05, 0); flame.add(gl); } }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.2), dark); plate.position.x = 0.05; pack.add(plate); out.push([pack, 'Spine2', new V3(-0.22, -0.12, 0), 1]);
      const ant = new THREE.Group(); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.18, 8), dark); rod.position.y = 0.09; ant.add(rod); const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), neon); tip.position.y = 0.19; ant.add(tip); tip.add(glow(0x24f0ff, 0.25));
      tip.onBeforeRender = () => { tip.scale.setScalar(0.85 + Math.sin(t() * 6) * 0.15); }; out.push([ant, 'Head', new V3(-0.06, 0.33, 0.1), 1]);
      for (const z of [-1, 1]) { const pad = new THREE.Group(); const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), chrome); pad.add(dome); const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), neon); led.position.y = 0.05; pad.add(led); led.add(glow(0x24f0ff, 0.14)); out.push([pad, 'Spine2', new V3(0.0, -0.1, z * 0.17), 1]); } }
    if (id === 'kraken') { const skin = P({ color: 0xb05cff, roughness: 0.45, sheen: 0.8, sheenColor: 0xffb0f0 }), spot = P({ color: 0xff7ad9, roughness: 0.4 });
      // an octopus hat sitting on the back of the helmet (the face stays clear) + six swaying tentacles from the hips
      const hood = new THREE.Group(); const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skin); dome.scale.set(1.05, 1.15, 1.05); hood.add(dome);
      for (let i = 0; i < 8; i++) { const a = i * 2.4, sp = new THREE.Mesh(new THREE.SphereGeometry(0.026 + (i % 3) * 0.008, 10, 8), spot); const n = new V3(Math.cos(a) * 0.8, 0.35 + (i % 3) * 0.2, Math.sin(a) * 0.8).normalize(); sp.position.copy(n).multiply(new V3(0.21, 0.23, 0.21)); sp.lookAt(n.clone().multiplyScalar(2)); sp.scale.set(1, 1, 0.4); hood.add(sp); }
      for (const z of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), P({ color: 0xffffff })); eye.position.set(0.12, 0.06, z * 0.12); hood.add(eye); const pu = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), P({ color: 0x14102a })); pu.position.set(0.15, 0.06, z * 0.125); hood.add(pu); }
      out.push([hood, 'Head', new V3(-0.07, 0.34, 0), 0.85]);
      const ring = new THREE.Group(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, pts = []; for (let k = 0; k <= 8; k++) { const f = k / 8; pts.push(new V3(-0.04 - f * 0.1 + Math.cos(a) * 0.05, -f * 0.28, Math.sin(a) * (0.07 + f * 0.09) + Math.sin(f * 5 + i) * 0.025)); }
        const tub = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.024, 8), skin); const piv = new THREE.Group(); piv.add(tub); ring.add(piv);
        const tipc = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), skin); tipc.position.copy(pts[8]); piv.add(tipc);
        tub.onBeforeRender = () => { piv.rotation.x = Math.sin(t() * 2.2 + i) * 0.22; piv.rotation.z = Math.cos(t() * 1.7 + i * 1.3) * 0.16; }; }
      out.push([ring, 'Hips', new V3(-0.04, -0.24, 0), 1]); }
    if (id === 'angler') { const dark = P({ color: 0x16224e, roughness: 0.3 }), bulbM = new THREE.MeshBasicMaterial({ color: 0xbffbff });
      // an anglerfish lure arching from the top of the helmet to dangle a glowing bulb in front of the face, glowing dots, fangs
      const lure = new THREE.Group(); const pts = [new V3(0, 0, 0), new V3(0.05, 0.14, 0), new V3(0.18, 0.2, 0), new V3(0.29, 0.13, 0)]; const stalk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.011, 8), dark); lure.add(stalk);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), bulbM); bulb.position.copy(pts[3]); bulb.position.y -= 0.03; lure.add(bulb); const bg = glow(0x7ff6ff, 0.5); bulb.add(bg);
      bulb.onBeforeRender = () => { const k = 0.75 + Math.sin(t() * 3.2) * 0.25; bg.material.opacity = 0.55 + k * 0.4; bulb.position.y = pts[3].y - 0.03 + Math.sin(t() * 2) * 0.02; }; out.push([lure, 'Head', new V3(-0.02, 0.35, 0), 1]);
      for (const [bone, pos] of [['Spine2', new V3(0.06, -0.14, 0.11)], ['Spine2', new V3(0.06, -0.18, -0.11)], ['Head', new V3(-0.14, 0.22, 0.17)], ['Head', new V3(-0.16, 0.12, -0.18)], ['Hips', new V3(0.02, -0.28, 0.1)], ['Hips', new V3(0.02, -0.3, -0.1)]]) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7ff6ff })); d.add(glow(0x2bf0ff, 0.15)); out.push([d, bone, pos, 1]); }
      const teeth = new THREE.Group(); for (let i = 0; i < 7; i++) { const z = (i - 3) * 0.04, tt = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 6), P({ color: 0xffffff })); tt.position.set(0, 0.0, z); tt.rotation.z = Math.PI; teeth.add(tt); } out.push([teeth, 'Head', new V3(0.21, 0.0, 0), 1]); }
    out.forEach(([o]) => o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.userData.noOutline = true; } })); return out; }
  // per-frame: blend the clips from what the diver is doing (weights always add up to 1, so it never falls back to the T/A-pose)
  function glbDrive(u, dt, st) { const G = u.glb, A = G.act, W = G.w;
    const busy = Math.min(1, Math.max(st.reach, st.push, st.dig)), r = 1 - busy * 0.95, mv = st.swim * r, still = (1 - st.swim) * r;
    const goal = { push: 1 - r, walk: mv * st.floor * 0.9, swim: mv * (1 - st.floor), stand: (still + mv * 0.1) * st.floor, idle: still * (1 - st.floor) }; // full-strength strides so arms and legs really move
    let sum = 0; for (const k in goal) { W[k] = (W[k] ?? 0) + (goal[k] - (W[k] ?? 0)) * Math.min(1, dt * 10); sum += W[k]; }
    for (const k in goal) A[k].setEffectiveWeight(W[k] / (sum || 1));
    const sp = st.speed || 0; A.walk.timeScale = Math.max(1, Math.min(2.6, 0.9 + sp * 0.42)); A.swim.timeScale = Math.max(1, Math.min(2.4, 0.9 + sp * 0.36)); A.idle.timeScale = 0.9; // strides keep pace with the body
    if (A.push) { if (st.pushing) { A.push.paused = false; A.push.timeScale = Math.min(1.6, 0.6 + sp * 0.25); } else if (!A.push.paused) { A.push.paused = true; } } // the shove animates while the pearl moves, holds still otherwise
    G.mixer.update(dt); }
  // ---------------------------------------------------------------- skins (shop)
  const SKIN = { suit: 'violet', scarf: 'pink', hat: 'none', trail: 'bubbles', pearl: 'ruby' };
  const SKINS = {
    suit: [ // pat = painted pattern on helmet + suit; glow = emissive pattern
      { id: 'violet', name: 'Violet Star', price: 0, helm: 0x5a12f0, suit: 0xffb800, fin: 0x00a8ff, pat: 'sprinkle', acc: 0xffe27a },
      { id: 'coral', name: 'Coral Polka', price: 250, helm: 0xff3d5e, suit: 0xfff1d6, fin: 0xff9a3c, pat: 'dots', acc: 0xffffff },
      { id: 'mint', name: 'Mint Racer', price: 250, helm: 0x12b896, suit: 0xf0fff8, fin: 0x7a5cff, pat: 'stripes', acc: 0xffffff },
      { id: 'sunny', name: 'Sunshine', price: 300, helm: 0xffbf00, suit: 0x2b6cff, fin: 0xff4f6d, pat: 'rays', acc: 0xfff3a0 },
      { id: 'bubblegum', name: 'Bubblegum', price: 350, helm: 0xff6fd0, suit: 0xb8f2ff, fin: 0xff3fa0, pat: 'hearts', acc: 0xffd6f2 },
      { id: 'kelp', name: 'Kelp Camo', price: 400, helm: 0x3f7a2a, suit: 0x8aa84a, fin: 0x2d5a1e, pat: 'camo', acc: 0x24461a },
      { id: 'midnight', name: 'Starry Night', price: 450, helm: 0x141c44, suit: 0x2a3670, fin: 0x00e5ff, pat: 'stars', acc: 0xfff6c8, glow: true },
      { id: 'shark', name: 'Shark Attack', price: 550, helm: 0x5f7590, suit: 0xe9eef4, fin: 0x34445a, pat: 'gills', acc: 0x34445a },
      { id: 'clown', name: 'Clownfish', price: 650, helm: 0xff7a12, suit: 0xff8a1f, fin: 0x1a1a1a, pat: 'bands', acc: 0xffffff },
      { id: 'lava', name: 'Magma Core', price: 800, helm: 0x241a1a, suit: 0x3a2622, fin: 0xff6a12, pat: 'cracks', acc: 0xff7a12, glow: true },
      { id: 'gold', name: 'Golden Diver', price: 1200, helm: 0xffc533, suit: 0xfff0b3, fin: 0xffd23f, pat: 'scales', acc: 0xc98a1a, metal: true },
      { id: 'galaxy', name: 'Galaxy', price: 1600, helm: 0x1a0b3a, suit: 0x2a1458, fin: 0xff4fd8, pat: 'galaxy', acc: 0xffffff, glow: true },
      { id: 'rainbow', name: 'Rainbow', price: 2000, helm: 0xff3d5e, suit: 0xffd23f, fin: 0x00c8ff, rainbow: true, pat: 'sprinkle', acc: 0xffffff },
      { id: 'vip', name: 'VIP Black Gold', price: 0, vip: true, helm: 0x15131f, suit: 0xffc933, fin: 0x15131f, pat: 'scales', acc: 0xffe27a, metal: true }, // unlocked by sharing a public post, never sold or gifted
      // premium outfits: unlocked only by sharing (one public post = one outfit). Each adds real 3D pieces on the skeleton (makeKit)
      { id: 'sharky', name: 'Shark Suit', price: 0, vip: true, kit: 'sharky', helm: 0x6d84a3, suit: 0xf2f6fa, fin: 0x3c4f6b, pat: 'gills', acc: 0x34445a },
      { id: 'mermaid', name: 'Merdiver', price: 0, vip: true, kit: 'mermaid', helm: 0x7b3cff, suit: 0x23d3c4, fin: 0xff5fb0, pat: 'scales', acc: 0xffffff },
      { id: 'robo', name: 'Robo Diver', price: 0, vip: true, kit: 'robo', helm: 0xc9d3de, suit: 0x7d8a99, fin: 0x24f0ff, pat: 'sprinkle', acc: 0x24f0ff, metal: true },
      { id: 'kraken', name: 'Kraken', price: 0, vip: true, kit: 'kraken', helm: 0x7a2fd0, suit: 0xb05cff, fin: 0xff7ad9, pat: 'dots', acc: 0xffd6f2 },
      { id: 'angler', name: 'Abyss Angler', price: 0, vip: true, kit: 'angler', helm: 0x16224e, suit: 0x0d1838, fin: 0x2bf0ff, pat: 'stars', acc: 0x7ff6ff, glow: true },
    ],
    scarf: [
      { id: 'pink', name: 'Bubble Pink', price: 0, col: 0xff1f6e }, { id: 'sky', name: 'Sky Blue', price: 120, col: 0x2fb6ff },
      { id: 'lime', name: 'Lime', price: 120, col: 0x7ae82a }, { id: 'flame', name: 'Flame', price: 150, col: 0xff6a12 },
      { id: 'royal', name: 'Royal', price: 180, col: 0x7a2fff }, { id: 'snow', name: 'Snow', price: 180, col: 0xf4f8ff },
      { id: 'gold', name: 'Gold Silk', price: 400, col: 0xffc21a, metal: true }, { id: 'none', name: 'No scarf', price: 0, col: 0x445566 },
    ],
    hat: [
      { id: 'none', name: 'No hat', price: 0, emoji: '·' }, { id: 'antenna', name: 'Antennae', price: 250, emoji: '📡' },
      { id: 'party', name: 'Party Hat', price: 300, emoji: '🎉' }, { id: 'shark', name: 'Shark Fin', price: 400, emoji: '🦈' },
      { id: 'bunny', name: 'Bunny Ears', price: 500, emoji: '🐰' }, { id: 'propeller', name: 'Propeller', price: 650, emoji: '🌀' },
      { id: 'flower', name: 'Flower Crown', price: 450, emoji: '🌸' }, { id: 'pirate', name: 'Pirate Hat', price: 700, emoji: '🏴‍☠️' },
      { id: 'viking', name: 'Viking Helm', price: 800, emoji: '🪓' }, { id: 'crown', name: 'Royal Crown', price: 1000, emoji: '👑' }, { id: 'halo', name: 'Angel Halo', price: 1500, emoji: '😇' },
    ],
    trail: [
      { id: 'bubbles', name: 'Bubbles', price: 0, col: 0xcff3ff }, { id: 'sparkle', name: 'Gold Sparkle', price: 200, col: 0xffd84a },
      { id: 'love', name: 'Love', price: 250, col: 0xff5fa8 }, { id: 'mint', name: 'Mint Glow', price: 250, col: 0x4fffc0 },
      { id: 'ember', name: 'Embers', price: 300, col: 0xff7a1a }, { id: 'rainbow', name: 'Rainbow', price: 800, col: 0xffffff, rainbow: true },
    ],
    pearl: [
      { id: 'ruby', name: 'Ruby', price: 0, col: 0xb00410, em: 0x9a0010, glow: 0xff4a18 }, { id: 'sapphire', name: 'Sapphire', price: 200, col: 0x0a3fd0, em: 0x0a2a9a, glow: 0x3a8aff },
      { id: 'emerald', name: 'Emerald', price: 200, col: 0x05a050, em: 0x046a30, glow: 0x3aff8a }, { id: 'amethyst', name: 'Amethyst', price: 250, col: 0x7a12d0, em: 0x4a0a8a, glow: 0xc06aff },
      { id: 'gold', name: 'Gold', price: 600, col: 0xffb800, em: 0x8a5a00, glow: 0xffd84a, metal: true },
    ],
  };
  const skinOf = (cat, id) => SKINS[cat].find(x => x.id === id) || SKINS[cat][0];
  const rarityOf = (it) => it.vip ? 'premium' : it.price >= 1200 ? 'legendary' : it.price >= 600 ? 'epic' : it.price >= 300 ? 'rare' : 'common';
  // painted suit patterns: one colour texture (and an optional glow texture) per suit + part, cached
  const PAT = {};
  function suitTex(s, part) { const key = s.id + part; if (PAT[key]) return PAT[key];
    const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), gc = document.createElement('canvas'); gc.width = W; gc.height = H; const gg = gc.getContext('2d');
    const hx = n => '#' + n.toString(16).padStart(6, '0'), base = hx(part === 'helm' ? s.helm : s.suit), acc = hx(s.acc || 0xffffff); let rs = 7; const R = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
    g.fillStyle = base; g.fillRect(0, 0, W, H); gg.fillStyle = '#000'; gg.fillRect(0, 0, W, H);
    const shade = g.createLinearGradient(0, 0, 0, H); shade.addColorStop(0, 'rgba(255,255,255,0.18)'); shade.addColorStop(0.5, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.18)');
    const dot = (ctx, x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
    const star = (ctx, x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.fill(); };
    const p = s.pat;
    if (p === 'sprinkle') for (let i = 0; i < 46; i++) star(g, R() * W, R() * H, 4 + R() * 6, acc + 'cc');
    if (p === 'dots') for (let y = 0; y < H + 40; y += 46) for (let x = (y / 46) % 2 * 32; x < W + 40; x += 64) dot(g, x, y, part === 'helm' ? 13 : 10, acc);
    if (p === 'stripes') { g.fillStyle = acc; for (let x = 0; x < W; x += 128) { g.fillRect(x + 40, 0, 26, H); g.fillRect(x + 74, 0, 8, H); } }
    if (p === 'rays') { g.save(); g.translate(W * 0.25, H * 0.5); for (let i = 0; i < 16; i++) { g.rotate(Math.PI / 8); g.fillStyle = i % 2 ? acc + '66' : 'transparent'; g.beginPath(); g.moveTo(0, 0); g.lineTo(600, -60); g.lineTo(600, 60); g.fill(); } g.restore(); }
    if (p === 'hearts') for (let y = 20; y < H; y += 56) for (let x = (y / 56 % 2) * 40 + 20; x < W; x += 80) { g.fillStyle = acc; g.beginPath(); g.moveTo(x, y + 8); g.bezierCurveTo(x - 18, y - 8, x - 8, y - 22, x, y - 8); g.bezierCurveTo(x + 8, y - 22, x + 18, y - 8, x, y + 8); g.fill(); }
    if (p === 'camo') for (let i = 0; i < 70; i++) { g.fillStyle = [acc, '#5f8a33', '#a8c46a', '#2e5222'][i % 4]; g.beginPath(); const x = R() * W, y = R() * H; for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28, r = 14 + R() * 22; g.lineTo(x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r); } g.fill(); }
    if (p === 'stars') { for (let i = 0; i < 140; i++) { const x = R() * W, y = R() * H, r = R() < 0.1 ? 4 : 1.2 + R() * 1.6; dot(g, x, y, r, acc); dot(gg, x, y, r, '#fff6c8'); } for (let i = 0; i < 9; i++) { const x = R() * W, y = R() * H; star(g, x, y, 9, acc); star(gg, x, y, 9, '#fff6c8'); } }
    if (p === 'gills') { if (part === 'suit') { const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, hx(s.helm)); bg.addColorStop(0.55, hx(s.helm)); bg.addColorStop(0.62, base); g.fillStyle = bg; g.fillRect(0, 0, W, H); }
      g.strokeStyle = acc; g.lineWidth = 6; g.lineCap = 'round'; for (let i = 0; i < 4; i++) { const x = 300 + i * 22; g.beginPath(); g.moveTo(x, H * 0.38); g.quadraticCurveTo(x - 12, H * 0.5, x, H * 0.62); g.stroke(); }
      if (part === 'helm') { g.fillStyle = '#fff'; for (let i = 0; i < 9; i++) { const x = 330 + i * 16; g.beginPath(); g.moveTo(x, H * 0.66); g.lineTo(x + 8, H * 0.78); g.lineTo(x + 16, H * 0.66); g.fill(); } } }
    if (p === 'bands') { for (const x of [100, 260, 420]) { g.fillStyle = '#111'; g.fillRect(x - 34, 0, 68, H); g.fillStyle = acc; g.fillRect(x - 26, 0, 52, H); } }
    if (p === 'cracks') { g.fillStyle = '#4a3028'; for (let i = 0; i < 40; i++) dot(g, R() * W, R() * H, 6 + R() * 18, '#2f201c');
      for (let i = 0; i < 26; i++) { let x = R() * W, y = R() * H; const path = [[x, y]]; for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 70; y += (R() - 0.5) * 50; path.push([x, y]); }
        for (const [ctx, w, col] of [[g, 12, '#ff6a12'], [g, 5, '#ffd23f'], [gg, 16, '#ff7a1a'], [gg, 6, '#ffe27a']]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath(); path.forEach(([px, py], j) => j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke(); } } }
    if (p === 'scales') { for (let y = -20; y < H + 30; y += 26) for (let x = (Math.round(y / 26) % 2) * 22 - 22; x < W + 44; x += 44) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(x, y, 22, 0, Math.PI); g.fill(); g.strokeStyle = acc; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 22, 0, Math.PI); g.stroke(); } }
    if (p === 'galaxy') { for (let i = 0; i < 7; i++) { const x = R() * W, y = R() * H, r = 60 + R() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r); const col = ['rgba(255,79,216,0.55)', 'rgba(90,120,255,0.55)', 'rgba(0,229,255,0.4)'][i % 3]; gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
        const gr2 = gg.createRadialGradient(x, y, 0, x, y, r); gr2.addColorStop(0, col.replace(/[\d.]+\)$/, '0.35)')); gr2.addColorStop(1, 'rgba(0,0,0,0)'); gg.fillStyle = gr2; gg.fillRect(0, 0, W, H); }
      for (let i = 0; i < 160; i++) { const x = R() * W, y = R() * H, r = R() < 0.08 ? 3.2 : 1 + R() * 1.4; dot(g, x, y, r, '#ffffff'); dot(gg, x, y, r, '#ffffff'); } for (let i = 0; i < 6; i++) { const x = R() * W, y = R() * H; star(g, x, y, 8, '#fff'); star(gg, x, y, 8, '#fff'); } }
    g.fillStyle = shade; g.fillRect(0, 0, W, H);
    const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
    return (PAT[key] = { map: mk(c), glow: s.glow ? mk(gc) : null }); }
  function applySkin(sk) {
    Object.assign(SKIN, sk); if (!MAT.dHelm) makeDiverProc();
    const s = skinOf('suit', SKIN.suit), dim = (c, k) => new THREE.Color(c).multiplyScalar(k);
    for (const [m, part, col, ek] of [[MAT.dHelm, 'helm', s.helm, 0.25], [MAT.dSuit, 'suit', s.suit, 0.12]]) { const T2 = suitTex(s, part), had = !!m.emissiveMap;
      m.map = T2.map; m.color.set(0xffffff); if (T2.glow) { m.emissiveMap = T2.glow; m.emissive.set(0xffffff); m.emissiveIntensity = s.pat === 'cracks' ? 1.6 : 0.9; } else { m.emissiveMap = null; m.emissive.copy(dim(col, ek)); m.emissiveIntensity = 1; }
      if (had !== !!m.emissiveMap || !m.userData.mapped) { m.needsUpdate = true; m.userData.mapped = true; } }
    MAT.dFin.color.set(s.fin); MAT.dFin.emissive.copy(dim(s.fin, 0.35)); glbSkin(s);
    for (const m of [MAT.dHelm, MAT.dSuit]) { m.metalness = s.metal ? 0.75 : 0; m.roughness = s.metal ? 0.2 : m === MAT.dHelm ? 0.14 : 0.24; }
    const sc = skinOf('scarf', SKIN.scarf); MAT.dScarf.color.set(sc.col); MAT.dScarf.emissive.copy(dim(sc.col, 0.3)); MAT.dScarf.metalness = sc.metal ? 0.7 : 0;
    const pl = skinOf('pearl', SKIN.pearl); if (!MAT.pearl) makeBall(true);
    for (const m of [MAT.pearl, MAT.ball]) { m.color.set(pl.col); m.emissive.set(pl.em); m.metalness = pl.metal ? 0.6 : 0; }
    MAT.ballGlow.color.set(pl.glow); MAT.ballCore.color.set(new THREE.Color(pl.glow).lerp(new THREE.Color(0xffffff), 0.45));
  }
  function skinTick(t) { // animated skins
    if (skinOf('suit', SKIN.suit).rainbow && MAT.dHelm) { const h = (t * 0.08) % 1; MAT.dHelm.color.setHSL(h, 0.85, 0.62); MAT.dSuit.color.setHSL((h + 0.33) % 1, 0.9, 0.7); MAT.dFin.color.setHSL((h + 0.66) % 1, 0.9, 0.55); }
  }
  function trailColor(t) { const tr = skinOf('trail', SKIN.trail); return tr.rainbow ? new THREE.Color().setHSL((t * 0.5) % 1, 0.9, 0.6) : new THREE.Color(tr.col); }
  function makeHat(id) {
    if (!id || id === 'none') return null; const g = new THREE.Group(); g.position.set(-0.03, 0.22, 0);
    const P = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.35, clearcoat: 0.6, envMapIntensity: 1 }, o));
    const GOLD = P({ color: 0xffc533, metalness: 0.9, roughness: 0.18, clearcoat: 1 }), gem = (c) => new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.05, clearcoat: 1, transmission: 0, metalness: 0.1 });
    const stripeTex = (cols, n = 8, diag = true) => { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d'); for (let i = -n; i < n * 2; i++) { x.fillStyle = cols[((i % cols.length) + cols.length) % cols.length]; x.save(); x.translate(i * 256 / n, 0); if (diag) x.transform(1, 0, -0.6, 1, 0, 0); x.fillRect(0, 0, 256 / n, 256); x.restore(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
    if (id === 'antenna') { for (const z of [-0.08, 0.08]) { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, z), new THREE.Vector3(0.02, 0.1, z * 1.6), new THREE.Vector3(-0.03, 0.2, z * 2.4)]);
        const st = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.011, 8), P({ color: 0x2a3144, metalness: 0.7, roughness: 0.25 })); g.add(st);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xff3d8b, emissive: 0xff3d8b, emissiveIntensity: 1.4, clearcoat: 1 })); b.position.set(-0.03, 0.22, z * 2.4); g.add(b);
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff6fb0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 })); gl.scale.setScalar(0.16); b.add(gl); }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 20), P({ color: 0x2a3144, metalness: 0.7 })); g.add(base); }
    if (id === 'party') { const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 32, 1, true), P({ map: stripeTex(['#2fb6ff', '#ffffff', '#ff3d8b', '#ffffff'], 8), side: THREE.DoubleSide })); c.position.y = 0.13; c.rotation.z = 0.18; g.add(c);
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 28), P({ color: 0xffd23f })); brim.rotation.x = Math.PI / 2; brim.position.y = -0.13; c.add(brim);
      const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 2), P({ color: 0xffd23f, roughness: 0.9, clearcoat: 0 })); pom.position.y = 0.15; c.add(pom);
      for (let i = 0; i < 8; i++) { const cf = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.004), P({ color: [0xff3d8b, 0x2fb6ff, 0x7ae82a, 0xffd23f][i % 4] })); const a = i / 8 * 6.28; cf.position.set(Math.cos(a) * 0.09, -0.02 + (i % 3) * 0.05, Math.sin(a) * 0.09); cf.rotation.set(a, a * 2, 0); c.add(cf); } }
    if (id === 'shark') { const sh = new THREE.Shape(); sh.moveTo(-0.14, 0); sh.quadraticCurveTo(0.0, 0.05, 0.05, 0.27); sh.quadraticCurveTo(0.09, 0.1, 0.13, 0); sh.closePath();
      const f = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 4, curveSegments: 16 }), P({ color: 0x5f7590, roughness: 0.4 })); f.position.set(0.0, -0.01, -0.015); g.add(f);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), P({ color: 0xe9eef4 })); tip.position.set(0.05, 0.26, 0); g.add(tip);
      for (let i = 0; i < 3; i++) { const sc = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 4, 12, 2.4), P({ color: 0xffffff })); sc.position.set(-0.04 + i * 0.03, 0.06 + i * 0.03, 0.035); sc.rotation.z = 1.2; g.add(sc); } }
    if (id === 'bunny') { for (const z of [-0.07, 0.07]) { const ear = new THREE.Group(); ear.position.set(-0.02, 0.02, z); ear.rotation.x = z * 2.6; ear.rotation.z = z > 0 ? 0.25 : -0.05; g.add(ear);
        const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.2, 8, 16), P({ color: 0xffffff, roughness: 0.8, clearcoat: 0, sheen: 1, sheenColor: 0xffe0ef })); e.position.y = 0.13; e.scale.z = 0.55; ear.add(e);
        const inn = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.15, 6, 12), P({ color: 0xff9ac4, roughness: 0.6 })); inn.position.set(0.018, 0.13, 0); inn.scale.z = 0.4; ear.add(inn); }
      const bow = new THREE.Mesh(new THREE.TorusKnotGeometry(0.03, 0.012, 40, 8, 2, 3), P({ color: 0xff3d8b })); bow.position.set(0.02, 0.02, 0); g.add(bow); }
    if (id === 'propeller') { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), P({ map: stripeTex(['#ff3d5e', '#ffd23f', '#2fb6ff', '#7ae82a'], 4, false) })); g.add(cap);
      const vis = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.02, 24, 1, false, -0.9, 1.8), P({ color: 0x2a3144 })); vis.position.y = 0.0; g.add(vis);
      const rot = new THREE.Group(); rot.position.y = 0.15; g.add(rot); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.06, 8), GOLD); st.position.y = -0.03; rot.add(st); const hub = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), GOLD); rot.add(hub);
      for (const sgn of [-1, 1]) { const bl = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.16, 4, 8), P({ color: sgn > 0 ? 0xffd23f : 0x2fb6ff })); bl.rotation.z = Math.PI / 2; bl.scale.set(1, 1, 0.35); bl.position.x = sgn * 0.1; bl.rotation.x = sgn * 0.3; rot.add(bl); }
      cap.onBeforeRender = () => { rot.rotation.y = performance.now() / 1000 * 14; }; }
    if (id === 'flower') { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.014, 8, 40), P({ color: 0x3fae58 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.0; g.add(ring);
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, fl = new THREE.Group(); fl.position.set(Math.cos(a) * 0.17, 0.015, Math.sin(a) * 0.17); fl.lookAt(Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5); g.add(fl);
        const col = [0xff6fb0, 0xffd23f, 0xffffff, 0xb47aff][i % 4]; for (let k = 0; k < 5; k++) { const pt = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 6), P({ color: col, roughness: 0.6 })); const b = k / 5 * 6.28; pt.scale.set(1, 1, 0.4); pt.position.set(Math.cos(b) * 0.022, Math.sin(b) * 0.022, 0); fl.add(pt); }
        const ctr = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), P({ color: 0xffb800 })); ctr.position.z = 0.006; fl.add(ctr); } }
    if (id === 'pirate') { const blk = P({ color: 0x1c1c26, roughness: 0.6, clearcoat: 0.2 });
      const sh = new THREE.Shape(); sh.moveTo(-0.24, 0); sh.quadraticCurveTo(-0.22, 0.12, -0.1, 0.1); sh.quadraticCurveTo(0, 0.2, 0.1, 0.1); sh.quadraticCurveTo(0.22, 0.12, 0.24, 0); sh.quadraticCurveTo(0, 0.05, -0.24, 0);
      const hat = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3, curveSegments: 16 }), blk); hat.position.set(0, -0.01, -0.08); hat.rotation.y = Math.PI / 2; g.add(hat);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 40, Math.PI), GOLD); trim.position.set(0.1, 0.03, 0); trim.rotation.y = Math.PI / 2; g.add(trim);
      const sk = document.createElement('canvas'); sk.width = sk.height = 64; const x = sk.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 26, 15, 0, 7); x.fill(); x.fillRect(24, 34, 16, 10); x.fillStyle = '#1c1c26'; x.beginPath(); x.arc(26, 25, 4, 0, 7); x.arc(38, 25, 4, 0, 7); x.fill();
      x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.moveTo(10, 46); x.lineTo(54, 60); x.moveTo(54, 46); x.lineTo(10, 60); x.stroke(); const st = new THREE.CanvasTexture(sk); st.colorSpace = THREE.SRGBColorSpace;
      const skull = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: st, transparent: true })); skull.position.set(0.13, 0.08, 0); skull.rotation.y = Math.PI / 2; g.add(skull);
      const fth = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.2, 4, 8), P({ color: 0xff3d5e, roughness: 0.8 })); fth.position.set(-0.05, 0.14, -0.09); fth.rotation.set(0.6, 0, -0.5); fth.scale.z = 0.3; g.add(fth); }
    if (id === 'viking') { const steel = P({ color: 0x9aa6b4, metalness: 0.85, roughness: 0.28 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), steel); g.add(dome);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.016, 8, 32), GOLD); band.rotation.x = Math.PI / 2; g.add(band);
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 8, 32, Math.PI), GOLD); ridge.rotation.y = Math.PI / 2; g.add(ridge);
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28, r = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), GOLD); r.position.set(Math.cos(a) * 0.14, 0.0, Math.sin(a) * 0.14); g.add(r); }
      for (const z of [-1, 1]) { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.05, z * 0.12), new THREE.Vector3(0.01, 0.12, z * 0.22), new THREE.Vector3(0.04, 0.24, z * 0.25)]);
        const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.032, 12), P({ color: 0xfff2d6, roughness: 0.5, sheen: 0.4 })); const pos = horn.geometry.attributes.position; // taper toward the tip
        for (let i = 0; i < pos.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pos, i), k = Math.min(1, Math.max(0, (v.y - 0.05) / 0.2)), c = curve.getPoint(k); v.sub(c).multiplyScalar(1 - k * 0.85).add(c); pos.setXYZ(i, v.x, v.y, v.z); } horn.geometry.computeVertexNormals(); g.add(horn); } }
    if (id === 'crown') { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.115, 0.075, 32, 1, true), GOLD); band.material = GOLD.clone(); band.material.side = THREE.DoubleSide; band.position.y = 0.04; g.add(band);
      const velvet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), P({ color: 0xb0122e, roughness: 0.85, clearcoat: 0, sheen: 1, sheenColor: 0xff6a8a })); velvet.position.y = 0.04; g.add(velvet);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, sp = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.09, 12), GOLD); sp.position.set(Math.cos(a) * 0.118, 0.115, Math.sin(a) * 0.118); g.add(sp);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), P({ color: 0xffffff, roughness: 0.1, clearcoat: 1 })); ball.position.set(Math.cos(a) * 0.118, 0.165, Math.sin(a) * 0.118); g.add(ball);
        const jw = new THREE.Mesh(new THREE.OctahedronGeometry(0.019, 0), gem([0xff1f4e, 0x2fb6ff, 0x3ce05a, 0xb47aff][i % 4])); jw.position.set(Math.cos(a) * 0.124, 0.04, Math.sin(a) * 0.124); jw.scale.set(1, 1.3, 1); g.add(jw); }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), GOLD); top.position.y = 0.15; g.add(top); const cr = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), GOLD); cr.position.y = 0.19; g.add(cr); const cr2 = cr.clone(); cr2.rotation.x = Math.PI / 2; cr2.position.y = 0.195; g.add(cr2); }
    if (id === 'halo') { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 16, 48), new THREE.MeshPhysicalMaterial({ color: 0xfff2a8, emissive: 0xffd84a, emissiveIntensity: 1.3, metalness: 0.4, roughness: 0.2, clearcoat: 1 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; g.add(ring); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xffe27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })); gl.scale.set(0.5, 0.22, 1); gl.position.y = 0.16; g.add(gl);
      ring.onBeforeRender = () => { const t = performance.now() / 1000; ring.position.y = 0.16 + Math.sin(t * 2) * 0.012; ring.rotation.z = t * 0.5; }; }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
  }
  // live 3D preview of the equipped / browsed skin (shop): its own small renderer
  // Previews draw through the game's own WebGL context into an off-screen target and copy the pixels to a 2D canvas:
  // a second/third WebGL context per page is what makes phones drop the game's context (the 'blue screen').
  let MAIN_R = null;
  class SharedDraw {
    constructor(cv, ss = 1.5) { this.cv = cv; this.g = cv.getContext('2d'); this.ss = ss; this.tmp = document.createElement('canvas'); this.tg = this.tmp.getContext('2d'); }
    render(scene, cam) { const R = MAIN_R; if (!R) return; const w = Math.round(this.cv.width * this.ss), h = Math.round(this.cv.height * this.ss); // supersampled (multisampled targets read back empty on some GPUs)
      if (!this.rt || this.rt.width !== w || this.rt.height !== h) { if (this.rt) this.rt.dispose(); this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType }); this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace; this.rt.isXRRenderTarget = true; // tone-mapped, linear: encoded to sRGB below
        this.buf = new Uint8Array(w * h * 4); this.tmp.width = w; this.tmp.height = h; this.img = this.tg.createImageData(w, h); }
      const prevRT = R.getRenderTarget(), prevA = R.getClearAlpha(), prevC = R.getClearColor(new THREE.Color()), sm = R.shadowMap.autoUpdate;
      R.setRenderTarget(this.rt); R.setClearColor(0x000000, 0); R.clear(); R.shadowMap.autoUpdate = false; R.render(scene, cam); R.shadowMap.autoUpdate = sm;
      R.readRenderTargetPixels(this.rt, 0, 0, w, h, this.buf); R.setRenderTarget(prevRT); R.setClearColor(prevC, prevA);
      const d = this.img.data, row = w * 4, L = SharedDraw.lut || (SharedDraw.lut = Uint8Array.from({ length: 256 }, (_, i) => { const c = i / 255; return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }));
      for (let y = 0; y < h; y++) { const so = (h - 1 - y) * row, dO = y * row; for (let x = 0; x < row; x += 4) { d[dO + x] = L[this.buf[so + x]]; d[dO + x + 1] = L[this.buf[so + x + 1]]; d[dO + x + 2] = L[this.buf[so + x + 2]]; d[dO + x + 3] = this.buf[so + x + 3]; } } // flip Y + linear -> sRGB
      this.tg.putImageData(this.img, 0, 0); this.g.clearRect(0, 0, this.cv.width, this.cv.height); this.g.imageSmoothingQuality = 'high'; this.g.drawImage(this.tmp, 0, 0, this.cv.width, this.cv.height); }
    dispose() { if (this.rt) this.rt.dispose(); this.rt = null; }
  }
  class SkinPreview {
    constructor(cv, thumb = false) { this.cv = cv; this.thumb = thumb; this.r = new SharedDraw(cv, thumb ? 2 : 1.5);
      this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.1, 50); this.frame('full');
      this.scene.add(new THREE.HemisphereLight(0xdff4ff, 0x203060, 1.5)); const k = new THREE.DirectionalLight(0xfff0d8, 3.4); k.position.set(-2, 3, 4); this.scene.add(k); const r2 = new THREE.DirectionalLight(0x9fe8ff, 2.2); r2.position.set(3, 1.5, -3); this.scene.add(r2);
      const f = new THREE.DirectionalLight(0xffd6f0, 0.8); f.position.set(3, -1, 3); this.scene.add(f);
      this.ped = new THREE.Group(); this.scene.add(this.ped);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.18, 48), new THREE.MeshPhysicalMaterial({ color: 0xffe2a0, roughness: 0.45, clearcoat: 0.8 })); top.position.y = -0.95; this.ped.add(top);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.89, 0.035, 10, 64), new THREE.MeshPhysicalMaterial({ color: 0xffc533, metalness: 0.85, roughness: 0.22 })); rim.rotation.x = Math.PI / 2; rim.position.y = -0.86; this.ped.add(rim);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.05, 0.12, 48), new THREE.MeshPhysicalMaterial({ color: 0x1f4f9a, roughness: 0.4, clearcoat: 1 })); base.position.y = -1.09; this.ped.add(base);
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28, sh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshPhysicalMaterial({ color: [0xff9ac4, 0xfff1d6, 0x8fd0ff][i % 3], roughness: 0.3, clearcoat: 1 })); sh.scale.set(1, 0.5, 1); sh.position.set(Math.cos(a) * 0.98, -1.02, Math.sin(a) * 0.98); this.ped.add(sh); }
      this.pearl = new THREE.Mesh(GEO.ball, MAT.pearl); this.scene.add(this.pearl);
      this.pglow = new THREE.Sprite(MAT.ballGlow); this.pearl.add(this.pglow); this.pglow.scale.setScalar(1.8); this.pglow.position.z = -0.1;
      this.trail = [...Array(18)].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); this.scene.add(sp); return sp; });
      this.rebuild(); this.mode = 'full'; }
    frame(mode) { this.mode = mode; const C = { full: [0, 0.55, 6.6, -0.2], trailCard: [-0.6, 0.4, 6.4, 0.05], card: [0, 0.45, 4.9, 0.05], mascot: [0.35, 0.35, 5.6, 0.05], head: [0.2, 1.35, 3.3, 1.1], trail: [-0.3, 0.45, 8.6, -0.05], pearl: [0, 0.2, 3.6, 0] }[mode] || [0, 0.55, 6.6, -0.2];
      this.cam.position.set(C[0], C[1], C[2]); this.cam.lookAt(C[0] * 0.5, C[3], 0); }
    rebuild() { if (this.d) { this.scene.remove(this.d); this.d.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } this.d = makeDiver(); this.d.scale.setScalar(2.3); this.d.position.y = 0.2; this.scene.add(this.d); this.hatId = SKIN.hat; this.scarfId = SKIN.scarf; this.kitId = skinOf('suit', SKIN.suit).kit || ''; }
    render(t) { if (this.hatId !== SKIN.hat || (this.scarfId === 'none') !== (SKIN.scarf === 'none') || this.kitId !== (skinOf('suit', SKIN.suit).kit || '')) this.rebuild(); skinTick(t);
      const u = this.d.userData, pm = this.mode === 'pearl', tm = this.mode === 'trail' || this.mode === 'trailCard';
      this.d.visible = !pm; this.ped.visible = !pm && !tm && this.mode !== 'head' && this.mode !== 'mascot';
      this.d.rotation.y = tm ? -0.15 : this.mode === 'head' ? -0.75 : this.thumb ? -0.45 : -0.6 + Math.sin(t * 0.6) * 0.55; this.d.position.set(tm ? 0.9 : 0, (tm ? 0.25 : 0.2) + Math.sin(t * 1.2) * 0.06, 0); this.d.rotation.z = tm ? -0.25 : 0;
      u.armF.rotation.z = (tm ? 1.4 + Math.sin(t * 8) * 0.8 : 0.5 + Math.sin(t * 1.6) * 0.25 + (!this.thumb && Math.sin(t * 0.5) > 0.8 ? 2.2 + Math.sin(t * 14) * 0.3 : 0)); u.armB.rotation.z = tm ? 1.2 - Math.sin(t * 8) * 0.8 : 0.4 + Math.sin(t * 1.6 + 1) * 0.2;
      u.legF.rotation.z = Math.sin(t * (tm ? 10 : 2)) * (tm ? 0.4 : 0.15); u.legB.rotation.z = -u.legF.rotation.z;
      if (u.scarf) u.scarf.forEach((sc, j) => { const P = sc.geo.attributes.position, b = sc.base; for (let i = 0; i < P.count; i++) { const x = -b[i * 3] / sc.len; P.setY(i, b[i * 3 + 1] + Math.sin(t * (tm ? 9 : 3) - x * 5 + j) * 0.025 * x); } P.needsUpdate = true; sc.piv.rotation.z = (tm ? 0 : -0.5) + Math.sin(t + j) * 0.1; });
      // pearl: beside the diver, or centre stage in the pearl shot
      this.pearl.visible = !tm && !(this.thumb && this.mode !== 'pearl'); if (pm) { this.pearl.position.set(0, 0, 0); this.pearl.scale.setScalar(1.15); } else { this.pearl.scale.setScalar(0.55); this.pearl.position.set(0.95, -0.62 + Math.sin(t * 1.5 + 1) * 0.04, -0.3); }
      this.pearl.rotation.y = t * 0.8; this.pglow.material = MAT.ballGlow;
      // trail: a stream of the equipped trail's particles behind the diver
      const tr = skinOf('trail', SKIN.trail), bub = tr.id === 'bubbles', showT = tm || (!pm && this.mode === 'full' && !this.thumb);
      this.trail.forEach((sp, i) => { sp.visible = showT; if (!showT) return; const k = ((i / this.trail.length) + t * 0.35) % 1, x = (tm ? 0.55 : 0.2) - k * (tm ? 3.4 : 1.5), y = (tm ? 0.1 : -0.4) + Math.sin(k * 7 + i) * 0.18 * k + k * (tm ? 0.5 : 0.3);
        sp.position.set(x, y, -0.2 + Math.cos(i) * 0.2); const sz = (bub ? 0.12 + (i % 3) * 0.06 : 0.3 + (i % 3) * 0.1) * (1 - k * 0.45) * (tm ? 1.7 : 1); sp.scale.setScalar(sz);
        sp.material.map = bub ? TEX.bubble : TEX.dot; sp.material.blending = THREE.NormalBlending; /* normal blending keeps trail colours saturated (additive piles up to white) */ sp.material.color.copy(bub ? new THREE.Color(0xe8fbff) : (tr.rainbow ? new THREE.Color().setHSL((k + t * 0.3) % 1, 0.9, 0.6) : new THREE.Color(tr.col))); sp.material.opacity = Math.min(1, (1 - k) * 1.3); });
      this.r.render(this.scene, this.cam); }
    shot(mode, t = 1.3) { this.frame(mode); this.render(t); return this.cv.toDataURL('image/png'); }
    dispose() { this.r.dispose(); }
  }
  // ---- reef-rock material for thick wall masses: world-space cobble texture (seamless across cells), darker toward open edges,
  // a sunlit lip on exposed tops; uses the sand mask's wall channel (.b) to know which neighbours are open
  function massMat(world) { MAT.mass = MAT.mass || [];
    if (MAT.mass[world]) return MAT.mass[world];
    if (!TEX.cobbleRock) { // reef rock in the owner's reference style: small and medium flat stones packed tightly, warm browns with a few grey-lavender
      // ones, soft low-contrast shading and thin warm mortar. Two canvases share every stone: a height map (bump) and a colour map.
      const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); g.fillStyle = 'rgb(58,58,58)'; g.fillRect(0, 0, N, N);
      const cc = document.createElement('canvas'); cc.width = cc.height = N; const gC = cc.getContext('2d'); gC.fillStyle = '#5f412f'; gC.fillRect(0, 0, N, N);
      const PAL = [[160, 114, 84], [170, 124, 92], [148, 104, 78], [178, 134, 100], [140, 98, 74], [152, 126, 130], [162, 118, 86], [144, 102, 80], [182, 140, 106], [154, 110, 82], [136, 118, 128], [168, 126, 96]];
      let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647; const stones = []; for (let k = 0; k < 9000; k++) { gC.fillStyle = rnd() < 0.5 ? 'rgba(60,38,22,0.22)' : 'rgba(190,150,110,0.18)'; gC.fillRect(rnd() * N, rnd() * N, 2 + rnd() * 4, 2 + rnd() * 4); } // warm mottled earth between the stones
      const fits = (x, y, r) => { for (const q of stones) { let dx = Math.abs(q.x - x), dy = Math.abs(q.y - y); dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); if (dx * dx + dy * dy < (q.r + r + 1.5) ** 2) return false; } return true; };
      for (const [rmin, rmax, tries] of [[62, 90, 700], [38, 58, 1200], [18, 34, 2600], [8, 15, 900]]) for (let t = 0; t < tries; t++) { const r = rmin + rnd() * (rmax - rmin), x = rnd() * N, y = rnd() * N; if (fits(x, y, r)) stones.push({ x, y, r }); }
      for (const q of stones) { const bs = [...Array(14)].map(() => 0.9 + rnd() * 0.16), bp = (ctx, sx = 1) => { ctx.beginPath(); for (let i = 0; i <= 14; i++) { const t = i / 14 * Math.PI * 2, k = bs[i % 14] * sx; const px = Math.cos(t) * rx * k, py = Math.sin(t) * ry * k; if (!i) ctx.moveTo(px, py); else { const t0 = (i - 0.5) / 14 * Math.PI * 2, k0 = (bs[(i - 1) % 14] + bs[i % 14]) / 2 * sx * 1.03; ctx.quadraticCurveTo(Math.cos(t0) * rx * k0, Math.sin(t0) * ry * k0, px, py); } } ctx.closePath(); }; const a = rnd() * 3.14, rx = q.r * (0.98 + rnd() * 0.12), ry = q.r * (0.8 + rnd() * 0.18), v = 0.72 + rnd() * 0.22, col = PAL[(rnd() * PAL.length) | 0], j = 1.04 + rnd() * 0.18;
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const X = q.x + ox, Y = q.y + oy; if (X < -80 || X > N + 80 || Y < -80 || Y > N + 80) continue;
          g.save(); g.translate(X, Y); g.rotate(a); const gr = g.createRadialGradient(-rx * 0.2, -ry * 0.25, 1, 0, 0, Math.max(rx, ry));
          const L = k => Math.round(255 * Math.min(1, v * k)); gr.addColorStop(0, `rgb(${L(1.05)},${L(1.05)},${L(1.05)})`); gr.addColorStop(0.7, `rgb(${L(0.95)},${L(0.95)},${L(0.95)})`); gr.addColorStop(0.92, `rgb(${L(0.75)},${L(0.75)},${L(0.75)})`); gr.addColorStop(1, 'rgb(70,70,70)');
          g.fillStyle = gr; bp(g); g.fill(); g.restore();
          gC.save(); gC.translate(X + 3, Y + 5); gC.rotate(a); gC.fillStyle = 'rgba(38,22,15,0.62)'; bp(gC); gC.fill(); gC.restore(); // a soft shadow in the mortar
          gC.save(); gC.translate(X, Y); gC.rotate(a); const C = (k, al = 1) => `rgba(${Math.min(255, col[0] * k * j) | 0},${Math.min(255, col[1] * k * j) | 0},${Math.min(255, col[2] * k * j) | 0},${al})`, cg = gC.createRadialGradient(-rx * 0.3, -ry * 0.35, 1, 0, 0, Math.max(rx, ry));
          cg.addColorStop(0, C(1.08)); cg.addColorStop(0.65, C(1.0)); cg.addColorStop(1, C(0.86)); gC.fillStyle = cg; bp(gC); gC.fill();
          gC.save(); gC.clip(); for (let k = 0; k < Math.max(10, q.r * 5); k++) { gC.fillStyle = rnd() < 0.5 ? C(1.2, 0.2) : C(0.72, 0.22); gC.beginPath(); gC.arc((rnd() - 0.5) * rx * 2, (rnd() - 0.5) * ry * 2, 0.8 + rnd() * q.r * 0.07, 0, 7); gC.fill(); }
            { gC.rotate(-a); const sg = gC.createLinearGradient(-rx * 0.8, -ry * 0.8, rx * 0.8, ry * 0.8); sg.addColorStop(0, 'rgba(255,240,220,0.2)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(30,16,8,0.32)'); gC.fillStyle = sg; gC.fillRect(-rx * 1.5, -ry * 1.5, rx * 3, ry * 3); gC.rotate(a); } gC.restore(); // rough, mottled stone surface, lit top-left and shaded bottom-right
          gC.lineWidth = Math.max(1.5, q.r * 0.09); gC.strokeStyle = 'rgba(52,32,22,0.38)'; bp(gC); gC.stroke(); // soft dark rim
          gC.lineWidth = Math.max(1, q.r * 0.06); gC.strokeStyle = 'rgba(236,214,192,0.5)'; gC.beginPath(); gC.ellipse(0, 0, rx * 0.9, ry * 0.9, 0, Math.PI * 0.95 - a, Math.PI * 1.6 - a); gC.stroke(); // light catch, top-left
          gC.restore(); } }
      { const im = g.getImageData(0, 0, N, N), d = im.data; for (let k = 0; k < d.length; k += 4) { const n = (rnd() - 0.5) * 14; d[k] = d[k + 1] = d[k + 2] = Math.max(0, Math.min(255, d[k] + n)); } g.putImageData(im, 0, 0); }
      TEX.cobbleRock = new THREE.CanvasTexture(c); TEX.cobbleRock.wrapS = TEX.cobbleRock.wrapT = THREE.RepeatWrapping; TEX.cobbleRock.colorSpace = THREE.NoColorSpace; TEX.cobbleRock.anisotropy = 4;
      TEX.rockCol = new THREE.CanvasTexture(cc); TEX.rockCol.wrapS = TEX.rockCol.wrapT = THREE.RepeatWrapping; TEX.rockCol.colorSpace = THREE.SRGBColorSpace; TEX.rockCol.anisotropy = 4; }
    const COL = [[0.82, 0.46, 0.3], [0.5, 0.34, 0.75], [0.24, 0.4, 0.6]][world] || [0.82, 0.46, 0.3];
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, envMapIntensity: 0.3 });
    m.onBeforeCompile = (sh) => { sh.uniforms.uMask = MAT.sandMask.tex; sh.uniforms.uSize = MAT.sandMask.size; sh.uniforms.uRock = { value: TEX.cobbleRock }; sh.uniforms.uRockC = { value: TEX.rockCol }; sh.uniforms.uCol = { value: new THREE.Vector3(...COL) }; sh.uniforms.uCausticT = MAT.causticT; sh.uniforms.uLamp = MAT.lamp; sh.uniforms.uLampAmb = MAT.lampAmb;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWm; varying vec3 vNm;').replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWm = (modelMatrix * wp4).xyz; vNm = normal; }');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uMask, uRock, uRockC; uniform vec2 uSize; uniform vec3 uCol; uniform float uCausticT, uLampAmb; uniform vec4 uLamp; varying vec3 vWm; varying vec3 vNm;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 p = vWm.xy; vec2 pt = abs(vNm.y) > 0.5 ? vWm.xz * vec2(1.0, 1.6) : abs(vNm.x) > 0.5 ? vWm.zy * vec2(1.6, 1.0) : vWm.xy; float r2 = texture2D(uRock, pt * 0.13 + 0.37).r, r3 = texture2D(uRock, pt * 0.07 + 0.71).r;
          float r = texture2D(uRock, pt * 0.3).r;
          vec3 tint = mix(uCol, vec3(dot(uCol, vec3(0.3333))) * vec3(0.94, 1.0, 1.06), smoothstep(0.4, 0.8, r3) * 0.5); // stones vary: some greyer, some warmer
          tint *= 0.88 + 0.24 * smoothstep(0.25, 0.8, r2 * 0.5 + r3 * 0.5);                                                // broad light and dark patches
          vec3 c = tint * (0.12 + 0.5 * r * r) * (0.82 + 0.3 * r2);
          ${world === 0 ? '{ vec3 rc = texture2D(uRockC, pt * 0.3).rgb; rc = mix(vec3(dot(rc, vec3(0.3, 0.59, 0.11))), rc, 0.76) * vec3(1.06, 0.97, 0.94); rc = mix(vec3(dot(rc, vec3(0.3, 0.59, 0.11))), rc, 1.18) * vec3(1.0, 0.93, 0.88); c = max(rc, 0.0) * (0.92 + 0.16 * r2) * 0.88; }' : 'c = mix(c, texture2D(uRockC, pt * 0.3).rgb * tint * 1.6, 0.35);'} // the reference's warm cobbles (other worlds keep their colour, with a hint of the stone variety)
          { float ee = 0.009, hx = texture2D(uRock, (pt + vec2(ee, 0.0)) * 0.3).r - r, hy = texture2D(uRock, (pt + vec2(0.0, ee)) * 0.3).r - r; // bump: stones lit from the top-left like the key light
            c *= clamp(1.0 + (-hx * 0.6 + hy * 0.75) * 9.5, 0.6, 1.5);
            if (uCol.r > 0.3 || uCol.g > 0.45) c = mix(c, vec3(0.2, 0.36, 0.22) * (0.5 + 0.7 * r), smoothstep(0.5, 0.85, r2) * smoothstep(0.0, 0.02, hy) * smoothstep(0.35, 0.6, r) * 0.32); } // a little algae on the upper faces
          vec2 cell = vec2(floor(p.x + 0.5), floor(-p.y + 0.5)); vec2 lc = vec2(p.x + 0.5, -p.y + 0.5) - cell;
          #define WB(o) texture2D(uMask, (cell + o + 0.5) / uSize).b
          float oU = 1.0 - step(0.5, WB(vec2(0.0, -1.0))), oD = 1.0 - step(0.5, WB(vec2(0.0, 1.0))), oL = 1.0 - step(0.5, WB(vec2(-1.0, 0.0))), oR = 1.0 - step(0.5, WB(vec2(1.0, 0.0)));
          if (cell.y < 0.5) oU = 0.0;
          // depth: distance to the nearest open water (up to 2 cells away). Rock near the water is lit, deep inside a mass it sinks into shade,
          // so thick walls read as solid reef with volume instead of a flat tiled panel
          float dE = 2.0;
          if (oL > 0.5) dE = min(dE, lc.x); if (oR > 0.5) dE = min(dE, 1.0 - lc.x); if (oU > 0.5) dE = min(dE, lc.y); if (oD > 0.5) dE = min(dE, 1.0 - lc.y);
          if (WB(vec2(-1.0, -1.0)) < 0.5) dE = min(dE, length(lc)); if (WB(vec2(1.0, -1.0)) < 0.5) dE = min(dE, length(lc - vec2(1.0, 0.0)));
          if (WB(vec2(-1.0, 1.0)) < 0.5) dE = min(dE, length(lc - vec2(0.0, 1.0))); if (WB(vec2(1.0, 1.0)) < 0.5) dE = min(dE, length(lc - vec2(1.0, 1.0)));
          if (WB(vec2(-2.0, 0.0)) < 0.5) dE = min(dE, lc.x + 1.0); if (WB(vec2(2.0, 0.0)) < 0.5) dE = min(dE, 2.0 - lc.x);
          if (WB(vec2(0.0, 1.0)) > 0.5 && WB(vec2(0.0, 2.0)) < 0.5) dE = min(dE, 2.0 - lc.y); if (cell.y > 1.5 && WB(vec2(0.0, -2.0)) < 0.5) dE = min(dE, lc.y + 1.0);
          float dk = smoothstep(0.05, 1.7, dE);
          c = mix(c, tint * 0.3, dk * 0.18) * mix(1.1, 0.6, dk);                     // deep inside: darker and calmer
          float bev = oU * smoothstep(0.13, 0.02, lc.y) + oL * smoothstep(0.1, 0.0, lc.x) * 0.55; // bevel: bright rim on edges that face the light...
          float crease = max(oR * smoothstep(0.16, 0.0, 1.0 - lc.x), oD * smoothstep(0.22, 0.0, 1.0 - lc.y));
          c *= 1.0 - crease * 0.45;                                                  // ...and a soft shaded crease on the far side
          c = mix(c, uCol * 0.95 + 0.06, min(1.0, bev) * 0.8);
          float a = sin(p.x * 3.1 + uCausticT * 0.9 + sin(p.y * 2.3 + uCausticT * 0.6) * 1.5), b = sin(p.y * 2.7 - uCausticT * 0.7 + sin(p.x * 2.9 - uCausticT * 0.8) * 1.5);
          c += vec3(0.6, 0.85, 0.9) * pow(max(0.0, 1.0 - abs(a + b) * 0.5), 8.0) * 0.08;
          if (vNm.y > 0.5) c = mix(uCol * 0.5, uCol * 0.85 + 0.04, 0.6) * (0.85 + 0.3 * r2) * (0.92 + 0.08 * sin(vWm.x * 9.0 + vWm.z * 5.0)); // ledge top: sunlit, calm
          else if (vNm.z < 0.5) c *= 0.7;                                           // block sides a bit darker
          { float d = length(p - uLamp.xy), pool = smoothstep(uLamp.z * 1.9, 0.0, d), core = smoothstep(uLamp.z, 0.0, d); c *= 1.0 - uLampAmb * (1.0 - pool); c += c * vec3(0.9, 0.6, 0.28) * core * core * uLamp.w; }
          diffuseColor.rgb = c; }`);
      if (world === 2) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { /* the Deep: sparse spots of glowing lichen on the rock faces, each breathing at its own pace */
          vec2 q = vWm.xy * 2.3, ci = floor(q), f = fract(q); float h = fract(sin(dot(ci, vec2(12.9898, 78.233))) * 43758.5453), h2 = fract(h * 17.31), h3 = fract(h * 41.7), gl = 0.0;
          if (h < 0.11) { float rr = 0.04 + 0.05 * h2, d = length(f - vec2(0.25 + 0.5 * h2, 0.25 + 0.5 * h3)); gl = smoothstep(rr, rr * 0.25, d) + 0.3 * smoothstep(rr * 2.8, rr, d); gl *= 0.55 + 0.45 * sin(uCausticT * 1.2 + h * 40.0); }
          totalEmissiveRadiance += vec3(0.22, 0.92, 1.0) * gl * 0.5 * step(0.5, vNm.z); }`); };
    m.customProgramCacheKey = () => 'mass' + world;
    return (MAT.mass[world] = m); }
  // ---- monsters, in the diver's toy style: glossy bodies with a soft rim glow, big readable eyes, clear "danger" faces
  function rimMat(m, col, k) { m.onBeforeCompile = (sh) => { sh.uniforms.uRim = { value: new THREE.Color(col).multiplyScalar(k) };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;').replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n{ float rim = pow(max(0.0, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)))), 2.4); totalEmissiveRadiance += uRim * rim; }'); };
    m.customProgramCacheKey = () => 'mrim' + col + k; return m; }
  function monMats() { if (MAT.monEye) return;
    const P = o => new THREE.MeshPhysicalMaterial(o);
    MAT.monEye = P({ color: 0xffffff, roughness: 0.08, clearcoat: 1, envMapIntensity: 0.8, emissive: 0x404040, emissiveIntensity: 1 });
    MAT.monPupil = P({ color: 0x0b0b18, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.2 });
    MAT.monShine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    MAT.monMouth = new THREE.MeshStandardMaterial({ color: 0x3a0820, roughness: 0.6 });
    MAT.monTooth = P({ color: 0xfffbf0, roughness: 0.2, clearcoat: 1, emissive: 0x303030, emissiveIntensity: 1 });
    MAT.fishN = rimMat(P({ color: 0x7a3cff, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3, iridescence: 0.35, iridescenceIOR: 1.4, emissive: 0x200060, emissiveIntensity: 1 }), 0xff7ad8, 0.55);
    MAT.fishBellyN = rimMat(P({ color: 0xffc93a, roughness: 0.25, clearcoat: 1, envMapIntensity: 1.1, emissive: 0x402000, emissiveIntensity: 1 }), 0xfff0a0, 0.35);
    MAT.finN = rimMat(P({ color: 0xff4f9a, roughness: 0.3, clearcoat: 0.8, envMapIntensity: 1, side: THREE.DoubleSide, emissive: 0x400018, emissiveIntensity: 1 }), 0xffb0d8, 0.4);
    MAT.spotN = P({ color: 0x4a1ab0, roughness: 0.2, clearcoat: 1 });
    MAT.jellyN = rimMat(P({ color: 0xff8ad6, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.82, emissive: 0xff3fb8, emissiveIntensity: 0.6, envMapIntensity: 1.4, iridescence: 0.7, iridescenceIOR: 1.3, depthWrite: false }), 0xffe0ff, 0.9);
    MAT.jellyInN = new THREE.MeshStandardMaterial({ color: 0xffd0f0, emissive: 0xff70d0, emissiveIntensity: 1.1, transparent: true, opacity: 0.9 });
    MAT.tentN = new THREE.MeshStandardMaterial({ color: 0xffb0ea, emissive: 0xff58cc, emissiveIntensity: 0.9, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
    MAT.crabN = rimMat(P({ color: 0xff5a1f, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3, emissive: 0x401000, emissiveIntensity: 1 }), 0xffd08a, 0.5);
    MAT.crabDarkN = P({ color: 0xc23a10, roughness: 0.3, clearcoat: 1 });
    MAT.crabBellyN = P({ color: 0xffd8a8, roughness: 0.35, clearcoat: 0.6 });
  }
  function talkMouth(parent, x, y, z, w, h, ry = 0) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), MAT.monMouth || MAT.monPupil); m.scale.set(w * 0.35, h, w); m.position.set(x, y, z); m.rotation.y = ry; m.visible = false; m.userData.h = h; parent.add(m); return m; }
  function cartoonEye(r, look = [0.25, 0]) { // white ball, big pupil looking toward look, two highlights
    const g = new THREE.Group(), w = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), MAT.monEye); g.add(w);
    const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 12, 8), MAT.monPupil); p.position.set(look[0] * r, look[1] * r, r * 0.55); g.add(p);
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 8, 6), MAT.monShine); s1.position.set(look[0] * r + r * 0.18, look[1] * r + r * 0.22, r * 1.02); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 6, 5), MAT.monShine); s2.position.set(look[0] * r - r * 0.12, look[1] * r - r * 0.18, r * 1.04); g.add(s2);
    g.userData.pupil = p; return g; }
  function finShape(w, h, lobes) { const s = new THREE.Shape(); s.moveTo(0, -h * 0.18); s.quadraticCurveTo(w * 0.5, -h * 0.55, w, -h * 0.5);
    if (lobes) s.quadraticCurveTo(w * 0.72, 0, w, h * 0.5); else s.quadraticCurveTo(w * 1.05, 0, w, h * 0.5);
    s.quadraticCurveTo(w * 0.5, h * 0.55, 0, h * 0.18); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 10 }); g.translate(0, 0, -0.01); return g; }
  function makeFish() { monMats();
    const g = new THREE.Group(); const b = new THREE.Group(); g.add(b);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), MAT.fishN); body.scale.set(1.18, 1.0, 0.82); b.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 12), MAT.fishBellyN); belly.scale.set(1.05, 0.62, 0.78); belly.position.set(0.05, -0.12, 0.02); b.add(belly);
    for (const [x, y, r] of [[-0.12, 0.17, 0.045], [-0.22, 0.08, 0.035], [-0.04, 0.24, 0.03]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), MAT.spotN); sp.scale.z = 0.4; sp.position.set(x, y, 0.235); b.add(sp); }
    const tail = new THREE.Group(); tail.position.set(-0.33, 0, 0); b.add(tail); { const f = new THREE.Mesh(finShape(0.26, 0.42, true), MAT.finN); f.rotation.y = Math.PI; tail.add(f); }
    const dorsal = new THREE.Mesh(finShape(0.2, 0.16, false), MAT.finN); dorsal.rotation.z = Math.PI / 2 + 0.5; dorsal.position.set(0.02, 0.27, 0); b.add(dorsal);
    const pect = new THREE.Mesh(finShape(0.13, 0.1, false), MAT.finN); pect.rotation.set(0.3, -0.5, Math.PI + 0.6); pect.position.set(0.0, -0.08, 0.22); b.add(pect);
    const eye = cartoonEye(0.1, [0.35, -0.05]); eye.position.set(0.17, 0.09, 0.19); b.add(eye);
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.13, 4, 8), MAT.monPupil); brow.rotation.z = Math.PI / 2 - 0.5; brow.position.set(0.17, 0.21, 0.24); b.add(brow);
    { const e2 = cartoonEye(0.1, [-0.35, -0.05]); e2.rotation.y = Math.PI; e2.position.set(0.17, 0.09, -0.19); b.add(e2); const b2 = brow.clone(); b2.position.z = -0.24; b.add(b2);
      const p2 = pect.clone(); p2.rotation.set(-0.3, 0.5, Math.PI + 0.6); p2.position.z = -0.22; b.add(p2);
      for (const [x, y, r] of [[-0.12, 0.17, 0.045], [-0.22, 0.08, 0.035], [-0.04, 0.24, 0.03]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), MAT.spotN); sp.scale.z = 0.4; sp.position.set(x, y, -0.235); b.add(sp); } } // the far side (films show it)
    const jaw = new THREE.Group(); jaw.position.set(0.3, -0.04, 0.05); b.add(jaw);
    { const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.monMouth); mouth.rotation.z = -Math.PI / 2; mouth.scale.set(1, 0.6, 1.3); jaw.add(mouth);
      for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.07, 5), MAT.monTooth); t.position.set(0.0, 0.035, -0.06 + i * 0.045 + 0.02); t.rotation.z = Math.PI; jaw.add(t);
        const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.055, 5), MAT.monTooth); t2.position.set(0.0, -0.035, -0.04 + i * 0.045); jaw.add(t2); } }
    g.userData = { b, tail, jaw }; g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeJelly() { monMats();
    const g = new THREE.Group();
    const bell = new THREE.Group(); bell.position.y = 0.02; g.add(bell);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.jellyN); dome.scale.y = 0.95; bell.add(dome);
    const frill = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 28), MAT.jellyN); frill.rotation.x = Math.PI / 2; bell.add(frill);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), MAT.jellyInN); core.position.y = 0.11; core.scale.set(1, 0.65, 1); bell.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff6ad8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })); glow.scale.set(1.0, 0.9, 1); glow.position.set(0, 0.08, 0.05); g.add(glow);
    for (const sx of [-1, 1]) { const e = cartoonEye(0.065, [0, -0.2]); e.position.set(sx * 0.1, 0.12, 0.27); bell.add(e); }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), MAT.monPupil); smile.rotation.z = Math.PI; smile.position.set(0, 0.04, 0.3); bell.add(smile);
    const tents = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3, r = 0.19, tg = new THREE.Group(); tg.position.set(Math.cos(a) * r, -0.01, Math.sin(a) * r * 0.8);
      const pts = []; for (let k = 0; k <= 6; k++) pts.push(new THREE.Vector3(Math.sin(k * 1.2 + i) * 0.035, -k * 0.075, 0)); const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.022 - (i % 2) * 0.006, 6), MAT.tentN);
      tg.add(tube); g.add(tg); tents.push(tg); }
    g.userData = { bell, tents }; return g;
  }
  function makeCrab() { monMats();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 14), MAT.crabN); body.scale.set(1.3, 0.72, 0.95); g.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10), MAT.crabBellyN); belly.scale.set(1.2, 0.45, 0.85); belly.position.set(0, -0.07, 0.04); g.add(belly);
    for (const [x, y, r] of [[-0.18, 0.1, 0.04], [0.16, 0.13, 0.035], [0.0, 0.17, 0.03], [-0.06, 0.08, 0.025]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), MAT.crabDarkN); sp.scale.y = 0.5; sp.position.set(x, y, 0.2); g.add(sp); }
    const legs = []; for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const lg = new THREE.Group(); lg.position.set(s * (0.22 + i * 0.06), -0.08, 0.1 - i * 0.1); g.add(lg);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8), MAT.crabN); up.rotation.z = s * -1.0; up.position.set(s * 0.07, 0.02, 0); lg.add(up);
      const lo = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.14, 4, 8), MAT.crabDarkN); lo.rotation.z = s * 0.35; lo.position.set(s * 0.15, -0.08, 0); lg.add(lo); legs.push(lg); }
    const claws = []; for (const s of [-1, 1]) { const cg = new THREE.Group(); cg.position.set(s * 0.3, 0.08, 0.18); g.add(cg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), MAT.crabN); arm.rotation.z = s * 0.9; arm.position.set(s * 0.04, -0.02, 0); cg.add(arm);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12), MAT.crabN); palm.scale.set(1.2, 0.95, 0.8); palm.position.set(s * 0.12, 0.08, 0); cg.add(palm);
      const top = new THREE.Group(); top.position.set(s * 0.17, 0.13, 0); cg.add(top); const tf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 10), MAT.crabN); tf.rotation.z = s * -0.5; tf.position.set(s * 0.03, 0.06, 0); top.add(tf);
      const bot = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 10), MAT.crabDarkN); bot.rotation.z = s * -0.9; bot.position.set(s * 0.22, 0.13, 0); cg.add(bot); claws.push(top); }
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.16, 8), MAT.crabN); st.position.set(s * 0.09, 0.22, 0.12); st.rotation.z = -s * 0.15; g.add(st);
      const e = cartoonEye(0.075, [0, -0.15]); e.position.set(s * 0.1, 0.32, 0.14); g.add(e);
      const br = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.08, 4, 6), MAT.monPupil); br.rotation.z = Math.PI / 2 + s * 0.45; br.position.set(s * 0.1, 0.41, 0.19); g.add(br); }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12, Math.PI), MAT.monPupil); mouth.position.set(0, 0.05, 0.27); g.add(mouth);
    g.userData = { legs, claws, mouth: talkMouth(g, 0, 0.035, 0.265, 0.05, 0.035, Math.PI / 2) }; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
  }
  // air capsule: a glassy soap-bubble (clear middle, bright fresnel rim, iridescent sheen, a window highlight),
  // a soft cyan glow inside, a crisp O2 badge and three tiny bubbles that rise and loop inside it
  function makeAir() {
    if (!MAT.airShell) {
      const m = new THREE.MeshPhysicalMaterial({ color: 0xe6fbff, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 1, envMapIntensity: 2.2, depthWrite: false,
        iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [250, 650] });
      m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
        { float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
          gl_FragColor.rgb = gl_FragColor.rgb * (0.35 + fr) + vec3(0.45, 0.9, 1.0) * fr * 0.85;
          gl_FragColor.a = clamp(0.07 + fr * 0.95, 0.0, 1.0); }`); };
      m.customProgramCacheKey = () => 'airShell1'; MAT.airShell = m;
      { const [c, g] = canvas(128); g.translate(64, 64); // window highlight: a curved bright streak + a dot
        g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineCap = 'round'; g.lineWidth = 9; g.shadowColor = '#ffffff'; g.shadowBlur = 6;
        g.beginPath(); g.arc(0, 0, 44, Math.PI * 1.08, Math.PI * 1.42); g.stroke(); g.lineWidth = 0; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-13, -50, 5, 0, 7); g.fill();
        MAT.airHi = new THREE.SpriteMaterial({ map: tex(c), transparent: true, depthWrite: false, toneMapped: false }); }
      { const [c, g] = canvas(256); g.translate(128, 132); g.font = '700 118px Fredoka, "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        g.lineWidth = 22; g.strokeStyle = '#0a5fb8'; g.strokeText('O', -16, 0); g.font = '700 64px Fredoka, "Trebuchet MS", sans-serif'; g.strokeText('2', 44, 30);
        g.fillStyle = '#ffffff'; g.font = '700 118px Fredoka, "Trebuchet MS", sans-serif'; g.fillText('O', -16, 0); g.font = '700 64px Fredoka, "Trebuchet MS", sans-serif'; g.fillText('2', 44, 30);
        MAT.airO2 = new THREE.SpriteMaterial({ map: tex(c), transparent: true, depthWrite: false }); }
      MAT.airGlow = new THREE.SpriteMaterial({ map: TEX.dot, color: 0x5fe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
      MAT.airMini = new THREE.MeshPhysicalMaterial({ color: 0xe6fbff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.6, envMapIntensity: 2, depthWrite: false });
      GEO.airMini = new THREE.SphereGeometry(1, 12, 8); GEO.airShell = new THREE.SphereGeometry(0.38, 40, 28);
    }
    const g = new THREE.Group(); const b = new THREE.Group(); g.add(b);
    const glow = new THREE.Sprite(MAT.airGlow); glow.scale.setScalar(0.95); glow.position.z = -0.05; b.add(glow);
    const minis = []; for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(GEO.airMini, MAT.airMini); m.scale.setScalar(0.035 + i * 0.012); m.renderOrder = 2; b.add(m); minis.push({ m, x: (i - 1) * 0.12, ph: i * 0.37 }); }
    const label = new THREE.Sprite(MAT.airO2); label.scale.setScalar(0.42); label.position.z = 0.12; label.renderOrder = 3; b.add(label);
    const shell = new THREE.Mesh(GEO.airShell, MAT.airShell); shell.renderOrder = 4; b.add(shell);
    const hi = new THREE.Sprite(MAT.airHi); hi.scale.setScalar(0.62); hi.position.set(0, 0, 0.4); hi.renderOrder = 5; b.add(hi);
    g.userData = { b, minis }; return g;
  }
  function makeKelp(h) {
    const g = new THREE.PlaneGeometry(0.2, h, 1, 8); g.translate(0, h / 2, 0);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - 0.6 * y / h) + Math.sin(y * 4) * 0.05); }
    g.computeVertexNormals(); return new THREE.Mesh(g, MAT.kelp);
  }
  function makeCoral() {
    const g = new THREE.Group(); const m = [MAT.coralPink, MAT.coralPurple, MAT.coralOrange][Math.random() * 3 | 0];
    for (let i = 0; i < 4; i++) { const h = 0.18 + Math.random() * 0.2; const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, h, 4, 8), m); c.position.set((i - 1.5) * 0.07, h / 2, 0); c.rotation.z = (i - 1.5) * 0.25; g.add(c); }
    return g;
  }

  // ---------------------------------------------------------------- living 3D reef behind the board
  const Reef = (() => {
    let sd = 1234567; const R = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const h3 = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
    const sm = t => t * t * (3 - 2 * t);
    function noise(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), xf), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), xf), yf),
               l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), xf), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), xf), yf), zf);
    }
    const fbm = (x, y, z) => noise(x, y, z) * 0.55 + noise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise(x * 4.3, y * 4.3, z * 4.3) * 0.15;
    const UP = new THREE.Vector3(0, 1, 0);
    function merge(parts) {
      let n = 0; const list = parts.map(([g, c]) => { const gg = g.index ? g.toNonIndexed() : g; n += gg.attributes.position.count; return [gg, c]; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
      for (const [g, c] of list) { const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
        for (let i = 0; i < P.count; i++) { pos.set([P.getX(i), P.getY(i), P.getZ(i)], (o + i) * 3); nor.set([N.getX(i), N.getY(i), N.getZ(i)], (o + i) * 3);
          if (C) col.set([C.getX(i), C.getY(i), C.getZ(i)], (o + i) * 3); else col.set(c ? [c.r, c.g, c.b] : [1, 1, 1], (o + i) * 3); }
        o += P.count; }
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      out.computeBoundingSphere(); return out;
    }
    // shared shader bits: caustics + optional sway (bends with height, phase from instance position)
    function reefMat(m, { caustic = 0.18, sway = 0, wag = 0 } = {}) {
      m.onBeforeCompile = sh => {
        sh.uniforms.uT = MAT.causticT;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT; varying vec3 vWpR;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float ph = 0.0;
          #ifdef USE_INSTANCING
            ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.45;
          #endif
            float hy = max(position.y, 0.0);
            transformed.x += sin(uT * 1.1 + ph + position.y * 0.45) * hy * ${sway.toFixed(3)};
            transformed.z += cos(uT * 0.8 + ph * 1.3 + position.y * 0.35) * hy * ${(sway * 0.6).toFixed(3)};
            transformed.z += sin(uT * 11.0 + ph * 3.0 + position.x * 7.0) * ${wag.toFixed(3)} * smoothstep(0.05, -0.35, position.x); }`)
          .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWpR = (modelMatrix * wp4).xyz; }');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT; varying vec3 vWpR;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { vec2 p = vWpR.xz * 0.55 + vWpR.y * 0.12;
            float a = sin(p.x * 3.1 + uT * 0.9 + sin(p.y * 2.3 + uT * 0.6) * 1.5);
            float b = sin(p.y * 2.7 - uT * 0.7 + sin(p.x * 2.9 - uT * 0.8) * 1.5);
            float cau = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 6.0);
            totalEmissiveRadiance += vec3(0.7, 0.95, 1.0) * cau * ${caustic.toFixed(3)} * (0.3 + diffuseColor.rgb) * clamp(normal.y * 0.5 + 0.6, 0.2, 1.0); }`);
      };
      m.customProgramCacheKey = () => 'reef' + caustic + '_' + sway + '_' + wag;
      return m;
    }
    function mergeSmooth(geo) { // weld duplicate vertices so computeVertexNormals gives smooth shading
      const P = geo.attributes.position, map = new Map(), idx = [], pos = [];
      for (let i = 0; i < P.count; i++) { const k = `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
        let j = map.get(k); if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(P.getX(i), P.getY(i), P.getZ(i)); } idx.push(j); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; }
    function inst(geo, mat, n, place) {
      const im = new THREE.InstancedMesh(geo, mat, n); const d = new THREE.Object3D(); const c = new THREE.Color();
      for (let i = 0; i < n; i++) { d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); const col = place(d, i, c); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (col) im.setColorAt(i, col); }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; return im;
    }

    function build(lowQ) {
      sd = 1234567;
      const g = new THREE.Group();
      // ---- seabed: dunes rising into hills in the distance
      const groundH = (x, z) => { const back = Math.max(0, -z - 6), front = Math.max(0, z - 1);
        return fbm(x * 0.08, 0, z * 0.08) * 2.2 + Math.sin(x * 0.35 + z * 0.15) * 0.25 + back * back * 0.0016 + back * 0.04 + Math.max(0, Math.abs(x) - 18) * 0.12 * (0.6 + fbm(x * 0.1, 5, z * 0.1)) - front * front * 0.05 - front * 0.5; };
      const sb = new THREE.PlaneGeometry(170, 120, 170, 90); sb.rotateX(-Math.PI / 2); sb.translate(0, 0, -28);
      { const P = sb.attributes.position, C = new Float32Array(P.count * 3);
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), y = groundH(x, z); P.setY(i, y);
          const t = fbm(x * 0.3, 1, z * 0.3), sh = 0.78 + t * 0.32; C.set([0.98 * sh, 0.76 * sh, 0.44 * sh], i * 3); }
        sb.setAttribute('color', new THREE.BufferAttribute(C, 3)); sb.computeVertexNormals(); }
      const sbm = reefMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.07 }), { caustic: 0.16 });
      const bed = new THREE.Mesh(sb, sbm); g.add(bed);
      const onBed = (x, z) => groundH(x, z);
      // where things may stand: anywhere except the strip right behind the board's middle (kept calmer)
      const spot = (minZ, maxZ, spread = 55) => { const x = (R() - 0.5) * 2 * spread, z = -(minZ + R() * (maxZ - minZ)); return [x, z]; };

      // ---- rocks: lumpy boulders and tall pillars, mossy on top
      const rockGeos = [0, 1, 2].map(v => { const geo = mergeSmooth(new THREE.IcosahedronGeometry(1, 5)); const P = geo.attributes.position; const C = new Float32Array(P.count * 3); const tmp = new THREE.Vector3();
        for (let i = 0; i < P.count; i++) { tmp.fromBufferAttribute(P, i); const n = fbm(tmp.x * 1.3 + v * 7, tmp.y * 1.3, tmp.z * 1.3); tmp.multiplyScalar(0.72 + n * 0.55); P.setXYZ(i, tmp.x, tmp.y, tmp.z); }
        geo.computeVertexNormals(); const N = geo.attributes.normal;
        for (let i = 0; i < P.count; i++) { const up = Math.max(0, N.getY(i)); const k = fbm(P.getX(i) * 3, P.getY(i) * 3, P.getZ(i) * 3); const hy = (P.getY(i) + 1) * 0.5;
          const base = [0.2 + hy * 0.16 + k * 0.08, 0.24 + hy * 0.16 + k * 0.08, 0.62 + hy * 0.16 + k * 0.08], moss = [0.22, 0.8, 0.55];
          const m = Math.pow(up, 2.5) * (0.5 + k * 0.6); C.set([base[0] + (moss[0] - base[0]) * m, base[1] + (moss[1] - base[1]) * m, base[2] + (moss[2] - base[2]) * m], i * 3); }
        geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); return geo; });
      const rockMat = reefMat(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, envMapIntensity: 0.18, sheen: 0.25, sheenColor: 0x9fe8ff, sheenRoughness: 0.5 }), { caustic: 0.35 });
      const rockSpots = [];
      rockGeos.forEach((geo, v) => g.add(inst(geo, rockMat, 14, d => {
        const [x, z] = spot(5, 46); const pillar = R() < 0.35; const s = 1.2 + R() * 2.6;
        d.scale.set(s * (0.8 + R() * 0.5), s * (pillar ? 2.2 + R() * 2 : 0.6 + R() * 0.5), s * (0.8 + R() * 0.5));
        d.position.set(x, onBed(x, z) + d.scale.y * 0.35, z); d.rotation.set((R() - 0.5) * 0.3, R() * 6.28, (R() - 0.5) * 0.3);
        rockSpots.push([x, z, d.position.y + d.scale.y * 0.75, s]); })));

      // ---- branching coral (staghorn), colour per instance, brighter tips
      const branch = () => { const parts = [];
        const grow = (p, dir, len, rad, depth) => { const end = p.clone().addScaledVector(dir, len);
          const cyl = new THREE.CylinderGeometry(rad * 0.72, rad, len, 7, 1); cyl.translate(0, len / 2, 0); cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir)); cyl.translate(p.x, p.y, p.z); parts.push([cyl]);
          const cap = new THREE.SphereGeometry(rad * 0.74, 7, 5); cap.translate(end.x, end.y, end.z); parts.push([cap]);
          if (depth > 0) { const k = 2 + (R() < 0.45 ? 1 : 0); for (let i = 0; i < k; i++) { const nd = dir.clone().add(new THREE.Vector3((R() - 0.5) * 1.5, R() * 0.6, (R() - 0.5) * 1.5)).normalize(); grow(end, nd, len * (0.62 + R() * 0.2), rad * 0.74, depth - 1); } } };
        grow(new THREE.Vector3(), UP.clone(), 0.8, 0.14, 3);
        const geo = merge(parts); const P = geo.attributes.position, C = geo.attributes.color; let my = 0; for (let i = 0; i < P.count; i++) my = Math.max(my, P.getY(i));
        for (let i = 0; i < P.count; i++) { const t = Math.pow(P.getY(i) / my, 1.6); C.setXYZ(i, 0.55 + t * 0.45, 0.55 + t * 0.45, 0.55 + t * 0.45); } return geo; };
      const coralMat = reefMat(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.25, emissive: 0x220818, emissiveIntensity: 1 }), { caustic: 0.3 });
      const palette = [0xff6fb2, 0xff8a3a, 0xa35cff, 0xffd447, 0x5fe6c8, 0xff5a5a];
      const coralSpot = () => { if (R() < 0.45 && rockSpots.length) { const r = rockSpots[(R() * rockSpots.length) | 0]; return [r[0] + (R() - 0.5) * r[3] * 0.8, r[2] - 0.2, r[1] + (R() - 0.5) * r[3] * 0.6]; } const [x, z] = spot(3, 40); return [x, onBed(x, z) - 0.05, z]; };
      for (let v = 0; v < 3; v++) g.add(inst(branch(), coralMat, lowQ ? 10 : 18, (d, i, c) => { const [x, y, z] = coralSpot(); d.position.set(x, y, z); d.rotation.y = R() * 6.28; d.scale.setScalar(0.9 + R() * 1.3); return c.set(palette[(R() * palette.length) | 0]); }));
      // brain coral domes
      { const geo = new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2); const P = geo.attributes.position, tmp = new THREE.Vector3();
        for (let i = 0; i < P.count; i++) { tmp.fromBufferAttribute(P, i); const r = Math.sin(tmp.x * 9 + noise(tmp.x * 2, tmp.y * 2, tmp.z * 2) * 7 + tmp.z * 3) * 0.035; tmp.multiplyScalar(1 + r); tmp.y *= 0.62; P.setXYZ(i, tmp.x, tmp.y, tmp.z); }
        geo.computeVertexNormals();
        const m = reefMat(new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.2 }), { caustic: 0.35 });
        g.add(inst(geo, m, lowQ ? 10 : 18, (d, i, c) => { const [x, y, z] = coralSpot(); d.position.set(x, y - 0.1, z); d.rotation.y = R() * 6.28; d.scale.setScalar(0.5 + R() * 0.9); return c.set([0xe8c46a, 0x9fd36a, 0xd98a5a, 0xc7a0e0][(R() * 4) | 0]); })); }
      // tube sponges
      { const parts = []; for (let i = 0; i < 5; i++) { const h = 0.8 + R() * 1.3, r = 0.16 + R() * 0.08; const t = new THREE.CylinderGeometry(r, r * 0.8, h, 12, 1, true); t.translate((R() - 0.5) * 0.6, h / 2, (R() - 0.5) * 0.6); t.rotateZ((R() - 0.5) * 0.3); parts.push([t]); }
        const m = reefMat(new THREE.MeshPhysicalMaterial({ vertexColors: false, roughness: 0.5, clearcoat: 0.5, envMapIntensity: 0.2, side: THREE.DoubleSide, emissive: 0x200a30, emissiveIntensity: 1 }), { caustic: 0.25 });
        g.add(inst(merge(parts), m, lowQ ? 8 : 14, (d, i, c) => { const [x, y, z] = coralSpot(); d.position.set(x, y, z); d.rotation.y = R() * 6.28; d.scale.setScalar(0.8 + R() * 0.9); return c.set([0xa35cff, 0xff8a3a, 0xffcf3a, 0x4fb0ff][(R() * 4) | 0]); })); }
      // sea fans: lacy flat fans on a hand-drawn texture
      { const [cv, gx] = canvas(256); gx.strokeStyle = '#fff'; gx.lineCap = 'round';
        const fan = (x, y, a, len, w, d) => { if (d < 0) return; const x2 = x + Math.sin(a) * len, y2 = y - Math.cos(a) * len; gx.lineWidth = w; gx.beginPath(); gx.moveTo(x, y); gx.lineTo(x2, y2); gx.stroke();
          fan(x2, y2, a - 0.32 + (R() - 0.5) * 0.2, len * 0.78, w * 0.72, d - 1); fan(x2, y2, a + 0.32 + (R() - 0.5) * 0.2, len * 0.78, w * 0.72, d - 1); };
        fan(128, 250, 0, 60, 7, 6); fan(128, 250, -0.6, 50, 5, 5); fan(128, 250, 0.6, 50, 5, 5);
        const tx = new THREE.CanvasTexture(cv); const geo = new THREE.PlaneGeometry(2, 2); geo.translate(0, 1, 0);
        const m = reefMat(new THREE.MeshStandardMaterial({ map: tx, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.2, emissive: 0x300818, emissiveIntensity: 1 }), { caustic: 0.2, sway: 0.03 });
        g.add(inst(geo, m, lowQ ? 8 : 16, (d, i, c) => { const [x, y, z] = coralSpot(); d.position.set(x, y - 0.1, z); d.rotation.y = (R() - 0.5) * 1.2; d.scale.setScalar(0.9 + R() * 1.4); return c.set([0xff4f7a, 0xffa040, 0xd070ff][(R() * 3) | 0]); })); }
      // anemones: soft swaying tentacles
      { const parts = []; for (let i = 0; i < 26; i++) { const a = R() * 6.28, rr = R() * 0.22; const t = new THREE.CapsuleGeometry(0.035, 0.45 + R() * 0.25, 3, 6); const dir = new THREE.Vector3(Math.cos(a) * rr * 2.2, 1, Math.sin(a) * rr * 2.2).normalize();
          t.translate(0, 0.3, 0); t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir)); t.translate(Math.cos(a) * rr, 0.05, Math.sin(a) * rr); parts.push([t]); }
        const geo = merge(parts); const P = geo.attributes.position, C = geo.attributes.color; for (let i = 0; i < P.count; i++) { const k = Math.min(1, P.getY(i) / 0.75); C.setXYZ(i, 0.6 + k * 0.4, 0.6 + k * 0.4, 0.6 + k * 0.4); }
        const m = reefMat(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, envMapIntensity: 0.25, emissive: 0x401020, emissiveIntensity: 1, sheen: 0.6, sheenColor: 0xffc0e0 }), { caustic: 0.2, sway: 0.18 });
        g.add(inst(geo, m, lowQ ? 10 : 22, (d, i, c) => { const [x, y, z] = coralSpot(); d.position.set(x, y, z); d.scale.setScalar(0.9 + R() * 1.1); return c.set([0xff7ab8, 0xff9a40, 0x7af0d0, 0xffe070][(R() * 4) | 0]); })); }
      // kelp forest: tall twisting ribbons
      { const geo = new THREE.PlaneGeometry(0.55, 1, 1, 24); geo.translate(0, 0.5, 0); const P = geo.attributes.position;
        for (let i = 0; i < P.count; i++) { const y = P.getY(i), x = P.getX(i); const tw = y * 2.2; P.setX(i, x * Math.cos(tw) * (1 - y * 0.35) + Math.sin(y * 6) * 0.08); P.setZ(i, x * Math.sin(tw) * (1 - y * 0.35)); }
        geo.computeVertexNormals();
        const m = reefMat(new THREE.MeshPhysicalMaterial({ color: 0x3fae58, roughness: 0.45, clearcoat: 0.5, envMapIntensity: 0.25, side: THREE.DoubleSide, emissive: 0x0a3018, emissiveIntensity: 1, sheen: 0.8, sheenColor: 0xbaffc8 }), { caustic: 0.25, sway: 0.1 });
        const im = inst(geo, m, lowQ ? 40 : 80, (d, i, c) => { const cl = (i / 10) | 0; const cx = [-34, -22, 26, 38, -46, 12, 48, -8][cl % 8], cz = [-12, -24, -14, -28, -34, -38, -18, -44][cl % 8];
          const x = cx + (R() - 0.5) * 7, z = cz + (R() - 0.5) * 6; const h = 5 + R() * 9; d.position.set(x, onBed(x, z) - 0.2, z); d.scale.set(1 + R() * 0.5, h, 1); d.rotation.y = R() * 6.28;
          const k = 0.75 + R() * 0.35; return c.setRGB(0.8 * k, 1.0 * k, 0.55 * k); });
        // sway amount is per unit of local height; kelp is scaled tall, so bend uses local y in 0..1
        g.add(im); }
      // starfish and shells scattered on the front sand
      { const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 0.16 : 0.42; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }); geo.rotateX(-Math.PI / 2);
        const m = new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.6, envMapIntensity: 0.3 });
        g.add(inst(geo, m, 14, (d, i, c) => { const [x, z] = spot(2, 14, 40); d.position.set(x, onBed(x, z) + 0.04, z); d.rotation.y = R() * 6.28; d.scale.setScalar(0.7 + R() * 0.6); return c.set([0xff6a3a, 0xff3a5a, 0xffb040, 0xb060ff][(R() * 4) | 0]); })); }

      // ---- fish schools
      const fishGeo = (() => { const body = new THREE.SphereGeometry(0.3, 14, 10); body.scale(1, 0.62, 0.3);
        const P = body.attributes.position, C = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) { const b = P.getY(i) < -0.06 ? 1.25 : 1; C.set([b, b, b], i * 3); } body.setAttribute('color', new THREE.BufferAttribute(C, 3));
        const tail = new THREE.BufferGeometry(); tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.24, 0, 0, -0.5, 0.17, 0, -0.5, -0.17, 0, -0.24, 0, 0, -0.5, -0.17, 0, -0.5, 0.17, 0], 3)); tail.computeVertexNormals();
        const fin = new THREE.BufferGeometry(); fin.setAttribute('position', new THREE.Float32BufferAttribute([0.05, 0.15, 0, -0.15, 0.3, 0, -0.18, 0.12, 0, 0.05, 0.15, 0, -0.18, 0.12, 0, -0.15, 0.3, 0], 3)); fin.computeVertexNormals();
        return merge([[body], [tail, new THREE.Color(0.85, 0.85, 0.85)], [fin, new THREE.Color(0.9, 0.9, 0.9)]]); })();
      const fishMat = reefMat(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.5, side: THREE.DoubleSide, iridescence: 0.4, iridescenceIOR: 1.35 }), { caustic: 0.15, wag: 0.09 });
      const schools = [
        { n: lowQ ? 8 : 14, col: [0xffd23a, 0xffe36a], r: [26, 3, 10], z: -26, y: 5, w: 0.05, sz: 0.9 },
        { n: lowQ ? 16 : 34, col: [0x4fb6ff, 0x8fe0ff], r: [34, 3, 12], z: -24, y: 14, w: -0.035, sz: 0.7 },
        { n: lowQ ? 8 : 16, col: [0xff7a3a, 0xffffff], r: [20, 2.5, 6], z: -10, y: 5, w: 0.07, sz: 0.8 },
        { n: lowQ ? 14 : 30, col: [0xc8d6ea, 0xa0b4d0], r: [42, 5, 14], z: -34, y: 18, w: 0.025, sz: 1.1 } ];
      const total = schools.reduce((a, s2) => a + s2.n, 0);
      const fish = new THREE.InstancedMesh(fishGeo, fishMat, total); fish.frustumCulled = false; g.add(fish);
      const fishData = []; const cc = new THREE.Color();
      schools.forEach((s2, si) => { for (let i = 0; i < s2.n; i++) { fishData.push({ s: s2, ph: R() * 6.28, lag: R() * 1.6, o: new THREE.Vector3((R() - 0.5) * 4.5, (R() - 0.5) * 2.2, (R() - 0.5) * 3.5), sc: s2.sz * (0.8 + R() * 0.4) }); fish.setColorAt(fishData.length - 1, cc.set(s2.col[R() < 0.7 ? 0 : 1])); } });
      fish.instanceColor.needsUpdate = true;

      // ---- light shafts from the surface
      const shaftMat = new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
        vertexShader: 'attribute float aPh; varying vec2 vUv; varying float vPh; void main(){ vUv = uv; vPh = aPh; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uT; varying vec2 vUv; varying float vPh; void main(){
          float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float fade = pow(max(vUv.y, 0.0), 1.6) * smoothstep(0.0, 0.25, vUv.y);
          float flick = 0.55 + 0.45 * sin(uT * 0.6 + vPh) * sin(uT * 0.37 + vPh * 2.0);
          float a = edge * fade * flick * 0.42; gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a, a); }` });
      const shafts = new THREE.Group();
      for (let i = 0; i < 9; i++) { const w = 2.5 + R() * 5, h = 60; const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2 - 8, 0); geo.setAttribute('aPh', new THREE.Float32BufferAttribute(new Array(4).fill(R() * 6.28), 1));
        const m = new THREE.Mesh(geo, shaftMat); m.position.set((R() - 0.5) * 70, 0, -(6 + R() * 34)); m.rotation.z = -0.28 + (R() - 0.5) * 0.12; m.renderOrder = 2; shafts.add(m); }
      g.add(shafts);

      // ---- drifting marine snow
      const SN = lowQ ? 250 : 700; const sp = new Float32Array(SN * 3), ss = new Float32Array(SN);
      for (let i = 0; i < SN; i++) { sp.set([(R() - 0.5) * 80, R() * 36, -(2 + R() * 40)], i * 3); ss[i] = 0.4 + R() * 0.8; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aS', new THREE.BufferAttribute(ss, 1));
      const snowMat = new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT, tex: { value: TEX.dot }, scale: { value: 400 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        vertexShader: `attribute float aS; uniform float uT, scale; varying float vA; void main(){ vec3 p = position; p.y = mod(p.y - uT * 0.18 * aS, 36.0); p.x += sin(uT * 0.3 + position.z) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = aS * 0.12 * scale / -mv.z; vA = 0.35 * smoothstep(0.0, 3.0, p.y) * smoothstep(36.0, 30.0, p.y); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: 'uniform sampler2D tex; varying float vA; void main(){ float a = texture2D(tex, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, a); }' });
      const snow = new THREE.Points(sg, snowMat); snow.frustumCulled = false; g.add(snow);

      // vertex colours above were authored in sRGB; convert once to linear so they shade correctly
      { const seen = new Set(); g.traverse(o => { const ca = o.geometry && o.geometry.attributes.color; if (!ca || seen.has(ca)) return; seen.add(ca); for (let i = 0; i < ca.array.length; i++) ca.array[i] = Math.pow(ca.array[i], 2.2); ca.needsUpdate = true; }); }
      const d = new THREE.Object3D(); d.rotation.order = 'YZX'; const pos = new THREE.Vector3(), vel = new THREE.Vector3();
      function update(t) {
        const path = (s2, tt, out) => out.set(Math.sin(s2.w * tt * 6.28 / 1.5) * s2.r[0], s2.y + Math.sin(s2.w * tt * 12.56 / 1.5) * s2.r[1], s2.z + Math.cos(s2.w * tt * 6.28 / 1.5) * s2.r[2]);
        fishData.forEach((f, i) => { const tt = t - f.lag; path(f.s, tt, pos); path(f.s, tt + 0.05, vel); vel.sub(pos);
          d.position.set(pos.x + f.o.x + Math.sin(t * 0.9 + f.ph) * 0.4, pos.y + f.o.y + Math.sin(t * 1.3 + f.ph) * 0.25, pos.z + f.o.z);
          d.rotation.set(0, Math.atan2(-vel.z, vel.x), Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) * 0.7); d.scale.setScalar(f.sc); d.updateMatrix(); fish.setMatrixAt(i, d.matrix); });
        fish.instanceMatrix.needsUpdate = true;
      }
      // seagrass meadows: thousands of thin swaying blades, cheap as one instanced mesh
      { const blade = new THREE.PlaneGeometry(0.09, 1, 1, 6); blade.translate(0, 0.5, 0); const P = blade.attributes.position;
        for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setX(i, P.getX(i) * (1 - y * 0.85) + y * y * 0.12); }
        blade.computeVertexNormals(); const C = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) { const y = P.getY(i); C.set([0.25 + y * 0.55, 0.55 + y * 0.4, 0.25 + y * 0.15], i * 3); }
        blade.setAttribute('color', new THREE.BufferAttribute(C, 3)); for (let i = 0; i < C.length; i++) C[i] = Math.pow(C[i], 2.2);
        const m = reefMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.2, emissive: 0x0c2a10, emissiveIntensity: 1 }), { caustic: 0.15, sway: 0.16 });
        const patches = []; for (let k = 0; k < 22; k++) { const [x, z] = spot(1, 26, 40); patches.push([x, z, 2 + R() * 3.5]); }
        const N = lowQ ? 900 : 2400;
        g.add(inst(blade, m, N, (d, i, c) => { const pt = patches[i % patches.length]; const a = R() * 6.28, r = Math.sqrt(R()) * pt[2]; const x = pt[0] + Math.cos(a) * r, z = pt[1] + Math.sin(a) * r * 0.7;
          d.position.set(x, onBed(x, z) - 0.05, z); d.rotation.y = R() * 6.28; d.scale.set(1 + R() * 0.6, 0.6 + R() * 1.1, 1); const k = 0.8 + R() * 0.4; return c.setRGB(k, k, k * 0.9); })); }

      // manta rays gliding far off
      const mantas = []; { const bodyM = reefMat(new THREE.MeshStandardMaterial({ color: 0x1d3f86, roughness: 0.5, envMapIntensity: 0.2 }), { caustic: 0.2 });
        const bellyM = new THREE.MeshStandardMaterial({ color: 0xcfe2f5, roughness: 0.6 });
        const wingGeo = new THREE.BufferGeometry(); wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.9, 2.6, 0, -0.2, 0, 0, -0.9, 0, 0.12, 0, 2.6, 0, -0.2, 0, 0, 0.9, 0, 0.12, 0, 0, 0, -0.9, 2.6, 0, -0.2], 3)); wingGeo.computeVertexNormals();
        for (let k = 0; k < 2; k++) { const grp = new THREE.Group(); const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12), bodyM); body.scale.set(1, 0.28, 1.3); grp.add(body);
          const belly = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bellyM); belly.scale.set(0.95, 0.22, 1.25); grp.add(belly);
          const wr = new THREE.Mesh(wingGeo, bodyM), wl = new THREE.Mesh(wingGeo, bodyM); wl.scale.x = -1; wr.position.x = 0.45; wl.position.x = -0.45; grp.add(wr, wl);
          const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 2.2, 5), bodyM); tail.rotation.x = Math.PI / 2; tail.position.z = -1.9; grp.add(tail);
          grp.scale.setScalar(k ? 1.6 : 2.1); g.add(grp); mantas.push({ grp, wr, wl, ph: k * 3.1, r: k ? 30 : 38, y: k ? 16 : 22, z: k ? -30 : -42, w: k ? 0.035 : 0.025 }); } }

      // glowing jellyfish drifting in the distance
      const jellies = []; { const bell = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        for (let k = 0; k < (lowQ ? 3 : 7); k++) { const col = [0xff7ad9, 0x8f7bff, 0x5fe0ff][k % 3];
          const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
          const grp = new THREE.Group(); const b = new THREE.Mesh(bell, mat); grp.add(b);
          for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 1.2, 4), mat); t.position.set(Math.cos(i * 1.26) * 0.25, -0.6, Math.sin(i * 1.26) * 0.25); grp.add(t); }
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); glow.scale.setScalar(3); grp.add(glow);
          grp.position.set((R() - 0.5) * 70, 6 + R() * 18, -(14 + R() * 26)); grp.scale.setScalar(0.8 + R() * 0.8); g.add(grp); jellies.push({ grp, b, ph: R() * 6.28, y0: grp.position.y }); } }

      // bubble vents: little columns of bubbles rising from the sand
      const VN = lowQ ? 60 : 160, vents = []; for (let k = 0; k < 5; k++) { const [x, z] = spot(4, 26, 40); vents.push([x, onBed(x, z), z]); }
      const vp = new Float32Array(VN * 3), vs = new Float32Array(VN); for (let i = 0; i < VN; i++) { const v = vents[i % vents.length]; vp.set([v[0] + (R() - 0.5) * 0.4, v[1] + R() * 22, v[2] + (R() - 0.5) * 0.4], i * 3); vs[i] = 0.6 + R() * 0.9; }
      const vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.BufferAttribute(vp, 3)); vg.setAttribute('aS', new THREE.BufferAttribute(vs, 1));
      const ventMat = new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT, tex: { value: TEX.bubble }, scale: snowMat.uniforms.scale }, transparent: true, depthWrite: false, toneMapped: false,
        vertexShader: `attribute float aS; uniform float uT, scale; varying float vA; void main(){ vec3 p = position; float base = p.y - mod(p.y, 22.0); float yy = mod(p.y + uT * 1.6 * aS, 22.0);
          p.y = base + yy; p.x += sin(uT * 3.0 * aS + position.z) * 0.12 * yy * 0.15; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = aS * 0.22 * scale / -mv.z; vA = smoothstep(22.0, 15.0, yy); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: 'uniform sampler2D tex; varying float vA; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85, 0.96, 1.0), t.a * vA * 0.8); }' });
      const ventPts = new THREE.Points(vg, ventMat); ventPts.frustumCulled = false; g.add(ventPts);

      const baseUpdate = update;
      function update2(t) { baseUpdate(t);
        for (const m of mantas) { const a = t * m.w * 6.28 + m.ph; const grp = m.grp; grp.position.set(Math.sin(a) * m.r, m.y + Math.sin(a * 2) * 2, m.z + Math.cos(a) * m.r * 0.35);
          grp.rotation.set(0.1, Math.atan2(Math.cos(a), -Math.sin(a) * 0.35), Math.sin(a) * 0.15); const f = Math.sin(t * 1.4 + m.ph) * 0.35; m.wr.rotation.z = f; m.wl.rotation.z = -f; }
        for (const j of jellies) { const p = (Math.sin(t * 1.6 + j.ph) + 1) / 2; j.b.scale.set(1 + p * 0.15, 1 - p * 0.25, 1 + p * 0.15); j.grp.position.y = j.y0 + Math.sin(t * 0.3 + j.ph) * 2; }
      }
      return { group: g, update: update2, snowMat };
    }
    return { build };
  })();

  // ---------------------------------------------------------------- post: bloom + grade
  class Post {
    constructor(renderer, mobile) {
      this.r = renderer; this.mobile = mobile; const gl2 = renderer.capabilities.isWebGL2;
      this.enabled = gl2; this.supported = gl2;
      if (!this.enabled) return;
      const fp = renderer.extensions.has('EXT_color_buffer_float');
      this.type = fp ? THREE.HalfFloatType : THREE.UnsignedByteType;
      this.levels = mobile ? 4 : 5;
      this.strength = 0.75;
      const opt = (extra) => Object.assign({ type: this.type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }, extra);
      this.main = new THREE.WebGLRenderTarget(1, 1, opt({ depthBuffer: true, samples: mobile ? 2 : 4 }));
      this.main.texture.colorSpace = THREE.LinearSRGBColorSpace;
      // three.js only applies tone mapping when drawing to the screen (or an XR target); flag this target so materials
      // still tone-map exactly as before, and we bloom/grade the finished image afterwards.
      this.main.isXRRenderTarget = true;
      this.down = []; this.up = [];
      for (let i = 0; i < this.levels; i++) { this.down.push(new THREE.WebGLRenderTarget(1, 1, opt())); this.up.push(new THREE.WebGLRenderTarget(1, 1, opt())); }
      this.raysRT = new THREE.WebGLRenderTarget(1, 1, opt()); this.rays = 0; this.raySamples = 32; this.lens = 0; // set per quality tier
      this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.scene.add(this.quad);
      const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
      const M = (u, fs) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false });
      this.brightMat = M({ tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.86 }, knee: { value: 0.2 } },
        `uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold, knee; varying vec2 vUv;
        vec3 safe(vec3 c){ return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : clamp(c, 0.0, 32.0); }
        vec3 pre(vec3 c){ c = safe(c); float br = dot(c, vec3(0.2126, 0.7152, 0.0722)); float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee); rq = rq * rq / (4.0 * knee + 1e-4);
          return c * max(rq, br - threshold) / max(br, 1e-4); }
        void main(){ vec3 c = pre(texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb) + pre(texture2D(tDiffuse, vUv + texel * vec2(1.0, -1.0)).rgb)
          + pre(texture2D(tDiffuse, vUv + texel * vec2(-1.0, 1.0)).rgb) + pre(texture2D(tDiffuse, vUv + texel * vec2(1.0, 1.0)).rgb);
          gl_FragColor = vec4(c * 0.25, 1.0); }`);
      this.downMat = M({ tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } },
        `uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb * 4.0; vec2 h = texel * 1.0;
          c += texture2D(tDiffuse, vUv + vec2(-h.x, -h.y)).rgb + texture2D(tDiffuse, vUv + vec2(h.x, -h.y)).rgb + texture2D(tDiffuse, vUv + vec2(-h.x, h.y)).rgb + texture2D(tDiffuse, vUv + vec2(h.x, h.y)).rgb;
          gl_FragColor = vec4(c / 8.0, 1.0); }`);
      this.upMat = M({ tDiffuse: { value: null }, tAdd: { value: null }, texel: { value: new THREE.Vector2() } },
        `uniform sampler2D tDiffuse, tAdd; uniform vec2 texel; varying vec2 vUv;
        void main(){ vec2 h = texel; vec3 c = vec3(0.0);
          c += texture2D(tDiffuse, vUv + vec2(-h.x * 2.0, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(h.x * 2.0, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, -h.y * 2.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, h.y * 2.0)).rgb;
          c += (texture2D(tDiffuse, vUv + vec2(-h.x, -h.y)).rgb + texture2D(tDiffuse, vUv + vec2(h.x, -h.y)).rgb + texture2D(tDiffuse, vUv + vec2(-h.x, h.y)).rgb + texture2D(tDiffuse, vUv + vec2(h.x, h.y)).rgb) * 2.0;
          gl_FragColor = vec4(c / 12.0 + texture2D(tAdd, vUv).rgb, 1.0); }`);
      // screen-space volumetric light ('god rays'): bright water-surface light near the top of the frame, smeared along rays from the sun
      this.raysMat = M({ tScene: { value: null }, sun: { value: new THREE.Vector2(0.42, 1.12) }, n: { value: 32 }, time: { value: 0 } },
        `uniform sampler2D tScene; uniform vec2 sun; uniform float n, time; varying vec2 vUv;
        float src(vec2 uv) { vec3 c = texture2D(tScene, uv).rgb; c = (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(32.0)); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return smoothstep(0.3, 0.95, l) * smoothstep(0.45, 0.9, uv.y) * (0.55 + 0.45 * c.b / max(l, 0.05) * 0.6); }
        void main(){ vec2 d = (vUv - sun) / n * 0.92; vec2 uv = vUv; float acc = 0.0, w = 1.0, tot = 0.0;
          float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453); uv -= d * j; // dither the march
          for (int i = 0; i < 64; i++) { if (float(i) >= n) break; uv -= d; acc += src(uv) * w; tot += w; w *= 0.965; }
          float a = acc / tot; float flick = 0.85 + 0.15 * sin(time * 0.6 + vUv.x * 9.0);
          gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a * flick, 1.0); }`);
      this.compMat = M({ tScene: { value: this.main.texture }, tBloom: { value: null }, tRays: { value: null }, strength: { value: this.strength }, rays: { value: 0 }, lens: { value: 0 }, aspect: { value: 1 }, time: { value: 0 }, night: { value: 0 }, vig: { value: 0 } },
        `uniform sampler2D tScene, tBloom, tRays; uniform float strength, rays, lens, aspect, time, night, vig; varying vec2 vUv;
        vec3 safe(vec3 c){ return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : clamp(c, 0.0, 32.0); }
        void main(){ vec3 c = safe(texture2D(tScene, vUv).rgb); vec3 b = safe(texture2D(tBloom, vUv).rgb);
          if (lens > 0.0) { vec2 dv = (vUv - 0.5) * lens * 0.0012 * dot(vUv - 0.5, vUv - 0.5) * 4.0; c.r = safe(texture2D(tScene, vUv + dv).rgb).r; c.b = safe(texture2D(tScene, vUv - dv).rgb).b; } // faint chromatic fringe at the edges
          // the intro's night grade: a moonlit split-tone (inky indigo shadows, teal mid-tones, silver highlights, a moon glow pouring in
          // from the surface) instead of a flat blue wash; real lights (pearl-lights, lamp, lightning) keep shining and bloom more
          if (night > 0.0) { vec3 hi = max(c - 1.0, 0.0); float ln = dot(c, vec3(0.2126, 0.7152, 0.0722));
            vec3 g = mix(vec3(0.003, 0.01, 0.045), vec3(0.025, 0.12, 0.23), smoothstep(0.0, 0.2, ln));
            g = mix(g, vec3(0.3, 0.5, 0.66), smoothstep(0.22, 1.1, ln));
            g = mix(g, c * vec3(0.45, 0.62, 1.0), 0.38);
            float red = max(c.r - 2.2 * max(c.g, c.b), 0.0); g += vec3(1.0, 0.16, 0.24) * red * 2.2;   // the red pearls glow warm against the cool night
            vec2 mo = (vUv - vec2(0.5, 1.1)) * vec2(aspect * 0.85, 1.35); g += vec3(0.1, 0.22, 0.34) * pow(max(0.0, 1.0 - length(mo)), 2.6);
            c = mix(c, g + hi * 3.0, night); b *= 1.0 + night * 1.9; }
          c += b * strength * 0.85;
          if (rays > 0.0) c += safe(texture2D(tRays, vUv).rgb) * rays;
          // gentle grade: a touch more contrast and saturation, cool shadows, warm highlights
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.2); /* the owner's reference look: vivid but clean */
          c = mix(c * vec3(0.94, 0.99, 1.06), c * vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.8, l));
          c = max(c, 0.0); vec3 cc = min(c, 1.0); c += (cc * cc * (3.0 - 2.0 * cc) - cc) * 0.55; /* softer filmic contrast (was 0.62) */
          // soft vignette
          vec2 d = vUv - 0.5; d.x *= aspect; float v = smoothstep(1.05, 0.3, length(d)); c *= mix(0.74 - 0.46 * night - 0.12 * vig, 1.0, v); c *= 1.0 + 0.05 * (1.0 - night);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; }`);
    }
    setSize(w, h) {
      if (!this.supported) return;
      this.main.setSize(w, h); this.compMat.uniforms.aspect.value = w / h;
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      for (let i = 0; i < this.levels; i++) { this.down[i].setSize(bw, bh); this.up[i].setSize(bw, bh); bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); }
      const rsh = this.mobile ? 3 : 2; this.raysRT.setSize(Math.max(1, w >> rsh), Math.max(1, h >> rsh));
    }
    pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
    render(scene, camera, t) {
      const r = this.r;
      if (!this.enabled || !this.main) { r.setRenderTarget(null); r.render(scene, camera); return; }
      r.setRenderTarget(this.main); r.render(scene, camera);
      const tx = (rt) => new THREE.Vector2(1 / rt.width, 1 / rt.height);
      this.brightMat.uniforms.tDiffuse.value = this.main.texture; this.brightMat.uniforms.texel.value.set(0.5 / this.main.width, 0.5 / this.main.height); this.pass(this.brightMat, this.down[0]);
      for (let i = 1; i < this.levels; i++) { const src = this.down[i - 1]; this.downMat.uniforms.tDiffuse.value = src.texture; this.downMat.uniforms.texel.value.set(1 / src.width, 1 / src.height); this.pass(this.downMat, this.down[i]); }
      let prev = this.down[this.levels - 1];
      for (let i = this.levels - 2; i >= 0; i--) { this.upMat.uniforms.tDiffuse.value = prev.texture; this.upMat.uniforms.tAdd.value = this.down[i].texture; this.upMat.uniforms.texel.value.set(0.5 / prev.width, 0.5 / prev.height); this.pass(this.upMat, this.up[i]); prev = this.up[i]; }
      if (this.rays > 0) { const R = this.raysMat.uniforms; R.tScene.value = this.main.texture; R.n.value = this.raySamples; R.time.value = t % 100; this.pass(this.raysMat, this.raysRT); }
      const C = this.compMat.uniforms; C.tRays.value = this.raysRT.texture; C.rays.value = this.rays; C.lens.value = this.lens;
      this.compMat.uniforms.tBloom.value = prev.texture; this.compMat.uniforms.strength.value = this.strength / this.levels * 2.2; this.compMat.uniforms.time.value = t % 100;
      this.pass(this.compMat, null);
    }
  }

  const PHOTO_BG_URI = window.AQ_DATA.PHOTO_BG_URI; const PHOTO_IMG = new Image(); PHOTO_IMG.src = PHOTO_BG_URI;
  // per-world paintings (optional: bg_photo_w2 / bg_photo_w3 in assets/images/background); a world without one uses the main painting
  const PHOTO_W = [PHOTO_IMG, ...[2, 3].map(w => { const u = window.AQ_DATA['PHOTO_BG_W' + w]; if (!u) return PHOTO_IMG; const im = new Image(); im.src = u; return im; })];
  const photoTexCache = new Map();
  function photoTex(im) { if (photoTexCache.has(im)) return photoTexCache.get(im); const tex = new THREE.Texture(im); if (im.complete && im.naturalWidth) tex.needsUpdate = true; else im.addEventListener('load', () => { tex.needsUpdate = true; }, { once: true });
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.minFilter = THREE.LinearMipmapLinearFilter; photoTexCache.set(im, tex); return tex; }
  const PHOTO_LEVELS = new Set(LEVELS.map(l => l.name)); // painted background on every level
  // which asset sheet dresses a level: 'new' (images/sheet2, the owner's new sheet) is on trial on the first 4 levels
  const NEW_ART_LEVELS = new Set(LEVELS.map(l => l.name)); // the new sheet / premium tank look on every level
  // per-world mood for the painted backdrop: sunlit shallows, violet coral caves, the dark deep
  const worldOf = (name) => { const i = LEVELS.findIndex(l => l.name === name); if (i < 0 && DAILY_WORLD.has(name)) return DAILY_WORLD.get(name); return i < 10 ? 0 : i < 20 ? 1 : 2; };
  const DAILY_WORLD = new Map(); // Daily Dive puzzles borrow a world's look (set by the controller)
  const WORLD_TINT = [0xffffff, 0xcdb2ff, 0x6a80c4], WORLD_FOG = [0, 0.12, 0.32];
  // per-world identity inside the tank: frame lacquer, water colour, and the deep's glowing specks
  const WORLD_STYLE = [{ trim: 0x18284f, lo: [0.0, 0.4, 0.8], hi: [0.1, 0.76, 1.0], glow: 0, crystals: 0 },
    { trim: 0x3b1c74, lo: [0.12, 0.2, 0.52], hi: [0.34, 0.62, 0.96], glow: 0.25, crystals: 0xb57cff },
    { trim: 0x0c2f3a, lo: [0.02, 0.15, 0.3], hi: [0.07, 0.47, 0.66], glow: 1, crystals: 0x4ff0d8 }];
  const ART_SETS = {
    old: { plinth: ['rocks', 'coralA', 'plant2', 'coralB', 'plant4', 'rocks', 'coralC', 'plantS', 'plant1', 'coralA', 'rocks', 'plant3', 'coralB'],
      ledge: ['plant1', 'plant2', 'plant3', 'plant4', 'plantS', 'coralA', 'coralC'], stars: ['star1', 'star2'], shells: ['shell1', 'shell2', 'shell3'], jelly: 'jelly', goal: 'goal', platform: 'platform' },
    new: { plinth: ['rockA', 'coral1', 'weed2', 'coral2', 'weed5', 'rockB', 'coral3', 'weed9', 'weed1', 'coral4', 'rockC', 'weed3', 'coral5', 'weed8'],
      ledge: ['weed1', 'weed2', 'weed3', 'weed4', 'weed5', 'weed6', 'weed7', 'weed8', 'weed9', 'coral1', 'coral3', 'coral5'], stars: ['starA', 'starB', 'starC', 'starD'], shells: ['shellA', 'shellB', 'shellC', 'shellD'], jelly: 'jellyN', goal: 'gateA', platform: 'platformN' } };
  const isRockSpr = (n) => n.startsWith('rock'), isPlantSpr = (n) => n.startsWith('plant') || n.startsWith('weed');
  // ---------------------------------------------------------------- the world
  // ---------------------------------------------------------------- story: the tunnel pipe between levels
  // Weathered metal pipe with brass rings and rivets, three glowing porthole lamps round the mouth (top, left, right), barnacles, moss,
  // coral and rocks at its foot (the owner's design sheet). Per world: teal (shallows), violet (caves), navy with cyan glow (the deep).
  const PIPE_TINT = [{ base: '#2f8f8b', dark: '#13504f', light: '#77d3c4', moss: 0x7c9a2e },
    { base: '#7354b4', dark: '#33236a', light: '#b597f0', moss: 0x8f6fc0 },
    { base: '#1e4c78', dark: '#0b2140', light: '#3d84b8', moss: 0x2c7a86, glow: '#62f4ff' }];
  function pipeTex(w) { TEX.pipe = TEX.pipe || []; if (TEX.pipe[w]) return TEX.pipe[w];
    const P = PIPE_TINT[w], [c, g] = canvas(1024, 512); let s = 11 + w * 977; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = P.base; g.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 2600; i++) { const x = rnd() * 1024, y = rnd() * 512, r = 3 + rnd() * 28; g.globalAlpha = 0.05 + rnd() * 0.13; g.fillStyle = rnd() < 0.55 ? P.dark : P.light; g.beginPath(); g.ellipse(x, y, r * 1.4, r, rnd() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 1100; i++) { const x = rnd() * 1024, y = rnd() * 512, r = 0.7 + rnd() * 3.2; g.globalAlpha = 0.3 + rnd() * 0.55; g.fillStyle = rnd() < 0.6 ? '#b0602a' : '#6a3a1c'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } // rust flecks
    for (let i = 0; i < 70; i++) { const x = rnd() * 1024, y = rnd() * 512; g.globalAlpha = 0.18 + rnd() * 0.2; g.fillStyle = '#8a4a20'; g.beginPath(); g.ellipse(x, y, 6 + rnd() * 18, 3 + rnd() * 8, rnd() * 3, 0, 7); g.fill(); } // rust patches
    g.globalAlpha = 0.6; g.strokeStyle = P.dark; g.lineWidth = 3; // riveted plates
    for (let x = 0; x <= 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    for (let y = 0; y <= 512; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    g.globalAlpha = 0.25; g.strokeStyle = P.light; g.lineWidth = 1.5; for (let x = 2; x <= 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    const rivet = (x, y, r) => { const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, 0.5, x, y, r); gr.addColorStop(0, '#f6e2a8'); gr.addColorStop(0.5, '#b08a4a'); gr.addColorStop(1, '#4a3418'); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    for (let x = 0; x <= 1024; x += 128) for (let y = 10; y < 512; y += 24) rivet(x + 7, y, 3.4);
    for (let y = 0; y <= 512; y += 128) for (let x = 12; x < 1024; x += 26) rivet(x, y + 7, 3);
    if (P.glow) for (let i = 0; i < 140; i++) { const x = rnd() * 1024, y = rnd() * 512, r = 1.5 + rnd() * 4; const gr = g.createRadialGradient(x, y, 0, x, y, r * 3); gr.addColorStop(0, P.glow); gr.addColorStop(1, 'rgba(98,244,255,0)'); g.globalAlpha = 0.5 + rnd() * 0.5; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return (TEX.pipe[w] = t); }
  // R = outer radius, L = length; the mouth is at z = 0 facing +z and the pipe runs back along -z. Lamps are exposed for pulsing.
  function makePipe(w = 0, R = 1, L = 6, base = true) { const P = PIPE_TINT[w], T = R * 0.13, g = new THREE.Group(), tx = pipeTex(w);
    const tO = tx.clone(); tO.repeat.set(3, L / (R * 2.2)); tO.needsUpdate = true; const tI = tx.clone(); tI.repeat.set(3, L / (R * 2.2)); tI.needsUpdate = true;
    const metal = new THREE.MeshStandardMaterial({ map: tO, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.9 });
    const inner = new THREE.MeshStandardMaterial({ map: tI, color: 0x9fb6b4, roughness: 0.8, metalness: 0.2, side: THREE.BackSide, envMapIntensity: 0.5 });
    const brass = MAT.pipeBrass || (MAT.pipeBrass = new THREE.MeshStandardMaterial({ color: 0xd8a03e, metalness: 0.85, roughness: 0.3, envMapIntensity: 1.2 }));
    const cyl = (r, m) => { const geo = new THREE.CylinderGeometry(r, r, L, 64, 1, true); geo.rotateX(Math.PI / 2); geo.translate(0, 0, -L / 2); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
    cyl(R, metal); cyl(R - T, inner);
    { const lip = new THREE.Mesh(new THREE.RingGeometry(R - T, R, 64), metal); g.add(lip); }
    const ring = (r, tube, z, m = brass) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 14, 80), m); t.position.z = z; t.castShadow = true; g.add(t); return t; };
    ring(R - T * 0.4, R * 0.085, R * 0.04); ring(R - T - R * 0.02, R * 0.03, -R * 0.02); // the chunky brass rim + a thin inner bead
    for (const z of [-L * 0.3, -L * 0.62]) ring(R + R * 0.01, R * 0.05, z);
    for (let k = 1; k * R * 0.8 < L; k++) ring(R - T, R * 0.035, -k * R * 0.8, inner); // ribs inside the tunnel
    { const riv = [], add = (x, y, z) => riv.push([x, y, z]);
      for (let i = 0; i < 30; i++) { const a = i / 30 * Math.PI * 2; add(Math.cos(a) * (R - T * 0.4), Math.sin(a) * (R - T * 0.4), R * 0.13); }
      for (const z of [-L * 0.3, -L * 0.62]) for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; add(Math.cos(a) * (R + R * 0.05), Math.sin(a) * (R + R * 0.05), z); }
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(R * 0.032, 8, 6), brass, riv.length), M4 = new THREE.Matrix4(); riv.forEach((p, i) => im.setMatrixAt(i, M4.makeTranslation(p[0], p[1], p[2]))); g.add(im); }
    const lamps = [];
    for (const a of [Math.PI / 2, Math.PI * 0.94, Math.PI * 0.06]) { const lp = new THREE.Group(); lp.position.set(Math.cos(a) * (R + R * 0.02), Math.sin(a) * (R + R * 0.02), R * 0.1); g.add(lp);
      const bez = new THREE.Mesh(new THREE.TorusGeometry(R * 0.15, R * 0.045, 12, 32), brass); lp.add(bez);
      const back = new THREE.Mesh(new THREE.CircleGeometry(R * 0.17, 24), brass); back.position.z = -R * 0.03; lp.add(back);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(R * 0.14, 24, 14), new THREE.MeshStandardMaterial({ color: 0xd8401c, emissive: 0xff2a06, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0 }));
      glass.scale.z = 0.55; lp.add(glass);
      const hot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc8a8 })); hot.position.set(-R * 0.03, R * 0.04, R * 0.06); lp.add(hot);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff6a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })); glow.scale.setScalar(R * 1.1); glow.position.z = R * 0.1; lp.add(glow);
      for (let i = 0; i < 8; i++) { const b = i / 8 * Math.PI * 2, rv = new THREE.Mesh(new THREE.SphereGeometry(R * 0.018, 6, 4), brass); rv.position.set(Math.cos(b) * R * 0.15, Math.sin(b) * R * 0.15, R * 0.04); lp.add(rv); }
      lamps.push({ glass, glow }); }
    for (const a of [Math.PI / 2, Math.PI * 0.8, Math.PI * 0.2]) { const lp = new THREE.Group(), rr = R - T - R * 0.02; lp.position.set(Math.cos(a) * rr, Math.sin(a) * rr, -R * 0.75); lp.lookAt(0, 0, -R * 0.75); g.add(lp); // lamps set into the tunnel wall
      const bez = new THREE.Mesh(new THREE.TorusGeometry(R * 0.1, R * 0.03, 10, 24), brass); lp.add(bez);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(R * 0.09, 18, 10), new THREE.MeshStandardMaterial({ color: 0xd8401c, emissive: 0xff2a06, emissiveIntensity: 0.55, roughness: 0.15 })); glass.scale.z = 0.5; lp.add(glass);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff6a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 })); glow.scale.setScalar(R * 0.8); glow.position.z = R * 0.08; lp.add(glow);
      lamps.push({ glass, glow }); }
    { // barnacles and moss on the upper body and round the rim
      let s = 5 + w; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), Pp = new V3(), up = new V3(0, 1, 0);
      const bar = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 1, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.95 }), 46);
      const moss = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: P.moss, roughness: 1 }), 90);
      for (let i = 0; i < 46; i++) { const a = Math.PI * (0.12 + rnd() * 0.76) + (rnd() < 0.3 ? Math.PI * 0.9 : 0), z = -rnd() * L * 0.75, n = new V3(Math.cos(a), Math.sin(a), 0);
        Pp.copy(n).multiplyScalar(R * 1.01).setZ(z); Q.setFromUnitVectors(up, n); const k = R * (0.035 + rnd() * 0.04); S.set(k, k, k); bar.setMatrixAt(i, M4.compose(Pp, Q, S)); }
      for (let i = 0; i < 90; i++) { const a = Math.PI * (0.18 + rnd() * 0.64), z = rnd() < 0.5 ? -rnd() * R * 0.5 : -rnd() * L * 0.8, n = new V3(Math.cos(a), Math.sin(a), 0);
        Pp.copy(n).multiplyScalar(R * 1.0).setZ(z); Q.setFromUnitVectors(up, n); const k = R * (0.05 + rnd() * 0.08); S.set(k * 1.4, k * 0.45, k * 1.2); moss.setMatrixAt(i, M4.compose(Pp, Q, S)); }
      bar.castShadow = moss.castShadow = true; g.add(bar, moss); }
    if (base) { // rocks round the foot of the mouth
      let s = 31 + w; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), Pp = new V3();
      const rk = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: w === 1 ? 0x6c5a8a : w === 2 ? 0x3a4a66 : 0x6f7480, roughness: 0.9, flatShading: true }), 16);
      for (let i = 0; i < 16; i++) { const side = i % 2 ? 1 : -1, x = side * (R * (0.7 + rnd() * 0.55)), z = R * (0.25 - rnd() * 0.9); Pp.set(x, -R * 0.82 + rnd() * R * 0.12, z); Q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); const k = R * (0.1 + rnd() * 0.17); S.set(k * 1.2, k * 0.8, k);
        rk.setMatrixAt(i, M4.compose(Pp, Q, S)); }
      rk.castShadow = rk.receiveShadow = true; g.add(rk); }
    g.userData.pipe = { R, L, lamps, mats: [metal, inner, tO, tI] }; return g; }
  function pipeTick(p, t) { const L = p.userData.pipe.lamps; L.forEach((l, i) => { const k = 0.82 + 0.18 * Math.sin(t * 2.2 + i * 2.1); l.glass.material.emissiveIntensity = 0.55 * k; l.glow.material.opacity = 0.5 * k + 0.1; }); }

  // the transition film: shot 1 inside the pipe swimming toward the light, shot 2 outside on the sand (the diver walks out, turns to
  // the next aquarium in the distance and waves), then it holds on that frame under the result card. Its own scene; World renders it
  // instead of the level while it runs.
  // ---------------------------------------------------------------- story cast + props (cutscenes only; built per film, freed after)
  // Everything faces +x like the diver. Animated parts are exposed in userData and moved by the cutscene recipes.
  const SM = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.55, metalness: 0 }, o));
  const SP = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }, o));
  function glowSpr(col, size, op = 0.6) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: op })); s.scale.setScalar(size); return s; }
  function canvasTex(w, h, draw, rep) { const [c, g] = canvas(w, h); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.anisotropy = 4; return t; }
  function shadowOf(m) { m.traverse(o => { if (o.isMesh) o.castShadow = true; }); return m; }
  // Pip: a little seahorse, a chain of shrinking beads that curls into a tail, a snout, big eyes, a fluttering back fin. glow 0..1
  function makePip(col = 0xffc23a, glow = 0.4) { const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const mat = SP({ color: col, emissive: col, emissiveIntensity: 0.06 + glow * 0.22, roughness: 0.35 }), belly = SP({ color: new THREE.Color(col).lerp(new THREE.Color(0xfff0c8), 0.45), emissive: col, emissiveIntensity: 0.04 + glow * 0.15 });
    const segs = []; const pts = [[0.02, 0.2, 0.085], [0.0, 0.13, 0.095], [-0.01, 0.06, 0.1], [0.0, -0.01, 0.092], [0.02, -0.07, 0.078], [0.03, -0.12, 0.064], [0.02, -0.165, 0.052], [-0.01, -0.2, 0.042], [-0.05, -0.22, 0.034], [-0.085, -0.205, 0.028], [-0.1, -0.17, 0.024], [-0.085, -0.14, 0.02]];
    let parent = body; pts.forEach(([x, y, r], i) => { const piv = new THREE.Group(); piv.position.set(x - (i ? pts[i - 1][0] : 0), y - (i ? pts[i - 1][1] : 0), 0); parent.add(piv); const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), i > 0 && i < 5 ? belly : mat); m.scale.set(1, 1, 0.82); piv.add(m); segs.push(piv); parent = piv; });
    const head = new THREE.Group(); head.position.set(0.04, 0.3, 0); body.add(head);
    { const h = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), mat); h.scale.set(1.05, 0.95, 0.85); head.add(h);
      const sn = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.12, 12), mat); sn.rotation.z = -Math.PI / 2 + 0.25; sn.position.set(0.1, -0.03, 0); head.add(sn);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mat); tip.position.set(0.16, -0.045, 0); head.add(tip); head.userData.mouth = talkMouth(head, 0.188, -0.05, 0, 0.024, 0.02);
      for (const z of [-1, 1]) { const e = cartoonEye(0.045, [0.4, 0]); e.position.set(0.03, 0.02, z * 0.062); e.rotation.y = z * 0.5; head.add(e); }
      for (let i = 0; i < 4; i++) { const cr = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 6), mat); cr.position.set(-0.04 - i * 0.025, 0.075 - i * 0.012, 0); cr.rotation.z = 0.5 + i * 0.25; head.add(cr); } }
    const fin = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16, -0.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xfff1b8, emissive: col, emissiveIntensity: 0.5, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); fin.position.set(-0.07, 0.07, 0); fin.rotation.y = Math.PI / 2; body.add(fin);
    const halo = glowSpr(col, 0.8, 0.08 + glow * 0.22); halo.position.set(0, 0.05, 0); g.add(halo);
    g.userData = { body, head, segs, fin, halo, mat, mouth: head.userData.mouth, setGlow(k) { mat.emissiveIntensity = 0.06 + k * 0.22; halo.material.opacity = 0.08 + k * 0.22; },
      tick(t) { body.position.y = Math.sin(t * 2.4) * 0.03; segs.forEach((s, i) => { if (i > 5) s.rotation.z = Math.sin(t * 2 + i * 0.6) * 0.12; }); fin.scale.x = 0.8 + Math.sin(t * 22) * 0.2; head.rotation.z = Math.sin(t * 1.3) * 0.08; } };
    return shadowOf(g); }
  // Shelly: a big friendly sea turtle (shell with painted plates, four paddling flippers, a sleepy smile)
  function makeTurtle(glowSpots = false) { const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    const shellT = canvasTex(512, 256, (x, W, H) => { x.fillStyle = '#4f7a3a'; x.fillRect(0, 0, W, H); x.lineWidth = 7; x.strokeStyle = '#2f4a22';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) { const cx = c * 60 + (r % 2) * 30, cy = 20 + r * 62; x.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; x.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); } x.closePath();
        const gr = x.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, 32); gr.addColorStop(0, '#8fbf5a'); gr.addColorStop(1, '#4a7334'); x.fillStyle = gr; x.fill(); x.stroke(); } }, true);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), SP({ map: shellT, roughness: 0.45 })); shell.scale.set(1.15, 0.55, 0.92); b.add(shell);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 8, 40), SM({ color: 0x6f5a2a })); rim.rotation.x = Math.PI / 2; rim.scale.set(1.15, 0.92, 1); b.add(rim);
    const belly = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), SM({ color: 0xe9d99a })); belly.rotation.x = Math.PI / 2; belly.scale.set(1.12, 0.9, 1); belly.position.y = -0.01; b.add(belly);
    const skin = SP({ color: 0x8fc07a, roughness: 0.5 }); if (glowSpots) { skin.emissive = new THREE.Color(0x30ffd0); skin.emissiveIntensity = 0.25; }
    const head = new THREE.Group(); head.position.set(0.92, 0.08, 0); b.add(head);
    { const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 6, 12), skin); neck.rotation.z = Math.PI / 2; neck.position.x = -0.12; head.add(neck);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), skin); h.scale.set(1.15, 0.9, 0.95); h.position.x = 0.08; head.add(h);
      for (const z of [-1, 1]) { const e = cartoonEye(0.06, [0.5, 0]); e.position.set(0.2, 0.07, z * 0.12); e.rotation.y = z * 0.6; head.add(e); }
      const sm = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), MAT.monPupil); sm.rotation.set(Math.PI / 2, 0, Math.PI); sm.position.set(0.27, -0.04, 0); head.add(sm); head.userData.mouth = talkMouth(head, 0.265, -0.05, 0, 0.075, 0.045); }
    const flip = []; for (const [x, z, s] of [[0.45, 0.62, 1], [0.45, -0.62, 1], [-0.55, 0.5, 0.7], [-0.55, -0.5, 0.7]]) { const p = new THREE.Group(); p.position.set(x, 0, z); b.add(p);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10), skin); f.scale.set(0.9 * s, 0.09, 0.42 * s); f.position.set(0.05, 0, Math.sign(z) * 0.22 * s); f.rotation.y = Math.sign(z) * (x > 0 ? -0.5 : 0.4); p.add(f); flip.push(p); }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 8), skin); tail.rotation.z = Math.PI / 2; tail.position.set(-0.85, 0, 0); b.add(tail);
    if (glowSpots) for (let i = 0; i < 14; i++) { const a = i * 2.4, d = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7ffff0 })); const n = new V3(Math.cos(a) * 0.8, 0.45 + (i % 3) * 0.15, Math.sin(a) * 0.8).normalize(); d.position.set(n.x * 0.8, n.y * 0.385, n.z * 0.64); b.add(d); }
    g.userData = { b, head, flip, mouth: head.userData.mouth, tick(t, k = 1) { flip.forEach((p, i) => { p.rotation.x = Math.sin(t * 2.2 * k + (i % 2) * Math.PI + (i > 1 ? 1 : 0)) * 0.45 * (i % 2 ? -1 : 1); }); head.rotation.z = Math.sin(t * 0.9) * 0.08; b.position.y = Math.sin(t * 1.6) * 0.05; } };
    return shadowOf(g); }
  // a manta ray: two wings that flap, cephalic lobes, a thin tail; dark top, pale belly
  function makeManta() { const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    const top = SP({ color: 0x24406e, roughness: 0.45 }), bot = SM({ color: 0x9fb4d8 });
    const wing = (side) => { const sh = new THREE.Shape(); sh.moveTo(0.7, 0); sh.quadraticCurveTo(0.35, 0.5 * side, -0.1, 1.6 * side); sh.quadraticCurveTo(-0.3, 0.6 * side, -0.75, 0.05 * side); sh.lineTo(0.7, 0);
      const geo = new THREE.ShapeGeometry(sh, 24); geo.rotateX(Math.PI / 2); const p = new THREE.Group(); const m1 = new THREE.Mesh(geo, top); m1.position.y = 0.012; const m2 = new THREE.Mesh(geo, bot); m2.position.y = -0.012; m2.material.side = THREE.DoubleSide; m1.material.side = THREE.DoubleSide; p.add(m1, m2); return p; };
    const wl = wing(1), wr = wing(-1); b.add(wl, wr);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12), top); body.scale.set(1.6, 0.32, 0.9); b.add(body);
    for (const z of [-1, 1]) { const lobe = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 8), top); lobe.rotation.set(Math.PI / 2, 0, -0.3 * z); lobe.position.set(0.72, -0.02, z * 0.2); b.add(lobe); const e = cartoonEye(0.05, [0.5, 0]); e.position.set(0.6, 0.06, z * 0.26); e.rotation.y = z * 0.9; b.add(e); }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.7, 6), top); tail.rotation.z = Math.PI / 2; tail.position.set(-1.0, 0, 0); b.add(tail);
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.CircleGeometry(0.05 + (i % 2) * 0.02, 10), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6 })); sp.rotation.x = -Math.PI / 2; sp.position.set(-0.2 + (i % 3) * 0.2, 0.15, (i < 3 ? 1 : -1) * (0.45 + (i % 2) * 0.15)); b.add(sp); }
    g.userData = { b, wl, wr, tick(t, k = 1) { const a = Math.sin(t * 2.1 * k) * 0.38; wl.rotation.x = a; wr.rotation.x = -a; b.position.y = -Math.sin(t * 2.1 * k) * 0.06; } };
    return shadowOf(g); }
  // a whale for the sky of the deep: long body, lighter belly, tail flukes, a gentle eye
  function makeWhale() { const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    const geo = new THREE.SphereGeometry(1, 40, 24); geo.scale(4.4, 1.25, 1.4); const P = geo.attributes.position, col = []; for (let i = 0; i < P.count; i++) { const y = P.getY(i), x = P.getX(i); const k = y < -0.25 ? 1 : 0; col.push(...(k ? [0.75, 0.82, 0.92] : [0.2, 0.3, 0.48])); if (x < -2) P.setY(i, y * (0.6 + 0.4 * (x + 4.4) / 2.4)); } geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, SP({ vertexColors: true, roughness: 0.6 })); b.add(body);
    for (let i = 0; i < 7; i++) { const gr = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.02, 4, 24, 1.2), SM({ color: 0x9fb2cc })); gr.rotation.set(0, Math.PI / 2, -0.6); gr.position.set(1.6 - i * 0.35, -0.55, 0); gr.scale.set(1, 0.5, 1); b.add(gr); }
    const tail = new THREE.Group(); tail.position.set(-4.3, 0, 0); b.add(tail);
    for (const z of [-1, 1]) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8), SP({ color: 0x2a3a58 })); f.scale.set(0.5, 0.08, 1); f.position.set(-0.3, 0, z * 0.75); f.rotation.y = z * 0.5; tail.add(f); }
    for (const z of [-1, 1]) { const fin = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), SP({ color: 0x2a3a58 })); fin.scale.set(0.6, 0.08, 0.25); fin.position.set(1.4, -0.7, z * 1.25); fin.rotation.set(z * 0.6, 0, -0.5); b.add(fin);
      const e = cartoonEye(0.16, [0.4, 0]); e.position.set(3.1, -0.15, z * 0.95); e.rotation.y = z * 1.1; b.add(e); }
    g.userData = { b, tail, tick(t) { tail.rotation.z = Math.sin(t * 1.1) * 0.25; b.rotation.z = Math.sin(t * 1.1 + 1) * 0.03; } };
    return g; }
  // Murk: a big shy octopus. sad 0..1 droops the eyes; tentacles curl on their own
  function makeOctopus(col = 0x8a4fd8) { const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    const skin = SP({ color: col, roughness: 0.4, sheen: 0.7, sheenColor: 0xffb8f0, emissive: col, emissiveIntensity: 0.05 }), spot = SM({ color: new THREE.Color(col).lerp(new THREE.Color(0xffc0f0), 0.5) });
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), skin); head.scale.set(1, 1.15, 0.95); head.position.y = 1.15; b.add(head);
    for (let i = 0; i < 12; i++) { const a = i * 2.1, n = new V3(Math.cos(a) * 0.7, 0.4 + (i % 4) * 0.15, Math.sin(a) * 0.7).normalize(); const s = new THREE.Mesh(new THREE.SphereGeometry(0.07 + (i % 3) * 0.03, 10, 8), spot); s.position.set(n.x, n.y * 1.15 + 1.15, n.z * 0.95); s.scale.set(1, 1, 0.4); s.lookAt(s.position.clone().multiplyScalar(2)); b.add(s); }
    const eyes = []; for (const z of [-1, 1]) { const eg = new THREE.Group(); eg.position.set(0.72, 1.0, z * 0.42); eg.rotation.y = z * 0.7; b.add(eg); const e = cartoonEye(0.26, [0.3, 0]); eg.add(e);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), skin); lid.position.z = 0.02; eg.add(lid); eyes.push({ eg, lid }); }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16, Math.PI), MAT.monPupil); mouth.position.set(0.98, 0.62, 0); mouth.rotation.set(0, Math.PI / 2, 0); b.add(mouth); const mOpen = talkMouth(b, 0.97, 0.55, 0, 0.15, 0.09);
    const tents = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2, piv = new THREE.Group(); piv.position.set(Math.cos(a) * 0.55, 0.35, Math.sin(a) * 0.55); piv.rotation.y = -a; b.add(piv);
      const pts = []; for (let k = 0; k <= 10; k++) { const f = k / 10; pts.push(new V3(f * 1.7, -f * 0.3 + Math.sin(f * 3) * 0.12, Math.sin(f * 4 + i) * 0.12)); }
      const curve = new THREE.CatmullRomCurve3(pts), geo = new THREE.TubeGeometry(curve, 24, 0.13, 10); const P = geo.attributes.position; // taper toward the tip
      for (let v = 0; v < P.count; v++) { const seg = Math.floor(v / 11) / 24; const cx = curve.getPoint(Math.min(1, seg)); const p = new V3(P.getX(v), P.getY(v), P.getZ(v)); p.sub(cx).multiplyScalar(1 - seg * 0.8).add(cx); P.setXYZ(v, p.x, p.y, p.z); }
      geo.computeVertexNormals(); const tm = new THREE.Mesh(geo, skin); piv.add(tm); tents.push(piv); }
    g.userData = { b, eyes, mouth: mOpen, smile: mouth, tents, glow: null, setSad(k) { eyes.forEach(E => { E.lid.rotation.x = -0.2 - k * 0.9; E.lid.visible = k > 0.02; }); mouth.rotation.z = k > 0.5 ? 0 : Math.PI; mouth.position.y = k > 0.5 ? 0.55 : 0.62; },
      tick(t, k = 1) { tents.forEach((p, i) => { p.rotation.z = Math.sin(t * 1.3 * k + i * 0.8) * 0.22 - 0.1; p.rotation.x = Math.cos(t * 1.1 * k + i) * 0.12; }); b.position.y = Math.sin(t * 1.2) * 0.08; } };
    g.userData.setSad(0); return shadowOf(g); }
  // a giant clam with a glowing pearl; open 0..1
  function makeClam(col = 0xc59ae8) { const g = new THREE.Group(); const ridge = canvasTex(256, 64, (x, W, H) => { const gr = x.createLinearGradient(0, 0, W, 0); for (let i = 0; i <= 12; i++) gr.addColorStop(i / 12, i % 2 ? '#ffffff' : '#c9b8e6'); x.fillStyle = gr; x.fillRect(0, 0, W, H); });
    const m = SP({ color: col, map: ridge, roughness: 0.35 }), inner = SP({ color: 0xffe8f4, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.3 });
    const half = (up) => { const p = new THREE.Group(); const s = new THREE.Mesh(new THREE.SphereGeometry(0.55, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), m); s.scale.set(1, 0.42, 0.85); if (!up) s.rotation.x = Math.PI; s.position.x = 0.5; p.add(s);
      const n = new THREE.Mesh(new THREE.CircleGeometry(0.53, 28), inner); n.rotation.x = up ? Math.PI / 2 : -Math.PI / 2; n.scale.set(1, 0.85, 1); n.position.set(0.5, up ? -0.005 : 0.005, 0); p.add(n); return p; };
    const lo = half(false), hi = half(true); lo.position.x = -0.5; hi.position.x = -0.5; g.add(lo, hi); lo.position.y = 0.2; hi.position.y = 0.2;
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), SP({ color: 0xfff6ff, emissive: 0xffd6f6, emissiveIntensity: 0.6, roughness: 0.1, iridescence: 1 })); pearl.position.set(0.05, 0.32, 0); g.add(pearl); const pg = glowSpr(0xffd0f0, 0.9, 0.0); pg.position.copy(pearl.position); g.add(pg);
    g.userData = { hi, pearl, pg, setOpen(k) { hi.rotation.z = -k * 0.85; pg.material.opacity = k * 0.6; } }; g.userData.setOpen(0); return shadowOf(g); }
  // a treasure chest with a lid that opens and light that pours out
  function makeChest() { const g = new THREE.Group(); const wood = canvasTex(256, 128, (x, W, H) => { x.fillStyle = '#7a4a24'; x.fillRect(0, 0, W, H); for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? '#6a3e1c' : '#86542a'; x.fillRect(0, i * 15, W, 14); } x.strokeStyle = 'rgba(40,20,8,0.5)'; for (let i = 0; i < 40; i++) { x.beginPath(); const y = Math.random() * H; x.moveTo(0, y); x.bezierCurveTo(W / 3, y + 4, W * 2 / 3, y - 4, W, y); x.stroke(); } });
    const wm = SM({ map: wood, roughness: 0.8 }), gold = SM({ color: 0xe0a83a, metalness: 0.85, roughness: 0.3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.55), wm); box.position.y = 0.225; g.add(box);
    for (const x of [-0.3, 0.3]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.47, 0.57), gold); band.position.set(x, 0.225, 0); g.add(band); }
    const lidP = new THREE.Group(); lidP.position.set(-0.4, 0.45, 0); g.add(lidP); const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.8, 20, 1, false, 0, Math.PI), wm); lid.rotation.set(Math.PI / 2, 0, Math.PI / 2); lid.rotation.order = 'ZYX'; lid.position.x = 0.4; lid.scale.set(1, 1, 0.6); lidP.add(lid);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.04), gold); lock.position.set(0, 0.42, 0.29); g.add(lock);
    const light = glowSpr(0xffe08a, 1.6, 0); light.position.y = 0.6; g.add(light); const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 1.2; beam.rotation.x = Math.PI; g.add(beam);
    g.userData = { lidP, setOpen(k) { lidP.rotation.z = k * 1.9; light.material.opacity = k * 0.8; beam.material.opacity = k * 0.22; } }; return shadowOf(g); }
  // the map of the thirty gates (a glowing shell-paper scroll the diver holds up)
  function makeMap(lit = 6) { const t = canvasTex(256, 160, (x, W, H) => { x.fillStyle = '#f3e3b8'; x.fillRect(0, 0, W, H); x.strokeStyle = '#b88a4a'; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
      x.strokeStyle = '#8a6030'; x.lineWidth = 3; x.setLineDash([6, 6]); x.beginPath(); const P = []; for (let i = 0; i < 30; i++) { const u = i / 29; P.push([20 + u * (W - 40), H / 2 + Math.sin(u * 9) * 40]); } P.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.stroke(); x.setLineDash([]);
      P.forEach(([px, py], i) => { x.fillStyle = i < lit ? '#ff4a3a' : '#6a5a48'; x.beginPath(); x.arc(px, py, i < lit ? 5 : 3.5, 0, 7); x.fill(); }); x.fillStyle = '#4a3a2a'; x.font = 'bold 18px sans-serif'; x.fillText('★', P[29][0] - 6, P[29][1] - 10); });
    const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, emissive: 0xffe0a0, emissiveMap: t, emissiveIntensity: 0.35 })); g.add(m);
    for (const x of [-0.26, 0.26]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 10), SM({ color: 0xc89a5a })); r.position.x = x; g.add(r); }
    const gl = glowSpr(0xffe6a0, 0.9, 0.35); gl.position.z = -0.05; g.add(gl); return g; }
  function makeCrystals(col, n = 7, size = 1, seed = 3) { const g = new THREE.Group(); let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const mat = SP({ color: col, emissive: col, emissiveIntensity: 0.0, roughness: 0.15, transparent: true, opacity: 0.9 }); const shards = [];
    for (let i = 0; i < n; i++) { const geo = new THREE.OctahedronGeometry(0.22 * size * (0.6 + r() * 0.8), 0); geo.scale(0.5, 1.8, 0.5); const m = new THREE.Mesh(geo, mat); m.position.set((r() - 0.5) * 0.7 * size, 0.25 * size, (r() - 0.5) * 0.5 * size); m.rotation.set((r() - 0.5) * 0.7, r() * 3, (r() - 0.5) * 0.7); g.add(m); shards.push(m); }
    const gl = glowSpr(col, 2.2 * size, 0); gl.position.y = 0.4 * size; g.add(gl); g.userData = { mat, gl, setLit(k) { mat.emissiveIntensity = k * 1.6; gl.material.opacity = k * 0.55; } }; return shadowOf(g); }
  // ruins of the sea city: fluted columns, some broken, a light ring on each that can wake
  function makeColumn(h = 3, broken = false) { const g = new THREE.Group(), stone = SM({ map: TEX.rockCol || null, color: 0x7a8aa8, roughness: 0.9 });
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, h, 16), stone); sh.position.y = h / 2; g.add(sh);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.8), stone); base.position.y = 0.11; g.add(base);
    if (!broken) { const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.8), stone); cap.position.y = h + 0.1; g.add(cap); } else { const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 7), stone); tip.position.y = h + 0.15; tip.rotation.z = 0.4; g.add(tip); }
    const ringM = new THREE.MeshBasicMaterial({ color: 0x2a3a5a }); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.04, 8, 24), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = h * 0.62; g.add(ring);
    const gl = glowSpr(0x5ff0ff, 1.5, 0); gl.position.y = h * 0.62; g.add(gl);
    g.userData = { setLit(k) { ringM.color.setRGB(0.16 + k * 0.4, 0.23 + k * 0.72, 0.35 + k * 0.65); gl.material.opacity = k * 0.5; } }; return shadowOf(g); }
  // the coral arch: a stone arc crusted with coral, lamps along it that light one by one
  function makeArch(lamps = 9) { const g = new THREE.Group(); const rock = SM({ color: 0x9a6a5a, roughness: 0.9 });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.42, 14, 40, Math.PI), rock); arc.scale.set(1, 1.05, 0.8); g.add(arc);
    for (const x of [-2.4, 2.4]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.6, 12), rock); leg.position.set(x, -0.1, 0); g.add(leg); }
    const L = []; for (let i = 0; i < lamps; i++) { const a = Math.PI * (0.08 + 0.84 * i / (lamps - 1)), m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0x3a2a2a })); m.position.set(Math.cos(a) * 2.4, Math.sin(a) * 2.5, 0.38); g.add(m); const gl = glowSpr(0xffb060, 0.9, 0); gl.position.copy(m.position); g.add(gl); L.push({ m, gl }); }
    g.userData = { L, setLit(k) { L.forEach((l, i) => { const on = Math.min(1, Math.max(0, k * L.length - i)); l.m.material.color.setRGB(0.23 + on * 0.77, 0.16 + on * 0.6, 0.16 + on * 0.25); l.gl.material.opacity = on * 0.75; }); } }; return shadowOf(g); }
  // an old wreck lying on the sand: a split hull of planks, ribs showing, a broken mast
  function makeWreck() { const g = new THREE.Group(); const planks = canvasTex(256, 256, (x, W, H) => { for (let i = 0; i < 16; i++) { x.fillStyle = ['#6b4a2e', '#5a3c24', '#7a5634', '#4e3420'][i % 4]; x.fillRect(0, i * 16, W, 15); } x.fillStyle = 'rgba(60,110,70,0.35)'; for (let i = 0; i < 300; i++) x.fillRect(Math.random() * W, Math.random() * H, 3, 3); }, true);
    planks.repeat.set(3, 1); const wood = SM({ map: planks, roughness: 0.9, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 24, 1, true, Math.PI * 0.55, Math.PI * 1.1), wood); hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.8); hull.position.y = 0.6; g.add(hull);
    for (let i = 0; i < 6; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.06, 6, 20, Math.PI * 0.9), SM({ color: 0x4a3220 })); rib.rotation.set(0, Math.PI / 2, Math.PI * 1.05); rib.position.set(-2.5 + i, 0.6, 0); rib.scale.set(0.8, 1, 1); g.add(rib); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 4.5, 10), wood); mast.position.set(0.6, 1.9, -0.4); mast.rotation.z = -0.55; g.add(mast);
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), wood); spar.position.set(1.4, 2.9, -0.4); spar.rotation.z = 0.9; g.add(spar);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.4, 20, 1, true, Math.PI * 0.55, Math.PI * 1.1), wood); bow.rotation.z = -Math.PI / 2; bow.scale.set(1, 1, 0.8); bow.position.set(4.2, 0.6, 0); g.add(bow);
    g.rotation.z = 0.08; g.rotation.x = -0.12; return shadowOf(g); }
  // the Great Lantern: a tall coral tower with a spiral of 30 lights (one per gate) and a lens on top
  function makeTower(lit = 0, heart = 0) { const g = new THREE.Group(); const stone = SM({ map: TEX.rockCol || null, color: 0x8a7a9a, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.8, 12, 24, 6), stone); body.position.y = 6; g.add(body);
    for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(1.75 - i * 0.18, 0.12, 8, 30), SM({ color: 0xc9a25a, metalness: 0.6, roughness: 0.35 })); r.rotation.x = Math.PI / 2; r.position.y = 1 + i * 2.4; g.add(r); }
    const L = []; for (let i = 0; i < 30; i++) { const u = i / 29, y = 0.8 + u * 10.5, rad = 1.8 - u * 0.85 + 0.08, a = u * Math.PI * 6; const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: i < lit ? 0xff5a3a : 0x2a2a3a })); m.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad); g.add(m);
      if (i < lit) { const gl = glowSpr(0xff7a4a, 0.8, 0.6); gl.position.copy(m.position); g.add(gl); } L.push(m); }
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), SP({ color: 0xbfefff, transparent: true, opacity: 0.85, roughness: 0.05, emissive: 0xfff0c0, emissiveIntensity: heart * 2 })); lens.position.y = 12.7; g.add(lens);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 16), SM({ color: 0xc9a25a, metalness: 0.6, roughness: 0.35 })); cap.position.y = 13.9; g.add(cap);
    const big = glowSpr(0xfff0b0, 9, heart * 0.8); big.position.y = 12.7; g.add(big); g.userData = { lens, big }; return shadowOf(g); }
  // Lumen: an anglerfish (the piranha model, bigger and darker) with a glowing lure
  function makeAngler() { const g = makeFish(); g.traverse(o => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.45); } }); g.scale.setScalar(1.8);
    const pts = [new V3(0.05, 0.25, 0), new V3(0.15, 0.48, 0), new V3(0.35, 0.52, 0), new V3(0.47, 0.38, 0)]; const stalk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 6), SM({ color: 0x2a2a44 })); g.add(stalk);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshBasicMaterial({ color: 0xdffcff })); bulb.position.copy(pts[3]); g.add(bulb); const gl = glowSpr(0x7ff6ff, 1.0, 0.8); bulb.add(gl);
    const pl = new THREE.PointLight(0x7ff6ff, 3, 6, 1.5); bulb.add(pl); g.userData.bulb = bulb; g.userData.lureGlow = gl; return g; }
  // ---------------------------------------------------------------- the story: one chapter after every level (1–29), each its own cutscene
  // A chapter = title, two caption lines (seconds, text), a recipe (setting + cast + action + cameras) and how the diver arrives in the
  // next tank. The film holds on its last frame under the result card. Pip the seahorse glows a little more every chapter.
  const CHAPTERS = [null,
    {"t": "Through the Old Pipe", "r": "pipe", "a": "pipe", "L": [["", "The first gate wakes, and its light shoots down an old pipe. With you in it."], ["pip", "AAAH! A light! A real light! Are you a light? Are you a fish? Are you a light-fish?", "hop"], ["pip", "I'm Pip! And you're a spark. That's your name now. Spark. No take-backs.", "spin"], ["", "Far away, in the dark, something very big opens one red eye."]], "Q": {"at": 2, "kind": "choice", "label": "Who are you?", "opts": [["brave", "I'm here to turn the lights back on.", [["you", "I'm the one who's going to turn the lights back on."], ["pip", "Ooh. Cool. Can I come? I'm very brave. Mostly in my head.", "hop"]]], ["funny", "A lost tourist. Gift shop?", [["you", "Just a very lost tourist. Is there a gift shop?"], ["pip", "Ha! A funny one! The reef has been SO not funny lately.", "laugh"]]], ["kind", "A friend. You okay?", [["you", "A friend. Are you okay, little guy?"], ["pip", "Nobody's asked me that since the storm. I'm… better now.", "nod"]]]]}},
    {"t": "Pip’s Glow", "r": "kelp", "a": "swirl", "L": [["pip", "Real talk, Spark. I used to GLOW. People called me Pip the Bright.", "spin"], ["you", "Who called you that?"], ["pip", "…Me. I called me that. But then the storm came, and it had EYES. Red ones. And it ate every light in the reef.", "shake"], ["pip", "But when your gate woke up, I sparkled! Just a teeny bit! Do it again! Do it again!", "hop"]]},
    {"t": "Shelly’s Tale", "r": "turtle", "a": "drop", "L": [["shelly", "Red eyes? Hmph. Two hundred years I have lived, and I have seen red eyes once."], ["shelly", "Grimtide. An eel as long as a shipwreck, with an ego twice that size. He drinks light."], ["pip", "Drinks it? Like a smoothie?", "shake"], ["shelly", "Like a smoothie. The Keeper built thirty gates to stop him. You woke one, so now he knows about you. Hop on.", "nod"], ["pip", "I'm not scared. My fins are just cold.", "shake"]]},
    {"t": "Captain Clack", "r": "crabs", "a": "bubble", "L": [["clack", "HALT! In the name of the Crack Crab Crew! State your name, rank, and favourite snack!", "salute"], ["clack", "We rescued these pearls from the sand. Grimtide’s tail took the rest. Thick as a mast! Thicker! Two masts!", "shake"], ["clack", "The Crack Crab Crew sails with you! Pip, you're promoted to Deputy Assistant Vice Captain.", "salute"], ["pip", "I've been here five seconds."], ["clack", "And already a natural!", "laugh"]], "Q": {"at": 1, "kind": "choice", "label": "Name, rank, snack?", "opts": [["brave", "Spark. Snacks later, heroics now.", [["you", "Spark. Gate-waker. Snacks later, heroics now."], ["clack", "HA! A diver with priorities! I like you already!", "salute"]]], ["funny", "Spark. Seaweed chips.", [["you", "Spark. Professional tourist. Seaweed chips, extra salty."], ["clack", "Seaweed chips! A diver of TASTE! Crew, this one is one of us!", "laugh"]]], ["kind", "The famous captain, I presume?", [["you", "Spark. And you must be the famous captain everyone talks about."], ["clack", "Famous? Me? Well. Yes. Obviously. Crew, did you HEAR that?", "hop"]]]]}},
    {"t": "Jelly Bounce", "r": "jelly", "a": "drop", "L": [["", "Five gates awake, and the jellyfish are humming. They want to help."], ["pip", "They're making a bouncy staircase! Jump, Spark! Jump!", "hop"], ["you", "Boing… boing… whoa-ho-HO!"], ["clack", "A captain does NOT bounce. A captain ascends. With dignity. WHEEEE!", "hop"]]},
    {"t": "The Keeper’s Map", "r": "wreck", "a": "swirl", "L": [["", "Inside the old wreck: a chest with a seashell lock."], ["pip", "Open it! No, wait, what if it bites? Open it! No! Okay. Open it.", "shake"], ["keeper", "“If Grimtide returns, wake the gates. Shared light is the one thing he cannot drink.”"], ["clack", "A treasure map! Hand it here, crew. Captains are excellent with maps.", "salute"], ["pip", "You're holding it upside down."]]},
    {"t": "The Lure", "r": "trap", "a": "swirl", "L": [["", "In a dark hollow, a soft light glows. A gate? It looks just like one."], ["pip", "Spark… gates don't usually wink at you.", "shake"], ["grimtide", "Thank you, little light. A map with every gate marked. How thoughtful."], ["grimtide", "Do keep waking them. I'll be waiting at every single one."], ["pip", "Spark… my glow. It's going out again.", "droop"]], "Q": {"at": 2, "kind": "tap", "n": 8, "label": "Hold on to the map!", "ok": [["you", "Not! Letting! GO!"], ["", "The map tears in two. A torn corner drifts off into the dark."]], "no": [["you", "No! The map!"], ["", "He rips it free. A torn corner drifts off into the dark."]]}},
    {"t": "Follow the Fish", "r": "school", "a": "bubble", "L": [["pip", "This is my fault. I said “ooh, pretty light”. I literally said “ooh”.", "droop"], ["", "Then the fish remember the gates. They swirl into a big silver arrow."], ["clack", "FISH! Of course! Exactly as I planned. I planned fish.", "salute"], ["pip", "Ha! Who needs his map anyway?", "hop"]], "Q": {"at": 1, "kind": "choice", "label": "Cheer Pip up", "opts": [["brave", "We'll find the gates ourselves.", [["you", "We don't need his map. We'll find the gates ourselves."], ["pip", "Ourselves. Okay! I am GREAT at ourselves.", "nod"]]], ["funny", "It WAS a very pretty light.", [["you", "In your defence, it WAS a very pretty light."], ["pip", "It was SO pretty. Okay. I feel a little better.", "laugh"]]], ["kind", "You warned me. We're a team.", [["you", "Hey. You warned me. I didn't listen. We're in this together."], ["pip", "…Together. Okay. Together.", "nod"]]]]}},
    {"t": "The Torn Map", "r": "dune", "a": "drop", "L": [["pip", "Look! The torn piece of the map! It blew all the way here!", "hop"], ["you", "It only shows one gate. On the edge of a cliff."], ["clack", "Cliffs. Of course it’s cliffs. Crabs and cliffs have a long and painful history.", "shake"], ["", "Behind the dune, ink hangs in the water. Fresh ink."]]},
    {"t": "The Edge of the Shallows", "r": "descent", "a": "drop", "L": [["pip", "That's the Coral Caves down there. Maybe we take the stairs?", "shake"], ["snip", "Ooh, look, Snap! Little light wants to take the STAIRS!", "laugh"], ["snap", "There are no stairs. There’s only US."], ["clack", "Crabs… don’t… fall… WELLLLL!"]], "Q": {"at": 3, "kind": "run", "v": "dive", "dur": 22, "label": "Escape Snip & Snap!", "ok": [["pip", "We lost them! Did we lose them? WE LOST THEM!", "hop"], ["snip", "This isn't over, little light! …Snap, which way is up?"]], "no": [["pip", "Ow! Ow! They nibbled my tail! …But we're alive! Mostly!", "shake"], ["snap", "Next time, little light. NEXT TIME."]]}},
    {"t": "Voices in the Caves", "r": "crystals", "a": "bubble", "w": 1, "L": [["grimtide", "Welcome to my caves, little light. Mind the echo. It's ME."], ["pip", "He can see us! Spark, he can SEE us!", "shake"], ["grimtide", "Every crystal you light shows me where you are. Shine away."], ["clack", "Crew! We came to pinch, and pinch we shall!", "salute"]], "Q": {"at": 3, "kind": "choice", "label": "Answer Grimtide", "opts": [["brave", "Then we'll light them ALL.", [["you", "Then we'll light every single one."], ["grimtide", "…Bold. I like bold. Bold tastes better."]]], ["funny", "Do you always talk this much?", [["you", "Do you always talk this much in caves?"], ["grimtide", "I… That is… how RUDE."]]], ["kind", "Stay close, Pip.", [["you", "Stay close, Pip. He's just trying to scare you."], ["pip", "It's working. But… okay. Closer.", "nod"]]]]}},
    {"t": "The Silent Clam", "r": "clams", "a": "swirl", "w": 1, "L": [["", "Giant clams open, one by one, and sing the Keeper’s old song."], ["choir", "“Share your light, and the light comes home…”"], ["", "But the last clam stays shut. Grimtide stole its pearl, and its song."], ["shelly", "Remember that tune, little ones. You’ll need it soon."]]},
    {"t": "The Dark Storm", "r": "storm", "a": "drop", "w": 1, "L": [["", "The water goes black. The storm has found you."], ["grimtide", "Thirteen gates, little light? Thirteen too many!"], ["shelly", "Everyone behind my shell! NOW!"], ["", "Shelly takes the whole blow… and sinks, slowly, to the sand."], ["grimtide", "One down."]], "Q": {"at": 3, "kind": "run", "v": "storm", "dur": 24, "label": "Get everyone through the storm!", "ok": [["you", "I've got you, Pip! Don't let go!"], ["pip", "I'm holding! I'm holding! Where's Shelly?!"]], "no": [["pip", "Spark! I can't hold on!"], ["you", "Shelly! Where are you?!"]]}},
    {"t": "Rest, Old Friend", "r": "shellyrest", "a": "bubble", "w": 1, "L": [["pip", "Shelly? Shelly, please wake up…", "droop"], ["shelly", "Hush. My shell has survived worse. Clack’s singing, for one."], ["shelly", "But I can't swim on. Promise me you'll wake every gate. Every last one."], ["clack", "Go. I’ll stand guard. Nobody touches this turtle while Clack has claws.", "salute"]], "Q": {"at": 3, "kind": "choice", "label": "Promise Shelly", "opts": [["brave", "I promise. Then I'm coming back.", [["you", "I promise. And then I'm coming back for you."], ["shelly", "I’ll hold you to that.", "nod"]]], ["funny", "Promise. You owe me a story.", [["you", "Promise. But you owe me a bedtime story."], ["shelly", "Deal. It’s a long one. Two hundred years.", "laugh"]]], ["kind", "Rest, Shelly. We've got this.", [["you", "Rest, Shelly. We've got this."], ["shelly", "I know you do. That’s why I can rest.", "nod"]]]]}},
    {"t": "Mira", "r": "manta", "a": "drop", "w": 1, "L": [["mira", "I am Mira. The currents carried me a message from an old turtle."], ["mira", "“Don’t look back. Tell them I’m proud. And tell the crab to stop fussing.”"], ["pip", "That's definitely Shelly.", "laugh"], ["mira", "Climb on. The canyon is wide, and grief is heavy. I will carry both."]], "Q": {"at": 4, "kind": "run", "v": "ride", "dur": 26, "label": "Ride the canyon with Mira!", "ok": [["pip", "WHEEEE! Again! AGAIN! Shelly would have LOVED that!", "spin"], ["mira", "You fly like a manta, little one. She would be proud."]], "no": [["pip", "I think I swallowed a jellyfish. Is that bad? It feels bad.", "shake"], ["mira", "The canyon is rough tonight. Hold on tight. We are almost there."]]}},
    {"t": "The Prisoner", "r": "shadow", "a": "swirl", "w": 1, "L": [["pip", "Spark… there are EYES in there. Big ones. Bigger than Shelly!", "shake"], ["murk", "Please don't scream. Everybody screams. I'm Murk. Sorry about my face."], ["murk", "He chains me. He makes me gather the pearls. Wait… that lamp. Where did you get that lamp?"], ["", "Before you can answer, a tail yanks him back into the dark."]]},
    {"t": "The Arch’s Secret", "r": "arch", "a": "drop", "w": 1, "L": [["", "An old coral arch blocks the way. Its lamps went out in the storm."], ["arch", "“Grimtide fears one thing: light that is given away.”"], ["pip", "Given away? But he TAKES light. He's a light-taker. A big… taking… noodle.", "shake"], ["you", "That's how we beat him, Pip. And how we free Murk."]], "Q": {"at": 1, "kind": "tap", "n": 6, "label": "Light the lamps!", "ok": [["pip", "You did it! The arch remembers!"]], "no": [["", "One by one, the old lamps flicker awake on their own."]]}},
    {"t": "A Secret Trail", "r": "pearls", "a": "bubble", "w": 1, "L": [["", "Pearls float up from the sand like little lanterns. A trail."], ["pip", "Murk left them! He's helping us! In secret! Like a spy! A big squishy spy!", "spin"], ["grimtide", "Murk… Why are my pearls floating away, Murk?"], ["murk", "…Currents?"]]},
    {"t": "Good News", "r": "race", "a": "swirl", "w": 1, "L": [["cousin", "PIP! PIP! Shelly woke up! She’s okay!", "hop"], ["pip", "She's okay? SHE'S OKAY! Spark! She's okay!", "spin"], ["cousin", "And the loud crab says, quote: “Don’t save the reef without me!”", "laugh"]], "Q": {"at": 3, "kind": "choice", "label": "Message for home", "opts": [["brave", "Tell him to hurry up!", [["you", "Tell him to hurry. We're not slowing down."], ["cousin", "Ooh, intense! I’ll tell him!", "hop"]]], ["funny", "We’ll save him a bit of reef.", [["you", "Tell him we'll save him a little bit of reef."], ["cousin", "Ha! He’s going to HATE that!", "laugh"]]], ["kind", "Tell Shelly we love her.", [["you", "Tell Shelly we love her."], ["cousin", "She knows. She says it first, every morning.", "nod"]]]]}},
    {"t": "The Lantern in Chains", "r": "coil", "a": "drop", "w": 1, "L": [["", "From the last cliff of the caves, you see it: the Great Lantern."], ["", "And wrapped around it like a storm cloud: Grimtide."], ["grimtide", "Twenty gates! You think you’re saving the reef? You’re setting my table."], ["pip", "Why does he keep talking about FOOD?", "shake"]]},
    {"t": "Lumen", "r": "angler", "a": "bubble", "w": 2, "L": [["lumen", "Psst! Over here! Quick, before his eyes find you!"], ["lumen", "Lumen’s the name, light’s the game! The Deep’s last lantern, live and in person!", "spin"], ["lumen", "I’ve been hiding for three weeks. In a sock. Don’t ask where I got a sock."], ["lumen", "But you’re going after him? Then my light is yours. Showtime!", "hop"]]},
    {"t": "Whale Song", "r": "whale", "a": "drop", "w": 2, "L": [["lumen", "Old Bellow! He only sings when the Lantern fights back!", "spin"], ["clack", "Did somebody say CAPTAIN?", "salute"], ["pip", "CLACK!", "hop"], ["clack", "Shelly sends her love. And a VERY rude message for Grimtide. I’ll deliver it personally.", "laugh"]]},
    {"t": "The Mural", "r": "ruins", "a": "swirl", "w": 2, "L": [["", "An old sea city. On its last wall: the Reef Keeper and a giant purple octopus."], ["pip", "Spark… look at her helmet. Look at her LAMP.", "shake"], ["you", "It's my lamp. It's the same lamp."], ["lumen", "Kid, I’ve been in show business a long time. That’s what we call a plot twist.", "nod"]]},
    {"t": "Ambush", "r": "ambush", "a": "drop", "w": 2, "L": [["pip", "Twenty-four gates! We're going to make it, Spark! We're actually going to—", "spin"], ["grimtide", "ENOUGH!"], ["pip", "Spaaark!"], ["clack", "Let him go, you overgrown NOODLE!"], ["", "Clack leaps at the tail. One mighty pinch… and the tail swats him into the dark."], ["grimtide", "Come to my lair, little light. Or never see your seahorse again."]], "Q": {"at": 2, "kind": "run", "v": "chase", "dur": 24, "label": "Chase Grimtide! Save Pip!", "ok": [["you", "I've got you! I've got… NO!"], ["pip", "Spaaark! Don’t let go of the reef!"]], "no": [["you", "PIP!"], ["grimtide", "Too slow, little light. Much too slow."]]}},
    {"t": "The Captain’s Last Order", "r": "farewell", "a": "drop", "w": 2, "L": [["clack", "Gate-waker… did I get him? Tell me I pinched him good."], ["clack", "Tell my crew… they were the finest crew… on the whole reef.", "droop"], ["", "And the Captain is still."], ["shelly", "You brave, loud, wonderful fool. Up, little one. Grimtide has Pip. And I have two hundred years of anger."]], "Q": {"at": 1, "kind": "choice", "label": "Answer the Captain", "opts": [["brave", "You were magnificent, Captain.", [["you", "You were magnificent, Captain."], ["clack", "Magnificent… put that on my shell."]]], ["funny", "He'll walk funny for a week.", [["you", "He'll be walking funny for a week."], ["clack", "Ha… good. Good."]]], ["kind", "You saved us, Captain.", [["you", "You did, Captain. You saved us."], ["clack", "Then it was worth it."]]]]}},
    {"t": "Breaking the Chains", "r": "cage", "a": "bubble", "w": 2, "L": [["pip", "Spark! You came! I knew you’d come! I said “Spark will come” like four hundred times!", "hop"], ["murk", "I'm sorry. He makes me guard him. If I let go, Grimtide will…", "droop"], ["you", "Murk. This was her lamp, wasn’t it?"], ["murk", "…She was my best friend."], ["murk", "FREE! I'm free! Group hug! I have eight arms, everyone's included!", "laugh"]], "Q": {"at": 4, "kind": "tap", "n": 10, "label": "Give your light!", "ok": [["", "You hold up a glowing pearl and give it away. The ink chains melt."]], "no": [["", "The pearl’s light pours out on its own, and the ink chains melt."]]}},
    {"t": "Over the Abyss", "r": "murkride", "a": "drop", "w": 2, "L": [["murk", "Climb on. I know the way to his lair."], ["murk", "The night of the storm, she went to face him alone. I was too scared to follow.", "droop"], ["pip", "I'm not scared. My fins are just… okay, I'm scared. But I'm going anyway!", "shake"]], "Q": {"at": 2, "kind": "choice", "label": "Answer Murk", "opts": [["brave", "This time, we go together.", [["you", "This time, we all go together."], ["murk", "Together.", "nod"]]], ["funny", "Eight arms. Use them ALL.", [["you", "Well, you have eight arms now. Use them ALL."], ["murk", "Eight arms of fury. I like that.", "laugh"]]], ["kind", "It wasn't your fault, Murk.", [["you", "It wasn't your fault, Murk."], ["murk", "…She would have said that. Thank you.", "nod"]]]]}},
    {"t": "The Deep Rises", "r": "plankton", "a": "bubble", "w": 2, "L": [["lumen", "Ladies and gentlefish! Wave those arms, Spark! Show the Deep it’s not alone!", "spin"], ["", "Every wave sets the plankton glowing. Then the jellies. Then the fish. Then everyone."], ["", "Clack’s crew raise his tiny hat high."], ["grimtide", "Light them all, little light. More for me."]]},
    {"t": "Grimtide’s Lair", "r": "lair", "a": "drop", "w": 2, "L": [["grimtide", "Twenty-nine gates. The Lantern is nearly full. Wake the last, and I drink it ALL."], ["pip", "THAT'S why he let us! We've been cooking his DINNER!", "shake"], ["you", "You’re wrong about one thing. That light isn’t yours. We’re giving it away."], ["grimtide", "Then come, Keeper’s child. Let’s see who shines last."]], "Q": {"at": 2, "kind": "run", "v": "lair", "dur": 24, "label": "Through the coils! Reach the Lantern!", "ok": [["murk", "Not this time, Grimtide!"], ["grimtide", "Clever little light. It will not save you."]], "no": [["murk", "Spark! I've got you! Grab my arm!"], ["pip", "Eight arms! Best seatbelt EVER!", "hop"]]}},
    {"t": "The Reef’s Revenge", "r": "victory", "a": "drop", "w": 2, "L": [["grimtide", "YES! Give it to me!"], ["", "Every creature in the sea gives its light at once. Way too much light. Freely given."], ["grimtide", "No… NO! It BURNS! Too bright! Too SHARED!"], ["", "And the mighty Grimtide shrinks… to a tiny, wriggling, very grumpy worm."], ["snip", "Uh… Snap? I think we work for a worm now."], ["clack", "Did somebody say… CAPTAIN?", "salute"], ["pip", {"brave": "CLACK?! You were brave the whole way, Spark. Everybody was!", "funny": "CLACK?! Spark, you made me laugh the whole way. And now THIS!", "kind": "CLACK?! Spark, you were kind the whole way. That’s why it worked."}, "spin"], ["", "The Heart Pearl rises home. And the whole reef shines."]], "Q": {"at": 1, "kind": "hold", "label": "Give the light away!", "ok": [["you", "It was never yours!"]], "no": [["pip", "Everybody, NOW! Give it away!"]]}}];
  const PROLOGUE = {"t": "The Night the Lights Went Out", "r": "prologue", "a": "pipe", "w": 0, "L": [["", "Once, the reef glowed every night. And the brightest light of all was the Great Lantern."], ["pip", "Ooh! Ooh! Look at me! I'm the second brightest thing here!", "spin"], ["grimtide", "Such pretty little lights. I'll take them. ALL of them."], ["", "Grimtide, the eel who drinks light, rose out of the abyss, and the reef's lights poured into his jaws."], ["keeper", "Not while I'm Keeper!"], ["", "The Reef Keeper gave all her light to save the Lantern. Grimtide fled… and the whole reef went dark."], ["pip", "Hello…? Anybody…?", "droop"]]};
  const STORY_WHO = {"": "", "you": "Spark", "pip": "Pip", "shelly": "Shelly", "clack": "Captain Clack", "mira": "Mira", "cousin": "Pip’s cousin", "lumen": "Lumen", "murk": "Murk", "grimtide": "Grimtide", "snip": "Snip", "snap": "Snap", "keeper": "The Reef Keeper", "choir": "The Clam Choir", "arch": "The Coral Arch"};
  const sm01 = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
  // keyframes: [[t, value], ...] where value is a number or [x, y, z]; smooth between keys, held at the ends
  function K(t, keys) { if (t <= keys[0][0]) return Array.isArray(keys[0][1]) ? new V3(...keys[0][1]) : keys[0][1]; const last = keys[keys.length - 1]; if (t >= last[0]) return Array.isArray(last[1]) ? new V3(...last[1]) : last[1];
    let i = 0; while (keys[i + 1][0] < t) i++; const [t0, a] = keys[i], [t1, b] = keys[i + 1], k = sm01((t - t0) / (t1 - t0));
    return Array.isArray(a) ? new V3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k) : a + (b - a) * k; }
  const RECIPES = {};
  // the first chapter: the original tunnel film (inside the pipe, out onto the sand, wave at the next tank), plus Pip peeking out
  RECIPES.pipe = { dur: 5.9, setup(S, c) { const R = 1.05; c.R = R; c.dir = new V3(0.72, 0, 0.69).normalize(); c.M = new V3(-2.1, R * 0.82, -0.4);
      c.pipe = makePipe(S.w, R, 9); c.pipe.rotation.y = Math.atan2(c.dir.x, c.dir.z); c.pipe.position.copy(c.M); S.scene.add(c.pipe); S.mats.push(...c.pipe.userData.pipe.mats);
      { const warm = new THREE.PointLight(0xff9a62, 3.2, 5, 1.6); warm.position.set(0, R * 0.55, -R * 0.9); c.pipe.add(warm); const cool = new THREE.PointLight(0x8fe8ff, 4, 7, 1.4); cool.position.set(0, 0, -R * 0.4); c.pipe.add(cool); }
      S.clearPath(c.M, c.dir, -9, 4.5, 1.5); c.pip = S.add(makePip(0xffc23a, 0.05)); c.pip.visible = false; },
    run(S, c, t) { const d = c.dir, M = c.M, side = new V3(d.z, 0, -d.x), at = (s, y) => new V3(M.x + d.x * s, y, M.z + d.z * s); pipeTick(c.pipe, S.time);
      if (t < 2.7) { const k = t / 2.7, cs = -4.4 + k * 1.3; S.camRaw(at(cs, M.y + 0.28).addScaledVector(side, -0.2), at(cs + 6, M.y - 0.12), 0.06);
        S.dv(at(cs + 1.15 + sm01(k) * 1.7, M.y - 0.3 + Math.sin(t * 3.2) * 0.04).addScaledVector(side, 0.28), d, -0.15 + Math.sin(t * 3.2) * 0.05, -0.35); return { mode: 'swim', speed: 2.4 }; }
      const t2 = t - 2.7, Df = at(1.75, 0.5), fF = new V3().subVectors(S.tankP(), Df).setY(0).normalize(), rgt = new V3(-fF.z, 0, fF.x);
      S.cam(Df.clone().addScaledVector(fF, -3.0 + 0.35 * sm01(t2 / 3.2)).addScaledVector(rgt, 0.95).setY(0.9), Df.clone().addScaledVector(fF, 6).addScaledVector(rgt, 0.9).setY(0.8));
      const p = at(-0.5 + 2.25 * sm01(t2 / 1.8), 0.5).addScaledVector(side, 0.1 * sm01(t2 / 1.8)); if (t2 < 0.25) p.y += Math.sin(t2 / 0.25 * Math.PI) * 0.12;
      const f = d.clone().lerp(new V3().subVectors(S.tankP(), p).setY(0).normalize(), sm01((t2 - 1.6) / 0.7)).normalize(); S.dv(p, f);
      c.pip.visible = t2 > 1.9; c.pip.position.copy(at(0.15, 0.55 + sm01((t2 - 1.9) / 0.8) * 0.5)).addScaledVector(side, -0.55); c.pip.rotation.y = Math.atan2(-(S.cam0.position.z - c.pip.position.z), S.cam0.position.x - c.pip.position.x) * 0.6;
      const walk = t2 < 1.9 ? 1 : t2 < 2.4 ? 1 - (t2 - 1.9) / 0.5 : 0; return { mode: walk > 0.05 ? 'walk' : 'stand', speed: walk * 1.8, arms: 'wave', armK: sm01((t2 - 2.2) / 0.5), face: f }; } };
  // 2: through a kelp forest after Pip, into a clearing
  RECIPES.kelp = { dur: 6.6, setup(S, c) { S.tankAt(4.6, -11, -0.3); S.kelpWalls(-1.2, 5, -2.5, 2.2, 26); c.pip = S.add(makePip(0xffc23a, S.glow)); },
    run(S, c, t) { const dz = K(t, [[0, 5.5], [3.4, 0.4], [4.6, -0.9]]), p = new V3(-0.2 + Math.sin(t * 1.4) * 0.2, K(t, [[0, 1.2], [3.4, 1.0], [4.6, 0.5]]), dz);
      const f = t < 4 ? new V3(0, 0, -1) : new V3().subVectors(S.tankP(), p).setY(0).normalize(); S.dv(p, f, t < 3.8 ? 0.0 : 0);
      c.pip.position.set(Math.sin(t * 2.3) * 0.35 + (t > 4.4 ? -0.9 : 0), p.y + 0.4 + Math.sin(t * 3) * 0.1, dz - 1.1 + (t > 4.4 ? 0.6 : 0)); c.pip.rotation.y = t < 4.4 ? Math.PI / 2 : -0.4 + t * 2.5 * (t < 5.4 ? 1 : 0); c.pip.userData.tick(S.time);
      if (t < 3.4) S.cam(new V3(2.4, 1.5, dz + 1.6), new V3(-0.3, 1.0, dz - 0.6)); else S.cam(K(t, [[3.4, [2.4, 1.5, 2.0]], [5.0, [1.5, 0.95, 2.1]]]), K(t, [[3.4, [-0.3, 1.0, -0.2]], [5.0, [2.0, 0.85, -5]]]));
      return { mode: t < 3.4 ? 'swim' : t < 4.6 ? 'walk' : 'stand', speed: t < 4.6 ? 1.6 : 0, arms: 'wave', armK: sm01((t - 5.0) / 0.4), face: f }; } };
  // 3: Shelly swims in, the diver hops on, they glide off together
  RECIPES.turtle = { dur: 7.0, setup(S, c) { c.tu = S.add(makeTurtle()); c.tu.scale.setScalar(1.35); S.tankAt(5.5, -12, -0.42); S.clear.push([2, -4, 4]); },
    run(S, c, t) { const tp = K(t, [[0, [6, 0.6, 0.5]], [2.2, [0.9, 0.55, 0.2]], [3.0, [0.9, 0.7, 0.2]], [6.2, [3.6, 1.4, -7.6]], [7, [3.7, 0.7, -8.0]]]);
      c.tu.position.copy(tp); const tf = t < 2.2 ? new V3(-1, 0, 0) : t < 3 ? new V3(-1, 0, -0.3).lerp(new V3(0.3, 0, -1), sm01((t - 2.2) / 0.8)).normalize() : new V3(0.33, 0, -1).normalize(); c.tu.rotation.y = Math.atan2(-tf.z, tf.x); c.tu.userData.tick(S.time, t > 3 ? 1.4 : 1);
      let p; if (t < 2.2) p = new V3(-0.4, 0.5, 0.6); else if (t < 3.0) { const k = (t - 2.2) / 0.8; p = new V3(-0.4, 0.5, 0.6).lerp(tp.clone().setY(tp.y + 0.62), sm01(k)); p.y += Math.sin(k * Math.PI) * 0.6; } else p = tp.clone().setY(tp.y + 0.62);
      const f = t < 2.2 ? new V3(1, 0, -0.1).normalize() : tf; S.dv(p, f);
      if (t < 3.0) S.cam(new V3(-2.6, 1.1, 3.6), new V3(1.2, 0.9, 0)); else S.cam(K(t, [[3, [-2.6, 1.1, 3.6]], [6.2, [0.2, 2.2, -2.6]], [7, [0.4, 1.7, -3.2]]]), tp.clone().add(new V3(1.5, 0.3, -2.5)));
      return { mode: t < 2.2 ? 'stand' : 'stand', arms: t > 3 && t < 6.2 ? 'grip' : 'wave', armK: t < 2.2 ? sm01((t - 0.6) / 0.4) * (1 - sm01((t - 1.8) / 0.3)) : t < 6.2 ? 1 : sm01((t - 6.3) / 0.4), face: f }; } };
  // 4: a parade of crabs carrying pearls; the diver dances along and high-fives the leader
  RECIPES.crabs = { dur: 6.6, setup(S, c) { c.crabs = []; for (let i = 0; i < 6; i++) { const cr = S.add(makeCrab()); cr.scale.setScalar(i ? 1.0 : 1.25); if (i) { const pe = makeBall(true); pe.scale.setScalar(0.42); pe.position.y = 0.35; cr.add(pe); } else cr.add(makeCapHat()); c.crabs.push(cr); } c.clack = c.crabs[0]; S.tankAt(4.4, -11, -0.3); S.clear.push([0, 0, 3.5]); },
    run(S, c, t) { c.crabs.forEach((cr, i) => { const x = K(t, [[0, -6 - i * 1.1], [4.6, 1.8 - i * 1.1 + (i ? 0 : 0)], [6.6, (i ? 2.4 - i * 1.1 : 1.9)]]); cr.position.set(x, 0.22 + Math.abs(Math.sin(S.time * 7 + i)) * 0.05, -0.6 + (i % 2) * 0.15); cr.rotation.y = -Math.PI / 2 + Math.sin(S.time * 7 + i) * 0.12; if (cr.userData.clawL) cr.userData.clawL.rotation.z = Math.sin(S.time * 9 + i) * 0.4; });
      const bob = t < 4.8 ? Math.abs(Math.sin(t * 5)) * 0.12 : 0, p = new V3(0.9, 0.5 + bob, 0.45), f = t < 4.8 ? new V3(Math.sin(t * 2.5) * 0.6, 0, 1).normalize() : new V3(-0.9, 0, -0.45).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [2.8, 1.2, 3.4]], [4.4, [2.2, 1.0, 3.0]], [6.6, [2.9, 1.05, 2.4]]]), K(t, [[0, [-1.5, 0.6, -0.4]], [6.6, [0.5, 0.7, -2.5]]]));
      return { mode: 'stand', arms: t < 4.8 ? 'cheer' : 'point', armK: t < 4.8 ? 0.6 + 0.4 * Math.sin(t * 5) : sm01((t - 5) / 0.4), face: f, target: c.crabs[0].position.clone().add(new V3(0, 0.4, 0)) }; } };
  // 5: up a stair of bouncing jellyfish to a ledge
  RECIPES.jelly = { dur: 6.8, setup(S, c) { c.js = [[-1.4, 0.8, 0], [-0.2, 1.7, -0.9], [1.0, 2.6, -1.8]].map(([x, y, z]) => { const j = S.add(makeJelly()); j.scale.setScalar(1.6); j.position.set(x, y, z); j.userData.base = j.position.clone(); return j; });
      { const geo = new THREE.DodecahedronGeometry(1.5, 2); const P = geo.attributes.position; for (let v = 0; v < P.count; v++) { const x = P.getX(v), y = P.getY(v), z = P.getZ(v), n = 1 + Math.sin(x * 3.1) * Math.sin(z * 2.7) * 0.08 + Math.sin(y * 4.3) * 0.05; P.setXYZ(v, x * n, y * n * 1.25, z * n); } geo.computeVertexNormals();
        c.ledge = S.add(new THREE.Mesh(geo, SM({ map: TEX.rockCol || null, color: 0xc8a080, roughness: 0.95 }))); c.ledge.position.set(2.6, 1.95, -2.8); c.ledge.receiveShadow = c.ledge.castShadow = true; }
      for (const [x, z, n, h] of [[2.1, -2.3, 'coral3', 0.6], [3.0, -2.2, 'weed5', 0.7], [2.4, -3.3, 'coral1', 0.5]]) S.spr(n, h, x, z, 3.4); S.tankAt(5.4, -13, -0.45); S.clear.push([0.5, -1, 3.5]); },
    run(S, c, t) { const hops = [[-2.6, 0.5, 0.8], [-1.4, 1.35, 0], [-0.2, 2.25, -0.9], [1.0, 3.15, -1.8], [2.5, 3.9, -2.6]], seg = Math.min(3.999, Math.max(0, (t - 0.6) / 1.15)), i = Math.floor(seg), k = seg - i, a = hops[i], b = hops[i + 1];
      const p = new V3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k + Math.sin(k * Math.PI) * 0.9, a[2] + (b[2] - a[2]) * k); if (t < 0.6) p.set(...hops[0]);
      c.js.forEach((j, n) => { const land = n === i - 1 ? Math.max(0, 1 - k * 3) : 0; j.scale.set(1.6 * (1 + land * 0.25), 1.6 * (1 - land * 0.3), 1.6 * (1 + land * 0.25)); j.position.y = j.userData.base.y + Math.sin(S.time * 1.6 + n) * 0.08; if (j.userData.bell) j.userData.bell.scale.y = 1 + Math.sin(S.time * 3 + n) * 0.06; });
      const f = new V3(b[0] - a[0], 0, b[2] - a[2]).normalize(); const done = t > 5.2; S.dv(done ? new V3(2.5, 3.9, -2.6) : p, done ? new V3(0.4, 0, -1).normalize() : f);
      S.cam(K(t, [[0, [-3.6, 2.0, 4.2]], [5.2, [-0.4, 3.2, 2.4]], [6.8, [-0.2, 3.8, 1.0]]]), K(t, [[0, [-1, 1.2, -0.5]], [5.2, [2.2, 3.4, -2.8]], [6.8, [4.4, 2.6, -8]]]));
      return { mode: done ? 'stand' : 'float', arms: 'cheer', armK: done ? sm01((t - 5.3) / 0.4) : 0.4 * Math.sin(k * Math.PI), face: done ? new V3(0.4, 0, -1).normalize() : f }; } };
  // 6: the old wreck, a chest, and the map of the thirty gates
  RECIPES.wreck = { dur: 7.4, setup(S, c) { c.wr = S.add(makeWreck()); c.wr.position.set(-2.6, 0, -5.0); c.wr.rotation.y = 0.95; c.ch = S.add(makeChest()); c.ch.position.set(0.2, 0, -1.2); c.ch.rotation.y = 0.35; c.map = S.add(makeMap(6)); c.map.visible = false; S.tankAt(5.4, -12, -0.4); S.clear.push([-1, -2.5, 3.6]); },
    run(S, c, t) { const p = K(t, [[0, [1.6, 0.5, 2.6]], [2.0, [0.65, 0.5, -0.35]]]), toC = new V3().subVectors(c.ch.position, p).setY(0).normalize(); const open = sm01((t - 2.4) / 0.8); c.ch.userData.setOpen(open);
      const up = sm01((t - 3.3) / 1.0); c.map.visible = t > 3.1; const hand = p.clone().add(new V3(0, 0.55 + up * 0.25, 0)).addScaledVector(toC, 0.18); c.map.position.copy(c.ch.position.clone().add(new V3(0, 0.6, 0)).lerp(hand, up)); c.map.lookAt(S.cam0.position); c.map.rotation.z += Math.sin(S.time * 2) * 0.05;
      const f = t < 4.6 ? toC : toC.clone().lerp(new V3().subVectors(S.cam0.position, p).setY(0).normalize(), sm01((t - 4.6) / 0.6) * 0.75).normalize(); S.dv(p, f);
      if (t < 2.3) S.cam(new V3(3.2, 1.3, 3.0), K(t, [[0, [0, 0.8, -1]], [2.3, [0.3, 0.6, -1.0]]])); else if (t < 4.6) S.cam(K(t, [[2.3, [1.9, 0.9, 0.7]], [4.6, [1.7, 0.8, 0.9]]]), new V3(0.3, 0.75, -0.9)); else S.cam(K(t, [[4.6, [2.4, 1.0, 1.8]], [7.4, [2.8, 1.0, 2.2]]]), new V3(-0.2, 0.9, -2.6));
      return { mode: t < 2 ? 'walk' : 'stand', speed: t < 2 ? 1.5 : 0, arms: t < 3.3 ? 'reach' : 'hold', armK: t < 2.2 ? 0 : t < 3.3 ? sm01((t - 2.2) / 0.4) : 1, face: f, target: c.ch.position.clone().add(new V3(0, 0.5, 0)), lift: up }; } };
  // 7: a warm whirlpool lifts the diver, spins him round and sets him down by the next tank
  RECIPES.current = { dur: 6.6, setup(S, c) { const tex = canvasTex(256, 64, (x, W, H) => { for (let i = 0; i < 8; i++) { const gr = x.createLinearGradient(i * 32, 0, i * 32 + 32, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(220,250,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(i * 32, 0, 32, H); } }, true); S.own.push(tex);
      c.vm = new THREE.MeshBasicMaterial({ map: tex, color: 0x9ff0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); S.mats.push(c.vm); tex.repeat.set(3, 1);
      c.v = S.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.4, 5, 32, 1, true), c.vm)); c.v.position.set(0, 2.5, -1); S.tankAt(4.6, -10, -0.35); S.clear.push([0, -1, 2.5]); },
    run(S, c, t) { c.vm.opacity = 0.16 * sm01(t / 0.8) * (1 - sm01((t - 4.6) / 0.8)); c.vm.map.offset.x = -S.time * 0.8; c.v.rotation.y = S.time * 2;
      const lift = K(t, [[0, 0], [1.0, 0], [2.6, 1], [3.6, 1], [5.0, 0]]), ang = t * 5.5 * (t < 4.6 ? 1 : 0.2), rad = 0.9 * lift, land = sm01((t - 3.6) / 1.4);
      const p = new V3(Math.cos(ang) * rad, 0.5 + lift * 2.6, -1 + Math.sin(ang) * rad).lerp(new V3(2.4, 0.5, -5.2), land); if (t < 1.0) p.set(0, 0.5, -1);
      const f = t < 4.8 ? new V3(-Math.sin(ang), 0, Math.cos(ang)) : new V3().subVectors(S.tankP(), p).setY(0).normalize(); S.dv(p, f, 0, 0, Math.sin(t * 3) * 0.3 * lift);
      if (Math.random() < 0.6 && t < 4.6) S.parts.bubbles((Math.random() - 0.5) * 2.5, Math.random() * 4.5, -1 + (Math.random() - 0.5) * 2.5, 1, 0.05 + Math.random() * 0.06, 0.3);
      S.cam(K(t, [[0, [0.8, 1.3, 4.6]], [3.6, [1.2, 2.6, 4.6]], [6.6, [0.2, 1.0, -1.6]]]), K(t, [[0, [0, 1.2, -1]], [3.6, [0, 2.6, -1]], [6.6, [4.0, 0.9, -8.5]]]));
      return { mode: t < 1 || t > 5 ? 'stand' : 'float', arms: t < 4.6 ? 'cheer' : 'wave', armK: t < 1 ? 0 : t < 4.6 ? 0.8 : sm01((t - 5.2) / 0.4), face: f }; } };
  // 8: a school of fish swirls into an arrow that points the way
  RECIPES.school = { dur: 6.6, setup(S, c) { c.f = []; for (let i = 0; i < 46; i++) { const sp = sprPlane(['fishA', 'fishC', 'fishE', 'fishH'][i % 4], 0.2, false, null); sp.material = sp.material.clone(); S.mats.push(sp.material); S.scene.add(sp); c.f.push(sp); }
      // arrow formation points (in the arrow's own frame: +x = forward)
      c.arrow = []; for (let i = 0; i < 46; i++) { if (i < 22) c.arrow.push([-2.2 + i * 0.2, 0, 0]); else { const s = i < 34 ? 1 : -1, k = (i - (i < 34 ? 22 : 34)) / 11; c.arrow.push([2.2 - k * 1.3, s * k * 1.1, 0]); } } S.tankAt(4.8, -11, -0.3); },
    run(S, c, t) { const form = sm01((t - 1.4) / 1.6), dir = new V3().subVectors(S.tankP(), new V3(0, 0, 0)).setY(0).normalize(), ang = Math.atan2(-dir.z, dir.x), cen = new V3(0.6, 2.3, -3.4);
      c.f.forEach((sp, i) => { const a = S.time * 1.6 + i * 0.37, ball = new V3(Math.cos(a) * 1.1, Math.sin(a * 1.3 + i) * 0.6, Math.sin(a) * 1.1); const [ax, ay] = c.arrow[i], ar = new V3(ax * 0.8, ay * 0.8, 0); // the arrow faces the camera and points right, toward the tank
        const q = ball.lerp(ar, form).add(cen); q.x += form * Math.sin(S.time * 4 + i) * 0.04; sp.position.copy(q); sp.lookAt(S.cam0.position); sp.scale.x = form > 0.5 ? (Math.cos(ang - Math.atan2(S.cam0.position.x - q.x, S.cam0.position.z - q.z) + Math.PI / 2) > 0 ? -1 : 1) : 1; });
      const p = K(t, [[0, [-1.6, 0.5, 1.6]], [3.4, [-0.6, 0.5, 0.4]], [5.4, [0.4, 0.5, -0.8]]]), f = t < 3.4 ? new V3(0.3, 0, -1).normalize() : new V3().subVectors(S.tankP(), p).setY(0).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [1.8, 1.0, 4.0]], [3.4, [2.2, 1.3, 3.6]], [6.6, [-1.6, 1.1, 2.6]]]), K(t, [[0, [0, 1.6, -2]], [3.4, [0.4, 1.8, -2.2]], [6.6, [2.6, 1.4, -5]]]));
      return { mode: t < 5.4 ? 'walk' : 'stand', speed: t < 5.4 ? 1.2 : 0, arms: t < 3.4 ? null : 'point', armK: sm01((t - 3.6) / 0.5), face: f, target: S.tankP().clone().setY(1.4) }; } };
  // 9: sliding down the big dune
  RECIPES.dune = { dur: 6.4, set: { dune: true }, setup(S, c) { S.tankAt(6.5, -10, -0.5); S.clear.push([-2, 0, 5]); },
    run(S, c, t) { const x = K(t, [[0, -6.2], [0.8, -5.6], [3.6, 1.2], [4.2, 1.6]]), y = S.groundY(x, 0); const sliding = t > 0.8 && t < 3.8;
      const p = new V3(x, y + 0.5 + (sliding ? -0.15 : 0), 0.2), slope = (S.groundY(x + 0.2, 0) - S.groundY(x - 0.2, 0)) / 0.4, f = t < 4.4 ? new V3(1, 0, 0) : new V3().subVectors(S.tankP(), p).setY(0).normalize();
      S.dv(p, f, sliding ? -0.9 + Math.atan(slope) * 0.6 : 0); if (sliding && Math.random() < 0.8) S.parts.emit(p.x - 0.3, p.y - 0.4, p.z, 2, { color: new THREE.Color(1, 0.85, 0.55), speed: 1.4, life: 0.7, size: 0.14, spread: 0.3 });
      S.cam(K(t, [[0, [-4.6, 3.4, 5.0]], [3.6, [0.5, 1.4, 5.0]], [6.4, [-0.4, 1.0, 3.0]]]), K(t, [[0, [-5, 2.6, 0]], [3.6, [1.0, 0.7, 0]], [6.4, [3.6, 0.9, -5]]]));
      return { mode: sliding ? 'float' : t < 0.8 ? 'walk' : 'stand', speed: 1, arms: sliding ? 'cheer' : t > 4.4 ? 'cheer' : null, armK: sliding ? 0.9 : sm01((t - 4.5) / 0.4), face: f }; } };
  // 10: the edge of the shallows; the Coral Caves glow violet far below
  RECIPES.descent = { dur: 6.8, set: { cliff: -3, dark: 0.4 }, setup(S, c) { c.pip = S.add(makePip(0xffc23a, S.glow)); c.snip = S.add(makeFish()); c.snap = S.add(makeFish()); c.snip.scale.setScalar(1.3); c.snap.scale.setScalar(1.45); c.snip.visible = c.snap.visible = false; S.tankAt(5.0, -11, -0.35, -3); c.cave = S.add(makeCrystals(0xb57cff, 12, 2.2, 7)); c.cave.position.set(2.5, -3, -9); c.cave.userData.setLit(0.55);
      const pl = new THREE.PointLight(0xb57cff, 9, 14, 1.4); pl.position.set(3, -1.6, -9); S.scene.add(pl); S.clear.push([0, 0, 3]); },
    run(S, c, t) { const p = K(t, [[0, [-1.6, 0.5, 1.6]], [2.6, [-0.1, 0.5, -1.8]]]), f = new V3(0.35, 0, -1).normalize(), fall = sm01((t - 4.9) / 1.7);
      if (t > 4.9) { p.x += (t - 4.9) * 0.3; p.y -= 5.5 * fall; p.z -= 1.6 * sm01((t - 4.9) / 1.2); }
      S.dv(p, f, t > 4.9 ? 0.35 + 0.9 * sm01((t - 4.9) / 0.4) : t > 2.6 ? 0.35 * sm01((t - 2.6) / 0.6) : 0);
      [[c.snip, -0.55, 0], [c.snap, 0.6, 0.25]].forEach(([F, ox, dl]) => { F.visible = t > 3.5 + dl; if (!F.visible) return; const k = sm01((t - 3.5 - dl) / 1.1), edge = new V3(-0.1 + ox, 1.0 + ox * 0.3, -1.0);
        const fp = new V3(-4.5 + ox, 1.6, 2.2).lerp(t < 4.9 ? p.clone().add(new V3(ox, 0.55, 0.9)) : edge, t < 4.9 ? k : 1); fp.y += Math.sin(S.time * 3 + ox) * 0.06; F.position.copy(fp);
        const d = new V3().subVectors(p, fp).setY(0); if (d.lengthSq() > 1e-4) F.rotation.y = Math.atan2(-d.z, d.x); if (F.userData.jaw) F.userData.jaw.rotation.z = -0.15 - Math.abs(Math.sin(S.time * 10 + ox)) * 0.45; if (F.userData.tail) F.userData.tail.rotation.y = Math.sin(S.time * 14 + ox) * 0.6; });
      c.pip.position.set(p.x - 0.7 + Math.sin(S.time * 9) * 0.03 * (t > 3 ? 1 : 0), p.y + 0.75 + Math.sin(S.time * 2) * 0.06, p.z + 0.3 - (t > 4.6 ? 0.5 * sm01((t - 4.6) / 0.8) : 0)); c.pip.rotation.y = 0.6; c.pip.userData.tick(S.time);
      S.cam(K(t, [[0, [1.5, 1.2, 3.4]], [2.6, [1.4, 1.5, 1.0]], [6.8, [1.2, 2.4, 0.9]]]), K(t, [[0, [-0.5, 0.8, -1]], [2.6, [0.5, -0.5, -5]], [6.8, [3.4, -0.6, -9.5]]]));
      return { mode: t < 2.6 ? 'walk' : 'stand', speed: 1.3, arms: t > 4.2 ? 'point' : null, armK: sm01((t - 4.3) / 0.5), face: f, target: c.cave.position.clone() }; } };
  // 11: the lamp wakes crystal clusters one by one
  RECIPES.crystals = { dur: 6.8, set: { dark: 0.55 }, setup(S, c) { c.cr = []; for (let i = 0; i < 9; i++) { const g = S.add(makeCrystals(i % 3 ? 0xb57cff : 0x6fe0ff, 6, 0.9 + (i % 3) * 0.35, 11 + i)); const side = i % 2 ? 1 : -1; g.position.set(side * (1.2 + (i % 3) * 0.5), 0, 3 - i * 0.9); c.cr.push(g); }
      c.lamp = new THREE.SpotLight(0xfff0c0, 18, 8, 0.6, 0.6, 1.2); S.scene.add(c.lamp, c.lamp.target); S.tankAt(3.6, -9, -0.25); },
    run(S, c, t) { const z = K(t, [[0, 4.2], [5.0, -3.4]]), p = new V3(Math.sin(t * 0.8) * 0.25, 0.5, z), f = t < 5.2 ? new V3(Math.sin(t * 1.6) * 0.5, 0, -1).normalize() : new V3().subVectors(S.tankP(), p).setY(0).normalize(); S.dv(p, f);
      c.lamp.position.copy(p).add(new V3(0, 0.95, 0)); c.lamp.target.position.copy(p).addScaledVector(f, 3).setY(0.3);
      c.cr.forEach((g, i) => { const d = g.position.z - z; g.userData.setLit(sm01((1.2 - d) / 0.8) * (0.85 + 0.15 * Math.sin(S.time * 3 + i))); });
      S.cam(K(t, [[0, [2.0, 1.3, 6.4]], [5.0, [1.8, 1.2, -0.8]], [6.8, [1.6, 1.1, -0.6]]]), K(t, [[0, [0, 0.8, 3]], [5.0, [0, 0.8, -3.6]], [6.8, [2.2, 0.9, -7]]]));
      return { mode: t < 5 ? 'walk' : 'stand', speed: 1.3, arms: 'wave', armK: sm01((t - 5.5) / 0.4), face: f }; } };
  // 12: a choir of giant clams opens one after another; the diver claps along
  RECIPES.clams = { dur: 6.8, set: { dark: 0.3 }, setup(S, c) { c.cl = []; for (let i = 0; i < 5; i++) { const g = S.add(makeClam([0xc59ae8, 0xf0a0c8, 0x9ad0f0][i % 3])); const a = -0.9 + i * 0.45; g.position.set(Math.sin(a) * 2.6, 0, -1.2 - Math.cos(a) * 1.6); g.rotation.y = -a + Math.PI / 2; g.scale.setScalar(1.1); c.cl.push(g); c.rung = c.rung || []; }
      S.tankAt(4.4, -11, -0.3); S.clear.push([0, -1, 3.2]); },
    run(S, c, t) { c.cl.forEach((g, i) => { const k = sm01((t - 0.8 - i * 0.55) / 0.35) * (0.85 + 0.15 * Math.sin(S.time * 4 + i)); g.userData.setOpen(k); if (k > 0.5 && !c.rung[i] && !S.probe) { c.rung[i] = true; try { Audio.pearl(i); } catch (er) {} } });
      const p = new V3(0, 0.5 + (t > 4 ? Math.abs(Math.sin(t * 4)) * 0.06 : 0), 0.6), f = t < 4.6 ? new V3(0, 0, -1) : new V3(0.25, 0, -1).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [0.3, 2.2, 4.2]], [4.0, [1.6, 1.2, 3.2]], [6.8, [2.0, 1.0, 2.6]]]), K(t, [[0, [0, 0.4, -1.5]], [4.0, [0, 0.6, -1.2]], [6.8, [1.8, 0.9, -4]]]));
      return { mode: 'stand', arms: t > 3.6 ? 'clap' : null, armK: sm01((t - 3.7) / 0.3), face: f }; } };
  // 13: tiny glowing jellies circle the floating diver
  RECIPES.glimmer = { dur: 6.6, set: { dark: 0.5 }, setup(S, c) { c.j = []; for (let i = 0; i < 18; i++) { const j = S.add(makeJelly()); j.scale.setScalar(0.45 + (i % 3) * 0.12); const gl = glowSpr([0xff9ae0, 0x9ae8ff, 0xfff09a][i % 3], 0.8, 0.5); j.add(gl); c.j.push(j); } S.tankAt(4.0, -10, -0.3); S.clear.push([0, 0, 2]); },
    run(S, c, t) { const lift = sm01((t - 0.6) / 3), p = new V3(0, 0.5 + lift * 1.3 + Math.sin(S.time * 1.4) * 0.05, 0); c.j.forEach((j, i) => { const a = S.time * (0.5 + (i % 4) * 0.12) + i * 0.35, r = 1.3 + (i % 5) * 0.32; j.position.set(Math.cos(a) * r * (0.4 + 0.6 * sm01(t / 2)), p.y - 0.4 + (i % 6) * 0.3 + Math.sin(a * 2) * 0.2, Math.sin(a) * r * (0.4 + 0.6 * sm01(t / 2))); });
      const f = new V3(Math.sin(t * 0.5) * 0.3 + 0.3, 0, 1).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [0, 0.9, 4.4]], [3.4, [2.4, 1.8, 3.4]], [6.6, [2.2, 1.9, 3.0]]]), K(t, [[0, [0, 0.9, 0]], [3.4, [0, 1.6, 0]], [6.6, [1.2, 1.6, -2]]]));
      return { mode: 'float', arms: 'cheer', armK: 0.3 + 0.7 * sm01((t - 1.2) / 1), face: f }; } };
  // 14: riding a manta over the canyon
  RECIPES.manta = { dur: 7.0, set: { trench: 5, dark: 0.2 }, setup(S, c) { c.m = S.add(makeManta()); c.m.scale.setScalar(1.25); S.tankAt(5.4, -13, -0.42); S.clear.push([0, -4, 5]); },
    run(S, c, t) { const mp = K(t, [[0, [-5, 1.6, 2]], [1.6, [-0.5, 0.7, 0.4]], [2.4, [-0.4, 0.7, 0.2]], [5.8, [3.2, 2.0, -8]], [7, [3.6, 0.9, -9.2]]]); c.m.position.copy(mp);
      const mf = t < 2.4 ? new V3(1, 0, -0.35).normalize() : new V3(0.33, 0, -1).normalize(); c.m.rotation.y = Math.atan2(-mf.z, mf.x); c.m.rotation.z = t > 2.4 && t < 5.8 ? Math.sin(t * 1.5) * 0.12 : 0; c.m.userData.tick(S.time, t > 5.8 ? 0.4 : 1);
      let p; if (t < 2.0) p = new V3(-0.4, 0.5, 1.4); else if (t < 2.6) { const k = (t - 2.0) / 0.6; p = new V3(-0.4, 0.5, 1.4).lerp(mp.clone().setY(mp.y + 0.55), sm01(k)); p.y += Math.sin(k * Math.PI) * 0.5; } else p = mp.clone().setY(mp.y + 0.55);
      const f = t < 2.0 ? new V3(-1, 0, -0.4).normalize() : mf; S.dv(p, f);
      S.cam(K(t, [[0, [1.4, 1.2, 4.0]], [2.6, [1.0, 1.4, 3.4]], [5.8, [1.2, 3.2, -3.6]], [7, [1.0, 2.0, -5.0]]]), K(t, [[0, [-1.5, 0.9, 0]], [2.6, [0, 1, 0]], [5.8, [3.6, 1.7, -9]], [7, [5.0, 1.4, -11]]]));
      return { mode: 'stand', arms: t < 2.6 ? 'wave' : t < 5.8 ? 'grip' : 'wave', armK: t < 2.0 ? sm01((t - 0.9) / 0.4) : t < 2.6 ? 0 : t < 5.8 ? 1 : sm01((t - 6) / 0.4), face: f }; } };
  // 15: a huge eye opens in the dark; something big slides away; Pip hides behind the diver
  RECIPES.shadow = { dur: 7.0, set: { dark: 0.8 }, setup(S, c) { c.o = S.add(makeOctopus(0x3a2266)); c.o.position.set(-0.6, 0.2, -8.0); c.o.rotation.y = -Math.PI / 2 + 0.15; c.o.scale.setScalar(1.7); c.eg = c.o.userData.eyes.map(E => { const g = glowSpr(0xfff3a0, 0.9, 0); g.position.z = 0.2; E.eg.add(g); return g; });
      c.pip = S.add(makePip(0xffc23a, S.glow)); for (let i = 0; i < 5; i++) { const r = S.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.4 + (i % 2) * 0.5, 1), SM({ color: 0x2a2440, roughness: 1, flatShading: true }))); r.position.set(-4 + i * 1.8, 0.6 + (i % 2) * 0.6, -6.8 - (i % 3) * 0.4); } S.tankAt(4.2, -8.5, -0.3); S.clear.push([0, -2, 3]); },
    run(S, c, t) { const open = sm01((t - 1.4) / 0.4) * (1 - sm01((t - 2.6) / 0.12) * (1 - sm01((t - 2.8) / 0.12))) * (1 - sm01((t - 4.4) / 0.6)); c.o.userData.setSad(1 - open); c.eg.forEach(g => { g.material.opacity = open * 0.9; }); c.o.position.x = -0.6 - sm01((t - 4.2) / 1.6) * 4; c.o.position.y = 0.2 - sm01((t - 4.2) / 1.2) * 2.5; c.o.userData.tick(S.time, 0.6);
      const p = K(t, [[0, [0.6, 0.5, 1.6]], [1.4, [0.4, 0.5, 0.2]], [2.6, [0.4, 0.5, 0.2]], [3.4, [0.7, 0.5, 0.9]]]), f = new V3(-0.15, 0, -1).normalize(); S.dv(p, f);
      c.pip.position.copy(p).add(new V3(t > 2.6 ? 0.25 : -0.6, 0.9 - (t > 2.6 ? 0.35 : 0), t > 2.6 ? 0.45 : -0.3)); c.pip.rotation.y = t > 2.6 ? 1.2 : -1.4; c.pip.userData.tick(S.time * (t > 2.6 ? 3 : 1));
      S.cam(K(t, [[0, [2.6, 1.1, 3.8]], [2.4, [1.6, 0.9, 2.6]], [7, [2.2, 1.0, 3.0]]]), K(t, [[0, [-0.4, 0.9, -3]], [2.4, [-0.6, 1.1, -5]], [7, [1.6, 0.9, -5.6]]]));
      return { mode: t < 1.4 || (t > 2.6 && t < 3.4) ? 'walk' : 'stand', speed: t > 2.6 ? -0.8 : 0.6, arms: t > 4.6 ? 'point' : null, armK: sm01((t - 4.8) / 0.5), face: f, target: c.o.position.clone().add(new V3(0, 1.5, 0)) }; } };
  // 16: swimming through the coral arch as its lamps wake
  RECIPES.arch = { dur: 6.6, set: { dark: 0.35 }, setup(S, c) { c.a = S.add(makeArch(11)); c.a.position.set(0, 0.2, -1.6); for (const [x, n, h] of [[-2.6, 'coral1', 0.9], [-2.2, 'coral3', 0.7], [2.3, 'coral4', 0.8], [2.7, 'weed5', 1.0], [-2.8, 'weed3', 1.1]]) S.spr(n, h, x, -1.4, 0.4); S.tankAt(4.6, -11, -0.32); S.clear.push([0, -1.6, 2.6]); },
    run(S, c, t) { const z = K(t, [[0, 3.4], [3.6, -2.2], [4.6, -2.4]]), p = new V3(Math.sin(t) * 0.2, K(t, [[0, 1.2], [3.6, 1.0], [4.6, 0.5]]), z); c.a.userData.setLit(sm01((1.8 - (z + 1.6)) / 3.2));
      const f = t < 4.2 ? new V3(0, 0, -1) : new V3(0, 0, 1).lerp(new V3(1, 0, 0.4), 0.3).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [1.6, 1.3, 6.0]], [3.6, [1.0, 1.4, 2.6]], [6.6, [1.4, 1.2, 3.2]]]), K(t, [[0, [0, 1.3, 0]], [3.6, [0, 1.4, -2]], [6.6, [0.6, 1.4, -2]]]));
      return { mode: t < 3.6 ? 'swim' : 'stand', speed: 1.5, arms: 'cheer', armK: sm01((t - 4.6) / 0.5), face: f }; } };
  // 17: buried pearls float up like lanterns
  RECIPES.pearls = { dur: 6.6, set: { dark: 0.45 }, setup(S, c) { c.p = []; for (let i = 0; i < 14; i++) { const b = S.add(makeBall(true)); b.scale.setScalar(0.4 + (i % 3) * 0.08); const gl = glowSpr(0xff6a5a, 1.0, 0.55); b.add(gl); const a = i * 2.39, r = 0.9 + (i % 5) * 0.55; b.userData.o = [Math.cos(a) * r, Math.sin(a) * r - 1, 0.6 + (i % 4) * 0.4]; c.p.push(b); } S.tankAt(4.2, -10, -0.3); },
    run(S, c, t) { c.p.forEach((b, i) => { const [x, z, d] = b.userData.o, k = Math.max(0, t - 0.6 - i * 0.12); b.position.set(x + Math.sin(S.time + i) * 0.12 * Math.min(1, k), 0.15 + k * d, z); });
      const p = new V3(0, 0.5, 0.4), f = new V3(0.2, 0, 1).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [0.6, 1.0, 3.6]], [6.6, [1.6, 0.6, 3.2]]]), K(t, [[0, [0, 0.8, 0]], [6.6, [0.4, 2.6, -1]]]));
      return { mode: 'stand', arms: 'cheer', armK: sm01((t - 0.6) / 0.5), face: f }; } };
  // 18: Pip and three cousins race the diver
  RECIPES.race = { dur: 6.4, setup(S, c) { c.h = [0xffc23a, 0xff7ab8, 0x7ae0ff, 0xa8ff7a].map((col, i) => S.add(makePip(col, i ? 0.4 : S.glow))); S.tankAt(4.0, -10, -0.3); S.clear.push([0, 0, 4]); },
    run(S, c, t) { const x = K(t, [[0, -7], [4.2, 1.0], [5.0, 1.4]]); c.h.forEach((h, i) => { const lead = [0.6, -0.2, 0.3, -0.5][i] + Math.sin(S.time * 2 + i) * 0.25; h.position.set(x + lead + (t > 4.2 ? Math.cos(S.time * 2 + i) * 0.4 : 0), 1.0 + i * 0.25 + Math.sin(S.time * 3 + i) * 0.1, -0.8 + i * 0.5); h.rotation.y = t < 4.2 ? 0 : S.time * 3 + i; h.userData.tick(S.time * 1.5 + i); });
      const p = new V3(x, t < 4.2 ? 1.0 : K(t, [[4.2, 1.0], [5.0, 0.5]]), 0.6), f = t < 4.4 ? new V3(1, 0, 0) : new V3(0.2, 0, 1).normalize(); S.dv(p, f, t < 4.2 ? -0.1 : 0);
      S.cam(t < 4.2 ? new V3(x + 0.8, 1.3, 4.2) : K(t, [[4.2, [x + 0.8, 1.3, 4.2]], [6.4, [2.2, 1.1, 3.6]]]), t < 4.2 ? new V3(x + 0.3, 1.1, 0) : new V3(1.4, 1.1, -0.6));
      return { mode: t < 4.2 ? 'swim' : 'stand', speed: 2.6, arms: 'cheer', armK: sm01((t - 4.5) / 0.4), face: f }; } };
  // 19: the first sight of the Great Lantern, dark, far below
  RECIPES.lanternview = { dur: 6.8, set: { cliff: -10, dark: 0.35 }, setup(S, c) { c.tw = S.add(makeTower(18, 0)); c.tw.position.set(7, -10, -26); c.pip = S.add(makePip(0xffc23a, S.glow)); S.tankAt(-4.6, -9, 0.4, -10); S.clear.push([0, 0, 3]); },
    run(S, c, t) { const p = K(t, [[0, [-1.2, 0.5, 1.8]], [2.4, [0.1, 0.5, -1.4]]]), f = new V3(0.3, 0, -1).normalize(); S.dv(p, f); c.pip.position.set(p.x + 0.65, 1.3 + Math.sin(S.time * 2) * 0.06, p.z + 0.2); c.pip.rotation.y = 0.9; c.pip.userData.tick(S.time);
      S.cam(K(t, [[0, [1.6, 1.1, 3.6]], [2.4, [1.0, 1.3, 0.6]], [6.8, [-0.6, 1.5, 0.9]]]), K(t, [[0, [0, 0.8, -2]], [2.4, [2, 0, -10]], [6.8, [5.6, -1.5, -24]]]));
      return { mode: t < 2.4 ? 'walk' : 'stand', speed: 1.2, arms: t > 3.6 ? 'point' : null, armK: sm01((t - 3.8) / 0.5), face: f, target: c.tw.position.clone().add(new V3(0, 10, 0)) }; } };
  // 20: a little light bobs in the dark: Lumen the anglerfish
  RECIPES.angler = { dur: 7.0, set: { dark: 0.85 }, setup(S, c) { c.a = S.add(makeAngler()); S.tankAt(3.6, -9, -0.25); S.clear.push([0, -2, 3]); },
    run(S, c, t) { const ap = K(t, [[0, [-1.2, 1.6, -6]], [2.6, [-0.6, 1.2, -1.6]], [4.4, [-0.3, 1.2, -1.4]], [7, [1.8, 1.1, -4.6]]]); c.a.position.copy(ap); c.a.position.y += Math.sin(S.time * 2) * 0.08;
      const af = t < 4.4 ? new V3(0.2, 0, 1).normalize() : new V3(0.6, 0, -1).normalize(); c.a.rotation.y = Math.atan2(-af.z, af.x); if (c.a.userData.tail) c.a.userData.tail.rotation.y = Math.sin(S.time * 6) * 0.4;
      const p = K(t, [[0, [0, 0.5, 0.8]], [2.4, [0, 0.5, 0.8]], [2.8, [0.15, 0.5, 1.1]], [4.4, [0.15, 0.5, 1.1]], [7, [1.0, 0.5, -2.6]]]), f = t < 4.4 ? new V3(-0.25, 0, -1).normalize() : new V3(0.4, 0, -1).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [1.4, 1.0, 3.2]], [4.4, [1.6, 1.0, 3.0]], [7, [2.2, 1.1, 1.2]]]), K(t, [[0, [-0.6, 1.1, -3]], [4.4, [-0.4, 1.0, -1.2]], [7, [2.0, 0.9, -6]]]));
      return { mode: t > 4.4 ? 'walk' : 'stand', speed: 1, arms: t > 3 && t < 4.6 ? 'wave' : null, armK: sm01((t - 3.1) / 0.3) * (1 - sm01((t - 4.4) / 0.2)), face: f }; } };
  // 21: a whale passes overhead singing
  RECIPES.whale = { dur: 7.0, set: { dark: 0.6 }, setup(S, c) { c.wh = S.add(makeWhale()); c.wh.scale.setScalar(1.2); S.tankAt(4.4, -10, -0.3); S.clear.push([0, 0, 2], [2.4, 1.4, 1.2]); c.clack = S.add(makeCrab()); c.clack.add(makeCapHat()); c.clack.scale.setScalar(1.2); },
    run(S, c, t) { c.wh.position.set(K(t, [[0, -16], [7, 3.5]]), 8.5 + Math.sin(t * 0.6) * 0.3, -6); c.wh.rotation.y = 0.15; c.wh.userData.tick(S.time);
      const p = new V3(0, 0.5, 0.6), f = new V3(Math.sin(t * 0.35) * 0.6, 0, -1).normalize(); S.dv(p, f);
      { const C = c.clack, k = sm01((t - 2.0) / 1.2), cp = new V3(3.6, 0, 1.6).lerp(new V3(0.9, 0, 1.15), k); cp.y = S.groundY(cp.x, cp.z) + 0.26 + (k < 1 ? Math.abs(Math.sin(S.time * 14)) * 0.05 : 0); C.position.copy(cp); C.visible = t > 1.9;
        const d = new V3().subVectors(S.cam0.position, cp).setY(0); C.rotation.set(0, k < 1 ? -Math.PI / 2 : Math.atan2(d.x, d.z), 0); }
      if (t > 1.6 && !c.sang && !S.probe) { c.sang = true; try { Audio.play('gateOpen'); } catch (er) {} }
      S.cam(K(t, [[0, [1.4, 0.6, 3.4]], [7, [1.8, 0.7, 3.2]]]), K(t, [[0, [-0.4, 3.0, -2]], [4.6, [0.4, 4.2, -3]], [7, [1.4, 2.0, -4]]]));
      return { mode: 'stand', arms: t > 2.2 ? 'wave' : null, armK: sm01((t - 2.3) / 0.4), face: f, look: c.wh.position }; } };
  // 22: walking the sunken city; columns light up as the diver passes
  RECIPES.ruins = { dur: 6.8, set: { dark: 0.6 }, setup(S, c) { c.c = []; for (let i = 0; i < 8; i++) { const side = i % 2 ? 1 : -1, col = S.add(makeColumn(2.6 + (i % 3) * 0.7, i % 4 === 3)); col.position.set(side * 2.3, 0, 3.4 - Math.floor(i / 2) * 1.9); c.c.push(col); } S.tankAt(3.4, -10, -0.2); },
    run(S, c, t) { const z = K(t, [[0, 4.6], [5.0, -2.8]]), p = new V3(0, 0.5, z), f = t < 5.2 ? new V3(0, 0, -1) : new V3().subVectors(S.tankP(), p).setY(0).normalize(); S.dv(p, f);
      c.c.forEach(col => col.userData.setLit(sm01((1.6 - (col.position.z - z)) / 1.2)));
      S.cam(K(t, [[0, [0.6, 2.2, 8.2]], [5.0, [0.5, 1.5, 0.6]], [6.8, [0.4, 1.2, 0.8]]]), K(t, [[0, [0, 0.8, 3]], [5.0, [0, 0.9, -3]], [6.8, [2.4, 1.0, -7]]]));
      return { mode: t < 5 ? 'walk' : 'stand', speed: 1.4, arms: 'cheer', armK: sm01((t - 5.4) / 0.4), face: f }; } };
  // 23: Shelly again, glowing in the deep; seen riding straight at the camera, then from the side
  RECIPES.turtle2 = { dur: 6.8, set: { dark: 0.55 }, setup(S, c) { c.tu = S.add(makeTurtle(true)); c.tu.scale.setScalar(1.35); S.tankAt(-3.6, -9, 0.4); S.clear.push([0, -2, 4]); },
    run(S, c, t) { const tp = K(t, [[0, [0.8, 1.6, -8]], [3.4, [0.3, 1.3, -1.4]], [5.4, [-1.8, 0.9, -4.0]], [6.8, [-2.0, 0.6, -5.0]]]); c.tu.position.copy(tp); const tf = t < 3.4 ? new V3(0, 0, 1) : new V3(-0.55, 0, -1).normalize(); c.tu.rotation.y = Math.atan2(-tf.z, tf.x); c.tu.userData.tick(S.time, 1.5);
      const p = tp.clone().setY(tp.y + 0.62); S.dv(p, tf); S.cam(t < 3.4 ? new V3(0.4, 1.4, 2.6) : K(t, [[3.4, [2.2, 1.6, 1.4]], [6.8, [1.2, 1.3, -1.2]]]), t < 3.4 ? tp.clone().add(new V3(0, 0.5, 0)) : tp.clone().add(new V3(-0.6, 0.5, -1.2)));
      return { mode: 'stand', arms: t < 5.4 ? 'grip' : 'wave', armK: t < 5.4 ? 1 : sm01((t - 5.6) / 0.4), face: tf }; } };
  // the prologue (the first thing a player sees): the reef's night festival under the Great Lantern; Grimtide erupts from the abyss and
  // drinks the lights; the Reef Keeper (the diver model, on her rock) gives all her light to the Lantern and drives him off; then darkness,
  // and little Pip alone. The intro film then cuts into the level-1 tank, where a new lamp clicks on.
  RECIPES.prologue = { dur: 16, set: { dark: 0.85, night: 0.9 }, setup(S, c) {
      c.tw = S.add(makeTower(30, 1)); c.tw.position.set(-3.5, 0, -19);
      c.pip = S.add(makePip(0xffc23a, 1));
      c.crabs = [0, 1, 2].map(() => { const cr = S.add(makeCrab()); cr.scale.setScalar(0.9); const pe = makeBall(true); pe.scale.setScalar(0.4); pe.position.y = 0.34; cr.add(pe); const gl = glowSpr(0xff8a5a, 0.9, 0.6); gl.position.y = 0.34; cr.add(gl); cr.userData.gl = gl; return cr; });
      c.js = [0, 1, 2, 3].map(i => { const j = S.add(makeJelly()); j.scale.setScalar(0.7); const gl = glowSpr([0xff9ae0, 0x9ae8ff, 0xfff09a, 0xb8ff9a][i], 1.2, 0.6); j.add(gl); j.userData.gl = gl; return j; });
      c.eel = S.add(makeEel(42, 2.1)); c.eel.visible = false;
      c.motes = []; for (let i = 0; i < 26; i++) { const m = glowSpr([0xffd27a, 0xff9ae0, 0x9ae8ff][i % 3], 0.35, 0.7); S.scene.add(m); c.motes.push({ m, p0: new V3((Math.random() - 0.5) * 10, 0.4 + Math.random() * 3, -2 - Math.random() * 8), d: Math.random() * 0.8 }); }
      const bm = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); S.mats.push(bm);
      c.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, 1, 16, 1, true), bm); S.scene.add(c.beam);
      c.lamp = glowSpr(0xfff2c0, 1.4, 0); S.scene.add(c.lamp); c.lampL = new THREE.PointLight(0xfff0c0, 0, 10, 1.4); S.scene.add(c.lampL);
      c.rock = S.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 1), SM({ color: 0x5a5068, roughness: 1, flatShading: true }))); c.rock.position.set(4.2, 0.1, -5.4); c.rock.scale.set(1.3, 0.7, 1.1);
      S.clear.push([0, 0, 4], [4.2, -5.4, 2.5], [-3.5, -19, 5], [6, -1.6, 2]); },
    run(S, c, t) { const T0 = c.tw.position, mouthP = new V3(-1, 6, -13);
      const drink = sm01((t - 6.6) / 3.2), dark = sm01((t - 12.4) / 1.6), keeperK = sm01((t - 10.8) / 0.5), panic = sm01((t - 6.2) / 0.6);
      // festival: jellies bob, crabs march with their glowing pearls (and scatter when he comes)
      c.js.forEach((j, i) => { j.position.set(-3 + i * 2.1, 1.4 + (i % 2) * 0.8 + Math.sin(S.time * 1.2 + i) * 0.2, -4 - (i % 2) * 2.5); j.userData.gl.material.opacity = 0.6 * (1 - drink); });
      c.crabs.forEach((cr, i) => { const x = -2.5 + i * 0.8 + Math.min(t, 6.2) * 0.25 + panic * (t - 6.2) * (i % 2 ? 2.2 : -2.2), z = -2.2 - i * 0.3; cr.position.set(x, S.groundY(x, z) + 0.22 + Math.abs(Math.sin(S.time * 7 + i)) * 0.04, z); cr.rotation.y = panic > 0.5 ? (i % 2 ? 0 : Math.PI) : -Math.PI / 2; cr.userData.gl.material.opacity = 0.6 * (1 - drink); });
      // Grimtide erupts from the abyss in front of the Lantern, coils and opens his jaws; every light streams into his mouth
      const rise = sm01((t - 4.6) / 1.8), back = sm01((t - 11.6) / 1.6); c.eel.visible = t > 4.5 && back < 0.99;
      if (c.eel.visible) { c.eel.userData.pose((u, tt) => { const a = u * 7 + tt * 0.6, r = 3.2 + u * 1.5; return new V3(T0.x + 2.5 + Math.cos(a) * r * (0.4 + 0.6 * u), -9 + (rise * 16 - back * 18) * (1 - u * 0.55) + Math.sin(u * 9 - tt * 2) * 0.9, T0.z + 9 + Math.sin(a) * r * 0.6); }, S.time); // towering, just in front of the Lantern
        c.eel.userData.setGlow(1 - back * 0.8); c.eel.userData.head.getWorldPosition(mouthP); c.eel.userData.jaw.rotation.x += drink * (1 - back) * 0.6; }
      if (t > 4.9) S.fx('erupt', 'roar'); if (t > 6.4) S.fx('crack', 'thunder');
      c.motes.forEach((q, i) => { const k = sm01((t - 6.6 - q.d) / 2.6); q.m.material.opacity = k >= 0.99 ? 0 : 0.7; q.m.position.copy(q.p0).lerp(mouthP, k); q.m.position.y += Math.sin(S.time * 1.4 + i) * 0.15 * (1 - k); });
      // the Lantern dims as he drinks; the Keeper's gift blazes it up for a heartbeat, then the whole reef goes dark
      const gift = sm01((t - 11.2) / 0.5) * (1 - sm01((t - 12.6) / 1.4));
      c.tw.userData.big.material.opacity = 0.8 * Math.max(1 - drink * 0.75, gift) * (1 - dark * 0.92); c.tw.userData.lens.material.emissiveIntensity = 2 * Math.max(1 - drink * 0.8, gift * 1.6) * (1 - dark * 0.9);
      S.key.intensity = ((3.2 * (1 - S.dark * 0.75) + 0.2) * (1 - drink * 0.5) + gift * 6) * (1 - dark * 0.85) + 0.1; S.nightK = 0.9 + dark * 0.1 - gift * 0.5; if (t > 11.2) S.fx('gift', 'flash');
      // the Keeper on her rock: lamp up, a beam of light to the Lantern
      const kp = new V3(4.2, c.rock.position.y + 0.55, -5.4), kf = new V3().subVectors(T0, kp).setY(0).normalize(); S.dv(kp, kf);
      const lampP = kp.clone().add(new V3(kf.x * 0.25, 1.35 + keeperK * 0.35, kf.z * 0.25)); c.lamp.position.copy(lampP); c.lamp.material.opacity = (0.5 + gift * 0.5) * (t > 9.4 ? 1 : 0) * (1 - dark);
      c.lampL.position.copy(lampP); c.lampL.intensity = ((t > 9.4 ? 4 : 0) + gift * 20) * (1 - dark);
      { const to = T0.clone().add(new V3(0, 12.7, 0)), L = lampP.distanceTo(to); c.beam.position.copy(lampP).lerp(to, 0.5); c.beam.scale.set(1, L, 1); c.beam.lookAt(to); c.beam.rotateX(Math.PI / 2); c.beam.material.opacity = Math.min(1, gift * 1.1); }
      // Pip: loops of joy at the festival, hides when Grimtide comes, then alone and dim in the dark
      const pp = t < 5.2 ? new V3(-0.6 + Math.cos(t * 2.4) * 0.8, 1.3 + Math.sin(t * 2.4) * 0.5, 1.2) : t < 13.6 ? new V3(-1.2, 0.5 + Math.sin(S.time * 9) * 0.02, 0.4) : new V3(-0.4, 0.8 + Math.sin(S.time * 1.4) * 0.05, 1.4);
      c.pip.position.lerp(pp, t < 0.05 ? 1 : 0.12); c.pip.rotation.y = t < 5.2 ? -t * 2.4 : 0.4; c.pip.userData.setGlow(t < 5.2 ? 1 : t < 13.6 ? 1 - drink * 0.9 : 0.06); c.pip.userData.tick(S.time * (t < 5.2 ? 2 : 1));
      // cameras: drift through the festival; low and looking up at the eruption; the Keeper; then close on Pip in the dark
      if (t < 4.6) S.cam(K(t, [[0, [2.6, 1.4, 6.5]], [4.6, [1.2, 1.5, 4.2]]]), K(t, [[0, [-1.5, 2.6, -8]], [4.6, [-0.8, 1.6, 0]]]));
      else if (t < 9.6) S.cam(K(t, [[4.6, [2.2, 0.4, 5]], [9.6, [3.0, 0.6, 4]]]), K(t, [[4.6, [-1.6, 4, -12]], [9.6, [-1.5, 6.5, -13]]]));
      else if (t < 13.4) S.cam(K(t, [[9.6, [6.6, 0.9, -0.9]], [11.6, [6.2, 0.9, -1.3]], [13.4, [6.0, 1.1, -1.2]]]), K(t, [[9.6, [4.0, 1.6, -5.6]], [11.6, [3.9, 1.8, -5.8]], [13.4, [-0.5, 4.5, -13]]])); // the Keeper in silhouette, Grimtide looming behind her
      else S.cam(K(t, [[13.4, [0.6, 1.0, 3.8]], [16, [0.1, 0.9, 2.9]]]), K(t, [[13.4, [-0.4, 0.8, 1.4]], [16, [-0.4, 0.8, 1.4]]]));
      return { mode: 'stand', arms: t > 10.8 ? 'hold' : null, armK: keeperK, lift: 1, face: kf }; } };
  // 25: Clack lies on his back in the sand, his hat beside him; the diver kneels with him; his claws go still; Shelly glides down out of the dark
  RECIPES.farewell = { dur: 8.4, set: { dark: 0.62 }, setup(S, c) { c.clack = S.add(makeCrab()); c.clack.scale.setScalar(1.2); c.hat = S.add(makeCapHat()); c.hat.scale.setScalar(1.25); c.tu = S.add(makeTurtle(true)); c.tu.scale.setScalar(1.35);
      c.soft = new THREE.PointLight(0xffd8a8, 5, 6, 1.5); c.soft.position.set(0.3, 1.7, 0.8); S.scene.add(c.soft); S.tankAt(-3.8, -10, 0.4); S.clear.push([0, 0, 3]); },
    run(S, c, t) { const cp = new V3(0.05, 0, 0.1); cp.y = S.groundY(cp.x, cp.z) + 0.16; c.clack.position.copy(cp); c.clack.rotation.set(0, 0.5, Math.PI * 0.92);
      const die = sm01((t - 4.6) / 0.6); if (c.clack.userData.claws) c.clack.userData.claws.forEach((cl, i) => { cl.rotation.z = (i ? -1 : 1) * (0.5 - die * 0.9) + Math.sin(S.time * 3) * 0.08 * (1 - die); });
      if (t > 4.7 && t < 6.2 && Math.random() < 0.5) S.parts.emit(cp.x, cp.y + 0.3 + (t - 4.7) * 0.5, cp.z, 1, { color: new THREE.Color(1, 0.85, 0.5), speed: 0.2, life: 1.6, size: 0.12, spread: 0.06 });
      const tp = K(t, [[0, [-1.5, 6.5, -7]], [5.0, [-1.5, 6.5, -7]], [6.1, [-1.25, 0.5, -0.7]], [8.4, [-1.25, 0.45, -0.7]]]); c.tu.position.copy(tp); c.tu.rotation.y = -0.63; c.tu.userData.tick(S.time, t > 6.1 ? 0.6 : 1.6); c.tu.visible = t > 4.9;
      const stand = sm01((t - 6.6) / 0.8), p = new V3(0.75, 0.5, 0.75), f = t < 6.3 ? new V3().subVectors(cp, p).setY(0).normalize() : new V3().subVectors(tp, p).setY(0).normalize(); S.dv(p, f, 0.45 * (1 - stand));
      if (t < 6.8) { const hx = 0.62, hz = 0.42; c.hat.position.set(hx, S.groundY(hx, hz) + 0.06, hz); c.hat.rotation.set(0.3, 0.6, 0.25); } else { c.hat.position.copy(p).add(new V3(f.x * 0.35, 0.85, f.z * 0.35)); c.hat.rotation.set(0, 0, 0); }
      S.cam(K(t, [[0, [2.6, 1.2, 2.8]], [4.6, [1.7, 0.9, 1.9]], [6.0, [2.4, 1.3, 2.8]], [8.4, [2.6, 1.2, 3.0]]]), K(t, [[0, [0.2, 0.4, 0.1]], [4.6, [0.3, 0.4, 0.2]], [6.0, [-0.5, 0.8, -0.4]], [8.4, [-0.3, 0.8, -0.2]]]));
      return { mode: 'stand', arms: t < 6.6 ? 'offer' : 'hold', armK: t < 6.6 ? 0.8 : 1, lift: 0.5, face: f }; } };
  // 24: Murk's den, full of pearls; he looks sad and scared
  RECIPES.murkden = { dur: 7.0, set: { dark: 0.6 }, setup(S, c) { c.o = S.add(makeOctopus(0x8a4fd8)); c.o.position.set(0, -0.2, -4.4); c.o.rotation.y = -Math.PI / 2 + 0.25; c.o.scale.setScalar(1.3); c.o.userData.setSad(0.9);
      for (let i = 0; i < 12; i++) { const b = S.add(makeBall(true)); b.scale.setScalar(0.35); const a = i * 0.55 - 3, r = 2.0 + (i % 3) * 0.3; b.position.set(Math.sin(a) * r, 0.15, -4.4 + Math.cos(a) * r * 0.6 + 0.5); }
      for (let i = 0; i < 6; i++) { const r = S.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 1), SM({ color: 0x3a3050, roughness: 1, flatShading: true }))); r.position.set(-4.4 + i * 1.8, 1.4 + (i % 2) * 0.8, -6.6); } S.tankAt(4.6, -9, -0.3); S.clear.push([0, -2, 3]); },
    run(S, c, t) { c.o.userData.tick(S.time, 0.5); const p = K(t, [[0, [0.8, 0.5, 2.4]], [3.6, [0.3, 0.5, -1.2]]]), f = new V3(-0.1, 0, -1).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [2.4, 1.6, 4.4]], [3.6, [2.0, 1.2, 1.4]], [7, [2.4, 1.1, 1.2]]]), K(t, [[0, [0, 1.0, -3]], [3.6, [0, 1.3, -4]], [7, [-0.4, 1.4, -4.6]]]));
      return { mode: t < 3.6 ? 'walk' : 'stand', speed: 0.7, arms: t > 4.2 ? 'reach' : null, armK: sm01((t - 4.3) / 0.6), face: f, target: c.o.position.clone().add(new V3(0, 1.2, 0)) }; } };
  // 25: the diver gives Murk a glowing pearl; Murk lights up and smiles
  RECIPES.gift = { dur: 7.0, set: { dark: 0.55 }, setup(S, c) { c.o = S.add(makeOctopus(0x8a4fd8)); c.o.position.set(-0.4, -0.2, -3.6); c.o.rotation.y = -Math.PI / 2 + 0.45; c.o.scale.setScalar(1.25); c.pe = S.add(makeBall(true)); c.pe.scale.setScalar(0.5); c.pe.add(glowSpr(0xff7a6a, 1.4, 0.7));
      c.gl = new THREE.PointLight(0xffa080, 0, 8, 1.4); S.scene.add(c.gl); S.tankAt(4.2, -9, -0.3); S.clear.push([0, -1, 3]); },
    run(S, c, t) { const p = new V3(0.6, 0.5, 0.2), f = new V3(-0.3, 0, -1).normalize(); S.dv(p, f); const fly = sm01((t - 1.8) / 1.6), hand = p.clone().add(new V3(-0.1, 0.75, -0.25)), mouth = c.o.position.clone().add(new V3(0.3, 0.9, 1.1));
      c.pe.position.copy(hand.clone().lerp(mouth, fly)); c.pe.position.y += Math.sin(fly * Math.PI) * 0.6; c.pe.visible = fly < 0.98; const happy = sm01((t - 3.5) / 0.6); c.o.userData.setSad(0.9 * (1 - happy)); c.gl.position.copy(c.o.position).add(new V3(0.5, 1.6, 1.2)); c.gl.intensity = happy * 5;
      c.o.userData.tick(S.time, 0.6 + happy); c.o.userData.tents[0].rotation.z = happy * (0.6 + Math.sin(S.time * 6) * 0.4);
      S.cam(K(t, [[0, [2.4, 1.2, 2.8]], [3.4, [2.2, 1.6, 2.6]], [7, [2.8, 1.3, 2.4]]]), K(t, [[0, [0, 1.1, -1.5]], [3.4, [-0.2, 1.6, -3]], [7, [-0.4, 1.4, -3.2]]]));
      return { mode: 'stand', arms: t < 2 ? 'offer' : 'wave', armK: t < 2 ? sm01((t - 0.4) / 0.5) : sm01((t - 4.2) / 0.4), face: f }; } };
  // 26: Murk carries the diver across the abyss and sets him down
  RECIPES.murkride = { dur: 7.0, set: { trench: 7, dark: 0.55 }, setup(S, c) { c.o = S.add(makeOctopus(0x8a4fd8)); c.o.scale.setScalar(0.9); S.tankAt(4.6, -13, -0.4); S.clear.push([0, -4, 6]); },
    run(S, c, t) { const op = K(t, [[0, [-3.6, 0.0, 1.0]], [1.2, [-3.4, 0.2, 0.8]], [5.6, [2.8, 0.4, -8.6]], [7, [3.0, -0.1, -9.0]]]); c.o.position.copy(op); const of = t < 1.2 ? new V3(1, 0, 0) : new V3(0.6, 0, -1).normalize(); c.o.rotation.y = Math.atan2(-of.z, of.x); c.o.userData.tick(S.time, 1.8); c.o.userData.setSad(0);
      const head = op.clone().add(new V3(0, 2.6, 0)); let p = t < 6 ? head : head.clone().lerp(op.clone().addScaledVector(of, 1.4).setY(0.5 + op.y), sm01((t - 6) / 0.6)); S.dv(p, of);
      S.cam(K(t, [[0, [1.2, 2.2, 4.6]], [5.6, [5.6, 2.8, -4.0]], [7, [5.2, 2.0, -5.2]]]), K(t, [[0, [-3, 1.6, 0.5]], [5.6, [2.8, 1.6, -8.6]], [7, [3.4, 1.3, -9.4]]]));
      return { mode: 'stand', arms: t < 6 ? 'cheer' : 'wave', armK: t < 6 ? 0.6 : sm01((t - 6.3) / 0.4), face: of }; } };
  // 27: waving arms light up the plankton
  RECIPES.plankton = { dur: 6.6, set: { dark: 0.85 }, setup(S, c) { S.tankAt(4.0, -9, -0.3); S.clear.push([0, 0, 2], [-1, 1, 1.2]);
      c.crew = [0, 1, 2].map(i => { const cr = S.add(makeCrab()); cr.scale.setScalar(0.9); return cr; }); c.hat = S.add(makeCapHat()); c.hat.scale.setScalar(1.3); c.hg = glowSpr(0xffd27a, 0.9, 0); c.hat.add(c.hg); c.tu = S.add(makeTurtle(true)); c.tu.scale.setScalar(1.2); },
    run(S, c, t) { const p = new V3(0, 0.5, 0.4), f = new V3(Math.sin(t * 1.2) * 0.5, 0, 1).normalize(); S.dv(p, f);
      c.tu.position.set(1.6, 1.1 + Math.sin(S.time * 0.8) * 0.06, -0.6); c.tu.rotation.y = -2.3; c.tu.userData.tick(S.time, 0.7);
      c.crew.forEach((cr, i) => { const x = -1.5 + i * 0.42, z = 1.05 + (i % 2) * 0.12; cr.position.set(x, S.groundY(x, z) + 0.2 + Math.abs(Math.sin(S.time * 5 + i)) * 0.03, z); cr.rotation.y = 0.35; if (cr.userData.claws) cr.userData.claws.forEach(cl => { cl.rotation.z = 0.6 * sm01((t - 2.9) / 0.6); }); });
      { const up = sm01((t - 2.9) / 0.7), m = c.crew[1].position; c.hat.position.set(m.x, m.y + 0.25 + up * 0.55, m.z); c.hat.rotation.set(0, S.time * 0.6, 0); c.hg.material.opacity = 0.75 * up; }
      if (t > 0.6) for (const sx of [-1, 1]) { const a = t * 4 * sx; S.parts.emit(p.x + Math.cos(a) * 0.55, p.y + 0.6 + Math.sin(a) * 0.45, p.z + 0.15, 2, { color: new THREE.Color().setHSL(0.5 + Math.random() * 0.15, 1, 0.65), speed: 0.4, life: 1.6, size: 0.12, spread: 0.08 }); }
      if (t > 2.4 && Math.random() < 0.7) S.parts.emit((Math.random() - 0.5) * 8, Math.random() * 4, -2 - Math.random() * 6, 3, { color: new THREE.Color().setHSL(0.48 + Math.random() * 0.2, 1, 0.6), speed: 0.15, life: 2.2, size: 0.1, spread: 0.2 });
      S.cam(K(t, [[0, [0.4, 1.0, 3.2]], [6.6, [1.4, 1.1, 3.4]]]), K(t, [[0, [0, 1.0, 0]], [6.6, [0.6, 1.2, -1.5]]]));
      return { mode: 'stand', arms: 'cheer', armK: 0.5 + 0.5 * Math.sin(t * 4), face: f }; } };
  // 28: at the foot of the Great Lantern; 28 of its 30 lights glow
  RECIPES.tower = { dur: 6.8, set: { dark: 0.45 }, setup(S, c) { c.tw = S.add(makeTower(28, 0.12)); c.tw.position.set(-1.2, 0, -6.5); c.pip = S.add(makePip(0xffc23a, S.glow)); S.tankAt(4.6, -10, -0.35); S.clear.push([-1, -5, 3]); },
    run(S, c, t) { const p = K(t, [[0, [1.4, 0.5, 1.8]], [2.6, [0.6, 0.5, -2.0]]]), f = new V3().subVectors(c.tw.position, p).setY(0).normalize(); S.dv(p, f); c.pip.position.set(p.x + 0.7, 1.4 + Math.sin(S.time * 2) * 0.08, p.z + 0.3); c.pip.rotation.y = 2.2; c.pip.userData.tick(S.time);
      S.cam(K(t, [[0, [2.6, 1.0, 3.4]], [2.6, [2.4, 0.8, 0.6]], [6.8, [2.6, 0.7, 0.8]]]), K(t, [[0, [0, 1.2, -2]], [2.6, [-0.8, 4, -6]], [6.8, [-1.0, 7.5, -6.5]]]));
      return { mode: t < 2.6 ? 'walk' : 'stand', speed: 1.2, arms: t > 3.2 ? 'point' : null, armK: sm01((t - 3.4) / 0.5), face: f, target: c.tw.position.clone().add(new V3(0, 12.7, 0)) }; } };
  // 29: Murk brings the Heart Pearl and sets it before the Lantern
  RECIPES.heart = { dur: 7.4, set: { dark: 0.4 }, setup(S, c) { c.tw = S.add(makeTower(29, 0.25)); c.tw.position.set(-3.4, 0, -9); c.o = S.add(makeOctopus(0x8a4fd8)); c.o.scale.setScalar(1.0); c.o.userData.setSad(0);
      c.hp = S.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), SP({ color: 0xfff4f0, emissive: 0xffb0a0, emissiveIntensity: 1.2, roughness: 0.08, iridescence: 1 }))); c.hp.add(glowSpr(0xffd0c0, 3.2, 0.8)); c.hl = new THREE.PointLight(0xffc0a0, 12, 9, 1.3); c.hp.add(c.hl);
      c.ped = S.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.8, 16), SM({ color: 0xc9a25a, metalness: 0.5, roughness: 0.4 }))); c.ped.position.set(-0.6, 0.4, -2.6); c.pip = S.add(makePip(0xffc23a, S.glow)); S.tankAt(4.6, -10, -0.35); S.clear.push([-1, -3, 3.5]); },
    run(S, c, t) { const op = K(t, [[0, [-5, 0, -4]], [3.2, [-1.8, 0, -3.0]], [7.4, [-2.0, 0, -3.2]]]); c.o.position.copy(op); c.o.rotation.y = -0.9; c.o.userData.tick(S.time, 1);
      const set = sm01((t - 3.2) / 1.2); c.hp.position.copy(op.clone().add(new V3(1.0, 1.4, 0.5)).lerp(c.ped.position.clone().add(new V3(0, 0.95, 0)), set)); c.hp.position.y += Math.sin(set * Math.PI) * 0.4;
      const p = new V3(1.0, 0.5, -0.6), f = new V3().subVectors(c.hp.position, p).setY(0).normalize(); S.dv(p, f); c.pip.position.set(1.7, 1.3 + Math.sin(S.time * 2) * 0.08, -0.4); c.pip.rotation.y = 2.4; c.pip.userData.tick(S.time); c.pip.userData.setGlow(0.9);
      S.cam(K(t, [[0, [2.6, 1.4, 3.2]], [4.4, [2.8, 1.2, 2.6]], [7.4, [3.0, 1.1, 2.4]]]), K(t, [[0, [-2, 1.4, -3]], [4.4, [-0.6, 1.3, -2.6]], [7.4, [-1.0, 1.6, -3.4]]]));
      return { mode: 'stand', arms: t > 4.6 ? 'cheer' : null, armK: sm01((t - 4.8) / 0.4), face: f }; } };

  // Grimtide: a giant shadow eel. A chain of shrinking segments posed along a path every frame (pose(fn) with fn(u) -> V3, u = 0 at the
  // head), a fanged jaw, burning red eyes, glowing red spots down his sides and a ragged fin along his back.
  function makeEel(len = 12, R = 0.55) { const g = new THREE.Group(), N = 30;
    const skin = SP({ color: 0x231a38, roughness: 0.42, sheen: 0.7, sheenColor: 0x8a3aff, emissive: 0x1a0612, emissiveIntensity: 0.6 }), fin = new THREE.MeshStandardMaterial({ color: 0x5a1030, emissive: 0x3a0010, emissiveIntensity: 0.5, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const spotM = new THREE.MeshBasicMaterial({ color: 0xff3a3a }), segs = [];
    for (let i = 0; i < N; i++) { const u = i / (N - 1), r = R * (i === 0 ? 1.05 : u < 0.15 ? 1 - u : 0.9 * Math.pow(1 - u, 0.7) + 0.06), seg = new THREE.Group(); g.add(seg);
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), skin); m.scale.set(r, r * 0.92, r * 1.6); seg.add(m);
      if (i > 1 && i % 2 === 0 && u < 0.92) { const f = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, r * 1.3, 4), fin); f.position.y = r * 1.05; f.rotation.x = -0.5; seg.add(f); }
      if (i > 2 && i % 3 === 0 && u < 0.85) for (const sx of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 8, 6), spotM); d.position.set(sx * r * 0.9, r * 0.1, 0); seg.add(d); }
      segs.push({ g: seg, r }); }
    const head = segs[0].g, jaw = new THREE.Group(); jaw.position.set(0, -R * 0.35, R * 0.3); head.add(jaw);
    { const lj = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin); lj.scale.set(1, 0.5, 1.5); jaw.add(lj);
      const tm = new THREE.MeshStandardMaterial({ color: 0xf4eee0 }); for (let k = 0; k < 6; k++) { const a = (k / 5 - 0.5) * 1.8; for (const up of [1, -1]) { const tt = new THREE.Mesh(new THREE.ConeGeometry(R * 0.07, R * 0.28, 5), tm); tt.position.set(Math.sin(a) * R * 0.75, up > 0 ? R * 0.33 : -R * 0.02, R * 0.55 + Math.cos(a) * R * 0.75); if (up > 0) tt.rotation.x = Math.PI; (up > 0 ? head : jaw).add(tt); } } }
    const eyes = []; for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); e.position.set(sx * R * 0.62, R * 0.38, R * 0.9); head.add(e);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(R * 0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0x1a0000 })); pu.scale.set(0.45, 1.2, 0.6); pu.position.set(sx * R * 0.66, R * 0.38, R * 1.07); head.add(pu);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(R * 0.55, R * 0.12, R * 0.3), skin); brow.position.set(sx * R * 0.55, R * 0.62, R * 0.85); brow.rotation.z = sx * 0.45; head.add(brow);
      const gl = glowSpr(0xff3a1a, R * 1.6, 0.85); gl.position.copy(e.position); head.add(gl); eyes.push(gl); }
    const tmp = new V3(), tmp2 = new V3(); let sc = 1;
    g.userData = { segs, head, jaw, eyes, len,
      pose(fn, t = 0) { for (let i = 0; i < N; i++) { const u = i / (N - 1), p = fn(u, t); const q = fn(Math.max(0, u - 0.02), t); segs[i].g.position.copy(p); tmp.copy(q); if (tmp.distanceToSquared(p) < 1e-8) tmp.copy(fn(u + 0.02, t)).sub(p).negate().add(p); segs[i].g.lookAt(tmp); } jaw.rotation.x = 0.25 + Math.sin(t * 2.2) * 0.15; },
      setGlow(k) { eyes.forEach(e => { e.material.opacity = 0.85 * k; }); spotM.color.setRGB(k, 0.23 * k, 0.23 * k); } };
    return shadowOf(g); }
  // Captain Clack's tricorn hat (navy, gold band and badge)
  function makeCapHat() { const g = new THREE.Group(), navy = SM({ color: 0x1a2a5a, roughness: 0.6 }), gold = SM({ color: 0xe0a83a, metalness: 0.8, roughness: 0.3 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 3), navy); brim.rotation.y = Math.PI / 6; g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.11, 16), navy); crown.position.y = 0.06; g.add(crown);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 20), gold); band.rotation.x = Math.PI / 2; band.position.y = 0.025; g.add(band);
    const badge = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), gold); badge.position.set(0, 0.06, 0.105); g.add(badge); g.position.y = 0.27; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g; }
  // a hanging cage (Pip is kept in it); open(k) raises the bars
  function makeCage() { const g = new THREE.Group(), gold = SM({ color: 0x6a5a7a, metalness: 0.7, roughness: 0.35 }); const bars = new THREE.Group(); g.add(bars);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), gold); b.position.set(Math.cos(a) * 0.34, 0.4, Math.sin(a) * 0.34); bars.add(b); }
    for (const y of [0, 0.8]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 32), gold); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); }
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.3, 24), gold); top.position.y = 0.95; g.add(top); const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 16), gold); hook.position.y = 1.15; g.add(hook);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3, 6), gold); chain.position.y = 2.7; g.add(chain);
    g.userData = { open(k) { bars.position.y = k * 0.85; bars.scale.y = 1 - k * 0.6; } }; return shadowOf(g); }
  // chains of ink wrapped round Murk; melt(k) fades them away
  function makeInkChains(rad = 1.1) { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x14081e, emissive: 0x4a1a6a, emissiveIntensity: 0.5, transparent: true, roughness: 0.3 });
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, l = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 16), m); l.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad); l.rotation.set(Math.PI / 2, a + (i % 2) * Math.PI / 2, 0); g.add(l); }
    g.userData = { mat: m, melt(k) { m.opacity = 1 - k; g.visible = k < 0.99; g.scale.setScalar(1 + k * 0.3); } }; return g; }

  // a cloud of ink: dark soft puffs that drift and fade (Story.ink)
  // (helpers below are mixed into Story by the recipes)
  const pathSweep = (hx, hy, hz, dir, L, amp, freq, speed) => (u, t) => new V3(hx - dir * u * L, hy + Math.sin(u * freq - t * speed) * amp * (0.3 + u), hz + Math.cos(u * freq * 0.7 - t * speed) * amp * 0.5 * u);

  // 7: a light in a dark hollow looks like a gate. It's Grimtide's lure: it snaps shut, ink bursts, his tail snatches the map
  RECIPES.trap = { dur: 7.6, set: { dark: 0.55 }, setup(S, c) { c.map = S.add(makeMap(7)); c.lure = S.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 24, 16), new THREE.MeshBasicMaterial({ color: 0xbff4ff })));
      c.lg = glowSpr(0x9ff0ff, 3.2, 0.8); c.lure.add(c.lg); c.lure.position.set(-0.4, 1.6, -4.2); c.ll = new THREE.PointLight(0x9ff0ff, 10, 8, 1.4); c.lure.add(c.ll);
      c.eel = S.add(makeEel(10, 0.5)); c.eel.visible = false; c.pip = S.add(makePip(0xffc23a, 0.5));
      for (let i = 0; i < 5; i++) { const r = S.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.5 + (i % 2) * 0.6, 1), SM({ color: 0x3a3048, roughness: 1, flatShading: true }))); r.position.set(-4 + i * 1.9, 0.8, -6 - (i % 2) * 0.6); }
      S.tankAt(4.4, -9, -0.3); S.clear.push([0, -2, 3.5]); },
    run(S, c, t) { const p = K(t, [[0, [0.8, 0.5, 1.4]], [2.6, [0.2, 0.5, -1.6]], [4.2, [0.2, 0.5, -1.6]], [5.2, [0.7, 0.5, -0.4]]]), f = new V3(-0.15, 0, -1).normalize(); S.dv(p, f);
      const snap = sm01((t - 3.4) / 0.25); c.lure.scale.setScalar(Math.max(0.01, 1 - snap)); c.lg.material.opacity = 0.8 * (1 - snap) * (0.8 + 0.2 * Math.sin(S.time * 9)); c.ll.intensity = 10 * (1 - snap);
      if (t > 3.4) S.fx('ink', 'flash'); if (t > 3.45) S.inkBurst(new V3(-0.2, 1.4, -3.4), 26, 1.4);
      const held = t < 4.0; c.map.visible = t < 5.6; const hand = p.clone().add(new V3(0.15, 0.95, 0.1)); c.map.position.copy(held ? hand : hand.lerp(new V3(-3, 2.4, -7), sm01((t - 4.0) / 1.4))); c.map.lookAt(S.cam0.position);
      c.eel.visible = t > 3.6 && t < 6.2; if (c.eel.visible) { const k = (t - 3.6) / 2.6; c.eel.userData.pose(pathSweep(4 - k * 12, 1.8 + Math.sin(k * 3) * 0.4, -3.2, 1, 9, 0.35, 7, 4), S.time); }
      c.pip.position.copy(p).add(new V3(-0.55, 0.95 + Math.sin(S.time * 3) * 0.05, 0.2)); c.pip.rotation.y = t < 3.4 ? -1.2 : 1.2; c.pip.userData.tick(S.time * (t > 3.4 ? 3 : 1)); c.pip.userData.setGlow(t < 3.4 ? 0.5 : 0.5 * (1 - sm01((t - 5.6) / 1.6)) + 0.05);
      S.cam(K(t, [[0, [2.4, 1.3, 3.6]], [3.2, [1.8, 1.2, 1.4]], [5.0, [2.6, 1.6, 2.8]], [7.6, [2.4, 1.2, 2.2]]]), K(t, [[0, [-0.3, 1.2, -3]], [3.2, [-0.3, 1.4, -4]], [5.0, [-0.6, 1.6, -4]], [7.6, [0.2, 0.9, -1.6]]]));
      return { mode: t < 2.6 || (t > 4.2 && t < 5.2) ? 'walk' : 'stand', speed: t > 4.2 ? -1.2 : 1, arms: t < 3.4 ? 'hold' : t < 4.2 ? 'cheer' : 'reach', armK: t < 3.4 ? 0.6 : 1, lift: 0.4, face: f, target: c.map.position.clone() }; } };
  // 13: Grimtide's storm: the water goes black, the eel sweeps in, Shelly shields the little ones and sinks to the sand
  RECIPES.storm = { dur: 7.6, set: { dark: 0.7 }, setup(S, c) { c.tu = S.add(makeTurtle()); c.tu.scale.setScalar(1.35); c.eel = S.add(makeEel(13, 0.62)); c.pip = S.add(makePip(0xffc23a, S.glow)); S.tankAt(4.4, -10, -0.3); S.clear.push([0, -1, 4]); },
    run(S, c, t) { const p = new V3(0.9, 0.5, 1.0), f = new V3(-0.6, 0, -1).normalize(); S.dv(p, f, 0, 0, t > 2 && t < 4.4 ? Math.sin(S.time * 18) * 0.04 : 0);
      if (t > 0.4 && t < 6) S.inkBurst(new V3((Math.random() - 0.5) * 10, 1 + Math.random() * 3, -4 - Math.random() * 3), 1, 1.8);
      if (t > 1.8) S.fx('storm1', 'thunder'); if (t > 4.1) S.fx('storm2', 'flash');
      const ek = (t - 1.6) / 3.2; c.eel.visible = ek > 0 && ek < 1; if (c.eel.visible) c.eel.userData.pose(pathSweep(-7 + ek * 16, 1.6 + Math.sin(ek * 4) * 0.5, -1.2 - Math.sin(ek * 3) * 0.6, -1, 12, 0.6, 6, 5), S.time);
      const hit = sm01((t - 4.1) / 1.4), tp = K(t, [[0, [3.4, 0.8, -0.2]], [2.4, [0.0, 0.9, -0.2]], [4.1, [-0.2, 1.0, -0.4]], [5.6, [-0.6, 0.35, -0.9]]]); c.tu.position.copy(tp); c.tu.rotation.set(hit * 0.35, Math.PI * 0.9 + hit * 0.6, hit * 0.5); c.tu.userData.tick(S.time, 1 - hit * 0.9);
      c.pip.position.copy(p).add(new V3(0.5, 0.8 + Math.sin(S.time * 9) * 0.03, 0.4)); c.pip.rotation.y = 2.4; c.pip.userData.tick(S.time * 2);
      S.cam(K(t, [[0, [2.6, 1.2, 4.0]], [4.1, [2.2, 1.4, 3.4]], [7.6, [2.0, 1.0, 2.8]]]), K(t, [[0, [0, 1.2, -1]], [4.1, [-0.2, 1.3, -1]], [7.6, [-0.6, 0.5, -0.9]]]));
      return { mode: 'stand', arms: t < 4.4 ? 'hold' : 'reach', armK: t < 1.8 ? 0 : 1, lift: 0.2, face: f, target: c.tu.position.clone() }; } };
  // 14: Shelly lies on the sand; the diver kneels beside her, glimmer jellies gather to keep her warm
  RECIPES.shellyrest = { dur: 8.0, set: { dark: 0.55 }, setup(S, c) { c.tu = S.add(makeTurtle()); c.tu.scale.setScalar(1.35); c.tu.position.set(-0.4, 0.35, -0.8); c.tu.rotation.set(0.25, Math.PI * 0.75, 0.32);
      c.j = []; for (let i = 0; i < 12; i++) { const j = S.add(makeJelly()); j.scale.setScalar(0.38 + (i % 3) * 0.1); j.add(glowSpr([0xff9ae0, 0x9ae8ff, 0xfff09a][i % 3], 0.8, 0.5)); c.j.push(j); }
      c.pip = S.add(makePip(0xffc23a, 0.25)); c.warm = new THREE.PointLight(0xffc0e0, 0, 6, 1.4); c.warm.position.set(-0.4, 1.4, -0.6); S.scene.add(c.warm); S.tankAt(4.6, -10, -0.3); S.clear.push([0, -1, 3.2]); },
    run(S, c, t) { const p = new V3(0.75, 0.42, 0.1), f = new V3().subVectors(c.tu.position, p).setY(0).normalize(); S.dv(p, f, 0.12); c.tu.userData.b.position.y = Math.sin(S.time * 0.8) * 0.02; // slow breathing
      const come = sm01((t - 4.6) / 2.4); c.j.forEach((j, i) => { const a = S.time * 0.35 + i * 0.52, r = 1.3 + (i % 3) * 0.25; j.position.set(c.tu.position.x + Math.cos(a) * r * (2.5 - 1.5 * come), 0.6 + (i % 4) * 0.25 + Math.sin(a * 2) * 0.1 + (1 - come) * 2.5, c.tu.position.z + Math.sin(a) * r * 0.6 * (2.5 - 1.5 * come)); });
      c.warm.intensity = come * 6; c.pip.position.set(0.3, 1.0 + Math.sin(S.time * 1.2) * 0.04, -0.1); c.pip.rotation.y = 2.6; c.pip.userData.tick(S.time * 0.6);
      S.cam(K(t, [[0, [2.4, 1.0, 2.6]], [4.4, [1.9, 0.8, 2.0]], [8, [2.6, 1.4, 2.8]]]), K(t, [[0, [-0.2, 0.6, -0.8]], [4.4, [-0.1, 0.6, -0.6]], [8, [-0.2, 0.9, -1.2]]]));
      return { mode: 'stand', arms: 'offer', armK: sm01((t - 1.0) / 0.8) * (t > 6.4 ? 0.6 : 1), face: f }; } };
  // 20: the Great Lantern far below, Grimtide coiled around it like a storm cloud
  RECIPES.coil = { dur: 7.2, set: { cliff: -10, dark: 0.45 }, setup(S, c) { c.tw = S.add(makeTower(20, 0)); c.tw.position.set(6, -10, -24); c.eel = S.add(makeEel(34, 1.4)); c.pip = S.add(makePip(0xffc23a, S.glow)); S.tankAt(-4.6, -9, 0.4, -10); S.clear.push([0, 0, 3]); },
    run(S, c, t) { const T0 = c.tw.position; c.eel.userData.pose((u, tt) => { const a = u * Math.PI * 5.5 + tt * 0.35, y = 11.5 - u * 10; return new V3(T0.x + Math.cos(a) * (2.4 + u * 0.6), T0.y + y, T0.z + Math.sin(a) * (2.4 + u * 0.6)); }, S.time);
      c.eel.userData.setGlow(0.6 + 0.4 * Math.sin(S.time * 1.4)); const p = K(t, [[0, [-1.2, 0.5, 1.8]], [2.4, [0.1, 0.5, -1.4]]]), f = new V3(0.3, 0, -1).normalize(); S.dv(p, f, 0, 0, 0);
      c.pip.position.set(p.x + 0.55, 1.15 + Math.sin(S.time * 9) * 0.02, p.z + 0.35); c.pip.rotation.y = 1.0; c.pip.userData.tick(S.time * 2); if (t > 4.6) S.fx('roar', 'roar');
      S.cam(K(t, [[0, [1.6, 1.1, 3.6]], [2.4, [1.0, 1.3, 0.6]], [7.2, [-0.6, 1.5, 0.9]]]), K(t, [[0, [0, 0.8, -2]], [2.4, [2, 0, -10]], [7.2, [5.6, -2.0, -24]]]));
      return { mode: t < 2.4 ? 'walk' : 'stand', speed: 1.2, arms: t > 3.8 ? 'point' : null, armK: sm01((t - 4.0) / 0.5), face: f, target: T0.clone().add(new V3(0, 9, 0)) }; } };
  // 24: ambush. The gate shines, then Grimtide's tail smashes through, the light dies and Pip is dragged into the dark
  RECIPES.ambush = { dur: 7.6, set: { dark: 0.6 }, setup(S, c) { c.gate = S.add(makeGate()); c.gate.scale.setScalar(1.6); c.gate.position.set(-0.6, 0.9, -2.6); c.gl = glowSpr(0x7ff0ff, 4, 0.0); c.gl.position.set(-0.6, 1.0, -2.4); S.scene.add(c.gl);
      c.gli = new THREE.PointLight(0x7ff0ff, 0, 9, 1.3); c.gli.position.set(-0.6, 1.4, -1.8); S.scene.add(c.gli); c.eel = S.add(makeEel(13, 0.65)); c.pip = S.add(makePip(0xffc23a, S.glow)); S.tankAt(4.4, -10, -0.3); S.clear.push([0, -1.5, 3.5], [2.4, 0.6, 1.4]);
      c.clack = S.add(makeCrab()); c.clack.add(makeCapHat()); c.clack.scale.setScalar(1.2); c.clack.visible = false; },
    run(S, c, t) { const shine = sm01(t / 1.2) * (1 - sm01((t - 2.6) / 0.25)); c.gl.material.opacity = 0.7 * shine; c.gli.intensity = 16 * shine;
      if (t > 2.5) S.fx('smash', 'flash'); if (t > 2.55) S.inkBurst(new V3(-0.4, 1.2, -1.8), 30, 1.6);
      const ek = (t - 2.2) / 4.4; c.eel.visible = ek > 0 && ek < 1; let tailP = null; if (c.eel.visible) { const fn = pathSweep(5 - ek * 13, 1.3 + Math.sin(ek * 5) * 0.3, -1.6, 1, 12, 0.5, 6, 5); c.eel.userData.pose(fn, S.time); tailP = fn(0.78, S.time); }
      { const C = c.clack; C.visible = t > 4.0 && t < 6.7; if (C.visible) { let cp; const r0 = new V3(3.2, 0, 1.0), r1 = new V3(1.5, 0, 0.3), sc = 1.2;
          if (t < 4.9 || !tailP) { cp = r0.clone().lerp(r1, sm01((t - 4.0) / 0.9)); cp.y = S.groundY(cp.x, cp.z) + 0.24 + Math.abs(Math.sin(S.time * 14)) * 0.05; C.rotation.set(0, -0.9, 0); C.scale.setScalar(sc); }
          else if (t < 5.3) { const k = (t - 4.9) / 0.4; cp = r1.clone().lerp(tailP, k); cp.y += Math.sin(k * Math.PI) * 1.0 + 0.24 * (1 - k); C.rotation.set(0, -0.9, -k * 0.6); }
          else if (t < 5.7) { cp = tailP.clone().add(new V3(0, 0.25, 0)); C.rotation.set(0.4 * Math.sin(S.time * 20), -0.9, 0.2); if (C.userData.claws) C.userData.claws.forEach(cl => { cl.rotation.z = Math.sin(S.time * 24) * 0.5; }); }
          else { const k = (t - 5.7) / 1.0; cp = tailP.clone().lerp(new V3(-7, 4.5, -10), sm01(k)); C.rotation.set(k * 9, k * 4, k * 7); C.scale.setScalar(sc * (1 - k * 0.6)); }
          C.position.copy(cp); if (t > 5.3) S.fx('pinch', 'thunder'); } }
      const tug = sm01((t - 2.9) / 1.6), pp = new V3(0.2, 1.3, -0.2).lerp(new V3(-6.5, 2.4, -9), tug); c.pip.position.copy(pp); c.pip.position.y += Math.sin(S.time * 14) * 0.05 * (t > 2.9 ? 1 : 0); c.pip.scale.setScalar(1 - tug * 0.6); c.pip.rotation.z = tug * 3; c.pip.userData.tick(S.time * 3);
      const p = K(t, [[0, [0.9, 0.5, 0.9]], [4.4, [0.9, 0.5, 0.9]], [5.4, [0.2, 0.5, 0.0]]]), f = t < 2.6 ? new V3(-0.4, 0, -1).normalize() : new V3().subVectors(pp, p).setY(0).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [2.4, 1.2, 3.6]], [2.6, [2.2, 1.3, 3.2]], [4.4, [2.8, 1.6, 3.4]], [7.6, [2.0, 1.0, 2.6]]]), K(t, [[0, [-0.6, 1.0, -2]], [2.6, [-0.4, 1.2, -1.6]], [4.4, [-2.4, 1.8, -5]], [7.6, [-3, 1.6, -7]]]));
      return { mode: t > 4.4 && t < 5.4 ? 'walk' : 'stand', speed: 1.5, arms: t < 2.6 ? 'cheer' : 'reach', armK: t < 2.6 ? sm01((t - 0.8) / 0.4) : 1, face: f, target: pp.clone() }; } };
  // 26: Murk in ink chains beside a hanging cage with Pip; a pearl of light melts the chains, the cage opens
  RECIPES.cage = { dur: 8.4, set: { dark: 0.62 }, setup(S, c) { c.o = S.add(makeOctopus(0x8a4fd8)); c.o.position.set(-1.6, -0.2, -3.8); c.o.rotation.y = -Math.PI / 2 + 0.45; c.o.scale.setScalar(1.15); c.o.userData.setSad(0.9);
      c.ch = S.add(makeInkChains(1.15)); c.ch.position.set(-1.6, 0.6, -3.8); c.ch2 = S.add(makeInkChains(0.85)); c.ch2.position.set(-1.6, 1.4, -3.8);
      c.cg = S.add(makeCage()); c.cg.position.set(0.8, 1.0, -3.2); c.pip = S.add(makePip(0xffc23a, 0.3)); c.pe = S.add(makeBall(true)); c.pe.scale.setScalar(0.5); c.pe.add(glowSpr(0xff7a6a, 1.4, 0.7));
      for (let i = 0; i < 10; i++) { const b = S.add(makeBall(true)); b.scale.setScalar(0.32); const a = i * 0.6 - 3; b.position.set(-1.6 + Math.sin(a) * 2.2, 0.15, -3.8 + Math.cos(a) * 1.1 + 0.6); }
      for (let i = 0; i < 6; i++) { const r = S.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 1), SM({ color: 0x3a3050, roughness: 1, flatShading: true }))); r.position.set(-4.4 + i * 1.8, 1.4 + (i % 2) * 0.8, -6.4); }
      c.gl = new THREE.PointLight(0xffa080, 0, 8, 1.4); S.scene.add(c.gl); S.tankAt(4.6, -9, -0.3); S.clear.push([0, -1.5, 3.4]); },
    run(S, c, t) { const p = new V3(0.5, 0.5, 0.6), toM = new V3().subVectors(c.o.position, p).setY(0).normalize(); S.dv(p, t < 6.2 ? toM : new V3().subVectors(c.cg.position, p).setY(0).normalize());
      const fly = sm01((t - 3.4) / 1.4), hand = p.clone().add(new V3(-0.1, 0.85, -0.2)), dst = c.o.position.clone().add(new V3(0.3, 1.2, 0.8)); c.pe.position.copy(hand.lerp(dst, fly)); c.pe.position.y += Math.sin(fly * Math.PI) * 0.5; c.pe.visible = fly < 0.98;
      const melt = sm01((t - 4.8) / 1.2); c.ch.userData.melt(melt); c.ch2.userData.melt(melt); c.o.userData.setSad(0.9 * (1 - melt)); c.gl.intensity = melt * 7; c.gl.position.copy(c.o.position).add(new V3(0.5, 1.6, 1.2)); c.o.userData.tick(S.time, 0.4 + melt);
      const op = sm01((t - 6.2) / 0.8); c.cg.userData.open(op); c.cg.position.y = 1.0 + Math.sin(S.time * 0.9) * 0.04;
      const out = sm01((t - 6.9) / 0.9); c.pip.position.copy(c.cg.position.clone().add(new V3(0, 0.4, 0)).lerp(p.clone().add(new V3(0.45, 1.0, 0.25)), out)); c.pip.rotation.y = out > 0.5 ? S.time * 4 : 1.6; c.pip.userData.tick(S.time * (1 + out * 3)); c.pip.userData.setGlow(0.3 + out * 0.6);
      S.cam(K(t, [[0, [2.6, 1.4, 3.2]], [4.8, [2.2, 1.3, 2.6]], [8.4, [2.8, 1.2, 2.8]]]), K(t, [[0, [-0.6, 1.2, -3.4]], [4.8, [-1.0, 1.3, -3.6]], [8.4, [-0.2, 1.2, -2.6]]]));
      return { mode: 'stand', arms: t < 3.4 ? 'offer' : t < 6.4 ? 'reach' : 'cheer', armK: t < 3.4 ? sm01((t - 2.4) / 0.6) : 1, face: toM, target: dst }; } };
  // 29: the lair. Grimtide coiled at the foot of the Lantern with the Heart Pearl; Murk and Pip at the diver's side
  RECIPES.lair = { dur: 7.6, set: { dark: 0.6 }, setup(S, c) { c.tw = S.add(makeTower(29, 0.1)); c.tw.position.set(-1.6, 0, -9.5); c.eel = S.add(makeEel(16, 0.8));
      c.hp = S.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), SP({ color: 0xfff4f0, emissive: 0xffb0a0, emissiveIntensity: 1.1, roughness: 0.08, iridescence: 1 }))); c.hp.add(glowSpr(0xffd0c0, 3.0, 0.7)); c.hp.add(new THREE.PointLight(0xffc0a0, 8, 8, 1.4));
      c.o = S.add(makeOctopus(0x8a4fd8)); c.o.scale.setScalar(0.7); c.o.userData.setSad(0); c.pip = S.add(makePip(0xffc23a, 0.85)); S.tankAt(6.2, -12, -0.35); S.clear.push([-1, -5, 4], [1.6, 1.8, 1.6]); },
    run(S, c, t) { const C = new V3(-0.8, 0, -5.8); c.eel.userData.pose((u, tt) => { if (u < 0.22) { const k = u / 0.22; return new V3(C.x + 1.2 - k * 0.4, 2.6 + Math.sin(tt * 1.2) * 0.15 - k * 0.8, C.z + 2.2 - k * 1.6); } const a = (u - 0.22) * Math.PI * 4.2 + tt * 0.25; return new V3(C.x + Math.cos(a) * 1.9, 1.5 - (u - 0.22) * 1.6, C.z + Math.sin(a) * 1.3); }, S.time);
      c.eel.userData.setGlow(0.75 + 0.25 * Math.sin(S.time * 2)); c.hp.position.set(C.x, 0.9 + Math.sin(S.time) * 0.05, C.z); if (t > 2.0) S.fx('laugh', 'roar');
      const p = new V3(1.0, 0.5, 0.6), f = new V3().subVectors(c.eel.userData.head.position, p).setY(0).normalize(); S.dv(p, f); c.o.position.set(3.0, -0.1, -4.4); c.o.rotation.y = -2.4; c.o.userData.tick(S.time, 1.2);
      c.pip.position.set(0.3, 1.25 + Math.sin(S.time * 2) * 0.06, 0.9); c.pip.rotation.y = 2.0; c.pip.userData.tick(S.time);
      S.cam(K(t, [[0, [3.0, 1.6, 3.6]], [3.6, [2.6, 1.2, 3.0]], [7.6, [3.2, 1.1, 2.8]]]), K(t, [[0, [-0.8, 1.8, -5]], [3.6, [-0.4, 1.6, -4]], [7.6, [-0.6, 1.4, -4.4]]]));
      return { mode: 'stand', arms: t > 5.4 ? 'point' : null, armK: sm01((t - 5.6) / 0.4), face: f, target: c.eel.userData.head.position.clone() }; } };
  // 30: the reef's revenge. Thirty beams of light pour down, Grimtide burns and shrinks to a tiny worm, the Heart Pearl rises home
  RECIPES.victory = { dur: 9.6, set: { dark: 0.6 }, setup(S, c) { RECIPES.lair.setup(S, c); c.beams = []; const bm = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); S.mats.push(bm); c.bm = bm;
      for (let i = 0; i < 30; i++) { const a = i / 30 * Math.PI * 2, b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 18, 8, 1, true), bm); b.position.set(-0.8 + Math.cos(a) * 7, 9, -5.8 + Math.sin(a) * 4); b.lookAt(-0.8, 0.8, -5.8); b.rotateX(Math.PI / 2); S.scene.add(b); c.beams.push(b); }
      c.sun = new THREE.PointLight(0xfff0c0, 0, 30, 1.2); c.sun.position.set(-0.8, 6, -4); S.scene.add(c.sun); c.tu = S.add(makeTurtle(true)); c.tu.scale.setScalar(1.2); },
    run(S, c, t) { const st = RECIPES.lair.run(S, c, Math.min(t, 1.5)); const C = new V3(-0.8, 0, -5.8), burn = sm01((t - 1.6) / 1.2), shrink = sm01((t - 3.6) / 2.2);
      c.bm.opacity = 0.5 * burn * (1 - sm01((t - 7.2) / 1.6)) * (0.8 + 0.2 * Math.sin(S.time * 7)); c.sun.intensity = burn * 30 + shrink * 20;
      if (t > 1.6) S.fx('beams', 'flash'); if (t > 2.6) S.fx('burn', 'roar');
      const s = 1 - shrink * 0.94, wig = shrink > 0.9 ? Math.sin(S.time * 14) * 0.3 : 0; c.eel.scale.setScalar(s); c.eel.position.set(C.x * (1 - s), (1 - s) * 0.4, C.z * (1 - s) + shrink * 1.2); c.eel.userData.setGlow((1 - burn) * 0.8 + 0.2);
      c.eel.userData.pose((u, tt) => { const a = (u) * Math.PI * (4 - shrink * 3) + tt * (0.25 + shrink * 3), r = 1.9 * (1 - shrink * 0.2); return new V3(C.x + Math.cos(a) * r + wig * u, 1.4 - u * 1.4, C.z + Math.sin(a) * r * 0.7); }, S.time);
      if (burn > 0.2 && shrink < 0.95 && Math.random() < 0.7) S.parts.emit(C.x + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 2, C.z + (Math.random() - 0.5) * 2, 3, { color: new THREE.Color(1, 0.85, 0.5), speed: 1.6, life: 1.0, size: 0.2, spread: 0.4 });
      const rise = sm01((t - 6.0) / 2.2); c.hp.position.set(C.x * (1 - rise) + c.tw.position.x * rise, 0.9 + rise * 12, C.z * (1 - rise) + c.tw.position.z * rise); c.tw.userData.big.material.opacity = sm01((t - 7.8) / 1.2) * 0.9; c.tw.userData.lens.material.emissiveIntensity = sm01((t - 7.8) / 1.2) * 2;
      c.o.userData.tick(S.time, 1.4); c.pip.userData.setGlow(1); c.tu.position.set(2.3, 1.0 + Math.sin(S.time * 0.9) * 0.06, -0.9); c.tu.rotation.y = 2.75; c.tu.userData.tick(S.time, 0.8);
      const p = new V3(1.0, 0.5, 0.6), f = t < 6 ? new V3().subVectors(C, p).setY(0).normalize() : new V3(-0.3, 0, -1).normalize(); S.dv(p, f);
      S.cam(K(t, [[0, [3.2, 1.6, 3.6]], [3.6, [3.4, 1.4, 3.4]], [6.0, [3.0, 1.2, 2.8]], [9.6, [3.6, 1.0, 3.6]]]), K(t, [[0, [-0.6, 1.6, -4.6]], [3.6, [-0.7, 0.8, -5.2]], [6.0, [-0.8, 0.8, -5]], [9.6, [-1.4, 7.5, -8.5]]]));
      return { mode: 'stand', arms: t < 3.6 ? 'point' : 'cheer', armK: 1, face: f, target: C.clone().add(new V3(0, 1, 0)) }; } };
  // ---- playable action scenes inside the films (Q.kind 'run'): a fast swim through a canyon, seen from behind the diver.
  // Drag (or arrow keys / WASD) to steer; dodge rocks, piranhas, eel coils and ink; grab pearl-lights; skim past danger for a "Close!".
  // Three hits and the scene ends early (the story goes on with the "no" lines). Variants set the dressing and the spawn mix.
  const RUN_V = {
    dive:  { bg: 0x1b5f9a, fog: [10, 70], sand: 0xffe0a8, hazards: ['rock', 'fish', 'fish', 'gap'], speed: [9, 14], chaser: 'fish' },
    storm: { bg: 0x0e2a4a, fog: [8, 55], sand: 0x9a8a78, hazards: ['rock', 'rock', 'gap', 'ink'], speed: [9, 13.5], wind: 1, flash: 1 },
    ride:  { bg: 0x2a3f8a, fog: [12, 75], sand: 0xb09ad8, hazards: ['rock', 'ink', 'gap'], speed: [10, 15], manta: 1, pearls: 1.5 },
    chase: { bg: 0x141c48, fog: [8, 60], sand: 0x6a6a90, hazards: ['coil', 'rock', 'coil', 'fish', 'gap'], speed: [10, 15.5], target: 1 },
    lair:  { bg: 0x0c0a26, fog: [7, 50], sand: 0x4a3a60, hazards: ['coil', 'coil', 'rock', 'ink', 'gap'], speed: [10, 15], eyes: 1 } };
  class StoryRun {
    constructor(S, Q) { this.S = S; this.Q = Q; const V = this.V = RUN_V[Q.v] || RUN_V.dive; this.dur = Q.dur || 24; this.t = -1.6; this.lives = 3; this.got = 0; this.close = 0; this.inv = 0; this.done = null;
      this.pos = new V3(0, 1.8, 0); this.tgt = new V3(0, 1.8, 0); this.vel = new V3(); this.keys = {}; this.objs = []; this.spawnT = 0.4; this.z = 0; this.shake = 0; this.own = []; this.mats = []; this.wave = 0;
      const sc = this.scene = new THREE.Scene(), w = S.w; sc.environment = S.scene.environment; sc.background = new THREE.Color(V.bg); sc.fog = new THREE.Fog(V.bg, V.fog[0], V.fog[1]);
      this.cam = new THREE.PerspectiveCamera(S.port ? 72 : 60, innerWidth / innerHeight, 0.1, 200);
      sc.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a4a3a, 1.1)); const key = new THREE.DirectionalLight(0xfff0d8, 2.4); key.position.set(-3, 10, 4); sc.add(key, key.target); this.key = key;
      const fill = new THREE.PointLight(0x9fd8ff, 6, 9, 1.6); fill.position.set(0, 2.5, 2); sc.add(fill); this.fill = fill;
      { const t = TEX.sandRef.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 24); t.needsUpdate = true; this.own.push(t); this.sandT = t;
        const m = new THREE.MeshStandardMaterial({ map: t, color: V.sand, roughness: 0.95 }); this.mats.push(m); const g = new THREE.Mesh(new THREE.PlaneGeometry(26, 120), m); g.rotation.x = -Math.PI / 2; g.position.set(0, -0.2, -50); sc.add(g); this.own.push(g.geometry); }
      // canyon walls: rocks and corals streaming past on both sides (recycled)
      this.walls = []; const NM = w === 2 ? ['coral2', 'coral4', 'weed3', 'weed7'] : ['coral1', 'coral2', 'coral3', 'coral5', 'weed1', 'weed5', 'weed9'];
      const RK = ['rockA', 'rockB', 'rockC']; // painted sheet rocks for the canyon walls, so the 3D stones are only ever things to dodge
      for (let i = 0; i < 36; i++) { const side = i % 2 ? 1 : -1, r = sprPlane(RK[i % 3], 2.6 + Math.random() * 2.6, true, null); r.position.set(side * (4.4 + Math.random() * 2), -0.25, -i * 3.4); if (Math.random() < 0.5) r.scale.x = -1; sc.add(r); this.walls.push(r);
        if (i % 2 === 0) { const sp = sprPlane(NM[i % NM.length], 1.1 + Math.random() * 1.3, true, null); sp.position.set(side * (3.4 + Math.random() * 0.8), -0.22, -i * 3.4 - 1.6); sc.add(sp); this.walls.push(sp); } }
      { const N = 260, g = new THREE.BufferGeometry(), p = new Float32Array(N * 3); for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 14; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = -Math.random() * 60; }
        g.setAttribute('position', new THREE.BufferAttribute(p, 3)); const m = new THREE.PointsMaterial({ color: 0xcfefff, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false }); this.mats.push(m); this.own.push(g); this.specks = new THREE.Points(g, m); sc.add(this.specks); }
      if (V.target) { const eel = this.eel = makeEel(14, 0.7); eel.userData.setGlow(1); sc.add(eel); const pip = this.pip = makePip(0xffc23a, 0.9); pip.scale.setScalar(1.3); sc.add(pip); }
      if (V.eyes) { const g = this.eyes = new THREE.Group(); for (const sx of [-1, 1]) { const sp = glowSpr(0xff2a1a, 7, 0.9); sp.position.x = sx * 3.2; g.add(sp); } g.position.set(0, 4.5, -48); sc.add(g); }
      if (V.chaser) { this.chasers = []; for (let i = 0; i < 2; i++) { const f = makeFish(); f.scale.setScalar(0.85); f.rotation.y = Math.PI / 2; sc.add(f); this.chasers.push(f); } }
      if (V.manta) { const m = this.manta = makeManta(); m.scale.setScalar(0.9); sc.add(m); }
      this.coils = V.hazards.includes('coil') ? [0, 1].map(() => { const e = makeEel(9, 0.55); e.userData.setGlow(0.8); e.visible = false; sc.add(e); return e; }) : [];
      S.scene.remove(S.hold); sc.add(S.hold); S.hold.rotation.set(0, Math.PI / 2, 0); S.diver.rotation.set(0, 0, 0);
      this.parts = new Particles(sc, 400); this.resize(); }
    resize() { const c = this.cam; c.aspect = innerWidth / innerHeight; c.fov = innerWidth < innerHeight ? 72 : 60; c.updateProjectionMatrix(); const s = innerHeight * this.S.world.pixelRatio * 0.9; this.parts.mat.uniforms.scale.value = s; this.parts.bubMat.uniforms.scale.value = s; }
    input(type, d) { if (type === 'drag') { this.tgt.x += d.dx * 9; this.tgt.y -= d.dy * 6; } else if (type === 'key') this.keys[d.k] = d.on; }
    // a wave of things at the far end; patterns leave a fair way through (and often a line of pearls along it)
    spawn() { const V = this.V, kind = V.hazards[Math.floor(Math.random() * V.hazards.length)], Z = -62, X = () => (Math.random() * 2 - 1) * 2.4, Y = () => 0.6 + Math.random() * 3; this.wave++;
      const pearls = (x0, y0, x1, y1, n = 5) => { for (let i = 0; i < n; i++) { const k = i / (n - 1); this.add('pearl', x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, Z - 6 - i * 1.6); } };
      if (kind === 'rock') { const x = X(), y = Y(); this.add('rock', x, y, Z, 0.8 + Math.random() * 0.5); if (Math.random() < 0.6) pearls(-x * 0.8, 1 + Math.random() * 2.5, -x * 0.6, 1.2 + Math.random() * 2.4, 4); }
      else if (kind === 'gap') { const gx = X() * 0.8, gy = 0.8 + Math.random() * 2.6; for (const [x, y] of [[-2.6, 0.6], [0, 0.6], [2.6, 0.6], [-2.6, 2.2], [0, 2.2], [2.6, 2.2], [-2.6, 3.8], [0, 3.8], [2.6, 3.8]]) if (Math.hypot(x - gx, y - gy) > 1.9) this.add('rock', x, y, Z, 0.75);
        pearls(gx, gy, gx, gy, 3); }
      else if (kind === 'fish') { for (let i = 0; i < 2; i++) this.add('fish', i ? 3.4 : -3.4, Y(), Z - i * 4, 0.55, i ? -1 : 1); if (Math.random() < 0.5) pearls(X(), Y(), X(), Y(), 4); }
      else if (kind === 'coil') { const lo = Math.random() < 0.5; this.add('coil', 0, lo ? 1.0 : 3.1, Z, 0.75); pearls(-1.5, lo ? 3.4 : 0.8, 1.5, lo ? 3.4 : 0.8, 4); }
      else if (kind === 'ink') { this.add('ink', X(), Y(), Z, 1.3); pearls(X(), Y(), X(), Y(), 3); }
      this.spawnT = Math.max(0.55, 1.15 - this.t * 0.018) * (V.pearls && kind === 'gap' ? 1.2 : 1); }
    add(kind, x, y, z, r = 0.3, dir = 1) { let o;
      if (kind === 'rock') { o = makeBoulder(); o.scale.setScalar(r / 0.43); o.rotation.set(Math.random() * 3, Math.random() * 3, 0); }
      else if (kind === 'fish') { o = makeFish(); o.scale.setScalar(1.3); o.rotation.y = dir > 0 ? 0 : Math.PI; }
      else if (kind === 'coil') { o = this.coils.find(c => !c.userData.busy); if (!o) return; o.userData.busy = true; o.visible = true; }
      else if (kind === 'ink') { o = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0x1a0c2c, transparent: true, opacity: 0.85, depthWrite: false })); o.scale.setScalar(3.4); this.mats.push(o.material); }
      else { o = new THREE.Group(); const core = new THREE.Mesh(GEO.runPearl || (GEO.runPearl = new THREE.SphereGeometry(0.17, 16, 12)), MAT.runPearl || (MAT.runPearl = new THREE.MeshBasicMaterial({ color: 0xffe08a }))); o.add(core, glowSpr(0xffb43a, 1.1, 0.75)); r = 0.45; }
      o.position.set(x, y, z); this.scene.add(o); this.objs.push({ kind, o, x, y, z, r, dir, x0: x, ph: Math.random() * 6, hit: false, near: false }); }
    hurt(ob) { if (this.inv > 0) return; this.lives--; this.inv = 1.3; this.shake = REDUCED_MOTION ? 0 : 0.5; ob.hit = true; this.parts.emit(this.pos.x, this.pos.y, 0, 26, { color: new THREE.Color(1, 0.4, 0.35), speed: 2.4, life: 0.7, size: 0.12 });
      if (this.S.o.onQte) this.S.o.onQte(this.Q, 'hit', this.stats()); if (this.lives <= 0) this.done = 'no'; }
    stats() { return { lives: this.lives, got: this.got, close: this.close, prog: Math.max(0, Math.min(1, this.t / this.dur)) }; }
    update(dt) { const S = this.S, V = this.V; this.t += dt; const t = this.t, go = t > 0, sp = go ? V.speed[0] + (V.speed[1] - V.speed[0]) * Math.min(1, t / this.dur) : 4; this.inv -= dt;
      // steering: drag moves the target, keys push it; the diver chases it with a little lag (banks into turns)
      const kx = (this.keys.ArrowRight || this.keys.d ? 1 : 0) - (this.keys.ArrowLeft || this.keys.a ? 1 : 0), ky = (this.keys.ArrowUp || this.keys.w ? 1 : 0) - (this.keys.ArrowDown || this.keys.s ? 1 : 0);
      this.tgt.x += kx * dt * 7; this.tgt.y += ky * dt * 5.5; if (V.wind && go) this.tgt.x += Math.sin(t * 0.7) * dt * 1.6;
      this.tgt.x = Math.max(-2.8, Math.min(2.8, this.tgt.x)); this.tgt.y = Math.max(0.5, Math.min(4.1, this.tgt.y));
      const prev = this.pos.clone(); this.pos.lerp(this.tgt, 1 - Math.exp(-dt * 9)); this.vel.subVectors(this.pos, prev).divideScalar(Math.max(1e-3, dt));
      const h = S.hold; h.position.copy(this.pos); if (V.manta && this.manta) { this.manta.position.set(this.pos.x, this.pos.y - 0.62, 0.1); this.manta.rotation.set(0, Math.PI / 2, -this.vel.x * 0.06); if (this.manta.userData.tick) this.manta.userData.tick(S.world.time, 1.6); }
      h.rotation.set(0, Math.PI / 2, 0); S.diver.rotation.set(-this.vel.x * 0.07 + (this.inv > 0.6 ? Math.sin(t * 30) * 0.4 : 0), 0, V.manta ? 0 : -0.35 + this.vel.y * 0.05);
      if (S.u.glb) glbDrive(S.u, dt, { reach: 0, push: 0, dig: 0, swim: V.manta ? 0 : 1, floor: V.manta ? 1 : 0, speed: V.manta ? 0 : 2.6, pushing: false });
      h.visible = !(this.inv > 0 && Math.floor(t * 14) % 2);
      // the world streams toward the camera
      const dz = sp * dt; this.z += dz; this.sandT.offset.y += dz / 5; for (const w of this.walls) { w.position.z += dz; if (w.position.z > 8) w.position.z -= 36 * 3.4; }
      { const P = this.specks.geometry.attributes.position; for (let i = 0; i < P.count; i++) { let z = P.getZ(i) + dz * 1.15; if (z > 6) z -= 60; P.setZ(i, z); } P.needsUpdate = true; }
      if (go && t < this.dur - 1.2 && !this.done) { this.spawnT -= dt; if (this.spawnT <= 0) this.spawn(); }
      const D = this.pos, pr = 0.36;
      this.objs = this.objs.filter(ob => { ob.z += dz; const o = ob.o;
        if (ob.kind === 'fish') { ob.x = ob.x0 + ob.dir * Math.min(6.8, Math.max(0, (ob.z + 40) * 0.17)); o.rotation.z = Math.sin(S.world.time * 12 + ob.ph) * 0.15; }
        if (ob.kind === 'coil') o.userData.pose((u, tt) => new V3(-6 + u * 12, ob.y + Math.sin(u * 7 + tt * 5) * 0.28, ob.z + Math.cos(u * 5 + tt * 3) * 0.3), S.world.time);
        else o.position.set(ob.x, ob.y + (ob.kind === 'pearl' ? Math.sin(S.world.time * 4 + ob.ph) * 0.08 : 0), ob.z);
        if (ob.kind === 'rock') o.rotation.x += dt * 0.8;
        if (!ob.hit && Math.abs(ob.z) < (ob.kind === 'coil' ? 0.7 : ob.r + 0.3)) { const d = ob.kind === 'coil' ? Math.abs(D.y - ob.y) : Math.hypot(D.x - ob.x, D.y - ob.y);
          if (ob.kind === 'pearl') { if (d < ob.r + pr) { ob.hit = true; this.got++; Audio.pearl(Math.min(7, 1 + (this.got % 7))); this.parts.emit(ob.x, ob.y, 0, 12, { color: new THREE.Color(1, 0.85, 0.4), speed: 1.6, life: 0.5, size: 0.1 }); if (S.o.onQte) S.o.onQte(this.Q, 'got', this.stats()); this.scene.remove(o); return false; } }
          else if (d < ob.r + pr * (ob.kind === 'ink' ? 0.6 : 0.9)) this.hurt(ob);
          else if (!ob.near && d < ob.r + pr + 0.75 && ob.z > -0.1) { ob.near = true; this.close++; if (S.o.onQte) S.o.onQte(this.Q, 'close', this.stats()); } }
        if (ob.z > 6) { if (ob.kind === 'coil') { o.visible = false; o.userData.busy = false; } else this.scene.remove(o); if (o.isSprite) o.material.dispose(); return false; } return true; });
      if (this.eel) { const ez = -14 + Math.sin(t * 0.4) * 2, ex = Math.sin(t * 0.9) * 1.6; this.eel.userData.pose((u, tt) => new V3(ex + Math.sin(u * 6 - tt * 4) * 0.9 * u, 2.2 + Math.cos(u * 5 - tt * 3) * 0.6 * u, ez - u * 14), S.world.time); this.pip.position.set(ex, 2.9, ez + 0.3); this.pip.rotation.set(0, -Math.PI / 2, Math.sin(t * 8) * 0.3); }
      if (this.eyes) { this.eyes.children.forEach(s => { s.material.opacity = 0.55 + 0.35 * Math.sin(t * 2); }); }
      if (this.chasers) this.chasers.forEach((f, i) => { f.position.set(this.pos.x + (i ? 1.15 : -1.15) + Math.sin(t * 2 + i) * 0.3, this.pos.y - 0.35 + Math.cos(t * 2.4 + i) * 0.3, 1.3 + Math.sin(t * 1.3 + i * 2) * 0.5); f.rotation.y = Math.PI / 2; f.rotation.z = Math.sin(S.world.time * 14 + i) * 0.2; });
      if (V.flash && go && Math.random() < dt * 0.25) { this.flashK = 1; Audio.play('thunder'); } this.flashK = Math.max(0, (this.flashK || 0) - dt * 3); this.key.intensity = 2.4 + this.flashK * 8;
      this.fill.position.set(this.pos.x, this.pos.y + 0.6, 1.4);
      // camera: behind and a little above, leaning into turns
      this.shake = Math.max(0, this.shake - dt * 1.6); const c = this.cam, sh = this.shake * this.shake;
      c.position.set(this.pos.x * 0.7 + (Math.random() - 0.5) * sh, this.pos.y * 0.7 + 1.05 + (Math.random() - 0.5) * sh, 3.1); c.up.set(Math.sin(-this.vel.x * 0.012), 1, 0); c.lookAt(this.pos.x * 0.45, this.pos.y * 0.65 + 0.45, -8);
      this.parts.bubbles(this.pos.x - 0.1, this.pos.y + 0.5, 0.2, 1, 0.04, 0.12); this.parts.update(dt, S.world.time);
      if (S.o.onQte && go) S.o.onQte(this.Q, 'prog', this.stats());
      if (!this.done && t >= this.dur) this.done = 'ok'; return this.done; }
    dispose() { const S = this.S; this.scene.remove(S.hold); S.scene.add(S.hold); S.hold.visible = true;
      this.scene.traverse(o => { if (o.isSprite && o.material && o.material.map === TEX.dot && !this.mats.includes(o.material) && o.material !== MAT.runPearl) this.mats.push(o.material); if ((o.isMesh || o.isPoints) && o.geometry && o.geometry !== GEO.runPearl && !Object.values(GEO).includes(o.geometry) && !this.own.includes(o.geometry)) this.own.push(o.geometry); });
      for (const x of this.own) x.dispose && x.dispose(); for (const m of this.mats) m.dispose(); }
  }
  class Story {
    constructor(world, o) { this.world = world; this.o = o; this.t = 0; this.frozen = false; this.ch = o.ch || CHAPTERS[1]; this.rc = RECIPES[this.ch.r] || RECIPES.pipe; this.dur = this.rc.dur;
      this.n = o.n ?? 1; this.Q = this.ch.Q || null; this.qte = null; this.qDone = !this.Q; this.li = 0; this.shot = null; this.camCur = null; this.look = new V3();
      this.trait = o.trait || 'brave'; this.seq = (this.ch.L || []).map((l, i) => this.mkLine(l, `s${this.n}_${i + 1}`)); this.seqTail = this.Q ? this.seq.splice(this.Q.at) : [];
      this.lines = this.seq; this.plan(0, 0.35, 0, this.Q ? this.qLines(this.Q.kind === 'choice' ? this.Q.opts[0][0] : true).map(l => this.mkLine(l, '')).concat(this.seqTail) : null);
      const w = this.w = this.ch.w ?? o.w ?? 0, WS = WORLD_STYLE[w], set = Object.assign({}, this.rc.set || {}, this.ch.set || {}); this.set = set; const dark = this.dark = Math.min(0.92, (set.dark || 0) * 0.8 + [0, 0.22, 0.42][w]);
      this.glow = Math.min(1, 0.1 + (o.n || 1) / 30); this.own = []; this.mats = []; this.clear = []; this.time = 0;
      const S = this.scene = new THREE.Scene(); S.environment = world.scene.environment;
      const fogC = new THREE.Color().setRGB(...WS.lo).lerp(new THREE.Color().setRGB(...WS.hi), 0.55).multiplyScalar(1 - dark * 0.55); S.background = fogC.clone(); S.fog = new THREE.Fog(fogC, 9 - dark * 3, 46 - dark * 14);
      this.cam0 = new THREE.PerspectiveCamera(46, 1, 0.08, 220);
      S.add(new THREE.HemisphereLight(0xd6f0ff, 0x8a6a3a, (w === 2 ? 0.7 : 1.05) * (1 - dark * 0.7) + 0.08));
      const key = this.key = new THREE.DirectionalLight(w ? 0xc8d8ff : 0xfff1d8, (w === 2 ? 2.2 : 3.2) * (1 - dark * 0.75) + 0.2); key.position.set(-3, 12, -5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0008; key.shadow.normalBias = 0.03;
      { const c = key.shadow.camera; c.left = -9; c.right = 9; c.top = 9; c.bottom = -9; c.near = 1; c.far = 44; } key.target.position.set(0, 0, -1); S.add(key, key.target);
      const fill = new THREE.DirectionalLight(0x9fd8ff, 1.1 * (1 - dark * 0.4)); fill.position.set(4, 3, 8); S.add(fill);
      { const im = PHOTO_W[w] || PHOTO_W[0], tex = new THREE.Texture(im); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.MirroredRepeatWrapping; tex.repeat.set(4, 1); tex.needsUpdate = true; this.own.push(tex);
        const Rr = 40, Hh = Rr * 2 * Math.PI / 4 / 1.78, geo = new THREE.CylinderGeometry(Rr, Rr, Hh, 72, 1, true);
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, color: new THREE.Color(WORLD_TINT[w]).lerp(new THREE.Color(0xffffff), w ? 0.08 : 0).multiplyScalar(1 - dark * 0.85) }); this.mats.push(mat);
        const ring = new THREE.Mesh(geo, mat); ring.position.y = Hh * 0.3 + (set.cliff || 0) * 0.6; ring.rotation.y = -Math.PI / 2 - 0.9; S.add(ring); }
      { const t = TEX.sandRef.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); t.needsUpdate = true; this.own.push(t);
        const geo = new THREE.PlaneGeometry(90, 90, 120, 120); geo.rotateX(-Math.PI / 2); const P = geo.attributes.position;
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); P.setY(i, this.groundY(x, z)); } geo.computeVertexNormals();
        const tint = [new THREE.Color(1.25, 1.12, 0.9), new THREE.Color(0.75, 0.62, 0.95), new THREE.Color(0.45, 0.6, 0.8)][w].multiplyScalar(1 - dark * 0.55);
        const mat = new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 0.95 }); this.mats.push(mat); const sand = new THREE.Mesh(geo, mat); sand.receiveShadow = true; S.add(sand); }
      { const sm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uT: { value: 0 }, uK: { value: 0.16 * (1 - dark * 0.7) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform float uT, uK; varying vec2 vUv; void main(){ float a = pow(max(0.0, sin(vUv.x * 3.14159)), 2.0) * smoothstep(0.0, 0.8, vUv.y) * (0.75 + 0.25 * sin(uT * 0.6 + vUv.x * 4.0)); gl_FragColor = vec4(vec3(1.0, 0.97, 0.85) * a * uK, a * uK); }' });
        this.shaftMat = sm; this.mats.push(sm); for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2 + (i % 3) * 0.9, 26), sm); m.position.set(-10 + i * 3.1, 11, -9 - (i % 4) * 3); m.rotation.z = 0.32 - (i % 3) * 0.06; S.add(m); } }
      this.hold = new THREE.Group(); S.add(this.hold); this.diver = makeDiver(); this.hold.add(this.diver); this.u = this.diver.userData; this.diver.traverse(c => { if (c.isMesh) c.castShadow = true; });
      if (this.u.glb) { const bones = this.u.glb.mesh.skeleton.bones, B = n => bones.find(b => b.name === n); this.armR = [B('RightArm'), B('RightForeArm'), B('RightHand')]; this.armL = [B('LeftArm'), B('LeftForeArm'), B('LeftHand')]; }
      this.parts = new Particles(S, 500); this.bubT = 0;
      this.tankPos = new V3(5.2, 0, -12); this.tankRY = -0.38; this.tankY = 0; this.c = {}; this.decor = []; this.rc.setup(this, this.c, this.ch);
      { const spk = new Set([...(this.ch.L || []), ...this.qAll()].map(l => l[0])); this.comp = [];
        if (spk.has('pip') && !this.c.pip && !this.c.h) { this.c.pip = this.add(makePip(0xffc23a, this.glow)); this.comp.push('pip'); }
        if (spk.has('lumen') && !this.c.lumen && this.ch.r !== 'angler') { this.c.lumen = this.add(makeAngler()); this.c.lumen.scale.multiplyScalar(0.7); this.comp.push('lumen'); }
        if (spk.has('clack') && !this.c.clack && !this.c.crabs) { this.c.clack = this.add(makeCrab()); this.c.clack.add(makeCapHat()); this.comp.push('clack'); } }
      { const P0 = this.parts; this.parts = { emit() {}, bubbles() {} }; this.probe = true; this.camPts = []; const who = [...new Set([...(this.ch.L || []), ...this.qAll()].map(l => l[0]).filter(w => w))];
        for (let i = 0; i <= 40; i++) { try { this.rc.run(this, this.c, this.dur * i / 40); this.companions(); } catch (er) {} const base = this.cam0.position.clone(); this.camPts.push(base);
          if (i % 2 === 0) for (const w of who) for (const sd of [-1, 1]) { const dc = this.dialogCam(w, sd, 0, base); if (dc) for (const k of [0, 0.35, 0.7]) this.camPts.push(dc.pos.clone().lerp(dc.q.p, k)); } } this.probe = false; this.parts = P0; this.c.rung = []; this.c.sang = false; // keep the lens clear: no plant may sit on the camera's path
        this.decor = this.decor.filter(d => { if (this.camPts.some(q => (q.x - d.position.x) ** 2 + (q.z - d.position.z) ** 2 < 1.6 * 1.6)) { this.scene.remove(d); return false; } return true; }); }
      if (o.tank) this.buildTank(o.tank, WS);
      this.scatter(w); this.resize(); this.capI = 0; }
    // ---- the film's clock. plan() times lines from..end (clock t, recipe time r); prov = lines still to come after an interactive beat
    plan(from, tStart, rStart, prov) { const L = this.seq, dur = this.dur, vd = this.o.voDur;
      const lenOf = l => Math.max(2.4, 0.8 + l.text.split(/\s+/).length * 0.2, vd && l.id ? vd(l.id) : 0), wOf = l => l.who && l.who !== 'choir' && l.who !== 'arch' ? 0.45 : 1;
      const all = L.slice(from).concat(prov || []); let tot = 0; all.forEach(l => { l.d = lenOf(l); tot += l.d * wOf(l); }); const sc = tot > 0 ? (dur - rStart) / tot : 0;
      let t = tStart, r = rStart; for (let i = from; i < L.length; i++) { const l = L[i]; l.t0 = t; l.r0 = r; t += l.d; r = Math.min(dur, r + l.d * wOf(l) * sc); l.t1 = t; l.r1 = r; }
      this.qAt = this.qDone ? Infinity : t; this.rQ = r; this.T = this.qDone ? t + 1.3 : Infinity; }
    // a line: [who, text, emote?]; a text can be {brave, funny, kind}, picked by how the player has answered so far (voice id gets _<style>)
    mkLine(l, id) { const d = l[1] && typeof l[1] === 'object', tx = d ? (l[1][this.trait] || l[1].brave) : l[1]; return { who: l[0], text: tx, em: l[2] || '', id: d && id ? id + '_' + this.trait : id }; }
    qLines(k) { const Q = this.Q; if (!Q) return []; if (Q.kind === 'choice') { const o = Q.opts.find(o => o[0] === k) || Q.opts[0]; return o[2]; } return k ? Q.ok : Q.no; }
    qAll() { const Q = this.Q; if (!Q) return []; return Q.kind === 'choice' ? [].concat(...Q.opts.map(o => o[2])) : [...Q.ok, ...Q.no]; }
    rtAt(t) { if (this.qte) return this.qte.r; const L = this.seq; if (!L.length || t <= L[0].t0) return 0;
      for (const l of L) if (t < l.t1) return l.r0 + (l.r1 - l.r0) * Math.max(0, (t - l.t0) / (l.t1 - l.t0));
      return this.qDone ? this.dur : this.rQ; }
    // ---- interactive beats: tap (fill the bar), hold, swipe. The film runs at 15% meanwhile; 6.5 s without success = the other outcome
    qteStart() { const Q = this.Q; this.qte = { kind: Q.kind, n: Q.n || 8, el: 0, prog: 0, r: this.rQ, down: false }; if (Q.kind === 'run') { try { this.run = new StoryRun(this, Q); } catch (er) { console.warn(er); this.run = null; } } if (this.o.onQte) this.o.onQte(Q, 'start'); }
    qteIn(type, key) { const q = this.qte; if (!q || this.frozen) return; if (q.kind === 'run') { if (this.run && (type === 'drag' || type === 'key')) this.run.input(type, key); return; } if (q.kind === 'choice') { if (type === 'pick') this.qteEnd(true, key); return; } if (type === 'down') { q.down = true; if (q.kind === 'tap') q.prog += 1 / q.n; else if (q.kind === 'swipe') q.prog += 0.34; }
      else if (type === 'up') q.down = false; else if (type === 'swipe') q.prog = 1; if (q.kind !== 'hold' && q.prog >= 1) return this.qteEnd(true); if (this.o.onQte) this.o.onQte(this.Q, 'prog', q.prog); }
    qteEnd(ok, key) { const q = this.qte; if (!q) return; if (this.run) { key = this.run.stats(); this.run.dispose(); this.run = null; } this.qte = null; this.qDone = true; this.qOk = ok; const n = this.n, from = this.seq.length, Q = this.Q;
      if (Q.kind === 'choice') { if (!key || !Q.opts.some(o => o[0] === key)) key = Q.opts.some(o => o[0] === this.trait) ? this.trait : Q.opts[0][0]; this.qKey = key; // no answer in time: what this player would say
        this.seq.push(...this.qLines(key).map((l, j) => this.mkLine(l, `s${n}_c${key}_${j + 1}`)), ...this.seqTail); }
      else this.seq.push(...this.qLines(ok).map((l, j) => this.mkLine(l, `s${n}_${ok ? 'ok' : 'no'}${j + 1}`)), ...this.seqTail);
      this.plan(from, this.t + 0.25, q.r); if (this.o.onQte) this.o.onQte(Q, ok ? 'ok' : 'no', key); }
    skipAll() { if (!this.qDone) { if (!this.qte) this.qte = { kind: this.Q.kind, n: 1, el: 0, prog: 0, r: this.rQ }; this.qteEnd(false); } this.t = Math.max(this.t, this.T - 0.05); this.li = this.capI = this.seq.length; if (this.o.onCap) this.o.onCap(null); }
    companions() { if (!this.comp || !this.comp.length) return; const f = this.face || new V3(1, 0, 0), up = new V3(0, 1, 0), r = new V3().crossVectors(f, up).normalize(), h = this.hold.position, tm = this.time;
      const sp = this.shot && this.t < this.shot.l.t1 ? this.shot.who : '', cam = this.cam0.position;
      for (const k of this.comp) { const o = this.c[k]; let d = new V3().subVectors(cam, o.position).setY(0).normalize(), talking = sp === k;
        if (k === 'pip') { o.position.copy(h).addScaledVector(r, 0.62).addScaledVector(f, 0.1); o.position.y += 1.05 + Math.sin(tm * 2.2) * 0.06; const g = talking ? d.applyAxisAngle(up, -0.6) : f; o.rotation.set(0, Math.atan2(-g.z, g.x), 0); if (o.userData.tick) o.userData.tick(tm); }
        else if (k === 'lumen') { o.position.copy(h).addScaledVector(r, -0.95).addScaledVector(f, -0.15); o.position.y += 1.15 + Math.sin(tm * 1.7) * 0.08; const g = talking ? d.applyAxisAngle(up, 0.5) : f; o.rotation.set(0, Math.atan2(-g.z, g.x), 0); if (o.userData.tail) o.userData.tail.rotation.y = Math.sin(tm * 6) * 0.4; }
        else if (k === 'clack') { const x = h.x + r.x * 0.75 + f.x * 0.4, z = h.z + r.z * 0.75 + f.z * 0.4; const gy = this.groundY(x, z); o.position.set(x, (h.y < gy - 0.3 ? h.y + 0.1 : gy + 0.22) + Math.abs(Math.sin(tm * 6)) * 0.02, z); /* falls with the diver off a cliff */ const g = talking ? d : f; o.rotation.set(0, Math.atan2(g.x, g.z), 0); } } }
    // ---- who is speaking: the cast member on screen, its size, and a close-up camera on it (shot/reverse-shot from the recipe's camera)
    castOf(who) { const c = this.c; let o = null, s = 1, y = 0;
      switch (who) { case 'you': o = this.hold; y = 0.72; break; /* the Keeper is only ever seen in silhouette (no close-up) */ case 'pip': o = c.pip || (c.h && c.h[0]); s = 0.75; break; case 'cousin': o = c.h && c.h[1]; s = 0.7; break;
        case 'shelly': o = c.tu; s = 1.6; y = 0.35; break; case 'murk': o = c.o; s = 2.0; y = 1.0; break; case 'lumen': o = c.lumen || (this.ch.r === 'angler' ? c.a : null); s = 1.1; break;
        case 'mira': o = c.m; s = 1.9; break; case 'clack': o = c.clack || (c.crabs && c.crabs[0]); s = 0.55; y = 0.25; break;
        case 'grimtide': if (c.eel && c.eel.visible) { o = c.eel.userData.head; s = Math.max(1.6, c.eel.userData.segs[0].r * 3.2 * c.eel.scale.x); } break;
        case 'snip': o = c.snip; s = 0.7; break; case 'snap': o = c.snap; s = 0.7; break; }
      if (!o) return null; for (let a = o; a; a = a.parent) if (!a.visible) return null; const p = o.getWorldPosition(new V3()); p.y += y;
      const fw = (who === 'clack' || who === 'grimtide' ? new V3(0, 0, 1) : new V3(1, 0, 0)).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())); fw.y = 0; if (fw.lengthSq() > 1e-6) fw.normalize(); if (who === 'clack' && this.c.crabs) fw.set(0, 0, 0); /* the parade: shoot from the scene camera's side, past the crew */ return { o, p, s, fw }; }
    dialogCam(who, side, prog, base) { const q = this.castOf(who); if (!q) return null; const d0 = base.clone().sub(q.p); d0.y = 0; if (d0.lengthSq() < 1e-4) d0.set(0, 0, 1); d0.normalize();
      d0.multiplyScalar(0.8).addScaledVector(q.fw, 1.0); if (d0.lengthSq() < 1e-3) d0.copy(q.fw); d0.normalize(); // toward the face, from the side of the scene camera
      const a = side * 0.38, ca = Math.cos(a), sa = Math.sin(a), dir = new V3(d0.x * ca - d0.z * sa, 0, d0.x * sa + d0.z * ca), dist = (q.s * 3.6 + 0.7) * (this.port ? 1.15 : 1) * (1 - 0.06 * prog); /* a close-up lens (see shotCam): the speaker fills the frame */
      const pos = q.p.clone().addScaledVector(dir, dist), wantY = q.p.y + q.s * 0.32 + 0.12, gy = this.groundY(pos.x, pos.z) + 0.35; if (gy > wantY + 0.6) return null; pos.y = Math.max(wantY, gy); /* below a cliff edge: keep the wide shot */
      const look = q.p.clone().addScaledVector(new V3(dir.z, 0, -dir.x), q.s * 0.08 * side); look.y += q.s * 0.06; return { pos, look, q }; }
    // ---- helpers the recipes use
    groundY(x, z) { const S = this.set, r = Math.hypot(x, z); let y = (Math.sin(x * 0.7 + z * 0.3) * 0.06 + Math.sin(z * 0.9 - x * 0.2) * 0.05) * Math.min(1, r / 3) + Math.max(0, r - 18) * 0.05;
      if (S.dune) y += Math.max(0, -x - 1.2) * 0.62 * sm01((x + 9) / 3) + (x < -9 ? 3.4 : 0) * 0;
      if (S.cliff) y += S.cliff * sm01((-z - 3.2) / 2.2);
      if (S.trench) y -= S.trench * (sm01((-z - 1.6) / 1.4) - sm01((-z - 7.2) / 1.4)) * sm01((10 - Math.abs(x)) / 4); return y; }
    add(o) { this.scene.add(o); return o; }
    fx(key, kind) { if (this.probe || this.frozen) return; this.fxDone = this.fxDone || {}; if (this.fxDone[key]) return; this.fxDone[key] = 1; if (this.o.onFx) this.o.onFx(kind); }
    inkBurst(pos, n, size = 1) { if (this.probe || this.frozen) return; this.inks = this.inks || []; for (let i = 0; i < n && this.inks.length < 90; i++) {
        const m = new THREE.SpriteMaterial({ map: TEX.dot, color: 0x1c0f30, transparent: true, opacity: 0, depthWrite: false }); this.mats.push(m); const sp = new THREE.Sprite(m); sp.position.copy(pos).add(new V3((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size));
        this.scene.add(sp); this.inks.push({ sp, v: new V3((Math.random() - 0.5) * 1.4, (Math.random() - 0.3) * 0.8, (Math.random() - 0.5) * 1.4), life: 0, max: 2.2 + Math.random() * 1.6, s0: size * (0.35 + Math.random() * 0.45) }); } }
    spr(n, h, x, z, y = null) { const sp = sprPlane(n, h, true, null); sp.position.set(x, y ?? this.groundY(x, z) - 0.02, z); this.scene.add(sp); this.decor.push(sp); return sp; }
    tankAt(x, z, ry, y = 0) { this.tankPos.set(x, y, z); this.tankRY = ry; this.tankY = y; this.clear.push([x, z, 4.4]); }
    tankP() { return this.tankPos; }
    clearPath(M, d, s0, s1, w) { for (let s = s0; s <= s1; s += 1) this.clear.push([M.x + d.x * s, M.z + d.z * s, w]); }
    kelpWalls(x0, z0, x1, z1, n) { for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1, z = z0 - (i / n) * (z0 - z1) * 1.6, x = side < 0 ? -1.5 - (i % 3) * 0.7 : 4.0 + (i % 3) * 0.8; const k = this.spr('weed' + [1, 3, 5, 7, 9][i % 5], 2.2 + (i % 4) * 0.6, x, z); k.userData.sw = i; (this.kelp = this.kelp || []).push(k); } }
    camRaw(pos, look, roll = 0) { const c = this.cam0; c.position.copy(pos); this.look.copy(look); c.up.set(0, 1, 0); c.lookAt(look); if (roll) c.rotateZ(roll); }
    cam(pos, look) { if (this.port) pos = look.clone().add(pos.clone().sub(look).multiplyScalar(1.4)); this.camRaw(pos, look); }
    dv(p, f, pitch = 0, yawOff = 0, roll = 0) { this.hold.position.copy(p); this.face = f.clone ? f.clone().setY(0).normalize() : new V3(1, 0, 0); this.hold.rotation.set(0, Math.atan2(-this.face.z, this.face.x) + yawOff, 0); this.diver.rotation.set(roll, 0, pitch); }
    buildTank(cv, WS) { const tw = 5.2, th = tw * cv.height / cv.width, g = this.tank = new THREE.Group(); g.position.copy(this.tankPos); g.rotation.y = this.tankRY; this.scene.add(g);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; this.own.push(tex); const cr = 1 / 1.04; tex.repeat.set(cr, cr); tex.offset.set((1 - cr) / 2, (1 - cr) / 2);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), new THREE.MeshBasicMaterial({ map: tex, fog: true })); face.position.set(0, 0.55 + th / 2, 0); g.add(face);
      const navy = new THREE.MeshStandardMaterial({ color: WS.trim, roughness: 0.4, metalness: 0.3 }), fr = 0.09;
      for (const [x, y, bw, bh] of [[0, 0.55, tw + fr * 2, fr], [0, 0.55 + th, tw + fr * 2, fr], [-tw / 2, 0.55 + th / 2, fr, th], [tw / 2, 0.55 + th / 2, fr, th]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.9), navy); b.position.set(x, y, -0.4); g.add(b); }
      for (const [x, y] of [[-tw / 2, 0.55], [tw / 2, 0.55], [-tw / 2, 0.55 + th], [tw / 2, 0.55 + th]]) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), MAT.pipeBrass || SM({ color: 0xd8a03e, metalness: 0.85, roughness: 0.3 })); c.position.set(x, y, 0.05); g.add(c); }
      const st = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.5, 0.55, 1.3), new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.7 })); st.position.set(0, 0.27, -0.4); st.castShadow = st.receiveShadow = true; g.add(st);
      const halo = glowSpr(0x7ff0ff, 1, 0.28 + this.dark * 0.2); halo.scale.set(tw * 2.2, th * 2.4, 1); halo.material.fog = false; halo.position.set(0, 0.55 + th / 2, -0.6); g.add(halo); }
    scatter(w) { let s = 77 + w * 13 + (this.o.n || 1) * 31; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const NM = w === 2 ? ['coral2', 'coral4', 'weed3', 'weed7', 'rockA', 'rockB', 'rockC', 'shellA', 'starC'] : ['coral1', 'coral2', 'coral3', 'coral4', 'coral5', 'weed1', 'weed3', 'weed5', 'weed7', 'weed9', 'rockA', 'rockB', 'rockC', 'shellA', 'shellC', 'starA', 'starC'];
      const ok = (x, z) => !this.clear.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < r * r) && !(this.camPts || []).some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < 2.2 * 2.2);
      for (let i = 0; i < 150; i++) { const a = rnd() * Math.PI * 2, r = 1.6 + Math.pow(rnd(), 0.7) * 22, x = Math.cos(a) * r, z = Math.sin(a) * r - 4; if (!ok(x, z) || (this.set.cliff && z < -3) || (this.set.trench && z < -1.2 && z > -8.8)) continue;
        const nm = NM[Math.floor(rnd() * NM.length)], big = nm.startsWith('rock') ? 0.6 : nm.startsWith('shell') || nm.startsWith('star') ? 0.22 : 0.55; const sp = this.spr(nm, big * (0.8 + rnd() * 0.9) * (1 + r * 0.03), x, z); if (rnd() < 0.5) sp.scale.x = -1; }
      if (w) for (let i = 0; i < 10; i++) { const x = (rnd() - 0.5) * 20, z = -2 - rnd() * 14; if (!ok(x, z) || (this.set.cliff && z < -3)) continue; const cr = makeCrystals(WORLD_STYLE[w].crystals || 0xb57cff, 5, 0.8 + rnd(), 5 + i); cr.position.set(x, this.groundY(x, z), z); cr.userData.setLit(0.7); this.scene.add(cr); }
      this.fish = []; const FN = ['fishA', 'fishB', 'fishC', 'fishE', 'fishG', 'fishH', 'fishI']; for (let i = 0; i < (this.dark > 0.6 ? 3 : 7); i++) { const f = sprPlane(FN[i % FN.length], 0.28 + rnd() * 0.22, false, null); f.material = f.material.clone(); f.material.fog = true; this.mats.push(f.material);
        f.userData.f = { x: -12 + rnd() * 24, y: 1.5 + rnd() * 4.5, z: -6 - rnd() * 14, v: (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7), ph: rnd() * 6 }; this.scene.add(f); this.fish.push(f); } }
    resize() { if (this.run) this.run.resize(); const w = innerWidth, h = innerHeight, c = this.cam0; c.aspect = w / h; this.port = w < h; c.fov = this.port ? 62 : 44; c.updateProjectionMatrix(); const pr = this.world.pixelRatio; this.parts.mat.uniforms.scale.value = h * pr * 0.9; this.parts.bubMat.uniforms.scale.value = h * pr * 0.9; }
    aim(b, c, dir, k) { if (!b || !c || k <= 0) return; b.updateWorldMatrix(true, false); c.updateWorldMatrix(false, false);
      const p0 = new V3().setFromMatrixPosition(b.matrixWorld), p1 = new V3().setFromMatrixPosition(c.matrixWorld), cur = p1.sub(p0).normalize();
      const qd = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize()), qw = new THREE.Quaternion(), qp = new THREE.Quaternion(); b.getWorldQuaternion(qw); b.parent.getWorldQuaternion(qp);
      const nl = qp.invert().multiply(qd.multiply(qw)); b.quaternion.slerp(nl, Math.min(1, k)); }
    // arm poses in world directions (f = facing, r = the diver's right)
    arms(st) { const k = st.armK ?? 1; if (!st.arms || k <= 0 || !this.armR) return; const f = this.face || new V3(1, 0, 0), up = new V3(0, 1, 0), r = new V3().crossVectors(f, up).normalize(), t = this.t;
      const D = (a, b, c) => up.clone().multiplyScalar(a).addScaledVector(f, b).addScaledVector(r, c); const R = this.armR, L = this.armL; this.diver.updateMatrixWorld(true);
      const pose = (arm, s, u1, f1, r1, u2, f2, r2) => { this.aim(arm[0], arm[1], D(u1, f1, r1 * s), k); this.aim(arm[1], arm[2], D(u2, f2, r2 * s), k); };
      const wv = Math.sin(t * 8.5);
      switch (st.arms) {
        case 'wave': pose(R, 1, 0.5, 0.35, 0.8, 0.85, 0.2, 0.2 + 0.45 * wv); break;
        case 'cheer': pose(R, 1, 0.9, 0.15, 0.5, 1, 0.1, 0.15 + 0.15 * wv); pose(L, -1, 0.9, 0.15, 0.5, 1, 0.1, 0.15 - 0.15 * wv); break;
        case 'point': { let d = D(0.15, 1, 0.25); if (st.target) { R[0].updateWorldMatrix(true, false); d = st.target.clone().sub(new V3().setFromMatrixPosition(R[0].matrixWorld)).normalize(); } this.aim(R[0], R[1], d, k); this.aim(R[1], R[2], d, k); break; }
        case 'reach': { let d = D(0, 1, 0.1); if (st.target) { R[0].updateWorldMatrix(true, false); d = st.target.clone().sub(new V3().setFromMatrixPosition(R[0].matrixWorld)).normalize(); } this.aim(R[0], R[1], d, k); this.aim(R[1], R[2], d.clone().add(up.clone().multiplyScalar(0.2)), k); pose(L, -1, -0.6, 0.3, 0.3, -0.3, 0.6, 0.1); break; }
        case 'hold': { const lift = st.lift ?? 1; pose(R, 1, 0.3 + lift * 0.6, 0.6, 0.35, 0.5 + lift * 0.5, 0.5, -0.25); pose(L, -1, 0.3 + lift * 0.6, 0.6, 0.35, 0.5 + lift * 0.5, 0.5, -0.25); break; }
        case 'clap': { const c = 0.5 + 0.5 * Math.sin(t * 9); pose(R, 1, 0.2, 0.8, 0.3, 0.3, 0.8, -0.35 * c); pose(L, -1, 0.2, 0.8, 0.3, 0.3, 0.8, -0.35 * c); break; }
        case 'offer': pose(R, 1, 0.2, 0.9, 0.15, 0.6, 0.7, 0); pose(L, -1, 0.2, 0.9, 0.15, 0.6, 0.7, 0); break;
        case 'grip': pose(R, 1, -0.6, 0.6, 0.45, -0.3, 0.8, 0.1); pose(L, -1, -0.6, 0.6, 0.45, -0.3, 0.8, 0.1); break; } }
    update(dt) { if (this.run && this.qte) { const r = this.run.update(Math.min(dt, 0.05)); if (r) this.qteEnd(r === 'ok'); return; } // a playable action scene: the film waits
      const sl = this.qte ? 0.15 : 1; if (!this.frozen) { this.t += dt * sl; this.time += dt * sl; } const t = this.t;
      if (this._tb) { const b = this._tb; b.o.position.y -= b.dy; b.o.rotation.z -= b.rz; b.o.rotation.y -= b.ry; this._tb = null; }
      if (this.qte && !this.frozen) { const q = this.qte; q.el += dt; q.r = Math.min(this.dur, q.r + dt * 0.22); if (q.kind === 'hold') { q.prog = Math.max(0, Math.min(1, q.prog + (q.down ? dt / 1.3 : -dt * 0.3))); if (this.o.onQte) this.o.onQte(this.Q, 'prog', q.prog); if (q.prog >= 1) this.qteEnd(true); } if (this.qte && q.el > (q.kind === 'choice' ? 9 : 6.5)) this.qteEnd(false); }
      if (!this.frozen && !this.qDone && !this.qte && t >= this.qAt) this.qteStart();
      const st = this.rc.run(this, this.c, this.rtAt(this.t)) || {}; this.st = st; this.companions();
      if (this.u.glb && !this.frozen) { const m = st.mode || 'stand', sw = m === 'swim' || m === 'walk' ? 1 : 0, fl = m === 'walk' || m === 'stand' ? 1 : 0;
        glbDrive(this.u, dt, { reach: 0, push: 0, dig: 0, swim: sw, floor: fl, speed: Math.abs(st.speed || (sw ? 1.4 : 0)), pushing: false }); this.arms(st); }
      if (!this.frozen && t >= this.T) { this.frozen = true; if (this.o.onCap) this.o.onCap(null); if (this.o.onFreeze) this.o.onFreeze(); }
      if (!this.frozen) while (this.li < this.seq.length && this.seq[this.li].t0 !== undefined && this.t >= this.seq[this.li].t0) { const l = this.seq[this.li]; if (this.o.onCap) this.o.onCap(l, this.li, this.ch); this.shot = { who: l.who, side: this.li % 2 ? 1 : -1, l, cut: true }; this.li++; this.capI = this.li; }
      this.shotCam(dt);
      this.shaftMat.uniforms.uT.value = this.world.time;
      if (this.kelp) this.kelp.forEach(k => { k.rotation.z = Math.sin(this.world.time * 0.9 + k.userData.sw) * 0.06; });
      for (const f of this.fish) { const F = f.userData.f; F.x += F.v * dt; if (F.x > 14) F.x = -14; if (F.x < -14) F.x = 14; f.position.set(F.x, F.y + Math.sin(this.world.time * 1.3 + F.ph) * 0.15, F.z); f.scale.x = F.v > 0 ? -1 : 1; }
      this.bubT -= dt; if (this.bubT <= 0 && !this.frozen) { this.bubT = 0.14; const p = this.hold.position; this.parts.bubbles(p.x - 0.1, p.y + 0.85, p.z, 1, 0.04 + Math.random() * 0.04, 0.12); }
      if (this.inks && !this.frozen) this.inks = this.inks.filter(k => { k.life += dt; const f = k.life / k.max; if (f >= 1) { this.scene.remove(k.sp); return false; } k.sp.position.addScaledVector(k.v, dt); k.v.multiplyScalar(1 - dt * 0.8);
        k.sp.scale.setScalar(k.s0 * (0.6 + f * 1.3)); k.sp.material.opacity = 0.55 * Math.min(1, f * 6) * (1 - f); return true; });
      this.parts.update(dt, this.world.time); }
    // close-up on whoever speaks (cut in, then it drifts with them); narration and interactive beats keep the recipe's own camera
    shotCam(dt) { const sh = this.shot, t = this.t; let q = null;
      if (sh && sh.cut && sh.who && !this.qte && !this.frozen) { const base = this.cam0.position.clone(); sh.wide = true; // pick a side with a clear view of the speaker (a big shell or a rock in the way: try the other side, else stay wide)
        for (const sd of [sh.side, -sh.side]) { const tg = this.dialogCam(sh.who, sd, 0, base); if (tg && this.clearView(tg.pos, tg.q)) { sh.side = sd; sh.wide = false; break; } } }
      if (sh && !sh.wide && !this.qte && !this.frozen && t < sh.l.t1 + 0.15 && sh.who) { const prog = Math.min(1, (t - sh.l.t0) / Math.max(0.1, sh.l.t1 - sh.l.t0)), base = this.cam0.position.clone();
        let tg = this.dialogCam(sh.who, sh.side, prog, base);
        if (tg && (sh.chk = (sh.chk || 0) - dt) <= 0) { sh.chk = 0.25; // someone swam into the shot: cut to the other side, or back to the wide shot
          if (!this.clearView(tg.pos, tg.q)) { const t2 = this.dialogCam(sh.who, -sh.side, prog, base); if (t2 && this.clearView(t2.pos, t2.q)) { sh.side = -sh.side; sh.cut = true; tg = t2; } else { sh.wide = true; tg = null; } } }
        if (tg) { q = tg.q; if (sh.cut || !this.camCur) { this.camCur = { pos: tg.pos.clone(), look: tg.look.clone() }; sh.cut = false; } else { this.camCur.pos.lerp(tg.pos, 1 - Math.exp(-dt * 10)); this.camCur.look.copy(tg.look); }
          this.camRaw(this.camCur.pos, this.camCur.look); } }
      { const fov = q ? (this.port ? 40 : 28) : (this.port ? 62 : 44), c = this.cam0; if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } } // close-ups on a longer lens, the rest wide
      if (!q) this.camCur = null;
      if (this.qte && this.qte.kind !== 'choice') { const k = 0.02 + 0.03 * this.qte.prog; this.cam0.position.x += (Math.random() - 0.5) * k; this.cam0.position.y += (Math.random() - 0.5) * k; }
      // the speaker talks: a little bob and sway (Grimtide's jaw works instead)
      if (this._mouth) { this._mouth.visible = false; this._mouth = null; } if (this._jaw) { this._jaw.rotation.z = -0.15; this._jaw = null; }
      const spk = sh && sh.who && !this.frozen && t < sh.l.t1 ? (q || this.castOf(sh.who)) : null; // the speaker talks in every shot, close or wide
      if (spk) { const tt = this.world.time, a = Math.abs(Math.sin(tt * 9.5)) * (0.55 + 0.45 * Math.sin(tt * 2.3 + 1)) * (Math.sin(tt * 0.9) > -0.85 ? 1 : 0.2); // syllables, with small pauses
        if (sh.who === 'grimtide' && this.c.eel) this.c.eel.userData.jaw.rotation.x += 0.4 * a;
        else { let dy = spk.s * 0.03 * a, rz = Math.sin(tt * 5.5) * 0.04, ry = 0; const em = sh.l.em, ek = (t - sh.l.t0) / 0.9, b = ek >= 0 && ek < 1 ? Math.sin(Math.PI * ek) : 0, S = spk.s; // the line's emote, over its first 0.9 s
          if (em === 'hop') dy += S * 0.32 * b; else if (em === 'spin') ry = ek >= 0 && ek < 1 ? Math.PI * 2 * sm01(ek) : 0; else if (em === 'shake') rz += Math.sin(ek * 42) * 0.13 * b;
          else if (em === 'laugh') { dy += S * 0.07 * Math.abs(Math.sin((t - sh.l.t0) * 16)) * Math.min(1, (sh.l.t1 - t) * 2); rz += Math.sin((t - sh.l.t0) * 16) * 0.05; }
          else if (em === 'salute') rz -= 0.22 * b; else if (em === 'nod') dy -= S * 0.06 * Math.abs(Math.sin(Math.min(1, Math.max(0, ek)) * Math.PI * 2));
          else if (em === 'droop') { const k = sm01((t - sh.l.t0) / 0.6); dy -= S * 0.07 * k; rz += 0.14 * k; } // sinks a little for the whole line
          spk.o.position.y += dy; spk.o.rotation.z += rz; spk.o.rotation.y += ry; this._tb = { o: spk.o, dy, rz, ry };
          const ud = spk.o.userData || {}; if (ud.mouth) { const m = ud.mouth; m.visible = a > 0.1; m.scale.y = m.userData.h * (0.3 + 0.9 * a); this._mouth = m; } else if (ud.jaw) { ud.jaw.rotation.z = -0.15 - 0.55 * a; this._jaw = ud.jaw; } } } }
    clearView(pos, q) { const R = this.ray || (this.ray = new THREE.Raycaster()); R.camera = this.cam0; // five rays: to the speaker and around them (something big near the lens covers half the frame)
      const own = o => { for (let a = o; a; a = a.parent) if (a === q.o) return true; return false; }, d0 = q.p.clone().sub(pos), side = new V3(d0.z, 0, -d0.x).normalize(), r = q.s * 0.4;
      for (const off of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r * 0.6]]) { const to = q.p.clone().addScaledVector(side, off[0]); to.y += off[1]; const d = to.sub(pos), L = d.length(); if (L < 0.05) continue;
        R.set(pos, d.normalize()); R.far = L - Math.max(0.2, q.s * 0.45); let hits; try { hits = R.intersectObjects(this.scene.children, true); } catch (er) { continue; }
        for (const h of hits) { const o = h.object, m = o.material; if (!o.isMesh || own(o) || !m || m.side === THREE.BackSide || (m.transparent && (m.opacity ?? 1) < 0.35) || m.blending === THREE.AdditiveBlending) continue;
          let vis = true; for (let a = o; a; a = a.parent) if (!a.visible) { vis = false; break; } if (vis) return false; } } return true; }
    // the last second slides the picture aside for the card (right on wide screens, bottom on phones)
    render(post) { if (this.run) { if (post.compMat) post.compMat.uniforms.night.value = 0; this.cam0.clearViewOffset(); post.render(this.run.scene, this.run.cam, this.world.time); return; }
      if (this.set.night && post.compMat) post.compMat.uniforms.night.value = this.nightK ?? this.set.night; /* the moonlit night grade */ const w = innerWidth, h = innerHeight, c = this.cam0, k = sm01((this.t - (this.T - 1.1)) / 1.0); if (k > 0) { if (this.port) c.setViewOffset(w, h, 0, h * 0.26 * k, w, h); else c.setViewOffset(w, h, w * 0.13 * k, 0, w, h); } else c.clearViewOffset();
      post.render(this.scene, c, this.world.time); }
    dispose() { if (this.run) { this.run.dispose(); this.run = null; } this.scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isSprite) && o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose();
        if (o.isMesh && o.material && !Object.values(MAT).includes(o.material) && !Object.values(SPR.mat || {}).includes(o.material)) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m && m.map && m.map.isCanvasTexture && !Object.values(TEX).includes(m.map)) this.own.push(m.map); }); } });
      for (const t of new Set(this.own)) t.dispose(); for (const m of this.mats) m.dispose(); }
  }
  class WorldImpl {
    constructor(cv) {
      this.canvas = cv;
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !isMobile, powerPreference: 'high-performance', alpha: false }); // phones: the post pass anti-aliases; a multisampled screen buffer on top only cost bandwidth
      this.renderer.outputColorSpace = THREE.SRGBColorSpace; MAIN_R = this.renderer;
      this.renderer.debug.checkShaderErrors = !!navigator.webdriver || /[?&]debug/.test(location.search); // players: no synchronous shader-log readback (it stalls every compile); tests keep the checks
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.post = new Post(this.renderer, isMobile);
      this.pixelRatio = Math.min(devicePixelRatio || 1, isMobile ? 2 : 2);
      buildTextures(); buildMaterials(); buildGeometry();
      this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x138ccf);
      this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 1.2, 400); this.tilt = isMobile ? 0.05 : 0.1; this.yawNow = CAM_YAW; // camera pitch: a little from above, flatter on phones so less floor shows
      this.camTarget = new V3(); this.camPos = new V3(0, 0, 30); this.shake = 0;
      this.moveDir = new THREE.Vector2(); this.lead = new THREE.Vector2(); this.zoomK = 1.12; this.lastMove = -99;
      this.particles = new Particles(this.scene);
      this.time = 0; this.tickMs = 150; this.lastTick = 0;
      this.entities = new Map(); this.e = null; this.entShadows = []; this.ghosts = []; this.absorbing = [];
      this.buildEnvironment(); this.setupLights(); this.setupBackdrop();
      this.quality = undefined; this.setQuality(isMobile ? 'medium' : 'high');
      this.levelGroup = new THREE.Group(); this.scene.add(this.levelGroup);
      this.fx = document.getElementById('fx');
      this.resize();
    }
    buildEnvironment() {
      // an underwater 'light studio': deep water gradient, a bright surface window, and soft light panels
      // placed around the camera so glossy surfaces catch clear, shaped highlights.
      const env = new THREE.Scene();
      const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP);
          vec3 c = mix(vec3(0.02, 0.1, 0.28), vec3(0.25, 0.62, 0.95), smoothstep(-0.6, 0.5, d.y));
          c = mix(c, vec3(0.75, 0.95, 1.1), smoothstep(0.45, 0.95, d.y));
          c += vec3(4.0, 3.8, 3.4) * pow(max(0.0, dot(d, normalize(vec3(-0.4, 0.8, 0.6)))), 90.0);
          c += vec3(0.9, 0.62, 0.22) * smoothstep(-0.2, -0.75, d.y) * 0.6;
          c *= 1.0 - 0.75 * smoothstep(0.55, 0.98, d.z);  // dark 'studio wall' straight behind the camera keeps front faces rich
          gl_FragColor = vec4(c, 1.0); }` }));
      env.add(sky);
      const panel = (w, h, x, y, z, col, k, round = false) => {
        const m = new THREE.Mesh(round ? new THREE.CircleGeometry(w, 32) : new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
      panel(9, 5, -9, 10, 11, 0xfff4e4, 7);       // key softbox, upper left front
      panel(2.2, 14, 14, 2, 7, 0xbfe6ff, 4.5);    // tall strip, right
      panel(16, 1.6, 0, 15, 1, 0xe8f8ff, 5);      // overhead strip
      panel(2, 10, -15, -1, 3, 0x9fd8ff, 2.5);    // left kicker
      panel(12, 3, 2, -13, 5, 0xffb44a, 1.4);     // warm bounce from the sand below
      panel(3, 3, 6, 9, -10, 0xffffff, 5, true);  // back rim light
      const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromScene(env, 0.0).texture; pm.dispose();
    }
    setupLights() {
      this.hemi = new THREE.HemisphereLight(0xcdeaff, 0x0f1c48, 0.38); this.scene.add(this.hemi);
      this.key = new THREE.DirectionalLight(0xfff0d8, 4.0); this.key.position.set(-5, 9, 12); this.scene.add(this.key); this.scene.add(this.key.target);
      this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0006; this.key.shadow.normalBias = 0.02; this.key.shadow.radius = 3;
      this.fill = new THREE.DirectionalLight(0x8fd0ff, 0.55); this.fill.position.set(8, -2, 8); this.scene.add(this.fill);
      this.rim = new THREE.DirectionalLight(0xbff2ff, 1.8); this.rim.position.set(4, 10, -6); this.scene.add(this.rim); this.scene.add(this.rim.target);
      // pooled point lights: energy balls cast a warm glow onto the tiles around them, the gate lamp tints its neighbours
      this.ballLights = []; for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff5a24, 0, 2.8, 1.6); this.scene.add(l); this.ballLights.push(l); }
      this.gateLight = new THREE.PointLight(0xff3a2a, 0, 2.6, 1.6); this.scene.add(this.gateLight);
    }
    buildReef() {
      if (this.reef) { this.scene.remove(this.reef.group); this.reef.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      this.reef = Reef.build(this.quality === 'low'); this.scene.add(this.reef.group); this.reef.group.visible = !this.photoMode; // a tier change rebuilds it: keep it hidden behind the painting
      this.scene.fog = new THREE.Fog(0x0a5a8f, 60, 140);
      this.positionReef();
    }
    positionReef() { if (!this.reef || !this.e) return; const W = this.e.w, H = this.e.h; this.reef.group.position.set((W - 1) / 2, -(H - 1) - 1.3, 0); }
    // graphics tiers. 'auto' (see autoQuality) moves between them from the measured frame rate.
    //   low: 1x pixels, no post, no shadows | medium: post + 1K shadows | high: sharper pixels, 2K shadows, light shafts | ultra: full-res, 4K shadows, rich shafts, lens polish
    setQuality(q) {
      const T_ = { low: { pr: 1, post: false, sh: 0, msaa: 0, rays: 0, rs: 0, lens: 0, bloom: 0.75 }, medium: { pr: 1.25, post: true, sh: 1024, msaa: 2, rays: 0, rs: 0, lens: 0, bloom: 0.75 },
        high: { pr: 1.75, post: true, sh: 2048, msaa: 4, rays: 1.0, rs: 28, lens: 0, bloom: 0.8 }, ultra: { pr: 2.5, post: true, sh: 4096, msaa: 4, rays: 1.35, rs: 48, lens: 1, bloom: 0.85 } };
      if (q === 'auto' || !T_[q]) q = this.quality && T_[this.quality] ? this.quality : 'high'; const c = Object.assign({}, T_[q]); if (isMobile) c.msaa = Math.min(c.msaa, 2); const prev = this.quality, wasLow = prev === 'low', isLow = q === 'low'; this.quality = q;
      const ss = isMobile ? 1 : { low: 1, medium: 1, high: 1.25, ultra: 1.5 }[q]; // a touch of supersampling on desktop for crisper edges
      this.prBase = Math.min(c.pr, (devicePixelRatio || 1) * ss); this.pixelRatio = this.prBase * (this.resLock || this.resScale || 1); // resize() applies the pixel budget
      const P = this.post; P.enabled = c.post && P.supported;
      if (P.supported && P.main) { P.rays = c.rays; P.raySamples = c.rs; P.lens = c.lens; P.strength = c.bloom; if (P.main.samples !== c.msaa) { P.main.samples = c.msaa; P.main.dispose(); } }
      const shOn = c.sh > 0; if (this.renderer.shadowMap.enabled !== shOn) { this.renderer.shadowMap.enabled = shOn; this.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
      if (shOn && this.key.shadow.mapSize.x !== c.sh) { this.key.shadow.mapSize.set(c.sh, c.sh); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
      if (prev === undefined || wasLow !== isLow) this.buildReef();
      this.aqHold = performance.now() + 1800; this.resize(); if (this.e && this.levelGroup) this.render(); // redraw at once: a resized canvas is blank until the next draw (that blank frame was the flicker)
      if (this.onQuality) this.onQuality(q);
    }
    // adaptive quality: watch the real frame rate; drop a tier quickly when it struggles, climb back slowly when there's headroom
    autoQuality(realDt) {
      const A = this.aq || (this.aq = { t: 0, n: 0, sum: 0, since: 0, banned: {} }), order = ['low', 'medium', 'high', 'ultra'];
      // ignore: hidden tabs, long gaps (app switch, GC), and the first seconds after a level/tier change (one-time shader compiles)
      if (document.hidden || realDt <= 0 || realDt > 0.25 || performance.now() < (this.aqHold || 0)) { A.t = A.n = A.sum = 0; return; }
      A.t += realDt; A.n++; A.sum += realDt; A.since += realDt; const i = order.indexOf(this.quality);
      if (A.t < 1.5) return; const fps = A.n / A.sum;
      // a drop that didn't speed anything up means the browser is capping the frame rate (e.g. iOS Low Power Mode at 30 fps), not
      // the GPU struggling: go back up and stop dropping for this session
      if (A.check && A.t >= 2.5) { const c = A.check; A.check = null; if (fps < c.fps * 1.15) { A.capped = true; this.resScale = c.rs; this.setQuality(c.from); if (this.onAutoTier) this.onAutoTier(this.quality); A.t = A.n = A.sum = 0; return; } }
      if (A.capped) { A.t = A.n = A.sum = 0; return; }
      if (!this.resLock) { const rs = this.resScale || 1, minRs = isMobile ? 0.85 : 0.7;
        if (fps < (isMobile ? 45 : 52) && A.t >= 2.5 && rs > minRs + 0.02) { A.check = { from: this.quality, rs, fps }; this.resScale = Math.max(minRs, rs - (isMobile ? 0.075 : 0.1)); this.setQuality(this.quality); A.t = A.n = A.sum = 0; A.since = 0; return; }
        if (fps >= 58 && rs < 1 && A.since > 4) { this.resScale = Math.min(1, rs + 0.05); this.setQuality(this.quality); A.t = A.n = A.sum = 0; A.since = 0; return; } }
      if (fps < (this.menuMode ? 47 : isMobile ? 38 : 50) && A.t >= 3 && i > 0) { A.check = { from: this.quality, rs: this.resScale || 1, fps }; A.banned[order[i]] = performance.now() + 120000; this.setQuality(order[Math.max(0, i - 1)]); A.since = 0; if (this.onAutoTier) this.onAutoTier(this.quality); }
      else if (A.t >= 4 && fps >= 57 && i < 3 && A.since > 6 && (this.menuMode || !this.e) && !((A.banned[order[i + 1]] || 0) > performance.now())) { this.setQuality(order[i + 1]); A.since = 0; if (this.onAutoTier) this.onAutoTier(this.quality); }
      else if (A.t < 4) return;
      A.t = A.n = A.sum = 0;
    }
    setupBackdrop() {
      this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: TEX.backdrop, toneMapped: false, depthWrite: false, fog: false }));
      this.backdrop.renderOrder = -10; this.scene.add(this.backdrop);
      // animated light rays over the painting
      const rayMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec2 vUv; uniform float time; void main(){ vec2 p = vUv - vec2(0.5, 1.05); float ang = atan(p.x, -p.y); float r = length(p);
          float rays = 0.0; for (int i = 0; i < 3; i++) { float fi = float(i); rays += pow(max(0.0, 0.5 + 0.5 * sin(ang * (9.0 + fi * 5.0) + time * (0.15 + fi * 0.07) + fi * 2.0)), 6.0); }
          float a = rays * 0.09 * smoothstep(1.1, 0.1, r) * smoothstep(0.0, 0.15, r); gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a, a); }` });
      this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), rayMat); this.rays.renderOrder = -9; this.scene.add(this.rays); this.rayMat = rayMat;
    }
    // ---- photo background (test on the first level): your painting + bubbles, surface shimmer and a distant school
    buildPhotoBg() {
      if (this.photo) return; const g = new THREE.Group(); this.scene.add(g);
      const tex = photoTex(PHOTO_IMG);
      const AR = 1435 / 2560; const bgM = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false, fog: false }); MAT.bgLift = MAT.bgLift || { value: 1 };
      bgM.onBeforeCompile = (sh) => { sh.uniforms.uBgLift = MAT.bgLift; sh.fragmentShader = 'uniform float uBgLift;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 c = diffuseColor.rgb; float bl = clamp((c.b - max(c.r, c.g)) * 3.0, 0.0, 1.0) * uBgLift; float yy = vMapUv.y; // the reference's water: teal-cyan, sunlit toward the surface
          c.g = mix(c.g, c.g * 1.18, bl); c.r = mix(c.r, c.r + c.b * 0.03, bl);
          c += vec3(0.05, 0.22, 0.08) * pow(smoothstep(0.62, 1.0, yy), 1.6) * bl; diffuseColor.rgb = c; }`); };
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, AR), bgM); bg.renderOrder = -10; g.add(bg);
      const shimmer = new THREE.Mesh(new THREE.PlaneGeometry(1, AR), new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uT; varying vec2 vUv; void main(){ if (vUv.y < 0.25) discard; vec2 p = vUv * vec2(9.0, 4.0);
          float a = sin(p.x * 1.3 + uT * 0.8 + sin(p.y * 2.1 + uT * 0.5) * 1.6), b = sin(p.y * 2.7 - uT * 0.6 + sin(p.x * 1.7 - uT * 0.7) * 1.4);
          float c = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 7.0) * smoothstep(0.62, 0.98, vUv.y);
          float rays = pow(max(0.0, sin(vUv.x * 26.0 + sin(uT * 0.25) * 2.0 + vUv.y * 4.0)), 18.0) * smoothstep(0.25, 0.95, vUv.y) * (0.5 + 0.5 * sin(uT * 0.7 + vUv.x * 9.0));
          float v = c * 0.35 + rays * 0.06; gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * v, v); }` }));
      shimmer.renderOrder = -9; g.add(shimmer);
      const N = World.isMobile ? 60 : 110, pos = new Float32Array(N * 3), sd = new Float32Array(N);
      for (let i = 0; i < N; i++) { const col = (i % 9) / 9 - 0.5; pos.set([col + (Math.random() - 0.5) * 0.06, Math.random(), Math.random()], i * 3); sd[i] = 0.5 + Math.random(); }
      const bgG = new THREE.BufferGeometry(); bgG.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bgG.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
      const bubM = new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT, tex: { value: TEX.bubble }, uW: { value: 30 }, uH: { value: 17 }, scale: { value: 500 } }, transparent: true, depthWrite: false, toneMapped: false, fog: false,
        vertexShader: `attribute float aS; uniform float uT, uW, uH, scale; varying float vA; void main(){ float y = fract(position.y + uT * 0.025 * aS);
          vec3 p = vec3(position.x * uW + sin(uT * 1.5 * aS + position.z * 6.0) * 0.25, (y - 0.5) * uH, -6.0 - position.z * 18.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (0.18 + aS * 0.14) * scale / -mv.z; vA = smoothstep(0.0, 0.08, y) * smoothstep(1.0, 0.85, y) * 0.75; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: 'uniform sampler2D tex; varying float vA; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85, 0.96, 1.0), t.a * vA); }' });
      const bubbles = new THREE.Points(bgG, bubM); bubbles.frustumCulled = false; bubbles.renderOrder = -8; g.add(bubbles);
      const fishG = new THREE.SphereGeometry(0.16, 10, 6); fishG.scale(1, 0.45, 0.3); const fishM = new THREE.MeshBasicMaterial({ color: 0x1d4f9a, transparent: true, opacity: 0.55, fog: false });
      const fishSpr = ['fishA', 'fishC', 'fishD', 'fishE', 'fishF', 'fishG', 'fishH', 'fishI', 'school'].map(n => { const f = sprPlane(n, n === 'school' ? 0.6 : 0.5, false, { k: 0.45, dz: 0.6, op: 0.22 }); f.material = f.material.clone(); f.material.depthWrite = false; f.renderOrder = -7; f.userData.shadow.renderOrder = -7.5; g.add(f); return f; });
      const school = new THREE.InstancedMesh(fishG, fishM, 9); school.visible = false; school.frustumCulled = false; g.add(school);
      const jellies = [0, 1, 2, 3].map(i => { const j = sprPlane('jellyN', 0.9 + (i % 2) * 0.4, false, false); j.material = j.material.clone(); j.material.depthWrite = false; j.material.transparent = true; j.material.opacity = 0.75; j.renderOrder = -7; g.add(j); return j; });
      this.photo = { group: g, bg, shimmer, bubbles, bubM, school, fishSpr, jellies, off: [...Array(9)].map(() => [Math.random() * 1.6, Math.random() * 0.8, Math.random() * 6]) };
    }
    // screen-filling placement of the painting for a given camera (its sand line, ~20% up from the bottom, under the tank's plinth on portrait)
    photoFit(cam, AR) {
      // the painting always sits at the same depth in the world (z = -30), so it gets the right amount of parallax however far back the camera is
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), dist = (-30 - cam.position.z) / fwd.z;
      const fov = cam.fov * Math.PI / 180, hv = 2 * Math.tan(fov / 2) * dist, wv = hv * cam.aspect; let sc = Math.max(wv, hv / AR) * 1.15, off = 0;
      if (this.e) { const nb = new THREE.Vector3((this.e.w - 1) / 2, -(this.e.h - 1.5) - 0.86, -19).project(cam).y, v0 = 0.36;
        // grow the painting (at most 1.7x the view, so it stays sharp) and slide it so its sand line lands as close to the plinth as covering the screen allows;
        // on tall phones the 3D seabed in front of the tank fills the rest
        const Hp = Math.min(hv * 1.8, Math.max(sc * AR, (hv / 2) * (1 - nb) / (1 - v0) * 1.06)); sc = Hp / AR;
        off = Math.max(nb * hv / 2 - (v0 - 0.5) * Hp, hv / 2 * 1.03 - Hp / 2); } // never uncover the top; the seabed covers the bottom
      const q = cam.quaternion.clone(), pos = cam.position.clone().addScaledVector(fwd, dist).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), off);
      return { pos, q, sc };
    }
    placePhotoBg(t) {
      // The painting is a fixed backdrop in the world (placed to fill the whole-level view), so zooming in or following the diver
      // zooms/pans it too, with natural parallax, instead of it being glued to the screen.
      const P = this.photo; if (!P || !P.group.visible || !this.e) return; const AR = 1435 / 2560, cam = this.camera;
      const key = [this.e.w, this.e.h, cam.aspect.toFixed(3), (this.dFull || 0).toFixed(2)].join();
      if (P.key !== key) { P.key = key;
        const g0 = this.camGoal.clone(), l0 = this.lookGoal.clone(); this.updateCameraTarget(true); const cg = this.camGoal.clone(), lg = this.lookGoal.clone(); this.camGoal.copy(g0); this.lookGoal.copy(l0);
        const rc = P.refCam || (P.refCam = new THREE.PerspectiveCamera()); rc.fov = cam.fov; rc.aspect = cam.aspect; rc.near = cam.near; rc.far = cam.far; rc.updateProjectionMatrix();
        const d = cg.z; rc.position.set(cg.x + d * Math.cos(this.tilt) * Math.sin(CAM_YAW), lg.y + d * Math.sin(this.tilt) - (lg.y - cg.y), d * Math.cos(this.tilt) * Math.cos(CAM_YAW)); rc.lookAt(lg.x, lg.y, 0); rc.updateMatrixWorld(true);
        P.fixed = this.photoFit(rc, AR); }
      let { pos, q, sc } = this.menuMode || this.cineCam ? this.photoFit(cam, AR) : P.fixed; // menu + intro fly-in: always fill the screen
            for (const m of [P.bg, P.shimmer]) { m.scale.set(sc, sc, 1); m.position.copy(pos); m.quaternion.copy(q); }
      const fov = cam.fov * Math.PI / 180, hView = 2 * Math.tan(fov / 2) * (P.fixed.pos.distanceTo(P.refCam.position) - 8), wView = hView * cam.aspect, cx = P.refCam.position.x, cy = P.refCam.position.y;
      P.bubbles.position.set(cx, cy, 0); P.bubM.uniforms.uW.value = wView * 0.75; P.bubM.uniforms.uH.value = hView * 0.9; P.bubM.uniforms.scale.value = innerHeight * this.pixelRatio * 0.9;
      const d0 = new THREE.Object3D(), span = wView * 0.7, sx = ((t * 0.9) % (span * 2.4)) - span * 1.2;
      P.off.forEach(([ox, oy, ph], i) => { d0.position.set(cx + sx + ox * 1.4, cy + hView * 0.12 + oy * 1.1 + Math.sin(t * 1.3 + ph) * 0.1, -14); d0.rotation.set(0, 0, Math.sin(t * 2 + ph) * 0.08); d0.updateMatrix(); P.school.setMatrixAt(i, d0.matrix); });
      P.school.instanceMatrix.needsUpdate = true;
      // jellyfish drifting up through the distant water on both sides of the tank, pulsing as they swim
      if (P.jellies && this.e) P.jellies.forEach((j, i) => { const side = i % 2 ? 1 : -1, H2 = hView * 0.8, y = ((t * (0.18 + i * 0.03) + i * 3.1) % H2) - H2 * 0.35;
        const pulse = 1 + Math.sin(t * 2.2 + i * 1.7) * 0.08; j.position.set(cx + side * (this.e.w / 2 + 2.5 + (i >> 1) * 2.2), cy + y, -9 - i * 1.5); j.scale.set(pulse, 2 - pulse, 1); j.rotation.z = Math.sin(t * 0.6 + i) * 0.12; });
      P.fishSpr.forEach((f, i) => { const dir = i % 2 ? -1 : 1, sp2 = 0.6 + (i % 3) * 0.25, W2 = wView * 0.9, x = ((t * sp2 + i * 7.3) % (W2 * 2.2)) - W2 * 1.1;
        f.position.set(cx + dir * x, cy + hView * (0.05 + (i % 4) * 0.07) + Math.sin(t * 1.4 + i) * 0.12, -10 - (i % 3) * 3); f.scale.set(-dir, 1, 1); });
    }
    placeBackdrop() {
      // keep the painting filling the view, a little behind the board, with gentle parallax
      const d = 40, z = -d; const fov = this.camera.fov * Math.PI / 180;
      const hView = 2 * Math.tan(fov / 2) * (this.camera.position.z - z), wView = hView * this.camera.aspect;
      const s = Math.max(wView * 1.15, hView * 2.3);
      for (const m of [this.backdrop, this.rays]) { m.scale.set(s, s, 1); m.position.set(this.camera.position.x * 0.85, this.camera.position.y * 0.85 + s * 0.04, z); }
    }
    resize() {
      const w = innerWidth, h = innerHeight; if (!w || !h) return;
      // pixel budget per tier: a 4K / retina monitor at Ultra would otherwise draw 10+ million pixels every frame
      const mp = { low: 1.3, medium: 2.2, high: 3.4, ultra: 5.2 }[this.quality] || 3.4;
      this.pixelRatio = Math.max(0.6, Math.min(this.prBase || this.pixelRatio, Math.sqrt(mp * 1e6 / (w * h)))) * (this.resLock || this.resScale || 1);
      this.renderer.setPixelRatio(this.pixelRatio); this.renderer.setSize(w, h, false);
      this.post.setSize(Math.round(w * this.pixelRatio), Math.round(h * this.pixelRatio));
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.particles.mat.uniforms.scale.value = h * this.pixelRatio * 0.9; this.particles.bubMat.uniforms.scale.value = h * this.pixelRatio * 0.9; if (this.story) this.story.resize();
      this.fitCamera(true, this.e && !this.e.menu && !this.playing);
    }

    // ---- level construction ----
    keepTreasures() { this._keepTreasures = (this.treasures || []).filter(t => t.state !== 'buried').map(t => ({ cx: t.cx, cy: t.cy, x: t.m.position.x, y: t.m.position.y, rz: t.m.rotation.z })); }
    // free everything a level built on the GPU (geometries, materials, textures) except the shared caches (GEO / MAT / TEX / SPR /
    // sand shapes). Without this every level load, restart and undo leaked ~2 MB of GPU memory until the context died.
    disposeLevel() { const shared = new Set(), seen = new Set();
      const scan = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return; seen.add(o);
        if (o.isMaterial || o.isBufferGeometry || o.isTexture) { shared.add(o); if (o.isMaterial) for (const k in o) { const v = o[k]; if (v && v.isTexture) shared.add(v); } return; }
        if (o.isObject3D) return; if (o instanceof Map) { for (const v of o.values()) scan(v, d + 1); return; }
        const pr = Object.getPrototypeOf(o); if (pr !== Object.prototype && pr !== Array.prototype && pr !== null) return; // plain containers only: never walk pixel buffers, images or canvases
        for (const k in o) scan(o[k], d + 1); };
      scan(GEO, 0); scan(MAT, 0); scan(TEX, 0); scan(SPR, 0); scan(sandGeoCache, 0);
      // a level's materials are not disposed: disposing them deletes their compiled shader programs, and the next level would
      // compile the very same shaders again (that was most of the pause when a level starts). Programs are few and shared.
      const keepPrograms = this.renderer.info.programs.length < 260;
      const freeMat = (m) => { if (!m || shared.has(m)) return; for (const k in m) { const v = m[k]; if (v && v.isTexture && !shared.has(v)) v.dispose(); } if (!keepPrograms) m.dispose(); };
      this.levelGroup.traverse(o => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(freeMat); });
      for (const t of [this.maskTex, this.occTex]) if (t) t.dispose(); }
    clearLevel() {
      this.disposeLevel(); this.levelGroup.clear(); this.entShadows = []; this.entities.clear(); this.particles.n = 0; this.particles.bub.n = 0;
      this.gateObj = null; this.gateFx = null; this.pops = []; this.coachCells = null; this.sandInst = null; this.treasures = []; this.digChunks = []; if (this.warn) this.warn.visible = false; this.ghosts = []; this.absorbing = []; this.deathTint = 0; this.setFx('');
    }
    loadLevel(e) { this.arr = null; this.mood = null; this.quakeT = 0; this.flickT = 0; this.relic = null; this.revealQ = null; if (this.dangerPool) { this.setDanger(null); this.dangerPool.forEach(sp => { sp.userData.k = 0; sp.visible = false; }); }
      this.clearLevel(); this.e = e; this.shadowDirty = true; this.mood = null; this.playerAct = null; this.lastHup = -9; const ART = ART_SETS[NEW_ART_LEVELS.has(e.name) || e.menu || e.daily ? 'new' : 'old']; this.newArt = ART === ART_SETS.new; MAT.sandNew.value = this.newArt ? 1 : 0; this.tickMs = e.tickMs; this.menuMode = !!e.menu; this.playing = false; this.lead.set(0, 0); this.lastMove = -99; this.zoomK = 1.12; this.playerPos = null;
      const W = e.w, H = e.h; this.particles.top = 1;
      const sand = [], blocks = [], cobbles = [], solid = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = e.get(x, y); if (t === T.SAND) sand.push([x, y]); else if (t === T.STEEL) { if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue; blocks.push([x, y]); solid.push([x, y]); } else if (t === T.WALL) { cobbles.push([x, y]); } }
      const dummy = new THREE.Object3D();
      const inst = (geo, mat, cells, z = 0) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length)); cells.forEach(([x, y], i) => { dummy.position.set(x, -y, z); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }); im.count = cells.length; im.instanceMatrix.needsUpdate = true; this.levelGroup.add(im); return im; };
      // dark grout behind block masses so the gaps between bevels read as mortar
      inst(GEO.backing, MAT.backing, solid, -0.3);
      // ---- glass tank instead of the outer block frame: the level is a cross-section tank sitting on the seabed
      { const x0 = 0.5, x1 = W - 1.5, yT = -0.5, yB = -(H - 1.5), cx = (x0 + x1) / 2, cy = (yT + yB) / 2, w = x1 - x0, h = yT - yB, zF = 0.52, zB = -0.5;
        const tank = new THREE.Group(); this.levelGroup.add(tank);
        if (!MAT.glassBack) {
          MAT.glassBack = new THREE.MeshPhysicalMaterial({ color: 0x1f6fb8, transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false });
          MAT.glassSide = surfMat({ color: 0xbfeaf2, transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
          const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
          const streak = (x, wd, a) => { const gr = g.createLinearGradient(x, 0, x + wd, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.save(); g.transform(1, 0, -0.45, 1, 0, 0); g.fillRect(x, 0, wd, 256); g.restore(); };
          streak(90, 60, 0.22); streak(170, 18, 0.18); streak(380, 40, 0.12);
          MAT.glassFront = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.22 });
          MAT.trim = new THREE.MeshPhysicalMaterial({ color: 0x2c6d78, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3 });
          MAT.trimCap = new THREE.MeshPhysicalMaterial({ color: 0xe0b85a, metalness: 0.8, roughness: 0.25, clearcoat: 1, envMapIntensity: 1.5 });
          MAT.plinth = causticify(new THREE.MeshPhysicalMaterial({ color: 0xcdb78f, roughness: 0.75, clearcoat: 0.2, envMapIntensity: 0.4 }), 0.15);
          MAT.plinthSide = new THREE.MeshPhysicalMaterial({ color: 0xa48e66, roughness: 0.8, envMapIntensity: 0.3 });
          // new look: deep navy lacquered frame + warm teak stand
          MAT.trimN = surfMat({ color: 0x18284f, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5 });
          MAT.plinthN = causticify(surfMat({ color: 0x8a5a36, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6, sheen: 0.3, sheenColor: 0xffd29a }), 0.12);
          MAT.plinthSideN = surfMat({ color: 0x5e3b22, roughness: 0.6, clearcoat: 0.4, envMapIntensity: 0.4 });
        }
        // back glass (tinted, you see the reef through it), side panes, faint front reflections
        const WS = WORLD_STYLE[e.menu || e.cine ? 0 : worldOf(e.name)];
        const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.newArt ? (MAT.waterBack || (MAT.waterBack = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: MAT.causticT, uH: { value: new THREE.Vector2() }, uLo: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uGlow: { value: 0 }, uLamp: MAT.lamp, uLampAmb: MAT.lampAmb },
          vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
          fragmentShader: `uniform float uT, uGlow, uLampAmb; uniform vec2 uH; uniform vec3 uLo, uHi; uniform vec4 uLamp; varying vec3 vW; void main(){ float k = clamp((vW.y - uH.x) / (uH.y - uH.x), 0.0, 1.0);
            vec3 c = mix(uLo, uHi, pow(k, 1.1));
            { vec2 q = vW.xy * 2.2 + vec2(0.0, uT * 0.12); vec2 ci = floor(q); float h = fract(sin(dot(ci, vec2(37.1, 91.7))) * 43758.5); vec2 f = fract(q) - 0.5 - (vec2(fract(h * 7.3), fract(h * 3.1)) - 0.5) * 0.6;
              c += vec3(0.4, 0.95, 1.0) * uGlow * step(0.9, h) * smoothstep(0.09, 0.0, length(f)) * (0.5 + 0.5 * sin(uT * 2.0 + h * 40.0)); } // the deep: drifting bioluminescent specks c += vec3(0.1, 0.18, 0.2) * smoothstep(0.35, 0.0, abs(fract(vW.x * 0.11 + 0.3) - 0.5)) * k; // lighter, bluer water with soft light pools                                     // deep blue at the floor -> bright cyan under the surface
            vec2 p = vW.xy * 0.9; float a = sin(p.x * 3.1 + uT * 0.8 + sin(p.y * 2.3 + uT * 0.55) * 1.5), b = sin(p.y * 2.7 - uT * 0.65 + sin(p.x * 2.9 - uT * 0.7) * 1.5);
            float cau = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 6.0); c += vec3(0.55, 0.95, 1.0) * cau * (0.1 + 0.18 * k);            // moving caustic net on the back glass
            { float sx = vW.x * 0.34 + vW.y * 0.16 + sin(uT * 0.11) * 0.35, sh = pow(0.5 + 0.5 * sin(sx * 6.2832 + sin(sx * 2.1 + uT * 0.07) * 1.3), 6.0);
              c += uHi * sh * (0.05 + 0.16 * k * k); }                                                                              // soft slanted sun shafts, swaying slowly, strongest under the surface
            float silA = 0.0; { float x = vW.x; // hazy reef behind the tank (the reference shows blue rock pillars through the water): a far and a near layer
              float far = 0.66 + 0.13 * sin(x * 0.7 + 1.3) + 0.09 * sin(x * 1.9 + 0.4) + 0.05 * sin(x * 4.3) + 0.12 * smoothstep(0.55, 0.9, sin(x * 0.45 + 2.0));
              float nr = 0.45 + 0.08 * sin(x * 1.1 + 4.0) + 0.06 * sin(x * 2.7 + 1.0) + 0.03 * sin(x * 6.3) + 0.16 * smoothstep(0.6, 0.95, sin(x * 0.62 + 5.1));
              float fm = smoothstep(far + 0.012, far - 0.012, k), nm = smoothstep(nr + 0.01, nr - 0.01, k);
              float tex = 0.5 + 0.5 * sin(x * 9.0 + sin(vW.y * 5.0) * 1.5) * sin(vW.y * 7.0 + x * 2.0);
              c = mix(c, mix(mix(uLo, uHi, 0.3), vec3(0.36, 0.42, 0.9), 0.4) * (0.72 + 0.12 * tex), fm * 0.8); silA = max(fm * 0.75, nm * 0.9);
              c = mix(c, mix(uLo, vec3(0.26, 0.24, 0.66), 0.5) * (0.62 + 0.14 * tex) + uHi * 0.04, nm * 0.88);
              { float cx = floor(x * 2.6), hc = fract(sin(cx * 91.7) * 4375.5); vec2 q = vec2(fract(x * 2.6) - 0.5, (k - nr) * 9.0); float blob = smoothstep(0.32, 0.0, length(q - vec2((hc - 0.5) * 0.4, 0.1)));
                c = mix(c, mix(vec3(1.0, 0.42, 0.62), vec3(1.0, 0.62, 0.25), step(0.5, hc)) * 0.75, blob * step(0.35, hc) * 0.65 * (1.0 - uGlow * 0.6)); } // coral tufts on the near ridge
              c += uHi * 0.16 * smoothstep(0.05, 0.0, far - k) * fm + uHi * 0.12 * smoothstep(0.04, 0.0, nr - k) * nm; } // sunlit rims on top of each layer
            c *= 0.9 + 0.1 * smoothstep(0.0, 0.5, k);                                                                               // the floor of a tunnel a touch deeper
            { vec2 q = vW.xy * 5.0 + vec2(sin(uT * 0.21 + vW.y) * 0.4, uT * 0.18); vec2 ci = floor(q); float h = fract(sin(dot(ci, vec2(91.7, 37.3))) * 43758.5);
              vec2 f = fract(q) - 0.5 - (vec2(fract(h * 5.7), fract(h * 9.1)) - 0.5) * 0.7; c += vec3(0.8, 0.95, 1.0) * step(0.93, h) * smoothstep(0.06, 0.0, length(f)) * 0.22; } // tiny motes drifting in the water
            { float d = length(vW.xy - uLamp.xy), pool = smoothstep(uLamp.z * 2.0, 0.0, d); c *= 1.0 - uLampAmb * 0.8 * (1.0 - pool); c += vec3(0.5, 0.42, 0.25) * pool * pool * uLamp.w * 0.35; }
            gl_FragColor = vec4(pow(c, vec3(2.2)), mix(0.5 + 0.12 * (1.0 - k), 0.92, silA)); }` }))) : MAT.glassBack);
        if (this.newArt) { const U = back.material.uniforms; U.uH.value.set(yB, yT); U.uLo.value.setRGB(...WS.lo); U.uHi.value.setRGB(...WS.hi); U.uGlow.value = WS.glow; }
        back.position.set(cx, cy, zB); back.renderOrder = 1; tank.add(back);
        for (const sx of [x0, x1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(zF - zB, h), MAT.glassSide); p.rotation.y = Math.PI / 2; p.position.set(sx, cy, (zF + zB) / 2); p.renderOrder = 2; tank.add(p); }
        const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MAT.glassFront); front.position.set(cx, cy, zF); front.renderOrder = 5; tank.add(front);
        // slim teal frame with little brass corner caps
        if (this.newArt) MAT.trimN.color.set(WS.trim); const trimM = this.newArt ? MAT.trimN : MAT.trim, bar = (lx, ly, lz, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), trimM); m.position.set(px, py, pz); m.castShadow = true; tank.add(m); return m; };
        const T2 = this.newArt ? 0.15 : 0.12;
        for (const sx of [x0, x1]) for (const sz of [zF, zB]) bar(T2, h + T2, T2, sx, cy, sz);           // four upright edges
        for (const sz of [zF, zB]) bar(w + T2, T2, T2, cx, yT, sz);                                       // top rims
        for (const sx of [x0, x1]) bar(T2, T2, zF - zB + T2, sx, yT, (zF + zB) / 2);                      // top side rims
        for (const sx of [x0, x1]) for (const sz of [zF, zB]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(this.newArt ? 0.14 : 0.11, 16, 10), MAT.trimCap); cap.position.set(sx, yT, sz); tank.add(cap); }
        // stone plinth the tank stands on, resting on the seabed
        const pl = new THREE.Mesh(roundedBox(w + 0.7, 0.85, 1.3, 0.12), this.newArt ? [MAT.plinthN, MAT.plinthSideN] : [MAT.plinth, MAT.plinthSide]); pl.position.set(cx, yB - 0.42, 0); pl.castShadow = pl.receiveShadow = true; tank.add(pl);
        bar(w + 0.3, 0.1, zF - zB + 0.25, cx, yB - 0.02, 0).material = MAT.trim;
        this.pump = null; this.streams = null; if (this.newArt) this.buildPremiumTank(tank, { x0, x1, yT, yB, cx, cy, w, h, zF, zB });
        if (false) { const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d'), idx = LEVELS.findIndex(l => l.name === e.name) + 1;
          const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, '#ffe7a3'); gr.addColorStop(0.45, '#d9a63c'); gr.addColorStop(1, '#8a5a17');
          g.fillStyle = gr; g.beginPath(); g.roundRect(8, 8, 1008, 144, 36); g.fill(); g.lineWidth = 6; g.strokeStyle = '#5a3a0c'; g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.beginPath(); g.roundRect(22, 22, 980, 116, 26); g.stroke();
          for (const sx of [56, 968]) { g.fillStyle = '#7a4f12'; g.beginPath(); g.arc(sx, 80, 13, 0, 7); g.fill(); g.fillStyle = '#ffe9b0'; g.beginPath(); g.arc(sx - 3, 77, 5, 0, 7); g.fill(); }
          g.font = '700 74px "Lilita One", "Baloo 2", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; const txt = `LEVEL ${idx}  ·  ${e.name.toUpperCase()}`;
          g.fillStyle = 'rgba(255,240,200,0.8)'; g.fillText(txt, 512, 86); g.fillStyle = '#4a2c06'; g.fillText(txt, 512, 82); // engraved
          const t2 = new THREE.CanvasTexture(c); t2.colorSpace = THREE.SRGBColorSpace; t2.anisotropy = 8;
          const pw = Math.min(w * 0.55, 4.2), plq = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw * 160 / 1024), new THREE.MeshPhysicalMaterial({ map: t2, metalness: 0.6, roughness: 0.32, clearcoat: 1, envMapIntensity: 1.2 }));
          plq.position.set(cx, yB - 0.4, 0.656); tank.add(plq);
          if (document.fonts && document.fonts.load) document.fonts.load('700 74px "Lilita One"').then(() => { g.clearRect(0, 0, 1024, 160); g.fillStyle = gr; g.beginPath(); g.roundRect(8, 8, 1008, 144, 36); g.fill(); g.lineWidth = 6; g.strokeStyle = '#5a3a0c'; g.stroke();
            g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.beginPath(); g.roundRect(22, 22, 980, 116, 26); g.stroke(); for (const sx of [56, 968]) { g.fillStyle = '#7a4f12'; g.beginPath(); g.arc(sx, 80, 13, 0, 7); g.fill(); g.fillStyle = '#ffe9b0'; g.beginPath(); g.arc(sx - 3, 77, 5, 0, 7); g.fill(); }
            g.font = '700 74px "Lilita One", "Baloo 2", sans-serif'; g.fillStyle = 'rgba(255,240,200,0.8)'; g.fillText(txt, 512, 86); g.fillStyle = '#4a2c06'; g.fillText(txt, 512, 82); t2.needsUpdate = true; }).catch(() => {}); }
        // ---- life around the base: rocks along the plinth, coral clumps, swaying seaweed at the tank corners
        { const rnd = (() => { let sd = 4242 + W * 7 + H; return () => (sd = (sd * 16807) % 2147483647) / 2147483647; })();
          const rockM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, envMapIntensity: 0.5 });
          const rockG = new THREE.IcosahedronGeometry(0.24, 1); const nR = Math.round((w + 1.6) / 0.62);
          const rocks = new THREE.InstancedMesh(rockG, rockM, nR + 6); const d0 = new THREE.Object3D(); let ri = 0;
          for (let i = 0; i < nR; i++) { const sc = 0.7 + rnd() * 0.7, rx = x0 - 0.8 + i * 0.62; d0.position.set(rx + (rnd() - 0.5) * 0.25, yB - 0.9 + sc * 0.1, 0.6 + rnd() * 0.3); d0.scale.set(sc * 1.25, sc * 0.7, sc); d0.rotation.set(rnd(), rnd() * 6, rnd()); d0.updateMatrix(); rocks.setMatrixAt(ri, d0.matrix); rocks.setColorAt(ri++, new THREE.Color().setHSL(0.6 + rnd() * 0.04, 0.45, 0.26 + rnd() * 0.12)); }
          for (const sx of [x0 - 0.75, x1 + 0.75]) for (let k = 0; k < 3; k++) { const sc = 1 + rnd() * 0.8; d0.position.set(sx + (rnd() - 0.5) * 0.6, yB - 0.75 + sc * 0.15, 0.3 + rnd() * 0.5); d0.scale.set(sc * 1.3, sc, sc); d0.rotation.set(rnd(), rnd() * 6, rnd()); d0.updateMatrix(); rocks.setMatrixAt(ri, d0.matrix); rocks.setColorAt(ri++, new THREE.Color().setHSL(0.6, 0.22, 0.42 + rnd() * 0.1)); }
          rocks.count = ri; rocks.castShadow = rocks.receiveShadow = true; tank.add(rocks);
          if (this.newArt && WS.crystals) { // glowing crystal clusters on the seabed in front of the stand (violet caves / the deep)
            const cg = new THREE.OctahedronGeometry(0.16, 0); cg.scale(0.55, 1.6, 0.55); const cm = new THREE.MeshPhysicalMaterial({ color: WS.crystals, emissive: WS.crystals, emissiveIntensity: 0.9, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.9 });
            const nCl = Math.max(3, Math.round(w / 3.2)), cr = new THREE.InstancedMesh(cg, cm, nCl * 4); let ci = 0;
            for (let k = 0; k < nCl; k++) { const bx = x0 - 0.3 + (k + 0.5) * (w + 0.6) / nCl + (rnd() - 0.5) * 0.8; for (let j = 0; j < 4; j++) { const sc = 0.6 + rnd() * 0.7; d0.position.set(bx + (j - 1.5) * 0.12, yB - 0.92 + sc * 0.2, 1.05 + rnd() * 0.25); d0.rotation.set(0, rnd() * 3, (j - 1.5) * 0.35); d0.scale.setScalar(sc); d0.updateMatrix(); cr.setMatrixAt(ci++, d0.matrix); } }
            cr.count = ci; cr.castShadow = true; tank.add(cr); }
          // bubble-coral clumps (pink / purple / orange) sitting on the rocks in front of the plinth
          const coralCols = [0xff6fae, 0xa86bff, 0xff9a4a, 0x5fd3c4]; const ballG = new THREE.SphereGeometry(0.11, 14, 10);
          const coralM = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6, emissive: 0x22081a, emissiveIntensity: 1, envMapIntensity: 0.6 });
          const nC = Math.max(4, Math.round(w / 2.2)); const balls = new THREE.InstancedMesh(ballG, coralM, nC * 12);
          let bi = 0; for (let k = 0; k < nC; k++) { const cx0 = x0 - 0.4 + (k + 0.5) * (w + 0.8) / nC + (rnd() - 0.5) * 0.5, col = new THREE.Color(coralCols[(rnd() * 4) | 0]);
            for (let j = 0; j < 12; j++) { const a = rnd() * 6.28, r = rnd() * 0.22, hgt = rnd() * 0.4; d0.position.set(cx0 + Math.cos(a) * r, yB - 0.6 + hgt, 0.98 + Math.sin(a) * r * 0.6); d0.scale.setScalar(0.7 + rnd() * 0.8 - hgt); d0.rotation.set(0, 0, 0); d0.updateMatrix(); balls.setMatrixAt(bi, d0.matrix); balls.setColorAt(bi++, col.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.12)); } }
          balls.count = bi; balls.visible = false; tank.add(balls);
          { const row = ART.plinth;
            const NA = this.newArt, n = Math.max(5, Math.round((w + 1.6) / (NA ? 0.78 : 1.05))); for (let k = 0; k < n; k++) { const nm = row[(k + W) % row.length], hgt = (isRockSpr(nm) ? 0.62 + rnd() * 0.2 : isPlantSpr(nm) ? (NA ? 0.6 + rnd() * 0.25 : 0.8 + rnd() * 0.45) : 0.55 + rnd() * 0.25) * (NA ? 0.7 + rnd() * 0.65 : 1);
              const px0 = x0 - 0.6 + (k + 0.5) * (w + 1.2) / n; 
              const sp = sprPlane(nm, hgt, true, { dz: 0.16, op: 0.6, lean: 0.38 }); sp.position.set(x0 - 0.6 + (k + 0.5) * (w + 1.2) / n + (rnd() - 0.5) * (NA ? 0.7 : 0.3), yB - 0.9, (NA ? 0.86 + rnd() * 0.42 : 0.92 + rnd() * 0.25)); if (rnd() < 0.5) sp.scale.x = -1;
              if (isPlantSpr(nm)) { const ph = rnd() * 6; sp.userData.sway = [0.06, 1.2, ph]; sp.onBeforeRender = () => { sp.rotation.z = Math.sin(performance.now() / 1000 * 1.2 + ph) * 0.06; }; } tank.add(sp); } }
          // seaweed fronds hugging the tank's sides, gently swaying
          const blade = new THREE.PlaneGeometry(0.16, 1, 1, 8); blade.translate(0, 0.5, 0); { const P = blade.attributes.position; for (let i = 0; i < P.count; i++) { const yy = P.getY(i); P.setX(i, P.getX(i) * (1 - yy * 0.7) + Math.sin(yy * 4) * 0.05); } blade.computeVertexNormals(); }
          const weedM = new THREE.MeshPhysicalMaterial({ color: 0x3fae58, roughness: 0.45, clearcoat: 0.4, side: THREE.DoubleSide, emissive: 0x0b3018, emissiveIntensity: 1, sheen: 0.6, sheenColor: 0xbaffc8 });
          for (const sx of []) for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(blade, weedM); const hh = 1.1 + rnd() * 1.4; m.scale.set(1 + rnd() * 0.6, hh, 1); m.position.set(sx + (rnd() - 0.5) * 0.5, yB - 0.6, 0.55 + rnd() * 0.3); m.rotation.y = rnd() * 3;
            const ph = rnd() * 6; m.onBeforeRender = () => { m.rotation.z = Math.sin(performance.now() / 1000 * 1.3 + ph) * 0.12; }; tank.add(m); }
        }

      }

      const variant = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const tinted = (geo, mats, cells) => { const im = new THREE.InstancedMesh(geo, mats, Math.max(1, cells.length));
        cells.forEach(([x, y], i) => { const h = variant(x, y); dummy.position.set(x, -y, 0); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); const v = 0.84 + ((h >> 3) % 17) / 100, hu = (((h >> 5) % 7) - 3) * 0.012; im.setColorAt(i, new THREE.Color(v * (1 - hu), v, v * (1.02 + hu))); dummy.rotation.set(0, 0, 0); });
        im.count = cells.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = im.receiveShadow = true; this.levelGroup.add(im); if (cells.length) outlineInst(im, this.levelGroup); return im; };
      for (let v = 0; v < 4; v++) tinted(GEO.block, [MAT.blocks[v], MAT.blockSide], blocks.filter(([x, y]) => (variant(x, y) >> 7) % 4 === v));
      // ---- inner walls as table-coral shelves growing out of the tank's back wall (anchored, so they never fall)
      if (cobbles.length) {
        if (!MAT.coralFace) {
          const mk = (base, pore, hi) => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 128);
            for (let i = 0; i < 260; i++) { const x = Math.random() * 256, y = Math.random() * 128, r = 2 + Math.random() * 4; g.fillStyle = hi; g.beginPath(); g.arc(x - 1, y - 1, r + 1.5, 0, 7); g.fill(); g.fillStyle = pore; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
            const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(80,20,40,0.25)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
            const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t; };
          MAT.coralFaces = [['#d9573f', '#8f2d22', '#ff9d82'], ['#8c5cc9', '#4e2d86', '#c8a8f2'], ['#e07a2c', '#8e4210', '#ffbe7a']].map(([b, p, h]) => {
            const tx = mk(b, p, h); return [causticify(surfMat({ map: tx, roughness: 0.7, sheen: 0.15, sheenColor: new THREE.Color(h), envMapIntensity: 0.2 }), 0.08),
              surfMat({ color: new THREE.Color(b).lerp(new THREE.Color(h), 0.25), roughness: 0.6, sheen: 0.25, sheenColor: new THREE.Color(h), envMapIntensity: 0.25 })]; });
          MAT.coralFace = true; GEO.polyp = new THREE.SphereGeometry(1, 10, 8); GEO.branch = new THREE.CapsuleGeometry(0.035, 0.16, 3, 6);
        }
        // one shelf per horizontal run of wall cells
        const isW = (x, y) => e.get(x, y) === T.WALL; const runs = [];
        for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!isW(x, y)) { x++; continue; } const s0 = x; while (x < W && isW(x, y)) x++; runs.push([s0, x - 1, y]); } }
        // thick wall masses (wall above or below somewhere along the run) render as one continuous reef-rock block instead of stacked planks;
        // only single-row ledges stay shelves
        if (this.newArt) { const mass = [], keep = [];
          for (const r of runs) { let thick = true; for (let x = r[0]; x <= r[1]; x++) if (isW(x, r[2] - 1) || isW(x, r[2] + 1)) { thick = true; break; } if (thick) for (let x = r[0]; x <= r[1]; x++) mass.push([x, r[2]]); else keep.push(r); }
          runs.length = 0; runs.push(...keep);
          if (mass.length) { const wld2 = e.menu || e.cine ? 0 : worldOf(e.name), mm = massMat(wld2);
            // one merged mesh: a front quad per cell + side walls only where the mass meets open water (no internal faces -> no seams)
            const pos = [], nor = [], zF = 0.47, zB = -0.51, isM = new Set(mass.map(([x, y]) => y * W + x)), mM = (x, y) => isM.has(y * W + x);
            const quad = (a, b, c, d, n) => { for (const v of [a, b, c, a, c, d]) { pos.push(...v); nor.push(...n); } };
            for (const [x, y] of mass) { const X0 = x - 0.5, X1 = x + 0.5, Y0 = -y - 0.5, Y1 = -y + 0.5;
              quad([X0, Y0, zF], [X1, Y0, zF], [X1, Y1, zF], [X0, Y1, zF], [0, 0, 1]);
              if (!mM(x - 1, y)) quad([X0, Y0, zB], [X0, Y0, zF], [X0, Y1, zF], [X0, Y1, zB], [-1, 0, 0]);
              if (!mM(x + 1, y)) quad([X1, Y0, zF], [X1, Y0, zB], [X1, Y1, zB], [X1, Y1, zF], [1, 0, 0]);
              if (!mM(x, y - 1)) quad([X0, Y1, zF], [X1, Y1, zF], [X1, Y1, zB], [X0, Y1, zB], [0, 1, 0]);
              if (!mM(x, y + 1)) quad([X0, Y0, zB], [X1, Y0, zB], [X1, Y0, zF], [X0, Y0, zF], [0, -1, 0]); }
            const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
            const im = new THREE.Mesh(mg, mm); im.castShadow = im.receiveShadow = true; this.levelGroup.add(im);
            for (const [x, y] of mass) { if (y < 1 || e.get(x, y - 1) !== T.EMPTY) continue; const hh = variant(x, y + 3); if (hh % 100 > 55) continue; // a few plants on exposed tops
              const nm = ART.ledge[hh % ART.ledge.length], sp = sprPlane(nm, 0.3 + (hh % 4) * 0.05, true, { dz: 0.25, op: 0.5 }); sp.position.set(x + ((hh >> 4) % 5 - 2) * 0.08, -y + 0.5, -0.2); if (hh & 1) sp.scale.x = -1; this.levelGroup.add(sp); }
            // the reference grows little coral clumps right out of the rock face (mostly along its foot, a few higher up)
            for (const [x, y] of mass) { const hh = variant(x + 7, y * 3 + 1), foot = !mM(x, y + 1); if (hh % 100 > (foot ? 48 : 13)) continue;
              const CF = ['coral1', 'coral2', 'coral3', 'coral4', 'coral5', 'weed2', 'weed5'], nm = CF[(hh >> 3) % CF.length], sp = sprPlane(nm, 0.3 + (hh % 5) * 0.045, true, { dz: 0.03, op: 0.5 });
              sp.position.set(x + ((hh >> 5) % 7 - 3) * 0.07, -y - 0.5 + (foot ? 0.02 : 0.18 + ((hh >> 2) % 4) * 0.08), zF + 0.015); if (hh & 2) sp.scale.x = -1; sp.userData.sway = [nm.startsWith('weed') ? 0.05 : 0.015, 1.2, (hh % 50) / 10]; this.levelGroup.add(sp); } } }
        const pol = new THREE.InstancedMesh(GEO.polyp, new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, sheen: 0.5, envMapIntensity: 0.5 }), runs.reduce((a, r) => a + (r[1] - r[0] + 1) * 8, 0));
        const br = new THREE.InstancedMesh(GEO.branch, new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, emissive: 0x220a10, emissiveIntensity: 1 }), runs.reduce((a, r) => a + (r[1] - r[0] + 1) * 3, 0));
        let pi = 0, bi = 0;
        if (this.newArt && !MAT.shelfStone) { // extra shelf materials so every level doesn't read as the same plank: slate, driftwood
          const mkC = (draw) => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t; };
          const stone = mkC(g => { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#8d93a8'); gr.addColorStop(1, '#4a4f66'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
            for (let i = 0; i < 60; i++) { const x = Math.random() * 256, y = 10 + Math.random() * 110, r = 6 + Math.random() * 16; g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '20,24,44'},${0.05 + Math.random() * 0.08})`; g.beginPath(); g.ellipse(x, y, r * 1.6, r, 0, 0, 7); g.fill(); }
            g.strokeStyle = 'rgba(25,28,50,0.45)'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { g.beginPath(); let x = Math.random() * 256, y = 20 + Math.random() * 90; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += 10 + Math.random() * 20; y += (Math.random() - 0.5) * 18; g.lineTo(x, y); } g.stroke(); }
            g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, 0, 256, 6); g.fillStyle = 'rgba(60,170,120,0.55)'; for (let x = 0; x < 256; x += 3) { const hh = 3 + Math.random() * 9 * (0.5 + 0.5 * Math.sin(x * 0.07)); g.fillRect(x, 0, 3, hh); } });
          const wood = mkC(g => { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#b98a5a'); gr.addColorStop(1, '#6b4426'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
            for (let i = 0; i < 26; i++) { const y = Math.random() * 128; g.strokeStyle = `rgba(${Math.random() < 0.5 ? '60,34,14' : '230,190,140'},${0.15 + Math.random() * 0.2})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3); g.stroke(); }
            for (let i = 0; i < 3; i++) { const x = 30 + Math.random() * 200, y = 30 + Math.random() * 70; g.fillStyle = 'rgba(50,28,10,0.5)'; g.beginPath(); g.ellipse(x, y, 9, 6, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(50,28,10,0.35)'; g.beginPath(); g.ellipse(x, y, 16, 10, 0, 0, 7); g.stroke(); }
            g.fillStyle = '#3c2a1a'; for (const x of [10, 246]) for (const y of [30, 98]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } });
          MAT.shelfStone = [causticify(surfMat({ map: stone, roughness: 0.75, envMapIntensity: 0.4, emissive: 0xffffff, emissiveMap: stone, emissiveIntensity: 0.12 }), 0.1), surfMat({ color: 0x5a6078, roughness: 0.7, envMapIntensity: 0.5 })];
          MAT.shelfWood = [causticify(surfMat({ map: wood, roughness: 0.6, clearcoat: 0.3, envMapIntensity: 0.4, emissive: 0xffffff, emissiveMap: wood, emissiveIntensity: 0.12 }), 0.1), surfMat({ color: 0x6b4426, roughness: 0.6, envMapIntensity: 0.4 })]; }
        // which shelf looks this world uses: shallows = sheet plank + pink/orange reef rock; violet caves = purple coral + slate; the deep = slate + driftwood
        const wld = e.menu || e.cine ? 0 : worldOf(e.name), STY = [['plank', 'coral0', 'plank', 'coral2'], ['coral1', 'stone', 'coral1', 'plank'], ['stone', 'wood', 'stone', 'coral1']][wld];
        const lump = this.newArt ? new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0x6d7390, roughness: 0.8 }), runs.reduce((a, r) => a + (r[1] - r[0] + 1) * 2, 0)) : null; let li = 0;
        runs.forEach(([x0r, x1r, y], ri) => { const len = x1r - x0r + 1, cx = (x0r + x1r) / 2, vh = variant(x0r * 3 + 1, y * 5 + 2), sty = this.newArt ? STY[vh % 4] : 'old';
          const kind = sty.startsWith('coral') ? +sty[5] : (variant(x0r, y) >> 2) % 3, mats = MAT.coralFaces[kind];
          const geo = roundedBox(len - 0.04, 0.64, 0.98, 0.2, 3); const face = sty === 'plank' || sty === 'old' ? shelfFace(len, ART.platform) : null;
          if (sty === 'stone' || sty === 'wood') { const M2 = sty === 'stone' ? MAT.shelfStone : MAT.shelfWood; const mm = M2.map(x => x.clone()); mm[0].map = M2[0].map.clone(); mm[0].map.needsUpdate = true; mm[0].map.repeat.set(len * 0.5, 1); mm[0].map.offset.x = (vh % 97) / 97; mm[0].emissiveMap = mm[0].map;
            const m = new THREE.Mesh(geo, mm); m.position.set(cx, -y - 0.02, -0.02); m.castShadow = m.receiveShadow = true; this.levelGroup.add(m);
            if (sty === 'stone') for (let i = 0; i < len; i++) { const hh = variant(x0r + i, y + 13); if (hh % 3) continue; dummy.position.set(x0r + i + ((hh >> 3) % 5 - 2) * 0.1, -y + 0.3, 0.1 - (hh % 4) * 0.1); dummy.rotation.set(hh % 7, hh % 5, 0); dummy.scale.set(1.3, 0.7, 1); dummy.updateMatrix(); lump.setMatrixAt(li++, dummy.matrix); }
            dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); }
          else { const m = new THREE.Mesh(geo, face ? [new THREE.MeshStandardMaterial({ map: face, roughness: 0.75, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.25 }), (this.newArt ? (MAT.shelfSideN || (MAT.shelfSideN = surfMat({ color: 0x8a5a2b, metalness: 0.45, roughness: 0.35, clearcoat: 0.6, envMapIntensity: 0.9 }))) : new THREE.MeshStandardMaterial({ color: 0xd9913f, roughness: 0.8 }))] : [mats[0], mats[1]]); mats[0].map.repeat.set(len * 0.6, 1);
          m.position.set(cx, -y - 0.02, -0.02); m.castShadow = m.receiveShadow = true; this.levelGroup.add(m); }
          const dens = [0.15, 0.45, 0.8][vh % 3]; // some shelves bare, some lush
          if (this.newArt) for (let i = 0; i < len; i++) { const hh = variant(x0r + i, y + 5); if ((hh % 100) / 100 > dens) continue; // sea-plant tufts growing on the shelf top
            const nm = ART.ledge[hh % 9], sp = sprPlane(nm, 0.3 + (hh % 4) * 0.05, true, { dz: 0.25, op: 0.5 }); sp.position.set(x0r + i + ((hh >> 4) % 5 - 2) * 0.08, -y + 0.3, -0.2); if (hh & 1) sp.scale.x = -1; this.levelGroup.add(sp); }
          const hi = new THREE.Color(['#ff9d82', '#c8a8f2', '#ffbe7a'][kind]), deep = new THREE.Color(['#b8402e', '#6b44a8', '#c4621c'][kind]);
          // bumpy polyps along the top and a few on the front lip (old look, and the new look's coral shelves)
          if (this.newArt && !sty.startsWith('coral')) return;
          const PN = this.newArt ? 5 : 8; for (let i = 0; i < len * PN; i++) { const h = variant(x0r + i, y + 31 * i), u = (i + 0.5) / (len * PN); const onTop = i % 4 !== 0;
            dummy.position.set(x0r - 0.48 + u * (len - 0.04), -y + (onTop ? 0.3 : 0.12 - (h % 7) * 0.03), onTop ? 0.25 - (h % 5) * 0.11 : 0.47); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.05 + (h % 4) * 0.012); dummy.updateMatrix();
            pol.setMatrixAt(pi, dummy.matrix); pol.setColorAt(pi++, (h % 3 ? hi : deep).clone()); }
          // little branching tips on top
          if (!this.newArt) for (let i = 0; i < len * 3; i++) { const h = variant(x0r + i * 3, y + 7); dummy.position.set(x0r - 0.4 + (i + 0.5) / (len * 3) * (len - 0.2), -y + 0.38, 0.1 - (h % 5) * 0.08); dummy.rotation.set(0, 0, ((h % 9) - 4) * 0.12); dummy.scale.setScalar(0.9 + (h % 3) * 0.2); dummy.updateMatrix();
            br.setMatrixAt(bi, dummy.matrix); br.setColorAt(bi++, hi.clone()); } });
        if (lump) { lump.count = li; lump.castShadow = lump.receiveShadow = true; lump.instanceMatrix.needsUpdate = true; this.levelGroup.add(lump); }
        pol.count = pi; br.count = bi; pol.visible = br.visible = true; for (const im of [pol, br]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = !this.newArt; this.levelGroup.add(im); }
        dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); }

      // ---- treasures embedded in the sand: starfish, shells and tiny jellyfish. They fall when their sand is dug.
      { if (!GEO.star) {
          const st = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.07 : 0.17; i ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
          GEO.star = new THREE.ExtrudeGeometry(st, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3 });
          const sh = new THREE.Shape(); sh.moveTo(0, -0.12); for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.1 + i / 8 * Math.PI * 0.8, r = 0.16 + (i % 2 ? 0.0 : 0.012); sh.lineTo(Math.cos(a) * r, Math.sin(a) * r - 0.04); } sh.closePath();
          GEO.shell = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 3 });
          GEO.jellyDome = new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); GEO.jellyLeg = new THREE.CylinderGeometry(0.012, 0.006, 0.16, 5);
          MAT.starfish = new THREE.MeshPhysicalMaterial({ color: 0xff7a3d, roughness: 0.45, clearcoat: 0.5, sheen: 0.4, sheenColor: 0xffc08a });
          MAT.shellM = new THREE.MeshPhysicalMaterial({ color: 0xf4e3cc, roughness: 0.35, clearcoat: 0.8, iridescence: 0.4, iridescenceIOR: 1.4 });
          MAT.jellyT = new THREE.MeshPhysicalMaterial({ color: 0xff9ad8, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85, emissive: 0xff4fbf, emissiveIntensity: 0.35 }); }
        this.treasures = [];
        // after an undo, treasures that were already dug out come back where they lay (not re-buried, not lost)
        const kept = this._keepTreasures || []; this._keepTreasures = null; const keepMap = new Map(kept.map(k => [k.cx + ',' + k.cy, k]));
        const cellsT = sand.concat(kept.filter(k => e.get(k.cx, k.cy) !== T.SAND).map(k => [k.cx, k.cy]));
        for (const [x, y] of cellsT) { const h = variant(x, y), r = ((h * 2654435761) >>> 0) % 1000 / 1000, kp = e.get(x, y) !== T.SAND ? keepMap.get(x + ',' + y) : null;
          // fewer treasures, grouped into little finds (a few patches per level) instead of an even sprinkle
          const ph = ((variant(Math.floor((x + 1) / 4), Math.floor((y + 1) / 3) + 91) * 2654435761) >>> 0) % 1000 / 1000; if (!kp && (ph > 0.42 || r > 0.16)) continue;
          if (!kp && y > 0 && e.get(x, y - 1) !== T.SAND && e.get(x, y - 1) !== T.STEEL && r > 0.08) continue; // keep the top surface tidy
          const kind = y >= 1 && -y < -(H * 0.5) ? (r < 0.09 ? 'shell' : r < 0.13 ? 'star' : 'jelly') : (r < 0.08 ? 'star' : r < 0.13 ? 'shell' : 'jelly'); let m;
          const tsh = { k: 0.22, dz: 0.005, op: 0.6 }; // half-buried in sand: tight shadow right on the sand face
          if (kind === 'star') m = sprPlane(ART.stars[h % ART.stars.length], 0.38, false, tsh);
          else if (kind === 'shell') m = sprPlane(ART.shells[h % ART.shells.length], 0.32, false, tsh);
          else if (true) m = sprPlane(ART.jelly, 0.4, false, tsh);
          else { m = new THREE.Group(); const d = new THREE.Mesh(GEO.jellyDome, MAT.jellyT); m.add(d); for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(GEO.jellyLeg, MAT.jellyT); l.position.set(-0.07 + k * 0.047, -0.07, 0); m.add(l); } }
          const ox = (((h >> 3) % 9) - 4) * 0.05, oy = (((h >> 6) % 9) - 4) * 0.05, rot = ((h >> 9) % 13) * 0.48;
          m.position.set(x + ox, -y + oy, 0.41); m.rotation.z = rot; m.scale.setScalar((0.9 + ((h >> 2) % 4) * 0.08) * (this.newArt ? 1.3 : 1)); m.traverse(o => { if (!o.userData.fakeShadow) o.castShadow = true; });
          this.levelGroup.add(m); this.treasures.push({ m, cx: x, cy: y, state: kp ? 'falling' : 'buried', vy: 0, spin: (r - 0.1) * 14 }); if (kp) { m.position.set(kp.x, kp.y, 0.3); m.rotation.z = kp.rz; } } }
      // ---- sea plants on the sand ledges inside the tank (from your sheet); removed with their sand
      this.edgePlants = [];
      { const names = ART.ledge;
        for (const [x, y] of sand) { if (y < 1) continue; const above = e.get(x, y - 1); if (above !== T.EMPTY) continue; // only into open water: never inside an air bubble, stone or pearl's cell
          const h = variant(x, y + 77); if (h % 100 > (this.newArt ? 72 : 34)) continue; const nm = names[h % names.length], hgt = isPlantSpr(nm) ? 0.55 + (h % 5) * 0.06 : 0.38 + (h % 3) * 0.05;
          const sp = sprPlane(nm, hgt, true, { dz: 0.3, op: 0.55, lean: 0.45 }); sp.position.set(x + (((h >> 3) % 7) - 3) * 0.08, -y + 0.47, -0.12); const ph = (h % 17) * 0.4; sp.onBeforeRender = () => { sp.rotation.z = Math.sin(performance.now() / 1000 * 1.1 + ph) * 0.05; };
          this.levelGroup.add(sp); this.edgePlants.push({ m: sp, x, y }); } }
      // ---- foreground seabed in front of the tank: a soft sand shelf with shells, stones, starfish and sea grass
      { const x0f = -2.5, x1f = W + 1.5, yF = -(H - 1.5) - 0.86, rnd = (() => { let sd = 777 + W * 13 + H; return () => (sd = (sd * 16807) % 2147483647) / 2147483647; })();
        if (!MAT.fgSand) { MAT.fgSand = causticify(new THREE.MeshStandardMaterial({ color: 0xe8c98a, roughness: 0.95, envMapIntensity: 0.15 }), 0.35);
          MAT.fgStone = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, envMapIntensity: 0.4 }); }
        const sg = new THREE.PlaneGeometry(x1f - x0f, 4.2, 60, 16); sg.rotateX(-Math.PI / 2); const P = sg.attributes.position;
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), front = Math.max(0, z + 0.6); P.setY(i, Math.sin(x * 0.9) * 0.05 + Math.sin(x * 2.3 + z * 1.7) * 0.03 - front * front * 0.12); } sg.computeVertexNormals();
        const photoMode = PHOTO_LEVELS.has(e.name) || !!e.menu || !!e.daily, spots = [];
        const shelf = new THREE.Mesh(sg, MAT.fgSand); shelf.visible = !photoMode; shelf.position.set((x0f + x1f) / 2, yF + 0.02, 2.45); shelf.receiveShadow = true; this.levelGroup.add(shelf);
        const groundY = (x, z) => yF + 0.02 + Math.sin(x * 0.9) * 0.05 - Math.pow(Math.max(0, z - 2.45 + 0.6), 2) * 0.12;
        const place = (geo, mat, n, fn, shadowR = 0) => { const im = new THREE.InstancedMesh(geo, mat, n); for (let i = 0; i < n; i++) { dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); const col = fn(dummy, i); if (shadowR) spots.push([dummy.position.x, dummy.position.z, shadowR * Math.max(dummy.scale.x, dummy.scale.z)]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (col) im.setColorAt(i, col); }
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; this.levelGroup.add(im); return im; };
        const span = x1f - x0f, nS = Math.round(span * (this.newArt ? 0.32 : photoMode ? 0.55 : 1.1)), zMin = photoMode ? 1.55 : 1.0, NA = this.newArt;
        place(new THREE.IcosahedronGeometry(0.12, 1), MAT.fgStone, nS, (d, i) => { const x = x0f + rnd() * span, z = zMin + rnd() * 1.4, sc = NA ? 0.45 + rnd() * 0.75 : 0.6 + rnd() * 1.4; d.position.set(x, groundY(x, z) + sc * (NA ? 0.0 : 0.05), z); d.scale.set(sc * 1.3, sc * (NA ? 0.55 : 0.7), sc); d.rotation.set(rnd(), rnd() * 6, rnd()); return NA ? new THREE.Color().setHSL([0.62, 0.7, 0.5][(rnd() * 3) | 0] + rnd() * 0.03, 0.45, 0.32 + rnd() * 0.14) : new THREE.Color().setHSL(0.6 + rnd() * 0.04, 0.35, 0.3 + rnd() * 0.18); }, 0.17);
        const sway = (sp, amt) => { const ph = rnd() * 6; sp.userData.sway = [amt, 1.2, ph]; sp.onBeforeRender = () => { sp.rotation.z = Math.sin(performance.now() / 1000 * 1.2 + ph) * amt; }; };
        if (this.newArt) { // the sheet's shells and sea plants on the seabed, each with a light-facing ground shadow
          const nSh = Math.round(span * 0.32); for (let i = 0; i < nSh; i++) { const x = x0f + rnd() * span, z = 1.05 + rnd() * 1.4, sp = sprPlane(ART.shells[i % ART.shells.length], 0.2 + rnd() * 0.1, true, { drop: false, op: 0.6 });
            sp.position.set(x, groundY(x, z) - 0.01, z); sp.rotation.z = (rnd() - 0.5) * 0.4; if (rnd() < 0.5) sp.scale.x = -1; this.levelGroup.add(sp); }
          const weeds = ART.ledge.filter(n => n.startsWith('weed')), nW = Math.round(span * 0.3);
          for (let i = 0; i < nW; i++) { const x = x0f + rnd() * span, z = 1.0 + rnd() * 1.4, sp = sprPlane(weeds[(rnd() * weeds.length) | 0], 0.34 + rnd() * 0.22, true, { drop: false, op: 0.55 });
            sp.position.set(x, groundY(x, z) - 0.02, z); if (rnd() < 0.5) sp.scale.x = -1; sway(sp, 0.05); this.levelGroup.add(sp); }
          // a nearer, sparser layer (z 2.9-5.6) so the seabed in front of the tank has depth instead of an empty band on phones:
          // bigger weed clumps and shells, a few stones, each with its ground shadow; kept to the sides and front, never over the tank
          const gy2 = (x, z) => photoMode ? yF + 0.005 : groundY(x, z), nN = Math.round(span * 0.45);
          for (let i = 0; i < nN; i++) { const x = x0f - 1 + rnd() * (span + 2), z = 2.6 + rnd() * 2.2, kind = rnd();
            if (kind < 0.55) { const sp = sprPlane(weeds[(rnd() * weeds.length) | 0], 0.55 + rnd() * 0.45, true, { drop: false, op: 0.5 }); sp.position.set(x, gy2(x, z) - 0.03, z); if (rnd() < 0.5) sp.scale.x = -1; sway(sp, 0.06); this.levelGroup.add(sp); spots.push([x, z, 0.3]); }
            else { const sp = sprPlane(ART.shells[(rnd() * ART.shells.length) | 0], 0.26 + rnd() * 0.14, true, { drop: false, op: 0.6 }); sp.position.set(x, gy2(x, z) - 0.01, z); sp.rotation.z = (rnd() - 0.5) * 0.5; if (rnd() < 0.5) sp.scale.x = -1; this.levelGroup.add(sp); spots.push([x, z, 0.16]); } }
          place(new THREE.IcosahedronGeometry(0.12, 1), MAT.fgStone, Math.round(span * 0.12), (d) => { const x = x0f - 1 + rnd() * (span + 2), z = 2.7 + rnd() * 2.1, sc = 0.9 + rnd() * 1.1; d.position.set(x, gy2(x, z), z); d.scale.set(sc * 1.3, sc * 0.6, sc); d.rotation.set(rnd(), rnd() * 6, rnd() * 0.3); return new THREE.Color().setHSL(0.08 + rnd() * 0.05, 0.12, 0.42 + rnd() * 0.2); }, 0.16); }
        if (GEO.shell && !this.newArt) place(GEO.shell, MAT.shellM, Math.round(span * 0.45), (d) => { const x = x0f + rnd() * span, z = 1.0 + rnd() * 1.5; d.position.set(x, groundY(x, z) + 0.03, z); d.rotation.set(-Math.PI / 2 + 0.5, 0, rnd() * 6); d.scale.setScalar(1.1 + rnd() * 0.8); return null; }, 0.15);
        if (GEO.star) place(GEO.star, MAT.starfish, Math.max(2, Math.round(span * 0.15)), (d) => { const x = x0f + rnd() * span, z = 1.1 + rnd() * 1.3; d.position.set(x, groundY(x, z) + 0.03, z); d.rotation.set(-Math.PI / 2, 0, rnd() * 6); d.scale.setScalar(1.3 + rnd() * 0.7); return new THREE.Color().setHSL(0.03 + rnd() * 0.06, 0.8, 0.55 + rnd() * 0.1); }, 0.18);
        if (!this.newArt) { const blade = new THREE.PlaneGeometry(0.06, 0.5, 1, 4); blade.translate(0, 0.25, 0); const gm = new THREE.MeshStandardMaterial({ color: 0x4fae5c, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x0b2e14, emissiveIntensity: 1 });
          const nT = Math.round(span * 0.35); let k = 0; place(blade, gm, nT * 7, (d, i) => { if (i % 7 === 0) k = [x0f + rnd() * span, 1.0 + rnd() * 1.4]; const x = k[0] + (rnd() - 0.5) * 0.25, z = k[1] + (rnd() - 0.5) * 0.2; d.position.set(x, groundY(x, z) - 0.02, z); d.rotation.set((rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.5); d.scale.set(1, 0.6 + rnd() * 0.9, 1); return new THREE.Color().setHSL(0.3 + rnd() * 0.06, 0.5, 0.35 + rnd() * 0.15); }); }
        if (photoMode) { // ONE seabed: an unlit sand floor in the painting's own sand colours and light-net style, from the screen's bottom edge
          // back to where the painted sand meets the rocks, fading into the painting there (so the 3D props and the painting share one ground)
          const gm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: MAT.causticT, uTint: { value: new THREE.Color(e.menu ? 0xffffff : WORLD_TINT[worldOf(e.name)]) } },
            vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
            fragmentShader: `uniform float uT; uniform vec3 uTint; varying vec3 vW;
              float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
              float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y); }
              void main() { vec2 p = vW.xz; float far = smoothstep(2.0, -20.0, vW.z);
                vec3 c = mix(vec3(0.957, 0.765, 0.365), vec3(0.973, 0.82, 0.435), far);                 // sampled from the painting: near / mid sand
                c *= 0.93 + vn(p * vec2(0.9, 1.6)) * 0.1 + (hs(floor(p * 36.0)) - 0.5) * 0.03;        // soft dune shading + fine grain
                vec2 q = p * vec2(0.6, 1.0); float a = sin(q.x * 3.1 + uT * 0.5 + sin(q.y * 2.3 + uT * 0.4) * 1.5), b = sin(q.y * 2.7 - uT * 0.45 + sin(q.x * 2.9 - uT * 0.5) * 1.5);
                float net = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 5.0);                                  // the painting's bright light net, moving
                c = mix(c, vec3(1.0, 0.965, 0.553), net * 0.45 * (1.0 - far * 0.5));
                c *= mix(1.0, 0.7, smoothstep(1.5, 7.0, vW.z));                                          // the seabed nearest the camera falls into soft shade so it doesn't shout
                c = mix(c, vec3(0.588, 0.733, 0.749), smoothstep(-13.0, -23.0, vW.z) * 0.6);                 // the painting's far, hazy sea floor
                gl_FragColor = vec4(pow(c, vec3(2.2)) * uTint, 1.0 - smoothstep(-14.0, -24.0, vW.z)); }` });
          const gp = new THREE.PlaneGeometry(span + 140, 160); gp.rotateX(-Math.PI / 2); const ground = new THREE.Mesh(gp, gm); ground.position.set((W - 1) / 2, yF + 0.005, 50); ground.renderOrder = -6; ground.frustumCulled = false; this.levelGroup.add(ground); this.groundTint = gm.uniforms.uTint; this.groundTint0 = gm.uniforms.uTint.value.clone();
          const mk = (draw, key) => { if (key && TEX[key]) return TEX[key]; const c = document.createElement('canvas'); c.width = c.height = 256; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); if (key) TEX[key] = t; return t; }; // the same for every level: drawn once
          const blob = mk(g => { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(18,26,48,0.85)'); gr.addColorStop(0.55, 'rgba(18,26,48,0.35)'); gr.addColorStop(1, 'rgba(18,26,48,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }, 'shadowBlob');
          // tank shadow: darkest right under the base and along its front edge, fading toward the viewer
          const tankTex = mk(g => { for (let y = 0; y < 256; y++) { const v = y / 255, a = v < 0.42 ? 0.78 : 0.78 * Math.pow(1 - (v - 0.42) / 0.58, 1.5); for (let x = 0; x < 256; x++) { const u = Math.abs(x / 255 - 0.5) * 2, edge = Math.min(1, (1 - u) / 0.12); g.fillStyle = `rgba(16,24,46,${(a * edge).toFixed(3)})`; g.fillRect(x, y, 1, 1); } } }, 'tankShadow');
          const sm = new THREE.MeshBasicMaterial({ map: tankTex, transparent: true, depthWrite: false, toneMapped: false, fog: false });
          const ts = new THREE.Mesh(new THREE.PlaneGeometry((W - 2) + 2.6, 3.4), sm); ts.rotation.x = -Math.PI / 2; ts.position.set((W - 1) / 2, yF + 0.025, 0.95); ts.renderOrder = -5; this.levelGroup.add(ts);
        }
        { // a soft shadow under every stone and starfish, stretched back-right away from the key light (all levels)
          const bm = new THREE.MeshBasicMaterial({ map: getContactTex(), transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: photoMode ? 0.85 : 0.6 });
          const sh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), bm, Math.max(1, spots.length)); const d1 = new THREE.Object3D();
          spots.forEach(([sx, sz, r], i) => { d1.position.set(sx + r * 0.55, groundY(sx, sz) + 0.01, sz - r * 0.45); d1.rotation.set(-Math.PI / 2, 0, -0.5); d1.scale.set(r * 3.2, r * 1.9, 1); d1.updateMatrix(); sh.setMatrixAt(i, d1.matrix); });
          sh.count = spots.length; sh.instanceMatrix.needsUpdate = true; sh.renderOrder = -4; this.levelGroup.add(sh); }
        dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); }
      // ---- foreground life layer (drifting specks, rising bubbles, an occasional fish) – kept off the playfield centre
      if (!this.fg) { const fg = new THREE.Group(); this.scene.add(fg); const N = World.isMobile ? 70 : 140;
        const pos = new Float32Array(N * 3), sd = new Float32Array(N); for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * 30, Math.random() * 20, 2.5 + Math.random() * 5], i * 3); sd[i] = 0.4 + Math.random() * 0.9; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
        const mat = new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT, tex: { value: TEX.dot }, scale: { value: 500 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
          vertexShader: `attribute float aS; uniform float uT, scale; varying float vA; void main(){ vec3 p = position; p.y = mod(p.y - uT * 0.12 * aS, 20.0) - 2.0; p.x += sin(uT * 0.25 + position.z * 3.0) * 0.8;
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = aS * 0.16 * scale / -mv.z; vA = 0.22 * smoothstep(-2.0, 1.0, p.y) * smoothstep(18.0, 14.0, p.y); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: 'uniform sampler2D tex; varying float vA; void main(){ float a = texture2D(tex, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.9, 0.97, 1.0) * a, a); }' });
        const specks = new THREE.Points(g, mat); specks.frustumCulled = false; fg.add(specks);
        // two foreground fish that sometimes cruise past above or below the tank
        const fishG = new THREE.SphereGeometry(0.22, 16, 10); fishG.scale(1, 0.55, 0.32); const tailG = new THREE.ConeGeometry(0.13, 0.22, 4); tailG.rotateZ(Math.PI / 2);
        const fishes = [0xffc93a, 0x5fb8ff].map(col => { const f = new THREE.Group(); const mm = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.3, clearcoat: 1, envMapIntensity: 1 }); const b = new THREE.Mesh(fishG, mm); f.add(b); const tl = new THREE.Mesh(tailG, mm); tl.position.x = -0.28; f.add(tl);
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 })); eye.position.set(0.13, 0.04, 0.07); f.add(eye);
          // new-sheet look: a fish sprite (drawn facing left, so mirrored to face +x like the model)
          const sp = sprPlane(col === 0xffc93a ? 'fishC' : 'fishE', 0.42, false, { k: 0.5, dz: 0.5, op: 0.25 }); sp.scale.x = -1; sp.visible = false; f.add(sp);
          f.visible = false; fg.add(f); return { f, tl, sp, parts: [b, tl, eye], t: 3 + Math.random() * 6, on: false }; });
        this.fg = { group: fg, mat, fishes, update: (t, dt, cx, top, bot, span) => {
          for (const F of this.fg.fishes) { if (!F.on) { F.t -= dt; if (F.t <= 0) { F.on = true; F.dir = Math.random() < 0.5 ? 1 : -1; F.x = cx - F.dir * (span / 2 + 3); F.y = Math.random() < 0.5 ? top + 0.9 + Math.random() * 0.6 : bot - 0.6 - Math.random() * 0.4; F.z = 2.2 + Math.random() * 1.2; F.f.visible = true; } continue; }
            F.x += F.dir * dt * 1.6; F.f.position.set(F.x, F.y + Math.sin(t * 2 + F.z) * 0.08, F.z); F.f.rotation.y = F.dir > 0 ? 0 : Math.PI; F.tl.rotation.y = Math.sin(t * 12) * 0.4; F.f.scale.setScalar(1.2);
            if (Math.abs(F.x - cx) > span / 2 + 3.5) { F.on = false; F.f.visible = false; F.t = (6 + Math.random() * 10) * (this.menuMode ? 1 - 0.75 * (this.reefK || 0) : 1); } } } }; } // fish return to the menu tank as the reef wakes
      for (const F of this.fg.fishes) { F.sp.visible = this.newArt; F.parts.forEach(o => { o.visible = !this.newArt; }); }
      this.fg.group.position.set((W - 1) / 2, -(H - 1), 0); this.fg.box = { top: 0.5 + (H - 1), bot: -0.4, span: W }; // group-local: origin sits at the bottom row centre


      this.sandInst = null;
      // one seamless front surface for all sand, masked per cell (r = 255 * visible size)
      this.maskData = new Uint8Array(W * H * 4); sand.forEach(([x, y]) => { this.maskData[(y * W + x) * 4] = 255; });
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const tt = e.get(x, y); if (tt === T.WALL || tt === T.STEEL || tt === T.GATE) this.maskData[(y * W + x) * 4 + 2] = 255; }
      this.maskTex = new THREE.DataTexture(this.maskData, W, H, THREE.RGBAFormat); this.maskTex.magFilter = this.maskTex.minFilter = THREE.NearestFilter; this.maskTex.needsUpdate = true;
      MAT.sandMask.tex.value = this.maskTex; MAT.sandMask.size.value.set(W, H);
      this.sandFront = new THREE.Mesh(new THREE.PlaneGeometry(W, H), MAT.sandFront); this.sandFront.receiveShadow = true; this.sandFront.position.set((W - 1) / 2, -(H - 1) / 2, 0.4); this.levelGroup.add(this.sandFront);
      this.sandIndex = new Map(); this.sandAnim = new Map(); sand.forEach(([x, y], i) => this.sandIndex.set(y * W + x, i));
      // the sand blocks: one instanced mesh per corner-rounding variant (16) + one for inner-corner fillets; rebuilt whenever sand changes
      this.sandScale = new Float32Array(sand.length).fill(1); this.sandMeshes = {};
      const cap = Math.max(1, sand.length);
      for (let fl = 0; fl < 16; fl++) { const im = new THREE.InstancedMesh(sandBlockGeo(fl), MAT.sand, cap); im.receiveShadow = true; im.count = 0; this.levelGroup.add(im); this.sandMeshes[fl] = im; }
      { const im = new THREE.InstancedMesh(sandFilletGeo(), MAT.sand, cap * 4); im.receiveShadow = true; im.count = 0; this.levelGroup.add(im); this.sandMeshes.fillet = im; }
      this.sandCells = sand; this.syncSandBlocks(); this.buildOcclusion();
      this.lipInst = new THREE.InstancedMesh(GEO.lip, MAT.lip, Math.max(1, sand.length)); this.lipInst.count = sand.length; this.levelGroup.add(this.lipInst); this.lipInst.visible = false;
      this.sandCells = sand; this.refreshLips();
      // a few kelp / coral pieces standing on surfaces, behind the play plane
      this.weeds = [];
      let k = 0;
      for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
        const below = e.get(x, y), here = e.get(x, y - 1);
        if (here !== T.EMPTY || (below !== T.SAND && below !== T.STEEL && below !== T.WALL)) continue;
        if (this.newArt ? variant(x, y + 5) % 100 > 64 : ((x * 7 + y * 13 + W) % 4) !== 0) continue; // the reference: coral and plants on most ledges
        const ox = ((x * 31 + y * 17) % 5) / 10 - 0.2;
        if (this.newArt) { const hh = variant(x, y + 11), CORAL = ['coral1', 'coral2', 'coral3', 'coral4', 'coral5'], WEED = ART.ledge.filter(n => n.startsWith('weed')); // a small cluster: a coral and often a weed beside it
          const pick = [[CORAL[hh % CORAL.length], 0.4 + (hh % 4) * 0.06, 0]]; if (hh % 3 !== 0) pick.push([WEED[(hh >> 2) % WEED.length], 0.5 + (hh % 5) * 0.06, (hh & 2) ? 0.28 : -0.28]);
          for (const [nm, hgt, dx] of pick) { const w = sprPlane(nm, hgt, true, { dz: 0.25, op: 0.45 }); w.position.set(x + ox + dx, -y + 0.5, dx ? -0.2 : -0.08); if (hh & 1) w.scale.x = -1; w.userData.sway = [nm.startsWith('weed') ? 0.06 : 0.02, 1.3, (hh % 60) / 10]; this.levelGroup.add(w); }
          k++; continue; } // baked with the static sprites; sways in the shader
        if (k++ % 3 !== 1) { for (let i = 0; i < 3; i++) { const w = makeKelp(0.5 + Math.random() * 0.4); w.position.set(x + ox - 0.15 + i * 0.13, -y + 0.48, -0.42); w.userData.phase = Math.random() * 6; this.levelGroup.add(w); this.weeds.push(w); } }
        else { const c = makeCoral(); c.position.set(x + ox, -y + 0.48, -0.42); c.scale.setScalar(1.2); this.levelGroup.add(c); }
      }
      for (const o of e.objects.values()) this.spawn(o);
      this.gateSprite = sprPlane(ART.goal, 0.98, false, { k: 0.1, dz: 0.02, op: 0.55 }); this.gateSprite.material = this.gateSprite.material.clone(); this.gateSprite.position.set(e.gate.x, -e.gate.y, 0.47); this.levelGroup.add(this.gateSprite);
      this.gateObj = outline(makeGate(), 0.055, hullMat); this.gateObj.position.set(e.gate.x, -e.gate.y, 0); this.levelGroup.add(this.gateObj);
      { // the goal reads from across the level: a soft beacon halo that brightens with each pearl delivered, plus one slot light per pearl
        const fx = new THREE.Group(); fx.position.set(e.gate.x, -e.gate.y, 0.55); this.levelGroup.add(fx);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0x5fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 })); halo.scale.set(2.2, 2.2, 1); fx.add(halo);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.64, 48), new THREE.MeshBasicMaterial({ color: 0x8ff4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4, toneMapped: false })); fx.add(ring);
        const n = Math.min(6, e.ballsTotal), slots = [];
        for (let i = 0; i < n; i++) { const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.42, d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), new THREE.MeshBasicMaterial({ color: 0x2a3a5a, transparent: true, toneMapped: false }));
          d.position.set(Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0.01); fx.add(d); slots.push(d); }
        this.gateFx = { fx, halo, ring, slots, lit: 0, burst: 0 }; }
      this.airObjs = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (e.get(x, y) === T.AIR) { const a = makeAir(); a.position.set(x, -y, 0.1); this.levelGroup.add(a); this.airObjs.set(y * W + x, a); }
      this.key.target.position.set((W - 1) / 2, -(H - 1) / 2, 0); this.key.position.set((W - 1) / 2 - 5, -(H - 1) / 2 + 9, 9);
      { const S = Math.max(W, H) * 0.62 + 2, c = this.key.shadow.camera; c.left = -S; c.right = S; c.top = S; c.bottom = -S; c.near = 1; c.far = 40; c.updateProjectionMatrix(); }
      this.rim.target.position.copy(this.key.target.position); this.rim.position.set((W - 1) / 2 + 4, -(H - 1) / 2 + 10, -6);
      this.positionReef();
      if (MAT.bgLift) MAT.bgLift.value = e.menu ? 1 : [1, 0.45, 0.2][worldOf(e.name)] ?? 1;
      { const usePhoto = PHOTO_LEVELS.has(e.name) || !!e.menu || !!e.daily; this.photoMode = usePhoto; if (usePhoto) this.buildPhotoBg(); this.bgTint = new THREE.Color(e.menu ? 0xffffff : WORLD_TINT[worldOf(e.name)]); if (this.photo) { this.photo.bg.material.color.copy(this.bgTint); const im = PHOTO_W[e.menu ? 0 : worldOf(e.name)] || PHOTO_IMG; this.photo.bg.material.map = photoTex(im); if (im !== PHOTO_IMG) this.photo.bg.material.color.lerp(new THREE.Color(1, 1, 1), 0.7); } /* an own painting needs little tint */ if (this.photo) this.photo.group.visible = usePhoto;
        if (this.reef) this.reef.group.visible = !usePhoto; this.backdrop.visible = !usePhoto; this.rays.visible = !usePhoto; }
      this.bakeStatic(); this.aqHold = performance.now() + 3000;
      this.fitCamera(true, !e.menu);
    }
    // ---- static batching: after a level is built, every static decoration (sheet sprites, their baked shadows, contact patches)
    // that shares a material is merged into ONE mesh. Plant sway moves into the vertex shader (same motion, no per-object JS).
    // Treasures, ledge plants (they vanish when dug), the gate sprite and anything animated stay separate. Draw calls drop a lot.
    bakeStatic() { const LG = this.levelGroup; LG.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(LG.matrixWorld).invert();
      const skip = new Set(); (this.treasures || []).forEach(t => t.m.traverse(o => skip.add(o))); (this.edgePlants || []).forEach(p => p.m.traverse(o => skip.add(o))); if (this.gateSprite) this.gateSprite.traverse(o => skip.add(o)); for (const g of [this.fg && this.fg.group, this.photo && this.photo.group, this.reef && this.reef.group]) if (g) g.traverse(o => skip.add(o));
      const sprMats = new Set(Object.values(SPR.mat || {})), shMats = new Set([...Object.values(SPR.shm || {}), ...Object.values(SPR.cm || {})]);
      const groups = new Map(), victims = [];
      LG.traverse(o => { if (!o.isMesh || o.isInstancedMesh || skip.has(o) || !o.visible) return; const m = o.material; if (Array.isArray(m) || !(sprMats.has(m) || shMats.has(m))) return;
        let p = o.parent, ok = true; while (p && p !== LG) { if (skip.has(p) || !p.visible) { ok = false; break; } p = p.parent; } if (!ok) return;
        if (o.userData.fakeShadow && o.onBeforeRender) { o.onBeforeRender(); o.updateMatrixWorld(true); }
        const owner = o.userData.fakeShadow ? o.parent : o, sw = owner && owner.userData.sway;
        if (sw && !o.userData.fakeShadow) o.rotation.z = 0, o.updateMatrixWorld(true);
        (groups.get(m) || groups.set(m, []).get(m)).push({ o, sw: o.userData.fakeShadow ? null : sw }); });
      const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), v = new V3();
      for (const [mat, list] of groups) {
        let nv = 0, ni = 0; for (const { o } of list) { nv += o.geometry.attributes.position.count; ni += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; }
        const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), swa = new Float32Array(nv * 3), idx = new Uint32Array(ni); let vo = 0, io = 0, anySway = false;
        for (const { o, sw } of list) { const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv; _m.multiplyMatrices(inv, o.matrixWorld); _n.getNormalMatrix(_m);
          const sy = new V3().setFromMatrixColumn(_m, 1).length();
          for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); const ly = v.y; v.applyMatrix4(_m); pos.set([v.x, v.y, v.z], (vo + i) * 3);
            if (N) { v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3); } else nor.set([0, 0, 1], (vo + i) * 3);
            if (U) uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
            if (sw) { anySway = true; swa.set([Math.max(0, ly) * sy * sw[0], sw[1], sw[2]], (vo + i) * 3); } }
          if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo; else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
          vo += P.count; victims.push(o); }
        const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); mg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); mg.setIndex(new THREE.BufferAttribute(idx, 1));
        let mm = mat; if (anySway) { mg.setAttribute('aSw', new THREE.BufferAttribute(swa, 3)); mm = (MAT.swayed || (MAT.swayed = new Map())).get(mat);
          if (!mm) { mm = mat.clone(); mm.onBeforeCompile = (sh) => { sh.uniforms.uSwT = MAT.causticT; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aSw; uniform float uSwT;')
              .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x -= sin(uSwT * aSw.y + aSw.z) * aSw.x;'); }; mm.customProgramCacheKey = () => 'sway'; MAT.swayed.set(mat, mm); } }
        const merged = new THREE.Mesh(mg, mm); merged.renderOrder = list[0].o.renderOrder; merged.receiveShadow = list[0].o.receiveShadow; merged.frustumCulled = false; LG.add(merged); }
      for (const o of victims) { o.onBeforeRender = () => {}; if (o.parent) o.parent.remove(o); } }
    spawn(o) {
      let m;
      if (o.t === T.ROCK) m = makeStone(this.newArt); else if (o.t === T.BALL) m = makeBall(this.newArt); else if (o.t === T.PLAYER) m = makeDiver();
      else if (o.t === T.FISH) m = makeFish(); else if (o.t === T.JELLY) m = makeJelly(); else if (o.t === T.CRAB) m = makeCrab();
      if (!m) return;
      // only parts big enough to throw a visible shadow cast one (eyes, pupils, highlights, teeth, spots don't): halves their cost in the shadow pass
      { m.updateMatrixWorld(true); const R = new THREE.Box3().setFromObject(m).getSize(new V3()).length() / 2 || 1, ws = new V3();
        m.traverse(c => { if (!c.isMesh) return; if (!c.geometry.boundingSphere) c.geometry.computeBoundingSphere(); ws.setFromMatrixScale(c.matrixWorld); const r = c.geometry.boundingSphere.radius * Math.max(ws.x, ws.y, ws.z);
          c.castShadow = r > R * 0.16 && !(c.material && c.material.transparent); }); }
      m.position.set(o.x, -o.y, 0.05);
      if (o.t === T.PLAYER) { // measure the model once and size it to stand inside one cell
        m.scale.setScalar(1); m.rotation.set(0, -0.35, 0); m.updateMatrixWorld(true);
        const bb = new THREE.Box3(); m.traverse(c => { if (c.isMesh && c.geometry && !c.userData.isHull && c.material && !c.material.transparent) { c.geometry.computeBoundingBox(); bb.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld)); } });
        const sz = new THREE.Vector3(); bb.getSize(sz); const sc = Math.min(0.88 / sz.y, 0.86 / Math.max(sz.x, sz.z)); const feet = bb.min.y - m.position.y;
        m.userData.fit = { s: sc, yOff: -0.5 + 0.03 - feet * sc }; m.scale.setScalar(sc); }
      const ent = { o, m, facing: 1, squash: 0, phase: Math.random() * 10, wasFalling: false };
      { // fake shadows for the 3D pieces: a soft drop shadow on the back wall (down-right, like every other shadow) + a contact patch on the floor
        const [dw, dh, cw] = o.t === T.BALL ? [0.86, 0.86, 0.8] : o.t === T.ROCK ? [1.0, 1.0, 0.95] : o.t === T.PLAYER ? [0.6, 0.9, 0.6] : [0.75, 0.55, 0.65];
        const mk = (op) => new THREE.MeshBasicMaterial({ map: getContactTex(), transparent: true, opacity: op, depthWrite: false });
        const drop = new THREE.Mesh(new THREE.PlaneGeometry(dw * 1.1, dh * 1.1), mk(0.7)); drop.renderOrder = 3;
        const contact = new THREE.Mesh(new THREE.PlaneGeometry(cw * 1.15, 0.6), mk(0.85)); contact.rotation.x = -Math.PI / 2; contact.renderOrder = 3;
        this.levelGroup.add(drop, contact); ent.sh = { drop, contact }; m.userData.shadow = contact; this.entShadows.push(ent); }
      this.entities.set(o.id, ent);
      this.levelGroup.add(m);
    }
    // ---- baked contact shadows + ambient occlusion on the tank's back wall: every solid cell (sand, shelves, frame)
    // darkens the water behind its edges and casts a soft shadow down-right, the same way as the key light
    buildOcclusion() {
      const e = this.e, W = e.w, H = e.h; this.occData = new Uint8Array(W * H * 4); this.occStatic = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = e.get(x, y); if (t === T.WALL || t === T.STEEL) this.occStatic[y * W + x] = 255; }
      this.occTex = new THREE.DataTexture(this.occData, W, H, THREE.RGBAFormat); this.occTex.magFilter = this.occTex.minFilter = THREE.LinearFilter; this.occVer = -1; this.syncOcclusion();
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uOcc: { value: this.occTex }, uSize: { value: new THREE.Vector2(W, H) }, uL: { value: new THREE.Vector2(-SHADOW_DIR.x, SHADOW_DIR.y) } },
        vertexShader: 'varying vec2 vC; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vC = vec2(wp.x, -wp.y); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: `uniform sampler2D uOcc; uniform vec2 uSize, uL; varying vec2 vC;
          float S(vec2 c) { return texture2D(uOcc, (c + 0.5) / uSize).r; }
          void main() { float ao = 0.0;
            for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 d = vec2(cos(a), sin(a)); ao += S(vC + d * 0.3) + S(vC + d * 0.62) * 0.6; }
            ao = clamp(ao / 12.8 - 0.06, 0.0, 1.0);
            float sh = 0.0; for (int i = 1; i <= 7; i++) { float t = float(i) * 0.1; sh = max(sh, S(vC + uL * t) * (1.0 - t * 0.85)); }
            float a = clamp(ao * 0.8 + sh * 0.6, 0.0, 0.6); gl_FragColor = vec4(0.03, 0.1, 0.22, a); }` });
      const w = W - 2, h = H - 2, m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set((W - 1) / 2, -(H - 1) / 2, -0.47); m.renderOrder = 2; /* after the tinted back glass (renderOrder 1), which it sits in front of */ this.levelGroup.add(m); this.occMesh = m;
    }
    syncOcclusion() { if (!this.occTex || this.occVer === this.maskTex.version) return; this.occVer = this.maskTex.version;
      const D = this.occData, Mk = this.maskData, St = this.occStatic; for (let i = 0; i < St.length; i++) D[i * 4] = Math.max(St[i], Mk[i * 4]); this.occTex.needsUpdate = true; }
    // new-look aquarium extras: a live water surface + waterline, sun shafts slanting in from the key light's side, an air-stone bubble column
    buildPremiumTank(tank, b) {
      const { x0, x1, yT, yB, cx, cy, w, h, zF, zB } = b, add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
      const vs = 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';
      const ys = yT - 0.14; // water surface, just under the top rim
      { // the waterline seen through the front glass: a bright wavering edge with a soft glow below it
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.5), new THREE.ShaderMaterial({ ...add, uniforms: { uT: MAT.causticT }, vertexShader: vs,
          fragmentShader: `uniform float uT; varying vec2 vUv; varying vec3 vW; void main(){ float wave = 0.72 + sin(vW.x * 2.3 + uT * 1.6) * 0.035 + sin(vW.x * 5.1 - uT * 2.2) * 0.02;
            float d = vUv.y - wave; float soft = smoothstep(0.09, 0.0, abs(d)), glint = smoothstep(0.02, 0.0, abs(d)) * (0.55 + 0.45 * sin(vW.x * 11.0 + uT * 3.0) * sin(vW.x * 4.3 - uT * 1.7));
            float glow = smoothstep(-0.7, 0.0, d) * step(d, 0.0) * 0.26; float a = soft * soft * 0.42 + glint * 0.38 + glow; /* a soft meniscus with moving glints, not a hard ruled line */ gl_FragColor = vec4(vec3(0.75, 0.97, 1.0) * a, a); }` }));
        m.position.set(cx, ys - 0.12, zF + 0.004); m.renderOrder = 6; tank.add(m); }
      { // the surface itself, rippling (seen at a grazing angle)
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, zF - zB), new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide, uniforms: { uT: MAT.causticT }, vertexShader: vs,
          fragmentShader: `uniform float uT; varying vec2 vUv; varying vec3 vW; void main(){ vec2 p = vW.xz * vec2(2.2, 5.0);
            float a = sin(p.x + uT * 0.9 + sin(p.y * 1.3 + uT) * 1.4), c = sin(p.y * 1.7 - uT * 0.8 + sin(p.x * 0.9 - uT * 0.6) * 1.3);
            float k = pow(max(0.0, 1.0 - abs(a + c) * 0.5), 4.0) * 0.55 + 0.12; gl_FragColor = vec4(vec3(0.6, 0.92, 1.0) * k, k); }` }));
        m.rotation.x = -Math.PI / 2; m.position.set(cx, ys, (zF + zB) / 2); m.renderOrder = 6; tank.add(m); }
      { // sun shafts: slanted, soft-edged, slowly breathing, clipped to the tank
        const n = Math.max(3, Math.round(w / 2.6));
        for (let i = 0; i < n; i++) { const bw = 0.8 + ((i * 37) % 7) * 0.13, ph = i * 1.7;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, h * 1.5), new THREE.ShaderMaterial({ ...add, uniforms: { uT: MAT.causticT, uB: { value: new THREE.Vector4(x0, x1, yB, ys) }, uPh: { value: ph } }, vertexShader: vs,
            fragmentShader: `uniform float uT, uPh; uniform vec4 uB; varying vec2 vUv; varying vec3 vW; void main(){
              float inside = step(uB.x, vW.x) * step(vW.x, uB.y) * step(uB.z, vW.y) * step(vW.y, uB.w);
              float across = pow(max(0.0, sin(vUv.x * 3.14159)), 3.0), down = pow(clamp((vW.y - uB.z) / (uB.w - uB.z), 0.0, 1.0), 1.4);
              float a = 0.15 * across * down * (0.65 + 0.35 * sin(uT * 0.5 + uPh)) * inside; gl_FragColor = vec4(vec3(1.0, 0.96, 0.82) * a, a); }` }));
          m.position.set(x0 + (i + 0.5) * w / n + 0.6, cy + 0.2, 0.47); m.rotation.z = 0.36; m.renderOrder = 4; tank.add(m); } }
      this.pump = { x: x0 + 0.28, y: yB + 0.15, z: -0.42, t: 0, top: ys };
      // a few more thin bubble streams rising behind the play plane (the reference tank fizzes everywhere)
      this.streams = []; { const n = Math.max(3, Math.round(w / 2.6)); for (let i = 0; i < n; i++) this.streams.push({ x: x0 + (i + 0.5 + (((i * 53) % 10) / 10 - 0.5) * 0.6) * w / n, y: yB + 0.1, z: -0.44 + ((i * 31) % 5) * 0.012, t: i * 0.37, on: 0.18 + ((i * 17) % 7) * 0.03 }); }
    }
    // the diver's death: flattened under a stone, keeling over onto his back (out of air), or spun over (gobbled). He stays down
    // with X eyes and little stars circling until the result screen; nothing pops out of existence.
    animateDeath(ent, dt) {
      const g = ent.ghost, m = ent.m, u = m.userData, bs = u.baseScale, t = g.t, floorY = g.cy - 0.5;
      if (!g.init) { g.init = true; g.y0 = m.position.y; g.x0 = m.position.x;
        if (u.eyes) { u.eyes.forEach(eg => { eg.visible = false; }); u.happy.forEach(h => { h.visible = false; }); u.smile.visible = false; u.mouthJoy.visible = false; u.mouthO.visible = true; u.mouthO.scale.set(0.9, 0.7, 0.4);
          const xm = MAT.eyeDeep; g.xs = u.eyes.map(eg => { const grp = new THREE.Group(); grp.position.copy(eg.userData.base); for (const r of [0.785, -0.785]) { const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 3, 6), xm); bar.rotation.z = r; grp.add(bar); } u.face.add(grp); return grp; }); }
        if (!TEX.star) { const c = document.createElement('canvas'); c.width = c.height = 64; const g2 = c.getContext('2d'); g2.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 28, an = -Math.PI / 2 + i * Math.PI / 5; g2.lineTo(32 + Math.cos(an) * r, 32 + Math.sin(an) * r); } g2.closePath();
          g2.fillStyle = '#ffd93b'; g2.fill(); g2.lineWidth = 4; g2.strokeStyle = '#b86a00'; g2.stroke(); TEX.star = new THREE.CanvasTexture(c); TEX.star.colorSpace = THREE.SRGBColorSpace; }
        g.stars = [0, 1, 2].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })); sp.scale.setScalar(0.26); sp.renderOrder = 12; this.levelGroup.add(sp); return sp; }); }
      const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
      let headX = m.position.x, headY = m.position.y + 0.5;
      if (g.cause === 'crushed') { // pancake under the stone: instant squash, a little wobble, limbs splayed
        const k = ease(t / 0.12), wob = Math.sin(t * 28) * Math.exp(-t * 7) * 0.08;
        m.rotation.y += (-Math.PI / 2 - m.rotation.y) * Math.min(1, dt * 20); /* face the camera: local z is then screen-wide */ m.scale.set(bs * (1 + 0.35 * k), bs * (1 - 0.8 * k - wob), bs * (1 + 0.85 * k + wob)); m.position.set(g.x0, floorY + 0.05 + (g.y0 - floorY - 0.05) * (1 - k), 0.14 + 0.36 * k); /* flattened in front of the stone so you can see what happened */
        u.armF.rotation.z = u.armF.rotation.z + (1.6 - u.armF.rotation.z) * Math.min(1, dt * 12); u.armB.rotation.z = u.armB.rotation.z + (-0.9 - u.armB.rotation.z) * Math.min(1, dt * 12);
        u.legF.rotation.z = 0.5; u.legB.rotation.z = -0.5; u.body.rotation.z = 0; headY = floorY + 0.02; headX = g.x0 + 0.1;
      } else { // keel over onto his back and settle on the floor; gobbled = a quick spin first
        const spin = g.cause === 'monster' ? Math.max(0, 1 - t / 0.6) : 0; m.rotation.z += spin * dt * 14;
        const k = ease((t - (g.cause === 'monster' ? 0.5 : 0.25)) / 0.7), bounce = Math.abs(Math.sin(Math.min(1, t / 1.2) * Math.PI * 2.5)) * Math.exp(-t * 3) * 0.12;
        u.body.rotation.z = u.body.rotation.z + (1.5 - u.body.rotation.z) * k; m.position.y = g.y0 + (floorY + 0.12 - g.y0) * k + bounce; m.position.x = g.x0;
        if (spin <= 0) m.rotation.z += (0 - m.rotation.z) * Math.min(1, dt * 6);
        u.armF.rotation.z = 2.4 * k + 0.4 * (1 - k); u.armB.rotation.z = 2.0 * k; u.legF.rotation.z = -0.2 * k + Math.sin(t * 20) * 0.25 * Math.exp(-t * 3); u.legB.rotation.z = 0.15 * k;
        headY = m.position.y + 0.25; headX = g.x0 - 0.35 * Math.cos(m.rotation.y);
        if (g.cause === 'oxygen' && Math.random() < dt * 6 * Math.exp(-t)) this.particles.bubbles(headX, headY, 0.3, 1, 0.06, 0.1); }
      g.stars.forEach((sp, i) => { const a = t * 3.4 + i * 2.094, show = Math.min(1, Math.max(0, (t - 0.35) / 0.3)); sp.position.set(headX + Math.cos(a) * 0.3, headY + 0.28 + Math.sin(a * 2) * 0.03, 0.55 + Math.sin(a) * 0.25); sp.material.opacity = show; sp.material.rotation = t * 4 + i; });
      if (t > 6) { this.levelGroup.remove(m); g.stars.forEach(sp => this.levelGroup.remove(sp)); return false; }
      return true;
    }
    syncEntityShadows() {
      this.entShadows = this.entShadows.filter(ent => { const { drop, contact } = ent.sh;
        if (!this.entities.has(ent.o.id)) { this.levelGroup.remove(drop, contact); return false; }
        const m = ent.m, fit = ent.o.t === T.PLAYER ? (m.userData.fit || { yOff: 0 }) : null, cx = m.position.x, cy = fit ? m.position.y - fit.yOff - (ent.lift || 0) : m.position.y;
        drop.visible = m.visible; drop.position.set(cx + SHADOW_DIR.x * 0.42, (fit ? m.position.y - fit.yOff : cy) + SHADOW_DIR.y * 0.42, -0.465);
        contact.position.set(cx + 0.1, cy - 0.455, 0.0); /* floor trim top sits at cell bottom + 0.03 */ if (!m.visible) contact.visible = false; return true; });
    }
    // lay out the sand blocks from the engine grid: corners round where both neighbouring sides are open,
    // and inner corners (three sand cells around an open one) get a fillet, matching the sand-front shader
    syncSandBlocks() {
      const e = this.e, M = this.sandMeshes; if (!M) return; const d0 = new THREE.Object3D();
      const isS = (x, y) => { if (e.get(x, y) === T.SAND) return true; const i = this.sandIndex.get(y * e.w + x); return i !== undefined && this.sandScale[i] > 0.5; }; // a cell being dug counts as sand until halfway
      for (const k in M) M[k].count = 0;
      this.sandCells.forEach(([x, y], i) => { const k = this.sandScale[i]; if (k <= 0.5) return;
        const oU = y < 1 || !isS(x, y - 1), oD = !isS(x, y + 1), oL = !isS(x - 1, y), oR = !isS(x + 1, y);
        const fl = (oU && oL ? 1 : 0) | (oU && oR ? 2 : 0) | (oD && oR ? 4 : 0) | (oD && oL ? 8 : 0), im = M[fl];
        d0.position.set(x, -y, 0); d0.rotation.set(0, 0, 0); d0.scale.setScalar(1); d0.updateMatrix(); im.setMatrixAt(im.count++, d0.matrix); });
      const F = M.fillet, seen = new Set();
      this.sandCells.forEach(([sx, sy]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const x = sx + dx, y = sy + dy, id = y * e.w + x;
        if (seen.has(id) || x < 0 || y < 0 || x >= e.w || y >= e.h) continue; seen.add(id); const t = e.get(x, y); if (isS(x, y) || t === T.WALL || t === T.STEEL) continue;
        // corner -> [neighbour x, neighbour y, rotation]; the fillet geometry is the top-left one
        for (const [ax, ay, rot] of [[-1, -1, 0], [1, -1, -Math.PI / 2], [1, 1, Math.PI], [-1, 1, Math.PI / 2]]) {
          if (y + ay < 0) continue;
          if (isS(x + ax, y) && isS(x, y + ay) && isS(x + ax, y + ay)) { d0.position.set(x, -y, 0); d0.rotation.set(0, 0, rot); d0.scale.setScalar(1); d0.updateMatrix(); F.setMatrixAt(F.count++, d0.matrix); } } } });
      for (const k in M) { M[k].visible = M[k].count > 0; M[k].instanceMatrix.needsUpdate = true; }
    }
    // a sand cell gets a bright top lip when the cell above it is not sand (and it hasn't been dug itself)
    refreshLips() {
      const e = this.e, dummy = new THREE.Object3D(), W = e.w;
      this.sandCells.forEach(([x, y], i) => {
        const show = e.get(x, y) === T.SAND && e.get(x, y - 1) !== T.SAND;
        dummy.position.set(x, -y + 0.46, 0.41); dummy.scale.setScalar(show ? 1 : 0); dummy.updateMatrix(); this.lipInst.setMatrixAt(i, dummy.matrix);
      });
      this.lipInst.instanceMatrix.needsUpdate = true;
    }
    startPlay() { this.playing = true; this.fitCamera(false); }
    onTick(e, now) {
      this.lastTick = now;
      for (const ev of e.events) this.handleEvent(ev, e);
      for (const [id, ent] of this.entities) if (!e.objects.has(id) && !ent.ghost) { this.levelGroup.remove(ent.m); this.entities.delete(id); }
    }
    sfx(n) { if (this.onSfx) this.onSfx(n); }
    // ---- the hidden relic: an ancient gold coin buried in one sand cell per level (placed by the controller, off the winning route).
    // While buried only a faint glint shows on the sand now and then; dug out it floats, spins and glows until the diver takes it.
    setRelic(c) { if (this.relic) { this.levelGroup.remove(this.relic.g); this.relic = null; } if (!c || this.menuMode) return;
      if (!TEX.relicFace) { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
        const gr = g.createRadialGradient(100, 90, 20, 128, 128, 128); gr.addColorStop(0, '#fff6c0'); gr.addColorStop(0.55, '#f2b52c'); gr.addColorStop(1, '#a8650a'); g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
        g.lineWidth = 10; g.strokeStyle = '#8a4e04'; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke();
        g.strokeStyle = '#7a4302'; g.lineWidth = 13; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 196); g.lineTo(128, 70); g.moveTo(90, 108); g.quadraticCurveTo(92, 150, 128, 152); g.quadraticCurveTo(164, 150, 166, 108); g.moveTo(90, 108); g.lineTo(90, 82); g.moveTo(166, 108); g.lineTo(166, 82); g.stroke(); // a trident
        g.fillStyle = '#7a4302'; [[128, 58], [90, 72], [166, 72]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x - 11, y + 12); g.lineTo(x, y - 10); g.lineTo(x + 11, y + 12); g.fill(); });
        TEX.relicFace = new THREE.CanvasTexture(cv); TEX.relicFace.colorSpace = THREE.SRGBColorSpace; }
      if (!MAT.relic) { MAT.relic = [new THREE.MeshStandardMaterial({ color: 0xd99a1e, metalness: 0.9, roughness: 0.28, emissive: 0x5a3200, emissiveIntensity: 0.6 }), new THREE.MeshStandardMaterial({ map: TEX.relicFace, metalness: 0.75, roughness: 0.3, emissive: 0xffc040, emissiveMap: TEX.relicFace, emissiveIntensity: 0.35 })];
        MAT.relic.push(MAT.relic[1]); GEO.relic = new THREE.CylinderGeometry(0.29, 0.29, 0.07, 40); GEO.relic.rotateX(Math.PI / 2); }
      const g = new THREE.Group(); g.position.set(c.x, -c.y, 0.08); const coin = new THREE.Mesh(GEO.relic, MAT.relic); coin.castShadow = true; g.add(coin);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xffc94a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0 })); glow.scale.setScalar(1.5); glow.position.z = -0.05; g.add(glow);
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xfff1b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 })); glint.renderOrder = 9; glint.position.set(c.x + 0.12, -c.y + 0.1, 0.62); this.levelGroup.add(glint);
      this.levelGroup.add(g); this.relic = { g, coin, glow, glint, c, t: Math.random() * 3 }; }
    collectRelic() { const r = this.relic; if (!r) return; const { x, y } = r.g.position; const P = this.particles;
      P.emit(x, y, 0.6, 46, { color: new THREE.Color(1, 0.82, 0.3), speed: 2.6, life: 1.1, size: 0.14 }); P.emit(x, y, 0.6, 20, { color: new THREE.Color(1, 1, 0.85), speed: 1.2, life: 1.4, size: 0.22 }); P.bubbles(x, y, 0.3, 14, 0.1, 0.6);
      this.popText(x, y + 0.4, 'Relic!', '#ffd84a'); this.playerMood('joy', 1.2); this.sfx('woohoo'); this.shake = Math.max(this.shake, 0.1);
      this.levelGroup.remove(r.glint); r.fly = 0; }
    // ---- level start: a quick tour of what matters, one ring per pearl (rising chime) and then the gate
    reveal(pts) { this.revealQ = pts.map((p, i) => ({ ...p, at: this.time + 0.25 + i * 0.42 })); }
    // ---- reactions
    dodge() { const pl = this.e && this.e.player, ent = pl && this.entities.get(pl.id); if (!ent || !ent.sp) return; ent.sp.vy += 3.2; this.playerMood('surprise', 0.7); this.sfx('eep'); }
    funUpdate(dt, t) {
      const r = this.relic, e = this.e;
      if (r) { r.t += dt;
        if (r.fly !== undefined) { r.fly += dt; const k = Math.min(1, r.fly / 0.6); r.g.position.y += dt * 2.2; r.g.scale.setScalar(Math.max(0.01, 1 + k * 0.6 - k * k * 1.6)); r.coin.rotation.y += dt * 18; r.glow.material.opacity = 0.9 * (1 - k); if (k >= 1) { this.levelGroup.remove(r.g); this.relic = null; } }
        else { const buried = e && e.get(r.c.x, r.c.y) === T.SAND; r.coin.rotation.y = buried ? 0.4 : Math.sin(r.t * 1.4) * 0.85; r.g.position.y = -r.c.y + (buried ? 0 : Math.sin(r.t * 2.2) * 0.06); r.g.position.z = buried ? 0.08 : 0.42; /* sways so the trident face always shows */
          r.glow.material.opacity = buried ? 0 : 0.85 + Math.sin(r.t * 3) * 0.15; if (!buried && Math.random() < dt * 5) this.particles.emit(r.g.position.x + (Math.random() - 0.5) * 0.5, r.g.position.y + (Math.random() - 0.5) * 0.5, 0.6, 1, { color: new THREE.Color(1, 0.9, 0.5), speed: 0.15, life: 0.8, size: 0.09, kind: 2, spread: 0.05 });
          const ph = (r.t % 3.2) / 3.2, gl = buried ? Math.max(0, Math.sin(Math.min(1, ph / 0.18) * Math.PI)) : 0; r.glint.material.opacity = gl * 0.9; r.glint.scale.setScalar(0.12 + gl * 0.32); r.glint.material.rotation = r.t; } }
      if (this.revealQ && this.revealQ.length) { if (!this.pings) this.pings = [];
        while (this.revealQ.length && this.time >= this.revealQ[0].at) { const p = this.revealQ.shift();
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.ringGlow || TEX.dot, color: p.gate ? 0x7ff4ff : 0xffb070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
          sp.renderOrder = 18; sp.position.set(p.x, -p.y, 0.8); this.scene.add(sp); this.pings.push({ sp, t: 0 });
          this.particles.emit(p.x, -p.y, 0.6, 12, { color: p.gate ? new THREE.Color(0.55, 0.95, 1) : new THREE.Color(1, 0.7, 0.35), speed: 1.2, life: 0.7, size: 0.12 });
          if (this.onReveal) this.onReveal(p); } }
      if (this.pings) this.pings = this.pings.filter(pg => { pg.t += dt / 0.8; const k = Math.min(1, pg.t); pg.sp.scale.setScalar(0.5 + k * 2.1); pg.sp.material.opacity = (1 - k) * (1 - k); if (k >= 1) { this.scene.remove(pg.sp); pg.sp.material.dispose(); return false; } return true; });
    }
    // red glow on cells that would be fatal to step into this tick (see dangerScan in the controller)
    setDanger(d) { this.lastDanger = d; this.dangerStay = !!(d && d.stay); const cells = (d && d.cells) || [];
      if (!this.dangerPool) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
        const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, 'rgba(255,40,30,0.85)'); gr.addColorStop(0.6, 'rgba(235,20,30,0.6)'); gr.addColorStop(1, 'rgba(200,10,30,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#ff3b30'; g.lineWidth = 9; g.setLineDash([14, 8]); g.beginPath(); g.arc(64, 64, 42, 0, 7); g.stroke();
        g.strokeStyle = 'rgba(255,240,230,0.95)'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.stroke();
        const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; this.dangerPool = [];
        for (let i = 0; i < 4; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })); sp.renderOrder = 19; sp.visible = false; sp.userData.k = 0; this.scene.add(sp); this.dangerPool.push(sp); } }
      this.dangerPool.forEach((sp, i) => { const c = cells[i]; if (c) { if (!sp.userData.on || sp.userData.x !== c.x || sp.userData.y !== c.y) sp.userData.k = 0; sp.userData.on = true; sp.userData.x = c.x; sp.userData.y = c.y; sp.position.set(c.x, -c.y, 0.85); } else sp.userData.on = false; }); }
    dangerUpdate(dt, t) { if (!this.dangerPool) return; for (const sp of this.dangerPool) { const u = sp.userData; u.k = Math.max(0, Math.min(1, u.k + (u.on ? dt * 8 : -dt * 6))); sp.visible = u.k > 0.01 && !this.menuMode;
      if (sp.visible) { sp.material.opacity = u.k * (0.85 + Math.sin(t * 10) * 0.15); sp.scale.setScalar(0.95 * (0.7 + u.k * 0.3) * (1 + Math.sin(t * 10) * 0.04)); sp.material.rotation = t * 0.8; } } }
    // the diver's facial/body reaction of the moment (effort, surprise, joy, flinch, bonk); a stronger mood replaces a weaker one
    playerMood(k, dur) { const rank = { flinch: 1, bonk: 1, surprise: 2, joy: 3 }; if (this.mood && rank[this.mood.k] > rank[k] && this.mood.t < this.mood.dur * 0.7) return; this.mood = { k, t: 0, dur }; }
    setFx(cls) { if (this.fx) this.fx.className = cls; }
    flashFx(cls) { if (!this.fx) return; this.fx.classList.remove(cls); void this.fx.offsetWidth; this.fx.classList.add(cls); }
    // little floating words for small wins ("+1", "Phew!", "Bonk!"): a canvas sprite that pops, rises and fades
    popText(x, y, text, col = '#ffd84a') { if (this.menuMode || (this.e && this.e.cine)) return; this.pops = this.pops || []; const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
      g.font = '700 60px "Outfit", "Nunito", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.shadowColor = 'rgba(0, 12, 30, 0.55)'; g.shadowBlur = 10; g.shadowOffsetY = 3; g.fillStyle = col; g.fillText(text, 128, 50); /* modern: soft shadow, no thick outline */
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      sp.position.set(x, y + 0.3, 0.9); sp.renderOrder = 9; sp.scale.set(0.01, 0.01, 1); this.levelGroup.add(sp); this.pops.push({ sp, t: 0, y: y + 0.3 }); }
    // ---- intro cinematic effects, driven by the controller through this.cineFx = { glow, storm, lamp } (0..1 each)
    cineFlash(k = 1) { if (REDUCED_MOTION) k *= 0.15; this.flashK = Math.max(this.flashK || 0, k); }
    cineWake() { this.wakeT = this.time; this.wakeScale = 9; this.wakePlay = false; }
    ringAt(sc) { this.wakeT = this.time; this.wakeScale = sc; this.wakePlay = !this.menuMode; } // a ring of light racing out of the gate
    tickCine(dt) { const F = this.cineFx, on = !!(this.cineCam && F && this.e); const t = this.time;
      if (!this.cineGlow) { this.cineGlow = []; const mk = (c) => new THREE.SpriteMaterial({ map: TEX.dot, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        for (let i = 0; i < 90; i++) { const sp = new THREE.Sprite(mk([0xff8a3a, 0xffc94a, 0xff5a2a, 0x7ff0ff][i % 4])); sp.visible = false; sp.renderOrder = 7; this.scene.add(sp); this.cineGlow.push({ sp, ph: Math.random() * 6.28, sz: 0.3 + Math.random() * 0.45, sp0: 0.15 + Math.random() * 0.3 }); }
        const lm = new THREE.SpriteMaterial({ map: TEX.dot, color: 0xfff1c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        this.lampGlow = new THREE.Sprite(lm); this.lampBeam = new THREE.Sprite(lm.clone()); for (const l of [this.lampGlow, this.lampBeam]) { l.visible = false; l.renderOrder = 7; this.scene.add(l); }
        { const [c, g] = canvas(256), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); /* a soft light ring: faint fill, cyan glow, white-hot edge */
          gr.addColorStop(0, 'rgba(120,230,255,0)'); gr.addColorStop(0.55, 'rgba(120,230,255,0.08)'); gr.addColorStop(0.8, 'rgba(110,225,255,0.55)'); gr.addColorStop(0.9, 'rgba(235,255,255,1)'); gr.addColorStop(0.95, 'rgba(140,235,255,0.5)'); gr.addColorStop(1, 'rgba(120,230,255,0)');
          g.fillStyle = gr; g.fillRect(0, 0, 256, 256); TEX.ringGlow = tex(c); }
        const rm = () => new THREE.MeshBasicMaterial({ map: TEX.ringGlow, color: 0xe8fff8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        this.wakeRing = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), rm()); this.wakeRing.visible = false; this.wakeRing.renderOrder = 7; this.scene.add(this.wakeRing);
        this.wakeRing2 = new THREE.Mesh(this.wakeRing.geometry, rm()); this.wakeRing2.visible = false; this.wakeRing2.renderOrder = 7; this.scene.add(this.wakeRing2); }
      const e = this.e, W = e ? e.w : 12, H = e ? e.h : 7;
      // menu: every gate the player has woken sends one more pearl-light drifting through the tank (gate collection)
      const ml = !on && this.menuMode ? Math.min(this.cineGlow.length, this.reefLights || 0) : 0, FF = on ? F : { glow: 0.8, storm: 0 };
      this.cineGlow.forEach((g, i) => { if (on ? FF.glow < 0.01 : i >= ml) { g.sp.visible = false; g.init = false; return; } const F = FF;
        if (!g.init) { g.init = true; g.x = -1.5 + Math.random() * (W + 2); g.y = -(H + 0.5) + Math.random() * (H + 4); }
        g.y += dt * g.sp0 * (1 - F.storm); g.x += dt * (F.storm * (4 + g.sp0 * 8) + Math.sin(t * 0.7 + g.ph) * 0.12); if (g.y > 3.5) g.y = -(H + 0.5); if (g.x > W + 2) { g.x = -2; g.y = -(H + 0.5) + Math.random() * (H + 4); }
        const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + g.ph); g.sp.visible = true; g.sp.position.set(g.x, g.y, -0.2 + (i % 3) * 0.5); const sz = g.sz * (1 + F.storm * 0.6); g.sp.scale.set(sz * (1 + F.storm * 2.5), sz, 1); g.sp.material.opacity = Math.min(1, F.glow * tw * 1.3); });
      // storm: sand and grit tearing across the tank
      if (on && F.storm > 0.05) { const n = Math.round(F.storm * 90 * dt * 10); for (let i = 0; i < n; i++) this.particles.emit(-1 + Math.random() * 3, -Math.random() * (H + 2) + 1.5, 0.3 + Math.random() * 1.2, 1, { color: new THREE.Color(0.75 + Math.random() * 0.2, 0.62, 0.42), speed: 0.4, life: 1.4, size: 0.1 + Math.random() * 0.14, kind: 1, spread: 0.3, vx: 7 + Math.random() * 7, vy: -0.4 + Math.random() * 0.8 }); }
      // the diver's helmet lamp: a warm pool of light and a beam in the facing direction
      const lk = on ? F.lamp : (this.playLamp || 0) * 0.42, pp = this.playerPos;
      if (lk > 0.01 && pp && (on || (this.e && this.e.state === 'playing'))) { const dir = this.playerFacing || 1, fl = 0.92 + Math.sin(t * 13) * 0.03 + Math.sin(t * 7.3) * 0.03;
        this.lampGlow.visible = this.lampBeam.visible = true; this.lampGlow.position.set(pp.x + 0.18 * dir, pp.y + 0.3, 0.75); this.lampGlow.scale.setScalar(2.4 * lk * fl); this.lampGlow.material.opacity = 0.75 * lk;
        this.lampBeam.position.set(pp.x + 1.6 * dir, pp.y + 0.22, 0.7); this.lampBeam.scale.set(3.6 * lk, 1.1 * lk, 1); this.lampBeam.material.opacity = (on ? 0.35 : 0.2) * lk * fl; }
      else if (this.lampGlow) this.lampGlow.visible = this.lampBeam.visible = false;
      // the gate waking: a ring of light racing outward
      const wt = this.wakeT !== undefined && (on || this.wakePlay) ? t - this.wakeT : 99, wsc = this.wakeScale || 9;
      if (wt < 1.6 && e && e.gate) { const k = wt / 1.6; this.wakeRing.visible = true; this.wakeRing.position.set(e.gate.x, -e.gate.y, 0.8); this.wakeRing.scale.setScalar(0.5 + k * wsc); this.wakeRing.material.opacity = (1 - k) * (1 - k * 0.3);
          const k2 = Math.max(0, (wt - 0.18) / 1.6); this.wakeRing2.visible = k2 > 0 && k2 < 1; this.wakeRing2.position.copy(this.wakeRing.position); this.wakeRing2.scale.setScalar(0.4 + k2 * wsc * 0.7); this.wakeRing2.material.opacity = (1 - k2) * 0.6; }
        else { this.wakeRing.visible = false; if (this.wakeRing2) this.wakeRing2.visible = false; }
      this.flashK = Math.max(0, (this.flashK || 0) - dt * 3.2); }
    // level-1 coach: a pulsing trail of light along the cells the diver should swim/dig through next (cells: [[x,y],...] or null)
    toScreen(x, y, z = 0.5) { const v = new V3(x, -y, z).project(this.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }
    setCoachTrail(cells) { this.coachCells = cells && cells.length ? cells : null; }
    tickCoach(dt) { const C = this.coachCells; this.coachK = (this.coachK || 0) + ((C ? 1 : 0) - (this.coachK || 0)) * Math.min(1, dt * 5);
      if (!this.coachPool) { this.coachPool = []; const m0 = new THREE.SpriteMaterial({ map: TEX.dot, color: 0x9dffe0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false });
        for (let i = 0; i < 40; i++) { const sp = new THREE.Sprite(m0.clone()); sp.renderOrder = 8; sp.visible = false; this.scene.add(sp); this.coachPool.push(sp); } }
      const t = this.time; this.coachPool.forEach((sp, i) => { const c = C && C[i]; if (!c || this.coachK < 0.02 || !this.e || this.e.state !== 'playing') { sp.visible = false; return; }
        if (C !== this.coachLast) { sp.position.set(c[0], -c[1], 0.62); }
        sp.position.lerp(new V3(c[0], -c[1], 0.62), Math.min(1, dt * 10)); const wave = Math.max(0, Math.cos((i * 0.55 - t * 4.2))), last = i === C.length - 1;
        sp.visible = true; const sz = (last ? 0.62 : 0.32) + wave * 0.16; sp.scale.set(sz, sz, 1); sp.material.opacity = this.coachK * (last ? 0.9 : 0.35 + wave * 0.5); sp.material.color.set(last ? 0xffe27a : 0x9dffe0); });
      this.coachLast = C; }
    tickPops(dt) { if (!this.pops || !this.pops.length) return; this.pops = this.pops.filter(p => { p.t += dt; const k = p.t, s = k < 0.18 ? (k / 0.18) * 1.15 : 1.15 - Math.min(0.15, (k - 0.18) * 0.8);
      p.sp.scale.set(1.3 * s, 0.49 * s, 1); p.sp.position.y = p.y + Math.min(1, k) * 0.7; p.sp.material.opacity = k < 0.8 ? 1 : Math.max(0, 1 - (k - 0.8) / 0.4);
      if (k > 1.2) { this.levelGroup.remove(p.sp); p.sp.material.map.dispose(); p.sp.material.dispose(); return false; } return true; }); }
    handleEvent(ev, e) {
      const P = this.particles, x = ev.x, y = -ev.y;
      const SAND = new THREE.Color(1, 0.8, 0.3);
      switch (ev.type) {
        case 'dig': { const pl = [...e.objects.values()].find(q => q.t === T.PLAYER); this.playerAct = { k: 'dig', t: 0, dir: pl ? (ev.y > pl.py ? 'down' : ev.y < pl.py ? 'up' : 'side') : 'side' };
          const i = this.sandIndex.get(ev.y * e.w + ev.x); if (i !== undefined) this.sandAnim.set(i, 0);
          const pl2 = e.player, fx0 = pl2 ? pl2.px : ev.x, fy0 = pl2 ? pl2.py : ev.y, code = ev.x > fx0 ? 1 : ev.x < fx0 ? 2 : ev.y > fy0 ? 3 : ev.y < fy0 ? 4 : 0;
          this.maskData[(ev.y * e.w + ev.x) * 4 + 1] = code * 50; this.maskTex.needsUpdate = true;
          { const vx = code === 1 ? 1.1 : code === 2 ? -1.1 : 0, vy = code === 3 ? -0.6 : code === 4 ? 1.1 : 0.4; // grains spray away from the diver and settle
            P.emit(x + vx * 0.25, y, 0.42, 18, { color: SAND, speed: 0.45, life: 1.1, size: 0.075, kind: 1, spread: 0.35, vx, vy: vy + 0.5 });
            P.emit(x, y, 0.44, 8, { color: new THREE.Color(0xc99a4a), speed: 0.3, life: 0.9, size: 0.11, kind: 1, spread: 0.3, vx: vx * 0.6, vy: 0.4 }); } this.refreshLips(); P.emit(x, y + 0.2, 0.42, 22, { color: SAND, speed: 0.55, life: 1.3, size: 0.08, kind: 1, spread: 0.45 }); P.emit(x, y, 0.42, 5, { color: new THREE.Color(0xf7e2b0), speed: 0.25, life: 0.7, size: 0.32, kind: 0, spread: 0.3 }); this.sfx('dig'); break; }
        case 'air': { const a = this.airObjs.get(ev.y * e.w + ev.x); if (a) { this.levelGroup.remove(a); this.airObjs.delete(ev.y * e.w + ev.x); } P.bubbles(x, y, 0.2, 16, 0.12, 0.6); P.emit(x, y, 0.5, 18, { color: new THREE.Color(0.55, 0.95, 1), speed: 1.8, life: 0.7, size: 0.12 }); this.sfx('air'); if (!this.menuMode && !e.relaxed) this.popText(x, y + 0.2, '+' + Math.round(30 * (e.tscale || 1)) + 's air', '#8ff4ff'); break; }
        case 'push': { const dx = e.player ? Math.sign(ev.x - e.player.x) || 1 : 1; // ev = the pushed object's new cell
          P.emit(x - dx * 0.45, y - 0.42, 0.42, 9, { color: SAND, speed: 0.5, life: 0.8, size: 0.09, kind: 1, spread: 0.25, vx: -dx * 0.5, vy: 0.35 });
          P.emit(x - dx * 1.35, y - 0.45, 0.4, 5, { color: new THREE.Color(0xd9b06a), speed: 0.4, life: 0.6, size: 0.07, kind: 1, spread: 0.15, vx: -dx * 0.9, vy: 0.5 });
          P.emit(x - dx * 0.45, y - 0.35, 0.44, 3, { color: new THREE.Color(0xf7e2b0), speed: 0.15, life: 0.7, size: 0.3, kind: 0, spread: 0.2 }); }
          this.playerAct = { k: 'push', t: 0 }; this.sfx('push'); if (this.time - (this.lastHup ?? -9) > 0.8) { this.lastHup = this.time; this.sfx('hup'); } break;
        case 'land': { { const pl = e.player; if (pl && Math.abs(pl.x - ev.x) <= 1 && Math.abs(pl.y - ev.y) <= 1) { this.playerMood('flinch', 0.45); this.sfx('oof'); if (ev.t === T.ROCK && ev.y >= pl.y && (pl.px === ev.x || Math.abs(pl.x - ev.x) === 1 && pl.y === ev.y)) { this.sfx('eep'); } } } // a heavy thing lands right next to him
          this.shake = Math.max(this.shake, ev.t === T.ROCK ? 0.12 : 0.07); P.emit(x, y - 0.42, 0.4, 10, { color: SAND, speed: 1.2, life: 0.5, size: 0.1, kind: 1, spread: 0.7 }); this.sfx('land'); break; }
        case 'roll': this.sfx('roll'); break;
        case 'teeter': { const ent = this.entities.get(ev.id); if (ent) ent.teeter = 1; this.sfx('eep'); this.playerMood('surprise', 0.5); this.shake = Math.max(this.shake, 0.06); break; } // grace tick: the stone wobbles, the diver yelps
        case 'absorb': { this.ringAt(3.2); P.emit(x, y, 0.5, 40, { color: new THREE.Color(1, 0.55, 0.25), speed: 2.6, life: 0.8, size: 0.14 }); P.emit(x, y, 0.5, 30, { color: new THREE.Color(0.5, 0.9, 1), speed: 2, life: 1, size: 0.12 }); this.sfx('absorb'); if (e.ballsIn < e.ballsTotal) { this.popText(x, y + 0.2, `${e.ballsIn}/${e.ballsTotal}`, '#ffb36a'); if (!this.menuMode && !e.cine) { this.playerMood('joy', 0.95); this.sfx('yay'); } } /* the last one: the 'Swim in!' marker + banner speak instead */ if (this.onStat && !this.menuMode) this.onStat('pearl'); this.playerMood('joy', 1.25); setTimeout(() => this.sfx('yay'), 260);
          const ent = this.entities.get(ev.id); if (ent) { ent.absorbing = { t: 0, from: new V3(ev.fromX, -ev.fromY, 0.05), to: new V3(x, y, 0.3) }; this.entities.delete(ev.id); this.absorbing.push(ent); } break; }
        case 'gateOpen': { this.ringAt(7); if (this.onGateOpen && !this.menuMode && !e.cine) this.onGateOpen(); this.playerMood('joy', 1.25); this.flashFx('flash'); P.emit(x, y, 0.5, 70, { color: new THREE.Color(0.55, 0.95, 1), speed: 3.5, life: 1.3, size: 0.16 }); P.bubbles(x, y, 0.2, 18, 0.12, 0.8); this.sfx('gateOpen'); this.shake = 0.18; break; }
        case 'gateLocked': if (this.onToast && this.time - (this.lastLockToast ?? -9) > 2.5) { this.lastLockToast = this.time; this.onToast(`Deliver all energy first (${e.ballsIn}/${e.ballsTotal})`); } this.sfx('gateLocked'); this.playerMood('bonk', 0.55); this.sfx('hmm'); break;
        case 'monsterDeath': { P.bubbles(x, y, 0.2, 14, 0.1, 0.6); P.emit(x, y, 0.4, 20, { color: new THREE.Color(1, 0.7, 0.4), speed: 2, life: 0.7, size: 0.12 }); this.sfx('monsterDeath'); this.shake = Math.max(this.shake, 0.12);
          for (const ent of this.entities.values()) if (ent.o.x === ev.x && ent.o.y === ev.y && ent.o.t === ev.t) { ent.ghost = { t: 0, kind: 'monster' }; this.ghosts.push(ent); this.entities.delete(ent.o.id); } break; }
        case 'playerDeath': { if (this.warn) this.warn.visible = false; P.bubbles(x, y, 0.2, 36, 0.13, 0.8); this.shake = 0.4; this.sfx('death'); this.sfx('aww'); this.setFx('dead');
          if (ev.cause === 'crushed') { P.emit(x, y - 0.3, 0.45, 26, { color: SAND, speed: 1.6, life: 0.9, size: 0.1, kind: 1, spread: 0.5, vy: 0.4 }); P.emit(x, y, 0.5, 14, { color: new THREE.Color(1, 0.95, 0.6), speed: 2.4, life: 0.5, size: 0.13, spread: 0.2 }); this.shake = 0.55; }
          for (const ent of this.entities.values()) if (ent.o.t === T.PLAYER) { ent.ghost = { t: 0, kind: 'player', cause: ev.cause, cx: x, cy: y }; ent.m.userData.baseScale = ent.m.scale.x; this.ghosts.push(ent); this.entities.delete(ent.o.id); } break; }
        case 'win': { const wx = e.gate ? e.gate.x : x, wy = e.gate ? -e.gate.y : y; this.flashFx('flash'); this.ringAt(11); for (let i = 0; i < 3; i++) P.emit(wx, wy + 0.2, 0.6, 26, { color: new THREE.Color(1, 0.78 + i * 0.07, 0.3), speed: 2.2 + i, life: 2, size: 0.2, vy: 1.6 }); /* a fountain of pearl-light */ for (let i = 0; i < 4; i++) P.emit(wx, wy, 0.5, 30, { color: new THREE.Color().setHSL(Math.random(), 0.85, 0.65), speed: 3.5, life: 1.6, size: 0.15 }); this.sfx('win'); this.sfx('woohoo');
          for (const ent of this.entities.values()) if (ent.o.t === T.PLAYER) { ent.ghost = { t: 0, kind: 'win', to: e.gate ? new V3(e.gate.x, -e.gate.y, 0.75) : new V3(x, y, 0.75) }; this.ghosts.push(ent); this.entities.delete(ent.o.id); } break; }
      }
    }

    // ---- camera ----
    fitCamera(snap, wholeLevel = false) {
      if (!this.e) return;
      const W = this.e.w, H = this.e.h, aspect = this.camera.aspect, fov = this.camera.fov * Math.PI / 180;
      const padTop = innerWidth < 560 ? 66 : 76, padBottom = (document.body.classList.contains('touch') ? (innerHeight < 500 && innerWidth > innerHeight ? 96 : 76) : 12) + (this.photoMode ? Math.round(innerHeight * (isMobile ? 0.03 : 0.08)) : 0);
      const freeFrac = Math.max(0.3, 1 - (padTop + padBottom) / innerHeight);
      const dH = (H / 2 + (isMobile ? 0.3 : 0.15)) / Math.tan(fov / 2) / freeFrac, dW = (W / 2 * (1 + 0.6 * Math.sin(CAM_YAW)) + (isMobile ? 0.4 : 0.15)) / Math.tan(fov / 2) / aspect; // computers: frame the playfield tighter
      const dFull = Math.max(dH, dW); this.dFull = dFull;
      // show the whole board unless that makes cells smaller than ~34px; then follow the diver at ~46px cells
      const pxPerCell = d => innerHeight / (2 * Math.tan(fov / 2) * d);
      const cellPx = aspect < 0.75 ? Math.max(58, Math.min(76, innerWidth / 5.6)) : 52, dFollow = innerHeight / (2 * Math.tan(fov / 2) * cellPx);
      this.camDist = wholeLevel || pxPerCell(dFull) >= 34 ? dFull : Math.min(dFull, dFollow);
      this.follow = this.camDist < dFull - 0.01;
      if (!isMobile) { this.camDist = wholeLevel ? dFull : dFull * DESK_CLOSE; this.follow = this.camDist < dFull - 0.01; } // computers: closer in, following the diver (Map / hold M shows the whole level)
      // on the home screen, pull back so the menu has room and the reef shows around the board
      if (this.menuMode) { this.camDist = dFull * (aspect > 1 ? (this.menuShift ? 1.4 : 1.75) : 0.98); this.follow = false; }
      if (snap) { this.updateCameraTarget(); this.camPos.copy(this.camGoal); this.camTarget.copy(this.lookGoal); }
    }
    updateCameraTarget(overview = false) {
      const e = this.e, W = e.w, H = e.h; let cx = (W - 1) / 2, cy = -(H - 1) / 2;
      const dist = overview ? this.dFull * 1.04 : this.camDist * (this.menuMode ? 1 : (this.zoomK || 1));
      const fov = this.camera.fov * Math.PI / 180, halfH = Math.tan(fov / 2) * dist, halfW = halfH * this.camera.aspect;
      // centre the board in the free area between the HUD (top) and the D-pad (bottom, phones)
      const ppc = innerHeight / (2 * halfH);
      const padTop = innerWidth < 560 ? 66 : 76, padBottom = (document.body.classList.contains('touch') ? (innerHeight < 500 && innerWidth > innerHeight ? 96 : 76) : 12) + (this.photoMode ? Math.round(innerHeight * (isMobile ? 0.03 : 0.08)) : 0);
      const shift = (padTop - padBottom) / 2 / ppc;
      const visH = halfH - (padTop + padBottom) / 2 / ppc; // half-height of the free area in world units
      if (!overview && (this.follow || (this.playing && isMobile)) && (this.focus || this.playerPos) && !this.menuMode) {
        // follow the diver (or the tutorial's focus), leading a little in the swim direction; never show past the board edges
        const fp = this.focus || this.playerPos, ld = this.focus ? null : this.lead, lx = fp.x + (ld ? ld.x : 0), ly = fp.y + (ld ? ld.y : 0);
        cx = halfW * 2 >= W ? (W - 1) / 2 : Math.max(halfW - 0.6, Math.min(W - 0.4 - halfW, lx));
        cy = visH * 2 >= H ? -(H - 1) / 2 : Math.min(-visH + 0.5, Math.max(-(H - 0.5) + visH, ly));
      }
      cy += shift;
      // portrait phones: when the board fits vertically, sit the tank (and its stand) on the bottom of the free area instead of centring it,
      // so the extra screen goes to open water and the painting above rather than to seabed below
      // portrait phones: when the board fits vertically, centre the tank and its stand in the free area (it used to sit on the bottom edge, leaving half the screen as empty water)
      if (this.camera.aspect < 1 && !this.menuMode && visH * 2 >= H + 1.2) cy = -(H - 1) / 2 - 0.55 + shift + Math.min(visH - (H + 1.2) / 2, 3) * 0.45; // a little below centre: more water above, less seabed below
      this.camGoal = this.camGoal || new V3(); this.lookGoal = this.lookGoal || new V3();
      this.camGoal.set(cx, cy, dist); this.lookGoal.set(cx, cy, 0);
    }

    // ---- per frame ----
    update(dt, now) {
      this.time += dt; const t = this.time; skinTick(t);
      this.rayMat.uniforms.time.value = t; MAT.causticT.value = t;
      if (this.story) { this.story.update(dt); return; } // the transition film owns the screen
      this.particles.update(dt, t); this.tickPops(dt); this.tickCoach(dt); this.tickCine(dt);
      if (!this.e) { this.camera.position.set(0, 0, 30); this.camera.lookAt(0, 0, 0); this.placeBackdrop(); return; }
      const e = this.e;
      const a = Math.min(1, (now - this.lastTick) / this.tickMs), ease = a * a * (3 - 2 * a);
      // treasures: fall through open water once their sand is gone, settle on the next ledge
      if (this.edgePlants) for (const ep of this.edgePlants) if (ep.m.visible && e.get(ep.x, ep.y) !== T.SAND) ep.m.visible = false;
      if (this.treasures) for (const tr of this.treasures) {
        const m = tr.m;
        if (tr.state === 'buried') { if (e.get(tr.cx, tr.cy) !== T.SAND) { tr.state = 'falling'; tr.vy = 0.6; this.particles.emit(m.position.x, m.position.y, 0.5, 10, { color: new THREE.Color(1, 0.95, 0.7), speed: 1.4, life: 0.6, size: 0.12, spread: 0.2 }); if (!this.menuMode) { this.sfx('treasure'); if (this.onStat) this.onStat('treasure', tr.cx + ',' + tr.cy); this.popText(m.position.x, m.position.y, '+1', '#ffe066'); this.particles.emit(m.position.x, m.position.y, 0.55, 12, { color: new THREE.Color(1, 0.85, 0.3), speed: 1.6, life: 0.6, size: 0.09, kind: 2, spread: 0.1 }); } }
          else { if (this.newArt && Math.random() < dt * 0.09) this.particles.emit(m.position.x + 0.08, m.position.y + 0.06, 0.48, 1, { color: new THREE.Color(1, 1, 0.9), speed: 0.01, life: 0.45, size: 0.3, spread: 0.02 }); continue; } }
        const row = Math.round(-m.position.y), col = Math.round(m.position.x);
        const below = e.get(col, row + 1), floorY = -(row + 1) + 0.5 + 0.06;
        const blocked = below !== T.EMPTY && below !== T.PLAYER && !MONSTERS.has(below);
        if (tr.state === 'rest') { if (!blocked) { tr.state = 'falling'; tr.vy = 0; } else continue; }
        tr.vy = Math.max(-5, tr.vy - 9 * dt); m.position.y += tr.vy * dt; m.rotation.z += tr.spin * dt; m.position.z += (0.3 - m.position.z) * Math.min(1, dt * 4);
        if (blocked && m.position.y <= floorY) { m.position.y = floorY; if (tr.vy < -1.5) { tr.vy = -tr.vy * 0.25; } else { tr.state = 'rest'; tr.vy = 0; } }
        if (m.position.y < -e.h) { tr.state = "rest"; }
      }
      // sand chunks pushed back into the tank after a dig
      if (this.digChunks) this.digChunks = this.digChunks.filter(ch => { ch.t += dt / 0.38; const k = Math.min(1, ch.t), ease = 1 - Math.pow(1 - k, 2);
        ch.m.position.z = 0.15 - ease * 0.75; ch.m.scale.setScalar(1 - ease * 0.45); ch.m.material.opacity = 1 - Math.pow(k, 1.6);
        if (k >= 1) { this.levelGroup.remove(ch.m); ch.m.material.dispose(); return false; } return true; });
      // dug sand shrinks away
      if (this.sandAnim.size) {
        const mtx = new THREE.Matrix4(), pos = new V3(), q = new THREE.Quaternion(), sc = new V3();
        for (const [i, s] of this.sandAnim) { const ns = s + dt * 3.6; const k = Math.max(0, Math.pow(1 - Math.min(1, ns), 2.2));
          const [cx, cy] = this.sandCells[i]; this.maskData[(cy * e.w + cx) * 4] = Math.round(255 * k); this.maskTex.needsUpdate = true;
          this.sandScale[i] = k;
          if (ns >= 1) this.sandAnim.set(i, 99); else this.sandAnim.set(i, ns); }
        for (const [i, s] of this.sandAnim) if (s === 99) this.sandAnim.delete(i);
        this.syncSandBlocks();
      }
      if (this.streams) for (const q of this.streams) { q.t -= dt; if (q.t <= 0) { q.t = q.on + Math.random() * 0.25; this.particles.bubbles(q.x + (Math.random() - 0.5) * 0.06, q.y, q.z, 1, 0.02 + Math.random() * 0.025, 0.04); } }
      if (this.pump) { this.pump.t -= dt; if (this.pump.t <= 0) { this.pump.t = 0.09 + Math.random() * 0.08; this.particles.bubbles(this.pump.x + (Math.random() - 0.5) * 0.08, this.pump.y, this.pump.z, 1, 0.03 + Math.random() * 0.03, 0.05); } }
      this.syncOcclusion();
      for (const ent of this.entities.values()) {
        const o = ent.o, m = ent.m, moving = o.px !== o.x || o.py !== o.y;
        const k = (o.t === T.ROCK || o.t === T.BALL) && (o.falling || o.py !== o.y) ? a * a : ease;
        let ix = o.px + (o.x - o.px) * k, iy = -(o.py + (o.y - o.py) * k);
        if (o.t === T.ROCK || o.t === T.BALL) {
          // pushed along the floor: ride just in front of the diver's real (spring) position, so the gloves stay on it the whole way
          // and it never runs ahead or lags behind him; switching between following and free motion is blended (offX decays)
          const sg = Math.sign(o.x - o.px), pl = e.player, pe = pl && this.entities.get(pl.id);
          const follow = sg !== 0 && o.py === o.y && !o.falling && pl && pl.y === o.y && pl.x === o.x - sg && pe && pe.sp;
          if (follow) ix = Math.min(Math.max(pe.sp.x + sg, Math.min(o.x, o.x - sg * 1.5)), Math.max(o.x, o.x - sg * 1.5));
          if (follow !== !!ent.follow && ent.lastIx !== undefined) ent.offX = (ent.lastIx + (ent.offX || 0) * 0) - ix; ent.follow = !!follow;
          ent.offX = (ent.offX || 0) * Math.exp(-dt * 14); if (Math.abs(ent.offX) < 1e-3) ent.offX = 0; ix += ent.offX;
          // roll exactly as far as it travels (no fixed-rate spin, no quarter-turn snapping)
          if (ent.lastIx !== undefined) { const dx = ix - ent.lastIx; if (Math.abs(dx) < 0.5) m.userData.spin.rotation.z -= dx / (o.t === T.BALL ? 0.41 : 0.43); }
          if (follow && ent.lastIx !== undefined && Math.abs(ix - ent.lastIx) > 0.004 && Math.random() < dt * 22 && e.get(o.x, o.y + 1) === T.SAND || (follow && Math.random() < dt * 9)) // a little sand dust rolls off the floor under a pushed pearl/stone
            this.particles.emit(ix - sg * 0.18, iy - 0.42, 0.4, 1, { color: new THREE.Color(0.98, 0.86, 0.6), speed: 0.25, life: 0.55, size: 0.1, kind: 1, spread: 0.12, vy: 0.25, vx: -sg * 0.35 });
          ent.lastIx = ix;
          m.position.set(ix, iy, 0.05);
          // squash only on a real landing after a fall (a push used to end in the same squash, so pearls looked like dented eggs)
          if (ent.wasFalling && !o.falling && !moving && (ent.fellRows || 0) > 0) ent.squash = Math.min(1, 0.45 + ent.fellRows * 0.25);
          if (o.falling && o.y > o.py) ent.fellRows = (ent.fallTick === o.moved ? ent.fellRows : (ent.fellRows || 0) + 1), ent.fallTick = o.moved; else if (!o.falling && !moving) ent.fellRows = 0;
          ent.wasFalling = o.falling || moving;
          const sq = ent.squash || 0, sqk = Math.sin(Math.min(1, 1 - sq) * Math.PI) * sq; m.scale.set(1 + sqk * 0.1, 1 - sqk * 0.1, 1 + sqk * 0.1); ent.squash = Math.max(0, sq - dt * 6);
          if (ent.teeter > 0) { ent.teeter = Math.max(0, ent.teeter - dt * 5); m.rotation.z = Math.sin(t * 60) * 0.12 * ent.teeter; m.position.y += Math.sin(t * 45) * 0.03 * ent.teeter; } else if (m.rotation.z) m.rotation.z = 0;
          m.userData.shadow.visible = e.get(o.x, o.y + 1) !== T.EMPTY && !o.falling;
          if (o.t === T.BALL) { const pulse = Math.sin(t * 4 + ent.phase); m.userData.glow.scale.setScalar(1.7 + pulse * 0.12); m.userData.core.material.opacity = 0.45 + pulse * 0.15;
            ent.spark = (ent.spark || 0) - dt; if (ent.spark <= 0) { ent.spark = 0.25 + Math.random() * 0.45; const an = Math.random() * 6.28; this.particles.emit(ix + Math.cos(an) * 0.38, iy + Math.sin(an) * 0.38, 0.45, 1, { color: new THREE.Color(1, 0.6 + Math.random() * 0.3, 0.2), speed: 0.35, life: 0.7, size: 0.07, kind: 2, spread: 0.02 }); } }
        } else if (o.t === T.PLAYER) {
          const u = m.userData, fit = u.fit || { s: 1.3, yOff: 0.04 }, dir = e.playerDir >= 0 ? 1 : -1, ph = ent.phase;
          // ---- locomotion: a damped spring chases the diver's cell, so every move eases out, overshoots a hair and settles like a body in water
          if (!ent.sp || Math.hypot(ent.sp.x - o.x, ent.sp.y + o.y) > 2.5) ent.sp = { x: o.x, y: -o.y, vx: 0, vy: 0 };
          // the spring chases the tick-interpolated position (not the end of the cell), so a held move glides at an even speed instead of
          // slowing down and speeding up every cell; a single tap still eases in and settles
          { const S = ent.sp, k = 120, c = 2 * Math.sqrt(k) * 0.88, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, ta = moving ? a : 1, tx = o.px + (o.x - o.px) * ta, ty = -(o.py + (o.y - o.py) * ta);
            for (let i = 0; i < n; i++) { S.vx += (k * (tx - S.x) - c * S.vx) * h; S.vy += (k * (ty - S.y) - c * S.vy) * h; S.x += S.vx * h; S.y += S.vy * h; } }
          const gx0 = ent.sp.x, gy0 = ent.sp.y, vxW = ent.sp.vx, vyW = ent.sp.vy, speed = Math.hypot(vxW, vyW);
          if (moving) { this.lastMove = t; this.moveDir.set(o.x - o.px, -(o.y - o.py)); }
          if (ent.cell !== o.y * e.w + o.x) { if (ent.cell !== undefined && !(this.playerAct && this.playerAct.t < 0.06)) this.sfx('swim'); ent.cell = o.y * e.w + o.x; }
          const swimK = (ent.swim = (ent.swim || 0) + (Math.min(1, speed / 2.6) - (ent.swim || 0)) * Math.min(1, dt * 7));
          const idleFor = t - (this.lastMove ?? -99), below = e.get(o.x, o.y + 1), grounded = speed < 0.35 && below !== T.EMPTY && below !== T.GATE;
          // spawn: pop in with a bubble burst; landing after a drop: a sand puff under the fins and a little squash
          if (ent.spawnT === undefined) { ent.spawnT = 0; this.particles.bubbles(gx0, gy0, 0.3, 14, 0.09, 0.45); this.particles.emit(gx0, gy0, 0.4, 12, { color: new THREE.Color(0.7, 0.95, 1), speed: 1.4, life: 0.6, size: 0.12, spread: 0.2 }); this.sfx('bubble'); }
          ent.spawnT += dt; const spawnK = ent.spawnT < 0.55 ? (() => { const k = ent.spawnT / 0.55; return 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.18; })() : 1;
          ent.airT = grounded ? 0 : (ent.airT || 0) + dt;
          if (grounded && ent.wasAir > 0.22) { ent.landSq = 1; this.particles.emit(gx0, gy0 - 0.47, 0.42, 10, { color: new THREE.Color(1, 0.8, 0.3), speed: 0.7, life: 0.7, size: 0.08, kind: 1, spread: 0.35, vy: 0.3 }); this.particles.emit(gx0, gy0 - 0.42, 0.44, 2, { color: new THREE.Color(0xf7e2b0), speed: 0.12, life: 0.6, size: 0.3, kind: 0, spread: 0.25 }); }
          ent.wasAir = ent.airT; ent.landSq = Math.max(0, (ent.landSq || 0) - dt * 4.5); const lsq = Math.sin((1 - ent.landSq) * Math.PI) * (ent.landSq > 0 ? 0.13 : 0);
          // ---- floating: very slow, layered sines so the hover never looks mechanical; fades out while swimming / standing
          const floatK = (ent.floatK = (ent.floatK ?? 1) + ((grounded ? 0 : 1) * (1 - swimK) - (ent.floatK ?? 1)) * Math.min(1, dt * 2.2));
          const bob = (Math.sin(t * 0.95 + ph) * 0.034 + Math.sin(t * 0.57 + ph * 1.7) * 0.016) * floatK;
          ent.lift = (ent.lift ?? 0) + ((grounded ? 0 : 0.05) - (ent.lift ?? 0)) * Math.min(1, dt * 3.5);
          // ---- what the diver is doing: reaching for a pearl/stone in front, pushing, digging, mood reactions
          const ahead = e.obj[o.y * e.w + o.x + dir], canPush = ahead && (ahead.t === T.BALL || ahead.t === T.ROCK) && speed < 1.2;
          ent.reach = (ent.reach || 0) + ((canPush ? 1 : 0) - (ent.reach || 0)) * Math.min(1, dt * (canPush ? 7 : 4));
          const act = this.playerAct; let pushE = 0, digE = 0;
          if (act) { act.t += dt; const dur = act.k === 'dig' ? 0.36 : 0.42, p = Math.min(1, act.t / dur), env = Math.sin(p * Math.PI);
            if (act.k === 'dig') digE = env; else pushE = Math.sin(Math.min(1, p * 1.6) * Math.PI * 0.5) * (1 - Math.max(0, p - 0.7) / 0.3); if (p >= 1) this.playerAct = null; }
          const mood = this.mood; if (mood) { mood.t += dt; if (mood.t > mood.dur) this.mood = null; }
          if (u.glb) { const onFloor = below !== T.EMPTY && below !== T.GATE ? 1 : 0; ent.onFloor = (ent.onFloor ?? onFloor) + (onFloor - (ent.onFloor ?? onFloor)) * Math.min(1, dt * 6);
            glbDrive(u, dt, { reach: ent.reach, push: pushE, dig: digE, swim: swimK, floor: ent.onFloor, speed, pushing: !!(ent.reach > 0.5 && speed > 0.4) }); }
          const mk = this.mood ? this.mood.k : null, mt = this.mood ? this.mood.t : 0, joy = mk === 'joy' ? Math.sin(Math.min(1, mt / 1.1) * Math.PI) : 0;
          // ---- lean: a springy pitch into the swim direction; stops rock back past upright and settle (water drag)
          const fwdV = vxW * dir, leanGoal = Math.max(-0.42, Math.min(0.42, -fwdV * 0.1)) - ent.reach * 0.12 - pushE * 0.32 + (vyW > 0.4 ? 0.08 : vyW < -0.4 ? -0.16 : 0);
          { ent.lean = ent.lean || 0; ent.leanV = ent.leanV || 0; const k = 70, c = 2 * Math.sqrt(k) * 0.42; ent.leanV += (k * (leanGoal - ent.lean) - c * ent.leanV) * dt; ent.lean += ent.leanV * dt; }
          const sway = Math.sin(t * 0.7 + ph) * 0.05 * floatK;
          u.body.rotation.z = (ent.lean + sway + digE * (act && act.dir === 'down' ? 0.42 : act && act.dir === 'up' ? -0.32 : -0.2)) * (u.glb ? 0.4 : 1); /* the clips already lean */
          u.head.rotation.z = -ent.lean * 0.35 + Math.sin(t * 0.8 + ph + 1) * 0.04 * floatK + (mk === 'bonk' ? Math.sin(mt * 30) * 0.18 * Math.max(0, 1 - mt / 0.5) : 0) + (vyW > 0.4 ? 0.12 : vyW < -0.4 ? -0.18 : 0) * swimK;
          // body slides toward what it pushes so the gloves actually touch it
          const lean2 = dir * (u.glb ? 0.145 * Math.max(ent.reach, pushE) : 0.2 * Math.max(ent.reach, pushE) + 0.02 * pushE), hop = joy * 0.16 * Math.abs(Math.sin(mt * 6.5)) ;
          ent.cold = (ent.cold || 0) + (((this.lowAir && !this.menuMode) ? 1 : 0) - (ent.cold || 0)) * Math.min(1, dt * 3); // low air: he shivers and gasps
          const shiver = ent.cold > 0.01 ? Math.sin(t * 47) * 0.014 * ent.cold : 0; if (ent.cold > 0.3 && Math.random() < dt * 1.6) this.particles.bubbles(gx0 + 0.12 * dir, gy0 + 0.4, 0.3, 2, 0.04, 0.12);
          m.position.set(gx0 + lean2 + shiver, gy0 + fit.yOff + ent.lift + bob + hop, 0.14); this.playerPos = m.position; this.playerFacing = ent.facing || 1;
          const gx = gx0, gy = gy0;
          // danger cue: a heavy stone/pearl in the column right above the diver (it falls if he moves the wrong way)
          { if (!this.warn) { const c = document.createElement('canvas'); c.width = c.height = 128; const g2 = c.getContext('2d');
              g2.fillStyle = '#ff3b30'; g2.beginPath(); g2.arc(64, 64, 52, 0, 7); g2.fill(); g2.lineWidth = 8; g2.strokeStyle = '#ffffff'; g2.stroke();
              g2.fillStyle = '#ffffff'; g2.font = '900 84px Arial, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('!', 64, 70);
              this.warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, toneMapped: false })); this.warn.renderOrder = 20; this.scene.add(this.warn); }
            let danger = false; for (let k = 1; k <= 2; k++) { const yy = o.y - k; if (yy < 0) break; const q = e.obj[yy * e.w + o.x]; if (q && (q.t === T.ROCK || q.t === T.BALL)) { danger = true; break; } if (e.get(o.x, yy) !== T.EMPTY) break; }
            danger = danger || !!this.dangerStay; const show = danger && e.state === 'playing'; if (show && !this.warn.visible) { this.playerMood('surprise', 0.9); this.sfx('eep'); } this.warn.visible = show; if (danger) { const pz = 1 + Math.sin(t * 9) * 0.12; this.warn.scale.setScalar(0.42 * pz); this.warn.position.set(gx + 0.38, gy + 0.62, 0.9); } }
          // ---- turning (yaw spring) + a full happy spin on joy
          { const yo = u.glb ? 0.72 - 0.5 * Math.max(ent.reach || 0, pushE) : 0.35, yt = dir > 0 ? -yo : -Math.PI + yo; /* facing what he pushes so the gloves meet it */ /* the Meshy diver turns a little more toward the camera so its face reads */ if (ent.yaw === undefined) ent.yaw = yt; ent.yaw += (yt - ent.yaw) * (1 - Math.exp(-dt * 9));
            m.rotation.y = ent.yaw + (mk === 'joy' ? Math.PI * 2 * Math.min(1, Math.max(0, (mt - 0.15) / 0.75)) ** 0.8 * (1 - 0) : 0);
            // squash & stretch: slow breath when idle, stretch along fast moves, a quick squash on a flinch
            const fs = fit.s, br = Math.sin(t * 1.25 + ph) * 0.018 * (1 - swimK), st = swimK * 0.07, fl = mk === 'flinch' ? Math.sin(Math.min(1, mt / 0.35) * Math.PI) * 0.12 : 0;
            const sk = fs * spawnK; m.scale.set(sk * (1 - br * 0.6 - st * 0.5 + fl * 0.6 + lsq * 0.8), sk * (1 + br + st - fl - lsq), sk * (1 - br * 0.6 + fl * 0.4 + lsq * 0.5)); }
          // ---- legs: lazy flutter when floating, strong kicks when swimming or pushing, still when standing
          const kf = 1.4 + swimK * 9.5 + pushE * 12, ka = (grounded ? 0.03 : 0.12) * (1 - swimK) + swimK * 0.42 + pushE * 0.45, kick = Math.sin(t * kf) * ka;
          u.legF.rotation.z = kick + (grounded ? 0 : 0.08); u.legB.rotation.z = -kick + (grounded ? 0 : 0.08);
          u.finF.rotation.z = -0.25 - Math.sin(t * kf - 0.9) * ka * 1.1; u.finB.rotation.z = -0.25 + Math.sin(t * kf - 0.9) * ka * 1.1;
          // ---- arms: slow treading when floating, relaxed when standing, breaststroke when swimming, hands up & forward to reach, shove when pushing
          let aF = (grounded ? 0.18 : 0.45) + Math.sin(t * 1.1 + ph) * (grounded ? 0.05 : 0.18), aB = (grounded ? 0.14 : 0.38) + Math.sin(t * 1.1 + ph + 1.4) * (grounded ? 0.05 : 0.18);
          if (swimK > 0.01) { const sw = Math.sin(t * 8.5); aF += ((1.25 + sw * 0.85) - aF) * swimK; aB += ((1.15 - sw * 0.85) - aB) * swimK; }
          const lc = -u.body.rotation.z; // arms aim in world space, so leaning in doesn't tip the hands down
          if (ent.reach > 0.01) { aF += (1.5 + lc + Math.sin(t * 3) * 0.04 - aF) * ent.reach; aB += (1.42 + lc + Math.sin(t * 3 + 1) * 0.04 - aB) * ent.reach; }
          if (pushE > 0) { const sh = Math.sin(t * 22) * 0.05; aF += (1.58 + lc + sh - aF) * pushE; aB += (1.5 + lc - sh - aB) * pushE; }
          if (digE > 0) { const dn = act.dir === 'down', up = act.dir === 'up'; aF += (dn ? -0.5 : up ? 2.6 : 1.9) * digE * 0.8; aB += (dn ? 0.9 : up ? 2.3 : 1.2) * digE * 0.7; }
          if (joy > 0) { aF += (2.85 + Math.sin(t * 16) * 0.2 - aF) * joy; aB += (2.75 - Math.sin(t * 16) * 0.2 - aB) * joy; }
          // an occasional cheerful wave (with a little 'hi') after standing still for a while
          if (!act && !mk && swimK < 0.05 && idleFor > 2.6) { ent.waveT = (ent.waveT ?? 1.2) - dt; if (ent.waveT < 0) { if (!ent.waved) { ent.waved = true; this.sfx('hi'); } const w = Math.min(1, -ent.waveT / 1.2); aF = 2.75 + Math.sin(t * 13) * 0.35 * Math.sin(w * Math.PI); if (ent.waveT < -1.2) { ent.waveT = 5 + Math.random() * 4; ent.waved = false; } } } else { ent.waveT = 1.2; ent.waved = false; }
          ent.aF = (ent.aF ?? aF) + (aF - (ent.aF ?? aF)) * Math.min(1, dt * 14); ent.aB = (ent.aB ?? aB) + (aB - (ent.aB ?? aB)) * Math.min(1, dt * 14);
          u.armF.rotation.z = ent.aF; u.armB.rotation.z = ent.aB;
          { const ext = 1 + 0.8 * Math.max(ent.reach, pushE); u.armF.scale.y = ext; u.armB.scale.y = ext; } // cartoon reach: the arms stretch so the gloves press on the pearl
          // ---- face: blinks, glances, and expressions (effort / surprise / joy / flinch / bonk)
          if (u.eyes) {
            ent.blinkT = (ent.blinkT ?? 2) - dt; if (ent.blinkT < -0.13) ent.blinkT = 1.8 + Math.random() * 3.2 - (Math.random() < 0.2 ? 1.7 : 0); // sometimes a quick double blink
            const blink = ent.blinkT < 0 ? Math.sin(-ent.blinkT / 0.13 * Math.PI) : 0;
            const effort = Math.max(pushE, digE * 0.7, ent.reach * 0.25), surprise = mk === 'surprise' || mk === 'flinch' ? Math.sin(Math.min(1, mt / Math.max(0.2, this.mood.dur)) * Math.PI) : 0;
            const eyeY = Math.max(0.06, (1 - blink * 0.95) * (1 - effort * 0.42) * (1 + surprise * 0.28)) * (mk === 'bonk' ? 0.45 : 1), eyeX = 1 + surprise * 0.18;
            const look = new THREE.Vector2(Math.sin(t * 0.37 + ph) * 0.006 * floatK, (vyW > 0.3 ? 0.012 : vyW < -0.3 ? -0.014 : 0) + (pushE + ent.reach) * -0.004);
            u.eyes.forEach((eg, i) => { eg.visible = joy < 0.25; eg.scale.set(eyeX, eyeY, 1); eg.position.set(eg.userData.base.x + look.x, eg.userData.base.y + look.y, eg.userData.base.z); });
            u.happy.forEach(hp => { hp.visible = joy >= 0.25; });
            u.brows.forEach((bw, i) => { const sgn = i ? 1 : -1; bw.rotation.z = Math.PI / 2 + sgn * (effort * 0.38 - surprise * 0.1) + (mk === 'bonk' ? sgn * 0.3 : 0);
              bw.position.y = bw.userData.base.y + surprise * 0.018 + joy * 0.012 - effort * 0.008; });
            u.smile.visible = joy < 0.25 && effort < 0.45 && surprise < 0.3; u.mouthO.visible = !u.smile.visible && joy < 0.25; u.mouthO.scale.set(1 - effort * 0.35, 1.25 * (0.6 + surprise * 0.8 + effort * 0.2), 0.4); u.mouthJoy.visible = joy >= 0.25;
            u.cheeks.forEach(ck => { const s2 = 1 + joy * 0.35 + effort * 0.2; ck.scale.set(1.2 * s2, 0.7 * s2, 0.3); });
          }
          // ---- scarf: slow flutter while floating, streaming while swimming
          if (u.scarf) u.scarf.forEach((sc, j) => { const P = sc.geo.attributes.position, b = sc.base, sp = 2.6 + swimK * 9, amp = 0.022 + swimK * 0.035;
            for (let i = 0; i < P.count; i++) { const x = -b[i * 3] / sc.len; P.setY(i, b[i * 3 + 1] + Math.sin(t * sp - x * 5 + j) * amp * x); P.setZ(i, Math.cos(t * sp * 0.8 - x * 4 + j) * amp * 0.6 * x); }
            P.needsUpdate = true; sc.piv.rotation.z = -0.5 + Math.sin(t * 0.9 + j) * 0.1 + swimK * 0.4 - ent.lean * 0.6; });
          u.lampGlow.material.opacity = 0.55 + Math.sin(t * 1.6) * 0.08;
          m.userData.shadow.visible = e.get(o.x, o.y + 1) !== T.EMPTY;
          ent.bub = (ent.bub || 0) - dt; if (ent.bub <= 0) { ent.bub = (pushE > 0 ? 0.25 : 1.1) + Math.random() * 1.4; this.particles.bubbles(gx + 0.15 * dir, gy + 0.45, 0.25, 1 + (Math.random() * 3 | 0), 0.05, 0.1); }
          if (swimK > 0.3 && Math.random() < dt * 14) { if (SKIN.trail === 'bubbles') this.particles.bubbles(gx - 0.32 * dir, gy - 0.28, 0.2, 1, 0.035, 0.15); else this.particles.emit(gx - 0.3 * dir, gy - 0.2, 0.3, 1, { color: trailColor(t), speed: 0.25, life: 0.7, size: 0.14, spread: 0.18, vx: -dir * 0.4 }); } // trail from the fins (shop skin)
        } else if (o.t === T.FISH) {
          m.position.set(ix, iy + Math.sin(t * 3 + ent.phase) * 0.04, 0.15);
          const D = [[1, 0], [0, 1], [-1, 0], [0, -1]]; const d = D[o.dir]; if (d[0]) ent.facing = d[0];
          ent.fs = (ent.fs || ent.facing) + (ent.facing - (ent.fs || ent.facing)) * Math.min(1, dt * 12); m.rotation.y = -0.5;
          ent.hunt = (ent.hunt || 0) + ((o.hunting ? 1 : 0) - (ent.hunt || 0)) * Math.min(1, dt * 6);
          m.userData.tail.rotation.y = Math.sin(t * (10 + ent.hunt * 14) + ent.phase) * 0.6; m.userData.jaw.rotation.z = -0.15 - Math.abs(Math.sin(t * 6)) * 0.2 - ent.hunt * 0.3;
          const fsc = 1 + ent.hunt * 0.12; m.scale.set(fsc * ent.fs, fsc, fsc);
        } else if (o.t === T.JELLY) {
          const p = (Math.sin(t * 2.4 + ent.phase) + 1) / 2;
          m.position.set(ix, iy + p * 0.06, 0.15); m.userData.bell.scale.set(1 + p * 0.12, 1 - p * 0.2, 1 + p * 0.12);
          m.userData.tents.forEach((tt, i) => { tt.rotation.x = Math.sin(t * 3 + i) * 0.22; tt.rotation.z = Math.cos(t * 2.5 + i) * 0.22 + (p - 0.5) * 0.25 * (tt.position.x > 0 ? 1 : -1); });
        } else if (o.t === T.CRAB) {
          m.position.set(ix, iy - 0.2, 0.15);
          m.userData.legs.forEach((l, i) => { l.rotation.z = moving ? Math.sin(t * 22 + i * 1.7) * 0.35 : Math.sin(t * 2 + i) * 0.05; });
          if (m.userData.claws) m.userData.claws.forEach((c, i) => { c.rotation.z = (i ? -1 : 1) * (0.15 + Math.max(0, Math.sin(t * (moving ? 9 : 2.2) + i * 1.3)) * 0.35); });
          m.rotation.z = moving ? Math.sin(t * 22) * 0.05 : 0;
        }
      }
      this.tickArrive(dt); this.moodTick(dt);
      this.syncEntityShadows(); this.dangerUpdate(dt, t); this.funUpdate(dt, t);
      // ghosts
      this.ghosts = this.ghosts.filter(ent => { const g = ent.ghost, m = ent.m; g.t += dt;
        if (g.kind === 'win') { if (g.s0 === undefined) { g.s0 = m.scale.x; g.from = m.position.clone(); } /* a happy hop, then a spiral into the light, leaving sparkles */
          const k = Math.min(1, g.t / 1.15), hop = Math.sin(Math.min(1, k / 0.45) * Math.PI) * 0.3, mv = 1 - Math.pow(1 - Math.min(1, k / 0.5), 3), /* dash to the gate (ease-out) */
            sk = Math.max(0, (k - 0.45) / 0.55), ease = sk * sk * (3 - 2 * sk), r = 0.3 * Math.sin(sk * Math.PI), an = g.t * 14; /* then spin down into it */
          m.position.set(g.from.x + (g.to.x - g.from.x) * mv + Math.cos(an) * r, g.from.y + (g.to.y - g.from.y) * mv + hop + Math.sin(an) * r * 0.5, g.from.z + (g.to.z - g.from.z) * mv);
          m.rotation.y += dt * (3 + 18 * ease); m.scale.setScalar(g.s0 * (k < 0.45 ? 1 + 0.1 * Math.sin(k / 0.45 * Math.PI) : 1 - ease));
          const pull = sk;
          if (pull > 0 && Math.random() < 0.6) this.particles.emit(m.position.x, m.position.y, 0.6, 1, { color: new THREE.Color(1, 0.9, 0.5), speed: 0.4, life: 0.6, size: 0.1, spread: 0.1 });
          if (k >= 1) { this.levelGroup.remove(m); return false; } return true; }
        if (g.kind === 'monster') { m.position.y -= dt * 1.2; m.rotation.z += dt * 4; const k = Math.min(1, g.t / 0.8); m.scale.setScalar(1 - k); if (k >= 1) { this.levelGroup.remove(m); return false; } return true; }
        return this.animateDeath(ent, dt); });
      this.absorbing = this.absorbing.filter(ent => { const ab = ent.absorbing; ab.t += dt * 2.5; const k = Math.min(1, ab.t); ent.m.position.lerpVectors(ab.from, ab.to, k * k); ent.m.scale.setScalar(1 - k * 0.9); if (k >= 1) { this.levelGroup.remove(ent.m); return false; } return true; });
      // glow lights follow the energy balls nearest the view centre
      { const cx = this.camTarget.x, cy = this.camTarget.y; const balls = [];
        for (const ent of this.entities.values()) if (ent.o.t === T.BALL) balls.push(ent);
        for (const ent of this.absorbing) balls.push(ent);
        balls.sort((p, q) => Math.hypot(p.m.position.x - cx, p.m.position.y - cy) - Math.hypot(q.m.position.x - cx, q.m.position.y - cy));
        this.ballLights.forEach((l, i) => { const ent = balls[i]; if (!ent) { l.intensity = 0; return; }
          const pulse = Math.sin(t * 4 + (ent.phase || 0)); l.position.set(ent.m.position.x, ent.m.position.y, 0.75); l.intensity = (2.6 + pulse * 0.5) * Math.min(1, ent.m.scale.x); }); }
      if (this.gateSprite) { const op = e.gate && e.gate.open; this.gateSprite.material.color.setRGB(op ? 0.75 : 1, op ? 1.15 + Math.sin(t * 4) * 0.1 : 1, op ? 0.8 : 1); }
      if (this.gateObj) { const open = e.gate.open; this.gateLight.color.set(open ? 0x3aff7a : 0xff3a2a); this.gateLight.position.set(this.gateObj.position.x, this.gateObj.position.y + 0.33, 0.8); this.gateLight.intensity = open ? 2.6 + Math.sin(t * 4) * 0.4 : 1.2;
        if (!this.gateBeam) { this.gateBeam = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: MAT.causticT, uK: { value: 0 } },
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform float uT, uK; varying vec2 vUv; void main(){ float x = abs(vUv.x - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - x), 2.5) * pow(max(0.0, 1.0 - vUv.y), 1.6) * (0.7 + 0.3 * sin(uT * 3.0 - vUv.y * 9.0)) * uK; gl_FragColor = vec4(vec3(0.55, 1.0, 0.8) * a, a); }' }));
          this.gateBeam.renderOrder = 7; this.scene.add(this.gateBeam); }
        this.gateBeam.position.set(this.gateObj.position.x, this.gateObj.position.y + 1.95, 0.5);
        const bk = this.gateBeam.material.uniforms.uK; bk.value += ((open ? 0.85 : 0) - bk.value) * Math.min(1, dt * 3); this.gateBeam.visible = bk.value > 0.01; } else if (this.gateBeam) this.gateBeam.visible = false; if (!this.gateObj) { this.gateLight.intensity = 0; if (this.gateArrow) this.gateArrow.visible = false; }
      // gate
      if (this.gateObj) {
        const g = this.gateObj, open = e.gate.open ? 1 : 0; g.userData.k = (g.userData.k || 0) + (open - (g.userData.k || 0)) * Math.min(1, dt * 3); const ok = g.userData.k;
        g.userData.lamp.material = open ? MAT.lampGreen : MAT.lampRed; g.userData.lampGlow.material.color.set(open ? 0x3aff7a : 0xff3a2a);
        g.userData.glow.material.opacity = 0.18 + ok * 0.28 + Math.sin(t * 4) * 0.05 * (0.3 + ok);
        g.userData.screen.position.y = -0.06 + (open ? Math.sin(t * 5) * 0.01 : 0);
        if (open && Math.random() < 0.25) this.particles.bubbles(g.position.x + (Math.random() - 0.5) * 0.5, g.position.y, 0.5, 1, 0.06, 0.2);
        { // once the gate is awake, a bouncing "Swim in!" marker above it until the diver goes in (new players didn't know to)
          if (!this.gateArrow) { const c = document.createElement('canvas'); c.width = 256; c.height = 200; const gx = c.getContext('2d');
            gx.font = '58px "Lilita One", "Baloo 2", sans-serif'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.lineJoin = 'round';
            gx.fillStyle = 'rgba(4,40,30,0.55)'; gx.beginPath(); gx.roundRect(18, 6, 220, 84, 42); gx.fill(); gx.lineWidth = 10; gx.strokeStyle = '#0b3a2a'; gx.strokeText('Swim in!', 128, 50); gx.fillStyle = '#9dffcf'; gx.fillText('Swim in!', 128, 50);
            gx.beginPath(); gx.moveTo(92, 112); gx.lineTo(164, 112); gx.lineTo(128, 186); gx.closePath(); gx.lineWidth = 12; gx.strokeStyle = '#0b3a2a'; gx.stroke(); gx.fillStyle = '#5dffb0'; gx.fill();
            const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; this.gateArrow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); this.gateArrow.renderOrder = 9; this.gateArrow.scale.set(1.7, 1.33, 1); this.scene.add(this.gateArrow);
            if (document.fonts && document.fonts.load) document.fonts.load('58px "Lilita One"').then(() => { gx.clearRect(0, 0, 256, 200); gx.fillStyle = 'rgba(4,40,30,0.55)'; gx.beginPath(); gx.roundRect(18, 6, 220, 84, 42); gx.fill(); gx.lineWidth = 10; gx.strokeStyle = '#0b3a2a'; gx.strokeText('Swim in!', 128, 50); gx.fillStyle = '#9dffcf'; gx.fillText('Swim in!', 128, 50); gx.beginPath(); gx.moveTo(92, 112); gx.lineTo(164, 112); gx.lineTo(128, 186); gx.closePath(); gx.lineWidth = 12; gx.strokeStyle = '#0b3a2a'; gx.stroke(); gx.fillStyle = '#5dffb0'; gx.fill(); tx.needsUpdate = true; }).catch(() => {}); }
          const show = !!e.gate.open && e.state === 'playing' && !this.menuMode && !e.cine; this.gateArrow.visible = show;
          if (show) { const b = Math.abs(Math.sin(t * 3.2)); this.gateArrow.position.set(g.position.x, g.position.y + 1.45 + b * 0.25, 0.9); this.gateArrow.material.opacity = Math.min(1, ok * 1.5); } }
        const G = this.gateFx; if (G) { const fr = e.ballsTotal ? e.ballsIn / e.ballsTotal : 1;
          if (e.ballsIn > G.lit) { G.lit = e.ballsIn; G.burst = 1; } if (e.ballsIn < G.lit) G.lit = e.ballsIn;
          G.burst = Math.max(0, G.burst - dt * 1.4); const pulse = 0.5 + 0.5 * Math.sin(t * (2 + fr * 4 + ok * 3));
          G.halo.material.color.setRGB(0.37 + ok * -0.1, 0.9 + ok * 0.1, 1 - ok * 0.45); G.halo.material.opacity = 0.12 + fr * 0.14 + ok * 0.1 + pulse * 0.06 + G.burst * 0.35;
          const hs = 1.9 + fr * 0.5 + ok * 0.6 + G.burst * 1.2 + pulse * 0.1; G.halo.scale.set(hs, hs, 1);
          G.ring.material.color.setRGB(0.55 - ok * 0.2, 0.95, 1 - ok * 0.4); G.ring.material.opacity = (0.15 + fr * 0.3 + ok * 0.35) * (0.7 + pulse * 0.3) + G.burst * 0.5; G.ring.scale.setScalar(1 + G.burst * 0.6 + ok * Math.sin(t * 3) * 0.04); G.ring.rotation.z = t * 0.5;
          G.slots.forEach((d, i) => { const on = i < e.ballsIn; d.material.color.setRGB(on ? 1 : 0.16, on ? 0.45 + pulse * 0.2 : 0.23, on ? 0.2 : 0.35); d.scale.setScalar(on ? 1.15 + (i === e.ballsIn - 1 ? G.burst * 0.8 : 0) : 0.85); });
          if (ok > 0.5 && Math.random() < dt * 10) { const an = Math.random() * 6.28; this.particles.emit(g.position.x + Math.cos(an) * 0.62, g.position.y + Math.sin(an) * 0.62, 0.6, 1, { color: new THREE.Color(0.6, 1, 0.75), speed: 0.4, life: 0.9, size: 0.09, kind: 2, spread: 0.02 }); } }
      }
      for (const a2 of this.airObjs.values()) { const u = a2.userData, ph = a2.position.x * 1.7 + a2.position.y; u.b.position.y = Math.sin(t * 1.8 + ph) * 0.035;
        u.b.scale.set(1 + Math.sin(t * 3.1 + ph) * 0.035, 1 - Math.sin(t * 3.1 + ph) * 0.03, 1); /* jelly wobble */
        for (const q of u.minis) { const k = (t * 0.32 + q.ph + ph * 0.1) % 1; q.m.position.set(q.x + Math.sin(t * 2 + q.ph * 9) * 0.03, -0.24 + k * 0.48, 0.05); q.m.visible = k < 0.93; } }
      for (const w of this.weeds) w.rotation.z = Math.sin(t * 1.3 + w.userData.phase) * 0.12;
      if (Math.random() < dt * 1.5) { const x = Math.random() * e.w | 0, y = Math.random() * e.h | 0; if (e.get(x, y) === T.EMPTY) this.particles.bubbles(x, -y, 0.2, 1, 0.05, 0.3); }
      // camera
      // smart camera: drift slightly out while idle, ease slightly in while swimming; look a little ahead
      if (!this.moveDir) this.moveDir = new THREE.Vector2(); if (!this.lead) this.lead = new THREE.Vector2();
      const swimming = this.playing && e.state === 'playing' && (t - (this.lastMove ?? -99)) < 0.45;
      const idleFor = t - (this.lastMove ?? -99);
      const zoomTarget = (this.menuMode || !isMobile) ? 1 : swimming ? 0.97 : idleFor > 1.1 || !this.playing ? 1.12 : (this.zoomK || 1);
      this.zoomK = (this.zoomK || 1.12) + (zoomTarget - (this.zoomK || 1.12)) * (1 - Math.exp(-dt * (zoomTarget < (this.zoomK || 1) ? 1.6 : 0.7)));
      const leadTarget = swimming ? new THREE.Vector2(this.moveDir.x * 1.3, this.moveDir.y * 0.9) : new THREE.Vector2(this.lead.x, this.lead.y).multiplyScalar(idleFor > 1.4 ? 0 : 1);
      this.lead.lerp(leadTarget, 1 - Math.exp(-dt * (swimming ? 1.8 : 0.8)));
      this.updateCameraTarget();
      // hold-to-view map: blend smoothly toward a whole-board overview
      this.peekK = (this.peekK || 0) + ((this.peek && !this.menuMode ? 1 : 0) - (this.peekK || 0)) * (1 - Math.exp(-dt * (this.peek ? 3.2 : 4)));
      if (this.peekK > 0.002) { const g0 = this.camGoal.clone(), l0 = this.lookGoal.clone(); this.updateCameraTarget(true); const k = this.peekK * this.peekK * (3 - 2 * this.peekK);
        this.camGoal.lerpVectors(g0, this.camGoal.clone(), k); this.lookGoal.lerpVectors(l0, this.lookGoal.clone(), k); }
      if (this.menuMode) { this.camGoal.x += Math.sin(t * 0.15) * (this.menuShift ? 0.6 : 1.2); this.lookGoal.x = this.camGoal.x; const lift = this.menuLift !== undefined ? this.menuLift * 2 * Math.abs(this.camGoal.z) * Math.tan(this.camera.fov * Math.PI / 360) : this.camGoal.z * (innerHeight > innerWidth ? 0.026 : -0.045); // centre the tank in the free space the home screen leaves this.camGoal.y -= lift; this.lookGoal.y -= lift;
        if (this.menuShift) { const vw = 2 * Math.abs(this.camGoal.z) * Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect; this.camGoal.x -= this.menuShift * vw; this.lookGoal.x -= this.menuShift * vw; } } // computer home: the tank sits right of the menu column // menu: board sits between the logo and PLAY
      let cl = 1 - Math.pow(0.012, dt);
      { const dim = this.cineCam ? (this.storyDim || 0) : 0; this.nightK = this.cineCam ? Math.min(1, Math.max(0, (dim - 0.2) / 0.9)) : 0; MAT.sandNight.value = this.nightK; if (this.groundTint) this.groundTint.value.copy(this.groundTint0).lerp(new THREE.Color(0.05, 0.09, 0.22), this.nightK * 0.85); if (this.post && this.post.compMat) this.post.compMat.uniforms.night.value = this.nightK; this.renderer.toneMappingExposure = (Math.max(0.36, 1 - 0.46 * dim) + (this.cineCam ? (this.flashK || 0) * 1.4 : 0)) * (this.flickT > 0 && !this.cineCam ? 0.62 + 0.38 * Math.abs(Math.sin(this.time * 31) * Math.sin(this.time * 7.3)) : 1); if (this.photo) this.photo.bg.material.color.copy(this.bgTint || new THREE.Color(1, 1, 1)).lerp(new THREE.Color(0.14, 0.24, 0.48), Math.min(1, 0.7 * dim)); } // the story's dark reef, lit again when the gate wakes
      { // stage lighting in play: the world outside the tank sinks into cooler shade (deeper worlds more), the diver's lamp warms the
        // sand/rock/water around them and the far corners of the tank fall gently into shadow. Never dark: it adds depth, not gloom.
        const e0 = this.e, play = !!(e0 && !this.menuMode && !this.cineCam), wl = e0 && !e0.menu && !e0.cine ? worldOf(e0.name) : 0;
        const L = [[0.7, 0.1, 0.94], [0.95, 0.24, 0.7], [1.2, 0.36, 0.5]][wl] || [0.7, 0.1, 0.94], pp = this.playerPos;
        const dk = play && !e0.photo && e0.name === this.condFor ? ({ dark: 1, dim: 0.4 }[this.cond] || 0) : 0; // story: lights out (only your lamp) / dimmed
        const goal = play && pp && e0.state !== 'won' ? 1 : 0; this.lampK = (this.lampK || 0) + (goal - (this.lampK || 0)) * Math.min(1, dt * 2.5);
        if (this.cineCam && this.cineFx && pp) { MAT.lamp.value.set(pp.x + 0.15, pp.y + 0.25, 2.8, this.cineFx.lamp * 1.1); MAT.lampAmb.value = 0; }
        else { if (pp) MAT.lamp.value.set(pp.x + 0.1, pp.y + 0.2, 3.3 - dk * 0.35, L[0] * this.lampK * (1 + dk * 0.5)); else MAT.lamp.value.w = 0; MAT.lampAmb.value = Math.min(0.75, L[1] + dk * 0.42) * this.lampK; }
        this.playLamp = L[0] * this.lampK;
        if (!this.cineCam) { const b = 1 + (L[2] * (1 - dk * 0.45) - 1) * this.lampK; if (this.photo) this.photo.bg.material.color.copy(this.bgTint || new THREE.Color(1, 1, 1)).multiplyScalar(b);
          if (this.groundTint) this.groundTint.value.copy(this.groundTint0).multiplyScalar(Math.max(0.62, b * 0.9)); }
        if (this.post && this.post.compMat && this.post.compMat.uniforms.vig) this.post.compMat.uniforms.vig.value = this.lampK * (1 + dk); }
      if (this.cineCam && this.cineT !== undefined) { // the intro's director: descend from the surface -> follow the diver -> push in on the gate -> pull back wide
        const e = this.e, cx = (e.w - 1) / 2, cy = -(e.h - 1) / 2, D = this.dFull || 20, T = this.cineT, sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
        const pp = this.playerPos || new V3(cx, cy, 0), gx = e.gate ? e.gate.x : cx, gy = e.gate ? -e.gate.y : cy, S = this.cineShot || 'play';
        let fx, fy, d, lift;
        if (S === 'descent') { const k = sm(0, 9.4, T); fx = cx + (pp.x - cx) * k * 0.5; fy = cy + 4.2 * (1 - k) + (pp.y - cy) * k * 0.5; d = D * (1.35 - 0.6 * k); lift = 6.5 * (1 - k) + 0.8 * k; }
        else if (S === 'hero') { const k = sm(0, 4, T - (this.shotT0 || 0)); fx = pp.x + 0.25; fy = pp.y + 0.15; d = D * (0.5 - 0.12 * k); lift = 0.25; }
        else if (S === 'storm') { const k = sm(0, 5, T - (this.shotT0 || 0)); fx = cx + (k - 0.5) * 1.2; fy = cy - 0.6; d = D * (0.78 - 0.1 * k); lift = -0.6; }
        else if (S === 'gate') { fx = (pp.x + gx) / 2; fy = (pp.y + gy) / 2 + 0.2; d = D * 0.62; lift = 0.5; }
        else if (S === 'wide') { fx = cx; fy = cy + 0.4; d = D * 1.08; lift = 2.2; }
        else { fx = pp.x + this.moveDir.x * 0.6; fy = pp.y + 0.35; d = D * 0.68; lift = 0.6; }
        const hw = Math.tan(this.camera.fov * Math.PI / 360) * d * this.camera.aspect; if (hw * 2 < e.w) fx = Math.max(hw - 1, Math.min(e.w - hw, fx)); else fx = cx; // stay inside the tank
        this.camGoal.set(fx, fy + lift, d); this.lookGoal.set(fx, fy, 0); cl = 1 - Math.pow(S === 'descent' ? 0.25 : 0.1, dt); // slower, filmic easing
      }
      this.camPos.lerp(this.camGoal, cl); this.camTarget.lerp(this.lookGoal, cl);
      this.shake = Math.max(0, this.shake - dt * 1.4); const sh = REDUCED_MOTION ? 0 : this.shake * this.shake * 0.25; /* modern: gentler shakes */
      const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
      { // look down at the board from slightly above so blocks, sand walls and shadows read as real 3D
        const tl = this.menuMode ? this.tilt * 0.8 : this.tilt, d = this.camPos.z;
        let yw = CAM_YAW; // phones: the angle swings a little with the diver's place in the tank, so moving shows depth (computers stay still)
        if (isMobile && this.playing && !this.menuMode && !this.cineCam && this.playerPos && this.e && this.e.w > 1) yw += CAM_SWING * ((this.playerPos.x / (this.e.w - 1)) - 0.5);
        if (this.menuMode) yw *= 0.7; this.yawNow += (yw - this.yawNow) * (1 - Math.pow(0.02, dt));
        this.camera.position.set(this.camPos.x + sx + d * Math.cos(tl) * Math.sin(this.yawNow), this.camTarget.y + sy + d * Math.sin(tl) - (this.camTarget.y - this.camPos.y), d * Math.cos(tl) * Math.cos(this.yawNow));
        this.camera.lookAt(this.camTarget.x + sx, this.camTarget.y + sy, 0); }
      this.placeBackdrop(); this.placePhotoBg(t);
      if (this.fg && this.fg.box) { const b = this.fg.box; this.fg.update(t, dt, 0, b.top, b.bot, b.span); this.fg.mat.uniforms.scale.value = innerHeight * this.pixelRatio * 0.9; }
      if (this.reef) { this.reef.update(t); const cd = this.camera.position.z; this.scene.fog.near = cd - 2; this.scene.fog.far = cd + 40; this.reef.snowMat.uniforms.scale.value = innerHeight * this.pixelRatio * 0.9; }
      if (this.fx) this.fx.classList.toggle('lowair', e.state === 'playing' && e.oxygen < 15);
    }
    warm(e) { this.loadLevel(e); this.onTick(e, performance.now()); this.fitCamera(true, true); for (let i = 0; i < 2; i++) { this.update(0.016, performance.now()); this.render(); } }
    // what this device can hold at most, before measuring: weak GPUs / little memory / few cores never start above Medium
    deviceCeiling() { let q = isMobile ? 'high' : 'ultra';
      try { const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'), gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        if (/SwiftShader|llvmpipe|Software|Mali-[4T]|Mali-G[357]\d\b|Adreno \(TM\) [2-5]\d\d|PowerVR|Intel.*HD Graphics [2-5]\d{2,3}\b/i.test(gpu)) q = 'medium'; } catch (er) {}
      const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency || 8;
      if (mem && mem < 2) q = 'low'; else if ((mem && mem < 4) || (isMobile && cores <= 4)) q = q === 'low' ? q : 'medium';
      return q; }
    // pick the tier during loading: render the current (heavy) level at the highest allowed tier, step down until a frame fits.
    // Frames are timed with a pixel read-back, so CPU + GPU are both counted (a pessimistic, stall-included time).
    async benchmark(start, onStep) { const gl = this.renderer.getContext(), px = new Uint8Array(4), order = ['low', 'medium', 'high', 'ultra'];
      const budget = isMobile ? 15 : 13; let i = order.indexOf(start || this.deviceCeiling()), m = 0; if (i < 0) i = 2; this.resScale = 1;
      const frameMs = () => { const t0 = performance.now(); this.update(0.016, performance.now()); this.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - t0; };
      for (; ; i--) { this.setQuality(order[i]); if (onStep) onStep(order[i]); await new Promise(r => setTimeout(r, 0)); // let the loader repaint
        // warm-up frames compile this tier's shaders and settle the GPU; a frame that is hopeless even then skips the measuring
        let slow = 0; for (let k = 0; k < 4; k++) slow = frameMs();
        if (i > 0 && slow > 250) continue;
        const ms = []; for (let k = 0; k < 7; k++) ms.push(frameMs()); ms.sort((a, b) => a - b); m = ms[3];
        if (m <= budget || i === 0) break;
        if (m <= budget * 1.35) { this.resScale = isMobile ? 0.88 : 0.8; this.setQuality(order[i]); break; } } // just over: keep the look, render 12% fewer pixels
      if (i === 0 && m > budget * 1.6) { this.resScale = isMobile ? 0.85 : 0.7; this.setQuality('low'); }
      this.aqHold = performance.now() + 4000; return { ms: m, q: this.quality }; }
    // a still photo of the loaded level's tank interior (the home screen's level card): own camera, drawn through the shared context
    tankShot(cv) { const e = this.e; if (!e || !MAIN_R) return false;
      this.update(0.016, performance.now()); this.update(0.016, performance.now() + 16); // place everything, settle sand/sprites
      const cam = new THREE.PerspectiveCamera(26, cv.width / cv.height, 0.5, 200), fov = cam.fov * Math.PI / 180;
      const x0 = 0.5, x1 = e.w - 1.5, yT = -0.5, yB = -(e.h - 1.5), cx = (x0 + x1) / 2, cy = (yT + yB) / 2, hw = (x1 - x0) / 2 * 1.04, hh = (yT - yB) / 2 * 1.04;
      const d = Math.max(hh / Math.tan(fov / 2), hw / Math.tan(fov / 2) / cam.aspect); // the whole tank inside the card (diver, pearls and gate all visible); the reef fills any spare room
      cam.position.set(cx, cy + d * 0.08, d); cam.lookAt(cx, cy, 0); cam.updateMatrixWorld();
      const sd = new SharedDraw(cv, 1.5); try { sd.render(this.scene, cam); } finally { sd.dispose(); } return true; }
    // arriving from the tunnel: the pipe's mouth pushes up out of the sand in the tank's bottom-left corner, the diver pops out and arcs
    // to his start cell, then the pipe sinks away. Visual only (the engine already has the diver on his cell); his first move ends it.
    arrive(kind = 'pipe') { const e = this.e; if (!e || !e.player) return; this.arriveStop(); const w = e.menu || e.cine ? 0 : worldOf(e.name);
      if (kind !== 'pipe') { const sx = e.player.x, sy = -e.player.y; let bub = null; // the other ways in: drop from above, a whirl of bubbles, a bubble that floats down and pops
        if (kind === 'bubble') { bub = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 20), MAT.airShell || new THREE.MeshPhysicalMaterial({ color: 0xdffcff, transparent: true, opacity: 0.3, roughness: 0.05, iridescence: 1 })); bub.position.set(sx, sy + 2, 0.3); this.levelGroup.add(bub); }
        this.arr = { t: 0, kind, sx, sy, bub, puff: false, pop: false }; return; }
      const p = makePipe(w, 0.36, 1.2, false), dir = new V3(0.5, 0.84, 0.2).normalize(); p.quaternion.setFromUnitVectors(new V3(0, 0, 1), dir);
      let cx = 1, cy = e.h - 2; { let best = -1e9; for (let y = 1; y < e.h - 1; y++) for (let x = 1; x < e.w - 1; x++) { // the lowest open floor cell toward the bottom-left
        const t0 = e.get(x, y), tb = e.get(x, y + 1); if ((t0 !== T.EMPTY && t0 !== T.PLAYER) || tb === T.EMPTY || tb === T.PLAYER) continue; const sc = y * 3 - x * 2; if (sc > best) { best = sc; cx = x; cy = y; } } }
      const base = new V3(cx - 0.05, -cy - 0.5 + 0.24, 0.05); p.position.copy(base); p.scale.setScalar(0.001); this.levelGroup.add(p);
      this.arr = { t: 0, p, base, dir, mouth: base.clone().addScaledVector(dir, 0.12), puff: false, pop: false }; }
    arriveStop() { const A = this.arr; if (!A) return; if (A.p) { this.levelGroup.remove(A.p); A.p.traverse(o => { if (o.geometry) o.geometry.dispose(); }); A.p.userData.pipe.mats.forEach(m => m.dispose()); } if (A.bub) { this.levelGroup.remove(A.bub); A.bub.geometry.dispose(); } this.arr = null;
      for (const ent of this.entities.values()) if (ent.o.t === T.PLAYER) ent.m.visible = true; }
    tickArrive(dt) { const A = this.arr; if (!A) return; const e = this.e, pl = e && e.player; if (pl && (pl.x !== pl.px || pl.y !== pl.py) && A.t < 1.35) A.t = 1.35; // a move ends the pop-out
      if (A.kind !== 'pipe') { A.t += dt; const t = A.t, sm = k => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); }; let ent = null; for (const en of this.entities.values()) if (en.o.t === T.PLAYER) ent = en;
        const m = ent && ent.m, end = A.kind === 'drop' ? 1.3 : A.kind === 'swirl' ? 1.4 : 1.6;
        if (m) { const to = m.position.clone();
          if (A.kind === 'drop') { const k = sm(t / 1.0); m.position.set(to.x, to.y + (1 - k) * 3.2 + Math.sin(k * Math.PI) * 0.15, to.z); m.rotation.z = (1 - k) * 0.4; if (Math.random() < 0.6 && t < 1) this.particles.bubbles(m.position.x, m.position.y + 0.3, 0.3, 1, 0.06, 0.15);
            if (t >= 1.0 && !A.puff) { A.puff = true; this.particles.emit(to.x, to.y - 0.4, 0.3, 18, { color: new THREE.Color(1, 0.86, 0.55), speed: 1.4, life: 0.7, size: 0.14, spread: 0.3 }); this.sfx('land'); } }
          else if (A.kind === 'swirl') { const k = sm((t - 0.35) / 0.8); m.visible = t > 0.35; m.scale.multiplyScalar(Math.max(0.05, k)); m.rotation.y += (1 - k) * 8; if (t < 1.1) for (let i = 0; i < 2; i++) { const a = t * 14 + i * Math.PI, r = 0.7 * (1 - t / 1.2); this.particles.bubbles(A.sx + Math.cos(a) * r, A.sy - 0.4 + t * 0.9, 0.3 + Math.sin(a) * r * 0.4, 1, 0.05, 0.05); }
            if (!A.pop && t > 0.35) { A.pop = true; this.sfx('bubble'); } }
          else if (A.kind === 'bubble') { const k = sm(t / 1.15); m.position.y = to.y + (1 - k) * 2.2 + Math.sin(t * 5) * 0.04 * (1 - k); if (A.bub) { A.bub.position.set(to.x, m.position.y + 0.05, 0.3); A.bub.scale.setScalar(1 + Math.sin(t * 9) * 0.03); A.bub.visible = t < 1.25; }
            if (t >= 1.25 && !A.pop) { A.pop = true; this.particles.bubbles(to.x, to.y + 0.1, 0.4, 16, 0.08, 0.4); this.particles.emit(to.x, to.y + 0.1, 0.5, 14, { color: new THREE.Color(0.75, 0.97, 1), speed: 1.6, life: 0.5, size: 0.12, spread: 0.3 }); this.sfx('bubble'); } } }
        if (t > end) { if (m) { m.rotation.z = 0; m.visible = true; } this.arriveStop(); } return; }
      A.t += dt; const t = A.t, sm = k => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); }, back = k => { k = Math.min(1, Math.max(0, k)); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
      const rise = t < 0.5 ? back(t / 0.5) : t < 2.3 ? 1 : 1 - sm((t - 2.3) / 0.5); A.p.scale.setScalar(Math.max(0.001, rise)); A.p.position.copy(A.base).addScaledVector(A.dir, -0.3 * (1 - Math.min(1, rise)));
      pipeTick(A.p, this.time);
      if (!A.puff) { A.puff = true; this.particles.emit(A.base.x, A.base.y + 0.1, 0.3, 26, { color: new THREE.Color(1, 0.86, 0.55), speed: 1.6, life: 0.8, size: 0.16, spread: 0.35 }); this.particles.bubbles(A.base.x, A.base.y + 0.2, 0.3, 8, 0.08, 0.3); }
      let ent = null; for (const en of this.entities.values()) if (en.o.t === T.PLAYER) ent = en;
      if (ent) { const m = ent.m; if (t < 0.5) m.visible = false;
        else if (t < 1.35) { m.visible = true; if (!A.pop) { A.pop = true; this.particles.bubbles(A.mouth.x, A.mouth.y + 0.2, 0.3, 14, 0.1, 0.25); this.sfx('bubble'); }
          const k = (t - 0.5) / 0.85, s = sm(k), to = m.position.clone(); m.position.lerpVectors(A.mouth, to, s); m.position.y += Math.sin(Math.min(1, k) * Math.PI) * 0.9; m.scale.multiplyScalar(0.55 + 0.45 * sm(k * 1.6));
          m.rotation.z = (1 - s) * 0.5; }
        else { m.visible = true; m.rotation.z = 0; } }
      if (t > 2.85) this.arriveStop(); }
    setStoryMood(m) { this.mood = null; const e = this.e; if (!e || !m) return; const x0 = 0.5, x1 = e.w - 1.5, yT = -0.5, yB = -(e.h - 1.5), M = this.mood = { m, t: 0 };
      if (m.pip != null) { M.pip = makePip(0xffc23a, m.pip); M.pip.scale.setScalar(1.5); M.pip.position.set(x0 + 1, yT + 0.75, 0.45); this.levelGroup.add(M.pip); M.x0 = x0; M.x1 = x1; M.yT = yT; }
      if (m.ink) { M.ink = []; for (let i = 0; i < 9; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0x0a0614, transparent: true, opacity: 0.35, depthWrite: false })); sp.scale.setScalar(2 + (i % 3)); sp.position.set(x0 + (i / 8) * (x1 - x0), yB + 1 + (i % 4) * (yT - yB) / 4, -1.2 - (i % 3)); sp.userData.ph = i * 1.7; this.levelGroup.add(sp); M.ink.push(sp); } }
      if (m.eyes > 0) { M.eyes = []; for (let i = 0; i < 2; i++) { const g = new THREE.Group(); for (const sx of [-0.35, 0.35]) { const sp = glowSpr(0xff2a1a, 0.7, 0); sp.position.x = sx; g.add(sp); } const side = i ? 1 : -1; g.position.set(side < 0 ? x0 - 3.5 : x1 + 3.5, (yT + yB) / 2 + i, -7); g.userData.ph = i * 9; this.levelGroup.add(g); M.eyes.push(g); } } }
    setCond(c) { this.cond = c || null; this.condFor = this.e && this.e.name; } // tied to the level by name: photos and undo reload the scene
    pipNod() { if (this.mood && this.mood.pip) this.mood.nod = 1; }
    // a story moment inside a level: Grimtide's tail sweeps over the tank, his eyes watch from beside it (or stare in, during a cutscene),
    // the tank shakes, ink drifts by, the lights flicker; friends glow and fish stream past. Nothing touches the board.
    storyFx(kind) { const e = this.e; if (!e || this.menuMode) return; const M = this.mood || (this.mood = { m: {}, t: 0 }), x0 = 0.5, x1 = e.w - 1.5, yT = 0.6, cx = (e.w - 1) / 2, P = this.particles; M.fx = M.fx || [];
      const el = document.getElementById('sfx'), css = c => { if (!el || REDUCED_MOTION && c !== 'ink') return; el.className = ''; void el.offsetWidth; el.className = c; };
      switch (kind) {
        case 'quake': this.quakeT = 1.3; for (let i = 0; i < 36; i++) P.emit(x0 + Math.random() * (x1 - x0), yT - Math.random() * 0.3, 0.3, 1, { color: new THREE.Color(0.85, 0.72, 0.5), speed: 0.4, life: 1.4, size: 0.08, kind: 1, vy: -1.5 }); css('quake'); break;
        case 'tail': { const eel = makeEel(16, 0.75); eel.userData.setGlow(0.9); this.levelGroup.add(eel); M.fx.push({ kind, o: eel, t: 0, d: 3.2, y: yT + 1.7, x0: x0 - 6, x1: x1 + 15 }); css('shadow'); break; }
        case 'eyes': case 'stare': { const g = new THREE.Group(), big = kind === 'stare'; for (const sx of [-1, 1]) { const sp = glowSpr(0xff1a0a, big ? 3.6 : 1.5, 0); sp.position.x = sx * (big ? 1.7 : 0.85); g.add(sp); const core = glowSpr(0xffb040, big ? 1.1 : 0.42, 0); core.position.x = sp.position.x; g.add(core);
            if (big) { const sl = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending })); sl.scale.set(0.16, 0.95, 1); sl.position.set(sp.position.x, 0, 0.01); g.add(sl); } } // slit pupils make them his
          if (big) g.children.forEach(sp => { sp.material.depthTest = false; sp.renderOrder = 30; });
          g.position.set(big ? cx : (Math.random() < 0.5 ? x0 - 2.6 : x1 + 2.6), big ? -(e.h - 1) / 2 + 0.6 : yT + 1.2, big ? 2.4 : -2.5); this.levelGroup.add(g); M.fx.push({ kind, o: g, t: 0, d: big ? 4.4 : 3.6 }); css(big ? 'menace big' : 'menace'); break; }
        case 'ink': for (let i = 0; i < 16; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0x1c0f30, transparent: true, opacity: 0, depthWrite: false })), side = i % 2 ? 1 : -1;
            sp.position.set(side < 0 ? x0 - 1 - Math.random() * 2 : x1 + 1 + Math.random() * 2, yT - Math.random() * (e.h - 1), -1 - Math.random() * 2); sp.scale.setScalar(1.5 + Math.random() * 2); this.levelGroup.add(sp); M.fx.push({ kind, o: sp, t: -Math.random() * 0.8, d: 5, v: side * (0.2 + Math.random() * 0.3) }); }
          css('ink'); break;
        case 'flicker': this.flickT = 1.6; break;
        case 'glow': if (M.pip) { M.glowT = 2.2; M.nod = 1; for (let i = 0; i < 24; i++) P.emit(M.pip.position.x, M.pip.position.y, M.pip.position.z, 1, { color: new THREE.Color(1, 0.85, 0.4), speed: 1.4, life: 1, size: 0.1 }); } break;
        case 'fish': for (let i = 0; i < 10; i++) { const f = sprPlane(['fishA', 'fishB', 'fishC', 'fishE'][i % 4], 0.3 + Math.random() * 0.2, false, null); this.levelGroup.add(f); M.fx.push({ kind, o: f, t: -i * 0.14, d: 4.6, y: yT + 0.9 + Math.random() * 1.3, z: -0.5 - Math.random(), x0: x0 - 5, x1: x1 + 5 }); } break; } }
    moodTick(dt) { const M = this.mood; if (!M) return; M.t += dt; const t = M.t;
      if (M.pip) { const pp = this.playerPos, tx = pp ? Math.min(M.x1 - 0.5, Math.max(M.x0 + 0.5, pp.x - 0.9)) : M.x0 + 1; M.pip.position.x += (tx - M.pip.position.x) * Math.min(1, dt * 1.6); M.pip.position.y = M.yT + 0.75 + Math.sin(t * 2) * 0.06;
        M.nod = Math.max(0, (M.nod || 0) - dt * 0.8); M.pip.rotation.y = -0.5 + (M.nod > 0 ? Math.sin(M.nod * 12) * 0.6 : 0); M.pip.position.y += M.nod * Math.abs(Math.sin(M.nod * 9)) * 0.25; M.pip.userData.tick(t); }
      if (M.ink) M.ink.forEach(sp => { sp.position.x += Math.sin(t * 0.2 + sp.userData.ph) * dt * 0.15; sp.material.opacity = 0.22 + 0.12 * Math.sin(t * 0.5 + sp.userData.ph); });
      if (M.fx && M.fx.length) M.fx = M.fx.filter(f => { f.t += dt; const k = f.t / f.d; if (k >= 1) { this.levelGroup.remove(f.o); if (f.o.isSprite) f.o.material.dispose(); return false; } if (f.t < 0) return true;
        if (f.kind === 'tail') { const hx = f.x0 + (f.x1 - f.x0) * sm01(k); f.o.userData.pose((u, tt) => new V3(hx - u * 9, f.y + Math.sin(u * 7 - tt * 5) * 0.45, -0.8 - Math.cos(u * 4) * 0.4), this.time); }
        else if (f.kind === 'eyes' || f.kind === 'stare') { const a = sm01(k / 0.15) * (1 - sm01((k - 0.8) / 0.2)), blink = Math.abs(Math.sin(f.t * 1.7 + 1)) < 0.08 ? 0.1 : 1; f.o.children.forEach(sp => { sp.material.opacity = a * blink * 0.95; }); }
        else if (f.kind === 'ink') { f.o.position.x += f.v * dt; f.o.material.opacity = 0.5 * sm01(k / 0.2) * (1 - sm01((k - 0.6) / 0.4)); f.o.scale.multiplyScalar(1 + dt * 0.08); }
        else if (f.kind === 'fish') { f.o.position.set(f.x0 + (f.x1 - f.x0) * k, f.y + Math.sin(f.t * 3) * 0.08, f.z); f.o.scale.x = -1; }
        return true; });
      if (this.quakeT > 0) { this.quakeT -= dt; this.shake = Math.max(this.shake, 0.32); } if (this.flickT > 0) this.flickT -= dt;
      if (M.glowT > 0) { M.glowT -= dt; if (M.pip && M.pip.userData.setGlow) M.pip.userData.setGlow(Math.min(1, (M.m.pip || 0.3) + M.glowT)); }
      if (M.eyes) M.eyes.forEach(g => { const c = (t + g.userData.ph) % 16, k = c > 10 && c < 14 ? Math.sin((c - 10) / 4 * Math.PI) : 0, blink = Math.abs(Math.sin((c - 12) * 3)) < 0.15 ? 0.2 : 1; g.children.forEach(sp => { sp.material.opacity = k * blink * M.m.eyes; }); }); }
    storyStart(o) { this.storyStop(); this.story = new Story(this, o); this.story.update(0); }
    storyStop() { if (!this.story) return; this.story.dispose(); this.story = null; }
    render() { if (this.story) { this.story.render(this.post); return; }
      // phones: refresh the shadow map every other frame (the key light and tank never move; bobbing at 30 Hz is indistinguishable)
      const sm = this.renderer.shadowMap; if (isMobile && sm.enabled) { sm.autoUpdate = false; this.frameN = (this.frameN || 0) + 1; if (this.frameN % 2 === 0 || this.shadowDirty) { sm.needsUpdate = true; this.shadowDirty = false; } }
      this.post.render(this.scene, this.camera, this.time); }
  }
  // resolves once every image the scenes use is decoded (the loading screen waits on it), reporting progress 0..1
  function ready(onProgress) { const ims = [...Object.values(SPR.img), ...new Set(PHOTO_W)]; let done = 0;
    return Promise.all(ims.map(im => (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).then(() => { done++; if (onProgress) onProgress(done / ims.length); }))); }
  // small 3D icons for menus (How to play): the real stone and a block of the real sand, drawn through the shared context
  function iconShot(kind, px = 160) { if (!MAIN_R) return null; const cv = document.createElement('canvas'); cv.width = cv.height = px;
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(28, 1, 0.1, 20); cam.position.set(0.55, 0.75, 2.6); cam.lookAt(0, 0, 0);
    sc.add(new THREE.HemisphereLight(0xe6f6ff, 0x3a3020, 1.6)); const k = new THREE.DirectionalLight(0xfff1dc, 3); k.position.set(-2, 3, 3); sc.add(k); const r = new THREE.DirectionalLight(0x8fe4ff, 1.4); r.position.set(3, 1, -2); sc.add(r);
    let obj, own = false; if (kind === 'stone') { obj = makeBoulder(); obj.scale.setScalar(1.25); obj.rotation.set(0.3, 0.6, 0.1); }
    else if (kind === 'pearl') { obj = makeBall(true); obj.scale.setScalar(1.3); }
    else if (kind === 'fish' || kind === 'jelly' || kind === 'crab') { obj = kind === 'fish' ? makeFish() : kind === 'jelly' ? makeJelly() : makeCrab(); own = true;
      const bb = new THREE.Box3().setFromObject(obj), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3()), k = 1.05 / Math.max(sz.x, sz.y, 0.01);
      const g = new THREE.Group(); obj.position.sub(c); g.add(obj); g.scale.setScalar(k); g.rotation.set(0.15, kind === 'crab' ? -0.35 : -0.55, 0); obj = g; }
    else if (kind === 'air') { obj = makeAir(); obj.scale.setScalar(1.2); }
    else { const s = 0.38, rr = 0.1, sh = new THREE.Shape(); sh.moveTo(-s + rr, -s); sh.lineTo(s - rr, -s); sh.quadraticCurveTo(s, -s, s, -s + rr); sh.lineTo(s, s - rr); sh.quadraticCurveTo(s, s, s - rr, s); sh.lineTo(-s + rr, s); sh.quadraticCurveTo(-s, s, -s, s - rr); sh.lineTo(-s, -s + rr); sh.quadraticCurveTo(-s, -s, -s + rr, -s);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 6 }); g.center();
      const t = sprTex('sand').clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4);
      obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, color: 0xffd08a, roughness: 0.95 })); obj.rotation.set(0.25, -0.5, 0); obj.scale.setScalar(1.15); }
    sc.add(obj); const sd = new SharedDraw(cv, 2); try { sd.render(sc, cam); } finally { sd.dispose(); } const url = cv.toDataURL('image/png');
    if (kind === 'sand') obj.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map.dispose(); o.material.dispose(); } }); return url; }
  return { create: c => new WorldImpl(c), CHAPTERS, PROLOGUE, STORY_WHO, isMobile, iconShot, isIOS, dailyWorld: (name, w) => DAILY_WORLD.set(name, w), setColorMarks: on => { CB.on = !!on; if (MAT.cbMark) MAT.cbMark.visible = CB.on; }, ready, SKINS, SKIN, applySkin, preview: (cv, thumb) => new SkinPreview(cv, thumb), trailColor, rarityOf };
})();

window.__T = T;
// Deep Current — game flow, UI, input, saves. Expects globals: THREE, Engine, T, LEVELS, World, Audio.
/* global Engine, T, LEVELS, World, Audio */
(() => {
  const $ = s => document.querySelector(s);
  // ---- the owner's UI art (src/assets/images/ui, compressed WebPs): each image becomes a CSS variable --ui-<key>, line icons
  // become recolourable masks and the home tiles get their 3D objects. Without the art the old CSS/SVG look stays.
  const UI = (window.AQ_DATA && AQ_DATA.UI) || null;
  function uiIcon(el, key) { if (!el || !UI || !UI[key]) return; const i = document.createElement('i'); i.className = 'ico'; i.style.setProperty('--ico', `var(--ui-${key})`); el.replaceWith(i); return i; }
  function uiImg(el, key, cls) { if (!el || !UI || !UI[key]) return; const im = new Image(); im.src = UI[key]; im.alt = ''; im.className = cls || 'ico3d'; im.draggable = false; el.replaceWith(im); return im; }
  (function applyUiArt() { if (!UI) return; const R = document.documentElement.style; for (const k in UI) R.setProperty('--ui-' + k, `url("${UI[k]}")`); if (window.AQ_DATA.PHOTO_BG_URI) R.setProperty('--bgphoto', `url("${AQ_DATA.PHOTO_BG_URI}")`); document.body.classList.add('ui-art');
    const q = (sel, key) => document.querySelectorAll(sel).forEach(el => uiIcon(el, key));
    q('#btnPause svg', 'i_pause'); q('#btnUndo svg', 'i_undo'); q('#btnRestartHud svg', 'i_restart'); q('#btnMap svg', 'i_map'); q('.back svg', 'i_back');
    q('#btnRestart svg', 'i_restart'); q('#btnRetry svg', 'i_restart'); q('#btnResLevels svg', 'i_map'); q('#btnResHome svg', 'i_home'); q('#btnQuit svg', 'i_home'); q('#btnEndHome svg', 'i_home');
    q('#btnEndIntro svg', 'i_play'); q('#btnWatch svg', 'i_play'); q('#btnShare svg', 'i_share'); q('#btnSound svg', 'i_sound'); q('.hm-sq svg', 'i_settings');
    uiImg(document.querySelector('#btnHint svg'), 'bulb', 'ico3d hint3d'); uiImg(document.querySelector('#btnPauseHint svg'), 'bulb', 'ico3d tile3d');
    [['.c-shop', 'bag'], ['.c-rank', 'trophy'], ['.c-gift', 'gift'], ['.c-lvl', 'scroll'], ['.c-how', 'i_question'], ['.c-intro', 'i_play']].forEach(([c, k]) => document.querySelectorAll(c + ' .ic svg').forEach(el => uiImg(el, k, 'ico3d' + (k.startsWith('i_') ? ' flat' : ''))));

    const hand = document.querySelector('#coachHand .ch-finger'); if (hand) uiImg(hand, 'hand', 'ch-finger');
    const dd = document.querySelector('.hm-daily .dd-ic'); if (dd) { dd.textContent = ''; dd.classList.add('art'); }
    document.querySelectorAll('.ld-title, .gs-title, .hm-title, .cine-title .title').forEach(t => { t.classList.add('logo-art'); t.setAttribute('aria-label', 'Aqua Energizer'); });
  })();
  const canvas = $('#c');
  const world = World.create(canvas); window.__dc = { world, aud: Audio, talk: k => { beatSeen.delete((levelIdx + 1) + ':' + k); beat(k); }, cut: () => { const n = levelIdx + 1, B = (LEVEL_BEATS[n] || []).find(b => b.on === 's'); if (B) { beatSeen.delete(n + ':s'); storyCut(B, n); } }, death: () => deathLine(), qte: (k, key) => world.story && world.story.qteIn(k, key), watch: (n) => watchChapter(n), story: () => ({ on: storyOn, shown: resultShown, t: world.story ? world.story.t : -1 }), card: (i) => startLevel(i), get engine() { return engine; }, get save() { return save; }, get state() { return state; }, startCustom: (lv) => { startLevel(0, lv); beginPlay(); }, startIndex: (i) => { skipTut = true; try { startLevel(i); beginPlay(); } finally { skipTut = false; } }, plan: (cb) => planFrom(engine, coachRefs(), COACH.route, cb), planCheck: (plan) => plSim(engine, plan).won, doomed: () => doomed(engine), relic: (i) => relicCell(i), run: () => RUN, tick: () => { engine.step(); tickWorld(engine, performance.now()); dangerScan(); }, danger: () => { dangerScan(); return world.lastDanger; }, undo: () => undo(), tut: (i) => { if (save.tutSeen) delete save.tutSeen[i]; startLevel(i); beginPlay(); }, go: (id) => { if (booting) { dropLoader(); showMenuScene(); } go(id); }, frame: (now) => frame(now), World, intro: () => { if (booting) { dropLoader(); showMenuScene(); } startCine(); } };
  world.onSfx = n => Audio.play(n); world.onToast = m => toast(m);
  let gateOpenAt = 0, gateNudged = true;
  world.onGateOpen = () => { if (state === 'replay' || state === 'clip') return; gateOpenAt = performance.now(); gateNudged = false; banner('The gate is awake!', 'Swim in!', 'Swim into the glowing gate to carry the light home.', 3200); };
  const isTouch = World.isMobile || navigator.maxTouchPoints > 0;
  document.body.classList.toggle('touch', isTouch);

  // ---- save ----
  const save = (() => { const d = { name: '', unlocked: 1, stars: {}, best: {}, settings: { music: true, sfx: true, dpad: false, vibe: true, quality: World.isMobile ? 'high' : 'high' } };
    try { const s = JSON.parse(localStorage.getItem('dc-save') || '{}'); Object.assign(d, s); d.settings = Object.assign({ music: true, sfx: true, dpad: false, vibe: true, quality: 'high' }, s.settings || {}); } catch {} return d; })();
  // guard against damaged saves (a null field used to stop the game from booting) and move old saves to the redesigned levels:
  // stars/best/tips from before v2 belonged to different level layouts, so they reset (coins, skins and progress are kept)
  for (const k of ['stars', 'best', 'owned', 'stats', 'ach', 'daily', 'equip', 'tipsSeen', 'relics', 'relicPaid', 'chest']) if (save[k] !== undefined && (save[k] === null || typeof save[k] !== 'object' || Array.isArray(save[k]))) delete save[k];
  save.stars = save.stars || {}; save.best = save.best || {}; if (typeof save.coins !== 'number' || !isFinite(save.coins)) save.coins = 0; save.unlocked = Math.max(1, Math.min(30, +save.unlocked || 1));
  if ((save.v || 1) < 2) { const s1 = save.stars[1], b1 = save.best[1]; save.stars = s1 ? { 1: s1 } : {}; save.best = b1 ? { 1: b1 } : {}; save.tipsSeen = {}; save.v = 2; }
  const persist = () => { try { localStorage.setItem('dc-save', JSON.stringify(save)); } catch {} };
  const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);
  let hapEl = null, hapLast = 0;
  function iosTap() { try { if (!hapEl) { hapEl = document.createElement('label'); hapEl.setAttribute('aria-hidden', 'true'); hapEl.style.cssText = 'position:fixed;left:-300px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none';
      const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1; hapEl.appendChild(i); document.body.appendChild(hapEl); } hapEl.click(); } catch (er) {} }
  const buzz = ms => { if (!save.settings.vibe) return; if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (er) {} return; }
    if (World.isIOS) { const now = performance.now(); if (now - hapLast < 70) return; hapLast = now; const n = Array.isArray(ms) ? Math.min(3, Math.ceil(ms.length / 2)) : 1; for (let k = 0; k < n; k++) setTimeout(iosTap, k * 120); } };
  const click = () => Audio.play('click');

  // ================= economy: coins, skins, daily treasure, achievements =================
  save.coins = save.coins || 0; save.owned = save.owned || {}; save.equip = Object.assign({ suit: 'violet', scarf: 'pink', hat: 'none', trail: 'bubbles', pearl: 'ruby' }, save.equip || {});
  save.stats = Object.assign({ dug: 0, treasures: 0, pearls: 0, wins: 0, perfect: 0 }, save.stats || {}); save.ach = save.ach || {}; save.daily = save.daily || { last: '', streak: 0 };
  const owns = (cat, id) => { const it = World.SKINS[cat].find(x => x.id === id); return (it && it.price === 0 && !it.vip) || !!save.owned[cat + ':' + id]; };
  World.applySkin(save.equip);
  const coinEls = () => document.querySelectorAll('.coinCount, #hmCoins');
  function syncCoins() { coinEls().forEach(el => { el.textContent = save.coins.toLocaleString(); }); }
  function addCoins(n, why) { if (!n) return; save.coins += n; persist(); syncCoins(); Audio.play('treasure');
    const t = document.createElement('div'); t.className = 'toast-coin'; t.innerHTML = '<i class="coin"></i>'; const b = document.createElement('b'); b.textContent = `+${n}` + (why ? `  ${why}` : ''); t.appendChild(b); document.body.appendChild(t); setTimeout(() => t.remove(), 1700); }
  world.onStat = (k, id) => { if (replay || CLIP) return; if (k === 'treasure') { if (id && runTreasureSet.has(id)) return; if (id) runTreasureSet.add(id); runTreasures++; save.stats.treasures++; weekBump('treasure'); } else if (k === 'pearl') { save.stats.pearls++; weekBump('pearls'); } };
  let runTreasures = 0; const runTreasureSet = new Set(); // a treasure re-dug after an undo doesn't count twice
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  // login streak: it keeps growing (coins rise each week of the streak) and every 7th day holds a guaranteed rare item
  const DAILY = [50, 80, 120, 160, 220, 300, 400];
  const dailyCoins = d => Math.round(DAILY[d % 7] * (1 + 0.25 * Math.min(4, Math.floor(d / 7))) / 5) * 5; // d = 0-based day of the streak
  function dailyState() { const today = dayKey(), y = new Date(); y.setDate(y.getDate() - 1); const D = save.daily;
    const can = D.last !== today, streak = D.last === today ? D.streak : D.last === dayKey(y) ? D.streak : 0; return { can, streak, day: can ? streak : Math.max(0, streak - 1) }; } // day = today's 0-based streak day
  // a random item of the given rarity band the player doesn't own yet (null if they own them all)
  function giftItem(minR, maxR) { const pool = []; for (const cat of Object.keys(World.SKINS)) for (const it of World.SKINS[cat]) if (!it.vip && it.price >= minR && it.price < maxR && !owns(cat, it.id)) pool.push([cat, it]);
    return pool.length ? pool[Math.random() * pool.length | 0] : null; }
  function grantItem(g, why) { const [cat, it] = g; save.owned[cat + ':' + it.id] = true; persist(); Audio.play('absorb'); buzz([20, 40, 20, 40, 60]);
    const nm = { suit: 'suit', hat: 'hat', scarf: 'scarf', trail: 'trail', pearl: 'pearl skin' }[cat] || cat; toast(`🎁 ${why}: ${it.name} (${World.rarityOf(it)} ${nm})!`); }
  const ACH = [
    { id: 'first', ic: '🏁', name: 'First dive', desc: 'Clear your first level', goal: 1, v: () => Math.max(save.stats.wins, Object.keys(save.stars).length), r: 50 },
    { id: 'wins10', ic: '🌊', name: 'Deep diver', desc: 'Clear 10 levels', goal: 10, v: () => Object.keys(save.stars).length, r: 200 },
    { id: 'stars10', ic: '⭐', name: 'Star collector', desc: 'Collect 10 stars', goal: 10, v: () => totalStars(), r: 120 },
    { id: 'stars45', ic: '🌟', name: 'Star hoarder', desc: 'Collect 45 stars', goal: 45, v: () => totalStars(), r: 400 },
    { id: 'perfect', ic: '💎', name: 'Flawless', desc: 'Get 3 stars on a level', goal: 1, v: () => Object.values(save.stars).filter(x => x >= 3).length, r: 80 },
    { id: 'perfect5', ic: '👑', name: 'Perfectionist', desc: 'Get 3 stars on 5 levels', goal: 5, v: () => Object.values(save.stars).filter(x => x >= 3).length, r: 250 },
    { id: 'dig', ic: '⛏️', name: 'Sand shoveler', desc: 'Dig through 300 sand blocks', goal: 300, v: () => save.stats.dug, r: 120 },
    { id: 'treasure', ic: '🐚', name: 'Treasure hunter', desc: 'Dig out 40 treasures', goal: 40, v: () => save.stats.treasures, r: 150 },
    { id: 'pearls', ic: '🔴', name: 'Pearl pusher', desc: 'Deliver 30 pearls', goal: 30, v: () => save.stats.pearls, r: 150 },
    { id: 'world1', ic: '🏝️', name: 'Sunlit Shallows', desc: 'Clear all of world 1', goal: 10, v: () => [...Array(10).keys()].filter(i => save.stars[i + 1]).length, r: 500 },
    { id: 'shopper', ic: '🛍️', name: 'Fresh look', desc: 'Buy something in the shop', goal: 1, v: () => Object.keys(save.owned).length, r: 60 },
  ];
  const claimableCount = () => ACH.filter(a => !save.ach[a.id] && a.v() >= a.goal).length + (dailyState().can ? 1 : 0) + weekly().filter(c => !save.weekly.c[c.id] && (save.weekly.p[c.id] || 0) >= c.goal).length;
  function buildRewards() {
    const ds = dailyState(), el = $('#daily'); el.innerHTML = ''; const w0 = Math.floor(ds.day / 7) * 7;
    { const sn = $('#streakN'); sn.textContent = ds.can ? `Day ${ds.day + 1} ready` : `🔥 ${ds.streak}-day streak`; sn.classList.toggle('ready', ds.can); }
    for (let i = w0; i < w0 + 7; i++) { const d = document.createElement('div'); d.className = 'day' + (i % 7 === 6 ? ' big gift' : '') + (i < ds.day || (!ds.can && i === ds.day) ? ' done' : '') + (ds.can && i === ds.day ? ' today' : '');
      d.innerHTML = i % 7 === 6 ? `<span>Day ${i + 1}</span><i class="gift-ic">🎁</i><b>Rare</b>` : `<span>Day ${i + 1}</span><i class="coin"></i><b>${dailyCoins(i)}</b>`; el.appendChild(d); }
    const btn = $('#dailyClaim'); btn.disabled = !ds.can; btn.textContent = ds.can ? (ds.day % 7 === 6 ? 'Open the chest 🎁' : `Claim ${dailyCoins(ds.day)} coins`) : 'Come back tomorrow';
    buildWeekly();
    { const c = chestState(); $('#rwChestN').textContent = `${c.n}/${CHEST_N}`; $('#rwChestF').style.width = (c.n / CHEST_N * 100) + '%'; const left = 3 - c.o % 3;
      $('#rwChestS').textContent = `Earn ${CHEST_N - c.n} more new star${CHEST_N - c.n > 1 ? 's' : ''} to open it: 75 coins` + (left === 1 ? ', and this one holds a rare item!' : ` · a rare item in ${left} chests`); }
    const ul = $('#achList'); ul.innerHTML = '';
    ACH.slice().sort((a, b) => (!!save.ach[a.id] - !!save.ach[b.id]) || ((b.v() >= b.goal) - (a.v() >= a.goal))).forEach(a => { const v = Math.min(a.goal, a.v()), done = !!save.ach[a.id], ready = !done && v >= a.goal;
      const li = document.createElement('li'); li.className = done ? 'done' : '';
      li.innerHTML = `<span class="ai">${a.ic}</span><span class="at"><b></b><small></small><div class="bar"><i style="width:${(v / a.goal * 100).toFixed(0)}%"></i></div></span><button class="claim" ${ready ? '' : 'disabled'}><i class="coin"></i>${done ? '✓' : a.r}</button>`;
      li.querySelector('b').textContent = a.name; li.querySelector('small').textContent = `${a.desc} · ${v}/${a.goal}`;
      li.querySelector('.claim').onclick = () => { if (!ready) return; save.ach[a.id] = true; addCoins(a.r, a.name); buzz(20); buildRewards(); refreshHome(); };
      ul.appendChild(li); });
    syncCoins();
  }
  $('#dailyClaim').onclick = () => { const ds = dailyState(); if (!ds.can) return; save.daily = { last: dayKey(), streak: ds.day + 1 }; addCoins(dailyCoins(ds.day), `Day ${ds.day + 1}`); buzz(25);
    if (ds.day % 7 === 6) { const g = giftItem(300, 600) || giftItem(600, 1200) || giftItem(0, 1e9); if (g) grantItem(g, `Day ${ds.day + 1} chest`); else addCoins(500, 'Chest'); }
    buildRewards(); refreshHome(); };
  // ---- weekly challenges: three goals a week (same for everyone, picked from the week number); all three = a guaranteed epic item
  const WEEK_POOL = [
    { id: 'noundo', ic: '🎯', name: 'Clean dives', desc: 'Finish 3 levels without undo', goal: 3, r: 150 },
    { id: 'treasure', ic: '🐚', name: 'Beachcomber', desc: 'Dig out 20 treasures', goal: 20, r: 120 },
    { id: 'pearls', ic: '🔴', name: 'Pearl courier', desc: 'Deliver 15 pearls', goal: 15, r: 120 },
    { id: 'stars', ic: '⭐', name: 'Starry week', desc: 'Earn 9 stars (replays count)', goal: 9, r: 150 },
    { id: 'perfect', ic: '💎', name: 'Flawless twice', desc: 'Get ★★★ on 2 levels', goal: 2, r: 180 },
    { id: 'nohint', ic: '🧠', name: 'Own wits', desc: 'Win 3 levels without a hint', goal: 3, r: 120 },
    { id: 'dig', ic: '⛏️', name: 'Sand mover', desc: 'Dig through 250 sand blocks', goal: 250, r: 100 },
    { id: 'wins', ic: '🌊', name: 'Busy week', desc: 'Finish 5 levels', goal: 5, r: 120 },
    { id: 'bonk', ic: '💥', name: 'Bonk!', desc: 'Drop stones on 2 monsters', goal: 2, r: 150, need: 4 },
    { id: 'daily', ic: '📅', name: 'Daily diver', desc: 'Play 3 Daily Dives', goal: 3, r: 150 },
  ];
  const weekNo = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2024, 0, 1)) / 864e5 / 7); // weeks start on Monday
  function weekly() { const wk = weekNo(); if (!save.weekly || save.weekly.wk !== wk) save.weekly = { wk, p: {}, c: {}, bonus: 0 };
    const pool = WEEK_POOL.filter(c => !c.need || save.unlocked >= c.need), pick = []; let x = (wk * 2654435761) >>> 0; // seeded so everyone gets the same three
    while (pick.length < 3 && pool.length) { x = (x * 1103515245 + 12345) >>> 0; pick.push(pool.splice(x % pool.length, 1)[0]); } return pick; }
  function weekBump(id, n = 1) { const W = weekly(); if (!W.some(c => c.id === id)) return; const P = save.weekly.p, c = W.find(c => c.id === id), was = P[id] || 0; P[id] = Math.min(c.goal, was + n); persist();
    if (was < c.goal && P[id] >= c.goal && state !== 'menu') setTimeout(() => toast(`Weekly challenge done: ${c.name} ✓`), 1600); }
  function buildWeekly() { const W = weekly(), ul = $('#weekList'); ul.innerHTML = ''; const P = save.weekly.p, C = save.weekly.c;
    const days = 7 - ((new Date().getDay() + 6) % 7); $('#weekLeft').textContent = days === 1 ? 'Ends tonight' : `${days} days left`;
    W.forEach(c => { const v = Math.min(c.goal, P[c.id] || 0), done = !!C[c.id], ready = !done && v >= c.goal; const li = document.createElement('li'); li.className = done ? 'done' : '';
      li.innerHTML = `<span class="ai">${c.ic}</span><span class="at"><b></b><small></small><div class="bar"><i style="width:${(v / c.goal * 100).toFixed(0)}%"></i></div></span><button class="claim" ${ready ? '' : 'disabled'}><i class="coin"></i>${done ? '✓' : c.r}</button>`;
      li.querySelector('b').textContent = c.name; li.querySelector('small').textContent = `${c.desc} · ${v}/${c.goal}`;
      li.querySelector('.claim').onclick = () => { if (!ready) return; C[c.id] = 1; addCoins(c.r, c.name); buzz(20);
        if (!save.weekly.bonus && W.every(w => C[w.id])) { save.weekly.bonus = 1; persist(); const g = giftItem(600, 1200) || giftItem(300, 1e9); if (g) grantItem(g, 'Weekly prize'); else addCoins(800, 'Weekly prize'); }
        buildRewards(); refreshHome(); };
      ul.appendChild(li); });
    const done = W.filter(c => C[c.id] || (P[c.id] || 0) >= c.goal).length; $('#rwBonusN').textContent = `${done}/3`; $('#rwBonusFill').style.width = (done / 3 * 100) + '%';
    $('#weekBonus').textContent = save.weekly.bonus ? 'Claimed ✓' : done >= 3 ? 'Claim all three' : 'In progress'; $('#rwBonus').classList.toggle('won', !!save.weekly.bonus); }

  // ---- shop
  const SHOP_TABS = [['suit', 'Suits'], ['hat', 'Hats'], ['scarf', 'Scarves'], ['trail', 'Trails'], ['pearl', 'Pearls']];
  let shopTab = 'suit', shopSel = null, preview = null, previewRAF = 0;
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  function swatch(cat, it) { const sw = document.createElement('span'); sw.className = 'sw';
    if (cat === 'suit') sw.style.background = it.rainbow ? 'conic-gradient(#ff3d5e, #ffd23f, #3ce05a, #00c8ff, #a46bff, #ff3d5e)' : `linear-gradient(135deg, ${hex(it.helm)} 0 50%, ${hex(it.suit)} 50% 78%, ${hex(it.fin)} 78%)`;
    else if (cat === 'hat') { sw.style.background = 'radial-gradient(circle at 40% 35%, #8fd0ff, #1f78e8)'; sw.textContent = it.emoji; }
    else if (cat === 'scarf') { sw.style.background = it.id === 'none' ? 'repeating-linear-gradient(45deg, #445566 0 6px, #2a3644 6px 12px)' : `linear-gradient(160deg, ${hex(it.col)}, ${hex(new THREE.Color(it.col).multiplyScalar(0.6).getHex())})`; }
    else if (cat === 'trail') sw.style.background = it.rainbow ? 'conic-gradient(#ff3d5e, #ffd23f, #3ce05a, #00c8ff, #a46bff, #ff3d5e)' : `radial-gradient(circle, ${hex(it.col)} 0 18%, transparent 20%) 0 0 / 22px 22px, radial-gradient(circle at 50% 50%, ${hex(it.col)}55, #0b2a66)`;
    else sw.style.background = `radial-gradient(circle at 35% 30%, #fff 0 8%, ${hex(it.glow)} 22%, ${hex(it.col)} 60%, #200)`;
    return sw; }
  function buildShop() {
    const tabs = $('#shopTabs'); tabs.innerHTML = '';
    SHOP_TABS.forEach(([k, label]) => { const b = document.createElement('button'); b.textContent = label; b.className = k === shopTab ? 'on' : ''; b.onclick = () => { click(); shopTab = k; shopSel = save.equip[k]; tryOn(); buildShop(); }; tabs.appendChild(b); });
    const grid = $('#shopGrid'); grid.innerHTML = ''; if (shopSel === null) shopSel = save.equip[shopTab];
    World.SKINS[shopTab].forEach(it => { const own = owns(shopTab, it.id), eq = save.equip[shopTab] === it.id, rar = World.rarityOf(it);
      const b = document.createElement('button'); b.className = `item r-${rar}` + (it.id === shopSel ? ' sel' : '') + (own ? '' : ' locked');
      const rib = document.createElement('span'); rib.className = 'rib'; rib.textContent = rar; b.appendChild(rib);
      const th = thumbs[shopTab + ':' + it.id]; if (th) { const im = document.createElement('img'); im.className = 'th'; im.src = th; im.alt = ''; b.appendChild(im); } else { const sw = swatch(shopTab, it); sw.classList.add('th'); b.appendChild(sw); }
      const nm = document.createElement('span'); nm.textContent = it.name; b.appendChild(nm);
      const tg = document.createElement('span'); if (eq) { tg.className = 'tag eq'; tg.textContent = 'Equipped'; } else if (own) { tg.className = 'tag'; tg.textContent = 'Owned'; } else if (it.vip) { tg.className = 'pr vip'; tg.textContent = 'Share to unlock'; } else { tg.className = 'pr'; tg.innerHTML = `<i class="coin"></i>${it.price}`; } b.appendChild(tg);
      b.onclick = () => { click(); shopSel = it.id; tryOn(); buildShop(); }; grid.appendChild(b); });
    makeThumbs(shopTab);
    const it = World.SKINS[shopTab].find(x => x.id === shopSel), own = owns(shopTab, it.id), eq = save.equip[shopTab] === it.id, act = $('#shopAct');
    $('#shop .shop-stage').dataset.rar = World.rarityOf(it); $('#shopRar').textContent = World.rarityOf(it);
    $('#shopSelName').textContent = it.name; $('#shopSelSub').textContent = eq ? 'Equipped' : own ? 'Owned · tap to wear' : it.vip ? 'Premium · one public post unlocks it' : `${it.price.toLocaleString()} coins`;
    act.className = 'cta shop-act' + (eq ? ' equipped' : own ? ' owned' : it.vip ? ' vip' : save.coins < it.price ? ' cant' : '');
    act.innerHTML = eq ? 'Equipped ✓' : own ? 'Wear it' : it.vip ? 'Share to unlock' : `<i class="coin"></i> Buy ${it.price.toLocaleString()}`;
    act.onclick = () => { if (eq) return; if (!own && it.vip) { click(); SHARE.target = it.id; shareGame(); return; }
      if (!own) { if (save.coins < it.price) { toast(`Need ${(it.price - save.coins).toLocaleString()} more coins: try Rewards or replay a level`); return; } save.coins -= it.price; save.owned[shopTab + ':' + it.id] = true; Audio.play('absorb'); buzz(30); }
      save.equip[shopTab] = it.id; persist(); World.applySkin(save.equip); syncCoins(); buildShop(); refreshHome(); };
    syncCoins(); }
  // after boot, render the shop pictures a category at a time while the player sits on the home screen, so the shop opens fully drawn
  function idleThumbs() { if (window.__freeze || thumbBusy || state !== 'menu' && state !== 'splash') return; const cat = SHOP_TABS.map(t => t[0]).find(c => World.SKINS[c].some(it => !thumbs[c + ':' + it.id])); if (cat) setTimeout(() => { if (!thumbBusy && $('#home').classList.contains('on')) makeThumbs(cat); else setTimeout(idleThumbs, 3000); }, 1500); }
  function tryOn() { World.applySkin(Object.assign({}, save.equip, { [shopTab]: shopSel })); if (preview) preview.frame(shopTab === 'trail' ? 'trail' : 'full'); }
  // card pictures: each item rendered in 3D once (diver wearing it / its trail / the pearl), cached for the session
  const thumbs = {}; let thumbR = null, thumbBusy = false;
  function makeThumbs(cat) { if (thumbBusy) return; const todo = World.SKINS[cat].filter(it => !thumbs[cat + ':' + it.id]); if (!todo.length) return;
    try { if (!thumbR) { const cv = document.createElement('canvas'); cv.width = cv.height = 220; thumbR = World.preview(cv, true); } } catch (er) { return; }
    thumbBusy = true; const mode = cat === 'hat' ? 'head' : cat === 'trail' ? 'trailCard' : cat === 'pearl' ? 'pearl' : 'card';
    const step = () => { const it = todo.shift(); if (!it) { thumbBusy = false; tryOn(); if ($('#shop').classList.contains('on')) buildShop(); else idleThumbs(); return; } // also starts the tab the player moved to meanwhile
      World.applySkin(Object.assign({}, save.equip, { [cat]: it.id })); thumbs[cat + ':' + it.id] = thumbR.shot(mode); tryOn(); setTimeout(step, 0); }; // restore right away so the live preview never shows a card's skin
    step(); }
  function openShop() { shopSel = save.equip[shopTab]; buildShop();
    if (!preview) try { preview = World.preview($('#shopPreview')); } catch (er) { preview = null; }
    cancelAnimationFrame(previewRAF); const t0 = performance.now(); const loop = (now) => { if (!$('#shop').classList.contains('on')) { World.applySkin(save.equip); return; } if (preview) preview.render((now - t0) / 1000); previewRAF = requestAnimationFrame(loop); }; previewRAF = requestAnimationFrame(loop); }

  // ---- leaderboard (claude.ai artifact: shared db, one doc per player under their own id; elsewhere: your own records only)
  const LB = { db: null, user: null, uid: null, unsub: null, ready: null, rows: [] };
  LB.ready = (async () => { try { const C = window.claude; if (!C || !C.use) return; const [db, user] = await Promise.all([C.use('db'), C.use('user')]); LB.db = db; LB.user = user; LB.uid = user ? await user.id() : null; } catch (er) {} })();
  const myEntry = () => ({ nick: (save.name || 'Diver').slice(0, 16), stars: totalStars(), levels: Object.keys(save.stars).length, score: Object.values(save.best).reduce((a, b) => a + b, 0), suit: save.equip.suit, updatedAt: Date.now() });
  let lbWriting = Promise.resolve(), lbLast = '';
  function pushScore() { lbWriting = lbWriting.then(async () => { await LB.ready; if (!LB.db || !LB.uid) return; const e = myEntry(), k = [e.nick, e.stars, e.levels, e.score, e.suit].join('|'); if (k === lbLast) return;
      try { await LB.db.doc('board/' + LB.uid).set(e); lbLast = k; } catch (er) { if (er && er.code === 'invalid_argument') LB.readOnly = true; } }); }
  let lbTab = 'stars';
  document.querySelectorAll('#lbTabs button').forEach(b => b.onclick = () => { click(); openRanks(b.dataset.t); });
  let lbTok = 0;
  async function openRanks(tab) { if (tab) lbTab = tab; const tok = ++lbTok; document.querySelectorAll('#lbTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === lbTab));
    const st = $('#lbStatus'), list = $('#lbList'), me = $('#lbMe'); st.textContent = 'Loading…'; list.innerHTML = ''; me.innerHTML = '';
    if (lbTab !== 'stars') return openDailyRanks(tok);
    await LB.ready; if (tok !== lbTok) return;
    if (!LB.db) { st.textContent = 'Online ranks aren\'t available here. Your best so far:'; await renderRows([Object.assign(myEntry(), { id: 'me', isMe: true })]); lbEmpty(); return; }
    pushScore(); if (LB.unsub) LB.unsub();
    LB.unsub = LB.db.collection('board').orderBy('stars', 'desc').limit(100).onSnapshot(async snap => { if (tok !== lbTok) return;
      const rows = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.stars - a.stars) || (b.levels - a.levels) || (b.score - a.score));
      st.textContent = (rows.length ? `${rows.length} diver${rows.length === 1 ? '' : 's'} · live` : 'No scores yet: clear a level to be first!') + (LB.readOnly ? ' (Viewing only: open your own copy of the game to post your score.)' : ''); await renderRows(rows); },
      er => { st.textContent = 'Leaderboard is offline right now. Your own best:'; renderRows([Object.assign(myEntry(), { id: 'me', isMe: true })]); });
  }
  function lbEmpty() { const li = document.createElement('li'); li.className = 'lb-empty'; li.innerHTML = '<i class="lbe-art" aria-hidden="true"></i><b>Every star counts</b><span>Wake gates, earn stars and find relics. Your rank grows with every dive.</span>'; $('#lbList').appendChild(li); }
  async function openDailyRanks(tok) { const st = $('#lbStatus'), D = ddSave(), L = todayDive(), by = lbTab === 'air' ? 'air' : 't';
    const mine = () => D.best ? [{ id: 'me', isMe: true, nick: save.name || 'Diver', t: D.best.t, air: D.best.air }] : [];
    await LB.ready; if (tok !== lbTok) return; if (LB.unsub) { LB.unsub(); LB.unsub = null; }
    const head = L ? `${L.name} · ` : '';
    if (!LB.db) { st.textContent = head + (D.best ? 'Online ranks aren\'t available here. Your best today:' : 'Play today\'s Daily Dive to post a time.'); renderRows(mine(), by); return; }
    pushDaily();
    LB.unsub = LB.db.collection('daily').where('day', '==', D.key).limit(300).onSnapshot(async snap => { if (tok !== lbTok) return;
      const rows = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(r => typeof r.t === 'number').sort((a, b) => (a[by] - b[by]) || (a.t - b.t));
      st.textContent = head + (rows.length ? `${rows.length} diver${rows.length === 1 ? '' : 's'} today · ${by === 'air' ? 'least air used' : 'fastest'}` : 'No times yet today: be the first!'); await renderRows(rows, by); },
      er => { st.textContent = 'Leaderboard is offline right now. Your best today:'; renderRows(mine(), by); }); }
  async function renderRows(rows, by) {
    const list = $('#lbList'), me = $('#lbMe'); let ps = {};
    try { if (LB.user && rows.length) ps = await LB.user.profiles(rows.map(r => r.id).filter(id => id !== 'me')); } catch (er) {}
    const row = (r, i) => { const li = document.createElement('li'); const mine = r.isMe || (LB.uid && r.id === LB.uid); li.className = 'lb-row' + (mine ? ' me' : '');
      li.classList.toggle('top', i < 3); li.dataset.rank = i + 1; const rk = document.createElement('span'); rk.className = 'rk' + (i === 0 ? ' g' : i === 1 ? ' s' : i === 2 ? ' b' : ''); rk.textContent = i < 3 ? (UI ? '' : ['🥇', '🥈', '🥉'][i]) : `${i + 1}`; li.appendChild(rk);
      const p = ps[r.id]; if (p && p.avatarUrl) { const im = document.createElement('img'); im.src = p.avatarUrl; im.alt = ''; li.appendChild(im); } else { const av = document.createElement('span'); av.className = 'av'; av.textContent = (r.nick || 'D')[0].toUpperCase(); li.appendChild(av); }
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (r.nick || (p && p.name) || 'Diver') + (mine ? ' (you)' : ''); const sm = document.createElement('small'); sm.textContent = by ? `${(+r.air).toFixed(1)} s of air used` : `${r.levels || 0} levels cleared`; nm.appendChild(sm); li.appendChild(nm);
      const sv = document.createElement('span'); sv.className = 'sv'; if (by) sv.textContent = `${(+(by === 'air' ? r.air : r.t)).toFixed(1)}s`; else { sv.innerHTML = '<i class="st">★</i>'; sv.appendChild(document.createTextNode(r.stars || 0)); } li.appendChild(sv);
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = by ? (by === 'air' ? `${(+r.t).toFixed(1)}s` : '') : (r.score ? r.score.toLocaleString() : ''); li.appendChild(sc); return li; };
    list.innerHTML = ''; me.innerHTML = '';
    if (!rows.length) { const e = document.createElement('li'); e.className = 'lb-empty'; e.textContent = 'Be the first diver on the board!'; list.appendChild(e); return; }
    rows.forEach((r, i) => list.appendChild(row(r, i)));
    if (LB.uid) { const i = rows.findIndex(r => r.id === LB.uid); if (i > 7) me.appendChild(row(rows[i], i)); }
  }

  // ---- state ----
  let quietAt = 0, quietOn = false;
  let engine = null, levelIdx = 0, state = 'splash', acc = 0, lastFrame = performance.now(), overTimer = 0, lowAirBeep = 0, resultShown = false;
  const held = new Set(); let heldOrder = [];
  let screenStack = [];
  // caustic light for the menus: one tileable 256 px canvas of soft bright Voronoi edges, used by the .caus layers
  (function causticTile() { try { const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N; const c2 = cv.getContext('2d'), im = c2.createImageData(N, N), P = [];
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 14; i++) P.push([rnd() * N, rnd() * N]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let d1 = 1e9, d2 = 1e9; for (const p of P) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const dx = x - p[0] - ox * N, dy = y - p[1] - oy * N, d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      const e = Math.sqrt(d2) - Math.sqrt(d1), v = Math.pow(Math.max(0, 1 - e / 9), 3), j = (y * N + x) * 4; im.data[j] = 190 + 65 * v; im.data[j + 1] = 240 + 15 * v; im.data[j + 2] = 255; im.data[j + 3] = 255 * v; }
    c2.putImageData(im, 0, 0); document.documentElement.style.setProperty('--caus', `url("${cv.toDataURL('image/png')}")`); } catch (er) {} })();
  // computer home: the layers drift a little with the mouse (depth); phones skip it
  { const home = $('#home'); let mx = 0, my = 0, raf = 0; if (home && !isTouch && !REDUCED_MOTION) home.addEventListener('pointermove', ev => { mx = ev.clientX / innerWidth * 2 - 1; my = ev.clientY / innerHeight * 2 - 1;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; home.style.setProperty('--mx', mx.toFixed(3)); home.style.setProperty('--my', my.toFixed(3)); }); }); }
  // ---- 3D icons for hints, intro cards and the tutorial (rendered once each, then reused as CSS variables --ic-<kind>)
  const ICON = {};
  function needIcons(kinds) { for (const k of kinds) { if (ICON[k] !== undefined) continue; let u = null; try { u = World.iconShot(k, 192); } catch (er) {} ICON[k] = u;
      if (u) document.documentElement.style.setProperty('--ic-' + k, `url("${u}")`); } }
  // hint text: **words** become highlighted
  const rich = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); shownId = id; hearing(); }
  function setState(s) { state = s; document.body.dataset.state = s; hearing(); }
  // underwater hearing: the music + ambience close in while a card covers the dive, and open again when you swim
  let shownId = '';
  function hearing() { const k = state === 'paused' ? 1 : state === 'over' && shownId === 'result' ? 0.75 : state === 'menu' && shownId && shownId !== 'home' && shownId !== 'splash' ? 0.4 : 0; if (k !== hearing.k) { hearing.k = k; Audio.muffle(k); } }
  function go(id) {
    if (id === 'home' && state !== 'menu' && state !== 'splash' && !go.inHome) { go.inHome = true; try { openHome(); } finally { go.inHome = false; } return; }
    if (id === 'back') { id = screenStack.pop() || 'home'; } else { const cur = document.querySelector('.screen.on'); if (cur && cur.id !== id && id !== 'home') screenStack.push(cur.id); if (id === 'home') screenStack = []; }
    if (id === 'shop') openShop(); if (id === 'rewards') { buildRewards(); syncVipBanner(); } if (id === 'ranks') openRanks(lbTab); else if (LB.unsub) { LB.unsub(); LB.unsub = null; }
    if (id === 'how' && !go.icons) { go.icons = 1; try { for (const k of ['stone', 'sand']) { const u = World.iconShot(k); if (u) document.querySelector('.how .ic.' + k).style.cssText = `background: url("${u}") center / 108% no-repeat !important; box-shadow: none !important; border-radius: 0 !important;`; } } catch (er) {} }
    if (id === 'journal') buildJournal(); if (id === 'profile') buildProfile(); if (id === 'settings') syncSettings(); if (id === 'home') refreshHome();
    if (id === 'name') { $('#nameInput').value = save.name || ''; setTimeout(() => $('#nameInput').focus(), 50); }
    show(id); if (id === 'home') { if (state === 'menu' || state === 'splash') homeCard(); homeLayout(); } if (id === 'levels') buildLevels();
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { click(); go(b.dataset.go); }));

  // ---- home ----
  const WORLDS = [{ name: 'Sunlit Shallows', from: 0, to: 10 }, { name: 'Coral Caves', from: 10, to: 20 }, { name: 'The Deep', from: 20, to: LEVELS.length }];
  function refreshHome() {
    const next = Math.min(save.unlocked, LEVELS.length);
    $('#playSub').textContent = save.unlocked > 1 ? `Continue · Level ${next}` : 'Play · Level 1';
    $('#playMain').textContent = save.unlocked > 1 ? 'Continue' : 'Play'; $('#playLv').textContent = `— Level ${next} —`; $('#hmCardLv').textContent = `Level ${next}`;
    $('#hmName').textContent = save.name || 'Diver'; $('#hmAva').textContent = (save.name || 'D')[0].toUpperCase(); $('#hmStars').textContent = totalStars(); $('#hmLvl').textContent = next;
    $('#hmDot').hidden = claimableCount() === 0; syncCoins(); syncDiveBtn();
  }

  let menuEngine = null;
  function showMenuScene() { if (menuKeep) { menuKeep = false; return; } if (menuEngine && world.e === menuEngine) return; /* already on screen: never rebuild the same scene */ menuEngine = new Engine(LEVELS[0]); menuEngine.time = 1e9; menuEngine.oxygen = 1e9; menuEngine.menu = true; world.loadLevel(menuEngine); world.onTick(menuEngine, performance.now()); reefProgress(); }
  function reefProgress() { const c = cleared(); world.reefLights = c * 3; world.reefK = c / LEVELS.length; }
  function wipeTo(fn, ev) { const w = $('#wipe'); if (!w || REDUCED_MOTION || w.classList.contains('in')) { fn(); return; }
    const x = ev && ev.clientX ? ev.clientX : innerWidth / 2, y = ev && ev.clientY ? ev.clientY : innerHeight / 2; w.style.setProperty('--x', x + 'px'); w.style.setProperty('--y', y + 'px');
    w.classList.add('in'); Audio.play('bubble'); setTimeout(() => { try { fn(); } finally { setTimeout(() => w.classList.remove('in'), 90); } }, 380); }
  function openHome() { storyEnd(); if (TUT.on) { TUT.on = false; Audio.stopVo(); $('#tut').classList.remove('on'); world.focus = null; } setPeekSafe(); Audio.setTension(0); Audio.music('menu'); setState('menu'); go('home'); showMenuScene(); reefProgress(); homeCard(); homeLayout(); idleThumbs(); }
  // phone portrait home (the owner's mockup): painted backdrop, waving diver, and a card with a photo of the next level's tank.
  // The 3D scene is hidden behind it there, so the frame loop holds instead of rendering.
  // the mockup home: phones in portrait, and computers / big landscape screens (laid out for width). Both cover the 3D scene.
  const HM3P = matchMedia('(max-width: 760px) and (orientation: portrait)'), HM3D = matchMedia('(orientation: landscape) and (min-width: 760px) and (min-height: 521px)');
  const HM3 = { get matches() { return HM3P.matches || HM3D.matches; } }; let cardKey = '';
  function homeCard() { const n = Math.min(save.unlocked, LEVELS.length); if (!HM3.matches) return;
    // the photo is drawn at the card's real pixel size (a small canvas looked soft on big monitors), in 160 px steps so resizes reuse it
    const cv = $('#hmCardCv'), r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = r.width > 10 ? Math.max(480, Math.min(1440, Math.ceil(r.width * dpr / 160) * 160)) : 480, h = Math.round(w * 2 / 3), key = n + ':' + w;
    if (cardKey === key) return; if (cv.width !== w) { cv.width = w; cv.height = h; }
    const prev = world.e; try { const e = new Engine(LEVELS[n - 1]); e.photo = true; world.loadLevel(e); world.onTick(e, performance.now()); if (world.tankShot(cv)) cardKey = key; }
    catch (er) {} finally { if (prev) { world.loadLevel(prev); world.onTick(prev, performance.now()); } } }
  for (const mq of [HM3P, HM3D]) try { mq.addEventListener('change', () => { heldDirty = true; if ($('#home').classList.contains('on')) homeCard(); }); } catch (er) {}
  if (UI && UI.home_diver) $('#hmDiver').src = UI.home_diver; else $('#hmDiver').hidden = true;
  $('#hmCard').onclick = ev => $('#btnPlay').onclick(ev);
  // wide screens: the menu column sits on the left, so the menu camera moves the tank into the free space on the right
  function homeLayout() { let sh = 0, lift; const home = $('#home');
    if (world.menuMode && home.classList.contains('on')) { const col = $('.hm-col').getBoundingClientRect(), nav = $('.hm-nav').getBoundingClientRect(), top = $('.hm-top').getBoundingClientRect();
      if (innerWidth > innerHeight && col.right < innerWidth * 0.7) { sh = Math.min(0.24, col.right / innerWidth / 2); lift = (innerHeight / 2 - (top.bottom + nav.top) / 2) / innerHeight; }
      else { const t = $('.hm-logo').getBoundingClientRect().bottom, b = $('.hm-cta').getBoundingClientRect().top; if (b > t) lift = (innerHeight / 2 - (t + b) / 2) / innerHeight; } }
    if (Math.abs((world.menuShift || 0) - sh) > 0.005 || world.menuLift !== lift) { world.menuShift = sh; world.menuLift = lift; if (world.menuMode) world.fitCamera(false); } }
  function setPeekSafe() { try { world.peek = false; } catch {} }
  // ---- intro cinematic: plays once (first launch) or on request; skippable; can't double-start
  function tickWorld(e, t) { if (e === engine && e.events && e.events.length) { feel(e); fun(e); } world.onTick(e, t); }
  // ---- fun pass (owner-approved): combo moments, one hidden relic per level, diver reactions, the level-start reveal ----
  // Combos: a stone dropped on a monster ("BONK!") and two pearls delivered within ~3 s ("DOUBLE!") get a stamp, a slow-motion beat
  // and coins on the result screen. Each counts once per run (keyed, so undo-and-repeat can't farm it). Never in replays/clips.
  const RUN = { combos: [], keys: new Set(), lastAbsorb: -99, relic: null, relicGot: false, near: new Map(), dodgeAt: -9 };
  function runReset() { RUN.combos = []; RUN.keys.clear(); RUN.lastAbsorb = -99; RUN.relicGot = false; RUN.near.clear(); RUN.dodgeAt = -9; RUN.airSaid = false; }
  // the diver's little voice lines during play (src/assets/vo/d_*.mp3, made by make_voices.bat). Only if the clip exists, at most one
  // every 6 s, and the frequent moments only some of the time, so they stay cute instead of repetitive.
  const DV = { pearl: ['d_pearl1', 'd_pearl2', 'd_pearl3'], gate: ['d_gate1', 'd_gate2'], relic: ['d_relic'], bonk: ['d_bonk'], double: ['d_double'], phew: ['d_phew1', 'd_phew2'], air: ['d_air'], undo: ['d_undo1', 'd_undo2'] };
  const DVK = { pearl: 0.55, phew: 0.6, undo: 0.5 }; let dvAt = 0;
  const hasVo = id => !!(window.AQ_DATA && AQ_DATA.VO && AQ_DATA.VO[id]);
  // the story's voice packs load in the background, one per world, when that world is near (missing files are fine: subtitles only)
  const voicePack = {}; function loadVoice(w) { const have = window.AQ_DATA && AQ_DATA.VOP; if (w < 1 || w > 3 || voicePack[w] || !have || !have.includes(w)) return; voicePack[w] = 1; try { const sc = document.createElement('script'); sc.src = `assets/voice-${w}.js`; sc.async = true; sc.onerror = () => sc.remove(); document.head.appendChild(sc); } catch (er) {} }
  const packOf = n => Math.min(3, Math.max(1, Math.floor((n - 1) / 10) + 1));
  function dvoice(kind) { if (replay || CLIP || state === 'cine' || !DV[kind]) return; const now = performance.now(); if (now - dvAt < 6000) return; if (Math.random() > (DVK[kind] ?? 1)) return;
    const L = DV[kind].filter(hasVo); if (!L.length) return; dvAt = now; Audio.vo(L[Math.random() * L.length | 0]); }
  function combo(key, label, coins, word, col) { if (RUN.keys.has(key)) return; RUN.keys.add(key); RUN.combos.push([label, coins]);
    slowMo = Math.max(slowMo, 0.4); comboStamp(word, '+' + coins, col); buzz([20, 40, 20, 40, 60]); Audio.play('star'); dvAt = 0; dvoice(key.startsWith('bonk') ? 'bonk' : 'double'); }
  function comboStamp(word, sub, col) { const el = $('#comboStamp'); if (!el || REDUCED_MOTION && false) return; bannerOff(); el.querySelector('b').textContent = word; el.querySelector('span').textContent = sub; el.style.setProperty('--cc', col || '#ff8fd0');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); clearTimeout(comboStamp.t); comboStamp.t = setTimeout(() => el.classList.remove('on'), 1400); }
  function fun(e) { if (replay || CLIP || e !== engine || !e.player && !e.events.some(v => v.type === 'monsterDeath' || v.type === 'absorb')) return;
    for (const v of e.events) {
      if (v.type === 'monsterDeath') combo(`bonk:${v.t}@${v.x},${v.y}`, 'Monster bonk', 15, 'BONK!', '#ff8fd0');
      if (v.type === 'absorb') { if (e.tick - RUN.lastAbsorb <= 14 && e.ballsIn >= 2) combo('dbl:' + e.ballsIn, 'Double pearl', 20, 'DOUBLE!', '#ffd23f'); RUN.lastAbsorb = e.tick; } }
    const p = e.player; if (!p || e.state !== 'playing') return;
    // relic: walk (or dig) into its cell
    if (RUN.relic && !RUN.relicGot && p.x === RUN.relic.x && p.y === RUN.relic.y) { RUN.relicGot = true; const n = levelIdx + 1; save.relics = save.relics || {}; const first = !save.relics[n]; save.relics[n] = 1; persist();
      world.collectRelic(); Audio.play('treasure'); setTimeout(() => Audio.play('star'), 160); buzz([20, 30, 20, 30, 80]); dvAt = 0; dvoice('relic');
      toast(first ? `Keeper’s coin found! ${Object.keys(save.relics).length}/${LEVELS.length}` : 'Keeper’s coin found again'); if (MEM_LINES[n]) setTimeout(() => talk('keeper', MEM_LINES[n], 'm' + n, { now: true }), 900); }
    // near miss: a monster came right next to him and moved on without catching him -> a quick dodge hop + "Close one!"
    for (const o of e.objects.values()) { if (o.t !== T.FISH && o.t !== T.JELLY && o.t !== T.CRAB) continue; const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
      if (d <= 1) RUN.near.set(o.id, true); else if (RUN.near.get(o.id)) { RUN.near.delete(o.id); if (performance.now() - RUN.dodgeAt > 2500) { RUN.dodgeAt = performance.now(); world.dodge(); dvoice('phew'); } } }
    world.lowAir = !e.relaxed && e.begun && e.oxygen < 10; if (world.lowAir && !RUN.airSaid) { RUN.airSaid = true; dvoice('air'); } }
  // the relic's cell: a sand cell the diver can dig to from the start, as far as possible from every cell the verified winning route
  // visits (so finding it is a detour, never on the way), not right under a stone/pearl. Computed once per level.
  const relicCache = {};
  function relicCell(i) { if (i in relicCache) return relicCache[i]; let best = null; try {
    const lv = LEVELS[i], e = new Engine(lv), route = ROUTES[i + 1] || '', seen = new Set(), W = e.w, H = e.h;
    seen.add(e.player.y * W + e.player.x); for (const c of route) { if (c !== '.') e.press(PLM[c]); e.step(); if (e.player) seen.add(e.player.y * W + e.player.x); if (e.state !== 'playing') break; }
    const e0 = new Engine(lv), reach = new Set(), boards = [new Engine(lv)];
    { const eb = new Engine(lv); for (let k = 0; k < route.length; k++) { const c = route[k]; if (c !== '.') eb.press(PLM[c]); eb.step(); if (eb.state !== 'playing') break; if (k % 8 === 7) boards.push(cloneEngine(eb)); } }
    for (const b of boards) { if (!b.player) continue; const q = [b.player.y * W + b.player.x], rs = new Set(q); // also look at the board as the route opens it up
      while (q.length) { const c = q.shift(), x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = ny * W + nx, t = b.get(nx, ny);
        if (rs.has(n) || !(t === T.SAND || t === T.EMPTY || t === T.AIR)) continue; rs.add(n); q.push(n); } }
      for (const c of rs) if (e0.get(c % W, (c / W) | 0) === T.SAND || e0.get(c % W, (c / W) | 0) === T.EMPTY) reach.add(c); }
    const route2 = [...seen].map(c => [c % W, (c / W) | 0]); let bs = -Infinity;
    for (const c of reach) { const x = c % W, y = (c / W) | 0, t0 = e0.get(x, y); if (seen.has(c) || !(t0 === T.SAND || t0 === T.EMPTY)) continue; const up = e0.get(x, y - 1); if (up === T.ROCK || up === T.BALL) continue;
      const d = Math.min(...route2.map(([rx, ry]) => Math.abs(rx - x) + Math.abs(ry - y))); const sc = Math.min(d, 6) * 10 + (t0 === T.SAND ? 5 : 0) - (e0.water[c] ? 40 : 0) + y * 0.5 + x * 0.01; /* monster water only as a last resort: a guarded relic */ if (sc > bs) { bs = sc; best = { x, y }; } }
    if (bs < -30) best = null; } catch (er) { best = null; window.__relicErr = String(er); } // prefers buried sand far from the route; falls back to a cell just off it
    return (relicCache[i] = best); }
  function relicSync() { const n = levelIdx + 1;
    RUN.relic = !dive && !replay ? relicCell(levelIdx) : null; world.setRelic(RUN.relic && !(save.relics || {})[n] && !RUN.relicGot ? RUN.relic : null); }
  // haptics + music cues for what just happened in the tank
  function feel(e) { const pl = e.player; let best = 0, pat = null; const want = (p, w) => { if (w > best) { best = w; pat = p; } };
    for (const v of e.events) switch (v.type) {
      case 'dig': want(5, 1); break;
      case 'push': want(8, 2); break;
      case 'gateLocked': want(14, 3); break;
      case 'land': if (pl) { const d = Math.max(Math.abs(pl.x - v.x), Math.abs(pl.y - v.y)); if (d <= 1) want([26, 40, 16], 6); else if (d <= 3) want(12, 3); } break;
      case 'monsterDeath': want([20, 30, 20], 5); weekBump('bonk'); break;
      case 'teeter': want([22, 50, 22], 7); break;
      case 'absorb': want([18, 50, 30], 8); slowMo = 0.23; if (e.ballsIn === 1 && (LEVEL_BEATS[levelIdx + 1] || []).some(b => b.on === 'p')) beat('p'); else if (e.ballsIn < e.ballsTotal) dvoice('pearl'); break; // one soft 'whoomp' (absorb) only: the extra pitched chime on top made it shrill
      case 'gateOpen': want([30, 60, 30, 60, 90], 9); Audio.swell(); dvAt = 0; if (!dive && (LEVEL_BEATS[levelIdx + 1] || []).some(b => b.on === 'g') && !beatSeen.has((levelIdx + 1) + ':g')) beat('g'); else dvoice('gate'); break;
    }
    if (pat) buzz(pat); }
  let cineRunning = false, slowMo = 0; // seconds of a short slow-motion beat when a pearl goes in (counted on the frame clock)
  // ---- opening cinematic: the real game, played by itself (route verified to win Level 1)
  let cine = null, cineEngine = null;
  let menuKeep = false; // after the intro, its finished tank stays on as the menu backdrop (no reload, no jump)
  const CINE_ROUTE = 'RRRRDDRRRRRDULLLLLULLDRRRRRRRDD';
  const T_BALL = T.BALL; // cineTick uses T for its clock
  function cap(text) { const el = $('#cineCap'); el.classList.remove('on'); clearTimeout(cap.tm); cap.tm = setTimeout(() => { el.innerHTML = ''; // the words fade in one after another, like a storyteller
      (text || '').split(' ').forEach((w, i) => { const sp = document.createElement('span'); sp.textContent = w + ' '; sp.style.animationDelay = (i * 0.07).toFixed(2) + 's'; el.appendChild(sp); }); el.classList.toggle('on', !!text); }, text ? 260 : 0); }
  // ---- the intro: a short in-engine film in seven beats. Every spoken line has an id (vo1…vo7) so ElevenLabs clips dropped in
  // src/assets/vo/<id>.mp3 play automatically (see docs/voiceover-script.md); without clips the subtitles carry the story.
  // every line is spoken at the moment the picture shows it: lines 1-4 on the film's clock, 5-9 on real events in the tank
  // (first dig, reaching the gate, first push, gate opening, swimming in). Keep the words short and plain: kids should follow it.
  const CINE_LINES = {
    vo1: 'Deep in the sea, the reef glows with magic pearls.',             // night reef, glowing pearl-lights drifting
    vo2: 'One night, a huge storm hits the reef…',                         // thunder, flashes, grit
    vo3: '…and sweeps all the pearls away. The reef goes dark.',          // the lights are blown away, darkness
    vo4: 'But one little diver turns on a light.',                         // helmet lamp clicks on during the line
    vo5: 'Swim into the sand to dig a tunnel.',                            // the first dig
    vo6: 'The tunnel reaches the gate. Now get behind the red pearl…',     // the diver arrives above the gate, turns back
    vo7: '…and push it to the gate!',                                      // the first push
    vo8: 'The gate wakes up, and the light comes back!',                   // gate opens: shockwave, light pours back
    vo9: 'Twenty-nine gates are still dark. Can you wake them all?' };     // wide shot + the row of 30 gates, one lit
  // each film line gets the time until the next one (CINE_MAX, seconds); if the previous line is nearly done it finishes first
  const CINE_MAX = { vo1: 4.5, vo2: 3.35, vo3: 3.85, vo4: 4.4, vo5: 3.35, vo6: 3.45, vo7: 1.9, vo8: 3.6, vo9: 4.3 };
  function say(id) { clearTimeout(say.w); const left = Audio.voLeft(); if (left > 0.05 && left < 1.6) { say.w = setTimeout(() => { if (cineRunning) say(id); }, left * 1000 + 120); return; }
    cap(CINE_LINES[id] || ''); Audio.vo(id, CINE_MAX[id]); }
  const ramp = (from, to, t0, dur, T) => from + (to - from) * Math.min(1, Math.max(0, (T - t0) / dur));
  function startCine() {
    if (cineRunning) return; cineRunning = true; Audio.music(null);
    setState('cine'); show(null); $('#skipIntro').hidden = false; $('#cineTitle').classList.remove('on'); $('#cineFade').classList.add('on'); $('#cineFade').classList.add('black');
    cineEngine = new Engine(Object.assign({}, LEVELS[0], { tickMs: 150 })); cineEngine.time = 999; cineEngine.oxygen = 999; cineEngine.cine = true;
    world.loadLevel(cineEngine); world.onTick(cineEngine, performance.now()); world.startPlay();
    world.cineCam = true; world.cineT = 0; world.cineShot = 'descent'; world.shotT0 = 0; world.storyDim = 0.95; world.cineFx = { glow: 0, storm: 0, lamp: 0 }; world.wakeT = undefined;
    cine = { t: 0, i: 0, wait: 0, wonAt: null, gateAt: null, said: {}, pro: !REDUCED_MOTION }; acc = 0; frame.last = performance.now();
    if (cine.pro) world.storyStart({ w: 0, n: 0, ch: World.PROLOGUE, tank: null, voDur: storyVoLen, onFx: storyFx, onCap: (line, i) => { storyCap(line, i, 0, World.PROLOGUE); $('#storySkip').hidden = true; }, onFreeze: () => { if (cine) cine.proEnd = true; } });
    setTimeout(() => $('#cineFade').classList.remove('on'), 120); // fade up from black
  }
  function cineTick(realDt, now) {
    realDt = Math.min(realDt, 0.1);
    if (cine.pro) { if (!cine.proEnd) { $('#skipIntro').style.setProperty('--sp', Math.min(1, (world.story ? world.story.t : 0) / 70).toFixed(3)); $('#cineDark').style.opacity = world.post && world.post.enabled ? 0 : 0.4; return; } // the prologue film plays first (low tier: no night grade, so a dark overlay)
      cine.pro = false; storyCap(null); world.storyStop(); cine.t = 12.3; Object.assign(cine.said, { l1: 1, v1: 1, st: 1, th2: 1, v3: 1 }); world.cineFx.glow = 0; world.storyDim = 1.3; acc = 0; } // then into the dark tank, lamp next
    cine.t += realDt; world.cineT = cine.t; const c = cine, E = cineEngine, T = c.t, F = world.cineFx, once = (k, fn) => { if (!c.said[k]) { c.said[k] = 1; fn(); } };
    const shot = (n) => { world.cineShot = n; world.shotT0 = T; };
    // 1. the legend: the reef at night, alive with drifting pearl-light
    if (c.gateAt === null) { F.glow = Math.min(F.glow, 1); }
    if (T < 5.6) { F.glow = ramp(0, 1, 0.2, 2.2, T); world.storyDim = 0.95; }
    once('l1', () => {}); if (T > 1.0) once('v1', () => say('vo1'));
    // 2. the storm: thunder, flashes, grit tearing across the tank, the lights swept away
    if (T > 5.6) once('st', () => { shot('storm'); Audio.play('thunder'); Audio.play('stormWind'); world.cineFlash(1); world.shake = 0.5; flash(); say('vo2'); });
    if (T > 5.6 && T < 11.6) { F.storm = T < 10.4 ? ramp(0, 1, 5.6, 1.0, T) : ramp(1, 0, 10.4, 0.8, T); F.glow = ramp(1, 0, 6.0, 3.6, T); world.storyDim = ramp(0.95, 1.3, 5.6, 1.4, T); world.shake = Math.max(world.shake, F.storm * 0.18); }
    if (T > 7.9) once('th2', () => { Audio.play('thunder'); world.cineFlash(0.8); world.shake = 0.45; flash(); });
    if (T > 9.0) once('v3', () => say('vo3'));
    // 3. the hero: darkness, then a helmet lamp clicks on
    if (T > 11.6) once('hero', () => { shot('hero'); F.storm = 0; });
    if (T > 12.5) once('capClr', () => cap(''));
    if (T > 14.3) { once('lamp', () => { Audio.play('lampOn'); world.playerMood('surprise', 0.8); }); if (c.gateAt === null) F.lamp = ramp(0, 1, 14.3, 0.35, T); }
    if (T > 12.9) once('v4', () => { say('vo4'); setTimeout(() => { if (cineRunning) { Audio.play('hi'); world.playerMood('joy', 1.3); } }, 2300); });
    // 4. the first dive, lit by the lamp
    if (T > 16.8) once('play', () => { shot('play'); cap(''); });
    if (T > 17.2 && c.i < CINE_ROUTE.length && !(c.gateAt !== null && T - c.gateAt < 3.3)) { c.wait -= realDt * 1000; if (c.wait <= 0 && (!E.moveQueue || E.moveQueue.length === 0)) { E.press({ U: 'up', D: 'down', L: 'left', R: 'right' }[CINE_ROUTE[c.i++]]); c.wait = 300; } }
    // 5. the gate wakes: a ring of light, the pearl-lights pour back, the reef relights
    if (E.gate && E.gate.open && c.gateAt === null) { c.gateAt = T; shot('gate'); Audio.play('wake'); world.cineWake(); world.cineFlash(0.7); say('vo8'); }
    if (c.gateAt !== null) { const k = T - c.gateAt; world.storyDim = ramp(1.3, 0, 0.2, 2.2, k); F.glow = ramp(0, 1, 0.3, 2.4, k); F.lamp = ramp(1, 0, 0.6, 1.6, k); }
    $('#cineDark').style.opacity = world.post && world.post.enabled ? 0 : (world.nightK || 0) * 0.62; $('#skipIntro').style.setProperty('--sp', Math.min(1, (T + 22) / 70).toFixed(3)); // low tier: no post pass, darken with an overlay
    acc += Math.min(250, realDt * 1000);
    while (acc >= E.tickMs) { acc -= E.tickMs; E.step();
      for (const v of E.events) { if (v.type === 'dig') once('v5', () => say('vo5')); if (v.type === 'push' && v.t === T_BALL) once('v7', () => say('vo7')); }
      world.onTick(E, now - acc);
      const p = E.player; if (p && E.gate && p.x === E.gate.x && p.y === E.gate.y - 1 && c.said.v5) once('v6', () => say('vo6')); }
    // 6. pull back wide, then the title on black, then fade into the menu
    if (E.state === 'won' && c.wonAt === null) { c.wonAt = T; shot('wide'); setTimeout(() => { if (cineRunning) { say('vo9'); $('#cineGates').classList.add('on'); } }, 600); }
    if (c.wonAt !== null) { const k = T - c.wonAt;
      if (k > 4.2) once('riser', () => Audio.play('riser'));
      if (k > 5.0) once('fadeout', () => { cap(''); $('#cineGates').classList.remove('on'); $('#cineFade').classList.add('on'); });
      if (k > 6.4) once('title', () => $('#cineTitle').classList.add('on'));
      if (k > 10.2) endCine(); }
  }
  function flash() { if (REDUCED_MOTION) return; const f = $('#cineFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  function endCine() {
    if (!cineRunning) return; if (cine && cine.pro) { storyCap(null); world.storyStop(); } cineRunning = false; clearTimeout(say.w); cine = null; world.cineCam = false; world.storyDim = 0; world.cineFx = null; world.flashK = 0; $('#cineDark').style.opacity = 0; cap(''); Audio.stopVo(); $('#cineTitle').classList.remove('on'); $('#cineGates').classList.remove('on');
    $('#cineFade').classList.add('on'); setTimeout(() => $('#cineFade').classList.remove('on'), 60); // the menu fades up out of black
    menuEngine = cineEngine; cineEngine.menu = true; world.menuMode = true; world.playing = false; world.fitCamera(false); menuKeep = true; // the intro's tank becomes the menu backdrop as-is
    $('#skipIntro').hidden = true; save.introSeen = true; persist(); openHome();
  }
  $('#skipIntro').addEventListener('click', () => { click(); endCine(); });
  $('#btnReplayIntro').addEventListener('click', () => { click(); go('journal'); });
  $('#btnIntro2').addEventListener('click', () => { click(); go('journal'); });

  // ---- world map: one world at a time (‹ World › arrows), a winding path over the world's painting, the diver standing on the
  // current level. Tapping a level selects it (the card shows a preview of its real layout); Play starts it. Woken gates glow and
  // the reef decor lights up with the number of gates awake; the diver walks to a newly unlocked level.
  const DECOR_ART = [['coral', 'shell', 'fish', 'starfish', 'coral', 'shell'], ['coral', 'crystal', 'shell', 'crystal', 'fish', 'coral'], ['jelly', 'crystal', 'fish', 'jelly', 'starfish', 'crystal']];
  const DECOR = [['🪸', '🐚', '🐠', '🌿', '⭐', '🐡'], ['🪸', '💜', '🦑', '🐚', '🔮', '🐠'], ['🐙', '✨', '🦐', '💎', '🪼', '🐟']];
  const cleared = () => Object.keys(save.stars).filter(k => +k <= LEVELS.length).length;
  const worldOfIdx = i => Math.max(0, WORLDS.findIndex(w => i >= w.from && i < w.to));
  const LV = { w: 0, sel: 0, pts: null, horiz: false };
  function worldStats(wi) { const w = WORLDS[wi]; let st = 0, awake = 0; for (let i = w.from; i < w.to; i++) { st += save.stars[i + 1] || 0; if (save.stars[i + 1]) awake++; } return { st, awake, n: w.to - w.from }; }
  function buildLevels() { const cur = Math.min(save.unlocked, LEVELS.length) - 1; LV.w = worldOfIdx(cur); LV.sel = cur; renderWorld(true); }
  function renderWorld(travel) {
    const box = $('#worlds'); if (!box) return; box.innerHTML = ''; const w = WORLDS[LV.w], wi = LV.w, n = w.to - w.from, cur = Math.min(save.unlocked, LEVELS.length) - 1;
    $('#lvBg').className = 'lv-bg w' + wi; $('#levels').dataset.w = wi;
    const ws = worldStats(wi); $('#lvWorld').innerHTML = ''; { const b1 = document.createElement('span'); b1.textContent = `World ${wi + 1} · `; const b2 = document.createElement('em'); b2.textContent = w.name; $('#lvWorld').append(b1, b2); }
    $('#lvWorldSub').innerHTML = `<i class="g">✦</i> ${ws.awake}/${ws.n} gates awake &nbsp;·&nbsp; <i class="s">★</i> ${ws.st}/${ws.n * 3} stars`;
    $('#lvcWorldN').textContent = `World ${wi + 1}`; $('#lvcWorld').textContent = w.name; $('#lvcGates').innerHTML = `<i class="g">✦</i> ${ws.awake}/${ws.n} gates awake`; $('#lvcStarsW').innerHTML = `<i class="s">★</i> ${ws.st}/${ws.n * 3} stars`;
    $('#lvPrevW').disabled = wi === 0; $('#lvNextW').disabled = wi === WORLDS.length - 1;
    $('#lvStars').textContent = `${totalStars()} / ${LEVELS.length * 3}`;
    // layout: a horizontal path on wide screens, a vertical one on phones
    const cw = box.clientWidth || innerWidth, ch = box.clientHeight || innerHeight * 0.6, horiz = cw > ch * 1.05; LV.horiz = horiz;
    const pts = []; let MW, MH;
    if (horiz) { const sp = Math.max(150, Math.min(240, cw / 5.2)), pad = Math.max(110, sp * 0.7); MW = pad * 2 + sp * (n - 1); MH = ch;
      for (let k = 0; k < n; k++) pts.push([pad + k * sp, ch * (0.47 + 0.2 * Math.sin(k * 1.2 + 0.4))]); }
    else { const sp = Math.max(108, Math.min(150, ch / 5.2)), pad = 80; MH = pad * 2 + sp * (n - 1); MW = cw;
      for (let k = 0; k < n; k++) pts.push([cw * (0.5 + 0.24 * Math.sin(k * 1.05 + 0.5)), pad + k * sp]); }
    LV.pts = pts;
    const map = document.createElement('div'); map.className = 'lv-inner'; map.style.width = MW + 'px'; map.style.height = MH + 'px';
    const seg = (k) => { const [x0, y0] = pts[k], [x1, y1] = pts[k + 1]; return horiz ? `C${(x0 + x1) / 2} ${y0} ${(x0 + x1) / 2} ${y1} ${x1} ${y1}` : `C${x0} ${(y0 + y1) / 2} ${x1} ${(y0 + y1) / 2} ${x1} ${y1}`; };
    const reach = Math.max(-1, Math.min(n - 1, cur - w.from)); let d = `M${pts[0][0]} ${pts[0][1]}`, dl = d;
    for (let k = 0; k < n - 1; k++) { d += seg(k); if (k < reach) dl += seg(k); }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'lv-path'); svg.setAttribute('width', MW); svg.setAttribute('height', MH);
    svg.innerHTML = `<path class="lv-trail" d="${d}"/>` + (reach > 0 ? `<path class="lv-lit-glow" d="${dl}"/><path class="lv-lit" d="${dl}"/>` : ''); map.appendChild(svg);
    // reef decor that lights up as this world's gates wake
    const lit = ws.awake / ws.n; DECOR[wi].forEach((dch, k) => { const el = document.createElement('span'), at = Math.min(n - 1, Math.round(k * 1.7 + 0.6)), [px, py] = pts[at];
      el.className = 'lv-deco' + (k / DECOR[wi].length < lit ? ' on' : ''); const art = UI && UI[DECOR_ART[wi][k]]; if (art) { el.classList.add('art'); el.style.setProperty('--d', `var(--ui-${DECOR_ART[wi][k]})`); } else el.textContent = dch;
      const off = (k % 2 ? 1 : -1) * (horiz ? 70 : Math.min(120, cw * 0.3)); el.style.left = (horiz ? px + (k % 3 - 1) * 40 : Math.max(30, Math.min(MW - 30, px + off))) + 'px'; el.style.top = (horiz ? py + off * 1.1 : py + (k % 3 - 1) * 26) + 'px'; map.appendChild(el); });
    for (let k = 0; k < n; k++) { const i = w.from + k, num = i + 1, locked = num > save.unlocked, stars = save.stars[num] || 0, [px, py] = pts[k];
      const b = document.createElement('button'); b.className = `lv-node w${wi}` + (locked ? ' locked' : stars ? ' awake' : '') + (i === cur ? ' cur' : '') + (stars === 3 ? ' perfect' : '') + (i === LV.sel ? ' sel' : '');
      b.style.left = px + 'px'; b.style.top = py + 'px'; b.dataset.i = i; b.setAttribute('aria-label', locked ? `Level ${num}, locked` : `Level ${num}, ${LEVELS[i].name}, ${stars} stars`);
      b.innerHTML = locked ? `<span class="n">${num}</span>` : `<span class="n">${num}</span><span class="st">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></span>`;
      const lab = document.createElement('span'); lab.className = 'lv-name' + (horiz ? ' below' : px > MW / 2 ? ' left' : ''); if (!locked) { const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = LEVELS[i].name; lab.append(nm); if (i === cur) { const c = document.createElement('em'); c.textContent = 'Current'; lab.prepend(c); } }
      if (!locked || horiz) b.appendChild(lab);
      if (!locked && save.runs && save.runs[num]) { const wb = document.createElement('span'); wb.className = 'lv-watch'; wb.setAttribute('role', 'button'); wb.setAttribute('aria-label', `Watch your best run of level ${num}`); wb.textContent = '▶'; wb.onclick = ev => { ev.stopPropagation(); startReplay(num, 'levels'); }; b.appendChild(wb); }
      b.onclick = () => { if (LV.dragged) return; click(); if (locked) { toast(`Clear level ${save.unlocked} to unlock level ${num}`); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); buzz(12); return; } if (LV.sel === i) { wipeTo(() => startLevel(i), event); return; } selectLevel(i); };
      map.appendChild(b); }
    // the diver stands beside the current level (and walks there from the last level the map showed)
    if (cur >= w.from && cur < w.to) { const dv = document.createElement('div'); dv.className = 'lv-diver' + (!horiz && pts[cur - w.from][0] > MW / 2 ? ' r' : ''); const th = diverThumb(); dv.innerHTML = th ? `<img alt="" src="${th}">` : '<span>🤿</span>'; map.appendChild(dv);
      const k1 = cur - w.from, from = Math.max(0, Math.min(k1, (save.mapAt || save.unlocked) - 1 - w.from)), place = (x, y) => { dv.style.left = x + 'px'; dv.style.top = y + 'px'; };
      place(pts[from][0], pts[from][1]);
      if (travel && from < k1) { const t0 = performance.now() + 500, per = 650; dv.classList.add('travel');
        const run = now => { const kk = (now - t0) / per; if (kk < 0) { requestAnimationFrame(run); return; } const sgi = Math.min(k1 - from - 1, Math.floor(kk)), t = Math.min(1, kk - sgi), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const a0 = pts[from + sgi], a1 = pts[from + sgi + 1]; place(a0[0] + (a1[0] - a0[0]) * e, a0[1] + (a1[1] - a0[1]) * e);
          if (kk < k1 - from) requestAnimationFrame(run); else { place(pts[k1][0], pts[k1][1]); dv.classList.remove('travel'); dv.classList.add('arrive'); buzz(15); Audio.play('click'); } };
        requestAnimationFrame(run); }
      save.mapAt = cur + 1; persist(); }
    box.appendChild(map); selectLevel(LV.sel >= w.from && LV.sel < w.to ? LV.sel : Math.max(w.from, Math.min(cur, w.to - 1)), true);
    requestAnimationFrame(() => { const p = pts[Math.max(0, Math.min(n - 1, LV.sel - w.from))]; if (horiz) box.scrollLeft = Math.max(0, p[0] - box.clientWidth * 0.45); else box.scrollTop = Math.max(0, p[1] - box.clientHeight * 0.5); }); }
  function selectLevel(i, quiet) { LV.sel = i; document.querySelectorAll('.lv-node').forEach(b => b.classList.toggle('sel', +b.dataset.i === i)); const num = i + 1, locked = num > save.unlocked, stars = save.stars[num] || 0, lv = LEVELS[i];
    $('#lvcNum').textContent = `Level ${num}`; $('#lvcName').textContent = locked ? 'Locked' : lv.name;
    $('#lvcSub').textContent = locked ? `Clear level ${save.unlocked} first` : stars ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ·  best ${(save.best[num] || 0).toLocaleString()}` : 'Ready to dive?';
    const pb = $('#lvPlay'); pb.disabled = locked; pb.innerHTML = locked ? 'Locked' : `<svg class="i" viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>Play<span class="pl-n"> level ${num}</span>`; $('#lvCard').classList.toggle('locked', locked);
    levelPhoto($('#lvPrev'), i, locked); }
  $('#lvPlay').onclick = ev => { if (LV.sel + 1 > save.unlocked) return; click(); buzz(10); wipeTo(() => startLevel(LV.sel), ev); };
  $('#lvPrevW').onclick = () => { if (LV.w > 0) { click(); LV.w--; LV.sel = WORLDS[LV.w].from; const cur = save.unlocked - 1; if (cur >= WORLDS[LV.w].from && cur < WORLDS[LV.w].to) LV.sel = cur; else LV.sel = Math.min(WORLDS[LV.w].to - 1, cur); renderWorld(); } };
  $('#lvNextW').onclick = () => { if (LV.w < WORLDS.length - 1) { click(); LV.w++; const cur = save.unlocked - 1; LV.sel = cur >= WORLDS[LV.w].from && cur < WORLDS[LV.w].to ? cur : WORLDS[LV.w].from; renderWorld(); } };
  // drag the map with the mouse on computers (touch scrolls natively)
  { const box = $('#worlds'); let dr = null;
    box.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse' || ev.button !== 0) return; dr = { x: ev.clientX, y: ev.clientY, sl: box.scrollLeft, st: box.scrollTop, moved: 0 }; LV.dragged = false; });
    addEventListener('pointermove', ev => { if (!dr) return; const dx = ev.clientX - dr.x, dy = ev.clientY - dr.y; dr.moved = Math.max(dr.moved, Math.abs(dx) + Math.abs(dy)); if (dr.moved > 6) { LV.dragged = true; box.classList.add('dragging'); } box.scrollLeft = dr.sl - dx; box.scrollTop = dr.st - dy; });
    addEventListener('pointerup', () => { if (!dr) return; dr = null; box.classList.remove('dragging'); setTimeout(() => { LV.dragged = false; }, 0); });
    box.addEventListener('wheel', ev => { if (LV.horiz && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { box.scrollLeft += ev.deltaY; ev.preventDefault(); } }, { passive: false }); }
  // a real photo of a level's tank (same renderer as the game), cached per level and size; the drawn map is the fallback
  const photoCache = new Map();
  function levelPhoto(cv, i, locked, live) { if (!cv) return; const lv = live ? dive : LEVELS[i], g = cv.getContext('2d'), key = (live ? 'd' + dayNum() : i) + ':' + cv.width + 'x' + cv.height; let off = photoCache.get(key);
    if (!off) { off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height; let ok = false; const prev = world.e;
      try { if (prev && prev === engine && (live ? !!dive : levelIdx === i && !dive)) ok = world.tankShot(off); // the level is already loaded (level card)
        else { const e = new Engine(lv); e.photo = true; world.loadLevel(e); world.onTick(e, performance.now()); ok = world.tankShot(off); } } catch (er) { ok = false; }
      finally { if (prev && world.e !== prev) { world.loadLevel(prev); world.onTick(prev, performance.now()); } heldDirty = true; }
      if (!ok) return drawLevelPreview(cv, lv, locked); photoCache.set(key, off); }
    g.save(); g.clearRect(0, 0, cv.width, cv.height); const r = Math.round(cv.height * 0.06); g.beginPath(); g.roundRect(0, 0, cv.width, cv.height, r); g.clip();
    if (locked) { try { g.filter = 'blur(6px) saturate(0.5)'; } catch (er) {} } g.drawImage(off, 0, 0); g.filter = 'none';
    if (locked) { g.fillStyle = 'rgba(6, 18, 44, 0.55)'; g.fillRect(0, 0, cv.width, cv.height); const cx = cv.width / 2, cy = cv.height / 2, u = cv.height * 0.09;
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(cx - u * 1.1, cy - u * 0.2, u * 2.2, u * 1.7, u * 0.3); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = u * 0.32; g.beginPath(); g.arc(cx, cy - u * 0.2, u * 0.7, Math.PI, 0); g.stroke(); }
    g.restore(); }
  // a little top-down picture of the level's real layout for the level card
  function drawLevelPreview(cv, lv, locked) { if (!cv || !lv) return; const g = cv.getContext('2d'), W = cv.width, H = cv.height, rows = lv.map, R = rows.length, C = Math.max(...rows.map(r => r.length));
    g.clearRect(0, 0, W, H); const cs = Math.min((W - 16) / C, (H - 16) / R), ox = (W - cs * C) / 2, oy = (H - cs * R) / 2;
    const bg = g.createLinearGradient(0, oy, 0, oy + cs * R); bg.addColorStop(0, '#2a8fe0'); bg.addColorStop(1, '#0b3c8a'); g.fillStyle = bg; g.beginPath(); g.roundRect(ox - 4, oy - 4, cs * C + 8, cs * R + 8, 10); g.fill();
    const wi = worldOfIdx(LEVELS.indexOf(lv)), wall = ['#5b78b8', '#7a5ac8', '#3c4f8a'][wi] || '#5b78b8';
    const circ = (x, y, r, c) => { g.beginPath(); g.arc(ox + (x + 0.5) * cs, oy + (y + 0.5) * cs, r * cs, 0, Math.PI * 2); g.fillStyle = c; g.fill(); };
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) { const ch = rows[y][x] || ' ', px = ox + x * cs, py = oy + y * cs;
      if (ch === '#') { g.fillStyle = '#1d2d5c'; g.fillRect(px, py, cs + 0.5, cs + 0.5); }
      else if (ch === 'W') { g.fillStyle = wall; g.beginPath(); g.roundRect(px + 0.5, py + 0.5, cs - 1, cs - 1, cs * 0.25); g.fill(); }
      else if (ch === '.') { g.fillStyle = '#f0b64c'; g.fillRect(px, py, cs + 0.5, cs + 0.5); g.fillStyle = 'rgba(255,240,190,0.35)'; g.fillRect(px, py, cs + 0.5, cs * 0.18); } }
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) { const ch = rows[y][x];
      if (ch === 'R' || ch === 'X') circ(x, y, 0.42, '#a3adc4'); else if (ch === 'B') { circ(x, y, 0.62, 'rgba(255,90,60,0.35)'); circ(x, y, 0.42, '#ff3d2a'); circ(x - 0.12, y - 0.12, 0.12, '#ffd0c0'); }
      else if (ch === 'E') { g.fillStyle = '#5fe8ff'; g.beginPath(); g.roundRect(ox + x * cs + cs * 0.1, oy + y * cs + cs * 0.1, cs * 0.8, cs * 0.8, cs * 0.18); g.fill(); g.fillStyle = '#0b3c8a'; g.fillRect(ox + x * cs + cs * 0.32, oy + y * cs + cs * 0.3, cs * 0.36, cs * 0.5); }
      else if (ch === 'P') { circ(x, y, 0.44, '#ffd23f'); circ(x, y - 0.05, 0.24, '#7a45e8'); } else if (ch === 'A') circ(x, y, 0.32, '#c9f2ff');
      else if (ch === 'F') circ(x, y, 0.38, '#ff9a2a'); else if (ch === 'J') circ(x, y, 0.38, '#ff7ad8'); else if (ch === 'C') circ(x, y, 0.38, '#ff5a3a'); }
    cv.classList.toggle('locked', !!locked); }
  // the equipped diver as a little picture (the shop's card render), for the map and the win card
  function diverThumb() { const k = 'mascot:' + save.equip.suit + ':' + save.equip.hat + ':' + save.equip.scarf; if (thumbs[k]) return thumbs[k];
    try { if (!thumbR) { const c2 = document.createElement('canvas'); c2.width = c2.height = 220; thumbR = World.preview(c2, true); } World.applySkin(save.equip); thumbs[k] = thumbR.shot('mascot'); return thumbs[k]; } catch (er) { return null; } }
  function buildProfile() {
    $('#profName').textContent = save.name || 'Diver';
    $('#profAva').textContent = (save.name || 'D')[0].toUpperCase();
    const cleared = Object.keys(save.stars).length, best = Object.values(save.best).reduce((a, b) => a + b, 0), three = Object.values(save.stars).filter(s => s === 3).length;
    $('#profSub').textContent = `Reached level ${Math.min(save.unlocked, LEVELS.length)} of ${LEVELS.length}`;
    $('#profStats').innerHTML = `<div class="stat"><i class="si s"></i><b>${totalStars()}</b><span>stars</span></div><div class="stat"><i class="si l"></i><b>${cleared}</b><span>levels cleared</span></div><div class="stat"><i class="si p"></i><b>${three}</b><span>perfect levels</span></div>
      <div class="stat"><i class="si c"></i><b>${best.toLocaleString()}</b><span>total best score</span></div><div class="stat"><i class="si r"></i><b>${Object.keys(save.relics || {}).length}/${LEVELS.filter((_, k) => relicCell(k)).length}</b><span>Keeper’s coins</span></div>`;
    const pw = $('#profWorlds'); pw.innerHTML = ''; WORLDS.forEach((w, wi) => { const ws = worldStats(wi), d = document.createElement('div'); d.className = 'pw w' + wi;
      d.innerHTML = `<span class="pw-n">${wi + 1}</span><span class="pw-t"><b></b><small>${ws.awake}/${ws.n} gates awake · ★ ${ws.st}/${ws.n * 3}</small><span class="pw-bar"><i style="width:${(ws.st / (ws.n * 3) * 100).toFixed(0)}%"></i></span></span>`;
      d.querySelector('b').textContent = w.name; pw.appendChild(d); }); }
  $('#nameSave').onclick = () => { const v = $('#nameInput').value.trim().slice(0, 14); save.name = v; persist(); click(); go('back'); refreshHome(); };
  $('#nameInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('#nameSave').click(); });

  // ---- levels ----
  // the story inside each level (tools: scratchpad story_v4.py → docs/story.md): beats, the line said when a dive fails, the Keeper’s memories
  const LEVEL_BEATS = [null, [{"on": "s", "who": "", "text": "Dig into the sand. Push the red pearl into the gate."}, {"on": "g", "who": "", "text": "The gate is awake! Swim in!"}], [{"on": "s", "who": "pip", "text": "Psst, Spark! Stones fall if you dig under them. Don’t be under them!"}, {"on": "p", "who": "pip", "text": "Ooh, I felt that! My glow tickles!", "fx": "glow"}, {"on": "g", "who": "pip", "text": "Two gates! Look, look, I’m sparkling!"}], [{"on": "s", "who": "pip", "text": "A giant eel who drinks light… Nope. Not thinking about it. Digging!"}, {"on": "m", "who": "pip", "text": "Did… did something just blink out there?", "fx": "eyes"}, {"on": "g", "who": "shelly", "text": "Well done, little one. Now swim in, before my old bones get cold."}], [{"on": "s", "who": "clack", "text": "Crew! Escort the gate-waker! Eyes sharp, claws sharper!"}, {"on": "p", "who": "clack", "text": "A fine push! I taught you that. I didn’t. But I would have."}, {"on": "g", "who": "pip", "text": "Four gates! Take that, Grimtide!"}], [{"on": "s", "who": "snip", "text": "Well, well. A little light. Snap, look! A snack!", "fx": "eyes"}, {"on": "p", "who": "pip", "text": "Don’t listen to them, Spark! Drop a stone on them!"}, {"on": "g", "who": "clack", "text": "HA! Five gates! Hear that? The jellies are singing!"}], [{"on": "s", "who": "pip", "text": "Jellyfish float up and down. Wait for the gap… then go!"}, {"on": "m", "who": "clack", "text": "Patience, gate-waker. A good captain waits for the tide."}, {"on": "g", "who": "pip", "text": "Six! The wreck is right there!"}], [{"on": "s", "who": "pip", "text": "The map says this gate has a keystone. Careful where you dig."}, {"on": "m", "who": "pip", "text": "Spark… do you see that glow over there? It’s so pretty…", "fx": "flicker"}, {"on": "g", "who": "grimtide", "text": "Yes, little light. Come and see the pretty glow…", "fx": "eyes"}], [{"on": "s", "who": "pip", "text": "My glow is so faint… Stay close to me, okay?", "fx": "ink"}, {"on": "m", "who": "clack", "text": "No map, no problem! I have an excellent sense of direction. Mostly."}, {"on": "g", "who": "pip", "text": "We found it without the map! We actually did it!"}], [{"on": "s", "who": "pip", "text": "Ink everywhere… He came this way.", "fx": "ink"}, {"on": "m", "who": "grimtide", "text": "I can smell your little lamp from here.", "fx": "tail"}, {"on": "g", "who": "pip", "text": "Nine! The torn map piece is close. I can feel it!"}], [{"on": "s", "who": "snap", "text": "Last gate of the Shallows, little light. Shame you won’t reach it."}, {"on": "m", "who": "snip", "text": "Boss says hurry it up, Snap! Shake the tank!", "fx": "quake"}, {"on": "g", "who": "pip", "text": "Ten gates. Hold my fin, Spark. Here comes the cliff…"}], [{"on": "s", "who": "grimtide", "text": "Little light… turn back.", "fx": "eyes", "cut": true}, {"on": "m", "who": "pip", "text": "Every crystal we light, he sees us. So let’s light them ALL."}, {"on": "g", "who": "pip", "text": "Eleven! Ha! He can echo all he likes!"}], [{"on": "s", "who": "shelly", "text": "Breathe slow, little one. Air is precious this deep."}, {"on": "p", "who": "pip", "text": "That pearl is for the silent clam. I just know it."}, {"on": "g", "who": "pip", "text": "Twelve. Why does the water feel so heavy?", "fx": "flicker"}], [{"on": "s", "who": "pip", "text": "Something’s wrong. The water’s going dark…", "fx": "flicker"}, {"on": "m", "who": "grimtide", "text": "I’m coming for you, little light.", "fx": "quake"}, {"on": "g", "who": "shelly", "text": "Swim in, quickly! Something huge is coming!", "fx": "eyes"}], [{"on": "s", "who": "pip", "text": "Shelly would want us to keep going. So we keep going.", "fx": "ink"}, {"on": "m", "who": "clack", "text": "She’s sleeping sound, gate-waker! I’ve got her!"}, {"on": "g", "who": "pip", "text": "Fourteen. Rest well, Shelly."}], [{"on": "s", "who": "pip", "text": "For Shelly. Let’s go!"}, {"on": "m", "who": "mira", "text": "Steady, little one. Every gate you wake reaches her too."}, {"on": "g", "who": "pip", "text": "Fifteen gates! She’d be so proud of us."}], [{"on": "s", "who": "pip", "text": "That poor octopus… and why did he ask about your lamp?"}, {"on": "m", "who": "grimtide", "text": "Murk! Back to work!", "fx": "tail"}, {"on": "g", "who": "pip", "text": "Sixteen. Whatever it takes, Spark. We free him."}], [{"on": "s", "who": "pip", "text": "Light that’s given away… How do you give light away?"}, {"on": "p", "who": "pip", "text": "Wait. Every pearl we give the gate… is light, given away!", "fx": "glow"}, {"on": "g", "who": "pip", "text": "Seventeen! Look, pearls rising from the sand!"}], [{"on": "s", "who": "murk", "text": "This way… the pearls will guide you…"}, {"on": "m", "who": "grimtide", "text": "Murk… who are you whispering to?", "fx": "eyes"}, {"on": "g", "who": "pip", "text": "Eighteen! Someone’s coming… my cousins?", "fx": "fish"}], [{"on": "s", "who": "cousin", "text": "Race you to the gate, Pip! Last one in is a sea slug!"}, {"on": "p", "who": "pip", "text": "Shelly’s okay! I can’t stop smiling!", "fx": "glow"}, {"on": "g", "who": "cousin", "text": "Nooo, you won! Okay, rematch at the Lantern!"}], [{"on": "s", "who": "pip", "text": "He’s wrapped around the Lantern… What did he mean, “setting the table”?", "fx": "eyes"}, {"on": "m", "who": "grimtide", "text": "Hurry, little light. I’m hungry.", "fx": "quake"}, {"on": "g", "who": "pip", "text": "Twenty. The Deep is next. Stay close."}], [{"on": "s", "who": "lumen", "text": "Shh! Sleeping piranhas. Tiptoe, my friends. Tippy-tippy-toe."}, {"on": "m", "who": "snip", "text": "Huh? Snap… do you smell lamp?"}, {"on": "g", "who": "lumen", "text": "Twenty-one! Bravo! Bravissimo!"}], [{"on": "s", "who": "clack", "text": "Captain on deck! Now, where’s this gate I keep hearing about?"}, {"on": "p", "who": "lumen", "text": "Listen! Old Bellow sings louder with every pearl!"}, {"on": "g", "who": "clack", "text": "Twenty-two! Grimtide’s getting weaker, crew!"}], [{"on": "s", "who": "lumen", "text": "The pressure’s strong down here. Watch your air, Keeper."}, {"on": "m", "who": "pip", "text": "Your lamp, Spark… it’s really hers. That’s amazing. And kind of scary."}, {"on": "g", "who": "pip", "text": "Twenty-three. Murk, we’re coming!"}], [{"on": "s", "who": "grimtide", "text": "I see you, little light.", "fx": "eyes", "cut": true}, {"on": "m", "who": "pip", "text": "Stay close, Spark. Something feels wrong today.", "fx": "flicker"}, {"on": "g", "who": "pip", "text": "Twenty-four! Look how bright it is! Wait… what’s that shadow?", "fx": "tail"}], [{"on": "s", "who": "shelly", "text": "For Clack. For Pip. Wake this gate."}, {"on": "m", "who": "grimtide", "text": "Your little seahorse is crying for you. How sweet.", "fx": "eyes"}, {"on": "g", "who": "shelly", "text": "Hold on, Pip. We’re coming!"}], [{"on": "s", "who": "shelly", "text": "Murk’s den is close. I can hear Pip."}, {"on": "m", "who": "pip", "text": "Spark? Is that you? Hurry!"}, {"on": "g", "who": "shelly", "text": "Twenty-six. Now, to Pip!"}], [{"on": "s", "who": "pip", "text": "Thank you for coming for me. Now let’s finish this!"}, {"on": "m", "who": "murk", "text": "The undertow pulls hard here. Trust it, and you’ll find the way."}, {"on": "g", "who": "murk", "text": "Twenty-seven. His lair is near."}], [{"on": "s", "who": "lumen", "text": "Look behind you! The whole Deep is glowing!", "fx": "fish"}, {"on": "m", "who": "grimtide", "text": "Shine, little lights. Shine for my feast.", "fx": "tail"}, {"on": "g", "who": "pip", "text": "Twenty-eight! Everyone is with us!", "fx": "glow"}], [{"on": "s", "who": "grimtide", "text": "Turn back, Keeper’s child. Or lose everything.", "fx": "eyes", "cut": true}, {"on": "m", "who": "murk", "text": "He’s afraid. I can feel it. Keep going!", "fx": "quake"}, {"on": "g", "who": "murk", "text": "One gate left. Let’s end this."}], [{"on": "s", "who": "pip", "text": "This is it. The last gate. Ready, Spark?"}, {"on": "p", "who": "snip", "text": "Uh… Snap? I think we picked the wrong side."}, {"on": "m", "who": "grimtide", "text": "Faster, little light! Give me my Heart!", "fx": "quake"}, {"on": "g", "who": "pip", "text": "Now! Swim in, and give the light away!"}]];
  // story conditions per level (look only): dim after the map is stolen, lights out after Shelly falls / in Grimtide's dark,
  // the storm rumbling on, ink drifting from Murk's prison
  const LEVEL_COND = { 8: 'dim', 9: 'dim', 13: 'storm', 14: 'dark', 16: 'ink', 18: 'ink', 24: 'dark', 25: 'dark', 26: 'ink', 29: 'storm', 30: 'storm' };
  const COND_CHIP = { dim: ['🌘', 'Dim water', 'the lights are fading'], dark: ['🔦', 'Lights out', 'only your lamp'], storm: ['⛈️', 'Storm', 'the tank will shake'], ink: ['🦑', 'Ink', 'Murk’s ink drifts by'] };
  let condT = 0;
  const LEVEL_MOOD = [null, {"pip": null, "ink": false, "eyes": 0}, {"pip": 0.26666666666666666, "ink": false, "eyes": 0}, {"pip": 0.30000000000000004, "ink": false, "eyes": 0}, {"pip": 0.33333333333333337, "ink": false, "eyes": 0}, {"pip": 0.3666666666666667, "ink": false, "eyes": 0}, {"pip": 0.4, "ink": false, "eyes": 0}, {"pip": 0.43333333333333335, "ink": false, "eyes": 0}, {"pip": 0.15, "ink": true, "eyes": 0}, {"pip": 0.15, "ink": true, "eyes": 0}, {"pip": 0.5333333333333333, "ink": true, "eyes": 0}, {"pip": 0.5666666666666667, "ink": false, "eyes": 0.35}, {"pip": 0.6000000000000001, "ink": false, "eyes": 0.35}, {"pip": 0.6333333333333333, "ink": true, "eyes": 0.35}, {"pip": 0.6666666666666667, "ink": true, "eyes": 0.35}, {"pip": 0.7, "ink": false, "eyes": 0.35}, {"pip": 0.7333333333333334, "ink": false, "eyes": 0.35}, {"pip": 0.7666666666666666, "ink": false, "eyes": 0.35}, {"pip": 0.8, "ink": false, "eyes": 0.35}, {"pip": 0.8333333333333333, "ink": false, "eyes": 0.35}, {"pip": 0.8666666666666667, "ink": false, "eyes": 0.6}, {"pip": 0.8999999999999999, "ink": false, "eyes": 0.6}, {"pip": 0.9333333333333333, "ink": false, "eyes": 0.6}, {"pip": 0.9666666666666668, "ink": false, "eyes": 0.6}, {"pip": 1, "ink": false, "eyes": 1}, {"pip": null, "ink": true, "eyes": 1}, {"pip": null, "ink": false, "eyes": 1}, {"pip": 1, "ink": false, "eyes": 1}, {"pip": 1, "ink": false, "eyes": 1}, {"pip": 1, "ink": false, "eyes": 1}, {"pip": 1, "ink": false, "eyes": 1}];
  const LEVEL_STORY = [null, "The storm ate every light in the reef. Wake the very first gate.", "Pip saw red eyes inside the storm. Find the gate under the falling stones.", "Grimtide once took the reef’s light as tribute. Shelly says he’s back. Hurry.", "Captain Clack’s crew saw a dark tail drag pearls this way. Two roads. Choose well.", "The jellies are humming. Get past Grimtide’s piranha and wake gate five.", "Something glints inside the wreck. Wake this gate to reach it.", "You have the Keeper’s map. And something is glowing in the dark nearby…", "The map is gone and Pip’s glow is fading. Find this gate on your own.", "A torn piece of the map drifted this way. Get past the claws.", "The last gate of the Shallows sits on the edge of a cliff. Snip and Snap are watching.", "Grimtide sees every crystal you light. Light them anyway.", "A clam lost its song. Air is short in this deep cave.", "The water is going dark. Something huge is coming.", "Shelly is hurt. Clack guards her. Wake the next gate for her.", "Mira carried you over the canyon. Shelly said: don’t look back.", "A prisoner in ink chains was dragged through here. He asked about your lamp.", "Light that’s given away. That’s how you beat him. Remember it.", "Murk is dropping pearls to guide you. Grimtide is getting suspicious.", "Shelly is okay! Race Pip’s cousins to the bottom of the pit.", "Grimtide is coiled around the Great Lantern. What did he mean, “setting the table”?", "Lumen lights your way into the Deep, past a shoal of sleeping piranhas.", "Old Bellow is singing, and Clack is back! Wake gate twenty-two.", "The mural showed the Keeper wearing your lamp. The Deep presses in; air is short.", "Grimtide is furious. A gauntlet of stones guards this gate. Stay close to Pip.", "Pip is gone. Clack is gone. Shelly is here. Wake this gate for them.", "Pip is caged in Murk’s den. The citadel of stones is the hardest yet.", "Murk is free and on your side. The undertow pulls everything down.", "The whole Deep is waking up behind you. It’s a long way down.", "Grimtide wants the Lantern full. Wake the gate anyway. You have a plan.", "The last gate. Give the light away, and finish Grimtide."];
  const DEATH_LINES = {"crushed": [{"w": "pip", "t": "Spark! No, no, no… Undo it! Please!", "a": 1, "b": 30}, {"w": "snip", "t": "Ooh! Flat as a flounder!", "a": 4, "b": 20}, {"w": "clack", "t": "Man down! MAN DOWN!", "a": 4, "b": 24}, {"w": "grimtide", "t": "Careful, little light. The reef is so very heavy.", "a": 11, "b": 30}], "monster": [{"w": "snap", "t": "Grimtide says thanks for the snack!", "a": 4, "b": 30}, {"w": "snip", "t": "Crunchy! Ha!", "a": 4, "b": 30}, {"w": "pip", "t": "Spark! Get away from it!", "a": 1, "b": 30}, {"w": "grimtide", "t": "My pets were hungry.", "a": 11, "b": 30}], "oxygen": [{"w": "pip", "t": "Spark, your air! Hold on!", "a": 1, "b": 30}, {"w": "shelly", "t": "Too deep, too long. Come back up, child.", "a": 3, "b": 13}, {"w": "grimtide", "t": "Breathe, little light. Oh… you can’t.", "a": 11, "b": 30}]};
  const MEM_LINES = [null, "If you’re hearing this, someone found my first coin. Hello, little diver.", "I hid thirty coins across the reef. Each one remembers something.", "I was afraid of the dark once, too. So I made a lamp.", "Clack’s grandmother was a captain too. Twice as loud.", "The jellies taught me to sing. Terrible teachers. Wonderful singers.", "I left a map in an old wreck. Just in case.", "Never follow a light that flickers. Real light holds steady.", "When I felt lost, I followed the fish. They always know the way home.", "Every map tears, sooner or later. Your heart is the better map.", "Jumping is easy. It’s the deciding that’s hard.", "The caves echo your fear back at you. So I sang to them instead.", "The clams sang to me the night I built the first gate.", "Grimtide’s storms are loud. But they never last.", "Old Shelly carried me when I was small. She’ll carry you too.", "Grief is heavy. Share it, and it gets lighter. Just like light.", "I met a little octopus who was scared of everything. His name was Murk.", "Murk and I learned the secret together: light given away comes back brighter.", "Murk always left me pearls to find. A trail, so I’d never get lost.", "Good news travels fastest in a school of fish.", "I built the Lantern to hold the reef’s light. I never thought he’d come for it.", "The Deep is dark, but it’s never empty. Someone is always shining.", "Old Bellow sang the day the Lantern was lit. Listen for him.", "They painted me on a wall once. I looked much taller.", "If he takes someone you love, don’t give up. That’s what he wants.", "Brave isn’t not being scared. Brave is going anyway.", "If you find Murk, tell him it wasn’t his fault. It never was.", "The trench is deep, but friends make good bridges.", "One light alone is easy to drink. A thousand lights are not.", "The night of the storm, I gave all my light to the Lantern. It was worth it.", "Whoever wears my lamp now: thank you. The reef is yours to keep shining."];
  function startLevel(i, custom) { storyEnd(); arriveNext = false; if (TUT.on) { TUT.on = false; Audio.stopVo(); $('#tut').classList.remove('on'); world.focus = null; }
    if (typeof booting !== 'undefined' && booting) dropLoader();
    runTreasures = 0; runTreasureSet.clear(); runLog = ''; runUndo = false; runHint = false; runReset();
    levelIdx = i; const lv = custom || LEVELS[i]; dive = custom && custom.daily ? custom : null;
    Audio.music(!custom && i >= 20 ? 'deep' : 'play'); // the Deep gets its own dark soundscape
    engine = new Engine(lv); engine.relaxed = !!save.settings.relaxed && !dive; if (dive) { engine.daily = true; World.dailyWorld(lv.name, dayNum() % 3); } /* the Daily Dive is a race: always on the clock */ world.loadLevel(engine); hideStuck(); stuckKey = ''; Audio.setTension(0); document.body.classList.toggle('relaxed', engine.relaxed);
    window.__LEVELSCENE = (custom || LEVELS[i]).scene || null; history = []; undoLeft = UNDO_MAX; undoUntil = 0; stuckTimer = 0; stuckShown = false; gateNudged = true; coachStart(i, custom);
    { const ph = $('#pauseHint'); if (ph) ph.innerHTML = rich(lv.hint); }
    if (!custom) { loadVoice(packOf(i + 1)); if ((i + 1) % 10 >= 8) loadVoice(packOf(i + 1) + 1); } relicSync(); beatM = 0; condT = 0; deathSaid = false; talkStop(); cutEnd(); world.setCond(custom || dive ? null : LEVEL_COND[i + 1]); if (!custom) world.setStoryMood(LEVEL_MOOD[i + 1]); tickWorld(engine, performance.now());
    held.clear(); heldOrder = []; acc = 0; overTimer = 0; lowAirBeep = 0; resultShown = false; endTouch();
    $('#introNum').textContent = dive ? `Daily Dive · ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : `Level ${i + 1} of ${LEVELS.length}`; $('#introName').textContent = lv.name; $('#introHint').innerHTML = rich(lv.hint); { const st = $('#introStory'); st.textContent = !custom && LEVEL_STORY[i + 1] || ''; st.hidden = !!custom || !LEVEL_STORY[i + 1]; }
    { const cv = $('#introPrev'), wide = matchMedia('(orientation: landscape) and (min-width: 760px) and (min-height: 560px)').matches, w = wide ? 560 : 620, h = wide ? 490 : 340; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      levelPhoto(cv, i, false, !!dive); }
    { const g = $('#introGoals'), t = engine.time; if (engine.relaxed || dive) { g.innerHTML = dive ? '<span class="goal dd">☀ Race the clock: fastest time wins today</span>' : '<span class="goal">Relaxed mode: no air timer</span>'; }
      else g.innerHTML = `<span class="goal g3"><b>★★★</b>${Math.ceil(t * 0.6)}s+ air left</span><span class="goal g2"><b>★★<i>★</i></b>${Math.ceil(t * 0.3)}s+</span><span class="goal g1"><b>★<i>★★</i></b>finish</span>`;
      if (!dive && relicCell(i)) g.insertAdjacentHTML('beforeend', (save.relics || {})[i + 1] ? '<span class="goal relic got"><i class="rl"></i>Keeper’s coin found</span>' : '<span class="goal relic"><i class="rl"></i>A Keeper’s coin is hidden here</span>');
      const st = !dive && save.stars[i + 1], bb = $('#introBest'); bb.hidden = !st; if (st) bb.textContent = `Your best ${'★'.repeat(st)}${'☆'.repeat(3 - st)}`; }
    { const m = lv.map.join(''), n = ch => m.split(ch).length - 1, items = [['pearl', engine.ballsTotal, 'pearl', 'pearls'], ['stone', n('R') + n('X'), 'stone', 'stones'], ['fish', n('F'), 'piranha', 'piranhas'], ['jelly', n('J'), 'jellyfish', 'jellyfish'], ['crab', n('C'), 'crab', 'crabs'], ['air', n('A'), 'air capsule', 'air capsules']].filter(x => x[1] > 0);
      needIcons(items.map(x => x[0])); $('#introKit').innerHTML = items.map(([k, c, one, many]) => `<span class="kit"><i class="kic" style="--ic: var(--ic-${k})"></i><b>${c}</b><span>${c === 1 ? one : many}</span></span>`).join('') +
        `<span class="kit k-air"><i class="kic o"></i><b>${engine.relaxed ? '∞' : Math.round(engine.time)}${engine.relaxed ? '' : 's'}</b><span>${engine.relaxed ? 'no timer' : 'of air'}</span></span>` +
        ((!dive && COND_CHIP[LEVEL_COND[i + 1]]) ? (([ic, k, d]) => `<span class="kit k-cond"><i class="kic e" aria-hidden="true">${ic}</i><b>${k}</b><span>${d}</span></span>`)(COND_CHIP[LEVEL_COND[i + 1]]) : ''); }
    screenStack = []; setState('intro'); show('intro'); hudKey = ''; updateHud();
    applyAudio();
  }
  // ---- spotlight tutorial: the first time a level brings something new, the game waits, the screen dims and a ring of light
  // circles exactly the thing the words talk about (so a voice-over line always matches the picture). One short, plain line per
  // step; tap (or Enter/Space) for the next. Each step has a voice id: drop src/assets/vo/<id>.mp3 in and it plays with the step.
  const touchUI = () => document.body.classList.contains('touch');
  const TUT_STEPS = {
    0: [{ at: 'player', id: 't1a', k: 'Meet the diver', text: 'This is **you**. Swim, dig and push your way to the gate.' },
        { at: 'ball', id: 't1b', k: 'Energy pearl', text: 'This red pearl is **full of light**. The gate needs it.' },
        { at: 'gate', id: 't1c', k: 'The gate', text: '**Push the pearl in** to wake the gate, then swim in yourself.' },
        { at: '#hud .air', id: 't1d', k: 'Your air', text: 'Air starts on your **first move**, so look around first. Finish before it runs out!' },
        { at: 'player', id: 't1e', k: 'How to swim', text: () => touchUI() ? '**Swipe** to swim. Swim into sand to **dig** through it.' : 'Use the **arrow keys** to swim. Swim into sand to **dig** through it.' }],
    1: [{ at: 'rock', id: 't2a', k: 'New: stones', text: 'Take the sand away **under a stone** and it falls.' },
        { at: 'player', id: 't2b', k: 'Stay safe', text: '**Never stand right under** a stone!' }],
    2: [{ at: 'rock', id: 't3a', k: 'Good to know', text: 'Falling stones and pearls **roll off round things**, and they roll **left first**.' }],
    4: [{ at: 'fish', id: 't5a', k: 'New: piranha', text: 'It patrols the water and **charges** the moment it sees you.' },
        { at: 'rock', id: 't5b', k: 'Fight back', text: '**Drop a stone** on it to stop it for good.' }],
    5: [{ at: 'jelly', id: 't6a', k: 'New: jellyfish', text: 'It drifts up and down its shaft. Cross when it is **far away**.' }],
    8: [{ at: 'crab', id: 't9a', k: 'New: crab', text: 'It scuttles back and forth. **Stay out of its path!**' }],
    11: [{ at: 'airc', id: 't12a', k: 'New: air capsule', text: 'Swim into it for **+45 seconds** of air.' }] };
  const TUT = { on: false, steps: null, i: 0, t0: 0, raf: 0 }; let skipTut = false; // tests start levels directly, without the tutorial
  function tutTarget(st) { const e = engine; if (!e) return null; if (st.at[0] === '#') return { el: document.querySelector(st.at) };
    const want = { player: T.PLAYER, ball: T.BALL, rock: T.ROCK, fish: T.FISH, jelly: T.JELLY, crab: T.CRAB }[st.at], pl = e.player || { x: 0, y: 0 };
    if (st.at === 'gate') return { x: e.gate.x, y: e.gate.y };
    if (st.at === 'player') return pl ? { x: pl.x, y: pl.y } : null;
    let best = null, bd = 1e9; const near = (x, y) => { const d = Math.abs(x - pl.x) + Math.abs(y - pl.y); if (d < bd) { bd = d; best = { x, y }; } };
    if (st.at === 'airc') { for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) if (e.get(x, y) === T.AIR) near(x, y); return best; }
    for (const o of e.objects.values()) if (o.t === want) near(o.x, o.y); return best; }
  function tutPlace() { if (!TUT.on) return; const st = TUT.steps[TUT.i], tg = TUT.tg, ring = $('#tut .tut-ring'), bub = $('#tut .tut-bub'); if (!tg) return;
    let cx, cy, w, h; if (tg.el) { const r = tg.el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; w = r.width + 18; h = r.height + 18; ring.classList.add('rect'); }
    else { const [ax, ay] = world.toScreen(tg.x, tg.y), [bx] = world.toScreen(tg.x + 1, tg.y), cell = Math.abs(bx - ax); cx = ax; cy = ay; w = h = Math.max(64, cell * 1.55); ring.classList.remove('rect'); }
    ring.style.left = (cx - w / 2) + 'px'; ring.style.top = (cy - h / 2) + 'px'; ring.style.width = w + 'px'; ring.style.height = h + 'px';
    const bh = bub.offsetHeight || 120, below = cy < innerHeight * 0.5; let top = below ? cy + h / 2 + 22 : cy - h / 2 - 22 - bh; top = Math.max(12, Math.min(innerHeight - bh - 12, top)); bub.style.top = top + 'px'; }
  function tutShow() { const st = TUT.steps[TUT.i]; TUT.tg = tutTarget(st); if (TUT.tg && !TUT.tg.el) world.focus = { x: TUT.tg.x, y: -TUT.tg.y }; /* phones: the camera glides to what the line is about */ TUT.t0 = performance.now(); const txt = typeof st.text === 'function' ? st.text() : st.text;
    $('#tut .tut-txt').innerHTML = rich(txt); $('#tut .tut-step').textContent = st.k || (TUT.steps.length > 1 ? 'How it works' : 'New!');
    { const ic = { player: 'diver', ball: 'pearl', rock: 'stone', fish: 'fish', jelly: 'jelly', crab: 'crab', airc: 'air', gate: 'gate' }[st.at] || (st.at === '#hud .air' ? 'airm' : 'diver'), el = $('#tut .tut-ic');
      if (['pearl', 'stone', 'fish', 'jelly', 'crab', 'air'].includes(ic)) { needIcons([ic]); el.style.setProperty('--ic', `var(--ic-${ic})`); } else if (ic === 'diver') { const th = diverThumb(); el.style.setProperty('--ic', th ? `url("${th}")` : 'none'); } else el.style.removeProperty('--ic');
      el.dataset.ic = ic; $('#tut .tut-dots').innerHTML = TUT.steps.length > 1 ? TUT.steps.map((_, k) => `<i class="${k === TUT.i ? 'on' : k < TUT.i ? 'done' : ''}"></i>`).join('') : ''; }
    $('#tut .tut-next').textContent = TUT.i < TUT.steps.length - 1 ? 'Next' : "Let's dive";
    const b = $('#tut .tut-bub'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); Audio.stopVo(); Audio.vo(st.id === 't1e' && !touchUI() ? 't1e_k' : st.id); Audio.play('click'); }
  function startTut(idx) { const steps = TUT_STEPS[idx]; if (!steps || dive || skipTut) return false; save.tutSeen = save.tutSeen || {}; if (save.tutSeen[idx]) return false;
    TUT.on = true; TUT.idx = idx; TUT.steps = steps.filter(st => tutTarget(st)); if (!TUT.steps.length) { TUT.on = false; return false; } TUT.i = 0; setState('tut');
    $('#tut').classList.add('on'); tutShow(); tutPlace(); return true; }
  function tutNext() { if (!TUT.on || performance.now() - TUT.t0 < 350) return; TUT.i++; if (TUT.i < TUT.steps.length) { tutShow(); return; } endTut(); }
  function endTut() { if (!TUT.on) return; TUT.on = false; Audio.stopVo(); $('#tut').classList.remove('on'); world.focus = null;
    save.tutSeen = save.tutSeen || {}; save.tutSeen[TUT.idx] = 1; save.tipsSeen = save.tipsSeen || {}; save.tipsSeen[TUT.idx] = 1; persist();
    setState('playing'); lastFrame = performance.now(); acc = 0; world.lastTick = performance.now(); banner(); } // like beginPlay: the frame loop keeps its own clock (frame.last)
  $('#tut').addEventListener('click', ev => { if (ev.target.closest('.tut-skip')) { click(); TUT.t0 = 0; endTut(); return; } tutNext(); });
  function beginPlay() { if (state !== 'intro' && state !== 'paused') return; const fromIntro = state === 'intro'; setState('playing'); setTimeout(dangerScan, 0); show(null); lastFrame = performance.now(); acc = 0; world.lastTick = performance.now(); if (fromIntro) { world.startPlay(); startBeats(!!arriveNext); let arrived = false; if (arriveNext) { const kind = typeof arriveNext === 'string' ? arriveNext : 'pipe'; arriveNext = false; arrived = true; world.arrive(kind); const li = levelIdx; setTimeout(() => { if (state === 'playing' && levelIdx === li && engine && !engine.begun) startTut(li); }, 1700); } /* the tutorial waits for the pop-out */ if (arrived || !startTut(levelIdx)) { banner(); levelReveal(); if (!skipTut) { world.peek = true; clearTimeout(beginPlay.pk); beginPlay.pk = setTimeout(() => { if (!mapBtn.classList.contains('on')) world.peek = false; }, 1500); } } } } // phones: a look at the whole tank first, then the camera glides down to the diver
  let bannerTimer = null;
  function levelReveal() { if (!engine || replay || CLIP) return; const pts = []; for (const o of engine.objects.values()) if (o.t === T.BALL) pts.push({ x: o.x, y: o.y }); pts.sort((a, b) => a.x - b.x || a.y - b.y);
    if (engine.gate) pts.push({ x: engine.gate.x, y: engine.gate.y, gate: true }); let k = 0; world.onReveal = p => { if (p.gate) { Audio.play('hint'); world.popText(p.x, -p.y + 0.62, 'Gate', '#8ff4ff'); } else Audio.pearl(++k); }; world.reveal(pts); }
  // ---- level-1 coach: follows the verified winning route. When the player hesitates it shows a glowing trail to where the
  // diver should go next and, once there, an animated hand (key cap on computers) showing which way to swipe.
  // If the pearl ends up somewhere the route can't recover from, it points at Undo instead.
  // verified winning route of every level (synced from tests/routes.json by tools/build.py): drives the level-1 coach and "Show me" hints
  // Daily Dive puzzles (verified with tools/solver; see tools/solver/daily/), one per day in a fixed shuffle
  const DAILY_LEVELS = /*daily*/[{"name":"Two Pockets","time":135,"hint":"The gate swallows pearls dropped from above, but there is room beside it for only two stones.","map":["###################","#P................#","#.B.R.R....R....B.#","#WWWWWWWW WWWW WWW#","#WWWWWWWW WWWWWWWW#","#WWWWWWWW WWWWWWWW#","#WWWWWWWW WWWWWWWW#","#WWWWWWWW WWWWWWWW#","#WWWWWWW   WWWWWWW#","#WWWWWWW E WWWWWWW#","###################"],"route":"RRRRRRRDRLLULLDRRR.........LLLULLDRRRRR.........LLLLLULLDRRRRRRR.......RRURRDRRLLULLDRRR..RRURRDLLLLLLL.......LDDDDDDD."},{"name":"Left First","time":85,"hint":"Falling pearls roll left first. Be the wall on the left when they land.","map":["################","#.............P#","#WWWW.WBWWWW.WW#","#WWWW.WBWWWW.WW#","#WWWW. . WWW.WW#","#WWWWW W WWW.WW#","#WWWWW       EW#","################"],"route":"LLLLLLLLLDDDRRL....DDRRRRRRUUUUULLLLLLLDDDRDDRRRRRRR."},{"name":"Siding","time":130,"hint":"A pearl drops first. Park it out of the way and let the stone through to fill the gap.","map":["#################","#P.........WWWWW#","#    B R B.WWWWW#","#WWWWWWWWW WWWWW#","#WWWWW.... .....#","#WWWWW          #","#WWWWWWWWWWW WW #","#WWWWWWWWWWWWWW #","#WWWWWWWWWWWWWWE#","#################"],"route":"RRRRRRRRRDU....DDDRDLLLRRUUUULLLLDRRR....RDDLDRR..LLLULLDRRRRRRRR...LLLLUUUULLLLLLDRRRRR....RDDLDRRRRR...RDDD."},{"name":"Stone Clock","time":120,"hint":"Pearls crush crabs too. Drop the right-hand pearl just as the crab walks under it.","map":["##################","#P...............#","#..W.BW.WBWWWWWWW#","#W.W..W...WWWWWWW#","#W.WW WWW WWWWWWW#","#W.WW WWW WWWWWWW#","#W.WW WWW WWWWWWW#","#W.         C   E#","#WWWWWWWWWWWWWWWW#","##################"],"route":"RRRRRRDDR....RL.....LUULLLLLDDDDDDRRRRRRRRRRRRRLLLLLLLLLLLLLUUUUUURRDDRL....UULLDDDDDDRRRRRRRRRRRRRR."},{"name":"Pedestal","time":90,"hint":"The pearl rides on a stone. Work it loose from the gate side, and keep its left side packed.","map":["##################","#P...............#","#................#","#................#","#.......B........#","#...B.. R       E#","#WWWWWW .WWWWWWWW#","##################"],"route":"RRRRRRRRRDDDDLLR.UULLDDRRRRRRRRLLLLLLLLLLULLDRRRRRRRRRRRRR."},{"name":"Glancing Blow","time":90,"hint":"Stones roll off pearls. Put a pearl under the drop before the stone comes down.","map":["###############","#P............#","#........R....#","#.............#","#.WWWWWWW   B.#","#.WWWWWW  WWWW#","#..B      EWWW#","#WWWWWWW .WWWW#","###############"],"route":"RRRRRRRRRRRRDDDLL....LULR......DLDLDRUUULLLLLLLLDDDRRRRRRRRR."},{"name":"Jelly Lift","time":115,"hint":"Whatever goes down the jelly shaft first clears the way. Make it the stone.","map":["##################","#P...............#","#  B     .   R   #","#WWWWWWWW WWWWWWW#","#WWWWWWWW WWWWWWW#","#WWWWWWWWJWWWWWWW#","#WWWWWWWW WWWWWWW#","#WWWWWW.  WWWWWWW#","#WWWWWW.        E#","#WWWWWWWWWWW WWWW#","##################"],"route":"RRRRRRRRDURRRRRDLLLL.......LDDDDDLDRRR..LLUUUUUULLLLLULLDRRRRRR...........RDDDDDLDRRRRRRRR."},{"name":"Stair Roll","time":110,"hint":"The stairs carry anything to the gate, but the pit halfway down keeps the first thing that rolls in.","map":["################","#P.............#","# B B  .R..R...#","#WWWWW  .......#","#WWWWWW  WW WWW#","#WWWWWWW  W WWW#","#WWWWWWW    WWW#","#WWWWWWWWW  WWW#","#WWWWWWWWWW WWW#","#WWWWWWWWWWEWWW#","################"],"route":"RRRRRRDDRL.....LUULLLDRR....................LLULLDRRRR....................RRDDRDRDRDRDD."},{"name":"Fish Trap","time":105,"hint":"Stones and pearls both crush piranhas. Fill the dip first, and catch the fish on the way.","map":["#################","#...B.R.P.......#","#...............#","#.WW.W WWWWWWWWW#","#.WW.W WWWWWWWWW#","#.WW.W WWWWWWWWW#","#.B        F   E#","#WWWWW WWWWWWWWW#","#################"],"route":"LDLR......LLLLUDRR.........LDDDDRRRRRRRRRRLLLLLLLLLLUUUULLLDDDDRRRRRRRRRRRRRR."},{"name":"Lead Weight","time":100,"hint":"Lead each stone down the chimney and step out on the side you will push from.","map":["################","#WWWWWWWBWWWWWW#","#WWWWWWW.WWWWWW#","#WWWWWWWRWWWWWW#","#WWWWWWW.WWWWWW#","#WWWWWWWBWWWWWW#","#WWWWWWW.WWWWWW#","#WWWWWWWRWWWWWW#","#P.......    EW#","#WW W WW.WWWWWW#","#WWWWWWWWWWWWWW#","################"],"route":"RRRRRRRR.LLL..RRUUDDL.RRRRRLLLLUUUUDDDDR.LLLLL..RRRRUUUUUUDDDDDDL.RRRRRR."},{"name":"Crab Crossing","time":105,"hint":"Only the right-hand shaft reaches the crab. Drop that stone as it walks underneath; the left one just fills a hole.","map":["####################","#P...R .....R .....#","#.WWW. WWWWW. WWWW.#","#.WWWW WWWWWW WWWW.#","#.B     .   C    ..#","#WWWWW WWWWWW WWWWE#","####################"],"route":"RRRR.RRRRRRRRRRLDDDLLLLLRRRRRRRRRRLLLLLUUULLLLLLLLLLLLDDDRRRRRRRRRRRRRRRRRRD."},{"name":"Twin Claws","time":85,"hint":"One stone, two crabs. Wait until both claws line up under the shaft.","map":["######################","#P.......R ..........#","#WWWWWWWW. WWWWWWWWW.#","#WC         B        #","#WWWWWWWWW WWWWWWWWW #","#W C        B        #","#WWWWWWWWW WWWWWWWWW #","#WWWWWWWWWWWWWWWWWWWE#","######################"],"route":"RRRRRRR.......RDDRRRRRRRRRRRLLLLLLLLLDDRRRRRRRRR..RDD."},{"name":"Jelly Bridge","time":80,"hint":"The shafts are too deep to fill. Push the pearl across as the jellyfish rises under the road, then step back.","map":["#######################","#P....................#","#.B                 B.#","#WWWWWWWW.   .WWWWWWWW#","#WWWWWWWWW EJWWWWWWWWW#","#WWWWWWWWWJW WWWWWWWWW#","#WWWWWWWWWWWWWWWWWWWWW#","#WWWWWWWWWWWWWWWWWWWWW#","#######################"],"route":"DRRRRRRR....R.RLURRRRRRRRRRRRDLLLLLLL....LLRLLDD."},{"name":"Rolling Plug","time":90,"hint":"A falling stone rolls left first. Dig the right pocket before the drop, and the left one only after.","map":["#############","#WWWWWW R..P#","#WWWWWW .WW.#","#WWWWWWJWWW.#","#WWWWWW WWW.#","#WWWWWW ....#","#WWWWW. . B.#","#WWWWW W WWW#","#WWWWWEWWWWW#","#############"],"route":"DDDDLLLDURRRUUUULLL........LDDDDDLRUUUUURRRRDDDDDLLLL..LDD."},{"name":"Crab Fence","time":80,"hint":"You don't have to crush the crab. Drop the stone when it's on the far side and fence it in.","map":["######################","#P...R ..............#","#WWW. WWW.W.WWWWWWWWW#","#WWWW WWW.W.WWWWWWWWW#","#WW  C    B R       E#","#WWWWWWWWWWWWWWW WWWW#","#WWWWWWWWWWWWWWWWWWWW#","######################"],"route":"RRR....R....RRRRRRDDDRRRRLLLLUUULLDDDRRRRRRRRRRR."},{"name":"Fish Hook","time":85,"hint":"A stone in the pond would block the road. Drop the pearl on the piranha when it swims up the chute.","map":["#####################","#P...............B .#","#.WWWWWWWWWWRWWWW. .#","#............WWWWW .#","#WWWWWWWWWWW WWWWW .#","#EF                .#","#WWWWWWWWWWWWWWWWWWW#","#####################"],"route":"RRRRRRRRRRRRRRR.............R.RRDDDDLLLLLLLLLLLLLLLLLL."},{"name":"Pit Count","time":95,"hint":"The deep pit takes two stones, the shallow one only one. The middle stone belongs to the deep pit.","map":["#####################","#P     R    R    R  #","#.WWWWWWWW WWWW WW.W#","#.WWWWWWWW WWWW WW.W#","#.B                E#","#WWWWWWWWW WWWW WWWW#","#WWWWWWWWWJWWWWWWWWW#","#####################"],"route":"RRRRRRRR...RDDDRRRRRRRRUUULL.LLLLL.LLLLLLLLLLDDDRRRRRRRRRRRRRRRRRR."},{"name":"Crab Bait","time":95,"hint":"The crab never leaves its den by itself. Dig through, let it chase you under the stone, then pull the plug.","map":["################","#P............W#","#.WWWWWWWWWWW.W#","#.WWWWWWWWWWR.W#","#.WWWWWWWWWW..W#","#.B C  .......E#","#WWWWWWWWWWW WW#","################"],"route":"RRRRRRRRRRRRDDDDLLLLL.LRRRRRRULRUUULLLLLLLLLLLLDDDDRRRRRRRRRRRRR."},{"name":"Crab Herding","time":105,"hint":"Push the pearl to herd the crab into the corner under the shaft, then drop the stone on it.","map":["#####################","#W R.........P......#","#W ..WWWWWWWW.WWWWW.#","#W W.WWWWWWWW.WWWWW.#","#W W.WWWWWWWW.WWWWW.#","#E    C     B     B.#","#W WWWWWWWWWWWWWWWWW#","#####################"],"route":"DDDDLL..L.L.L.L.L.L.LUUUUL....DRDDDLLUUUURRRRRRRRRRRRRRRRRDDDDLLLLLLLLLLLLLLLLLL."},{"name":"Fish Elevator","time":80,"hint":"The piranha rides up the shaft now and then. Drop the stone while it is inside.","map":["######################","#WWWWWWWWW R.......PW#","#WWW WWWWW .WWWWWW.WW#","#WWW WWWWW WWWWWWW.WW#","#WWW WWWWW WWWWWWW.WW#","#EF              B WW#","#WWWWWWWWW WWWWWWWWWW#","######################"],"route":"LLLLLLL.....L...RRRRRRRDDDDLLLLLLLLLLLLLLLLL."}]/*end*/;
  const ROUTES = /*routes*/{"1":"DDDRRRL..DRRRRRRL..UULLLLDLDR..R..R..R..R..R..R","2":"RRRRDDDRRRRL...LLLLDDRRRRR.","3":"RRRRRRRRDLLULLLLDRR..RDDRDD.","4":"DDDRRRRRRRRRRLLLLUDL.RRRRRR.","5":"LLLLULLLLLLDD...LRURRRDDDLLUDL.RRRRRRRRRR.","6":"RRRRDR........RDRRRRRDDDLLLLLLLLLLL.","7":"RRRRDDRRUDL...RRLLLUULLLLDDRRRRRRRRRRRRR.","8":"LLULLLLLLLLLDRRRRRLLLLLLDDDDRRRRRRRRRRRR.","9":"LLLLLLLLLLDLLLLLD.......DRRRRRR.....R.RRDDRDLLLLLLLLLL.","10":"RRRDDDDRRRRLUUUDDDL.RRLRRRRRRUULLULLDDRDR...LLLLLLLLULLDRRRRRRRRRRRRRR.","11":"LLLLLLLLLLLLLDDRRRRRRRR.....LLLLLLLLDDRRRRRRLLLLLLUULLDDRRRRRRRRRRRRR.","12":"URRRDRRRRRRRRRRRRRLLLLLLLLLLLLLULLDRRRRRRRRRRRRRRRLLLLLLLLDURRRRRRRRRRRDDDDLLLLLLLLLLLLLLLLULLDDDRRRRRRRRRRRRRRRRRLLLLLLLLLLLLLLLLUURRRRRRRRRRRRRRUURUURRDDDDLLLLLLLUDLLLLLLLLLULLDDDRRRRRRRRRRRRRRRRRR.","13":"RRDDUU....RRRRRRRRRRRRRRDDDDDLLLLLLLLLLLLUUUDDDRR......LLUUUUURRRRRRRRRRRRDDDDDLLLLLLLLLLL.LD.","14":"RRRDDR....RRRRURRDLLLLRRRRRRRRUD...LRURRDLLLUDLLLLLLLLLLLULLDRRRRRRRRRRR.....RDDDDD.","15":"RRDDDDDLRRRLLUUUUURRRRRDDDDDLLL..LLUUUURRRRRDDDDUUUUULLLLLDDDDDRRRR..LLLLRRRRRUUUUURRRRDDDDDLRRRRRLLLLUUUUULLLLDDDDDRRRRUUUUULLLLDDDDDRRRRRRRLLLUUUUULLLLDDDDDRRRRRRLLLLLLLLLLL.LD.","16":"DDDDDDDRURRRDRRRLLLLULLDRRRRRRRLLLLUUUUUUURRRRRRRR....RDDDDDDLLUULLLRUULLLDDRRRRLDUUULLLDDRR....RDDDD.","17":"DDDRRRRRRRL.RRRRRR.RRRRRUUULLLLLLLRRRRRRRDDDLLLLLLLLLLLLLLLLLUUURRRRRRRRRRRRRRRLRRRDDDLLLLLLLLLLLLLLLRLLLDDDRRRRRRRRRRRRRRRRR.","18":"UUUUURRRRRRRRRRRRRRRRDDDDR..RL....DRLLLLLLLLLLLLUDL.RRRRRLLLLLLLUUDDL.RRRRRRRRRRRRRRRRRR.","19":"RRRRRRRRRRRRDLULLDRLLLLULLDRRLLULLDRRRRLLLLULLDRRRRRRURRRRRRRRDLURRRDLLLLLLU..........LLDDDDRDDRDDD.","20":"RRRRRDDDDLRRLUUUURRRRRRRRRRRDDDDLLLLLLLLLLLRRRR.RRRRRRRUUUU..LL...LLLLLLLLLDDDDRRRRRRRRRRRUUUULLLLLLLLLLLDDDDRRRRRRRRRRRUUUULLLLLLLLLLLLLLLDDDDRRRRRRRRRRRRRRRR.","21":"DDDDDLLLLLLLLLLLLLUUUULLULRRRR..........LDDDDDLLLLLLLRRRRRRRRRRRRRRRRRRRRUUUUULLLLLLRRRRRRDDDDDLLLLLLLLLLLLLLLLLLLLL.","22":"RRRRRRRRRRRRRRRRRDLRDDLDLDLDLLLLRRRRURURURUULULLLLLLLLLLLLDRR....RR...RURRLLDDDDDDLRUUUUUULLLLLLLLDRRRRRRURRRRRDL.........RURRDLLLULLDURDLDDDDDRDD.","23":"RUUURRRRRRRRRRRRRRRRRRRRDDDLLLLLLLLLLLLUDR..RRRRRRRRRRRUUULLLLLLLLLLLLLLLLLLLLDDDRRUDRRRRUDRRRRRUDRRRRRUDRRR.RUUULLLLLLLLLLLLLLLLLLLLLRDDDLDDDDRRRRRUDRRRRRRUDRRRRRUDRRRRR.","24":"RRRRDU......RRRRRRRR..DU.....RRRR...DU....RRDDDDLLLLLLLLLLLLL.LRRRRRRRRRRRRRRUUUULLLLLLLLLLLLLLLLLLDDDDRRRRR..RRRRRRRRRRRRRR.","25":"RRRRRDDD....DLLR......RUUUURRRRDDDDRRL......LUUUULLLLDDDDRRL....DRRRRRRRRRRRRLLLLLLLLLLLLULUUUULLLLLDDDDDRRRRRRRRRRRRRRRRRRR.","26":"RRRRRRDDDDLLRULLR....RRUUULLLLLLDDDDRRL...LUUUURRRRRRDDDDDDR....RL....DLUUUUUUURRRRRRRDDDDDDRR.L.....LDLLRRRRRRLLLLUUUUUUURRRRRRRRDDDDDDLLR....RDLLLLLLLLLLLLLLLLLLL.","27":"RRDD..U...RRRRRRRRRURRRRRRD....DU....LLLLULLLLDDU....DDDLLLLLRRRRRRRRRRLLLLLLLUUUULLLLLLLDDDDRRRRRRRRRRRRRRRRRRRRLLLLLLLLUDL.RRRRRRRRRR.","28":"RRRRRDRRURRDLLRRURRDLLLLRRRRURRRDRRRRURRDLLLL.....LLLLRLULLLLLLDLDDDDRRRRRRRRRRRRRRRDULLLLLLLLLLLLLLLUUUURRRRRRRRLLLLLLLLDDDDRRRRRRRRRRRRRRLLLLLLLLLLLLLLUUUULLRLULLDRRRLLLLLDDDDRRRRRRRRRRRRRRRRRRRR..RDD.","29":"RRDD......U...RRRRRRRRUDDU........RRRRRRRUD......DU....RRDU...LLLLLLLLLDDDLLLLLLRRRRRRRRRRRLLLLLDDDDRRRRRRRRRRLLLLLLLLLLLLLLLLLLLLUUUURRRRRRRRRLLLLLLLLLDDDDRRRRRRRRRRRRRRRRRRRRLLLLLLLLLLUUUUUURRRRRRRRRRRDDLLLLLLLLLLRLLLLLLLLLLLLDDDDRRRRRRRRRRRRRRRRRRRRR.","30":"RRRRDU....RRRRRRRDU..........RRDURRDLLLLLLLDDDDDRRRRRRRRRLLLLLLLLLLLUUULRDDDLRRRRRUUUUUULLLLLLLLLLDDDRRRRRLLLLLUUURRRRRRRRDDDDDDUUUUUULLLLLDDDRRRDDLDRRRRRRRRRRRRLLLLLLLUUUUUULLLDULLDRRLLLLLLLUDDDRRRRRRDDDRRRRRRRRRRRLLLLLLLUUUUUURRRRRRDLLLLLULLLDDDDDDRRRRRRRRRR."}/*end*/;
  const COACH = { on: false, auto: false, hint: 0, route: '', lvl: null, refs: null, idle: 0, lastP: '', ck: '', undoShown: false };
  const objKey = (e) => { const a = []; for (const o of e.objects.values()) if (o.t === T.ROCK || o.t === T.BALL) a.push(o.x + ',' + o.y); return a.sort().join(';') + '|' + e.ballsIn; };
  function coachStart(i, custom) { COACH.auto = i === 0 && !custom; COACH.hint = 0; COACH.plan = null; COACH.replanKey = ''; planJob++; HINT.busy = false; undoHold = false; planHold = false; COACH.on = COACH.auto; COACH.idle = 0; COACH.ck = ''; COACH.undoShown = false; world.setCoachTrail(null); coachHand(null);
    const lv = custom || LEVELS[i], route = custom ? custom.route || '' : ROUTES[i + 1] || ''; if (COACH.lvl !== lv) { COACH.lvl = lv; COACH.route = route; COACH.refs = null; } }
  function coachRefs() { if (COACH.refs || !COACH.route) return COACH.refs;
    const e = new Engine(COACH.lvl); e.time = e.oxygen = 9999; const M = { U: 'up', D: 'down', L: 'left', R: 'right' }; const R = COACH.refs = [{ key: objKey(e), p: [e.player.x, e.player.y] }];
    for (const c of COACH.route) { if (c !== '.') e.press(M[c]); e.step(); R.push({ key: objKey(e), p: e.player ? [e.player.x, e.player.y] : null }); }
    R.keys = new Set(R.map(r => r.key)); return R; }
  // what the next move does, in two or three words, shown beside the hand
  function coachSay(pl, dir) { const e = engine, d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[dir]; if (!e || !d || !pl || (e.gate && e.gate.open)) return ''; /* the gate's own 'Swim in!' marker says it */
    const t = e.get(pl[0] + d[0], pl[1] + d[1]); return t === T.SAND ? 'Dig!' : t === T.BALL ? 'Push the pearl!' : t === T.ROCK ? 'Push the stone!' : t === T.GATE ? 'Swim in!' : t === T.AIR ? 'Grab the air!' : 'Swim this way'; }
  function coachHand(pos, dir) { const h = $('#coachHand'); if (!pos) { h.classList.remove('on'); return; } { const sy = h.querySelector('.ch-say'); if (sy) sy.textContent = coachSay(engine && engine.player ? [engine.player.x, engine.player.y] : null, dir); }
    h.style.left = pos[0] + 'px'; h.style.top = pos[1] + 'px'; h.dataset.dir = dir; h.classList.add('on'); h.classList.toggle('keys', !document.body.classList.contains('touch')); }
  function coachPath(e, from, to) { const W = e.w, H = e.h, prev = new Int32Array(W * H).fill(-1), q = [from[1] * W + from[0]]; prev[q[0]] = q[0]; const goal = to[1] * W + to[0];
    const ok = (x, y) => { const t = e.get(x, y); return t === T.EMPTY || t === T.SAND || t === T.AIR || (t === T.GATE && e.gate.open && x === to[0] && y === to[1]); };
    for (let qi = 0; qi < q.length; qi++) { const c = q[qi]; if (c === goal) break; const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy, n = ny * W + nx; if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev[n] >= 0 || !ok(nx, ny)) continue; prev[n] = c; q.push(n); } }
    if (prev[goal] < 0) return null; const out = []; for (let c = goal; c !== prev[c]; c = prev[c]) out.push([c % W, (c / W) | 0]); return out.reverse(); }
  function coachTick(realDt) {
    COACH.on = COACH.auto || COACH.hint > 0;
    if (!COACH.on || state !== 'playing' || !engine || !engine.player || engine.state !== 'playing') { if (COACH.trail) { COACH.trail = false; world.setCoachTrail(null); coachHand(null); } return; }
    const pk = engine.player.x + ',' + engine.player.y; if (pk !== COACH.lastP) { if (COACH.lastP && COACH.hint > 0) { COACH.hint--; if (!COACH.hint) { if (!COACH.auto) COACH.plan = null; COACH.trail = false; world.setCoachTrail(null); coachHand(null); hintSync(); return; } } COACH.lastP = pk; COACH.idle = 0; if (!COACH.hint) { COACH.trail = false; world.setCoachTrail(null); coachHand(null); } } else COACH.idle += realDt;
    const wait = COACH.hint > 0 ? 0 : save.stars[1] ? 6 : COACH.firstDone ? 3.5 : 1.2; if (COACH.idle < wait) return;
    const cur = objKey(engine), ck = pk + '|' + cur + '|' + engine.gate.open; if (ck === COACH.ck && COACH.trail) return; COACH.ck = ck; // nothing changed since the last hint drawn
    const pl = [engine.player.x, engine.player.y]; let target = null, dir = null; const R = COACH.plan ? COACH.plan.refs : coachRefs(); if (!R) return; const RT = COACH.plan ? COACH.plan.route : COACH.route;
    if (engine.gate.open) target = [engine.gate.x, engine.gate.y];
    else { let j = -1; for (let k = R.length - 1; k >= 0; k--) if (R[k].key === cur) { j = k; break; }
      if (j < 0) { world.setCoachTrail(null); coachHand(null); COACH.trail = false;
        if (!HINT.busy && COACH.replanKey !== cur) { COACH.replanKey = cur; findPlan(plan => { COACH.plan = { route: plan, refs: planRefs(engine, plan) }; COACH.ck = ''; }); return; } // re-plan from here (free)
        if (HINT.busy) return; if (COACH.hint > 0) { COACH.hint = 0; hintSync(); return; }
        if (!COACH.undoShown) { COACH.undoShown = true; toast(document.body.classList.contains('touch') ? 'Oops! Tap ↶ to undo' : 'Oops! Press Z to undo'); undoNeed(6000); $('#btnUndo').classList.add('nudge'); setTimeout(() => $('#btnUndo').classList.remove('nudge'), 4000); } return; }
      let k = j + 1; while (k < R.length && R[k].key === cur) k++; if (k >= R.length) target = [engine.gate.x, engine.gate.y];
      else { let m = k; while (m > 0 && RT[m - 1] === '.') m--; target = R[m - 1].p; dir = RT[m - 1]; } }
    if (!target) return; COACH.firstDone = true; COACH.trail = true;
    if (pl[0] === target[0] && pl[1] === target[1] && dir) { world.setCoachTrail(null); const sp = world.toScreen(pl[0], pl[1]); coachHand(sp, dir); }
    else { const path = coachPath(engine, pl, target); world.setCoachTrail(path); coachHand(null);
      if (path && path.length) { const first = path[0], d = first[0] > pl[0] ? 'R' : first[0] < pl[0] ? 'L' : first[1] > pl[1] ? 'D' : 'U'; coachHand(world.toScreen(pl[0], pl[1]), d); } } }
  function banner(small, big, line, ms) { const lv = dive || LEVELS[levelIdx], b = $('#lvlBanner'); if (!lv) return;
    let tip = line || ''; if (small === undefined && dive) { small = 'Daily Dive'; big = dive.name; tip = 'Same puzzle for every diver today. Go fast!'; ms = 2600; setTimeout(() => { if (state === 'playing') Audio.vo('n_daily'); }, 400); }
    let card = null; if (small === undefined) { small = `Level ${levelIdx + 1}`; big = lv.name; card = (lv.intro && !(save.tipsSeen || {})[levelIdx]) ? lv.intro : null; tip = ''; if (card) { save.tipsSeen = save.tipsSeen || {}; save.tipsSeen[levelIdx] = 1; persist(); } ms = card ? 4600 : 1900; }
    { const c = $('#lbCard'); c.hidden = !card; if (card) { if (!/^world/.test(card.ic)) needIcons([card.ic]); c.dataset.ic = card.ic; c.style.setProperty('--ic', /^world/.test(card.ic) ? 'none' : `var(--ic-${card.ic})`);
        $('#lbK').textContent = card.k; $('#lbT').textContent = card.t; $('#lbD').innerHTML = rich(card.d);
        if (card.ic === 'world2' || card.ic === 'world3') setTimeout(() => { if (state === 'playing') Audio.vo('n_' + card.ic); }, 500); } } // the narrator welcomes you to a new world
    $('#lbNum').textContent = small; $('#lbName').textContent = big; $('#lbTip').textContent = tip; b.classList.toggle('go', big === 'Swim in!');
    b.classList.add('on'); $('#lbWrap').classList.toggle('on', !!card); banner.start = small === `Level ${levelIdx + 1}` && !tip; clearTimeout(bannerTimer); bannerTimer = setTimeout(bannerOff, ms || 1900); }
  function bannerOff() { $('#lvlBanner').classList.remove('on'); $('#lbWrap').classList.remove('on'); } // the first move clears the name and the intro card (it covered the board)
  let toastTimer = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200); }
  // ---- "Show me" hints: the coach walks the next 5 moves of the level's verified route. One free hint every 90 s, or pay coins now.
  const HINT = { cost: 25, every: 90, readyAt: 0, busy: false };
  const hintFree = () => performance.now() >= HINT.readyAt;
  function hintSync() { const b = $('#btnHint'); if (!b) return; const free = hintFree(), left = Math.ceil((HINT.readyAt - performance.now()) / 1000);
    b.classList.toggle('on', COACH.hint > 0); const tg = b.querySelector('em'); const txt = COACH.hint > 0 ? COACH.hint : free ? 'free' : HINT.cost; if (tg.textContent !== String(txt)) tg.textContent = txt; b.classList.toggle('free', free && !COACH.hint);
    const lab = free ? 'Show me the next moves (free)' : `Show me the next moves (${HINT.cost} coins, free again in ${left}s)`; if (hintSync.lab !== lab) { hintSync.lab = lab; b.setAttribute('aria-label', lab); } }
  function showMe() { if (state !== 'playing' || !engine || engine.state !== 'playing') return; Audio.play('hint');
    if (!COACH.route) { toast('No hint for this dive'); return; }
    if (COACH.hint > 0) { COACH.hint = 0; if (!COACH.auto) COACH.plan = null; hintSync(); return; } // tap again to hide it
    if (HINT.busy || !coachRefs()) return;
    if (!hintFree() && save.coins < HINT.cost) { toast(`Free hint in ${Math.ceil((HINT.readyAt - performance.now()) / 1000)} s (or ${HINT.cost} coins)`); return; }
    findPlan(plan => { // charged only when there really is a way forward from this board
      if (!hintFree()) { save.coins -= HINT.cost; persist(); syncCoins(); toast(`Hint · −${HINT.cost} coins`); } else HINT.readyAt = performance.now() + HINT.every * 1000;
      runHint = true; COACH.plan = { route: plan, refs: planRefs(engine, plan) }; COACH.hint = 5; COACH.lastP = engine.player.x + ',' + engine.player.y; COACH.ck = ''; COACH.idle = 0; buzz(12); hintSync(); }); }
  // plan from the board as it is now (async); if the board moved on meanwhile, the answer is dropped
  function findPlan(ok) { if (!engine || !engine.player) return; HINT.busy = true; planHold = true; const b = $('#btnHint'); b.classList.add('busy'); const key = plKey(engine), t0 = performance.now(); let told = false;
    const tell = setTimeout(() => { told = true; toast('Thinking… (the reef waits for you)'); }, 350);
    planFrom(engine, coachRefs(), COACH.route, (plan, proven) => { clearTimeout(tell); HINT.busy = false; planHold = false; b.classList.remove('busy');
      if (state !== 'playing' || !engine || engine.state !== 'playing' || plKey(engine) !== key) return;
      if (plan === null) { noWayForward(proven); return; } ok(plan); }); }
  $('#btnHint').onclick = showMe;
  // nothing wins from here: say so plainly and offer to rewind to the newest moment that still has a way through
  function noWayForward(proven = true) { const msg = proven ? 'No way to finish from here.' : 'I couldn\'t find a way from here.'; COACH.hint = 0; COACH.plan = null; hintSync(); world.setCoachTrail(null); coachHand(null); const R = coachRefs(); let k = -1;
    for (let i = history.length - 1; i >= 0 && i >= history.length - 60; i--) if (plRoute(history[i], R, COACH.route) !== null) { k = i; break; }
    if (k >= 0) stuckCard(msg, `Rewind ${history.length - k} move${history.length - k === 1 ? '' : 's'}`, () => { history.length = k + 1; undo(true); setTimeout(showMe, 80); });
    else stuckCard(msg, 'Start over', () => { restart(); }); }

  // the board left the verified route: find the newest undo snapshot that's back on it and offer to rewind there
  function offRoute() { noWayForward(); }
  // ---- "Stuck? Undo": a pearl that can never reach the gate (below it, or boxed in on a solid floor) gets an immediate prompt
  function deadPearl(e) { if (!e.gate || e.gate.open) return null; const solid = (x, y) => { const t = e.get(x, y); return t === T.STEEL || t === T.WALL; };
    for (const o of e.objects.values()) { if (o.t !== T.BALL) continue; if (o.y > e.gate.y) return o; if (!o.falling && solid(o.x, o.y + 1) && solid(o.x - 1, o.y) && solid(o.x + 1, o.y)) return o; }
    return null; }
  let stuckKey = '';
  function checkStuck() { const o = deadPearl(engine); if (!o) { stuckKey = ''; return; } const k = o.id + '@' + o.x + ',' + o.y; if (k === stuckKey) return; stuckKey = k;
    stuckCard(o.y > engine.gate.y ? 'That pearl fell below the gate: it can never get back up.' : 'That pearl is boxed in: it can\'t reach the gate now.', history.length && (undoLeft > 0 || undoFree()) ? 'Undo' : 'Restart', () => { if (history.length && (undoLeft > 0 || undoFree())) undo(); else restart(); }); undoNeed(9000); buzz([20, 40, 20]); }
  let stuckCb = null;
  function stuckCard(msg, act, fn) { const c = $('#stuckCard'); $('#stuckMsg').textContent = msg; $('#stuckAct').textContent = act; stuckCb = fn; c.classList.add('on'); clearTimeout(stuckCard.tm); stuckCard.tm = setTimeout(() => c.classList.remove('on'), 9000); }
  const hideStuck = () => { $('#stuckCard').classList.remove('on'); stuckCb = null; };
  $('#stuckAct').onclick = () => { const f = stuckCb; hideStuck(); if (f) f(); };
  $('#stuckX').onclick = () => { click(); hideStuck(); };
  function pause() { if (state !== 'playing') return; endTouch(); setPeek(false); setState('paused'); syncSound();
    $('#pauseLvl').textContent = dive ? `Daily Dive · ${dive.name}` : `Level ${levelIdx + 1} · ${LEVELS[levelIdx].name}`;
    $('#pauseStats').innerHTML = `<span><i class="si e"></i>${engine.ballsIn}/${engine.ballsTotal} pearls</span><span><i class="si a"></i>${engine.relaxed ? 'No timer' : Math.ceil(engine.oxygen) + 's air'}</span><span><i class="si m"></i>${history.length} moves</span>`;
    $('#btnPauseHint').classList.toggle('dim', !COACH.route); show('pause'); }
  $('#btnPauseHint').onclick = () => { if (!COACH.route) { toast('No hint for this dive'); return; } click(); beginPlay(); setTimeout(showMe, 30); };
  function restart() { click(); startLevel(levelIdx, dive || undefined); beginPlay(); }
  // ---- undo: a snapshot of the whole puzzle before every move the diver makes
  let history = [], stuckTimer = 0, stuckShown = false;
  // undo is a limited lifeline: 3 per attempt (Restart refills them; Relaxed mode keeps it unlimited). The button only shows up in a
  // tight spot (danger next to the diver, a stuck pearl, a long think, after a crash) and stays a few seconds, so it's there when it matters.
  const UNDO_MAX = 3; let undoLeft = UNDO_MAX, undoUntil = 0, undoVis = null;
  const undoFree = () => !!(engine && engine.relaxed);
  function undoNeed(ms) { undoUntil = Math.max(undoUntil, performance.now() + (ms || 5000)); undoSync(); }
  function undoSync() { const b = $('#btnUndo'); if (!b) return; const can = !!engine && history.length > 0 && (undoFree() || undoLeft > 0) && engine.state !== 'won';
    const vis = can && (undoFree() || state === 'over' || performance.now() < undoUntil); const key = vis + ':' + (undoFree() ? '∞' : undoLeft);
    if (key === undoVis) return; undoVis = key; b.classList.toggle('ready', vis); b.setAttribute('aria-hidden', vis ? 'false' : 'true'); b.tabIndex = vis ? 0 : -1;
    const n = b.querySelector('.ub-n'); if (n) n.textContent = undoFree() ? '∞' : undoLeft; b.classList.toggle('last', !undoFree() && undoLeft === 1); }
  let runLog = '', runUndo = false, runHint = false; // this attempt's moves, one char per tick (same format as the verified routes), for "Watch best run"
  function cloneEngine(e) { const n = Object.create(Engine.prototype); Object.assign(n, e);
    n.grid = e.grid.slice(); n.water = e.water.slice(); const map = new Map(); n.objects = new Map();
    for (const [id, o] of e.objects) { const c = { ...o }; map.set(o, c); n.objects.set(id, c); }
    n.obj = e.obj.map(o => (o ? map.get(o) || null : null)); n.player = e.player ? map.get(e.player) : null; n.gate = e.gate ? { ...e.gate } : null;
    n.events = []; n.moveQueue = []; n.held = null; return n; }

  // ---- live hint planner: hints come from the board as it really is, never from a path that is already blocked.
  // 1) the level's verified route, checked by playing it to the end on a hidden copy of the board from where the diver stands;
  // 2) if that fails, a small best-first search (the same macro moves as tools/solver/macro.js: walk, dig, push, grab air) looks
  //    for a way back onto the route or straight to a win; 3) if nothing works, the player is told and offered a rewind.
  const PLM = { U: 'up', D: 'down', L: 'left', R: 'right' }, PLD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }, PLL = { up: 'U', down: 'D', left: 'L', right: 'R' };
  const plHeavy = o => o.t === T.ROCK || o.t === T.BALL;
  function plSim(e0, plan) { const e = cloneEngine(e0); e.time = e0.time; e.oxygen = Math.max(e.oxygen, 9999); /* a hint is about the path, not the clock */ for (const c of plan) { if (c !== '.') { const p = e.player; if (!p) return { e, ok: false }; e.press(PLM[c]); }
      e.step(); if (e.state === 'won') return { e, ok: true, won: true }; if (e.state !== 'playing') return { e, ok: false }; } return { e, ok: true, won: false }; }
  function plWalk(e, to) { const p = e.player; if (!p) return null; if (p.x === to[0] && p.y === to[1]) return ''; const path = coachPath(e, [p.x, p.y], to); if (!path) return null; let x = p.x, y = p.y, out = '';
    for (const [nx, ny] of path) { out += nx > x ? 'R' : nx < x ? 'L' : ny > y ? 'D' : 'U'; x = nx; y = ny; } return out; }
  // the verified route from this exact board: walk to where the route expects the diver, then follow it; valid only if it wins
  // the verified route from this exact board: walk to where the route expects the diver, wait for the monsters to line up the
  // way they did when the route was recorded (a few ticks), then follow it. Used only if it actually wins on a hidden copy.
  function plRoute(e, R, RT) { if (!R || !RT) return null; const key = objKey(e), js = [];
    for (let j = 0; j < R.length; j++) if (R[j].key === key && R[j].p) js.push(j); if (!js.length) return null;
    const pick = [...new Set([js[js.length - 1], js[0], js[Math.floor(js.length / 2)], js[js.length - 2], js[1]].filter(x => x !== undefined))];
    const monsters = [...e.objects.values()].some(o => o.t === T.FISH || o.t === T.JELLY || o.t === T.CRAB), waits = monsters ? 28 : 0;
    for (const j of pick) { const walk = plWalk(e, R[j].p); if (walk === null) continue;
      for (let w = 0; w <= waits; w++) { const plan = walk + '.'.repeat(w) + RT.slice(j); if (plSim(e, plan).won) return plan; } }
    return null; }
  function plKey(e) { let k = e.grid.join(''); for (const o of e.objects.values()) if (plHeavy(o) || o.t === T.PLAYER) k += '|' + o.t + ',' + o.x + ',' + o.y; return k + '|' + e.ballsIn; }
  function plWalkable(e, x, y) { if (x < 0 || y < 0 || x >= e.w || y >= e.h) return false; const t = e.get(x, y), o = e.obj[y * e.w + x]; if (o && o.t !== T.PLAYER) return false; return t === T.EMPTY || t === T.SAND || t === T.AIR || t === T.PLAYER || (t === T.GATE && e.gate && e.gate.open); }
  function plPath(e, tx, ty) { const p = e.player, W = e.w, prev = new Map(), q = [[p.x, p.y]]; prev.set(p.y * W + p.x, null);
    for (let qi = 0; qi < q.length; qi++) { const [x, y] = q[qi]; if (x === tx && y === ty) break; for (const d in PLD) { const nx = x + PLD[d][0], ny = y + PLD[d][1], k = ny * W + nx; if (prev.has(k) || !plWalkable(e, nx, ny)) continue;
        if (e.get(nx, ny) === T.GATE && !(nx === tx && ny === ty)) continue; prev.set(k, [y * W + x, d]); q.push([nx, ny]); } }
    if (!prev.has(ty * W + tx)) return null; const out = []; let k = ty * W + tx; while (prev.get(k)) { const [pk, d] = prev.get(k); out.push(d); k = pk; } return out.reverse(); }
  function plSettle(e, log) { for (let i = 0; i < 10; i++) { let moving = false; for (const o of e.objects.values()) if (plHeavy(o) && o.falling) moving = true; if (!moving && i > 1) break; e.step(); log.push('.'); if (e.state !== 'playing') return; } }
  function plExec(e, dirs, log) { for (const d of dirs) { const p = e.player, x0 = p.x, y0 = p.y; e.press(d); e.step(); log.push(PLL[d]); if (e.state === 'won') return true; if (e.state !== 'playing') return false;
      if (e.player.x === x0 && e.player.y === y0) { e.step(); log.push('.'); if (e.state !== 'playing') return e.state === 'won'; if (e.player.x === x0 && e.player.y === y0) return false; } } return true; }
  function plMacros(e) { const out = [], p = e.player; if (!p) return out; if (e.gate && e.gate.open) out.push({ kind: 'gate', tx: e.gate.x, ty: e.gate.y });
    for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) if (e.get(x, y) === T.AIR) out.push({ kind: 'air', tx: x, ty: y });
    for (const o of e.objects.values()) { if (!plHeavy(o)) continue;
      for (const d of ['left', 'right']) { const dx = PLD[d][0], sx = o.x - dx, tt = e.get(o.x + dx, o.y); if ((tt === T.EMPTY && !e.obj[o.y * e.w + o.x + dx]) || (tt === T.GATE && o.t === T.BALL)) out.push({ kind: 'push', tx: sx, ty: o.y, then: d });
        for (let k = 1; k <= 12; k++) { const cx = o.x + dx * k, t2 = e.get(cx, o.y); if (t2 === T.EMPTY && !e.obj[o.y * e.w + cx]) continue; if (t2 === T.SAND) out.push({ kind: 'dig', tx: cx, ty: o.y }); break; } }
      for (let k = 1; k <= 8; k++) { const t2 = e.get(o.x, o.y + k); if (t2 === T.EMPTY && !e.obj[(o.y + k) * e.w + o.x]) continue; if (t2 === T.SAND) out.push({ kind: 'dig', tx: o.x, ty: o.y + k }); break; }
      for (const [cx, cy] of [[o.x - 1, o.y], [o.x + 1, o.y], [o.x - 1, o.y + 1], [o.x + 1, o.y + 1]]) if (e.get(cx, cy) === T.SAND) out.push({ kind: 'dig', tx: cx, ty: cy }); }
    if (e.gate) for (const [cx, cy] of [[e.gate.x - 1, e.gate.y], [e.gate.x + 1, e.gate.y], [e.gate.x, e.gate.y - 1]]) if (e.get(cx, cy) === T.SAND) out.push({ kind: 'dig', tx: cx, ty: cy });
    return out; }
  function plApply(e, m) { const n = cloneEngine(e), log = []; const pth = plPath(n, m.tx, m.ty); if (!pth) return null; if (m.kind === 'dig' && pth.length === 0) return null;
    if (!plExec(n, pth, log)) return n.state === 'won' ? { e: n, log } : null; if (n.state === 'won') return { e: n, log };
    if (m.kind === 'push') { if (!plExec(n, [m.then], log)) return null; }
    if (m.kind === 'dig' && pth.length) { const back = { up: 'down', down: 'up', left: 'right', right: 'left' }[pth[pth.length - 1]], bx = n.player.x + PLD[back][0], by = n.player.y + PLD[back][1]; if (plWalkable(n, bx, by)) { if (!plExec(n, [back], log)) return null; } }
    plSettle(n, log); if (n.state === 'dead') return null; return { e: n, log }; }
  function plH(e) { let s = (e.ballsTotal - e.ballsIn) * 60; const g = e.gate; for (const o of e.objects.values()) if (o.t === T.BALL && g) s += Math.abs(o.x - g.x) + Math.abs(o.y - g.y) * 1.5; if (g && g.open && e.player) s += Math.abs(e.player.x - g.x) + Math.abs(e.player.y - g.y); return s; }
  // ---- exact hint search for rooms without monsters (same method as tools/gen/exact.js): while nothing falls, the diver can
  // swim anywhere in his pocket of open water for free, so a resting board is one state per (board, pocket) and each step is
  // "swim to a pocket cell + one move into something" (dig, push, take air, enter the gate). While anything falls, every tick
  // is searched move by move. Complete: if a way exists it is found; if the search runs dry there is truly none.
  const XD = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const xHeavy = t => t === T.ROCK || t === T.BALL;
  function xMoving(e) { for (const o of e.objects.values()) if (xHeavy(o.t) && o.falling) return true; return false; }
  function xBearing(e) { const c = e.clone(), pc = c.player; c.obj[pc.y * c.w + pc.x] = null; c.set(pc.x, pc.y, T.EMPTY); c.objects.delete(pc.id); c.player = null;
    const before = []; for (const o of c.objects.values()) if (xHeavy(o.t)) before.push(o.x * 1000 + o.y); c.tick++; c.physics(); let i = 0; for (const o of c.objects.values()) if (xHeavy(o.t) && o.x * 1000 + o.y !== before[i++]) return true; return false; }
  function xGrid(e, skipP) { const g = e.grid; let s = ''; for (let i = 0; i < g.length; i++) s += String.fromCharCode(48 + (skipP && g[i] === T.PLAYER ? 0 : g[i])); return s; }
  function xPocket(e) { const W = e.w, p = e.player, seen = new Uint8Array(e.grid.length), q = [p.y * W + p.x]; seen[q[0]] = 1;
    for (let qi = 0; qi < q.length; qi++) { const c = q[qi], x = c % W, y = (c / W) | 0; for (const k in XD) { const n = (y + XD[k][1]) * W + x + XD[k][0]; if (seen[n]) continue; if (e.grid[n] === T.EMPTY) { seen[n] = 1; q.push(n); } } } return q; }
  function xState(e) { if (xMoving(e) || xBearing(e)) { let s = 'p' + xGrid(e, false); for (const o of e.objects.values()) if (xHeavy(o.t)) s += o.falling ? (o.fallN || 0) + (o.graced ? 'g' : '') : '_'; return { key: s + e.ballsIn, mode: 'p' }; }
    const pk = xPocket(e); let m = Infinity; for (const c of pk) if (c < m) m = c; return { key: 'r' + xGrid(e, true) + '@' + m + '|' + e.ballsIn, mode: 'r', pk }; }
  function xEdges(e, st) { const out = [];
    if (st.mode === 'p') { const o = ['U', 'D', 'L', 'R']; if (xMoving(e)) o.push('.'); for (const c of o) { const n = e.clone(); if (c !== '.') n.press(PLM[c]); n.step(); out.push([c, n]); } return out; }
    const W = e.w, P = e.player, G = (x, y) => (x === P.x && y === P.y) ? T.EMPTY : e.get(x, y);
    for (const c of st.pk) { const x = c % W, y = (c / W) | 0;
      for (const k in XD) { const nx = x + XD[k][0], ny = y + XD[k][1], t = G(nx, ny);
        if (t === T.EMPTY || t === T.STEEL || t === T.WALL) continue; if (t === T.GATE && !e.gate.open) continue;
        if (xHeavy(t) && (XD[k][1] !== 0 || G(nx + XD[k][0], ny) !== T.EMPTY && !(t === T.BALL && G(nx + XD[k][0], ny) === T.GATE))) continue;
        const n = e.clone(); if (n.player.x !== x || n.player.y !== y) n.moveObj(n.player, x, y); n.press(PLM[k]); n.step(); const q = n.player;
        if (n.state === 'playing' && q && q.x === x && q.y === y && !xMoving(n)) continue; out.push([c + ':' + k, n]); } }
    return out; }
  function xExpand(e0, labs) { const e = e0.clone(); e.oxygen = 9999; let out = '';
    for (const l of labs) { if (!l.includes(':')) { if (l !== '.') e.press(PLM[l]); e.step(); out += l; continue; }
      const [c, k] = l.split(':'), W = e.w, target = +c, p = e.player, start = p.y * W + p.x, prev = new Map([[start, -1]]), q = [start];
      for (let qi = 0; qi < q.length; qi++) { const cc = q[qi]; if (cc === target) break; const x = cc % W, y = (cc / W) | 0; for (const d in XD) { const n = (y + XD[d][1]) * W + x + XD[d][0]; if (prev.has(n) || e.grid[n] !== T.EMPTY) continue; prev.set(n, cc); q.push(n); } }
      if (!prev.has(target)) return null; const path = []; for (let cc = target; cc !== start; cc = prev.get(cc)) path.push(cc); path.reverse();
      let cx = start; for (const n of path) { const d = n === cx + 1 ? 'R' : n === cx - 1 ? 'L' : n > cx ? 'D' : 'U'; e.press(PLM[d]); e.step(); out += d; cx = n; if (e.state !== 'playing') return null; }
      e.press(PLM[k]); e.step(); out += k; if (e.state === 'won') return out; if (e.state !== 'playing') return null; }
    return e.state === 'won' ? out : null; }
  const xMonsters = e => { for (const o of e.objects.values()) if (o.t === T.FISH || o.t === T.JELLY || o.t === T.CRAB) return true; return false; };
  // best-first toward the goal (pearls left, distance to the gate), but it never drops a state, so it is still complete
  function xPlan(e0, job, cb, budgetMs) { const s0e = e0.clone(); s0e.oxygen = 9999; const g = s0e.gate, t0 = performance.now();
    const h = e => { let v = (e.ballsTotal - e.ballsIn) * 40; for (const o of e.objects.values()) if (o.t === T.BALL) v += Math.abs(o.x - g.x) * 1.2 + Math.abs(o.y - g.y) * 2; if (e.gate.open && e.player) v += (Math.abs(e.player.x - g.x) + Math.abs(e.player.y - g.y)) * 0.5; return v; };
    const s0 = xState(s0e), seen = new Map([[s0.key, null]]), heap = [], push = n => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= n.f) break; heap[i] = heap[p]; i = p; } heap[i] = n; },
      pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].f < (m === i ? last.f : heap[m].f)) m = l; if (r < heap.length && heap[r].f < (m === i ? last.f : heap[m].f)) m = r; if (m === i) break; heap[i] = heap[m]; i = m; } heap[i] = last; } return top; };
    push({ e: s0e, st: s0, f: h(s0e), d: 0, path: null }); let n = 0;
    const chunk = () => { if (job !== planJob) return; const tEnd = performance.now() + (planHold ? 40 : 14);
      while (heap.length && performance.now() < tEnd) { const cur = pop(); n++;
        for (const [l, ne] of xEdges(cur.e, cur.st)) { const path = { l, up: cur.path };
          if (ne.state === 'won') { const labs = []; for (let p = path; p; p = p.up) labs.push(p.l); const r = xExpand(e0, labs.reverse()); cb(r); return; }
          if (ne.state !== 'playing') continue; const st = xState(ne); if (seen.has(st.key)) continue; seen.set(st.key, 1); push({ e: ne, st, f: h(ne) + (cur.d + 1) * 0.5, d: cur.d + 1, path }); } }
      if (!heap.length) { cb(null, true); return; } if (performance.now() - t0 > budgetMs || seen.size > 120000) { cb(null, false); return; } setTimeout(chunk, 0); };
    setTimeout(chunk, 0); }
  // async: a few milliseconds at a time so the game keeps drawing. cb(plan string | null)
  let planJob = 0;
  function planFrom(e0, R, RT, cb, budgetMs = 7000) { const job = ++planJob, start = cloneEngine(e0); start.time = e0.time; start.oxygen = Math.max(start.oxygen, 9999); /* a hint is about the path, not the clock */
    const quick = plRoute(start, R, RT); if (quick !== null) { cb(quick); return; }
    if (!xMonsters(start)) { xPlan(start, job, cb, budgetMs); return; } // rooms without monsters: the complete search
    const seen = new Set([plKey(start)]), open = [{ e: start, log: '', f: plH(start) }], t0 = performance.now(); let exp = 0, pruned = false;
    const chunk = () => { if (job !== planJob) return; const tEnd = performance.now() + (planHold ? 40 : 14);
      while (open.length && performance.now() < tEnd) { open.sort((a, b) => a.f - b.f); const cur = open.shift(); exp++;
        for (const m of plMacros(cur.e)) { const r = plApply(cur.e, m); if (!r) continue; const log = cur.log + r.log.join('');
          if (r.e.state === 'won') { cb(log); return; }
          const back = R && R.keys && R.keys.has(objKey(r.e)) ? plRoute(r.e, R, RT) : null; if (back !== null) { cb(log + back); return; }
          const k = plKey(r.e); if (seen.has(k)) continue; seen.add(k); open.push({ e: r.e, log, f: plH(r.e) + log.length * 0.02 }); }
        if (open.length > 9000) { open.sort((a, b) => a.f - b.f); open.length = 4500; pruned = true; } }
      if (!open.length || performance.now() - t0 > budgetMs || exp > 60000) { cb(null, !open.length && !pruned); return; } setTimeout(chunk, 0); }; // 2nd arg: the search ran out of moves (truly stuck)
    setTimeout(chunk, 0); }
  // the coach follows a plan from the current board: reference states simulated along it
  function planRefs(e0, plan) { const e = cloneEngine(e0); e.time = e0.time; const R = [{ key: objKey(e), p: e.player ? [e.player.x, e.player.y] : null }];
    for (const c of plan) { if (c !== '.') e.press(PLM[c]); e.step(); R.push({ key: objKey(e), p: e.player ? [e.player.x, e.player.y] : null }); if (e.state !== 'playing') break; }
    R.keys = new Set(R.map(r => r.key)); return R; }
  // undo lands somewhere you can survive: if staying put and every single move both die within ~1.5 s, step back further
  // danger read-out (Settings → Danger glow): after every tick, each neighbouring cell the diver could move into is tried on a
  // hidden copy of the board. If that move kills him, or leaves no way to survive the next 3 ticks whatever he does, the cell
  // glows red. Staying put being fatal (while some move still saves him) lights the "!" over his head. Air is ignored.
  function survives(c, n) { for (let i = 0; i < n; i++) { c.step(); if (c.state === 'dead') return false; if (c.state === 'won') return true; } return true; }
  function dangerScan() {
    if (!engine || !engine.player || engine.state !== 'playing' || state !== 'playing' || save.settings.danger === false) { world.setDanger(null); return; }
    const p = engine.player, out = []; let anyThreat = false;
    for (const o of engine.objects.values()) if (o.t === T.FISH || o.t === T.JELLY || o.t === T.CRAB || ((o.t === T.ROCK || o.t === T.BALL) && Math.abs(o.x - p.x) <= 2 && o.y <= p.y + 1 && o.y >= p.y - 6)) { anyThreat = true; break; }
    if (!anyThreat) { world.setDanger(null); return; }
    const fresh = () => { const c = cloneEngine(engine); c.oxygen = 1e6; c.relaxed = true; return c; };
    // any way to live: a small breadth-first search (≤ 6 moves, waiting allowed, repeated boards skipped) for a spot where
    // standing still is safe for 3 ticks. If the budget runs out it says "safe": a false alarm is worse than no alarm.
    const escapes = c0 => { const seen = new Set(), q = [[c0, 0]]; let n = 0;
      while (q.length) { const [c, d] = q.shift(); if (survives(cloneEngine(c), 3)) return true; if (d >= 6) continue;
        for (const f of ['', 'U', 'D', 'L', 'R']) { if (++n > 400) return true; const k = cloneEngine(c); if (f) k.press(PLM[f]); k.step(); if (k.state === 'won') return true; if (k.state === 'dead') continue;
          const key = k.key() + (k.player.x + ',' + k.player.y); if (seen.has(key)) continue; seen.add(key); q.push([k, d + 1]); } }
      return false; };
    let anySafe = false;
    for (const d of ['U', 'D', 'L', 'R']) { const [dx, dy] = PLD[PLM[d]], nx = p.x + dx, ny = p.y + dy, t = engine.get(nx, ny);
      if (t === T.WALL || t === T.STEEL || t === T.GATE) continue;
      const c = fresh(); c.press(PLM[d]); c.step(); const moved = c.player && (c.player.x !== p.x || c.player.y !== p.y);
      const bad = c.state === 'dead' || (c.state === 'playing' && !escapes(c));
      if (!bad && moved) anySafe = true; if (bad && (moved || c.state === 'dead')) out.push({ x: nx, y: ny }); }
    const stay = fresh(); const stayBad = !survives(stay, 2);
    world.setDanger({ cells: out, stay: stayBad && anySafe }); if (out.length || stayBad) undoNeed(4500); }
  function doomed(e) { if (!e.player) return true;
    for (const first of ['', 'U', 'D', 'L', 'R']) { const c = cloneEngine(e); c.oxygen = Math.max(c.oxygen, 30); if (first) c.press(PLM[first]); let dead = false;
      for (let i = 0; i < 10; i++) { c.step(); if (c.state === 'dead') { dead = true; break; } if (c.state === 'won') break; } if (!dead) return false; }
    return true; }
  function undo(force) {
    if (!history.length || !engine || (state !== 'playing' && state !== 'over') || engine.state === 'won' || $('#ending').classList.contains('on')) { if (state === 'playing') toast('Nothing to undo yet'); return; }
    if (force !== true && !undoFree()) { if (undoLeft <= 0) { toast('No undos left: ⟲ Restart gives you 3 more'); return; } undoLeft--; } undoVis = null;
    Audio.play('undo'); buzz(10); hideStuck(); stuckKey = ''; planJob++; COACH.plan = null; let snap = history.pop(), extra = 0; while (history.length && extra < 12 && doomed(snap)) { snap = history.pop(); extra++; } runUndo = true; if (snap.__log !== undefined) runLog = runLog.slice(0, snap.__log); const cp = world.camPos.clone(), ct = world.camTarget.clone();
    engine = cloneEngine(snap); world.keepTreasures(); world.loadLevel(engine); relicSync(); world.onTick(engine, performance.now()); world.startPlay(); world.camPos.copy(cp); world.camTarget.copy(ct); setTimeout(dangerScan, 0);
    held.clear(); heldOrder = []; endTouch(); acc = 0; overTimer = 0; resultShown = false; hudKey = ''; lastScore = -1;
    if (state !== 'playing') { setState('playing'); show(null); } updateHud(); undoHold = true;
    if (!REDUCED_MOTION) world.flashFx('rewind'); { const pl = engine.player; if (pl) world.particles.bubbles(pl.x, -pl.y, 0.4, 10, 0.08, 0.35); } /* time rewound: a cool blue blink + a puff of bubbles */
    if (extra) toast(`Rewound ${extra + 1} moves to a safe spot`); else if (force !== true && !undoFree()) toast(undoLeft ? `${undoLeft} undo${undoLeft === 1 ? '' : 's'} left` : 'That was your last undo'); undoNeed(2500); dvoice('undo'); }
  let planHold = false; // while a hint is being worked out the world holds still (nothing moves, air paused); any move cancels it
  let undoHold = false; // after an undo the world waits for the player's next move (a falling stone hangs until you act)
  $('#btnUndo').onclick = () => undo();

  // ---- watch your best run: the fastest winning attempt is stored as a tick route and played back at 2x
  let replay = null, lastWin = null; const MV = { U: 'up', D: 'down', L: 'left', R: 'right' };
  function checkRun(lv, m, relaxed) { try { const e = new Engine(lv); e.relaxed = relaxed; for (const c of m) { if (c !== '.') e.press(MV[c]); e.step(); if (e.state !== 'playing') break; } for (let k = 0; k < 10 && e.state === 'playing'; k++) e.step(); return e.state === 'won'; } catch (er) { return false; } }
  function startReplay(n, back) { const run = save.runs && save.runs[n]; if (!run) return; click(); hideStuck(); coachHand(null); world.setCoachTrail(null);
    const e = new Engine(LEVELS[n - 1]); e.relaxed = !!run.rx; e.tickMs = Math.round(e.tickMs / 2); // 2x
    replay = { e, m: run.m, i: 0, back, n, end: 0 }; world.loadLevel(e); world.onTick(e, performance.now()); world.startPlay(); world.lastTick = performance.now();
    setState('replay'); show(null); $('#rpName').textContent = `Level ${n} · your best run`; $('#replayTag').hidden = false; acc = 0; }
  function endReplay() { if (!replay) return; const r = replay; replay = null; $('#replayTag').hidden = true; acc = 0;
    if (r.back === 'result' && engine && engine.state === 'won') { world.loadLevel(engine); world.onTick(engine, performance.now()); world.startPlay(); setState('over'); show('result'); }
    else { openHome(); go('levels'); } }
  function replayTick(realDt, now) { const R = replay; acc = Math.min(acc + realDt * 1000, 300);
    while (acc >= R.e.tickMs) { acc -= R.e.tickMs; if (R.e.state === 'playing' && R.i < R.m.length) { const c = R.m[R.i++]; if (c !== '.') R.e.press(MV[c]); } R.e.step(); world.onTick(R.e, now - acc); }
    if (R.e.state !== 'playing' || R.i >= R.m.length) { R.end += realDt; if (R.end > 2.2) endReplay(); } }
  $('#btnWatch').onclick = () => { if (lastWin) startReplay(lastWin.n, 'result'); };
  $('#rpSkip').onclick = () => { click(); endReplay(); };
  // ---- share card: the tank as it looks right now + the result, as a 1080x1350 picture
  // the 1080x1350 picture: the live tank + either this result (L) or, with no L, a general 'come play' card
  async function drawCard(L) { const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    try { world.render(); const src = canvas, k = Math.max(W / src.width, H / src.height); g.drawImage(src, (W - src.width * k) / 2, (H - src.height * k) / 2, src.width * k, src.height * k); } catch (er) { g.fillStyle = '#0d63c2'; g.fillRect(0, 0, W, H); }
    let gr = g.createLinearGradient(0, 0, 0, 420); gr.addColorStop(0, 'rgba(4,20,60,0.9)'); gr.addColorStop(1, 'rgba(4,20,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, 420);
    gr = g.createLinearGradient(0, H - 560, 0, H); gr.addColorStop(0, 'rgba(4,20,60,0)'); gr.addColorStop(0.45, 'rgba(4,20,60,0.85)'); gr.addColorStop(1, 'rgba(4,20,60,0.97)'); g.fillStyle = gr; g.fillRect(0, H - 560, W, 560);
    try { await document.fonts.load('80px "Lilita One"'); } catch (er) {}
    const D = '"Lilita One", "Baloo 2", sans-serif', txt = (t, x, y, size, col, al = 'center') => { g.font = `${size}px ${D}`; g.textAlign = al; g.lineJoin = 'round'; g.lineWidth = size * 0.16; g.strokeStyle = 'rgba(3,14,44,0.9)'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y); };
    txt('AQUA ENERGIZER', W / 2, 130, 92, '#ffd23f'); g.font = `800 34px "Baloo 2", sans-serif`; g.textAlign = 'center'; g.fillStyle = 'rgba(234,247,255,0.9)'; g.fillText('DIG · PUSH · BREATHE · ESCAPE', W / 2, 190);
    if (!L) { const woke = cleared(); txt('Can you wake all 30 gates?', W / 2, H - 330, 84, '#ffffff'); txt(woke ? `I've woken ${woke} so far 🌊` : 'A cosy underwater puzzle', W / 2, H - 230, 62, '#9ff0ff'); txt('Play free in your browser', W / 2, H - 100, 60, '#ffd23f'); }
    else { txt(L.daily ? "Today's Daily Dive" : `I cleared Level ${L.n}`, W / 2, H - 360, L.daily ? 90 : 104, '#ffffff'); txt(L.name, W / 2, H - 270, 62, '#9ff0ff');
    if (L.daily) txt('☀ DAILY DIVE ☀', W / 2, H - 160, 84, '#ffd23f'); else txt('★★★'.slice(0, L.stars), W / 2 - (3 - L.stars) * 45, H - 160, 120, '#ffd23f'); if (!L.daily && L.stars < 3) txt('★'.repeat(3 - L.stars), W / 2 + L.stars * 45, H - 160, 120, 'rgba(255,255,255,0.25)');
    txt(`in ${L.secs} s · can you beat it?`, W / 2, H - 70, 56, '#ffffff'); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png')); if (!L) return { blob, name: 'aqua-energizer.png', text: "I'm diving in Aqua Energizer 🌊 a cosy underwater puzzle: dig tunnels, push glowing pearls into the gate and escape before your air runs out. Can you wake all 30 gates?" };
    const name = L.daily ? `aqua-energizer-daily-${dayKey()}.png` : `aqua-energizer-level-${L.n}.png`, text = L.daily ? `I cleared today's Aqua Energizer Daily Dive (${L.name}) in ${L.secs} s 🌊 Can you beat it?` : `I cleared Level ${L.n} (${L.name}) in Aqua Energizer with ${'★'.repeat(L.stars)} in ${L.secs} s 🌊 Can you beat it?`;
    return { blob, name, text }; }

  // ---- sharing: one sheet for a result card or the game itself. Platform buttons open that app's composer already filled in;
  // a public post link unlocks the VIP suit (the link's shape is checked here: a web page can't see whether the post is public)
  const PUBLIC_URL = ''; // the game's public web address once it's hosted (itch.io / own site): every share then carries the link
  function shareLink() { if (PUBLIC_URL) return PUBLIC_URL; try { if (/^https?:$/.test(location.protocol) && !/claude|anthropic|usercontent|localhost|127\.0\.0\.1/.test(location.hostname)) return location.origin + location.pathname; } catch (er) {} return ''; }
  const SHARE = { text: '', blob: null, name: '', net: '' };
  function openShare(title, d) { SHARE.text = d.text; SHARE.blob = d.blob; SHARE.name = d.name; SHARE.net = '';
    $('#shareTitle').textContent = title; const im = $('#shareImg'), vd = $('#shareVid'); im.hidden = vd.hidden = true; try { vd.pause(); } catch (er) {}
    if (d.blob) { const u = URL.createObjectURL(d.blob); if (d.video) { vd.src = u; vd.hidden = false; vd.muted = true; vd.play().catch(() => {}); } else { im.src = u; im.hidden = false; } $('#shareDl').href = u; $('#shareDl').download = d.name; }
    $('#shareDl').textContent = d.video ? 'Save video' : 'Save picture'; SHARE.type = d.video ? (d.blob.type || 'video/mp4') : 'image/png';
    shareCard.file = d.blob ? { name: d.name, blob: d.blob } : null; $('#shareTxt').textContent = d.text; vipState(); $('#shareBox').classList.add('on'); }
  async function shareCard() { if (!lastWin) return; click(); openShare('Share your dive', await drawCard(lastWin)); }
  async function shareGame() { openShare('Share Aqua Energizer', await drawCard(null)); }
  const enc = encodeURIComponent;
  function netUrl(net) { const url = shareLink(), t = SHARE.text, full = t + (url ? ' ' + url : '') + ' #AquaEnergizer';
    return { x: `https://twitter.com/intent/tweet?text=${enc(t)}&hashtags=AquaEnergizer${url ? '&url=' + enc(url) : ''}`,
      facebook: url ? `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(t)}` : 'https://www.facebook.com/',
      whatsapp: `https://wa.me/?text=${enc(full)}`, telegram: `https://t.me/share/url?url=${enc(url || ' ')}&text=${enc(t + ' #AquaEnergizer')}`,
      reddit: url ? `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(t)}` : `https://www.reddit.com/submit?type=TEXT&title=${enc('Aqua Energizer: a cosy underwater puzzle')}&text=${enc(full)}`,
      threads: `https://www.threads.net/intent/post?text=${enc(full)}` }[net]; }
  async function shareTo(net) { click(); SHARE.net = net; const url = shareLink(), full = SHARE.text + (url ? ' ' + url : '') + ' #AquaEnergizer';
    if (net === 'more') { try { const f = SHARE.blob && new File([SHARE.blob], SHARE.name, { type: SHARE.type || 'image/png' });
        if (f && navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], text: full }); else if (navigator.share) await navigator.share({ text: full, url: url || undefined });
        else { await navigator.clipboard.writeText(full); toast('Text copied: save the picture and post it in any app'); } } catch (er) { if (!(er && er.name === 'AbortError')) toast('Save the picture, then post it in any app'); } return; }
    if (net === 'facebook' && !url) { try { await navigator.clipboard.writeText(full); } catch (er) {} toast('Text copied: paste it in your Facebook post (and add the picture)'); }
    let w = null; try { w = window.open(netUrl(net), '_blank'); if (w) w.opener = null; } catch (er) {}
    if (!w) { try { await navigator.clipboard.writeText(full); toast("Couldn't open the app from here: the text is copied, paste it in your post"); } catch (er) { toast('Copy the text below into your post'); } }
    setTimeout(() => { if ($('#shareBox').classList.contains('on') && !owns('suit', 'vip')) $('#vipMsg').textContent = 'Posted? Paste the link to your post here to claim the VIP suit.'; }, 1200); }
  document.querySelectorAll('#shareBox .sb-soc button').forEach(b => b.onclick = () => shareTo(b.dataset.net));

  // ---- share clips: the last moments of a run re-played from its move log, then an instant replay in slow motion with a fun
  // caption, recorded (picture + game sound) into a ~10 s portrait video. Fails are as shareable as wins: nobody has to brag.
  let lastRun = null, CLIP = null;
  function setShareLabel(won) { const b = $('#btnShare'), t = [...b.childNodes].reverse().find(n => n.nodeType === 3); if (t) t.textContent = clipOk() ? (won ? 'Share clip' : 'Share this fail 😂') : 'Share'; }
  const CAPS = { crushed: ['When the stone wins 🪨😵', 'Gravity: 1 · Me: 0', "I'm fine. Totally fine. 🫠"], monster: ['Nobody warned me about that fish 🐟', 'Got snacked on 😬', 'That was NOT in the plan'],
    oxygen: ['Forgot to breathe 🫧', 'Just one more move… 🫧'], win: ['Pearl in. Gate awake. ✨', 'Smooth dive 😎', 'Swim in like a pro 🌊'], bonk: ['BONK! 🐟💥', 'Stone 1 · Fish 0 💥'] };
  const pick = a => a[(Math.random() * a.length) | 0];
  const clipOk = () => { try { return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream); } catch (er) { return false; } };
  function simTo(R, upto, onTick) { const e = new Engine(R.lv); e.relaxed = !!R.relaxed; let i = 0; for (; i < upto && i < R.log.length; i++) { const c = R.log[i]; if (c !== '.') e.press(MV[c]); e.step(); if (onTick) onTick(e, i); if (e.state !== 'playing') { i++; break; } } e.events.length = 0; return { e, i }; }
  async function shareMoment() { if (!lastRun) return; click();
    if (!clipOk() || !lastRun.log || lastRun.log.length < 3) { if (lastWin) openShare('Share your dive', await drawCard(lastWin)); else shareGame(); return; }
    makeClip(lastRun); }
  function makeClip(R) {
    let bonkAt = -1, endAt = R.log.length; simTo(R, R.log.length, (e, i) => { if (e.events.some(v => v.type === 'monsterDeath')) bonkAt = i; if (e.state !== 'playing') endAt = i; }); // find the moments
    const pre = Math.round(4500 / 225), start = Math.max(0, endAt - pre), slowFrom = Math.max(0, endAt - 6);
    const kind = R.won ? (bonkAt > endAt - 25 && bonkAt >= 0 ? 'bonk' : 'win') : (R.cause in CAPS ? R.cause : 'crushed');
    const rc = document.createElement('canvas'); rc.width = 720; rc.height = 1280; const g = rc.getContext('2d');
    let stream, rec, chunks = [], aud = null; try { stream = rc.captureStream(30); aud = Audio.capture(); if (aud) aud.getAudioTracks().forEach(t => stream.addTrack(t));
      const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (er) { return false; } }) || '';
      rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: 3500000 }, mime ? { mimeType: mime } : {})); rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); }; }
    catch (er) { Audio.release(); toast("Clips aren't supported in this browser: sharing a picture instead"); if (lastWin) drawCard(lastWin).then(d => openShare('Share your dive', d)); return; }
    const box = $('#clipBox'); box.querySelector('.cb-stage').replaceChildren(rc); box.classList.add('on'); $('#clipBar').style.width = '0%';
    CLIP = { R, kind, cap: pick(CAPS[kind]), g, rc, rec, chunks, phase: 'play', t: 0, total: 0, speed: 1, zoom: 0.78, acc: 0, post: 0, i: 0, e: null, start, endAt, slowFrom, cx: null, cy: null, prevState: state };
    clipLoad(start); hideStuck(); coachHand(null); world.setCoachTrail(null); show(null); setState('clip'); rec.start(250); }
  function clipLoad(at) { const C = CLIP, { e, i } = simTo(C.R, at); C.e = e; C.i = i; C.acc = 0; C.post = 0; world.loadLevel(e); world.onTick(e, performance.now()); world.startPlay(); world.peek = true; world.peekK = 1; } /* the camera holds the whole tank; the clip zooms with its own crop */
  function clipFrame(realDt, now) { const C = CLIP, e = C.e, dt = Math.min(0.05, realDt); C.t += realDt; C.total += realDt;
    if (C.phase !== 'end') { C.acc += realDt * 1000 * C.speed;
      while (C.acc >= e.tickMs) { C.acc -= e.tickMs; if (e.state === 'playing' && C.i < C.R.log.length) { const c = C.R.log[C.i++]; if (c !== '.') e.press(MV[c]); } e.step(); world.onTick(e, now); }
      if (e.state !== 'playing') C.post += realDt;
      const done = C.phase === 'play' ? C.post > (C.R.won ? 1.9 : 1.6) || (e.state === 'playing' && C.i >= C.R.log.length && C.t > 6) : C.post > (C.R.won ? 2.6 : 2.4);
      if (done) { if (C.phase === 'play') { C.phase = 'replay'; C.speed = 0.35; C.zoom = 0.5; C.t = 0; clipLoad(C.slowFrom); Audio.play('riser'); } else { C.phase = 'end'; C.t = 0; } }
      world.update(dt * C.speed, now); world.render(); }
    clipDraw(); $('#clipBar').style.width = Math.min(100, C.total / 11 * 100) + '%';
    if (C.phase === 'end' && C.t > 1.6) clipFinish(false); }
  function clipDraw() { const C = CLIP, g = C.g, W = 720, H = 1280, D = '"Lilita One", "Baloo 2", sans-serif';
    const txt = (t, x, y, size, col, al = 'center', lw = 0.16) => { g.font = `${size}px ${D}`; g.textAlign = al; g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.lineWidth = size * lw; g.strokeStyle = 'rgba(3,14,44,0.92)'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y); };
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0b4fa6'); bg.addColorStop(0.5, '#0a3a86'); bg.addColorStop(1, '#061f55'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (C.phase === 'end') { const k = Math.min(1, C.t / 0.35); g.globalAlpha = k; txt('AQUA', W / 2, 470, 150, '#ffd23f'); txt('ENERGIZER', W / 2, 600, 110, '#ffd23f');
      txt(C.R.won ? 'Can you do it faster?' : 'Can you do better?', W / 2, 760, 58, '#ffffff'); txt('Play free · #AquaEnergizer', W / 2, 860, 40, '#9ff0ff'); g.globalAlpha = 1; return; }
    // the game view: a crop of the live canvas that follows the diver (and the gate at the end of a win)
    const src = world.renderer.domElement, sw = src.width, sh = src.height, k = sw / innerWidth, e = C.e; let fx = null, fy = null;
    if (e.player && e.state === 'playing') { [fx, fy] = world.toScreen(e.player.x, e.player.y); } else if (C.R.won && e.gate) { [fx, fy] = world.toScreen(e.gate.x, e.gate.y); }
    if (fx !== null) { fx *= k; fy *= k; if (C.cx === null) { C.cx = fx; C.cy = fy; } C.cx += (fx - C.cx) * 0.12; C.cy += (fy - C.cy) * 0.12; } else if (C.cx === null) { C.cx = sw / 2; C.cy = sh / 2; }
    C.zv = (C.zv ?? C.zoom) + (C.zoom - (C.zv ?? C.zoom)) * 0.08; const vy = 200, vh = 900, asp = W / vh;
    const [tx0, ty0] = world.toScreen(0.5, 0.5), [tx1, ty1] = world.toScreen(e.w - 1.5, e.h - 1.5), tw = Math.abs(tx1 - tx0) * k, th = Math.abs(ty1 - ty0) * k; /* the tank on screen */
    let ch = Math.max(th * 1.25, tw * 1.05 / asp) * C.zv / 0.78, cw = ch * asp; if (ch > sh) { ch = sh; cw = ch * asp; } if (cw > sw) { cw = sw; ch = cw / asp; }
    const sx = Math.max(0, Math.min(sw - cw, C.cx - cw / 2)), sy = Math.max(0, Math.min(sh - ch, C.cy - ch / 2));
    try { g.drawImage(src, sx, sy, cw, ch, 0, vy, W, vh); } catch (er) {}
    let sh2 = g.createLinearGradient(0, vy, 0, vy + 60); sh2.addColorStop(0, 'rgba(6,31,85,0.9)'); sh2.addColorStop(1, 'rgba(6,31,85,0)'); g.fillStyle = sh2; g.fillRect(0, vy, W, 60);
    sh2 = g.createLinearGradient(0, vy + vh - 80, 0, vy + vh); sh2.addColorStop(0, 'rgba(6,31,85,0)'); sh2.addColorStop(1, 'rgba(6,31,85,0.95)'); g.fillStyle = sh2; g.fillRect(0, vy + vh - 80, W, 80);
    txt('AQUA ENERGIZER', W / 2, 105, 74, '#ffd23f'); g.font = '800 30px "Baloo 2", sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(225,240,255,0.92)'; g.fillText(C.R.daily ? `Daily Dive · ${C.R.name}` : `Level ${C.R.n} · ${C.R.name}`, W / 2, 158);
    if (C.phase === 'replay') { const blink = (C.t * 2) % 1 < 0.6; g.fillStyle = 'rgba(230,30,60,0.92)'; const bw = 330, bx = (W - bw) / 2, by = vy + 24; g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, 56, 28) : g.rect(bx, by, bw, 56); g.fill();
      if (blink) { g.fillStyle = '#fff'; g.beginPath(); g.arc(bx + 30, by + 28, 9, 0, 7); g.fill(); } g.font = '800 30px "Baloo 2", sans-serif'; g.fillStyle = '#fff'; g.fillText('INSTANT REPLAY', W / 2 + 12, by + 39); }
    const cy = vy + vh + 88; let size = 64; g.font = `${size}px ${D}`; while (g.measureText(C.cap).width > W - 60 && size > 36) { size -= 4; g.font = `${size}px ${D}`; } txt(C.cap, W / 2, cy, size, '#ffffff');
    g.font = '800 30px "Baloo 2", sans-serif'; g.fillStyle = '#9ff0ff'; g.textAlign = 'center'; g.fillText('#AquaEnergizer', W / 2, cy + 58); }
  async function clipFinish(cancel) { const C = CLIP; if (!C) return; CLIP = null; $('#clipBox').classList.remove('on');
    const stopped = new Promise(r => { C.rec.onstop = r; }); try { C.rec.stop(); } catch (er) {} await stopped.catch(() => {}); Audio.release();
    world.peek = false; world.peekK = 0; if (engine) { world.keepTreasures(); world.loadLevel(engine); world.onTick(engine, performance.now()); world.startPlay(); } setState('over'); show('result'); acc = 0;
    if (cancel) return; const type = (C.rec.mimeType || 'video/webm').split(';')[0], ext = type.includes('mp4') ? 'mp4' : 'webm', blob = new Blob(C.chunks, { type });
    if (!blob.size) { toast("Couldn't record the clip: sharing a picture instead"); if (lastWin) openShare('Share your dive', await drawCard(lastWin)); return; }
    const R = C.R, text = R.daily ? `${C.cap} Today's Daily Dive in Aqua Energizer 🌊 Can you beat it?` : R.won ? `${C.cap} Level ${R.n} of Aqua Energizer 🌊 Can you do it faster?` : `${C.cap} Aqua Energizer, level ${R.n} 😂 Can you do better?`;
    openShare(R.won ? 'Share your clip' : 'Share this fail 😂', { blob, name: `aqua-energizer-clip.${ext}`, text, video: true }); }
  $('#clipCancel').onclick = () => { click(); clipFinish(true); };
  $('#rwVip').onclick = () => { click(); shareGame(); };
  function syncVipBanner() { const left = lockedPremiums().length, all = premiums().length; $('#rwVip').classList.toggle('done', !left); $('#rwVipT').textContent = left ? `Premium outfits · ${all - left}/${all}` : 'Share Aqua Energizer';
    $('#rwVipS').textContent = left ? 'Share a fun clip publicly: each post unlocks a premium outfit (Shark, Merdiver, Robo…)' : 'Every premium outfit unlocked 👑 Tell your friends anyway!'; }
  // a link to a single public post on a network where posts can be public (chats like WhatsApp/Telegram can't count)
  const POST_RX = [['X', /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(es)?\/\d{6,}/i], ['Facebook', /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\/(.+\/(posts|videos|photos)\/|permalink\.php\?|share\/(p|v|r)\/|story\.php\?|reel\/|watch\/?\?v=)/i],
    ['Facebook', /^https?:\/\/(fb\.watch|fb\.me)\/\w+/i], ['Reddit', /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/r\/\w+\/(comments|s)\/\w+/i], ['Reddit', /^https?:\/\/redd\.it\/\w+/i],
    ['Threads', /^https?:\/\/(www\.)?threads\.(net|com)\/@[\w.]+\/post\/[\w-]+/i], ['Instagram', /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels)\/[\w-]+/i],
    ['TikTok', /^https?:\/\/(www\.|m\.)?tiktok\.com\/@[\w.]+\/(video|photo)\/\d+/i], ['TikTok', /^https?:\/\/(vm|vt)\.tiktok\.com\/\w+/i], ['LinkedIn', /^https?:\/\/(www\.)?linkedin\.com\/(posts|feed\/update)\/[\w:%-]+/i]];
  // premium outfits are unlocked one per public post; the player picks which one this post unlocks
  const premiums = () => World.SKINS.suit.filter(x => x.vip), lockedPremiums = () => premiums().filter(x => !owns('suit', x.id));
  function vipState() { const left = lockedPremiums(), box = $('#shareVip'), has = !left.length; box.classList.toggle('done', has);
    if (!left.some(x => x.id === SHARE.target)) SHARE.target = left[0] ? left[0].id : null;
    const chips = $('#vipChips'); chips.innerHTML = ''; premiums().forEach(x => { const b = document.createElement('button'); const own = owns('suit', x.id); b.type = 'button'; b.className = 'vc' + (own ? ' own' : '') + (x.id === SHARE.target ? ' on' : ''); b.textContent = (own ? '✓ ' : '') + x.name; b.disabled = own; b.onclick = () => { click(); SHARE.target = x.id; vipState(); }; chips.appendChild(b); });
    $('#vipHead').textContent = has ? 'All premium outfits unlocked 👑' : `Unlock a premium outfit (${premiums().length - left.length}/${premiums().length})`;
    $('#vipMsg').textContent = has ? 'Thanks for sharing! Wear them from Shop › Suits.' : ''; $('#vipLink').hidden = $('#vipClaim').hidden = has; }
  $('#vipClaim').onclick = () => { const v = ($('#vipLink').value || '').trim(), hit = POST_RX.find(([, rx]) => rx.test(v)), msg = $('#vipMsg');
    if (!v) { msg.textContent = 'Paste the link to your post first.'; return; }
    if (!hit) { msg.textContent = "That doesn't look like a link to a single public post. Open your post, tap Share › Copy link, and paste it here."; Audio.play('gateLocked'); return; }
    if (!Array.isArray(save.vipPosts)) save.vipPosts = []; if (save.vipPosts.includes(v.toLowerCase())) { msg.textContent = 'That post was already used.'; return; }
    const it = World.SKINS.suit.find(x => x.id === SHARE.target && x.vip && !owns('suit', x.id)) || lockedPremiums()[0]; if (!it) { vipState(); return; }
    save.vipPosts = save.vipPosts.concat(v.toLowerCase()).slice(-12); save.owned['suit:' + it.id] = true; save.vip = { net: hit[0], at: Date.now() }; persist(); $('#vipLink').value = '';
    Audio.play('absorb'); buzz([20, 40, 20, 40, 60]); toast(`👑 ${it.name} unlocked! Thanks for sharing on ${hit[0]}`); vipState();
    msg.textContent = `${it.name} unlocked! Wear it from Shop › Suits. 👑` + (lockedPremiums().length ? ' Share another post to unlock the next one.' : ''); if ($('#shop').classList.contains('on')) buildShop(); syncVipBanner(); };
  $('#btnShare').onclick = shareMoment;
  // inside the claude.ai viewer a plain download link does nothing: save through the viewer's downloads permission when it's there
  $('#shareDl').onclick = async ev => { const f = shareCard.file, C = window.claude; if (!f || !C || !C.use) return; let dl = null; try { dl = await C.use('downloads'); } catch (er) {} if (!dl) return;
    ev.preventDefault(); try { await dl.save({ filename: f.name, data: f.blob }); } catch (er) { if (er && er.code !== 'declined') toast('Long-press the picture to save it'); } };
  $('#shareClose').onclick = () => { click(); $('#shareBox').classList.remove('on'); try { $('#shareVid').pause(); } catch (er) {} };
  $('#shareCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#shareTxt').textContent); toast('Copied!'); } catch (er) { toast('Long-press the text to copy it'); } };
  // ---- Daily Dive: one puzzle a day (the same for everyone, picked from the date), raced against the clock with its own leaderboard
  let dive = null;
  const DIVE_FROM = 6; // unlocks once level 5 is cleared
  const dayNum = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2024, 0, 1)) / 864e5);
  function todayDive() { if (!DAILY_LEVELS.length) return null; const k = dayNum(), L = DAILY_LEVELS[((k * 7) % DAILY_LEVELS.length + DAILY_LEVELS.length) % DAILY_LEVELS.length]; return Object.assign({}, L, { daily: true, key: dayKey() }); }
  function ddSave() { const D = save.dd = save.dd || {}; if (D.key !== dayKey()) { save.dd = { key: dayKey(), tries: 0, best: null, played: D.played, streak: D.streak, lastWin: D.lastWin }; } return save.dd; }
  function syncDiveBtn() { const b = $('#btnDaily'); if (!b) return; const L = todayDive(), D = ddSave(), locked = save.unlocked < DIVE_FROM || !L; b.classList.toggle('locked', locked); b.classList.toggle('done', !!D.best);
    $('#ddSub').textContent = locked ? (L ? `Unlocks after level ${DIVE_FROM - 1}` : 'Coming soon') : D.best ? `Today: ${D.best.t.toFixed(1)} s · beat it?` : `${L.name} · new today`; }
  function startDaily() { const L = todayDive(); if (!L) return; if (save.unlocked < DIVE_FROM) { toast(`Clear level ${DIVE_FROM - 1} to unlock the Daily Dive`); return; } click(); buzz(10); ddSave().tries++; persist(); startLevel(-1, L); }
  function finishDaily(won) { const D = ddSave(), L = dive; setState('over'); show('result'); $('#resGoals').hidden = true; const r = $('#result'); r.classList.toggle('win', won); r.classList.toggle('lose', !won);
    $('#resKicker').textContent = `Daily Dive · ${L.name}`; $('#resStars').hidden = true; $('#resBest').hidden = true; $('#resExtra').hidden = !won; $('#btnWatch').hidden = true; setShareLabel(true);
    { const el = $('#resScore'), total = engine.score, t0 = performance.now(); el.textContent = '0'; /* the score rolls up while the card pops in */
      const tick = (now) => { const k = Math.min(1, (now - t0 - 250) / 1000); if (k > 0) el.textContent = Math.round(total * (1 - Math.pow(1 - k, 3))).toLocaleString(); if (k < 1 && resultShown) requestAnimationFrame(tick); else el.textContent = total.toLocaleString(); };
      if (REDUCED_MOTION) el.textContent = total.toLocaleString(); else requestAnimationFrame(tick); } save.stats.dug += engine.dug || 0; weekBump('dig', engine.dug || 0);
    if (D.played !== D.key) { D.played = D.key; weekBump('daily'); }
    if (won) { const t = Math.round((engine.wonAt - (engine.begunAt || 0)) * engine.tickMs / 100) / 10, /* race time from the first move */ air = Math.round((engine.time - engine.oxygen) * 10) / 10, prev = D.best, first = !prev;
      const better = !prev || t < prev.t; if (better) D.best = { t, air: prev ? Math.min(prev.air, air) : air }; else D.best.air = Math.min(D.best.air, air);
      $('#resBest').hidden = !(prev && t < prev.t); $('#resTitle').textContent = first ? 'Daily Dive cleared!' : better ? 'Faster!' : 'Cleared!';
      $('#resStats').innerHTML = `<div class="stat"><b>${t.toFixed(1)}s</b><span>dive time</span></div><div class="stat"><b>${air.toFixed(1)}s</b><span>air used</span></div><div class="stat"><b>${D.best.t.toFixed(1)}s</b><span>today's best</span></div>`;
      if (first) { const y = new Date(); y.setDate(y.getDate() - 1); D.streak = D.lastWin === dayKey(y) ? (D.streak || 0) + 1 : 1; D.lastWin = D.key; const c = 60 + Math.min(6, D.streak - 1) * 10; save.coins += c; $('#resCoins').hidden = false; $('#resCoinN').textContent = `+${c}`; $('#resCoinWhy').textContent = D.streak > 1 ? `daily dive · ${D.streak}-day dive streak` : 'daily dive'; Audio.play('treasure'); } else $('#resCoins').hidden = true;
      $('#btnNext').textContent = 'Leaderboard'; $('#btnNext').hidden = false; $('#btnNext').classList.add('green'); $('#btnRetry').lastChild.textContent = 'Race again';
      lastWin = { n: 0, daily: true, stars: 3, secs: t, name: L.name }; pushDaily(); persist(); lastRun = { lv: L, n: 0, daily: true, log: runLog, relaxed: false, won: true, name: L.name };
      setTimeout(() => { if (state === 'over') Audio.vo(['win1', 'win2', 'win3'][Math.random() * 3 | 0]); }, 700); }
    else { const cause = { crushed: 'Crushed!', monster: 'Gobbled!', oxygen: 'Out of air!', self: 'Restarted' }[engine.deathCause] || 'Dive over'; $('#resTitle').textContent = cause; $('#resCoins').hidden = true; lastWin = null;
      $('#resStats').innerHTML = `<div class="stat"><b>${engine.ballsIn}/${engine.ballsTotal}</b><span>pearls</span></div><div class="stat"><b>${D.best ? D.best.t.toFixed(1) + 's' : '–'}</b><span>today's best</span></div>`;
      $('#btnNext').textContent = history.length && (undoLeft > 0 || undoFree()) ? (undoFree() ? 'Undo last move' : `Undo last move (${undoLeft} left)`) : 'Try again'; $('#btnNext').hidden = false; $('#btnNext').classList.add('green'); $('#btnRetry').lastChild.textContent = 'Restart'; persist(); } }
  let ddWriting = Promise.resolve();
  function pushDaily() { const D = ddSave(); if (!D.best) return; ddWriting = ddWriting.then(async () => { await LB.ready; if (!LB.db || !LB.uid) return;
    try { await LB.db.doc('daily/' + LB.uid).set({ day: D.key, t: D.best.t, air: D.best.air, nick: (save.name || 'Diver').slice(0, 16), suit: save.equip.suit, updatedAt: Date.now() }); } catch (er) { if (er && er.code === 'invalid_argument') LB.readOnly = true; } }); }
  $('#btnDaily').onclick = startDaily;
  function clearStamp() { const el = $('#clearStamp'); if (!el) return; clearTimeout(bannerTimer); bannerOff(); /* the stamp takes the stage: no 'Swim in!' banner under it */ const won = engine.state === 'won', frac = engine.oxygen / engine.time;
    const stars = dive ? 0 : engine.relaxed ? 1 : frac >= 0.6 ? 3 : frac >= 0.3 ? 2 : 1; el.querySelector('b').textContent = dive ? 'Dive complete!' : stars === 3 ? 'Perfect!' : 'Level clear!';
    const st = [...el.querySelectorAll('.cs-stars i')]; st.forEach(s => s.className = ''); el.querySelector('.cs-stars').hidden = !!dive;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    st.forEach((s, i) => setTimeout(() => { if (!el.classList.contains('on')) return; s.classList.add('show'); if (i < stars) { s.classList.add('got'); Audio.star(i); buzz(14); } }, 520 + i * 230)); }
  // ---- Star chest: every new star fills it; 9 open it (75 coins, every 3rd chest a rare item) ----
  const CHEST_N = 9;
  function chestState() { const c = save.chest = save.chest || {}; c.n = Math.max(0, Math.min(CHEST_N - 1, c.n | 0)); c.o = Math.max(0, c.o | 0); return c; }
  function chestAdd(g) { const c = chestState(), before = c.n; let opened = 0, gift = null; c.n += g; while (c.n >= CHEST_N) { c.n -= CHEST_N; c.o++; opened++; if (c.o % 3 === 0 && !gift) gift = giftItem(300, 600) || giftItem(600, 1200); }
    return { before, gained: g, opened, after: c.n, gift }; }
  function goalRow(id, title, frac, num, from) { const f = $('#rg' + id + 'F'); $('#rg' + id + 'T').textContent = title; $('#rg' + id + 'N').textContent = num;
    f.style.transition = 'none'; f.style.width = (Math.max(0, Math.min(1, from ?? frac)) * 100) + '%'; void f.offsetWidth; f.style.transition = ''; setTimeout(() => { f.style.width = (Math.max(0, Math.min(1, frac)) * 100) + '%'; }, REDUCED_MOTION ? 0 : 700); }
  function renderGoals(won, ch) { const w = WORLDS[worldOfIdx(levelIdx)], cnt = w.to - w.from; let awake = 0; for (let k = w.from + 1; k <= w.to; k++) if (save.stars[k]) awake++;
    goalRow('World', `${w.name} · gates awake`, awake / cnt, `${awake}/${cnt}`);
    const c = chestState(), row = $('#rgChest'); row.classList.remove('open');
    if (ch && ch.opened) { goalRow('Chest', 'Star chest opened!', 1, `+${ch.opened * 75}`, ch.before / CHEST_N); setTimeout(() => { if (ch.gift) grantItem(ch.gift, 'Star chest'); if (!resultShown) return; row.classList.add('open'); Audio.play('treasure'); buzz([20, 30, 40]); }, REDUCED_MOTION ? 0 : 1500); }
    else goalRow('Chest', ch && ch.gained ? `Star chest · +${ch.gained} ★` : won ? 'Star chest · earn new stars' : 'Star chest · win to add stars', c.n / CHEST_N, `${c.n}/${CHEST_N}`, ch ? ch.before / CHEST_N : null);
    const pr = $('#rgPearl'); pr.hidden = won || dive || engine.deathCause === 'self';
    if (!pr.hidden) { const a = engine.ballsIn, b = engine.ballsTotal; goalRow('Pearl', a >= b ? 'So close! The gate was open' : a ? `So close! ${a} of ${b} pearls in` : `Pearls in: ${a} of ${b}`, b ? a / b : 1, `${a}/${b}`); } }
  function finishLevel() { { const cs = $('#clearStamp'); if (cs) cs.classList.remove('on'); }
    resultShown = true; { const m = $('#resMascot'), th = diverThumb(); if (th) { m.src = th; m.hidden = false; } }
    const won = engine.state === 'won'; const n = levelIdx + 1; { const rc = $('#resCause'); rc.textContent = won ? '' : { crushed: 'A stone landed on your head. Undo and step aside sooner.', monster: 'A sea creature caught you. Watch its path, or drop a stone on it.', oxygen: 'Your air ran out. Look for air capsules, or plan a shorter route.', self: 'You restarted the dive.', spiked: 'Ouch, spikes!' }[engine.deathCause] || ''; rc.hidden = won || !rc.textContent; } if (dive) return finishDaily(won);
    setState('over'); show('result'); $('#resGoals').hidden = false;
    const r = $('#result'); r.classList.toggle('win', won); r.classList.toggle('lose', !won);
    const prevBest = save.best[n] || 0;
    $('#resKicker').textContent = `Level ${n} · ${LEVELS[levelIdx].name}`;
    { const el = $('#resScore'), total = engine.score, t0 = performance.now(); el.textContent = '0'; /* the score rolls up while the card pops in */
      const tick = (now) => { const k = Math.min(1, (now - t0 - 250) / 1000); if (k > 0) el.textContent = Math.round(total * (1 - Math.pow(1 - k, 3))).toLocaleString(); if (k < 1 && resultShown) requestAnimationFrame(tick); else el.textContent = total.toLocaleString(); };
      if (REDUCED_MOTION) el.textContent = total.toLocaleString(); else requestAnimationFrame(tick); }
    const starEls = [...document.querySelectorAll('#resStars i')]; starEls.forEach(s => s.className = '');
    if (won) {
      const frac = engine.oxygen / engine.time; const stars = engine.relaxed ? 1 : frac >= 0.6 ? 3 : frac >= 0.3 ? 2 : 1;
      const prevStars = save.stars[n] || 0, firstClear = !prevStars;
      save.stars[n] = Math.max(prevStars, stars); if (!engine.relaxed) save.best[n] = Math.max(prevBest, engine.score); const ch = chestAdd(Math.max(0, stars - prevStars));
      save.stats.wins++; save.stats.dug += engine.dug || 0;
      weekBump('wins'); weekBump('stars', stars); if (stars === 3) weekBump('perfect'); if (!runUndo) weekBump('noundo'); if (!runHint) weekBump('nohint'); weekBump('dig', engine.dug || 0);
      { const m = runLog.replace(/\.+$/, '') + '.', old = (save.runs || {})[n]; if ((!old || m.length < old.m.length) && checkRun(LEVELS[levelIdx], m, engine.relaxed)) { save.runs = save.runs || {}; save.runs[n] = { m, rx: engine.relaxed ? 1 : 0 }; } } // keep the fastest verified run
      lastWin = { n, stars, secs: Math.round(engine.wonAt * engine.tickMs / 1000), name: LEVELS[levelIdx].name, relaxed: engine.relaxed };
      lastRun = { lv: LEVELS[levelIdx], n, log: runLog, relaxed: engine.relaxed, won: true, name: LEVELS[levelIdx].name };
      setTimeout(() => { if (state === 'over') Audio.vo(['win1', 'win2', 'win3'][Math.random() * 3 | 0]); }, 700);
      { const parts = [['clear', 20], ['stars', stars * 10], ['first clear', firstClear ? 30 : 0], ['new stars', Math.max(0, stars - prevStars) * 15 * (firstClear ? 0 : 1)], ['treasures', runTreasures * 2], ['combos', RUN.combos.reduce((a, c) => a + c[1], 0)], ['relic', RUN.relicGot && !(save.relicPaid || {})[n] ? 50 : 0], ['star chest', ch.opened * 75]].filter(p => p[1] > 0), total = parts.reduce((a, p) => a + p[1], 0);
        if (RUN.relicGot) { save.relicPaid = save.relicPaid || {}; save.relicPaid[n] = 1; } save.coins += total; $('#resCoins').hidden = false; $('#resCoinWhy').innerHTML = parts.map(p => `<span><i>${p[0][0].toUpperCase() + p[0].slice(1)}</i><b>+${p[1]}</b></span>`).join('');
        const el = $('#resCoinN'); let shown = 0; const t0 = performance.now(); const tick = (now) => { const k = Math.min(1, (now - t0) / 900); shown = Math.round(total * k * (2 - k)); el.textContent = `+${shown}`; if (k < 1) requestAnimationFrame(tick); }; setTimeout(() => requestAnimationFrame(tick), 900); }
      pushScore();
      if (n >= save.unlocked && n < LEVELS.length) save.unlocked = n + 1; persist();
      $('#resTitle').textContent = n === LEVELS.length ? 'Last gate open!' : engine.relaxed ? 'Relaxed clear!' : ['Energized!', 'Great dive!', 'Brilliant!'][stars - 1];
      $('#resStars').hidden = false;
      starEls.forEach((s, i) => setTimeout(() => { s.classList.add('show'); if (i < stars) { s.classList.add('on'); buzz(12); } /* the clear stamp already chimed the stars: no second set of chimes here */ }, 250 + i * 260));
      $('#resBest').hidden = !(engine.score > prevBest && prevBest > 0);
      $('#resStats').innerHTML = engine.relaxed ? `<div class="stat"><i class="si t"></i><b>${Math.round(engine.wonAt * engine.tickMs / 1000)}s</b><span>dive time</span></div><div class="stat"><i class="si s"></i><b>★</b><span>air timer off for ★★★</span></div>` : `<div class="stat"><i class="si a"></i><b>${Math.ceil(engine.oxygen)}s</b><span>air left</span></div><div class="stat"><i class="si e"></i><b>${engine.ballsIn}/${engine.ballsTotal}</b><span>pearls</span></div>`;
      $('#btnNext').textContent = n >= LEVELS.length ? 'Wake the reef ✨' : 'Next level'; $('#btnNext').hidden = false; $('#btnNext').classList.toggle('green', n >= LEVELS.length);
      $('#btnRetry').lastChild.textContent = 'Replay';
      $('#resExtra').hidden = false; $('#btnWatch').hidden = !(save.runs && save.runs[n]); setShareLabel(true); renderGoals(true, ch);
    } else { $('#resExtra').hidden = !clipOk() || engine.deathCause === 'self'; $('#btnWatch').hidden = true; /* a funny fail is shareable too */ setShareLabel(false);
      lastRun = { lv: LEVELS[levelIdx], n, log: runLog, relaxed: engine.relaxed, won: false, cause: engine.deathCause, name: LEVELS[levelIdx].name };
      $('#resCoins').hidden = true; save.stats.dug += engine.dug || 0; weekBump('dig', engine.dug || 0); persist(); lastWin = null;
      setTimeout(() => { if (state === 'over' && !deathSaid) Audio.vo(['lose1', 'lose2'][Math.random() * 2 | 0]); }, 600);
      const cause = { crushed: 'Crushed!', monster: 'Gobbled!', oxygen: 'Out of air!', self: 'Restarted', spiked: 'Spiked!' }[engine.deathCause] || 'Dive over';
      $('#resTitle').textContent = cause; $('#resStars').hidden = true; $('#resBest').hidden = true;
      $('#resStats').innerHTML = `<div class="stat"><i class="si e"></i><b>${engine.ballsIn}/${engine.ballsTotal}</b><span>pearls</span></div><div class="stat"><i class="si a"></i><b>${Math.max(0, Math.ceil(engine.oxygen))}s</b><span>air left</span></div>`;
      $('#btnNext').textContent = history.length && (undoLeft > 0 || undoFree()) ? (undoFree() ? 'Undo last move' : `Undo last move (${undoLeft} left)`) : 'Try again'; $('#btnNext').hidden = false; $('#btnNext').classList.add('green');
      $('#btnRetry').lastChild.textContent = 'Restart'; renderGoals(false, null);
    }
  }

  // ---- HUD ----
  const hud = { airTxt: $('#airTxt'), airFill: $('#airFill'), air: $('#air'), fill: $('#energyFill'), etxt: $('#energyTxt'), lvl: $('#hudLvl'), score: $('#hudScore'), gate: $('#hudGate') };
  let hudKey = '', lastScore = -1;
  function updateHud() {
    if (!engine) return;
    { const at = engine.relaxed ? '∞' : String(Math.max(0, Math.ceil(engine.oxygen))); if (hud.airTxt.textContent !== at) hud.airTxt.textContent = at;
      const aw = (Math.max(0, Math.min(1, engine.oxygen / engine.time)) * 100).toFixed(1) + '%'; if (hud.airFill.style.width !== aw) hud.airFill.style.width = aw; }
    { const fr = engine.oxygen / engine.time, st = fr >= 0.6 ? 3 : fr >= 0.3 ? 2 : 1; const el = $('#airStars'); if (el && el.dataset.st !== String(st)) { el.dataset.st = st; [...el.children].forEach((c, k) => c.classList.toggle('off', k >= st)); } }
    hud.air.classList.toggle('low', engine.oxygen < 15 && engine.state === 'playing' && !engine.relaxed);
    const key = engine.ballsIn + '/' + engine.ballsTotal + (engine.gate.open ? 'o' : '');
    if (key !== hudKey) { hudKey = key;
      hud.fill.style.width = (engine.ballsTotal ? engine.ballsIn / engine.ballsTotal * 100 : 100) + '%';
      hud.etxt.textContent = engine.gate.open ? 'Gate open! Swim in' : `${engine.ballsIn} / ${engine.ballsTotal} pearls`;
      hud.gate.classList.toggle('open', !!engine.gate.open); $('#hudProg').classList.toggle('open', !!engine.gate.open);
      { const pe = $('#hudPearls'), n = engine.ballsTotal; if (n <= 6) { if (pe.children.length !== n || pe.firstChild && pe.firstChild.nodeType !== 1) pe.innerHTML = '<i></i>'.repeat(n); [...pe.children].forEach((c, k) => c.classList.toggle('on', k < engine.ballsIn)); if (engine.ballsIn > (hud.lastIn ?? engine.ballsIn) && pe.children[engine.ballsIn - 1]) { const c = pe.children[engine.ballsIn - 1]; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } hud.lastIn = engine.ballsIn; }
        else pe.innerHTML = `<i class="${engine.ballsIn ? 'on' : ''}"></i>${engine.ballsIn}/${n}`; }
      hud.gate.innerHTML = engine.gate.open ? '<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    }
    hud.lvl.textContent = dive ? '☀' : levelIdx + 1;
    if (engine.score !== lastScore) { if (lastScore >= 0 && engine.score > lastScore) { hud.score.classList.remove('bump'); void hud.score.offsetWidth; hud.score.classList.add('bump'); } lastScore = engine.score; hud.score.textContent = engine.score.toLocaleString(); }
  }

  // ---- input: keyboard ----
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
  function setHeldPeekOff() { if (beginPlay.pk && world.peek && !mapBtn.classList.contains('on')) { clearTimeout(beginPlay.pk); beginPlay.pk = 0; world.peek = false; } }
  function setHeld(dir, on) {
    if (on) { if (!held.has(dir)) { held.add(dir); heldOrder.push(dir); if (engine) engine.press(dir); } }
    else { held.delete(dir); heldOrder = heldOrder.filter(d => d !== dir); }
    if (engine) engine.hold(heldOrder.length ? heldOrder[heldOrder.length - 1] : null);
  }
  addEventListener('keydown', ev => {
    if (ev.repeat) return;
    if (state === 'splash') { unlock(); return; }
    if (storyOn && !resultShown) { { const S = world.story; if (S && S.qte && ev.key !== 'Escape') { ev.preventDefault(); if (S.qte.kind === 'run') { S.qteIn('key', { k: ev.key.length === 1 ? ev.key.toLowerCase() : ev.key, on: true }); return; } if (S.qte.kind === 'choice') { const k = '123'.indexOf(ev.key); if (k >= 0 && S.Q.opts[k]) S.qteIn('pick', S.Q.opts[k][0]); return; } if (ev.key.startsWith('Arrow')) S.qteIn('swipe'); else if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) S.qteIn('down'); return; } }
      if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (watching && ev.key === 'Escape') endWatch(); else storySkip(ev.key === 'Escape'); } return; }
    if (state === 'replay') { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); endReplay(); } return; }
    if (state === 'ending' && !$('#finale').hidden) { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); finale.end && finale.end(); } return; }
    if (state === 'cine') { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#skipIntro').click(); return; } return; }
    const dir = KEYS[ev.key];
    if (dir) { ev.preventDefault(); if (state === 'intro') beginPlay(); if (state === 'playing') setHeld(dir, true); return; }
    if (ev.key === 'Escape' && state !== 'playing' && state !== 'paused') { const sh = document.querySelector('.screen.sheet.on:not(.modal), #levels.on'); if (sh) { ev.preventDefault(); go('back'); return; } }
    if (ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') { if (state === 'playing') pause(); else if (state === 'paused') beginPlay(); }
    if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'u' || ev.key === 'U' || ev.key === 'Backspace') { ev.preventDefault(); if ($('#btnUndo').classList.contains('ready')) undo(); else if (history.length) toast(undoLeft > 0 || undoFree() ? 'Undo shows up when you\'re in a tight spot' : 'No undos left: R restarts'); return; }
    if (ev.key === 'r' || ev.key === 'R') { if (state === 'playing') { restart(); return; } else if (state === 'over' || state === 'paused') restart(); }
    if (ev.key === 'Enter' && state === 'menu' && !ev.target.closest('input')) { if ($('#home').classList.contains('on')) { $('#btnPlay').click(); return; } if ($('#levels').classList.contains('on')) { $('#lvPlay').click(); return; } }
    if (state === 'tut') { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tutNext(); } else if (ev.key === 'Escape') endTut(); return; }
    if (ev.key === 'Enter' || ev.key === ' ') { if (state === 'intro') beginPlay(); else if (state === 'over' && resultShown) $('#btnNext').hidden ? restart() : $('#btnNext').click(); }
  });
  addEventListener('keyup', ev => { const dir = KEYS[ev.key]; if (dir) setHeld(dir, false); });
  addEventListener('blur', () => { held.clear(); heldOrder = []; endTouch(); if (engine) engine.hold(null); });
  window.addEventListener('pointerdown', () => { const ac = Audio.ctx; if (ac && ac.state !== 'running') { try { ac.resume(); } catch (er) {} } }, { passive: true }); // iOS: an interruption (call, lock) can leave audio suspended until a gesture
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); const ac = Audio.ctx; if (ac) { try { document.hidden ? ac.suspend() : ac.resume(); } catch (er) {} } }); // silent + paused in the background

  // ---- hold to view the whole map ----
  const mapBtn = $('#btnMap');
  function setPeek(on) { world.peek = on; mapBtn.classList.toggle('on', on); $('#mapTag').classList.toggle('on', on); if (on) { buzz(8); endTouch(); } }
  mapBtn.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); try { mapBtn.setPointerCapture(ev.pointerId); } catch {} if (state === 'playing' || state === 'intro') setPeek(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => mapBtn.addEventListener(n, () => setPeek(false)));
  mapBtn.addEventListener('contextmenu', ev => ev.preventDefault());
  addEventListener('keydown', ev => { if ((ev.key === 'm' || ev.key === 'M' || ev.key === 'Tab') && !ev.repeat && (state === 'playing' || state === 'intro')) { ev.preventDefault(); setPeek(true); } });
  addEventListener('keyup', ev => { if (ev.key === 'm' || ev.key === 'M' || ev.key === 'Tab') setPeek(false); });

  // ---- input: analog drag stick ----
  // Short drag = careful single steps with a long pause between them; drag farther = steps come faster;
  // near the edge of the ring = full swimming speed. The anchor floats along if you drag past the ring.
  const stickEl = $('#stick'), knobEl = stickEl.querySelector('.knob');
  let touch = null;
  const stickR = () => Math.round(Math.max(64, Math.min(96, Math.min(innerWidth, innerHeight) * 0.2)));
  const DEAD = 16;
  function stickSpeed(dist, R) { return Math.max(0, Math.min(1, (dist - DEAD) / (R - DEAD))); }
  function stepInterval(t) { // ms between steps for speed t in 0..1
    const fast = engine ? engine.tickMs : 225, slow = Math.max(470, fast * 2.1); return slow + (fast - slow) * Math.min(1, Math.pow(t / 0.85, 0.65)); }
  const onStickDown = ev => {
    if (state === 'intro') { beginPlay(); }
    if (state !== 'playing' || (ev.pointerType === 'mouse' && ev.button !== 0)) return; // touch, pen, or left-mouse drag
    const R = stickR(); touch = { id: ev.pointerId, ax: ev.clientX, ay: ev.clientY, x: ev.clientX, y: ev.clientY, dir: null, t: 0, wait: 0, full: false, R };
    stickEl.style.setProperty('--r', R + 'px'); stickEl.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`; knobEl.style.transform = 'translate(0,0)'; stickEl.classList.add('on'); stickEl.classList.remove('fast');
  };
  canvas.addEventListener('pointerdown', onStickDown);
  addEventListener('pointermove', ev => {
    if (!touch || ev.pointerId !== touch.id) return;
    let dx = ev.clientX - touch.ax, dy = ev.clientY - touch.ay; let dist = Math.hypot(dx, dy); const R = touch.R;
    if (dist > R) { const k = (dist - R) / dist; touch.ax += dx * k; touch.ay += dy * k; dx = ev.clientX - touch.ax; dy = ev.clientY - touch.ay; dist = R; stickEl.style.transform = `translate(${touch.ax}px, ${touch.ay}px)`; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    if (dist < DEAD) { if (touch.dir) { touch.dir = null; engine && engine.hold(null); } return; }
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    touch.t = stickSpeed(dist, R);
    if (dir !== touch.dir) { touch.dir = dir; if (engine) engine.press(dir); touch.wait = stepInterval(touch.t); buzz(5); }
    const full = touch.t > 0.9; if (full !== touch.full) { touch.full = full; stickEl.classList.toggle('fast', full); }
    if (engine) engine.hold(full ? dir : null);
  });
  function endTouch(ev) { if (!touch || (ev && ev.pointerId !== touch.id)) return; touch = null; stickEl.classList.remove('on'); if (engine && !heldOrder.length) engine.hold(null); }
  addEventListener('pointerup', endTouch); addEventListener('pointercancel', endTouch);
  function stickTick(dtMs) {
    if (!touch || !touch.dir || touch.full || !engine || state !== 'playing') return;
    touch.wait -= dtMs;
    if (touch.wait <= 0) { if (!engine.moveQueue || engine.moveQueue.length === 0) engine.press(touch.dir); touch.wait += stepInterval(touch.t); if (touch.wait < 0) touch.wait = stepInterval(touch.t); }
  }

  // ---- buttons ----
  // the title opens on finger-up; the browser's click that follows would land on whatever menu button is now under the finger
  // (it started a level straight from the title), so swallow clicks for a moment after it
  let clickGuard = false; document.addEventListener('click', ev => { if (clickGuard) { clickGuard = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
  function unlock() { if (state !== 'splash' || (typeof booting !== 'undefined' && booting)) return; clickGuard = true; setTimeout(() => { clickGuard = false; }, 0); /* the click is already queued behind this pointerup, so it runs before this timer */ Audio.init(); Audio.resume(); applyAudio(); tryFullscreen(); if (!save.introSeen) startCine(); else openHome(); }
  $('#splash').addEventListener('pointerup', unlock);
  $('#btnPlay').onclick = ev => { click(); buzz(10); wipeTo(() => startLevel(Math.min(save.unlocked, LEVELS.length) - 1), ev); };
  $('#btnDive').onclick = () => { click(); beginPlay(); };
  $('#btnPause').onclick = () => { click(); pause(); };
  $('#btnRestartHud').onclick = () => { if (state === 'playing') { buzz(20); restart(); toast('Fresh start!'); } };
  $('#btnResume').onclick = () => { click(); beginPlay(); };
  $('#btnRestart').onclick = restart;
  $('#btnQuit').onclick = ev => { click(); wipeTo(openHome, ev); };
  $('#btnResHome').onclick = ev => { click(); wipeTo(openHome, ev); };
  function nextLevel() { click(); const fromStory = storyOn ? ((World.CHAPTERS[levelIdx + 1] || {}).a || 'pipe') : false; wipeTo(() => { startLevel(levelIdx + 1); arriveNext = fromStory; }); }
  // ---- the story between levels: the diver drops through the gate into a tunnel pipe, walks out onto the sand and waves at the next
  // aquarium; the film holds on that frame under the result card. Continue -> the next level opens with the pipe in its corner.
  let storyOn = false, arriveNext = false;
  function storyOK() { return !dive && !replay && !REDUCED_MOTION && engine && engine.state === 'won' && !!World.CHAPTERS[levelIdx + 1] && !save.settings.noStory; }
  function storyFx(kind) { if (kind === 'flash') { flash(); Audio.play('thunder'); buzz([30, 40, 60]); } else if (kind === 'thunder') { Audio.play('thunder'); flash(); } else if (kind === 'roar') { Audio.play('stormWind'); buzz(40); } else if (kind === 'ink') Audio.play('bubble'); }
  // story lines said inside a level (soon after it starts, and when its gate opens); Pip nods along above the tank
  // ---- the story inside the levels: beats (s = start, p = first pearl in, m = after 24 s of play, g = gate opens) once per session,
  // a line when a dive fails, the Keeper's memory when her coin is found. Lines queue in one bubble (#talk); voice ids l<n>_<on>, k_<cause>_<i>, m<n>.
  const beatSeen = new Set(); let beatM = 0, talkQ = [], talkOn = false, talkTimer = 0, cutHold = false, deathSaid = false, lastDeath = '';
  function talk(who, txt, id, opt = {}) { if (dive || replay || CLIP) return 0; const item = { who, txt, id, opt }; if (talkOn && !opt.now) { if (talkQ.length < 2) talkQ.push(item); return 0; } return showTalk(item); }
  function showTalk({ who, txt, id, opt }) { const el = $('#talk'); if (!el) return 0; talkOn = true; const b = el.querySelector('b'); b.textContent = World.STORY_WHO[who] || ''; b.hidden = !who; el.dataset.who = who || 'narrator'; el.querySelector('p').textContent = txt; el.classList.toggle('cine', !!opt.cine);
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); if (who === 'pip') world.pipNod(); const vd = id && hasVo(id) ? Audio.voDur(id) : 0; if (vd) Audio.vo(id);
    const ms = Math.max(3200, txt.split(/\s+/).length * 330 + 900, vd * 1000 + 600); clearTimeout(talkTimer); talkTimer = setTimeout(() => { el.classList.remove('on'); talkOn = false; const nx = talkQ.shift(); if (nx) setTimeout(() => showTalk(nx), 350); }, ms); return ms; }
  function talkStop() { clearTimeout(talkTimer); talkQ = []; talkOn = false; const t = $('#talk'); if (t) t.classList.remove('on', 'cine'); }
  function beat(on) { if (dive || replay || CLIP || !engine) return; const n = levelIdx + 1, key = n + ':' + on; if (beatSeen.has(key)) return; const B = (LEVEL_BEATS[n] || []).find(b => b.on === on); if (!B) return; beatSeen.add(key);
    if (B.fx) world.storyFx(B.fx); if (B.fx === 'quake' || B.fx === 'tail') { Audio.play('stormWind'); buzz([30, 40, 30]); } talk(B.who, B.text, `l${n}_${on}`); }
  // a short cutscene inside the level before the first move: the world waits, letterbox, Grimtide stares into the tank. Any move ends it.
  function storyCut(B, n) { beatSeen.add(n + ':s'); cutHold = true; document.body.classList.add('cut'); world.peek = true; world.storyFx('stare'); Audio.play('thunder'); buzz([40, 60, 40]); talkStop();
    const ms = showTalk({ who: B.who, txt: B.text, id: `l${n}_s`, opt: { cine: true } }); clearTimeout(storyCut.t); storyCut.t = setTimeout(cutEnd, (ms || 3500) + 300); }
  function cutEnd() { clearTimeout(storyCut.t); if (!cutHold) return; cutHold = false; document.body.classList.remove('cut'); if (!mapBtn.classList.contains('on')) world.peek = false; const t = $('#talk'); if (t) t.classList.remove('cine'); }
  function startBeats(arriving) { const li = levelIdx, n = li + 1, B = !dive && (LEVEL_BEATS[n] || []).find(b => b.on === 's'); if (!B) return;
    setTimeout(() => { if (levelIdx !== li || !engine || (state !== 'playing' && state !== 'tut')) return; if (B.cut && !beatSeen.has(n + ':s') && state === 'playing' && !engine.begun && !REDUCED_MOTION) storyCut(B, n); else beat('s'); }, arriving ? 2600 : B.cut ? 1100 : 3200); }
  function deathLine() { deathSaid = false; if (dive || replay || CLIP || !engine || engine.deathCause === 'self') return; const n = levelIdx + 1, P = (DEATH_LINES[engine.deathCause] || []).map((l, i) => [l, i]).filter(([l]) => n >= l.a && n <= l.b); if (!P.length) return;
    let pk = P[Math.random() * P.length | 0]; if (P.length > 1 && pk[0].t === lastDeath) pk = P.find(q => q[0].t !== lastDeath); lastDeath = pk[0].t; deathSaid = true; talkStop(); talk(pk[0].w, pk[0].t, `k_${engine.deathCause}_${pk[1] + 1}`, { now: true }); }
  // the storm keeps rumbling / ink keeps drifting while you play (never the board, never during the first seconds)
  function condTick(dt) { const c = !dive && LEVEL_COND[levelIdx + 1]; if (c !== 'storm' && c !== 'ink') return; condT += dt; const gap = c === 'storm' ? 13 : 16; if (condT < gap) return; condT = -Math.random() * 4;
    if (c === 'ink') world.storyFx('ink'); else if (Math.random() < 0.6) { world.storyFx('flicker'); Audio.play('thunder'); } else { world.storyFx('quake'); Audio.play('stormWind'); buzz([20, 30, 20]); } }
  // lights out / dim water: a screen overlay keeps a pool of lamplight around the diver (same on every graphics tier; the board stays readable)
  let ldOn = -1; function lampDark() { const el = $('#lampDark'); if (!el) return; const c = !dive && engine && (state === 'playing' || state === 'tut') ? LEVEL_COND[levelIdx + 1] : null, k = c === 'dark' ? 0.74 : c === 'dim' ? 0.36 : 0;
    if (k !== ldOn) { ldOn = k; el.style.opacity = k ? 1 : 0; el.style.setProperty('--ld', k); } if (!k || !world.playerPos) return; const pp = world.playerPos, [x, y] = world.toScreen(pp.x, -pp.y), [x1] = world.toScreen(pp.x + 1, -pp.y), cell = Math.max(24, Math.abs(x1 - x));
    el.style.setProperty('--lx', x.toFixed(0) + 'px'); el.style.setProperty('--ly', y.toFixed(0) + 'px'); el.style.setProperty('--lr', (cell * 3.4).toFixed(0) + 'px'); }
  function startStory() { if (!storyOn || resultShown) return; const n = levelIdx + 1; let cv = null;
    if (n < LEVELS.length) { const map = LEVELS[n].map, cw = Math.max(1, map[0].length - 2), ch = Math.max(1, map.length - 2); cv = document.createElement('canvas'); cv.width = 720; cv.height = Math.round(720 * Math.min(1.1, Math.max(0.3, ch / cw))); try { levelPhoto(cv, n, false); } catch (er) {} }
    document.body.classList.add('story'); bannerOff();
    const chap = World.CHAPTERS[n] || World.CHAPTERS[1];
    world.storyStart({ w: worldOfIdx(levelIdx), n, ch: chap, tank: cv, voDur: storyVoLen, onQte: qteUI, trait: topTrait(), onFx: storyFx, onCap: (line, i) => storyCap(line, i, n, chap), onFreeze: () => { if (!storyOn || resultShown) return; storyCap(null); finishLevel(); if (n < LEVELS.length) $('#btnNext').textContent = 'Continue ›'; $('#resKicker').textContent = `Chapter ${n} · ${chap.t}`; } }); }
  // the film's caption: chapter number + title, then the story line (it fades between lines)
  // lines are [speaker, text]; a voice clip s<n>_<i> plays with its line when it exists (tools/voices.json lists them all)
  const storyVoLen = id => { const d = Audio.voDur(id); return d ? d + 0.45 : 0; };
  // an interactive beat in a film: big prompt, a ring that fills (tap / hold) or an arrow (swipe), gold burst on success
  // the player's style so far (brave / funny / kind answers in the films); ties go to brave
  function topTrait() { const T = save.trait || {}; return ['brave', 'funny', 'kind'].reduce((a, k) => (T[k] || 0) > (T[a] || 0) ? k : a, 'brave'); }
  const CHOICE_IC = { brave: '⚡', funny: '😄', kind: '💛' };
  function choiceUI(Q, ev, key) { const el = $('#choice'); if (!el) return;
    if (ev === 'start') { el.querySelector('b').textContent = Q.label; const box = el.querySelector('.ch-opts'); box.innerHTML = '';
      Q.opts.forEach(([k, lab], i) => { const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ch-o c-' + k; bt.dataset.k = k;
        bt.innerHTML = `<i aria-hidden="true">${CHOICE_IC[k] || '•'}</i><span></span>${isTouch ? '' : `<kbd>${i + 1}</kbd>`}`; bt.querySelector('span').textContent = lab;
        bt.addEventListener('click', e2 => { e2.stopPropagation(); const S = world.story; if (S && S.qte) { click(); S.qteIn('pick', k); } }); box.appendChild(bt); });
      el.hidden = false; el.classList.remove('on', 'done'); void el.offsetWidth; el.classList.add('on'); Audio.play('hint'); buzz(20); return; }
    if (ev === 'ok' || ev === 'no') { if (ev === 'ok') { save.trait = save.trait || {}; save.trait[key] = (save.trait[key] || 0) + 1; persist(); }
      const bt = el.querySelector(`.ch-o[data-k="${key}"]`); if (bt) bt.classList.add('picked'); el.classList.add('done'); setTimeout(() => { el.classList.remove('on', 'done'); el.hidden = true; }, 650); return; }
    if (ev === 'hide') { el.classList.remove('on', 'done'); el.hidden = true; } }
  // the action scene's HUD: title + progress, three lamp lives, pearl count, pop words; pearls pay coins once (not when re-watching)
  let runPopT = 0;
  function runUI(Q, ev, st) { const el = $('#runHud'); if (!el) return; const pop = (txt, cls) => { const p = el.querySelector('.rh-pop'); p.textContent = txt; p.className = 'rh-pop on ' + (cls || ''); clearTimeout(runPopT); runPopT = setTimeout(() => { p.className = 'rh-pop'; }, 700); };
    if (ev === 'start') { el.hidden = false; el.className = 'on v-' + (Q.v || 'dive'); document.body.classList.add('running'); el.querySelector('.rh-t').textContent = Q.label; el.querySelector('.rh-hint').textContent = isTouch ? 'Drag to swim · dodge · grab the pearls' : 'Arrow keys / WASD or drag · dodge · grab the pearls';
      el.querySelector('.rh-lives').innerHTML = '<i></i><i></i><i></i>'; el.querySelector('.rh-n').textContent = '0'; el.style.setProperty('--rp', 0); pop('Ready…', 'go'); setTimeout(() => { if (world.story && world.story.run) { pop('SWIM!', 'go'); Audio.play('hint'); } }, 1000); buzz([20, 30, 20]); return; }
    if (ev === 'prog') { el.style.setProperty('--rp', st.prog); return; }
    if (ev === 'got') { el.querySelector('.rh-n').textContent = st.got; el.querySelector('.rh-sc').classList.remove('bump'); void el.offsetWidth; el.querySelector('.rh-sc').classList.add('bump'); buzz(8); return; }
    if (ev === 'close') { pop(['Close!', 'Whoa!', 'Nice!', 'Too close!'][st.close % 4], 'close'); Audio.play('swim'); buzz(12); return; }
    if (ev === 'hit') { el.querySelectorAll('.rh-lives i').forEach((h, i) => h.classList.toggle('off', i >= st.lives)); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); pop('Ouch!', 'hit'); Audio.play('bump'); buzz([40, 30, 60]); return; }
    if (ev === 'ok' || ev === 'no') { const coins = !watching && st ? Math.min(30, st.got) : 0; if (coins) { save.coins = (save.coins || 0) + coins; persist(); }
      pop((ev === 'ok' ? (st && st.lives === 3 ? 'Flawless! ' : 'Made it! ') : 'Out of luck… ') + (st ? `✦ ${st.got}` : '') + (coins ? ` · +${coins} coins` : ''), ev === 'ok' ? 'go big' : 'hit big'); if (ev === 'ok') Audio.play('star');
      setTimeout(() => { el.className = ''; el.hidden = true; document.body.classList.remove('running'); }, 1500); return; }
    if (ev === 'hide') { el.className = ''; el.hidden = true; document.body.classList.remove('running'); } }
  function qteUI(Q, ev, prog) { if (Q && Q.kind === 'run') return runUI(Q, ev, prog); if (ev === 'hide') runUI(null, 'hide'); if (Q && Q.kind === 'choice') return choiceUI(Q, ev, prog); const el = $('#qte'); if (!el) return; if (ev === 'hide') choiceUI(null, 'hide'); document.body.classList.toggle('qte-on', ev === 'start' || ev === 'prog'); if (ev === 'hide') { el.className = ''; el.hidden = true; return; }
    if (ev === 'start') { el.hidden = false; el.className = 'on k-' + Q.kind + (Q.dir ? ' d-' + Q.dir : ''); el.querySelector('b').textContent = Q.label;
      el.querySelector('small').textContent = Q.kind === 'tap' ? (isTouch ? 'Tap, tap, tap!' : 'Tap Space fast!') : Q.kind === 'hold' ? (isTouch ? 'Press and hold!' : 'Hold Space!') : (isTouch ? 'Swipe!' : 'Press an arrow key!');
      el.style.setProperty('--qp', 0); Audio.play('hint'); buzz([30, 30, 30]); return; }
    if (ev === 'prog') { el.style.setProperty('--qp', Math.min(1, prog || 0)); if (Q.kind !== 'hold') { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); } return; }
    el.classList.add(ev === 'ok' ? 'win' : 'lose'); el.style.setProperty('--qp', ev === 'ok' ? 1 : 0); if (ev === 'ok') { Audio.play('star'); buzz([20, 40, 60]); } else { Audio.play('bump'); buzz(60); }
    setTimeout(() => { if (!world.story || !world.story.qte) { el.className = ''; el.hidden = true; } }, 900); }
  function storyCap(line, i, n, ch) { const el = $('#storyCap'); if (!el) return; if (!line) { el.classList.remove('on'); $('#storySkip').hidden = true; Audio.stopVo(); return; }
    const who = line.who || '', txt = line.text || ''; el.querySelector('small').textContent = n ? `Chapter ${n} · ${ch.t}` : `Prologue · ${ch.t}`;
    const b = el.querySelector('b'); b.textContent = World.STORY_WHO[who] || ''; b.hidden = !who; el.dataset.who = who || 'narrator';
    const pEl = el.querySelector('p'); pEl.classList.remove('in'); void pEl.offsetWidth; pEl.textContent = txt; pEl.classList.add('in'); el.classList.add('on'); $('#storySkip').hidden = false;
    if (line.id && hasVo(line.id)) Audio.vo(line.id); }
  function storyEnd() { storyCap(null); talkStop(); qteUI(null, 'hide'); watching = false; document.body.classList.remove('watching'); if (!storyOn && !document.body.classList.contains('story')) return; storyOn = false; world.storyStop(); document.body.classList.remove('story'); heldDirty = true; }
  function storySkip(all) { const S = world.story; if (!(storyOn && !resultShown && S && S.t > 0.35)) return false; // a tap shows the next line; Skip (or the last tap) jumps to the end
    if (S.qte && !all) return true; // taps belong to the interactive beat
    if (!all && S.li < S.seq.length && S.seq[S.li].t0 !== undefined) S.t = Math.max(S.t, S.seq[S.li].t0); else if (!all && !S.qDone) S.t = Math.max(S.t, S.qAt); else { S.skipAll(); Audio.stopVo(); qteUI(null, 'hide'); } return true; }
  let qx = 0, qy = 0;
  addEventListener('pointerdown', ev => { if (ev.target && ev.target.closest && ev.target.closest('#storySkip')) return; const S = world.story; if (storyOn && S && S.qte) { qx = ev.clientX; qy = ev.clientY; if (S.qte.kind === 'run') { runDrag = [ev.clientX, ev.clientY]; return; } S.qteIn('down'); buzz(10); return; } storySkip(); }, true);
  addEventListener('pointerup', ev => { const S = world.story; if (storyOn && S && S.qte) S.qteIn(Math.hypot(ev.clientX - qx, ev.clientY - qy) > 40 ? 'swipe' : 'up'); }, true);
  addEventListener('keyup', ev => { const S = world.story; if (storyOn && S && S.qte && S.qte.kind === 'run') { S.qteIn('key', { k: ev.key.length === 1 ? ev.key.toLowerCase() : ev.key, on: false }); return; } if (storyOn && S && S.qte && (ev.key === ' ' || ev.key === 'Enter')) S.qteIn('up'); });
  let runDrag = null; // drag anywhere to steer in an action scene (relative, like a thumbstick without a stick)
  addEventListener('pointermove', ev => { const S = world.story; if (!runDrag || !(storyOn && S && S.qte && S.qte.kind === 'run')) return; S.qteIn('drag', { dx: (ev.clientX - runDrag[0]) / Math.max(320, innerWidth) * (isTouch ? 1.6 : 1), dy: (ev.clientY - runDrag[1]) / Math.max(320, innerHeight) * (isTouch ? 1.6 : 1) }); runDrag = [ev.clientX, ev.clientY]; }, { passive: true });
  addEventListener('pointerup', () => { runDrag = null; }); addEventListener('pointercancel', () => { runDrag = null; });
  $('#storySkip').addEventListener('click', ev => { ev.stopPropagation(); click(); storySkip(true); });
  // ---- the story journal: every chapter you've reached, to read again or watch again (chapter 0 = the intro film)
  let watching = false;
  function buildJournal() { const L = $('#jList'); if (!L) return; const CH = World.CHAPTERS, WHO = World.STORY_WHO; let html = '';
    const row = (n, title, lines, open) => `<li class="jr${open ? '' : ' locked'}" style="--i:${n}"><div class="jh"><span class="jn">${n ? 'Chapter ' + n : 'Prologue'}</span><b>${open ? title : 'Locked'}</b>${open ? `<button class="pill-btn jw" data-ch="${n}"><svg class="i" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Watch</button>` : ''}</div>`
      + (open ? `<div class="jt">${lines.map(([w, t0]) => { const t = t0 && typeof t0 === 'object' ? (t0[topTrait()] || t0.brave) : t0; return `<p${w ? ` data-who="${w}"` : ''}>${w ? `<em>${WHO[w] || ''}:</em> ` : ''}${t.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>`; }).join('')}</div>` : `<div class="jt"><p>Wake gate ${n} to read this chapter.</p></div>`) + '</li>';
    html += row(0, World.PROLOGUE.t, World.PROLOGUE.L.concat([['', 'But one little diver turns on a light…']]), true);
    let got = 0; for (let n = 1; n < CH.length; n++) { const open = !!save.stars[n]; if (open) got++; html += row(n, CH[n].t, CH[n].L, open); }
    { const R = save.relics || {}, mem = Object.keys(R).filter(k => MEM_LINES[k]).sort((a, b) => a - b);
      html += `<li class="jr jm" style="--i:31"><div class="jh"><span class="jn">The Keeper’s coins</span><b>${mem.length} of ${LEVELS.length} memories</b></div><div class="jt">${mem.length ? mem.map(k => `<p data-who="keeper"><em>Level ${k}:</em> “${MEM_LINES[k]}”</p>`).join('') : '<p>Each level hides one of the Reef Keeper’s gold coins. Find one to hear her memory.</p>'}</div></li>`; }
    L.innerHTML = html; $('#jCount').textContent = `${got} of ${CH.length - 1} chapters`;
    L.querySelectorAll('.jw').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); click(); const n = +b.dataset.ch; if (!n) { startCine(); return; } watchChapter(n); })); }
  function watchChapter(n) { const chap = World.CHAPTERS[n]; if (!chap) return; loadVoice(packOf(n)); const nx = Math.min(n, LEVELS.length - 1), map = LEVELS[nx].map, cv = document.createElement('canvas');
    cv.width = 720; cv.height = Math.round(720 * Math.min(1.1, Math.max(0.3, (map.length - 2) / Math.max(1, map[0].length - 2)))); try { levelPhoto(cv, nx, false); } catch (er) {}
    show(null); resultShown = false; storyOn = true; watching = true; document.body.classList.add('story', 'watching');
    world.storyStart({ w: worldOfIdx(n - 1), n, ch: chap, tank: n < LEVELS.length ? cv : null, onFx: storyFx, voDur: storyVoLen, onQte: qteUI, trait: topTrait(), onCap: (line, i) => storyCap(line, i, n, chap), onFreeze: () => { storyCap(null); setTimeout(endWatch, 1400); } }); }
  function endWatch() { if (!watching) return; watching = false; storyEnd(); document.body.classList.remove('watching'); go('journal'); }
  $('#btnNext').onclick = () => { if (dive && engine.state === 'won') { click(); lbTab = 'fast'; openHome(); go('ranks'); return; } if (engine.state === 'won' && levelIdx + 1 < LEVELS.length) nextLevel(); else if (engine.state === 'won') openEnding(); else if (engine.state !== 'won' && history.length && (undoLeft > 0 || undoFree())) undo(); else restart(); };
  // the finale: all 30 gates awake. A one-time coin bonus, the story's payoff, and a nudge to go back for every star.
  // the finale: 30 gate lights wake one by one (rising notes), fireworks of pearl-light, the title and the diver, then a credits roll;
  // a tap skips straight to the end card. Its own rAF loop (the game's frame loop holds behind it).
  function finale(done) { const F = $('#finale'); if (!F || REDUCED_MOTION) { done(); return; }
    show(null); F.hidden = false; F.className = ''; const G = $('#finGates'); G.innerHTML = '<i></i>'.repeat(30); const cnt = $('#finCount b'); cnt.textContent = '0';
    const cv = $('#finCv'), cx = cv.getContext('2d'), P = [], T = []; let alive = true, last = performance.now(), tFire = 0;
    const fit = () => { const r = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * r; cv.height = innerHeight * r; cx.setTransform(r, 0, 0, r, 0, 0); }; fit();
    const COL = ['#ff4a5a', '#ffd23d', '#8ff0ff', '#ffffff', '#ff9d0a', '#b88cff'];
    const burst = (x, y, n, big) => { const c1 = COL[Math.floor(Math.random() * COL.length)], c2 = COL[Math.floor(Math.random() * COL.length)];
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (big ? 260 : 170) * (0.35 + Math.random() * 0.75); P.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1.3 + Math.random() * 0.9, t: 0, c: i % 3 ? c1 : c2, r: 1.6 + Math.random() * 2.2, k: 0 }); } };
    const confetti = n => { for (let i = 0; i < n; i++) P.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.4, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 90, l: 7, t: 0, c: COL[i % COL.length], r: 3 + Math.random() * 3, k: 1, s: Math.random() * 6, w: 2 + Math.random() * 4 }); };
    const loop = now => { if (!alive) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; cx.clearRect(0, 0, innerWidth, innerHeight);
      if (F.classList.contains('lit') && !F.classList.contains('roll')) { tFire -= dt; if (tFire <= 0) { tFire = 0.35 + Math.random() * 0.5; burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.12 + Math.random() * 0.4), 70, Math.random() < 0.3); } }
      cx.globalCompositeOperation = 'lighter';
      for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; p.t += dt; if (p.t > p.l || p.y > innerHeight + 40) { P.splice(i, 1); continue; } const a = 1 - p.t / p.l;
        if (p.k) { p.vy = Math.min(p.vy + 30 * dt, 160); p.x += (p.vx + Math.sin(p.t * 3 + p.s) * 40) * dt; p.y += p.vy * dt; cx.globalCompositeOperation = 'source-over'; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.t * 4 + p.s); cx.scale(1, Math.abs(Math.sin(p.t * 5 + p.s))); cx.fillStyle = p.c; cx.globalAlpha = Math.min(1, a * 3); cx.fillRect(-p.w, -p.r, p.w * 2, p.r * 2); cx.restore(); cx.globalCompositeOperation = 'lighter'; continue; }
        p.vx *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.6 * dt) + 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        cx.globalAlpha = a; cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.r * (0.6 + a), 0, 7); cx.fill(); cx.globalAlpha = a * 0.25; cx.beginPath(); cx.arc(p.x, p.y, p.r * 4, 0, 7); cx.fill(); }
      cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const at = (ms, fn) => T.push(setTimeout(() => { if (alive) fn(); }, ms));
    const gates = G.children; for (let i = 0; i < 30; i++) at(700 + i * 85, () => { gates[i].classList.add('on'); cnt.textContent = i + 1; if (i % 3 === 0) Audio.pearl(1 + (i / 3 % 7)); if (i % 5 === 4) buzz(8); });
    at(700 + 30 * 85 + 250, () => { F.classList.add('lit'); Audio.vo('n_fin1'); Audio.play('gateOpen'); Audio.swell && Audio.swell(); buzz([30, 60, 30, 60, 90]); const r = G.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 160, true); confetti(140); });
    at(4300, () => { F.classList.add('title'); Audio.play('win'); confetti(90); }); at(7200, () => Audio.vo('n_fin2'));
    at(9800, () => F.classList.add('roll'));
    const end = () => { if (!alive) return; alive = false; T.forEach(clearTimeout); Audio.stopVo(); F.hidden = true; F.className = ''; removeEventListener('resize', fit); done(); };
    at(27500, end); addEventListener('resize', fit);
    F.onclick = () => { click(); end(); }; finale.end = end; }
  function openEnding() { click(); setState('ending'); finale(() => { if (state === 'ending') openEndCard(); }); }
  function openEndCard() { Audio.play('win'); show('ending'); const first = !save.finished;
    if (first) { save.finished = 1; save.coins += 200; persist(); } $('#endCoins').hidden = !first;
    const stars = totalStars(), tr = (save.stats && save.stats.treasures) || 0;
    $('#endStats').innerHTML = `<div class="stat"><b>${stars}/${LEVELS.length * 3}</b><span>stars</span></div><div class="stat"><b>${tr}</b><span>treasures</span></div><div class="stat"><b>${save.coins}</b><span>coins</span></div>`;
    $('#btnEndStars').textContent = stars >= LEVELS.length * 3 ? 'Every star found!' : 'Find every star'; }
  $('#btnEndStars').onclick = () => { click(); openHome(); go('levels'); };
  $('#btnEndHome').onclick = () => { click(); openHome(); };
  $('#btnEndIntro').onclick = () => { click(); openHome(); setTimeout(() => { if (typeof startCine === 'function') startCine(); }, 50); };
  $('#btnRetry').onclick = () => { restart(); };
  $('#btnResLevels').onclick = ev => { click(); wipeTo(() => { openHome(); go('levels'); }, ev); };
  function tryFullscreen(force) { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen && force) el.requestFullscreen().catch(() => {}); }
  // settings
  // volumes: three sliders (music / ambience / sound effects), in Settings and on the pause screen, plus Mute on the pause screen.
  // Older saves had on/off switches: "Ambience" off meant no music and no bed, "Sound effects" off meant no effects.
  function vols() { const st = save.settings; if (!st.vol || typeof st.vol !== 'object') st.vol = { music: st.music === false ? 0 : 0.55, amb: st.music === false ? 0 : 0.8, sfx: st.sfx === false ? 0 : 1 };
    for (const [k, d] of [['music', 0.55], ['amb', 0.8], ['sfx', 1]]) { const v = +st.vol[k]; st.vol[k] = isFinite(v) ? Math.max(0, Math.min(1, v)) : d; } return st.vol; }
  function applyAudio() { const v = vols(); for (const k of ['music', 'amb', 'sfx']) Audio.setVol(k, v[k]); Audio.setMusic(true); Audio.setMuted(!!save.settings.mute); syncVolUI(); }
  function syncVolUI() { const v = vols(); document.querySelectorAll('input.vol[data-vol]').forEach(el => { const k = el.dataset.vol, n = Math.round(v[k] * 100); if (+el.value !== n) el.value = n; el.style.setProperty('--p', n + '%');
      const o = el.parentElement.querySelector('.vol-v'); if (o) o.textContent = n ? n + '%' : 'Off'; }); }
  let volSave = 0;
  document.querySelectorAll('input.vol[data-vol]').forEach(el => {
    el.addEventListener('input', () => { const k = el.dataset.vol, v = Math.max(0, Math.min(1, el.value / 100)); vols()[k] = v; Audio.setVol(k, v);
      if (save.settings.mute && v > 0) { save.settings.mute = false; Audio.setMuted(false); syncSound(); } syncVolUI(); clearTimeout(volSave); volSave = setTimeout(persist, 300); });
    el.addEventListener('change', () => { if (el.dataset.vol === 'sfx') Audio.play('pearl'); persist(); }); // let them hear the new effects level
    el.addEventListener('pointerdown', ev => ev.stopPropagation()); });
  function syncSound() { const on = !save.settings.mute; $('#sndLbl').textContent = on ? 'Sound on' : 'Muted'; const w = $('#sndWave'); if (w) w.style.display = on ? '' : 'none'; const ic = $('#btnSound .ico'); if (ic) ic.style.setProperty('--ico', `var(--ui-${on ? 'i_sound' : 'i_mute'})`); }
  function syncSettings() { syncVolUI(); $('#setVibe').checked = save.settings.vibe; $('#setFps').checked = !!save.settings.fps; $('#fpsMeter').hidden = !save.settings.fps;
    $('#setRelax').checked = !!save.settings.relaxed; $('#setCb').checked = !!save.settings.cb; $('#setBig').checked = !!save.settings.bighud; $('#setDanger').checked = save.settings.danger !== false;
    document.querySelectorAll('#setQuality button').forEach(b => b.classList.toggle('on', b.dataset.q === gfxMode()));
    document.querySelectorAll('#setRes button').forEach(b => b.classList.toggle('on', b.dataset.r === (save.settings.res || 'auto')));
    const rn = $('#resNow'); if (rn) rn.textContent = `Now: ${Math.round((world.resLock || world.resScale || 1) * 100)}% · ${world.renderer.domElement.width}×${world.renderer.domElement.height}`;
    const gn = $('#gfxNow'); if (gn) gn.textContent = gfxMode() === 'auto' ? `Now: ${world.quality[0].toUpperCase()}${world.quality.slice(1)}` : ''; }
  $('#setVibe').onchange = e => { save.settings.vibe = e.target.checked; persist(); buzz(15); };
  function applyAccess() { World.setColorMarks(save.settings.cb); document.body.classList.toggle('cb', !!save.settings.cb); document.body.classList.toggle('bighud', !!save.settings.bighud); }
  $('#setRelax').onchange = e => { save.settings.relaxed = e.target.checked; persist(); toast(e.target.checked ? 'Relaxed mode: no air timer (1 star per level)' : 'Air timer back on'); };
  $('#setDanger').onchange = e => { save.settings.danger = e.target.checked; persist(); dangerScan(); };
  $('#setCb').onchange = e => { save.settings.cb = e.target.checked; persist(); applyAccess(); };
  $('#setBig').onchange = e => { save.settings.bighud = e.target.checked; persist(); applyAccess(); };
  applyAccess();
  $('#setFps').onchange = e => { save.settings.fps = e.target.checked; persist(); $('#fpsMeter').hidden = !e.target.checked; };
  $('#fpsMeter').hidden = !save.settings.fps; const FPSM = { n: 0, t: 0 }; // optional on-screen meter (Settings → Show FPS) so real-device speed can be read off a phone
  document.querySelectorAll('#setQuality button').forEach(b => b.onclick = () => { click(); save.settings.gfx = b.dataset.q; persist(); if (b.dataset.q !== 'auto') world.setQuality(b.dataset.q); syncSettings(); });
  world.onQuality = () => syncSettings();
  // resolution: Auto (the game lowers it when frames drop) or a fixed share of the screen's pixels
  function applyRes() { const r = save.settings.res; world.resLock = r && r !== 'auto' ? +r : null; world.setQuality(world.quality); }
  document.querySelectorAll('#setRes button').forEach(b => b.onclick = () => { click(); save.settings.res = b.dataset.r; persist(); applyRes(); syncSettings(); });
  applyRes();
  world.onAutoTier = q => { if (gfxMode() === 'auto' && save.settings.aqTier !== q) { save.settings.aqTier = q; persist(); } }; // the next launch starts its tuning near here
  $('#btnSound').onclick = () => { save.settings.mute = !save.settings.mute; Audio.setMuted(!!save.settings.mute); persist(); syncSound(); if (!save.settings.mute) click(); };
  $('#btnReset').onclick = () => { const b = $('#btnReset'); click();
    if (!b.classList.contains('sure')) { b.classList.add('sure'); b.dataset.t = b.textContent; b.textContent = document.body.classList.contains('touch') ? 'Sure? Tap again' : 'Sure? Click again'; buzz(20); clearTimeout(b.tm); b.tm = setTimeout(() => { b.classList.remove('sure'); b.textContent = b.dataset.t; }, 3500); return; }
    clearTimeout(b.tm); b.classList.remove('sure'); b.textContent = b.dataset.t; save.unlocked = 1; save.stars = {}; save.best = {}; persist(); refreshHome(); toast('Progress erased'); };
  syncSettings();
  // graphics: 'auto' (default) adapts to the frame rate; an older 'Battery saver' choice carries over as low
  function gfxMode() { if (!save.settings.gfx) save.settings.gfx = save.settings.quality === 'low' ? 'low' : 'auto'; return save.settings.gfx; }
  if (gfxMode() !== 'auto') world.setQuality(gfxMode());
  applyAudio();

  // ---- loop ----
  let heldFrame = false, heldDirty = false, lastHeld = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.max(0, (now - lastFrame) / 1000); const dt = Math.min(0.05, realDt); lastFrame = now;
    if (state === 'clip' && CLIP) { frame.last = now; try { clipFrame(realDt, now); } catch (er) { console.warn('clip', er); clipFinish(true); } return; }
    if (save.settings.fps) { FPSM.n++; FPSM.t += realDt; if (FPSM.t >= 0.5) { $('#fpsMeter').textContent = `${Math.round(FPSM.n / FPSM.t)} fps · ${world.quality} · ${Math.round((world.resLock || world.resScale || 1) * 100)}% · ${world.renderer.domElement.width}×${world.renderer.domElement.height}`; FPSM.n = 0; FPSM.t = 0; } }
    if (engine && (state === 'playing' || state === 'over')) {
      if (state === 'playing') {
        stickTick(realDt * 1000);
        acc = Math.min(acc + (now - (frame.last || now)), 300); frame.last = now; // a long gap (tab throttled, iframe off-screen, GC) must not fast-forward the dive
        if (beginPlay.pk && ((engine.moveQueue && engine.moveQueue.length) || engine.held)) setHeldPeekOff(); // the first move ends the opening look
        if (banner.start && ((engine.moveQueue && engine.moveQueue.length) || engine.held)) { banner.start = false; bannerOff(); } // ...and the level-name banner (it sat over the tank)
        { const mv = (engine.moveQueue && engine.moveQueue.length) || engine.held || touch; if (mv) quietAt = now; const q = !!quietAt && now - quietAt < 1200 && (engine.relaxed || engine.oxygen > 15); if (q !== quietOn) { quietOn = q; document.body.classList.toggle('swim', q); } } // quiet HUD while swimming
        undoSync(); // the undo lifeline appears in tight spots and fades a few seconds later
        lampDark();
        if (slowMo > 0) { slowMo = Math.max(0, slowMo - realDt); acc = 0; } // the world holds its breath for a moment
        if (planHold) { if ((engine.moveQueue && engine.moveQueue.length) || engine.held) { planHold = false; planJob++; HINT.busy = false; $('#btnHint').classList.remove('busy'); } else acc = 0; }
        if (undoHold) { if ((engine.moveQueue && engine.moveQueue.length) || engine.held) undoHold = false; else acc = 0; }
        if (cutHold) { if ((engine.moveQueue && engine.moveQueue.length) || engine.held) cutEnd(); else acc = 0; } // an in-level cutscene: the world waits
        if (engine.moveQueue && engine.moveQueue.length && acc >= engine.tickMs * 0.6 && acc < engine.tickMs) acc = engine.tickMs; // a fresh tap moves now instead of waiting out the tick
        while (acc >= engine.tickMs) {
          acc -= engine.tickMs;
          const pre = (engine.moveQueue.length || engine.held) && engine.player ? cloneEngine(engine) : null, px0 = engine.player && engine.player.x, py0 = engine.player && engine.player.y;
          if (pre) pre.__log = runLog.length;
          engine.step(); tickWorld(engine, now - acc); dangerScan();
          { const p = engine.player; runLog += p && p.x !== px0 ? (p.x > px0 ? 'R' : 'L') : p && p.y !== py0 ? (p.y > py0 ? 'D' : 'U') : '.'; }
          if (pre && engine.player && (engine.player.x !== px0 || engine.player.y !== py0)) { history.push(pre); if (history.length > 200) history.shift(); stuckTimer = 0; }
          if (engine.state !== 'playing') { overTimer = 0; if (engine.state === 'dead') deathLine(); if (engine.state === 'won' && !storyOK()) clearStamp(); setState('over'); hideStuck(); Audio.setTension(0); held.clear(); heldOrder = []; endTouch(); buzz(engine.state === 'won' ? 30 : [40, 40, 60]); break; }
        }
        if (engine.state === 'playing') {
          coachTick(realDt); checkStuck(); hintSync(); if (engine.begun && !cutHold) { beatM += realDt; if (beatM > 24) beat('m'); condTick(realDt); }
          Audio.setTension(engine.relaxed ? 0 : (15 - engine.oxygen) / 15);
          if (engine.gate && engine.gate.open && !gateNudged && performance.now() - gateOpenAt > 8000) { gateNudged = true; toast('Swim into the glowing gate to finish ✨'); }
          stuckTimer += realDt; if (!stuckShown && stuckTimer > 22 && engine.ballsIn < engine.ballsTotal) { stuckShown = true; undoNeed(8000); toast(isTouch ? 'Stuck? Tap 💡 for a hint, or ↶ to undo' : 'Stuck? Click 💡 for a hint, or press Z to undo'); $('#btnHint').classList.add('nudge'); setTimeout(() => $('#btnHint').classList.remove('nudge'), 4000); }
          if (engine.oxygen < 15 && !engine.relaxed) { lowAirBeep -= dt; if (lowAirBeep <= 0) { lowAirBeep = engine.oxygen < 6 ? 1.3 : 2.4; Audio.play('lowAir'); /* calm: a soft pulse every few seconds, not a beeper */ } }
        }
        updateHud();
      } else { // over: keep physics animating briefly, then show result
        overTimer += realDt; frame.last = now;
        acc += dt * 1000; while (acc >= engine.tickMs) { acc -= engine.tickMs; engine.step(); tickWorld(engine, now - acc); }
        updateHud();
        if (!resultShown && !storyOn) { if (engine.state === 'won' && storyOK()) { if (overTimer > 1.25) { storyOn = true; wipeTo(startStory); } } else if (overTimer > (engine.state === 'won' ? 2.1 : deathSaid ? 2.6 : 1.4)) finishLevel(); }
      }
    } else {
      frame.last = now;
      if (state === 'cine' && cine) cineTick(realDt, now);
      else if (state === 'replay' && replay) replayTick(realDt, now);
      else if (state === 'menu' && menuEngine) { acc += dt * 1000; while (acc >= menuEngine.tickMs) { acc -= menuEngine.tickMs; menuEngine.step(); world.onTick(menuEngine, now - acc); } }
    }
    // the 3D world holds still while a screen covers it (level map, menus, pause, results): draw one fresh frame for the
    // blurred backdrop, then stop re-rendering until the screen closes. Saves the whole GPU budget on those screens.
    const covered = state !== 'playing' && state !== 'cine' && state !== 'replay' && (!!document.querySelector('.screen.sheet.on, #levels.on') || (state === 'menu' && HM3.matches && $('#home').classList.contains('on')) || (state === 'splash' && $('#splash').classList.contains('on')) || (state === 'ending' && !$('#finale').hidden));
    if (covered && heldFrame && !heldDirty) { lastHeld = now; return; }
    heldFrame = covered; heldDirty = false;
    if (TUT.on) tutPlace();
    { world.update(slowMo > 0 ? dt * 0.3 : dt, now); world.render(); if (!covered && gfxMode() === 'auto' && (state === 'playing' || state === 'menu' || state === 'cine')) world.autoQuality(realDt); }
  }
  addEventListener('resize', () => { heldDirty = true; world.resize(); homeLayout(); if (state === 'menu' && $('#home').classList.contains('on')) { clearTimeout(homeCard.t); homeCard.t = setTimeout(homeCard, 250); } if ($('#levels').classList.contains('on')) renderWorld(); });
  canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); if (state === 'playing') pause(); }, false);
  canvas.addEventListener('webglcontextrestored', () => { try { const e = state === 'cine' ? cineEngine : state === 'menu' || state === 'splash' ? menuEngine : engine; if (e) { if (state === 'playing' || state === 'paused' || state === 'over') world.keepTreasures(); world.loadLevel(e); world.onTick(e, performance.now()); if (state === 'playing' || state === 'paused' || state === 'over' || state === 'cine') world.startPlay(); if (state === 'cine') world.cineCam = true; } } catch (er) { console.warn('context restore', er); } }, false);
  requestAnimationFrame(frame);
  // ---- boot: loading screen -> decode art -> pre-build & pre-compile the intro level, a monster level and the menu -> title screen
  setState('splash'); show(null); let booting = true;
  const boot = {}; const dropLoader = () => { booting = false; clearInterval(boot.tipT); const L = $('#loader'); if (L) { L.classList.add('done'); setTimeout(() => L.remove(), 700); } };
  (async () => { const bar = $('#loadBar'), tip = $('#loadTip'), pause = () => new Promise(r => setTimeout(r, 0)); let shown = 0;
    const prog = (k, msg) => { shown = Math.max(shown, k); if (bar) bar.style.width = (shown * 100).toFixed(0) + '%'; const L = $('#loader'); if (L) L.style.setProperty('--ldp', Math.max(3, shown * 100).toFixed(0) + '%'); if (msg && tip) tip.textContent = msg; };
    { const H = ['Stones fall when you dig under them. <b>Never stand below one!</b>', 'Pearls roll off round things. Use that to steer them.', 'In a tight spot the <b>Undo</b> button pops up. You get 3 per try.', 'Air only starts counting <b>on your first move</b>.', 'Every level hides an ancient <b>relic</b>. Can you find all 30?', 'A stone dropped on a monster is a <b>BONK!</b> combo.', 'The 💡 hint plans a way out from wherever you are.'];
      const el = $('#ldHint'); let hi = Math.floor(Math.random() * H.length); const nx = () => { if (!el) return; el.classList.add('out'); setTimeout(() => { el.innerHTML = '<b>Tip</b> · ' + H[hi++ % H.length]; el.classList.remove('out'); }, 350); };
      if (el) { el.innerHTML = '<b>Tip</b> · ' + H[hi++ % H.length]; boot.tipT = setInterval(nx, 3400); } }
    try {
      prog(0.04, 'Filling the tank…'); await World.ready(k => prog(0.04 + k * 0.46));
      // tune graphics first, on one of the busiest levels, so every level below is warmed at the tier the device will really use
      if (gfxMode() === 'auto') { if (!booting) return; prog(0.5, 'Tuning graphics for your device…'); await pause(); if (!booting) return;
        try { const eb = new Engine(LEVELS[20]); eb.time = eb.oxygen = 999; world.warm(eb); const order = ['low', 'medium', 'high', 'ultra'], ceil = world.deviceCeiling(), learned = save.settings.aqTier;
          const start = learned && order.indexOf(learned) >= 0 && order.indexOf(learned) < order.indexOf(ceil) ? order[order.indexOf(learned) + 1] : ceil; // one step above what play settled on last time
          const r = await world.benchmark(start, q => { if (tip) tip.textContent = 'Tuning graphics: ' + q[0].toUpperCase() + q.slice(1) + '…'; });
          if (tip) tip.textContent = 'Graphics: ' + r.q[0].toUpperCase() + r.q.slice(1); console.info('graphics tuned', r); } catch (er) { console.warn('bench', er); } }
      if (!booting) return; prog(0.56, 'Warming up the lights…'); await pause(); if (!booting) return; const e1 = new Engine(LEVELS[0]); e1.time = e1.oxygen = 999; world.warm(e1);
      // pre-compile every shader variant the levels use (piranha, jellyfish, crab, air capsule, deep-world rock): these five levels
      // between them cover all of them, so no level stutters the first time it opens
      { const W5 = [1, 5, 8, 11, 20]; for (let k = 0; k < W5.length; k++) { if (!booting) return; prog(0.6 + k * 0.06, k < 2 ? 'Waking up the reef…' : 'Calling the fish home…'); await pause(); if (!booting) return; const e2 = new Engine(LEVELS[W5[k]]); e2.time = e2.oxygen = 999; world.warm(e2); } }
      if (!booting) return; prog(0.9, 'Almost there…'); await pause(); if (!booting) return; showMenuScene(); world.warm(menuEngine);
    } catch (er) { console.warn('preload', er); try { showMenuScene(); } catch (e2) {} }
    if (!booting) return; prog(1, 'Ready!'); await new Promise(r => setTimeout(r, 250)); if (!booting) return;
    show('splash'); dropLoader(); setTimeout(idleThumbs, 4000); setTimeout(() => loadVoice(packOf(Math.max(1, save.unlocked || 1))), 2500); })();
})();

})();
