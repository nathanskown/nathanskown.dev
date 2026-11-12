/*
 * PLEASE HOLD — per-scene illustrations.
 *
 * One hook, one picture. Files (16:9), same origin, next to this page:
 *   img/scenes/<hook>.webp       1200 x 675
 *   img/scenes/<hook>-780.webp    780 x 439
 * The large file stays at 1200 so the outlines are not scaled up.
 * Then add the hook string to `available` below. Until a hook is listed,
 * the page never requests it, and the canvas drawing stays in front.
 *
 * Hooks: title, detonation, bathtub_full, room_<room id>, end_<ending id>.
 */
(function (root) {
  'use strict';

  var WIDE = 1200;
  var NARROW = 780;

  var available = [
    'title', 'detonation', 'bathtub_full',
    'room_kitchen', 'room_basement', 'room_street', 'room_garage', 'room_dunmore',
    'room_hub', 'room_civic', 'room_school', 'room_bandroom', 'room_retirement',
    'room_church', 'room_strip', 'room_hardware', 'room_pharmacy', 'room_diner',
    'room_grocery', 'room_mall', 'room_interchange', 'room_office', 'room_m5',
    'end_shelter_in_place', 'end_home_base', 'end_up_north', 'end_bunker',
    'end_locked_out', 'end_business_as_usual'
  ];

  var captions = {
    title: 'A man in a jacket stands in his open front door, looking out at a silent cul-de-sac. A low mushroom-shaped cloud sits over the rooftops.',
    detonation: 'He recoils as the kitchen window shatters inward. A glass of water sits on the counter.',
    bathtub_full: 'He kneels beside a full clawfoot tub, with a row of full buckets on the floor.',
    room_kitchen: 'He leans on the kitchen counter on the phone, a laptop and a sandwich beside him, the back door ajar.',
    room_basement: 'He stands with his hands on his hips in the basement, among stacked boxes, a water heater, and stored supplies.',
    room_street: 'On Cedar Hollow Court he stands with his arms folded while a neighbor with a clipboard walks past cars loaded with luggage.',
    room_garage: "He crouches beside an older man seated on a bucket in the garage. A crank radio sits on a crate, and a pickup is parked behind them.",
    room_dunmore: 'He stands with both hands raised while a man in a tactical vest holds a long gun pointed down.',
    room_hub: 'He waits on the curb at a dark traffic light while a man in a cap and striped vest directs a car, the sun low behind them.',
    room_civic: 'A nurse marks his forearm. A volunteer with a clipboard and a firefighter stand behind them.',
    room_school: 'He raises a hand beside a coach with a whistle and a clipboard, while a line of people files into the gym.',
    room_bandroom: 'He stacks cases of bottled water in the band room while the coach logs them. A tuba, lockers, and a seated crowd are behind them.',
    room_retirement: 'He sits on a sofa next to an older resident who is reading the newspaper.',
    room_church: 'At the wedding, a bride in a full-length dress points at him. A three-tier cake sits nearby, and a priest stands with hands folded by a pew.',
    room_strip: 'He walks past dark storefronts carrying a tote bag, with a queue of people farther down the lot.',
    room_hardware: 'He pays cash at the hardware counter. The clerk works a manual register, with a coil of rope and a flashlight on the counter.',
    room_pharmacy: 'He stands at the pharmacy counter while the pharmacist holds a bottle. A long line of people waits out the door.',
    room_diner: 'He eats a coney at the counter while the cook stirs a pot. A small generator sits on the counter.',
    room_grocery: 'He reaches toward mostly empty grocery shelves. A cart sits between him and another shopper.',
    room_mall: 'He points toward a doorway while a security guard talks into a radio. A large blank screen hangs on the wall.',
    room_interchange: 'He crouches by a guardrail and offers a water bottle to a woman and a boy. A car with its hood up is stopped beside them.',
    room_office: 'He climbs the office stairs carrying a cord, while a man waves from a lit doorway. A picture of a heron hangs by the stairs.',
    room_m5: 'He leans on a minivan to talk to a child in the window, with cars gridlocked in every lane behind them.',
    end_shelter_in_place: 'He stands with the coach at a half-open door, the coach’s hand on the handle.',
    end_home_base: 'He kneels on the basement steps, rolling a blanket against the bottom of the door. A water heater and jugs sit behind him.',
    end_up_north: 'At night he holds a lantern beside a pickup with its tailgate down. The driver leans from the cab, with pines and a crescent moon behind them.',
    end_bunker: 'He sits on a bunk while a man in a tactical vest reads from a blank sheet. Shelves of stores line the wall.',
    end_locked_out: 'He strains against the wheel of a heavy round vault door.',
    end_business_as_usual: 'He sits at a table pointing at a bar chart on a laptop, across from a bald man. A map hangs on the wall behind them.'
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
    var fadeTimer = 0;
    function hideAll() {
      token++;
      clearTimeout(fadeTimer);
      fadeTimer = 0;
      shown = '';
      visible = -1;
      clearImg(imgs[0]);
      clearImg(imgs[1]);
    }
    function show(hook) {
      if (!listed(hook)) { hideAll(); return false; }
      if (hook === shown) return true;
      var my = ++token;
      clearTimeout(fadeTimer);
      fadeTimer = 0;
      shown = hook;
      // A change that arrives mid-fade drops the picture that was on its way in.
      // The settled picture stays until the new one is ready.
      if (visible >= 0) clearImg(imgs[1 - visible]);
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
          clearTimeout(fadeTimer);
          fadeTimer = 0;
          place();
        }
        back.addEventListener('transitionend', function onEnd(e) {
          if (e.propertyName !== 'opacity') return;
          back.removeEventListener('transitionend', onEnd);
          finish();
        });
        fadeTimer = setTimeout(finish, 450);
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
