/* Variety helpers for the Music games, shared by the pages and tools/build-daily.mjs.
   Plain script: in the browser it sets window.MXV, in Node it is loaded with require-free eval.

   family(genre)   maps the many fine Last.fm genres ("Cloud Rap", "Dream Pop", "Mpb") onto ten broad families,
                   so variety is judged on what a listener hears, not on tag spelling.
   spread(list, rnd, opt)  orders a list so consecutive picks change family, avoid the same artist within the
                   last few picks, and avoid repeating a decade back to back where the pool allows it. Families are
                   weighted by the square root of their size, so a pop-heavy catalog still yields mixed rounds. */
(function (root) {
  "use strict";
  const FAMILIES = ["Pop", "Hip-Hop", "R&B & Soul", "Rock & Alt", "Metal & Hardcore", "Electronic",
                    "Country & Folk", "Latin & Global", "Jazz & Blues", "Other"];
  const RULES = [
    ["Latin & Global", /k-?pop|j-?pop|mpb|reggaeton|bossa|dancehall|reggae|latin|afro|samba|cumbia|bachata|salsa|bollywood|world|c-?pop|flamenco|amapiano/],
    ["Jazz & Blues", /jazz|blues|swing|bebop/],
    ["Metal & Hardcore", /metal|core\b|hardcore|grindcore|djent/],
    ["Hip-Hop", /hip.?hop|\brap\b|trap|drill|cloud rap|\brage\b|plugg|opium|digicore|grime|boom bap/],
    ["R&B & Soul", /\br.?n.?b\b|soul|funk|disco|motown|gospel/],
    ["Country & Folk", /country|folk|singer.?songwriter|acoustic|americana|bluegrass/],
    ["Rock & Alt", /rock|punk|grunge|shoegaze|\bemo\b|new wave|britpop|^alternative$|slowcore|^psychedelic$|\bska\b|^indie$|post-punk/],
    ["Electronic", /electro(?!pop)|house|dubstep|\bidm\b|ambient|trip.?hop|chillwave|garage|witch house|breakcore|^dance$|lo-?fi|industrial|bubblegum bass|techno|edm|drum and bass|trance|synthwave/],
    ["Pop", /pop/]
  ];
  const famCache = {};
  function family(g) {
    const k = String(g || "").toLowerCase().trim();
    if (!k) return "Other";
    if (famCache[k]) return famCache[k];
    let f = "Other";
    for (const [name, re] of RULES) if (re.test(k)) { f = name; break; }
    return (famCache[k] = f);
  }
  /* An artist's family: the first of its tags that maps somewhere specific. */
  function familyOfTags(tags) {
    for (const t of tags || []) { const f = family(t); if (f !== "Other") return f; }
    return "Other";
  }
  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* opt: fam(x) -> family, artist(x) -> artist key, decade(x) -> decade or null, limit (stop early).
     Each pick draws a family with weight sqrt(songs left), so big families come up more often but small
     ones still get regular turns; the last two families picked sit out while others remain. */
  function spread(list, rnd, opt) {
    opt = opt || {};
    const famOf = opt.fam || (x => family(x.genre));
    const artOf = opt.artist || (x => String(x.artist || x.name || "").toLowerCase());
    const decOf = opt.decade || (x => x.year ? Math.floor(x.year / 10) * 10 : (x.era || x.debutDecade || null));
    const limit = Math.min(opt.limit || list.length, list.length);
    const buckets = {};
    shuffle(list, rnd).forEach(x => { const f = famOf(x); (buckets[f] = buckets[f] || []).push(x); });
    const out = [], lastFams = [];
    while (out.length < limit) {
      let fams = Object.keys(buckets).filter(f => buckets[f].length);
      if (!fams.length) break;
      const fresh = fams.filter(f => !lastFams.includes(f));
      if (fresh.length) fams = fresh;
      const w = fams.map(f => Math.sqrt(buckets[f].length) * (f === "Other" ? 0.4 : 1));
      let r = rnd() * w.reduce((a, b) => a + b, 0), k = 0;
      while (k < fams.length - 1 && (r -= w[k]) > 0) k++;
      const f = fams[k], b = buckets[f];
      const recentArtists = out.slice(-6).map(artOf);
      const prevDec = out.length ? decOf(out[out.length - 1]) : null;
      let i = b.findIndex(x => !recentArtists.includes(artOf(x)) && (prevDec == null || decOf(x) == null || decOf(x) !== prevDec));
      if (i < 0) i = b.findIndex(x => !recentArtists.includes(artOf(x)));
      if (i < 0) i = 0;
      out.push(b.splice(i, 1)[0]);
      lastFams.push(f); if (lastFams.length > 2) lastFams.shift();
    }
    return out;
  }
  const MXV = { FAMILIES, family, familyOfTags, spread, shuffle };
  if (typeof module !== "undefined" && module.exports) module.exports = MXV;
  if (root) root.MXV = MXV;
})(typeof window !== "undefined" ? window : null);
