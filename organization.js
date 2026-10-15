/* Division → battalion → apparatus, from the SFFD Daily Balance Report (day, 10/15/2026).
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
  var ALIASES = {
    "Rescue Captain 1": "RC1", "Rescue Captain 2": "RC2", "Rescue Captain 3": "RC3", "Rescue Captain 4": "RC4",
    "Pilot of Fire Boats": "FB3", "Marine Engineer of Fire Boats": "FB3",
  };
  var where = {};
  DIVISIONS.forEach(function (dv) {
    dv.battalions.forEach(function (bt) {
      bt.apparatus.forEach(function (co) { where[co] = { division: dv, battalion: bt }; });
    });
  });

  root.Organization = {
    DIVISIONS: DIVISIONS,
    // The report's apparatus code for a roster company (or title), e.g. "Rescue Captain 1" -> "RC1".
    apparatus: function (co) { return ALIASES[co] || co; },
    // {division, battalion} for an apparatus code, or null when it isn't in the report.
    locate: function (co) { return where[ALIASES[co] || co] || null; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.Organization;
})(typeof window !== "undefined" ? window : globalThis);
