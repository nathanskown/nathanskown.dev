// Base enemy stats (floor 1 equivalents). Scaled per floor in Game via floorPlan().
// body = [radius, offsetX, offsetY] of the physics circle inside the 32x32 sprite.

export const ENEMIES = {
  shambler: { name: 'Shambler', hp: 30, speed: 52, dmg: 10 },
  valet: { name: 'Valet', hp: 18, speed: 70, sprint: 200, dmg: 8 },
  crawler: { name: 'Cubicle Crawler', hp: 16, speed: 92, dmg: 8, body: [7, 9, 18] },
  spitter: { name: 'Spitter', hp: 26, speed: 46, dmg: 6, range: 250, shotDmg: 11, shotSpeed: 210, shotMs: 2300 },
  testsubject: { name: 'Test Subject', hp: 28, speed: 78, lunge: 260, dmg: 10 },
  hazmat: { name: 'Hazmat', hp: 90, speed: 38, dmg: 13, heavy: true, body: [11, 5, 10] },
  guard: { name: 'Guard Gone Wrong', hp: 60, speed: 44, dmg: 11, shieldHp: 65, turnRate: 1.6 },
  bloater: { name: 'Bloater', hp: 70, speed: 40, dmg: 10, heavy: true, cloudR: 60, cloudMs: 2600, body: [11, 5, 10] },
  executive: { name: 'Executive', hp: 45, speed: 96, dmg: 11, dodgeSpeed: 320, dodgeCd: 2400 },
  blob: { name: 'Blob', hp: 12, speed: 112, dmg: 6, body: [6, 10, 18] },
};

// Which zombies show up in each zone, and how often (weights).
const MIX = {
  2: { shambler: 4, valet: 2, crawler: 3, spitter: 1.5 },
  3: { shambler: 3, valet: 1, crawler: 2, spitter: 1.5, testsubject: 3, hazmat: 1.5 },
  4: { shambler: 2.5, crawler: 1.5, spitter: 1.5, testsubject: 2, hazmat: 1.2, guard: 1.8, bloater: 1.6 },
  5: { shambler: 2, valet: 1, crawler: 1.5, spitter: 1.5, testsubject: 1.5, hazmat: 1, guard: 1.8, bloater: 1.5, executive: 2 },
};

// What bosses call in when they summon.
export const ZONE_MINIONS = {
  1: ['shambler'],
  2: ['shambler', 'crawler'],
  3: ['testsubject', 'shambler'],
  4: ['guard', 'shambler'],
  5: ['executive'],
};

// The zombie types each zone introduces (shown when you arrive).
export const ZONE_NEW = {
  2: ['crawler', 'spitter'],
  3: ['testsubject', 'hazmat'],
  4: ['guard', 'bloater'],
  5: ['executive'],
};

export function pickEnemy(n) {
  if (n <= 10) {
    const valetFrac = n < 3 ? 0 : Math.min(0.4, 0.07 * n);
    return Math.random() < valetFrac ? 'valet' : 'shambler';
  }
  const mix = MIX[Math.min(5, Math.ceil(n / 10))];
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(mix)) { r -= w; if (r <= 0) return k; }
  return 'shambler';
}

export const BOSSES = {
  doorman: { name: 'THE DOORMAN', hp: 1500, speed: 50, dmg: 20, chargeSpeed: 430 },
  manager: { name: 'THE MANAGER', hp: 8000, speed: 55, dmg: 22 },
  specimen: { name: 'SPECIMEN ZERO', hp: 13000, speed: 62, dmg: 26 },
  warden: { name: 'THE WARDEN', hp: 19000, speed: 58, dmg: 30 },
  founder: { name: 'THE FOUNDER', hp: 30000, speed: 48, dmg: 34 },
};
