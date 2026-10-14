/* Shared helpers for the Music section. Plain script, no build step. */
(function () {
  "use strict";
  const MX = {};

  MX.$ = id => document.getElementById(id);
  MX.esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- randomness (seedable, so the daily challenge is the same for everyone) ---------- */
  MX.hashStr = function (s) {
    let h = 2166136261;
    for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  MX.mulberry32 = function (a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };
  MX.shuffle = function (arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  MX.todayKey = function () {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

  /* ---------- guess matching ---------- */
  /* Normalize: lowercase, strip accents, drop (parentheticals), [brackets],
     " - Remastered" suffixes, "feat." credits and punctuation. */
  MX.norm = function (s) {
    return String(s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/\s[-–—]\s.*$/, " ")
      .replace(/\b(feat|ft)\.?\s.*$/, " ")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ").trim();
  };
  MX.normArtist = s => MX.norm(s).replace(/^the /, "");
  MX.lev = function (a, b) {
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
  };
  /* both inputs already normalized; allow ~1 typo per 6 characters */
  MX.fuzzyEq = function (g, t) {
    if (!g || !t) return false;
    if (g === t) return true;
    return MX.lev(g, t) <= Math.floor(t.length / 6);
  };
  MX.isTitleMatch = (guess, title) => MX.fuzzyEq(MX.norm(guess), MX.norm(title));
  MX.isArtistMatch = function (guess, artist) {
    const g = MX.normArtist(guess);
    return [artist.name].concat(artist.aliases || []).some(n => MX.fuzzyEq(g, MX.normArtist(n)));
  };

  /* ---------- autocomplete ----------
     getItems(query) -> Promise<[{label, sub?}]>
     opts.onEnter()  -> called when Enter is pressed with nothing highlighted */
  MX.Autocomplete = function (input, box, getItems, opts) {
    opts = opts || {};
    let items = [], idx = -1, timer = null;
    function hide() { box.classList.add("hidden"); items = []; idx = -1; }
    function mark() { Array.prototype.forEach.call(box.children, (d, i) => d.classList.toggle("on", i === idx)); }
    function pick(i) { input.value = items[i].label; hide(); input.focus(); }
    async function show() {
      const found = await getItems(input.value);
      items = found || []; idx = -1;
      if (!items.length) { box.classList.add("hidden"); return; }
      box.innerHTML = items.map((s, i) =>
        '<div data-i="' + i + '">' + MX.esc(s.label) + (s.sub ? " <small>— " + MX.esc(s.sub) + "</small>" : "") + "</div>").join("");
      box.classList.remove("hidden");
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(show, 120); });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); idx = (idx + 1) % items.length; mark(); }
      else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; mark(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (idx >= 0) pick(idx); else if (opts.onEnter) opts.onEnter();
      }
      else if (e.key === "Escape") hide();
    });
    box.addEventListener("mousedown", e => {
      const d = e.target.closest("[data-i]");
      if (d) { e.preventDefault(); pick(+d.dataset.i); }
    });
    document.addEventListener("click", e => { if (!e.target.closest(".guess")) hide(); });
    return { hide };
  };

  /* ---------- small utilities ---------- */
  MX.copyText = async function (text, msgEl) {
    try { await navigator.clipboard.writeText(text); msgEl.textContent = "Copied."; }
    catch (e) { msgEl.textContent = "Couldn't reach the clipboard. Select the text above and copy it."; }
  };
  MX.initDevToggle = function () {
    const t = MX.$("devToggle");
    if (!t) return;
    t.onchange = () => {
      document.body.classList.toggle("dev", t.checked);
      const peek = MX.$("peekBtn");
      if (peek) peek.classList.toggle("hidden", !t.checked);
    };
  };
  MX.isLive = () => (window.MUSIC_CONFIG || {}).MODE === "live";

  window.MX = MX;
})();
