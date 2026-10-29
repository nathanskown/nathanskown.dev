/* Sports data layer for the NSKN Sports pages.
   Live data comes from ESPN's public site API through the site's own cached proxy (/api/espn/...),
   and slower data (standings, injuries, leaders, house ratings and odds) from JSON files the
   refresh-sports workflow commits under /data/sports/. Everything here turns those payloads into
   small, predictable records the page templates can render. Betting odds, ESPN win probabilities
   and pick'em data in the feeds are deliberately ignored. */
(function () {
  'use strict';

  var LEAGUES = {
    nfl:   { sport: 'football',   slug: 'nfl',                     label: 'NFL',           short: 'NFL',  teams: true, model: true, unit: 'pts' },
    mlb:   { sport: 'baseball',   slug: 'mlb',                     label: 'MLB',           short: 'MLB',  teams: true, model: true, unit: 'runs' },
    nhl:   { sport: 'hockey',     slug: 'nhl',                     label: 'NHL',           short: 'NHL',  teams: true, model: true, unit: 'goals' },
    nba:   { sport: 'basketball', slug: 'nba',                     label: 'NBA',           short: 'NBA',  teams: true, model: true, unit: 'pts' },
    ncaaf: { sport: 'football',   slug: 'college-football',        label: 'College football', short: 'NCAAF', teams: true, model: true, unit: 'pts', groups: '80' },
    ncaab: { sport: 'basketball', slug: 'mens-college-basketball', label: 'College basketball', short: 'NCAAB', teams: true, model: true, unit: 'pts', groups: '50' },
    ncaah: { sport: 'hockey',     slug: 'mens-college-hockey',     label: 'College hockey', short: 'NCAAH', teams: true, model: true, unit: 'goals' },
    epl:   { sport: 'soccer',     slug: 'eng.1',                   label: 'Premier League', short: 'EPL' },
    ucl:   { sport: 'soccer',     slug: 'uefa.champions',          label: 'Champions League', short: 'UCL' },
    mls:   { sport: 'soccer',     slug: 'usa.1',                   label: 'MLS',           short: 'MLS' },
    pga:   { sport: 'golf',       slug: 'pga',                     label: 'PGA Tour',      short: 'PGA',  kind: 'golf' },
    atp:   { sport: 'tennis',     slug: 'atp',                     label: 'ATP',           short: 'ATP',  kind: 'tennis' },
    wta:   { sport: 'tennis',     slug: 'wta',                     label: 'WTA',           short: 'WTA',  kind: 'tennis' }
  };
  var ORDER = ['nfl', 'mlb', 'nhl', 'nba', 'ncaaf', 'ncaab', 'ncaah', 'epl', 'ucl', 'mls', 'pga', 'atp', 'wta'];

  function api(lg, kind, params) {
    var L = LEAGUES[lg];
    var base = kind === 'standings' ? '/api/espn/v2/sports/' : '/api/espn/site/v2/sports/';
    var q = [];
    for (var k in (params || {})) if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.push(k + '=' + encodeURIComponent(params[k]));
    return base + L.sport + '/' + L.slug + '/' + kind + (q.length ? '?' + q.join('&') : '');
  }
  // live feeds are shared for 20 seconds, so the page and the score crawl don't fetch the same scoreboard twice
  var recent = {};
  function get(url) {
    var hit = recent[url];
    if (hit && Date.now() - hit.at < 20000) return hit.p;
    var p = fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
    recent[url] = { at: Date.now(), p: p };
    p.catch(function () { delete recent[url]; });
    return p;
  }
  function data(path) { return window.DC ? DC.load('/data/sports/' + path) : get('/data/sports/' + path); }

  function num(v) { if (v === null || v === undefined || v === '') return null; var n = typeof v === 'object' ? Number(v.value) : Number(v); return isNaN(n) ? null : n; }
  function rec(c) {
    var r = (c.records || c.record || []);
    if (!r.length) return '';
    var t = r.filter(function (x) { return x.type === 'total' || x.name === 'overall' || x.name === 'All Splits'; })[0] || r[0];
    return t.summary || t.displayValue || '';
  }
  function hex(c, fb) { return c ? '#' + String(c).replace('#', '') : fb; }

  function teamOf(c, lg) {
    var t = c.team || {};
    return {
      id: String(t.id || c.id || ''), abbr: t.abbreviation || '', name: t.displayName || t.name || '', short: t.shortDisplayName || t.name || t.abbreviation || '',
      loc: t.location || '', color: hex(t.color, '#12363B'), alt: hex(t.alternateColor, '#C8F7FC'),
      score: c.score && typeof c.score === 'object' ? c.score.displayValue : (c.score === undefined ? '' : String(c.score)),
      home: c.homeAway === 'home', winner: c.winner === true, record: rec(c),
      rank: c.curatedRank && c.curatedRank.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
      lines: (c.linescores || []).map(function (l) { return l.displayValue !== undefined ? l.displayValue : (l.value === undefined ? '' : String(l.value)); }),
      href: LEAGUES[lg] && LEAGUES[lg].teams && t.id ? teamHref(lg, t.id) : ''
    };
  }

  function status(s) {
    s = s || {}; var t = s.type || {};
    return { state: t.state || 'pre', done: !!t.completed, detail: t.shortDetail || t.detail || t.description || '', name: t.name || '', period: s.period || 0, clock: s.displayClock || '' };
  }

  /* one scoreboard event -> card record (team sports) */
  function normEvent(e, lg) {
    var L = LEAGUES[lg] || {};
    var c = (e.competitions || [])[0] || {};
    var st = status(c.status || e.status);
    var teams = (c.competitors || []).map(function (x) { return teamOf(x, lg); });
    teams.sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); }); // away first, home second
    var tv = (c.broadcasts || []).map(function (b) { return (b.names || []).join('/'); }).filter(Boolean).join(', ') || (c.broadcast || '');
    var note = ((c.notes || [])[0] || {}).headline || '';
    var series = c.series && c.series.summary ? c.series.summary : '';
    return {
      lg: lg, id: String(e.id), start: e.date, name: e.name || '', short: e.shortName || '', week: e.week ? e.week.number : null,
      // ESPN marks games without a set start time (it fills in 11:59 PM Eastern as a placeholder)
      tbd: c.timeValid === false || /\bTBD\b/i.test(st.detail || '') || /T0[34]:59/.test(e.date || ''),
      state: st.state, done: st.done, detail: st.detail, period: st.period, clock: st.clock,
      neutral: !!c.neutralSite, venue: (c.venue || {}).fullName || '', city: ((c.venue || {}).address || {}).city || '',
      tv: tv, note: note || series, away: teams[0] || null, home: teams[1] || null,
      href: L.teams ? gameHref(lg, e.id) : ''
    };
  }

  /* golf: one tournament with its top of the leaderboard */
  function normGolf(e) {
    var c = (e.competitions || [])[0] || {};
    var st = status(c.status || e.status);
    var players = (c.competitors || []).slice(0, 10).map(function (p) {
      var a = p.athlete || {};
      return { pos: (p.status && p.status.position && p.status.position.displayName) || p.order || '', name: a.displayName || a.shortName || '', score: p.score && p.score.displayValue ? p.score.displayValue : (p.score || ''), thru: p.status && p.status.thru ? 'thru ' + p.status.thru : '' };
    });
    return { lg: 'pga', kind: 'golf', id: String(e.id), name: e.name, start: e.date, end: e.endDate, state: st.state, detail: st.detail, players: players };
  }

  /* tennis: a tournament's singles matches, newest and live first */
  function normTennis(e, lg) {
    var out = [];
    (e.groupings || []).forEach(function (g) {
      var gname = (g.grouping || {}).displayName || '';
      if (!/singles/i.test(gname)) return;
      (g.competitions || []).forEach(function (m) {
        var st = status(m.status);
        var ps = (m.competitors || []).map(function (p) {
          var a = p.athlete || {};
          return { name: a.shortName || a.displayName || 'TBD', winner: p.winner === true, sets: (p.linescores || []).map(function (l) { return String(l.value === undefined ? '' : l.value) + (l.tiebreak !== undefined ? '(' + l.tiebreak + ')' : ''); }).join(' ') };
        });
        out.push({ id: String(m.id), round: (m.round || {}).displayName || '', state: st.state, detail: st.detail, start: m.date, players: ps, draw: gname });
      });
    });
    var rank = { 'in': 0, post: 1, pre: 2 };
    out.sort(function (a, b) { return (rank[a.state] - rank[b.state]) || (a.state === 'post' ? (b.start > a.start ? 1 : -1) : (a.start > b.start ? 1 : -1)); });
    return { lg: lg, kind: 'tennis', id: String(e.id), name: e.name, start: e.date, end: e.endDate, matches: out };
  }

  function scores(lg, params) {
    var L = LEAGUES[lg];
    var p = Object.assign({}, params || {});
    if (L.groups && !p.groups) p.groups = L.groups;
    if (L.kind === undefined && (lg === 'ncaaf' || lg === 'ncaab' || lg === 'ncaah') && !p.limit) p.limit = 300;
    return get(api(lg, 'scoreboard', p)).then(function (j) {
      var evs = j.events || [];
      if (L.kind === 'golf') return { lg: lg, events: evs.map(normGolf) };
      if (L.kind === 'tennis') return { lg: lg, events: evs.map(function (e) { return normTennis(e, lg); }) };
      return { lg: lg, events: evs.map(function (e) { return normEvent(e, lg); }), week: j.week ? j.week.number : null, season: j.season || null };
    });
  }

  /* a team's season schedule (results and upcoming) */
  function schedule(lg, id, params) {
    return get(api(lg, 'teams/' + id + '/schedule', params || {})).then(function (j) {
      var me = String((j.team || {}).id || id);
      var games = (j.events || []).map(function (e) {
        var c = (e.competitions || [])[0] || {};
        var st = status(c.status);
        var cs = c.competitors || [];
        var mine = cs.filter(function (x) { return String((x.team || {}).id) === me; })[0] || cs[0] || {};
        var opp = cs.filter(function (x) { return x !== mine; })[0] || {};
        var my = teamOf(mine, lg), op = teamOf(opp, lg);
        var res = '';
        if (st.done && my.score !== '' && op.score !== '') res = mine.winner ? 'W' : (opp.winner ? 'L' : 'T');
        return { id: String(e.id), start: e.date, week: e.week ? e.week.text || e.week.number : '', season: (e.seasonType || {}).name || '', home: mine.homeAway === 'home', neutral: !!c.neutralSite,
          opp: op, me: my, state: st.state, done: st.done, detail: st.detail, result: res, score: my.score && op.score ? my.score + '–' + op.score : '',
          tv: (c.broadcasts || []).map(function (b) { return (b.media || {}).shortName || (b.names || []).join('/'); }).filter(Boolean).join(', '), href: gameHref(lg, e.id) };
      });
      var t = j.team || {};
      return { lg: lg, id: me, team: { id: me, abbr: t.abbreviation, name: t.displayName, loc: t.location, color: hex(t.color, '#12363B'), alt: hex(t.alternateColor, '#C8F7FC'),
        record: t.recordSummary || '', standing: t.standingSummary || '' }, season: j.season || {}, bye: j.byeWeek || null, games: games };
    });
  }

  /* team detail: record splits and next event */
  function team(lg, id) {
    return get(api(lg, 'teams/' + id)).then(function (j) {
      var t = j.team || {};
      var items = ((t.record || {}).items || []);
      var stat = {};
      var tot = items.filter(function (x) { return x.type === 'total'; })[0] || items[0] || {};
      (tot.stats || []).forEach(function (s) { stat[s.name] = s.value; });
      var splits = items.map(function (x) { return { type: x.type, label: x.description || x.type, summary: x.summary }; });
      return { lg: lg, id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, loc: t.location, nick: t.nickname || t.name,
        color: hex(t.color, '#12363B'), alt: hex(t.alternateColor, '#C8F7FC'), record: tot.summary || '', standing: t.standingSummary || '', stats: stat, splits: splits,
        next: (t.nextEvent || []).map(function (e) { return normEvent(e, lg); })[0] || null };
    });
  }

  /* game summary -> page record. Odds, pick'em, ESPN predictor and win probability are dropped. */
  function summary(lg, id) {
    return get(api(lg, 'summary', { event: id })).then(function (j) {
      var h = j.header || {}; var c = (h.competitions || [])[0] || {};
      var st = status(c.status);
      var teams = (c.competitors || []).map(function (x) { return teamOf(x, lg); });
      teams.sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); });
      var gi = j.gameInfo || {};
      var stats = {};
      ((j.boxscore || {}).teams || []).forEach(function (t) {
        var tid = String((t.team || {}).id);
        var add = function (k, v) { if (!k || v === undefined) return; if (!stats[k]) stats[k] = { label: k, v: {} }; stats[k].v[tid] = v; };
        (t.statistics || []).forEach(function (s) {
          if (s.stats) { // baseball: grouped batting / pitching / fielding stats
            var keep = BASEBALL_BOX[s.name] || {};
            (s.stats || []).forEach(function (x) { if (keep[x.name]) add(keep[x.name], x.displayValue); });
            return;
          }
          add(s.label || s.displayName || s.name, s.displayValue);
        });
      });
      var statRows = Object.keys(stats).map(function (k) { return stats[k]; });
      var leaders = (j.leaders || []).map(function (L) {
        return { team: String((L.team || {}).id), abbr: (L.team || {}).abbreviation, cats: (L.leaders || []).map(function (x) {
          var top = (x.leaders || [])[0] || {}; var a = top.athlete || {};
          return { cat: x.displayName || x.name, name: a.shortName || a.displayName || '', line: top.displayValue || '' };
        }).filter(function (x) { return x.name; }) };
      });
      var abbrOf = {}; teams.forEach(function (t) { abbrOf[t.id] = t.abbr; });
      var sp = (j.scoringPlays && j.scoringPlays.length) ? j.scoringPlays : (j.plays || []).filter(function (p) { return p.scoringPlay; });
      var scoring = sp.map(function (p) {
        var tid = String((p.team || {}).id || ''); return { period: (p.period || {}).displayValue || (p.period || {}).number || '', clock: (p.clock || {}).displayValue || '', team: tid, abbr: (p.team || {}).abbreviation || abbrOf[tid] || '', text: p.text || '', away: p.awayScore, home: p.homeScore };
      });
      var injuries = (j.injuries || []).map(function (t) {
        return { team: String((t.team || {}).id || ''), abbr: (t.team || {}).abbreviation || '', list: (t.injuries || []).map(function (x) {
          var a = x.athlete || {}; return { name: a.displayName || '', pos: ((a.position || {}).abbreviation) || '', status: x.status || ((x.type || {}).description) || '', detail: (x.details && x.details.type) || '' };
        }) };
      });
      var last5 = (j.lastFiveGames || []).map(function (t) {
        return { team: String((t.team || {}).id || ''), abbr: (t.team || {}).abbreviation || '', games: (t.events || []).map(function (g) {
          return { date: g.gameDate, opp: (g.opponent || {}).abbreviation || '', at: g.atVs || '', result: g.gameResult || '', score: g.score || '' };
        }) };
      });
      var series = (j.seasonseries || []).map(function (s) { return s.summary || s.description || ''; }).filter(Boolean);
      var standings = [];
      ((j.standings || {}).groups || []).forEach(function (g) {
        var rows = (((g.standings || {}).entries) || []).map(function (e) {
          var s = {}; (e.stats || []).forEach(function (x) { s[x.type || x.name] = x.summary || x.displayValue; });
          return { team: e.team, id: String(e.id || ''), wl: s.total || s.overall || '', s: s };
        });
        standings.push({ name: g.header || '', rows: rows });
      });
      return {
        lg: lg, id: String(id), start: c.date, state: st.state, done: st.done, detail: st.detail, period: st.period, clock: st.clock, neutral: !!c.neutralSite,
        away: teams[0] || null, home: teams[1] || null, note: ((c.notes || [])[0] || {}).headline || '',
        venue: (gi.venue || {}).fullName || '', city: [((gi.venue || {}).address || {}).city, ((gi.venue || {}).address || {}).state].filter(Boolean).join(', '),
        attendance: gi.attendance || null, weather: gi.weather ? (gi.weather.displayValue || '') + (gi.weather.temperature ? ' · ' + gi.weather.temperature + '°' : '') : '',
        officials: (gi.officials || []).map(function (o) { return o.displayName + (o.position && o.position.displayName ? ' (' + o.position.displayName + ')' : ''); }),
        tv: (j.broadcasts || []).map(function (b) { return (b.media || {}).shortName || ''; }).filter(Boolean).join(', '),
        stats: statRows, leaders: leaders, scoring: scoring, injuries: injuries, last5: last5, series: series, standings: standings,
        linescoreHeads: (teams[0] && teams[0].lines.length ? teams[0].lines.map(function (_, i) { return periodLabel(lg, i); }) : [])
      };
    });
  }
  var BASEBALL_BOX = {
    batting: { hits: 'Hits', homeRuns: 'Home runs', walks: 'Walks', strikeouts: 'Strikeouts', runnersLeftOnBase: 'Left on base', stolenBases: 'Stolen bases' },
    pitching: { pitches: 'Pitches thrown' },
    fielding: { errors: 'Errors' }
  };
  function periodLabel(lg, i) {
    var sp = (LEAGUES[lg] || {}).sport;
    if (sp === 'baseball') return String(i + 1);
    if (sp === 'hockey') return i < 3 ? String(i + 1) : (i === 3 ? 'OT' : 'SO');
    if (sp === 'soccer') return i === 0 ? '1H' : i === 1 ? '2H' : 'ET';
    if (lg === 'ncaab') return i < 2 ? (i === 0 ? '1H' : '2H') : 'OT' + (i > 2 ? i - 1 : '');
    return i < 4 ? 'Q' + (i + 1) : 'OT' + (i > 4 ? i - 3 : '');
  }

  /* standings straight from ESPN (pages prefer the slimmer /data/sports/standings files) */
  function standingsLive(lg, params) {
    return get(api(lg, 'standings', params || {})).then(function (j) { return slimStandings(j); });
  }
  function slimStandings(j) {
    var groups = [];
    (function walk(n, parent) {
      if (n.standings && n.standings.entries) {
        groups.push({ name: n.name || n.abbreviation || parent || '', abbr: n.abbreviation || '', rows: n.standings.entries.map(function (e) {
          var s = {}; (e.stats || []).forEach(function (x) { s[x.name] = x.displayValue !== undefined ? x.displayValue : x.value; if (x.type === 'total' || x.name === 'overall') s.overall = x.displayValue || x.summary; });
          var t = e.team || {};
          return { id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, s: s };
        }) });
      }
      (n.children || []).forEach(function (c) { walk(c, n.name); });
    })(j, '');
    return { groups: groups };
  }

  /* links */
  function teamHref(lg, id) { return 'Team.dc.html?lg=' + lg + '&id=' + encodeURIComponent(id); }
  function gameHref(lg, id) { return 'Game.dc.html?lg=' + lg + '&id=' + encodeURIComponent(id); }

  /* house model: projected margin and win probability from /data/sports/model/<lg>.json */
  function Phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)); var d = 0.3989423 * Math.exp(-z * z / 2); var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  /* rest edge for a game starting at `start` (ISO): per-day edge x (home rest - away rest), rest = days since the
     team's previous game (capped), from the game dates in the model file; 0 beyond those dates or without a start */
  function dayNo(d) { return Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 864e5); }
  function restEdge(model, H, A, start) {
    if (!model.rest || !start || String(start).slice(0, 10) > (model.restUntil || '')) return 0;
    var cap = model.restCap || 7, day = dayNo(start), s0 = String(start).slice(0, 10);
    var rest = function (T) {
      var prev = (T.dates || []).filter(function (d) { return d < s0; });
      return prev.length ? Math.min(cap, day - dayNo(prev[prev.length - 1])) : cap;
    };
    return model.rest * (rest(H) - rest(A));
  }
  function project(model, awayId, homeId, neutral, start) {
    if (!model || !model.teams) return null;
    var A = model.teams[String(awayId)], H = model.teams[String(homeId)];
    if (!A || !H || A.rating === null || H.rating === null || A.rating === undefined || H.rating === undefined) return null;
    var hfa = neutral ? 0 : (model.hfa || 0);
    if (model.divHfa !== undefined && A.group && A.group === H.group && !neutral) hfa = model.divHfa;
    var m = H.rating - A.rating + hfa + restEdge(model, H, A, start);
    // MLB: announced starting pitchers' edge for this exact game, when the model file has it
    if (model.spEdges && start) m += model.spEdges[String(start).slice(0, 16) + '|' + homeId + '|' + awayId] || 0;
    // NFL: the starting quarterback against the team's usual one, when the model file has it for this game
    if (model.qbEdges && start) m += model.qbEdges[String(start).slice(0, 16) + '|' + homeId + '|' + awayId] || 0;
    // who is playing (NHL goalies, NBA availability, college QBs): adjustment written by the pipeline for this game
    if (model.ctxEdges && start) m += model.ctxEdges[String(start).slice(0, 16) + '|' + homeId + '|' + awayId] || 0;
    // when the model says so (pv), widen the spread by how unsure both ratings still are (w = weight of evidence in games)
    // NBA: blended with lineup strength, the summed value of the players expected to play (model.lu, tune.lineup_blend)
    if (model.lu && model.luEdges && start) { var lu = model.luEdges[String(start).slice(0, 16) + '|' + homeId + '|' + awayId]; if (lu !== undefined) m = model.lu[0] + model.lu[1] * m + model.lu[2] * lu; }
    // stretch where replaying past seasons showed the projections come out compressed (model.ms, tune.margin_scale)
    if (model.ms) { m *= model.ms; hfa *= model.ms; }
    var sg = (model.sigma || 13.5) * (model.pv && H.w && A.w ? Math.sqrt(1 + 1 / H.w + 1 / A.w) : 1);
    var p = Phi(m / sg);
    // blended with an Elo rating where that tested better (pipeline/sports/elo.py): p = (1 - w) p + w p_Elo
    if (model.elo && model.elo.w && H.elo != null && A.elo != null) {
      p = (1 - model.elo.w) * p + model.elo.w / (1 + Math.pow(10, -((H.elo - A.elo) + (neutral ? 0 : model.elo.hfa)) / 400));
    }
    return { margin: m, pHome: p, pAway: 1 - p, hfa: hfa, ctx: model.ctxInfo && start ? model.ctxInfo[String(start).slice(0, 16) + '|' + homeId + '|' + awayId] || null : null, qb: model.qbInfo && start ? model.qbInfo[String(start).slice(0, 16) + '|' + homeId + '|' + awayId] || null : null, coverage: model.coverage || null, basis: model.basis || '' };
  }

  /* In-game win probability: the current score plus the pre-game edge scaled to the time left, with the
     model's spread shrinking as the game runs out: P(home) = Φ((lead + edge·r) ÷ (σ·√r)), r = share of game left. */
  var GAME_SECS = { nfl: [4, 900], ncaaf: [4, 900], nba: [4, 720], ncaab: [2, 1200], nhl: [3, 1200], ncaah: [3, 1200] };
  function liveProb(model, lg, g, pre) {
    if (!model || !pre || !g || g.state !== 'in' || !g.home || !g.away) return null;
    var lead = (num(g.home.score) || 0) - (num(g.away.score) || 0), f = null, per = +g.period || 0;
    if (lg === 'mlb') {
      var d = String(g.detail || ''), half = /^top/i.test(d) ? 0 : (/^(mid|bot)/i.test(d) ? 1 : (/^end/i.test(d) ? 2 : 0));
      f = Math.min(0.97, ((per - 1) * 2 + half) / 18);
    } else if (GAME_SECS[lg]) {
      var P = GAME_SECS[lg], m = /(\d+):(\d+)/.exec(g.clock || ''), left = m ? +m[1] * 60 + +m[2] : P[1] / 2;
      f = per > P[0] ? 0.97 : Math.min(0.99, ((per - 1) * P[1] + (P[1] - left)) / (P[0] * P[1]));
    }
    if (f === null || f < 0) return null;
    var r = Math.max(0.01, 1 - f), sg = (model.sigma || 13.5) * Math.sqrt(r), mu = lead + pre.margin * r;
    var p = Phi(mu / sg);
    return { pHome: p, pAway: 1 - p, margin: mu, left: r };
  }

  /* Win-probability path through a game, rebuilt from the scoring plays with the same formula as liveProb:
     at each moment, P(home) = Φ((lead + edge·r) ÷ (σ·√r)), r = share of the game left. The lead only changes at a
     score, but the probability drifts toward the leader as time runs out, so the line is sampled on a time grid.
     Returns { pts: [{f, p, lead}], marks: [{f, p, swing, text, abbr}], end } or null when the league has no clock model. */
  function wpSeries(model, lg, g, pre) {
    if (!model || !pre || !g || !g.home || !g.away || g.state === 'pre') return null;
    var P = GAME_SECS[lg], base = lg === 'mlb';
    if (!P && !base) return null;
    var sg = model.sigma || 13.5, homeId = String(g.home.id);
    var prob = function (lead, f) { var r = Math.max(0.004, 1 - f); return Phi((lead + pre.margin * r) / (sg * Math.sqrt(r))); };
    var fOf = function (sp) {
      var per = parseInt(String(sp.period).replace(/[^0-9]/g, ''), 10) || 1;
      if (base) { var top = String(sp.team) !== homeId; return Math.min(0.985, ((per - 1) * 2 + (top ? 0.5 : 1.5)) / 18); }
      var m = /(\d+):(\d+)/.exec(sp.clock || ''), left = m ? +m[1] * 60 + +m[2] : P[1] / 2;
      if (per > P[0]) return Math.min(0.995, 0.97 + 0.01 * (per - P[0]));
      return Math.min(0.99, ((per - 1) * P[1] + (P[1] - left)) / (P[0] * P[1]));
    };
    var plays = (g.scoring || []).filter(function (sp) { return sp.home !== undefined && sp.away !== undefined && sp.home !== null; })
      .map(function (sp) { return { f: fOf(sp), lead: (+sp.home) - (+sp.away), text: sp.text || '', abbr: sp.abbr || '' }; })
      .sort(function (a, b) { return a.f - b.f; });
    // where the game is now
    var fNow = 1;
    if (g.state === 'in') {
      var lp = liveProb(model, lg, g, pre);
      fNow = lp ? 1 - lp.left : (plays.length ? plays[plays.length - 1].f : 0);
    }
    var leadAt = function (f) { var l = 0; for (var i = 0; i < plays.length && plays[i].f <= f; i++) l = plays[i].lead; return l; };
    var pts = [{ f: 0, p: pre.pHome, lead: 0 }], N = 90;
    for (var i = 1; i <= N; i++) {
      var f = fNow * i / N;
      plays.forEach(function (pl) { if (pl.f > pts[pts.length - 1].f && pl.f <= f) { pts.push({ f: pl.f - 0.0005, p: prob(leadAt(pl.f - 0.001), pl.f - 0.0005), lead: leadAt(pl.f - 0.001) }); pts.push({ f: pl.f, p: prob(pl.lead, pl.f), lead: pl.lead }); } });
      if (f > pts[pts.length - 1].f) pts.push({ f: f, p: prob(leadAt(f), f), lead: leadAt(f) });
    }
    var final = null;
    if (g.done) {
      var hs = num(g.home.score), as = num(g.away.score);
      final = hs > as ? 1 : hs < as ? 0 : 0.5;
      pts[pts.length - 1] = { f: 1, p: final, lead: (hs || 0) - (as || 0) };
    }
    var marks = plays.map(function (pl) {
      var before = prob(leadAt(pl.f - 0.001), Math.max(0, pl.f - 0.0005)), after = prob(pl.lead, pl.f);
      return { f: pl.f, p: after, swing: after - before, text: pl.text, abbr: pl.abbr };
    });
    return { pts: pts, marks: marks, end: fNow, final: final, periods: base ? 9 : P[0] };
  }

  /* Share card: a 1200x630 image of a game (score or matchup, house odds, win-probability line) drawn on a canvas,
     then handed to the phone's share sheet, or downloaded where sharing files isn't supported. */
  function shareCard(c) {
    var W = 1200, H = 630, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    var fonts = document.fonts && document.fonts.load ? Promise.all(['400 120px VT323', '600 28px "IBM Plex Mono"', '400 24px "IBM Plex Mono"'].map(function (f) { return document.fonts.load(f).catch(function () {}); })) : Promise.resolve();
    return fonts.then(function () {
      var mono = '"IBM Plex Mono", ui-monospace, monospace', big = 'VT323, ui-monospace, monospace';
      // background: away colour fading in from the left, home from the right
      x.fillStyle = '#03070c'; x.fillRect(0, 0, W, H);
      var g1 = x.createLinearGradient(0, 0, W, 0);
      g1.addColorStop(0, c.aColor + 'cc'); g1.addColorStop(0.42, c.aColor + '22'); g1.addColorStop(0.58, c.hColor + '22'); g1.addColorStop(1, c.hColor + 'cc');
      x.fillStyle = g1; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, 0, W, H);
      for (var i = 0; i < H; i += 4) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, i, W, 1); }   // scanlines
      // top bar
      x.fillStyle = '#3df2ff'; x.fillRect(0, 0, W, 54);
      x.fillStyle = '#000'; x.font = '600 24px ' + mono; x.textBaseline = 'middle';
      x.fillText(c.league + ' · ' + c.status, 28, 28);
      x.textAlign = 'right'; x.fillText('NSKN · SPORTS', W - 28, 28); x.textAlign = 'left';
      // teams and score
      // shrink the abbreviations and the score together until they fit side by side with room to spare
      var fa = 130, fc = 160;
      for (var tries = 0; tries < 12; tries++) {
        x.font = '400 ' + fa + 'px ' + big; var wa = Math.max(x.measureText(c.aAbbr).width, x.measureText(c.hAbbr).width);
        x.font = '400 ' + fc + 'px ' + big; var wc = x.measureText(c.center).width;
        if (wc / 2 + wa + 60 + 50 <= W / 2) break;
        fa = Math.round(fa * 0.92); fc = Math.round(fc * 0.92);
      }
      x.fillStyle = '#fff'; x.font = '400 ' + fa + 'px ' + big; x.textBaseline = 'alphabetic';
      x.fillText(c.aAbbr, 60, 250); x.textAlign = 'right'; x.fillText(c.hAbbr, W - 60, 250);
      x.textAlign = 'center'; x.font = '400 ' + fc + 'px ' + big;
      x.shadowColor = 'rgba(255,255,255,.35)'; x.shadowBlur = 24;
      x.fillText(c.center, W / 2, 255); x.shadowBlur = 0;
      x.font = '400 26px ' + mono; x.fillStyle = 'rgba(255,255,255,.85)';
      x.textAlign = 'left'; x.fillText(c.aName, 64, 296); x.textAlign = 'right'; x.fillText(c.hName, W - 64, 296);
      // house odds bar
      if (c.pHome !== null && c.pHome !== undefined) {
        var bx = 60, by = 340, bw = W - 120, bh = 22, pa = 1 - c.pHome;
        x.fillStyle = c.hColor; x.fillRect(bx, by, bw, bh);
        x.fillStyle = c.aColor; x.fillRect(bx, by, bw * pa, bh);
        x.strokeStyle = 'rgba(255,255,255,.6)'; x.strokeRect(bx, by, bw, bh);
        x.font = '600 26px ' + mono; x.fillStyle = '#fff';
        x.textAlign = 'left'; x.fillText(Math.round(pa * 100) + '%', bx, by + 58);
        x.textAlign = 'right'; x.fillText(Math.round(c.pHome * 100) + '%', bx + bw, by + 58);
        x.textAlign = 'center'; x.font = '400 22px ' + mono; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText(c.oddsLabel, W / 2, by + 56);
      }
      // win-probability line
      if (c.wp && c.wp.length > 2) {
        var gx = 60, gy = 440, gw = W - 120, gh = 120;
        x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(gx, gy, gw, gh);
        x.strokeStyle = 'rgba(255,255,255,.3)'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(gx, gy + gh / 2); x.lineTo(gx + gw, gy + gh / 2); x.stroke(); x.setLineDash([]);
        x.strokeStyle = '#ffc53d'; x.lineWidth = 3; x.beginPath();
        c.wp.forEach(function (q, k) { var px = gx + q.f * gw, py = gy + (1 - q.p) * gh; if (k) x.lineTo(px, py); else x.moveTo(px, py); });
        x.stroke(); x.lineWidth = 1;
        x.font = '400 18px ' + mono; x.fillStyle = 'rgba(255,255,255,.75)'; x.textAlign = 'left';
        x.fillText(c.hAbbr + ' ↑  win probability  ↓ ' + c.aAbbr, gx + 10, gy + 24);
      }
      // footer
      x.font = '400 22px ' + mono; x.fillStyle = 'rgba(255,255,255,.8)'; x.textAlign = 'left';
      x.fillText(c.foot || '', 60, H - 26);
      x.textAlign = 'right'; x.fillStyle = '#3df2ff'; x.font = '600 22px ' + mono; x.fillText('nathanskown.dev', W - 60, H - 26);
      return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); });
    }).then(function (blob) {
      var file = null, name = (c.file || 'game') + '.png';
      try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: c.title || 'NSKN Sports', text: c.text || '' }).then(function () { return 'shared'; }, function () { return 'cancelled'; });
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return 'downloaded';
    });
  }

  /* team search for the command line on every Sports page: "lions", "gonzaga", "Michigan State Spartans (NCAAB)" */
  var teamsP = null, LG_PRI = { nfl: 0, mlb: 1, nba: 2, nhl: 3, ncaaf: 4, ncaab: 5, ncaah: 6 };
  function teamList() {
    if (!teamsP) teamsP = data('teams.json').then(function (j) {
      var out = [];
      Object.keys(j.leagues || {}).forEach(function (lg) { j.leagues[lg].forEach(function (t) { out.push({ lg: lg, t: t }); }); });
      return out;
    }, function () { teamsP = null; return []; });
    return teamsP;
  }
  function findTeams(list, q, n) {
    var m = /\(([A-Z]{3,5})\)\s*$/i.exec(q), want = null;
    if (m) { var s = m[1].toUpperCase(); ORDER.forEach(function (k) { if (LEAGUES[k].short === s) want = k; }); q = q.slice(0, m.index); }
    q = q.trim().toLowerCase();
    if (!q) return [];
    var hits = [];
    list.forEach(function (x) {
      if (want && x.lg !== want) return;
      var t = x.t, names = [t.name, t.nick, t.loc, t.short, t.abbr].filter(Boolean).map(function (v) { return v.toLowerCase(); });
      var score = names.indexOf(q) >= 0 ? 0 : names.some(function (v) { return v.indexOf(q) === 0; }) ? 1 : (q.length >= 3 && names.some(function (v) { return v.indexOf(q) >= 0; }) ? 2 : -1);
      if (score >= 0) hits.push({ lg: x.lg, t: t, score: score });
    });
    hits.sort(function (a, b) { return a.score - b.score || LG_PRI[a.lg] - LG_PRI[b.lg] || (a.t.name < b.t.name ? -1 : 1); });
    return hits.slice(0, n || 12);
  }
  window.DC_SPORTS = true;
  var PAGE_WORDS = {
    'injuries': 'injuries', 'injury': 'injuries', 'injury report': 'injuries', 'playoff odds': 'odds', 'playoffs': 'odds', 'odds': 'odds',
    'simulator': 'simulator', 'matchup': 'simulator', 'methodology': 'methodology', 'method': 'methodology', 'how it works': 'methodology',
    'track record': 'track-record', 'record': 'track-record', 'picks': 'track-record', 'schedule strength': 'schedule-strength',
    'strength of schedule': 'schedule-strength', 'luck watch': 'luck-watch', 'luck': 'luck-watch', 'spots': 'spots', 'situational spots': 'spots'
  };
  window.DC_LOOKUP = function (q) {
    var pg = PAGE_WORDS[String(q || '').trim().toLowerCase()];
    if (pg) return Promise.resolve('/sports/' + pg + '/');
    return teamList().then(function (list) {
      var h = findTeams(list, q, 1)[0];
      return h && h.score <= 1 ? '/sports/team/?lg=' + h.lg + '&id=' + encodeURIComponent(h.t.id) : null;
    });
  };
  /* horizontally scrollable tables must be reachable by keyboard */
  function focusScrollers() {
    document.querySelectorAll('.s-scroll:not([data-kb])').forEach(function (el) {
      el.setAttribute('data-kb', '1'); el.tabIndex = 0; el.setAttribute('role', 'region');
      var t = el.querySelector('caption,th'); el.setAttribute('aria-label', 'Scrollable table' + (t && t.textContent.trim() ? ': ' + t.textContent.trim().slice(0, 40) : ''));
    });
  }
  function watchScrollers() {
    focusScrollers();
    try { new MutationObserver(focusScrollers).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.body) watchScrollers(); else document.addEventListener('DOMContentLoaded', watchScrollers);
  window.DC_SUGGEST = function (q) {
    return teamList().then(function (list) {
      return findTeams(list, q, 12).map(function (h) { return { value: h.t.name + ' (' + LEAGUES[h.lg].short + ')', label: LEAGUES[h.lg].label + (h.t.group ? ' · ' + h.t.group : '') }; });
    });
  };

  /* teams this visitor follows, saved in their browser only: [{lg, id, name}] */
  var FKEY = 'skown.sports.follows.v2';
  function follows() { try { var l = JSON.parse(window.localStorage.getItem(FKEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function setFollows(l) { try { window.localStorage.setItem(FKEY, JSON.stringify(l)); } catch (e) {} return l; }
  function isFollowed(lg, id) { return follows().some(function (f) { return f.lg === lg && String(f.id) === String(id); }); }
  function toggleFollow(lg, id, name) {
    var l = follows(), on = isFollowed(lg, id);
    setFollows(on ? l.filter(function (f) { return !(f.lg === lg && String(f.id) === String(id)); }) : l.concat([{ lg: lg, id: String(id), name: name || '' }]));
    return !on;
  }
  /* chips for the "My teams" bar: the visitor's own follows, or a prompt to follow some */
  function favChips(curLg, curId) {
    var l = follows();
    if (!l.length) return [{ label: '+ FOLLOW TEAMS', href: '/sports/#follow', cls: 't-chipl' }];
    return l.map(function (f) {
      var words = String(f.name || f.id).trim().split(/\s+/), nick = words.length > 1 && /^(red|blue|white|golden|maple|blue|trail|black|crimson|fighting|sun|tar)$/i.test(words[words.length - 2]) ? words.slice(-2).join(' ') : words[words.length - 1];
      var college = /^ncaa/.test(f.lg);
      return { label: (nick + (college ? ' ' + ({ ncaaf: 'FB', ncaab: 'BB', ncaah: 'HKY' }[f.lg] || '') : '')).toUpperCase(), href: teamHref(f.lg, f.id),
        cls: 't-chipl' + (f.lg === curLg && String(f.id) === String(curId) ? ' is-on' : '') };
    });
  }

  /* team logos load from ESPN's image server; if one fails, leave its space blank instead of broken-image alt text */
  if (typeof document !== 'undefined') document.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'IMG' && /espncdn\.com/.test(el.src || '')) { el.style.visibility = 'hidden'; el.alt = ''; }
  }, true);

  /* ---------- bottom-line score crawl on every sports page ----------
     Live games first, then upcoming, then finals, across the major leagues. Teams the visitor follows lead.
     It pauses on hover or keyboard focus, has a pause button (moving content must be stoppable), and sits
     still for people who ask their system for reduced motion. */
  function crawl() {
    if (typeof document === 'undefined' || document.querySelector('.s-crawl')) return;
    var LGS = ['nfl', 'mlb', 'nba', 'nhl', 'ncaaf', 'ncaab'];
    var box = document.createElement('aside');
    box.className = 's-crawl';
    box.setAttribute('aria-label', 'Scores across the major leagues');
    box.innerHTML = '<span class="s-crawl-l"><span aria-hidden="true">●</span> SCORES<span class="x"> · ALL LEAGUES</span></span>' +
      '<div class="s-crawl-win"><div class="s-crawl-track" id="sCrawl"><div class="s-crawl-run"><a href="/sports/"><span class="st">Loading scores…</span></a></div></div></div>' +
      '<button type="button" aria-pressed="false" aria-label="Pause the score crawl" title="Pause">❚❚</button>';
    document.body.appendChild(box);
    document.body.classList.add('has-crawl');
    // skip link past the long header to the page's main content
    var skip = document.createElement('a');
    skip.className = 't-skip'; skip.href = '#main'; skip.textContent = 'Skip to content';
    skip.addEventListener('click', function (ev) {
      var m = document.querySelector('main') || document.querySelector('h1');
      if (!m) return;
      ev.preventDefault(); if (!m.id) m.id = 'main'; m.setAttribute('tabindex', '-1'); m.focus(); m.scrollIntoView();
    });
    document.body.insertBefore(skip, document.body.firstChild);   // outside the page's rendered tree, which the runtime owns
    var btn = box.querySelector('button');
    var paused = false;
    try { paused = localStorage.getItem('nskn.crawl.paused') === '1'; } catch (e) {}
    var setPaused = function (v) {
      paused = v; box.classList.toggle('is-paused', v);
      btn.setAttribute('aria-pressed', String(v)); btn.textContent = v ? '▶' : '❚❚';
      btn.setAttribute('aria-label', v ? 'Play the score crawl' : 'Pause the score crawl'); btn.title = v ? 'Play' : 'Pause';
      try { localStorage.setItem('nskn.crawl.paused', v ? '1' : '0'); } catch (e) {}
    };
    setPaused(paused);
    btn.addEventListener('click', function () { setPaused(!paused); });
    var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    // game links are written as design-file names (Game.dc.html?...); outside the page renderer, map them to real URLs
    var R = window.DC_ROUTES || {}, url = function (h) { var q = String(h || '').indexOf('?'), b = q < 0 ? h : h.slice(0, q); return R[b] ? R[b] + (q < 0 ? '' : h.slice(q)) : (h || '/sports/'); };
    var tz = window.TZ, tm = function (iso) {
      try { return new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(':00', ''); } catch (e) { return ''; }
    };
    var timer;
    function load() {
      Promise.all(LGS.map(function (lg) { return scores(lg).then(function (b) { return b.events.map(function (e) { e.lg = lg; return e; }); }, function () { return []; }); }))
        .then(function (lists) {
          var all = [].concat.apply([], lists), fol = follows();
          var mine = function (e) { return fol.some(function (f) { return f.lg === e.lg && (String(f.id) === String(e.away.id) || String(f.id) === String(e.home.id)); }); };
          var rank = { 'in': 0, pre: 1, post: 2 }, soon = Date.now() + 36 * 3600000;
          all = all.filter(function (e) { return e.away && e.home && (e.state !== "pre" || Date.parse(e.start) < soon); })
            .sort(function (a, b) { return (mine(b) - mine(a)) || (rank[a.state] - rank[b.state]) || (a.start < b.start ? -1 : 1); }).slice(0, 40);
          var live = all.some(function (e) { return e.state === 'in'; });
          var item = function (e) {
            var A = e.away, H = e.home, pre = e.state === 'pre';
            var nm = function (t) { return (t.rank ? t.rank + ' ' : '') + esc(t.abbr || t.short); };
            var sc = function (t) { return pre ? '' : ' <span class="' + (e.done && t.winner ? 'w' : '') + '">' + esc(t.score) + '</span>'; };
            var st = e.state === 'in' ? '<span class="lv">' + esc(e.detail) + '</span>' : '<span class="st">' + esc(pre ? tm(e.start) : (e.detail || 'Final')) + '</span>';
            return '<a href="' + esc(url(e.href)) + '"><b>' + LEAGUES[e.lg].short + '</b> ' + nm(A) + sc(A) + ' <span class="st">' + (pre ? '@' : '·') + '</span> ' + nm(H) + sc(H) + ' ' + st + '</a>';
          };
          var html = all.length ? all.map(item).join('') : '<a href="/sports/"><span class="st">No games in the next day and a half. Full schedules on the scores page.</span></a>';
          var tr = document.getElementById('sCrawl');
          // second copy makes the loop seamless; hidden from screen readers so each game is announced once
          tr.innerHTML = '<div class="s-crawl-run">' + html + '</div><div class="s-crawl-run" aria-hidden="true">' + html.replace(/<a /g, '<a tabindex="-1" ') + '</div>';
          clearTimeout(timer); timer = setTimeout(load, live ? 30000 : 300000);
        });
    }
    load();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crawl); else setTimeout(crawl, 0);
  }

  window.SD = { follows: follows, setFollows: setFollows, isFollowed: isFollowed, toggleFollow: toggleFollow, favChips: favChips, LEAGUES: LEAGUES, ORDER: ORDER, api: api, get: get, data: data, scores: scores, schedule: schedule, team: team, summary: summary,
    standingsLive: standingsLive, slimStandings: slimStandings, normEvent: normEvent, teamHref: teamHref, gameHref: gameHref, project: project, liveProb: liveProb, wpSeries: wpSeries, shareCard: shareCard, Phi: Phi, num: num, teamList: teamList, findTeams: findTeams };
})();
