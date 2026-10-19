// Run: node --test firebase/functions  (no dependencies needed)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./accounts");

const NOW = "2026-10-19T12:00:00.000Z";
const roster = { "10EOC03M": { pos: "10EOC03M", name: "Lester,D", title: "Captain E10" }, "11ENL01M": { pos: "11ENL01M", name: "", title: "Lt E11" } };
const lookup = (k) => roster[k] || null;
const companies = new Set(["E10", "E11", "T01"]);

test("first sign-in is pending; ADMIN_EMAILS start as active admins", () => {
  const a = A.signIn(null, { email: "x@y.org", name: "X", isAdmin: false, allowed: true, now: NOW });
  assert.equal(a.created, true);
  assert.deepEqual([a.user.status, a.user.role], ["pending", "member"]);
  const b = A.signIn(null, { email: "boss@y.org", name: "B", isAdmin: true, allowed: true, now: NOW });
  assert.deepEqual([b.user.status, b.user.role], ["active", "admin"]);
});

test("disabled accounts and other domains are refused", () => {
  assert.throws(() => A.signIn({ status: "disabled", role: "member" }, { email: "x@y.org", isAdmin: false, allowed: true, now: NOW }), /disabled/);
  assert.throws(() => A.signIn(null, { email: "x@gmail.com", isAdmin: false, allowed: false, now: NOW }), (e) => e.reason === "domain");
  assert.equal(A.emailAllowed("x@gmail.com", []), true);
  assert.equal(A.emailAllowed("x@sfgov.org", ["sfgov.org"]), true);
  assert.equal(A.emailAllowed("x@gmail.com", ["sfgov.org"]), false);
  assert.deepEqual(A.parseList(" A@x.org, ,b@y.org "), ["a@x.org", "b@y.org"]);
});

test("an admin email gets its role back on sign-in", () => {
  const r = A.signIn({ status: "pending", role: "member", name: "Old" }, { email: "boss@y.org", name: "", isAdmin: true, allowed: true, now: NOW });
  assert.deepEqual([r.user.status, r.user.role, r.user.name, r.user.lastLogin], ["active", "admin", "Old", NOW]);
});

test("claims follow the account", () => {
  assert.deepEqual(A.claimsFor({ status: "pending", role: "member" }), { active: false, role: "member", pos: null });
  assert.deepEqual(A.claimsFor({ status: "active", role: "editor", pos: "10EOC03M" }), { active: true, role: "editor", pos: "10EOC03M" });
  assert.equal(A.claimsEqual({ active: true, role: "admin", pos: null }, { active: true, role: "admin" }), true);
  assert.equal(A.claimsEqual({ active: true, role: "admin" }, { active: true, role: "member" }), false);
});

test("me JSON has the server.py shape", () => {
  const j = A.meJson("u1", { email: "x@y.org", name: "X", role: "member", status: "active", pos: "10EOC03M" },
    { lookup, contact: { contactEmail: "c@y.org", share: true }, profile: { birthDate: "1980-01-01" } });
  assert.equal(j.posName, "Lester,D");
  assert.equal(j.shareContact, true);
  assert.deepEqual(j.profile, { birthDate: "1980-01-01", hireDate: null });
  assert.equal(j.alerts.board, "off");
});

test("claims: roster entry must exist and be free; requests are checked", () => {
  const ctx = { lookup, takenBy: () => null, companies, emplOwner: () => null };
  const pending = { status: "pending" };
  assert.deepEqual(A.planClaim("u1", pending, { pos: "10EOC03M", note: " hi " }, ctx), { claimPos: "10EOC03M", claimNote: "hi", claimRequest: null });
  assert.throws(() => A.planClaim("u1", pending, { pos: "11ENL01M" }, ctx), /Pick your name/); // vacant seat
  assert.throws(() => A.planClaim("u1", pending, { pos: "10EOC03M" }, Object.assign({}, ctx, { takenBy: () => "u2" })), (e) => e.code === "already-exists");
  assert.throws(() => A.planClaim("u1", { status: "active" }, { pos: "10EOC03M" }, ctx), (e) => e.code === "failed-precondition");
  const req = A.planClaim("u1", pending, { request: { name: "Smith,J", rank: "Firefighter", company: "e10", tour: 5, emplId: "ab1234" } }, ctx);
  assert.equal(req.claimRequest.company, "E10");
  assert.equal(req.claimRequest.emplId, "AB1234");
  assert.throws(() => A.planClaim("u1", pending, { request: { name: "Smith,J", rank: "Firefighter", company: "E99", tour: 5 } }, ctx), /Apparatus/);
  assert.throws(() => A.planClaim("u1", pending, { request: { name: "Smith,J", rank: "Chief", company: "E10", tour: 5 } }, ctx), /rank/);
  assert.throws(() => A.planClaim("u1", pending, { request: { name: "Smith,J", rank: "Firefighter", company: "E10", tour: 32 } }, ctx), /tour/);
  assert.throws(() => A.planClaim("u1", pending, { request: { name: "Smith,J", rank: "Firefighter", company: "E10" } }, ctx), /apparatus and tour/);
  assert.throws(() => A.planClaim("u1", pending, { request: { name: "Smith,J", rank: "Firefighter", company: "E10", tour: 5, emplId: "AB1234" } },
    Object.assign({}, ctx, { emplOwner: () => "Lester,D" })), /already on Lester,D/);
});

test("roster names leave out linked positions and vacant seats", () => {
  const out = A.rosterNames(Object.values(roster), [{ id: "p1", name: "New,A", rank: "Firefighter" }, { id: "p2", name: "Taken,B", rank: "ISS" }],
    new Set(["person:p2"]));
  assert.deepEqual(out.map((r) => r.pos), ["10EOC03M", "person:p1"]);
});

test("admin actions: approve, link, role, disable, keep one admin", () => {
  const ctx = { activeAdmins: 1, takenBy: () => null, lookup };
  const claimant = { uid: "u2", status: "pending", role: "member", claimPos: "10EOC03M" };
  assert.deepEqual(A.planAdminAction(claimant, { action: "approve" }, ctx).patch, { pos: "10EOC03M", claimPos: null, claimNote: null, status: "active" });
  assert.throws(() => A.planAdminAction(claimant, { action: "approve" }, Object.assign({}, ctx, { takenBy: () => "u3" })), (e) => e.code === "already-exists");
  const asker = { uid: "u4", status: "pending", role: "member", claimRequest: { name: "New,A" } };
  const plan = A.planAdminAction(asker, { action: "approve" }, ctx);
  assert.equal(plan.addPerson.name, "New,A");
  assert.equal(plan.patch.status, "active");
  const onlyAdmin = { uid: "u1", status: "active", role: "admin" };
  assert.throws(() => A.planAdminAction(onlyAdmin, { action: "role", role: "member" }, ctx), /at least one admin/);
  assert.throws(() => A.planAdminAction(onlyAdmin, { action: "disable" }, ctx), /only admin/);
  assert.deepEqual(A.planAdminAction(onlyAdmin, { action: "role", role: "member" }, Object.assign({}, ctx, { activeAdmins: 2 })).patch, { role: "member" });
  assert.equal(A.planAdminAction({ uid: "u2", status: "active", role: "member" }, { action: "disable" }, ctx).revoke, true);
  assert.throws(() => A.planAdminAction(claimant, { action: "role", role: "owner" }, ctx), /role must be/);
  assert.throws(() => A.planAdminAction(claimant, { action: "link", pos: "XX" }, ctx), /pos must be/);
  assert.deepEqual(A.planAdminAction(claimant, { action: "link", pos: "10EOC03M" }, ctx).patch.pos, "10EOC03M");
  assert.throws(() => A.planAdminAction(null, { action: "approve" }, ctx), (e) => e.code === "not-found");
  assert.throws(() => A.planAdminAction(claimant, { action: "nope" }, ctx), /Unknown action/);
});

test("users sort with waiting claims first", () => {
  const out = A.sortUsers([{ name: "B", status: "active" }, { name: "A", status: "pending" }, { name: "C", status: "pending", claimPos: "x" }]);
  assert.deepEqual(out.map((u) => u.name), ["C", "B", "A"]); // as server.py: then status, then name
});

test("stats return averages only, for known people", () => {
  const r = A.averages([{ key: "10EOC03M", birthDate: "1986-10-19", hireDate: "2016-10-19" }, { key: "gone", birthDate: "1950-01-01" }],
    "2026-10-19", (k) => !!lookup(k));
  assert.deepEqual(r, { avgAge: 40, nAge: 1, avgYos: 10, nYos: 1 });
});
