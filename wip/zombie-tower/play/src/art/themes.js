// Look of each area of the tower: colors, lighting, and which decorations show up.
// Used by tiles.js (to draw textures) and game/decorate.js (to place them).

export const THEMES = {
  garage: {
    floor: '#3b3e44', floorAlt: ['#43464c', '#35383d', '#404349'], pattern: 'concrete',
    wallTop: '#454950', wallHi: '#6b707a', face: '#50545b', faceDark: '#3a3d43', wallPattern: 'block',
    stain: '#26282c', accent: '#f2c230',
    faceDetails: ['pipes', 'signLevel', 'extinguisher', 'signExit'],
    decals: { oil: 4, tire: 3, crack: 3, puddle: 2, cone: 2, trash: 2, blood: 2 },
    light: 0xcfe8ff, dark: 0x05060c, darkAlpha: 0.62, glow: 0.08, lightGrid: { cols: [4, 12, 20], rows: [3, 11] }, flicker: 2,
  },
  lobby: {
    floor: '#d8d2c4', floorAlt: ['#c4bdac'], pattern: 'checker',
    wallTop: '#4a3530', wallHi: '#8a6a3a', face: '#5a4038', faceDark: '#3b2925', wallPattern: 'wood',
    stain: '#a89f8c', accent: '#c9a84a',
    faceDetails: ['painting', 'sconce', 'window', 'sconce'],
    decals: { papers: 3, glass: 3, blood: 3, crack: 1, suitcase: 2 },
    light: 0xffd9a0, dark: 0x0a0604, darkAlpha: 0.32, glow: 0.12, lightGrid: { cols: [5, 12, 19], rows: [4, 10] }, flicker: 1,
  },
  office: {
    floor: '#3e4a5c', floorAlt: ['#46536a', '#394456'], pattern: 'carpet',
    wallTop: '#a8a296', wallHi: '#d8d2c4', face: '#cfc9bc', faceDark: '#9a9488', wallPattern: 'plain',
    stain: '#2c3544', accent: '#5aa0e0',
    faceDetails: ['window', 'whiteboard', 'poster', 'window'],
    decals: { papers: 5, coffee: 3, chair: 3, cables: 2, blood: 2, crack: 1 },
    light: 0xe8f4ff, dark: 0x03050a, darkAlpha: 0.5, glow: 0.08, lightGrid: { cols: [3, 9, 15, 21], rows: [3, 11] }, flicker: 3,
  },
  labs: {
    floor: '#d9e2e6', floorAlt: ['#c8d3d8', '#e2e9ec'], pattern: 'tile',
    wallTop: '#8a98a0', wallHi: '#c2cdd2', face: '#aab6bc', faceDark: '#7a868c', wallPattern: 'panel',
    stain: '#9fb0b6', accent: '#3dffc5',
    faceDetails: ['monitor', 'biohazard', 'vent', 'monitor'],
    decals: { goo: 4, glass: 3, papers: 2, blood: 2, hazardStripe: 1 },
    light: 0xc8fff0, dark: 0x02080a, darkAlpha: 0.45, glow: 0.1, lightGrid: { cols: [4, 12, 20], rows: [3, 11] }, flicker: 2,
  },
  containment: {
    floor: '#2c3036', floorAlt: ['#24272c', '#33373e'], pattern: 'grate',
    wallTop: '#3a3f46', wallHi: '#5a6068', face: '#454a52', faceDark: '#2a2e33', wallPattern: 'panel',
    stain: '#1a1c20', accent: '#ff5a4a',
    faceDetails: ['warnLight', 'biohazard', 'cellDoor', 'pipes'],
    decals: { chains: 3, scorch: 3, goo: 3, blood: 3, bolts: 2, hazardStripe: 2 },
    light: 0xff6a5a, dark: 0x080204, darkAlpha: 0.46, glow: 0.14, lightGrid: { cols: [4, 12, 20], rows: [4, 10] }, flicker: 3,
  },
  executive: {
    floor: '#4a2e22', floorAlt: ['#563526', '#3f271d'], pattern: 'wood',
    wallTop: '#1e1a24', wallHi: '#c9a84a', face: '#2a2430', faceDark: '#16131a', wallPattern: 'plain',
    stain: '#2e1c14', accent: '#c9a84a',
    faceDetails: ['window', 'bookshelf', 'painting', 'window'],
    decals: { rug: 2, glass: 3, money: 3, papers: 2, blood: 3, wine: 2 },
    light: 0xffd090, dark: 0x080404, darkAlpha: 0.36, glow: 0.13, lightGrid: { cols: [5, 12, 19], rows: [3, 11] }, flicker: 1,
  },
  rooftop: {
    floor: '#55585e', floorAlt: ['#4d5056', '#5c5f65'], pattern: 'gravel',
    wallTop: '#6a6d73', wallHi: '#8a8d93', face: '#5e6167', faceDark: '#44474c', wallPattern: 'block',
    stain: '#3c3e43', accent: '#ff5f56',
    faceDetails: ['railing', 'warnLight', 'railing', 'vent'],
    decals: { puddle: 4, crack: 2, blood: 3, bolts: 2, papers: 2 },
    light: 0x9fb8ff, dark: 0x02030a, darkAlpha: 0.48, glow: 0.10, lightGrid: { cols: [4, 20], rows: [3, 11] }, flicker: 0,
  },
};

export const THEME_KEYS = Object.keys(THEMES);
