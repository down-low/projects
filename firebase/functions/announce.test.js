// Run: node --test firebase/functions/announce.test.js  (no dependencies). Phone numbers below are made up.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const AN = require("./announce");

const BASE = { title: "Sick and vacation tracking", message: "Your sick and vacation hours will show on My page soon." };

test("a plain announcement to everyone", () => {
  assert.deepEqual(AN.clean(BASE), { title: BASE.title, message: BASE.message, link: null, audience: "all", uids: [] });
});

test("title, message and link are checked", () => {
  assert.throws(() => AN.clean({ message: "x" }), /title/);
  assert.throws(() => AN.clean({ title: "x" }), /message/);
  assert.throws(() => AN.clean(Object.assign({}, BASE, { title: "x".repeat(81) })), /80/);
  assert.throws(() => AN.clean(Object.assign({}, BASE, { message: "x".repeat(301) })), /300/);
  assert.throws(() => AN.clean(Object.assign({}, BASE, { link: "http://example.org" })), /https/);
  assert.throws(() => AN.clean(Object.assign({}, BASE, { link: "javascript:alert(1)" })), /https/);
  assert.equal(AN.clean(Object.assign({}, BASE, { link: " https://example.org/a " })).link, "https://example.org/a");
});

test("phone numbers are refused anywhere in the text", () => {
  for (const n of ["415-555-0100", "(415) 555 0100", "4155550100", "+1 415.555.0100", "call 555-0100"]) {
    assert.throws(() => AN.clean(Object.assign({}, BASE, { message: "Questions? " + n })), /phone number/, n);
  }
  assert.throws(() => AN.clean(Object.assign({}, BASE, { title: "Text 415 555 0100" })), /phone number/);
  // dates, times and hour counts are fine
  for (const ok of ["Starts 2026-11-01 at 0800.", "Starts 11/01/2026.", "Up to 480 hours of sick leave, 10 days."]) {
    assert.equal(AN.clean(Object.assign({}, BASE, { message: ok })).message, ok);
  }
});

test("picked people: needs at least one, duplicates dropped", () => {
  assert.throws(() => AN.clean(Object.assign({}, BASE, { audience: "picked", uids: [] })), /Pick/);
  assert.deepEqual(AN.clean(Object.assign({}, BASE, { audience: "picked", uids: ["a", "a", "b", 3] })).uids, ["a", "b"]);
});

test("recipients: active accounts only; push when app alerts are on and a device is registered", () => {
  const users = [
    { uid: "a", status: "active", alerts: { app: true }, pushTokens: ["t1"] },
    { uid: "b", status: "active", alerts: { app: true }, pushTokens: [] },
    { uid: "c", status: "active", alerts: { app: false }, pushTokens: ["t2"] },
    { uid: "d", status: "pending", alerts: { app: true }, pushTokens: ["t3"] },
  ];
  const all = AN.recipients(users, { audience: "all" });
  assert.deepEqual(all.map((r) => [r.uid, r.push]), [["a", true], ["b", false], ["c", false]]);
  assert.deepEqual(AN.recipients(users, { audience: "picked", uids: ["c", "d"] }).map((r) => r.uid), ["c"]);
  assert.throws(() => AN.recipients(users, { audience: "picked", uids: ["d"] }), /active/);
});
