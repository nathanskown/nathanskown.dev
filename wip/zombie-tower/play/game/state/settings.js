// Per-device settings (pause menu): screen shake, vibration, damage numbers.

const KEY = 'zombieTower.settings.v1';
// Screen shake starts off for players whose device asks for reduced motion (they can still turn it on).
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULTS = { shake: !reduced, vibrate: true, numbers: true };
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { cache = { ...DEFAULTS }; }
  return cache;
}

export function setting(k) { return load()[k]; }

export function toggleSetting(k) {
  const s = load();
  s[k] = !s[k];
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* this session only */ }
  return s[k];
}

// Short vibration on phones that support it (Android; iPhone Safari ignores this).
export function buzz(pattern) {
  if (!setting('vibrate')) return;
  // Browsers refuse (and log an error) until the player has tapped the page at least once.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
