/* Cloud Functions for the beta: accounts and approval (the parts of server.py that rules alone can't do).
 * The decisions are in accounts.js; this file reads and writes Firestore, Storage and Auth.
 *
 * Settings (functions/.env, written by the deploy workflow from GitHub variables):
 *   ADMIN_EMAILS     comma-separated Google emails that become admins when they sign in
 *   ALLOWED_DOMAINS  optional; only these email domains may sign in (empty: any Google account, approved by an admin)
 */
"use strict";
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const A = require("./accounts");
const AL = require("./alerts");
const AN = require("./announce");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 5 });
const db = admin.firestore();

const now = () => new Date().toISOString();
const settings = () => ({ admins: A.parseList(process.env.ADMIN_EMAILS), domains: A.parseList(process.env.ALLOWED_DOMAINS) });

// accounts.js errors become callable errors; the reason reaches the page as error.details.
function wrap(handler) {
  return onCall(async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof A.AccountError) throw new HttpsError(e.code, e.message, e.reason ? { reason: e.reason } : undefined);
      throw e;
    }
  });
}
function signedIn(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return req.auth;
}
function requireAdmin(req) {
  const auth = signedIn(req);
  if (!(auth.token.active === true && auth.token.role === "admin")) throw new HttpsError("permission-denied", "Admins only.");
  return auth;
}

/* The roster and Employee ID files (data/ in Storage, synced from the repo on deploy), cached for 10 minutes. */
let rosterCache = { at: 0, rows: null, ids: null };
async function storageJson(path) {
  const [buf] = await admin.storage().bucket().file(path).download();
  return JSON.parse(buf.toString("utf8"));
}
// Missing files (before the first copy to Storage) give an empty roster rather than failing sign-in for everyone.
async function roster() {
  if (!rosterCache.rows || Date.now() - rosterCache.at > 600000) {
    const [rows, ids] = await Promise.all([
      storageJson("data/positions.json").catch((e) => { console.warn("roster file missing: " + e.message); return null; }),
      storageJson("data/employee-ids.json").catch(() => ({ ids: {} })),
    ]);
    if (!rows) return { rows: [], ids: {} };
    rosterCache = { at: Date.now(), rows, ids: ids.ids || {} };
  }
  return rosterCache;
}
const D = require("./deliver")({ db, admin, roster, now: () => now() });
async function lookups() {
  const [{ rows, ids }, people] = await Promise.all([roster(), db.collection("people").get()]);
  const byPos = new Map(rows.map((p) => [p.pos, p]));
  const added = new Map(people.docs.map((d) => [A.PERSON_PREFIX + d.id, Object.assign({ id: d.id }, d.data())]));
  const lookup = (key) => {
    if (!key) return null;
    const r = added.get(key);
    if (r) return { pos: key, name: r.name, title: r.rank + (r.company ? " " + r.company : "") + " (added)" };
    return byPos.get(key) || null;
  };
  return { rows, ids, people: Array.from(added.values()), lookup, companies: new Set(rows.map((p) => p.company).filter(Boolean)),
    emplOwner: (id) => {
      const pos = Object.keys(ids).find((k) => ids[k].id === id);
      if (pos) return (byPos.get(pos) && byPos.get(pos).name) || pos;
      const p = Array.from(added.values()).find((x) => x.emplId === id);
      return p ? p.name : null;
    } };
}
async function takenMap() {
  const snap = await db.collection("users").where("pos", "!=", null).get();
  return new Map(snap.docs.map((d) => [d.data().pos, d.id]));
}
async function meFor(uid, u, lookup) {
  const [contact, profile] = await Promise.all([db.doc("contacts/" + uid).get(),
    u.pos ? db.doc("profiles/" + u.pos).get() : Promise.resolve(null)]);
  return A.meJson(uid, u, { lookup, contact: contact.exists ? contact.data() : null, profile: profile && profile.exists ? profile.data() : null });
}
// Custom claims from the account doc; returns true when they changed (the page then refreshes its ID token).
async function syncClaims(uid, u, current) {
  const want = A.claimsFor(u);
  if (A.claimsEqual(want, current)) return false;
  await admin.auth().setCustomUserClaims(uid, want);
  return true;
}
function audit(actor, action, detail) {
  return db.collection("audit").add({ at: now(), actor, action, detail: detail || {} });
}

// On every page load after sign-in: create or refresh the account, set the claims, return /api/me.
// Signing in with a cell number: the staff-list cell (staffCells) that matches links the account to that seat at once.
async function staffCellMap() {
  const snap = await db.collection("staffCells").get();
  return new Map(snap.docs.map((d) => [d.id, d.data().cell]));
}
exports.syncMe = wrap(async (req) => {
  const auth = signedIn(req);
  const email = auth.token.email_verified === true ? String(auth.token.email || "").toLowerCase() : "";
  const phone = auth.token.phone_number || "";
  if (!email && !phone) throw new HttpsError("permission-denied", "Sign in with your cell number or a Google account.", { reason: "google" });
  const { admins, domains } = settings();
  const ref = db.doc("users/" + auth.uid);
  const cells = phone ? await staffCellMap() : null;
  // Google first: a cell number signs in only once it has been added to an account (My page, or "Verify with your
  // cell" on the claim screen), and then Firebase signs straight into that account. A cell on no account yet starts
  // nothing: the stray sign-in is removed and the page asks for Google. Accounts made by cell before this rule keep working.
  if (phone && !email && !(await ref.get()).exists) {
    await admin.auth().deleteUser(auth.uid).catch(() => {});
    throw new HttpsError("permission-denied", "Sign in with Google the first time, then add your cell on My page.", { reason: "google_first" });
  }
  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const r = A.signIn(snap.exists ? snap.data() : null, { email, phone, name: auth.token.name || "", isAdmin: !!email && admins.includes(email),
      allowed: !!email && A.emailAllowed(email, domains), now: now() });
    if (phone) {
      const key = Array.from(cells.keys()).find((k) => A.cellKey(cells.get(k)) === A.cellKey(phone));
      const linked = key ? await t.get(db.collection("users").where("pos", "==", key)) : null;
      const patch = A.planCellMatch(auth.uid, r.user, phone, cells, () => (linked && !linked.empty ? linked.docs[0].id : null), now());
      if (patch) { Object.assign(r.user, patch); r.cellLinked = patch.pos; }
    }
    t.set(ref, r.user);
    return r;
  });
  if (result.created) await audit(auth.uid, "signup", { email: email || null, phone: phone || null });
  if (result.cellLinked) {
    await audit(auth.uid, "cellLink", { pos: result.cellLinked });
    // The cell they signed in with becomes the number for trade texts (My page).
    const c = db.doc("contacts/" + auth.uid), cs = await c.get();
    if (!cs.exists || !cs.data().phoneMobile) await c.set({ pos: result.cellLinked, phoneMobile: phone, share: false, updatedAt: now() }, { merge: true });
  }
  // The staff-list cell for their seat becomes a sign-in number too, so members never have to add it (planStaffCell).
  const staffCell = A.planStaffCell(result.user, cells || await staffCellMap());
  if (staffCell) {
    try {
      await admin.auth().updateUser(auth.uid, { phoneNumber: staffCell });
      await ref.set({ phone: staffCell }, { merge: true });
      result.user.phone = staffCell;
      await audit(auth.uid, "staffCell", { pos: result.user.pos });
    } catch (e) {
      // Already the sign-in number of another account (e.g. one made by cell earlier): leave it; an admin can sort it out.
      console.warn("staff cell for " + auth.uid + ": " + (e.code || e.message));
    }
  }
  const changed = await syncClaims(auth.uid, result.user, auth.token);
  const { lookup } = await lookups();
  return Object.assign(await meFor(auth.uid, result.user, lookup), { claimsChanged: changed });
});

// A pending account picks its roster entry, or asks to be added ("I'm not on the list").
exports.claim = wrap(async (req) => {
  const auth = signedIn(req);
  const ctx = await lookups();
  const body = req.data || {};
  const ref = db.doc("users/" + auth.uid);
  // With an Employee ID, the one on file for that seat (expectedEmplId, below) decides: a match is in at once.
  const expected = typeof body.pos === "string" && body.emplId ? await expectedEmplId(body.pos) : null;
  const user = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "Reload the page and try again.");
    const u = snap.data();
    let takenBy = () => null;
    if (typeof body.pos === "string") {
      const q = await t.get(db.collection("users").where("pos", "==", body.pos));
      takenBy = () => (q.empty ? null : q.docs[0].id);
    }
    const patch = A.planClaim(auth.uid, u, body, Object.assign({}, ctx, { takenBy, expectedEmplId: expected }));
    t.update(ref, patch);
    return Object.assign({}, u, patch);
  });
  if (user.approvedBy === "emplId" && user.status === "active") {
    await syncClaims(auth.uid, user, auth.token);
    await audit(auth.uid, "emplIdLink", { pos: user.pos });
    return Object.assign(await meFor(auth.uid, user, ctx.lookup), { claimsChanged: true });
  }
  await audit(auth.uid, body.request ? "request" : "claim", { pos: user.claimPos || null, emplIdTried: !!body.emplId });
  return meFor(auth.uid, user, ctx.lookup);
});

// The claim screen's list: roster entries nobody has linked yet.
exports.rosterNames = wrap(async (req) => {
  signedIn(req);
  const [ctx, taken] = await Promise.all([lookups(), takenMap()]);
  return A.rosterNames(ctx.rows, ctx.people, new Set(taken.keys()), ctx.ids);
});

// Who's on the tool: positions with an active linked account. A trade's poster gets Invite for the people they sent it
// to who aren't (a text from their own phone).
exports.onToolKeys = wrap(async (req) => {
  const auth = signedIn(req);
  if (auth.token.active !== true) throw new HttpsError("permission-denied", "Approved accounts only.");
  const snap = await db.collection("users").where("pos", "!=", null).get();
  return snap.docs.map((d) => d.data()).filter((u) => u.status === "active").map((u) => u.pos);
});

/* ---------- Trade invites: a personal link per person, texted from the poster's own phone ----------
   createInvite (poster), inviteInfo and answerFromInvite (no sign-in: the link is the key), redeemInvite (signed in, with
   the invited person's Employee ID). tradeInvites and link answers are written only here (firestore.rules). */
const activePositions = async () => new Set((await db.collection("users").where("pos", "!=", null).get()).docs
  .map((d) => d.data()).filter((u) => u.status === "active").map((u) => u.pos));
const today = () => now().slice(0, 10);
async function inviteDoc(code) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{16,40}$/.test(code)) return { ref: null, inv: null };
  const ref = db.doc("tradeInvites/" + code);
  const snap = await ref.get();
  return { ref, inv: snap.exists ? snap.data() : null };
}
// The invited person's Employee ID: an Employee card override, an added person's record, or the staff-list file.
async function expectedEmplId(key) {
  const o = await db.doc("rosterOverrides/" + key).get();
  if (o.exists && o.data().emplId) return o.data().emplId;
  if (key.startsWith(A.PERSON_PREFIX)) {
    const p = await db.doc("people/" + key.slice(A.PERSON_PREFIX.length)).get();
    return p.exists ? p.data().emplId || null : null;
  }
  const { ids } = await roster();
  return (ids[key] && ids[key].id) || null;
}

/* {tradeId, keys}: one personal code per person (reused while it's valid), with the staff-list cell so Messages opens
   addressed to them (the page also uses the cells for a group text with the general link). Each cell handed out is
   audited. Past the daily limit a person gets code null (the page falls back to the general link).
   Returns [{key, code, cell}]. */
exports.createInvite = wrap(async (req) => {
  const auth = signedIn(req);
  if (auth.token.active !== true || !auth.token.pos) throw new HttpsError("permission-denied", "Link your account to your roster entry first.");
  const body = req.data || {};
  const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string").slice(0, 40) : [];
  if (typeof body.tradeId !== "string" || !keys.length) throw new HttpsError("invalid-argument", "tradeId and keys are required");
  const tsnap = await db.doc("trades/" + body.tradeId).get();
  const trade = tsnap.exists ? tsnap.data() : null;
  const onTool = await activePositions();
  const ctx = { callerPos: auth.token.pos, today: today(), onTool: (k) => onTool.has(k) };
  keys.forEach((k) => { const why = A.inviteProblem(trade, k, ctx); if (why) throw new HttpsError("failed-precondition", why); });
  const cells = await Promise.all(keys.map((k) => db.doc("staffCells/" + k).get().then((d) => (d.exists && A.normCell(d.data().cell)) || null)));
  const out = [];
  {
    const mine = await db.collection("tradeInvites").where("inviterKey", "==", auth.token.pos).get();
    const made = mine.docs.filter((d) => d.data().createdAt >= today());
    let fresh = made.length;
    for (let i = 0; i < keys.length; i++) {
      const old = mine.docs.find((d) => d.data().tradeId === body.tradeId && d.data().recipientKey === keys[i] && !A.inviteState(d.data(), now()));
      let code = old && old.id;
      if (!code) {
        const prior = await db.collection("tradeInvites").where("tradeId", "==", body.tradeId).where("recipientKey", "==", keys[i]).get();
        const live = prior.docs.find((d) => !A.inviteState(d.data(), now()));
        code = live && live.id;
      }
      if (!code) {
        if (fresh >= A.INVITES_PER_DAY) { out.push({ key: keys[i], code: null, cell: cells[i] }); continue; }
        code = crypto.randomBytes(18).toString("base64url");
        await db.doc("tradeInvites/" + code).set({ tradeId: body.tradeId, recipientKey: keys[i], inviterKey: auth.token.pos,
          createdAt: now(), expiresAt: A.inviteExpiry(trade.date, now()), usedBy: null, usedAt: null, answers: 0 });
        fresh++;
      }
      out.push({ key: keys[i], code, cell: cells[i] });
    }
  }
  const handed = out.filter((x) => x.cell).map((x) => x.key);
  if (handed.length) await audit(auth.uid, "inviteCell", { trade: body.tradeId, by: auth.token.pos, for: handed });
  return out;
});

// What the link shows before sign-in: who's asking, the day and where; or that it has expired.
exports.inviteInfo = wrap(async (req) => {
  const { inv } = await inviteDoc(req.data && req.data.code);
  const why = A.inviteState(inv, now());
  if (why) return { error: why };
  const [tsnap, { lookup }] = await Promise.all([db.doc("trades/" + inv.tradeId).get(), lookups()]);
  const t = tsnap.exists ? tsnap.data() : null;
  if (!t) return { error: "That trade is gone" };
  const poster = lookup(t.posterKey) || {}, seat = lookup(t.seatPos) || {}, me = lookup(inv.recipientKey) || {};
  const [reply, expected, { ids }] = await Promise.all([db.doc("tradeReplies/link_" + req.data.code).get(), expectedEmplId(inv.recipientKey), roster()]);
  return { needsSignIn: !expected || (inv.idMisses || 0) >= A.INVITE_ID_TRIES, date: t.date, open: t.status === "open" && t.date >= today(), posterName: poster.name || t.posterName || "",
    posterRank: poster.rank || "", station: seat.company || "", note: t.note || "",
    forName: A.friendlyName((ids[inv.recipientKey] && ids[inv.recipientKey].name) || me.name || ""),
    answer: reply.exists ? reply.data().proposal : null, used: !!inv.usedBy };
});

// An answer from the link, before sign-in. Only the invited person can answer: their Employee ID must match the one on
// file, so a link that reached the wrong person records nothing. Wrong IDs count against the link.
exports.answerFromInvite = wrap(async (req) => {
  const body = req.data || {};
  const { ref, inv } = await inviteDoc(body.code);
  const why = A.inviteState(inv, now());
  if (why) throw new HttpsError("failed-precondition", why);
  if ((inv.answers || 0) >= A.ANSWERS_PER_INVITE) throw new HttpsError("resource-exhausted", "Too many answers from this link. Sign in to answer.");
  const tsnap = await db.doc("trades/" + inv.tradeId).get();
  const t = tsnap.exists ? tsnap.data() : null;
  if (!t || t.status !== "open" || t.date < today()) throw new HttpsError("failed-precondition", "This trade is no longer open");
  const { proposal, note } = A.cleanInviteAnswer(body, t.date, today());
  const check = A.checkInviteId(inv, body.emplId, await expectedEmplId(inv.recipientKey));
  if (!check.ok) {
    if (check.miss) await ref.update({ idMisses: admin.firestore.FieldValue.increment(1) });
    throw new HttpsError("permission-denied", check.why);
  }
  const { lookup } = await lookups();
  const me = lookup(inv.recipientKey) || {};
  await db.doc("tradeReplies/link_" + body.code).set({ tradeId: inv.tradeId, takerKey: inv.recipientKey, takerName: me.name || null,
    proposal, swapSeatPos: null, note, via: "link", verified: true, createdAt: now(), createdBy: "invite:" + inv.inviterKey });
  await ref.update({ answers: admin.firestore.FieldValue.increment(1) });
  await D.reply("link_" + body.code).catch((e) => console.warn("alert: " + e.message));
  return { ok: true };
});

/* Signing in from the link with the invited person's Employee ID: links and approves the account, confirms their link
   answer, and if the poster already picked it (status "pending"), sets the trade. */
exports.redeemInvite = wrap(async (req) => {
  const auth = signedIn(req);
  const body = req.data || {};
  const { ref, inv } = await inviteDoc(body.code);
  if (!inv) throw new HttpsError("not-found", "That link isn't valid");
  const expected = await expectedEmplId(inv.recipientKey);
  const invitedCell = await db.doc("staffCells/" + inv.recipientKey).get().then((d) => (d.exists && d.data().cell) || null);
  const cellMatch = !!(auth.token.phone_number && invitedCell && A.cellKey(invitedCell) === A.cellKey(auth.token.phone_number));
  const uref = db.doc("users/" + auth.uid);
  const user = await db.runTransaction(async (t) => {
    const [usnap, linked] = await Promise.all([t.get(uref), t.get(db.collection("users").where("pos", "==", inv.recipientKey))]);
    const u = usnap.exists ? usnap.data() : null;
    const takenBy = linked.empty ? null : linked.docs[0].id;
    const patch = A.planRedeem(auth.uid, u, inv, body.emplId, { expected, takenBy, nowIso: now(), cellMatch });
    const rref = db.doc("tradeReplies/link_" + body.code), tref = db.doc("trades/" + inv.tradeId);
    const [rsnap, tsnap] = await Promise.all([t.get(rref), t.get(tref)]);
    t.update(uref, patch);
    t.update(ref, { usedBy: auth.uid, usedAt: now() });
    if (rsnap.exists) t.update(rref, { verified: true });
    const tr = tsnap.exists ? tsnap.data() : null;
    if (tr && tr.status === "pending" && tr.replyId === "link_" + body.code) t.update(tref, { status: "set", setAt: now() });
    return Object.assign({}, u, patch);
  });
  await syncClaims(auth.uid, user, auth.token);
  await audit(auth.uid, "invite", { pos: inv.recipientKey, by: inv.inviterKey, trade: inv.tradeId });
  await D.trade(inv.tradeId).catch((e) => console.warn("alert: " + e.message));
  const { lookup } = await lookups();
  return Object.assign(await meFor(auth.uid, user, lookup), { claimsChanged: true });
});

exports.adminUsers = wrap(async (req) => {
  requireAdmin(req);
  const [{ lookup }, snap] = await Promise.all([lookups(), db.collection("users").get()]);
  const rows = snap.docs.map((d) => {
    const u = d.data();
    return Object.assign(A.meJson(d.id, u, { lookup, contact: null, profile: null }), { createdAt: u.createdAt || null, lastLogin: u.lastLogin || null });
  });
  return A.sortUsers(rows);
});

// approve, reject, role, link, unlink, disable, enable (server.py admin_action). Linking runs in a transaction, so a
// position can't be linked to two accounts.
exports.adminAction = wrap(async (req) => {
  const actor = requireAdmin(req);
  const body = req.data || {};
  if (typeof body.id !== "string" || !body.id) throw new HttpsError("invalid-argument", "id is required");
  const ctx = await lookups();
  const ref = db.doc("users/" + body.id);
  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const target = snap.exists ? Object.assign({ uid: snap.id }, snap.data()) : null;
    const admins = await t.get(db.collection("users").where("role", "==", "admin").where("status", "==", "active"));
    const pos = body.action === "link" ? body.pos : target && target.claimPos;
    const linked = pos ? await t.get(db.collection("users").where("pos", "==", pos)) : null;
    const plan = A.planAdminAction(target, body, { activeAdmins: admins.size, lookup: ctx.lookup,
      takenBy: () => (linked && !linked.empty ? linked.docs[0].id : null) });
    const patch = Object.assign({}, plan.patch);
    if (plan.addPerson) {
      const person = db.collection("people").doc();
      const p = plan.addPerson;
      t.set(person, { name: p.name, rank: p.rank, company: p.company || null, tour: p.tour || null, emplId: p.emplId || null,
        note: p.note || null, createdAt: now(), createdBy: actor.uid });
      patch.pos = A.PERSON_PREFIX + person.id;
    }
    t.update(ref, patch);
    const { uid, ...rest } = Object.assign({}, target, patch);
    return { user: rest, revoke: !!plan.revoke };
  });
  const current = (await admin.auth().getUser(body.id)).customClaims || {};
  await syncClaims(body.id, result.user, current);
  if (result.revoke) await admin.auth().revokeRefreshTokens(body.id);
  await audit(actor.uid, body.action, { user: body.id, email: result.user.email, role: body.role, pos: body.pos });
  // A new "added" person isn't in the cached lookup yet; the Admin page reloads the list anyway.
  return A.meJson(body.id, result.user, { lookup: ctx.lookup, contact: null, profile: null });
});

// Average age and years of service; individual dates never leave Firestore except to admins and their owner.
exports.stats = wrap(async (req) => {
  const auth = signedIn(req);
  if (auth.token.active !== true) throw new HttpsError("permission-denied", "Your account isn't approved yet.");
  const date = req.data && /^\d{4}-\d{2}-\d{2}$/.test(req.data.date) ? req.data.date : now().slice(0, 10);
  const [{ lookup }, snap] = await Promise.all([lookups(), db.collection("profiles").get()]);
  return A.averages(snap.docs.map((d) => Object.assign({ key: d.id }, d.data())), date, (k) => !!lookup(k));
});

/* ---------- Trade alerts (deliver.js decides and sends) ----------
   notify: the page asks after posting, widening, answering, picking or cancelling; only alerts that are due and weren't
   sent yet go out, so asking twice is harmless. */
exports.notify = wrap(async (req) => {
  const auth = signedIn(req);
  if (auth.token.active !== true) throw new HttpsError("permission-denied", "Approved accounts only.");
  const body = req.data || {};
  if (typeof body.id !== "string" || !body.id) throw new HttpsError("invalid-argument", "id is required");
  const sent = body.kind === "reply" ? await D.reply(body.id) : await D.trade(body.id);
  return { sent };
});

// "Send me a test notification" (Trades → Alerts): one app notification to the caller's own registered devices.
exports.pushTest = wrap(async (req) => {
  const auth = signedIn(req);
  if (auth.token.active !== true) throw new HttpsError("permission-denied", "Approved accounts only.");
  const snap = await db.doc("users/" + auth.uid).get();
  const tokens = (snap.exists && snap.data().pushTokens) || [];
  if (!tokens.length) return { devices: 0, sent: 0 };
  const sent = await D.sendPush({ uid: auth.uid, pushTokens: tokens },
    { subject: "Test notification", text: "App notifications work on this device." }, D.appUrl() + "/");
  return { devices: tokens.length, sent };
});

/* Admin announcements (Admin → Send announcement; checks and audience in announce.js): stored in announcements/{id},
   shown in the app to every recipient (notices/{uid}), and sent as an app notification to those with app alerts on. */
exports.announce = wrap(async (req) => {
  const actor = requireAdmin(req);
  const ann = AN.clean(req.data || {});
  const users = await db.collection("users").where("status", "==", "active").get();
  const list = AN.recipients(users.docs.map((d) => Object.assign({ uid: d.id }, d.data())), ann);
  const ref = db.collection("announcements").doc(), at = now();
  const item = { title: ann.title, message: ann.message, link: ann.link, at };
  for (let i = 0; i < list.length; i += 400) {
    const batch = db.batch();
    list.slice(i, i + 400).forEach((r) => batch.set(db.doc("notices/" + r.uid), { items: { [ref.id]: item } }, { merge: true }));
    await batch.commit();
  }
  let pushed = 0, devices = 0;
  for (const r of list.filter((x) => x.push)) {
    const n = await D.sendPush(r, { subject: ann.title, text: ann.message }, D.appUrl() + "/").catch((e) => { console.warn("push: " + e.message); return 0; });
    if (n) { pushed++; devices += n; }
  }
  const counts = { recipients: list.length, pushed, devices };
  await ref.set(Object.assign({}, ann, { at, by: actor.uid, counts }));
  await audit(actor.uid, "announce", { id: ref.id, recipients: list.length, pushed });
  return Object.assign({ id: ref.id }, counts);
});

const page = (title, inner) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>" + title + '</title><body style="font:16px/1.45 -apple-system,Segoe UI,sans-serif;color:#1a2130;max-width:520px;margin:40px auto;padding:0 16px">' + inner + "</body>";
const escHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* One-tap links from alert emails. GET shows what will happen and a button (mail scanners open links on their own);
   POST does it, once per link. */
exports.alertAction = onRequest({ invoker: "public" }, async (req, res) => {
  const token = String((req.query && req.query.a) || (req.body && req.body.a) || "");
  const tok = AL.readToken(token, process.env.ALERT_KEY || "");
  const back = '<p><a href="' + escHtml(D.appUrl() + "/") + '">Open the tour schedule</a></p>';
  if (!tok) { res.status(400).send(page("Link expired", "<h2>That link has expired</h2><p>Open the trade in the app instead.</p>" + back)); return; }
  const what = tok.k === "pick" ? "Pick this answer" : "I'm interested · pay back later";
  if (req.method !== "POST") {
    res.send(page("Shift trade", "<h2>" + escHtml(what) + '</h2><form method="post"><input type="hidden" name="a" value="' + escHtml(token) +
      '"><button style="font:inherit;padding:10px 16px;border-radius:6px;border:0;background:#1a2130;color:#fff">Confirm</button></form>' + back));
    return;
  }
  const used = db.doc("alertTokens/" + require("crypto").createHash("sha256").update(token).digest("hex"));
  try { await used.create({ at: now(), uid: tok.u, kind: tok.k }); } catch (e) {
    res.send(page("Already done", "<h2>Already done</h2><p>This link was used already.</p>" + back)); return;
  }
  const said = tok.k === "pick" ? await D.pick(tok.u, tok.t, tok.r) : await D.answer(tok.u, tok.t, { later: true }, null);
  res.send(page("Shift trade", "<h2>" + escHtml(what) + "</h2><p>" + escHtml(said) + "</p>" + back));
});

/* Text replies (Twilio webhook, signature checked): "1" pay back later, "2 11/20" swap, "PICK" the last answer you were
   told about. Set the number's "A message comes in" webhook to this function's URL (FIREBASE_SETUP.md). */
exports.smsReply = onRequest({ invoker: "public" }, async (req, res) => {
  const token = process.env.TWILIO_TOKEN || "";
  const url = process.env.SMS_WEBHOOK_URL || D.fnUrl("smsReply");
  const params = req.body || {};
  if (!token || AL.twilioSignature(url, params, token) !== req.get("X-Twilio-Signature")) { res.status(403).send("forbidden"); return; }
  const reply = (text) => res.type("text/xml").send("<Response>" + (text ? "<Message>" + escHtml(text) + "</Message>" : "") + "</Response>");
  const from = AL.phoneKey(params.From), cmd = AL.parseSms(params.Body, now().slice(0, 10));
  const ms = await D.members();
  const m = Array.from(ms.values()).find((x) => x.phone && AL.phoneKey(x.phone) === from);
  if (!m) return reply("This number isn't on the tour schedule. Add your cell on My page to answer by text.");
  if (cmd && cmd.kind === "stop") { await db.doc("users/" + m.uid).update({ "alerts.text": false }); return reply(""); }
  if (!cmd) return reply("Reply 1 = interested, pay back later · 2 and a date = swap (e.g. 2 11/20) · PICK = pick the last answer.");
  const st = (await db.doc("alertState/" + m.uid).get()).data() || {};
  if (cmd.kind === "pick") return reply(st.answer ? await D.pick(m.uid, st.answer.tradeId, st.answer.replyId) : "There's no answer to pick yet.");
  if (!st.offer) return reply("There's no trade to answer yet.");
  return reply(await D.answer(m.uid, st.offer, cmd.kind === "swap" ? { swapDate: cmd.date } : { later: true }, "By text"));
});

// The daily summary of new board posts; called once a day by .github/workflows/daily-alerts.yml with the ALERT_KEY.
exports.dailySummary = onRequest({ invoker: "public" }, async (req, res) => {
  const key = process.env.ALERT_KEY || "";
  if (!key || req.method !== "POST" || req.get("X-Alert-Key") !== key) { res.status(403).send("forbidden"); return; }
  res.json({ sent: await D.daily() });
});

/* Launch invites (admin site → Admin → Invite people). status: whether the department number can send; audit: log a
   contact-card download; send: a personal text from the department number to each chosen person not on the tool yet
   (Twilio; recorded in launchInvites/{pos} and audited). Group texts from the admin's own phone need no function. */
exports.launchInvites = wrap(async (req) => {
  const actor = requireAdmin(req);
  const body = req.data || {};
  const twilio = !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);
  if (body.action === "status") return { twilio };
  if (body.action === "audit") {
    await audit(actor.uid, "contactsDownload", { count: Number(body.count) || 0 });
    return { ok: true };
  }
  if (body.action !== "send") throw new HttpsError("invalid-argument", "Unknown action");
  if (!twilio) throw new HttpsError("failed-precondition", "The department texting number isn't set up yet.");
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 600) : "";
  if (text.length < 20) throw new HttpsError("invalid-argument", "Write the message first.");
  const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string").slice(0, 1000) : [];
  const [cells, onTool, logged] = await Promise.all([staffCellMap(), activePositions(), db.collection("launchInvites").get()]);
  const viaTwilio = new Set(logged.docs.filter((d) => d.data().via === "twilio").map((d) => d.id));
  const plan = A.launchTargets(keys, cells, (k) => onTool.has(k), (k) => viaTwilio.has(k));
  let sent = 0, failed = 0;
  for (const x of plan.send) {
    const ok = await D.sendText(x.cell, text).catch(() => false);
    if (ok) { sent++; await db.doc("launchInvites/" + x.key).set({ sentAt: now(), via: "twilio", by: actor.uid }); } else failed++;
  }
  await audit(actor.uid, "launchTexts", { sent, failed, skipped: plan.skipped });
  return { sent, failed, skipped: plan.skipped };
});
