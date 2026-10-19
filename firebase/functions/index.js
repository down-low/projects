/* Cloud Functions for the beta: accounts and approval (the parts of server.py that rules alone can't do).
 * The decisions are in accounts.js; this file reads and writes Firestore, Storage and Auth.
 *
 * Settings (functions/.env, written by the deploy workflow from GitHub variables):
 *   ADMIN_EMAILS     comma-separated Google emails that become admins when they sign in
 *   ALLOWED_DOMAINS  optional; only these email domains may sign in (empty: any Google account, approved by an admin)
 */
"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const A = require("./accounts");

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
  return { rows, people: Array.from(added.values()), lookup, companies: new Set(rows.map((p) => p.company).filter(Boolean)),
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
exports.syncMe = wrap(async (req) => {
  const auth = signedIn(req);
  const email = String(auth.token.email || "").toLowerCase();
  if (!email || auth.token.email_verified !== true) throw new HttpsError("permission-denied", "Sign in with a Google account.", { reason: "google" });
  const { admins, domains } = settings();
  const ref = db.doc("users/" + auth.uid);
  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const r = A.signIn(snap.exists ? snap.data() : null, { email, name: auth.token.name || "", isAdmin: admins.includes(email),
      allowed: A.emailAllowed(email, domains), now: now() });
    t.set(ref, r.user);
    return r;
  });
  if (result.created) await audit(auth.uid, "signup", { email });
  const changed = await syncClaims(auth.uid, result.user, auth.token);
  const { lookup } = await lookups();
  return Object.assign(await meFor(auth.uid, result.user, lookup), { claimsChanged: changed });
});

// A pending account picks its roster entry, or asks to be added ("I'm not on the list").
exports.claim = wrap(async (req) => {
  const auth = signedIn(req);
  const ctx = await lookups();
  const ref = db.doc("users/" + auth.uid);
  const user = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "Reload the page and try again.");
    const u = snap.data();
    let takenBy = () => null;
    if (req.data && typeof req.data.pos === "string") {
      const q = await t.get(db.collection("users").where("pos", "==", req.data.pos));
      takenBy = () => (q.empty ? null : q.docs[0].id);
    }
    const patch = A.planClaim(auth.uid, u, req.data || {}, Object.assign({}, ctx, { takenBy }));
    t.update(ref, patch);
    return Object.assign({}, u, patch);
  });
  await audit(auth.uid, req.data && req.data.request ? "request" : "claim", { pos: user.claimPos || null });
  return meFor(auth.uid, user, ctx.lookup);
});

// The claim screen's list: roster entries nobody has linked yet.
exports.rosterNames = wrap(async (req) => {
  signedIn(req);
  const [ctx, taken] = await Promise.all([lookups(), takenMap()]);
  return A.rosterNames(ctx.rows, ctx.people, new Set(taken.keys()));
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
