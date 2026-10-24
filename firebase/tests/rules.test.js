/* Security rules tests (firestore.rules, storage.rules), ported from tests/test_server.py and FIREBASE_PLAN.md "Testing".
 * Run inside the emulator, from firebase/:
 *   npx firebase-tools emulators:exec --only firestore,storage --project demo-tour-schedule "node --test tests/rules.test.js"
 * Phone numbers below are made up.
 */
"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

const ROOT = path.join(__dirname, "..");
let env;

const ADMIN = { uid: "admin1", claims: { active: true, role: "admin", pos: null } };
const EDITOR = { uid: "ed1", claims: { active: true, role: "editor", pos: "20EOC01M" } };
const MEMBER = { uid: "mem1", claims: { active: true, role: "member", pos: "10EOC03M" } };
const OTHER = { uid: "mem2", claims: { active: true, role: "member", pos: "11ENL01M" } };
const PENDING = { uid: "pend1", claims: { active: false, role: "member", pos: null } };
const NOCLAIMS = { uid: "new1", claims: {} };

const as = (who) => env.authenticatedContext(who.uid, who.claims);
const db = (who) => (who ? as(who) : env.unauthenticatedContext()).firestore();
const status = (extra) => Object.assign({ pos: "10EOC03M", code: "VA", start: "2026-11-01", end: "2026-11-03", note: "" }, extra);

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-tour-schedule",
    firestore: { rules: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8") },
    storage: { rules: fs.readFileSync(path.join(ROOT, "storage.rules"), "utf8") },
  });
});
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await d.doc("statuses/s1").set(status());
    await d.doc("staffCells/10EOC03M").set({ cell: "415-555-0100" });
    await d.doc("profiles/10EOC03M").set({ birthDate: "1980-01-01", hireDate: "2005-01-01" });
    await d.doc("profiles/11ENL01M").set({ birthDate: "1981-01-01" });
    await d.doc("contacts/mem1").set({ pos: "10EOC03M", phoneMobile: "415-555-0101", share: false });
    await d.doc("contacts/mem2").set({ pos: "11ENL01M", phoneMobile: "415-555-0102", share: true });
    await d.doc("users/mem1").set({ email: "m@x.org", status: "active", role: "member", pos: "10EOC03M" });
    await d.doc("trades/t1").set({ posterKey: "10EOC03M", date: "2026-11-05", status: "open", audience: { board: true, to: [] } });
    await d.doc("corrections/mem1").set({ items: { a: { state: "open" } } });
    await d.doc("feedback/mem1").set({ items: { a: { state: "open", kind: "idea", text: "x" } } });
    await d.doc("overtime/mem1").set({ pos: "10EOC03M", name: "A", days: { "2026-11-02": { kind: "want" } } });
    await d.doc("audit/a1").set({ action: "x" });
    await d.doc("announcements/n1").set({ title: "Hello", message: "Welcome", audience: "all", uids: [] });
    await d.doc("notices/mem1").set({ items: { n1: { title: "Hello", message: "Welcome", link: null } } });
  });
});

test("signed-out, pending and claim-less accounts see nothing", async () => {
  for (const who of [null, PENDING, NOCLAIMS]) {
    await assertFails(db(who).doc("statuses/s1").get());
    await assertFails(db(who).collection("statuses").get());
    await assertFails(db(who).doc("trades/t1").get());
    await assertFails(db(who).collection("contacts").where("share", "==", true).get());
  }
});

test("members read records but can't edit them", async () => {
  await assertSucceeds(db(MEMBER).collection("statuses").get());
  await assertFails(db(MEMBER).collection("statuses").add(status()));
  await assertFails(db(MEMBER).doc("statuses/s1").update({ end: "2026-11-09" }));
  await assertFails(db(MEMBER).doc("statuses/s1").delete());
  await assertFails(db(MEMBER).doc("rosterOverrides/10EOC03M").set({ name: "X" }));
});

test("members mark one of their own days VA or S, and remove only that", async () => {
  const own = (extra) => Object.assign({ pos: "10EOC03M", name: "Me,A", code: "VA", start: "2026-11-05", end: "2026-11-05", note: "",
    self: true, createdBy: "mem1", createdAt: "2026-10-21T00:00:00Z" }, extra);
  const ref = await assertSucceeds(db(MEMBER).collection("statuses").add(own()));
  await assertSucceeds(db(MEMBER).collection("statuses").add(own({ code: "S" })));
  await assertFails(db(MEMBER).collection("statuses").add(own({ pos: "11ENL01M" })));        // someone else's seat
  await assertFails(db(MEMBER).collection("statuses").add(own({ code: "D" })));              // only VA or S
  await assertFails(db(MEMBER).collection("statuses").add(own({ code: "WE" })));
  await assertFails(db(MEMBER).collection("statuses").add(own({ end: "2026-11-06" })));      // one day only
  await assertFails(db(MEMBER).collection("statuses").add(own({ self: false })));
  await assertFails(db(MEMBER).collection("statuses").add(own({ createdBy: "mem2" })));
  await assertFails(db(MEMBER).collection("statuses").add(own({ tradeId: "t1" })));          // no other fields
  await assertFails(db(OTHER).doc(ref.path).delete());                                       // not theirs
  await assertFails(db(MEMBER).doc(ref.path).update({ code: "S" }));                         // remove and re-add instead
  await assertSucceeds(db(MEMBER).doc(ref.path).delete());
  await assertFails(db(PENDING).collection("statuses").add(own()));
});

test("editors write records with valid fields only; admins skip the checks", async () => {
  await assertSucceeds(db(EDITOR).collection("statuses").add(status()));
  await assertFails(db(EDITOR).collection("statuses").add(status({ code: "XX" })));
  await assertFails(db(EDITOR).collection("statuses").add(status({ code: "TR" }))); // TR comes only from a trade
  await assertFails(db(EDITOR).collection("statuses").add(status({ start: "11/01/2026" })));
  await assertFails(db(EDITOR).collection("statuses").add(status({ end: "2026-10-01" })));
  await assertSucceeds(db(EDITOR).collection("tourChanges").add({ pos: "10EOC03M", tour: 12, effective: "2026-12-01" }));
  await assertFails(db(EDITOR).collection("tourChanges").add({ pos: "10EOC03M", tour: 32, effective: "2026-12-01" }));
  await assertFails(db(EDITOR).collection("covers").add({ coverKey: "a", targetPos: "a", start: "2026-11-01" }));
  await assertFails(db(EDITOR).collection("covers").add({ coverKey: "a", targetPos: "b", start: "2026-11-01", kind: "boss" }));
  await assertSucceeds(db(EDITOR).collection("covers").add({ coverKey: "a", targetPos: "b", start: "2026-11-01", kind: "acting" }));
  await assertFails(db(EDITOR).collection("people").add({ name: "New,A", rank: "Firefighter", emplId: "bad" }));
  await assertSucceeds(db(EDITOR).collection("people").add({ name: "New,A", rank: "Firefighter", emplId: "AB1234", tour: 5 }));
  await assertSucceeds(db(ADMIN).collection("statuses").add(status({ code: "TR" })));
  await assertFails(db(EDITOR).doc("rosterOverrides/10EOC03M").set({ name: "X" }));
  await assertSucceeds(db(ADMIN).doc("rosterOverrides/10EOC03M").set({ name: "X" }));
});

test("cell numbers are admin-only", async () => {
  for (const who of [MEMBER, EDITOR, PENDING]) {
    await assertFails(db(who).doc("staffCells/10EOC03M").get());
    await assertFails(db(who).collection("staffCells").get());
    await assertFails(db(who).doc("staffCells/10EOC03M").set({ cell: "415-555-0199" }));
  }
  await assertSucceeds(db(ADMIN).collection("staffCells").get());
  await assertSucceeds(db(ADMIN).doc("staffCells/11ENL01M").set({ cell: "415-555-0103" }));
});

test("profiles are private to their owner and admins", async () => {
  await assertSucceeds(db(MEMBER).doc("profiles/10EOC03M").get());
  await assertSucceeds(db(MEMBER).doc("profiles/10EOC03M").set({ birthDate: "1980-02-02", hireDate: null }));
  await assertFails(db(MEMBER).doc("profiles/11ENL01M").get());
  await assertFails(db(MEMBER).collection("profiles").get());
  await assertFails(db(EDITOR).doc("profiles/10EOC03M").get());
  await assertSucceeds(db(ADMIN).collection("profiles").get());
});

test("contact info: own, shared, or admin", async () => {
  await assertSucceeds(db(MEMBER).doc("contacts/mem1").get());
  await assertSucceeds(db(MEMBER).doc("contacts/mem2").get()); // shared
  await assertFails(db(OTHER).doc("contacts/mem1").get()); // not shared
  await assertSucceeds(db(OTHER).collection("contacts").where("share", "==", true).get());
  await assertFails(db(OTHER).collection("contacts").get());
  await assertSucceeds(db(ADMIN).collection("contacts").get());
  await assertSucceeds(db(MEMBER).doc("contacts/mem1").set({ pos: "10EOC03M", phoneMobile: "415-555-0104", share: true }));
  await assertFails(db(MEMBER).doc("contacts/mem1").set({ pos: "11ENL01M", share: true })); // someone else's seat
  await assertFails(db(MEMBER).doc("contacts/mem2").set({ pos: "10EOC03M", share: true }));
  // sharing shows only the cell: the email and other phone live in contactsPrivate (owner and admins)
  await assertFails(db(MEMBER).doc("contacts/mem1").set({ pos: "10EOC03M", phoneMobile: "415-555-0104", contactEmail: "a@b.org", share: true }));
  await assertSucceeds(db(MEMBER).doc("contactsPrivate/mem1").set({ pos: "10EOC03M", contactEmail: "a@b.org", phoneOther: null }));
  await assertSucceeds(db(MEMBER).doc("contactsPrivate/mem1").get());
  await assertFails(db(OTHER).doc("contactsPrivate/mem1").get());
  await assertFails(db(OTHER).collection("contactsPrivate").get());
  await assertFails(db(MEMBER).doc("contactsPrivate/mem1").set({ pos: "11ENL01M", contactEmail: "a@b.org" }));
  await assertSucceeds(db(ADMIN).collection("contactsPrivate").get());
});

test("accounts: read your own, change only alerts and tabs", async () => {
  await assertSucceeds(db(MEMBER).doc("users/mem1").get());
  await assertFails(db(OTHER).doc("users/mem1").get());
  await assertFails(db(MEMBER).collection("users").get());
  await assertSucceeds(db(MEMBER).doc("users/mem1").update({ alerts: { text: true, app: false, email: false, board: "off" } }));
  await assertFails(db(MEMBER).doc("users/mem1").update({ role: "admin" }));
  await assertSucceeds(db(MEMBER).doc("users/mem1").update({ pushTokens: ["tok1"] }));
  await assertFails(db(OTHER).doc("users/mem1").update({ pushTokens: ["tok2"] }));
  await assertFails(db(MEMBER).doc("alertState/mem1").get());
  await assertFails(db(MEMBER).doc("alertLog/t1").get());
  await assertFails(db(MEMBER).doc("users/mem1").update({ status: "active", pos: "11ENL01M" }));
  await assertFails(db(PENDING).doc("users/pend1").set({ status: "active", role: "admin" }));
});

test("trades: post as yourself, reply as yourself, only the poster sets or cancels", async () => {
  await assertSucceeds(db(MEMBER).collection("trades").add({ posterKey: "10EOC03M", date: "2026-11-09", status: "open", audience: { board: true, to: [] } }));
  await assertFails(db(MEMBER).collection("trades").add({ posterKey: "11ENL01M", date: "2026-11-09", status: "open" }));
  await assertFails(db(PENDING).collection("trades").add({ posterKey: "10EOC03M", status: "open" }));
  await assertSucceeds(db(OTHER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "11ENL01M", proposal: { later: true } }));
  await assertFails(db(OTHER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "10EOC03M", proposal: { later: true } }));
  // the poster records an answer they got by text; nobody else can answer for someone
  await assertSucceeds(db(MEMBER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "11ENL02M", via: "poster", proposal: { later: true } }));
  await assertFails(db(MEMBER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "11ENL02M", proposal: { later: true } }));
  await assertFails(db(OTHER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "11ENL02M", via: "poster", proposal: { later: true } }));
  // answers from an invite link, and invites themselves, are the functions' only
  await assertFails(db(MEMBER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "11ENL02M", via: "link", proposal: { later: true } }));
  await assertFails(db(OTHER).collection("tradeReplies").add({ tradeId: "t1", takerKey: "11ENL01M", verified: true, proposal: { later: true } }));
  await assertFails(db(MEMBER).doc("tradeInvites/abc").get());
  await assertFails(db(MEMBER).doc("launchInvites/11ENL01M").get());
  await assertFails(db(MEMBER).doc("launchInvites/11ENL01M").set({ via: "group" }));
  await assertSucceeds(db(ADMIN).doc("launchInvites/11ENL01M").set({ via: "group", sentAt: "x" }));
  await assertFails(db(MEMBER).doc("tradeInvites/abc").set({ tradeId: "t1", recipientKey: "11ENL02M" }));
  // the poster can mark a trade picked but waiting for the person to sign in
  await assertSucceeds(db(MEMBER).doc("trades/t1").update({ status: "pending", replyId: "link_x", takerKey: "11ENL02M", proposal: { later: true }, legs: [] }));
  await assertFails(db(OTHER).doc("trades/t1").update({ status: "set", takerKey: "11ENL01M" }));
  await assertSucceeds(db(MEMBER).doc("trades/t1").update({ status: "set", takerKey: "11ENL01M", replyId: "r1", setAt: "x", legs: [] }));
  await assertFails(db(MEMBER).doc("trades/t1").update({ posterKey: "11ENL01M" }));
  await assertFails(db(MEMBER).doc("trades/t1").update({ date: "2026-12-01" }));
  // posting again for the same day re-opens the cancelled trade, only by its poster
  await assertSucceeds(db(MEMBER).doc("trades/t1").update({ status: "cancelled", cancelledAt: "x" }));
  const reopen = { status: "open", audience: { board: true, to: [] }, note: "again", seatPos: "10EOC03M", reopenedAt: "y",
    replyId: null, takerKey: null, proposal: null, setAt: null, cancelledAt: null, legs: [] };
  await assertFails(db(OTHER).doc("trades/t1").update(reopen));
  await assertSucceeds(db(MEMBER).doc("trades/t1").update(reopen));
});

test("admins post a trade for someone, record answers and pick; members can't post for others", async () => {
  const rec = { posterKey: "11ENL01M", posterName: "Other", seatPos: "11ENL01M", date: "2026-12-10", note: "", status: "open",
    audience: { board: true, to: [] }, postedBy: "admin", createdBy: "admin1", createdAt: "x" };
  await assertFails(db(MEMBER).doc("trades/a1").set(rec));
  await assertSucceeds(db(ADMIN).doc("trades/a1").set(rec));
  await assertSucceeds(db(ADMIN).collection("tradeReplies").add({ tradeId: "a1", takerKey: "10EOC03M", via: "poster", proposal: { later: true } }));
  await assertSucceeds(db(ADMIN).doc("trades/a1").update({ status: "set", takerKey: "10EOC03M", replyId: "r1", setAt: "x", legs: [] }));
  // the person it's for can still manage it once they're on the tool
  await assertSucceeds(db(OTHER).doc("trades/a1").update({ status: "cancelled", cancelledAt: "x" }));
});

test("a set trade's legs: only the taker on the posted seat and the poster TR (and the reverse on a swap day)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await d.doc("trades/t2").set({ posterKey: "10EOC03M", seatPos: "10EOC03M", date: "2026-11-05", status: "open", audience: { board: true, to: [] } });
    await d.doc("tradeReplies/r2").set({ tradeId: "t2", takerKey: "11ENL01M", proposal: { later: true } });
    await d.doc("tradeReplies/r3").set({ tradeId: "t2", takerKey: "11ENL01M", proposal: { swapDate: "2026-11-20" } });
  });
  const cover = (who, seat, day) => ({ kind: "covers", coverKey: who, coverName: "X", targetPos: seat, start: day, end: day, note: "Shift trade" });
  const tr = (who, day) => ({ kind: "statuses", pos: who, name: "X", code: "TR", start: day, end: day, note: "Shift trade" });
  const set = (extra) => Object.assign({ status: "set", replyId: "r2", takerKey: "11ENL01M", proposal: { later: true }, setAt: "x",
    legs: [cover("11ENL01M", "10EOC03M", "2026-11-05"), tr("10EOC03M", "2026-11-05")] }, extra);
  await assertFails(db(MEMBER).doc("trades/t2").update(set({ legs: [cover("11ENL01M", "10EOC03M", "2026-11-05"), tr("12ENL01M", "2026-11-05")] }))); // someone else TR
  await assertFails(db(MEMBER).doc("trades/t2").update(set({ legs: [cover("11ENL01M", "20EOC01M", "2026-11-05"), tr("10EOC03M", "2026-11-05")] }))); // another seat
  await assertFails(db(MEMBER).doc("trades/t2").update(set({ legs: [cover("11ENL01M", "10EOC03M", "2026-11-05"), tr("10EOC03M", "2026-11-06")] }))); // two days
  await assertFails(db(MEMBER).doc("trades/t2").update(set({ takerKey: "12ENL01M", legs: [cover("12ENL01M", "10EOC03M", "2026-11-05"), tr("10EOC03M", "2026-11-05")] }))); // didn't answer
  await assertFails(db(MEMBER).doc("trades/t2").update(set({ legs: [Object.assign(tr("11ENL01M", "2026-11-05"), { code: "VA" }), tr("10EOC03M", "2026-11-05")] })));
  const swap = set({ replyId: "r3", proposal: { swapDate: "2026-11-20" }, legs: [cover("11ENL01M", "10EOC03M", "2026-11-05"), tr("10EOC03M", "2026-11-05"),
    cover("10EOC03M", "11ENL01M", "2026-11-20"), tr("11ENL01M", "2026-11-20")] });
  await assertSucceeds(db(MEMBER).doc("trades/t2").update(swap));
  await assertSucceeds(db(MEMBER).doc("trades/t2").update(set()));
  await assertSucceeds(db(MEMBER).doc("trades/t2").update({ status: "cancelled", cancelledAt: "x" }));
});

test("corrections: each member their own; editors and admins all", async () => {
  await assertSucceeds(db(MEMBER).doc("corrections/mem1").get());
  await assertSucceeds(db(MEMBER).doc("corrections/mem1").set({ items: { b: { state: "open" } } }, { merge: true }));
  await assertFails(db(OTHER).doc("corrections/mem1").get());
  await assertFails(db(OTHER).collection("corrections").get());
  await assertSucceeds(db(EDITOR).collection("corrections").get());
});

test("feedback: each member their own; editors and admins all", async () => {
  await assertSucceeds(db(MEMBER).doc("feedback/mem1").get());
  await assertSucceeds(db(MEMBER).doc("feedback/mem1").set({ items: { b: { state: "open", kind: "problem", text: "y" } } }, { merge: true }));
  await assertFails(db(OTHER).doc("feedback/mem1").get());
  await assertFails(db(OTHER).collection("feedback").get());
  await assertFails(db(PENDING).doc("feedback/mem1").get());
  await assertSucceeds(db(EDITOR).collection("feedback").get());
});

test("overtime: everyone reads the marks; notes only the member and admins; admins mark anyone's seat", async () => {
  const mark = (extra) => Object.assign({ pos: "10EOC03M", name: "A", days: { "2026-11-03": { kind: "worked", hours: 24 } } }, extra);
  await assertSucceeds(db(MEMBER).doc("overtime/mem1").set(mark()));
  await assertFails(db(MEMBER).doc("overtime/mem1").set(mark({ pos: "11ENL01M" })));   // someone else's seat
  await assertFails(db(MEMBER).doc("overtime/mem2").set(mark()));                      // someone else's record
  await assertFails(db(MEMBER).doc("overtime/seat-11ENL01M").set(mark({ pos: "11ENL01M" })));
  await assertSucceeds(db(OTHER).doc("overtime/mem1").get());                           // marks are public
  await assertSucceeds(db(OTHER).collection("overtime").get());
  await assertFails(db(PENDING).collection("overtime").get());
  await assertSucceeds(db(MEMBER).doc("overtimeNotes/mem1").set({ pos: "10EOC03M", notes: { "2026-11-03": "Hired E7" } }));
  await assertFails(db(OTHER).doc("overtimeNotes/mem1").get());                         // notes are private
  await assertFails(db(EDITOR).collection("overtimeNotes").get());
  await assertSucceeds(db(ADMIN).collection("overtimeNotes").get());
  await assertSucceeds(db(ADMIN).doc("overtime/seat-11ENL01M").set(mark({ pos: "11ENL01M" })));
  await assertSucceeds(db(MEMBER).doc("overtime/mem1").delete());
});

test("leave bank: the member's own seat (with consent) and admins only", async () => {
  const bank = (extra) => Object.assign({ asOf: "2026-10-09", sp: 100, va: 200, tc: 50, tcUsed: [], source: "member", consentAt: "2026-10-24T00:00:00Z", consentVersion: 1 }, extra);
  await assertSucceeds(db(MEMBER).doc("leaveBanks/10EOC03M").set(bank()));
  await assertSucceeds(db(MEMBER).doc("leaveBanks/10EOC03M").get());
  await assertFails(db(MEMBER).doc("leaveBanks/11ENL01M").set(bank()));                   // someone else's seat
  await assertFails(db(MEMBER).doc("leaveBanks/10EOC03M").set(bank({ va: 9999 })));       // over the cap
  await assertFails(db(MEMBER).doc("leaveBanks/10EOC03M").set(bank({ consentAt: null }))); // no consent
  await assertFails(db(MEMBER).doc("leaveBanks/10EOC03M").set(bank({ source: "import" })));
  await assertFails(db(OTHER).doc("leaveBanks/10EOC03M").get());
  await assertFails(db(EDITOR).collection("leaveBanks").get());
  await assertSucceeds(db(ADMIN).collection("leaveBanks").get());
  await assertSucceeds(db(ADMIN).doc("leaveBanks/11ENL01M").set(bank({ source: "import", consentAt: null })));
  await assertSucceeds(db(MEMBER).doc("leaveBanks/10EOC03M").delete());
});

test("site mode: everyone approved reads it, only admins set it", async () => {
  await assertSucceeds(db(MEMBER).doc("settings/site").get());
  await assertFails(db(PENDING).doc("settings/site").get());
  await assertFails(db(EDITOR).doc("settings/site").set({ mode: "live" }));
  await assertSucceeds(db(ADMIN).doc("settings/site").set({ mode: "live" }));
});

test("audit is admin-read, never written from a page", async () => {
  await assertFails(db(MEMBER).doc("audit/a1").get());
  await assertSucceeds(db(ADMIN).doc("audit/a1").get());
  await assertFails(db(ADMIN).collection("audit").add({ action: "y" }));
});

test("announcements: admins read the history; nobody writes them from a page", async () => {
  await assertSucceeds(db(ADMIN).doc("announcements/n1").get());
  await assertSucceeds(db(ADMIN).collection("announcements").get());
  for (const who of [EDITOR, MEMBER, PENDING, null]) {
    await assertFails(db(who).doc("announcements/n1").get());
    await assertFails(db(who).collection("announcements").get());
  }
  await assertFails(db(ADMIN).collection("announcements").add({ title: "x", message: "y" }));
  await assertFails(db(ADMIN).doc("announcements/n1").update({ title: "z" }));
  await assertFails(db(ADMIN).doc("announcements/n1").delete());
});

test("notices: each member reads and dismisses their own; items come only from the function", async () => {
  await assertSucceeds(db(MEMBER).doc("notices/mem1").get());
  await assertFails(db(OTHER).doc("notices/mem1").get());
  await assertFails(db(OTHER).collection("notices").get());
  await assertFails(db(PENDING).doc("notices/pend1").get());
  await assertSucceeds(db(ADMIN).doc("notices/mem1").get());
  await assertSucceeds(db(MEMBER).doc("notices/mem1").set({ dismissed: { n1: true } }, { merge: true }));
  await assertFails(db(MEMBER).doc("notices/mem1").set({ items: { n2: { title: "Fake" } } }, { merge: true }));
  await assertFails(db(MEMBER).doc("notices/mem1").set({ dismissed: "all" }, { merge: true }));
  await assertFails(db(OTHER).doc("notices/mem1").set({ dismissed: { n1: true } }, { merge: true }));
  await assertFails(db(MEMBER).doc("notices/mem1").delete());
  await assertFails(db(OTHER).doc("notices/mem2").set({ items: { n2: { title: "Fake" } } }));
});

test("storage: roster files and PDFs for approved accounts only", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("data/positions.json").put(Buffer.from("[]"), { contentType: "application/json" });
  });
  await assertSucceeds(as(MEMBER).storage().ref("data/positions.json").getMetadata());
  await assertFails(as(PENDING).storage().ref("data/positions.json").getMetadata());
  await assertFails(env.unauthenticatedContext().storage().ref("data/positions.json").getMetadata());
  await assertFails(as(ADMIN).storage().ref("data/positions.json").put(Buffer.from("[]")));
});
