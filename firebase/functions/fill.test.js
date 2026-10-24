// Run: node --test firebase/functions/fill.test.js  (no dependencies; uses the real roster in data/)
// Fill open spots (fill.js, admin site): who could fill an open seat on a day.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../fill.js");
const A = require("./alerts");
const rows = require("../../data/positions.json");
const RULES = require("../../data/seat-qualifications.json");

// Same day and seats as alerts.test.js: 11EOA13M (FF/Paramedic) works Sat Nov 14 2026; the three OFF FF/Paramedics are
// off; the Lieutenant is off but in another rank group; 01EOA07M works that day.
const SEAT = "11EOA13M", OFF = ["01EOA06M", "11EOA14M", "01EOA08M"], LT = "01EOL02M", WORKING = "01EOA07M";
const DAY = new Date(2026, 10, 14), ISO = "2026-11-14";
const slot = (pos) => rows.find((r) => r.pos === pos);
const mark = (pos, days) => ({ id: "seat-" + pos, pos, days });
function ctx(overtime, extra) {
  const world = A.buildWorld(rows, [], [], extra && extra.recs ? extra.recs : {});
  return Object.assign({ people: Object.values(world.byPos).filter((p) => p.name), opts: world.opts,
    want: F.wantOt(overtime, ISO), hours: F.otHours(overtime, 2026), extras: [], rules: RULES, profiles: {}, today: ISO }, extra || {});
}
const ot = (pos, co, c) => F.candidates(DAY, slot(pos), co || slot(pos).company, c).ot.map((x) => x.p.pos);
// Rules with every cert given one fir-db1 name (the real names come later), and a profile holding some of them.
const named = Object.assign({}, RULES, { certs: { "HazMat Specialist": ["HazMat Specialist"], Squad: ["Rescue Squad"], SCUBA: ["SCUBA Diver"],
  "Surf Rescue": ["Surf Rescue Tech"], "Surf ICS": ["Surf ICS"] } });
const holds = (pos, names, expires) => ({ [pos]: { licenses: names.map((n) => ({ name: n, expires: expires === undefined ? null : expires })) } });

test("Want OT: only people who marked it, in the seat's rank group and off that day", () => {
  const marks = [mark(OFF[0], { [ISO]: { kind: "want" } }), mark(OFF[1], { [ISO]: { kind: "want" } }),
    mark(LT, { [ISO]: { kind: "want" } }), mark(WORKING, { [ISO]: { kind: "want" } }), mark(OFF[2], { "2026-11-15": { kind: "want" } })];
  assert.deepEqual(ot(SEAT, null, ctx(marks)).sort(), [OFF[0], OFF[1]].sort());
});

test("Want OT: fewest Worked OT hours this year first; other years and Want OT marks don't count", () => {
  const marks = [
    mark(OFF[0], { [ISO]: { kind: "want" }, "2026-03-01": { kind: "worked", hours: 24 }, "2026-04-01": { kind: "worked", hours: 12 } }),
    mark(OFF[1], { [ISO]: { kind: "want" }, "2026-05-01": { kind: "worked", hours: 10 }, "2025-05-01": { kind: "worked", hours: 48 } }),
  ];
  assert.deepEqual(F.candidates(DAY, slot(SEAT), "E11", ctx(marks)).ot.map((x) => [x.p.pos, x.hours]), [[OFF[1], 10], [OFF[0], 36]]);
});

test("Want OT: someone with leave that day is left out", () => {
  const marks = [mark(OFF[0], { [ISO]: { kind: "want" } }), mark(OFF[1], { [ISO]: { kind: "want" } })];
  const recs = { statuses: [{ pos: OFF[0], start: ISO, end: ISO, code: "VA" }] };
  assert.deepEqual(ot(SEAT, null, ctx(marks, { recs })), [OFF[1]]);
});

test("extra bodies: only from an apparatus above required, same rank group, listed before OT", () => {
  const pm = { pos: "X1", name: "Extra,A", rank: "FF/Paramedic" }, ff = { pos: "X2", name: "Extra,B", rank: "Firefighter" };
  const atRequired = { pos: "X3", name: "Even,C", rank: "FF/Paramedic" };
  const summary = [
    { co: "E10", total: 1, people: [{ who: pm }, { who: ff }] },
    { co: "E12", total: 0, people: [{ who: atRequired }] },
    { co: "E11", total: -1, people: [] },
  ];
  const ex = F.extras(summary);
  assert.deepEqual(ex.map((x) => [x.p.pos, x.co, x.surplus]), [["X1", "E10", 1], ["X2", "E10", 1]]);
  const got = F.candidates(DAY, slot(SEAT), "E11", ctx([mark(OFF[0], { [ISO]: { kind: "want" } })], { extras: ex }));
  assert.deepEqual(got.extras.map((x) => x.p.pos), ["X1"]); // the Firefighter is another rank group
  assert.deepEqual(got.ot.map((x) => x.p.pos), [OFF[0]]); // Want OT comes as its own, second list
  // nobody is listed as an extra for a seat on their own apparatus
  assert.deepEqual(F.candidates(DAY, slot(SEAT), "E10", ctx([], { extras: ex })).extras, []);
});

test("extra bodies: same battalion first, then by name", () => {
  const a = { pos: "Y1", name: "Zed,A", rank: "FF/Paramedic" }, b = { pos: "Y2", name: "Abe,B", rank: "FF/Paramedic" };
  const ex = F.extras([{ co: "E10", total: 1, people: [{ who: a }] }, { co: "E20", total: 1, people: [{ who: b }] }]);
  const bat = (co) => (co === "E10" || co === "E11" ? "BT1" : "BT2");
  assert.deepEqual(F.candidates(DAY, slot(SEAT), "E11", ctx([], { extras: ex, battalionOf: bat })).extras.map((x) => x.p.pos), ["Y1", "Y2"]);
  assert.deepEqual(F.candidates(DAY, slot(SEAT), "E11", ctx([], { extras: ex })).extras.map((x) => x.p.pos), ["Y2", "Y1"]);
});

test("which seats are checked: Station 36 (E36 and the B02 chief), not HT48; Rescue Squads but not Rescue Captains", () => {
  const places = (pos) => F.qualified(slot(pos), slot(pos).company, [], RULES, ISO).places;
  assert.deepEqual(places("36EOD01M"), ["Haz-Mat (Station 36)"]);
  assert.deepEqual(places("36EOL27M"), ["Haz-Mat (Station 36)"]);
  assert.deepEqual(places("02BO205M"), ["Haz-Mat (Station 36)"]);
  assert.deepEqual(places("03BO208M"), []);
  assert.deepEqual(places("48HOL01M"), []);
  assert.deepEqual(places("01SOD18M"), ["Rescue Squad"]);
  assert.deepEqual(places("01SOL21M"), ["Rescue Squad"]);
  assert.deepEqual(places("01ROR01M"), []);
  assert.deepEqual(places("51EOL09M"), ["Surf Rescue", "Station 51"]);
  assert.deepEqual(places(SEAT), []);
});

test("with no license names set yet, a checked seat says which certs aren't set and leaves nobody out", () => {
  const q = F.qualified(slot("01SOD18M"), "RS1", [], RULES, ISO);
  assert.equal(q.ok, true);
  assert.deepEqual(q.notSet.sort(), ["HazMat Specialist", "SCUBA", "Squad"]);
});

test("Rescue Squad needs all three: Hazmat, Squad and SCUBA", () => {
  const rs = slot("01SOD18M");
  const q = (names) => F.qualified(rs, "RS1", names.map((n) => ({ name: n, expires: null })), named, ISO);
  assert.equal(q(["HazMat Specialist", "Rescue Squad", "SCUBA Diver"]).ok, true);
  assert.equal(q(["HazMat Specialist", "Rescue Squad"]).ok, false);
  assert.deepEqual(q(["HazMat Specialist", "Rescue Squad"]).missing, ["SCUBA"]);
});

test("E51 needs both Surf Rescue and Station 51: an officer needs Surf ICS for Station 51", () => {
  const lt = slot("51EOL09M");
  const q = (names) => F.qualified(lt, "E51", names.map((n) => ({ name: n, expires: null })), named, ISO);
  assert.equal(q(["Surf Rescue Tech"]).ok, false); // Surf Rescue meets Surf Rescue, not Station 51
  assert.equal(q(["Surf ICS"]).ok, true); // Surf ICS meets both
  const ff = F.qualified(slot("51EOD11M"), "E51", [{ name: "Surf Rescue Tech", expires: null }], named, ISO);
  assert.equal(ff.ok, true);
});

test("an expired cert doesn't count; a Want OT person without the cert is left out", () => {
  const hz = slot("36EOL27M"); // Lieutenant, E36
  const marks = [mark(LT, { [ISO]: { kind: "want" } })];
  const day = (profiles) => F.candidates(DAY, hz, "E36", ctx(marks, { rules: named, profiles })).ot.map((x) => x.p.pos);
  assert.deepEqual(day(holds(LT, ["HazMat Specialist"], "2027-01-01")), [LT]);
  assert.deepEqual(day(holds(LT, ["hazmat  specialist"])), [LT]); // names match ignoring case and spacing
  assert.deepEqual(day(holds(LT, ["HazMat Specialist"], "2026-11-13")), []);
  assert.deepEqual(day({}), []);
  // licenses not loaded yet (profiles null): nobody is left out
  assert.deepEqual(day(null), [LT]);
});
