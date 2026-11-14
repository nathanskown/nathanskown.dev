// Weapon mods: offered in gear drafts. Up to MAX_MODS different mods per run; they work on
// BOTH guns (so swapping guns never throws them away). Taking a mod you own levels it up.

export const MOD_MAX_LVL = 3;
export const MAX_MODS = 3;

export const MODS = [
  { id: 'pierce', name: 'Piercing Rounds', color: '#b9a8ff', glyph: '>', minFloor: 2,
    desc: (l) => `Bullets punch through ${PIERCE[l]} more zombie${PIERCE[l] > 1 ? 's' : ''}${l === 2 ? ' and hit 15% harder' : ''}.` },
  { id: 'ricochet', name: 'Ricochet', color: '#ffe066', glyph: '/', minFloor: 2,
    desc: (l) => `Bullets that hit a wall bounce toward a zombie (${RICOCHET[l]}x, ${RICOCHET_DMG[l] * 100}% damage).` },
  { id: 'burn', name: 'Incendiary', color: '#ff8a2a', glyph: '^', minFloor: 3,
    desc: (l) => `Hits set zombies on fire: +${BURN[l] * 100}% damage over 2s.` },
  { id: 'cryo', name: 'Cryo Rounds', color: '#9fe8ff', glyph: 'o', minFloor: 3,
    desc: (l) => `Hits slow zombies by ${Math.round(CRYO[l] * 100)}% for 1s.` },
  { id: 'boom', name: 'Last Round Boom', color: '#ff5f56', glyph: '!', minFloor: 4,
    desc: (l) => `The last bullet in every magazine explodes for ${BOOM[l]}x damage.` },
  { id: 'chain', name: 'Chain Shock', color: '#66d9ff', glyph: 'Z', minFloor: 6,
    desc: (l) => `Hits often arc to ${l} nearby zombie${l > 1 ? 's' : ''} for ${CHAIN * 100}% damage.` },
];

// Strength per level (index = level).
export const PIERCE = [0, 1, 1, 2];
export const RICOCHET = [0, 1, 2, 2];
export const RICOCHET_DMG = [0, 0.6, 0.6, 0.85];
export const BURN = [0, 0.2, 0.3, 0.4];
export const CRYO = [0, 0.15, 0.22, 0.3];
export const BOOM = [0, 1.5, 2, 2.5];
export const CHAIN = 0.3;

export const MOD_BY_ID = Object.fromEntries(MODS.map((m) => [m.id, m]));
