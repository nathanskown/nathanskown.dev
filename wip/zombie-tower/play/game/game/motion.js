// Camera fades that respect reduced motion: with it on, scenes switch at once.

import { REDUCED } from '../config.js';

export function fadeIn(scene, ms) {
  if (!REDUCED) scene.cameras.main.fadeIn(ms, 0, 0, 0);
}

export function fadeOut(scene, ms, then) {
  if (REDUCED) { then(); return; }
  scene.cameras.main.fadeOut(ms, 0, 0, 0);
  scene.cameras.main.once('camerafadeoutcomplete', then);
}
