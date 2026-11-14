// Weapon definitions. `weight` = how often it shows up as a NEW card (0 = never offered new).
// `minFloor` = earliest floor it can be offered. range is in pixels.

export const MAX_LVL = 8;
const PIERCE_BONUS_LVL = 5;

export const WEAPONS = {
  pistol: {
    id: 'pistol', short: 'PISTOL', name: 'Service Pistol', desc: 'Reliable sidearm. Never lets you down.',
    dmg: 12, fireMs: 260, mag: 12, reloadMs: 1000, speed: 560, pellets: 1, spread: 0.05,
    range: 440, pierce: 0, knock: 90, weight: 0, minFloor: 1,
  },
  nailgun: {
    id: 'nailgun', short: 'NAILGUN', name: 'Nail Gun', desc: 'Construction tool. Huge magazine, rapid fire.',
    dmg: 8, fireMs: 130, mag: 40, reloadMs: 2000, speed: 520, pellets: 1, spread: 0.08,
    range: 380, pierce: 0, knock: 50, weight: 10, minFloor: 1,
  },
  shotgun: {
    id: 'shotgun', short: 'SHOTGUN', name: 'Pump Shotgun', desc: 'Six pellets per blast. Point blank is best.',
    dmg: 8, fireMs: 720, mag: 6, reloadMs: 1800, speed: 600, pellets: 6, spread: 0.32,
    range: 230, pierce: 0, knock: 120, weight: 9, minFloor: 1,
  },
  smg: {
    id: 'smg', short: 'SMG', name: 'Compact SMG', desc: 'Sprays fast. Eats magazines.',
    dmg: 7, fireMs: 85, mag: 30, reloadMs: 1500, speed: 620, pellets: 1, spread: 0.12,
    range: 400, pierce: 0, knock: 40, weight: 8, minFloor: 2,
  },
  revolver: {
    id: 'revolver', short: 'CANNON', name: 'Hand Cannon', desc: 'Six heavy rounds. Punches through one zombie.',
    dmg: 30, fireMs: 420, mag: 6, reloadMs: 1400, speed: 700, pellets: 1, spread: 0.02,
    range: 520, pierce: 1, knock: 160, weight: 6, minFloor: 3,
  },
  rifle: {
    id: 'rifle', short: 'RIFLE', name: 'Marksman Rifle', desc: 'Slow, deadly. Pierces two zombies.',
    dmg: 44, fireMs: 620, mag: 8, reloadMs: 1700, speed: 900, pellets: 1, spread: 0.01,
    range: 760, pierce: 2, knock: 140, weight: 5, minFloor: 5, shake: true,
  },
  // ---- Zone 2+
  carbine: {
    id: 'carbine', short: 'CARBINE', name: 'Burst Carbine', desc: 'Security issue. Three rounds per pull.',
    dmg: 16, fireMs: 380, mag: 30, reloadMs: 1600, speed: 760, pellets: 1, spread: 0.03, burst: 3,
    range: 560, pierce: 0, knock: 70, weight: 8, minFloor: 11,
  },
  stapler: {
    id: 'stapler', short: 'STAPLER', name: 'Industrial Stapler', desc: 'Fires three staples at once. Office supply, weapon grade.',
    dmg: 10, fireMs: 300, mag: 15, reloadMs: 1500, speed: 640, pellets: 3, spread: 0.1,
    range: 360, pierce: 1, knock: 60, weight: 7, minFloor: 12,
  },
  // ---- Zone 3+
  torch: {
    id: 'torch', short: 'TORCH', name: 'Lab Torch', desc: 'Short-range fire hose. Burns through crowds.',
    dmg: 7, fireMs: 70, mag: 60, reloadMs: 2200, speed: 330, pellets: 2, spread: 0.22, flame: true, proj: 'flame',
    range: 160, pierce: 3, knock: 12, weight: 7, minFloor: 21,
  },
  plasma: {
    id: 'plasma', short: 'PLASMA', name: 'Plasma Caster', desc: 'Prototype. Rounds burst on impact.',
    dmg: 38, fireMs: 400, mag: 10, reloadMs: 1800, speed: 520, pellets: 1, spread: 0.03, blast: 48, proj: 'plasma',
    range: 520, pierce: 0, knock: 90, weight: 6, minFloor: 23,
  },
  // ---- Zone 4+
  breacher: {
    id: 'breacher', short: 'BREACHER', name: 'Riot Breacher', desc: 'Automatic shotgun. Seven pellets, no waiting.',
    dmg: 12, fireMs: 330, mag: 10, reloadMs: 2000, speed: 620, pellets: 7, spread: 0.3,
    range: 260, pierce: 0, knock: 140, weight: 7, minFloor: 31,
  },
  launcher: {
    id: 'launcher', short: 'LAUNCHER', name: 'Grenade Launcher', desc: 'Big boom, small magazine.',
    dmg: 75, fireMs: 750, mag: 4, reloadMs: 2200, speed: 420, pellets: 1, spread: 0.02, blast: 84, proj: 'grenade',
    range: 380, pierce: 0, knock: 0, weight: 5, minFloor: 33, shake: true,
  },
  // ---- Zone 5
  minigun: {
    id: 'minigun', short: 'MINIGUN', name: 'Minigun', desc: 'From the Founder\'s private armory. Do not stop.',
    dmg: 14, fireMs: 45, mag: 150, reloadMs: 3200, speed: 680, pellets: 1, spread: 0.14,
    range: 440, pierce: 0, knock: 30, weight: 6, minFloor: 41,
  },
  railgun: {
    id: 'railgun', short: 'RAILGUN', name: 'Prototype Railgun', desc: 'Goes through everything in a line.',
    dmg: 170, fireMs: 950, mag: 4, reloadMs: 2000, speed: 1400, pellets: 1, spread: 0, proj: 'rail',
    range: 900, pierce: 99, knock: 260, weight: 5, minFloor: 43, shake: true,
  },
};

// New weapons from early zones show up less once you're well past them.
export function newWeaponWeight(w, floor) {
  if (!w.weight || floor < w.minFloor) return 0;
  return floor > w.minFloor + 20 ? w.weight * 0.35 : w.weight;
}

// Final stats for a weapon at a level, with perk modifiers applied.
// mods = { reloadMul, fireMul }
export function weaponStats(id, lvl, mods = {}) {
  const b = WEAPONS[id];
  const l = lvl - 1;
  return {
    ...b,
    lvl,
    dmg: b.dmg * (1 + 0.2 * l),
    mag: Math.round(b.mag * (1 + 0.15 * l) * (mods.magMul ?? 1)),
    reloadMs: b.reloadMs * (1 - 0.06 * l) * (mods.reloadMul ?? 1),
    fireMs: b.fireMs * (1 - 0.04 * l) * (mods.fireMul ?? 1),
    pierce: b.pierce + (lvl >= PIERCE_BONUS_LVL ? 1 : 0),
  };
}

// Short stat lines for cards.
export function weaponLines(id, lvl) {
  const s = weaponStats(id, lvl);
  const dps = (s.dmg * s.pellets * (s.burst || 1) * 1000) / s.fireMs;
  const lines = [
    `DMG ${Math.round(s.dmg)}${s.pellets > 1 ? 'x' + s.pellets : ''}${s.burst ? ' x' + s.burst + ' BURST' : ''}`,
    `MAG ${s.mag}  RLD ${(s.reloadMs / 1000).toFixed(1)}s`,
    `DPS ~${Math.round(dps)}`,
  ];
  if (s.blast) lines.push('EXPLOSIVE');
  else if (s.pierce >= 99) lines.push('PIERCES ALL');
  else if (s.pierce) lines.push(`PIERCE ${s.pierce}`);
  return lines;
}
