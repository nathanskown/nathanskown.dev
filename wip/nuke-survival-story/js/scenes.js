/*
 * PLEASE HOLD — scene graphics.
 *
 * Draws the SCENE panel on a <canvas> in green phosphor: one animated
 * "instrument" screen per room, a dossier card for whoever you're talking
 * to, the detonation that opens the game, and one screen per ending.
 *
 * Everything is drawn in a virtual 640 x 240 space and scaled to fit.
 * Each scene is a function (g, t, v): g = drawing kit, t = seconds since the
 * scene appeared, v = the game's view (time, flags, vars, room...).
 *
 * Character photos: set `photo: "img/people/jeff.jpg"` on a person in story.js
 * and the dossier card turns it into a green dithered portrait automatically.
 */
(function (root) {
  'use strict';

  var W = 640, H = 240;
  var C = {
    bg: '#030703', g: '#8dff9c', hi: '#d6ffdc', dim: '#4c9a57', mute: '#2a5531', line: '#1b3a20',
    amber: '#ffb84d', red: '#ff5f56', panel: '#061006'
  };
  var FONT_MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
  var FONT_VT = 'VT323, ui-monospace, monospace';

  function hm(str) { var m = /(\d+):(\d+)\s*(AM|PM)/i.exec(str); var h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + Number(m[2]); }
  function rng(seed) { var x = seed >>> 0 || 1; return function () { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmt(min) { var h = Math.floor(min / 60) % 24, m = Math.floor(min % 60); return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM'); }

  // ------------------------------------------------------------ drawing kit
  function kit(ctx) {
    var cssScale = 1;
    var chipCursor = null;
    var phone = false;
    var phoneFacts = [];
    // On a desktop-sized canvas, small labels grow until they're about 12px on screen.
    // On a phone the same growth puts 12px type on coordinates laid out for 8px type,
    // so labels collide. Phone scenes keep the drawing and list explicit label/value
    // pairs underneath, in the order the scene records them. Live numbers are recorded
    // again every frame, so the list can tick with the drawing.
    function fitSize(requested, sample, maxW) {
      var size = requested;
      if (requested < 16 && cssScale > 0) {
        var onScreen = requested * cssScale;
        if (onScreen < 12) size = Math.min(22, requested * (12 / onScreen));
      }
      if (sample && maxW > 8) {
        ctx.font = size + 'px ' + FONT_MONO;
        while (size > requested && ctx.measureText(sample).width > maxW) {
          size -= 0.5;
          ctx.font = size + 'px ' + FONT_MONO;
        }
      }
      return size;
    }
    var g = {
      ctx: ctx, C: C,
      setScale: function (s) {
        cssScale = s || 1;
        phone = cssScale > 0 && cssScale < 0.8;
        phoneFacts = [];
        chipCursor = null;
      },
      // One row of the phone strip. A value stays with its label; an empty value is a heading.
      fact: function (label, value) {
        label = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
        if (!label) return;
        value = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
        phoneFacts.push({ label: label, value: value });
      },
      glow: function (on, color) { ctx.shadowBlur = on ? 8 : 0; ctx.shadowColor = color || C.g; },
      line: function (x1, y1, x2, y2, c, w, dash) {
        ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = c || C.g; ctx.lineWidth = w || 1;
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      },
      rect: function (x, y, w, h, c, lw, dash) { ctx.setLineDash(dash || []); ctx.strokeStyle = c || C.g; ctx.lineWidth = lw || 1; ctx.strokeRect(x + .5, y + .5, w, h); ctx.setLineDash([]); },
      fill: function (x, y, w, h, c, a) { ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = c || C.g; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; },
      poly: function (pts, c, close, fillC, lw, a) {
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        if (close) ctx.closePath();
        if (fillC) { ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = fillC; ctx.fill(); ctx.globalAlpha = 1; }
        if (c) { ctx.strokeStyle = c; ctx.lineWidth = lw || 1; ctx.stroke(); }
      },
      circle: function (x, y, r, c, fillC, lw, a) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (fillC) { ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = fillC; ctx.fill(); ctx.globalAlpha = 1; }
        if (c) { ctx.strokeStyle = c; ctx.lineWidth = lw || 1; ctx.stroke(); }
      },
      arc: function (x, y, r, a0, a1, c, lw) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.strokeStyle = c || C.g; ctx.lineWidth = lw || 1; ctx.stroke(); },
      text: function (s, x, y, o) {
        o = o || {};
        if (phone) return;
        var size = o.size || 10;
        var align = o.align || 'left';
        if (!o.vt && !o.exact) {
          var room = o.max || (align === 'right' ? x - 8 : align === 'center' ? Math.min(x, W - x) * 2 - 8 : W - 8 - x);
          size = fitSize(size, String(s), room);
        }
        ctx.font = (o.bold ? '600 ' : '') + size + 'px ' + (o.vt ? FONT_VT : FONT_MONO);
        ctx.fillStyle = o.color || C.g; ctx.textAlign = align; ctx.textBaseline = o.base || 'alphabetic';
        ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        if (o.glow) g.glow(true, o.color);
        ctx.fillText(s, x, y); g.glow(false); ctx.globalAlpha = 1;
      },
      // a labelled instrument pane
      pane: function (x, y, w, h, title, c) {
        c = c || C.line;
        g.fill(x, y, w, h, C.panel, 1);
        g.rect(x, y, w, h, c);
        if (title) {
          var tSize = fitSize(9, title, Math.max(40, w - 26));
          ctx.font = tSize + 'px ' + FONT_MONO;
          var tw = ctx.measureText(title).width + 10;
          var th = Math.max(10, tSize + 2);
          g.fill(x + 8, y - th / 2, tw, th, C.bg);
          g.text(title, x + 13, y + 3, { size: tSize, color: C.dim, exact: true });
        }
      },
      gauge: function (x, y, w, label, frac, valText, color) {
        g.fact(label, valText || (Math.round(clamp(frac, 0, 1) * 100) + '%'));
        g.text(label, x, y, { size: 9, color: C.dim });
        g.text(valText, x + w, y, { size: 9, color: color || C.g, align: 'right' });
        g.rect(x, y + 4, w, 7, C.line);
        g.fill(x + 1, y + 5, Math.max(0, (w - 1) * clamp(frac, 0, 1)), 6, color || C.g, 0.85);
      },
      chip: function (x, y, label, on, color) {
        if (phone) {
          phoneFacts.push({ label: label, value: '', chip: true, on: !!on });
          return 0;
        }
        var size = fitSize(9, label, 300);
        ctx.font = size + 'px ' + FONT_MONO;
        var w = Math.ceil(ctx.measureText(label).width + size + 8);
        var h = Math.max(14, Math.ceil(size + 6));
        if (!chipCursor || Math.abs(chipCursor.base - y) > 1) chipCursor = { base: y, x: x, y: y, h: h, start: x };
        if (chipCursor.x + w > W - 8 && chipCursor.x > chipCursor.start + 1) {
          chipCursor.y += chipCursor.h + 4;
          chipCursor.x = chipCursor.start;
        }
        var dx = chipCursor.x, dy = Math.min(chipCursor.y, H - h - 2);
        g.rect(dx, dy, w, h, on ? (color || C.g) : C.line);
        g.circle(dx + size * 0.55, dy + h / 2, Math.max(2, size * 0.22), null, on ? (color || C.g) : C.mute);
        g.text(label, dx + size, dy + h * 0.72, { size: size, color: on ? (color || C.g) : C.dim, exact: true });
        chipCursor.x += w + 6;
        chipCursor.h = Math.max(chipCursor.h, h);
        return w;
      },
      big: function (s, x, y, size, color, align) { g.text(s, x, y, { vt: true, size: size, color: color || C.g, align: align || 'left', glow: true }); },
      dots: function (n, seed, x, y, w, h, c, r, jitterT) {
        var R = rng(seed);
        for (var i = 0; i < n; i++) {
          var px = x + R() * w, py = y + R() * h;
          if (jitterT) { px += Math.sin(jitterT * 1.3 + i) * 0.6; py += Math.cos(jitterT + i * 1.7) * 0.6; }
          g.fill(px, py, r || 1.6, r || 1.6, c || C.g, 0.85);
        }
      },
      wrap: function (s, x, y, maxW, lh, o) {
        o = o || {};
        if (phone) { g.text(s, x, y, o); return y + (lh || 16); }
        var size = fitSize(o.size || 10, null, 0);
        var drawn = { size: size, color: o.color, align: o.align, exact: true, vt: o.vt };
        ctx.font = size + 'px ' + FONT_MONO;
        var step = Math.max(lh, size + 3);
        var words = String(s).split(' '), line = '', yy = y;
        words.forEach(function (w) {
          var test = line ? line + ' ' + w : w;
          if (ctx.measureText(test).width > maxW && line) { g.text(line, x, yy, drawn); line = w; yy += step; }
          else line = test;
        });
        if (line) g.text(line, x, yy, drawn);
        return yy;
      },
      // The phone strip, in the order this frame's facts were recorded. Null on a desktop canvas.
      readout: function () {
        if (!phone) return null;
        return phoneFacts.slice();
      }
    };
    return g;
  }

  function F(v, f) { return !!(v.flags && v.flags[f]); }
  function V(v, k) { return (v.vars && v.vars[k]) || 0; }

  // ------------------------------------------------------------ shared pieces
  function waveform(g, x, y, w, h, t, amp, dead) {
    g.line(x, y + h / 2, x + w, y + h / 2, C.line, 1, [2, 3]);
    var pts = [];
    for (var i = 0; i <= w; i += 2) {
      var u = i / w;
      var env = dead ? 0 : (0.55 + 0.45 * Math.sin(t * 0.8 + u * 3));
      var yy = y + h / 2 + (Math.sin(i * 0.09 + t * 5) * 0.7 + Math.sin(i * 0.23 + t * 9) * 0.3) * amp * env;
      pts.push([x + i, yy]);
    }
    g.glow(true); g.poly(pts, C.g, false, null, 1.2); g.glow(false);
  }
  function compass(g, x, y, r) {
    g.circle(x, y, r, C.line);
    g.text('N', x, y - r - 3, { size: 8, color: C.dim, align: 'center' });
    g.line(x, y + r * .7, x, y - r * .7, C.dim);
  }
  function arrow(g, x1, y1, x2, y2, c, lw) {
    g.line(x1, y1, x2, y2, c, lw);
    var a = Math.atan2(y2 - y1, x2 - x1), s = 5;
    g.poly([[x2, y2], [x2 - s * Math.cos(a - .5), y2 - s * Math.sin(a - .5)], [x2 - s * Math.cos(a + .5), y2 - s * Math.sin(a + .5)]], null, true, c);
  }
  function car(g, x, y, c, horiz) { if (horiz) g.fill(x, y, 7, 3.5, c || C.g, .85); else g.fill(x, y, 3.5, 7, c || C.g, .85); }
  function person(g, x, y, c, s) { s = s || 1; g.circle(x, y - 6 * s, 2 * s, null, c || C.g); g.fill(x - 1.5 * s, y - 4 * s, 3 * s, 6 * s, c || C.g); }
  function pf(g, x, y, val, label, good) {
    var col = good ? C.g : (val < 5 ? C.red : C.amber);
    g.fact('PROTECTION FACTOR', 'PF ' + val);
    if (label) g.fact(label);
    g.text('PROTECTION FACTOR', x, y, { size: 8, color: C.dim });
    g.big('PF ' + val, x, y + 26, 30, col);
    g.text(label, x, y + 40, { size: 8, color: C.dim });
  }
  function timeline(g, x, y, w, t0, t1, now, marks) {
    g.line(x, y, x + w, y, C.dim);
    marks.forEach(function (m) {
      g.fact(m[1], m[0]);
      var px = x + w * (hm(m[0]) - t0) / (t1 - t0);
      g.line(px, y - 4, px, y + 4, C.dim);
      g.text(m[0].replace(' PM', ''), px, y + 15, { size: 8, color: C.dim, align: 'center' });
      g.text(m[1], px, y - 9, { size: 8, color: C.g, align: 'center' });
    });
    var nx = x + w * clamp((now - t0) / (t1 - t0), 0, 1);
    g.poly([[nx, y - 2], [nx - 4, y + 6], [nx + 4, y + 6]], null, true, C.amber);
  }
  function decayChart(g, x, y, w, h, t, title) {
    g.pane(x, y, w, h, title);
    g.fact(title);
    g.fact('DOSE RATE');
    g.fact('DAYS', '0–14');
    var px = x + 30, py = y + 16, pw = w - 44, ph = h - 40;
    g.line(px, py, px, py + ph, C.dim); g.line(px, py + ph, px + pw, py + ph, C.dim);
    g.text('DOSE RATE', px - 4, py - 4, { size: 8, color: C.dim });
    g.text('DAY 0', px, py + ph + 11, { size: 8, color: C.dim });
    g.text('14', px + pw, py + ph + 11, { size: 8, color: C.dim, align: 'right' });
    // the 7-10 rule: rate falls ~ t^-1.2
    var pts = [];
    for (var i = 0; i <= 60; i++) {
      var hrs = 1 + (i / 60) * 336, r = Math.pow(hrs, -1.2);
      pts.push([px + pw * (i / 60), py + ph - ph * Math.min(1, r)]);
    }
    g.glow(true); g.poly(pts, C.g, false, null, 1.4); g.glow(false);
    var day = (t * 1.6) % 16;
    var mx = px + pw * clamp(day / 14, 0, 1);
    g.line(mx, py, mx, py + ph, C.amber, 1, [3, 3]);
    g.fact('DAY', String(Math.min(14, Math.floor(day) + 1)));
    g.text('DAY ' + Math.min(14, Math.floor(day) + 1), mx + 4, py + 10, { size: 9, color: C.amber });
    g.fact('7 HRS', '1/10');
    g.fact('2 DAYS', '1/100');
    g.text('7 HRS: 1/10', px + pw * 0.12, py + ph * 0.45, { size: 8, color: C.dim });
    g.text('2 DAYS: 1/100', px + pw * 0.22, py + ph * 0.8, { size: 8, color: C.dim });
  }

  // ------------------------------------------------------------ rooms
  var rooms = {

    kitchen: function (g, t, v) {
      var dead = F(v, 'landline_dead');
      g.pane(14, 14, 300, 150, 'LINE 1 · BRIGHTLINE FIBER');
      var held = (v.time - hm('11:22 AM')) * 60 + Math.floor(t);
      var hh = Math.floor(held / 3600), mm = Math.floor(held / 60) % 60, ss = held % 60;
      var holdClock = (hh ? hh + ':' : '') + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
      g.fact('LINE 1 · BRIGHTLINE FIBER');
      g.fact(dead ? 'NO SIGNAL' : 'ON HOLD', holdClock);
      g.text(dead ? 'NO SIGNAL' : 'ON HOLD', 26, 36, { size: 10, color: dead ? C.red : C.amber });
      g.big(holdClock, 302, 42, 26, dead ? C.dim : C.g, 'right');
      waveform(g, 24, 60, 280, 70, t, 26, dead);
      g.fact(dead ? 'carrier lost 6:00 PM' : '♪ saxophone, key of regret');
      g.text(dead ? 'carrier lost 6:00 PM' : '♪ saxophone, key of regret', 26, 152, { size: 9, color: C.dim, max: 276 });
      // the east window
      g.pane(326, 14, 300, 150, 'EAST WINDOW');
      var wx = 340, wy = 28, ww = 272, wh = 124;
      g.line(wx, wy + 92, wx + ww, wy + 92, C.dim);
      // cloud on the horizon, drifting east and flattening through the day
      var age = clamp((v.time - hm('12:12 PM')) / 240, 0, 1);
      g.ctx.save(); g.ctx.beginPath(); g.ctx.rect(wx, wy, ww, wh); g.ctx.clip();
      var cx = wx + 190 + age * 40 + Math.sin(t * .2) * 1.5, capY = wy + 34 + age * 10;
      var capW = 34 + age * 70, capH = 13 - age * 5;
      // stem: narrow, widening slightly to the ground
      g.poly([[cx - 9, wy + 92], [cx - 4, capY + 8], [cx + 4, capY + 8], [cx + 9, wy + 92]], C.dim, true, C.mute, 1, .9);
      // cap: a flattened, rolling dome that spreads east into a shelf as the afternoon goes on
      var cap = [];
      for (var i = 0; i <= 24; i++) {
        var a = Math.PI + (i / 24) * Math.PI, wob = Math.sin(i * 1.9 + t * .6) * 1.5;
        cap.push([cx + age * capW * .35 + Math.cos(a) * (capW + wob), capY + Math.sin(a) * (capH + wob)]);
      }
      cap.push([cx + age * capW * .35 + capW, capY + 6]); cap.push([cx + age * capW * .35 - capW, capY + 6]);
      g.glow(true, C.amber); g.poly(cap, C.amber, true, C.dim, 1, .55); g.glow(false);
      for (var ring = 0; ring < 3; ring++) g.line(cx - capW * .6 + age * capW * .35, capY - ring * 3, cx + capW * .6 + age * capW * .35, capY - ring * 3, C.amber, .5);
      if (age > .3) {
        g.fact('DRIFTING EAST');
        g.text('DRIFTING EAST', cx + age * capW * .35, capY - capH - 8, { size: 8, color: C.amber, align: 'center' });
      }
      // shattered glass
      var R = rng(7), ix = wx + 92, iy = wy + 48;
      for (var k = 0; k < 14; k++) {
        var a = R() * Math.PI * 2, len = 30 + R() * 120, pts = [[ix, iy]];
        for (var s = 1; s <= 3; s++) pts.push([ix + Math.cos(a + (R() - .5) * .3) * len * s / 3, iy + Math.sin(a + (R() - .5) * .3) * len * s / 3]);
        g.poly(pts, C.g, false, null, .7);
      }
      g.ctx.restore();
      g.rect(wx, wy, ww, wh, C.dim, 2);
      // status strip
      var x = 14;
      x += g.chip(x, 186, 'POWER', false) + 6;
      x += g.chip(x, 186, F(v, 'cells_dead') ? 'CELL: NONE' : 'CELL: SOS', !F(v, 'cells_dead'), C.amber) + 6;
      x += g.chip(x, 186, F(v, 'water_off') ? 'CITY WATER: OFF' : 'CITY WATER: LOW', !F(v, 'water_off'), C.amber) + 6;
      x += g.chip(x, 186, F(v, 'bathtub_full') ? 'TUB: FULL' : 'TUB: EMPTY', F(v, 'bathtub_full')) + 6;
      g.chip(x, 186, 'TIGERS 7:10 · 2 TIX', false);
      if (F(v, 'call_waiting') && !F(v, 'talked_sister') && !dead && v.time < hm('3:40 PM') && Math.floor(t * 2) % 2) {
        g.fact('CALL WAITING');
        g.text('◉ CALL WAITING', 626, 216, { size: 10, color: C.amber, align: 'right' });
      }
    },

    basement: function (g, t, v) {
      var gy = 92;
      g.fact('SECTION', 'YOUR HOUSE');
      g.text('SECTION · YOUR HOUSE', 14, 18, { size: 9, color: C.dim });
      // house above ground
      g.poly([[110, gy], [110, 52], [230, 26], [350, 52], [350, gy]], C.dim, false);
      g.line(14, gy, 400, gy, C.g, 1.4);
      g.fact('GRADE');
      g.text('GRADE', 18, gy - 4, { size: 8, color: C.dim });
      // earth hatching
      for (var hx = 14; hx < 400; hx += 9) g.line(hx, gy + 3, hx - 5, gy + 9, C.mute);
      // basement box
      g.rect(120, gy + 6, 220, 104, C.g, 3);
      // window well (sealed or not)
      var sealed = F(v, 'basement_window_sealed');
      g.fill(318, gy + 8, 18, 12, sealed ? C.dim : C.amber, sealed ? .6 : .35);
      g.fact('WINDOW', sealed ? 'SEALED' : 'OPEN');
      g.text(sealed ? 'SEALED' : 'WINDOW', 346, gy + 18, { size: 8, color: sealed ? C.dim : C.amber });
      // furniture
      g.fact('HTR · FURN');
      g.rect(134, gy + 50, 16, 46, C.dim); g.text('HTR', 135, gy + 46, { size: 7, color: C.dim });
      g.rect(158, gy + 64, 26, 32, C.dim); g.text('FURN', 158, gy + 60, { size: 7, color: C.dim });
      for (var sh = 0; sh < 4; sh++) g.line(290, gy + 40 + sh * 14, 330, gy + 40 + sh * 14, C.dim);
      person(g, 236, gy + 92, C.hi, 1.3); g.fact('YOU'); g.text('YOU', 236, gy + 102, { size: 8, color: C.hi, align: 'center' });
      // incoming radiation, attenuated by mass
      for (var r = 0; r < 7; r++) {
        var rx = 140 + r * 30, ph = (t * 40 + r * 23) % 70;
        g.line(rx, 4 + ph * .2, rx, 20 + ph * .2, C.amber, 1);
        if (r % 3 === 0) g.line(rx, gy - 18, rx, gy + 4, C.amber, .6, [2, 3]);
      }
      // instruments
      g.pane(420, 14, 206, 96, 'SHELTER');
      pf(g, 432, 34, sealed ? 15 : 10, sealed ? 'below grade · window sealed' : 'below grade · window open');
      g.pane(420, 122, 206, 104, 'WATER ON HAND');
      var gal = (F(v, 'bathtub_full') ? 40 : 0) + (F(v, 'heater_drained') ? 40 : 0) + V(v, 'water') * 3;
      g.fact('WATER ON HAND', gal + ' GAL');
      g.big(gal + ' GAL', 432, 162, 30, gal ? C.g : C.red);
      g.gauge(432, 182, 182, 'NEED: 14 GAL / PERSON', gal / 14, gal >= 14 ? 'OK' : 'SHORT', gal >= 14 ? C.g : C.red);
      g.fact((F(v, 'bathtub_full') ? 'tub ✓ ' : 'tub · ') + (F(v, 'heater_drained') ? 'tank ✓ ' : 'tank · ') + V(v, 'water') + ' case(s)');
      g.text((F(v, 'bathtub_full') ? 'tub ✓ ' : 'tub · ') + (F(v, 'heater_drained') ? 'tank ✓ ' : 'tank · ') + V(v, 'water') + ' case(s)', 432, 214, { size: 8, color: C.dim });
    },

    street: function (g, t, v) {
      var cx = 250, cy = 112;
      g.fact('PLAT', 'CEDAR HOLLOW COURT');
      g.text('PLAT · CEDAR HOLLOW COURT', 14, 18, { size: 9, color: C.dim });
      // road
      g.circle(cx, cy, 44, C.dim, null, 1); g.circle(cx, cy, 30, C.line);
      g.line(cx - 10, cy + 42, cx - 10, 236, C.dim); g.line(cx + 10, cy + 42, cx + 10, 236, C.dim);
      g.fact('TO TEN MILE');
      g.text('TO TEN MILE ↓', cx + 16, 230, { size: 8, color: C.dim });
      // lots
      var lots = [[180, 'YOU', C.hi], [222, '', C.dim], [258, '', C.dim], [270, 'JEFF', C.g], [290, '', C.dim], [318, '', C.dim], [0, 'ADAM', C.amber], [40, '', C.dim], [140, '', C.dim], [62, 'ROB', C.g], [118, '', C.dim]];
      lots.forEach(function (L) {
        var a = L[0] * Math.PI / 180, hx = cx + Math.cos(a) * 82, hy = cy + Math.sin(a) * 66;
        var small = L[1] === 'YOU';
        g.rect(hx - (small ? 9 : 13), hy - (small ? 7 : 10), small ? 18 : 26, small ? 14 : 20, L[2], small ? 1.6 : 1);
        if (L[1]) g.text(L[1], hx, hy + (L[0] === 270 ? -16 : 24), { size: 9, color: L[2], align: 'center' });
        if (L[1] === 'ADAM') { g.rect(hx - 22, hy - 18, 44, 36, C.amber, 1, [2, 2]); g.circle(hx + 18, hy, 3, C.amber); }
      });
      g.fact('YOU · JEFF · ADAM · ROB');
      person(g, cx, cy + 4, C.hi); g.fact('YOU ARE HERE'); g.text('YOU ARE HERE', cx, cy + 18, { size: 7, color: C.hi, align: 'center' });
      if (F(v, 'refugees')) for (var c = 0; c < 6; c++) car(g, cx - 8, 150 + c * 13 + Math.sin(t + c) * .5, C.amber, false);
      // wind + plume
      g.pane(430, 14, 196, 120, 'WIND · PLUME');
      compass(g, 470, 74, 22);
      for (var w = 0; w < 3; w++) { var off = ((t * 18) + w * 22) % 66; arrow(g, 506 + off * .2, 50 + w * 22, 540 + off * .4, 50 + w * 22, C.dim); }
      g.fact('WIND', 'W 14 MPH');
      g.fact('DETROIT PLUME → E');
      g.text('W 14 MPH', 520, 120, { size: 9, color: C.g, align: 'center' });
      g.text('DETROIT PLUME → E', 444, 128, { size: 8, color: C.amber });
      g.pane(430, 146, 196, 80, 'NEIGHBORS');
      g.fact('11 HOMES · 1 BUNKER');
      g.fact('HOA CHECK-IN', v.time > hm('2:00 PM') ? 'DONE' : 'IN PROGRESS');
      g.fact('STRANGERS AT CURB', F(v, 'refugees') ? 'YES' : 'NO');
      g.text('11 HOMES · 1 BUNKER', 442, 168, { size: 9, color: C.g });
      g.text('HOA CHECK-IN: ' + (v.time > hm('2:00 PM') ? 'DONE' : 'IN PROGRESS'), 442, 184, { size: 9, color: C.dim });
      g.text(F(v, 'refugees') ? 'STRANGERS AT CURB: YES' : 'STRANGERS AT CURB: NO', 442, 200, { size: 9, color: F(v, 'refugees') ? C.amber : C.dim });
    },

    garage: function (g, t, v) {
      var gone = F(v, 'ray_left');
      g.pane(14, 14, 360, 150, "JEFF'S PICKUP");
      if (!gone) {
        var pts = [[40, 120], [40, 92], [120, 92], [140, 64], [210, 64], [222, 92], [340, 92], [348, 120]];
        g.glow(true); g.poly(pts, C.g, true, null, 1.4); g.glow(false);
        g.line(150, 68, 150, 92, C.g); g.line(205, 68, 214, 92, C.g);
        [[90, 122], [290, 122]].forEach(function (w) { g.circle(w[0], w[1], 16, C.g, C.bg, 1.4); g.circle(w[0], w[1], 6, C.dim); });
        if (F(v, 'truck_fueled')) {
          g.fact('LOADED', 'blankets · cooler · water · seed packets');
          g.text('LOADED: blankets · cooler · water · seed packets', 30, 152, { size: 8, color: C.dim });
        }
      } else {
        g.fact('BAY EMPTY');
        g.fact('WENT NORTH. KEEP THE RADIO. AM ONLY. — J.');
        g.text('BAY EMPTY', 194, 90, { size: 14, color: C.dim, align: 'center' });
        g.text('WENT NORTH. KEEP THE RADIO. AM ONLY. — J.', 194, 112, { size: 9, color: C.amber, align: 'center' });
      }
      // fuel gauge
      g.pane(386, 14, 240, 150, 'FUEL');
      var full = F(v, 'truck_fueled') ? 0.92 : 0.25;
      g.arc(506, 120, 70, Math.PI, 0, C.dim, 2);
      for (var k = 0; k <= 4; k++) { var a = Math.PI + k * Math.PI / 4; g.line(506 + Math.cos(a) * 62, 120 + Math.sin(a) * 62, 506 + Math.cos(a) * 70, 120 + Math.sin(a) * 70, C.dim); }
      g.text('E', 432, 134, { size: 10, color: C.red }); g.text('F', 574, 134, { size: 10, color: C.g });
      var na = Math.PI + full * Math.PI + Math.sin(t * 3) * .01;
      g.glow(true, C.amber); g.line(506, 120, 506 + Math.cos(na) * 58, 120 + Math.sin(na) * 58, C.amber, 2); g.glow(false);
      g.fact('FUEL', F(v, 'truck_fueled') ? '+5 GAL · ~210 MI' : '1/4 TANK · ~100 MI');
      g.text(F(v, 'truck_fueled') ? '+5 GAL · ~210 MI' : '1/4 TANK · ~100 MI', 506, 154, { size: 9, color: C.g, align: 'center' });
      // route north
      g.fact('ROUTE', 'CABIN NEAR GAYLORD');
      g.fact('NOVI · FLINT · GRAYLING · GAYLORD');
      g.fact('196 MI');
      g.pane(14, 178, 612, 50, 'ROUTE · CABIN NEAR GAYLORD');
      var stops = [['NOVI', 0], ['FLINT', .3], ['GRAYLING', .78], ['GAYLORD', 1]];
      g.line(40, 206, 600, 206, C.dim, 1, [4, 3]);
      stops.forEach(function (s) { var x = 40 + 560 * s[1]; g.circle(x, 206, 3, C.g, C.bg); g.text(s[0], x, 222, { size: 8, color: C.dim, align: 'center' }); });
      g.text('196 MI', 320, 200, { size: 8, color: C.dim, align: 'center' });
    },

    dunmore: function (g, t, v) {
      var gy = 70;
      g.fact('SECTION', "ADAM'S PROPERTY");
      g.text('SECTION · ADAM\'S PROPERTY', 14, 18, { size: 9, color: C.dim });
      for (var f = 14; f < 420; f += 8) g.line(f, gy - 26, f, gy, C.mute);
      g.line(14, gy - 26, 420, gy - 26, C.mute);
      g.line(14, gy, 420, gy, C.g, 1.4);
      for (var hx = 14; hx < 420; hx += 9) g.line(hx, gy + 3, hx - 5, gy + 9, C.mute);
      // hatch + shaft + container
      g.fill(194, gy - 4, 30, 5, C.amber); g.fact('HATCH'); g.text('HATCH', 209, gy - 8, { size: 8, color: C.amber, align: 'center' });
      g.rect(200, gy + 1, 18, 60, C.dim); for (var l = 0; l < 6; l++) g.line(202, gy + 8 + l * 9, 216, gy + 8 + l * 9, C.dim);
      g.rect(90, gy + 62, 300, 80, C.g, 2);
      g.fact('DEPTH', '8 FT'); g.text('8 FT', 76, gy + 40, { size: 8, color: C.dim }); g.line(84, gy + 2, 84, gy + 60, C.dim, 1, [2, 2]);
      for (var b = 0; b < 4; b++) g.rect(100 + b * 26, gy + 72, 20, 10, C.dim);
      for (var s2 = 0; s2 < 3; s2++) g.line(270, gy + 82 + s2 * 16, 380, gy + 82 + s2 * 16, C.dim);
      g.fact('RATED', '4');
      g.fact('RULES', '1–44');
      g.text('RATED: 4', 240, gy + 132, { size: 9, color: C.g });
      g.text('RULES 1–44', 300, gy + 132, { size: 9, color: C.dim });
      // geiger counter
      g.pane(436, 14, 190, 120, 'GEIGER · CALIBRATED BY OWNER');
      var clicks = Math.floor(t * 3) % 7 === 0;
      g.fact('GEIGER', '0.02 mR/hr');
      if (clicks) g.fact('· tick ·');
      g.fact('BACKGROUND. FOR NOW.');
      g.big('0.02', 450, 70, 36, C.g); g.text('mR/hr', 540, 70, { size: 10, color: C.dim });
      g.text(clicks ? '· tick ·' : '', 450, 92, { size: 9, color: C.amber });
      g.text('BACKGROUND. FOR NOW.', 450, 120, { size: 8, color: C.dim });
      g.pane(436, 146, 190, 80, 'SUPPLIES');
      g.fact('FOOD', '1 YR');
      g.fact('FILTERS', '✓');
      var has = F(v, 'dale_has_insulin');
      g.fact('INSULIN', has ? '✓' : 'NONE');
      g.fact('HATCH', F(v, 'dale_open') ? 'OPEN' : 'SEALED');
      g.text('FOOD      1 YR', 448, 168, { size: 9, color: C.g });
      g.text('FILTERS   ✓', 448, 184, { size: 9, color: C.g });
      g.text('INSULIN   ' + (has ? '✓' : 'NONE'), 448, 200, { size: 9, color: has ? C.g : C.red });
      g.text('HATCH     ' + (F(v, 'dale_open') ? 'OPEN' : 'SEALED'), 448, 216, { size: 9, color: F(v, 'dale_open') ? C.amber : C.dim });
    },

    hub: function (g, t, v) {
      g.fact('INTERSECTION', 'TEN MILE & TAFT');
      g.text('INTERSECTION · TEN MILE & TAFT', 14, 18, { size: 9, color: C.dim });
      // roads
      g.fill(14, 88, 440, 64, C.panel); g.line(14, 88, 440, 88, C.dim); g.line(14, 152, 440, 152, C.dim); g.line(14, 120, 440, 120, C.amber, 1, [6, 5]);
      g.fill(196, 26, 64, 210, C.panel); g.line(196, 26, 196, 88, C.dim); g.line(260, 26, 260, 88, C.dim); g.line(196, 152, 196, 236, C.dim); g.line(260, 152, 260, 236, C.dim);
      g.fact('10 MILE'); g.fact('TAFT');
      g.text('10 MILE', 30, 82, { size: 9, color: C.dim }); g.text('TAFT', 266, 40, { size: 9, color: C.dim });
      // dark signals
      [[186, 78], [266, 78], [186, 158], [266, 158]].forEach(function (p) { g.rect(p[0], p[1], 6, 14, C.dim); for (var i = 0; i < 3; i++) g.circle(p[0] + 3.5, p[1] + 3 + i * 4, 1.4, C.mute); });
      // westbound crawl, eastbound empty
      for (var c = 0; c < 22; c++) { var x = ((c * 24 - t * 4) % 460 + 460) % 460; car(g, 14 + x, 96 + (c % 2) * 10, C.g, true); }
      for (var p2 = 0; p2 < 14; p2++) { var px = ((p2 * 33 - t * 2) % 440 + 440) % 440; person(g, 14 + px, 86, C.dim, .6); }
      // the officer
      person(g, 228, 132, C.amber, 1.2);
      var arm = Math.sin(t * 2.4) * 8;
      g.line(228, 124, 216, 120 + arm, C.amber, 1.4); g.line(228, 124, 240, 122 - arm, C.amber, 1.4);
      g.pane(470, 14, 156, 212, 'FLOW');
      g.fact('FLOW');
      g.fact('WESTBOUND', '3 MPH');
      g.fact('EASTBOUND', 'EMPTY');
      g.fact('SIGNALS', 'DARK');
      g.fact('OFFICER', 'IAN');
      g.fact('DIRECTING BY HAND');
      g.text('WESTBOUND', 482, 44, { size: 9, color: C.dim }); g.big('3 MPH', 482, 74, 28, C.g);
      g.text('EASTBOUND', 482, 104, { size: 9, color: C.dim }); g.big('EMPTY', 482, 134, 28, C.dim);
      g.text('SIGNALS: DARK', 482, 166, { size: 9, color: C.red });
      g.text('OFFICER: IAN', 482, 182, { size: 9, color: C.amber });
      g.text('DIRECTING BY HAND', 482, 198, { size: 9, color: C.dim });
    },

    civic: function (g, t, v) {
      g.fact('CIVIC CENTER · TRIAGE BOARD');
      g.text('CIVIC CENTER · TRIAGE BOARD', 14, 18, { size: 9, color: C.dim });
      var since = Math.max(0, v.time - hm('12:40 PM'));
      var cats = [['1', 'IMMEDIATE', C.red, .22], ['2', 'DELAYED', C.amber, .38], ['3', 'MINOR', C.g, .9], ['4', 'EXPECTANT', C.dim, .08]];
      cats.forEach(function (k, i) {
        var x = 14 + i * 108, n = Math.floor(since * k[3]);
        g.fact(k[1], n + ' · TAG ' + k[0]);
        g.pane(x, 30, 98, 150, k[1]);
        g.big(String(n), x + 49, 92, 42, k[2], 'center');
        g.text('TAG ' + k[0], x + 49, 112, { size: 9, color: C.dim, align: 'center' });
        for (var b = 0; b < Math.min(40, n); b++) g.fill(x + 10 + (b % 10) * 8, 128 + Math.floor(b / 10) * 9, 5, 5, k[2], .7);
      });
      g.pane(452, 30, 174, 70, 'GENERATOR · 60 HZ');
      waveform(g, 462, 44, 154, 46, t * 3, 14, false);
      g.fact('GENERATOR', '60 HZ');
      g.pane(452, 112, 174, 68, 'PLAN · REV. 1962');
      g.fact('P. 40', '3 SHELTERS');
      g.fact('OPEN', '0');
      g.fact('GUIDANCE', 'GET INSIDE');
      g.fact('Arrivals since 12:40', String(Math.floor(since * 1.58)));
      g.fact('Burns · glass · eyes. A lot of them looked at it.');
      g.text('P. 40: 3 SHELTERS', 464, 132, { size: 9, color: C.dim });
      g.text('OPEN: 0', 464, 148, { size: 9, color: C.red });
      g.text('GUIDANCE: GET INSIDE', 464, 164, { size: 9, color: C.g });
      g.text('Arrivals since 12:40: ' + Math.floor(since * 1.58), 14, 204, { size: 10, color: C.g });
      g.text('Burns · glass · eyes. A lot of them looked at it.', 14, 222, { size: 9, color: C.dim });
    },

    school: function (g, t, v) {
      var moving = F(v, 'dana_convinced');
      g.fact('FLOOR PLAN', 'NOVI HIGH · GYM + MUSIC WING');
      g.text('FLOOR PLAN · NOVI HIGH · GYM + MUSIC WING', 14, 18, { size: 9, color: C.dim });
      g.rect(14, 28, 380, 180, C.g, 1.4);
      for (var sx = 0; sx < 8; sx++) for (var sy = 0; sy < 4; sy++) g.rect(30 + sx * 45, 40 + sy * 40, 30, 26, C.mute, 1);
      g.fact('SKYLIGHTS');
      g.text('SKYLIGHTS', 30, 200, { size: 8, color: C.dim });
      // stairwell
      g.rect(394, 100, 36, 40, C.amber); g.fact('STAIRS'); g.text('STAIRS', 412, 154, { size: 8, color: C.amber, align: 'center' });
      var R = rng(11);
      for (var i = 0; i < 200; i++) {
        var x0 = 24 + R() * 360, y0 = 34 + R() * 168;
        if (moving) {
          var u = ((t * 0.12 + i / 200) % 1);
          var x = x0 + (412 - x0) * u, y = y0 + (120 - y0) * u;
          if (u > .96) continue;
          g.fill(x, y, 1.8, 1.8, C.g, .85);
        } else g.fill(x0 + Math.sin(t + i) * .5, y0, 1.8, 1.8, C.g, .85);
      }
      g.pane(446, 28, 180, 86, 'GYM');
      g.fact('GYM');
      pf(g, 458, 48, 2, 'glass-block roof', false);
      g.pane(446, 128, 180, 80, 'BAND ROOM (BELOW)');
      g.fact('BAND ROOM (BELOW)');
      pf(g, 458, 148, 40, 'cinderblock · below grade', true);
      g.fact(moving ? 'MOVING' : 'IN GYM', moving ? Math.min(200, Math.floor(t * 9)) + ' / 206' : '206');
      g.text(moving ? 'MOVING: ' + Math.min(200, Math.floor(t * 9)) + ' / 206' : 'IN GYM: 206', 14, 226, { size: 10, color: moving ? C.amber : C.red });
    },

    bandroom: function (g, t, v) {
      var gy = 70;
      g.fact('SECTION', 'MUSIC WING');
      g.text('SECTION · MUSIC WING', 14, 18, { size: 9, color: C.dim });
      g.poly([[40, gy], [40, 34], [360, 34], [360, gy]], C.dim);
      g.line(14, gy, 400, gy, C.g, 1.4);
      for (var hx = 14; hx < 400; hx += 9) g.line(hx, gy + 3, hx - 5, gy + 9, C.mute);
      g.rect(60, gy + 30, 290, 120, C.g, 3);
      g.fact('3 FT EARTH + SLAB');
      g.text('3 FT EARTH + SLAB', 64, gy + 22, { size: 8, color: C.dim });
      // risers + people
      for (var r = 0; r < 3; r++) g.line(90 + r * 10, gy + 120 - r * 22, 300 - r * 10, gy + 120 - r * 22, C.dim);
      var n = F(v, 'dana_convinced') ? 206 : 0;
      g.dots(Math.min(160, n), 5, 90, gy + 60, 210, 70, C.g, 1.6, t);
      // door
      var ready = F(v, 'dana_convinced') && F(v, 'school_water') && F(v, 'school_sheeting');
      g.rect(334, gy + 70, 12, 46, ready ? C.amber : C.dim, 2);
      g.fact('DOOR', 'OPEN');
      g.text('DOOR: OPEN', 340, gy + 132, { size: 8, color: C.amber, align: 'center' });
      g.pane(420, 14, 206, 212, 'BEFORE THE DOOR CLOSES');
      g.fact('BEFORE THE DOOR CLOSES');
      var items = [['People moved down', F(v, 'dana_convinced')], ['Water stocked', F(v, 'school_water')], ['Stairwell windows sealed', F(v, 'school_sheeting')], ['Food (bonus)', F(v, 'school_food')]];
      items.forEach(function (it) { g.fact(it[0], it[1] ? '✓' : 'NOT YET'); });
      items.forEach(function (it, i) {
        g.rect(434, 42 + i * 30, 12, 12, it[1] ? C.g : C.dim);
        if (it[1]) g.text('✓', 436, 52 + i * 30, { size: 11, color: C.g });
        g.text(it[0], 454, 52 + i * 30, { size: 10, color: it[1] ? C.g : C.dim });
      });
      pf(g, 434, 176, 40, ready ? 'ready · close the door' : 'not ready yet', ready);
    },

    retirement: function (g, t, v) {
      var locked = v.time >= hm('4:00 PM');
      g.fact('WILLOW GLEN · YESTERDAY\'S CROSSWORD');
      g.text('WILLOW GLEN · YESTERDAY\'S CROSSWORD', 14, 18, { size: 9, color: C.dim });
      var grid = ['SUMMER#', 'A#ALOE#', 'NAP#LAP', 'D#BEACH', '#SUN#OR', 'PIER#AD'];
      var filled = Math.floor((v.time - hm('12:00 PM')) / 9 + t * .05), n = 0;
      for (var r = 0; r < 6; r++) for (var c = 0; c < 7; c++) {
        var x = 20 + c * 24, y = 28 + r * 24, ch = grid[r][c];
        if (ch === '#') g.fill(x, y, 24, 24, C.dim, .7); else {
          g.rect(x, y, 24, 24, C.dim);
          if (n++ < filled) g.text(ch, x + 12, y + 17, { size: 13, color: C.g, align: 'center', vt: true });
        }
      }
      g.fact('IN PEN. OUT OF SPITE.');
      g.text('IN PEN. OUT OF SPITE.', 20, 186, { size: 9, color: C.dim });
      g.fact('FLOOR PLAN', 'GROUND FLOOR · NO BASEMENT');
      g.pane(210, 14, 416, 212, 'FLOOR PLAN · GROUND FLOOR · NO BASEMENT');
      g.rect(226, 34, 384, 176, C.dim);
      g.fill(226, 108, 384, 26, C.mute, .35); g.fact('INTERIOR HALLWAY'); g.text('INTERIOR HALLWAY', 418, 125, { size: 9, color: C.g, align: 'center' });
      for (var w = 0; w < 6; w++) { g.line(240 + w * 62, 34, 270 + w * 62, 34, C.amber, 2); g.line(240 + w * 62, 210, 270 + w * 62, 210, C.amber, 2); }
      g.fact('DINING');
      g.text('DINING', 260, 64, { size: 9, color: C.dim });
      var R = rng(3);
      for (var i = 0; i < 60; i++) {
        var x0 = 240 + R() * 140, y0 = 44 + R() * 50, x1 = 236 + (i / 60) * 360, y1 = 121 + (i % 2) * 6;
        var u = locked ? 1 : 0;
        g.fill(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 2.2, 2.2, i === 59 ? C.amber : C.g, .85);
      }
      g.fact(locked ? 'DOORS LOCKED' : 'DOORS LOCK AT', '4:00');
      g.text(locked ? 'DOORS LOCKED 4:00' : 'DOORS LOCK AT 4:00', 600, 200, { size: 9, color: locked ? C.red : C.amber, align: 'right' });
    },

    church: function (g, t, v) {
      g.fact("ST. CLARE\'S · ORDER OF SERVICE");
      g.text("ST. CLARE\'S · ORDER OF SERVICE", 14, 18, { size: 9, color: C.dim });
      g.fact('TODAY');
      g.pane(14, 30, 400, 100, 'TODAY');
      // Guests gather at 1:00, the ceremony starts at 1:15, and the party goes downstairs at 1:45.
      timeline(g, 40, 92, 350, hm('12:50 PM'), hm('2:00 PM'), v.time, [['1:00 PM', 'GUESTS'], ['1:15 PM', 'CEREMONY'], ['1:45 PM', 'DOWNSTAIRS']]);
      // rings
      g.glow(true); g.circle(120, 180, 26, C.g, null, 2); g.circle(152, 180, 26, C.amber, null, 2); g.glow(false);
      g.fact('MADY & RYAN');
      g.text('MADY & RYAN', 136, 226, { size: 10, color: C.g, align: 'center' });
      // cake
      var cx = 300;
      [[60, 16], [44, 16], [28, 16]].forEach(function (tier, i) { g.rect(cx - tier[0] / 2, 206 - (i + 1) * tier[1], tier[0], tier[1], C.dim); });
      g.fact('RECEPTION', 'CANCELED');
      g.text('RECEPTION: CANCELED', cx, 226, { size: 9, color: C.red, align: 'center' });
      g.fact('UNDER THE CAKE TABLE');
      g.pane(430, 30, 196, 196, 'UNDER THE CAKE TABLE');
      var left = (F(v, 'witnessed') || F(v, 'wedding_over')) ? 0 : 6;
      for (var k = 0; k < 6; k++) g.rect(446 + (k % 3) * 56, 60 + Math.floor(k / 3) * 46, 48, 36, k < left ? C.g : C.mute);
      g.fact('BOTTLED WATER', left + ' CASES');
      g.big(left + ' CASES', 528, 190, 28, left ? C.g : C.dim, 'center');
      g.text('BOTTLED WATER', 528, 210, { size: 9, color: C.dim, align: 'center' });
    },

    strip: function (g, t, v) {
      g.fact('GRAND RIVER · STOREFRONTS');
      g.text('GRAND RIVER · STOREFRONTS', 14, 18, { size: 9, color: C.dim });
      var stores = [['HARDWARE', '5:00 PM'], ['PHARMACY', '4:30 PM'], ['CONEY', '6:00 PM'], ['GROCERY', null]];
      stores.forEach(function (s) {
        var open = !s[1] || v.time < hm(s[1]);
        g.fact(s[0], s[1] ? (open ? 'OPEN TILL ' + s[1].replace(' PM', '') : 'CLOSED') : 'DOORS PRIED');
      });
      stores.forEach(function (s, i) {
        var x = 14 + i * 154, open = !s[1] || v.time < hm(s[1]);
        g.rect(x, 30, 144, 130, C.dim);
        g.fill(x + 10, 40, 124, 22, C.panel); g.rect(x + 10, 40, 124, 22, open ? C.g : C.mute);
        g.text(s[0], x + 72, 55, { size: 10, color: open ? C.g : C.dim, align: 'center' });
        g.rect(x + 50, 90, 44, 70, C.dim);
        var lit = open && (s[0] !== 'CONEY' || Math.floor(t * 1.5) % 6 !== 0);
        g.glow(lit, lit ? C.g : C.red); g.circle(x + 22, 120, 6, null, open ? C.g : C.red); g.glow(false);
        g.text(s[1] ? (open ? 'OPEN TILL ' + s[1].replace(' PM', '') : 'CLOSED') : 'DOORS PRIED', x + 72, 178, { size: 9, color: open ? C.g : C.red, align: 'center' });
      });
      for (var c = 0; c < 18; c++) car(g, 30 + c * 33, 200 + (c % 2) * 14, C.mute, true);
      g.fact('WE\'RE STILL HERE · GO LIONS');
      g.text('WE\'RE STILL HERE · GO LIONS', 626, 232, { size: 9, color: C.amber, align: 'right' });
    },

    hardware: function (g, t, v) {
      g.pane(14, 14, 250, 212, 'REGISTER · PAPER ROLL');
      g.fact('REGISTER · PAPER ROLL');
      var items = ['6MIL SHEETING   18.00', 'DUCT TAPE x2     7.00', 'D BATTERIES      9.50', 'FLASHLIGHT      12.00', 'SIPHON PUMP     15.00', 'AM RADIO        30.00', 'SHEETING        18.00', 'TAPE             3.50', 'BUCKET W/ LID    8.00', 'TARP 10X12      14.00'];
      items.forEach(function (line) {
        var m = /^(.*\S)\s+(\d+\.\d+)$/.exec(line);
        if (m) g.fact(m[1], m[2]); else g.fact(line.trim());
      });
      var off = (t * 14) % (items.length * 16);
      g.ctx.save(); g.ctx.beginPath(); g.ctx.rect(30, 30, 218, 170); g.ctx.clip();
      g.fill(40, 30, 200, 170, '#0b170b');
      for (var i = 0; i < items.length * 2; i++) g.text(items[i % items.length], 52, 200 - i * 16 + off, { size: 10, color: C.g });
      g.ctx.restore();
      g.fact('CASH ONLY');
      g.text('CASH ONLY', 139, 216, { size: 10, color: C.amber, align: 'center' });
      g.pane(280, 14, 346, 100, 'SIGN ON THE DOOR');
      g.fact('NO RETURNS.');
      g.fact('YES, EVEN NOW.');
      g.fact('— CHRIS · CLOSING AT 5');
      g.big('NO RETURNS.', 296, 56, 30, C.g); g.big('YES, EVEN NOW.', 296, 88, 30, C.amber);
      g.text('— CHRIS · CLOSING AT 5', 610, 106, { size: 9, color: C.dim, align: 'right' });
      g.fact('STOCK');
      g.pane(280, 126, 346, 100, 'STOCK');
      g.gauge(296, 150, 314, 'PLASTIC SHEETING', clamp(1 - (v.time - hm('12:30 PM')) / 300, 0, 1), '', C.g);
      g.gauge(296, 174, 314, 'DUCT TAPE (GRAY)', clamp(.6 - (v.time - hm('12:30 PM')) / 400, 0, 1), '', C.g);
      g.gauge(296, 198, 314, 'GENERATORS', 0, 'SOLD OUT 12:30', C.red);
    },

    pharmacy: function (g, t, v) {
      var served = 40 + Math.floor((v.time - hm('12:30 PM')) * 1.2) + Math.floor(t / 4);
      g.pane(14, 14, 250, 120, 'NOW SERVING');
      g.fact('NOW SERVING', String(served));
      g.big(String(served), 139, 104, 70, C.amber, 'center');
      g.fact('POTASSIUM IODIDE', '1 PER FAMILY');
      g.pane(280, 14, 346, 120, 'POTASSIUM IODIDE · 1 PER FAMILY');
      var stock = clamp(1 - (v.time - hm('12:30 PM')) / 240, 0, 1);
      g.gauge(296, 44, 314, 'STOCK', stock, Math.round(stock * 100) + '%', stock > .3 ? C.g : C.red);
      g.fact('Protects the thyroid only, from radioactive iodine only. Take only when health officials say to. Walls protect you.');
      g.wrap('Protects the thyroid only, from radioactive iodine only. Take only when health officials say to. Walls protect you.', 296, 80, 314, 13, { size: 9, color: C.dim });
      g.pane(14, 146, 300, 80, 'FRIDGE · ON CAR BATTERY');
      g.fact('FRIDGE · ON CAR BATTERY', '38°F');
      g.big('38°F', 30, 194, 34, C.g);
      g.gauge(130, 178, 170, 'BATTERY', clamp(.9 - (v.time - hm('12:30 PM')) / 600, 0, 1), '', C.g);
      g.pane(330, 146, 296, 80, 'LINE');
      for (var i = 0; i < 26; i++) person(g, 350 + i * 10.5 + Math.sin(t * .6 + i) * .4, 206, C.g, .7);
      g.fact('PAINTER\'S TAPE → OUT THE DOOR');
      g.text('PAINTER\'S TAPE → OUT THE DOOR', 344, 220, { size: 8, color: C.dim });
    },

    diner: function (g, t, v) {
      var dial = [];
      for (var n = 0; n <= 22; n += 4) dial.push(String(540 + n * 48));
      g.fact('RADIO · AM BAND', dial.join('  '));
      g.pane(14, 14, 612, 70, 'RADIO · AM BAND');
      g.line(30, 52, 610, 52, C.dim);
      for (var f = 0; f <= 22; f++) { var x = 30 + f * (580 / 22); g.line(x, 46, x, 52 + (f % 2 ? 0 : 4), C.dim); if (f % 4 === 0) g.text(String(540 + f * 48), x, 72, { size: 8, color: C.dim, align: 'center' }); }
      var nx = 30 + 580 * (0.42 + Math.sin(t * .4) * .01);
      g.glow(true, C.amber); g.line(nx, 30, nx, 64, C.amber, 2); g.glow(false);
      g.fact('GET INSIDE · STAY INSIDE · STAY TUNED');
      g.text('GET INSIDE · STAY INSIDE · STAY TUNED', 320, 38, { size: 9, color: C.g, align: 'center' });
      // griddle with coneys
      g.fact('GRIDDLE · ON GENERATOR');
      g.pane(14, 98, 400, 128, 'GRIDDLE · ON GENERATOR');
      g.fill(30, 190, 368, 6, C.dim, .8);
      for (var c = 0; c < 8; c++) {
        var x0 = 44 + c * 44;
        g.rect(x0, 172, 34, 14, C.g); g.line(x0 + 4, 179, x0 + 30, 179, C.amber, 2);
        for (var s = 0; s < 2; s++) { var ph = (t * 18 + c * 13 + s * 20) % 40; g.line(x0 + 10 + s * 12 + Math.sin(ph * .3) * 3, 166 - ph, x0 + 12 + s * 12 + Math.sin(ph * .3 + 1) * 3, 160 - ph, C.dim, 1); }
      }
      g.fact('CHILI · MUSTARD · ONION');
      g.text('CHILI · MUSTARD · ONION', 210, 214, { size: 9, color: C.dim, align: 'center' });
      g.pane(430, 98, 196, 128, 'TODAY');
      g.fact('TODAY');
      g.fact('SINCE', '1968');
      g.fact('SEATS', 'FULL');
      g.fact('TAB', '$0.00');
      g.fact('CLOSES', '6:00 PM');
      g.fact('LIGHTS', 'ON');
      g.text('SINCE 1968', 446, 124, { size: 10, color: C.g });
      g.text('SEATS: FULL', 446, 144, { size: 10, color: C.g });
      g.text('TAB: $0.00', 446, 164, { size: 10, color: C.amber });
      g.text('CLOSES: 6:00 PM', 446, 184, { size: 10, color: C.dim });
      g.text('LIGHTS: ON', 446, 204, { size: 10, color: C.g });
    },

    grocery: function (g, t, v) {
      g.fact('AISLE 7 · SHELF AUDIT');
      g.pane(14, 14, 360, 212, 'AISLE 7 · SHELF AUDIT');
      for (var r = 0; r < 5; r++) {
        var y = 42 + r * 36;
        g.line(30, y + 22, 358, y + 22, C.dim, 2);
        for (var b = 0; b < 8; b++) g.rect(36 + b * 40, y, 30, 20, C.mute, 1, [2, 2]);
      }
      g.fact('SPRING WATER 24PK', '$4.99');
      g.text('SPRING WATER 24PK  $4.99', 30, 220, { size: 9, color: C.dim });
      g.fact('INVENTORY');
      g.pane(390, 14, 236, 132, 'INVENTORY');
      [['WATER', 0], ['BREAD', 0], ['BATTERIES', 0], ['CANNED', .04], ['CHARCOAL', .6]].forEach(function (it, i) {
        g.gauge(404, 38 + i * 21, 206, it[0], it[1], Math.round(it[1] * 100) + '%', it[1] ? C.g : C.red);
      });
      g.fact('CART · NEAR REGISTERS');
      g.pane(390, 158, 236, 68, 'CART · NEAR REGISTERS');
      var gone = F(v, 'trent_gone');
      for (var k = 0; k < 8 && !gone; k++) g.rect(404 + (k % 4) * 26, 172 + Math.floor(k / 4) * 18, 22, 14, C.amber);
      g.fact(gone ? 'GONE' : '8 CASES · ARMED');
      g.text(gone ? 'GONE' : '8 CASES · ARMED', 600, 216, { size: 9, color: gone ? C.dim : C.red, align: 'right' });
    },

    mall: function (g, t, v) {
      var warned = F(v, 'warned_mall');
      g.fact('SECTION', 'CENTER COURT');
      g.text('SECTION · CENTER COURT', 14, 18, { size: 9, color: C.dim });
      var pts = [];
      for (var i = 0; i <= 10; i++) pts.push([60 + i * 34, i % 2 ? 40 : 70]);
      g.glow(true); g.poly(pts, C.g, false, null, 1.4); g.glow(false);
      var R = rng(4);
      for (var c = 0; c < 9; c++) { var cx = 70 + R() * 320, cy = 46 + R() * 18; g.poly([[cx, cy], [cx + 8, cy + 6], [cx + 3, cy + 12]], C.amber, false, null, .7); }
      g.fact('3 FLOORS OF GLASS');
      g.text('3 FLOORS OF GLASS', 230, 30, { size: 8, color: C.amber, align: 'center' });
      g.line(60, 70, 60, 210, C.dim); g.line(400, 70, 400, 210, C.dim); g.line(14, 210, 626, 210, C.dim);
      g.circle(230, 196, 22, C.dim); g.fact('FOUNTAIN'); g.text('FOUNTAIN', 230, 228, { size: 8, color: C.dim, align: 'center' });
      g.rect(420, 120, 206, 90, C.g, 1.4);
      g.fact('SERVICE CORRIDORS');
      g.fact('CINDERBLOCK · NO WINDOWS');
      g.text('SERVICE CORRIDORS', 523, 112, { size: 9, color: C.g, align: 'center' }); g.text('CINDERBLOCK · NO WINDOWS', 523, 224, { size: 8, color: C.dim, align: 'center' });
      var R2 = rng(9);
      for (var p = 0; p < 260; p++) {
        var x0 = 70 + R2() * 320, y0 = 150 + R2() * 56, x1 = 430 + R2() * 186, y1 = 130 + R2() * 72;
        var u = warned ? clamp((t * .25) - (p / 260) * .6, 0, 1) : 0;
        g.fill(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 1.6, 1.6, C.g, .8);
      }
      g.fact(warned ? 'MOVING' : '~1,000 UNDER GLASS');
      g.text(warned ? 'MOVING' : '~1,000 UNDER GLASS', 230, 104, { size: 11, color: warned ? C.g : C.red, align: 'center' });
    },

    interchange: function (g, t, v) {
      g.fact('INTERCHANGE', 'I-96 / I-696 / I-275 / M-5');
      g.text('INTERCHANGE · I-96 / I-696 / I-275 / M-5', 14, 18, { size: 9, color: C.dim });
      g.line(14, 120, 626, 120, C.dim, 10); g.line(14, 120, 626, 120, C.bg, 6);
      g.line(320, 236, 320, 30, C.dim, 10); g.line(320, 236, 320, 30, C.bg, 6);
      g.line(330, 110, 560, 20, C.dim, 8); g.line(330, 110, 560, 20, C.bg, 4);
      [[290, 92], [350, 148]].forEach(function (c) { g.arc(c[0], c[1], 26, 0, Math.PI * 2, C.mute, 3); });
      g.fact('I-96'); g.fact('I-275'); g.fact('M-5');
      g.text('I-96', 30, 110, { size: 9, color: C.dim }); g.text('I-275', 328, 228, { size: 9, color: C.dim }); g.text('M-5 ↗', 520, 44, { size: 9, color: C.dim });
      var R = rng(21);
      for (var c = 0; c < 70; c++) { var x = 20 + R() * 600; if (Math.abs(x - 320) < 20) continue; car(g, x, 116 + (R() > .5 ? -2 : 2), C.g, true); }
      for (var d = 0; d < 30; d++) car(g, 316 + (d % 2) * 5, 34 + d * 7, C.g, false);
      if (Math.floor(t * 2) % 2) for (var h = 0; h < 6; h++) g.fill(60 + h * 90, 113, 2, 2, C.amber);
      g.circle(170, 120, 8, C.amber); g.fact("'06 IMPALA · NO GAS CAP"); g.text("'06 IMPALA · NO GAS CAP", 140, 146, { size: 8, color: C.amber });
      if (!F(v, 'haddads_moved') && !F(v, 'haddads_walked')) { person(g, 470, 140, C.hi); person(g, 478, 140, C.hi, .7); g.fact('2 ON SHOULDER'); g.text('2 ON SHOULDER', 474, 156, { size: 8, color: C.hi, align: 'center' }); }
      g.fact('TRAFFIC', '0 MPH');
      g.big('0 MPH', 600, 228, 30, C.red, 'right');
    },

    office: function (g, t, v) {
      g.fact('KESSLER OFFICE PARK · ELEVATION');
      g.fact('A · B · C');
      g.text('KESSLER OFFICE PARK · ELEVATION', 14, 18, { size: 9, color: C.dim });
      [[30, 'A'], [190, 'B'], [350, 'C']].forEach(function (b) {
        g.rect(b[0], 40, 130, 140, C.dim);
        for (var r = 0; r < 3; r++) for (var c = 0; c < 5; c++) {
          var lit = b[1] === 'B' && r === 0 && c === 2;
          var on = lit && Math.floor(t * 1.2) % 5 !== 0;
          if (on) { g.glow(true, C.amber); g.fill(b[0] + 10 + c * 24, 52 + r * 42, 16, 28, C.amber, .9); g.glow(false); }
          else g.rect(b[0] + 10 + c * 24, 52 + r * 42, 16, 28, C.mute);
        }
      });
      g.line(258, 80, 258, 180, C.amber, 1.5, [3, 2]); g.rect(244, 182, 28, 16, C.amber); g.fact('GEN'); g.text('GEN', 258, 194, { size: 8, color: C.amber, align: 'center' });
      g.fact('CONF RM B');
      g.text('CONF RM B', 258, 34, { size: 8, color: C.amber, align: 'center' });
      g.poly([[40, 214], [120, 206], [220, 210], [300, 218], [200, 228], [80, 226]], C.dim, true);
      g.line(150, 214, 150, 204, C.g); g.line(150, 204, 156, 200, C.g); g.fact('heron'); g.text('heron', 160, 202, { size: 8, color: C.dim });
      g.pane(500, 40, 126, 140, 'DECK DUE');
      var left = hm('5:00 PM') - v.time;
      g.fact('DECK DUE', left > 0 ? Math.floor(left / 60) + 'h ' + (left % 60) + 'm' : 'LATE');
      g.fact('SLIDE 12', '[CHART GOES HERE]');
      g.big(left > 0 ? Math.floor(left / 60) + 'h ' + (left % 60) + 'm' : 'LATE', 563, 100, 26, left > 0 ? C.amber : C.red, 'center');
      g.text('SLIDE 12:', 516, 130, { size: 9, color: C.dim }); g.text('[CHART GOES', 516, 146, { size: 9, color: C.g }); g.text(' HERE]', 516, 160, { size: 9, color: C.g });
    },

    m5: function (g, t, v) {
      g.fact('M-5 NORTHBOUND · LANE DENSITY');
      g.text('M-5 NORTHBOUND · LANE DENSITY', 14, 18, { size: 9, color: C.dim });
      for (var l = 0; l <= 6; l++) g.line(80 + l * 40, 26, 80 + l * 40, 236, l === 0 || l === 6 ? C.dim : C.mute, 1, l === 0 || l === 6 ? [] : [6, 6]);
      for (var ln = 0; ln < 6; ln++) for (var c = 0; c < 22; c++) {
        var y = 30 + ((c * 9.5 - t * (0.4 + ln * .05)) % 210 + 210) % 210;
        car(g, 92 + ln * 40, y, ln === 0 || ln === 5 ? C.dim : C.g, false);
      }
      g.fact('SHOULDERS FULL');
      g.text('SHOULDERS FULL', 196, 232, { size: 8, color: C.dim, align: 'center' });
      g.pane(380, 26, 246, 90, 'GREEN SIGN');
      g.fact('M-5 NORTH');
      g.fact('Walled Lake', '4');
      g.fact('Commerce', '7');
      g.fact('Gaylord', '190');
      g.text('M-5 NORTH', 396, 52, { size: 12, color: C.g, vt: true });
      g.text('Walled Lake      4', 396, 72, { size: 10, color: C.g }); g.text('Commerce         7', 396, 88, { size: 10, color: C.g }); g.text('Gaylord        190', 396, 104, { size: 10, color: C.g });
      g.pane(380, 130, 246, 96, 'CONDITIONS');
      g.fact('CONDITIONS', '0.4 MPH');
      g.fact('WATER', '$20 / BOTTLE');
      g.fact('NOT THIS WAY');
      g.big('0.4 MPH', 396, 170, 30, C.red);
      g.text('WATER: $20 / BOTTLE', 396, 194, { size: 9, color: C.amber });
      g.text('NOT THIS WAY', 396, 212, { size: 9, color: C.dim });
    }
  };

  // ------------------------------------------------------------ endings
  var endings = {
    shelter_in_place: function (g, t, v) { decayChart(g, 14, 14, 400, 212, t, 'BAND ROOM · DAYS 1–14'); stamp(g, t, 'DOOR CLOSED', '206 PEOPLE'); },
    home_base: function (g, t, v) { decayChart(g, 14, 14, 400, 212, t, 'YOUR BASEMENT · DAYS 1–14'); stamp(g, t, 'DOOR CLOSED', (v.sheltered || 1) + ' INSIDE'); },
    up_north: function (g, t, v) {
      var stuck = F(v, 'route_m5');
      g.fact(stuck ? 'M-5 · COMMERCE TWP' : 'ROUTE · NOVI TO OTSEGO COUNTY');
      g.pane(14, 14, 612, 212, stuck ? 'M-5 · COMMERCE TWP' : 'ROUTE · NOVI TO OTSEGO COUNTY');
      var path = [[60, 200], [140, 170], [230, 150], [320, 110], [420, 80], [520, 52], [580, 40]];
      g.poly(path, C.dim, false, null, 1.2);
      for (var p = 0; p < 26; p++) { var x = 40 + (p * 47) % 560, y = 40 + (p * 31) % 150; g.poly([[x, y - 8], [x - 5, y + 4], [x + 5, y + 4]], C.mute, true); }
      var u = stuck ? clamp(t * .05, 0, .14) : (t * .06) % 1.1;
      u = clamp(u, 0, 1);
      var seg = u * (path.length - 1), i = Math.floor(seg), f = seg - i, a = path[Math.min(i, path.length - 1)], b = path[Math.min(i + 1, path.length - 1)];
      var tx = a[0] + (b[0] - a[0]) * f, ty = a[1] + (b[1] - a[1]) * f;
      g.glow(true, C.amber); g.fill(tx - 5, ty - 3, 10, 6, C.amber); g.glow(false);
      g.fact('NOVI');
      g.fact('CABIN');
      g.fact(stuck ? 'STOPPED' : (u >= 1 ? 'ARRIVED 11:40 PM' : 'NORTHBOUND'));
      g.text('NOVI', 60, 218, { size: 9, color: C.dim, align: 'center' }); g.text('CABIN', 580, 30, { size: 9, color: C.g, align: 'center' });
      g.big(stuck ? 'STOPPED' : (u >= 1 ? 'ARRIVED 11:40 PM' : 'NORTHBOUND'), 610, 216, 26, stuck ? C.red : C.g, 'right');
    },
    bunker: function (g, t, v) {
      g.pane(14, 14, 612, 212, 'RULES · 1 OF 44 · LAMINATED');
      var rules = ['RULE 1: NO ONE TOUCHES THE GEIGER COUNTER.', 'RULE 9: WE DO NOT OPEN THE HATCH.', 'RULE 14: TOILET PAPER IS RATIONED BY THE SQUARE.', 'RULE 22: QUIET HOURS 2200–0600. NO EXCEPTIONS.', 'RULE 31: POWDERED EGGS ARE FOR EMERGENCIES.', '         (THIS IS NOT YET AN EMERGENCY.)', 'RULE 38: NO TALKING ABOUT THE FENCE.', 'RULE 44: SEE RULE 9.'];
      g.fact('RULES · 1 OF 44 · LAMINATED');
      rules.forEach(function (r) { g.fact(r.trim()); });
      var off = (t * 10) % (rules.length * 22);
      g.ctx.save(); g.ctx.beginPath(); g.ctx.rect(20, 24, 600, 196); g.ctx.clip();
      for (var i = 0; i < rules.length * 2; i++) g.text(rules[i % rules.length], 40, 220 - i * 22 + off, { size: 12, color: i % rules.length === 1 ? C.amber : C.g });
      g.ctx.restore();
    },
    locked_out: function (g, t, v) {
      g.fact('HATCH · TOP VIEW');
      g.pane(14, 14, 612, 212, 'HATCH · TOP VIEW');
      var cx = 320, cy = 120;
      g.circle(cx, cy, 50, C.g, C.panel, 3); g.circle(cx, cy, 14, C.dim); for (var s = 0; s < 4; s++) { var a = s * Math.PI / 2 + t * .05; g.line(cx, cy, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, C.dim, 2); }
      var beat = (t % 3.2);
      if (t < 30) for (var r = 0; r < 3; r++) { var rr = 50 + (beat * 40) + r * 16; g.circle(cx, cy, rr, null, null); g.ctx.globalAlpha = clamp(1 - beat / 2, 0, 1) * .6; g.circle(cx, cy, rr, C.red, null, 1); g.ctx.globalAlpha = 1; }
      if (beat < .6 && t < 30) { g.fact('THUD'); g.big('THUD', cx + 90, cy - 40, 32, C.red); }
      g.fact('RULE 9.');
      g.text('RULE 9.', 610, 216, { size: 12, color: C.amber, align: 'right' });
    },
    business_as_usual: function (g, t, v) {
      g.fact('Q3 REGIONAL PORTFOLIO REVIEW · SLIDE 12 OF 41');
      g.pane(14, 14, 612, 212, 'Q3 REGIONAL PORTFOLIO REVIEW · SLIDE 12 OF 41');
      var bars = [.82, .64, .48, .2];
      bars.forEach(function (b, i) { g.fill(80 + i * 90, 190 - b * 130, 50, b * 130, C.g, .8); });
      g.line(60, 190, 460, 190, C.dim);
      g.fact('HEADWINDS');
      g.text('HEADWINDS', 440 + Math.round(Math.sin(t * .3)) * 2, 70, { size: 12, color: C.g });
      var haze = clamp((t - 4) / 20, 0, .6);
      g.fill(14, 14, 612, 212, C.dim, haze * .35);
      if (v.fallout) g.fact(v.fallout);
      g.text(v.fallout || '', 610, 216, { size: 11, color: C.dim, align: 'right' });
    }
  };
  function stamp(g, t, a, b) {
    g.pane(430, 14, 196, 212, 'STATUS');
    g.fact('STATUS', a);
    g.fact(b);
    g.fact('STILL ON HOLD');
    g.rect(450, 40, 156, 110, C.g, 2); g.circle(474, 98, 5, C.g, C.g);
    g.text(a, 528, 172, { size: 11, color: C.g, align: 'center' });
    g.text(b, 528, 192, { size: 10, color: C.dim, align: 'center' });
    g.text('STILL ON HOLD', 528, 212, { size: 9, color: C.amber, align: 'center' });
  }

  // ------------------------------------------------------------ title, detonation, static
  function title(g, t) {
    g.fact('PLEASE HOLD');
    g.fact('NOVI, MI · ONE AFTERNOON · TYPE “PLAY”');
    g.big('PLEASE HOLD', 320, 120, 84, C.g, 'center');
    waveform(g, 120, 140, 400, 40, t, 12, false);
    g.text('NOVI, MI · ONE AFTERNOON · TYPE “PLAY”', 320, 206, { size: 11, color: C.dim, align: 'center' });
  }
  function detonation(g, t, skipFlash) {
    var ctx = g.ctx;
    var gy = 190;
    g.line(0, gy, W, gy, C.dim);
    for (var b = 0; b < 30; b++) { var bx = b * 22, bh = 6 + ((b * 7) % 5) * 5; g.rect(bx, gy - bh, 14, bh, C.mute); }
    var r = Math.min(70, t * 26), rise = Math.min(80, t * 12);
    var fx = 470, fy = gy - 20 - rise;
    if (t > .2) {
      g.poly([[fx - 10, gy], [fx - 8, fy + 20], [fx + 8, fy + 20], [fx + 10, gy]], null, true, C.dim, 1, .7);
      for (var i = 0; i < 14; i++) { var a = i / 14 * Math.PI * 2 + t * .3; g.circle(fx + Math.cos(a) * r * .6, fy + Math.sin(a) * r * .25, r * .35, null, i % 3 ? C.dim : C.amber, 1, .28); }
      g.glow(true, C.amber); g.circle(fx, fy, r * .3, null, C.amber, 1, .5); g.glow(false);
    }
    var shock = (t - 0.4) * 60;
    if (shock > 0) g.circle(fx, gy, shock, C.g, null, 1);
    var count = Math.min(112, Math.floor(t * 14));
    g.fact('T+', count + ' s');
    g.fact(count >= 112 ? 'SHOCK ARRIVED · WINDOWS OUT' : 'COUNTING · SOUND HAS NOT ARRIVED');
    g.fact('DETROIT · ~25 MI ESE');
    g.text('T+', 24, 40, { size: 10, color: C.dim });
    g.big(String(count) + ' s', 24, 76, 38, count >= 112 ? C.red : C.g);
    g.text(count >= 112 ? 'SHOCK ARRIVED · WINDOWS OUT' : 'COUNTING · SOUND HAS NOT ARRIVED', 24, 96, { size: 9, color: count >= 112 ? C.red : C.dim });
    g.text('DETROIT · ~25 MI ESE', fx, gy + 18, { size: 9, color: C.amber, align: 'center' });
    // The opening white-out is a flash. Reduced motion and FLASH OFF both skip it.
    if (!skipFlash && t < .35) { ctx.globalAlpha = 1 - t / .35; ctx.fillStyle = '#f2fff3'; ctx.fillRect(-W, -H, W * 3, H * 3); ctx.globalAlpha = 1; }
  }
  function noise(g, t, still) {
    var R = rng(still ? 7 : Math.floor(t * 30) + 1);
    var n = still ? 180 : 900;
    for (var i = 0; i < n; i++) g.fill(R() * W, R() * H, 2 + R() * 6, 1 + R() * 2, R() > .8 ? C.red : C.g, still ? .35 : R() * .7);
    g.fact('SIGNAL LOST');
    g.big('SIGNAL LOST', 320, 132, 52, C.red, 'center');
  }

  // ------------------------------------------------------------ dossier card
  var photoCache = {};
  function ditherPhoto(src, cb) {
    if (photoCache[src] !== undefined) return photoCache[src];
    photoCache[src] = null;
    var img = new Image();
    img.onload = function () {
      var w = 120, h = 150, c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d');
      var s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
      x.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      var d = x.getImageData(0, 0, w, h), px = d.data;
      var bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (var i = 0; i < px.length; i += 4) {
        var p = i / 4, xx = p % w, yy = Math.floor(p / w);
        var lum = (px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11) / 255;
        var on = lum * 1.15 > (bayer[(yy % 4) * 4 + (xx % 4)] + .5) / 16;
        px[i] = on ? 141 : 3; px[i + 1] = on ? 255 : 10; px[i + 2] = on ? 156 : 4; px[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      photoCache[src] = c; if (cb) cb();
    };
    img.onerror = function () { photoCache[src] = false; };
    img.src = src;
    return null;
  }
  function silhouette(g, x, y, w, h, prop, t) {
    var cx = x + w / 2;
    g.fill(x, y, w, h, '#071207');
    for (var sy = y; sy < y + h; sy += 3) g.line(x, sy, x + w, sy, '#0c1d0c');
    g.glow(true);
    g.circle(cx, y + 52, 24, C.g, C.panel, 1.6);
    g.poly([[x + 14, y + h], [x + 22, y + 104], [cx - 16, y + 86], [cx + 16, y + 86], [x + w - 22, y + 104], [x + w - 14, y + h]], C.g, false, null, 1.6);
    g.glow(false);
    var P = {
      clipboard: function () { g.rect(cx + 16, y + 104, 24, 32, C.amber, 1.4); g.line(cx + 22, y + 114, cx + 34, y + 114, C.amber); g.line(cx + 22, y + 122, cx + 34, y + 122, C.amber); },
      cap: function () { g.poly([[cx - 26, y + 42], [cx - 22, y + 26], [cx + 22, y + 26], [cx + 26, y + 42], [cx + 40, y + 44]], C.amber, false, null, 1.6); },
      vest: function () { g.rect(cx - 26, y + 100, 52, 40, C.amber, 1.4); g.line(cx - 26, y + 112, cx + 26, y + 112, C.amber); },
      binder: function () { g.rect(cx - 36, y + 106, 30, 36, C.amber, 1.4); g.fact('1962'); g.text('1962', cx - 21, y + 128, { size: 8, color: C.amber, align: 'center' }); },
      helmet: function () { g.arc(cx, y + 46, 30, Math.PI, Math.PI * 2, C.amber, 2.2); g.line(cx - 34, y + 46, cx + 34, y + 46, C.amber, 2); },
      whistle: function () { g.line(cx - 10, y + 82, cx, y + 104, C.amber); g.line(cx + 10, y + 82, cx, y + 104, C.amber); g.rect(cx - 6, y + 104, 12, 7, C.amber, 1.4); },
      cardigan: function () { g.line(cx, y + 88, cx, y + h, C.amber, 1.4); for (var b = 0; b < 4; b++) g.circle(cx + 5, y + 100 + b * 12, 1.6, null, C.amber); g.rect(cx - 22, y + 30, 18, 8, C.amber); g.rect(cx + 4, y + 30, 18, 8, C.amber); },
      veil: function () { g.poly([[cx - 22, y + 36], [cx - 40, y + h - 10], [cx + 40, y + h - 10], [cx + 22, y + 36]], C.amber, false, null, 1, .3); },
      glasses: function () { g.circle(cx - 9, y + 52, 6, C.amber); g.circle(cx + 9, y + 52, 6, C.amber); g.arc(cx, y + 58, 22, .2, Math.PI - .2, C.amber, 1); },
      flashlight: function () { g.rect(cx + 18, y + 108, 26, 8, C.amber, 1.4); g.poly([[cx + 44, y + 106], [cx + 64, y + 96], [cx + 64, y + 128], [cx + 44, y + 118]], C.amber, true, C.amber, 1, .15); },
      hairnet: function () { for (var k = 0; k < 6; k++) g.arc(cx, y + 50, 26 - k * 2, Math.PI * 1.1, Math.PI * 1.9, C.amber, .8); },
      hood: function () { g.arc(cx, y + 54, 32, Math.PI * .9, Math.PI * 2.1, C.amber, 1.6); },
      laptop: function () { g.rect(cx - 30, y + 116, 60, 30, C.amber, 1.4); g.line(cx - 36, y + 146, cx + 36, y + 146, C.amber, 2); },
      pair: function () { g.circle(cx + 30, y + 92, 12, C.amber, C.panel, 1.4); g.poly([[cx + 16, y + h], [cx + 20, y + 112], [cx + 40, y + 112], [cx + 44, y + h]], C.amber, false, null, 1.4); }
    };
    if (P[prop]) P[prop]();
  }
  function dossier(g, t, v, pid, p) {
    var d = p.dossier || {};
    g.fact(p.name.toUpperCase());
    g.pane(14, 14, 150, 212, 'SUBJECT');
    var img = p.photo ? ditherPhoto(p.photo) : null;
    if (img) g.ctx.drawImage(img, 29, 30, 120, 150);
    else silhouette(g, 29, 30, 120, 150, (p.portrait || {}).prop, t);
    g.fact('FILE', String(Math.abs(hash(pid)) % 9000 + 1000));
    g.fact(img ? 'PHOTO · DITHERED' : 'NO PHOTO ON FILE');
    g.text('FILE ' + (Math.abs(hash(pid)) % 9000 + 1000), 89, 200, { size: 9, color: C.dim, align: 'center' });
    g.text(img ? 'PHOTO · DITHERED' : 'NO PHOTO ON FILE', 89, 214, { size: 8, color: C.dim, align: 'center' });
    g.pane(180, 14, 446, 212, 'DOSSIER');
    g.big(p.name.toUpperCase(), 196, 58, 34, C.g);
    var rows = [['AGE', d.age || '—'], ['ROLE', d.role || '—'], ['STATUS', d.status || '—'], ['LAST SEEN', v.roomName + ' · ' + v.clock]];
    rows.forEach(function (r) { g.fact(r[0], r[1]); });
    var y = 86;
    rows.forEach(function (r) {
      g.text(r[0], 196, y, { size: 9, color: C.dim });
      y = g.wrap(r[1], 280, y, 330, 13, { size: 10, color: r[0] === 'STATUS' ? C.amber : C.g }) + 22;
    });
    if (Math.floor(t * 1.5) % 2) g.fill(196, 212, 8, 2, C.g);
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ------------------------------------------------------------ renderer
  function Renderer(canvas, story, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var g = kit(ctx);
    var scene = { key: 'title' }, started = now(), raf = 0, view = {};
    var reduce = !!opts.reduceMotion;
    var noFlash = !!opts.noFlash;
    var onReadout = opts.onReadout || null;
    var lastSig = null;
    function now() { return (window.performance ? performance.now() : Date.now()) / 1000; }
    function size() {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    function draw() {
      size();
      var t = reduce ? 4 : now() - started;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var s = Math.min(canvas.width / W, canvas.height / H), ox = (canvas.width - W * s) / 2, oy = (canvas.height - H * s) / 2;
      g.setScale(s / dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(s, 0, 0, s, ox, oy);
      ctx.lineCap = 'round';
      try {
        var k = scene.key;
        var skipBright = reduce || noFlash;
        if (k === 'title') title(g, t);
        else if (k === 'detonation') detonation(g, reduce ? 12 : t, skipBright);
        else if (k === 'static') noise(g, t, skipBright);
        else if (k.indexOf('room:') === 0) (rooms[scene.id] || title)(g, t, view);
        else if (k.indexOf('end:') === 0) (endings[scene.id] || title)(g, t, view);
        else if (k.indexOf('person:') === 0) dossier(g, t, view, scene.id, story.people[scene.id]);
      } catch (e) { if (window.console) console.error('scene', scene.key, e); }
      publish();
    }
    function publish() {
      if (!onReadout) return;
      var items = g.readout();
      var sig = '';
      if (items) for (var i = 0; i < items.length; i++) {
        var it = items[i];
        sig += (it.chip ? (it.on ? '+' : '-') : '=') + it.label + '\t' + it.value + '\n';
      }
      if (sig === lastSig) return;
      lastSig = sig;
      onReadout(items);
    }
    function loop() { draw(); raf = reduce ? 0 : window.requestAnimationFrame(loop); }
    return {
      show: function (key, id, v) {
        view = v || view;
        if (key !== scene.key) { scene = { key: key, id: id }; started = now(); }
        draw();
        if (reduce) { if (raf) { window.cancelAnimationFrame(raf); raf = 0; } return; }
        if (!raf) raf = window.requestAnimationFrame(loop);
      },
      update: function (v) { view = v || view; if (reduce) draw(); },
      redraw: draw,
      setNoFlash: function (v) { noFlash = !!v; },
      readout: function () { return g.readout(); },
      has: function (kind, id) { return kind === 'room' ? !!rooms[id] : kind === 'ending' ? !!endings[id] : false; }
    };
  }

  var api = { Renderer: Renderer, rooms: rooms, endings: endings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PleaseHoldScenes = api;
})(typeof window !== 'undefined' ? window : this);
