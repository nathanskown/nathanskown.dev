// Floor layouts: 25 columns x 15 rows, 32px tiles.
//   #  wall          .  floor        P  player start     E  stairs up
//   S  zombie spawn  B  boss start   p  pillar           c  car (pairs join into one car)
//   d  desk / bench / table (looks depend on the zone)   o  planter / tank / pod
//   h  toxic spill (walkable, hurts you)
// Floors 1-10 and the boss arenas are hand-made. The other floors are generated from a fixed seed
// (same layout every time) out of zone-themed building blocks, mirrored left/right.
// To hand-design any floor, add it to FLOORS below and the generator will leave it alone.

import { COLS, ROWS } from '../config.js';
import { seeded } from '../art/pixel.js';
import { pickEnemy, ZONE_MINIONS } from './enemies.js';

export const ZONES = [
  { id: 1, name: 'Parking Garage & Lobby', short: 'THE GARAGE', from: 1, to: 10 },
  { id: 2, name: 'The Offices', short: 'THE OFFICES', from: 11, to: 20 },
  { id: 3, name: 'The Labs', short: 'THE LABS', from: 21, to: 30 },
  { id: 4, name: 'Containment Wing', short: 'CONTAINMENT', from: 31, to: 40 },
  { id: 5, name: 'Executive Penthouse', short: 'THE PENTHOUSE', from: 41, to: 50 },
];
export const TOP_FLOOR = 50;

export function zoneOf(n) {
  return ZONES.find((z) => n >= z.from && n <= z.to) || ZONES[ZONES.length - 1];
}

export function themeFor(n) {
  if (n <= 5) return 'garage';
  if (n <= 10) return 'lobby';
  if (n <= 20) return 'office';
  if (n <= 30) return 'labs';
  if (n <= 40) return 'containment';
  return n === 50 ? 'rooftop' : 'executive';
}

const WALL = '#########################';

export const FLOORS = {
  1: { name: 'Garage Level P3', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#...cc.............cc...#',
    '#.......................#',
    '#......p.........p......#',
    '#.......................#',
    '#S.....................S#',
    '#.......................#',
    '#......p.........p......#',
    '#.......................#',
    '#...cc.............cc...#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  2: { name: 'Garage Level P2', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..cc.cc.cc.....cc.cc...#',
    '#.......................#',
    '#.......................#',
    '#..p.......p.......p....#',
    '#S.....................S#',
    '#.......................#',
    '#...cc.cc.....cc.cc.cc..#',
    '#.......................#',
    '#..p.......p.......p....#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  3: { name: 'The Ramp', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#....###.........###....#',
    '#....#.............#....#',
    '#....#..cc.....cc..#....#',
    '#.......................#',
    '#S.........ppp.........S#',
    '#.......................#',
    '#....#..cc.....cc..#....#',
    '#....#.............#....#',
    '#....###.........###....#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  4: { name: 'Garage Level P1', map: [
    WALL,
    '#S.....c....E....c.....S#',
    '#......c.........c......#',
    '#..p...........p.....p..#',
    '#.....cc...cc...cc......#',
    '#.......................#',
    '#.cc....p.......p....cc.#',
    '#S.....................S#',
    '#.cc....p.......p....cc.#',
    '#.......................#',
    '#.....cc...cc...cc......#',
    '#..p...........p.....p..#',
    '#......c.........c......#',
    '#S.....c....P....c.....S#',
    WALL,
  ] },
  5: { name: 'Loading Dock', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..cc...............cc..#',
    '#.......................#',
    '#.#######.....#######...#',
    '#.......................#',
    '#S...p.............p...S#',
    '#.......................#',
    '#...#######.....#######.#',
    '#.......................#',
    '#..cc...............cc..#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  6: { name: 'Main Lobby', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..o...ddddddddddd...o..#',
    '#.......................#',
    '#...p.......o.......p...#',
    '#.......................#',
    '#S.....................S#',
    '#.......................#',
    '#...p...............p...#',
    '#.......................#',
    '#..o.................o..#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  7: { name: 'The Lounge', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..dd.dd.........dd.dd..#',
    '#.......................#',
    '#..dd.dd....o....dd.dd..#',
    '#.......................#',
    '#S.........ooo.........S#',
    '#.......................#',
    '#..dd.dd....o....dd.dd..#',
    '#.......................#',
    '#..dd.dd.........dd.dd..#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  8: { name: 'Elevator Hall', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#.###.###.......###.###.#',
    '#.......................#',
    '#.......p.......p.......#',
    '#..o.................o..#',
    '#S.....................S#',
    '#..o.................o..#',
    '#.......p.......p.......#',
    '#.......................#',
    '#.###.###.......###.###.#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  9: { name: 'Security Checkpoint', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#.......................#',
    '#.dddddd.ddd.ddd.dddddd.#',
    '#.......................#',
    '#....o.....p.p.....o....#',
    '#S.....................S#',
    '#....o.....p.p.....o....#',
    '#.......................#',
    '#.dddddd.ddd.ddd.dddddd.#',
    '#.......................#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  10: { name: 'The Grand Atrium', boss: 'doorman', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#.......................#',
    '#....p.............p....#',
    '#.......................#',
    '#.......................#',
    '#S..........B..........S#',
    '#.......................#',
    '#.......................#',
    '#....p.............p....#',
    '#.......................#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
};

// ----------------------------------------------------------------- boss arenas
Object.assign(FLOORS, {
  20: { name: 'The Corner Office', boss: 'manager', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..dd...............dd..#',
    '#.......................#',
    '#.....p...........p.....#',
    '#.......................#',
    '#S..........B..........S#',
    '#.......................#',
    '#.....p...........p.....#',
    '#.......................#',
    '#..dd...............dd..#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  30: { name: 'Containment Tank Alpha', boss: 'specimen', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#...oo.............oo...#',
    '#...oo.....hhh.....oo...#',
    '#.......................#',
    '#.....h...........h.....#',
    '#S..........B..........S#',
    '#.....h...........h.....#',
    '#.......................#',
    '#...oo.............oo...#',
    '#...oo.....hhh.....oo...#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  40: { name: "The Warden's Block", boss: 'warden', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..###.............###..#',
    '#..#.................#..#',
    '#.......p.......p.......#',
    '#.......................#',
    '#S..........B..........S#',
    '#.......................#',
    '#.......p.......p.......#',
    '#..#.................#..#',
    '#..###.............###..#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
  50: { name: 'The Rooftop', boss: 'founder', map: [
    WALL,
    '#S..........E..........S#',
    '#.......................#',
    '#..dd...............dd..#',
    '#.......................#',
    '#.......o.......o.......#',
    '#.......................#',
    '#S..........B..........S#',
    '#.......................#',
    '#.......o.......o.......#',
    '#.......................#',
    '#..dd...............dd..#',
    '#.......................#',
    '#S..........P..........S#',
    WALL,
  ] },
});

const NAMES = {
  11: 'Mail Room', 12: 'Open Plan', 13: 'Cubicle Farm', 14: 'Break Room', 15: 'Copy Center',
  16: 'IT Department', 17: 'Call Center', 18: 'Human Resources', 19: 'Accounting',
  21: 'Decontamination', 22: 'Sample Storage', 23: 'Clean Room', 24: 'Gene Sequencing', 25: 'Animal Testing',
  26: 'Serum Bay', 27: 'Observation Deck', 28: 'Cold Storage', 29: 'Trial Ward',
  31: 'Intake', 32: 'Holding Cells', 33: 'Quarantine Block', 34: 'The Kennels', 35: 'Isolation Ward',
  36: 'Incinerator', 37: 'Security Hub', 38: 'Riot Corridor', 39: 'Solitary',
  41: 'Executive Lounge', 42: 'Investor Suite', 43: 'The Boardroom', 44: 'Private Gym', 45: 'Wine Cellar',
  46: 'Trophy Hall', 47: 'Penthouse Library', 48: "Founder's Gallery", 49: 'Private Elevator',
};

// ------------------------------------------------------------------ generator
// Building blocks for the left half of a floor (they get mirrored to the right).
// [shape rows, weight]. '.' inside a shape stays open floor.
const STAMPS = {
  office: [
    [['dddd'], 3], [['dd', 'd.'], 2], [['dd', 'dd'], 2], [['d', 'd', 'd'], 1], [['o'], 2], [['p'], 1],
    [['####', '#...', '#...'], 1], [['o.o'], 1],
  ],
  labs: [
    [['ddd'], 3], [['dddd'], 2], [['oo'], 2], [['o', 'o'], 1], [['hh', 'hh'], 2], [['hhh'], 1], [['p'], 1],
    [['###', '..#', '..#'], 1], [['o.o', '...', 'o.o'], 1],
  ],
  containment: [
    [['###', '#..', '###'], 2], [['#.#', '#.#', '###'], 2], [['p'], 2], [['o'], 2], [['hh', 'hh'], 1.5],
    [['####'], 1], [['dd'], 1.5], [['d', 'd'], 1],
  ],
  executive: [
    [['ddd', 'ddd'], 2], [['dd'], 2], [['o'], 3], [['p'], 2], [['d', 'd'], 1], [['###'], 1], [['o..o'], 1],
    [['dd', '..', 'dd'], 1],
  ],
};

const SOLID_CH = new Set(['#', 'p', 'c', 'd', 'o']);
const KEEP = [[12, 1], [12, 13], [1, 1], [23, 1], [1, 7], [23, 7], [1, 13], [23, 13]];

function connected(g) {
  const start = [12, 13];
  const seen = new Set([start.join()]);
  const q = [start];
  while (q.length) {
    const [c, r] = q.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (SOLID_CH.has(g[nr][nc]) || seen.has(`${nc},${nr}`)) continue;
      seen.add(`${nc},${nr}`);
      q.push([nc, nr]);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!SOLID_CH.has(g[r][c]) && !seen.has(`${c},${r}`)) return false; // no sealed pockets
  }
  return true;
}

function generate(n, theme) {
  const stamps = STAMPS[theme];
  const totalW = stamps.reduce((s, [, w]) => s + w, 0);
  for (let attempt = 0; attempt < 60; attempt++) {
    const rand = seeded(n * 7919 + attempt * 104729 + 3);
    const g = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) =>
      (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 ? '#' : '.')));
    const reserved = new Set();
    for (const [kc, kr] of KEEP) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) reserved.add(`${kc + dc},${kr + dr}`);
    const isFree = (c, r) => g[r][c] === '.';

    const target = 5 + Math.floor(rand() * 3) + Math.floor(((n - 1) % 10) / 3);
    let placed = 0;
    for (let tries = 0; placed < target && tries < 400; tries++) {
      let x = rand() * totalW, shape = stamps[0][0];
      for (const [s, w] of stamps) { x -= w; if (x <= 0) { shape = s; break; } }
      const h = shape.length, w = shape[0].length;
      const c0 = 2 + Math.floor(rand() * (10 - w + 1));
      const r0 = 2 + Math.floor(rand() * (11 - h + 1));
      let ok = true;
      for (let r = r0 - 1; ok && r <= r0 + h; r++) for (let c = c0 - 1; ok && c <= c0 + w; c++) {
        if (r < 1 || r > 13 || c < 1) continue;
        if (!isFree(c, r) || !isFree(24 - c, r)) ok = false;
      }
      for (let r = 0; ok && r < h; r++) for (let c = 0; ok && c < w; c++) {
        if (shape[r][c] !== '.' && (reserved.has(`${c0 + c},${r0 + r}`) || reserved.has(`${24 - c0 - c},${r0 + r}`))) ok = false;
      }
      if (!ok) continue;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const ch = shape[r][c];
        if (ch === '.') continue;
        g[r0 + r][c0 + c] = ch;
        g[r0 + r][24 - c0 - c] = ch;
      }
      placed++;
    }
    // something down the middle sometimes
    const mid = Math.floor(rand() * 4);
    if (mid === 1) { g[5][12] = 'p'; g[9][12] = 'p'; }
    else if (mid === 2) { g[7][12] = theme === 'labs' ? 'h' : 'o'; }
    else if (mid === 3 && g[6][12] === '.' && g[8][12] === '.') { g[6][12] = 'd'; g[7][12] = 'd'; g[8][12] = 'd'; }

    g[1][12] = 'E'; g[13][12] = 'P';
    for (const [kc, kr] of KEEP.slice(2)) g[kr][kc] = 'S';
    if (connected(g)) return g.map((row) => row.join(''));
  }
  throw new Error(`could not generate floor ${n}`);
}

for (let n = 1; n <= TOP_FLOOR; n++) {
  const theme = themeFor(n);
  if (!FLOORS[n]) FLOORS[n] = { name: NAMES[n] || `Floor ${n}`, map: generate(n, theme), generated: true };
  FLOORS[n].theme = theme;
}

// Floor twists: every third regular floor of the climb (and stops 3, 6 and 8 of an Elevator Run).
export const TWISTS = {
  elite: { name: 'ELITE', sub: 'A GOLDEN ZOMBIE CARRIES A FREE UPGRADE' },
  blackout: { name: 'BLACKOUT', sub: 'STAY IN THE LIGHT' },
  flooded: { name: 'FLOODED', sub: 'EVERYONE MOVES SLOWER' },
  lockdown: { name: 'LOCKDOWN', sub: 'SURVIVE 45 SECONDS' },
};
const TWIST_ORDER = ['elite', 'blackout', 'flooded', 'lockdown'];
export function twistFor(n, run) {
  if (FLOORS[n]?.boss) return null;
  if (run?.mode === 'elevator') return { 2: 'elite', 5: 'blackout', 7: 'lockdown' }[run.step] || null;
  if (n % 3 !== 0) return null;
  return TWIST_ORDER[(n / 3 - 1) % TWIST_ORDER.length];
}

// How many zombies, how fast they come, and how tough they are on floor n.
export function floorPlan(n) {
  const boss = !!FLOORS[n]?.boss;
  // Zone 1 ramps 12% tougher per floor; after that 7% (tuned from autoplay runs: steeper curves
  // walled players whose gear rolls were average).
  const hpScale = n <= 10 ? 1 + 0.12 * (n - 1) : 2.08 + 0.07 * (n - 10);
  return {
    total: boss ? 6 : n <= 10 ? 10 + n * 4 : Math.min(66, 48 + (n - 10)), // capped: 80-zombie floors were an endurance grind
    maxAlive: boss ? 4 : n <= 10 ? Math.round(7 + n * 1.6) : Math.min(22, Math.round(16 + (n - 10) * 0.25)),
    spawnMs: boss ? 2600 : n <= 10 ? Math.max(320, 800 - n * 45) : 420,
    hpScale,
    dmgScale: 1 + (hpScale - 1) * (n <= 10 ? 0.4 : 0.32),
    pick: () => pickEnemy(n),
    minions: ZONE_MINIONS[zoneOf(n).id],
  };
}

// Sanity-check every map at load time; problems show in the browser console.
export function validateFloors() {
  const errors = [];
  for (const [n, f] of Object.entries(FLOORS)) {
    if (f.map.length !== ROWS) errors.push(`floor ${n}: ${f.map.length} rows (want ${ROWS})`);
    f.map.forEach((row, r) => {
      if (row.length !== COLS) errors.push(`floor ${n} row ${r}: ${row.length} cols (want ${COLS})`);
    });
    const all = f.map.join('');
    for (const ch of ['P', 'E', 'S']) if (!all.includes(ch)) errors.push(`floor ${n}: missing ${ch}`);
    if (f.boss && !all.includes('B')) errors.push(`floor ${n}: boss floor missing B`);
    if (!connected(f.map.map((r) => [...r]))) errors.push(`floor ${n}: has unreachable open tiles`);
  }
  if (errors.length) console.error('[Zombie Tower] floor map problems:\n' + errors.join('\n'));
  return errors;
}
