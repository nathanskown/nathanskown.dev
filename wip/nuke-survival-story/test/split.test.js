/*
 * A1: the pager's sentence splitter must never drop text.
 * Runs every string in story.js, plus the engine's notes tips, through splitSentences and checks that the
 * pieces put back together (whitespace collapsed) equal the original.
 *   node wip/nuke-survival-story/test/split.test.js
 * Also runs in a browser from test/index.html.
 */
(function () {
  'use strict';
  var inNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  var split = inNode ? require('../js/split.js').splitSentences : window.PleaseHoldSplit.splitSentences;
  var story = inNode ? require('../js/story.js') : window.STORY;
  var report = inNode ? function (ok, msg) { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) process.exitCode = 1; } : window.report;

  function squash(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  var strings = [];
  (function walk(x) {
    if (typeof x === 'string') { strings.push(x); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x && typeof x === 'object') Object.keys(x).forEach(function (k) { walk(x[k]); });
  })(story);
  // The engine's "New note" line, with each tip it can carry.
  var tips = [story.text.notesTip, story.text.touch && story.text.touch.notesTip];
  (story.notes || []).forEach(function (n) {
    tips.forEach(function (tip) { if (typeof n.text === 'string') strings.push('New note: ' + n.text + (tip || '')); });
  });
  // The paragraphs the engine actually prints (it splits on blank lines first).
  var paragraphs = [];
  strings.forEach(function (s) { s.split(/\n{2,}/).forEach(function (p) { if (p.trim()) paragraphs.push(p.trim()); }); });

  var lossy = paragraphs.filter(function (p) { return squash(split(p).join(' ')) !== squash(p); });
  report(lossy.length === 0, 'split: ' + paragraphs.length + ' paragraphs from story.js, ' + lossy.length + ' lossy');
  lossy.slice(0, 5).forEach(function (p) { report(false, '  lossy: ' + p.slice(0, 120)); });

  // The cases from the bug report.
  [
    ['Two cars. (Type “notes” to see them all.)', ['Two cars.', '(Type “notes” to see them all.)']],
    ['SPRING WATER 24PK $4.99. Limit two.', ['SPRING WATER 24PK $4.99.', 'Limit two.']],
    ['Go see Dr. Patel on Grand River. Now!', ['Go see Dr. Patel on Grand River.', 'Now!']],
    ['“Wait…” She stops. “No.”', ['“Wait…”', 'She stops.', '“No.”']],
    ['(You could “close the door”.)', ['(You could “close the door”.)']]
  ].forEach(function (c) {
    var got = split(c[0]);
    report(JSON.stringify(got) === JSON.stringify(c[1]), 'split: ' + c[0] + ' -> ' + JSON.stringify(got));
  });
})();
