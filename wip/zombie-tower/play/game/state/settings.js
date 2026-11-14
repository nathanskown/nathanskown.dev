// Per-device settings (pause menu): screen shake, vibration, damage numbers.

const KEY = 'zombieTower.settings.v1';
const DEFAULTS = { shake: true, vibrate: true, numbers: true };
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
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
