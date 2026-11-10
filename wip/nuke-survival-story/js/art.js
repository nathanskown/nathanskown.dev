/*
 * ============================================================================
 *  PLEASE HOLD — the town map (side panel).
 *  The animated scene graphics live in js/scenes.js.
 *
 *  Tips:
 *  - Keep each scene about 44 characters wide and 8–10 lines tall.
 *  - Each scene sits between String.raw` and `, so backslashes are safe.
 *    Just don't use a backtick ( ` ) inside one.
 *  - On the map, each room's label appears exactly once, in [BRACKETS].
 *    mapLabels says which label belongs to which room id.
 *  - Open tools/check.html after editing: it warns about missing scenes and
 *    map labels that don't match.
 * ============================================================================
 */
var ART = {

  // The town map. Each [LABEL] must appear exactly once.
  map: String.raw`
      ▲ UP NORTH
  [ON-RAMP]
      │        I-96 · I-275 · I-696
  [OVERPASS]═══════════════════════
      │
    [MALL]───────────[OFFICE]
      │  GRAND RIVER AVE
  ════╪════════════════════════════
  [PHARM]─[STRIP]─[CONEY]
      [HARDWARE] [GROCERY]
            │
  [JEFF] [ADAM]  TAFT RD
    │   ╱   │
  [COURT]───┤
    │       │
  [HOME]    │
    │       │          10 MILE RD
  [BSMT]    │
  [CHURCH]═[10 MILE]═[CIVIC]═[SCHOOL]
            │                  │
        [WILLOW]          [BAND RM]`,

  mapLabels: {
    m5: "ON-RAMP", interchange: "OVERPASS", mall: "MALL", office: "OFFICE",
    pharmacy: "PHARM", strip: "STRIP", diner: "CONEY", hardware: "HARDWARE", grocery: "GROCERY",
    garage: "JEFF", dunmore: "ADAM", street: "COURT", kitchen: "HOME", basement: "BSMT",
    church: "CHURCH", hub: "10 MILE", civic: "CIVIC", school: "SCHOOL",
    retirement: "WILLOW", bandroom: "BAND RM"
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = ART;
