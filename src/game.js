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
    this.time = level.time || 120;      // oxygen in seconds
    this.oxygen = this.time;
    this.tickMs = level.tickMs || 150;
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

    // oxygen
    this.oxygen -= this.tickMs / 1000;
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
    if (t === T.AIR) { this.set(nx, ny, T.EMPTY); this.oxygen = Math.min(this.time, this.oxygen + 30); this.score += 50; this.emit('air', { x: nx, y: ny }); this.moveObj(p, nx, ny); this.lastMoved = true; return; }
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
        if (below === T.EMPTY) { o.falling = true; this.moveObj(o, x, y + 1); continue; }
        if (o.falling) {
          // landing on something
          const victim = this.objAt(x, y + 1);
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
            o.falling = true; this.moveObj(o, x - 1, y); this.emit('roll', { x: x - 1, y }); continue;
          }
          if (this.get(x + 1, y) === T.EMPTY && this.get(x + 1, y + 1) === T.EMPTY && !this.objAt(x + 1, y + 1)) {
            o.falling = true; this.moveObj(o, x + 1, y); this.emit('roll', { x: x + 1, y }); continue;
          }
        }
        if (o.falling) { o.falling = false; this.emit('land', { x, y, t: o.t }); }
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
{ name: "First Light", time: 60, hint: "Push the energy ball into the gate, then swim in. Balls only move into open water, so dig the road first.", map: [
'############',
'#P.........#',
'#..........#',
'#...B......#',
'#....WW....#',
'#.........E#',
'############',
]},
{ name: "Pinned", time: 75, hint: "A stone sits on the ball. Clear a space and shove the stone off before you move the ball.", map: [
'##############',
'#P...........#',
'#....R.......#',
'#....B.......#',
'#............#',
'#........WW..#',
'#...........E#',
'##############',
]},
{ name: "The Shaft", time: 80, hint: "Balls roll off walls when the cells beside them open up. Open the shaft from below, then let it roll.", map: [
'##############',
'#P...........#',
'#...R........#',
'#..B.........#',
'#WWW.WWWWWWW.#',
'#............#',
'#WWWEWWWWWWWW#',
'##############',
]},
{ name: "Two Roads", time: 90, hint: "One ball hangs over the other's road. Send the high one first.", map: [
'#################',
'#P..............#',
'#.....B.........#',
'#..B............#',
'#.............E.#',
'#################',
]},
{ name: "Piranha Pit", time: 100, hint: "Opening the shaft lets the piranha hunt you. Lure it under the stone.", map: [
'#################',
'#P..............#',
'#......R........#',
'#...............#',
'#WW.WWWW.WWWWWWW#',
'#   B   F    E  #',
'#WWWWWWW WWWWWWW#',
'#################',
]},
{ name: "Jelly Shaft", time: 90, hint: "The jellyfish surges when you are in its column. Cross fast, never linger.", map: [
'#################',
'#P........J.....#',
'#......... .....#',
'#......... .....#',
'#......... .....#',
'#..B...... ..E..#',
'#...............#',
'#################',
]},
{ name: "Keystone", time: 110, hint: "A hole in the road swallows balls. Plug it with the stone first.", map: [
'#################',
'#P..............#',
'#...R...........#',
'#...............#',
'#.B.............#',
'#WWWWWWW WWWWW..#',
'#.............E.#',
'#################',
]},
{ name: "Pitfall", time: 100, hint: "A ball dropped between two walls can never be pushed again. Choose where it falls.", map: [
'#################',
'#P..............#',
'#..B....R.......#',
'#...............#',
'#......W.W.....E#',
'#################',
]},
{ name: "Ambush", time: 90, hint: "Crabs patrol open water. Cross when they are far away.", map: [
'####################',
'#P.................#',
'#..................#',
'#WWWWWW.WWWWWWWWWWW#',
'#C              C  #',
'#WWWWWW.WWWWWWWWWWW#',
'#...B..............#',
'#..................#',
'#.................E#',
'####################',
]},
{ name: "Stone Bridge", time: 90, hint: "Fill the shaft with stones to make a floor for the ball.", map: [
'##################',
'#P...............#',
'#.......R........#',
'#......R.R.......#',
'#..B............E#',
'#WWWWWW WWWWWWWWW#',
'#WWWWWW WWWWWWWWW#',
'#WWWWWW WWWWWWWWW#',
'##################',
]},
{ name: "Counterweight", time: 100, hint: "Stone columns rest on sand. Leave that sand alone.", map: [
'####################',
'#..................#',
'#..P...R...R...R...#',
'#......R...R...R...#',
'#..................#',
'#..B...............#',
'#..................#',
'#..B..............E#',
'####################',
]},
{ name: "Air Supply", time: 45, hint: "Oxygen is short. Air capsules refill 30 seconds.", map: [
'######################',
'#P...................#',
'#....................#',
'#..B......A..........#',
'#....................#',
'#..A..........B......#',
'#....................#',
'#........A..........E#',
'######################',
]},
{ name: "Trapdoor", time: 100, hint: "A stone on a wall only rolls if the cells beside it are open.", map: [
'####################',
'#P.................#',
'#..R.R.R...........#',
'#..W.W.W...........#',
'#..................#',
'#........B.........#',
'#........W.........#',
'#..................#',
'#.................E#',
'####################',
]},
{ name: "Crossfire", time: 110, hint: "Two piranhas. Drop the stones, then dive in.", map: [
'####################',
'#P.R...............#',
'#..R...............#',
'#..................#',
'#WW WWWWWWWWWWWWWW.#',
'#F              F  #',
'#                  #',
'#    B             #',
'#WWWWWWWWWWWWWWWWEW#',
'#WWWWWWWWWWWWWWWWWW#',
'####################',
]},
{ name: "Avalanche", time: 110, hint: "A wall of stones. Never dig the row beneath it.", map: [
'######################',
'#P...................#',
'#..RRRRRRRR..........#',
'#..RRRRRRRR..........#',
'#....................#',
'#....................#',
'#..B.......B.........#',
'#....................#',
'#...................E#',
'######################',
]},
{ name: "Vault", time: 100, hint: "The ball is sealed in. Tunnel in from below and let it drop.", map: [
'####################',
'#P.................#',
'#..................#',
'#.....WWWWW........#',
'#.....W.B.W........#',
'#.....W...W........#',
'#.....W.W.W........#',
'#..................#',
'#......E...........#',
'####################',
]},
{ name: "Switchback", time: 130, hint: "Three corridors. The ball must zigzag down to the gate.", map: [
'####################',
'#P.................#',
'#..B..........     #',
'#WWWWWWWWWWWWW WWW #',
'#                  #',
'# WW WWWWWWWWWWWWWW#',
'#   .             E#',
'####################',
]},
{ name: "Crab Cave", time: 120, hint: "Crabs die under stones too.", map: [
'######################',
'#P..R................#',
'#...R................#',
'#....................#',
'#WWW WWWWWWWWWWWWW...#',
'#C                   #',
'#WWWWWW WWWWWWWWWWWWW#',
'#....B....J..........#',
'#                   .#',
'#...................E#',
'######################',
]},
{ name: "The Pit", time: 100, hint: "Balls can fall a long way into the gate.", map: [
'####################',
'#P.................#',
'#....B.............#',
'#....W.............#',
'#.........B........#',
'#.........W........#',
'#..................#',
'#WWWWWWWWWW WWWWWWW#',
'#WWWWWWWWWWEWWWWWWW#',
'####################',
]},
{ name: "Lockstep", time: 130, hint: "Three balls, one gate. Nearest first.", map: [
'######################',
'#P...................#',
'#....................#',
'#..B.....B.....B.....#',
'#....................#',
'#....R...R...R.......#',
'#....................#',
'#....................#',
'#...................E#',
'######################',
]},
{ name: "Night Shoal", time: 130, hint: "A shoal of piranha. Two stone shafts.", map: [
'######################',
'#P.R.................#',
'#..R.................#',
'#....................#',
'#WW WWWWWWWWWWWWWWWWW#',
'#                  F #',
'#                    #',
'#    B               #',
'#WWWWWWWWWEWWWWWWWWWW#',
'#WWWWWWWWWWWWWWWWWWWW#',
'######################',
]},
{ name: "Hourglass", time: 130, hint: "Two stone blocks on sand. Think before every dig.", map: [
'######################',
'#P..RRRRRR.RRRRRR....#',
'#...RRRRRR.RRRRRR....#',
'#....................#',
'#.........B..........#',
'#.........W..........#',
'#....................#',
'#....B...............#',
'#...................E#',
'######################',
]},
{ name: "Deep Pressure", time: 60, hint: "Very little oxygen. Chain the capsules.", map: [
'########################',
'#P.....................#',
'#..A...................#',
'#.........B......A.....#',
'#......................#',
'#..B...........A.......#',
'#......................#',
'#.........A............#',
'#..............B......E#',
'########################',
]},
{ name: "Gauntlet", time: 140, hint: "Four jellyfish shafts cross the ball road.", map: [
'######################',
'#P...J..J..J..J......#',
'#.... .. .. .. ......#',
'#.... .. .. .. ......#',
'#.... .. .. .. ......#',
'#.... .. .. .. ......#',
'#.... .. .. .. ......#',
'#.... .. .. .. ......#',
'#.B.................E#',
'######################',
]},
{ name: "Chain Reaction", time: 140, hint: "Six stone columns. A piranha runs the trench below.", map: [
'########################',
'#P.....................#',
'#..R.R.R.R.R.R.........#',
'#..R.R.R.R.R.R.........#',
'#......................#',
'#......................#',
'#....B.......B.........#',
'#......................#',
'#F                 ....#',
'#WWWWWWWWWWWWWWWWWW....#',
'#.....................E#',
'########################',
]},
{ name: "Citadel", time: 160, hint: "Breach both vaults. Every ball must come home.", map: [
'########################',
'#P.....................#',
'#......................#',
'#..WWWWWWW..WWWWWWW....#',
'#..W.B...W..W...B.W....#',
'#..W.....W..W.....W....#',
'#..W.W.W.W..W.W.W.W....#',
'#......................#',
'#......B...............#',
'#......W..............E#',
'########################',
]},
{ name: "Undertow", time: 150, hint: "A crab and a piranha share the trench. Drop both stones first.", map: [
'########################',
'#P.R.........R.........#',
'#..R.........R.........#',
'#......................#',
'#WW WWWWWWWWW WWWWWWWW.#',
'#C         F          .#',
'#WWWWW WWWWWWWWWWWWWWW.#',
'#....B....J..B.........#',
'#                     .#',
'#.....................E#',
'########################',
]},
{ name: "Abyss", time: 160, hint: "Two jellyfish shafts. Drop every ball down a shaft, then roll it home.", map: [
'##########################',
'#P....J.......J..........#',
'#..RR..........RR........#',
'#..... ....... ..........#',
'#....B ....... B.........#',
'#..... ....... ..........#',
'#..B.. ....... .B........#',
'#..... ....... ..........#',
'#..... ....... ..........#',
'#........................#',
'#.......................E#',
'##########################',
]},
{ name: "The Energizer", time: 200, hint: "Everything you have learned. Bring the light home.", map: [
'##########################',
'#P.R.....................#',
'#..R.....................#',
'#........................#',
'#WW WWWWWWWWWWWWWWWWWWWW.#',
'#                     F .#',
'#                     A .#',
'#    B     B      B     .#',
'#WWWWWWWWWWWWWWWWWWWWWWW.#',
'#C                      .#',
'#............J...........#',
'#............ .......B...#',
'#.......................E#',
'##########################',
]},
{ name: "Deep Current", time: 240, hint: "Three balls, one gate, a crab in the vault. Clear the vault ball first, and remember the jellyfish shaft swallows anything pushed across it.", map: [
'######################',
'#P............J......#',
'#....B........ ......#',
'#............. ......#',
'#..B.......... ......#',
'#............. ......#',
'#WWWWW.WWWWWWWWWWWWW.#',
'#      C          A  #',
'#   B               E#',
'#WWWWWWWWWWWWWWWWWWWW#',
'######################',
]},
];

// Deep Current — procedural audio (no sample files). Ambient bed, generative music, synthesized SFX.
const Audio = (() => {
  let ctx = null, master, musicBus, sfxBus, ambBus;
  let started = false, muted = false, musicOn = true;
  let musicTimer = null, musicStep = 0, sandBuf = null;
  const settings = { music: 0.6, sfx: 0.9 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('dc-audio') || '{}')); } catch {}

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = settings.music; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = settings.sfx; sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = 0.5; ambBus.connect(master);
    // underwater reverb-ish: a gentle feedback delay on the sfx bus
    const delay = ctx.createDelay(0.5); delay.delayTime.value = 0.18;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    sfxBus.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
    ambient();
  }
  function resume() { if (!ctx) init(); if (ctx && ctx.state === 'suspended') ctx.resume(); if (!started) { started = true; startMusic(); } }

  function noiseBuffer(seconds = 2) {
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
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

  // ---- soundscape: a calm, continuous underwater ambience (no melody) ----------------
  // layers: slow ocean swell, a deep warm hum, a soft sustained pad that drifts very slowly,
  // and the occasional distant bubble trail.
  function startMusic() {
    if (!ctx || musicTimer) return;
    const t0 = ctx.currentTime;
    // ocean swell: brown noise, low-passed, breathing in and out like slow waves
    const sw = ctx.createBufferSource(); sw.buffer = brownBuffer(8); sw.loop = true;
    const swLp = ctx.createBiquadFilter(); swLp.type = 'lowpass'; swLp.frequency.value = 420; swLp.Q.value = 0.4;
    const swG = ctx.createGain(); swG.gain.value = 0.0; swG.gain.linearRampToValueAtTime(0.22, t0 + 3);
    const waveL = ctx.createOscillator(); waveL.frequency.value = 0.11; const waveG = ctx.createGain(); waveG.gain.value = 0.09; waveL.connect(waveG); waveG.connect(swG.gain); waveL.start();
    const cutL = ctx.createOscillator(); cutL.frequency.value = 0.045; const cutG = ctx.createGain(); cutG.gain.value = 160; cutL.connect(cutG); cutG.connect(swLp.frequency); cutL.start();
    sw.connect(swLp); swLp.connect(swG); swG.connect(musicBus); sw.start();
    // deep hum: what pressure sounds like
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 49;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 73.5;
    const humG = ctx.createGain(); humG.gain.value = 0; humG.gain.linearRampToValueAtTime(0.06, t0 + 4);
    hum.connect(humG); hum2.connect(humG); humG.connect(musicBus); hum.start(); hum2.start();
    // soft pad: pure sines through a dark filter, one chord fading into the next every ~14s
    const padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 700; padLp.Q.value = 0.3; padLp.connect(musicBus);
    const CH = [[0, 7, 15, 19], [-2, 5, 14, 17], [-4, 3, 12, 19], [-5, 7, 14, 17]], ROOT = 110;
    let ci = 0, nextPad = t0 + 0.5;
    const padChord = (t) => { const ch = CH[ci++ % CH.length]; const dur = 18;
      ch.forEach((st, k) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = ROOT * Math.pow(2, st / 12); o.detune.value = (Math.random() - 0.5) * 8;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(k === 0 ? 0.035 : 0.022, t + 6); g.gain.setValueAtTime(k === 0 ? 0.035 : 0.022, t + dur - 6); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); g.connect(padLp); o.start(t); o.stop(t + dur + 0.1); }); };
    // distant bubble trail: a few soft rising blips, panned
    const bubbleTrail = (t) => { const n = 3 + (Math.random() * 6 | 0); const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(musicBus); }
      for (let i = 0; i < n; i++) { const tt = t + i * (0.06 + Math.random() * 0.12); const f = 300 + Math.random() * 500;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.9, tt + 0.07);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.018, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.12);
        o.connect(g); g.connect(pan || musicBus); o.start(tt); o.stop(tt + 0.15); } };
    let nextBub = t0 + 3;
    const tick = () => {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now + 1 > nextPad) { padChord(nextPad); nextPad += 14; }
      if (now + 1 > nextBub) { bubbleTrail(nextBub); nextBub += 4 + Math.random() * 7; }
      musicTimer = setTimeout(tick, 400);
    };
    tick();
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
  function play(name) { if (!ctx || muted) return; try { SFX[name] && SFX[name](); } catch {} }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 1; }
  function setMusic(on) { musicOn = on; if (musicBus && ctx) musicBus.gain.setTargetAtTime(on ? settings.music : 0, ctx.currentTime, 0.6); }
  function setVolumes(music, sfx) { settings.music = music; settings.sfx = sfx; if (musicBus) musicBus.gain.value = musicOn ? music : 0; if (sfxBus) sfxBus.gain.value = sfx; try { localStorage.setItem('dc-audio', JSON.stringify(settings)); } catch {} }
  return { init, resume, play, setMuted, setMusic, setVolumes, settings, get ctx() { return ctx; } };
})();

// Deep Current — renderer v3: clean, bright, front-on puzzle board built from premium primitives.
// Expects global THREE and T (tile enum).
/* global THREE, T */
const World = (() => {
  const V3 = THREE.Vector3;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  const col = h => new THREE.Color(h);

  // ---------------------------------------------------------------- canvas helpers
  function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function tex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  const TEX = {};
  function buildTextures() {
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
  function addContact(sp, wd, op, cast) { const cp = new THREE.Mesh(new THREE.PlaneGeometry(wd * (cast ? 1.25 : 1.05), Math.min(cast ? 0.55 : 0.4, wd * (cast ? 0.6 : 0.4))), new THREE.MeshBasicMaterial({ map: getContactTex(), transparent: true, opacity: op * 1.1, depthWrite: false }));
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
      sh.uniforms.uCausticT = MAT.causticT; sh.uniforms.uSandTex = { value: sprTex('sand') }; sh.uniforms.uNew = MAT.sandNew;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCausticT, uNew; uniform sampler2D uSandTex; varying vec3 vWp; varying vec3 vNo; float vEdge = 0.0; float vBotOpen = 0.0; float vLine = 0.0; float vWet = 0.0; float vTopOpen = 0.0; vec2 vLc = vec2(0.5); vec3 vGlint = vec3(0.0);' + (mask ? '\nuniform sampler2D uMask; uniform vec2 uSize;' : ''))
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
          vEdge = sh; vTopOpen = 1.0 - step(0.5, nU); vBotOpen = (1.0 - step(0.5, nD)) * (1.0 - step(0.5, texture2D(uMask, (cell + vec2(0.0, 1.0) + 0.5) / uSize).b)); vLc = lc; } }` : '#include <clipping_planes_fragment>')
        .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 p = vWp.xy;
          // warm golden base with a gentle large-scale light/dark drift
          float drift = sin(p.x * 0.35 + p.y * 0.5) * 0.5 + 0.5;
          vec3 hi = vec3(1.0, 0.78, 0.33), mid = vec3(0.97, 0.63, 0.2), dark = vec3(0.7, 0.36, 0.06), lip = vec3(1.0, 0.88, 0.48);
          vec3 c = mix(mid, hi, drift * 0.6);
          { vec3 tl = pow(texture2D(uSandTex, p * 0.3).rgb, vec3(2.2)); float det = dot(tl, vec3(0.2126, 0.7152, 0.0722)) / 0.464; vec3 base = vec3(1.16, 0.84, 0.2);
            if (uNew > 0.5) { float dd = clamp(-p.y / 12.0, 0.0, 1.0); base = mix(vec3(1.16, 0.8, 0.26), vec3(1.06, 0.6, 0.17), smoothstep(0.0, 0.5, dd)); base = mix(base, vec3(0.84, 0.4, 0.16), smoothstep(0.5, 1.0, dd)); }
            c = base * mix(1.0, det, 0.42); }
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
          if (ph < 0.09 && uNew < 0.5) { vec2 q = fract(p * 1.6) - vec2(0.3 + ph * 4.0, 0.5); float d = length(q * vec2(1.0, 1.4));
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
          if (uNew > 0.5 && vBotOpen > 0.5) { float band = smoothstep(0.62, 0.8, vLc.y); // underside of a sand ledge: packed pebbles and grit
            vec2 q = p * vec2(4.6, 5.4) + vec2(floor(p.y * 5.4) * 0.5, 0.0); vec2 ci = floor(q), cf = fract(q) - 0.5; float h1 = fract(sin(dot(ci, vec2(41.7, 289.3))) * 43758.5); vec2 o = vec2(h1, fract(h1 * 13.7)) - 0.5;
            vec2 pq = (cf - o * 0.3) * vec2(1.0, 1.25 + h1 * 0.5); float peb = step(0.25, fract(h1 * 3.3)) * smoothstep(0.36 - h1 * 0.1, 0.28 - h1 * 0.1, length(pq)); vec3 pc = mix(vec3(0.36, 0.33, 0.4), vec3(0.55, 0.42, 0.3), fract(h1 * 7.1)) * (0.7 + 0.45 * smoothstep(-0.25, 0.2, pq.y));
            vec3 grit = mix(c * vec3(0.72, 0.62, 0.55), vec3(0.4, 0.33, 0.3), 0.35); c = mix(c, mix(grit, pc, peb), band); }
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
          c = mix(c, c * vec3(0.72, 0.62, 0.5), vWet * 0.75); c += vec3(0.25, 0.2, 0.12) * smoothstep(0.03, 0.0, abs(vWet - 0.75)) * vWet;
          diffuseColor.rgb = c; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vNo.z > 0.5) { vec2 p = vWp.xy; float w = p.y * 7.0 + sin(p.x * 1.7) * 1.4; float cw = cos(w);
          vec3 pert = vec3(0.0);
          normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz); }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.36 + vGlint; diffuseColor.rgb *= 0.5;');
    };
    return m;
  }
  // moving caustic light from the water surface, added on top of a lit material
  function causticify(m, k = 0.12) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCausticT = MAT.causticT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpC;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWpC = (modelMatrix * wp4).xyz; }');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCausticT; varying vec3 vWpC;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec2 p = vWpC.xy * 0.8 + vWpC.z * 0.3;
          float a = sin(p.x * 3.1 + uCausticT * 0.9 + sin(p.y * 2.3 + uCausticT * 0.6) * 1.5);
          float b = sin(p.y * 2.7 - uCausticT * 0.7 + sin(p.x * 2.9 - uCausticT * 0.8) * 1.5);
          float cau = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 6.0);
          totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * cau * ${k.toFixed(3)} * (0.4 + diffuseColor.rgb); }`);
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
    MAT.sand = sandify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, envMapIntensity: 0.4 }));
    MAT.sandMask = { tex: { value: null }, size: { value: new THREE.Vector2(1, 1) } }; MAT.sandNew = { value: 0 };
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

  // new look: a chunky blue reef boulder like the sheet's rocks (lumpy, faceted, cyan glints) instead of the lavender block
  function makeBoulder() {
    if (!GEO.rockN) { const g = new THREE.IcosahedronGeometry(0.43, 2), P = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); const n = Math.sin(v.x * 9.1 + v.y * 4.3) * 0.5 + Math.sin(v.y * 7.7 - v.z * 5.9) * 0.35 + Math.sin(v.z * 8.3 + v.x * 6.1) * 0.3;
        v.multiplyScalar(1 + n * 0.07); v.y *= 0.92; v.x *= 1.04; P.setXYZ(i, v.x, v.y, v.z); }
      g.computeVertexNormals(); GEO.rockN = g;
      MAT.rockN = causticify(new THREE.MeshPhysicalMaterial({ color: 0x2a4f8e, roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.35, sheenColor: 0x6fd8ff, sheenRoughness: 0.5, envMapIntensity: 0.6, flatShading: true }), 0.14); }
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
  function makeBall(newArt) {
    // new look: a deep ruby glass pearl (the sheet's energy pearl) rather than an orange plastic ball
    if (newArt && !MAT.pearl) MAT.pearl = new THREE.MeshPhysicalMaterial({ color: 0xb00410, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x9a0010, emissiveIntensity: 0.7, envMapIntensity: 1.2 });
    const g = new THREE.Group(); const m = new THREE.Mesh(GEO.ball, newArt ? MAT.pearl : MAT.ball); g.add(m);
    const glow = new THREE.Sprite(MAT.ballGlow); glow.scale.set(1.75, 1.75, 1); glow.position.z = -0.1; g.add(glow);
    const core = new THREE.Sprite(MAT.ballCore); core.scale.set(0.55, 0.55, 1); core.position.set(-0.04, 0.02, 0.3); g.add(core); g.userData = { core };
    Object.assign(g.userData, { spin: m, glow }); return withShadow(g);
  }
  function makeGate() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(roundedBox(0.96, 0.96, 0.9, 0.11), [MAT.gateFrame, MAT.gateFrame]); g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.6), MAT.gateScreen); screen.position.set(0, -0.06, 0.452); g.add(screen);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), MAT.lampRed); lamp.position.set(0, 0.33, 0.45); g.add(lamp);
    const glow = new THREE.Sprite(MAT.cyanGlow.clone()); glow.scale.set(1.4, 1.4, 1); glow.position.z = 0.5; glow.material.opacity = 0.25; g.add(glow);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xff3a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 })); lampGlow.scale.set(0.35, 0.35, 1); lampGlow.position.set(0, 0.33, 0.5); g.add(lampGlow);
    g.userData = { screen, lamp, glow, lampGlow }; return g;
  }
  function makeDiver() {
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
  const rarityOf = (it) => it.price >= 1200 ? 'legendary' : it.price >= 600 ? 'epic' : it.price >= 300 ? 'rare' : 'common';
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
    Object.assign(SKIN, sk); if (!MAT.dHelm) makeDiver();
    const s = skinOf('suit', SKIN.suit), dim = (c, k) => new THREE.Color(c).multiplyScalar(k);
    for (const [m, part, col, ek] of [[MAT.dHelm, 'helm', s.helm, 0.25], [MAT.dSuit, 'suit', s.suit, 0.12]]) { const T2 = suitTex(s, part), had = !!m.emissiveMap;
      m.map = T2.map; m.color.set(0xffffff); if (T2.glow) { m.emissiveMap = T2.glow; m.emissive.set(0xffffff); m.emissiveIntensity = s.pat === 'cracks' ? 1.6 : 0.9; } else { m.emissiveMap = null; m.emissive.copy(dim(col, ek)); m.emissiveIntensity = 1; }
      if (had !== !!m.emissiveMap || !m.userData.mapped) { m.needsUpdate = true; m.userData.mapped = true; } }
    MAT.dFin.color.set(s.fin); MAT.dFin.emissive.copy(dim(s.fin, 0.35));
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
    frame(mode) { this.mode = mode; const C = { full: [0, 0.55, 6.6, -0.2], trailCard: [-0.6, 0.4, 6.4, 0.05], card: [0, 0.45, 4.9, 0.05], head: [0.2, 1.35, 3.3, 1.1], trail: [-0.3, 0.45, 8.6, -0.05], pearl: [0, 0.2, 3.6, 0] }[mode] || [0, 0.55, 6.6, -0.2];
      this.cam.position.set(C[0], C[1], C[2]); this.cam.lookAt(C[0] * 0.5, C[3], 0); }
    rebuild() { if (this.d) this.scene.remove(this.d); this.d = makeDiver(); this.d.scale.setScalar(2.3); this.d.position.y = 0.2; this.scene.add(this.d); this.hatId = SKIN.hat; this.scarfId = SKIN.scarf; }
    render(t) { if (this.hatId !== SKIN.hat || (this.scarfId === 'none') !== (SKIN.scarf === 'none')) this.rebuild(); skinTick(t);
      const u = this.d.userData, pm = this.mode === 'pearl', tm = this.mode === 'trail' || this.mode === 'trailCard';
      this.d.visible = !pm; this.ped.visible = !pm && !tm && this.mode !== 'head';
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
  function makeFish() {
    const g = new THREE.Group(); const b = new THREE.Group(); g.add(b);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), MAT.fish); body.scale.set(1.25, 0.95, 0.75); b.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), MAT.fishBelly); belly.scale.set(1.1, 0.6, 0.7); belly.position.set(0.04, -0.13, 0); b.add(belly);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.28, 4), MAT.fin); tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, 0.25); tail.position.set(-0.45, 0, 0); b.add(tail);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 4), MAT.fin); dorsal.scale.set(1, 1, 0.25); dorsal.position.set(-0.04, 0.3, 0); b.add(dorsal);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), MAT.white); eye.position.set(0.2, 0.08, 0.17); b.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8), MAT.black); pupil.position.set(0.25, 0.07, 0.23); b.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.04), MAT.black); brow.position.set(0.2, 0.18, 0.2); brow.rotation.z = -0.45; b.add(brow);
    const jaw = new THREE.Group(); jaw.position.set(0.28, -0.06, 0); b.add(jaw);
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 4), MAT.white); t.position.set(0.03, 0.02, -0.09 + i * 0.09); t.rotation.z = Math.PI; jaw.add(t); }
    g.userData = { b, tail, jaw }; g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeJelly() {
    const g = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), MAT.jelly); bell.position.y = 0.04; g.add(bell);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), MAT.tentacle); inner.position.y = 0.12; inner.scale.y = 0.6; g.add(inner);
    for (const dz of [-0.08, 0.08]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), MAT.black); e.position.set(dz, 0.12, 0.27); g.add(e); }
    const tents = []; for (let i = 0; i < 7; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.028, 0.42, 6), MAT.tentacle); const a = i / 7 * Math.PI * 2; t.position.set(Math.cos(a) * 0.17, -0.18, Math.sin(a) * 0.17); g.add(t); tents.push(t); }
    g.userData = { bell, tents }; return g;
  }
  function makeCrab() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 28, 18), MAT.crab); body.scale.set(1.25, 0.7, 0.9); g.add(body);
    const legs = []; for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.18, 4, 8), MAT.crab); l.position.set((i - 1) * 0.15, -0.13, s * 0.24); l.rotation.x = s * 0.8; g.add(l); legs.push(l); }
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), MAT.crab); c.scale.set(1.3, 0.85, 1); c.position.set(s * 0.36, 0.06, 0.12); g.add(c); }
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6), MAT.crab); st.position.set(s * 0.08, 0.22, 0.12); g.add(st); const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), MAT.white); e.position.set(s * 0.08, 0.3, 0.14); g.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), MAT.black); p.position.set(s * 0.08, 0.3, 0.19); g.add(p); }
    g.userData = { legs }; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
  }
  function makeAir() {
    const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 24), MAT.bubbleShell); g.add(b);
    const label = new THREE.Sprite(MAT.o2); label.scale.set(0.5, 0.5, 1); label.position.z = 0.1; g.add(label);
    g.userData = { b }; return g;
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
      this.r = renderer; const gl2 = renderer.capabilities.isWebGL2;
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
      this.compMat = M({ tScene: { value: this.main.texture }, tBloom: { value: null }, tRays: { value: null }, strength: { value: this.strength }, rays: { value: 0 }, lens: { value: 0 }, aspect: { value: 1 }, time: { value: 0 } },
        `uniform sampler2D tScene, tBloom, tRays; uniform float strength, rays, lens, aspect, time; varying vec2 vUv;
        vec3 safe(vec3 c){ return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : clamp(c, 0.0, 32.0); }
        void main(){ vec3 c = safe(texture2D(tScene, vUv).rgb); vec3 b = safe(texture2D(tBloom, vUv).rgb);
          if (lens > 0.0) { vec2 dv = (vUv - 0.5) * lens * 0.0012 * dot(vUv - 0.5, vUv - 0.5) * 4.0; c.r = safe(texture2D(tScene, vUv + dv).rgb).r; c.b = safe(texture2D(tScene, vUv - dv).rgb).b; } // faint chromatic fringe at the edges
          c += b * strength;
          if (rays > 0.0) c += safe(texture2D(tRays, vUv).rgb) * rays;
          // gentle grade: a touch more contrast and saturation, cool shadows, warm highlights
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.24);
          c = mix(c * vec3(0.94, 0.99, 1.06), c * vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.8, l));
          c = max(c, 0.0); vec3 cc = min(c, 1.0); c += (cc * cc * (3.0 - 2.0 * cc) - cc) * 0.62;
          // soft vignette
          vec2 d = vUv - 0.5; d.x *= aspect; float v = smoothstep(1.05, 0.3, length(d)); c *= mix(0.58, 1.0, v);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; }`);
    }
    setSize(w, h) {
      if (!this.supported) return;
      this.main.setSize(w, h); this.compMat.uniforms.aspect.value = w / h;
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      for (let i = 0; i < this.levels; i++) { this.down[i].setSize(bw, bh); this.up[i].setSize(bw, bh); bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); }
      this.raysRT.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
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
  const PHOTO_LEVELS = new Set(LEVELS.map(l => l.name)); // painted background on every level
  // which asset sheet dresses a level: 'new' (images/sheet2, the owner's new sheet) is on trial on the first 4 levels
  const NEW_ART_LEVELS = new Set(LEVELS.map(l => l.name)); // the new sheet / premium tank look on every level
  // per-world mood for the painted backdrop: sunlit shallows, violet coral caves, the dark deep
  const worldOf = (name) => { const i = LEVELS.findIndex(l => l.name === name); return i < 10 ? 0 : i < 20 ? 1 : 2; };
  const WORLD_TINT = [0xffffff, 0xcdb2ff, 0x6a80c4], WORLD_FOG = [0, 0.12, 0.32];
  const ART_SETS = {
    old: { plinth: ['rocks', 'coralA', 'plant2', 'coralB', 'plant4', 'rocks', 'coralC', 'plantS', 'plant1', 'coralA', 'rocks', 'plant3', 'coralB'],
      ledge: ['plant1', 'plant2', 'plant3', 'plant4', 'plantS', 'coralA', 'coralC'], stars: ['star1', 'star2'], shells: ['shell1', 'shell2', 'shell3'], jelly: 'jelly', goal: 'goal', platform: 'platform' },
    new: { plinth: ['rockA', 'coral1', 'weed2', 'coral2', 'weed5', 'rockB', 'coral3', 'weed9', 'weed1', 'coral4', 'rockC', 'weed3', 'coral5', 'weed8'],
      ledge: ['weed1', 'weed2', 'weed3', 'weed4', 'weed5', 'weed6', 'weed7', 'weed8', 'weed9', 'coral1', 'coral3', 'coral5'], stars: ['starA', 'starB', 'starC', 'starD'], shells: ['shellA', 'shellB', 'shellC', 'shellD'], jelly: 'jellyN', goal: 'gateA', platform: 'platformN' } };
  const isRockSpr = (n) => n.startsWith('rock'), isPlantSpr = (n) => n.startsWith('plant') || n.startsWith('weed');
  // ---------------------------------------------------------------- the world
  class WorldImpl {
    constructor(cv) {
      this.canvas = cv;
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', alpha: false });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace; MAIN_R = this.renderer;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.post = new Post(this.renderer, isMobile);
      this.pixelRatio = Math.min(devicePixelRatio || 1, isMobile ? 2 : 2);
      buildTextures(); buildMaterials(); buildGeometry();
      this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x1477cf);
      this.camera = new THREE.PerspectiveCamera(28, 1, 2, 400); this.tilt = isMobile ? 0.05 : 0.1; // camera pitch: a little from above, flatter on phones so less floor shows
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
      this.scene.fog = new THREE.Fog(0x0a4790, 60, 140);
      this.positionReef();
    }
    positionReef() { if (!this.reef || !this.e) return; const W = this.e.w, H = this.e.h; this.reef.group.position.set((W - 1) / 2, -(H - 1) - 1.3, 0); }
    // graphics tiers. 'auto' (see autoQuality) moves between them from the measured frame rate.
    //   low: 1x pixels, no post, no shadows | medium: post + 1K shadows | high: sharper pixels, 2K shadows, light shafts | ultra: full-res, 4K shadows, rich shafts, lens polish
    setQuality(q) {
      const T_ = { low: { pr: 1, post: false, sh: 0, msaa: 0, rays: 0, rs: 0, lens: 0, bloom: 0.75 }, medium: { pr: 1.25, post: true, sh: 1024, msaa: 2, rays: 0, rs: 0, lens: 0, bloom: 0.75 },
        high: { pr: 1.75, post: true, sh: 2048, msaa: 4, rays: 1.0, rs: 28, lens: 0, bloom: 0.8 }, ultra: { pr: 2.5, post: true, sh: 4096, msaa: 4, rays: 1.35, rs: 48, lens: 1, bloom: 0.85 } };
      if (q === 'auto' || !T_[q]) q = this.quality && T_[this.quality] ? this.quality : 'high'; const c = T_[q], prev = this.quality, wasLow = prev === 'low', isLow = q === 'low'; this.quality = q;
      const ss = isMobile ? 1 : { low: 1, medium: 1, high: 1.25, ultra: 1.5 }[q]; // a touch of supersampling on desktop for crisper edges
      this.pixelRatio = Math.min(c.pr, (devicePixelRatio || 1) * ss) * (this.resScale || 1);
      const P = this.post; P.enabled = c.post && P.supported;
      if (P.supported && P.main) { P.rays = c.rays; P.raySamples = c.rs; P.lens = c.lens; P.strength = c.bloom; if (P.main.samples !== c.msaa) { P.main.samples = c.msaa; P.main.dispose(); } }
      const shOn = c.sh > 0; if (this.renderer.shadowMap.enabled !== shOn) { this.renderer.shadowMap.enabled = shOn; this.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
      if (shOn && this.key.shadow.mapSize.x !== c.sh) { this.key.shadow.mapSize.set(c.sh, c.sh); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
      if (prev === undefined || wasLow !== isLow) this.buildReef();
      this.resize(); if (this.e && this.levelGroup) this.render(); // redraw at once: a resized canvas is blank until the next draw (that blank frame was the flicker)
      if (this.onQuality) this.onQuality(q);
    }
    // adaptive quality: watch the real frame rate; drop a tier quickly when it struggles, climb back slowly when there's headroom
    autoQuality(realDt) {
      const A = this.aq || (this.aq = { t: 0, n: 0, sum: 0, since: 0, banned: {} }), order = ['low', 'medium', 'high', 'ultra'];
      if (document.hidden || realDt <= 0) { A.t = A.n = A.sum = A.slow = 0; return; }
      if (realDt > 1) { A.t = A.n = A.sum = 0; A.slow = (A.slow || 0) + 1; if (A.slow >= 3 && this.quality !== 'low') { A.slow = 0; this.setQuality('low'); } return; } // one long gap = tab switch; several in a row = a very slow device
      A.slow = 0;
      A.t += realDt; A.n++; A.sum += realDt; A.since += realDt; const i = order.indexOf(this.quality);
      if (A.t < 1.5) return; const fps = A.n / A.sum;
      if (isMobile) { const rs = this.resScale || 1;
        if (fps < 45 && A.t >= 2.5 && rs > 0.72) { this.resScale = Math.max(0.7, rs - 0.1); this.setQuality(this.quality); A.t = A.n = A.sum = 0; A.since = 0; return; }
        if (fps >= 58 && rs < 1 && A.since > 4) { this.resScale = Math.min(1, rs + 0.05); this.setQuality(this.quality); A.t = A.n = A.sum = 0; A.since = 0; return; } }
      if (fps < (this.menuMode ? 47 : 38) && A.t >= 3 && i > 0) { A.banned[order[i]] = performance.now() + 120000; this.setQuality(order[Math.max(0, i - (fps < 25 ? 2 : 1))]); A.since = 0; }
      else if (A.t >= 4 && fps >= 57 && i < 3 && A.since > 6 && (this.menuMode || !this.e) && !((A.banned[order[i + 1]] || 0) > performance.now())) { this.setQuality(order[i + 1]); A.since = 0; }
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
      const tex = new THREE.Texture(PHOTO_IMG); if (PHOTO_IMG.complete && PHOTO_IMG.naturalWidth) tex.needsUpdate = true; else PHOTO_IMG.addEventListener('load', () => { tex.needsUpdate = true; }, { once: true }); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.minFilter = THREE.LinearMipmapLinearFilter;
      const AR = 1435 / 2560; const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, AR), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false, fog: false })); bg.renderOrder = -10; g.add(bg);
      const shimmer = new THREE.Mesh(new THREE.PlaneGeometry(1, AR), new THREE.ShaderMaterial({ uniforms: { uT: MAT.causticT }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uT; varying vec2 vUv; void main(){ vec2 p = vUv * vec2(9.0, 4.0);
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
        const d = cg.z; rc.position.set(cg.x, lg.y + d * Math.sin(this.tilt) - (lg.y - cg.y), d * Math.cos(this.tilt)); rc.lookAt(lg.x, lg.y, 0); rc.updateMatrixWorld(true);
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
      this.renderer.setPixelRatio(this.pixelRatio); this.renderer.setSize(w, h, false);
      this.post.setSize(Math.round(w * this.pixelRatio), Math.round(h * this.pixelRatio));
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.particles.mat.uniforms.scale.value = h * this.pixelRatio * 0.9; this.particles.bubMat.uniforms.scale.value = h * this.pixelRatio * 0.9;
      this.fitCamera(true, this.e && !this.e.menu && !this.playing);
    }

    // ---- level construction ----
    clearLevel() {
      this.levelGroup.clear(); this.entShadows = []; this.entities.clear(); this.particles.n = 0; this.particles.bub.n = 0;
      this.gateObj = null; this.sandInst = null; this.treasures = []; this.digChunks = []; if (this.warn) this.warn.visible = false; this.ghosts = []; this.absorbing = []; this.deathTint = 0; this.setFx('');
    }
    loadLevel(e) {
      this.clearLevel(); this.e = e; this.shadowDirty = true; this.mood = null; this.playerAct = null; this.lastHup = -9; const ART = ART_SETS[NEW_ART_LEVELS.has(e.name) || e.menu ? 'new' : 'old']; this.newArt = ART === ART_SETS.new; MAT.sandNew.value = this.newArt ? 1 : 0; this.tickMs = e.tickMs; this.menuMode = !!e.menu; this.playing = false; this.lead.set(0, 0); this.lastMove = -99; this.zoomK = 1.12; this.playerPos = null;
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
          MAT.glassSide = new THREE.MeshPhysicalMaterial({ color: 0xbfeaf2, transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
          const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
          const streak = (x, wd, a) => { const gr = g.createLinearGradient(x, 0, x + wd, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.save(); g.transform(1, 0, -0.45, 1, 0, 0); g.fillRect(x, 0, wd, 256); g.restore(); };
          streak(90, 60, 0.22); streak(170, 18, 0.18); streak(380, 40, 0.12);
          MAT.glassFront = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.45 });
          MAT.trim = new THREE.MeshPhysicalMaterial({ color: 0x2c6d78, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3 });
          MAT.trimCap = new THREE.MeshPhysicalMaterial({ color: 0xe0b85a, metalness: 0.8, roughness: 0.25, clearcoat: 1, envMapIntensity: 1.5 });
          MAT.plinth = causticify(new THREE.MeshPhysicalMaterial({ color: 0xcdb78f, roughness: 0.75, clearcoat: 0.2, envMapIntensity: 0.4 }), 0.15);
          MAT.plinthSide = new THREE.MeshPhysicalMaterial({ color: 0xa48e66, roughness: 0.8, envMapIntensity: 0.3 });
          // new look: deep navy lacquered frame + warm teak stand
          MAT.trimN = new THREE.MeshPhysicalMaterial({ color: 0x18284f, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5 });
          MAT.plinthN = causticify(new THREE.MeshPhysicalMaterial({ color: 0x8a5a36, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6, sheen: 0.3, sheenColor: 0xffd29a }), 0.12);
          MAT.plinthSideN = new THREE.MeshPhysicalMaterial({ color: 0x5e3b22, roughness: 0.6, clearcoat: 0.4, envMapIntensity: 0.4 });
        }
        // back glass (tinted, you see the reef through it), side panes, faint front reflections
        const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.newArt ? (MAT.waterBack || (MAT.waterBack = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: MAT.causticT, uH: { value: new THREE.Vector2() } },
          vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
          fragmentShader: `uniform float uT; uniform vec2 uH; varying vec3 vW; void main(){ float k = clamp((vW.y - uH.x) / (uH.y - uH.x), 0.0, 1.0);
            vec3 c = mix(vec3(0.02, 0.17, 0.42), vec3(0.1, 0.6, 0.9), pow(k, 1.3));                                     // deep blue at the floor -> bright cyan under the surface
            vec2 p = vW.xy * 0.9; float a = sin(p.x * 3.1 + uT * 0.8 + sin(p.y * 2.3 + uT * 0.55) * 1.5), b = sin(p.y * 2.7 - uT * 0.65 + sin(p.x * 2.9 - uT * 0.7) * 1.5);
            float cau = pow(max(0.0, 1.0 - abs(a + b) * 0.5), 6.0); c += vec3(0.55, 0.95, 1.0) * cau * (0.1 + 0.18 * k);            // moving caustic net on the back glass
            gl_FragColor = vec4(pow(c, vec3(2.2)), 0.72); }` }))) : MAT.glassBack);
        if (this.newArt) back.material.uniforms.uH.value.set(yB, yT);
        back.position.set(cx, cy, zB); back.renderOrder = 1; tank.add(back);
        for (const sx of [x0, x1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(zF - zB, h), MAT.glassSide); p.rotation.y = Math.PI / 2; p.position.set(sx, cy, (zF + zB) / 2); p.renderOrder = 2; tank.add(p); }
        const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MAT.glassFront); front.position.set(cx, cy, zF); front.renderOrder = 5; tank.add(front);
        // slim teal frame with little brass corner caps
        const trimM = this.newArt ? MAT.trimN : MAT.trim, bar = (lx, ly, lz, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), trimM); m.position.set(px, py, pz); m.castShadow = true; tank.add(m); return m; };
        const T2 = this.newArt ? 0.15 : 0.12;
        for (const sx of [x0, x1]) for (const sz of [zF, zB]) bar(T2, h + T2, T2, sx, cy, sz);           // four upright edges
        for (const sz of [zF, zB]) bar(w + T2, T2, T2, cx, yT, sz);                                       // top rims
        for (const sx of [x0, x1]) bar(T2, T2, zF - zB + T2, sx, yT, (zF + zB) / 2);                      // top side rims
        for (const sx of [x0, x1]) for (const sz of [zF, zB]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(this.newArt ? 0.14 : 0.11, 16, 10), MAT.trimCap); cap.position.set(sx, yT, sz); tank.add(cap); }
        // stone plinth the tank stands on, resting on the seabed
        const pl = new THREE.Mesh(roundedBox(w + 0.7, 0.85, 1.3, 0.12), this.newArt ? [MAT.plinthN, MAT.plinthSideN] : [MAT.plinth, MAT.plinthSide]); pl.position.set(cx, yB - 0.42, 0); pl.castShadow = pl.receiveShadow = true; tank.add(pl);
        bar(w + 0.3, 0.1, zF - zB + 0.25, cx, yB - 0.02, 0).material = MAT.trim;
        this.pump = null; if (this.newArt) this.buildPremiumTank(tank, { x0, x1, yT, yB, cx, cy, w, h, zF, zB });
        if (this.newArt && !e.menu && !e.cine) { const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d'), idx = LEVELS.findIndex(l => l.name === e.name) + 1;
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
          for (let i = 0; i < nR; i++) { const sc = 0.7 + rnd() * 0.7, rx = x0 - 0.8 + i * 0.62; if (this.newArt && Math.abs(rx - cx) < Math.min(w * 0.55, 4.2) / 2 + 0.2) continue; d0.position.set(rx + (rnd() - 0.5) * 0.25, yB - 0.9 + sc * 0.1, 0.6 + rnd() * 0.3); d0.scale.set(sc * 1.25, sc * 0.7, sc); d0.rotation.set(rnd(), rnd() * 6, rnd()); d0.updateMatrix(); rocks.setMatrixAt(ri, d0.matrix); rocks.setColorAt(ri++, new THREE.Color().setHSL(0.6 + rnd() * 0.04, 0.45, 0.26 + rnd() * 0.12)); }
          for (const sx of [x0 - 0.75, x1 + 0.75]) for (let k = 0; k < 3; k++) { const sc = 1 + rnd() * 0.8; d0.position.set(sx + (rnd() - 0.5) * 0.6, yB - 0.75 + sc * 0.15, 0.3 + rnd() * 0.5); d0.scale.set(sc * 1.3, sc, sc); d0.rotation.set(rnd(), rnd() * 6, rnd()); d0.updateMatrix(); rocks.setMatrixAt(ri, d0.matrix); rocks.setColorAt(ri++, new THREE.Color().setHSL(0.6, 0.22, 0.42 + rnd() * 0.1)); }
          rocks.count = ri; rocks.castShadow = rocks.receiveShadow = true; tank.add(rocks);
          // bubble-coral clumps (pink / purple / orange) sitting on the rocks in front of the plinth
          const coralCols = [0xff6fae, 0xa86bff, 0xff9a4a, 0x5fd3c4]; const ballG = new THREE.SphereGeometry(0.11, 14, 10);
          const coralM = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6, emissive: 0x22081a, emissiveIntensity: 1, envMapIntensity: 0.6 });
          const nC = Math.max(4, Math.round(w / 2.2)); const balls = new THREE.InstancedMesh(ballG, coralM, nC * 12);
          let bi = 0; for (let k = 0; k < nC; k++) { const cx0 = x0 - 0.4 + (k + 0.5) * (w + 0.8) / nC + (rnd() - 0.5) * 0.5, col = new THREE.Color(coralCols[(rnd() * 4) | 0]);
            for (let j = 0; j < 12; j++) { const a = rnd() * 6.28, r = rnd() * 0.22, hgt = rnd() * 0.4; d0.position.set(cx0 + Math.cos(a) * r, yB - 0.6 + hgt, 0.98 + Math.sin(a) * r * 0.6); d0.scale.setScalar(0.7 + rnd() * 0.8 - hgt); d0.rotation.set(0, 0, 0); d0.updateMatrix(); balls.setMatrixAt(bi, d0.matrix); balls.setColorAt(bi++, col.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.12)); } }
          balls.count = bi; balls.visible = false; tank.add(balls);
          { const row = ART.plinth;
            const NA = this.newArt, n = Math.max(5, Math.round((w + 1.6) / (NA ? 0.78 : 1.05))); for (let k = 0; k < n; k++) { const nm = row[(k + W) % row.length], hgt = (isRockSpr(nm) ? 0.62 + rnd() * 0.2 : isPlantSpr(nm) ? (NA ? 0.6 + rnd() * 0.25 : 0.8 + rnd() * 0.45) : 0.55 + rnd() * 0.25) * (NA ? 0.7 + rnd() * 0.65 : 1);
              const px0 = x0 - 0.6 + (k + 0.5) * (w + 1.2) / n; if (NA && Math.abs(px0 - cx) < Math.min(w * 0.55, 4.2) / 2 + 0.25) continue;
              const sp = sprPlane(nm, hgt, true, { dz: 0.16, op: 0.6, lean: 0.38 }); sp.position.set(x0 - 0.6 + (k + 0.5) * (w + 1.2) / n + (rnd() - 0.5) * (NA ? 0.7 : 0.3), yB - 0.9, (NA ? 0.86 + rnd() * 0.42 : 0.92 + rnd() * 0.25)); if (rnd() < 0.5) sp.scale.x = -1;
              if (isPlantSpr(nm)) { const ph = rnd() * 6; sp.onBeforeRender = () => { sp.rotation.z = Math.sin(performance.now() / 1000 * 1.2 + ph) * 0.06; }; } tank.add(sp); } }
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
            const tx = mk(b, p, h); return [causticify(new THREE.MeshPhysicalMaterial({ map: tx, roughness: 0.7, sheen: 0.15, sheenColor: new THREE.Color(h), envMapIntensity: 0.2 }), 0.08),
              new THREE.MeshPhysicalMaterial({ color: new THREE.Color(b).lerp(new THREE.Color(h), 0.25), roughness: 0.6, sheen: 0.25, sheenColor: new THREE.Color(h), envMapIntensity: 0.25 })]; });
          MAT.coralFace = true; GEO.polyp = new THREE.SphereGeometry(1, 10, 8); GEO.branch = new THREE.CapsuleGeometry(0.035, 0.16, 3, 6);
        }
        // one shelf per horizontal run of wall cells
        const isW = (x, y) => e.get(x, y) === T.WALL; const runs = [];
        for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!isW(x, y)) { x++; continue; } const s0 = x; while (x < W && isW(x, y)) x++; runs.push([s0, x - 1, y]); } }
        const pol = new THREE.InstancedMesh(GEO.polyp, new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, sheen: 0.5, envMapIntensity: 0.5 }), runs.reduce((a, r) => a + (r[1] - r[0] + 1) * 8, 0));
        const br = new THREE.InstancedMesh(GEO.branch, new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, emissive: 0x220a10, emissiveIntensity: 1 }), runs.reduce((a, r) => a + (r[1] - r[0] + 1) * 3, 0));
        let pi = 0, bi = 0;
        runs.forEach(([x0r, x1r, y], ri) => { const len = x1r - x0r + 1, cx = (x0r + x1r) / 2, kind = (variant(x0r, y) >> 2) % 3, mats = MAT.coralFaces[kind];
          const geo = roundedBox(len - 0.04, 0.64, 0.98, 0.2, 3); const face = shelfFace(len, ART.platform); const m = new THREE.Mesh(geo, face ? [new THREE.MeshStandardMaterial({ map: face, roughness: 0.75, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.25 }), (this.newArt ? (MAT.shelfSideN || (MAT.shelfSideN = new THREE.MeshPhysicalMaterial({ color: 0x8a5a2b, metalness: 0.45, roughness: 0.35, clearcoat: 0.6, envMapIntensity: 0.9 }))) : new THREE.MeshStandardMaterial({ color: 0xd9913f, roughness: 0.8 }))] : [mats[0], mats[1]]); mats[0].map.repeat.set(len * 0.6, 1);
          m.position.set(cx, -y - 0.02, -0.02); m.castShadow = m.receiveShadow = true; this.levelGroup.add(m);
          if (this.newArt) for (let i = 0; i < len; i++) { const hh = variant(x0r + i, y + 5); if (hh % 3 === 0) continue; // sea-plant tufts growing on the shelf top
            const nm = ART.ledge[hh % 9], sp = sprPlane(nm, 0.3 + (hh % 4) * 0.05, true, { dz: 0.25, op: 0.5 }); sp.position.set(x0r + i + ((hh >> 4) % 5 - 2) * 0.08, -y + 0.3, -0.2); if (hh & 1) sp.scale.x = -1; this.levelGroup.add(sp); }
          const hi = new THREE.Color(['#ff9d82', '#c8a8f2', '#ffbe7a'][kind]), deep = new THREE.Color(['#b8402e', '#6b44a8', '#c4621c'][kind]);
          // bumpy polyps along the top and a few on the front lip
          for (let i = 0; i < len * 8; i++) { const h = variant(x0r + i, y + 31 * i), u = (i + 0.5) / (len * 8); const onTop = i % 4 !== 0;
            dummy.position.set(x0r - 0.48 + u * (len - 0.04), -y + (onTop ? 0.3 : 0.12 - (h % 7) * 0.03), onTop ? 0.25 - (h % 5) * 0.11 : 0.47); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.05 + (h % 4) * 0.012); dummy.updateMatrix();
            pol.setMatrixAt(pi, dummy.matrix); pol.setColorAt(pi++, (h % 3 ? hi : deep).clone()); }
          // little branching tips on top
          for (let i = 0; i < len * 3; i++) { const h = variant(x0r + i * 3, y + 7); dummy.position.set(x0r - 0.4 + (i + 0.5) / (len * 3) * (len - 0.2), -y + 0.38, 0.1 - (h % 5) * 0.08); dummy.rotation.set(0, 0, ((h % 9) - 4) * 0.12); dummy.scale.setScalar(0.9 + (h % 3) * 0.2); dummy.updateMatrix();
            br.setMatrixAt(bi, dummy.matrix); br.setColorAt(bi++, hi.clone()); } });
        pol.count = pi; br.count = bi; pol.visible = br.visible = !this.newArt; for (const im of [pol, br]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = true; this.levelGroup.add(im); }
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
        for (const [x, y] of sand) { const h = variant(x, y), r = ((h * 2654435761) >>> 0) % 1000 / 1000; if (r > 0.13) continue;
          const kind = r < 0.06 ? 'star' : r < 0.1 ? 'shell' : 'jelly'; let m;
          const tsh = { k: 0.22, dz: 0.005, op: 0.6 }; // half-buried in sand: tight shadow right on the sand face
          if (kind === 'star') m = sprPlane(ART.stars[h % ART.stars.length], 0.38, false, tsh);
          else if (kind === 'shell') m = sprPlane(ART.shells[h % ART.shells.length], 0.32, false, tsh);
          else if (true) m = sprPlane(ART.jelly, 0.4, false, tsh);
          else { m = new THREE.Group(); const d = new THREE.Mesh(GEO.jellyDome, MAT.jellyT); m.add(d); for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(GEO.jellyLeg, MAT.jellyT); l.position.set(-0.07 + k * 0.047, -0.07, 0); m.add(l); } }
          const ox = (((h >> 3) % 9) - 4) * 0.05, oy = (((h >> 6) % 9) - 4) * 0.05, rot = ((h >> 9) % 13) * 0.48;
          m.position.set(x + ox, -y + oy, 0.41); m.rotation.z = rot; m.scale.setScalar((0.9 + ((h >> 2) % 4) * 0.08) * (this.newArt ? 1.3 : 1)); m.traverse(o => { if (!o.userData.fakeShadow) o.castShadow = true; });
          this.levelGroup.add(m); this.treasures.push({ m, cx: x, cy: y, state: 'buried', vy: 0, spin: (r - 0.065) * 20 }); } }
      // ---- sea plants on the sand ledges inside the tank (from your sheet); removed with their sand
      this.edgePlants = [];
      { const names = ART.ledge;
        for (const [x, y] of sand) { if (y < 1) continue; const above = e.get(x, y - 1); if (above === T.SAND || above === T.WALL || above === T.STEEL) continue;
          const h = variant(x, y + 77); if (h % 100 > (this.newArt ? 72 : 34)) continue; const nm = names[h % names.length], hgt = isPlantSpr(nm) ? 0.55 + (h % 5) * 0.06 : 0.38 + (h % 3) * 0.05;
          const sp = sprPlane(nm, hgt, true, { dz: 0.3, op: 0.55, lean: 0.45 }); sp.position.set(x + (((h >> 3) % 7) - 3) * 0.08, -y + 0.47, -0.12); const ph = (h % 17) * 0.4; sp.onBeforeRender = () => { sp.rotation.z = Math.sin(performance.now() / 1000 * 1.1 + ph) * 0.05; };
          this.levelGroup.add(sp); this.edgePlants.push({ m: sp, x, y }); } }
      // ---- foreground seabed in front of the tank: a soft sand shelf with shells, stones, starfish and sea grass
      { const x0f = -2.5, x1f = W + 1.5, yF = -(H - 1.5) - 0.86, rnd = (() => { let sd = 777 + W * 13 + H; return () => (sd = (sd * 16807) % 2147483647) / 2147483647; })();
        if (!MAT.fgSand) { MAT.fgSand = causticify(new THREE.MeshStandardMaterial({ color: 0xe8c98a, roughness: 0.95, envMapIntensity: 0.15 }), 0.35);
          MAT.fgStone = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, envMapIntensity: 0.4 }); }
        const sg = new THREE.PlaneGeometry(x1f - x0f, 4.2, 60, 16); sg.rotateX(-Math.PI / 2); const P = sg.attributes.position;
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), front = Math.max(0, z + 0.6); P.setY(i, Math.sin(x * 0.9) * 0.05 + Math.sin(x * 2.3 + z * 1.7) * 0.03 - front * front * 0.12); } sg.computeVertexNormals();
        const photoMode = PHOTO_LEVELS.has(e.name) || !!e.menu, spots = [];
        const shelf = new THREE.Mesh(sg, MAT.fgSand); shelf.visible = !photoMode; shelf.position.set((x0f + x1f) / 2, yF + 0.02, 2.45); shelf.receiveShadow = true; this.levelGroup.add(shelf);
        const groundY = (x, z) => yF + 0.02 + Math.sin(x * 0.9) * 0.05 - Math.pow(Math.max(0, z - 2.45 + 0.6), 2) * 0.12;
        const place = (geo, mat, n, fn, shadowR = 0) => { const im = new THREE.InstancedMesh(geo, mat, n); for (let i = 0; i < n; i++) { dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); const col = fn(dummy, i); if (shadowR) spots.push([dummy.position.x, dummy.position.z, shadowR * Math.max(dummy.scale.x, dummy.scale.z)]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (col) im.setColorAt(i, col); }
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; this.levelGroup.add(im); return im; };
        const span = x1f - x0f, nS = Math.round(span * (this.newArt ? 0.32 : photoMode ? 0.55 : 1.1)), zMin = photoMode ? 1.55 : 1.0, NA = this.newArt;
        place(new THREE.IcosahedronGeometry(0.12, 1), MAT.fgStone, nS, (d, i) => { const x = x0f + rnd() * span, z = zMin + rnd() * 1.4, sc = NA ? 0.45 + rnd() * 0.75 : 0.6 + rnd() * 1.4; d.position.set(x, groundY(x, z) + sc * (NA ? 0.0 : 0.05), z); d.scale.set(sc * 1.3, sc * (NA ? 0.55 : 0.7), sc); d.rotation.set(rnd(), rnd() * 6, rnd()); return NA ? new THREE.Color().setHSL([0.62, 0.7, 0.5][(rnd() * 3) | 0] + rnd() * 0.03, 0.45, 0.32 + rnd() * 0.14) : new THREE.Color().setHSL(0.6 + rnd() * 0.04, 0.35, 0.3 + rnd() * 0.18); }, 0.17);
        const sway = (sp, amt) => { const ph = rnd() * 6; sp.onBeforeRender = () => { sp.rotation.z = Math.sin(performance.now() / 1000 * 1.2 + ph) * amt; }; };
        if (this.newArt) { // the sheet's shells and sea plants on the seabed, each with a light-facing ground shadow
          const nSh = Math.round(span * 0.32); for (let i = 0; i < nSh; i++) { const x = x0f + rnd() * span, z = 1.05 + rnd() * 1.4, sp = sprPlane(ART.shells[i % ART.shells.length], 0.2 + rnd() * 0.1, true, { drop: false, op: 0.6 });
            sp.position.set(x, groundY(x, z) - 0.01, z); sp.rotation.z = (rnd() - 0.5) * 0.4; if (rnd() < 0.5) sp.scale.x = -1; this.levelGroup.add(sp); }
          const weeds = ART.ledge.filter(n => n.startsWith('weed')), nW = Math.round(span * 0.3);
          for (let i = 0; i < nW; i++) { const x = x0f + rnd() * span, z = 1.0 + rnd() * 1.4, sp = sprPlane(weeds[(rnd() * weeds.length) | 0], 0.34 + rnd() * 0.22, true, { drop: false, op: 0.55 });
            sp.position.set(x, groundY(x, z) - 0.02, z); if (rnd() < 0.5) sp.scale.x = -1; sway(sp, 0.05); this.levelGroup.add(sp); } }
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
                c = mix(c, vec3(1.0, 0.965, 0.553), net * 0.7 * (1.0 - far * 0.5));
                c = mix(c, vec3(0.588, 0.733, 0.749), smoothstep(-13.0, -23.0, vW.z) * 0.6);                 // the painting's far, hazy sea floor
                gl_FragColor = vec4(pow(c, vec3(2.2)) * uTint, 1.0 - smoothstep(-14.0, -24.0, vW.z)); }` });
          const gp = new THREE.PlaneGeometry(span + 140, 160); gp.rotateX(-Math.PI / 2); const ground = new THREE.Mesh(gp, gm); ground.position.set((W - 1) / 2, yF + 0.005, 50); ground.renderOrder = -6; ground.frustumCulled = false; this.levelGroup.add(ground);
          const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 256; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); return t; };
          const blob = mk(g => { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(18,26,48,0.85)'); gr.addColorStop(0.55, 'rgba(18,26,48,0.35)'); gr.addColorStop(1, 'rgba(18,26,48,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
          // tank shadow: darkest right under the base and along its front edge, fading toward the viewer
          const tankTex = mk(g => { for (let y = 0; y < 256; y++) { const v = y / 255, a = v < 0.42 ? 0.78 : 0.78 * Math.pow(1 - (v - 0.42) / 0.58, 1.5); for (let x = 0; x < 256; x++) { const u = Math.abs(x / 255 - 0.5) * 2, edge = Math.min(1, (1 - u) / 0.12); g.fillStyle = `rgba(16,24,46,${(a * edge).toFixed(3)})`; g.fillRect(x, y, 1, 1); } } });
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
            if (Math.abs(F.x - cx) > span / 2 + 3.5) { F.on = false; F.f.visible = false; F.t = 6 + Math.random() * 10; } } } }; }
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
        if (((x * 7 + y * 13 + W) % 4) !== 0) continue;
        const ox = ((x * 31 + y * 17) % 5) / 10 - 0.2;
        if (k++ % 3 !== 1) { for (let i = 0; i < 3; i++) { const w = makeKelp(0.5 + Math.random() * 0.4); w.position.set(x + ox - 0.15 + i * 0.13, -y + 0.48, -0.42); w.userData.phase = Math.random() * 6; this.levelGroup.add(w); this.weeds.push(w); } }
        else { const c = makeCoral(); c.position.set(x + ox, -y + 0.48, -0.42); c.scale.setScalar(1.2); this.levelGroup.add(c); }
      }
      for (const o of e.objects.values()) this.spawn(o);
      this.gateSprite = sprPlane(ART.goal, 0.98, false, { k: 0.1, dz: 0.02, op: 0.55 }); this.gateSprite.material = this.gateSprite.material.clone(); this.gateSprite.position.set(e.gate.x, -e.gate.y, 0.47); this.levelGroup.add(this.gateSprite);
      this.gateObj = outline(makeGate(), 0.055, hullMat); this.gateObj.position.set(e.gate.x, -e.gate.y, 0); this.levelGroup.add(this.gateObj);
      this.airObjs = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (e.get(x, y) === T.AIR) { const a = makeAir(); a.position.set(x, -y, 0.1); this.levelGroup.add(a); this.airObjs.set(y * W + x, a); }
      this.key.target.position.set((W - 1) / 2, -(H - 1) / 2, 0); this.key.position.set((W - 1) / 2 - 5, -(H - 1) / 2 + 9, 9);
      { const S = Math.max(W, H) * 0.62 + 2, c = this.key.shadow.camera; c.left = -S; c.right = S; c.top = S; c.bottom = -S; c.near = 1; c.far = 40; c.updateProjectionMatrix(); }
      this.rim.target.position.copy(this.key.target.position); this.rim.position.set((W - 1) / 2 + 4, -(H - 1) / 2 + 10, -6);
      this.positionReef();
      { const usePhoto = PHOTO_LEVELS.has(e.name) || !!e.menu; this.photoMode = usePhoto; if (usePhoto) this.buildPhotoBg(); this.bgTint = new THREE.Color(e.menu ? 0xffffff : WORLD_TINT[worldOf(e.name)]); if (this.photo) this.photo.bg.material.color.copy(this.bgTint); if (this.photo) this.photo.group.visible = usePhoto;
        if (this.reef) this.reef.group.visible = !usePhoto; this.backdrop.visible = !usePhoto; this.rays.visible = !usePhoto; }
      this.fitCamera(true, !e.menu);
    }
    spawn(o) {
      let m;
      if (o.t === T.ROCK) m = makeStone(this.newArt); else if (o.t === T.BALL) m = makeBall(this.newArt); else if (o.t === T.PLAYER) m = makeDiver();
      else if (o.t === T.FISH) m = makeFish(); else if (o.t === T.JELLY) m = makeJelly(); else if (o.t === T.CRAB) m = makeCrab();
      if (!m) return;
      m.traverse(c => { if (c.isMesh) c.castShadow = true; });
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
            float a = clamp(ao * 1.05 + sh * 0.75, 0.0, 0.82); gl_FragColor = vec4(0.015, 0.04, 0.11, a); }` });
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
            float d = vUv.y - wave; float line = smoothstep(0.045, 0.0, abs(d)); float glow = smoothstep(-0.7, 0.0, d) * step(d, 0.0) * 0.22;
            float a = line * 0.75 + glow; gl_FragColor = vec4(vec3(0.75, 0.97, 1.0) * a, a); }` }));
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
              float across = pow(max(0.0, sin(vUv.x * 3.14159)), 2.0), down = pow(clamp((vW.y - uB.z) / (uB.w - uB.z), 0.0, 1.0), 1.4);
              float a = 0.17 * across * down * (0.65 + 0.35 * sin(uT * 0.5 + uPh)) * inside; gl_FragColor = vec4(vec3(1.0, 0.96, 0.82) * a, a); }` }));
          m.position.set(x0 + (i + 0.5) * w / n + 0.6, cy + 0.2, 0.47); m.rotation.z = 0.36; m.renderOrder = 4; tank.add(m); } }
      this.pump = { x: x0 + 0.28, y: yB + 0.15, z: -0.42, t: 0, top: ys };
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
        g.stars = [0, 1, 2].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })); sp.scale.setScalar(0.2); sp.renderOrder = 12; this.levelGroup.add(sp); return sp; }); }
      const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
      let headX = m.position.x, headY = m.position.y + 0.5;
      if (g.cause === 'crushed') { // pancake under the stone: instant squash, a little wobble, limbs splayed
        const k = ease(t / 0.12), wob = Math.sin(t * 28) * Math.exp(-t * 7) * 0.08;
        m.scale.set(bs * (1 + 0.5 * k + wob), bs * (1 - 0.78 * k - wob), bs * (1 + 0.35 * k)); m.position.set(g.x0, floorY + 0.05 + (g.y0 - floorY - 0.05) * (1 - k), 0.14);
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
    // the diver's facial/body reaction of the moment (effort, surprise, joy, flinch, bonk); a stronger mood replaces a weaker one
    playerMood(k, dur) { const rank = { flinch: 1, bonk: 1, surprise: 2, joy: 3 }; if (this.mood && rank[this.mood.k] > rank[k] && this.mood.t < this.mood.dur * 0.7) return; this.mood = { k, t: 0, dur }; }
    setFx(cls) { if (this.fx) this.fx.className = cls; }
    flashFx(cls) { if (!this.fx) return; this.fx.classList.remove(cls); void this.fx.offsetWidth; this.fx.classList.add(cls); }
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
        case 'air': { const a = this.airObjs.get(ev.y * e.w + ev.x); if (a) { this.levelGroup.remove(a); this.airObjs.delete(ev.y * e.w + ev.x); } P.bubbles(x, y, 0.2, 16, 0.12, 0.6); this.sfx('air'); break; }
        case 'push': { const dx = e.player ? Math.sign(ev.x - e.player.x) || 1 : 1; // ev = the pushed object's new cell
          P.emit(x - dx * 0.45, y - 0.42, 0.42, 9, { color: SAND, speed: 0.5, life: 0.8, size: 0.09, kind: 1, spread: 0.25, vx: -dx * 0.5, vy: 0.35 });
          P.emit(x - dx * 1.35, y - 0.45, 0.4, 5, { color: new THREE.Color(0xd9b06a), speed: 0.4, life: 0.6, size: 0.07, kind: 1, spread: 0.15, vx: -dx * 0.9, vy: 0.5 });
          P.emit(x - dx * 0.45, y - 0.35, 0.44, 3, { color: new THREE.Color(0xf7e2b0), speed: 0.15, life: 0.7, size: 0.3, kind: 0, spread: 0.2 }); }
          this.playerAct = { k: 'push', t: 0 }; this.sfx('push'); if (this.time - (this.lastHup ?? -9) > 0.8) { this.lastHup = this.time; this.sfx('hup'); } break;
        case 'land': { { const pl = e.player; if (pl && Math.abs(pl.x - ev.x) <= 1 && Math.abs(pl.y - ev.y) <= 1) { this.playerMood('flinch', 0.45); this.sfx('oof'); } } // a heavy thing lands right next to him
          this.shake = Math.max(this.shake, ev.t === T.ROCK ? 0.12 : 0.07); P.emit(x, y - 0.42, 0.4, 10, { color: SAND, speed: 1.2, life: 0.5, size: 0.1, kind: 1, spread: 0.7 }); this.sfx('land'); break; }
        case 'roll': this.sfx('roll'); break;
        case 'absorb': { P.emit(x, y, 0.5, 40, { color: new THREE.Color(1, 0.55, 0.25), speed: 2.6, life: 0.8, size: 0.14 }); P.emit(x, y, 0.5, 30, { color: new THREE.Color(0.5, 0.9, 1), speed: 2, life: 1, size: 0.12 }); this.sfx('absorb'); if (this.onStat && !this.menuMode) this.onStat('pearl'); this.playerMood('joy', 1.25); setTimeout(() => this.sfx('yay'), 260);
          const ent = this.entities.get(ev.id); if (ent) { ent.absorbing = { t: 0, from: new V3(ev.fromX, -ev.fromY, 0.05), to: new V3(x, y, 0.3) }; this.entities.delete(ev.id); this.absorbing.push(ent); } break; }
        case 'gateOpen': { this.playerMood('joy', 1.25); this.flashFx('flash'); P.emit(x, y, 0.5, 70, { color: new THREE.Color(0.55, 0.95, 1), speed: 3.5, life: 1.3, size: 0.16 }); P.bubbles(x, y, 0.2, 18, 0.12, 0.8); this.sfx('gateOpen'); this.shake = 0.18; break; }
        case 'gateLocked': if (this.onToast && this.time - (this.lastLockToast ?? -9) > 2.5) { this.lastLockToast = this.time; this.onToast(`Deliver all energy first (${e.ballsIn}/${e.ballsTotal})`); } this.sfx('gateLocked'); this.playerMood('bonk', 0.55); this.sfx('hmm'); break;
        case 'monsterDeath': { P.bubbles(x, y, 0.2, 14, 0.1, 0.6); P.emit(x, y, 0.4, 20, { color: new THREE.Color(1, 0.7, 0.4), speed: 2, life: 0.7, size: 0.12 }); this.sfx('monsterDeath'); this.shake = Math.max(this.shake, 0.12);
          for (const ent of this.entities.values()) if (ent.o.x === ev.x && ent.o.y === ev.y && ent.o.t === ev.t) { ent.ghost = { t: 0, kind: 'monster' }; this.ghosts.push(ent); this.entities.delete(ent.o.id); } break; }
        case 'playerDeath': { P.bubbles(x, y, 0.2, 36, 0.13, 0.8); this.shake = 0.4; this.sfx('death'); this.sfx('aww'); this.setFx('dead');
          if (ev.cause === 'crushed') { P.emit(x, y - 0.3, 0.45, 26, { color: SAND, speed: 1.6, life: 0.9, size: 0.1, kind: 1, spread: 0.5, vy: 0.4 }); P.emit(x, y, 0.5, 14, { color: new THREE.Color(1, 0.95, 0.6), speed: 2.4, life: 0.5, size: 0.13, spread: 0.2 }); this.shake = 0.55; }
          for (const ent of this.entities.values()) if (ent.o.t === T.PLAYER) { ent.ghost = { t: 0, kind: 'player', cause: ev.cause, cx: x, cy: y }; ent.m.userData.baseScale = ent.m.scale.x; this.ghosts.push(ent); this.entities.delete(ent.o.id); } break; }
        case 'win': { this.flashFx('flash'); for (let i = 0; i < 4; i++) P.emit(x, y, 0.5, 30, { color: new THREE.Color().setHSL(Math.random(), 0.85, 0.65), speed: 3.5, life: 1.6, size: 0.15 }); this.sfx('win'); this.sfx('woohoo');
          for (const ent of this.entities.values()) if (ent.o.t === T.PLAYER) { ent.ghost = { t: 0, kind: 'win', to: new V3(x, y, 0.3) }; this.ghosts.push(ent); this.entities.delete(ent.o.id); } break; }
      }
    }

    // ---- camera ----
    fitCamera(snap, wholeLevel = false) {
      if (!this.e) return;
      const W = this.e.w, H = this.e.h, aspect = this.camera.aspect, fov = this.camera.fov * Math.PI / 180;
      const padTop = innerWidth < 560 ? 104 : isMobile ? 118 : 104, padBottom = (document.body.classList.contains('touch') ? 84 : 12) + (this.photoMode ? Math.round(innerHeight * (isMobile ? 0.04 : 0.08)) : 0);
      const freeFrac = Math.max(0.3, 1 - (padTop + padBottom) / innerHeight);
      const dH = (H / 2 + (isMobile ? 0.3 : 0.15)) / Math.tan(fov / 2) / freeFrac, dW = (W / 2 + (isMobile ? 0.4 : 0.1)) / Math.tan(fov / 2) / aspect; // computers: frame the playfield tighter
      const dFull = Math.max(dH, dW); this.dFull = dFull;
      // show the whole board unless that makes cells smaller than ~34px; then follow the diver at ~46px cells
      const pxPerCell = d => innerHeight / (2 * Math.tan(fov / 2) * d);
      const cellPx = aspect < 0.75 ? Math.max(46, Math.min(64, innerWidth / 7.2)) : 46, dFollow = innerHeight / (2 * Math.tan(fov / 2) * cellPx);
      this.camDist = wholeLevel || pxPerCell(dFull) >= 34 ? dFull : Math.min(dFull, dFollow);
      this.follow = this.camDist < dFull - 0.01;
      if (!isMobile) { this.camDist = dFull; this.follow = false; } // computers: always the whole level, no follow/zoom
      // on the home screen, pull back so the menu has room and the reef shows around the board
      if (this.menuMode) { this.camDist = dFull * (aspect > 1 ? 1.75 : 0.98); this.follow = false; }
      if (snap) { this.updateCameraTarget(); this.camPos.copy(this.camGoal); this.camTarget.copy(this.lookGoal); }
    }
    updateCameraTarget(overview = false) {
      const e = this.e, W = e.w, H = e.h; let cx = (W - 1) / 2, cy = -(H - 1) / 2;
      const dist = overview ? this.dFull * 1.04 : this.camDist * (this.menuMode ? 1 : (this.zoomK || 1));
      const fov = this.camera.fov * Math.PI / 180, halfH = Math.tan(fov / 2) * dist, halfW = halfH * this.camera.aspect;
      // centre the board in the free area between the HUD (top) and the D-pad (bottom, phones)
      const ppc = innerHeight / (2 * halfH);
      const padTop = innerWidth < 560 ? 104 : isMobile ? 118 : 104, padBottom = (document.body.classList.contains('touch') ? 84 : 12) + (this.photoMode ? Math.round(innerHeight * (isMobile ? 0.04 : 0.08)) : 0);
      const shift = (padTop - padBottom) / 2 / ppc;
      const visH = halfH - (padTop + padBottom) / 2 / ppc; // half-height of the free area in world units
      if (!overview && (this.follow || (this.playing && isMobile)) && this.playerPos && !this.menuMode) {
        // follow the diver, leading a little in the swim direction; never show past the board edges
        const lx = this.playerPos.x + (this.lead ? this.lead.x : 0), ly = this.playerPos.y + (this.lead ? this.lead.y : 0);
        cx = halfW * 2 >= W ? (W - 1) / 2 : Math.max(halfW - 0.6, Math.min(W - 0.4 - halfW, lx));
        cy = visH * 2 >= H ? -(H - 1) / 2 : Math.min(-visH + 0.5, Math.max(-(H - 0.5) + visH, ly));
      }
      cy += shift;
      // portrait phones: when the board fits vertically, sit the tank (and its stand) on the bottom of the free area instead of centring it,
      // so the extra screen goes to open water and the painting above rather than to seabed below
      if (this.camera.aspect < 1 && !this.menuMode) { const bottom = -(H - 1) - 0.5 - 1.15, top = 0.9, want = bottom + halfH * 0.9; // stand ~10% above the screen's bottom edge
        if (want + halfH - padTop / ppc >= top) cy = want; }
      this.camGoal = this.camGoal || new V3(); this.lookGoal = this.lookGoal || new V3();
      this.camGoal.set(cx, cy, dist); this.lookGoal.set(cx, cy, 0);
    }

    // ---- per frame ----
    update(dt, now) {
      this.time += dt; const t = this.time; skinTick(t);
      this.rayMat.uniforms.time.value = t; MAT.causticT.value = t;
      this.particles.update(dt, t);
      if (!this.e) { this.camera.position.set(0, 0, 30); this.camera.lookAt(0, 0, 0); this.placeBackdrop(); return; }
      const e = this.e;
      const a = Math.min(1, (now - this.lastTick) / this.tickMs), ease = a * a * (3 - 2 * a);
      // treasures: fall through open water once their sand is gone, settle on the next ledge
      if (this.edgePlants) for (const ep of this.edgePlants) if (ep.m.visible && e.get(ep.x, ep.y) !== T.SAND) ep.m.visible = false;
      if (this.treasures) for (const tr of this.treasures) {
        const m = tr.m;
        if (tr.state === 'buried') { if (e.get(tr.cx, tr.cy) !== T.SAND) { tr.state = 'falling'; tr.vy = 0.6; this.particles.emit(m.position.x, m.position.y, 0.5, 10, { color: new THREE.Color(1, 0.95, 0.7), speed: 1.4, life: 0.6, size: 0.12, spread: 0.2 }); if (!this.menuMode) { this.sfx('treasure'); if (this.onStat) this.onStat('treasure'); } }
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
      if (this.pump) { this.pump.t -= dt; if (this.pump.t <= 0) { this.pump.t = 0.09 + Math.random() * 0.08; this.particles.bubbles(this.pump.x + (Math.random() - 0.5) * 0.08, this.pump.y, this.pump.z, 1, 0.03 + Math.random() * 0.03, 0.05); } }
      this.syncOcclusion();
      for (const ent of this.entities.values()) {
        const o = ent.o, m = ent.m, moving = o.px !== o.x || o.py !== o.y;
        const k = (o.t === T.ROCK || o.t === T.BALL) && (o.falling || o.py !== o.y) ? a * a : ease;
        const ix = o.px + (o.x - o.px) * k, iy = -(o.py + (o.y - o.py) * k);
        if (o.t === T.ROCK || o.t === T.BALL) {
          m.position.set(ix, iy, 0.05);
          if (moving && o.t === T.BALL) { m.userData.spin.rotation.z -= (o.x - o.px) * dt * 7; m.userData.spin.rotation.x += (o.y - o.py) * dt * 5; }
          if (o.t === T.ROCK) { // a stone block tips a quarter turn per cell it rolls sideways
            ent.roll = (ent.roll || 0); if (o.x !== o.px && ent.lastRollTick !== o.moved) { ent.lastRollTick = o.moved; ent.rollTarget = (ent.rollTarget || 0) - Math.sign(o.x - o.px) * Math.PI / 2; }
            ent.roll += ((ent.rollTarget || 0) - ent.roll) * Math.min(1, dt * 14); m.userData.spin.rotation.z = ent.roll; }
          if (ent.wasFalling && !o.falling && !moving) ent.squash = 1; ent.wasFalling = o.falling || moving;
          const sq = ent.squash; m.scale.set(1 + sq * 0.12, 1 - sq * 0.14, 1 + sq * 0.12); ent.squash = Math.max(0, sq - dt * 7);
          m.userData.shadow.visible = e.get(o.x, o.y + 1) !== T.EMPTY && !o.falling;
          if (o.t === T.BALL) { const pulse = Math.sin(t * 4 + ent.phase); m.userData.glow.scale.setScalar(1.7 + pulse * 0.12); m.userData.core.material.opacity = 0.45 + pulse * 0.15;
            ent.spark = (ent.spark || 0) - dt; if (ent.spark <= 0) { ent.spark = 0.25 + Math.random() * 0.45; const an = Math.random() * 6.28; this.particles.emit(ix + Math.cos(an) * 0.38, iy + Math.sin(an) * 0.38, 0.45, 1, { color: new THREE.Color(1, 0.6 + Math.random() * 0.3, 0.2), speed: 0.35, life: 0.7, size: 0.07, kind: 2, spread: 0.02 }); } }
        } else if (o.t === T.PLAYER) {
          const u = m.userData, fit = u.fit || { s: 1.3, yOff: 0.04 }, dir = e.playerDir >= 0 ? 1 : -1, ph = ent.phase;
          // ---- locomotion: a damped spring chases the diver's cell, so every move eases out, overshoots a hair and settles like a body in water
          if (!ent.sp || Math.hypot(ent.sp.x - o.x, ent.sp.y + o.y) > 2.5) ent.sp = { x: o.x, y: -o.y, vx: 0, vy: 0 };
          { const S = ent.sp, k = 115, c = 2 * Math.sqrt(k) * 0.74, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
            for (let i = 0; i < n; i++) { S.vx += (k * (o.x - S.x) - c * S.vx) * h; S.vy += (k * (-o.y - S.y) - c * S.vy) * h; S.x += S.vx * h; S.y += S.vy * h; } }
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
          const mk = this.mood ? this.mood.k : null, mt = this.mood ? this.mood.t : 0, joy = mk === 'joy' ? Math.sin(Math.min(1, mt / 1.1) * Math.PI) : 0;
          // ---- lean: a springy pitch into the swim direction; stops rock back past upright and settle (water drag)
          const fwdV = vxW * dir, leanGoal = Math.max(-0.42, Math.min(0.42, -fwdV * 0.1)) - ent.reach * 0.12 - pushE * 0.32 + (vyW > 0.4 ? 0.08 : vyW < -0.4 ? -0.16 : 0);
          { ent.lean = ent.lean || 0; ent.leanV = ent.leanV || 0; const k = 70, c = 2 * Math.sqrt(k) * 0.42; ent.leanV += (k * (leanGoal - ent.lean) - c * ent.leanV) * dt; ent.lean += ent.leanV * dt; }
          const sway = Math.sin(t * 0.7 + ph) * 0.05 * floatK;
          u.body.rotation.z = ent.lean + sway + digE * (act && act.dir === 'down' ? 0.42 : act && act.dir === 'up' ? -0.32 : -0.2);
          u.head.rotation.z = -ent.lean * 0.35 + Math.sin(t * 0.8 + ph + 1) * 0.04 * floatK + (mk === 'bonk' ? Math.sin(mt * 30) * 0.18 * Math.max(0, 1 - mt / 0.5) : 0) + (vyW > 0.4 ? 0.12 : vyW < -0.4 ? -0.18 : 0) * swimK;
          // body slides toward what it pushes so the gloves actually touch it
          const lean2 = dir * (0.31 * Math.max(ent.reach, pushE) + 0.03 * pushE), hop = joy * 0.16 * Math.abs(Math.sin(mt * 6.5)) ;
          m.position.set(gx0 + lean2, gy0 + fit.yOff + ent.lift + bob + hop, 0.14); this.playerPos = m.position;
          const gx = gx0, gy = gy0;
          // danger cue: a heavy stone/pearl in the column right above the diver (it falls if he moves the wrong way)
          { if (!this.warn) { const c = document.createElement('canvas'); c.width = c.height = 128; const g2 = c.getContext('2d');
              g2.fillStyle = '#ff3b30'; g2.beginPath(); g2.arc(64, 64, 52, 0, 7); g2.fill(); g2.lineWidth = 8; g2.strokeStyle = '#ffffff'; g2.stroke();
              g2.fillStyle = '#ffffff'; g2.font = '900 84px Arial, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('!', 64, 70);
              this.warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, toneMapped: false })); this.warn.renderOrder = 20; this.scene.add(this.warn); }
            let danger = false; for (let k = 1; k <= 2; k++) { const yy = o.y - k; if (yy < 0) break; const q = e.obj[yy * e.w + o.x]; if (q && (q.t === T.ROCK || q.t === T.BALL)) { danger = true; break; } if (e.get(o.x, yy) !== T.EMPTY) break; }
            const show = danger && e.state === 'playing'; if (show && !this.warn.visible) { this.playerMood('surprise', 0.9); this.sfx('eep'); } this.warn.visible = show; if (danger) { const pz = 1 + Math.sin(t * 9) * 0.12; this.warn.scale.setScalar(0.42 * pz); this.warn.position.set(gx + 0.38, gy + 0.62, 0.9); } }
          // ---- turning (yaw spring) + a full happy spin on joy
          { const yt = dir > 0 ? -0.35 : -Math.PI + 0.35; if (ent.yaw === undefined) ent.yaw = yt; ent.yaw += (yt - ent.yaw) * (1 - Math.exp(-dt * 9));
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
          m.userData.tents.forEach((tt, i) => { tt.rotation.x = Math.sin(t * 3 + i) * 0.25; tt.rotation.z = Math.cos(t * 2.5 + i) * 0.25; });
        } else if (o.t === T.CRAB) {
          m.position.set(ix, iy - 0.2, 0.15);
          m.userData.legs.forEach((l, i) => { l.rotation.z = moving ? Math.sin(t * 22 + i) * 0.4 : 0; });
        }
      }
      this.syncEntityShadows();
      // ghosts
      this.ghosts = this.ghosts.filter(ent => { const g = ent.ghost, m = ent.m; g.t += dt;
        if (g.kind === 'win') { const k = Math.min(1, g.t / 1); m.position.lerp(g.to, Math.min(1, dt * 5)); m.rotation.y += dt * 12; m.scale.setScalar(1.45 * (1 - k * k)); if (k >= 1) { this.levelGroup.remove(m); return false; } return true; }
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
        const bk = this.gateBeam.material.uniforms.uK; bk.value += ((open ? 0.55 : 0) - bk.value) * Math.min(1, dt * 3); this.gateBeam.visible = bk.value > 0.01; } else if (this.gateBeam) this.gateBeam.visible = false; if (!this.gateObj) this.gateLight.intensity = 0;
      // gate
      if (this.gateObj) {
        const g = this.gateObj, open = e.gate.open ? 1 : 0; g.userData.k = (g.userData.k || 0) + (open - (g.userData.k || 0)) * Math.min(1, dt * 3); const ok = g.userData.k;
        g.userData.lamp.material = open ? MAT.lampGreen : MAT.lampRed; g.userData.lampGlow.material.color.set(open ? 0x3aff7a : 0xff3a2a);
        g.userData.glow.material.opacity = 0.18 + ok * 0.5 + Math.sin(t * 4) * 0.06 * (0.3 + ok);
        g.userData.screen.position.y = -0.06 + (open ? Math.sin(t * 5) * 0.01 : 0);
        if (open && Math.random() < 0.25) this.particles.bubbles(g.position.x + (Math.random() - 0.5) * 0.5, g.position.y, 0.5, 1, 0.06, 0.2);
      }
      for (const a2 of this.airObjs.values()) { a2.position.y += Math.sin(t * 2 + a2.position.x) * 0.0015; a2.userData.b.scale.setScalar(1 + Math.sin(t * 3 + a2.position.x) * 0.04); }
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
      if (this.menuMode) { this.camGoal.x += Math.sin(t * 0.15) * 1.2; this.lookGoal.x = this.camGoal.x; const lift = this.camGoal.z * (innerHeight > innerWidth ? 0.052 : -0.045); this.camGoal.y -= lift; this.lookGoal.y -= lift; } // menu: board sits between the logo and PLAY
      let cl = 1 - Math.pow(0.012, dt);
      { const dim = this.cineCam ? (this.storyDim || 0) : 0; this.renderer.toneMappingExposure = 1 - 0.62 * dim; if (this.photo) this.photo.bg.material.color.copy(this.bgTint || new THREE.Color(1, 1, 1)).lerp(new THREE.Color(0.08, 0.14, 0.32), 0.78 * dim); } // the story's dark reef, lit again when the gate wakes
      if (this.cineCam && this.cineT !== undefined) { // the intro's director: descend from the surface -> follow the diver -> push in on the gate -> pull back wide
        const e = this.e, cx = (e.w - 1) / 2, cy = -(e.h - 1) / 2, D = this.dFull || 20, T = this.cineT, sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
        const pp = this.playerPos || new V3(cx, cy, 0), gx = e.gate ? e.gate.x : cx, gy = e.gate ? -e.gate.y : cy, S = this.cineShot || 'play';
        let fx, fy, d, lift;
        if (S === 'descent') { const k = sm(0, 9.4, T); fx = cx + (pp.x - cx) * k * 0.5; fy = cy + 4.2 * (1 - k) + (pp.y - cy) * k * 0.5; d = D * (1.35 - 0.6 * k); lift = 6.5 * (1 - k) + 0.8 * k; }
        else if (S === 'hero') { fx = pp.x + 0.25; fy = pp.y + 0.15; d = D * 0.42; lift = 0.25; }
        else if (S === 'gate') { fx = (pp.x + gx) / 2; fy = (pp.y + gy) / 2 + 0.2; d = D * 0.62; lift = 0.5; }
        else if (S === 'wide') { fx = cx; fy = cy + 0.4; d = D * 1.08; lift = 2.2; }
        else { fx = pp.x + this.moveDir.x * 0.6; fy = pp.y + 0.35; d = D * 0.68; lift = 0.6; }
        const hw = Math.tan(this.camera.fov * Math.PI / 360) * d * this.camera.aspect; if (hw * 2 < e.w) fx = Math.max(hw - 1, Math.min(e.w - hw, fx)); else fx = cx; // stay inside the tank
        this.camGoal.set(fx, fy + lift, d); this.lookGoal.set(fx, fy, 0); cl = 1 - Math.pow(S === 'descent' ? 0.25 : 0.1, dt); // slower, filmic easing
      }
      this.camPos.lerp(this.camGoal, cl); this.camTarget.lerp(this.lookGoal, cl);
      this.shake = Math.max(0, this.shake - dt * 1.4); const sh = this.shake * this.shake * 0.5;
      const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
      { // look down at the board from slightly above so blocks, sand walls and shadows read as real 3D
        const tl = this.menuMode ? this.tilt * 0.8 : this.tilt, d = this.camPos.z;
        this.camera.position.set(this.camPos.x + sx, this.camTarget.y + sy + d * Math.sin(tl) - (this.camTarget.y - this.camPos.y), d * Math.cos(tl));
        this.camera.lookAt(this.camTarget.x + sx, this.camTarget.y + sy, 0); }
      this.placeBackdrop(); this.placePhotoBg(t);
      if (this.fg && this.fg.box) { const b = this.fg.box; this.fg.update(t, dt, 0, b.top, b.bot, b.span); this.fg.mat.uniforms.scale.value = innerHeight * this.pixelRatio * 0.9; }
      if (this.reef) { this.reef.update(t); const cd = this.camera.position.z; this.scene.fog.near = cd - 2; this.scene.fog.far = cd + 40; this.reef.snowMat.uniforms.scale.value = innerHeight * this.pixelRatio * 0.9; }
      if (this.fx) this.fx.classList.toggle('lowair', e.state === 'playing' && e.oxygen < 15);
    }
    warm(e) { this.loadLevel(e); this.onTick(e, performance.now()); this.fitCamera(true, true); for (let i = 0; i < 2; i++) { this.update(0.016, performance.now()); this.render(); } }
    benchmark() { const gl = this.renderer.getContext(), px = new Uint8Array(4), ms = [];
      for (let i = 0; i < 4; i++) { const t0 = performance.now(); this.update(0.016, performance.now()); this.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t0); }
      ms.sort((a, b) => a - b); const m = ms[1]; // a typical frame at the current tier
      const q = m < 9 ? (isMobile ? 'high' : 'ultra') : m < 18 ? 'high' : m < 34 ? 'medium' : 'low'; if (q !== this.quality) this.setQuality(q); return { ms: m, q }; }
    render() {
      // phones: refresh the shadow map every other frame (the key light and tank never move; bobbing at 30 Hz is indistinguishable)
      const sm = this.renderer.shadowMap; if (isMobile && sm.enabled) { sm.autoUpdate = false; this.frameN = (this.frameN || 0) + 1; if (this.frameN % 2 === 0 || this.shadowDirty) { sm.needsUpdate = true; this.shadowDirty = false; } }
      this.post.render(this.scene, this.camera, this.time); }
  }
  // resolves once every image the scenes use is decoded (the loading screen waits on it), reporting progress 0..1
  function ready(onProgress) { const ims = [...Object.values(SPR.img), PHOTO_IMG]; let done = 0;
    return Promise.all(ims.map(im => (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).then(() => { done++; if (onProgress) onProgress(done / ims.length); }))); }
  return { create: c => new WorldImpl(c), isMobile, ready, SKINS, SKIN, applySkin, preview: (cv, thumb) => new SkinPreview(cv, thumb), trailColor, rarityOf };
})();

// Aqua Energizer — hand-drawn doodle intro (≈28 s) and doodle menu background.
// Plain 2D canvas, black wobbly ink on warm paper, a few flat accent colours.
const Doodle = (() => {
  const cv = document.getElementById('doodle'); let ctx = cv.getContext('2d');
  const INK = '#1b1b1f', PAPER = '#fbf6ea', SAND = '#f7e6a6', STONE = '#dedad1', RED = '#e8402e', BLUE = '#2f8cff', LBLUE = '#d6ecff', GREEN = '#3aa655', YELLOW = '#ffcc33';
  let W = 0, H = 0, dpr = 1, scale = 1, oy = 0, camX = 0;
  let mode = 'off', t0 = 0, raf = 0, onDone = null, fired = new Set(), bubbles = [], lastT = 0;
  const DUR = 28;

  function resize() { dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); scale = Math.min(H / 580, W / 560); oy = (H - 600 * scale) / 2; }
  addEventListener('resize', resize); resize();

  // ---------- hand-drawn primitives (wobble is seeded from local coords, with a gentle 7 fps "boil")
  let boil = 0;
  const hn = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const jit = (x, y, s, amt) => [x + (hn(x * 0.131 + s, y * 0.071 + boil) - 0.5) * amt * 2, y + (hn(y * 0.113 + s, x * 0.053 + boil * 1.7) - 0.5) * amt * 2];
  function dens(pts, step, close) { const out = [], n = pts.length, lim = close ? n : n - 1;
    for (let i = 0; i < lim; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; const k = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step)); for (let j = 0; j < k; j++) out.push([x1 + (x2 - x1) * j / k, y1 + (y2 - y1) * j / k]); }
    if (!close) out.push(pts[n - 1]); return out; }
  function shape(pts, { fill = null, stroke = INK, lw = 3, close = true, step = 16, wob = 1.1, seed = 0, alpha = 1 } = {}) {
    const p = step < 900 ? dens(pts, step, close) : pts; ctx.beginPath();
    p.forEach(([x, y], i) => { const [a, b] = jit(x, y, seed + i * 0.37, wob); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); if (close) ctx.closePath();
    ctx.globalAlpha = alpha; if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); } ctx.globalAlpha = 1; }
  const circ = (x, y, r, o = {}) => { const n = Math.max(12, Math.round(r * 0.8)), pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } shape(pts, { step: 999, wob: Math.min(1.1, r * 0.08), ...o }); };
  const rect = (x, y, w, h, o = {}) => shape([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o);
  const line = (pts, o = {}) => shape(pts, { close: false, ...o });
  const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---------- scene pieces (world units: floor at y=470, ceiling edge ~y=70)
  const FLOOR = 470;
  const ceilPts = (() => { const p = [[-600, -600]]; for (let x = -600; x <= 2600; x += 130) p.push([x, 66 + Math.sin(x * 0.013) * 8]); p.push([2600, -600]); return p; })();
  const floorPts = (() => { const p = [[-600, 1200]]; for (let x = -600; x <= 2600; x += 120) p.push([x, FLOOR + Math.sin(x * 0.011 + 1) * 5]); p.push([2600, 1200]); return p; })();
  const WEEDS = [[-120, 70], [120, 80], [175, 55], [430, 70], [600, 50], [880, 75], [1190, 60], [1420, 70], [1640, 55], [1990, 80], [2060, 55]];
  function weed(x, h, t) { const pts = []; for (let i = 0; i <= 6; i++) { const k = i / 6; pts.push([x + Math.sin(t * 1.3 + x * 0.05 + k * 2.4) * 9 * k, FLOOR + 2 - h * k]); } line(pts, { stroke: GREEN, lw: 4, step: 8, wob: 0.6, seed: x }); }
  function fish(x, y, dir, t, s = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
    const wag = Math.sin(t * 8) * 4;
    shape([[-18, 0], [-30, -9 + wag * 0.3], [-30, 9 + wag * 0.3]], { fill: '#fff', lw: 2.5, step: 999 });
    const pts = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push([Math.cos(a) * 20, Math.sin(a) * 11]); } shape(pts, { fill: '#fff', lw: 2.5, step: 999 });
    circ(9, -2, 2.2, { fill: INK, stroke: null }); ctx.restore(); }
  function pearl(x, y, t, s = 1, glow = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (glow > 0) { const p = (Math.sin(t * 3) + 1) / 2; circ(0, 0, 24 + p * 5, { fill: null, stroke: RED, lw: 2, alpha: (0.2 + p * 0.25) * glow }); }
    circ(0, 0, 16, { fill: RED, lw: 3 }); line([[-7, -6], [-3, -9]], { stroke: '#fff', lw: 3, step: 999, wob: 0.3 }); ctx.restore(); }
  function bubble(x, y, r) { circ(x, y, r, { stroke: BLUE, lw: 2, fill: null }); }

  // diver: round helmet + big visor, simple body, tank, line arms/legs
  function diver(x, y, o) { const { face = 1, kick = 0, look = [1, 0], pose = 'swim', tilt = 0, s = 1, reach = 0 } = o;
    if (!INK_MODE && ART.ready && ART.man.length >= 7) { const f = pose === 'up' ? 4 : pose === 'push' ? 3 : o.idle ? 0 : 1 + (Math.floor(kick * 0.35) % 6 + 6) % 6; const im = ART.man[f];
      const hgt = 84 * s, wd = im.width * hgt / im.height; ctx.save(); ctx.translate(x, y); ctx.rotate(tilt * 0.5); ctx.scale(face, 1); ctx.drawImage(im, -wd / 2, -46 * s, wd, hgt); ctx.restore(); return; }
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(face * s, s);
    const k1 = Math.sin(kick) * 7, k2 = -k1, LEG = '#26201b';
    // backpack (orange, pencil shaded)
    shape([[-24, -12], [-9, -12], [-9, 14], [-24, 14]], { fill: '#f2a33c', lw: 2.6, step: 999, wob: 0.6 });
    line([[-22, -4], [-12, -4]], { stroke: '#c67a1e', lw: 2, step: 999 }); line([[-21, 4], [-13, 8]], { stroke: '#c67a1e', lw: 1.6, step: 999 }); line([[-21, 9], [-14, 12]], { stroke: '#c67a1e', lw: 1.6, step: 999 });
    // legs (stick legs with little feet)
    line([[-3, 15], [-6 + k1 * 0.6, 26], [-10 + k1, 36]], { stroke: LEG, lw: 3.2, step: 999 }); line([[-10 + k1, 36], [-4 + k1, 37]], { stroke: LEG, lw: 3.2, step: 999 });
    line([[4, 15], [5 + k2 * 0.6, 26], [3 + k2, 36]], { stroke: LEG, lw: 3.2, step: 999 }); line([[3 + k2, 36], [9 + k2, 37]], { stroke: LEG, lw: 3.2, step: 999 });
    // body
    shape([[-10, -7], [10, -7], [11, 16], [-10, 16]], { fill: '#fffaf0', lw: 2.8, step: 999, wob: 0.6 });
    line([[-9, -5], [-9, 6]], { stroke: '#f2a33c', lw: 3, step: 999 }); // strap
    // arms
    if (pose === 'up') { line([[8, -3], [16, -14], [20, -26]], { stroke: LEG, lw: 3, step: 999 }); line([[-6, -3], [-12, -16], [-14, -28]], { stroke: LEG, lw: 3, step: 999 }); }
    else if (pose === 'push') { line([[8, -1], [22 + reach, 2], [30 + reach, 0]], { stroke: LEG, lw: 3, step: 999 }); line([[6, 4], [21 + reach, 8], [29 + reach, 7]], { stroke: LEG, lw: 3, step: 999 }); }
    else { const sw = Math.sin(kick * 0.8) * 7; line([[8, -2], [15, 6], [20, 12 + sw]], { stroke: LEG, lw: 3, step: 999 }); line([[-4, -1], [-8, 7], [-10, 14 - sw]], { stroke: LEG, lw: 3, step: 999 }); }
    // head with a happy face
    circ(1, -26, 17, { fill: '#fffdf6', lw: 2.8 });
    ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#8a7a60'; ctx.beginPath(); ctx.arc(-4, -21, 12, 1.4, 3.4); ctx.lineTo(-4, -21); ctx.fill(); ctx.restore(); // soft pencil shade
    const [lx, ly] = look, ex = 6 + lx * 2, ey = -29 + ly * 2;
    ctx.fillStyle = INK; for (const dx of [-4.5, 4.5]) { ctx.beginPath(); ctx.ellipse(ex + dx, ey, 2.2, 3.1, 0, 0, 7); ctx.fill(); }
    if (pose === 'up') shape([[ex - 6, ey + 6], [ex + 6, ey + 6], [ex, ey + 12]], { fill: '#c0392b', lw: 2, step: 999, wob: 0.2 });
    else line([[ex - 5, ey + 7], [ex, ey + 10], [ex + 5, ey + 7]], { lw: 2.2, step: 999, wob: 0.2 });
    ctx.restore(); }
  function machine(t, st) { const x = 1000, y = 360;
    rect(x + 46, y - 30, 16, 30, { fill: STONE, lw: 3, step: 999 });
    rect(x, y, 120, FLOOR - y, { fill: STONE, lw: 3 });
    line([[x + 70, y + 30], [x + 104, y + 30]], { lw: 2.5, step: 999 }); line([[x + 70, y + 44], [x + 96, y + 44]], { lw: 2.5, step: 999 });
    rect(x + 12, 418, 40, 40, { fill: st.active ? '#fff' : '#f2efe7', lw: 3, step: 999 });
    const blink = st.active ? 1 : (Math.sin(t * 5) > 0 ? 1 : 0.45);
    circ(x + 92, 385, 9, { fill: st.active ? BLUE : '#a9cdf0', lw: 2.5, alpha: st.active ? 1 : blink });
    if (st.active) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + t; line([[x + 92 + Math.cos(a) * 13, 385 + Math.sin(a) * 13], [x + 92 + Math.cos(a) * 18, 385 + Math.sin(a) * 18]], { stroke: BLUE, lw: 2, step: 999 }); }
    // cable to the door; energy dashes travel along it once active
    line([[x + 120, 452], [1270, 452]], { lw: 2.5 });
    if (st.active) { ctx.save(); ctx.setLineDash([10, 14]); ctx.lineDashOffset = -t * 60; line([[x + 120, 446], [1270, 446]], { stroke: BLUE, lw: 3, wob: 0.4 }); ctx.restore(); }
  }
  function door(t, st) { const x = 1270, w = 60;
    ctx.save(); ctx.beginPath(); ctx.rect(x, 296, w, FLOOR - 296 + 4); ctx.clip();
    const dy = -st.doorOpen * 180;
    rect(x + 6, 300 + dy, w - 12, 170, { fill: '#fff', lw: 3, step: 999 });
    line([[x + 14, 340 + dy], [x + w - 14, 340 + dy]], { stroke: BLUE, lw: 4, step: 999 }); line([[x + 14, 360 + dy], [x + w - 14, 360 + dy]], { stroke: BLUE, lw: 4, step: 999 });
    circ(x + w / 2, 410 + dy, 7, { fill: st.active ? BLUE : '#a9cdf0', lw: 2.5 });
    ctx.restore();
    rect(x, 60, w, 236, { fill: STONE, lw: 3 }); // lintel + wall above the doorway
    line([[x, 296], [x, FLOOR]], { lw: 3 }); line([[x + w, 296], [x + w, FLOOR]], { lw: 3 });
  }
  function passage(t) {
    rect(1470, 410, 60, 60, { fill: STONE, lw: 3, step: 999 });
    shape([[1570, FLOOR], [1590, 420], [1640, 400], [1690, 415], [1710, FLOOR]], { fill: SAND, lw: 3 });
    rect(1760, 350, 60, 60, { fill: STONE, lw: 3, step: 999 }); rect(1760, 410, 60, 60, { fill: STONE, lw: 3, step: 999 });
    pearl(1900, 452, t, 1, 1);
    rect(2150, 60, 70, FLOOR - 60, { fill: STONE, lw: 3 });
    // tiny crab
    ctx.save(); ctx.translate(2040, 456); const sc = Math.sin(t * 2) * 10; ctx.translate(sc, 0);
    shape([[-14, 0], [-10, -10], [10, -10], [14, 0]], { fill: '#fff', lw: 2.5, step: 999 }); circ(-6, -14, 2, { fill: INK, stroke: null }); circ(6, -14, 2, { fill: INK, stroke: null });
    line([[-14, -4], [-20, -12]], { lw: 2.5, step: 999 }); line([[14, -4], [20, -12]], { lw: 2.5, step: 999 }); ctx.restore();
  }
  function scenery(t) { shape(ceilPts, { fill: STONE, lw: 3, step: 30 }); shape(floorPts, { fill: SAND, lw: 3, step: 30 });
    rect(-240, 330, 90, FLOOR - 330, { fill: STONE, lw: 3, step: 999 });
    WEEDS.forEach(([x, h]) => weed(x, h, t)); }
  function updBubbles(dt, srcs) {
    if (Math.random() < dt * 2.2) { const s = srcs[(Math.random() * srcs.length) | 0]; bubbles.push({ x: s[0], y: s[1], r: 3 + Math.random() * 5, v: 30 + Math.random() * 30, ph: Math.random() * 6 }); }
    bubbles = bubbles.filter(b => (b.y -= b.v * dt) > 75); }
  function drawBubbles(t) { bubbles.forEach(b => bubble(b.x + Math.sin(t * 2 + b.ph) * 3, b.y, b.r)); }

  // ---------- intro timeline
  function state(t) {
    const st = { active: t >= 14.8, doorOpen: ease(seg(t, 15.4, 16.8)) };
    // diver path
    let dx, dy = 400 + Math.sin(t * 2) * 5, face = 1, pose = 'swim', kick = t * 8, look = [1, 0], tilt = 0, reach = 0;
    if (t < 4.2) { dx = lerp(-90, 540, 1 - Math.pow(1 - seg(t, 0, 4.2), 2)); tilt = -0.08; }
    else if (t < 10) { dx = 540; kick = t * 2.5;
      if (t < 5.4) look = [1, 0.6];                               // spots the pearl
      else { const ph = Math.floor((t - 5.4) / 1.1) % 2; look = ph ? [1, -0.3] : [0.6, 0.8]; } } // pearl ↔ machine
    else if (t < 11.2) { dx = lerp(540, 648, ease(seg(t, 10, 11.2))); dy = lerp(400, 440, ease(seg(t, 10, 11.2))); tilt = -0.1; }
    else if (t < 14.5) { const k = ease(seg(t, 11.2, 14.0)); dx = lerp(648, 948, k); dy = 440 + Math.sin(t * 2) * 3; pose = 'push'; reach = Math.sin(t * 6) * 2; tilt = -0.15; kick = t * 10; }
    else if (t < 17) { dx = 948; dy = lerp(440, 400, ease(seg(t, 14.5, 15.5))); kick = t * 3; look = t < 15.3 ? [1, 0.3] : [1, -0.1]; }
    else if (t < 18.6) { dx = 948; const j = seg(t, 17, 18.6); dy = 400 - Math.abs(Math.sin(j * Math.PI * 2)) * 26; pose = 'up'; kick = t * 6; }
    else if (t < 21.4) { dx = 948; kick = t * 2.5; look = [1, -0.2]; }
    else { const k = ease(seg(t, 21.4, 25.6)); dx = lerp(948, 1460, k); dy = lerp(400, 380, k) + Math.sin(t * 3) * 4; tilt = -0.12; kick = t * 9; }
    st.diver = { x: dx, y: dy, face, pose, kick, look, tilt, reach };
    // pearl: rests, gets pushed, hops into the socket
    if (t < 11.2) st.pearl = [700, 452];
    else if (t < 14.0) st.pearl = [lerp(700, 1000, ease(seg(t, 11.2, 14.0))), 452];
    else if (t < 14.5) { const k = seg(t, 14.0, 14.5); st.pearl = [lerp(1000, 1032, k), lerp(452, 438, k) - Math.sin(k * Math.PI) * 26]; }
    else { const k = seg(t, 14.5, 14.9); st.pearl = [1032, 438 - Math.sin(k * Math.PI) * 6]; st.pearlSquash = 1 - Math.sin(k * Math.PI) * 0.12; }
    st.pearlSpin = t > 11.2 && t < 14 ? (t - 11.2) * 6 : 0;
    // camera
    let c;
    if (t < 5) c = Math.max(250, dx + 120);
    else if (t < 10) c = lerp(660, Math.min(820, 498 + W / scale / 2), ease(seg(t, 5, 6.6)));
    else if (t < 14.6) c = Math.max(820, dx + 120);
    else if (t < 18.6) c = lerp(1068, 1120, ease(seg(t, 14.6, 16)));
    else if (t < 21.4) c = t < 20.2 ? lerp(1120, 1660, ease(seg(t, 18.6, 20.2))) : lerp(1660, 1180, ease(seg(t, 20.6, 21.6)));
    else c = lerp(1180, 1470, ease(seg(t, 21.6, 25.8)));
    st.cam = c; return st;
  }
  const CUES = [[4.3, 'air'], [14.45, 'push'], [14.5, 'click'], [14.85, 'absorb'], [15.5, 'gateOpen'], [17.1, 'bubble']];

  function drawIntro(t, dt) {
    const st = state(t); camX = st.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - camX * scale), dpr * oy);
    scenery(t);
    fish(lerp(-200, 1500, (t * 0.035) % 1), 170, 1, t); fish(lerp(1500, -200, (t * 0.028 + 0.4) % 1), 230, -1, t, 0.8); fish(lerp(1400, 2300, (t * 0.03) % 1), 200, 1, t, 0.9);
    updBubbles(dt, [[120, 400], [430, 400], [880, 400], [1420, 400], [st.diver.x + 10, st.diver.y - 45]]); drawBubbles(t);
    passage(t); machine(t, st); door(t, st);
    // pearl (pushed pearl spins with a little rolling mark)
    const [px, py] = st.pearl; ctx.save(); ctx.translate(px, py); ctx.scale(1, st.pearlSquash || 1); ctx.rotate(st.pearlSpin); ctx.translate(-px, -py); pearl(px, py, t, 1, t < 14.5 ? 1 : 0.6); ctx.restore();
    // discovery sparkle on the pearl
    if (t > 3.7 && t < 5.2) { const k = seg(t, 3.7, 5.2), a = Math.sin(k * Math.PI); for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2 + 0.4; line([[700 + Math.cos(an) * 26, 452 + Math.sin(an) * 26], [700 + Math.cos(an) * (26 + 12 * a), 452 + Math.sin(an) * (26 + 12 * a)]], { stroke: YELLOW, lw: 3, step: 999 }); } }
    // hint arrow pearl → socket
    if (t > 6.8 && t < 10.4) { const p = ease(seg(t, 6.8, 8.6)), fade = 1 - seg(t, 9.8, 10.4); const P0 = [700, 420], C = [866, 300], P1 = [1028, 412]; const pts = [];
      for (let i = 0; i <= 30 * p; i++) { const u = i / 30; pts.push([(1 - u) * (1 - u) * P0[0] + 2 * (1 - u) * u * C[0] + u * u * P1[0], (1 - u) * (1 - u) * P0[1] + 2 * (1 - u) * u * C[1] + u * u * P1[1]]); }
      if (pts.length > 1) { ctx.save(); ctx.setLineDash([10, 10]); line(pts, { stroke: INK, lw: 3, step: 999, wob: 0.5, alpha: fade }); ctx.restore(); }
      if (p > 0.97) { const [ex, ey] = P1; shape([[ex, ey], [ex - 16, ey - 4], [ex - 6, ey - 16]], { fill: INK, lw: 2, step: 999, alpha: fade }); } }
    // activation: small flash, energy lines, pulse ring
    if (t > 14.75 && t < 16) { const k = seg(t, 14.75, 15.9);
      circ(1032, 438, 24 + k * 20, { fill: '#fff', stroke: null, alpha: (1 - seg(t, 14.75, 15.1)) * 0.9 });
      circ(1060, 415, 30 + k * 110, { fill: null, stroke: BLUE, lw: 3, alpha: 1 - k });
      for (let i = 0; i < 7; i++) { const a = -Math.PI * 0.95 + i * Math.PI * 0.32, r0 = 40 + k * 30; const pts = []; for (let j = 0; j < 4; j++) { const r = r0 + j * 9; pts.push([1060 + Math.cos(a) * r + (j % 2 ? 5 : -5) * Math.sin(a), 415 + Math.sin(a) * r - (j % 2 ? 5 : -5) * Math.cos(a)]); } line(pts, { stroke: BLUE, lw: 3, step: 999, alpha: 1 - k }); } }
    // door dust bubbles
    if (t > 15.5 && t < 16.9) for (let i = 0; i < 5; i++) { const k = seg(t, 15.5 + i * 0.1, 16.9); bubble(1280 + i * 11, 460 - k * 60, 3 + (i % 3)); }
    // diver + reactions
    const d = st.diver; diver(d.x, d.y, d);
    if (t > 4.3 && t < 5.6) { const k = seg(t, 4.3, 4.6), out = 1 - seg(t, 5.3, 5.6); ctx.save(); ctx.translate(d.x + 4, d.y - 62); ctx.scale(k * out, k * out);
      line([[0, -14], [0, 2]], { lw: 5, step: 999, wob: 0.4 }); circ(0, 9, 2.6, { fill: INK, stroke: null }); ctx.restore(); }
    if (t > 17 && t < 18.8) { for (let i = 0; i < 3; i++) { const a = -2.2 + i * 0.7, k = seg(t, 17 + i * 0.15, 18.4); const sx = d.x + Math.cos(a) * (40 + k * 12), sy = d.y - 30 + Math.sin(a) * (40 + k * 12);
        line([[sx - 6, sy], [sx + 6, sy]], { stroke: YELLOW, lw: 3, step: 999, alpha: 1 - k }); line([[sx, sy - 6], [sx, sy + 6]], { stroke: YELLOW, lw: 3, step: 999, alpha: 1 - k }); } }
    // fade to paper at the end
    const f = seg(t, 26.2, 27.6); if (f > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = f; ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalAlpha = 1; }
    const fin = seg(t, 0, 0.8); if (fin < 1) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - fin; ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalAlpha = 1; }
  }

  // ---------- calm menu background
  function drawMenu(t, dt) {
    camX = 330;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - camX * scale), dpr * oy);
    shape(floorPts, { fill: SAND, lw: 3, step: 30 });
    [[20, 70], [70, 50], [560, 80], [610, 55], [660, 65]].forEach(([x, h]) => weed(x, h, t));
    fish(lerp(-150, 820, (t * 0.04) % 1), 150, 1, t, 0.9); fish(lerp(820, -150, (t * 0.03 + 0.5) % 1), 240, -1, t, 0.7);
    updBubbles(dt, [[70, 410], [610, 410], [150, 360]]); drawBubbles(t);
    // keep the little diver and his pearl clear of the centred title/buttons
    const vw = W / scale, portrait = H > W, dxm = portrait ? camX - 90 : camX - vw * 0.36;
    diver(dxm, 405 + Math.sin(t * 1.6) * 7, { kick: t * 2.5, look: [1, 0.5], tilt: Math.sin(t * 0.9) * 0.05, s: portrait ? 1.3 : 1.15 });
    pearl(dxm + (portrait ? 150 : vw * 0.66), 452, t, portrait ? 1.2 : 1.1, 1);
  }


  // ---------- doodle gameplay renderer (experiment: first levels drawn in the paper style)
  // Reads the same Engine state as the 3D world, so rules, timing and input are untouched.
  const C = 64; // world units per cell
  let L = null;
  const T_ = () => window.__T;
  function crab(x, y, t, s = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    shape([[-16, 8], [-12, -6], [12, -6], [16, 8]], { fill: '#fff', lw: 2.6, step: 999 });
    circ(-6, -12, 2.4, { fill: INK, stroke: null }); circ(6, -12, 2.4, { fill: INK, stroke: null });
    const w = Math.sin(t * 6) * 3;
    line([[-16, 0], [-24, -8 + w]], { lw: 2.6, step: 999 }); line([[16, 0], [24, -8 - w]], { lw: 2.6, step: 999 });
    line([[-10, 8], [-14, 16]], { lw: 2.2, step: 999 }); line([[10, 8], [14, 16]], { lw: 2.2, step: 999 }); ctx.restore(); }
  function jelly(x, y, t, s = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); const p = (Math.sin(t * 2.4) + 1) / 2;
    const pts = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; pts.push([Math.cos(a) * (18 + p * 2), Math.sin(a) * (16 - p * 3) - 2]); }
    shape(pts, { fill: '#fff', lw: 2.6, step: 999 });
    for (let i = 0; i < 4; i++) { const bx = -10 + i * 7, q = []; for (let k = 0; k <= 4; k++) q.push([bx + Math.sin(t * 3 + i + k) * 3, -2 + k * 5]); line(q, { lw: 2, step: 999, wob: 0.4 }); }
    circ(-5, -9, 1.8, { fill: INK, stroke: null }); circ(5, -9, 1.8, { fill: INK, stroke: null }); ctx.restore(); }
  function stoneBlock(x, y, rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    shape([[-26, -23], [-23, -26], [23, -26], [26, -23], [26, 23], [23, 26], [-23, 26], [-26, 23]], { fill: '#c9cdd1', stroke: '#2e2a27', lw: 3, step: 999 });
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-22, -22, 44, 6); ctx.fillStyle = 'rgba(40,40,50,0.18)'; ctx.fillRect(-22, 16, 44, 6);
    shape([[-14, -14], [14, -14], [14, 14], [-14, 14]], { fill: '#dfe2e5', stroke: '#4a4642', lw: 2.2, step: 999 });
    circ(0, 0, 6, { fill: null, stroke: '#2e2a27', lw: 2.4 });
    for (const [bx, by] of [[-19, -19], [19, -19], [-19, 19], [19, 19]]) circ(bx, by, 2, { fill: '#6c6862', stroke: null }); ctx.restore(); }
  function cls(t) { const T = T_(); return t === T.STEEL || t === T.WALL || t === T.SPIKE ? 'S' : t === T.SAND ? 'D' : 'O'; }

  // ================= storybook paper look (reference: coloured-pencil diorama on a sketched landscape)
  const BRN = '#26201b'; // warm dark-brown ink for terrain outlines
  // tileable coloured-pencil textures, made once
  function crayonTex(base, strokes, size = 384, dots = null) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, size, size); g.lineCap = 'round';
    let sd = 7 + strokes.length * 13; const R = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const put = (x, y, an, l, col, lw, a) => { g.strokeStyle = col; g.lineWidth = lw; g.globalAlpha = a;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(an) * l * 0.5 + (R() - 0.5) * 2, y + oy + Math.sin(an) * l * 0.5 + (R() - 0.5) * 2, x + ox + Math.cos(an) * l, y + oy + Math.sin(an) * l); g.stroke(); } };
    for (const [col, n, len, lw, ang, a] of strokes) {
      // clustered patches: each patch has its own direction, like a hand shading small areas at a time
      const patches = Math.max(6, Math.round(n / 14));
      for (let p = 0; p < patches; p++) { const cx = R() * size, cy = R() * size, pr = 14 + R() * 34, pa = ang + (R() - 0.5) * 2.2, dens = 6 + Math.round(R() * 16);
        for (let i = 0; i < dens; i++) { const r = Math.sqrt(R()) * pr, t = R() * 6.283; put(cx + Math.cos(t) * r, cy + Math.sin(t) * r, pa + (R() - 0.5) * 0.35, len * (0.5 + R() * 0.9), col, lw * (0.7 + R() * 0.6), a * (0.5 + R() * 0.6)); } }
      // plus a light scatter of loose strokes in any direction
      for (let i = 0; i < n * 0.25; i++) put(R() * size, R() * size, R() * 6.283, len * (0.4 + R() * 0.6), col, lw * 0.8, a * 0.5);
    }
    if (dots) for (const [col, n, r] of dots) { g.fillStyle = col; for (let i = 0; i < n; i++) { const x = R() * size, y = R() * size, rr = r * (0.5 + R()); g.globalAlpha = 0.4 + R() * 0.5; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); } }
    g.globalAlpha = 1; return c; }
  const TEX = {
    sand: crayonTex('#f1c757', [['#f8dc85', 260, 14, 3, -0.7, 0.55], ['#dca63a', 200, 10, 2, -0.7, 0.45], ['#fff0b8', 90, 8, 2, 0.6, 0.4]], 256, [['#c98f2e', 60, 1.4]]),
    card: crayonTex('#e2bf84', [['#f0d39c', 260, 9, 2.4, -0.7, 0.55], ['#c39a5c', 230, 6, 2, 0.6, 0.45], ['#f8e6c0', 70, 6, 2, -0.7, 0.4]], 256, [['#a27a48', 120, 1.2]]),
    wood: crayonTex('#b8773c', [['#d39557', 160, 40, 2.5, 0.03, 0.55], ['#8a5426', 140, 46, 2, 0.0, 0.5], ['#e2ad6c', 60, 30, 1.5, 0.02, 0.4]], 256),
    dirt: crayonTex('#a5683a', [['#c08050', 220, 12, 3, 0.5, 0.5], ['#7d4a26', 220, 9, 2.5, -0.6, 0.5], ['#d29a64', 70, 8, 2, 1.0, 0.35]], 256, [['#6e3f1f', 80, 1.6]]),
    water: crayonTex('#4aa6ee', [['#7fc8ff', 300, 16, 3, 0.05, 0.55], ['#2f86e0', 220, 14, 2.5, -0.1, 0.5], ['#bfe6ff', 90, 10, 2, 0.1, 0.45]], 384),
    cave: crayonTex('#f7e6b8', [['#fbf0cf', 160, 12, 3, -0.7, 0.5], ['#e9cf8e', 110, 9, 2, -0.7, 0.35]], 256),
  };
  const PAT = {}; for (const k in TEX) PAT[k] = ctx.createPattern(TEX[k], 'repeat');
  const ART_SRC = window.AQ_DATA.ART_SRC;
  let land = null;
  // ================= YOUR ARTWORK: background + sprites cut directly from the asset sheet you sent
  const ART = (() => { const o = { ready: false, img: {}, man: [] }; let n = 0, total = 0;
    const load = src => { total++; const im = new Image(); im.onload = im.onerror = () => { if (++n === total) { o.ready = true; land = null; if (L) L.dirty = true; } }; im.src = src; return im; };
    for (const k of ['bg', 'metal', 'orb', 'gate', 'plank', 'plant', 'grass', 'sand', 'beige', 'dirt', 'crate', 'lever', 'post', 'spikes']) o.img[k] = load(ART_SRC[k]);
    o.man = ART_SRC.man.map(load); return o; })();
  function artPatterns() { if (!ART.ready || PAT._art) return;
    const mk = (img, sc) => { const p = ctx.createPattern(img, 'repeat'); if (p.setTransform) p.setTransform(new DOMMatrix().scale(sc)); return p; };
    PAT.sand = mk(ART.img.sand, 0.7); PAT.card = mk(ART.img.beige, 0.7); PAT.dirt = mk(ART.img.dirt, 0.75); PAT._art = true; }
  function plank3(g, x0, x1, yc, h) { const im = ART.img.plank, iw = im.width, ih = im.height, k = h / ih, cap = 34, y = yc - h / 2;
    const L0 = cap * k, R0 = cap * k;
    if (x1 - x0 <= L0 + R0) { g.drawImage(im, 0, 0, iw, ih, x0, y, x1 - x0, h); return; }
    g.drawImage(im, 0, 0, cap, ih, x0, y, L0, h); g.drawImage(im, iw - cap, 0, cap, ih, x1 - R0, y, R0, h);
    const mid = iw - 2 * cap, midW = mid * k; for (let x = x0 + L0; x < x1 - R0; x += midW) { const w = Math.min(midW, x1 - R0 - x); g.drawImage(im, cap, 0, mid * (w / midW), ih, x, y, w, h); } }
  function grassRun(g, x0, x1, ytop) { const im = ART.img.grass, h = 30, w = im.width * h / im.height; g.save(); g.beginPath(); g.rect(x0 - 2, ytop - 40, x1 - x0 + 4, 60); g.clip();
    let x = x0 - ((x0 * 0.37) % (w * 0.5)); while (x < x1) { g.drawImage(im, x, ytop - h + 9, w, h); x += w - 6; } g.restore(); }

  // paper grain
  const grain = (() => { const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d'); const id = g.createImageData(160, 160);
    for (let i = 0; i < id.data.length; i += 4) { const v = 110 + Math.random() * 70; id.data[i] = v; id.data[i + 1] = v * 0.95; id.data[i + 2] = v * 0.85; id.data[i + 3] = Math.random() < 0.55 ? 12 : 0; }
    g.putImageData(id, 0, 0); return ctx.createPattern(c, 'repeat'); })();

  // ---- pencil-sketched countryside behind the board (cached per screen size)
  function buildLandscape() {
    const w = Math.round(W * 1.25 * dpr), h = Math.round(H * dpr);
    if (land && land.width === w && land.height === h) return; land = document.createElement('canvas'); land.width = w; land.height = h;
    const g = land.getContext('2d'); g.scale(dpr, dpr); const LW = W * 1.25, LH = H;
    if (ART.ready && ART.img.bg.naturalWidth) { const im = ART.img.bg, ar = im.naturalWidth / im.naturalHeight;
      g.fillStyle = '#ebe3d6'; g.fillRect(0, 0, LW, LH);
      const dh = Math.max(LW / ar, LH * 0.6), dw = dh * ar, dx = (LW - dw) / 2, dy = LH - dh;
      g.imageSmoothingQuality = 'high'; g.drawImage(im, dx, dy, dw, dh);
      const fade = g.createLinearGradient(0, dy, 0, dy + dh * 0.12); fade.addColorStop(0, '#ebe3d6'); fade.addColorStop(1, 'rgba(235,227,214,0)'); g.fillStyle = fade; g.fillRect(0, dy - 1, LW, dh * 0.12 + 1);
      if (dx > 0) { g.fillStyle = '#ebe3d6'; g.fillRect(0, dy, dx + 1, dh); g.fillRect(dx + dw - 1, dy, dx + 1, dh); }
      g.fillStyle = grain; g.fillRect(0, 0, LW, LH); return; }
    let sd = 11; const R = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    g.fillStyle = '#f1eadb'; g.fillRect(0, 0, LW, LH);
    const pen = (a = 0.5, lw = 1.5) => { g.strokeStyle = `rgba(60,58,55,${Math.min(0.85, a * 1.35)})`; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; };
    const sketch = (pts, a = 0.5, passes = 2) => { for (let p = 0; p < passes; p++) { pen(a * (p ? 0.6 : 1), p ? 1.1 : 1.6); g.beginPath(); pts.forEach(([x, y], i) => { const jx = x + (R() - 0.5) * 1.6, jy = y + (R() - 0.5) * 1.6; i ? g.lineTo(jx, jy) : g.moveTo(jx, jy); }); g.stroke(); } };
    const hatch = (x, y, w2, h2, a = 0.18) => { pen(a, 1); for (let i = 0; i < w2 / 5; i++) { const xx = x + i * 5 + R() * 2; g.beginPath(); g.moveTo(xx, y + h2); g.lineTo(xx + h2 * 0.5, y); g.stroke(); } };
    const S = Math.min(LW, LH * 1.6) / 900; // scale of drawn props
    // sun + clouds
    const sx = LW * 0.68, sy = LH * 0.16; g.beginPath(); pen(0.45); g.arc(sx, sy, 26 * S, 0, 7); g.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; sketch([[sx + Math.cos(a) * 36 * S, sy + Math.sin(a) * 36 * S], [sx + Math.cos(a) * 52 * S, sy + Math.sin(a) * 52 * S]], 0.4, 1); }
    for (const [cx, cy, cw] of [[0.22, 0.14, 120], [0.5, 0.1, 90], [0.88, 0.2, 110]]) { const x0 = LW * cx, y0 = LH * cy, ww = cw * S; const pts = []; for (let i = 0; i <= 18; i++) { const q = i / 18; pts.push([x0 + q * ww, y0 - Math.abs(Math.sin(q * Math.PI * 3)) * 14 * S - Math.sin(q * Math.PI) * 10 * S]); } sketch(pts, 0.35); sketch([[x0, y0], [x0 + ww, y0]], 0.25, 1); }
    // rolling hills (three ridges), each with soft hatching underneath
    const ridge = (base, amp, f, ph, a) => { const pts = []; for (let x = 0; x <= LW; x += 20) pts.push([x, LH * base - Math.sin(x * f + ph) * amp * S - Math.sin(x * f * 2.3 + ph) * amp * 0.3 * S]); sketch(pts, a);
      pen(a * 0.35, 1); for (let x = 0; x < LW; x += 7) { const y = LH * base - Math.sin(x * f + ph) * amp * S - Math.sin(x * f * 2.3 + ph) * amp * 0.3 * S; g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x - 8, y + 14 + R() * 10); g.stroke(); } };
    { const base = LH * 0.36; const peaks = [[0.18, 0.13], [0.3, 0.09], [0.44, 0.15], [0.58, 0.11], [0.8, 0.14]];
      for (const [px, ph] of peaks) { const x = LW * px, w2 = LW * 0.09, y = base - LH * ph; sketch([[x - w2, base], [x - w2 * 0.3, y + LH * 0.03], [x, y], [x + w2 * 0.4, y + LH * 0.04], [x + w2, base]], 0.4);
        pen(0.14, 1); for (let i = 0; i < 14; i++) { const q = i / 14, xx = x + w2 * q * 0.9, yy = y + (base - y) * q; g.beginPath(); g.moveTo(xx, yy + 4); g.lineTo(xx - 10, yy + 18); g.stroke(); } }
      for (let i = 0; i < 5; i++) { const bx = LW * (0.6 + R() * 0.15), by = LH * (0.08 + R() * 0.1), bw = 6 + R() * 4; sketch([[bx - bw, by], [bx - bw * 0.4, by - 3], [bx, by + 1], [bx + bw * 0.4, by - 3], [bx + bw, by]], 0.45, 1); } }
    ridge(0.36, 40, 0.004, 1, 0.35); ridge(0.46, 30, 0.006, 3, 0.4); ridge(0.6, 22, 0.008, 5, 0.45);
    // trees, pines, a house, a windmill, a fence
    const tree = (x, y, s) => { sketch([[x, y], [x + 1, y - 40 * s]], 0.55); { const cpts = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * 6.283, r = (1 + 0.16 * Math.sin(a * 7 + x)) ; cpts.push([x + Math.cos(a) * 24 * s * r, y - 56 * s + Math.sin(a) * 19 * s * r]); } sketch(cpts, 0.5); } for (let i = 0; i < 0; i++) { const a = i / 9 * 6.28; g.beginPath(); pen(0.45, 1.4); g.arc(x + Math.cos(a) * 14 * s, y - 55 * s + Math.sin(a) * 12 * s, 11 * s, 0, 7); g.stroke(); } hatch(x - 18 * s, y - 50 * s, 34 * s, 22 * s, 0.12); };
    const pine = (x, y, s) => { sketch([[x, y], [x, y - 12 * s]], 0.5); for (let k = 0; k < 3; k++) { const yy = y - 12 * s - k * 16 * s, ww = (22 - k * 5) * s; sketch([[x - ww, yy], [x, yy - 26 * s], [x + ww, yy], [x - ww, yy]], 0.5); } hatch(x - 8 * s, y - 50 * s, 12 * s, 36 * s, 0.14); };
    const house = (x, y, s) => { sketch([[x, y], [x, y - 34 * s], [x + 50 * s, y - 34 * s], [x + 50 * s, y], [x, y]], 0.55); sketch([[x - 6 * s, y - 34 * s], [x + 25 * s, y - 56 * s], [x + 56 * s, y - 34 * s]], 0.55);
      sketch([[x + 8 * s, y - 24 * s], [x + 18 * s, y - 24 * s], [x + 18 * s, y - 14 * s], [x + 8 * s, y - 14 * s], [x + 8 * s, y - 24 * s]], 0.4, 1); sketch([[x + 30 * s, y], [x + 30 * s, y - 18 * s], [x + 40 * s, y - 18 * s], [x + 40 * s, y]], 0.4, 1); hatch(x, y - 52 * s, 50 * s, 16 * s, 0.14); };
    const mill = (x, y, s) => { sketch([[x - 14 * s, y], [x - 8 * s, y - 70 * s], [x + 8 * s, y - 70 * s], [x + 14 * s, y], [x - 14 * s, y]], 0.55); const cy = y - 72 * s;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.5; sketch([[x, cy], [x + Math.cos(a) * 46 * s, cy + Math.sin(a) * 46 * s]], 0.55); const px = x + Math.cos(a) * 30 * s, py = cy + Math.sin(a) * 30 * s, nx = -Math.sin(a) * 8 * s, ny = Math.cos(a) * 8 * s; sketch([[px, py], [px + nx, py + ny], [px + nx + Math.cos(a) * 16 * s, py + ny + Math.sin(a) * 16 * s]], 0.4, 1); } };
    const fence = (x0, x1, y, s) => { for (let x = x0; x <= x1; x += 46 * s) sketch([[x, y], [x, y - 30 * s]], 0.5); sketch([[x0, y - 22 * s], [x1, y - 24 * s]], 0.45); sketch([[x0, y - 11 * s], [x1, y - 12 * s]], 0.45); };
    for (let i = 0; i < 9; i++) { const x = R() * LW, y = LH * (0.38 + R() * 0.1); (R() < 0.5 ? pine : tree)(x, y, (0.55 + R() * 0.3) * S); }
    house(LW * 0.56, LH * 0.47, 0.9 * S); house(LW * 0.74, LH * 0.45, 0.7 * S); mill(LW * 0.9, LH * 0.47, 1.0 * S);
    for (let i = 0; i < 6; i++) { const x = R() * LW, y = LH * (0.55 + R() * 0.12); (R() < 0.5 ? pine : tree)(x, y, (0.8 + R() * 0.4) * S); }
    fence(LW * 0.02, LW * 0.4, LH * 0.62, 1.1 * S); fence(LW * 0.62, LW * 0.98, LH * 0.7, 1.1 * S);
    // a big foreground tree on the left edge and grass scribbles at the bottom
    sketch([[LW * 0.03, LH], [LW * 0.05, LH * 0.45], [LW * 0.02, LH * 0.2]], 0.5); sketch([[LW * 0.06, LH], [LW * 0.07, LH * 0.5], [LW * 0.12, LH * 0.25]], 0.5);
    { const cx0 = LW * 0.09, cy0 = LH * 0.16, cpts = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * 6.283, r = 1 + 0.14 * Math.sin(a * 9); cpts.push([cx0 + Math.cos(a) * 90 * S * r, cy0 + Math.sin(a) * 60 * S * r]); } sketch(cpts, 0.45);
      pen(0.14, 1); for (let i = 0; i < 40; i++) { const xx = cx0 - 70 * S + R() * 140 * S, yy = cy0 - 30 * S + R() * 60 * S; g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + 8, yy + 10); g.stroke(); } }
    pen(0.3, 1.2); for (let i = 0; i < 260; i++) { const x = R() * LW, y = LH * (0.75 + R() * 0.25); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - 8, x + (R() - 0.5) * 8, y - 14 - R() * 10); g.stroke(); }
    g.fillStyle = grain; g.fillRect(0, 0, LW, LH);
  }

  const M = 5; // cache margin in cells (room for the dirt base, shadows and grass)
  const CP = 72; // cache pixels per cell
  function buildTerrain() {
    artPatterns();
    const e = L.e, T = T_(), W_ = e.w, H_ = e.h; const cw = (W_ + 2 * M) * CP, ch = (H_ + 2 * M) * CP;
    if (!L.terr || L.terr.width !== cw || L.terr.height !== ch) { L.terr = document.createElement('canvas'); L.terr.width = cw; L.terr.height = ch; }
    const g = L.terr.getContext('2d'); const save = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
    g.setTransform(CP / C, 0, 0, CP / C, CP * (M + 0.5), CP * (M + 0.5));
    const cell = (x, y) => [x * C - C / 2, y * C - C / 2];
    const hash = (x, y, k) => { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
    const left = -C / 2, right = (W_ - 0.5) * C, top = -C / 2, bot = (H_ - 0.5) * C;
    let sd = 3; const R = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    // ---- underground cutaway: a deep, tapered chunk of brown soil with a darker tunnel band and rocks
    const depth = C * 3.1;
    { const pts = [[left - 8, bot - 30]];
      for (let x = left - 8; x <= right + 8; x += 36) { const q = (x - left) / (right - left); const taper = Math.pow(Math.abs(q - 0.5) * 2, 2.4) * depth * 0.55;
        pts.push([x, bot + depth - taper + Math.sin(x * 0.03) * 12 + (R() - 0.5) * 18]); }
      pts.push([right + 8, bot - 30]);
      g.save(); g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = 'rgba(70,45,20,0.16)'; g.translate(6, 8); g.fill(); g.restore();
      g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = PAT.dirt; g.fill();
      // darker tunnel band carved through the soil
      g.save(); g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.clip();
      const tx0 = left + (right - left) * 0.18, tx1 = right - (right - left) * 0.12, ty0 = bot + C * 0.75, ty1 = bot + C * 1.75;
      g.fillStyle = 'rgba(70,38,16,0.45)'; g.beginPath(); g.moveTo(tx0, ty0 + 20); g.quadraticCurveTo(tx0, ty0, tx0 + 30, ty0); g.lineTo(tx1 - 30, ty0); g.quadraticCurveTo(tx1, ty0, tx1, ty0 + 20); g.lineTo(tx1, ty1); g.lineTo(tx0, ty1); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,22,10,0.55)'; g.lineWidth = 2.5; g.stroke();
      // graphite shading strokes in the soil
      g.strokeStyle = 'rgba(50,30,15,0.22)'; g.lineWidth = 1.4; for (let i = 0; i < (right - left) / 6; i++) { const x = left + R() * (right - left), y = bot + 10 + R() * depth; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 7, y + 10); g.stroke(); }
      g.restore();
      ctx = g; boil = 0; shape(pts, { fill: null, stroke: BRN, lw: 3.4, step: 20, wob: 1.2 }); ctx = save;
      for (let i = 0; i < Math.max(4, W_ / 2.5); i++) { const rx = left + 50 + R() * (right - left - 100), ry = bot + 30 + R() * depth * 0.55, rr = 10 + R() * 14;
        g.fillStyle = '#b9b2a4'; g.beginPath(); g.ellipse(rx, ry, rr * 1.3, rr, R(), 0, 7); g.fill(); g.strokeStyle = BRN; g.lineWidth = 2.4; g.stroke();
        g.strokeStyle = 'rgba(60,55,50,0.35)'; g.lineWidth = 1.2; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(rx - rr * 0.6 + k * rr * 0.35, ry + rr * 0.6); g.lineTo(rx - rr * 0.3 + k * rr * 0.35, ry - rr * 0.1); g.stroke(); } } }


    // ---- arena shell: raised grass-topped ledges, a wooden bridge, a water trough feeding the waterfall.
    // Pure scenery around the outside of the playfield, so the board reads like the reference diorama
    // without touching any playable cell.
    { const U = C, X = v => (v - 0.5) * U, Y = v => (v - 0.5) * U; // cell-edge helpers
      const block = (x0, y0, x1, y1, pat, grassTop = true) => { const pts = [[x0, y1], [x0, y0 + 6], [x0 + 6, y0], [x1 - 6, y0], [x1, y0 + 6], [x1, y1]];
        g.save(); g.beginPath(); pts.forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); g.closePath(); g.fillStyle = 'rgba(70,45,20,0.18)'; g.translate(5, 6); g.fill(); g.restore();
        g.beginPath(); pts.forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); g.closePath(); g.fillStyle = pat; g.fill();
        g.fillStyle = 'rgba(255,248,220,0.3)'; g.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, 4);
        ctx = g; boil = 0; line(pts, { lw: 3.4, stroke: BRN, step: 16, wob: 1.0 }); ctx = save;
        if (grassTop && ART.ready) { grassRun(g, x0, x1, y0); } else if (grassTop) { for (let bx = x0 + 3; bx < x1 - 2; bx += 6) { const h = 7 + R() * 10, lean = (R() - 0.5) * 8; g.beginPath(); g.moveTo(bx - 2.5, y0 + 3); g.quadraticCurveTo(bx + lean * 0.4, y0 - h * 0.5, bx + lean, y0 - h); g.quadraticCurveTo(bx + lean * 0.5, y0 - h * 0.4, bx + 2.5, y0 + 3); g.closePath(); g.fillStyle = R() < 0.35 ? '#4c962c' : '#6dbb3c'; g.fill(); g.strokeStyle = 'rgba(35,70,18,0.7)'; g.lineWidth = 1; g.stroke(); }
          g.fillStyle = '#5aa834'; g.fillRect(x0 + 1, y0 - 1, x1 - x0 - 2, 4); } };
      const leafy = (x, y, s = 1) => { for (let k = 0; k < 6; k++) { const an = -Math.PI / 2 + (k - 2.5) * 0.42, l = (24 + R() * 12) * s; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(an - 0.4) * l * 0.6, y + Math.sin(an - 0.4) * l * 0.6, x + Math.cos(an) * l, y + Math.sin(an) * l); g.quadraticCurveTo(x + Math.cos(an + 0.4) * l * 0.6, y + Math.sin(an + 0.4) * l * 0.6, x, y); g.fillStyle = k % 2 ? '#5fb13a' : '#3f8a26'; g.fill(); g.strokeStyle = 'rgba(30,60,15,0.8)'; g.lineWidth = 1.5; g.stroke(); } };
      const plank = (x0, x1, y, posts) => { g.fillStyle = PAT.wood; g.fillRect(x0, y, x1 - x0, 16); g.fillStyle = 'rgba(255,230,180,0.35)'; g.fillRect(x0, y + 2, x1 - x0, 3); g.strokeStyle = BRN; g.lineWidth = 3; g.strokeRect(x0, y, x1 - x0, 16);
        for (const px of posts) { g.fillStyle = PAT.wood; g.fillRect(px - 7, y + 16, 14, top - (y + 16)); g.strokeStyle = BRN; g.lineWidth = 2.6; g.strokeRect(px - 7, y + 16, 14, top - (y + 16)); g.fillStyle = '#9aa0a6'; g.beginPath(); g.arc(px, y + 8, 3.5, 0, 7); g.fill(); g.strokeStyle = BRN; g.lineWidth = 1.6; g.stroke(); } };
      const top = Y(0); // top edge of the board
      if (W_ >= 8) {
        // raised ledge, top-left
        block(X(0) - 6, Y(-1.15), X(2.6), top + 4, PAT.card); leafy(X(2.1), Y(-1.15) + 2, 0.9);
        // wooden bridge with posts in the middle
        const bx0 = X(3.2), bx1 = X(Math.min(W_ - 4, 7.4)); if (bx1 - bx0 > U * 1.5) plank(bx0, bx1, Y(-0.75), [bx0 + 14, bx1 - 14]);
        // little grassy mound between
        if (W_ > 12) { const mx0 = X(Math.min(W_ - 5, 8)), mx1 = mx0 + U * 1.6; block(mx0, Y(-0.6), mx1, top + 4, PAT.sand); leafy(mx0 + U * 0.8, Y(-0.6) + 2, 0.8); }
        // tall tower, top-right, with a water trough on top that spills into the waterfall
        const tx0 = X(W_ - 3), tx1 = X(W_) + 4, ty0 = Y(-1.25);
        block(tx0, ty0, tx1, top + 4, PAT.card, false);
        const wy0 = ty0 - 22; g.fillStyle = '#3f9cf0'; g.fillRect(tx0 + 14, wy0, tx1 - tx0 - 14, ty0 - wy0 + 6); g.strokeStyle = '#1d4f8c'; g.lineWidth = 2.4; g.strokeRect(tx0 + 14, wy0, tx1 - tx0 - 14, ty0 - wy0 + 6);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.4; for (let x = tx0 + 22; x < tx1 - 10; x += 22) { g.beginPath(); g.moveTo(x, wy0 + 7); g.quadraticCurveTo(x + 5, wy0 + 3, x + 11, wy0 + 7); g.stroke(); }
        block(tx0, wy0 - 4, tx0 + 16, ty0 + 2, PAT.card, true); // rim on the trough's left
        L.fallTop = wy0 + 4; L.lever = [tx0 + (tx1 - tx0) * 0.35, ty0];
      }
      // a small grassy ledge sticking out of the left wall
      if (H_ >= 6) block(X(0) - U * 0.75, Y(Math.floor(H_ / 2)), X(0) + 4, Y(Math.floor(H_ / 2)) + U * 0.45, PAT.card);
      // plunge pool where the waterfall lands in the soil
      if (!(window.__LEVELSCENE && window.__LEVELSCENE.fall !== undefined)) { const px = X(W_) + U * 0.28, py = bot + U * 0.95; g.fillStyle = '#3f9cf0'; g.beginPath(); g.ellipse(px, py, U * 0.7, U * 0.22, 0, 0, 7); g.fill(); g.strokeStyle = '#1d4f8c'; g.lineWidth = 2.4; g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.ellipse(px, py - 2, U * 0.45, U * 0.1, 0, 3.4, 6.0); g.stroke(); L.fallBot = py; }
    }
    if (e.gate) for (let k = 1; k <= 2; k++) { const yy = e.gate.y - k; if (yy >= 0 && e.get(e.gate.x, yy) === T.EMPTY) { const X = e.gate.x * C, Y = yy * C; g.fillStyle = '#ffffff'; g.strokeStyle = '#1d4f8c'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(X - 6, Y - 14); g.lineTo(X + 6, Y - 14); g.lineTo(X + 6, Y + 2); g.lineTo(X + 13, Y + 2); g.lineTo(X, Y + 16); g.lineTo(X - 13, Y + 2); g.lineTo(X - 6, Y + 2); g.closePath(); g.fill(); g.stroke(); } }
    // ---- drop shadow of the whole diorama
    g.fillStyle = 'rgba(70,45,20,0.22)'; g.beginPath(); for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (cls(e.get(x, y)) !== 'O') { const [a, b] = cell(x, y); g.rect(a + 6, b + 8, C, C); } g.fill();
    // ---- open caves: warm cream carved space with a soft inner shadow under the ceiling
    g.fillStyle = PAT.water || '#5fb0f0'; g.beginPath(); for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (cls(e.get(x, y)) === 'O') { const [a, b] = cell(x, y); g.rect(a - 0.5, b - 0.5, C + 1, C + 1); } g.fill();
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (cls(e.get(x, y)) === 'O') { const [a, b] = cell(x, y);
      if (y > 0 && cls(e.get(x, y - 1)) !== 'O') { g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.moveTo(a, b + 7); for (let k = 0; k <= 8; k++) g.lineTo(a + k * 8, b + 7 + (k % 2 ? -4 : 2)); g.lineTo(a + C, b + 12); g.lineTo(a, b + 12); g.fill(); }
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2; g.lineCap = 'round'; for (let k = 0; k < 2; k++) { const yy = b + 24 + k * 18 + hash(x, y, k) * 8, xx = a + 8 + hash(x, y, k + 4) * 26; g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + 8, yy - 4, xx + 16, yy); g.quadraticCurveTo(xx + 22, yy + 3, xx + 28, yy); g.stroke(); } }
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (cls(e.get(x, y)) === 'O') { const [a, b] = cell(x, y);
      if (y > 0 && cls(e.get(x, y - 1)) !== 'O') { const gr = g.createLinearGradient(0, b, 0, b + 22); gr.addColorStop(0, 'rgba(20,60,120,0.25)'); gr.addColorStop(1, 'rgba(20,60,120,0)'); g.fillStyle = gr; g.fillRect(a, b, C, 22); }
      if (x > 0 && cls(e.get(x - 1, y)) !== 'O') { const gr = g.createLinearGradient(a, 0, a + 14, 0); gr.addColorStop(0, 'rgba(20,60,120,0.15)'); gr.addColorStop(1, 'rgba(20,60,120,0)'); g.fillStyle = gr; g.fillRect(a, b, 14, C); } }
    // ---- materials
    const fillType = (pred, pat) => { g.fillStyle = pat; g.beginPath(); for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (pred(e.get(x, y))) { const [a, b] = cell(x, y); g.rect(a - 0.6, b - 0.6, C + 1.2, C + 1.2); } g.fill(); };
    fillType(t => t === T.SAND, PAT.sand); fillType(t => t === T.STEEL, PAT.card);
    if (ART.ready) { for (let y = 0; y < H_; y++) { let x = 0; while (x < W_) { if (e.get(x, y) !== T.WALL) { x++; continue; } const s0 = x; while (x < W_ && e.get(x, y) === T.WALL) x++;
        plank3(g, s0 * C - C / 2, x * C - C / 2, y * C, C * 0.78); } } }
    if (ART.ready) { const po = ART.img.post;
      for (let y = 0; y < H_ - 1; y++) { let x = 0; while (x < W_) { if (e.get(x, y) !== T.WALL) { x++; continue; } const s0 = x; while (x < W_ && e.get(x, y) === T.WALL) x++;
        for (const px of (x - s0 >= 2 ? [s0, x - 1] : [s0])) { const below = e.get(px, y + 1); if (below === T.SAND || below === T.STEEL) g.drawImage(po, px * C - 9, y * C + C * 0.3, 18, C * 0.95); } } }
      for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (e.get(x, y) === T.SPIKE) { const [a, b] = cell(x, y); g.fillStyle = PAT.card; g.fillRect(a, b, C, C);
        const sp = ART.img.spikes; for (const [nx, rot] of [[-1, -Math.PI / 2], [1, Math.PI / 2]]) if (cls(e.get(x + nx, y)) === 'O') { g.save(); g.translate(x * C + nx * C * 0.5, y * C); g.rotate(rot); g.drawImage(sp, -C / 2, -26, C, 26); g.restore(); } } }
    // inner walls become bolted wooden beams
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (!ART.ready && e.get(x, y) === T.WALL) { const [a, b] = cell(x, y);
      g.fillStyle = PAT.wood; g.fillRect(a, b + 6, C, C - 12); g.fillStyle = 'rgba(255,230,180,0.35)'; g.fillRect(a, b + 8, C, 5); g.fillStyle = 'rgba(60,30,10,0.25)'; g.fillRect(a, b + C - 14, C, 6);
      // one continuous plank: draw top/bottom edges always, end caps + bolts only where the beam ends
      const wl = x > 0 && e.get(x - 1, y) === T.WALL, wr = x < W_ - 1 && e.get(x + 1, y) === T.WALL;
      g.strokeStyle = BRN; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(a, b + 6); g.lineTo(a + C, b + 6); g.moveTo(a, b + C - 6); g.lineTo(a + C, b + C - 6);
      if (!wl) { g.moveTo(a + 1, b + 6); g.lineTo(a + 1, b + C - 6); } if (!wr) { g.moveTo(a + C - 1, b + 6); g.lineTo(a + C - 1, b + C - 6); } g.stroke();
      if (wl) { g.strokeStyle = 'rgba(50,25,8,0.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(a, b + 8); g.lineTo(a, b + C - 8); g.stroke(); }
      const bolts = []; if (!wl) bolts.push(a + 10); if (!wr) bolts.push(a + C - 10); if (wl && wr && x % 3 === 0) bolts.push(a + C / 2);
      for (const bx of bolts) { g.fillStyle = '#9aa0a6'; g.beginPath(); g.arc(bx, b + C / 2, 4.2, 0, 7); g.fill(); g.strokeStyle = BRN; g.lineWidth = 1.8; g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(bx - 1.2, b + C / 2 - 1.2, 1.2, 0, 7); g.fill(); } }
    // soft bevel: light rim on top-left faces of solid blobs, darker on bottom-right
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) { const c0 = cls(e.get(x, y)); if (c0 === 'O' || e.get(x, y) === T.WALL) continue; const [a, b] = cell(x, y);
      const up = y > 0 ? cls(e.get(x, y - 1)) : 'X', dn = y < H_ - 1 ? cls(e.get(x, y + 1)) : 'X', lf = x > 0 ? cls(e.get(x - 1, y)) : 'X', rt = x < W_ - 1 ? cls(e.get(x + 1, y)) : 'X';
      g.fillStyle = 'rgba(255,248,220,0.3)'; if (up !== c0) g.fillRect(a, b, C, 4); if (lf !== c0) g.fillRect(a, b, 3, C);
      g.fillStyle = 'rgba(110,70,25,0.14)'; if (dn !== c0) g.fillRect(a, b + C - 4, C, 4); if (rt !== c0) g.fillRect(a + C - 4, b, 4, C); }
    // ---- ink contours (warm brown), drawn with the wobbly primitives
    ctx = g; const oldBoil = boil; boil = 0;
    const segs = [];
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) { const here = cls(e.get(x, y));
      const lf = x > 0 ? cls(e.get(x - 1, y)) : 'O'; if (here !== lf && (here !== 'O' || lf !== 'O')) segs.push([[x * C - C / 2, y * C - C / 2], [x * C - C / 2, y * C + C / 2]]);
      const up = y > 0 ? cls(e.get(x, y - 1)) : 'O'; if (here !== up && (here !== 'O' || up !== 'O')) segs.push([[x * C - C / 2, y * C - C / 2], [x * C + C / 2, y * C - C / 2]]);
      if (here !== 'O' && x === W_ - 1) segs.push([[x * C + C / 2, y * C - C / 2], [x * C + C / 2, y * C + C / 2]]);
      if (here !== 'O' && y === H_ - 1) segs.push([[x * C - C / 2, y * C + C / 2], [x * C + C / 2, y * C + C / 2]]); }
    for (const [p0, p1] of segs) line([p0, p1], { lw: 3.4, step: 16, wob: 1.0, stroke: BRN });
    if (ART.ready) { for (let y = 0; y < H_; y++) { let x = 0; while (x < W_) { const c0 = cls(e.get(x, y)), ab = y > 0 ? cls(e.get(x, y - 1)) : 'O'; if (c0 === 'O' || ab !== 'O') { x++; continue; } const s0 = x;
        while (x < W_ && cls(e.get(x, y)) !== 'O' && (y > 0 ? cls(e.get(x, y - 1)) : 'O') === 'O') x++; grassRun(g, s0 * C - C / 2, x * C - C / 2, y * C - C / 2); } }
      const pl = ART.img.plant; for (let x = 0; x < W_; x++) if (hash(x, 0, 50) < 0.22) g.drawImage(pl, x * C - 22, -C / 2 - 36, 44, 36); }
    else {
    // ---- grass tufts on every top surface that faces open water or sky
    const tuft = (x, y, s) => { const blades = 7; for (let i = 0; i < blades; i++) { const q = i / (blades - 1) - 0.5, h = (14 + R() * 12) * s * (1 - Math.abs(q) * 0.6), bx = x + q * 26 * s, tip = [bx + q * 16 * s + (R() - 0.5) * 6, y - h];
        g.beginPath(); g.moveTo(bx - 3 * s, y + 2); g.quadraticCurveTo(bx + (tip[0] - bx) * 0.4, y - h * 0.5, tip[0], tip[1]); g.quadraticCurveTo(bx + (tip[0] - bx) * 0.6, y - h * 0.4, bx + 3 * s, y + 2); g.closePath();
        g.fillStyle = i % 2 ? '#78c043' : '#4f9a2e'; g.fill(); g.strokeStyle = 'rgba(40,70,20,0.75)'; g.lineWidth = 1.2; g.stroke(); } };
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) { const c0 = cls(e.get(x, y)); if (c0 === 'O') continue; const above = y > 0 ? cls(e.get(x, y - 1)) : 'O';
      if (above === 'O') { const [a, b] = cell(x, y); for (let k = 0; k < 9; k++) { const bx = a + 3 + k * 7 + (hash(x, y, 60 + k) - 0.5) * 3, h = 7 + hash(x, y, 70 + k) * 9, lean = (hash(x, y, 80 + k) - 0.5) * 8;
          g.beginPath(); g.moveTo(bx - 2.5, b + 3); g.quadraticCurveTo(bx + lean * 0.4, b - h * 0.5, bx + lean, b - h); g.quadraticCurveTo(bx + lean * 0.5, b - h * 0.4, bx + 2.5, b + 3); g.closePath(); g.fillStyle = k % 3 ? '#6dbb3c' : '#4c962c'; g.fill(); g.strokeStyle = 'rgba(35,70,18,0.7)'; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = '#5aa834'; g.fillRect(a, b - 1, C, 4); }
      if (above === 'O' && hash(x, y, 40) < 0.3) { const [a, b] = cell(x, y); tuft(a + 18 + hash(x, y, 41) * 28, b + 3, 0.8 + hash(x, y, 42) * 0.5); if (hash(x, y, 43) < 0.35) tuft(a + 8 + hash(x, y, 44) * 46, b + 3, 0.6); } }
    // a broad leafy plant here and there on the outer rim
    for (let x = 0; x < W_; x += 1) if (hash(x, 0, 50) < 0.18) { const [a, b] = cell(x, 0); for (let k = 0; k < 5; k++) { const an = -Math.PI / 2 + (k - 2) * 0.45, l = 26 + R() * 10; g.beginPath(); g.moveTo(a + 32, b + 4); g.quadraticCurveTo(a + 32 + Math.cos(an - 0.4) * l * 0.6, b + 4 + Math.sin(an - 0.4) * l * 0.6, a + 32 + Math.cos(an) * l, b + 4 + Math.sin(an) * l); g.quadraticCurveTo(a + 32 + Math.cos(an + 0.4) * l * 0.6, b + 4 + Math.sin(an + 0.4) * l * 0.6, a + 32, b + 4); g.fillStyle = k % 2 ? '#5fb13a' : '#3f8a26'; g.fill(); g.strokeStyle = 'rgba(30,60,15,0.8)'; g.lineWidth = 1.5; g.stroke(); } }
    }
    { const g0 = g;
    // ---- the exit pipe (reference: blue pipe with grey clamps, bending through the tunnel, ending in a down arrow)
    if (e.gate) { const gx = e.gate.x * C, mid = (left + right) / 2, Ty = bot + C * 1.25, yb = bot + depth + 26;
      let xe = gx < mid ? Math.min(gx + 4 * C, right - 1.5 * C) : Math.max(gx - 4 * C, left + 1.5 * C); if (Math.abs(xe - gx) < C) xe = gx;
      const gy0 = (e.gate.y + 0.45) * C; const pts = xe === gx ? [[gx, gy0], [gx, yb]] : [[gx, gy0], [gx, Ty], [xe, Ty], [xe, yb]];
      const trace = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) g.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 44); g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
      g.lineCap = 'butt'; g.lineJoin = 'round';
      trace(); g.strokeStyle = BRN; g.lineWidth = 40; g.stroke();
      trace(); g.strokeStyle = '#2f86e6'; g.lineWidth = 33; g.stroke();
      trace(); g.strokeStyle = '#5db6f6'; g.lineWidth = 18; g.stroke();
      trace(); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.setLineDash([22, 14]); g.stroke(); g.setLineDash([]);
      // grey clamps along the straight runs
      const clamp = (x, y, vertical) => { g.save(); g.translate(x, y); if (!vertical) g.rotate(Math.PI / 2);
        g.fillStyle = '#7a7f86'; g.fillRect(-25, -8, 50, 16); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-25, -8, 50, 4); g.strokeStyle = BRN; g.lineWidth = 2.6; g.strokeRect(-25, -8, 50, 16);
        for (const bx of [-18, 18]) { g.fillStyle = '#3d3b39'; g.beginPath(); g.arc(bx, 0, 2.6, 0, 7); g.fill(); } g.restore(); };
      for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(len / 110));
        for (let k = 1; k <= n; k++) { const q = k / (n + 1); clamp(x0 + (x1 - x0) * q, y0 + (y1 - y0) * q, x0 === x1); } }
      // down-arrow end piece
      const [ax, ay] = pts[pts.length - 1]; g.beginPath(); g.moveTo(ax - 30, ay - 4); g.lineTo(ax + 30, ay - 4); g.lineTo(ax, ay + 34); g.closePath(); g.fillStyle = '#2f86e6'; g.fill(); g.strokeStyle = BRN; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.moveTo(ax - 12, ay + 2); g.lineTo(ax + 12, ay + 2); g.lineTo(ax, ay + 20); g.closePath(); g.fillStyle = '#ffffff'; g.fill();
      // paper tag
      const tx = ax + 46, ty = ay - 18; g.save(); g.translate(tx, ty); g.rotate(-0.03);
      g.fillStyle = 'rgba(70,45,20,0.18)'; g.beginPath(); g.moveTo(-10, 4); g.lineTo(2, -12); g.lineTo(156, -12); g.lineTo(156, 20); g.lineTo(2, 20); g.closePath(); g.fill();
      g.fillStyle = '#f7ecd2'; g.beginPath(); g.moveTo(-12, 0); g.lineTo(0, -16); g.lineTo(150, -16); g.lineTo(150, 16); g.lineTo(0, 16); g.closePath(); g.fill(); g.strokeStyle = BRN; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = '#2b211a'; g.font = '700 21px "Gochi Hand", "Patrick Hand", sans-serif'; g.textBaseline = 'middle'; g.fillText('To Next Level', 8, 1); g.restore();
      L.pipe = { pts }; }
    }
    // ---- masking-tape pieces holding the diorama on the page
    const tape = (x, y, r) => { g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = 'rgba(236,222,186,0.82)'; g.beginPath(); g.moveTo(-26, -9); for (let i = 0; i <= 6; i++) g.lineTo(-26 + i * 8.6, -9 + (i % 2 ? -1.5 : 1.5)); g.lineTo(26, 9); for (let i = 6; i >= 0; i--) g.lineTo(-26 + i * 8.6, 9 + (i % 2 ? 1.5 : -1.5)); g.closePath(); g.fill(); g.strokeStyle = 'rgba(150,120,70,0.35)'; g.lineWidth = 1; g.stroke(); g.restore(); };
    tape(left + 6, top + 40, -0.7); tape(right - 6, bot - 30, -0.6); tape(left + 10, bot - 10, 0.5); if (W_ > 10) tape((left + right) / 2, bot + 6, 0.08);
    ctx = save; boil = oldBoil; L.dirty = false;
  }
  // ================= INK STYLE (matches the menu): black wobbly ink on cream paper, flat accents, doodle charm
  const INK_MODE = true;
  function buildInk() {
    const e = L.e, T = T_(), W_ = e.w, H_ = e.h; const cw = (W_ + 2 * M) * CP, ch = (H_ + 2 * M) * CP;
    if (!L.terr || L.terr.width !== cw || L.terr.height !== ch) { L.terr = document.createElement('canvas'); L.terr.width = cw; L.terr.height = ch; }
    const g = L.terr.getContext('2d'); const save = ctx, oldBoil = boil;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
    g.setTransform(CP / C, 0, 0, CP / C, CP * (M + 0.5), CP * (M + 0.5));
    const cell = (x, y) => [x * C - C / 2, y * C - C / 2];
    const hash = (x, y, k) => { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
    ctx = g; boil = 0;
    // flat fills
    const fill = (pred, col) => { g.fillStyle = col; g.beginPath(); for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (pred(e.get(x, y))) { const [a, b] = cell(x, y); g.rect(a - 0.6, b - 0.6, C + 1.2, C + 1.2); } g.fill(); };
    fill(t => cls(t) === 'O', '#fffdf7'); fill(t => t === T.SAND, '#f9e6a2'); fill(t => t === T.STEEL || t === T.SPIKE, '#e3ded3'); fill(t => t === T.WALL, '#d6cfbf');
    // doodle textures, sparse and hand-placed
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) { const t = e.get(x, y), [a, b] = cell(x, y), h = k => hash(x, y, k);
      if (t === T.SAND) { // dots + little ticks like a pen tapping sand
        g.fillStyle = '#d8b65a'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(a + 10 + h(k) * 44, b + 10 + h(k + 5) * 44, 1.7, 0, 7); g.fill(); }
        if (h(9) < 0.35) line([[a + 16 + h(10) * 20, b + 30 + h(11) * 14], [a + 22 + h(10) * 20, b + 26 + h(11) * 14], [a + 28 + h(10) * 20, b + 30 + h(11) * 14]], { stroke: '#cba552', lw: 2, step: 999, wob: 0.4 }); }
      else if (t === T.STEEL) { // the odd crack and pebble
        if (h(20) < 0.1) line([[a + 14 + h(21) * 20, b + 14], [a + 22 + h(21) * 20, b + 26], [a + 16 + h(21) * 20, b + 34], [a + 26 + h(21) * 20, b + 46]], { stroke: '#8e887b', lw: 1.8, step: 999, wob: 0.5 });
        else if (h(22) < 0.18) circ(a + 16 + h(23) * 32, b + 16 + h(24) * 32, 4 + h(25) * 3, { fill: null, stroke: '#9a9487', lw: 1.8 }); }
      else if (t === T.WALL) { g.save(); g.beginPath(); g.rect(a, b, C, C); g.clip(); g.strokeStyle = 'rgba(27,27,31,0.28)'; g.lineWidth = 2; g.lineCap = 'round';
        for (let k = -1; k < 5; k++) { g.beginPath(); g.moveTo(a + k * 16, b + C); g.lineTo(a + k * 16 + C, b); g.stroke(); } g.restore(); }
      else if (cls(t) === 'O' && h(30) < 0.28) { // tiny water doodles in open cells
        const xx = a + 12 + h(31) * 26, yy = b + 18 + h(32) * 26; line([[xx, yy], [xx + 6, yy - 4], [xx + 12, yy], [xx + 18, yy - 4], [xx + 24, yy]], { stroke: '#8cc6f2', lw: 2.2, step: 999, wob: 0.3 }); } }
    // spikes: red doodle teeth on the sides that face water
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (e.get(x, y) === T.SPIKE) for (const nx of [-1, 1]) if (cls(e.get(x + nx, y)) === 'O') {
      const ex = x * C + nx * C / 2; for (let k = 0; k < 3; k++) { const yy = y * C - C / 2 + 6 + k * 18; shape([[ex, yy], [ex + nx * 16, yy + 9], [ex, yy + 18]], { fill: '#e8402e', lw: 2.4, step: 999, wob: 0.4 }); } }
    // sketchy double contour: a bold ink line plus a lighter pencil echo slightly off
    const segs = [];
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) { const here = cls(e.get(x, y));
      const lf = x > 0 ? cls(e.get(x - 1, y)) : 'O'; if (here !== lf && (here !== 'O' || lf !== 'O')) segs.push([[x * C - C / 2, y * C - C / 2], [x * C - C / 2, y * C + C / 2]]);
      const up = y > 0 ? cls(e.get(x, y - 1)) : 'O'; if (here !== up && (here !== 'O' || up !== 'O')) segs.push([[x * C - C / 2, y * C - C / 2], [x * C + C / 2, y * C - C / 2]]);
      if (here !== 'O' && x === W_ - 1) segs.push([[x * C + C / 2, y * C - C / 2], [x * C + C / 2, y * C + C / 2]]);
      if (here !== 'O' && y === H_ - 1) segs.push([[x * C - C / 2, y * C + C / 2], [x * C + C / 2, y * C + C / 2]]); }
    g.save(); g.translate(2.5, 2.5); for (const [p0, p1] of segs) line([p0, p1], { lw: 1.4, step: 16, wob: 1.4, stroke: INK, alpha: 0.35 }); g.restore();
    for (const [p0, p1] of segs) line([p0, p1], { lw: 3.2, step: 16, wob: 1.1, stroke: INK });
    // little green sprigs where sand or stone meets open water from above
    for (let y = 1; y < H_; y++) for (let x = 0; x < W_; x++) { const t = e.get(x, y); if (cls(t) === 'O' || cls(e.get(x, y - 1)) !== 'O' || hash(x, y, 40) > 0.45) continue; const [a, b] = cell(x, y), bx = a + 14 + hash(x, y, 41) * 34;
      for (let k = -1; k <= 1; k++) line([[bx + k * 5, b + 1], [bx + k * 7 + Math.sin(k) * 3, b - 12 - (k ? 0 : 6)]], { stroke: k ? '#5cc46f' : '#3aa655', lw: 2.6, step: 999, wob: 0.3 }); }
    // doodle critters tucked into the stone frame: starfish and shells
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) { if (e.get(x, y) !== T.STEEL || (x > 0 && x < W_ - 1 && y > 0 && y < H_ - 1) || hash(x, y, 50) > 0.12) continue; const [a, b] = cell(x, y), cx = a + C / 2, cy = b + C / 2;
      if (hash(x, y, 51) < 0.5) { const pts = []; for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 6 : 15; pts.push([cx + Math.cos(an) * r, cy + Math.sin(an) * r]); } shape(pts, { fill: '#ffb36b', lw: 2.2, step: 999, wob: 0.4 }); circ(cx, cy, 1.6, { fill: INK, stroke: null }); }
      else { shape([[cx - 12, cy + 8], [cx, cy - 12], [cx + 12, cy + 8]], { fill: '#ffd6e0', lw: 2.2, step: 999, wob: 0.4 }); for (const dx of [-5, 0, 5]) line([[cx, cy - 10], [cx + dx, cy + 7]], { lw: 1.4, step: 999, wob: 0.2 }); } }
    // wooden posts under bridges, as simple ink sticks
    for (let y = 0; y < H_ - 1; y++) { let x = 0; while (x < W_) { if (e.get(x, y) !== T.WALL) { x++; continue; } const s0 = x; while (x < W_ && e.get(x, y) === T.WALL) x++;
      for (const px of (x - s0 >= 2 ? [s0, x - 1] : [])) if (e.get(px, y + 1) === T.SAND) { const X = px * C; shape([[X - 5, y * C + C / 2], [X + 5, y * C + C / 2], [X + 5, y * C + C * 1.3], [X - 5, y * C + C * 1.3]], { fill: '#c98d4e', lw: 2.2, step: 999, wob: 0.4 }); } } }
    // dashed doodle arrows down the shaft above the gate
    if (e.gate) for (let k = 1; k <= 2; k++) { const yy = e.gate.y - k; if (yy >= 0 && e.get(e.gate.x, yy) === T.EMPTY) { const X = e.gate.x * C, Y = yy * C; line([[X, Y - 14], [X, Y + 10]], { lw: 3, step: 999, wob: 0.3, stroke: BLUE }); shape([[X - 8, Y + 4], [X, Y + 16], [X + 8, Y + 4]], { fill: BLUE, lw: 2, step: 999, wob: 0.3, stroke: BLUE }); } }
    ctx = save; boil = oldBoil; L.dirty = false;
  }
  function inkBackground(t) { // the menu's paper, with a few slow doodles drifting in the margins
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = 'rgba(140,195,240,0.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const yy = H * (0.18 + i * 0.22), off = (t * 10 + i * 70) % 160; ctx.beginPath(); for (let xx = -160 + off; xx < W + 20; xx += 160) { ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + 18, yy - 6, xx + 36, yy); ctx.quadraticCurveTo(xx + 54, yy + 6, xx + 72, yy); } ctx.stroke(); } ctx.restore();
    const sx = 1 / Math.max(1, W), u = Math.min(W, H) / 700;
    ctx.save(); ctx.scale(u, u); const VW = W / u, VH = H / u;
    fish(((t * 22) % (VW + 200)) - 100, VH * 0.52, 1, t, 0.9); fish(VW + 100 - ((t * 15 + 300) % (VW + 200)), VH * 0.9, -1, t, 0.7);
    for (let i = 0; i < 6; i++) { const bx = (i * 173) % VW, by = VH - ((t * (18 + i * 4) + i * 120) % (VH + 40)); circ(bx + Math.sin(t + i) * 6, by, 4 + (i % 3) * 2, { stroke: BLUE, lw: 2, fill: null, alpha: 0.6 }); }
    ctx.restore(); ctx.fillStyle = grain; ctx.fillRect(0, 0, W, H); }
  // ================= NOTEBOOK DOODLE: lined paper, bold marker shapes, clean ink, soft shading
  const NB = { ink: '#2b2420', sand: '#f5c75f', sandDk: '#d99a3c', sandHi: '#fbe3a0', stone: '#5d6aa0', stoneDk: '#46518a', stoneHi: '#8692c8', water: '#d4f2f4', waterDk: '#a6dde4', wood: '#c98955', woodDk: '#9b6235', grass: '#7cc46a', grassDk: '#4f9a45' };
  function roundedCells(g, cells, same, r) { // union of cells with rounded outer corners
    g.beginPath();
    for (const [x, y] of cells) { const a = x * C - C / 2, b = y * C - C / 2, u = same(x, y - 1), d = same(x, y + 1), l = same(x - 1, y), rt = same(x + 1, y);
      const tl = !u && !l ? r : 0, tr = !u && !rt ? r : 0, br = !d && !rt ? r : 0, bl = !d && !l ? r : 0, e = 0.6;
      g.moveTo(a - e + tl, b - e); g.lineTo(a + C + e - tr, b - e); tr ? g.arcTo(a + C + e, b - e, a + C + e, b - e + tr, tr) : g.lineTo(a + C + e, b - e);
      g.lineTo(a + C + e, b + C + e - br); br ? g.arcTo(a + C + e, b + C + e, a + C + e - br, b + C + e, br) : g.lineTo(a + C + e, b + C + e);
      g.lineTo(a - e + bl, b + C + e); bl ? g.arcTo(a - e, b + C + e, a - e, b + C + e - bl, bl) : g.lineTo(a - e, b + C + e);
      g.lineTo(a - e, b - e + tl); tl ? g.arcTo(a - e, b - e, a - e + tl, b - e, tl) : g.lineTo(a - e, b - e); g.closePath(); } }
  function buildNotebook() {
    const e = L.e, T = T_(), W_ = e.w, H_ = e.h; const cw = (W_ + 2 * M) * CP, ch = (H_ + 2 * M) * CP;
    if (!L.terr || L.terr.width !== cw || L.terr.height !== ch) { L.terr = document.createElement('canvas'); L.terr.width = cw; L.terr.height = ch; }
    const g = L.terr.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
    g.setTransform(CP / C, 0, 0, CP / C, CP * (M + 0.5), CP * (M + 0.5)); g.lineJoin = 'round'; g.lineCap = 'round';
    const hash = (x, y, k) => { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
    const isStone = t => t === T.STEEL || t === T.SPIKE, isSand = t => t === T.SAND, isOpen = t => cls(t) === 'O';
    const cellsOf = pred => { const out = []; for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (pred(e.get(x, y))) out.push([x, y]); return out; };
    const inB = (x, y) => x >= 0 && y >= 0 && x < W_ && y < H_;
    // ---- whole-board soft shadow on the page
    const DX = 7, DY = 18; // extrusion direction: light from top-left, we look down at the front
    const all = cellsOf(() => true), allSame = (x, y) => inB(x, y);
    g.save(); g.fillStyle = 'rgba(46,52,98,0.28)'; g.translate(DX * 3.2, DY * 3.4); roundedCells(g, all, allSame, 22); g.fill(); g.restore();       // soft drop shadow on the page
    g.save(); g.translate(DX * 2.4, DY * 2.4); roundedCells(g, all, allSame, 22); g.strokeStyle = NB.ink; g.lineWidth = 9; g.stroke(); g.restore();
    for (let k = 24; k >= 1; k--) { g.save(); g.translate(DX * 0.1 * k, DY * 0.1 * k); roundedCells(g, all, allSame, 22); g.fillStyle = '#2f3868'; g.fill(); g.restore(); } // solid tray thickness
    g.save(); g.translate(DX * 2.2, DY * 2.4); roundedCells(g, all, allSame, 22); g.restore();
    // ---- water: pale cyan wash with highlights
    const open = cellsOf(isOpen); g.fillStyle = NB.water; roundedCells(g, cellsOf(t => isOpen(t) || t === T.WALL), () => true, 0); g.fill();
    for (const [x, y] of open) { const a = x * C - C / 2, b = y * C - C / 2;
      if (y > 0 && !isOpen(e.get(x, y - 1))) { g.fillStyle = NB.waterDk; g.fillRect(a, b, C, 8); }
      if (hash(x, y, 1) < 0.4) { g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.beginPath(); const xx = a + 14 + hash(x, y, 2) * 22, yy = b + 22 + hash(x, y, 3) * 24; g.moveTo(xx, yy); g.quadraticCurveTo(xx + 7, yy - 5, xx + 14, yy); g.quadraticCurveTo(xx + 21, yy + 5, xx + 28, yy); g.stroke(); } }
    // ---- extruded side walls (drawn first, so neighbouring top faces hide the sides that would be buried)
    const side = (pred, col, dx = DX, dy = DY) => { const cells = cellsOf(pred); if (!cells.length) return; const same = (x, y) => inB(x, y) && pred(e.get(x, y));
      g.save(); g.translate(dx, dy); roundedCells(g, cells, same, 16); g.strokeStyle = NB.ink; g.lineWidth = 9; g.stroke(); g.fillStyle = col; g.fill(); g.restore();
      // vertical edge lines where the side wall turns a corner, for a crisp solid read
      g.strokeStyle = NB.ink; g.lineWidth = 3.5; g.beginPath(); for (const [x, y] of cells) { if (same(x, y + 1)) continue; const a = x * C - C / 2, b = y * C + C / 2;
        if (!same(x - 1, y) && !same(x - 1, y + 1)) { g.moveTo(a + 10, b); g.lineTo(a + 10 + dx, b + dy); } if (!same(x + 1, y)) { g.moveTo(a + C, b - 8); g.lineTo(a + C + dx, b - 8 + dy); } } g.stroke(); };
    side(isSand, '#c78a32');
    // soft ambient-occlusion in the water right under every raised edge
    for (const [x, y] of open) { const a = x * C - C / 2, b = y * C - C / 2; if (y > 0 && !isOpen(e.get(x, y - 1)) && e.get(x, y - 1) !== T.WALL) { const gr = g.createLinearGradient(0, b + DY, 0, b + DY + 26); gr.addColorStop(0, 'rgba(40,60,110,0.28)'); gr.addColorStop(1, 'rgba(40,60,110,0)'); g.fillStyle = gr; g.fillRect(a, b + DY, C, 26); }
      if (x > 0 && !isOpen(e.get(x - 1, y)) && e.get(x - 1, y) !== T.WALL) { const gr = g.createLinearGradient(a + DX, 0, a + DX + 18, 0); gr.addColorStop(0, 'rgba(40,60,110,0.2)'); gr.addColorStop(1, 'rgba(40,60,110,0)'); g.fillStyle = gr; g.fillRect(a + DX, b, 18, C); } }
    // ---- a material region: bold ink outline (dilated stroke), marker fill, top highlight, bottom shade, clean texture
    const region = (pred, base, dk, hi, tex) => { const cells = cellsOf(pred); if (!cells.length) return; const same = (x, y) => inB(x, y) && pred(e.get(x, y));
      roundedCells(g, cells, same, 16); g.strokeStyle = NB.ink; g.lineWidth = 9; g.stroke(); g.fillStyle = base; g.fill();
      g.save(); roundedCells(g, cells, same, 16); g.clip();
      for (const [x, y] of cells) { const a = x * C - C / 2, b = y * C - C / 2;
        if (!same(x, y - 1)) { g.fillStyle = hi; g.fillRect(a - 1, b + 4, C + 2, 7); }
        if (!same(x - 1, y)) { g.fillStyle = hi; g.globalAlpha = 0.6; g.fillRect(a + 4, b, 6, C); g.globalAlpha = 1; }
        if (!same(x, y + 1)) { g.fillStyle = dk; g.globalAlpha = 0.45; g.fillRect(a - 1, b + C - 8, C + 2, 8); g.globalAlpha = 1; }
        tex(x, y, a, b, same); }
      g.restore(); };
    const stoneRegion = () => region(isStone, NB.stone, NB.stoneDk, NB.stoneHi, (x, y, a, b) => { // tidy brick seams
      g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 3; g.beginPath(); g.moveTo(a, b + C / 2); g.lineTo(a + C, b + C / 2);
      const off = y % 2 ? C / 2 : 0; g.moveTo(a + off, b); g.lineTo(a + off, b + C / 2); g.moveTo(a + (off + C / 2) % C, b + C / 2); g.lineTo(a + (off + C / 2) % C, b + C); g.stroke(); });
    region(isSand, NB.sand, NB.sandDk, NB.sandHi, (x, y, a, b) => { g.fillStyle = 'rgba(190,120,40,0.22)';
      for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(a + 12 + hash(x, y, k) * 40, b + 16 + hash(x, y, k + 6) * 34, 2.6, 0, 7); g.fill(); } });
    side(isStone, '#39437a', DX * 1.5, DY * 1.5); stoneRegion();
    // ---- wooden planks for inner walls (one per horizontal run), with posts
    for (let y = 0; y < H_; y++) { let x = 0; while (x < W_) { if (e.get(x, y) !== T.WALL) { x++; continue; } const s0 = x; while (x < W_ && e.get(x, y) === T.WALL) x++;
      const x0 = s0 * C - C / 2 + 2, x1 = x * C - C / 2 - 2, y0 = y * C - C * 0.27, h = C * 0.54;
      for (const px of (x - s0 >= 2 ? [s0, x - 1] : [])) if (e.get(px, y + 1) === T.SAND || e.get(px, y + 1) === T.STEEL) { g.fillStyle = NB.woodDk; g.strokeStyle = NB.ink; g.lineWidth = 4; g.beginPath(); g.roundRect(px * C - 7, y0 + h - 4, 14, C * 0.95, 4); g.fill(); g.stroke(); }
      g.beginPath(); g.roundRect(x0 + DX * 0.7, y0 + DY * 0.7, x1 - x0, h, 10); g.fillStyle = NB.woodDk; g.fill(); g.lineWidth = 5; g.strokeStyle = NB.ink; g.stroke();
      g.beginPath(); g.roundRect(x0, y0, x1 - x0, h, 10); g.fillStyle = NB.wood; g.fill(); g.lineWidth = 5; g.strokeStyle = NB.ink; g.stroke();
      g.fillStyle = '#efb27a'; g.fillRect(x0 + 8, y0 + 6, x1 - x0 - 16, 4);
      g.strokeStyle = NB.woodDk; g.lineWidth = 2.5; g.beginPath(); for (let gx = x0 + 30; gx < x1 - 20; gx += 46) { g.moveTo(gx, y0 + h * 0.45); g.lineTo(gx + 22, y0 + h * 0.45); } g.stroke();
      for (const nx of [x0 + 12, x1 - 12]) { g.fillStyle = NB.ink; g.beginPath(); g.arc(nx, y0 + h / 2, 3.4, 0, 7); g.fill(); } } }
    // ---- grass: a scalloped strip on every sand/stone top facing water
    for (let y = 1; y < H_; y++) for (let x = 0; x < W_; x++) { const t = e.get(x, y); if (!(isSand(t) || isStone(t)) || !isOpen(e.get(x, y - 1))) continue;
      const a = x * C - C / 2, b = y * C - C / 2; g.beginPath(); g.moveTo(a, b + 6); for (let k = 0; k < 4; k++) { const cx = a + 8 + k * 16; g.arc(cx, b + 4, 8 + (hash(x, y, k) * 3), Math.PI, 0); } g.lineTo(a + C, b + 8); g.lineTo(a, b + 8); g.closePath();
      g.fillStyle = NB.grass; g.fill(); g.strokeStyle = NB.ink; g.lineWidth = 3; g.stroke();
      if (hash(x, y, 9) < 0.3) { const fx = a + 18 + hash(x, y, 10) * 28; g.strokeStyle = NB.grassDk; g.lineWidth = 3; g.beginPath(); g.moveTo(fx, b); g.lineTo(fx - 2, b - 14); g.stroke(); g.fillStyle = hash(x, y, 11) < 0.5 ? '#ff7aa8' : '#ffffff'; g.strokeStyle = NB.ink; g.lineWidth = 2; for (let p = 0; p < 5; p++) { const an = p * 1.256; g.beginPath(); g.arc(fx - 2 + Math.cos(an) * 5, b - 16 + Math.sin(an) * 5, 3.6, 0, 7); g.fill(); g.stroke(); } g.fillStyle = '#ffd45e'; g.beginPath(); g.arc(fx - 2, b - 16, 3, 0, 7); g.fill(); } }
    // ---- spikes: glossy red teeth with ink outline, facing the water
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (e.get(x, y) === T.SPIKE) for (const nx of [-1, 1]) if (isOpen(e.get(x + nx, y))) {
      const ex = x * C + nx * C / 2; for (let k = 0; k < 3; k++) { const yy = y * C - C / 2 + 5 + k * 18; g.beginPath(); g.moveTo(ex, yy); g.lineTo(ex + nx * 18, yy + 9); g.lineTo(ex, yy + 18); g.closePath(); g.fillStyle = '#ff4d3d'; g.fill(); g.strokeStyle = NB.ink; g.lineWidth = 3; g.stroke(); } }
    // ---- chevrons down the shaft into the gate
    if (e.gate) for (let k = 1; k <= 2; k++) { const yy = e.gate.y - k; if (yy >= 0 && e.get(e.gate.x, yy) === T.EMPTY) { const X = e.gate.x * C, Y = yy * C; g.strokeStyle = '#2f8cff'; g.lineWidth = 6; g.beginPath(); g.moveTo(X - 12, Y - 8); g.lineTo(X, Y + 4); g.lineTo(X + 12, Y - 8); g.moveTo(X - 12, Y + 6); g.lineTo(X, Y + 18); g.lineTo(X + 12, Y + 6); g.stroke(); } }
    L.dirty = false;
  }
  // ---- notebook page drawn in world space: it zooms and pans with the camera (gentle parallax)
  function notebookPage(t, s, midY) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#fbf5e8'; ctx.fillRect(0, 0, W, H);
    const e = L.e, P = 0.82, bs = s * P, camX = L.cam[0] * C, camY = L.cam[1] * C;
    const sx = wx => W / 2 + (wx - camX) * bs, sy = wy => midY + (wy - camY) * bs;
    const wy0 = camY + (0 - midY) / bs, wy1 = camY + (H - midY) / bs, RULE = 44;
    ctx.strokeStyle = 'rgba(126,160,205,0.42)'; ctx.lineWidth = Math.max(0.8, 1.6 * bs); ctx.beginPath();
    for (let wy = Math.floor(wy0 / RULE) * RULE; wy < wy1; wy += RULE) { const y = sy(wy); ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
    const mX = sx(-2.4 * C); ctx.strokeStyle = 'rgba(214,96,104,0.5)'; ctx.lineWidth = Math.max(1, 2.2 * bs); ctx.beginPath(); ctx.moveTo(mX, 0); ctx.lineTo(mX, H); ctx.stroke();
    // spiral binding further left
    const rx = sx(-3.6 * C); if (rx > -30) for (let wy = Math.floor(wy0 / 70) * 70; wy < wy1 + 70; wy += 70) { const y = sy(wy); ctx.fillStyle = '#e4dccb'; ctx.beginPath(); ctx.arc(rx, y, 9 * bs, 0, 7); ctx.fill(); ctx.strokeStyle = '#5b5560'; ctx.lineWidth = Math.max(1.2, 3.4 * bs); ctx.beginPath(); ctx.ellipse(rx - 5 * bs, y - 3 * bs, 17 * bs, 7 * bs, -0.25, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke(); }
    // indigo ballpoint doodles anchored around the board
    ctx.save(); ctx.strokeStyle = 'rgba(70,82,150,0.5)'; ctx.lineWidth = Math.max(1, 2.4 * bs); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const star = (wx, wy, r) => { const x = sx(wx), y = sy(wy), R = r * bs; ctx.beginPath(); for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * 0.45 : R; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.stroke(); };
    const BW = e.w * C, BH = e.h * C;
    star(BW + 1.2 * C, 0.2 * C, 16); star(BW + 1.9 * C, 0.7 * C, 9); star(-1.2 * C, BH + 0.6 * C, 12);
    { const x = sx(BW + 1.5 * C), y = sy(BH * 0.55), R = 20 * bs; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + t * 0.2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 1.35, y + Math.sin(a) * R * 1.35); ctx.lineTo(x + Math.cos(a) * R * 1.85, y + Math.sin(a) * R * 1.85); ctx.stroke(); } }
    { const x = sx(BW * 0.5), y = sy(BH + 1.0 * C); ctx.beginPath(); for (let i = 0; i < 70; i++) { const a = i * 0.33, r = i * 0.38 * bs; i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x, y); } ctx.stroke(); }
    for (let i = 0; i < 6; i++) { const wx = BW + 0.8 * C + (i % 3) * 22, wy = BH - ((t * (22 + i * 6) + i * 140) % (BH + 2 * C)) + C; ctx.beginPath(); ctx.arc(sx(wx + Math.sin(t + i) * 8), sy(wy), (5 + (i % 3) * 3) * bs, 0, 7); ctx.stroke(); }
    ctx.restore(); ctx.fillStyle = grain; ctx.fillRect(0, 0, W, H);
  }
  // ---- crisp pieces
  function nbShadow(x, y, w) { ctx.save(); ctx.fillStyle = 'rgba(30,30,60,0.16)'; ctx.beginPath(); ctx.ellipse(x + 4, y + 27, w, 6, 0, 0, 7); ctx.fill(); ctx.restore(); }
  function nbPearl(x, y, t) { const p = (Math.sin(t * 3) + 1) / 2; ctx.save(); ctx.translate(x, y); ctx.fillStyle = 'rgba(40,50,100,0.22)'; ctx.beginPath(); ctx.ellipse(8, 16, 22, 10, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,77,61,' + (0.25 + p * 0.25) + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 28 + p * 4, 0, 7); ctx.stroke();
    const gr = ctx.createRadialGradient(-7, -8, 3, 0, 0, 23); gr.addColorStop(0, '#ff8a76'); gr.addColorStop(0.55, '#f2402e'); gr.addColorStop(1, '#c4231a'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = NB.ink; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(-8, -9, 6, 4, -0.6, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(7, 9, 2.2, 0, 7); ctx.globalAlpha = 0.7; ctx.fill(); ctx.restore(); }
  function nbStone(x, y, rot, crate) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath(); ctx.roundRect(-26 + 6, -26 + 12, 52, 52, 10); ctx.fillStyle = crate ? NB.woodDk : '#7c86ad'; ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = NB.ink; ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-22, 26); ctx.lineTo(-16, 36); ctx.moveTo(26, -18); ctx.lineTo(32, -6); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-26, -26, 52, 52, 10); ctx.fillStyle = crate ? NB.wood : '#c4cae0'; ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = NB.ink; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.roundRect(-26, -26, 52, 52, 10); ctx.clip(); ctx.fillStyle = crate ? NB.woodDk : '#8f97bd'; ctx.fillRect(-26, 14, 52, 12); ctx.fillStyle = crate ? '#efb27a' : '#dfe5f5'; ctx.fillRect(-20, -21, 40, 4); ctx.restore();
    ctx.strokeStyle = NB.ink; ctx.lineWidth = 3.5; ctx.beginPath();
    if (crate) { ctx.moveTo(-18, -18); ctx.lineTo(18, 18); ctx.moveTo(18, -18); ctx.lineTo(-18, 18); ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(-18, -18, 36, 36); ctx.stroke(); }
    else { ctx.arc(0, 0, 9, 0, 7); ctx.stroke(); for (const [bx, by] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) { ctx.fillStyle = NB.ink; ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, 7); ctx.fill(); } }
    ctx.restore(); }
  function nbGate(x, y, open, t) { ctx.save(); ctx.translate(x, y);
    if (open) { const p = (Math.sin(t * 4) + 1) / 2; ctx.strokeStyle = 'rgba(56,201,110,' + (0.4 + p * 0.5) + ')'; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(-34 - p * 4, -34 - p * 4, 68 + p * 8, 68 + p * 8, 16); ctx.stroke(); }
    ctx.beginPath(); ctx.roundRect(-27 + 6, -28 + 11, 54, 56, 10); ctx.fillStyle = open ? '#7fd9a0' : '#b9c7e6'; ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = NB.ink; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-27, -28, 54, 56, 10); ctx.fillStyle = open ? '#c8f5d8' : '#ffffff'; ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = NB.ink; ctx.stroke();
    ctx.strokeStyle = '#2f8cff'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-16, -15); ctx.lineTo(16, -15); ctx.moveTo(-16, -4); ctx.lineTo(16, -4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(4, 6, 10, 10, 10, 15); ctx.arc(0, 15, 10, 0, Math.PI); ctx.bezierCurveTo(-10, 10, -4, 6, 0, 0); ctx.fillStyle = open ? '#38c96e' : '#2f8cff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = NB.ink; ctx.stroke(); ctx.restore(); }
  function nbAir(x, y) { ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.arc(0, 0, 21, 0, 7); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#2f8cff'; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(-8, -9, 5, 3, -0.6, 0, 7); ctx.fill(); ctx.fillStyle = '#2f8cff'; ctx.font = '700 17px "Gochi Hand", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('O₂', 0, 2); ctx.restore(); }
  function nbStick(x, y, o) { const { face = 1, kick = 0, pose = 'swim', tilt = 0, s = 1, idle = false } = o; ctx.save(); ctx.fillStyle = 'rgba(40,50,100,0.2)'; ctx.beginPath(); ctx.ellipse(x + 7, y + 40, 18, 6, 0, 0, 7); ctx.fill(); ctx.restore(); ctx.save(); ctx.translate(x, y); ctx.rotate(tilt * 0.6); ctx.scale(face * s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const sw = idle ? Math.sin(kick) * 0.15 : Math.sin(kick) * 0.75, ink = NB.ink;
    const limb = (x0, y0, ang, len, k2) => { const x1 = x0 + Math.sin(ang) * len * 0.55, y1 = y0 + Math.cos(ang) * len * 0.55, x2 = x1 + Math.sin(ang + k2) * len * 0.5, y2 = y1 + Math.cos(ang + k2) * len * 0.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    // backpack
    ctx.beginPath(); ctx.roundRect(-24, -12, 15, 26, 5); ctx.fillStyle = '#ff9f43'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = ink; ctx.stroke(); ctx.fillStyle = '#e07b1c'; ctx.fillRect(-21, 4, 9, 6);
    ctx.lineWidth = 4.5; ctx.strokeStyle = ink;
    // legs
    if (pose === 'up') { limb(-3, 14, 0.4, 24, -0.6); limb(4, 14, -0.4, 24, 0.6); } else { limb(-2, 14, sw, 26, -Math.abs(sw) * 0.6); limb(3, 14, -sw, 26, -Math.abs(sw) * 0.6); }
    // body
    ctx.beginPath(); ctx.roundRect(-10, -8, 21, 24, 7); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    // arms
    ctx.lineWidth = 4.5; if (pose === 'up') { limb(8, -3, Math.PI * 0.85, 26, 0.3); limb(-6, -3, -Math.PI * 0.85, 26, -0.3); } else if (pose === 'push') { limb(8, -1, Math.PI / 2, 30, 0.1); limb(6, 4, Math.PI / 2 + 0.15, 28, 0.05); } else { limb(8, -2, -sw * 0.8 + 0.35, 24, 0.5); limb(-5, -2, sw * 0.8 - 0.25, 24, 0.5); }
    // head
    ctx.beginPath(); ctx.arc(2, -27, 17, 0, 7); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = ink; for (const dx of [3, 11]) { ctx.beginPath(); ctx.ellipse(dx, -30, 2.4, 3.4, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,120,150,0.55)'; ctx.beginPath(); ctx.ellipse(14, -22, 3.6, 2.2, 0, 0, 7); ctx.fill();
    ctx.lineWidth = 2.8; ctx.beginPath(); if (pose === 'up') { ctx.arc(7, -24, 5, 0, Math.PI); ctx.fillStyle = '#ff6b5a'; ctx.fill(); ctx.stroke(); } else { ctx.arc(7, -25, 5, 0.25, Math.PI - 0.25); ctx.stroke(); }
    ctx.restore(); }
  function levelStart(e) { L = { e, fx: [], ghosts: [], cam: null, s: 0, lead: [0, 0], lastMove: -9, face: 1, act: null, t: 0, prev: new Map(), dirty: true }; mode = 'level'; startLoop(); }

  function levelTick(e) { if (!L || e !== L.e) return; const T = T_();
    for (const ev of e.events) {
      const x = ev.x * C, y = ev.y * C;
      if (ev.type === 'dig' || ev.type === 'air') L.dirty = true;
      if (ev.type === 'dig') { for (let i = 0; i < 7; i++) L.fx.push({ k: 'dot', x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, life: 0.5, t: 0, c: '#d9b44a' }); L.act = { k: 'dig', t: 0 }; }
      else if (ev.type === 'push') L.act = { k: 'push', t: 0 };
      else if (ev.type === 'air') for (let i = 0; i < 6; i++) L.fx.push({ k: 'bub', x: x + (Math.random() - 0.5) * 30, y, vx: 0, vy: -60 - Math.random() * 50, life: 1, t: 0, r: 3 + Math.random() * 4 });
      else if (ev.type === 'land') for (let i = 0; i < 4; i++) L.fx.push({ k: 'dot', x: x + (Math.random() - 0.5) * 40, y: y + 26, vx: (Math.random() - 0.5) * 50, vy: -10, life: 0.4, t: 0, c: '#9a9488' });
      else if (ev.type === 'absorb') L.ghosts.push({ k: 'ball', fx: ev.fromX * C, fy: ev.fromY * C, tx: x, ty: y, t: 0, d: 0.45 });
      else if (ev.type === 'gateOpen') L.fx.push({ k: 'ring', x, y, t: 0, life: 0.9 });
      else if (ev.type === 'monsterDeath') L.ghosts.push({ k: 'mon', ot: ev.t, x, y, t: 0, d: 0.8 });
      else if (ev.type === 'playerDeath') L.ghosts.push({ k: 'pdie', x, y, t: 0, d: 1.8, face: L.face });
      else if (ev.type === 'win') L.ghosts.push({ k: 'pwin', x, y, t: 0, d: 1, face: L.face });
    } }
  function drawLevel(t, dt, now) {
    const e = L.e, T = T_(), W_ = e.w, H_ = e.h; L.t = t;
    const w = window.__dc && window.__dc.world; const tickMs = e.tickMs, a = Math.min(1, Math.max(0, (now - (w ? w.lastTick : now)) / tickMs));
    // ----- camera: fit or follow, smart zoom, look-ahead, hold-to-peek
    const touch = document.body.classList.contains('touch');
    const padT = innerWidth < 560 ? 112 : 138, padB = innerWidth < 560 ? 86 : 74, availH = Math.max(120, H - padT - padB);
    const EXT = INK_MODE ? { l: 0.4, r: 0.4, t: 0.4, b: 0.4 } : { l: 1.0, r: 1.3, t: 2.0, b: 4.1 }; // scenery around the board, in cells
    const fitAll = Math.min(W / (W_ + EXT.l + EXT.r), availH / (H_ + EXT.t + EXT.b));
    const player = [...e.objects.values()].find(o => o.t === T.PLAYER);
    const moving = player && (player.px !== player.x || player.py !== player.y);
    if (moving) { L.lastMove = t; L.mdir = [player.x - player.px, player.y - player.py]; if (player.x !== player.px) L.face = Math.sign(player.x - player.px); }
    const idle = t - L.lastMove, peek = w && w.peek;
    const desk = !document.body.classList.contains('touch');
    let target = desk ? fitAll : (fitAll >= 30 ? fitAll : 52); const fitted = desk || fitAll >= 30; if (!desk) target *= idle > 1.1 ? 0.9 : 1.0; if (peek) target = Math.min(fitAll, target);
    L.s = L.s ? L.s + (target - L.s) * (1 - Math.exp(-dt * (peek ? 3 : 1.6))) : target;
    const s = L.s / C; // px per world unit
    const lg = idle < 0.45 && L.mdir ? [L.mdir[0] * 1.2, L.mdir[1] * 0.8] : [0, 0];
    L.lead[0] += (lg[0] - L.lead[0]) * (1 - Math.exp(-dt * 1.8)); L.lead[1] += (lg[1] - L.lead[1]) * (1 - Math.exp(-dt * 1.8));
    const g = player ? 1 - Math.pow(1 - a, 3) : 0;
    const pxp = player ? (player.px + (player.x - player.px) * g) : (W_ - 1) / 2, pyp = player ? (player.py + (player.y - player.py) * g) : (H_ - 1) / 2;
    const halfW = W / 2 / L.s, halfH = availH / 2 / L.s;
    const ccx = (W_ - 1) / 2 + (EXT.r - EXT.l) / 2, ccy = (H_ - 1) / 2 + (EXT.b - EXT.t) / 2;
    let cx = peek ? ccx : pxp + L.lead[0], cy = peek ? ccy : pyp + L.lead[1];
    if (fitted || peek) { cx = ccx; cy = ccy; } else {
    cx = W_ <= halfW * 2 - 0.4 ? (W_ - 1) / 2 : Math.max(halfW - 0.7, Math.min(W_ - 0.3 - halfW, cx));
    cy = H_ <= halfH * 2 - 0.4 ? (H_ - 1) / 2 : Math.max(halfH - 0.7, Math.min(H_ - 0.3 - halfH, cy)); }
    if (!L.cam) L.cam = [cx, cy]; const k = 1 - Math.pow(0.012, dt); L.cam[0] += (cx - L.cam[0]) * k; L.cam[1] += (cy - L.cam[1]) * k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (INK_MODE) notebookPage(t, s, padT + availH / 2); else {     buildLandscape(); { const par = ((L.cam ? L.cam[0] : 0) / Math.max(1, W_ - 1)) * W * 0.25; ctx.drawImage(land, -par, 0, W * 1.25, H); } }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - L.cam[0] * C * s), dpr * (padT + availH / 2 - L.cam[1] * C * s));

    // ----- visible range
    const x0 = Math.max(0, Math.floor(L.cam[0] - halfW - 1)), x1 = Math.min(W_ - 1, Math.ceil(L.cam[0] + halfW + 1));
    const y0 = Math.max(0, Math.floor(L.cam[1] - H / 2 / L.s - 1)), y1 = Math.min(H_ - 1, Math.ceil(L.cam[1] + H / 2 / L.s + 1));
    // ----- terrain (cached: redrawn only when sand is dug or air is collected)
    if (L.dirty || !L.terr) (INK_MODE ? buildNotebook : buildTerrain)();
    ctx.drawImage(L.terr, -(M + 0.5) * C, -(M + 0.5) * C, (W_ + 2 * M) * C, (H_ + 2 * M) * C);
    if (L.pipe && !INK_MODE) { const P = L.pipe.pts; ctx.save(); ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let k = 1; k < P.length - 1; k++) ctx.arcTo(P[k][0], P[k][1], P[k + 1][0], P[k + 1][1], 44); ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.setLineDash([14, 46]); ctx.lineDashOffset = -t * 80; ctx.stroke(); ctx.restore(); }
    const scn = (window.__LEVELSCENE || {});
    if (scn.fall !== undefined) { const fx = scn.fall * C; let y0 = 0; while (y0 < H_ && e.get(scn.fall, y0) !== T.EMPTY) y0++; let y1 = y0; while (y1 < H_ && (e.get(scn.fall, y1) === T.EMPTY || e.get(scn.fall, y1) === T.ROCK || e.get(scn.fall, y1) === T.PLAYER)) y1++;
      const top = (y0 - 0.5) * C, bt = (y1 - 0.5) * C; ctx.save(); ctx.beginPath(); ctx.rect(fx - C / 2, top, C, bt - top); ctx.clip();
      const wg = ctx.createLinearGradient(fx - C / 2, 0, fx + C / 2, 0); wg.addColorStop(0, '#3f9cf0'); wg.addColorStop(0.5, '#8fd8ff'); wg.addColorStop(1, '#2f86e0'); ctx.fillStyle = wg; ctx.globalAlpha = 0.85; ctx.fillRect(fx - C * 0.45, top, C * 0.62, bt - top); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      for (let k = 0; k < 4; k++) { const xx = fx - C * 0.38 + k * C * 0.15; for (let y = top - 80 + ((t * (150 + k * 19) + k * 31) % 80); y < bt; y += 80) { ctx.beginPath(); ctx.moveTo(xx, y); ctx.quadraticCurveTo(xx + 3, y + 14, xx, y + 30); ctx.stroke(); } }
      ctx.restore(); for (let k = 0; k < 6; k++) circ(fx + Math.cos(k * 1.1 + t * 3) * C * 0.36, bt - 8 - Math.abs(Math.sin(t * 4 + k)) * 12, 5 + (k % 3) * 2, { fill: '#ffffff', stroke: '#6cb6f0', lw: 2 }); }
    if (scn.fall === undefined && !INK_MODE) { const wx = (W_ - 0.5) * C + 6, ww = C * 0.56, wy0 = L.fallTop !== undefined ? L.fallTop : -C * 0.3, wy1 = L.fallBot !== undefined ? L.fallBot : (H_ - 0.5) * C + C * 0.9;
      ctx.save(); const wg = ctx.createLinearGradient(wx, 0, wx + ww, 0); wg.addColorStop(0, '#3f9cf0'); wg.addColorStop(0.5, '#7fd3ff'); wg.addColorStop(1, '#2f86e0');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.moveTo(wx - 4, wy0); ctx.quadraticCurveTo(wx + ww * 0.5, wy0 - 14, wx + ww + 6, wy0 + 4); ctx.lineTo(wx + ww + 2, wy1); ctx.lineTo(wx, wy1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#1d4f8c'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) { const xx = wx + 6 + k * (ww - 12) / 4; for (let y = wy0 - 80 + ((t * (140 + k * 17) + k * 37) % 80); y < wy1; y += 80) { ctx.beginPath(); ctx.moveTo(xx, y); ctx.quadraticCurveTo(xx + 3, y + 14, xx, y + 30); ctx.stroke(); } }
      ctx.restore();
      for (let k = 0; k < 7; k++) { const sx = wx + ww / 2 + Math.cos(k * 0.9 + t * 3) * ww * 0.8, sy = wy1 - 4 - Math.abs(Math.sin(t * 4 + k)) * 14; circ(sx, sy, 5 + (k % 3) * 2, { fill: '#ffffff', stroke: '#6cb6f0', lw: 2 }); } }
    if (L.lever && ART.ready && !INK_MODE) { const [lx, ly] = L.lever, on = e.gate && e.gate.open; ctx.save(); ctx.translate(lx, ly - 34); if (on) ctx.scale(-1, 1); ctx.drawImage(ART.img.lever, -30, -30, 60, 60); ctx.restore(); }
    // seaweed sprigs on open floors (live, they sway)
    for (let y = Math.max(1, y0); y <= y1; y++) for (let x = x0; x <= x1; x++) if (cls(e.get(x, y)) !== 'O' && e.get(x, y - 1) === T.EMPTY && ((x * 7 + y * 13) % 4) === 0) {
      const bx = x * C + ((x * 31) % 20) - 10, by = y * C - C / 2; for (let k = 0; k < 2; k++) { const pts = []; const hgt = 30 + k * 10; for (let i = 0; i <= 5; i++) { const q = i / 5; pts.push([bx + k * 9 + Math.sin(t * 1.3 + x + k + q * 2.4) * 6 * q, by - hgt * q]); } line(pts, { stroke: k ? '#78c043' : '#4f9a2e', lw: 3.5, step: 8, wob: 0.5 }); } }
    // ----- gate + air capsules
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const tt = e.get(x, y);
      if (tt === T.GATE && INK_MODE) nbGate(x * C, y * C, e.gate && e.gate.open, t);
      else if (tt === T.AIR && INK_MODE) nbAir(x * C, y * C + Math.sin(t * 2 + x) * 3);
      else if (tt === T.GATE && ART.ready && !INK_MODE) { const X = x * C, Y = y * C, open = e.gate && e.gate.open; ctx.drawImage(ART.img.gate, X - 30, Y - 30, 60, 60);
        if (open) { const p = (Math.sin(t * 4) + 1) / 2; circ(X, Y, 34 + p * 6, { fill: null, stroke: BLUE, lw: 3.5, alpha: 0.5 + p * 0.5 }); } }
      else if (tt === T.GATE) { const X = x * C, Y = y * C, open = e.gate && e.gate.open;
        rect(X - 26, Y - 28, 52, 56, { fill: open ? LBLUE : '#fff', lw: 3, step: 999 });
        if (!open) { line([[X - 17, Y - 15], [X + 17, Y - 15]], { stroke: BLUE, lw: 4, step: 999 }); line([[X - 17, Y - 6], [X + 17, Y - 6]], { stroke: BLUE, lw: 4, step: 999 });
          ctx.beginPath(); ctx.moveTo(X, Y + 1); ctx.bezierCurveTo(X + 3, Y + 6, X + 8, Y + 10, X + 8, Y + 15); ctx.arc(X, Y + 15, 8, 0, Math.PI); ctx.bezierCurveTo(X - 8, Y + 10, X - 3, Y + 6, X, Y + 1); ctx.fillStyle = '#3a95ec'; ctx.fill(); ctx.strokeStyle = '#1d4f8c'; ctx.lineWidth = 2; ctx.stroke(); }
        else { const p = (Math.sin(t * 4) + 1) / 2; circ(X, Y, 14 + p * 4, { fill: null, stroke: BLUE, lw: 3, alpha: 0.6 + p * 0.4 }); shape([[X - 7, Y - 4], [X + 7, Y - 4], [X, Y + 7]], { fill: BLUE, lw: 2, step: 999 }); } }
      else if (tt === T.AIR) { const X = x * C, Y = y * C + Math.sin(t * 2 + x) * 3; circ(X, Y, 19, { fill: '#fff', stroke: BLUE, lw: 2.6 }); ctx.save(); ctx.fillStyle = BLUE; ctx.font = '700 15px "Patrick Hand", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('O₂', X, Y + 1); ctx.restore(); } }
    // ----- objects
    for (const o of e.objects.values()) {
      const kk = (o.t === T.ROCK || o.t === T.BALL) && (o.falling || o.py !== o.y) ? a * a : (a * a * (3 - 2 * a));
      let X = (o.px + (o.x - o.px) * kk) * C, Y = (o.py + (o.y - o.py) * kk) * C;
      if (o.t !== T.PLAYER) { ctx.save(); ctx.globalAlpha = 0.14; ctx.fillStyle = '#4a3a1c'; ctx.beginPath(); ctx.ellipse(X + 4, Y + 27, 22, 5, 0, 0, 7); ctx.fill(); ctx.restore(); }
      if (o.t === T.ROCK) { L.prev.set(o.id, (L.prev.get(o.id) || 0) + (o.x - o.px) * dt * 3); if (INK_MODE) { nbStone(X, Y, L.prev.get(o.id), o.skin === 'crate'); } else if (false) { if (o.skin === 'crate') { ctx.save(); ctx.translate(X, Y); shape([[-25, -25], [25, -25], [25, 25], [-25, 25]], { fill: '#d9a066', lw: 3, step: 999, wob: 0.6 }); line([[-25, -25], [25, 25]], { lw: 2.6, step: 999 }); line([[25, -25], [-25, 25]], { lw: 2.6, step: 999 }); line([[-25, -8], [25, -8]], { lw: 1.4, step: 999, alpha: 0.5 }); line([[-25, 8], [25, 8]], { lw: 1.4, step: 999, alpha: 0.5 }); ctx.restore(); } else { ctx.save(); ctx.translate(X, Y); ctx.rotate(L.prev.get(o.id)); shape([[-24, -20], [-20, -24], [20, -24], [24, -20], [24, 20], [20, 24], [-20, 24], [-24, 20]], { fill: '#c7c3ba', lw: 3, step: 999, wob: 0.6 }); circ(0, 0, 8, { fill: null, lw: 2.4 }); line([[-14, -16], [-6, -16]], { stroke: '#fff', lw: 3, step: 999, alpha: 0.8 }); ctx.restore(); } }
      else if (ART.ready) { ctx.save(); ctx.translate(X, Y); ctx.rotate(L.prev.get(o.id)); if (o.skin === 'crate') ctx.drawImage(ART.img.crate, -30, -32, 60, 64); else ctx.drawImage(ART.img.metal, -30, -30, 60, 60); ctx.restore(); } else stoneBlock(X, Y, L.prev.get(o.id)); }
      else if (o.t === T.BALL && INK_MODE) nbPearl(X, Y, t + o.id);
      else if (o.t === T.BALL && ART.ready && !INK_MODE) { ctx.drawImage(ART.img.orb, X - 30, Y - 31, 60, 62); }
      else if (o.t === T.BALL) { shape([[X - 26, Y - 26], [X + 26, Y - 26], [X + 26, Y + 26], [X - 26, Y + 26]], { fill: '#fbf7ee', stroke: BRN, lw: 2.6, step: 999, wob: 0.5 }); pearl(X, Y, t + o.id, 1.25, 0.7); const sp = (t * 0.6 + o.id * 0.37) % 3; if (sp < 0.5) { const q = Math.sin(sp / 0.5 * Math.PI) * 7; line([[X + 12 - q, Y - 14], [X + 12 + q, Y - 14]], { stroke: YELLOW, lw: 2.6, step: 999 }); line([[X + 12, Y - 14 - q], [X + 12, Y - 14 + q]], { stroke: YELLOW, lw: 2.6, step: 999 }); } }
      else if (o.t === T.FISH) { const D = [[1, 0], [0, 1], [-1, 0], [0, -1]][o.dir] || [1, 0]; if (D[0]) L.prev.set(o.id, D[0]); fish(X, Y + Math.sin(t * 3 + o.id) * 3, L.prev.get(o.id) || 1, t, 1.15); }
      else if (o.t === T.JELLY) jelly(X, Y + Math.sin(t * 2.4 + o.id) * 4, t + o.id, 1.2);
      else if (o.t === T.CRAB) crab(X, Y + 12, t + o.id, 1.2);
      else if (o.t === T.PLAYER) {
        X = pxp * C; Y = pyp * C + Math.sin(t * 1.7) * 3 + 4;
        const act = L.act; let pose = 'swim', reach = 0; if (act) { act.t += dt; if (act.t > 0.35) L.act = null; else { pose = 'push'; reach = Math.sin(act.t / 0.35 * Math.PI) * 8; } }
        const md = L.mdir || [0, 0], tilt = moving ? (md[1] ? -0.5 * md[1] * L.face : -0.12) : Math.sin(t * 1.2) * 0.05;
        (INK_MODE ? nbStick : diver)(X, Y - 4, { idle: !moving && pose !== 'push', face: L.face, kick: t * (moving ? 10 : 2.5), look: [1, moving ? 0 : 0.3], pose, reach, tilt, s: 0.82 });
      } }
    // ----- ghosts & small effects
    L.ghosts = L.ghosts.filter(gh => { gh.t += dt; const q = Math.min(1, gh.t / gh.d);
      if (gh.k === 'ball') pearl(lerp(gh.fx, gh.tx, q * q), lerp(gh.fy, gh.ty, q * q), t, 1.35 * (1 - q * 0.9), 1 - q);
      else if (gh.k === 'mon') { ctx.save(); ctx.globalAlpha = 1 - q; ctx.translate(gh.x, gh.y + q * 30); ctx.rotate(q * 4); ctx.translate(-gh.x, -gh.y); if (gh.ot === T.FISH) fish(gh.x, gh.y, 1, t, 1.15); else if (gh.ot === T.JELLY) jelly(gh.x, gh.y, t, 1.2); else crab(gh.x, gh.y, t, 1.2); ctx.restore(); }
      else if (gh.k === 'pdie') { ctx.save(); ctx.globalAlpha = 1 - Math.max(0, q - 0.6) / 0.4; diver(gh.x, gh.y - q * 40, { face: gh.face, tilt: q * 6, pose: 'up', kick: t * 4, s: 0.82 }); ctx.restore(); }
      else if (gh.k === 'pwin') { diver(gh.x, gh.y, { face: gh.face, tilt: q * 8, pose: 'up', kick: t * 6, s: 0.82 * (1 - q) }); }
      return gh.t < gh.d; });
    L.fx = L.fx.filter(f => { f.t += dt; const q = f.t / f.life;
      if (f.k === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 120 * dt; circ(f.x, f.y, 3, { fill: f.c, stroke: null, alpha: 1 - q }); }
      else if (f.k === 'bub') { f.y += f.vy * dt; circ(f.x + Math.sin(f.t * 8) * 3, f.y, f.r, { stroke: BLUE, lw: 2, alpha: 1 - q }); }
      else if (f.k === 'ring') circ(f.x, f.y, 20 + q * 70, { stroke: BLUE, lw: 3, alpha: 1 - q });
      return q < 1; });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    { const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(120,95,50,0)'); vg.addColorStop(1, 'rgba(110,80,40,0.2)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - L.cam[0] * C * s), dpr * (padT + availH / 2 - L.cam[1] * C * s));
    // gentle ambient bubbles in open water

    if (Math.random() < dt * 1.5) { for (let tries = 0; tries < 6; tries++) { const x = x0 + Math.floor(Math.random() * (x1 - x0 + 1)), y = y0 + Math.floor(Math.random() * (y1 - y0 + 1)); if (e.get(x, y) === T.EMPTY) { L.fx.push({ k: 'bub', x: x * C, y: y * C + 20, vy: -40, life: 1.2, t: 0, r: 3 + Math.random() * 3 }); break; } } }
  }

  // ---------- loop + API
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const t = (now - t0) / 1000, dt = Math.min(0.05, Math.max(0, t - lastT)); lastT = t;
    boil = Math.floor(t * 7) * 0.37;
    if (mode === 'intro') {
      for (const [ct, name] of CUES) if (t >= ct && !fired.has(ct)) { fired.add(ct); try { Audio.play(name); } catch {} }
      drawIntro(t, dt);
      if (t >= DUR) { const cb = onDone; stopLoop(); mode = 'off'; if (cb) cb(); }
    } else if (mode === 'menu') drawMenu(t, dt);
    else if (mode === 'level' && L) drawLevel(t, dt, now);
  }
  function startLoop() { cancelAnimationFrame(raf); t0 = performance.now(); lastT = 0; bubbles = []; raf = requestAnimationFrame(loop); }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }
  return {
    playIntro(cb) { if (mode === 'intro') return false; mode = 'intro'; onDone = cb; fired = new Set(); startLoop(); return true; },
    skip() { if (mode !== 'intro') return; const cb = onDone; onDone = null; mode = 'off'; stopLoop(); if (cb) cb(); },
    menu() { if (mode === 'menu') return; mode = 'menu'; L = null; startLoop(); },
    hide() { mode = 'off'; stopLoop(); L = null; },
    levelStart, levelTick,
    get mode() { return mode; },
    renderAt(t) { mode = 'debug'; stopLoop(); boil = Math.floor(t * 7) * 0.37; bubbles = []; for (let i = 0; i < 40; i++) updBubbles(0.05, [[120, 400], [880, 400]]); drawIntro(t, 0); },
    DUR,
  };
})();

window.__doodle = Doodle; window.__T = T;
// Deep Current — game flow, UI, input, saves. Expects globals: THREE, Engine, T, LEVELS, World, Audio.
/* global Engine, T, LEVELS, World, Audio */
(() => {
  const $ = s => document.querySelector(s);
  const canvas = $('#c');
  const world = World.create(canvas); window.__dc = { world, get engine() { return engine; }, get state() { return state; }, startCustom: (lv) => { startLevel(0, lv); beginPlay(); }, startIndex: (i) => { startLevel(i); beginPlay(); }, go: (id) => { if (booting) { dropLoader(); showMenuScene(); } go(id); }, frame: (now) => frame(now), World, intro: () => { if (booting) { dropLoader(); showMenuScene(); } startCine(); } };
  world.onSfx = n => Audio.play(n); world.onToast = m => toast(m);
  const isTouch = World.isMobile || navigator.maxTouchPoints > 0;
  document.body.classList.toggle('touch', isTouch);

  // ---- save ----
  const save = (() => { const d = { name: '', unlocked: 1, stars: {}, best: {}, settings: { music: true, sfx: true, dpad: false, vibe: true, quality: World.isMobile ? 'high' : 'high' } };
    try { const s = JSON.parse(localStorage.getItem('dc-save') || '{}'); Object.assign(d, s); d.settings = Object.assign({ music: true, sfx: true, dpad: false, vibe: true, quality: 'high' }, s.settings || {}); } catch {} return d; })();
  const persist = () => { try { localStorage.setItem('dc-save', JSON.stringify(save)); } catch {} };
  const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);
  const buzz = ms => { if (save.settings.vibe && navigator.vibrate) navigator.vibrate(ms); };
  const click = () => Audio.play('click');

  // ================= economy: coins, skins, daily treasure, achievements =================
  save.coins = save.coins || 0; save.owned = save.owned || {}; save.equip = Object.assign({ suit: 'violet', scarf: 'pink', hat: 'none', trail: 'bubbles', pearl: 'ruby' }, save.equip || {});
  save.stats = Object.assign({ dug: 0, treasures: 0, pearls: 0, wins: 0, perfect: 0 }, save.stats || {}); save.ach = save.ach || {}; save.daily = save.daily || { last: '', streak: 0 };
  const owns = (cat, id) => World.SKINS[cat].find(x => x.id === id)?.price === 0 || !!save.owned[cat + ':' + id];
  World.applySkin(save.equip);
  const coinEls = () => document.querySelectorAll('.coinCount, #hmCoins');
  function syncCoins() { coinEls().forEach(el => { el.textContent = save.coins.toLocaleString(); }); }
  function addCoins(n, why) { if (!n) return; save.coins += n; persist(); syncCoins(); Audio.play('treasure');
    const t = document.createElement('div'); t.className = 'toast-coin'; t.innerHTML = '<i class="coin"></i>'; const b = document.createElement('b'); b.textContent = `+${n}` + (why ? `  ${why}` : ''); t.appendChild(b); document.body.appendChild(t); setTimeout(() => t.remove(), 1700); }
  world.onStat = (k) => { if (k === 'treasure') { runTreasures++; save.stats.treasures++; } else if (k === 'pearl') save.stats.pearls++; };
  let runTreasures = 0;
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const DAILY = [50, 80, 120, 160, 220, 300, 500];
  function dailyState() { const today = dayKey(), y = new Date(); y.setDate(y.getDate() - 1); const D = save.daily;
    const can = D.last !== today, streak = D.last === today ? D.streak : D.last === dayKey(y) ? D.streak % 7 : 0; return { can, day: can ? streak : (D.streak - 1) % 7 }; } // day = index of today's box
  const ACH = [
    { id: 'first', ic: '🏁', name: 'First dive', desc: 'Clear your first level', goal: 1, v: () => Math.max(save.stats.wins, Object.keys(save.stars).length), r: 50 },
    { id: 'wins10', ic: '🌊', name: 'Deep diver', desc: 'Clear 10 levels', goal: 10, v: () => Object.keys(save.stars).length, r: 200 },
    { id: 'stars10', ic: '⭐', name: 'Star collector', desc: 'Collect 10 stars', goal: 10, v: () => totalStars(), r: 120 },
    { id: 'stars45', ic: '🌟', name: 'Star hoarder', desc: 'Collect 45 stars', goal: 45, v: () => totalStars(), r: 400 },
    { id: 'perfect', ic: '💎', name: 'Flawless', desc: 'Get 3 stars on a level', goal: 1, v: () => Object.values(save.stars).filter(x => x >= 3).length, r: 80 },
    { id: 'perfect5', ic: '👑', name: 'Perfectionist', desc: 'Get 3 stars on 5 levels', goal: 5, v: () => Object.values(save.stars).filter(x => x >= 3).length, r: 250 },
    { id: 'dig', ic: '⛏️', name: 'Sand shoveler', desc: 'Dig 300 sand', goal: 300, v: () => save.stats.dug, r: 120 },
    { id: 'treasure', ic: '🐚', name: 'Treasure hunter', desc: 'Dig out 40 treasures', goal: 40, v: () => save.stats.treasures, r: 150 },
    { id: 'pearls', ic: '🔴', name: 'Pearl pusher', desc: 'Deliver 30 energy pearls', goal: 30, v: () => save.stats.pearls, r: 150 },
    { id: 'world1', ic: '🏝️', name: 'Sunlit Shallows', desc: 'Clear all of world 1', goal: 10, v: () => [...Array(10).keys()].filter(i => save.stars[i + 1]).length, r: 500 },
    { id: 'shopper', ic: '🛍️', name: 'Fresh look', desc: 'Buy something in the shop', goal: 1, v: () => Object.keys(save.owned).length, r: 60 },
  ];
  const claimableCount = () => ACH.filter(a => !save.ach[a.id] && a.v() >= a.goal).length + (dailyState().can ? 1 : 0);
  function buildRewards() {
    const ds = dailyState(), el = $('#daily'); el.innerHTML = '';
    DAILY.forEach((n, i) => { const d = document.createElement('div'); d.className = 'day' + (i === 6 ? ' big' : '') + (i < ds.day || (!ds.can && i === ds.day) ? ' done' : '') + (ds.can && i === ds.day ? ' today' : '');
      d.innerHTML = `<span>Day ${i + 1}</span><i class="coin"></i><b>${n}</b>`; el.appendChild(d); });
    const btn = $('#dailyClaim'); btn.disabled = !ds.can; btn.textContent = ds.can ? `Claim ${DAILY[ds.day]} coins` : 'Come back tomorrow';
    const ul = $('#achList'); ul.innerHTML = '';
    ACH.slice().sort((a, b) => (!!save.ach[a.id] - !!save.ach[b.id]) || ((b.v() >= b.goal) - (a.v() >= a.goal))).forEach(a => { const v = Math.min(a.goal, a.v()), done = !!save.ach[a.id], ready = !done && v >= a.goal;
      const li = document.createElement('li'); li.className = done ? 'done' : '';
      li.innerHTML = `<span class="ai">${a.ic}</span><span class="at"><b></b><small></small><div class="bar"><i style="width:${(v / a.goal * 100).toFixed(0)}%"></i></div></span><button class="claim" ${ready ? '' : 'disabled'}><i class="coin"></i>${done ? '✓' : a.r}</button>`;
      li.querySelector('b').textContent = a.name; li.querySelector('small').textContent = `${a.desc} · ${v}/${a.goal}`;
      li.querySelector('.claim').onclick = () => { if (!ready) return; save.ach[a.id] = true; addCoins(a.r, a.name); buzz(20); buildRewards(); refreshHome(); };
      ul.appendChild(li); });
    syncCoins();
  }
  $('#dailyClaim').onclick = () => { const ds = dailyState(); if (!ds.can) return; save.daily = { last: dayKey(), streak: ds.day + 1 }; addCoins(DAILY[ds.day], `Day ${ds.day + 1}`); buzz(25); buildRewards(); refreshHome(); };

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
      const tg = document.createElement('span'); if (eq) { tg.className = 'tag eq'; tg.textContent = 'Equipped'; } else if (own) { tg.className = 'tag'; tg.textContent = 'Owned'; } else { tg.className = 'pr'; tg.innerHTML = `<i class="coin"></i>${it.price}`; } b.appendChild(tg);
      b.onclick = () => { click(); shopSel = it.id; tryOn(); buildShop(); }; grid.appendChild(b); });
    makeThumbs(shopTab);
    const it = World.SKINS[shopTab].find(x => x.id === shopSel), own = owns(shopTab, it.id), eq = save.equip[shopTab] === it.id, act = $('#shopAct');
    $('#shop .shop-stage').dataset.rar = World.rarityOf(it); $('#shopRar').textContent = World.rarityOf(it);
    $('#shopSelName').textContent = it.name; $('#shopSelSub').textContent = eq ? 'Equipped' : own ? 'Owned · tap to wear' : `${it.price.toLocaleString()} coins`;
    act.className = 'cta shop-act' + (eq ? ' equipped' : own ? ' owned' : save.coins < it.price ? ' cant' : '');
    act.innerHTML = eq ? 'Equipped ✓' : own ? 'Wear it' : `<i class="coin"></i> Buy ${it.price.toLocaleString()}`;
    act.onclick = () => { if (eq) return;
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
  async function openRanks() {
    const st = $('#lbStatus'), list = $('#lbList'), me = $('#lbMe'); st.textContent = 'Loading…'; list.innerHTML = ''; me.innerHTML = '';
    await LB.ready;
    if (!LB.db) { st.textContent = 'Global ranks appear when you play on claude.ai. Your own best so far:'; renderRows([Object.assign(myEntry(), { id: 'me', isMe: true })]); return; }
    pushScore(); if (LB.unsub) LB.unsub();
    LB.unsub = LB.db.collection('board').orderBy('stars', 'desc').limit(100).onSnapshot(async snap => {
      const rows = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.stars - a.stars) || (b.levels - a.levels) || (b.score - a.score));
      st.textContent = rows.length ? `${rows.length} diver${rows.length === 1 ? '' : 's'} · live` : 'No scores yet: clear a level to be first!'; await renderRows(rows); },
      er => { st.textContent = 'Leaderboard is offline right now. Your own best:'; renderRows([Object.assign(myEntry(), { id: 'me', isMe: true })]); });
  }
  async function renderRows(rows) {
    const list = $('#lbList'), me = $('#lbMe'); let ps = {};
    try { if (LB.user && rows.length) ps = await LB.user.profiles(rows.map(r => r.id).filter(id => id !== 'me')); } catch (er) {}
    const row = (r, i) => { const li = document.createElement('li'); const mine = r.isMe || (LB.uid && r.id === LB.uid); li.className = 'lb-row' + (mine ? ' me' : '');
      const rk = document.createElement('span'); rk.className = 'rk' + (i === 0 ? ' g' : i === 1 ? ' s' : i === 2 ? ' b' : ''); rk.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`; li.appendChild(rk);
      const p = ps[r.id]; if (p && p.avatarUrl) { const im = document.createElement('img'); im.src = p.avatarUrl; im.alt = ''; li.appendChild(im); } else { const av = document.createElement('span'); av.className = 'av'; av.textContent = (r.nick || 'D')[0].toUpperCase(); li.appendChild(av); }
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (r.nick || (p && p.name) || 'Diver') + (mine ? ' (you)' : ''); const sm = document.createElement('small'); sm.textContent = `${r.levels || 0} levels cleared`; nm.appendChild(sm); li.appendChild(nm);
      const sv = document.createElement('span'); sv.className = 'sv'; sv.innerHTML = '<i class="st">★</i>'; sv.appendChild(document.createTextNode(r.stars || 0)); li.appendChild(sv);
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = (r.score || 0).toLocaleString(); li.appendChild(sc); return li; };
    list.innerHTML = ''; me.innerHTML = '';
    if (!rows.length) { const e = document.createElement('li'); e.className = 'lb-empty'; e.textContent = 'Be the first diver on the board!'; list.appendChild(e); return; }
    rows.forEach((r, i) => list.appendChild(row(r, i)));
    if (LB.uid) { const i = rows.findIndex(r => r.id === LB.uid); if (i > 7) me.appendChild(row(rows[i], i)); }
  }

  // ---- state ----
  let engine = null, levelIdx = 0, state = 'splash', acc = 0, lastFrame = performance.now(), overTimer = 0, lowAirBeep = 0, resultShown = false;
  const held = new Set(); let heldOrder = [];
  let screenStack = [];
  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
  function setState(s) { state = s; document.body.dataset.state = s; }
  function go(id) {
    if (id === 'home' && state !== 'menu' && state !== 'splash' && !go.inHome) { go.inHome = true; try { openHome(); } finally { go.inHome = false; } return; }
    if (id === 'back') { id = screenStack.pop() || 'home'; } else { const cur = document.querySelector('.screen.on'); if (cur && cur.id !== id && id !== 'home') screenStack.push(cur.id); if (id === 'home') screenStack = []; }
    if (id === 'shop') openShop(); if (id === 'rewards') buildRewards(); if (id === 'ranks') openRanks(); else if (LB.unsub) { LB.unsub(); LB.unsub = null; }
    if (id === 'levels') buildLevels(); if (id === 'profile') buildProfile(); if (id === 'settings') syncSettings(); if (id === 'home') refreshHome();
    if (id === 'name') { $('#nameInput').value = save.name || ''; setTimeout(() => $('#nameInput').focus(), 50); }
    show(id);
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { click(); go(b.dataset.go); }));

  // ---- home ----
  const WORLDS = [{ name: 'Sunlit Shallows', from: 0, to: 10 }, { name: 'Coral Caves', from: 10, to: 20 }, { name: 'The Deep', from: 20, to: LEVELS.length }];
  function refreshHome() {
    const next = Math.min(save.unlocked, LEVELS.length);
    $('#playSub').textContent = save.unlocked > 1 ? `Continue · Level ${next}` : `Level 1 · ${LEVELS[0].name}`;
    $('#hmName').textContent = save.name || 'Diver'; $('#hmAva').textContent = (save.name || 'D')[0].toUpperCase(); $('#hmStars').textContent = totalStars(); $('#hmLvl').textContent = next;
    $('#hmDot').hidden = claimableCount() === 0; syncCoins();
  }

  let menuEngine = null;
  function showMenuScene() { if (menuKeep) { menuKeep = false; return; } if (menuEngine && world.e === menuEngine) return; /* already on screen: never rebuild the same scene */ menuEngine = new Engine(LEVELS[0]); menuEngine.time = 1e9; menuEngine.oxygen = 1e9; menuEngine.menu = true; world.loadLevel(menuEngine); world.onTick(menuEngine, performance.now()); }
  function openHome() { setPeekSafe(); doodleLevel = false; document.body.classList.remove('doodle-play'); Doodle.hide(); setState('menu'); go('home'); showMenuScene(); idleThumbs(); }
  function setPeekSafe() { try { world.peek = false; } catch {} }
  // ---- intro cinematic: plays once (first launch) or on request; skippable; can't double-start
  // EXPERIMENT: the first DOODLE_LEVELS levels are drawn in the hand-drawn style. Set to 0 to revert.
  const DOODLE_LEVELS = 0; let doodleLevel = false;
  function tickWorld(e, t) { if (e === engine && e.events && e.events.some(v => v.type === 'dig')) buzz(5); world.onTick(e, t); if (doodleLevel && e === engine) Doodle.levelTick(e); }
  let cineRunning = false;
  // ---- opening cinematic: the real game, played by itself (route verified to win Level 1)
  let cine = null, cineEngine = null;
  let menuKeep = false; // after the intro, its finished tank stays on as the menu backdrop (no reload, no jump)
  const CINE_ROUTE = 'RRRRDDRRRRRDULLLLLULLDRRRRRRRDD';
  function cap(text) { const el = $('#cineCap'); el.classList.remove('on'); clearTimeout(cap.tm); cap.tm = setTimeout(() => { el.textContent = text; el.classList.toggle('on', !!text); }, text ? 260 : 0); }
  function startCine() {
    if (cineRunning) return; cineRunning = true; Doodle.hide();
    setState('cine'); show(null); $('#skipIntro').hidden = false; $('#cineTitle').classList.remove('on');
    // same level, same look as the menu backdrop: swap engines in one frame and keep the camera where it is, so it just flies in
    const cp = world.camPos.clone(), ct = world.camTarget.clone();
    cineEngine = new Engine(LEVELS[0]); cineEngine.time = 999; cineEngine.oxygen = 999; cineEngine.cine = true;
    world.loadLevel(cineEngine); world.onTick(cineEngine, performance.now()); world.startPlay(); world.camPos.copy(cp); world.camTarget.copy(ct);
    world.cineCam = true; world.cineT = 0; world.cineShot = 'descent'; world.storyDim = 1; cine = { t: 0, i: 0, wait: 0, wonAt: null, said: {} }; acc = 0; frame.last = performance.now();
    cap('Long ago, the Glow Reef shone with the light of a thousand energy pearls.');
  }
  function cineTick(realDt, now) {
    cine.t += realDt; world.cineT = cine.t; const c = cine, E = cineEngine, T = c.t;
    // act 1 - the legend (dark reef, camera sinks from the surface)
    if (T > 4.8 && !c.said.b) { c.said.b = 1; cap('Then a great storm scattered the pearls… and every gate in the deep went dark.'); }
    // act 2 - the hero
    if (T > 9.4 && !c.said.h) { c.said.h = 1; world.cineShot = 'hero'; cap('Only one little diver was brave enough to bring the light back.'); world.playerMood('joy', 1.3); Audio.play('hi'); }
    // act 3 - the first dive
    if (T > 13.2 && !c.said.p) { c.said.p = 1; world.cineShot = 'play'; cap('Swim into the sand to dig a path…'); }
    if (T > 13.6 && c.i < CINE_ROUTE.length) { c.wait -= realDt * 1000; if (c.wait <= 0 && (!E.moveQueue || E.moveQueue.length === 0)) { E.press({ U: 'up', D: 'down', L: 'left', R: 'right' }[CINE_ROUTE[c.i++]]); c.wait = 300; } }
    if (c.i >= 22 && !c.said.c) { c.said.c = 1; cap('…then push the energy pearl into the gate!'); }
    if (E.gate && E.gate.open && !c.said.d) { c.said.d = 1; c.gateAt = T; world.cineShot = 'gate'; cap('The first gate wakes, and light pours back into the reef!'); }
    world.storyDim = c.gateAt !== undefined ? Math.max(0, 1 - (T - c.gateAt) / 2.2) : 1;
    acc += Math.min(250, realDt * 1000);
    while (acc >= E.tickMs) { acc -= E.tickMs; E.step(); world.onTick(E, now - acc); }
    // finale
    if (E.state === 'won' && c.wonAt === null) { c.wonAt = T; world.cineShot = 'wide'; cap('29 more gates still sleep. The reef is counting on you!'); }
    if (c.wonAt !== null && T - c.wonAt > 3.4 && !c.said.e) { c.said.e = 1; cap(''); $('#cineTitle').classList.add('on'); }
    if (c.wonAt !== null && T - c.wonAt > 6.2) endCine();
  }
  function endCine() {
    if (!cineRunning) return; cineRunning = false; cine = null; world.cineCam = false; world.storyDim = 0; cap(''); $('#cineTitle').classList.remove('on');
    menuEngine = cineEngine; cineEngine.menu = true; world.menuMode = true; world.playing = false; world.fitCamera(false); menuKeep = true; // the intro's tank becomes the menu backdrop as-is
    $('#skipIntro').hidden = true; save.introSeen = true; persist(); openHome();
  }
  $('#skipIntro').addEventListener('click', () => { click(); endCine(); });
  $('#btnReplayIntro').addEventListener('click', () => { click(); startCine(); });

  function buildLevels() {
    const box = $('#worlds'); box.innerHTML = '';
    WORLDS.forEach((w, wi) => {
      const sec = document.createElement('div'); sec.className = 'world w' + wi;
      let st = 0; for (let i = w.from; i < w.to; i++) st += save.stars[i + 1] || 0;
      sec.innerHTML = `<h3><em>World ${wi + 1}</em>${w.name}<span>★ ${st} / ${(w.to - w.from) * 3}</span></h3>`;
      const grid = document.createElement('div'); grid.className = 'lgrid';
      for (let i = w.from; i < w.to; i++) {
        const n = i + 1, locked = n > save.unlocked, stars = save.stars[n] || 0;
        const b = document.createElement('button'); b.className = 'lvl' + (locked ? ' locked' : '') + (n === save.unlocked ? ' cur' : '') + (stars === 3 ? ' perfect' : '');
        b.setAttribute('aria-label', locked ? `Level ${n}, locked` : `Level ${n}, ${LEVELS[i].name}, ${stars} stars`);
        b.innerHTML = locked ? `<span class="n">${n}</span><svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
          : `<span class="n">${n}</span><span class="st">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></span>`;
        if (!locked) b.onclick = () => { click(); startLevel(i); };
        grid.appendChild(b);
      }
      sec.appendChild(grid); box.appendChild(sec);
    });
    $('#lvStars').textContent = `${totalStars()} / ${LEVELS.length * 3}`;
  }
  function buildProfile() {
    $('#profName').textContent = save.name || 'Diver';
    $('#profAva').textContent = (save.name || 'D')[0].toUpperCase();
    const cleared = Object.keys(save.stars).length, best = Object.values(save.best).reduce((a, b) => a + b, 0), three = Object.values(save.stars).filter(s => s === 3).length;
    $('#profSub').textContent = `Reached level ${Math.min(save.unlocked, LEVELS.length)} of ${LEVELS.length}`;
    $('#profStats').innerHTML = `<div class="stat"><b>${totalStars()}</b><span>stars</span></div><div class="stat"><b>${cleared}</b><span>levels cleared</span></div><div class="stat"><b>${three}</b><span>perfect levels</span></div>
      <div class="stat" style="grid-column:span 3"><b>${best.toLocaleString()}</b><span>total best score</span></div>`;
  }
  $('#nameSave').onclick = () => { const v = $('#nameInput').value.trim().slice(0, 14); save.name = v; persist(); click(); go('back'); refreshHome(); };
  $('#nameInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('#nameSave').click(); });

  // ---- levels ----
  function startLevel(i, custom) {
    if (typeof booting !== 'undefined' && booting) dropLoader();
    runTreasures = 0;
    Doodle.hide();
    levelIdx = i; const lv = custom || LEVELS[i];
    engine = new Engine(lv); world.loadLevel(engine);
    window.__LEVELSCENE = (custom || LEVELS[i]).scene || null; history = []; stuckTimer = 0; stuckShown = false;
    { const ph = $('#pauseHint'); if (ph) ph.textContent = lv.hint || ''; }
    doodleLevel = !custom && i < DOODLE_LEVELS; document.body.classList.toggle('doodle-play', doodleLevel); if (doodleLevel) Doodle.levelStart(engine);
    tickWorld(engine, performance.now());
    held.clear(); heldOrder = []; acc = 0; overTimer = 0; lowAirBeep = 0; resultShown = false; endTouch();
    $('#introNum').textContent = `Level ${i + 1} of ${LEVELS.length}`; $('#introName').textContent = lv.name; $('#introHint').textContent = lv.hint;
    $('#introBalls').textContent = engine.ballsTotal === 1 ? '1 energy ball' : `${engine.ballsTotal} energy balls`; $('#introAir').textContent = `${lv.time}s of air`;
    screenStack = []; setState('intro'); show('intro'); hudKey = ''; updateHud();
    Audio.setMusic(save.settings.music);
  }
  function beginPlay() { if (state !== 'intro' && state !== 'paused') return; const fromIntro = state === 'intro'; setState('playing'); show(null); lastFrame = performance.now(); acc = 0; world.lastTick = performance.now(); if (fromIntro) { world.startPlay(); toast(`Level ${levelIdx + 1} · ${LEVELS[levelIdx].name}`); } }
  let toastTimer = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200); }
  function pause() { if (state !== 'playing') return; endTouch(); setPeek(false); setState('paused'); syncSound(); show('pause'); }
  function restart() { click(); startLevel(levelIdx); beginPlay(); }
  // ---- undo: a snapshot of the whole puzzle before every move the diver makes
  let history = [], stuckTimer = 0, stuckShown = false;
  function cloneEngine(e) { const n = Object.create(Engine.prototype); Object.assign(n, e);
    n.grid = e.grid.slice(); n.water = e.water.slice(); const map = new Map(); n.objects = new Map();
    for (const [id, o] of e.objects) { const c = { ...o }; map.set(o, c); n.objects.set(id, c); }
    n.obj = e.obj.map(o => (o ? map.get(o) || null : null)); n.player = e.player ? map.get(e.player) : null; n.gate = e.gate ? { ...e.gate } : null;
    n.events = []; n.moveQueue = []; n.held = null; return n; }
  function undo() {
    if (!history.length || !engine || (state !== 'playing' && state !== 'over')) { if (state === 'playing') toast('Nothing to undo yet'); return; }
    click(); buzz(10); const snap = history.pop(); const cp = world.camPos.clone(), ct = world.camTarget.clone();
    engine = cloneEngine(snap); world.loadLevel(engine); world.onTick(engine, performance.now()); world.startPlay(); world.camPos.copy(cp); world.camTarget.copy(ct);
    held.clear(); heldOrder = []; endTouch(); acc = 0; overTimer = 0; resultShown = false; hudKey = ''; lastScore = -1;
    if (state !== 'playing') { setState('playing'); show(null); } updateHud(); }
  $('#btnUndo').onclick = undo;

  function finishLevel() {
    resultShown = true;
    const won = engine.state === 'won'; const n = levelIdx + 1;
    setState('over'); show('result');
    const r = $('#result'); r.classList.toggle('win', won); r.classList.toggle('lose', !won);
    const prevBest = save.best[n] || 0;
    $('#resKicker').textContent = `Level ${n} · ${LEVELS[levelIdx].name}`;
    $('#resScore').textContent = engine.score.toLocaleString();
    const starEls = [...document.querySelectorAll('#resStars i')]; starEls.forEach(s => s.className = '');
    if (won) {
      const frac = engine.oxygen / engine.time; const stars = frac >= 0.6 ? 3 : frac >= 0.3 ? 2 : 1;
      const prevStars = save.stars[n] || 0, firstClear = !prevStars;
      save.stars[n] = Math.max(prevStars, stars); save.best[n] = Math.max(prevBest, engine.score);
      save.stats.wins++; save.stats.dug += engine.dug || 0;
      { const parts = [['clear', 20], ['stars', stars * 10], ['first clear', firstClear ? 30 : 0], ['new stars', Math.max(0, stars - prevStars) * 15 * (firstClear ? 0 : 1)], ['treasures', runTreasures * 2]].filter(p => p[1] > 0), total = parts.reduce((a, p) => a + p[1], 0);
        save.coins += total; $('#resCoins').hidden = false; $('#resCoinWhy').textContent = parts.map(p => `${p[0]} +${p[1]}`).join(' · ');
        const el = $('#resCoinN'); let shown = 0; const t0 = performance.now(); const tick = (now) => { const k = Math.min(1, (now - t0) / 900); shown = Math.round(total * k * (2 - k)); el.textContent = `+${shown}`; if (k < 1) requestAnimationFrame(tick); else Audio.play('treasure'); }; setTimeout(() => requestAnimationFrame(tick), 900); }
      pushScore();
      if (n >= save.unlocked && n < LEVELS.length) save.unlocked = n + 1; persist();
      $('#resTitle').textContent = n === LEVELS.length ? 'Cave escaped!' : ['Energized!', 'Great dive!', 'Brilliant!'][stars - 1];
      $('#resStars').hidden = false;
      starEls.forEach((s, i) => setTimeout(() => { s.classList.add('show'); if (i < stars) { s.classList.add('on'); Audio.play('click'); buzz(12); } }, 250 + i * 260));
      $('#resBest').hidden = !(engine.score > prevBest && prevBest > 0);
      $('#resStats').innerHTML = `<div class="stat"><b>${Math.ceil(engine.oxygen)}s</b><span>air left</span></div><div class="stat"><b>${engine.ballsIn}/${engine.ballsTotal}</b><span>energy</span></div>`;
      $('#btnNext').textContent = 'Next level'; $('#btnNext').hidden = n >= LEVELS.length; $('#btnNext').classList.remove('green');
      $('#btnRetry').lastChild.textContent = 'Replay';
    } else {
      $('#resCoins').hidden = true; save.stats.dug += engine.dug || 0; persist();
      const cause = { crushed: 'Crushed!', monster: 'Gobbled!', oxygen: 'Out of air!', self: 'Restarted', spiked: 'Spiked!' }[engine.deathCause] || 'Dive over';
      $('#resTitle').textContent = cause; $('#resStars').hidden = true; $('#resBest').hidden = true;
      $('#resStats').innerHTML = `<div class="stat"><b>${engine.ballsIn}/${engine.ballsTotal}</b><span>energy</span></div><div class="stat"><b>${Math.max(0, Math.ceil(engine.oxygen))}s</b><span>air left</span></div>`;
      $('#btnNext').textContent = history.length ? 'Undo last move' : 'Try again'; $('#btnNext').hidden = false; $('#btnNext').classList.add('green');
      $('#btnRetry').lastChild.textContent = 'Restart';
    }
  }

  // ---- HUD ----
  const hud = { airTxt: $('#airTxt'), airFill: $('#airFill'), air: $('#air'), fill: $('#energyFill'), etxt: $('#energyTxt'), lvl: $('#hudLvl'), score: $('#hudScore'), gate: $('#hudGate') };
  let hudKey = '', lastScore = -1;
  function updateHud() {
    if (!engine) return;
    hud.airTxt.textContent = Math.max(0, Math.ceil(engine.oxygen));
    hud.airFill.style.width = (Math.max(0, Math.min(1, engine.oxygen / engine.time)) * 100).toFixed(1) + '%';
    { const fr = engine.oxygen / engine.time, st = fr >= 0.6 ? 3 : fr >= 0.3 ? 2 : 1; const el = $('#airStars'); if (el && el.dataset.st !== String(st)) { el.dataset.st = st; [...el.children].forEach((c, k) => c.classList.toggle('off', k >= st)); } }
    hud.air.classList.toggle('low', engine.oxygen < 15 && engine.state === 'playing');
    const key = engine.ballsIn + '/' + engine.ballsTotal + (engine.gate.open ? 'o' : '');
    if (key !== hudKey) { hudKey = key;
      hud.fill.style.width = (engine.ballsTotal ? engine.ballsIn / engine.ballsTotal * 100 : 100) + '%';
      hud.etxt.textContent = engine.gate.open ? 'Gate open! Swim in' : `${engine.ballsIn} / ${engine.ballsTotal} energy`;
      hud.gate.classList.toggle('open', !!engine.gate.open);
      hud.gate.innerHTML = engine.gate.open ? '<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    }
    hud.lvl.textContent = levelIdx + 1;
    { const tt = $('#ddTitle'), et = $('#ddEtxt'); if (tt) tt.textContent = `Level ${levelIdx + 1}`; if (et) et.textContent = engine.gate.open ? 'Gate open!' : `${engine.ballsIn} / ${engine.ballsTotal} Energy`; }
    if (engine.score !== lastScore) { if (lastScore >= 0 && engine.score > lastScore) { hud.score.classList.remove('bump'); void hud.score.offsetWidth; hud.score.classList.add('bump'); } lastScore = engine.score; hud.score.textContent = engine.score.toLocaleString(); }
  }

  // ---- input: keyboard ----
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
  function setHeld(dir, on) {
    if (on) { if (!held.has(dir)) { held.add(dir); heldOrder.push(dir); if (engine) engine.press(dir); } }
    else { held.delete(dir); heldOrder = heldOrder.filter(d => d !== dir); }
    if (engine) engine.hold(heldOrder.length ? heldOrder[heldOrder.length - 1] : null);
  }
  addEventListener('keydown', ev => {
    if (ev.repeat) return;
    if (state === 'splash') { unlock(); return; }
    if (state === 'cine') { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#skipIntro').click(); return; } return; }
    if (false) { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); Doodle.skip(); } return; }
    const dir = KEYS[ev.key];
    if (dir) { ev.preventDefault(); if (state === 'intro') beginPlay(); if (state === 'playing') setHeld(dir, true); return; }
    if (ev.key === 'Escape' || ev.key === 'p' || ev.key === 'P') { if (state === 'playing') pause(); else if (state === 'paused') beginPlay(); }
    if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'u' || ev.key === 'U' || ev.key === 'Backspace') { ev.preventDefault(); undo(); return; }
    if (ev.key === 'r' || ev.key === 'R') { if (state === 'playing') { restart(); return; } else if (state === 'over' || state === 'paused') restart(); }
    if (ev.key === 'Enter' || ev.key === ' ') { if (state === 'intro') beginPlay(); else if (state === 'over' && resultShown) $('#btnNext').hidden ? restart() : $('#btnNext').click(); }
  });
  addEventListener('keyup', ev => { const dir = KEYS[ev.key]; if (dir) setHeld(dir, false); });
  addEventListener('blur', () => { held.clear(); heldOrder = []; endTouch(); if (engine) engine.hold(null); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); const ac = Audio.ctx; if (ac) { try { document.hidden ? ac.suspend() : ac.resume(); } catch (er) {} } }); // silent + paused in the background

  // ---- hold to view the whole map ----
  const mapBtn = $('#btnMap');
  function setPeek(on) { world.peek = on; mapBtn.classList.toggle('on', on); $('#mapTag').classList.toggle('on', on); if (on) { buzz(8); endTouch(); } }
  mapBtn.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); try { mapBtn.setPointerCapture(ev.pointerId); } catch {} if (state === 'playing' || state === 'intro') setPeek(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => mapBtn.addEventListener(n, () => setPeek(false)));
  mapBtn.addEventListener('contextmenu', ev => ev.preventDefault());
  $('#btnMapView').addEventListener('click', () => { if (state === 'playing' || state === 'intro') { click(); setPeek(!world.peek); } });
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
    const slow = 560, fast = engine ? engine.tickMs : 150; return slow + (fast - slow) * Math.pow(t, 0.8); }
  const onStickDown = ev => {
    if (state === 'intro') { beginPlay(); }
    if (state !== 'playing' || (ev.pointerType === 'mouse' && ev.button !== 0)) return; // touch, pen, or left-mouse drag
    const R = stickR(); touch = { id: ev.pointerId, ax: ev.clientX, ay: ev.clientY, x: ev.clientX, y: ev.clientY, dir: null, t: 0, wait: 0, full: false, R };
    stickEl.style.setProperty('--r', R + 'px'); stickEl.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`; knobEl.style.transform = 'translate(0,0)'; stickEl.classList.add('on'); stickEl.classList.remove('fast');
  };
  canvas.addEventListener('pointerdown', onStickDown); $('#doodle').addEventListener('pointerdown', onStickDown);
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
  function unlock() { if (state !== 'splash') return; Audio.init(); Audio.resume(); Audio.setMusic(save.settings.music); Audio.setMuted(false); tryFullscreen(); if (!save.introSeen) startCine(); else openHome(); }
  $('#splash').addEventListener('pointerup', unlock);
  $('#btnPlay').onclick = () => { click(); buzz(10); startLevel(Math.min(save.unlocked, LEVELS.length) - 1); };
  $('#btnDive').onclick = () => { click(); beginPlay(); };
  $('#btnPause').onclick = () => { click(); pause(); };
  $('#btnRestartHud').onclick = () => { if (state === 'playing') { buzz(20); restart(); toast('Fresh start!'); } };
  $('#btnResume').onclick = () => { click(); beginPlay(); };
  $('#btnRestart').onclick = restart;
  $('#btnQuit').onclick = () => { click(); openHome(); };
  $('#btnResHome').onclick = () => { click(); openHome(); };
  function nextLevel() { click(); startLevel(levelIdx + 1); }
  $('#btnNext').onclick = () => { if (engine.state === 'won' && levelIdx + 1 < LEVELS.length) nextLevel(); else if (engine.state !== 'won' && history.length) undo(); else restart(); };
  $('#btnRetry').onclick = () => { restart(); };
  $('#btnResLevels').onclick = () => { click(); openHome(); go('levels'); };
  function tryFullscreen(force) { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen && (force || !isTouch)) el.requestFullscreen().catch(() => {}); }
  // settings
  function applyAudio() { Audio.setMusic(save.settings.music); Audio.setVolumes(Audio.settings.music, save.settings.sfx ? 0.9 : 0); }
  function syncSound() { const on = save.settings.music || save.settings.sfx; $('#sndLbl').textContent = on ? 'Sound on' : 'Muted'; $('#sndWave').style.display = on ? '' : 'none'; }
  function syncSettings() { $('#setMusic').checked = save.settings.music; $('#setSfx').checked = save.settings.sfx; $('#setVibe').checked = save.settings.vibe;
    document.querySelectorAll('#setQuality button').forEach(b => b.classList.toggle('on', b.dataset.q === gfxMode()));
    const gn = $('#gfxNow'); if (gn) gn.textContent = gfxMode() === 'auto' ? `Now: ${world.quality[0].toUpperCase()}${world.quality.slice(1)}` : ''; }
  $('#setMusic').onchange = e => { save.settings.music = e.target.checked; applyAudio(); persist(); };
  $('#setSfx').onchange = e => { save.settings.sfx = e.target.checked; applyAudio(); persist(); };
  $('#setVibe').onchange = e => { save.settings.vibe = e.target.checked; persist(); buzz(15); };
  document.querySelectorAll('#setQuality button').forEach(b => b.onclick = () => { click(); save.settings.gfx = b.dataset.q; persist(); if (b.dataset.q !== 'auto') world.setQuality(b.dataset.q); syncSettings(); });
  world.onQuality = () => syncSettings();
  $('#btnSound').onclick = () => { const on = !(save.settings.music || save.settings.sfx); save.settings.music = on; save.settings.sfx = on; applyAudio(); persist(); syncSound(); click(); };
  $('#btnReset').onclick = () => { if (confirm('Erase all progress? This can\'t be undone.')) { save.unlocked = 1; save.stars = {}; save.best = {}; persist(); refreshHome(); toast('Progress erased'); } };
  syncSettings();
  // graphics: 'auto' (default) adapts to the frame rate; an older 'Battery saver' choice carries over as low
  function gfxMode() { if (!save.settings.gfx) save.settings.gfx = save.settings.quality === 'low' ? 'low' : 'auto'; return save.settings.gfx; }
  if (gfxMode() !== 'auto') world.setQuality(gfxMode());
  if (!save.settings.sfx) Audio.setVolumes(Audio.settings.music, 0);

  // ---- loop ----
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.max(0, (now - lastFrame) / 1000); const dt = Math.min(0.05, realDt); lastFrame = now;
    if (engine && (state === 'playing' || state === 'over')) {
      if (state === 'playing') {
        stickTick(realDt * 1000);
        acc += (now - (frame.last || now)); frame.last = now;
        while (acc >= engine.tickMs) {
          acc -= engine.tickMs;
          const pre = (engine.moveQueue.length || engine.held) && engine.player ? cloneEngine(engine) : null, px0 = engine.player && engine.player.x, py0 = engine.player && engine.player.y;
          engine.step(); tickWorld(engine, now - acc);
          if (pre && engine.player && (engine.player.x !== px0 || engine.player.y !== py0)) { history.push(pre); if (history.length > 200) history.shift(); stuckTimer = 0; }
          if (engine.state !== 'playing') { overTimer = 0; setState('over'); held.clear(); heldOrder = []; endTouch(); buzz(engine.state === 'won' ? 30 : [40, 40, 60]); break; }
        }
        if (engine.state === 'playing') {
          stuckTimer += realDt; if (!stuckShown && stuckTimer > 22 && engine.ballsIn < engine.ballsTotal) { stuckShown = true; toast(isTouch ? 'Stuck? Tap ↶ to undo, or ⟲ to restart' : 'Stuck? Press Z to undo, R to restart'); }
          if (engine.oxygen < 15) { lowAirBeep -= dt; if (lowAirBeep <= 0) { lowAirBeep = engine.oxygen < 6 ? 0.5 : 1; Audio.play('lowAir'); } }
        }
        updateHud();
      } else { // over: keep physics animating briefly, then show result
        overTimer += realDt; frame.last = now;
        acc += dt * 1000; while (acc >= engine.tickMs) { acc -= engine.tickMs; engine.step(); tickWorld(engine, now - acc); }
        updateHud();
        if (overTimer > 1.4 && !resultShown) finishLevel();
      }
    } else {
      frame.last = now;
      if (state === 'cine' && cine) cineTick(realDt, now);
      else if (state === 'menu' && menuEngine) { acc += dt * 1000; while (acc >= menuEngine.tickMs) { acc -= menuEngine.tickMs; menuEngine.step(); world.onTick(menuEngine, now - acc); } }
    }
    // the 3D world sleeps while the paper menu / intro covers the screen
    if (!doodleLevel) { world.update(dt, now); world.render(); if (gfxMode() === 'auto' && (state === 'playing' || state === 'menu' || state === 'cine')) world.autoQuality(realDt); }
    else if (doodleLevel && engine) $('#fx').classList.toggle('lowair', state === 'playing' && engine.oxygen < 15);
  }
  addEventListener('resize', () => world.resize());
  canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); if (state === 'playing') pause(); }, false);
  canvas.addEventListener('webglcontextrestored', () => { try { const e = state === 'menu' || state === 'splash' ? menuEngine : engine; if (e) { world.loadLevel(e); world.onTick(e, performance.now()); } } catch (er) {} }, false);
  requestAnimationFrame(frame);
  // ---- boot: loading screen -> decode art -> pre-build & pre-compile the intro level, a monster level and the menu -> title screen
  setState('splash'); show(null); let booting = true;
  const dropLoader = () => { booting = false; const L = $('#loader'); if (L) { L.classList.add('done'); setTimeout(() => L.remove(), 700); } };
  (async () => { const bar = $('#loadBar'), tip = $('#loadTip'), pause = () => new Promise(r => setTimeout(r, 0)); let shown = 0;
    const prog = (k, msg) => { shown = Math.max(shown, k); if (bar) bar.style.width = (shown * 100).toFixed(0) + '%'; if (msg && tip) tip.textContent = msg; };
    try {
      prog(0.04, 'Filling the tank…'); await World.ready(k => prog(0.04 + k * 0.46));
      if (!booting) return; prog(0.52, 'Warming up the lights…'); await pause(); if (!booting) return; const e1 = new Engine(LEVELS[0]); e1.time = e1.oxygen = 999; world.warm(e1);
      if (!booting) return; prog(0.72, 'Waking up the reef…'); await pause(); if (!booting) return; const e2 = new Engine(LEVELS[Math.min(13, LEVELS.length - 1)]); e2.time = e2.oxygen = 999; world.warm(e2);
      if (!booting) return; prog(0.9, 'Almost there…'); await pause(); if (!booting) return; showMenuScene(); world.warm(menuEngine);
      if (gfxMode() === 'auto') { try { world.benchmark(); } catch (er) {} } // settle Auto's tier now, behind the loader, not mid-game
    } catch (er) { console.warn('preload', er); try { showMenuScene(); } catch (e2) {} }
    if (!booting) return; prog(1, 'Ready!'); await new Promise(r => setTimeout(r, 250)); if (!booting) return;
    show('splash'); dropLoader(); setTimeout(idleThumbs, 4000); })();
})();

})();
