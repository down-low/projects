// Run: node --test firebase/functions/changelog.test.js  (no dependencies)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./changelog");

const AT = "2026-10-23T22:00:00.000Z";
const USER = { authType: "app_user", authId: "uid-editor" };
const cover = { coverKey: "01EOA06M", targetPos: "11EOA13M", start: "2026-11-01", end: null, kind: "cover", createdBy: "uid-a", createdAt: "2026-10-01" };

test("add, edit and delete are logged with who did it, before and after", () => {
  const add = C.entryFor("covers", "c1", null, cover, USER, AT);
  assert.equal(add.action, "add");
  assert.equal(add.actor, "uid-editor");
  assert.equal(add.before, null);
  assert.deepEqual(add.after.coverKey, "01EOA06M");
  assert.deepEqual(add.subjects.sort(), ["01EOA06M", "11EOA13M"]);

  const edited = Object.assign({}, cover, { end: "2026-11-30", updatedAt: AT, updatedBy: "uid-editor" });
  const edit = C.entryFor("covers", "c1", cover, edited, USER, AT);
  assert.equal(edit.action, "edit");
  assert.equal(edit.before.end, null);
  assert.equal(edit.after.end, "2026-11-30");

  const del = C.entryFor("covers", "c1", edited, null, { authType: "app_user", authId: "uid-deleter" }, AT);
  assert.equal(del.action, "delete");
  assert.equal(del.actor, "uid-deleter"); // the person deleting, not the last editor
  assert.equal(del.after, null);
  assert.equal(del.before.end, "2026-11-30");
});

test("a write that only touches the update stamps isn't logged; other collections aren't logged", () => {
  const a = Object.assign({}, cover, { updatedAt: "x", updatedBy: "u1" });
  const b = Object.assign({}, cover, { updatedAt: "y", updatedBy: "u2" });
  assert.equal(C.entryFor("covers", "c1", a, b, USER, AT), null);
  ["staffCells", "contacts", "users", "audit", "changeLog", "notices", "overtimeNotes"].forEach((c) =>
    assert.equal(C.entryFor(c, "x", null, { cell: "+14155550100" }, USER, AT), null, c));
});

test("cell numbers and other contact fields never go into the log, at any depth", () => {
  const rec = { pos: "P1", cell: "+14155550100", phoneMobile: "x", contactEmail: "a@b.c", email: "a@b.c",
    nested: { staffCell: "y", ok: 1 }, list: [{ phone: "z", keep: 2 }] };
  const e = C.entryFor("people", "p1", null, rec, USER, AT);
  const text = JSON.stringify(e);
  assert.doesNotMatch(text, /415|a@b|phone|cell|contact|email/i);
  assert.deepEqual(e.after.nested, { ok: 1 });
  assert.deepEqual(e.after.list, [{ keep: 2 }]);
  assert.ok(e.subjects.includes("person:p1"));
});

test("who did it without a signed-in user: functions are 'system', otherwise the record's own stamps", () => {
  assert.equal(C.entryFor("trades", "t1", { status: "open" }, { status: "set" }, { authType: "service_account" }, AT).actor, "system");
  assert.equal(C.entryFor("covers", "c1", null, cover, { authType: "unknown" }, AT).actor, "uid-a");
  const ed = Object.assign({}, cover, { end: "2026-12-01", updatedAt: AT, updatedBy: "uid-b" });
  assert.equal(C.entryFor("covers", "c1", cover, ed, {}, AT).actor, "uid-b");
  assert.equal(C.entryFor("covers", "c1", cover, null, {}, AT).actor, "unknown");
});

test("restore puts back the version before the change and is logged as a restore by that admin", () => {
  const edited = Object.assign({}, cover, { end: "2026-11-30" });
  const del = C.entryFor("covers", "c1", edited, null, USER, AT);
  const back = C.restoreDoc(del, "uid-admin", "2026-10-24T00:00:00.000Z", "log1");
  assert.equal(back.end, "2026-11-30");
  assert.equal(back.restoredBy, "uid-admin");
  const logged = C.entryFor("covers", "c1", null, back, { authType: "service_account" }, AT);
  assert.equal(logged.action, "restore");
  assert.equal(logged.actor, "uid-admin");
  // nothing to restore from an add, or for a collection that isn't logged
  assert.equal(C.restoreDoc(C.entryFor("covers", "c2", null, cover, USER, AT), "u", AT, "l"), null);
  assert.equal(C.restoreDoc(Object.assign({}, del, { collection: "staffCells" }), "u", AT, "l"), null);
});

test("actor names never show an email or phone number", () => {
  assert.equal(C.actorLabel({ name: "Dave Lester" }, null), "Dave Lester");
  assert.equal(C.actorLabel({ name: "x" }, "Lester,D"), "Lester,D");
  assert.equal(C.actorLabel({ name: "dave@example.org" }, null), null);
  assert.equal(C.actorLabel({ name: "+14155550100" }, null), null);
});

test("a set trade is about the poster, the taker and its legs", () => {
  const t = { posterKey: "A", takerKey: "B", seatPos: "A", legs: [{ kind: "covers", coverKey: "B", targetPos: "A" }, { kind: "statuses", pos: "A" }] };
  assert.deepEqual(C.subjects("trades", "t1", t).sort(), ["A", "B"]);
});
