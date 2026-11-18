// "Play full screen" on the turn-your-phone screen: phones that can lock the screen sideways
// (most Android browsers) get a button that does it. iPhone Safari can't, so it never shows there.
(function () {
  'use strict';
  var b = document.getElementById('fullscreen');
  var el = document.documentElement;
  if (!b || !el.requestFullscreen || !document.fullscreenEnabled || !(screen.orientation && screen.orientation.lock)) return;
  b.hidden = false;
  b.addEventListener('click', function () {
    try {
      el.requestFullscreen().then(function () { return screen.orientation.lock('landscape'); }).catch(function () {});
    } catch (e) { /* not supported */ }
  });
})();
