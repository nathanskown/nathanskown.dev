// Guess matching, run on the server so the answers never reach a browser.
// This is the same normalizing and typo-tolerant comparison the pages used (music/assets/common.js).

export const norm = s => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, " ")
  .replace(/\s[-–—]\s.*$/, " ")
  .replace(/\b(feat|ft)\.?\s.*$/, " ")
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9 ]/g, "")
  .replace(/\s+/g, " ").trim();

export const normArtist = s => norm(s).replace(/^the /, "");

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// both inputs already normalized; allow about one typo per six characters
function fuzzyEq(g, t) {
  if (!g || !t) return false;
  if (g === t) return true;
  return lev(g, t) <= Math.floor(t.length / 6);
}

export const isTitleMatch = (guess, title) => fuzzyEq(norm(String(guess).slice(0, 200)), norm(title));

export function isArtistMatch(guess, artist) {
  const g = normArtist(String(guess).slice(0, 200));
  return [artist.name].concat(artist.aliases || []).some(n => fuzzyEq(g, normArtist(n)));
}
