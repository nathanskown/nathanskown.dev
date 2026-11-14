// The run = everything about the current climb that carries between floors.
// Checkpoints are saved after each boss (and at the start of a new climb).

import { SAVE_KEY } from '../config.js';
import { ARMOR, armorDef } from '../data/armor.js';

export function newRun() {
  return {
    version: 1,
    floor: 1,
    hp: 100,
    weapons: [{ id: 'pistol', lvl: 1 }, null],
    activeSlot: 0,
    armor: { head: null, body: null, legs: null },
    perks: [],
    secondWindUsed: false,
    kills: 0,
    checkpointFloor: 1,
    mercy: 0, // retries since the last new checkpoint (zombies get a little weaker each time)
    mods: [], // weapon mods [{ id, lvl }], work on both guns
    crew: [], // rescued survivors (ids from data/crew.js)
    meter: 0, // kills toward the next medkit
    mode: 'climb', // 'climb' | 'elevator'
    nightShift: false,
  };
}

// Older saves are missing newer fields.
export function normalizeRun(run) {
  run.mods ||= []; run.crew ||= []; run.meter ||= 0; run.mode ||= 'climb';
  return run;
}

// Elevator Run: 9 quick stops spread across the tower, then the Manager. Difficulty follows the
// stop number (ELEVATOR_EFFECTIVE), not the real floor, and you pick two cards after each stop.
export const ELEVATOR_EFFECTIVE = [2, 4, 6, 9, 11, 13, 15, 17, 19, 20];
export const ELEVATOR_PERK_AFTER = 4; // a perk draft after this stop (0-based)
export function newElevatorRun() {
  const run = newRun();
  run.mode = 'elevator';
  const zoneFloors = (z) => Array.from({ length: 9 }, (_, i) => (z - 1) * 10 + 1 + i);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const route = [];
  for (let i = 0; i < 9; i++) {
    const z = Math.min(5, Math.floor(i / 2) + 1);
    let f; do { f = pick(zoneFloors(z)); } while (route.includes(f));
    route.push(f);
  }
  route.push(20);
  run.route = route;
  run.step = 0;
  run.floor = route[0];
  return run;
}
export const isElevator = (run) => run.mode === 'elevator';

export function cloneRun(run) {
  return JSON.parse(JSON.stringify(run));
}

export function hasPerk(run, id) {
  return run.perks.includes(id);
}

// Stats that come from armor + perks.
export function derived(run) {
  let defense = 0;
  let speedMod = 0;
  let bonusHp = 0;
  let toxicMul = hasPerk(run, 'antitoxin') ? 0.4 : 1;
  for (const piece of Object.values(run.armor)) {
    if (!piece) continue;
    const a = ARMOR[piece.id];
    defense += armorDef(piece.id, piece.lvl);
    speedMod += a.speed;
    bonusHp += a.hp || 0;
    if (a.toxic) toxicMul *= a.toxic;
  }
  if (hasPerk(run, 'thickskin')) defense += 15;
  const crew = run.crew || [];
  if (crew.includes('reyes')) defense += 12;
  if (crew.includes('osei')) toxicMul *= 0.5;
  if (hasPerk(run, 'fleetfoot')) speedMod += 0.15;
  const brawler = hasPerk(run, 'brawler');
  return {
    maxHp: 100 + bonusHp + (hasPerk(run, 'irongut') ? 30 : 0),
    defense,
    reduction: defense / (defense + 60),
    speed: 150 * (1 + speedMod),
    reloadMul: hasPerk(run, 'quickhands') ? 0.65 : 1,
    fireMul: hasPerk(run, 'overclock') ? 0.85 : 1,
    crit: hasPerk(run, 'deadshot') ? 0.15 : 0,
    meleeDmg: 22 * (brawler ? 2 : 1),
    meleeCd: 1400 * (brawler ? 0.7 : 1), // shove-dash recharge
    leech: hasPerk(run, 'leech') ? 2 : 0,
    toxicMul,
    magMul: hasPerk(run, 'bigmag') ? 1.3 : 1,
    mods: Object.fromEntries((run.mods || []).map((m) => [m.id, m.lvl])),
    medkitMul: (hasPerk(run, 'scavenger') ? 1.5 : 1) * (crew.includes('dana') ? 1.5 : 1),
    meterNeed: Math.round(40 * (hasPerk(run, 'scavenger') ? 0.7 : 1) * (crew.includes('priya') ? 0.75 : 1)),
    scavenger: hasPerk(run, 'scavenger'),
  };
}

// ---- saving (browser storage can be unavailable, so never let it crash the game;
// an in-memory copy keeps retries working for this session either way)
let memorySnap = null;

export function saveCheckpoint(run) {
  if (run.mode === 'elevator') return null; // Elevator Runs never touch your climb's save
  const snap = cloneRun(run);
  snap.checkpointFloor = run.floor;
  snap.hp = derived(run).maxHp;
  snap.secondWindUsed = false;
  snap.mercy = 0;
  run.mercy = 0;
  run.checkpointFloor = run.floor;
  memorySnap = cloneRun(snap);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snap)); } catch { /* ignore */ }
  return snap;
}

export function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const run = JSON.parse(raw);
      if (run && run.version === 1) return normalizeRun(run);
    }
  } catch { /* fall through */ }
  return memorySnap ? cloneRun(memorySnap) : null;
}

// After a death: one more retry from the same checkpoint, so zombies ease off a little (max 3).
export function bumpMercy() {
  const cp = loadCheckpoint();
  if (!cp) return null;
  cp.mercy = Math.min(MAX_MERCY, (cp.mercy || 0) + 1);
  memorySnap = cloneRun(cp);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(cp)); } catch { /* ignore */ }
  return cp;
}
export const MAX_MERCY = 3;
export const MERCY_STEP = 0.08; // zombie health -8% per retry

export function clearCheckpoint() {
  memorySnap = null;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
