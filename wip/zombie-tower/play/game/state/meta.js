// Progress that survives between climbs: best floor, wins, and what that unlocks
// (starting kits, Night Shift). Unlocks change your options, never your raw stats.

import { WIN_KEY } from '../config.js';
import { MODS } from '../data/mods.js';

const KEY = 'zombieTower.meta.v1';

export function loadMeta() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* fresh */ }
  m = { best: 0, wins: 0, nightWins: 0, elevatorWins: 0, ...m };
  try { if (localStorage.getItem(WIN_KEY)) m.wins = Math.max(m.wins, 1); } catch { /* ignore */ }
  return m;
}

function saveMeta(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

export function recordFloor(run) {
  if (run.mode === 'elevator') return;
  const m = loadMeta();
  if (run.floor > m.best) { m.best = run.floor; saveMeta(m); }
}

export function recordWin(run) {
  const m = loadMeta();
  if (run.mode === 'elevator') m.elevatorWins++;
  else { m.wins++; m.best = 50; if (run.nightShift) m.nightWins++; }
  saveMeta(m);
}

export const nightShiftUnlocked = (m = loadMeta()) => m.wins > 0;

export const KITS = [
  { id: 'standard', name: 'STANDARD ISSUE', desc: 'Service pistol. Nothing else.', need: 0 },
  { id: 'scrapper', name: 'SCRAPPER', desc: 'Pump shotgun and pistol.', need: 11 },
  { id: 'tinkerer', name: 'TINKERER', desc: 'Pistol and a random weapon mod.', need: 21 },
  { id: 'armored', name: 'ARMORED', desc: 'Pistol, hard hat and security vest.', need: 31 },
  { id: 'specialist', name: 'SPECIALIST', desc: 'Burst carbine L2 and pistol.', need: 41 },
];

export const kitUnlocked = (kit, m = loadMeta()) => m.best >= kit.need;

export function applyKit(run, id) {
  run.kit = id;
  if (id === 'scrapper') { run.weapons = [{ id: 'shotgun', lvl: 1 }, { id: 'pistol', lvl: 1 }]; }
  else if (id === 'tinkerer') {
    const pool = MODS.filter((x) => x.minFloor <= 3);
    run.mods = [{ id: pool[Math.floor(Math.random() * pool.length)].id, lvl: 1 }];
  } else if (id === 'armored') { run.armor.head = { id: 'hardhat', lvl: 1 }; run.armor.body = { id: 'vest', lvl: 1 }; }
  else if (id === 'specialist') { run.weapons = [{ id: 'carbine', lvl: 2 }, { id: 'pistol', lvl: 1 }]; }
  return run;
}
