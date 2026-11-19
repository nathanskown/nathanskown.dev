/*
 * A5: two engine fixes.
 *  (a) The Up North count includes Jeff when he drives you without having joined your party. Bunker unchanged.
 *  (b) A second conversation with someone whose talk.start is a list opens with their "again" line.
 *   node wip/nuke-survival-story/test/engine.test.js
 * Also runs in a browser from test/index.html.
 */
(function () {
  'use strict';
  var inNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  var Engine = inNode ? require('../js/engine.js') : window.PleaseHoldEngine;
  var story = inNode ? require('../js/story.js') : window.STORY;
  var report = inNode ? function (ok, msg) { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) process.exitCode = 1; } : window.report;

  function memStore() {
    var m = {};
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  }
  function newGame() {
    var lines = [];
    var g = Engine.createGame(story, { print: function (t) { lines.push(String(t)); }, storage: memStore(), random: function () { return 0.5; } });
    g.start();
    g.handle('Sam');
    return { g: g, lines: lines, run: function (cmds) { lines.length = 0; cmds.forEach(function (c) { g.handle(c); }); return lines.join('\n'); } };
  }
  function afterwordFor(g, ending) {
    var S = g._state();
    S.ended = ending;
    return (story.afterword || []).filter(function (a) { return a['if'] && a['if'].ending === ending; }).map(function (a) { return g.resolve(a.text); }).join(' | ');
  }

  // (a) Up North without inviting Jeff: you plus Jeff.
  var t = newGame();
  t.g._state().party = [];
  var up = afterwordFor(t.g, 'up_north');
  report(t.g.view().sheltered === 2 && /IN JEFF'S TRUCK: 2, counting you\./.test(up), 'up north, Jeff not invited: ' + up);

  // Up North after Jeff joined: still 2 (he is counted once, in the party).
  t = newGame();
  t.g._state().party = ['ray'];
  up = afterwordFor(t.g, 'up_north');
  report(t.g.view().sheltered === 2, 'up north, Jeff in the party: ' + t.g.view().sheltered);

  // Bunker Mentality: you plus Adam, unchanged.
  t = newGame();
  t.g._state().party = [];
  t.g._state().ended = 'bunker';
  report(t.g.view().sheltered === 2, 'bunker alone: ' + t.g.view().sheltered + ' (you and Adam)');

  // (b) Return visits: Jeff.
  t = newGame();
  var first = t.run(['out', 'north', 'talk to jeff']);
  t.run(['6']);
  var again = t.run(['talk to jeff']);
  report(/Jeff looks up when you come in/.test(first) && /Jeff turns the radio down\. “What do you need\?”/.test(again) && !/Jeff looks up when you come in/.test(again),
    'Jeff, second visit: ' + again.split('\n')[0]);

  // Adam, before you have his insulin.
  t = newGame();
  t.run(['out', 'east', 'talk to adam', '3']);
  again = t.run(['talk to adam']);
  report(/Still not opening the hatch/.test(again), 'Adam, second visit: ' + again.split('\n')[0]);
})();
