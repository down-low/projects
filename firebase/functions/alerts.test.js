// Run: node --test firebase/functions/alerts.test.js  (no dependencies; uses the real roster in data/)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./alerts");
const rows = require("../../data/positions.json");

// Ribeiro (FF/Paramedic) works Sat Nov 14 2026; these three FF/Paramedics are off that day; the Lieutenant is off too
// but in another rank group; 01EOA07M works that day.
const POSTER = "11EOA13M", OFF = ["01EOA06M", "11EOA14M", "01EOA08M"], LT = "01EOL02M", WORKING = "01EOA07M";
const world = A.buildWorld(rows, [], [], {});
const member = (board) => ({ uid: "u", alerts: { board: board || "off" } });
const members = (o) => new Map(Object.entries(o));
const TRADE = { posterKey: POSTER, seatPos: POSTER, date: "2026-11-14", status: "open", note: "Family event",
  audience: { board: false, to: [OFF[0], OFF[1]] }, createdAt: "2026-10-20T10:00:00.000Z" };
const TODAY = "2026-10-20";

test("a trade sent to people alerts the ones with accounts, once", () => {
  const m = members({ [OFF[0]]: member(), [POSTER]: member() });
  const first = A.tradeAlerts(TRADE, {}, m, world, TODAY);
  assert.deepEqual(first.alerts, [{ pos: OFF[0], kind: "sent" }]);
  assert.deepEqual(A.tradeAlerts(TRADE, first.log, m, world, TODAY).alerts, []);
  // widened to one more person: only the new one
  m.set(OFF[2], member());
  const wider = Object.assign({}, TRADE, { audience: { board: false, to: TRADE.audience.to.concat([OFF[2]]) } });
  assert.deepEqual(A.tradeAlerts(wider, first.log, m, world, TODAY).alerts, [{ pos: OFF[2], kind: "sent" }]);
});

test("board posts alert members set to 'each' who could take it, not other rank groups or people working", () => {
  const t = Object.assign({}, TRADE, { audience: { board: true, to: [OFF[0]] } });
  const m = members({ [OFF[0]]: member("each"), [OFF[1]]: member("each"), [OFF[2]]: member("off"), [LT]: member("each"), [WORKING]: member("each") });
  const got = A.tradeAlerts(t, {}, m, world, TODAY).alerts;
  assert.deepEqual(got, [{ pos: OFF[0], kind: "sent" }, { pos: OFF[1], kind: "board" }]);
});

test("picked and cancelled go to the taker", () => {
  const m = members({ [OFF[0]]: member() });
  const sent = A.tradeAlerts(TRADE, {}, m, world, TODAY);
  const set = Object.assign({}, TRADE, { status: "set", takerKey: OFF[0], proposal: { later: true } });
  const picked = A.tradeAlerts(set, sent.log, m, world, TODAY);
  assert.deepEqual(picked.alerts, [{ pos: OFF[0], kind: "picked" }]);
  const gone = A.tradeAlerts(Object.assign({}, set, { status: "cancelled" }), picked.log, m, world, TODAY);
  assert.deepEqual(gone.alerts, [{ pos: OFF[0], kind: "cancelled" }]);
});

test("a past or closed trade alerts nobody new", () => {
  const m = members({ [OFF[0]]: member() });
  assert.deepEqual(A.tradeAlerts(TRADE, {}, m, world, "2026-11-15").alerts, []);
  assert.deepEqual(A.tradeAlerts(Object.assign({}, TRADE, { status: "cancelled" }), {}, m, world, TODAY).alerts, []);
});

test("the daily summary lists new board posts each 'daily' member could take", () => {
  const t = Object.assign({}, TRADE, { audience: { board: true, to: [] } });
  const m = members({ [OFF[0]]: member("daily"), [OFF[1]]: member("each"), [LT]: member("daily") });
  const by = A.dailyDigest([t, Object.assign({}, t, { createdAt: "2026-10-01T00:00:00.000Z" })], m, world, "2026-10-19T14:00:00.000Z", TODAY);
  assert.deepEqual(Array.from(by.keys()), [OFF[0]]);
  assert.equal(by.get(OFF[0]).length, 1);
  assert.match(A.digestMessage(by.get(OFF[0]), world).text, /1 new trade on the board[\s\S]*Sat Nov 14: Ribeiro,J/);
});

test("messages carry the details and the text-reply codes", () => {
  const me = world.byPos[OFF[0]];
  const sent = A.message("sent", { trade: TRADE, world, me });
  assert.match(sent.text, /^Ribeiro,J \(FF\/Paramedic · E11\) wants a 24-hr trade for Sat Nov 14 at E11\. "Family event" You're off that day\./);
  assert.match(sent.sms, /Reply 1 = interested, pay back later · 2 and a date = swap \(e\.g\. 2 11\/14\)$/);
  const ans = A.message("answer", { trade: TRADE, world, reply: { takerKey: OFF[0], proposal: { swapDate: "2026-11-23" } } });
  assert.match(ans.text, /can take your Sat Nov 14\. Swap: you work their Mon Nov 23\./);
  assert.match(ans.sms, /Reply PICK/);
  const picked = A.message("picked", { trade: Object.assign({}, TRADE, { status: "set", proposal: { later: true } }), world });
  assert.match(picked.text, /Ribeiro,J picked you for Sat Nov 14 at E11\. Pay back later\. It's on the schedule\./);
});

test("pick legs: cover and TR, the other way on a swap day; refused when the taker works", () => {
  const ctx = { byPos: world.byPos, opts: world.opts, today: TODAY };
  const later = A.M.pickLegs(TRADE, { takerKey: OFF[0], proposal: { later: true } }, ctx);
  assert.deepEqual(later.map((w) => [w.kind, w.rec.coverKey || w.rec.pos, w.rec.start]), [["covers", OFF[0], "2026-11-14"], ["statuses", POSTER, "2026-11-14"]]);
  const swap = A.M.pickLegs(TRADE, { takerKey: OFF[0], proposal: { swapDate: "2026-11-23" } }, ctx);
  assert.equal(swap.length, 4);
  assert.deepEqual([swap[2].rec.coverKey, swap[2].rec.targetPos, swap[3].rec.pos], [POSTER, OFF[0], OFF[0]]);
  assert.match(A.M.pickLegs(TRADE, { takerKey: WORKING, proposal: { later: true } }, ctx), /works that day/);
});

test("one-tap links: signed, expire, can't be altered", () => {
  const tok = A.signToken({ u: "uid1", k: "later", t: "trade1" }, "secret", 1000);
  assert.deepEqual((({ u, k, t }) => ({ u, k, t }))(A.readToken(tok, "secret", 2000)), { u: "uid1", k: "later", t: "trade1" });
  assert.equal(A.readToken(tok, "other", 2000), null);
  assert.equal(A.readToken(tok, "secret", 1000 + 8 * 864e5), null);
  assert.equal(A.readToken(tok.replace(/^./, "x"), "secret", 2000), null);
});

test("text replies", () => {
  assert.deepEqual(A.parseSms("1", TODAY), { kind: "later" });
  assert.deepEqual(A.parseSms(" 2 11/20 ", TODAY), { kind: "swap", date: "2026-11-20" });
  assert.deepEqual(A.parseSms("2 Jan 5", TODAY), { kind: "swap", date: "2027-01-05" });
  assert.deepEqual(A.parseSms("pick", TODAY), { kind: "pick" });
  assert.deepEqual(A.parseSms("STOP", TODAY), { kind: "stop" });
  assert.equal(A.parseSms("11/20", TODAY), null);
  assert.equal(A.parseSms("2 13/40", TODAY), null);
  assert.equal(A.phoneKey("+1 (415) 555-0110"), "4155550110");
  assert.equal(A.e164("(415) 555-0110"), "+14155550110");
  // the request-validation example used in Twilio's own library tests
  assert.equal(A.twilioSignature("https://mycompany.com/myapp.php?foo=1&bar=2",
    { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" }, "12345"),
    "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
});

test("answers from an alert or a text follow the page's rules", () => {
  const me = world.byPos[OFF[0]];
  assert.deepEqual(A.answerCheck(TRADE, me, { later: true }, world, TODAY), { swapSeatPos: null });
  assert.deepEqual(A.answerCheck(TRADE, me, { swapDate: "2026-11-23" }, world, TODAY), { swapSeatPos: OFF[0] });
  assert.match(A.answerCheck(TRADE, me, { swapDate: "2026-11-14" }, world, TODAY).error, /later day/);
  assert.match(A.answerCheck(TRADE, world.byPos[WORKING], { later: true }, world, TODAY).error, /can't take/);
  assert.match(A.answerCheck(TRADE, world.byPos[LT], { later: true }, world, TODAY).error, /rank group/);
  assert.match(A.answerCheck(TRADE, world.byPos[POSTER], { later: true }, world, TODAY).error, /own trade/);
});
