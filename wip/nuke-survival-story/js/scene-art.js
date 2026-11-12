/*
 * PLEASE HOLD — per-scene illustrations.
 *
 * One hook, one picture. Files (16:9), same origin, next to this page:
 *   img/scenes/<hook>.webp       1560 x 878
 *   img/scenes/<hook>-780.webp    780 x 439
 * Then add the hook string to `available` below. Until a hook is listed,
 * the page never requests it, and the canvas drawing stays in front.
 *
 * Hooks: title, detonation, bathtub_full, room_<room id>, end_<ending id>.
 */
(function (root) {
  'use strict';

  var WIDE = 1560;
  var NARROW = 780;

  // Shipped pictures. Empty until the webps are in img/scenes/.
  var available = [];

  var captions = {
    title: 'PLEASE HOLD in green phosphor letters, with a flat line under the title.',
    detonation: 'A phosphor view southeast toward Detroit, with the seconds since the flash counting up.',
    bathtub_full: 'The kitchen after the bathtub and the pots have been filled with water.',
    room_kitchen: 'The kitchen: a phone on hold with Brightline Fiber, and the east window toward the plume.',
    room_basement: 'A section of the house showing the basement below grade, with shelter and water readings.',
    room_street: 'A plat of Cedar Hollow Court, with the wind and the Detroit plume.',
    room_garage: "Jeff's pickup, the fuel gauge, and the route north toward Gaylord.",
    room_dunmore: "A section of Adam's yard: the hatch, the buried container, and a quiet Geiger counter.",
    room_hub: 'Ten Mile and Taft, westbound traffic at 3 miles an hour, eastbound lanes empty.',
    room_civic: 'The Civic Center triage board, counting immediate, delayed, minor, and expectant.',
    room_school: 'The Novi High gym under a glass-block roof, and the band room below it.',
    room_bandroom: 'The band room under the music wing, and the checklist before the door closes.',
    room_retirement: "Willow Glen's crossword and the ground floor, with doors that lock at 4:00.",
    room_church: "St. Clare's order of service: guests at 1:00, the ceremony at 1:15, and water under the cake table.",
    room_strip: 'Storefronts along Grand River: hardware, pharmacy, the Coney, and the grocery.',
    room_hardware: 'The hardware store receipt tape, the sign on the door, and what is left on the shelves.',
    room_pharmacy: "The pharmacy's now-serving number, the potassium iodide, and the line out the door.",
    room_diner: 'The Coney Island radio dial and the griddle, still running on a generator.',
    room_grocery: 'Aisle 7, empty shelves, and a cart of water near the registers.',
    room_mall: 'Center court under three floors of glass, and the windowless service corridors.',
    room_interchange: 'The I-96, I-275, and M-5 interchange at a stop, and a car with no gas cap.',
    room_office: 'Kessler Office Park, one conference room still lit, and the deck that is due at 5.',
    room_m5: 'M-5 northbound with every lane full, and distances to Walled Lake, Commerce, and Gaylord.',
    end_shelter_in_place: 'The band room across the first two weeks, door closed, 206 people inside.',
    end_home_base: 'The basement across the first two weeks, door closed.',
    end_up_north: 'The route from Novi north toward the cabin.',
    end_bunker: "Adam's laminated rules.",
    end_locked_out: 'The hatch from above, and rule 9.',
    end_business_as_usual: 'Slide 12 of the portfolio review as the light goes flat.'
  };

  var failed = {};
  function listed(hook) { return !!hook && available.indexOf(hook) >= 0 && !failed[hook]; }

  // Which picture this view should use. Empty string means keep the canvas.
  function hookFor(v, key) {
    if (!key || key === 'static' || key.indexOf('person:') === 0) return '';
    if (key === 'title' || !v || !v.playing) return 'title';
    if (key === 'detonation') return 'detonation';
    if (v.ended) return 'end_' + v.ended;
    if (v.room === 'kitchen' && v.flags && v.flags.bathtub_full) return 'bathtub_full';
    if (v.room) return 'room_' + v.room;
    return '';
  }

  function srcOf(hook) { return 'img/scenes/' + hook + '.webp'; }
  function srcsetOf(hook) {
    return 'img/scenes/' + hook + '-780.webp ' + NARROW + 'w, img/scenes/' + hook + '.webp ' + WIDE + 'w';
  }

  function clearImg(img) {
    img.onload = null;
    img.onerror = null;
    img.hidden = true;
    img.classList.remove('is-shown');
    img.removeAttribute('src');
    img.removeAttribute('srcset');
    img.alt = '';
  }

  // Two stacked images so a scene change can crossfade. Reduced motion swaps
  // with no fade. A hook that is not in `available` is never requested.
  function mount(imgA, imgB, reduceMotion, onChange) {
    var imgs = [imgA, imgB];
    var visible = -1;
    var shown = '';
    var token = 0;
    function hideAll() {
      token++;
      shown = '';
      visible = -1;
      clearImg(imgs[0]);
      clearImg(imgs[1]);
    }
    function show(hook) {
      if (!listed(hook)) { hideAll(); return false; }
      if (hook === shown) return true;
      var my = ++token;
      shown = hook;
      // Load into the image that is not on screen, so a slow fade cannot
      // overwrite the picture the reader is already looking at.
      var slot = visible === 0 ? 1 : 0;
      var back = imgs[slot];
      var top = visible < 0 ? null : imgs[visible];
      clearImg(back);
      back.alt = captions[hook] || '';
      back.sizes = '(max-width: 600px) 100vw, 800px';
      back.srcset = srcsetOf(hook);
      back.onload = function () {
        if (my !== token) return;
        back.hidden = false;
        back.style.zIndex = '3';
        if (top) top.style.zIndex = '2';
        function place() {
          if (top) clearImg(top);
          visible = slot;
        }
        if (reduceMotion) {
          back.classList.add('is-shown');
          place();
          return;
        }
        requestAnimationFrame(function () {
          if (my !== token) return;
          back.classList.add('is-shown');
        });
        var finished = false;
        function finish() {
          if (finished || my !== token) return;
          finished = true;
          place();
        }
        back.addEventListener('transitionend', function onEnd(e) {
          if (e.propertyName !== 'opacity') return;
          back.removeEventListener('transitionend', onEnd);
          finish();
        });
        setTimeout(finish, 700);
      };
      back.onerror = function () {
        if (my !== token) return;
        failed[hook] = true;
        shown = '';
        clearImg(back);
        if (top) clearImg(top);
        visible = -1;
        if (onChange) onChange(false);
      };
      back.src = srcOf(hook);
      return true;
    }
    return { show: show };
  }

  root.PleaseHoldSceneArt = {
    available: available,
    captions: captions,
    hookFor: hookFor,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : this);
