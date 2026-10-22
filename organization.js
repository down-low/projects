/* Division → battalion → apparatus, from the SFFD Daily Balance Report (day, 10/15/2026), and the station each
 * apparatus runs from (STATIONS), from fir-db1's Roster by Station for all 10 battalions (10/21/2026).
 * ALIASES map roster company names to the report's apparatus codes. Divisions marked hidden are left off the dashboard.
 */
(function (root) {
  "use strict";
  var DIVISIONS = [
    { id: "DV02", name: "Division 2", battalions: [
      { id: "BT01", name: "Batt 1", apparatus: ["B01", "E02", "E13", "E28", "E41", "RC1", "T02", "T13"] },
      { id: "BT04", name: "Batt 4", apparatus: ["B04", "E03", "E16", "E38", "E51", "T03", "T16"] },
      { id: "BT05", name: "Batt 5", apparatus: ["B05", "D2", "E05", "E10", "E12", "E21", "T05", "T10", "T12"] },
      { id: "BT07", name: "Batt 7", apparatus: ["B07", "E14", "E22", "E31", "E34", "RC2", "T14"] },
      { id: "BT08", name: "Batt 8", apparatus: ["B08", "E18", "E20", "E23", "E40", "MA1", "T18"] },
    ] },
    { id: "DV03", name: "Division 3", battalions: [
      { id: "BT02", name: "Batt 2", apparatus: ["B02", "E01", "E06", "E29", "E36", "RS1", "T01", "T06"] },
      { id: "BT03", name: "Batt 3", apparatus: ["B03", "E04", "E08", "E35", "E48", "FB3", "HT48", "T04", "T08", "T48"] },
      { id: "BT06", name: "Batt 6", apparatus: ["B06", "D3", "E07", "E11", "E24", "E26", "E32", "RC3", "RS2", "T07", "T11"] },
      { id: "BT09", name: "Batt 9", apparatus: ["B09", "E15", "E19", "E33", "E39", "E43", "RC4", "T15", "T19"] },
      { id: "BT10", name: "Batt 10", apparatus: ["B10", "BE", "E09", "E17", "E25", "E37", "E42", "E44", "T09", "T17"] },
    ] },
    { id: "HQFD", name: "HQFD", hidden: true, battalions: [
      { id: "AO", name: "AO", apparatus: ["VR03", "VR10", "VR20", "VR30", "VR33", "VR40", "VR50"] },
    ] },
  ];
  // Fire station → apparatus housed there (Bureau of Equipment, BE, has no station).
  var STATIONS = {
    1: ["E01", "T01", "RS1"], 2: ["B01", "E02", "T02"], 3: ["E03", "T03"], 4: ["E04", "T04"], 5: ["D2", "E05", "T05"],
    6: ["E06", "T06"], 7: ["D3", "E07", "T07", "RS2"], 8: ["B03", "E08", "T08"], 9: ["B10", "E09", "T09"], 10: ["E10", "T10"],
    11: ["B06", "E11", "T11", "RC3"], 12: ["E12", "T12"], 13: ["E13", "T13", "RC1"], 14: ["E14", "T14"], 15: ["B09", "E15", "T15"],
    16: ["E16", "T16"], 17: ["E17", "T17"], 18: ["E18", "T18"], 19: ["E19", "T19"], 20: ["E20", "MA1"], 21: ["B05", "E21"],
    22: ["E22"], 23: ["E23"], 24: ["E24"], 25: ["E25"], 26: ["E26"], 28: ["E28"], 29: ["E29"], 31: ["B07", "E31", "RC2"],
    32: ["E32"], 33: ["E33"], 34: ["E34"], 35: ["E35", "FB3"], 36: ["B02", "E36"], 37: ["E37"], 38: ["B04", "E38"],
    39: ["E39"], 40: ["B08", "E40"], 41: ["E41"], 42: ["E42"], 43: ["E43", "RC4"], 44: ["E44"], 48: ["E48", "T48", "HT48"],
    51: ["E51"],
  };
  var stationOf = {};
  Object.keys(STATIONS).forEach(function (n) { STATIONS[n].forEach(function (co) { stationOf[co] = +n; }); });
  var ALIASES = {
    "Rescue Captain 1": "RC1", "Rescue Captain 2": "RC2", "Rescue Captain 3": "RC3", "Rescue Captain 4": "RC4",
    "Pilot of Fire Boats": "FB3", "Marine Engineer of Fire Boats": "FB3",
  };
  var where = {}, orderOf = {}, n = 0;
  DIVISIONS.forEach(function (dv) {
    dv.battalions.forEach(function (bt) {
      bt.apparatus.forEach(function (co) { where[co] = { division: dv, battalion: bt }; orderOf[co] = n++; });
    });
  });

  root.Organization = {
    DIVISIONS: DIVISIONS,
    // The report's apparatus code for a roster company (or title), e.g. "Rescue Captain 1" -> "RC1".
    apparatus: function (co) { return ALIASES[co] || co; },
    STATIONS: STATIONS,
    // {division, battalion, station (number or null)} for an apparatus code, or null when it isn't in the report.
    locate: function (co) {
      var c = ALIASES[co] || co, w = where[c];
      return w ? { division: w.division, battalion: w.battalion, station: stationOf[c] || null } : null;
    },
    // Fire station number an apparatus runs from (E05 -> 5), or null.
    station: function (co) { return stationOf[ALIASES[co] || co] || null; },
    // Sort key for an apparatus code in report order (division, battalion, apparatus); unknown codes last.
    order: function (co) { return orderOf[ALIASES[co] || co] != null ? orderOf[ALIASES[co] || co] : 1e6; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.Organization;
})(typeof window !== "undefined" ? window : globalThis);
