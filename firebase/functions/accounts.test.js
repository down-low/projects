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

const TRADE = { posterKey: "10EOC03M", status: "open", date: "2026-11-14", audience: { board: false, to: ["11ENL01M", "11ENL02M"] } };
const ictx = (o) => Object.assign({ callerPos: "10EOC03M", today: "2026-10-20", onTool: () => false }, o);

test("invites: only the poster, only people the trade went to, only people not on the tool", () => {
  assert.equal(A.inviteProblem(TRADE, "11ENL01M", ictx()), null);
  assert.match(A.inviteProblem(TRADE, "11ENL01M", ictx({ callerPos: "11ENL02M" })), /posted the trade/);
  assert.match(A.inviteProblem(TRADE, "12ENL09M", ictx()), /sent the trade to/);
  assert.match(A.inviteProblem(TRADE, "11ENL01M", ictx({ onTool: () => true })), /already on the tool/);
  assert.match(A.inviteProblem(Object.assign({}, TRADE, { status: "set" }), "11ENL01M", ictx()), /no longer open/);
  assert.match(A.inviteProblem(TRADE, "11ENL01M", ictx({ today: "2026-11-15" })), /no longer open/);
  assert.match(A.inviteProblem(null, "11ENL01M", ictx()), /No such trade/);
});

test("invites expire on the trade's day or after 14 days", () => {
  assert.equal(A.inviteExpiry("2026-11-14", "2026-10-20T12:00:00.000Z"), "2026-11-03T12:00:00.000Z");
  assert.equal(A.inviteExpiry("2026-10-25", "2026-10-20T12:00:00.000Z"), "2026-10-25T23:59:59.999Z");
  assert.match(A.inviteState({ expiresAt: "2026-10-19T00:00:00.000Z" }, NOW), /expired/);
  assert.equal(A.inviteState({ expiresAt: "2026-10-25T00:00:00.000Z" }, NOW), null);
  assert.match(A.inviteState(null, NOW), /isn't valid/);
});

test("answers from a link: pay back later or a later swap day", () => {
  assert.deepEqual(A.cleanInviteAnswer({ proposal: { later: true } }, "2026-11-14", "2026-10-20"), { proposal: { later: true }, note: null });
  assert.deepEqual(A.cleanInviteAnswer({ proposal: { swapDate: "2026-11-20" }, note: " ok " }, "2026-11-14", "2026-10-20").proposal, { swapDate: "2026-11-20" });
  assert.throws(() => A.cleanInviteAnswer({ proposal: { swapDate: "2026-11-14" } }, "2026-11-14", "2026-10-20"), /later day/);
  assert.throws(() => A.cleanInviteAnswer({ proposal: {} }, "2026-11-14", "2026-10-20"), /pay back later/);
});

test("signing in from a link: the Employee ID must match the invited person", () => {
  const inv = { recipientKey: "11ENL01M", inviterKey: "10EOC03M", expiresAt: "2026-11-01T00:00:00.000Z", usedBy: null };
  const pending = { status: "pending", role: "member", pos: null };
  const patch = A.planRedeem("u1", pending, inv, "le1234", { expected: "LE1234", takenBy: null, nowIso: NOW });
  assert.deepEqual([patch.pos, patch.status, patch.approvedBy, patch.invitedBy], ["11ENL01M", "active", "invite", "10EOC03M"]);
  assert.throws(() => A.planRedeem("u1", pending, inv, "LE9999", { expected: "LE1234", nowIso: NOW }), /doesn't match/);
  assert.throws(() => A.planRedeem("u1", pending, inv, "LE1234", { expected: null, nowIso: NOW }), /no Employee ID on file/);
  assert.throws(() => A.planRedeem("u1", pending, inv, "LE1234", { expected: "LE1234", takenBy: "u2", nowIso: NOW }), /already linked/);
  assert.throws(() => A.planRedeem("u1", pending, Object.assign({}, inv, { usedBy: "u2" }), "LE1234", { expected: "LE1234", nowIso: NOW }), /already been used/);
  assert.throws(() => A.planRedeem("u1", { status: "active", pos: "12X" }, inv, "LE1234", { expected: "LE1234", nowIso: NOW }), /linked to someone else/);
  assert.throws(() => A.planRedeem("u1", pending, inv, "1234", { expected: "LE1234", nowIso: NOW }), /two letters/);
});

test("answering from a link: only the invited person's Employee ID, capped wrong tries", () => {
  const inv = { recipientKey: "11ENL01M", idMisses: 0 };
  assert.deepEqual(A.checkInviteId(inv, " le1234 ", "LE1234"), { ok: true });
  assert.deepEqual(["Doe,Jane Q", "Doe,J", "Doe"].map(A.friendlyName), ["Jane Doe", "J. Doe", "Doe"]);
  const wrong = A.checkInviteId(inv, "LE9999", "LE1234");
  assert.equal(wrong.miss, true);
  assert.match(wrong.why, /doesn't match/);
  assert.match(A.checkInviteId(inv, "LE1234", null).why, /no Employee ID on file/);
  assert.match(A.checkInviteId(inv, "1234", "LE1234").why, /two letters/);
  assert.ok(!A.checkInviteId(inv, "1234", "LE1234").miss);
  const spent = A.checkInviteId({ idMisses: A.INVITE_ID_TRIES }, "LE1234", "LE1234");
  assert.match(spent.why, /Too many/);
  assert.ok(!spent.ok);
});

test("cell-number sign-in: a phone account, no domain rule", () => {
  const a = A.signIn(null, { phone: "+14155550110", isAdmin: false, allowed: false, now: NOW });
  assert.deepEqual([a.user.phone, a.user.email, a.user.status, a.user.name], ["+14155550110", null, "pending", "+14155550110"]);
  const b = A.signIn(a.user, { phone: "+14155550110", isAdmin: false, allowed: false, now: NOW });
  assert.equal(b.created, false);
  assert.equal(A.meJson("u", b.user, { lookup, contact: null, profile: null }).phone, "+14155550110");
});

test("cell-number sign-in links the one staff-list seat with that cell", () => {
  const cells = new Map([["10EOC03M", "(415) 555-0110"], ["11ENL01M", "415.555.0111"], ["12X", "415-555-0112"], ["13X", "4155550112"]]);
  const pending = { status: "pending", role: "member", pos: null };
  const p = A.planCellMatch("u1", pending, "+14155550110", cells, () => null, NOW);
  assert.deepEqual([p.pos, p.status, p.approvedBy], ["10EOC03M", "active", "cell"]);
  assert.equal(A.planCellMatch("u1", pending, "+14155559999", cells, () => null, NOW), null); // not on the list
  assert.equal(A.planCellMatch("u1", pending, "+14155550112", cells, () => null, NOW), null); // two seats share it
  assert.equal(A.planCellMatch("u1", pending, "+14155550110", cells, () => "u2", NOW), null); // seat taken
  assert.equal(A.planCellMatch("u1", { status: "active", pos: "X" }, "+14155550110", cells, () => null, NOW), null);
});

test("a personal invite link opened with the invited person's cell needs no Employee ID", () => {
  const inv = { recipientKey: "11ENL01M", inviterKey: "10EOC03M", expiresAt: "2026-11-01T00:00:00.000Z", usedBy: null };
  const p = A.planRedeem("u1", { status: "pending" }, inv, "", { expected: "LE1234", nowIso: NOW, cellMatch: true });
  assert.deepEqual([p.pos, p.status, p.approvedBy], ["11ENL01M", "active", "invite"]);
  assert.throws(() => A.planRedeem("u1", { status: "pending" }, inv, "", { expected: "LE1234", nowIso: NOW, cellMatch: false }), /two letters/);
});

test("launch texts skip people on the tool, without a cell, or already texted", () => {
  const cells = new Map([["a", "4155550101"], ["b", "4155550102"], ["c", ""], ["d", "4155550104"], ["e", "123"]]);
  const r = A.launchTargets(["a", "b", "c", "d", "e", "a"], cells, (k) => k === "b", (k) => k === "d");
  assert.deepEqual(r.send, [{ key: "a", cell: "+14155550101" }]);
  assert.deepEqual(r.skipped, { onTool: 1, noCell: 2, sent: 1 });
});

test("picking your name with the Employee ID on file gets you in at once; otherwise an admin approves", () => {
  const ctx = { lookup, takenBy: () => null, companies, emplOwner: () => null, expectedEmplId: "LE1234" };
  const pending = { status: "pending", role: "member", pos: null };
  const p = A.planClaim("u1", pending, { pos: "10EOC03M", emplId: " le1234 " }, ctx);
  assert.deepEqual([p.pos, p.status, p.approvedBy], ["10EOC03M", "active", "emplId"]);
  assert.deepEqual(A.planClaim("u1", pending, { pos: "10EOC03M", emplId: "LE9999" }, ctx).claimPos, "10EOC03M");
  assert.deepEqual(A.planClaim("u1", pending, { pos: "10EOC03M", emplId: "LE1234" }, Object.assign({}, ctx, { expectedEmplId: null })).claimPos, "10EOC03M");
  assert.throws(() => A.planClaim("u1", pending, { pos: "10EOC03M", emplId: "LE1234" }, Object.assign({}, ctx, { takenBy: () => "u2" })), (e) => e.code === "already-exists");
});

test("cell numbers are standardized to +1 and ten digits", () => {
  const cases = { "(415) 555-0100": "+14155550100", "415.555.0100": "+14155550100", "1-415-555-0100": "+14155550100",
    "+1 415 555 0100": "+14155550100", "cell 415-555-0100 / home 650-555-0199": "+14155550100", "4155550100": "+14155550100",
    "555-0100": null, "": null, "n/a": null };
  Object.entries(cases).forEach(([raw, want]) => assert.equal(A.normCell(raw), want, raw));
  assert.equal(A.cellKey("cell 415-555-0100 / home 650-555-0199"), "4155550100");
});
