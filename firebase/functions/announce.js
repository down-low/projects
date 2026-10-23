/* Admin announcements (back office → Admin → Send announcement): checking what the admin wrote and choosing who gets
 * it. Kept free of Firebase so it can be tested with `node --test`; index.js (announce) writes and sends.
 *
 * announcements/{id}: {title, message, link, audience: "all" | "picked", uids, at, by, counts} (admins read; only the
 * function writes). notices/{uid}: {items: {<id>: {title, message, link, at}}, dismissed: {<id>: true}}, what each
 * recipient sees in the app; an app notification also goes to those who turned app alerts on.
 */
"use strict";
const { AccountError } = require("./accounts");

const LIMITS = { title: 80, message: 300, link: 300, picked: 1000 };
const bad = (message) => new AccountError("invalid-argument", message);

// Anything shaped like a phone number (415-555-0100, (415) 555 0100, 4155550100, 555-0100): cells never go out.
const PHONE = /(\+?1[\s.-]*)?\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b|\b\d{3}[\s.-]\d{4}\b/;
function looksLikePhone(text) { return PHONE.test(String(text || "")); }

// {title, message, link, audience, uids} from the page -> the cleaned announcement, or an error to show the admin.
function clean(body) {
  const text = (k) => (typeof body[k] === "string" ? body[k].trim() : "");
  const title = text("title"), message = text("message"), link = text("link");
  if (!title) throw bad("Write a title.");
  if (!message) throw bad("Write the message.");
  if (title.length > LIMITS.title) throw bad("Keep the title to " + LIMITS.title + " characters.");
  if (message.length > LIMITS.message) throw bad("Keep the message to " + LIMITS.message + " characters.");
  if (looksLikePhone(title) || looksLikePhone(message) || looksLikePhone(link)) {
    throw bad("Take out the phone number: announcements never carry cell numbers.");
  }
  if (link) {
    let u = null;
    try { u = new URL(link); } catch (e) { /* not a URL */ }
    if (!u || u.protocol !== "https:" || link.length > LIMITS.link) throw bad("The link must be a full https:// address.");
  }
  const audience = body.audience === "picked" ? "picked" : "all";
  const uids = audience === "picked" && Array.isArray(body.uids)
    ? Array.from(new Set(body.uids.filter((x) => typeof x === "string" && x))).slice(0, LIMITS.picked) : [];
  if (audience === "picked" && !uids.length) throw bad("Pick at least one person.");
  return { title, message, link: link || null, audience, uids };
}

// users: [{uid, status, alerts, pushTokens}] -> the active accounts it goes to, each with push: true when the app
// notification can go too (app alerts on and a device registered).
function recipients(users, ann) {
  const picked = new Set(ann.uids || []);
  const list = users.filter((u) => u.status === "active" && (ann.audience !== "picked" || picked.has(u.uid)))
    .map((u) => ({ uid: u.uid, push: !!(u.alerts && u.alerts.app) && Array.isArray(u.pushTokens) && u.pushTokens.length > 0,
      pushTokens: Array.isArray(u.pushTokens) ? u.pushTokens : [] }));
  if (!list.length) throw bad(ann.audience === "picked" ? "None of the people picked has an active account." : "There's nobody to send it to yet.");
  return list;
}

module.exports = { LIMITS, clean, recipients, looksLikePhone };
