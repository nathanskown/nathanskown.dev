/* Guess the Track: audio sources.
   The game only talks to the object returned by MX.trackSource(). Both versions expose:
     pool()                       -> [{id,title,artist,year?,era?,genre}]
     prepare(song)                -> Promise; fills song.link / song.cover (live: previewUrl too); rejects if unplayable
     play(song,secs,onTick,onEnd,onError)
     stop()
   "mock" synthesizes a stand-in melody. "live" asks your Cloudflare Worker for a fresh
   Deezer preview link and plays it in a normal <audio> element. Audio is streamed
   straight from Deezer to the visitor and never stored. */
(function () {
  "use strict";

  const SHOW_COVERS = true;   // set false to skip album art from Deezer

  const PROVIDER = {
    previewCredit: "30-second preview · provided by Deezer · for private listening only",
    revealCredit: "Preview provided by Deezer",
    linkLabel: "Listen on Deezer ↗",
    badge: "Deezer"
  };

  function allSeeds() {
    const gen = window.TRACK_SEEDS_GENERATED || [];
    const curated = window.TRACK_SEEDS || [];
    const seen = new Set(curated.map(s => MX.norm(s.title) + "|" + MX.normArtist(s.artist)));
    const extra = gen.filter(s => !seen.has(MX.norm(s.title) + "|" + MX.normArtist(s.artist)));
    return curated.concat(extra);
  }

  function suggest(q) {
    const n = MX.norm(q);
    if (n.length < MX.suggestMin()) return Promise.resolve([]);
    const seen = new Set(), out = [];
    for (const s of allSeeds()) {
      if (MX.wordStart(MX.norm(s.title), n)) {
        const k = MX.norm(s.title) + "|" + MX.normArtist(s.artist);
        if (!seen.has(k)) { seen.add(k); out.push({ label: s.title, sub: s.artist }); }
        if (out.length >= 5) break;
      }
    }
    return Promise.resolve(out);
  }

  /* ---------------- MOCK ---------------- */
  function mockSource() {
    let ctx = null, nodes = [], raf = null;
    function stop() {
      nodes.forEach(n => { try { n.stop(); } catch (e) {} });
      nodes = [];
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }
    async function play(song, secs, onTick, onEnd) {
      stop();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        ctx = ctx || new AC();
        if (ctx.state === "suspended") await ctx.resume();
        const rng = MX.mulberry32(MX.hashStr(song.id));
        const scale = [0, 2, 4, 7, 9, 12];
        const root = 174.6 * Math.pow(2, Math.floor(rng() * 6) / 12);
        const t0 = ctx.currentTime + 0.05, step = 0.25;
        let deg = Math.floor(rng() * 4);
        const tone = (f, t, d, type, g) => {
          const o = ctx.createOscillator(), a = ctx.createGain();
          o.type = type; o.frequency.value = f;
          a.gain.setValueAtTime(0.0001, t);
          a.gain.exponentialRampToValueAtTime(g, t + 0.015);
          a.gain.exponentialRampToValueAtTime(0.0001, t + d);
          o.connect(a).connect(ctx.destination);
          o.start(t); o.stop(t + d + 0.02); nodes.push(o);
        };
        for (let i = 0; i * step < secs; i++) {
          deg = Math.max(0, Math.min(scale.length - 1, deg + Math.floor(rng() * 5) - 2));
          const f = root * Math.pow(2, scale[deg] / 12);
          const t = t0 + i * step, d = Math.min(0.22, t0 + secs - t);
          if (d <= 0) break;
          tone(f, t, d, "triangle", 0.18);
          if (i % 4 === 0) tone(f / 2, t, Math.min(0.9, t0 + secs - t), "sine", 0.14);
        }
      }
      const start = performance.now();
      (function tick() {
        const e = (performance.now() - start) / 1000;
        onTick(Math.min(e, secs));
        if (e < secs) raf = requestAnimationFrame(tick); else { raf = null; onEnd(); }
      })();
    }
    return {
      pool: () => Promise.resolve(allSeeds()),
      prepare: song => { song.link = "#"; song.cover = null; return Promise.resolve(song); },
      play, stop, suggest
    };
  }

  /* ---------------- LIVE (Deezer via your Worker) ---------------- */
  function liveSource() {
    const base = ((window.MUSIC_CONFIG || {}).WORKER_URL || "").replace(/\/+$/, "");
    let audio = null, raf = null;
    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (audio) { try { audio.pause(); } catch (e) {} }
    }
    async function resolve(song) {
      if (!base) throw new Error("WORKER_URL is not set in assets/config.js");
      const u = base + "/resolve?artist=" + encodeURIComponent(song.artist) + "&title=" + encodeURIComponent(song.title);
      const r = await fetch(u);
      if (!r.ok) throw new Error("resolve " + r.status);
      return r.json();
    }
    async function prepare(song) {
      const d = await resolve(song);
      if (!d.preview) throw new Error("no preview");
      song.previewUrl = d.preview;
      song.link = d.link || "#";
      song.cover = SHOW_COVERS ? (d.cover || null) : null;
      song.resolvedAt = Date.now();
      return song;
    }
    async function play(song, secs, onTick, onEnd, onError) {
      stop();
      // preview links can expire: refresh if the one we hold is more than 10 minutes old
      if (!song.previewUrl || Date.now() - (song.resolvedAt || 0) > 10 * 60 * 1000) {
        try { await prepare(song); } catch (e) { onError(e); return; }
      }
      audio = new Audio();
      audio.preload = "auto";
      let failed = false;
      audio.addEventListener("error", () => { if (!failed) { failed = true; stop(); onError(new Error("audio")); } });
      audio.src = song.previewUrl;
      try { await audio.play(); } catch (e) { if (!failed) { failed = true; onError(e); } return; }
      (function tick() {
        if (failed) return;
        const e = audio.currentTime;
        onTick(Math.min(e, secs));
        if (e < secs && !audio.ended) raf = requestAnimationFrame(tick);
        else { raf = null; audio.pause(); onEnd(); }
      })();
    }
    // start downloading the next clip while the player is still guessing (best effort)
    function warm(song) {
      if (!song.previewUrl || song._warm) return;
      try { const a = new Audio(); a.preload = "auto"; a.src = song.previewUrl; song._warm = a; } catch (e) { /* ignore */ }
    }
    return { pool: () => Promise.resolve(allSeeds()), prepare, play, stop, suggest, warm };
  }

  MX.trackProvider = PROVIDER;
  MX.trackSource = () => (MX.isLive() ? liveSource() : mockSource());
})();
