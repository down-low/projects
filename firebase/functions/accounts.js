/* Account rules for the Firebase functions, kept free of Firebase so they can be tested with `node --test` anywhere.
 * They follow server.py: sign_in, me_json, claim, roster_names, admin_action, clean_person_fields and stats.
 * index.js does the reads and writes; these functions only decide.
 *
 * users/{uid}: {email, name, status: pending|active|disabled, role: member|editor|admin, pos, claimPos, claimNote,
 *               claimRequest, alerts, createdAt, lastLogin}
 * Custom claims (what firestore.rules and storage.rules check): {active, role, pos}.
 */
"use strict";

const ROLES = ["member", "editor", "admin"];
const RANKS = ["Battalion Chief", "Rescue Captain", "Captain", "Lieutenant", "ISS", "FF/Paramedic", "Firefighter", "Pilot", "Marine Engineer"];
const COMPANY_RE = /^[A-Z]{1,3}\d{1,2}$/;
const EMPL_ID_RE = /^[A-Z]{2}\d{4}$/; // SFFD employee ID, e.g. LE1234
const PERSON_PREFIX = "person:";
const BOARD_ALERTS = ["off", "daily", "each"];

class AccountError extends Error {
  // code is a Firebase HttpsError code; reason (optional) tells the sign-in screen what to say.
  constructor(code, message, reason) {
    super(message);
    this.code = code;
    this.reason = reason || null;
  }
}
const bad = (message) => new AccountError("invalid-argument", message);

// "a@x.org, B@y.org" -> ["a@x.org", "b@y.org"]
function parseList(value) {
  return String(value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function emailAllowed(email, domains) {
  if (!domains.length) return true;
  const at = email.lastIndexOf("@");
  return at !== -1 && domains.indexOf(email.slice(at + 1)) !== -1;
}

/* First sign-in creates the account (pending, or an active admin for ADMIN_EMAILS); later sign-ins refresh the email,
   name and lastLogin, and make ADMIN_EMAILS admins again. Returns {user, created}. */
function signIn(existing, { email, name, isAdmin, allowed, now }) {
  if (!allowed && !isAdmin) throw new AccountError("permission-denied", "That Google account isn't from an allowed domain.", "domain");
  if (!existing) {
    return {
      created: true,
      user: { email, name: name || email, role: isAdmin ? "admin" : "member", status: isAdmin ? "active" : "pending", pos: null,
        claimPos: null, claimNote: null, claimRequest: null, createdAt: now, lastLogin: now },
    };
  }
  if (existing.status === "disabled") throw new AccountError("permission-denied", "This account has been disabled.", "disabled");
  const user = Object.assign({}, existing, { email, name: name || existing.name || email, lastLogin: now });
  if (isAdmin) Object.assign(user, { role: "admin", status: "active" });
  return { created: false, user };
}

function claimsFor(user) {
  return { active: user.status === "active", role: ROLES.indexOf(user.role) !== -1 ? user.role : "member", pos: user.pos || null };
}
function claimsEqual(a, b) {
  a = a || {}; b = b || {};
  return a.active === b.active && a.role === b.role && (a.pos || null) === (b.pos || null);
}

/* The /api/me shape the screens use (admin.js). lookup(key) -> {name, ...} or null; contact and profile are the
   user's own records, or null. */
function meJson(uid, u, { lookup, contact, profile }) {
  const pos = u.pos ? lookup(u.pos) : null;
  const claim = u.claimPos ? lookup(u.claimPos) : null;
  const c = contact || {};
  const alerts = u.alerts || {};
  return {
    signedIn: true, id: uid, name: u.name, googleEmail: u.email, role: u.role, status: u.status,
    pos: u.pos || null, posName: (pos && pos.name) || null,
    claimPos: u.claimPos || null, claimName: (claim && claim.name) || null, claimNote: u.claimNote || null,
    contactEmail: c.contactEmail || null, phoneMobile: c.phoneMobile || null, phoneOther: c.phoneOther || null, shareContact: !!c.share,
    claimRequest: u.claimRequest || null,
    profile: u.pos ? { birthDate: (profile && profile.birthDate) || null, hireDate: (profile && profile.hireDate) || null } : null,
    alerts: { text: !!alerts.text, app: !!alerts.app, email: !!alerts.email, board: BOARD_ALERTS.indexOf(alerts.board) !== -1 ? alerts.board : "off" },
  };
}

function cleanText(value, field, limit) {
  if (value == null) return "";
  if (typeof value !== "string") throw bad(field + " must be text");
  return value.trim().slice(0, limit || 500);
}

/* "I'm not on the list": the same checks as server.py's clean_person_fields. companies: the set of roster companies;
   emplOwner(id) -> the name already holding that Employee ID, or null. */
function cleanPersonRequest(body, { companies, emplOwner }) {
  body = body || {};
  const name = cleanText(body.name, "name", 80);
  if (name.length < 2) throw bad("Enter the person's name (Last,First initial works best, e.g. Lester,D)");
  if (RANKS.indexOf(body.rank) === -1) throw bad("rank must be one of: " + RANKS.join(", "));
  const company = cleanText(body.company, "company", 6).toUpperCase() || null;
  if (company && (!COMPANY_RE.test(company) || !companies.has(company))) throw bad("Apparatus must be a company on the roster, like E10 or T01");
  let tour = body.tour;
  if (tour === null || tour === undefined || tour === "") tour = null;
  else if (!Number.isInteger(tour) || tour < 1 || tour > 31) throw bad("tour must be a whole number from 1 to 31");
  const emplId = cleanText(body.emplId, "emplId", 20).toUpperCase() || null;
  if (emplId && !EMPL_ID_RE.test(emplId)) throw bad("Employee ID is two letters and four digits, e.g. LE1234");
  const owner = emplId && emplOwner(emplId);
  if (owner) throw bad("Employee ID " + emplId + " is already on " + owner);
  return { name, rank: body.rank, company, tour, emplId, note: cleanText(body.note, "note") };
}

/* A pending account picks a roster entry ({pos, note}) or asks to be added ({request}). takenBy(pos) -> the uid
   linked to that position, or null. Returns the fields to write. */
function planClaim(uid, u, body, { lookup, takenBy, companies, emplOwner }) {
  if (u.status !== "pending") throw new AccountError("failed-precondition", "Only accounts waiting for approval can send a claim.");
  if (body && body.request && typeof body.request === "object") {
    const req = cleanPersonRequest(body.request, { companies, emplOwner });
    if (!req.company || !req.tour) throw bad("Pick your apparatus and tour");
    return { claimRequest: req, claimPos: null, claimNote: null };
  }
  const pos = body && body.pos;
  const entry = typeof pos === "string" ? lookup(pos) : null;
  if (!entry || !entry.name) throw bad("Pick your name from the roster");
  const other = takenBy(pos);
  if (other && other !== uid) throw new AccountError("already-exists", "That roster entry is already linked to another account. Ask an admin for help.");
  return { claimPos: pos, claimNote: cleanText(body.note, "Note", 300) || null, claimRequest: null };
}

// Positions with a name and added people that no account is linked to yet (the claim screen's search list).
function rosterNames(positions, people, taken) {
  return positions.filter((p) => p.name && !taken.has(p.pos)).map((p) => ({ pos: p.pos, name: p.name, title: p.title }))
    .concat(people.filter((r) => !taken.has(PERSON_PREFIX + r.id))
      .map((r) => ({ pos: PERSON_PREFIX + r.id, name: r.name, title: r.rank + " (added)" })));
}

/* What an admin action does to the target account, as server.py's admin_action. ctx: {activeAdmins, takenBy(pos),
   lookup(key)}. Returns {patch, addPerson (the people record to create, for approving "not on the list"), revoke}.
   When addPerson is set, the caller creates it and sets patch.pos to "person:<new id>". */
function planAdminAction(target, body, ctx) {
  if (!target) throw new AccountError("not-found", "No such user");
  const action = body && body.action;
  const lastAdmin = target.role === "admin" && target.status === "active" && ctx.activeAdmins <= 1;
  const linkedElsewhere = (pos) => { const o = ctx.takenBy(pos); return o && o !== target.uid; };
  if (action === "approve" && target.claimRequest && !target.claimPos) {
    return { patch: { claimRequest: null, status: "active" }, addPerson: target.claimRequest };
  }
  if (action === "approve") {
    const pos = target.claimPos;
    if (pos && linkedElsewhere(pos)) throw new AccountError("already-exists", "That roster entry is already linked to another account");
    return { patch: pos ? { pos, claimPos: null, claimNote: null, status: "active" } : { status: "active" } };
  }
  if (action === "reject") return { patch: { claimPos: null, claimNote: null, claimRequest: null } };
  if (action === "role") {
    if (ROLES.indexOf(body.role) === -1) throw bad("role must be member, editor or admin");
    if (lastAdmin && body.role !== "admin") throw new AccountError("failed-precondition", "Make someone else an admin first. There must always be at least one admin.");
    return { patch: { role: body.role } };
  }
  if (action === "link") {
    if (typeof body.pos !== "string" || !ctx.lookup(body.pos)) throw bad("pos must be a position number from the vacancy list or an added person");
    if (linkedElsewhere(body.pos)) throw new AccountError("already-exists", "That roster entry is already linked to another account");
    return { patch: { pos: body.pos, claimPos: null, claimNote: null } };
  }
  if (action === "unlink") return { patch: { pos: null } };
  if (action === "disable") {
    if (lastAdmin) throw new AccountError("failed-precondition", "You can't disable the only admin.");
    return { patch: { status: "disabled" }, revoke: true };
  }
  if (action === "enable") return { patch: { status: "active" } };
  throw bad("Unknown action");
}

// The Admin page's order: claims waiting first, then by status and name.
function sortUsers(rows) {
  const rank = (u) => (u.status === "pending" && u.claimPos ? 0 : 1);
  return rows.slice().sort((a, b) => rank(a) - rank(b) || String(a.status).localeCompare(String(b.status)) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}

// Average age and years of service on isoDate; only records for known people count (server.py's stats).
function averages(rows, isoDate, known) {
  const on = Date.parse(isoDate + "T00:00:00Z"), yr = 365.25 * 864e5, ages = [], yos = [];
  rows.forEach((r) => {
    if (!known(r.key)) return;
    if (r.birthDate) ages.push((on - Date.parse(r.birthDate + "T00:00:00Z")) / yr);
    if (r.hireDate && r.hireDate <= isoDate) yos.push((on - Date.parse(r.hireDate + "T00:00:00Z")) / yr);
  });
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return { avgAge: avg(ages), nAge: ages.length, avgYos: avg(yos), nYos: yos.length };
}

/* ---------- Trade invites (personal links) ----------
   tradeInvites/{code}: {tradeId, recipientKey, inviterKey, createdAt, expiresAt, usedBy, usedAt, answers}.
   A poster texts a link from their own phone to someone the trade went to who has no account. The link lets them
   answer before signing up; their Employee ID proves who they are when they sign in (planRedeem). */
const INVITES_PER_DAY = 20;
const INVITE_DAYS = 14;
const ANSWERS_PER_INVITE = 10;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* Why the poster can't invite `key` to `trade`, or null. trade: {posterKey, status, date, audience}; ctx: {callerPos,
   today, onTool(key) -> bool, sentToday (codes the caller made today, reused ones not counted)}. */
function inviteProblem(trade, key, ctx) {
  if (!trade) return "No such trade";
  if (!ctx.callerPos || trade.posterKey !== ctx.callerPos) return "Only the person who posted the trade can invite people to it";
  if (trade.status !== "open" || trade.date < ctx.today) return "This trade is no longer open";
  if (((trade.audience && trade.audience.to) || []).indexOf(key) === -1) return "You can only invite people you sent the trade to";
  if (ctx.onTool(key)) return "They're already on the tool and can see it";
  return null;
}
// The link works until the trade's day or 14 days after it was made, whichever is first.
function inviteExpiry(tradeDate, nowIso) {
  const limit = new Date(Date.parse(nowIso) + INVITE_DAYS * 864e5).toISOString();
  const dayEnd = tradeDate + "T23:59:59.999Z";
  return dayEnd < limit ? dayEnd : limit;
}
// Why an invite can't be used now, or null.
function inviteState(inv, nowIso) {
  if (!inv) return "That link isn't valid";
  if (inv.expiresAt < nowIso) return "That link has expired";
  return null;
}
// An answer from the link: pay back later, or a swap day (checked against the schedule when the poster picks it).
function cleanInviteAnswer(body, tradeDate, today) {
  const p = body && body.proposal;
  let proposal;
  if (p && p.later === true) proposal = { later: true };
  else if (p && isDate(p.swapDate)) {
    if (p.swapDate === tradeDate || p.swapDate < today) throw bad("Pick a later day for the swap, not the traded day");
    proposal = { swapDate: p.swapDate };
  } else throw bad("Choose pay back later or a swap day");
  return { proposal, note: cleanText(body.note, "note", 300) || null };
}
/* Signing in from a link: the Employee ID must match the one on file for the invited person. u: the account; expected:
   that person's Employee ID or null; takenBy: the uid linked to recipientKey, or null. Returns the account fields to set. */
function planRedeem(uid, u, inv, emplId, { expected, takenBy, nowIso }) {
  const why = inviteState(inv, nowIso);
  if (why) throw new AccountError("failed-precondition", why);
  if (inv.usedBy && inv.usedBy !== uid) throw new AccountError("already-exists", "That link has already been used by another account");
  if (!u || u.status === "disabled") throw new AccountError("permission-denied", "This account can't be used.");
  if (u.status === "active" && u.pos && u.pos !== inv.recipientKey) throw new AccountError("failed-precondition", "Your account is already linked to someone else");
  if (takenBy && takenBy !== uid) throw new AccountError("already-exists", "That person is already linked to another account. Ask an admin for help.");
  const id = cleanText(emplId, "emplId", 20).toUpperCase();
  if (!EMPL_ID_RE.test(id)) throw bad("Employee ID is two letters and four digits, e.g. LE1234");
  if (!expected) throw new AccountError("failed-precondition", "There's no Employee ID on file for you yet. Pick your name below and an admin will approve it.");
  if (id !== String(expected).toUpperCase()) throw new AccountError("permission-denied", "That Employee ID doesn't match the person this link was sent to.");
  return { pos: inv.recipientKey, status: "active", claimPos: null, claimNote: null, claimRequest: null,
    approvedBy: "invite", invitedBy: inv.inviterKey, approvedAt: nowIso };
}

module.exports = {
  ROLES, RANKS, PERSON_PREFIX, AccountError, parseList, emailAllowed, signIn, claimsFor, claimsEqual, meJson,
  cleanPersonRequest, planClaim, rosterNames, planAdminAction, sortUsers, averages,
  INVITES_PER_DAY, ANSWERS_PER_INVITE, inviteProblem, inviteExpiry, inviteState, cleanInviteAnswer, planRedeem,
};
