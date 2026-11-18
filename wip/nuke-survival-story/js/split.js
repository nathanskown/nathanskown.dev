/*
 * Splits a paragraph into sentences for the pager, without ever dropping text.
 * A sentence ends at . ! ? or … (one or more), plus any closing ) ] " ” ' ’,
 * followed by whitespace or the end. "4.99" never splits (no space after the
 * period), and short titles (St., Dr., Mr., Mrs., Mt.) don't end a sentence.
 * Works in the browser (window.PleaseHoldSplit) and in Node (require).
 */
(function (root) {
  'use strict';
  var ABBR = { st: 1, dr: 1, mr: 1, mrs: 1, mt: 1 };
  var END = /[.!?…]+[)\]"”'’]*(?=\s|$)/g;

  function splitSentences(text) {
    text = String(text);
    var parts = [], start = 0, m;
    END.lastIndex = 0;
    while ((m = END.exec(text))) {
      var stop = m.index + m[0].length;
      var word = /([A-Za-z]+)$/.exec(text.slice(start, m.index));
      if (m[0].charAt(0) === '.' && m[0].length === 1 && word && ABBR[word[1].toLowerCase()]) continue;
      var s = text.slice(start, stop).trim();
      if (s) parts.push(s);
      start = stop;
    }
    var tail = text.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length ? parts : [text];
  }

  var api = { splitSentences: splitSentences };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PleaseHoldSplit = api;
})(typeof window !== 'undefined' ? window : this);
