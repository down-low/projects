/* Trade alerts: who gets which alert and what it says, signed one-tap links, and text-reply parsing. Kept free of
 * Firebase so it can be tested with `node --test`; index.js reads the records and sends.
 *
 * Alerts (each goes out on the channels the person switched on under Trades -> Alerts: users/{uid}.alerts):
 *   sent     a trade sent to you (always)            answer   an answer to your trade (always)
 *   board    a new board post you could take (Board posts: "each"); "daily" gets one summary a day instead
 *   picked   your answer was picked (always)          cancelled  a set trade you were in was cancelled (always)
 * alertLog/{tradeId}: {to: [keys alerted], board: bool, status, taker} so asking twice never alerts twice.
 */
"use strict";
const crypto = require("crypto");
const M = loadSchedule();

function loadSchedule() {
  // The deploy copies schedule.js next to this file (tools/build_firebase.py); in the repo it's two folders up.
  try { return require("./lib/schedule.js"); } catch (e) { return require("../../schedule.js"); }
}

/* ---------- The schedule as the page sees it ---------- */
// rows: positions.json; people: added people docs [{id, name, rank, company, tour, emplId}]; overrides: rosterOverrides
// docs [{id, name, rank, emplId, forName}]; recs: {statuses, covers, tourChanges, trades}.
function buildWorld(rows, people, overrides, recs) {
  const over = new Map(overrides.map((o) => [o.id, o]));
  const byPos = {};
  const list = [];
  rows.forEach((r) => {
    const o = over.get(r.pos);
    const use = o && (!o.forName || o.forName === r.name) ? o : null;
    const p = Object.assign({}, r, { name: (use && use.name) || r.name, rank: (use && use.rank) || r.rank });
    byPos[p.pos] = p;
    if (p.name) list.push(p);
  });
  people.forEach((x) => {
    const p = { pos: "person:" + x.id, name: x.name, rank: x.rank, title: x.rank + (x.company ? " " + x.company : "") + " (added)",
      company: x.company || null, tour: x.tour || null, added: true };
    byPos[p.pos] = p;
    list.push(p);
  });
  const legs = (kind) => (recs.trades || []).filter((t) => t.status === "set" && t.legs)
    .reduce((out, t) => out.concat(t.legs.filter((l) => l.kind === kind)), []);
  const opts = { statuses: (recs.statuses || []).concat(legs("statuses")), covers: (recs.covers || []).concat(legs("covers")),
    changes: recs.tourChanges || [], byPos };
  return { byPos, people: list, opts };
}
const home = (p) => (p && (p.company || p.title)) || "";

/* ---------- Who gets what ----------
   members: Map pos -> {uid, alerts}; active accounts only. log: the trade's alertLog (or {}). Returns
   {alerts: [{pos, kind}], log: the new log}. */
function tradeAlerts(trade, log, members, world, today) {
  log = log || {};
  const out = [];
  const to = (trade.audience && trade.audience.to) || [];
  const sentBefore = new Set(log.to || []);
  const open = trade.status === "open" && trade.date >= today;
  if (open) {
    to.forEach((k) => { if (!sentBefore.has(k) && members.has(k) && k !== trade.posterKey) out.push({ pos: k, kind: "sent" }); });
    if (trade.audience && trade.audience.board && !log.board) {
      boardTakers(trade, members, world, "each").forEach((k) => { if (to.indexOf(k) === -1) out.push({ pos: k, kind: "board" }); });
    }
  }
  const was = log.status || "open";
  if ((trade.status === "set" || trade.status === "pending") && was === "open" && members.has(trade.takerKey)) out.push({ pos: trade.takerKey, kind: "picked" });
  if (trade.status === "cancelled" && (was === "set" || was === "pending") && log.taker && members.has(log.taker)) out.push({ pos: log.taker, kind: "cancelled" });
  const next = { to: Array.from(new Set((log.to || []).concat(open ? to : []))), board: !!(log.board || (open && trade.audience && trade.audience.board)),
    status: trade.status, taker: trade.takerKey || log.taker || null };
  return { alerts: out, log: next };
}
// Members with the given Board posts setting who could take the trade (same rank group, off that day, no status).
function boardTakers(trade, members, world, setting) {
  const poster = world.byPos[trade.posterKey];
  if (!poster) return [];
  const want = world.people.filter((p) => p.pos !== trade.posterKey && members.has(p.pos) && (members.get(p.pos).alerts || {}).board === setting);
  return M.eligibleTakers(M.fromIsoDate(trade.date), poster, { people: want, opts: world.opts }).map((e) => e.p.pos);
}
// The daily summary: for each member set to "daily", the board posts from the last day they could take.
function dailyDigest(trades, members, world, sinceIso, today) {
  const fresh = trades.filter((t) => t.status === "open" && t.date >= today && t.audience && t.audience.board && String(t.createdAt || "") >= sinceIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  const by = new Map();
  fresh.forEach((t) => boardTakers(t, members, world, "daily").forEach((k) => { if (!by.has(k)) by.set(k, []); by.get(k).push(t); }));
  return by;
}

/* Why `me` can't answer `trade` this way, or null; for a swap also the seat they'd work that day. Same rules as the page:
   same rank group, off that day, no status; a swap day is a later day they work and the poster is free.
   Returns {error} or {swapSeatPos}. */
function answerCheck(trade, me, proposal, world, today) {
  const poster = world.byPos[trade.posterKey];
  if (!me || !poster) return { error: "You're not linked to the roster yet." };
  if (trade.status !== "open" || trade.date < today) return { error: "This trade is no longer open." };
  if (me.pos === trade.posterKey) return { error: "That's your own trade." };
  if (!M.eligibleTakers(M.fromIsoDate(trade.date), poster, { people: [me], opts: world.opts }).length) {
    return { error: "You can't take this shift: you work that day, are marked off, or are in another rank group." };
  }
  if (!proposal || !proposal.swapDate) return { swapSeatPos: null };
  const sw = proposal.swapDate, d = M.fromIsoDate(sw);
  if (sw < today || sw === trade.date) return { error: "Pick a later day for the swap, not the traded day." };
  const seat = M.seatWorked(me, d, world.opts);
  if (!seat) return { error: "You don't work " + shortDate(sw) + ". Pick one of your shifts." };
  const own = poster.added && !poster.tour ? null : poster;
  if (M.dayFor(poster.pos, own, d, world.opts) || M.statusFor(poster.pos, d, world.opts.statuses)) return { error: poster.name + " isn't free on " + shortDate(sw) + "." };
  return { swapSeatPos: seat };
}

/* ---------- What it says ---------- */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso) { const d = M.fromIsoDate(iso); return DOW[d.getDay()] + " " + MON[d.getMonth()] + " " + d.getDate(); }
function whoText(p) { return p ? p.name + " (" + [p.rank, home(p)].filter(Boolean).join(" · ") + ")" : "Someone"; }
function termsText(prop, forPoster) {
  if (!prop) return "";
  if (prop.later) return "Pay back later";
  return forPoster ? "Swap: you work their " + shortDate(prop.swapDate) : "Swap: they work your " + shortDate(prop.swapDate);
}
/* {subject, text, sms} for one alert. ctx: {trade, reply, me (the recipient's person), world}. */
function message(kind, ctx) {
  const t = ctx.trade, w = ctx.world, poster = w.byPos[t.posterKey], seat = w.byPos[t.seatPos], when = shortDate(t.date);
  const at = seat ? " at " + home(seat) : "";
  const note = t.note ? ' "' + t.note + '"' : "";
  let adj = "";
  if (ctx.me && (kind === "sent" || kind === "board")) {
    const a = M.adjacentWork(ctx.me, M.fromIsoDate(t.date), w.opts);
    adj = a.before && a.after ? " You work the day before and the day after." : a.before ? " You work the day before." : a.after ? " You work the day after." : "";
  }
  const reply = " Reply 1 = interested, pay back later · 2 and a date = swap (e.g. 2 " + (M.fromIsoDate(t.date).getMonth() + 1) + "/" + M.fromIsoDate(t.date).getDate() + ")";
  if (kind === "sent" || kind === "board") {
    const text = whoText(poster) + " wants a 24-hr trade for " + when + at + "." + note + " You're off that day." + adj;
    return { subject: "Shift trade: " + when + (kind === "board" ? " (board)" : ""), text, sms: text + reply };
  }
  if (kind === "answer") {
    const taker = w.byPos[ctx.reply.takerKey];
    const text = whoText(taker) + " can take your " + when + ". " + termsText(ctx.reply.proposal, true) + "." + (ctx.reply.note ? ' "' + ctx.reply.note + '"' : "") +
      (ctx.reply.via === "link" && !ctx.reply.verified ? " (From their invite link; not verified yet.)" : "");
    return { subject: "Answer to your trade: " + when, text, sms: text + " Reply PICK to pick them." };
  }
  if (kind === "picked") {
    const text = (poster ? poster.name : "The poster") + " picked you for " + when + at + ". " + termsText(t.proposal, false) + "." +
      (t.status === "pending" ? " Sign in from your invite link to confirm." : " It's on the schedule.");
    return { subject: "Trade set: " + when, text, sms: text };
  }
  if (kind === "cancelled") {
    const text = "The trade for " + when + at + " with " + (poster ? poster.name : "the poster") + " was cancelled. It's off the schedule.";
    return { subject: "Trade cancelled: " + when, text, sms: text };
  }
  throw new Error("unknown alert " + kind);
}
function digestMessage(trades, world) {
  const lines = trades.map((t) => "· " + shortDate(t.date) + ": " + whoText(world.byPos[t.posterKey]) + (t.note ? ' "' + t.note + '"' : ""));
  const text = (trades.length === 1 ? "1 new trade" : trades.length + " new trades") + " on the board you could take:\n" + lines.join("\n");
  return { subject: "Trade board: " + trades.length + " new", text, sms: text };
}

/* ---------- One-tap links ----------
   A token names one person, one action and one trade (and answer, for a pick); it's signed with ALERT_KEY and good
   for 7 days. alertAction shows a confirm button first (mail scanners open links), then acts once. */
const b64 = (s) => Buffer.from(s).toString("base64url");
function signToken(payload, key, nowMs) {
  const body = b64(JSON.stringify(Object.assign({}, payload, { e: (nowMs || Date.now()) + 7 * 864e5, n: crypto.randomBytes(6).toString("base64url") })));
  return body + "." + crypto.createHmac("sha256", key).update(body).digest("base64url");
}
function readToken(token, key, nowMs) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !key) return null;
  const want = crypto.createHmac("sha256", key).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
  return p && p.e >= (nowMs || Date.now()) ? p : null;
}

/* ---------- Text replies ----------
   "1" -> pay back later; "2 11/20" (or 2 11-20, 2 Nov 20) -> swap that day, the next one on or after today; "PICK".
   Returns {kind: "later"} | {kind: "swap", date} | {kind: "pick"} | {kind: "stop"} | null. */
function parseSms(body, today) {
  const s = String(body || "").trim().toLowerCase();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)$/.test(s)) return { kind: "stop" };
  if (/^pick\b/.test(s)) return { kind: "pick" };
  if (/^1(\s|$|[^\d/])/.test(s)) return { kind: "later" };
  const m = /^2\s+(?:(\d{1,2})[/\-.](\d{1,2})|([a-z]{3})[a-z]*\.?\s*(\d{1,2}))$/.exec(s);
  if (!m) return null;
  const month = m[1] ? +m[1] : MON.map((x) => x.toLowerCase()).indexOf(m[3]) + 1, day = +(m[2] || m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = +today.slice(0, 4);
  const iso = (yy) => yy + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  return { kind: "swap", date: iso(y) >= today ? iso(y) : iso(y + 1) };
}
// Phone numbers compared by their last 10 digits.
// Phone numbers as typed become +1XXXXXXXXXX (the first US number in the text), compared by their 10 digits.
const { normCell } = require("./accounts");
const e164 = (n) => normCell(n);
const phoneKey = (n) => { const c = normCell(n); return c ? c.slice(2) : ""; };
// Twilio's request signature: HMAC-SHA1 over the full URL plus the sorted POST parameters.
function twilioSignature(url, params, token) {
  const data = Object.keys(params).sort().reduce((s, k) => s + k + params[k], url);
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

module.exports = { buildWorld, answerCheck, tradeAlerts, boardTakers, dailyDigest, message, digestMessage, signToken, readToken, parseSms,
  phoneKey, e164, twilioSignature, shortDate, termsText, M };
