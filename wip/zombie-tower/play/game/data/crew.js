// Survivors: one per zone, trapped on a set floor. Reach them before they're overrun and they
// join your elevator crew for the rest of the climb, each with a permanent passive.

export const CREW = [
  { id: 'dana', floor: 4, name: 'Dana', role: 'Parking Attendant', perk: 'Medkits heal 50% more.' },
  { id: 'priya', floor: 13, name: 'Priya', role: 'IT Intern', perk: 'The medkit meter fills 25% faster.' },
  { id: 'osei', floor: 23, name: 'Dr. Osei', role: 'Lab Scientist', perk: 'Toxic damage halved.' },
  { id: 'reyes', floor: 35, name: 'Sgt. Reyes', role: 'Security Guard', perk: '+12 defense.' },
  { id: 'marcus', floor: 44, name: 'Marcus', role: "The Founder's Assistant", perk: 'Once per floor, a killing blow leaves you at 1 HP.' },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c]));
export const crewOnFloor = (n) => CREW.find((c) => c.floor === n);

// How long a survivor holds out (ms) and how fast touching zombies wear them down (per second).
export const HOLD_MS = 40000;
export const CONTACT_DRAIN = 18;
