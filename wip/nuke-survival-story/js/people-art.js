/*
 * PLEASE HOLD — optional square portraits for the talk card.
 *
 * One person id, one picture. Files (1:1), same origin, next to this page:
 *   img/people/<id>.webp       384 x 384
 *   img/people/<id>-192.webp   192 x 192
 * The id is the code key (brenda is Rob), not the name on the card.
 * Add the id to `available` below. Until it is listed, the page never
 * requests the file, and the canvas silhouette stays in the square.
 */
(function (root) {
  'use strict';

  var available = [];

  function has(id) { return !!id && available.indexOf(id) >= 0; }

  function clear(img) {
    img.hidden = true;
    img.removeAttribute('src');
    img.removeAttribute('srcset');
    img.alt = '';
  }

  function show(img, id, alt) {
    if (!has(id)) { clear(img); return false; }
    img.alt = alt || '';
    img.sizes = '80px';
    img.srcset = 'img/people/' + id + '-192.webp 192w, img/people/' + id + '.webp 384w';
    img.src = 'img/people/' + id + '.webp';
    img.hidden = false;
    return true;
  }

  root.PleaseHoldPeople = { available: available, has: has, show: show, clear: clear };
})(typeof window !== 'undefined' ? window : this);
