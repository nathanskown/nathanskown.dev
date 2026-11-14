// Armor pieces. One per slot (head / body / legs). Duplicates upgrade the piece.
// def = defense points (damage reduction = def / (def + 60)). speed = move speed modifier.
// toxic = multiplier on toxic damage (goo, spills, clouds). hp = bonus max HP.

export const ARMOR_MAX_LVL = 8;
export const SLOTS = ['head', 'body', 'legs'];

export const ARMOR = {
  hardhat: { id: 'hardhat', slot: 'head', name: 'Hard Hat', desc: 'Left behind by the night crew.', def: 6, speed: 0, weight: 10, minFloor: 1 },
  riot: { id: 'riot', slot: 'head', name: 'Riot Helmet', desc: 'Security issue. Heavy visor.', def: 11, speed: 0, weight: 5, minFloor: 4 },
  vest: { id: 'vest', slot: 'body', name: 'Security Vest', desc: 'Padded, reflective, yours.', def: 10, speed: 0, weight: 10, minFloor: 1 },
  kevlar: { id: 'kevlar', slot: 'body', name: 'Kevlar Plate', desc: 'Stops a lot. Slows you a bit.', def: 18, speed: -0.06, weight: 5, minFloor: 4 },
  cargo: { id: 'cargo', slot: 'legs', name: 'Cargo Pants', desc: 'Light and quick.', def: 4, speed: 0.08, weight: 9, minFloor: 1 },
  kneeguards: { id: 'kneeguards', slot: 'legs', name: 'Knee Guards', desc: 'Built for crawling through vents.', def: 8, speed: 0, weight: 7, minFloor: 3 },
  sprintboots: { id: 'sprintboots', slot: 'legs', name: 'Running Shoes', desc: 'Someone\'s lunchtime jog gear.', def: 6, speed: 0.12, weight: 7, minFloor: 11 },
  gasmask: { id: 'gasmask', slot: 'head', name: 'Gas Mask', desc: 'Toxic damage halved.', def: 9, speed: 0, toxic: 0.5, weight: 8, minFloor: 21 },
  hazsuit: { id: 'hazsuit', slot: 'body', name: 'Hazmat Suit', desc: 'Toxic damage halved.', def: 15, speed: -0.03, toxic: 0.5, weight: 7, minFloor: 22 },
  tactical: { id: 'tactical', slot: 'head', name: 'Tactical Helmet', desc: 'Containment team issue.', def: 17, speed: 0, weight: 7, minFloor: 31 },
  greaves: { id: 'greaves', slot: 'legs', name: 'Plated Greaves', desc: 'Heavy steel shin guards.', def: 15, speed: -0.03, weight: 6, minFloor: 32 },
  exoframe: { id: 'exoframe', slot: 'body', name: 'Exo Frame', desc: 'Powered suit from the R&D vault. +25 max HP.', def: 26, speed: 0.05, hp: 25, weight: 6, minFloor: 41 },
};

export function armorDef(id, lvl) {
  return Math.round(ARMOR[id].def * (1 + 0.25 * (lvl - 1)));
}

export function armorLines(id, lvl) {
  const a = ARMOR[id];
  const lines = [`SLOT ${a.slot.toUpperCase()}`, `DEF ${armorDef(id, lvl)}`];
  if (a.speed) lines.push(`SPEED ${a.speed > 0 ? '+' : ''}${Math.round(a.speed * 100)}%`);
  if (a.toxic) lines.push(`TOXIC -${Math.round((1 - a.toxic) * 100)}%`);
  if (a.hp) lines.push(`MAX HP +${a.hp}`);
  return lines;
}
