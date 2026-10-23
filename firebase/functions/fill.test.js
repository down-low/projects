// Run: node --test firebase/functions/fill.test.js  (no dependencies; uses the real roster in data/)
// Fill open spots (fill.js, admin site): who could fill an open seat on a day.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../fill.js");
const A = require("./alerts");
const rows = require("../../data/positions.json");

// Same day and seats as alerts.test.js: 11EOA13M (FF/Paramedic) works Sat Nov 14 2026; the three OFF FF/Paramedics are
// off; the Lieutenant is off but in another rank group; 01EOA07M works that day.
const SEAT = "11EOA13M", OFF = ["01EOA06M", "11EOA14M", "01EOA08M"], LT = "01EOL02M", WORKING = "01EOA07M";
const DAY = new Date(2026, 10, 14), ISO = "2026-11-14";
const slot = (pos) => rows.find((r) => r.pos === pos);
const mark = (pos, days) => ({ id: "seat-" + pos, pos, days });
function ctx(overtime, extra) {
  const world = A.buildWorld(rows, [], [], extra && extra.recs ? extra.recs : {});
  return Object.assign({ people: Object.values(world.byPos).filter((p) => p.name), opts: world.opts,
    want: F.wantOt(overtime, ISO), hours: F.otHours(overtime, 2026), rules: {}, profiles: {}, today: ISO }, extra || {});
}

test("only people who marked Want OT, in the seat's rank group and off that day", () => {
  const ot = [mark(OFF[0], { [ISO]: { kind: "want" } }), mark(OFF[1], { [ISO]: { kind: "want" } }),
    mark(LT, { [ISO]: { kind: "want" } }), mark(WORKING, { [ISO]: { kind: "want" } }), mark(OFF[2], { "2026-11-15": { kind: "want" } })];
  const got = F.candidates(DAY, slot(SEAT), ctx(ot)).map((x) => x.p.pos).sort();
  assert.deepEqual(got, [OFF[0], OFF[1]].sort());
});

test("fewest Worked OT hours this year first; other years and Want OT marks don't count", () => {
  const ot = [
    mark(OFF[0], { [ISO]: { kind: "want" }, "2026-03-01": { kind: "worked", hours: 24 }, "2026-04-01": { kind: "worked", hours: 12 } }),
    mark(OFF[1], { [ISO]: { kind: "want" }, "2026-05-01": { kind: "worked", hours: 10 }, "2025-05-01": { kind: "worked", hours: 48 } }),
  ];
  const got = F.candidates(DAY, slot(SEAT), ctx(ot));
  assert.deepEqual(got.map((x) => [x.p.pos, x.hours]), [[OFF[1], 10], [OFF[0], 36]]);
});

test("someone with leave that day is left out", () => {
  const ot = [mark(OFF[0], { [ISO]: { kind: "want" } }), mark(OFF[1], { [ISO]: { kind: "want" } })];
  const recs = { statuses: [{ pos: OFF[0], start: ISO, end: ISO, code: "VA" }] };
  const got = F.candidates(DAY, slot(SEAT), ctx(ot, { recs })).map((x) => x.p.pos);
  assert.deepEqual(got, [OFF[1]]);
});

test("seat roles: Rescue Squad, Hazmat and Fire boat seats only", () => {
  assert.equal(F.seatRole({ company: "RS1", title: "Lt. RS1" }), "RS");
  assert.equal(F.seatRole({ company: "HT48", title: "Lt. HT48" }), "HT");
  assert.equal(F.seatRole({ company: "FB3", title: "Captain FB3" }), "FB");
  assert.equal(F.seatRole({ company: null, title: "Pilot of Fire Boats" }), "FB");
  assert.equal(F.seatRole({ company: "E10", title: "FF/Driver E10" }), null);
  assert.equal(F.seatRole({ company: "T10", title: "FF/Tiller T10" }), null);
});

test("a Hazmat seat needs an unexpired listed license; with no names set nobody is left out", () => {
  const hz = rows.find((r) => r.company === "HT48" && r.rank === "Lieutenant");
  const ot = [mark(LT, { [ISO]: { kind: "want" } })];
  const rules = { HT: ["HazMat Relief List"] };
  const lic = (expires) => ({ [LT]: { licenses: [{ name: "hazmat relief  list", expires }] } });
  const day = (o) => F.candidates(DAY, hz, ctx(ot, o)).map((x) => [x.p.pos, x.qual]);
  assert.deepEqual(day({ rules, profiles: lic("2027-01-01") }), [[LT, true]]);
  assert.deepEqual(day({ rules, profiles: lic(null) }), [[LT, true]]);
  assert.deepEqual(day({ rules, profiles: lic("2026-11-13") }), []);
  assert.deepEqual(day({ rules, profiles: {} }), []);
  assert.deepEqual(day({ rules: { HT: [] }, profiles: {} }), [[LT, null]]);
  // a seat without a role ignores licenses
  const ot2 = [mark(OFF[0], { [ISO]: { kind: "want" } })];
  assert.deepEqual(F.candidates(DAY, slot(SEAT), ctx(ot2, { rules })).map((x) => [x.p.pos, x.qual]), [[OFF[0], null]]);
});
