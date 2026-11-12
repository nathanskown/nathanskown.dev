/*
 * ============================================================================
 *  PLEASE HOLD — story data
 *  Everything the player reads lives in this file. Edit freely.
 *  After editing, run:   node tools/check-story.js
 *  It catches broken exits, misspelled item names, missing dialogue lines, etc.
 * ============================================================================
 *
 *  QUICK REFERENCE
 *
 *  TEXT can be:
 *    "A plain string."
 *    ["Paragraph one.", "Paragraph two."]
 *    { if: <condition>, text: "Shown when true", else: "Shown when false" }
 *    ...or a list mixing all of these. {time} prints the clock; {cash} and
 *    {water} print those counters.
 *
 *  CONDITIONS (used in `if:`) — every key must be true:
 *    has: "item" or ["a","b"]      lacks: "item"
 *    flag: "name"                  notFlag: "name"
 *    with: "person" (in your group)  without: "person"
 *    in: "roomId"                  notIn: "roomId"
 *    before: "3:00 PM"             after: "3:00 PM"
 *    visited: "roomId"             var: ["cash", ">=", 25]
 *    party: ["<=", 4]  (you + everyone with you)
 *    alone: true                   any: [ {..}, {..} ]   not: { .. }
 *
 *  EFFECTS (used in `effects:`) — all optional, applied in this order:
 *    text, give: "item", take: "item", place: {item, room}, flag: "name",
 *    unflag: "name", add: {cash: -25}, set: {cash: 0}, join: "person",
 *    part: "person", move: {person: "roomId" or null}, time: minutes,
 *    goto: "roomId", ending: "endingId", death: "text (rewinds one move)"
 *    Wrap any effect in { if: {...}, ...effect..., else: {...} } to make it
 *    conditional. A list of effects runs in order.
 *
 *  Rooms, items, people, uses, actions, events, hints and endings are below,
 *  in that order. Room/person/item ids (the keys like "kitchen") are what the
 *  rest of the file refers to; the `name` is what players see.
 * ============================================================================
 */

// Radio news, shared by Jeff's radio, the diner radio and the radio item.
var NEWS = [
  { if: { before: "1:30 PM" }, text: "The AM station is a man reading the same bulletin on a loop, his voice a little tighter each time: confirmed detonations over Detroit and near Selfridge Air National Guard Base. Unconfirmed reports from Chicago, Toledo, “and other cities.” Then the guidance, word for word every time: Get inside. Stay inside. Stay tuned. Go to a basement or the middle of a large building. Stay there at least twenty-four hours unless officials tell you otherwise." },
  { if: { after: "1:30 PM", before: "4:30 PM" }, text: "A different voice now, a woman at a station somewhere upstate. More cities. Some she reads carefully, some she reads fast. The Detroit plume is drifting east over Windsor and Lake St. Clair “on current winds.” She asks people not to drive toward Detroit to look for family. She asks three times." },
  { if: { after: "4:30 PM" }, text: "The upstate station. Fallout from strikes west of Michigan is expected across the southern Lower Peninsula this evening. Her best estimate for Oakland County is {eta}, and she says twice that it's only an estimate. Get inside. Stay inside. Stay tuned. She says it the way you'd say a prayer you've been saying since noon, which she has." }
];

var STORY = {

  // ==========================================================================
  //  BASICS
  // ==========================================================================
  meta: {
    title: "PLEASE HOLD",
    subtitle: "Novi, Michigan. One afternoon.",
    warning: "Content note: nuclear war, injury, death, and bright flashes. This story is serious, with some dark humor. (Type “flashes” to turn the flashes off.)",
    version: 3,                 // bump this if a change would break old saves
    saveKey: "please-hold-v1"
  },

  start: {
    room: "kitchen",
    inventory: ["cellphone"],
    vars: { cash: 0, water: 0 }
  },

  clock: {
    start: "12:14 PM",
    moveMinutes: 2,             // default minutes per move if an exit has no `time`
    talkMinutes: 1,             // minutes per dialogue choice
    waitMinutes: 15,
    // Multipliers on travel time. All that apply are multiplied together.
    moveModifiers: [
      { if: { flag: "has_bike", without: ["ruth", "haddads"] }, factor: 0.5 },
      { if: { with: "ruth" }, factor: 1.6 },
      { if: { with: "haddads" }, factor: 1.2 }
    ],
    events: [
      { at: "12:40 PM", effects: { fx: "flash" }, text: "Another flash, fainter, far off to the east-northeast. Macomb County, maybe. The sound comes almost two minutes later, a long low knock, like someone at a door in another house." },
      { at: "12:31 PM", effects: { flag: "msu_text" }, text: "Your phone buzzes once. One text made it through the jammed network, from your little sister at State, stamped 12:24: “are you ok?? were in the dorm basement, RA says stay here. DONT go to the game lol. love you.” You type three different answers and delete them. You send “ok. stay there. love you” and watch the little wheel spin, and spin." },
      { at: "1:15 PM", effects: { flag: "cells_dead" }, text: "Your phone's SOS ONLY turns into NO SERVICE. Somewhere a cell tower's backup battery has given up, or its fiber line ran through Detroit." },
      { at: "2:40 PM", effects: { flag: "water_off" }, text: [
        "Everywhere in Novi at once, faucets cough and go quiet. The water comes from Detroit's system, and Detroit's system is gone.",
        { if: { flag: "bathtub_full" }, text: "You think of the full bathtub at home and feel, for the first time today, something close to relief." }
      ] },
      { at: "3:15 PM", effects: { flag: "refugees" }, text: "The westbound traffic has started spilling off the main roads into the subdivisions. Dented cars, Wayne County plates, families looking for any driveway to stop in." },
      { at: "1:45 PM", if: { in: "church", notFlag: "witnessed" }, text: "Up front, Father Andrew pronounces them married. The guests clap too long, and then they all go downstairs." },
      { at: "1:45 PM", effects: { flag: "wedding_over" } },
      { at: "3:00 PM", if: { in: "grocery", notFlag: "trent_gone" }, text: "The man in the Lions windbreaker pushes his cart out through the pried-open doors without looking back." },
      { at: "3:00 PM", effects: { flag: "trent_gone" } },
      { at: "3:05 PM", effects: { flag: "call_waiting" } },
      { at: "3:05 PM", if: { in: "kitchen", notFlag: "landline_dead" }, text: "Under the saxophone, a double beep. Then another. Call waiting. Somebody is trying to reach this number. (You could “answer the call”.)" },
      { at: "4:00 PM", if: { notFlag: "haddads_moved" }, effects: { flag: "haddads_walked", move: { haddads: null } } },
      { at: "4:00 PM", if: { in: "interchange", notFlag: "haddads_moved" }, text: "Down on the shoulder, Mary shoulders a backpack, takes Jose's hand, and starts walking west." },
      { at: "4:30 PM", if: { any: [{ has: "radio" }, { in: ["garage", "diner", "civic"] }] }, text: "On the radio: fallout from strikes to the west is expected across southern Michigan this evening. Best estimate for Oakland County: {eta}. Get inside. Stay inside. Stay tuned." },
      { at: "5:30 PM", if: { flag: "truck_fueled", in: ["garage", "street"], without: "ray" }, text: "Jeff's pickup backs out of the garage. He rolls the window down, looks at you for a long second, and lifts two fingers off the wheel. Then he's gone." },
      { at: "5:30 PM", if: { flag: "truck_fueled", without: "ray", notFlag: "ray_left" }, effects: [
        { flag: "ray_left", move: { ray: null } },
        { if: { lacks: "radio" }, place: { item: "radio", room: "garage" } }
      ] },
      { at: "6:00 PM", effects: { flag: "landline_dead" } },
      { at: "6:00 PM", if: { in: "kitchen" }, text: "The hold music stops. Then the line. Not a dial tone. Nothing." },
      { at: "6:45 PM", text: "The light is going orange. The sky to the west looks completely ordinary." },
      { at: "7:34 PM", text: "The sun goes down over Novi. Streetlights don't come on. Somewhere a generator is running, and somewhere a dog won't stop." }
    ],
    // When this time arrives and the story hasn't ended, the player is caught
    // outside. They're rewound roughly `rewindMinutes` and can try again.
    // The real arrival time is picked at random between these two times each game.
    // The radio's estimate ({eta}) always contains it and narrows as it gets close.
    deadline: {
      earliest: "6:30 PM",
      latest: "9:00 PM",
      rewindMinutes: 120,
      text: [
        "You can't see it. That's what Steven spent the sixties trying to tell people. Fallout that has drifted two hundred miles isn't grit or ash. It's a dust too fine to notice, settling on the roofs and the lawns and the hoods of cars and on you, and the only things that would have told you were a Geiger counter, or the radio, or Steven.",
        { if: { in: ["basement", "bandroom"] }, text: "You were in the right place. You just hadn't finished getting it ready." },
        "You were caught outside when the fallout arrived."
      ]
    }
  },

  text: {
    askName: "BRIGHTLINE FIBER · ACCOUNT VERIFICATION\nBefore we connect you, please say or enter the first name on the account.\n(Type your first name and press Enter.)",
    askNameAgain: "We didn't catch that. Please enter the first name on the account.",
    afterIntro: "(Type “help” for commands, or “hint” if you're stuck. The game saves automatically.)",
    unknown: "You're not sure how to do that. (Type “help” for commands.)",
    wait: "You wait.",
    noHint: "Look around. Talk to people. The clock is running.",
    endTalk: "You step away.",
    choiceTip: "(Type a number to answer. Type anything else to end the conversation.)",
    exitHint: "There's no obvious way out from here. (To leave the game, type “quit”.)",
    quit: "You set the receiver down. (Progress saved. Type “play” to come back.)",
    saveOutdated: "(The story has changed since your last visit, so your old save can't be loaded. Starting fresh.)",
    rewindStep: "Rewinding to just before that.",
    rewindDeadline: "Rewinding to {time}. You have a little time to try something else. (If you're out of options, type “restart”.)",
    rewindRestart: "Starting over.",
    afterEnding: "Type “restart” to play again, “endings” to see which endings you've found, “share” to copy your result, or “quit” to leave.",
    endingTypes: { good: "a good ending", mixed: "a mixed ending", bad: "a bad ending" }
  },

  help: [
    "COMMANDS",
    "look (l): describe where you are.  examine X (x X): look closely at something.\ngo north (n, s, e, w, ne, nw, se, sw, up, down, in, out). You can also type a place: “go garage”.\ntake X, drop X, inventory (i)\ntalk to X, then answer with numbers.\nuse X, use X on Y, give X to Y\nwait (or wait 30): let time pass.  time: check the clock.\nhint, endings, restart, quit\nfeedback: copy your whole playthrough to send to whoever shared this with you.\nshare: copy your ending.\nflashes: turn the bright flashes on or off.",
    "Every move costs time. Some things only work before a certain hour."
  ],

  inventoryNotes: [
    { if: { var: ["cash", ">", 0] }, text: "Cash: ${cash}" },
    { if: { var: ["water", ">", 0] }, text: "Bottled water: {water} case(s)" }
  ],

  // ==========================================================================
  //  HUD — the news ticker and the STATUS panel on the game screen.
  //  Every ticker line whose `if` is true scrolls across the top.
  //  Status rows: `value` is the readout; `tone` is "ok", "warn" or "bad".
  // ==========================================================================
  hud: {
    ticker: [
      { text: "DETROIT ▼ CONFIRMED DETONATION 12:12 ET" },
      { if: { after: "12:40 PM" }, text: "SELFRIDGE ANGB ▼ CONFIRMED DETONATION" },
      { if: { before: "1:30 PM" }, text: "CHICAGO ▼ UNCONFIRMED · TOLEDO ▼ UNCONFIRMED" },
      { if: { after: "1:30 PM" }, text: "CHICAGO ▼ CONFIRMED · TOLEDO ▼ CONFIRMED · MORE CITIES UNCONFIRMED" },
      { text: "WIND W 14 MPH ► DETROIT PLUME DRIFTING EAST OVER WINDSOR" },
      { if: { notFlag: "cells_dead" }, text: "CELL NETWORK ▼ SOS ONLY" },
      { if: { flag: "cells_dead" }, text: "CELL NETWORK ▼ NO SERVICE" },
      { if: { notFlag: "water_off" }, text: "CITY WATER ▼ PRESSURE FALLING · FILL CONTAINERS NOW" },
      { if: { flag: "water_off" }, text: "CITY WATER ▼ OFFLINE" },
      { text: "DTE OUTAGE MAP ▼ UNAVAILABLE DUE TO OUTAGE" },
      { text: "BRIGHTLINE FIBER ▲ AVERAGE HOLD TIME: UNPRECEDENTED" },
      { text: "TIGERS 7:10 PM FIRST PITCH ▬ STATUS UNCLEAR" },
      { if: { before: "4:30 PM" }, text: "FALLOUT ETA ▬ UNKNOWN" },
      { if: { after: "4:30 PM" }, text: "FALLOUT ETA ▼ {eta} (ESTIMATE)" },
      { text: "SUNSET 7:34 PM ET" },
      { text: "GET INSIDE · STAY INSIDE · STAY TUNED" }
    ],
    status: [
      { label: "POWER", value: "GRID DOWN", tone: "bad" },
      { label: "CELL", value: { if: { flag: "cells_dead" }, text: "NO SERVICE", else: "SOS ONLY" }, tone: { if: { flag: "cells_dead" }, text: "bad", else: "warn" } },
      { label: "LANDLINE", value: { if: { flag: "landline_dead" }, text: "DEAD", else: "ON HOLD" }, tone: { if: { flag: "landline_dead" }, text: "bad", else: "warn" } },
      { label: "CITY WATER", value: { if: { flag: "water_off" }, text: "OFF", else: "RUNNING (LOW)" }, tone: { if: { flag: "water_off" }, text: "bad", else: "warn" } },
      { label: "STORED WATER", value: [
        { if: { flag: "bathtub_full" }, text: "BATHTUB" },
        { if: { flag: "heater_drained" }, text: "HEATER TANK" },
        { if: { var: ["water", ">", 0] }, text: "{water} CASE(S)" },
        { if: { notFlag: ["bathtub_full", "heater_drained"], var: ["water", "<", 1] }, text: "NONE" }
      ], tone: { if: { notFlag: ["bathtub_full", "heater_drained"], var: ["water", "<", 1] }, text: "bad", else: "ok" } },
      { label: "CASH", value: "${cash}" },
      { label: "SUNSET", value: "7:34 PM" },
      { label: "FALLOUT ETA", value: { if: { after: "4:30 PM" }, text: "{eta}", else: { if: { flag: "knows_deadline" }, text: "TONIGHT", else: "UNKNOWN" } }, tone: "warn" }
    ]
  },

  intro: [
    "Novi, Michigan. A Thursday in September. 12:09 PM.",
    "You are twenty-eight years old and you own a house, which still sounds like a lie when you say it out loud. It's the smallest house on Cedar Hollow Court, a brick ranch a mile off Beck and Ten Mile, with a basement that takes on water if you look at it wrong. You bought it two years ago with everything you had and some you didn't. The HOA newsletter calls it “the starter home.” You've decided to take that as a compliment.",
    "You work in finance, which mostly means you build slides about other people's money for a wealth-management firm off Twelve Mile. Today is a work-from-home day, which mostly means you have been on hold with Brightline Fiber for forty-seven minutes. The internet went out at nine. The hold music is a saxophone version of a song you almost recognize.",
    "There's a Lions hoodie on the back of your chair that's older than your car. There are two tickets to tonight's Tigers game on the counter under your keys, because you promised your little sister you'd drive to East Lansing, pick her up from State, and buy her a hot dog she'll complain about. Your older sister is in Arizona, two thousand miles away, working a hospital shift. The three of you have a group chat that is mostly memes and arguments about whose turn it is to call Mom.",
    "Brightline's automated system has your name on file, {name}, and has called you “a valued customer” eleven times since nine o'clock.",
    "At 12:09 every phone in the house screams at once. The cell on the counter. The tablet in the bedroom. The old flip phone in the junk drawer that you forgot still had a SIM card.",
    "EMERGENCY ALERT\nBALLISTIC MISSILE THREAT INBOUND TO MICHIGAN. SEEK IMMEDIATE SHELTER. THIS IS NOT A DRILL.",
    "You read it twice. Then you do what almost everyone does, the thing every pamphlet ever printed tells you not to do. You go to the window and look.",
    "At 12:12 the sky to the southeast goes white. Not bright. White. For a second and a half, the shadows in your kitchen point the wrong way, and you think, absurdly, of the Tigers tickets.",
    "You count without meaning to, the way you count after lightning. You get to a hundred and twelve.",
    "Then the east windows come in all at once, and the sound arrives. It isn't a bang. It's a weight, as if the air itself has been dropped on the roof.",
    "Then quiet. A car alarm. Two. Every dog on Cedar Hollow Court.",
    "The landline receiver is still in your hand, still playing the saxophone.",
    "“Your call is important to us,” it says. “Please continue to hold.”"
  ],

  // ==========================================================================
  //  ROOMS (20)
  // ==========================================================================
  rooms: {

    // ---------------------------------------------------------------- HOME
    kitchen: {
      name: "Your Kitchen",
      aliases: ["home", "house", "kitchen", "my house"],
      text: [
        "Glass all over the floor from the east windows, glittering like spilled sugar. The power is out. The fridge has gone quiet for the first time in the two years you've owned it, and the silence is so complete that you can hear the house tick as it settles. Your laptop is open on the table next to half a turkey sandwich and the Q3 deck you were supposed to send by five. The Tigers tickets are still on the counter, under your keys.",
        { if: { notFlag: "landline_dead" }, text: "The landline handset lies on the counter, off its cradle, still on hold. You can hear the saxophone from across the room." },
        { if: { flag: "landline_dead" }, text: "The landline handset lies on the counter. It's quiet now." },
        { if: { flag: "bathtub_full" }, text: "Down the hall, the bathtub is full to the overflow drain, and every pot you own sits on the counter full of water." },
        "The basement door is by the pantry. The front door hangs open. You don't remember opening it."
      ],
      short: [
        "Your kitchen: glass on the floor, the laptop, the phone on the counter.",
        { if: { notFlag: "landline_dead" }, text: "The saxophone plays on." }
      ],
      exits: {
        down: { to: "basement", time: 1, label: "the basement" },
        out: { to: "street", time: 1, also: ["east", "front door", "street", "outside"] }
      },
      items: ["wallet", "flashlight"],
      scenery: {
        "window, windows, sky, cloud, southeast": "Southeast, past David and Stephanie's roofline, a column of cloud stands over where Detroit should be. Brown at the base, pink and gray at the edges, flattening at the top like it's hit a ceiling. It's already leaning east, away from you, toward Canada.",
        "laptop, deck, q3 deck, computer, slides": "Q3 REGIONAL PORTFOLIO REVIEW, DRAFT v7. Forty-one slides about allocation and drawdown and risk tolerance. Slide 12 still says [CHART GOES HERE]. Battery: 14%. You close the lid, then open it again, then close it.",
        "hoodie, lions hoodie, chair": "Honolulu blue, gone soft and thin from ten years of washing. It has outlasted three head coaches and one girlfriend. You put it on. It's not cold. You put it on anyway.",
        "tickets, tigers tickets, keys": "Two tickets for tonight, 7:10 first pitch, upper deck behind first base. Comerica Park is in the middle of everything you saw turn white. You turn them face down, which doesn't help at all.",
        "photo, picture, magnet, sisters": "A photo under a Spartan helmet magnet: you and your sisters at a State game last November, faces painted green, all three of you visibly freezing and visibly happy. Your older sister flew in from Arizona for it. Your younger sister picked the seats and has not let anyone forget it.",
        "sink, faucet, tap": [
          { if: { notFlag: "water_off" }, text: "Water runs, a little weaker than usual. For now." },
          { if: { flag: "water_off" }, text: "You turn the tap. It coughs air." }
        ],
        "bathtub, tub, bath, bathroom": [
          { if: { flag: "bathtub_full" }, text: "Forty-some gallons, and it tastes faintly of pipes. It's the most valuable thing you own." },
          { if: { notFlag: "bathtub_full" }, text: "Down the hall. It's empty. You could fill it while the water still runs." }
        ],
        "phone, landline, handset, receiver, hold music, saxophone": [
          { if: { notFlag: "landline_dead" }, text: "A beige cordless the previous owners left behind. Still connected. Copper phone lines get their power from the phone company, not your house. You could listen, or hang up and try to call someone." },
          { if: { flag: "landline_dead" }, text: "Dead." }
        ],
        "glass, floor": "Window glass, in pebbles and in long knives. You step around the long ones.",
        "sandwich, turkey sandwich": "Half a turkey sandwich. You made it at 11:50, in a different world.",
        "fridge, refrigerator, freezer": "Keep it closed and it'll stay cold for a day or so. After that, the freezer becomes a countdown.",
        "pantry": "Cereal, crackers, a bag of rice you bought during a different emergency. The real food is downstairs."
      },
      actions: [
        {
          say: ["fill bathtub", "fill tub", "fill bath", "run bath", "fill up bathtub", "fill pots", "fill water", "store water", "fill bathtub with water", "fill sink"],
          if: { notFlag: ["water_off", "bathtub_full"] },
          time: 10,
          effects: { flag: "bathtub_full", text: "You go down the hall, jam the stopper in and open the tap all the way. Then the bathroom sink. Then you fill every pot in the kitchen. The pressure is already weaker than it should be. When it's done you stand there looking at forty-some gallons of water like it's a stack of gold bars, because it is." }
        },
        { say: ["fill bathtub", "fill tub", "fill bath", "run bath", "fill pots", "fill water", "store water"], if: { flag: "bathtub_full" }, effects: { text: "It's full. Every pot, too." } },
        { say: ["fill bathtub", "fill tub", "fill bath", "run bath", "fill pots", "fill water", "store water"], if: { flag: "water_off" }, effects: { text: "You open the tap down the hall. A cough of air, a few brown drops. Too late." } },
        {
          say: ["answer call", "answer the call", "answer", "answer phone", "answer call waiting", "switch over", "click over", "flash", "press flash", "take call", "pick up"],
          if: { flag: "call_waiting", notFlag: ["talked_sister", "landline_dead"], before: "3:40 PM" },
          time: 6,
          effects: { flag: ["talked_sister", "knows_shelter_basics", "knows_get_inside"], text: [
            "You press FLASH, a button you have never pressed in two years of owning this phone. Static, a click, and then your older sister's voice from two thousand miles away, thin and far off, like she's calling from the bottom of a pool.",
            "“Oh thank God. Thank God. I've been calling every number I have for three hours.” She's at work. You can hear the hospital behind her: a page overhead, someone shouting a room number. “Listen to me. Are you listening? Basement. Middle of the basement, away from the window. Water, as much as you can. You stay down there two weeks. Not two days. Two weeks. You don't go out for anything. You don't let anybody talk you into driving anywhere.”",
            "You tell her about the text from State. She already knows. “Twelve twenty-four. Dorm basement. She said you'd better not go to the game.” You laugh, and it comes out wrong, and she laughs too, and hers comes out wrong as well.",
            "“Hey,” she says. “Hey. I mean it. Two weeks.” Then the line clicks, and the saxophone comes back, and you understand that you were never removed from the queue at all."
          ] }
        },
        {
          say: ["listen to phone", "listen phone", "listen", "pick up phone", "answer phone", "listen to hold music", "listen to landline", "use phone", "use landline", "hold"],
          effects: { text: [
            { if: { before: "1:30 PM" }, text: "Saxophone. Then: “Your call is important to us. Our representatives are experiencing higher than usual call volume.” Then saxophone." },
            { if: { after: "1:30 PM", before: "3:30 PM" }, text: "The hold message has changed. Somebody, somewhere, recorded a new one in the last hour: “Due to a regional emergency, wait times may be longer than expected. For outage updates, please visit our website.” The saxophone resumes." },
            { if: { after: "3:30 PM", before: "6:00 PM" }, text: "Still holding. The saxophone skips now, every eleven seconds, on the same note. You realize you've started waiting for the skip." },
            { if: { after: "6:00 PM" }, text: "Nothing on the line. Not a dial tone. You hold it to your ear a while longer anyway." }
          ] }
        },
        {
          say: ["hang up", "hang up phone", "call 911", "dial 911", "call someone", "call", "call sister", "make call", "call for help"],
          if: { notFlag: "landline_dead" },
          time: 4,
          effects: { text: "You hang up on Brightline Fiber, forty-seven minutes of your life gone. You dial 911. Fast busy. You dial your little sister's cell. Fast busy. You dial your older sister in Arizona, and for one second it actually rings, a real ring, before a recording says all circuits are busy. You dial Brightline Fiber, out of some instinct you can't name, and the saxophone picks up on the first ring. A recorded voice tells you that you are caller number 4,112." },
          fail: "The line is dead."
        },
        { say: ["eat sandwich", "eat turkey sandwich", "eat"], time: 2, effects: { if: { notFlag: "ate_sandwich" }, flag: "ate_sandwich", text: "You eat it standing up because you don't know when you'll eat next. That's a new thought. You don't like it.", else: { text: "You already ate it." } } }
      ]
    },

    basement: {
      name: "Your Basement",
      aliases: ["basement", "cellar"],
      text: [
        "Poured concrete walls, the furnace, the water heater, a dehumidifier that stopped humming when the power went. Half the room is finished, in the sense that you put down a rug: a couch from your parents' old basement, a TV, a treadmill that has become a coat rack. The other half is storage. Christmas bins, your dad's old toolbox, a pantry shelf of soup and the good pasta.",
        "It smells like cold concrete and the dryer sheets you keep forgetting to buy more of. For two years this has been the room where you watch the Lions lose in December. Today it's the safest room you own.",
        { if: { notFlag: "basement_window_sealed" }, text: "One narrow window well, high on the east wall, lets in gray light." },
        { if: { flag: "basement_window_sealed" }, text: "The window well is covered in plastic sheeting, taped down at every edge." },
        { if: { flag: "knows_shelter_basics" }, text: "Below grade, concrete, one small window. Steven would call it “a decent start.”" },
        "If you're going to ride this out at home, this is where. (You could “shelter here” when you're ready.)"
      ],
      short: "The basement: concrete, the couch, the water heater, the pantry shelf.",
      exits: { up: { to: "kitchen", time: 1, label: "the kitchen" } },
      scenery: {
        "water heater, heater, tank": [
          { if: { flag: "heater_drained" }, text: "Drained. Every bin and bucket you own is full." },
          { if: { notFlag: "heater_drained", flag: "knows_waterheater" }, text: "Forty gallons of clean water sitting in a steel tank, if you do it the way Steven said. (You could “drain the water heater”.)" },
          { if: { notFlag: ["heater_drained", "knows_waterheater"] }, text: "A forty-gallon gas water heater. Its pilot light is still burning. It doesn't need electricity." }
        ],
        "window, window well, well": "The closest the outside gets to you down here. Plastic sheeting and tape would cover it. Dirt piled in the well would be even better.",
        "pantry, shelf, soup, pasta, food": "Soup, pasta, peanut butter, a jar of olives nobody has opened since 2021. Enough for one person for two weeks, if you're not picky. Less if you're not alone.",
        "couch, tv, treadmill": "The treadmill holds three coats and a tote bag of tote bags.",
        "furnace": "Off. In September it won't matter. You decide not to think about November.",
        "bins, christmas bins": "Ornaments, lights, a ceramic village. The little church has a light inside that runs on batteries."
      },
      actions: [
        {
          say: ["drain water heater", "drain heater", "use water heater", "open water heater", "get water from water heater", "drain tank"],
          if: { flag: "knows_waterheater", notFlag: "heater_drained", has: "flashlight" },
          time: 20,
          effects: { flag: "heater_drained", text: "Steven's way: you turn the gas valve to OFF, close the cold-water inlet, open a hot tap down the hall so it doesn't vacuum-lock, and crack the drain valve at the bottom. The first gallon is rusty. The rest runs clear into bins, buckets and the recycling tub. Forty gallons. You could kiss the thing." },
          fail: [
            { if: { flag: "heater_drained" }, text: "You already drained it." },
            { if: { notFlag: "knows_waterheater" }, text: "You don't know how to do that safely. Today seems like a bad day to learn by flooding the basement." },
            { if: { flag: "knows_waterheater", notFlag: "heater_drained", lacks: "flashlight" }, text: "The drain valve is on the back of the tank, wedged behind the furnace, and with the power out that corner of the basement is pitch black. You'd need a light. There's a flashlight in the kitchen junk drawer." }
          ]
        },
        {
          say: ["shelter here", "shelter", "hunker down", "stay here", "stay in basement", "wait it out", "close door", "seal basement", "shelter in basement", "close basement door", "lock door", "take shelter"],
          if: { any: [{ flag: "bathtub_full" }, { flag: "heater_drained" }, { var: ["water", ">=", 1] }] },
          effects: { ask: {
            text: [
              "You put your hand on the basement door. Once it closes, it stays closed for two weeks. You don't open it for anyone.",
              { if: { alone: true, before: "2:00 PM" }, text: "You haven't talked to anyone since the flash." },
              "Close the door?"
            ],
            yes: { ending: "home_base" },
            no: "You leave the door open. Not yet."
          } },
          fail: "You sit on the bottom step and do the math. A gallon a day per person, for two weeks. You have whatever's left in the pipes, which is nothing. You need water before you close this door."
        }
      ]
    },

    // ---------------------------------------------------------------- THE COURT
    street: {
      name: "Cedar Hollow Court",
      aliases: ["street", "court", "cul de sac", "cedar hollow", "outside", "subdivision", "neighborhood"],
      text: [
        "Cedar Hollow Court: eleven houses around a cul-de-sac off Ten Mile. Ten of them are two-story colonials in four HOA-approved shades of beige. The eleventh is yours, a brick ranch about the size of their garages. Half the houses have lost their east-facing windows. Your neighbors stand in their driveways the way people do after a storm, phones held up, looking for bars that aren't coming.",
        "To the southeast, the cloud over Detroit has flattened into a long brown shelf, drifting east.",
        { if: { flag: "refugees" }, text: "Cars that don't belong here are idling along the curb: dented, packed to the roof, Wayne County plates. A man is asking the Hendersons if he can use their bathroom." },
        "Your house is west. Jeff's garage is open to the north; you shovel his driveway every winter, and every spring he pretends he didn't notice. Adam's place, behind the eight-foot privacy fence, is east. The subdivision entrance and Ten Mile Road are south."
      ],
      short: [
        "Cedar Hollow Court. Neighbors in driveways, the brown shelf of cloud to the southeast.",
        { if: { flag: "refugees" }, text: "More strangers' cars along the curb now." }
      ],
      exits: {
        west: { to: "kitchen", time: 1, label: "your house", also: ["in", "inside", "home", "house"] },
        north: { to: "garage", time: 2 },
        east: { to: "dunmore", time: 2 },
        south: { to: "hub", time: 20 }
      },
      scenery: {
        "cloud, sky, detroit, southeast": "From here it almost looks like weather. Detroit is the city you have defended to every out-of-towner you've ever met: the food, the music, the comeback, the way people there show up for each other. You stand in your driveway and look at it for a long time.",
        "fence, privacy fence, dunmore place": "Eight feet of cedar. A sign: NO SOLICITING. NO TRESPASSING. NO EXCEPTIONS. Somebody has added, in Sharpie, a smiley face.",
        "neighbors, people, david, stephanie, olivia, kennedy, hendersons, driveways": "David and Stephanie are loading their minivan with the speed of people who have decided something, while Olivia and Kennedy fight over the window seat like it's any other day. The Hendersons sit on their porch steps, holding hands, not talking. Somebody's teenager is filming the cloud and narrating in a whisper.",
        "houses, colonials": "Four approved shades: Sandstone, Wheat, Buff, and a fourth that everyone calls Beige 4."
      }
    },

    garage: {
      name: "Jeff's Garage",
      aliases: ["garage", "jeff's garage", "jeffs garage", "jeff's house"],
      text: [
        "Jeff keeps his garage the way he kept his station at the Wixom plant for thirty-one years: everything labeled, every tool hanging inside its own outline on the pegboard. A Tigers schedule magnet from three seasons ago is still on the beer fridge. Jeff says he'll take it down when they win something.",
        { if: { notFlag: "ray_left" }, text: "A silver pickup sits nose-out. On the workbench, a battery radio murmurs." },
        { if: { flag: "ray_left", lacks: "radio" }, text: "The truck is gone. On the workbench, a note under the radio: WENT NORTH. KEEP THE RADIO. AM ONLY. — J." },
        { if: { flag: "ray_left", has: "radio" }, text: "The truck is gone. On the workbench, a note: WENT NORTH. KEEP THE RADIO. AM ONLY. — J." },
        { if: { flag: "truck_fueled", notFlag: "ray_left" }, text: "The truck's tailgate is down, half loaded: blankets, a cooler, two jugs of water, a coffee can of Jeff's late wife's seed packets." }
      ],
      short: "Jeff's garage. The pickup, the pegboard, the radio murmuring on the bench.",
      exits: { south: { to: "street", time: 2 } },
      items: ["bicycle", "gas_can"],
      scenery: {
        "truck, pickup": [
          { if: { notFlag: "truck_fueled" }, text: "A silver pickup with a fuel gauge just above a quarter. Gas stations can't pump without power, so a quarter tank is what Jeff has." },
          { if: { flag: "truck_fueled" }, text: "Fueled up. Enough to get past Gaylord, Jeff says." }
        ],
        "radio, workbench, bench": NEWS,
        "pegboard, tools": "A hammer inside a hammer outline. A wrench inside a wrench outline. One empty outline in the shape of a hacksaw, which is somehow the most unsettling thing in here."
      },
      actions: [
        { say: ["listen to radio", "listen radio", "listen", "turn up radio"], effects: { flag: "knows_get_inside", text: NEWS } }
      ]
    },

    dunmore: {
      name: "Adam's Yard",
      aliases: ["adams yard", "adam's yard", "bunker", "hatch", "fence"],
      text: [
        "Through the gate in the privacy fence is a yard planned by someone expecting this exact day. Rain barrels. Raised garden beds. Solar panels knocked crooked on their frames by the blast. In the middle of the lawn, under a fake boulder that isn't fooling anyone, is a round steel hatch. The summer you moved in, Adam asked you to help him carry a crate stenciled DO NOT TIP from his truck to that hatch. He never told you what was in it, and you never asked."
      ],
      short: "Adam's yard: rain barrels, solar panels, the hatch under the fake boulder.",
      exits: { west: { to: "street", time: 2 } },
      scenery: {
        "hatch, boulder, fake boulder, bunker": "A marine-grade steel hatch with a wheel lock. Under the fake boulder you can see the edge of a keypad. Adam has spent years and a lot of money on what's under there.",
        "rain barrels, barrels, garden, solar panels, panels": "All of it is good gear, maintained with care. There's a laminated sign on the rain barrel: NOT POTABLE UNTIL FILTERED. DON'T BE A HERO."
      }
    },

    // ---------------------------------------------------------------- TEN MILE
    hub: {
      name: "Ten Mile and Taft",
      aliases: ["ten mile", "10 mile", "intersection", "taft", "taft road", "hub", "corner"],
      text: [
        "Ten Mile and Taft. You've sat at this light a thousand times on the way to work, drinking gas-station coffee and listening to sports radio argue about the Lions' offensive line. The light is dark now. A Novi police officer in a reflective vest stands in the middle of the intersection directing traffic by hand, and he's very good at it. Somehow that frightens you more than anything else today.",
        "Eastbound Ten Mile is nearly empty. Westbound is solid: cars, pickups, a SMART bus, all crawling away from Detroit at walking speed. People walk on the shoulder too, carrying kids, carrying nothing.",
        "Cedar Hollow Court is back north. Taft Road runs up to Grand River and the shops to the northeast. The Civic Center and Novi High are east along Ten Mile. Willow Glen Senior Living is south. St. Clare's church is west, toward Beck."
      ],
      short: "Ten Mile and Taft. Dark signals, the officer, the slow westbound river of cars.",
      exits: {
        north: { to: "street", time: 20, label: "Cedar Hollow Court (home)", also: ["home"] },
        northeast: { to: "strip", time: 35, label: "Grand River and the shops" },
        east: { to: "civic", time: 12 },
        south: { to: "retirement", time: 10 },
        west: { to: "church", time: 8 }
      },
      scenery: {
        "traffic, cars, westbound, shoulder, people": "A woman in scrubs. A man carrying a toddler and a laundry basket full of shoes. A teenager pushing his grandmother in an office chair. Nobody is honking. That's the thing you'll remember.",
        "signals, lights, traffic lights": "Dark. Every one of them, as far as you can see.",
        "bus, smart bus": "A SMART bus, packed, with a hand-lettered sign in the window: NOT IN SERVICE / GOING ANYWAY."
      }
    },

    civic: {
      name: "Novi Civic Center",
      aliases: ["civic center", "civic", "city hall", "triage"],
      text: [
        "The city offices have become a triage point. Fire trucks fill the lot and generators roar. People from Detroit, Dearborn and Southfield stand in a line under the portico, some walking, some being carried. A nurse is writing numbers on foreheads in marker.",
        "Nobody is screaming. That's what surprises you. It's quieter than a Saturday at the DMV. People hold each other's elbows and wait their turn, because waiting your turn is the only part of this anyone knows how to do.",
        "A man in a Novi Emergency Management windbreaker stands on a folding table with a binder, trying to be heard. A fire lieutenant with a radio on each shoulder is trying to be everywhere."
      ],
      short: "The Civic Center triage point. Generators, the line, numbers on foreheads.",
      exits: {
        west: { to: "hub", time: 12, label: "Ten Mile and Taft" },
        east: { to: "school", time: 10, label: "the high school" }
      },
      scenery: {
        "line, people, injured, wounded": "Burns, mostly, on faces and forearms, the parts that were facing the window. Cuts from glass. Too many of them have bandages over their eyes. They looked at it. Everybody looked at it.",
        "binder": "City of Novi Emergency Operations Plan. The cover says REVISED 1962. Somebody has added a sticky note: REVISED AGAIN 1987?",
        "nurse, numbers": "Numbers 1 through 4. You don't ask what 4 means. You can tell from where they've put the 4s."
      }
    },

    school: {
      name: "Novi High School",
      aliases: ["high school", "school", "gym", "novi high"],
      text: [
        { if: { notFlag: "dana_convinced" }, text: "The gym doors are propped open. Inside, maybe two hundred people sit on bleachers and cots under a roof of glass-block skylights, which is exactly the wrong place to be. The cafeteria's east windows are gone, and glass crunches all down the hallway." },
        { if: { flag: "dana_convinced" }, text: "The gym is emptying. A long, quiet line of people with blankets and kids and pets is moving toward the music wing stairwell, the way you'd file out for a fire drill." },
        "Coach Connor, whistle around his neck, has been in charge for two hours. Nobody has told him he can stop. Behind him, a banner from last spring still hangs from the rafters: STATE QUALIFIERS · GIRLS' TRACK. Somebody's kid is asleep under it on a pile of gym mats.",
        "A stairwell by the music wing goes down."
      ],
      short: [
        { if: { notFlag: "dana_convinced" }, text: "The high school gym: two hundred people under the skylights." },
        { if: { flag: "dana_convinced" }, text: "The high school: a line of people heading down to the music wing." }
      ],
      exits: {
        west: { to: "civic", time: 10, label: "the Civic Center" },
        down: { to: "bandroom", time: 2, label: "the music wing stairs" }
      },
      scenery: {
        "skylights, roof, ceiling": "Glass block, forty feet up. On a sunny day the gym looks like a cathedral. It is a terrible place to be when the sky starts falling as dust.",
        "people, cots, bleachers": "Kids from the elementary school next door, still wearing name tags. Their parents, some of them. A man in a Lions jersey patiently explaining the same thing to his father over and over.",
        "windows, hallway, glass, stairwell": "The music wing stairwell has two tall windows at the landing, and both are broken. Anything coming in from outside would come down those stairs."
      }
    },

    bandroom: {
      name: "The Band Room",
      aliases: ["band room", "bandroom", "music room", "music wing", "basement"],
      text: [
        "Below grade, under the music wing. Cinderblock walls, no windows, one steel door, the smell of valve oil and old carpet. Risers, music stands, a tuba in a case like a small coffin. The whiteboard still says FALL CONCERT: AN EVENING OF AMERICAN CLASSICS, OCT 23. DON'T FORGET BLACK SOCKS.",
        "Three feet of earth and a slab of concrete sit between this room and the sky. You can feel it in the air: still, a little cool, the way a church is cool in July.",
        { if: { flag: "school_water" }, text: "Cases of water are stacked along the back wall." },
        { if: { flag: "school_sheeting" }, text: "Up the stairs, the broken landing windows are sealed with plastic sheeting and tape." },
        { if: { flag: "dana_convinced" }, text: "People are settling onto the risers, kids on laps, quiet." },
        "If everything's ready, someone has to close that door. (You could “close the door”.)"
      ],
      short: "The band room: cinderblock, the risers, the steel door.",
      exits: { up: { to: "school", time: 2, label: "the gym" } },
      scenery: {
        "door, steel door": "Heavy, steel, on a closer. Once it's shut, it's shut.",
        "tuba, case, instruments": "Property of the Novi Wildcats Marching Band. Somebody has stuck a googly eye on the bell.",
        "whiteboard, board": "AN EVENING OF AMERICAN CLASSICS, OCT 23. DON'T FORGET BLACK SOCKS."
      },
      actions: [
        {
          say: ["close door", "close the door", "shut door", "seal door", "seal band room", "seal room", "shelter here", "shelter", "lock door", "stay here", "close steel door"],
          if: { flag: ["dana_convinced", "school_water", "school_sheeting"] },
          effects: { ending: "shelter_in_place" },
          fail: [
            "Not yet. You look around and count what's missing:",
            { if: { notFlag: "dana_convinced" }, text: "Two hundred people are still upstairs in the gym. Coach Connor needs a reason to move them." },
            { if: { notFlag: "school_water" }, text: "There's no water down here. The fountains died with the city's water pressure." },
            { if: { notFlag: "school_sheeting" }, text: "The landing windows on the stairwell are wide open. Fallout would come right down the stairs to this door." }
          ]
        }
      ]
    },

    retirement: {
      name: "Willow Glen Senior Living",
      aliases: ["willow glen", "retirement home", "senior living", "nursing home"],
      text: [
        "The lobby smells like coffee and Lysol. Two aides for sixty residents, both running. Most of the residents are in the dining room in wheelchairs and walkers, watching the aides run. A man in a VFW cap is explaining duck-and-cover to a woman who clearly remembers it better than he does.",
        { if: { notFlag: "ruth_left", before: "4:00 PM" }, text: "In a chair by the window, a small old man in a cardigan is doing a crossword in pen. He is the calmest person you've seen today." },
        { if: { notFlag: "ruth_left", after: "4:00 PM" }, text: "The residents have been moved into the interior hallway, sitting on the floor in a long row, away from the windows. Elizabeth locks the front doors behind you. At the end of the row, the small old man in the cardigan is still doing his crossword." },
        { if: { flag: "ruth_left" }, text: "Steven's chair by the window is empty. The crossword is on the seat, finished." }
      ],
      short: "Willow Glen: the lobby, the dining room, the aides running.",
      exits: { north: { to: "hub", time: 10, label: "Ten Mile and Taft" } },
      scenery: {
        "aides, staff": "One of them, Elizabeth, says they're moving everyone into the interior hallway on the ground floor, away from the windows. There's no basement. She says it like an apology.",
        "residents, dining room": "A man in a VFW cap says, to nobody in particular, “Well, we always said they would.” A woman tells him to hush."
      }
    },

    church: {
      name: "St. Clare's",
      aliases: ["church", "st clares", "st. clare's", "st clare", "saint clares", "wedding"],
      text: [
        { if: { notFlag: "wedding_over" }, text: "There's a wedding going on. White ribbons on the pews, a three-tier cake on a folding table in the entryway, maybe forty guests in good clothes. Some of them are crying for reasons that have nothing to do with weddings." },
        { if: { flag: "wedding_over", notFlag: "witnessed" }, text: "The pews are empty. White ribbons, programs on the floor, a three-tier cake with one slice missing. Taped to the basement door, in the bride's handwriting: MARRIED 1:45 PM. SHELTERING DOWNSTAIRS. WE'RE FULL, WE'RE SORRY, GOD BLESS. M & R." },
        { if: { notFlag: ["witnessed", "wedding_over"], before: "1:15 PM" }, text: "The bride is standing in the aisle in her full dress, talking to the priest with the focus of someone defusing a bomb." },
        { if: { notFlag: ["witnessed", "wedding_over"], after: "1:15 PM" }, text: "The ceremony has started. Mady is at the altar, and Father Andrew is speaking. The guests are quieter than a church usually is." },
        { if: { flag: "witnessed" }, text: "The newlyweds are leading their guests down to the church basement, two by two, like an ark." }
      ],
      short: "St. Clare's. The wedding, the cake, the guests in good clothes.",
      exits: { east: { to: "hub", time: 8, label: "Ten Mile and Taft" } },
      scenery: {
        "cake": "Three tiers, buttercream, sugar roses. Somebody has already cut a slice from the back and tried to hide it.",
        "water, cases, table, cake table": [
          { if: { notFlag: ["witnessed", "wedding_over"] }, text: "Under the cake table: six cases of bottled water for a reception that isn't going to happen." },
          { if: { any: [{ flag: "witnessed" }, { flag: "wedding_over" }] }, text: "The water has gone downstairs with the guests." }
        ],
        "guests, pews": "Ryan's side is mostly cousins. Mady's side is mostly a grandmother, front row, in lavender, who has not stopped smiling and will not, out of principle."
      }
    },

    // ---------------------------------------------------------------- GRAND RIVER
    strip: {
      name: "Grand River Strip Mall",
      aliases: ["strip mall", "grand river", "shops", "strip", "parking lot"],
      text: [
        "A long lot of storefronts along Grand River. A hardware store to the north. A pharmacy to the west, with a line out the door. A Coney Island to the east, a generator rattling out back and its OPEN sign, unbelievably, lit. A grocery store anchors the northeast corner, where things look less orderly.",
        "Somebody has written on the dusty back window of a Silverado: WE'RE STILL HERE. Somebody else, in a different hand, has added: GO LIONS.",
        "Grand River runs northwest toward the mall. Taft Road leads back southwest to Ten Mile."
      ],
      short: "The Grand River strip mall: hardware, pharmacy, Coney, grocery.",
      exits: {
        southwest: { to: "hub", time: 35, label: "Ten Mile and Taft" },
        north: { to: "hardware", time: 2, if: { before: "5:00 PM" }, blocked: "Locked. A new sign in the window, same handwriting: CLOSED. GO HOME. GET INSIDE. — CHRIS" },
        west: { to: "pharmacy", time: 2, if: { before: "4:30 PM" }, blocked: "Locked. A sign on the door: CLOSED 4:30. WE ARE OUT OF IODIDE AND OUT OF TIME. GO HOME. — DONG" },
        east: { to: "diner", time: 2, if: { before: "6:00 PM" }, blocked: "The OPEN sign is off and the generator is quiet. Taped to the door: WENT HOME. STAY SAFE. THE CHILI WILL KEEP. — GRETA" },
        northeast: { to: "grocery", time: 3 },
        northwest: { to: "mall", time: 20, label: "the mall" }
      },
      scenery: {
        "sign, open sign": "OPEN, in red neon, on generator power. It is the brightest thing on Grand River and possibly in Oakland County.",
        "line": "Thirty people waiting for the pharmacy, in a straight line, because someone put down a strip of painter's tape and people will follow painter's tape to the end of the world."
      }
    },

    hardware: {
      name: "Hardware Store",
      aliases: ["hardware", "hardware store", "chris's"],
      text: [
        "A hand-lettered sign on the door: CASH ONLY. NO RETURNS. YES, EVEN NOW. CLOSING AT 5. — CHRIS.",
        "Inside it's dim and crowded. People are buying what people buy: plastic sheeting, duct tape, flashlights, batteries. The generators sold out at 12:30. Chris, sixties, reading glasses on a chain, adds up purchases on a paper-roll calculator. He says each total out loud, like a man reading scripture."
      ],
      short: "The hardware store. Chris at the counter with his paper-roll calculator.",
      exits: { south: { to: "strip", time: 2, label: "the strip mall lot" } },
      scenery: {
        "sign, door": "CASH ONLY. NO RETURNS. YES, EVEN NOW. — CHRIS.",
        "shelves, sheeting, tape, batteries": "The sheeting aisle is half gone. The tape aisle is all gone except for a pallet of the gray kind nobody likes, which is now going fast."
      }
    },

    pharmacy: {
      name: "Pharmacy",
      aliases: ["pharmacy", "drugstore", "drug store"],
      text: [
        "A hand-written sign: POTASSIUM IODIDE. 1 PER FAMILY. PLEASE READ THE INSERT. CLOSING 4:30. Behind the counter, the pharmacist, Dong, is filling prescriptions by flashlight, from memory and a paper log. Behind him, a fridge on a car battery and an inverter. The battery is from his own car. He'll be walking home."
      ],
      short: "The pharmacy. The line, the sign, Dong and his flashlight.",
      exits: { east: { to: "strip", time: 2, label: "the strip mall lot" } },
      scenery: {
        "sign, insert, potassium iodide": "The insert, in tiny print: Potassium iodide protects only the thyroid gland from radioactive iodine. It does not protect against other radiation. Take only when advised by public health officials.",
        "fridge, battery, inverter": "Insulin, vaccines, eye drops. Dong has rigged it to a car battery from his own car."
      }
    },

    diner: {
      name: "Coney Island",
      aliases: ["coney", "coney island", "diner", "greta's"],
      text: [
        "Booths, a counter, a griddle hissing on generator power. Every seat is full and nobody is paying. The owner, Greta, ladles chili onto hot dogs with the efficiency of a woman who has fed this town through two recessions and an ice storm and doesn't see why this should be any different.",
        "A battery radio by the register is tuned to the news. Above it, a framed dollar bill from 1968, and a photo of a man in a paper hat who has Greta's exact eyebrows."
      ],
      short: "The Coney. Greta at the griddle, the radio by the register.",
      exits: { west: { to: "strip", time: 2, label: "the strip mall lot" } },
      scenery: {
        "radio, register": NEWS,
        "griddle, coneys, food, chili": "Coney dogs, chili, mustard, onions. The smell is so normal it hurts.",
        "booths, people, customers": "A table of linemen from DTE in their hi-vis, eating fast, not talking. A mother feeding a baby fries one at a time. Two old men arguing about the Tigers like the season still matters."
      },
      actions: [
        { say: ["listen to radio", "listen radio", "listen", "listen to news"], effects: { flag: "knows_get_inside", text: NEWS } }
      ]
    },

    grocery: {
      name: "Grocery Store",
      aliases: ["grocery", "grocery store", "supermarket", "store"],
      text: [
        "The automatic doors have been pried open and stay that way. Inside, it's dark and loud. The water aisle has been stripped down to the shelf paper. A manager with a bullhorn is losing an argument with three hundred people. In the dark, the freezer cases are sweating, and the floor is slick with something you decide not to think about.",
        { if: { flag: "trent_gone" }, text: "Near the registers there's an empty space where a cart full of water used to be." },
        { if: { notFlag: "trent_gone" }, text: "Near the registers, a man in a Lions windbreaker stands guard over a cart stacked with eight cases of water, one hand resting on something at his belt." }
      ],
      short: "The grocery store: dark, loud, stripped.",
      exits: { southwest: { to: "strip", time: 3, label: "the strip mall lot" } },
      scenery: {
        "aisle, water aisle, shelves": "Shelf paper and a single price tag: SPRING WATER 24PK $4.99.",
        "manager, bullhorn": "“Please,” the manager says into the bullhorn. “Please. Please.” It's all he's got."
      }
    },

    mall: {
      name: "The Mall",
      aliases: ["mall", "shopping mall", "center court"],
      text: [
        "Somebody decided the mall would make a good shelter because it's big, and about a thousand people agreed. They're in center court, under a three-story glass atrium, sitting on the edge of the dry fountain. The light coming through the glass is beautiful. That's the problem with it.",
        { if: { flag: "warned_mall" }, text: "Now they're moving, in long lines, toward the service corridors behind the stores. Cinderblock, no windows." },
        "Grand River goes back southeast. The Novi Road overpass and the freeways are north. The office parks along Twelve Mile are east."
      ],
      short: [
        { if: { notFlag: "warned_mall" }, text: "The mall. A thousand people under the glass atrium." },
        { if: { flag: "warned_mall" }, text: "The mall. Center court is emptying into the service corridors." }
      ],
      exits: {
        southeast: { to: "strip", time: 20, label: "the Grand River strip mall" },
        north: { to: "interchange", time: 10, label: "the freeway overpass" },
        east: { to: "office", time: 12, label: "Kessler Office Park" }
      },
      scenery: {
        "atrium, glass, skylight, roof": "Three stories of glass panes, some already cracked from the blast wave. On a normal day it's a lovely place to sit with a pretzel.",
        "fountain, people, crowd": "Families, mall walkers in matching tracksuits, a kids' karate class still in their uniforms. Someone has started handing out free Cinnabon from a store with no power. It's the kindest thing anyone could think of."
      }
    },

    interchange: {
      name: "The Freeway Overpass",
      aliases: ["overpass", "interchange", "freeway", "highway", "i 96", "i96", "96"],
      text: [
        "From the Novi Road overpass you can see where I-96, I-696, I-275 and M-5 knot together. Nothing is moving on any of them. Westbound 96 is a parking lot to the horizon. People have gotten out of their cars and stand on the median, looking back east. Somewhere down there a car stereo is still playing, a Motown song you know every word to, and nobody turns it off.",
        "Some cars have been abandoned with their doors open.",
        { if: { notFlag: ["haddads_moved", "haddads_walked"] }, text: "On the shoulder below the overpass, a woman and a boy of about nine sit on the guardrail beside a car with its hood up." },
        { if: { flag: "haddads_walked" }, text: "The car with its hood up is still on the shoulder below the overpass. The woman and the boy are gone. Walking west, probably." }
      ],
      short: [
        "The overpass. Four freeways and nothing moving.",
        { if: { notFlag: ["haddads_moved", "haddads_walked"] }, text: "The woman and the boy are still on the guardrail." }
      ],
      exits: {
        south: { to: "mall", time: 10, label: "the mall" },
        north: { to: "m5", time: 12, label: "the M-5 on-ramp" }
      },
      scenery: {
        "cars, abandoned cars, vehicles": "A minivan with a car seat still buckled. A Tesla, dead for reasons of its own. An old rusted Impala with a broken gas cap and its doors flung open.",
        "impala": "A 2006 Impala, rusted through at the wheel wells. The gas cap is gone. Older cars don't have the anti-siphon screens newer ones do.",
        "median, people": "They're all facing the same way, toward the cloud. Nobody is saying anything.",
        "car, hood": "Dearborn dealer frame on the plate. The gauge would read empty if it had any power to read anything."
      }
    },

    office: {
      name: "Kessler Office Park",
      aliases: ["office", "office park", "work", "kessler"],
      text: [
        "Three glass buildings around a retention pond. In the lobby of yours, someone has set up a generator and run an orange extension cord up the stairwell. Your firm has the third floor: forty desks of people who move other people's money for a living, and a kitchen with a cold-brew tap that was the main selling point at your interview. Through a third-floor window you can see a light on in Conference Room B."
      ],
      short: "The office park. The orange cord up the stairs, the light in Conference Room B.",
      exits: { west: { to: "mall", time: 12, label: "the mall" } },
      scenery: {
        "pond, retention pond": "A heron stands in it, completely unbothered.",
        "cord, extension cord, generator": "Brendan's. You know it's Brendan's. He has the same model in his garage. He showed everyone photos."
      }
    },

    m5: {
      name: "M-5 On-Ramp",
      aliases: ["m5", "m 5", "on ramp", "ramp", "m-5"],
      text: [
        "M-5 runs north from here, toward Walled Lake and Commerce and eventually the idea of Up North. It's completely jammed: all lanes and both shoulders, headlights on in the middle of the afternoon. A man is walking between the cars selling bottled water for twenty dollars apiece, and people are paying.",
        "If anybody's getting out of Novi by car tonight, it won't be this way. A kid in the back of a minivan has written HELP on a piece of notebook paper and pressed it against the window, and then, under it, smaller: (JK). (MOSTLY)."
      ],
      short: "The M-5 on-ramp. Bumper to bumper, as far north as you can see.",
      exits: { south: { to: "interchange", time: 12, label: "the overpass" } },
      onEnter: [{ flag: "saw_gridlock" }],
      scenery: {
        "cars, traffic, lanes": "A camper with a canoe on top. A Corvette with a kayak on top, somehow. A school bus full of kids from a summer camp, staring out the windows.",
        "man, water, seller": "Twenty dollars a bottle. He has a cooler and a cash box and a look on his face like he can't believe it either."
      }
    }
  },

  // ==========================================================================
  //  ITEMS
  // ==========================================================================
  items: {
    cellphone: {
      name: "cell phone", aliases: ["phone", "cell", "iphone", "mobile"],
      desc: [
        { if: { notFlag: "cells_dead" }, text: "SOS ONLY. 41% battery. Sixty unsent texts in a family group chat, each with a little red exclamation point." },
        { if: { flag: "cells_dead" }, text: "NO SERVICE. You keep checking anyway. Everyone does." }
      ],
      drop: false, noDrop: "You can't make yourself put it down."
    },
    wallet: {
      name: "wallet", aliases: ["cash", "money"],
      desc: "Driver's license, two credit cards that are now pieces of plastic, and ${cash}.",
      takeText: "You take your wallet. Forty dollars in cash, which you only have because of the parking at a Tigers game last month.",
      onTake: { add: { cash: 40 } }
    },
    flashlight: {
      name: "flashlight", aliases: ["torch", "light"],
      desc: "A good LED flashlight from the junk drawer. Batteries: probably."
    },
    bicycle: {
      name: "bicycle", aliases: ["bike", "kids bike", "james's bike"],
      desc: "Jeff's grandson's bike. A little small for you. The roads are jammed, so a bike is the fastest thing in Novi today.",
      takeText: "You take the bike. Jeff nods. “James's in Grand Rapids with his mom. He won't miss it today.” (Travel is faster on the bike, unless you're walking with someone.)",
      onTake: { flag: "has_bike" }, onDrop: { unflag: "has_bike" }
    },
    gas_can: {
      name: "empty gas can", aliases: ["gas can", "can", "jerry can"],
      desc: "A red five-gallon plastic gas can. Empty.",
      takeText: "“Fill that and I'll go anywhere you want,” Jeff says."
    },
    gas_can_full: {
      name: "full gas can", aliases: ["gas can", "gas", "gasoline", "can", "fuel"],
      desc: "Five gallons of siphoned gasoline. It smells like a decision."
    },
    siphon: {
      name: "siphon pump", aliases: ["siphon", "pump", "hose"],
      desc: "A hand-squeeze siphon pump with six feet of clear hose."
    },
    sheeting: {
      name: "plastic sheeting and duct tape", aliases: ["sheeting", "plastic", "plastic sheeting", "tape", "duct tape"],
      desc: "A roll of 6-mil plastic sheeting and two rolls of gray duct tape. It won't stop radiation. It keeps the dust out of where you breathe, which is the point."
    },
    radio: {
      name: "battery radio", aliases: ["radio", "am radio"],
      desc: "A battery AM/FM radio. Keep it on AM. (You can “listen to radio” anywhere.)"
    },
    ki_pills: {
      name: "potassium iodide packet", aliases: ["potassium iodide", "ki", "iodide", "pills", "iodine", "ki pills", "packet"],
      desc: "Fourteen tablets in a foil card. The insert says, in bold, that this protects only your thyroid and only from radioactive iodine. Half the town thinks it's a force field."
    },
    insulin: {
      name: "insulin (Adam's)", aliases: ["insulin", "pharmacy bag", "bag", "refill", "adams insulin"],
      desc: "A white pharmacy bag: ADAM. Keep refrigerated. Dong has stapled on a note that just says IDIOT."
    },
    coneys: {
      name: "bag of coneys", aliases: ["coneys", "coney dogs", "hot dogs", "food", "bag", "bag of coneys"],
      desc: "A dozen Coney dogs wrapped in foil, still warm. Greta says they're good cold. They're not, but you're not going to tell her."
    }
  },

  // ==========================================================================
  //  PEOPLE
  //  `room` is where they start. `talk.start` is the first dialogue node, or a
  //  list of { if, node } to pick one. In a node, `again` is shown instead of
  //  `text` if you've already heard it. A choice with no `next` ends the talk.
  // ==========================================================================
  people: {

    brenda: {
      name: "Rob", aliases: ["rob", "robert", "hoa", "hoa president"],
      dossier: { age: "50s", role: "HOA president, Cedar Hollow Court", status: "Running a check-in. Wife at work downtown, 39th floor." },
      portrait: { prop: "clipboard" },
      room: "street",
      here: "Rob, the HOA president, is going door to door with a clipboard.",
      desc: "Late fifties, fleece vest, clipboard, reading glasses on his head. He is holding it together using procedure the way other people use a railing.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“Oh, thank God. Someone sensible.” Rob has the expression of a man who has decided to be useful at any cost. “I'm doing a check-in. Everybody on the court. {name}. The ranch. Got it. Are you hurt? Do you have a basement? I'm writing it all down.”",
            again: "Rob checks his clipboard. “You're on my list. Good. What do you need?”",
            choices: [
              { text: "I'm okay. Do you know anything?", next: "news" },
              { text: "Does anyone on the court have a shelter?", next: "bunker" },
              { text: "Rob, you should get in your basement.", next: "basement" },
              { text: "Come with me, Rob.", if: { without: "brenda" }, next: "join" },
              { text: "I have to go." }
            ]
          },
          news: {
            text: "“Phones are out. Jeff's got a radio. Mady is getting married at St. Clare's at one-fifteen, and they're going ahead with it, which is either beautiful or insane. They're saying Detroit, and maybe Chicago, and then the man on the radio started repeating himself.” His pen stops moving. “Diane's at work. Renaissance Center. Thirty-ninth floor.” He looks down at the clipboard. “I'm writing it down,” he says again.",
            choices: [
              { text: "Rob. I'm so sorry.", next: "sorry" },
              { text: "(Back.)", next: "start" }
            ]
          },
          sorry: {
            text: "“Phones are down,” he says. “That's all that means right now.” He clicks his pen twice. “David and Stephanie are leaving. I told them they're making a mistake, but I also gave them my good cooler, so.”",
            menu: "start"
          },
          bunker: {
            text: "“Adam has a bunker. In his backyard. In violation of Covenant 14, which prohibits structures exceeding or penetrating grade.” A pause. “I suppose that's moot.” He lowers his voice. “He's told everyone for eleven years that he won't let anyone in. He said it at the block party. In front of children.”",
            effects: { flag: "knows_bunker" },
            menu: "start"
          },
          join: {
            text: [
              { if: { before: "2:00 PM" }, text: "“After the check-in. I'm not leaving it half done.” He taps the clipboard. “Come back after two.”" },
              { if: { after: "2:00 PM" }, text: "“It's done, actually.” He turns the clipboard around. Every name on the court has a check mark except one, Diane, and next to it he has written a question mark and then crossed it out. “All right,” he says. “I'm bringing the clipboard.”" }
            ],
            effects: { if: { after: "2:00 PM" }, join: "brenda" },
            menu: "start"
          },
          basement: {
            text: "“I will. After the check-in.” He doesn't look up. “Somebody has to know who's here.”",
            menu: "start"
          }
        }
      }
    },

    ray: {
      name: "Jeff", aliases: ["jeff", "neighbor"],
      dossier: { age: "71", role: "Retired, Wixom Assembly (31 yrs)", status: "Daughter in Royal Oak. No word yet." },
      portrait: { prop: "cap" },
      room: "garage",
      here: "Jeff sits on an overturned bucket next to the radio, hands on his knees.",
      desc: "Seventy-one, Carhartt jacket, a Wixom Assembly retirement pin on the collar. His daughter Karen lives in Royal Oak, twelve miles from downtown Detroit.",
      talk: {
        start: [
          { if: { in: "garage" }, node: "start" },
          { node: "away" }
        ],
        nodes: {
          start: {
            text: "Jeff looks up when you come in. “Kid. You okay?” He's asking like he means it. He worked the line at Wixom for thirty-one years, and he has the calm of a man who's seen a lot of things go wrong slowly.",
            again: "Jeff turns the radio down. “What do you need?”",
            choices: [
              { text: "What's the radio saying?", next: "radio" },
              { text: "Have you heard from Karen?", next: "karen" },
              { text: "Can I borrow the radio?", if: { notFlag: "got_radio", lacks: "radio" }, next: "giveradio" },
              { text: "What are you going to do?", next: "plan" },
              { text: "I've got gas. Five gallons.", if: { has: "gas_can_full", notFlag: "truck_fueled" }, next: "fuel" },
              { text: "Let's go north. Now.", if: { flag: "truck_fueled" }, next: "go" },
              { text: "Come with me, Jeff. Don't sit here alone.", if: { without: "ray", notFlag: "truck_fueled" }, next: "join" },
              { text: "I have to go." }
            ]
          },
          radio: {
            text: NEWS,
            effects: { flag: "knows_get_inside" },
            menu: "start"
          },
          karen: {
            text: "“Royal Oak's twelve miles from downtown.” He says it like a fact about the weather. “Phones are down. That's all that means. Phones are down.” He doesn't say anything else, and you don't make him.",
            menu: "start"
          },
          giveradio: {
            text: "“Take it. I've got the one in the truck.” He hands it over. “Keep it on AM. The FM stations are all gone, or playing whatever was queued up. One of them's been playing smooth jazz since noon. Nobody there to stop it.”",
            effects: { give: "radio", flag: "got_radio" },
            menu: "start"
          },
          plan: {
            text: "“Cabin's up past Gaylord. Woodstove, a well, a root cellar. My wife and I spent thirty summers up there.” He nods at the truck. “I've got a quarter tank, and the stations can't pump without power. With five more gallons, I'd go. Not later than five-thirty, though. Not after dark, on those roads.” He looks at you. “There's room if you want it. Empty gas can's right there.”",
            effects: { flag: "knows_ray_plan" },
            menu: "start"
          },
          fuel: {
            text: "Jeff empties the can into the truck, slowly, so as not to spill a drop. “That'll get us there.” He starts loading: blankets, a cooler, two jugs of water, a coffee can of his late wife's seed packets. “I'm going at five-thirty, kid. With you or without you. I mean that kindly.”",
            effects: { take: "gas_can_full", flag: "truck_fueled" },
            menu: "start"
          },
          go: {
            text: [
              "Jeff gets behind the wheel. “Which way, {name}? M-5 is fastest. If it's moving.”",
              { if: { party: [">", 3] }, text: "He looks at everyone climbing into the back. “It's going to be tight. We'll manage.”" }
            ],
            choices: [
              { text: "Take M-5.", effects: { flag: "route_m5", ending: "up_north" } },
              { text: "M-5 is a parking lot. Take the back roads: Taft, Pontiac Trail, north through the lakes.", if: { flag: "saw_gridlock" }, effects: { flag: "route_back", ending: "up_north" } },
              { text: "Not yet. Give me a little time.", next: "start" }
            ]
          },
          join: {
            text: "Jeff thinks about it. “And go where?”",
            choices: [
              { text: "My basement. Two is better than one.", effects: { join: "ray", text: "“All right.” He stands up slowly, knees cracking. “I'll bring the radio.” He doesn't look back at the truck." } },
              { text: "Never mind.", next: "start" }
            ]
          },
          away: {
            text: "Jeff walks beside you with his hands in his jacket pockets. “Still with you, kid.”",
            choices: [
              { text: "Any news on the radio?", next: "radio" },
              { text: "Go home, Jeff. I'll be okay.", effects: { part: "ray", move: { ray: "garage" }, text: "He hesitates, then nods. “You know where I am.”" } },
              { text: "Keep going." }
            ]
          }
        }
      }
    },

    dale: {
      name: "Adam", aliases: ["adam", "prepper"],
      dossier: { age: "58", role: "Prepper. Bunker rated for four.", status: "Missing: one insulin refill." },
      portrait: { prop: "vest" },
      room: "dunmore",
      here: { if: { notFlag: "dale_open" }, text: "Adam stands on the hatch.", else: "Adam stands beside the open hatch." },
      desc: "Fifty-eight. A plate carrier over a golf polo. A shotgun held correctly, pointed at the grass. A medical alert bracelet on his wrist.",
      talk: {
        start: [
          { if: { flag: "dale_open" }, node: "open" },
          { if: { has: "insulin" }, node: "insulin" },
          { node: "start" }
        ],
        nodes: {
          start: {
            text: "“Stop there.” Adam keeps the shotgun pointed at the grass between you. “I know you, {name}. You're the one who leaves the recycling bin out until Thursday. I'm not opening the hatch. I've told everybody for eleven years I'm not opening the hatch.”",
            again: "“Still not opening the hatch,” Adam says.",
            choices: [
              { text: "I'm not asking to come in.", next: "notasking" },
              { text: "Then why are you still standing outside it?", next: "why" },
              { text: "I have to go." }
            ]
          },
          notasking: {
            text: "“Everyone's asking to come in. Some of them just haven't asked yet.”",
            menu: "start"
          },
          why: {
            text: "He doesn't answer for a while. “Insulin,” he says finally. “I've got a year of everything down there. Food. Water. Filters. Seeds. A Geiger counter I calibrated myself. And I let my insulin refill slide, because the pharmacy app kept logging me out.” He laughs, a short bad sound. “Twenty years of prepping, and I lost to two-factor authentication.” He looks toward Grand River. “I can't leave the hatch. Somebody'll be in it before I get back.”",
            effects: { flag: "knows_dale_insulin" },
            choices: [
              { text: "I could get it for you.", next: "offer" },
              { text: "(Back.)", next: "start" }
            ]
          },
          offer: {
            text: "He studies you. “Pharmacy on Grand River. Dong knows me.” A long pause. “If you do that, I'll owe you. I don't like owing people.”",
            menu: "start"
          },
          insulin: {
            text: "Adam's eyes go to the white pharmacy bag before they go to you.",
            choices: [
              { text: "Here. Dong says you're an idiot.", next: "give" },
              { text: "Not yet." }
            ]
          },
          give: {
            text: "He takes it with both hands. For a second he looks like someone else, someone younger and much more scared. Then the other face comes back. “Bunker's rated for four,” he says. “I counted. With me, that's three more.”",
            effects: { take: "insulin", flag: ["dale_open", "dale_has_insulin"] },
            next: "open"
          },
          open: {
            text: [
              "Adam has the hatch open. A ladder goes down into the white light of LEDs.",
              { if: { party: ["<=", 3] }, text: "“Room for you,” he says, counting the people with you. “Get in.”" },
              { if: { party: [">", 3] }, text: "He counts the people with you twice. “Four. I said four. I'm sorry. I mean that, and it's still four.”" }
            ],
            again: [
              "The hatch is open. Adam waits beside it.",
              { if: { party: [">", 3] }, text: "“Still four,” he says." }
            ],
            choices: [
              { text: "Go down the ladder.", if: { party: ["<=", 3] }, effects: [
                { if: { with: "ruth" }, text: "Steven looks down the ladder. “Forty-four rules,” he says. “I'll want a pen.” He goes first, one step at a time." },
                { ending: "bunker" }
              ] },
              { text: "Go down without the others.", if: { party: [">", 3] }, effects: { flag: "left_people", dismiss: true, ending: "bunker" } },
              { text: "Shove him off the hatch and seal it from inside.", effects: { ending: "locked_out" } },
              { text: "Not yet." }
            ]
          }
        }
      }
    },

    tran: {
      name: "Officer Ian", aliases: ["officer", "ian", "officer ian", "police", "cop"],
      dossier: { age: "30s", role: "Officer, Novi Police", status: "Directing traffic by hand at Ten Mile and Taft." },
      portrait: { prop: "cap" },
      room: "hub",
      here: "Officer Ian works the intersection with both arms.",
      desc: "Novi PD. Reflective vest, whistle, the steadiest hands in the city.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "Officer Ian doesn't stop moving his hands. “Can't talk. Go home. Basement. Stay off the roads.”",
            choices: [
              { text: "Is there anywhere official to go?", next: "official" },
              { text: "Okay." }
            ]
          },
          official: {
            text: "“Civic Center's coordinating, east on Ten Mile. But if you have a basement, you already have the best thing they can give you.” He waves a minivan through. “Get inside. Stay inside. Stay tuned. Go.”",
            effects: { flag: "knows_get_inside" }
          }
        }
      }
    },

    phil: {
      name: "Kyle", aliases: ["kyle", "emergency manager", "man with binder", "windbreaker"],
      dossier: { age: "60s", role: "Novi Emergency Management", status: "Operating from a plan revised in 1962." },
      portrait: { prop: "binder" },
      room: "civic",
      here: "Kyle, Emergency Management, stands on a folding table with his binder.",
      desc: "Laminated badge, windbreaker, the 1962 binder.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "Kyle climbs down off the table. “Go ahead. Quick.”",
            choices: [
              { text: "What's the plan?", next: "plan" },
              { text: "When does the fallout get here?", next: "when" },
              { text: "Never mind." }
            ]
          },
          plan: {
            text: "He opens the binder. “Plan says: proceed to designated fallout shelter. Designated shelters are listed on page forty.” He turns to page forty. “The first one is a department store that closed in 1998. The second one is a bank that's now a mattress store. The third one is—” He closes the binder. “The plan is: get inside, stay inside, stay tuned. That part has held up.”",
            effects: { flag: "knows_get_inside" },
            menu: "start"
          },
          when: {
            text: "“Detroit's plume is going east, over Windsor. That's the wind, and the wind is luck. What worries us is everything they hit west of here: Chicago, maybe farther. The weather service on the radio says tonight, after dark. He wouldn't give a time.” Kyle rubs his face. “I didn't like how he didn't give a time.”",
            effects: { flag: "knows_deadline" },
            menu: "start"
          }
        }
      }
    },

    marsh: {
      name: "Lieutenant Hunter", aliases: ["hunter", "lieutenant", "lt hunter", "fire lieutenant", "firefighter"],
      dossier: { age: "40s", role: "Lieutenant, Novi Fire Department", status: "Running triage at the Civic Center." },
      portrait: { prop: "helmet" },
      room: "civic",
      here: "Lieutenant Hunter of the fire department moves through the crowd with a radio on each shoulder.",
      desc: "Ash on his sleeves. He hasn't sat down since noon and won't until tomorrow.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“If you're hurt, the line's there. If you're not, I need you to be useful or I need you to go home.”",
            again: "Hunter glances at you. “Still useful?”",
            choices: [
              { text: "I'll be useful.", next: "useful" },
              { text: "Where are all these people coming from?", next: "where" },
              { text: "I'll go." }
            ]
          },
          useful: {
            text: "“High school, east of here. They've got a couple hundred people in the gym, and the gym roof is all skylights. Tell Coach Connor I said to get them below grade. The music wing has a basement. I can't spare anyone to walk over there.”",
            effects: { flag: "marsh_message" },
            menu: "start"
          },
          where: {
            text: "“Dearborn. Southfield. Detroit, the ones who could walk. Burns, mostly. Glass. Eyes. A lot of them looked at it.” He doesn't look at you while he says it. “We're sending the worst cases to the hospital, and the hospital's full.”",
            menu: "start"
          }
        }
      }
    },

    dana: {
      name: "Coach Connor", aliases: ["coach", "connor", "coach connor", "gym teacher"],
      dossier: { age: "30s", role: "PE and health teacher, Novi High", status: "In charge of 200 people since 12:30." },
      portrait: { prop: "whistle" },
      room: "school",
      here: "",
      desc: "PE and health teacher. Whistle, clipboard, a Novi Wildcats hoodie. Two hours ago someone handed him the gym keys, and here he is.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“If you're here to shelter, sign in with the—” He sees you're not carrying a bag. “Never mind. What do you need?”",
            again: "Coach Connor looks up from the clipboard. “What've you got?”",
            choices: [
              { text: "Steven, tell him what you told me.", if: { with: "ruth", notFlag: "dana_convinced" }, next: "ruth" },
              { text: "Lieutenant Hunter sent me. He says get everyone below grade, into the music wing basement.", if: { flag: "marsh_message", notFlag: "dana_convinced", without: "ruth" }, next: "marsh" },
              { text: "The band room, under the music wing. No windows, below grade. It's the best shelter in the building.", if: { flag: "knows_bandroom", notFlag: ["dana_convinced", "marsh_message"], without: "ruth" }, next: "bandroom" },
              { text: "Everyone needs to get out of this gym.", if: { notFlag: ["dana_convinced", "knows_bandroom", "marsh_message"] }, next: "nope" },
              { text: "What do you need?", next: "needs" },
              { text: "I brought water.", if: { var: ["water", ">=", 1], notFlag: "school_water" }, next: "water" },
              { text: "I brought plastic sheeting and tape for the stairwell windows.", if: { has: "sheeting", notFlag: "school_sheeting" }, next: "sheeting" },
              { text: "I brought food. A dozen coneys.", if: { has: "coneys", notFlag: "school_food" }, next: "food" },
              { text: "I'll be back." }
            ]
          },
          ruth: {
            text: "Steven tells him. It takes ninety seconds. Mass, depth, distance from the roof. The band room, which Steven inspected in 1971. Coach Connor listens with his whole face. Then he says, “Steven? From Willow Glen? You ran the drills when my mom was in school.” He lifts the whistle, which is the most useful sound in the world. “EVERYBODY! We're moving! Grab your stuff, follow the cones, music wing stairs!”",
            effects: { flag: ["dana_convinced", "ruth_at_school"] },
            menu: "start"
          },
          marsh: {
            text: "“Hunter said that?” He doesn't wait for an answer. “Okay. Okay.” He lifts the whistle. “EVERYBODY! We're moving! Music wing stairs. Bring your stuff. Leave the cots.”",
            effects: { flag: "dana_convinced" },
            menu: "start"
          },
          bandroom: {
            text: "“How do you know that?” “Steven, at Willow Glen. He inspected it in 1971.” Connor stares at you. “Steven ran the drills when my mom was in school.” He lifts the whistle. “EVERYBODY! We're moving!”",
            effects: { flag: "dana_convinced" },
            menu: "start"
          },
          nope: {
            text: "“And go where? Show me somewhere better, and I'll move two hundred people there. Until then, I've got a gym and a whistle.”",
            menu: "start"
          },
          needs: {
            text: [
              "He ticks it off on his fingers.",
              { if: { notFlag: "dana_convinced" }, text: "“Somewhere better than a gym.”" },
              { if: { notFlag: "school_water" }, text: "“Water. The fountains died when the city water did. We've got juice boxes from the cafeteria and that's it.”" },
              { if: { notFlag: "school_sheeting" }, text: "“Something to cover broken windows. Plastic. Tape.”" },
              { if: { flag: ["dana_convinced", "school_water", "school_sheeting"] }, text: "“Honestly? Somebody to close the door. I can't make myself do it.”" }
            ],
            menu: "start"
          },
          water: {
            text: "His volunteers carry it down. “That's two days for the kids, if we're careful. We'll be careful.”",
            effects: { add: { water: -1 }, flag: "school_water" },
            menu: "start"
          },
          sheeting: {
            text: "Two dads and a custodian go up the stairwell with the sheeting and tape. Ten minutes later, the landing windows are sealed. “It's not pretty,” the custodian says. It isn't, but it's done.",
            effects: { take: "sheeting", flag: "school_sheeting", time: 5 },
            menu: "start"
          },
          food: {
            text: "“Coneys.” Connor laughs for the first time in hours. “That's the most Michigan thing that's happened all day.” The bag disappears into a crowd of kids.",
            effects: { take: "coneys", flag: "school_food" },
            menu: "start"
          }
        }
      }
    },

    ruth: {
      name: "Steven", aliases: ["steven", "man in cardigan", "old man", "crossword guy"],
      dossier: { age: "88", role: "Oakland County civil defense, 1961–1974", status: "Calm. Correct. Doing yesterday's crossword." },
      portrait: { prop: "cardigan" },
      room: "retirement",
      here: "",
      desc: "Eighty-eight. Cardigan, reading glasses on a beaded chain, a crossword in pen. From 1961 to 1974, he ran civil defense shelter drills for Oakland County.",
      talk: {
        start: [
          { if: { with: "ruth" }, node: "walking" },
          { node: "start" }
        ],
        nodes: {
          start: {
            text: "He finishes a word in the crossword before he looks up. “You're not staff,” he says. “Good. Staff keeps telling me to stay calm. I am calm. I've been waiting sixty years for this, professionally.” He glances at the front doors. “Elizabeth locks those at four. If you want something from me, want it soon.”",
            again: "Steven caps his pen. “Yes, dear?”",
            choices: [
              { text: "What should people actually do?", next: "basics" },
              { text: "Where's the safest place in Novi?", next: "where" },
              { text: "How do I get water once the pressure's gone?", next: "water" },
              { text: "What's the crossword?", next: "crossword" },
              { text: "Come with me. The high school needs you.", if: { notFlag: "ruth_left", before: "4:00 PM" }, next: "join" },
              { text: "Come with me. The high school needs you.", if: { notFlag: "ruth_left", after: "4:00 PM" }, next: "locked" },
              { text: "I have to go." }
            ]
          },
          basics: {
            text: "“Get inside. Stay inside. Find the middle of the deepest building you can. Concrete, brick, dirt: put mass between you and the outside. Fallout is dust, dear. It's dangerous because it lands on things, and the things are next to you. The first day is the worst. Seven hours after the bomb, it's about a tenth as strong as it was. Two days after, about a hundredth. After two weeks, you can mostly come out.” He taps the pen. “Everyone wants to drive somewhere. The worst place to be is in a car, in traffic, when it starts coming down.”",
            effects: { flag: ["knows_shelter_basics", "knows_get_inside"] },
            menu: "start"
          },
          where: {
            text: "“The high school. Not the gym, that's a box of skylights. The band room, under the music wing. I inspected it in 1971, when they built that wing. No windows, below grade, one door. Whoever's in charge over there will have put everyone in the gym, because that's where you put people.”",
            effects: { flag: "knows_bandroom" },
            menu: "start"
          },
          water: {
            text: "“Your water heater. Forty or fifty gallons of clean water in every basement in this town, and nobody thinks of it. Turn off the gas first. Close the cold inlet. Open a hot tap, up the stairs or down the hall, so it doesn't vacuum-lock, then open the drain at the bottom. And bring a flashlight. That valve is always somewhere stupid. And fill your bathtub while you still can, if you still can.”",
            effects: { flag: "knows_waterheater" },
            menu: "start"
          },
          crossword: {
            text: "“Today's puzzle was printed yesterday. The theme is Summer Vacation.” He shows you the grid, almost finished. “I'm completing it out of spite.”",
            menu: "start"
          },
          join: {
            text: "“I thought you'd never ask.” He caps the pen, folds the crossword and leaves it on the chair. “I walk slowly. Don't hover.” On the way out he tells Elizabeth, the aide, to keep everyone in the interior hallway, sitting on the floor, away from the doors. Elizabeth looks like she might cry with relief.",
            effects: { join: "ruth", flag: "ruth_left" }
          },
          locked: {
            text: "“Elizabeth locked the doors at four, dear, and she's right to.” Steven looks down the hallway at sixty people sitting on the floor. “Besides. Somebody here has to know what they're doing.”",
            menu: "start"
          },
          walking: {
            text: "Steven walks with his hand on your arm. He is not using it for balance. He's using it to steer you.",
            choices: [
              { text: "What should people actually do?", next: "basics" },
              { text: "Where's the safest place in Novi?", next: "where" },
              { text: "How do I get water once the pressure's gone?", next: "water" },
              { text: "Keep walking." }
            ]
          }
        }
      }
    },

    jess: {
      name: "Mady", aliases: ["mady", "bride", "the bride"],
      dossier: { age: "28", role: "Bride", status: "Ceremony at 1:15 PM, as planned." },
      portrait: { prop: "veil" },
      room: "church",
      present: { notFlag: ["witnessed", "wedding_over"] },
      here: "",
      desc: "The bride. Mascara under one eye, a voice that could command a regiment.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“Are you a guest?” The bride looks you over. “Doesn't matter. Are you over eighteen and not related to either of us?”",
            choices: [
              { text: "...Yes?", next: "witness" },
              { text: "Why are you still doing this?", next: "why" },
              { text: "Sorry. Wrong church." }
            ]
          },
          witness: {
            text: [
              "“Great. Our best man was driving in from Corktown.” She takes a breath and lets it out.",
              { if: { before: "1:15 PM" }, text: "“Father Andrew starts at one-fifteen, with or without him. We need two witnesses to sign the license, and Father Andrew says the State of Michigan still exists until he hears otherwise. Will you sign?”" },
              { if: { after: "1:15 PM" }, text: "“Father Andrew started at one-fifteen, with or without him. We need two witnesses to sign the license, and Father Andrew says the State of Michigan still exists until he hears otherwise. Will you sign?”" }
            ],
            choices: [
              { text: "I'll sign.", time: 20, pre: { flag: "witnessed" }, next: "signed" },
              { text: "I can't. I'm sorry.", effects: { text: "“Then go,” she says, not unkindly. “We're doing this.”" } }
            ]
          },
          signed: {
            text: "It takes twenty minutes. Ryan's hands shake through his vows. Mady's don't. Father Andrew pronounces them married, and the forty guests clap too long, because nobody wants to be the first to stop. You sign the license on the cake table with a pen from a bank that isn't there anymore. Afterward, Mady finds you. “There's water under the cake table. Six cases. We're not having a reception.” She puts a case in your arms, then another. “Take them somewhere they'll do some good. We're going downstairs.”",
            effects: { add: { water: 2 }, flag: "witnessed", set: { wedAt: "{weddingTime}" } }
          },
          why: {
            text: "“Because we booked it eleven months ago. Because my grandma's here, and she's ninety-one, and she drove herself. Because if this is the last thing we do, then it's the last thing we do, and I'm not spending it in a basement next to Ryan's cousin Charlie.” She looks back toward the altar. “We'll go downstairs after. Father Andrew says the church basement is solid. We're just doing this first.”",
            menu: "start"
          }
        }
      }
    },

    lou: {
      name: "Chris", aliases: ["chris", "manager", "cashier", "hardware guy"],
      dossier: { age: "60s", role: "Owner, hardware store, since 1985", status: "Cash only. No returns." },
      portrait: { prop: "glasses" },
      room: "hardware",
      here: "",
      desc: "Sixties, reading glasses on a chain, a paper-roll calculator. He has owned this store since 1985 and plans to own it through whatever this is.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: [
              "“Cash only. No returns. What do you need?”",
              { if: { var: ["cash", ">", 0] }, text: "(You have ${cash}.)" }
            ],
            choices: [
              { text: "Plastic sheeting and duct tape. ($25)", if: { var: ["cash", ">=", 25], lacks: "sheeting" }, effects: { add: { cash: -25 }, give: "sheeting", text: "Chris rings it up by hand. “Six-mil. Don't let anybody tell you it stops radiation. It stops dust, and dust is the problem.”" }, next: "start" },
              { text: "A siphon pump. ($15)", if: { var: ["cash", ">=", 15], lacks: "siphon" }, effects: { add: { cash: -15 }, give: "siphon", text: "“Newer cars have screens in the filler neck,” Chris says. “Find something old.”" }, next: "start" },
              { text: "A battery radio. ($30)", if: { var: ["cash", ">=", 30], lacks: "radio" }, effects: { add: { cash: -30 }, give: "radio", text: "“Last one. Batteries included, which is the only reason anybody's buying it.”" }, next: "start" },
              { text: "I don't have enough cash.", if: { var: ["cash", "<", 15], notFlag: "chris_iou", any: [{ lacks: "sheeting" }, { lacks: "siphon" }] }, next: "iou" },
              { text: "Can I return this?", once: true, next: "returns" },
              { text: "That's all." }
            ]
          },
          iou: {
            text: "“Then I can't help you.” He looks at you over his glasses for a long second. Then he tears a strip off his paper roll, writes {name} and IOU. “Cedar Hollow? Rob's subdivision? God help you. One thing. Pay me when the banks remember who you are.”",
            choices: [
              { text: "Plastic sheeting and duct tape.", if: { lacks: "sheeting" }, effects: { give: "sheeting", flag: "chris_iou", text: "Chris slides the roll across. “Six-mil. Don't let anybody tell you it stops radiation. It stops dust, and dust is the problem.”" }, next: "start" },
              { text: "A siphon pump.", if: { lacks: "siphon" }, effects: { give: "siphon", flag: "chris_iou", text: "“Newer cars have screens in the filler neck,” Chris says. “Find something old.”" }, next: "start" },
              { text: "Never mind." }
            ]
          },
          returns: {
            text: "“No.” He doesn't even look at it.",
            menu: "start"
          }
        }
      }
    },

    osei: {
      name: "Dong", aliases: ["dong", "pharmacist"],
      dossier: { age: "50s", role: "Pharmacist", status: "Filling prescriptions by flashlight." },
      portrait: { prop: "flashlight" },
      room: "pharmacy",
      here: "",
      desc: "The pharmacist. Mid-fifties, flashlight in his teeth half the time. He knows every regular by name and every prescription by heart.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "Dong looks up from his paper log. “One packet per family. Read the insert. If you're here for something else, it's going to be slow.”",
            again: "“Yes?” He's already looking past you at the line.",
            choices: [
              { text: "What does potassium iodide actually do?", next: "ki" },
              { text: "Can I get a packet?", if: { notFlag: "got_ki" }, next: "packet" },
              { text: "I'm here for Adam's insulin.", if: { flag: "knows_dale_insulin", notFlag: "got_insulin" }, next: "insulin" },
              { text: "Thanks." }
            ]
          },
          ki: {
            text: "“It fills your thyroid with safe iodine so it can't absorb the radioactive kind. That's all. It doesn't protect anything else. It doesn't stop fallout. It's not a force field.” He nods at the line. “Half of them think it's a force field. Take it only when health officials tell you to. Walls are what protect you.”",
            effects: { flag: "knows_ki" },
            menu: "start"
          },
          packet: {
            text: "He tears one off a box and initials his log. “Read the insert.”",
            effects: { give: "ki_pills", flag: "got_ki" },
            menu: "start"
          },
          insulin: {
            text: "“Adam.” He flips back three pages. “Cedar Hollow Adam. He's ignored my reminders for three weeks.” He takes a white bag out of the battery-powered fridge, writes something on a sticky note and staples it to the bag. “Keep it cool. Tell him he's an idiot. From me.”",
            effects: { give: "insulin", flag: "got_insulin" },
            menu: "start"
          }
        }
      }
    },

    toula: {
      name: "Greta", aliases: ["greta", "owner", "cook"],
      dossier: { age: "60s", role: "Owner, Coney Island (family-run since 1968)", status: "Feeding everyone. Charging no one." },
      portrait: { prop: "hairnet" },
      room: "diner",
      here: "",
      desc: "Sixties, hairnet, forearms like a stevedore's. Her father opened this place in 1968.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“Sit, sit. Eat. Nobody's paying today, so don't try. I'm open till six, then I'm going home like a sensible person.” Greta puts a coney in front of you that you didn't order.",
            again: "Greta points her ladle at you. “You again. Eat something.”",
            choices: [
              { text: "What's the news saying?", next: "news" },
              { text: "Can I take some food to go?", if: { notFlag: "got_coneys" }, next: "togo" },
              { text: "Why are you still open?", next: "why" },
              { text: "Who in town actually knows what to do?", next: "who" },
              { text: "Thanks, Greta." }
            ]
          },
          news: {
            text: NEWS,
            effects: { flag: "knows_get_inside" },
            menu: "start"
          },
          togo: {
            text: "“Take a dozen. They're good cold.” They're not, but she says it with such conviction that you nod.",
            effects: { give: "coneys", flag: "got_coneys" },
            menu: "start"
          },
          why: {
            text: "“My father opened this place in '68. He said a town needs one place where the lights are on.” She looks at the generator cord running out the back door. “So. The lights are on.”",
            menu: "start"
          },
          who: {
            text: "“Steven. Over at Willow Glen, south of Ten Mile. He ran civil defense in this county when Kennedy was president. He used to come in and correct the fallout shelter sign on our basement door.” Greta shrugs. “We don't have a basement anymore. We had it filled in in '04. Steven was very disappointed in us.”",
            effects: { flag: "heard_of_ruth" },
            menu: "start"
          }
        }
      }
    },

    trent: {
      name: "the man in the Lions windbreaker", aliases: ["man", "trent", "lions", "windbreaker", "man with cart", "guy"],
      dossier: { age: "40s", role: "Unknown", status: "Armed. Guarding eight cases of water." },
      portrait: { prop: "hood" },
      room: "grocery",
      present: { notFlag: "trent_gone" },
      here: "",
      desc: "Forties. A Lions windbreaker over a work polo with a dealership logo. His hand rests on his belt and doesn't move.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“Keep walking.” He doesn't look at your face. He looks at your hands. “I'm out of here at three, and so is this water.”",
            again: "“I said keep walking.”",
            choices: [
              { text: "I'll trade you for one case. A potassium iodide packet.", if: { has: "ki_pills" }, next: "ki" },
              { text: "I'll trade you for one case. A dozen coneys.", if: { has: "coneys" }, next: "coneys" },
              { text: "Grab a case off his cart and run.", next: "grab" },
              { text: "Okay. I'm going." }
            ]
          },
          ki: {
            text: "His face changes. “They're out at the pharmacy.” He takes the packet and hands you a case of water without looking at it.",
            effects: { take: "ki_pills", add: { water: 1 } },
            choices: [
              { text: "You should know it only protects your thyroid. It's not—", if: { flag: "knows_ki" }, next: "truth" },
              { text: "(Leave.)", effects: { flag: "trent_gone" } }
            ]
          },
          truth: {
            text: "“It's what they're telling people to get,” he says. Then, quieter: “I have two girls. It's what they're telling people to get.” He pushes the cart toward the doors.",
            effects: { flag: "trent_gone" }
          },
          coneys: {
            text: "He looks at the foil bag for a long time. “My girls haven't eaten since breakfast.” He takes it and sets a case of water at your feet. He doesn't say thank you, and that's fine.",
            effects: { take: "coneys", add: { water: 1 }, flag: "trent_gone" }
          },
          grab: {
            effects: { death: "You get both hands on a case. He's faster than he looks, and he was never bluffing. The last thing you see is the price tag on the empty shelf beside you: SPRING WATER 24PK $4.99." }
          }
        }
      }
    },

    deshawn: {
      name: "Derek", aliases: ["derek", "guard", "security", "security guard"],
      dossier: { age: "24", role: "Mall security", status: "Waiting for someone to tell him he's right." },
      portrait: { prop: "cap" },
      room: "mall",
      here: "Derek, mall security, stands by the directory looking like he's waiting for someone to tell him he's right.",
      desc: "Twenty-four. Mall security polo, radio with no one on the other end.",
      talk: {
        start: "start",
        nodes: {
          start: {
            text: "“You work here? No? Okay.” He rubs his neck. “Management said center court. Then management went home.”",
            choices: [
              { text: "This atrium is all glass. Everyone needs to move somewhere solid.", if: { notFlag: "warned_mall" }, next: "warn" },
              { text: "Good luck, Derek." }
            ]
          },
          warn: {
            text: [
              { if: { flag: "knows_shelter_basics" }, text: "You tell him what Steven told you: mass, concrete, the middle of things. The service corridors behind the stores are cinderblock, with no windows. The lowest level of the parking structure is under three floors of concrete. He listens like it's the first sensible thing he's heard all day, which it might be. Then he climbs onto the edge of the fountain, cups his hands, and starts moving a thousand people." },
              { if: { notFlag: "knows_shelter_basics" }, text: "“Move where? Out there?” He isn't wrong that you don't have an answer. Somebody who knew what they were talking about could tell him." }
            ],
            effects: { if: { flag: "knows_shelter_basics" }, flag: "warned_mall" }
          }
        }
      }
    },

    haddads: {
      name: "Mary and Jose", aliases: ["mary", "jose", "woman", "boy", "mom", "kid", "family"],
      dossier: { age: "34 / 9", role: "ER nurse and son, from Dearborn", status: "Car out of gas on the I-96 shoulder." },
      portrait: { prop: "pair" },
      count: 2,
      room: "interchange",
      present: { notFlag: "haddads_walked" },
      here: "",
      desc: "Mary, thirties, scrubs under a cardigan. Her son Jose, nine, holds a phone with no service and plays a game on it anyway, sound off.",
      talk: {
        start: [
          { if: { with: "haddads" }, node: "walking" },
          { node: "start" }
        ],
        nodes: {
          start: {
            text: "The woman stands when you come down the embankment and puts herself between you and the boy. “We're fine.” They're not. The car is out of gas. Dearborn plates. “If nobody stops by four, we walk.”",
            again: "Mary watches you come back. “Still fine,” she says, less firmly.",
            choices: [
              { text: "Where are you trying to go?", next: "where" },
              { text: "Come with me. I know somewhere safer than a car.", next: "join" },
              { text: "Good luck." }
            ]
          },
          where: {
            text: "“My sister's in Grand Rapids. We left at twelve-thirty. We've gone eleven miles.” She laughs, the wrong kind of laugh. “Jose's dad works at the plant in Dearborn. Worked. Works.” She stops. Jose keeps playing his game.",
            menu: "start"
          },
          join: {
            text: "Mary looks at you for a long time, the way you'd look at a used car. Then at the freeway. Then at Jose. “Jose. Get your backpack.”",
            effects: { join: "haddads", flag: "haddads_moved" }
          },
          walking: {
            text: "Mary keeps one hand on Jose's backpack strap. Jose asks if there will be Wi-Fi where you're going, and then says “never mind,” very quietly, before anyone can answer.",
            choices: [
              { text: "We're almost there.", effects: { text: "“Okay,” Jose says." } },
              { text: "Keep walking." }
            ]
          }
        }
      }
    },

    kyle: {
      name: "Brendan", aliases: ["brendan", "boss", "manager"],
      dossier: { age: "30s", role: "Your manager", status: "Q3 deck due 5:00 PM. Still." },
      portrait: { prop: "laptop" },
      room: "office",
      here: "",
      desc: "Your manager. Quarter-zip, AirPods in with nothing playing, a laptop on an orange extension cord.",
      talk: {
        start: [
          { if: { with: "kyle" }, node: "walking" },
          { node: "start" }
        ],
        nodes: {
          start: {
            text: "Up on three, in Conference Room B: “There you are, {name}.” Brendan, your manager, is in a quarter-zip, his laptop plugged into an orange extension cord that runs down three flights of stairs to a generator. “Regional still wants the Q3 review. I know. I know. But when this is over, they're going to look at who showed up.”",
            again: "Brendan doesn't look up from the laptop. “Slide twelve. Whenever you're ready.”",
            choices: [
              { text: "Brendan. They bombed Detroit.", next: "detroit" },
              { text: "Come with me. You can't stay up here in a glass building.", next: "come" },
              { text: "Fine. Let's finish the deck.", next: "deck" },
              { text: "I'm leaving." }
            ]
          },
          detroit: {
            text: "“I'm aware.” He waves at the window. “I'm aware, okay? But what am I supposed to do, sit at home and think about it?” His laptop chimes low battery, even though it's plugged in. He jiggles the cord. You realize he hasn't been home. You realize there's nobody at home for him to go to.",
            menu: "start"
          },
          come: {
            text: [
              { if: { flag: "knows_shelter_basics" }, text: "You tell him, as plainly as Steven told you: the glass, the dust, two weeks, the middle of something solid. You tell him nobody from Regional is coming. Brendan looks at the laptop for a long moment. Then he closes it, unplugs it, winds the orange cord around his arm out of habit, and follows you down the stairs." },
              { if: { notFlag: "knows_shelter_basics" }, text: "“After the deck,” he says. He means it. He's going to be up here when it gets dark. You don't know enough to argue with him, not in a way that would work." }
            ],
            effects: { if: { flag: "knows_shelter_basics" }, join: "kyle" }
          },
          deck: {
            effects: { ending: "business_as_usual" }
          },
          walking: {
            text: "Brendan walks beside you, still holding his laptop like a hymnal. “I could have finished slide twelve,” he says. Then: “Thanks.”",
            choices: [{ text: "Keep walking." }]
          }
        }
      }
    }
  },

  // ==========================================================================
  //  USES — "use X", "use X on Y", "give X to Y"
  //  item: item id(s). on: words for the target. to: a person id. in: room(s).
  // ==========================================================================
  uses: [
    {
      item: "siphon", on: ["car", "cars", "impala", "abandoned car", "abandoned cars", "gas tank", "tank"], in: "interchange",
      if: { has: "gas_can" }, time: 15,
      effects: { take: "gas_can", give: "gas_can_full", text: "The first three cars have anti-siphon screens in the filler neck. The fourth is the rusted Impala with the missing gas cap, and it gives you five gallons and a mouthful of gasoline you'll taste for a week. Nobody on the overpass tries to stop you. Two people ask if you're done with the pump." },
      fail: "You'd need something to put the gas in."
    },
    {
      item: "gas_can", on: ["car", "cars", "impala", "abandoned car", "tank"], in: "interchange",
      fail: "You'd need a siphon pump to get the gas out. The hardware store might have one."
    },
    {
      item: "sheeting", on: ["window", "window well", "well"], in: "basement",
      if: { notFlag: "basement_window_sealed" }, time: 10,
      effects: { take: "sheeting", flag: "basement_window_sealed", text: "You cut the sheeting to size with kitchen scissors and tape the window well shut, edge over edge. Then you pile Christmas bins against the wall beneath it, because Steven would want mass, and the ceramic village is the mass you've got." }
    },
    {
      item: "sheeting", on: ["window", "windows", "stairwell", "landing"], in: "school",
      fail: "Better to give it to Coach Connor. His people know the building."
    },
    { item: "radio", effects: { flag: "knows_get_inside", text: NEWS }, time: 2 },
    { item: "insulin", to: "dale", fail: "Talk to Adam." },
    {
      item: "coneys", effects: { text: "You eat one. It's cold and greasy and good, and you feel guilty about it, and then you don't." }
    },
    {
      item: "ki_pills", effects: { text: "You read the insert again instead. Take only when advised by public health officials. Nobody has advised anything. You put it away." }
    },
    { item: "flashlight", effects: { text: "Click. It works. You turn it off to save the batteries." } },
    { item: "cellphone", effects: { text: [
      { if: { notFlag: "cells_dead" }, text: "SOS ONLY. You try to call your sister. The call fails before it rings. You try a text. A red exclamation point." },
      { if: { flag: "cells_dead" }, text: "NO SERVICE. Your thumb opens the group chat anyway. Nobody has said anything since 12:09." }
    ] } },
    { item: "bicycle", effects: { text: "You're already walking it everywhere you go. (Moving is faster with the bike, unless you're walking with someone.)" } }
  ],

  // Commands that work anywhere (when their `if` is true).
  actions: [
    { say: ["listen to radio", "listen radio", "turn on radio", "radio", "listen to news"], if: { has: "radio" }, time: 2, effects: { flag: "knows_get_inside", text: NEWS } },
    { say: ["look at cloud", "look at sky", "look up", "cloud", "sky"], effects: { text: [
      { if: { before: "3:00 PM" }, text: "Southeast, the cloud over Detroit has lost its mushroom shape and become a long brown shelf, drifting east toward Canada." },
      { if: { after: "3:00 PM", before: "7:34 PM" }, text: "The sky to the west is clear and blue and completely ordinary. That's where it's going to come from." },
      { if: { after: "7:34 PM" }, text: "Dark. More stars than Novi has seen in fifty years. Nobody looks up for long." }
    ] } },
    { say: ["cry", "scream", "panic", "sit down"], time: 5, effects: { text: "You sit on the curb and let it happen for five minutes. Nobody looks at you twice. Half the people you can see are doing the same thing. Then you get up, because the clock is still running." } }
  ],

  // ==========================================================================
  //  HINTS — the first one whose `if` is true is shown.
  // ==========================================================================
  hints: [
    { if: { notFlag: ["bathtub_full", "water_off"], in: "kitchen" }, text: "The front door is open. Jeff's garage is across the court, and his radio is on." },
    { if: { notFlag: "knows_get_inside", before: "1:00 PM" }, text: "Jeff's radio might know what's going on. His garage is north of your house, across the court." },
    { if: { after: "12:45 PM", before: "1:45 PM", notFlag: ["witnessed", "wedding_over"] }, text: "There's a wedding at St. Clare's, west of Ten Mile and Taft. By 1:45 the whole party goes downstairs, and the reception's water goes with them." },
    { if: { flag: "truck_fueled", notFlag: "ray_left", without: "ray", before: "5:30 PM", after: "4:15 PM" }, text: "Jeff leaves for the cabin at 5:30, with you or without you." },
    { if: { flag: "knows_dale_insulin", lacks: "insulin", notFlag: "dale_open", before: "4:30 PM" }, text: "Adam needs his insulin. The pharmacy on Grand River closes at 4:30." },
    { if: { after: "3:00 PM", before: "4:00 PM", notFlag: ["haddads_moved", "haddads_walked"] }, text: "Someone is stranded on the I-96 shoulder by the mall. If nobody stops by four, they start walking." },
    { if: { after: "3:15 PM", before: "4:00 PM", notFlag: ["ruth_left", "dana_convinced"] }, text: "Willow Glen locks its doors at four. Whoever you want from there, you need before then." },
    { if: { flag: "dana_convinced", notFlag: "school_sheeting", before: "5:00 PM", after: "3:30 PM" }, text: "The stairwell windows still need covering, and the hardware store closes at 5:00." },
    { if: { flag: "knows_dale_insulin", lacks: "insulin", notFlag: "dale_open" }, text: "Adam needs his insulin. The pharmacy is on Grand River." },
    { if: { notFlag: ["heard_of_ruth", "knows_shelter_basics"] }, text: "Someone in town remembers the last time people prepared for this. Greta at the Coney Island knows everyone, or try Willow Glen, south of Ten Mile." },
    { if: { notFlag: "dana_convinced", flag: "knows_bandroom" }, text: "Coach Connor needs a reason to move two hundred people: Steven himself, a word from the fire department, or the right detail about the building." },
    { if: { flag: "dana_convinced", notFlag: "school_water" }, text: "The band room needs water. The church has more than it needs." },
    { if: { flag: "dana_convinced", notFlag: "school_sheeting" }, text: "The stairwell windows need covering. The hardware store sells sheeting." },
    { if: { flag: "knows_ray_plan", notFlag: "truck_fueled", lacks: "gas_can_full" }, text: "Jeff needs five gallons. The pumps are dead, but the freeway is full of abandoned cars. You'd need a can and a way to get the gas out." },
    { if: { flag: "truck_fueled", notFlag: "saw_gridlock" }, text: "Before you choose a route north, it might be worth seeing what M-5 looks like." },
    { if: { notFlag: ["bathtub_full", "heater_drained"], var: ["water", "<", 1] }, text: "Whatever you do tonight, you'll need water. Your own bathtub, the church, the grocery, the water heater..." },
    { text: "There are several ways through tonight: your own basement, the high school, Adam's bunker, Jeff's truck. Each needs different things. The radio says the fallout comes after dark." }
  ],

  // ==========================================================================
  //  AFTERWARD — shown under every ending: what happened to everyone.
  //  Every line whose `if` is true is shown, in order. {party} = people
  //  sheltering with you, counting you. `ending: "id"` checks which ending.
  // ==========================================================================
  afterword: [
    { if: { not: { ending: ["up_north", "business_as_usual", "locked_out", "shelter_in_place"] } }, text: "SHELTERED WITH YOU: {party}, counting you." },
    { if: { ending: "up_north" }, text: "IN JEFF'S TRUCK: {party}, counting you." },

    { if: { flag: "talked_sister" }, text: "YOUR SISTER IN ARIZONA · Talked to you for four minutes on a landline at 3:05. Worked a double shift that night, and the next." },
    { if: { notFlag: "talked_sister" }, text: "YOUR SISTER IN ARIZONA · Called your landline at 3:05. You weren't there to pick up. She left a voicemail you will listen to forty times." },
    { text: "YOUR SISTER AT STATE · Sheltered in her dorm's basement, then in the steam tunnels under campus. The fallout reached East Lansing an hour before it reached you. She was underground for all of it." },
    { if: { with: "ray" }, text: "JEFF · With you." },
    { if: { ending: "up_north", without: "ray" }, text: "JEFF · Drove you north. He never once went over the speed limit." },
    { if: { not: { ending: "up_north" }, without: "ray", flag: "truck_fueled" }, text: "JEFF · Drove north alone at 5:30 with the gas you found him." },
    { if: { not: { ending: "up_north" }, without: "ray", notFlag: "truck_fueled" }, text: "JEFF · Rode it out in his garage with the radio on, waiting to hear the words Royal Oak." },

    { if: { with: "ruth", not: { ending: "shelter_in_place" } }, text: "STEVEN · With you." },
    { if: { with: "ruth", ending: "shelter_in_place" }, text: "STEVEN · Ran the band room. Officially, Coach Connor did." },
    { if: { without: "ruth", visited: "retirement" }, text: "STEVEN · Sat on the floor of the Willow Glen hallway and finished yesterday's crossword." },
    { if: { without: "ruth", not: { visited: "retirement" } }, text: "STEVEN · You never met him. He knew exactly what to do, and nobody asked." },

    { if: { with: "haddads" }, text: "MARY AND JOSE · With you." },
    { if: { without: "haddads", visited: "interchange" }, text: "MARY AND JOSE · Last seen walking west on the I-96 shoulder." },
    { if: { without: "haddads", not: { visited: "interchange" } }, text: "MARY AND JOSE · You never met them. They sat on the I-96 shoulder all afternoon, eleven miles from home." },

    { if: { with: "brenda" }, text: "ROB · With you, with the clipboard." },
    { if: { without: "brenda" }, text: "ROB · Finished the check-in. Every name accounted for but one." },

    { if: { ending: "locked_out" }, text: "ADAM · Outside his own hatch." },
    { if: { not: { ending: "locked_out" }, flag: "dale_has_insulin" }, text: "ADAM · In his bunker, with his insulin in the fridge." },
    { if: { not: { ending: "locked_out" }, notFlag: "dale_has_insulin" }, text: "ADAM · Sat on his hatch all night without his insulin." },

    { if: { with: "kyle" }, text: "BRENDAN · With you." },
    { if: { without: "kyle", not: { ending: "business_as_usual" } }, text: "BRENDAN · Stayed in Conference Room B and finished slide 12." },

    { if: { ending: "shelter_in_place" }, text: "THE GYM · All 206 people, safe in the band room." },
    { if: { not: { ending: "shelter_in_place" }, flag: "dana_convinced" }, text: "THE GYM · Moved to the band room. Coach Connor closed the door himself." },
    { if: { notFlag: "dana_convinced", not: { ending: "shelter_in_place" } }, text: "THE GYM · Two hundred people stayed under the skylights." },

    { text: "OFFICER IAN · Directed traffic at Ten Mile and Taft until the last car was through, then went home." },
    { if: { flag: "warned_mall" }, text: "THE MALL · A thousand people moved into the service corridors because Derek, the security guard, told them to." },
    { if: { notFlag: "warned_mall" }, text: "THE MALL · A thousand people sat under the glass atrium. Nobody told them not to." },

    { if: { flag: "witnessed" }, text: "MADY AND RYAN · Married at {wedAt}. Your signature is on the license." },
    { if: { notFlag: "witnessed" }, text: "MADY AND RYAN · Married at 1:45 PM, with a stranger's signature on the license, and went downstairs." }
  ],

  // ==========================================================================
  //  ENDINGS — type is "good", "mixed" or "bad".
  // ==========================================================================
  endings: {

    shelter_in_place: {
      title: "Shelter in Place",
      type: "good",
      text: [
        "Coach Connor looks at you, then at the door, then back at you. You close it. The closer hisses. The latch clicks. It's {time}.",
        "There are two hundred and six people in a room built for sixty kids and their instruments. It smells like valve oil and fear, and by the third day, like everything else.",
        { if: { with: "ruth" }, text: "Steven runs it. Not officially. Connor keeps the clipboard, but by the first night it's Steven who has assigned the latrine buckets to the corner behind the tuba lockers, set the water ration at a cup an hour for kids and two cups a day for everyone else, and started a schedule of who sleeps when. He does it with the calm of a man who inspected this room fifty-five years ago, because he did." },
        { if: { without: "ruth" }, text: "Connor runs it with the whistle and the clipboard and a voice that gets hoarse on the second day and gone on the fourth. Somebody finds a whiteboard marker. Somebody else starts a schedule." },
        { if: { flag: "school_food" }, text: "Greta's coneys get split into thirds and handed to the youngest kids first. A six-year-old says it's the best thing he's ever eaten. Nobody corrects him." },
        { if: { with: "haddads" }, text: "Jose teaches the elementary kids a card game with rules he makes up as he goes. Mary, who turns out to be an ER nurse, rebandages forty people by flashlight." },
        { if: { with: "ray" }, text: "Jeff keeps the radio by his ear, turned down low, and every hour he passes on the news in a voice that makes the bad parts sound survivable." },
        { if: { with: "brenda" }, text: "Rob takes one look at Connor's clipboard and quietly starts a second one. By morning there's a sign-up sheet for the latrine buckets, and nobody argues with it." },
        { if: { with: "kyle" }, text: "Brendan organizes the water rations into a spreadsheet on the back of a fall concert program. It's the best work he's ever done, and nobody from Regional will ever see it." },
        { if: { flag: "warned_mall" }, text: "On day three, a man finds his way down the stairs from the mall, two miles away. He says a security guard named Derek got a thousand people into the service corridors. He wants whoever told Derek to know." },
        { if: { flag: "witnessed" }, text: "You think about Mady and Ryan in the church basement, married four hours before the world ended, and you hope Cousin Charlie is behaving." },
        "On day fourteen, Lieutenant Hunter knocks on the steel door with a borrowed Geiger counter and a face you'll remember for the rest of your life. He says the readings are down. He says, carefully, that outside isn't safe, but it's survivable.",
        "Before anyone goes up the stairs, the band plays: An Evening of American Classics, a month early, missing the whole trumpet section, the tuba played by a freshman who has had eleven lessons. It's the worst performance in the history of Novi High School. Nobody in that room has ever heard anything better."
      ]
    },

    home_base: {
      title: "Home Base",
      // A full tub and a closed door keep you alive. The good version is the one where you also helped someone.
      type: { if: { any: [
        { not: { alone: true } },
        { flag: "witnessed" },
        { flag: "warned_mall" },
        { flag: "dale_has_insulin" },
        { flag: "dana_convinced" },
        { flag: "truck_fueled" },
        { flag: "school_water" },
        { flag: "school_sheeting" },
        { flag: "school_food" }
      ] }, text: "good", else: "mixed" },
      text: [
        "You close the basement door at {time} and stuff a towel along the bottom of it, because that's what you'd do for smoke, and it seems right.",
        { if: { flag: "basement_window_sealed" }, text: "The window well is a gray square of plastic and tape, with the Christmas bins stacked beneath it. Steven would approve. You hope." },
        { if: { notFlag: "basement_window_sealed" }, text: "The window well glows gray all night. You drag the couch to the far wall, away from it, and sleep with your head behind the furnace." },
        { if: { any: [{ flag: "heater_drained" }, { flag: "bathtub_full" }] }, text: "The water lasts. Every cup tastes faintly of pipes and tank, and every cup is a small miracle." },
        { if: { notFlag: ["heater_drained", "bathtub_full"] }, text: "The bottled water lasts eleven days if you're strict, and you are, and the last three days are the longest of your life." },
        { if: { with: "ray" }, text: "Jeff sits in the old recliner with the radio on his knee, turned down low, and listens to the names of places. When it says Royal Oak, he turns it off for a while, and you don't ask, and on the sixth day it says Royal Oak again, differently, and he weeps with his whole body like a kid." },
        { if: { with: "haddads" }, text: "Jose falls asleep on the treadmill every night. Mary doesn't seem to sleep at all. On the fourth day she tells you about Jose's father, all of it, in a flat voice, and then she says thank you, and she means for the basement." },
        { if: { with: "ruth" }, text: "Steven organizes the pantry by expiration date and makes everyone drink water on a schedule. He finishes the crossword. He starts on the back of the cereal box." },
        { if: { with: "brenda" }, text: "Rob reorganizes your pantry and never once mentions Covenant 14. On day nine he says Diane's name out loud for the first time, and then he says it a lot." },
        { if: { with: "kyle" }, text: "Brendan tries to finish the deck on his phone until the battery dies. Then he cries for a long time. Then he's better. He's still a little like this, years later, but he's better." },
        { if: { alone: true }, text: "It's very quiet. You talk to yourself, and then to the furnace, and by day four the furnace is a good listener." },
        { if: { alone: true, before: "1:00 PM" }, text: "You were the first person on Cedar Hollow Court underground. On day fifteen you'll learn what happened to the people who weren't, and you'll spend a long time thinking about the doors you didn't knock on." },
        { if: { without: "brenda" }, text: "On day fifteen, you open the door. The court is gray with a fine dust, like the inside of a vacuum bag. On Rob's porch, weighed down by a rock, his clipboard has every name on the court with a check mark beside it except Diane's, which still has the question mark he crossed out." },
        { if: { with: "brenda" }, text: "On day fifteen, you open the door. The court is gray with a fine dust, like the inside of a vacuum bag. Rob still has the clipboard. Every name on the court has a check mark beside it except Diane's." },
        "Upstairs, the landline is dead. Somewhere, presumably, you are still on hold."
      ]
    },

    up_north: {
      title: "Up North",
      type: "mixed",
      text: [
        { if: { flag: "route_back", before: "5:00 PM" }, text: "The back roads are empty in a way that feels like a secret. Taft to Pontiac Trail, through Walled Lake and Commerce, past lakes with docks and pontoon boats tied up as if it were any Thursday. Jeff drives exactly the speed limit. North of Flint the traffic thins to nothing, and for a few minutes the radio plays an old Motown song from a station somewhere that's still on the air, and nobody in the truck says anything." },
        { if: { flag: "route_back", before: "5:00 PM" }, text: "You reach the cabin at 11:40 PM. Jeff backs the truck into the shed by feel. The root cellar smells like dirt and potatoes and thirty summers. When the fallout reaches Otsego County two days later, lighter than it was downstate, you're already underground, and Jeff is teaching you how to play euchre with a deck that's missing the nine of hearts." },
        { if: { flag: "route_back", after: "5:00 PM" }, text: "The back roads are empty, but you left late. You're past Holly when the light goes orange and then gray. At {fallout}, Jeff's wipers start smearing a fine grit across the windshield. “Windows up. Vents off,” he says, very calmly. He pulls into the first farm with a light on, and a stranger named Sean lets four people he's never met into his basement without asking a single question. You make it to the cabin six days later. You never really thank Sean enough. You try." },
        { if: { flag: "route_m5" }, text: "M-5 doesn't move. In four hours you go seven miles. When the grit starts on the windshield you're in Commerce Township, and Jeff, very calmly, says “Windows up. Vents off,” and gets out to look for any building with a basement. You spend the first two weeks in a church basement in Walled Lake with ninety strangers and one bathroom. Jeff's truck is still on M-5 when you come up. The keys are still in it. So is the coffee can of seeds." },
        { if: { with: "haddads" }, text: "Mary and Jose ride in the back the whole way. In the spring, Mary finally gets through to her sister in Grand Rapids, by ham radio, with Jeff holding the microphone for her because her hands are shaking." },
        { if: { with: "ruth" }, text: "Steven tells Jeff he's driving too slowly the entire way, and Jeff loves him for it." },
        "Jeff turns on the radio every hour, hoping for news of Royal Oak."
      ]
    },

    bunker: {
      title: "Bunker Mentality",
      type: "mixed",
      text: [
        "Adam's bunker is a forty-foot shipping container buried eight feet down, with a second container for supplies and a third that he will only call “Phase Two.” It has LED lights, a composting toilet, an air filtration system with a hand crank, and a laminated sheet of rules, numbered one through forty-four.",
        "RULE 1: NO ONE TOUCHES THE GEIGER COUNTER. RULE 9: WE DO NOT OPEN THE HATCH. RULE 22: QUIET HOURS 2200 TO 0600. NO EXCEPTIONS. RULE 31: THE POWDERED EGGS ARE FOR EMERGENCIES. (THIS IS NOT YET AN EMERGENCY.)",
        { if: { flag: "left_people" }, text: "You think about the people you left at the hatch every time Adam reads Rule 9 out loud, which is every morning. You hear their voices when it's quiet. It's never quiet enough." },
        { if: { with: "ray" }, text: "Jeff and Adam argue about trucks for two weeks, and it might be the thing that keeps both of them sane." },
        { if: { with: "ruth" }, text: "Steven reads all forty-four rules on the first night, then takes out a pen and starts correcting them. Adam lets him. By day ten, there are fifty-one rules, and they're better." },
        { if: { with: "brenda" }, text: "Rob and Adam have been at war over his fence for eleven years. By day three they're co-chairs of the bunker. It's horrifying to watch." },
        { if: { with: "haddads" }, text: "Jose is the only person Adam lets touch the Geiger counter. He shows him how it works for an hour, very seriously, and Mary watches them and doesn't say anything." },
        "Adam is insufferable for fourteen days. He reads aloud from his own laminated binders. He rations toilet paper by the square. He also keeps every single person in that container alive, and on the last night, when he thinks everyone's asleep, you hear him whisper “thank you” to the white pharmacy bag in the fridge.",
        "On day fifteen, Adam opens the hatch. He goes up first. He insists."
      ]
    },

    locked_out: {
      title: "Locked Out",
      type: "bad",
      text: [
        { if: { alone: false }, text: "You put your shoulder into him. He's bigger than you, but he's looking at the people behind you, not at you, and he goes down hard on the lawn. The ladder. The hatch. The wheel lock turns so smoothly. Adam built it well." },
        { if: { alone: true }, text: "You put your shoulder into him. He's bigger than you, but there's nobody behind you, and he isn't looking at you at all. He goes down hard on the lawn. The ladder. The hatch. The wheel lock turns so smoothly. Adam built it well." },
        "His fists on the steel go on for a long time. Then they stop. Then, near dark, they start again, slower.",
        { if: { alone: false }, text: "Nobody who came down the ladder with you will look at you." },
        "You have a year of food. Filters. Seeds. A Geiger counter calibrated by a man you can still hear, if you're quiet enough, and you're always quiet enough.",
        "On the third day, you notice the white pharmacy bag on the floor by the hatch, where he dropped it when you hit him. Keep refrigerated. A sticky note stapled to the top: IDIOT.",
        "You don't open the hatch. It's Rule 9."
      ]
    },

    business_as_usual: {
      title: "Business as Usual",
      type: "bad",
      text: [
        "You sit down. Brendan looks so relieved that it almost makes it worth it.",
        "You fix slide twelve. You build the chart. You argue about whether to call the regional numbers “softness” or “headwinds.” Brendan's generator coughs at {falloutBefore}, and he goes down three flights to fuss with it, and comes back up, and says, “Okay. Where were we.”",
        "At {fallout}, while you're nudging the chart legend two pixels to the left, the light through the windows of Conference Room B goes a little gray, as if a cloud had passed. You don't look up. Neither does Brendan.",
        "Nobody from Regional ever sees the deck.",
        "It is, Brendan says at {falloutAfter}, with the generator still running and the fine gray dust settling on the glass walls of Kessler Office Park, the best work you've ever done."
      ]
    }
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = STORY;
