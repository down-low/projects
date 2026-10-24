/* Change history for schedule records (the log<Collection> triggers and restoreChange in index.js). Pure logic, tested by
 * changelog.test.js.
 *
 * Every add, edit and delete to a record in LOGGED becomes one changeLog/{id} entry:
 *   {collection, docId, action: "add" | "edit" | "delete" | "restore", actor (uid, or "system" / "unknown"), actorName,
 *    at (ISO), before, after, subjects: [keys of the people or companies it's about]}
 * Admins read it; nobody writes it but the triggers (firestore.rules). Private contact fields (anything named like a
 * cell, phone, email or contact) are dropped from before and after, and contact and cell collections aren't logged.
 * Who did it comes from the write's own sign-in (Firestore's auth context), so a delete is tied to the person deleting.
 */
"use strict";

const LOGGED = ["statuses", "tourChanges", "covers", "people", "staffing", "assignments", "rosterOverrides", "trades",
  "tradeReplies", "overtime", "profiles"];
const PRIVATE_KEY = /cell|phone|e-?mail|contact/i;
// Bookkeeping that alone doesn't make an edit worth logging.
const STAMPS = ["updatedAt", "updatedBy"];

function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object" && !(v instanceof Date) && typeof v.toDate !== "function") {
    const out = {};
    Object.keys(v).sort().forEach((k) => { if (!PRIVATE_KEY.test(k)) out[k] = clean(v[k]); });
    return out;
  }
  return v;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function withoutStamps(d) {
  const o = Object.assign({}, d);
  STAMPS.forEach((k) => { delete o[k]; });
  return o;
}

// The people (roster keys, "person:<id>" for added people) and companies a record is about, for the person filter.
function subjects(collection, docId, doc) {
  const out = new Set();
  const add = (v) => { if (typeof v === "string" && v) out.add(v); };
  const d = doc || {};
  ["pos", "key", "coverKey", "targetPos", "posterKey", "takerKey", "company"].forEach((k) => add(d[k]));
  if (collection === "people") add("person:" + docId);
  if (collection === "profiles" || collection === "rosterOverrides" || collection === "staffing") add(docId);
  (Array.isArray(d.legs) ? d.legs : []).forEach((l) => { add(l && l.coverKey); add(l && l.pos); });
  return Array.from(out);
}

/* One entry for a write, or null when nothing worth logging changed. auth: {authType, authId} from the trigger
   ("app_user" with the uid for a signed-in person; "admin" or "service_account" for the functions). */
function entryFor(collection, docId, beforeRaw, afterRaw, auth, at) {
  if (LOGGED.indexOf(collection) === -1 || (!beforeRaw && !afterRaw)) return null;
  const before = beforeRaw ? clean(beforeRaw) : null, after = afterRaw ? clean(afterRaw) : null;
  let action = !before ? "add" : !after ? "delete" : "edit";
  if (action === "edit" && same(withoutStamps(before), withoutStamps(after))) return null;
  const restored = after && after.restoredAt && (!before || before.restoredAt !== after.restoredAt);
  if (restored) action = "restore";
  const a = auth || {};
  let actor;
  if (a.authType === "app_user" && a.authId) actor = a.authId;
  else if (restored && after.restoredBy) actor = after.restoredBy;
  else if (["admin", "service_account", "system"].indexOf(a.authType) !== -1) actor = "system";
  else if (action === "add" && after.createdBy) actor = after.createdBy;
  else if (action === "edit" && after.updatedBy && after.updatedAt !== before.updatedAt) actor = after.updatedBy;
  else actor = "unknown";
  const subj = subjects(collection, docId, after || before);
  if (before && after) subjects(collection, docId, before).forEach((s) => { if (subj.indexOf(s) === -1) subj.push(s); });
  return { collection, docId, action, actor, at, before, after, subjects: subj };
}

// What a person is called in the log: their roster name, else their account name unless it's an email or a number.
function actorLabel(user, rosterName) {
  if (rosterName) return rosterName;
  const n = user && user.name;
  return n && !/@|\d{4,}/.test(n) ? n : null;
}

// The record restoreChange writes back: the version before the change, marked as restored (the trigger logs it).
function restoreDoc(entry, uid, at, logId) {
  if (!entry || LOGGED.indexOf(entry.collection) === -1 || !entry.before) return null;
  return Object.assign({}, entry.before, { restoredAt: at, restoredBy: uid, restoredFrom: logId });
}

module.exports = { LOGGED, clean, subjects, entryFor, actorLabel, restoreDoc };
