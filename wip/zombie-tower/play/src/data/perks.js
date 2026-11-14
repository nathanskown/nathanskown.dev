// Perks: only offered after beating a boss (pick 1 of 3). Each can be owned once.

export const PERKS = [
  { id: 'leech', name: 'Leech', desc: 'Heal 2 HP for every zombie you kill.', color: '#b8322a', glyph: '+' },
  { id: 'quickhands', name: 'Quick Hands', desc: 'Reload 35% faster.', color: '#2a7ab8', glyph: 'R' },
  { id: 'secondwind', name: 'Second Wind', desc: 'Once per checkpoint, get back up at 50% HP instead of dying.', color: '#d9a81f', glyph: '2' },
  { id: 'fleetfoot', name: 'Fleet Foot', desc: 'Move 15% faster.', color: '#3f9f5a', glyph: '>' },
  { id: 'deadshot', name: 'Deadshot', desc: '15% chance for bullets to deal double damage.', color: '#8a3ab8', glyph: '*' },
  { id: 'irongut', name: 'Iron Gut', desc: '+30 max HP.', color: '#7a4e2a', glyph: 'H' },
  { id: 'brawler', name: 'Brawler', desc: 'Shove hits twice as hard and recharges 30% faster.', color: '#c25a1f', glyph: 'M' },
  { id: 'overclock', name: 'Overclock', desc: 'All weapons fire 15% faster.', color: '#1f9fa0', glyph: '!' },
  { id: 'thickskin', name: 'Thick Skin', desc: '+15 defense on top of your armor.', color: '#6b7682', glyph: 'D' },
  { id: 'scavenger', name: 'Scavenger', desc: 'Medkits drop twice as often and heal 50% more.', color: '#4ade80', glyph: '$' },
  { id: 'bigmag', name: 'Extended Mags', desc: 'All magazines hold 30% more.', color: '#e8a020', glyph: '=' },
  { id: 'antitoxin', name: 'Antitoxin', desc: 'Take 60% less toxic damage.', color: '#3dffc5', glyph: '~' },
];

export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
