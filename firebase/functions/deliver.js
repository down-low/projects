/* Sending trade alerts: reads who's who from Firestore, decides with alerts.js, and sends by app push (Firebase Cloud
 * Messaging), email (Gmail over SMTP) and text (Twilio). A channel without its settings is skipped:
 *   email  GMAIL_USER, GMAIL_APP_PASSWORD        text  TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
 *   links  ALERT_KEY (signs the one-tap links)    APP_URL  the employee app (https://<project>.web.app)
 * The settings come from GitHub secrets, written into functions/.env by the deploy (.github/workflows/firebase.yml).
 *
 * alertLog/{tradeId}, alertLog/reply_{id}: what was already sent. alertState/{uid}: {offer: tradeId, answer: {tradeId,
 * replyId}}, the trade a text reply ("1", "2 11/20", "PICK") is about. Both are functions-only (no rule matches them).
 */
"use strict";
const A = require("./alerts");

module.exports = function makeDeliver({ db, admin, roster, now }) {
  const env = (k) => process.env[k] || "";
  const today = () => now().slice(0, 10);
  const project = () => process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const appUrl = () => env("APP_URL") || (project() ? "https://" + project() + ".web.app" : "");
  const fnUrl = (name) => "https://us-central1-" + project() + ".cloudfunctions.net/" + name;
  const docs = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

  async function world() {
    const [{ rows }, people, over, statuses, covers, changes, trades] = await Promise.all([roster(),
      db.collection("people").get(), db.collection("rosterOverrides").get(), db.collection("statuses").get(),
      db.collection("covers").get(), db.collection("tourChanges").get(), db.collection("trades").get()]);
    return A.buildWorld(rows, docs(people), docs(over), { statuses: docs(statuses), covers: docs(covers), tourChanges: docs(changes), trades: docs(trades) });
  }
  // Active accounts linked to a roster position: pos -> {uid, alerts, email, pushTokens, phone, contactEmail}.
  async function members() {
    const [users, contacts, privs] = await Promise.all([db.collection("users").where("pos", "!=", null).get(), db.collection("contacts").get(),
      db.collection("contactsPrivate").get()]);
    const byUid = new Map(contacts.docs.map((d) => [d.id, d.data()]));
    privs.docs.forEach((d) => byUid.set(d.id, Object.assign({}, byUid.get(d.id), d.data())));
    const out = new Map();
    users.docs.forEach((d) => {
      const u = d.data();
      if (u.status !== "active") return;
      const c = byUid.get(d.id) || {};
      out.set(u.pos, { uid: d.id, alerts: u.alerts || {}, email: c.contactEmail || u.email || null, phone: c.phoneMobile || null, pushTokens: u.pushTokens || [] });
    });
    return out;
  }

  /* ---------- Channels ---------- */
  let mailer = null;
  async function sendEmail(to, msg, buttons) {
    if (!to || !env("GMAIL_USER") || !env("GMAIL_APP_PASSWORD")) return false;
    if (!mailer) {
      const nodemailer = require("nodemailer");
      mailer = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD") } });
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const html = '<div style="font:15px/1.45 -apple-system,Segoe UI,sans-serif;color:#1a2130">' +
      esc(msg.text).replace(/\n/g, "<br>") + "<p>" + buttons.map((b, i) => '<a href="' + esc(b.url) + '" style="display:inline-block;margin:6px 6px 0 0;padding:9px 14px;border-radius:6px;text-decoration:none;' +
        (i === 0 ? "background:#1a2130;color:#fff" : "border:1px solid #d8dce4;color:#1a2130") + '">' + esc(b.label) + "</a>").join("") +
      '</p><p style="color:#5b6577;font-size:12px">You get these because of your alert settings (Trades → Alerts in the tour schedule).</p></div>';
    await mailer.sendMail({ from: "SFFD Tour Schedule <" + env("GMAIL_USER") + ">", to, subject: msg.subject,
      text: msg.text + "\n\n" + buttons.map((b) => b.label + ": " + b.url).join("\n"), html });
    return true;
  }
  async function sendText(to, body) {
    const num = A.e164(to);
    if (!num || !env("TWILIO_SID") || !env("TWILIO_TOKEN") || !env("TWILIO_FROM")) return false;
    const r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + env("TWILIO_SID") + "/Messages.json", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(env("TWILIO_SID") + ":" + env("TWILIO_TOKEN")).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: env("TWILIO_FROM"), To: num, Body: body.slice(0, 1500) }).toString(),
    });
    if (!r.ok) console.warn("Twilio " + r.status + ": " + (await r.text()).slice(0, 200));
    return r.ok;
  }
  // m: {uid, pushTokens}; msg: {subject, text}. Returns how many devices took it (0 when none).
  // errs (optional): collects "code: message" for each device that refused, so the page can say why (tokens never logged).
  async function sendPush(m, msg, link, errs) {
    if (!m.pushTokens.length) return 0;
    const res = await admin.messaging().sendEachForMulticast({ tokens: m.pushTokens,
      notification: { title: msg.subject, body: msg.text.slice(0, 300) }, webpush: { fcmOptions: { link } } });
    res.responses.forEach((x) => {
      if (x.success) return;
      const why = ((x.error && x.error.code) || "error") + ": " + ((x.error && x.error.message) || "").slice(0, 200);
      console.warn("push " + m.uid + " " + why);
      if (errs) errs.push(why);
    });
    // Drop only tokens the browser has retired; other errors (settings, payload) keep the device.
    const dead = res.responses.map((x, i) => (!x.success && /registration-token-not-registered|invalid-registration-token/.test((x.error && x.error.code) || "") ? m.pushTokens[i] : null)).filter(Boolean);
    if (dead.length) await db.doc("users/" + m.uid).update({ pushTokens: admin.firestore.FieldValue.arrayRemove(...dead) });
    return res.successCount;
  }
  function link(uid, kind, tradeId, replyId) {
    if (!env("ALERT_KEY") || !project()) return null;
    return fnUrl("alertAction") + "?a=" + A.signToken({ u: uid, k: kind, t: tradeId, r: replyId || null }, env("ALERT_KEY"));
  }
  // One alert on each channel the person switched on. buttons: [{label, kind, replyId}] for one-tap actions.
  async function send(m, msg, opts) {
    const a = m.alerts || {}, open = appUrl() + "/?trade=" + encodeURIComponent(opts.tradeId || "");
    const buttons = (opts.buttons || []).map((b) => ({ label: b.label, url: link(m.uid, b.kind, opts.tradeId, b.replyId) })).filter((b) => b.url)
      .concat([{ label: "Open the trade", url: open }]);
    const jobs = [];
    if (a.app) jobs.push(sendPush(m, msg, open).catch((e) => console.warn("push: " + e.message)));
    if (a.email) jobs.push(sendEmail(m.email, msg, buttons).catch((e) => console.warn("email: " + e.message)));
    if (a.text) jobs.push(sendText(m.phone, msg.sms).catch((e) => console.warn("text: " + e.message)));
    await Promise.all(jobs);
  }

  /* ---------- Events ---------- */
  // After a trade is posted, widened, picked or cancelled: alerts that are due and weren't sent yet.
  async function trade(tradeId) {
    const tref = db.doc("trades/" + tradeId), lref = db.doc("alertLog/" + tradeId);
    const [tsnap, lsnap] = await Promise.all([tref.get(), lref.get()]);
    if (!tsnap.exists) return 0;
    const t = Object.assign({ id: tradeId }, tsnap.data());
    const [w, ms] = await Promise.all([world(), members()]);
    const plan = A.tradeAlerts(t, lsnap.exists ? lsnap.data() : {}, ms, w, today());
    await lref.set(plan.log);
    for (const x of plan.alerts) {
      const m = ms.get(x.pos);
      const msg = A.message(x.kind, { trade: t, world: w, me: w.byPos[x.pos] });
      const offer = x.kind === "sent" || x.kind === "board";
      if (offer) await db.doc("alertState/" + m.uid).set({ offer: tradeId }, { merge: true });
      await send(m, msg, { tradeId, buttons: offer ? [{ label: "I'm interested · pay back later", kind: "later" }] : [] });
    }
    return plan.alerts.length;
  }
  // After an answer: the poster hears about it (unless they entered it themselves).
  async function reply(replyId) {
    const rref = db.doc("tradeReplies/" + replyId), lref = db.doc("alertLog/reply_" + replyId);
    const [rsnap, lsnap] = await Promise.all([rref.get(), lref.get()]);
    if (!rsnap.exists || lsnap.exists) return 0;
    const r = Object.assign({ id: replyId }, rsnap.data());
    await lref.set({ at: now() });
    if (r.via === "poster") return 0;
    const tsnap = await db.doc("trades/" + r.tradeId).get();
    if (!tsnap.exists) return 0;
    const t = Object.assign({ id: r.tradeId }, tsnap.data());
    const [w, ms] = await Promise.all([world(), members()]);
    const m = ms.get(t.posterKey);
    if (!m) return 0;
    await db.doc("alertState/" + m.uid).set({ answer: { tradeId: t.id, replyId } }, { merge: true });
    const taker = w.byPos[r.takerKey];
    await send(m, A.message("answer", { trade: t, reply: r, world: w }), { tradeId: t.id, buttons: [{ label: "Pick " + (taker ? taker.name : "them"), kind: "pick", replyId }] });
    return 1;
  }
  // The daily summary of new board posts, for members set to "Daily summary".
  async function daily() {
    const since = new Date(Date.parse(now()) - 864e5).toISOString();
    const [w, ms, trades] = await Promise.all([world(), members(), db.collection("trades").get()]);
    const by = A.dailyDigest(docs(trades), ms, w, since, today());
    for (const [pos, list] of by) await send(ms.get(pos), A.digestMessage(list, w), { tradeId: "" });
    return by.size;
  }

  /* ---------- Acting on an alert (one-tap link or text reply) ---------- */
  // The person behind an account: their roster entry, or an error.
  async function personFor(uid, w) {
    const u = await db.doc("users/" + uid).get();
    const d = u.exists ? u.data() : null;
    if (!d || d.status !== "active" || !d.pos) return { error: "Your account isn't set up for trades." };
    return { pos: d.pos, me: w.byPos[d.pos] };
  }
  async function answer(uid, tradeId, proposal, note) {
    const tsnap = await db.doc("trades/" + tradeId).get();
    if (!tsnap.exists) return "That trade is gone.";
    const t = Object.assign({ id: tradeId }, tsnap.data()), w = await world(), who = await personFor(uid, w);
    if (who.error) return who.error;
    const chk = A.answerCheck(t, who.me, proposal, w, today());
    if (chk.error) return chk.error;
    const ref = await db.collection("tradeReplies").add({ tradeId, takerKey: who.pos, takerName: who.me.name, proposal, swapSeatPos: chk.swapSeatPos,
      note: note || null, via: "alert", createdAt: now(), createdBy: uid });
    await reply(ref.id);
    return "Sent: " + A.termsText(proposal, false) + ". " + ((w.byPos[t.posterKey] || {}).name || "The poster") + " will see it.";
  }
  async function pick(uid, tradeId, replyId) {
    const [tsnap, rsnap] = await Promise.all([db.doc("trades/" + tradeId).get(), db.doc("tradeReplies/" + replyId).get()]);
    if (!tsnap.exists || !rsnap.exists) return "That trade or answer is gone.";
    const t = Object.assign({ id: tradeId }, tsnap.data()), r = Object.assign({ id: replyId }, rsnap.data());
    const w = await world(), who = await personFor(uid, w);
    if (who.error) return who.error;
    if (t.posterKey !== who.pos) return "Only the person who posted the trade can pick.";
    if (t.status !== "open") return "This trade isn't open any more.";
    const legs = A.M.pickLegs(t, r, { byPos: w.byPos, opts: w.opts, today: today() });
    if (typeof legs === "string") return legs;
    const pending = r.via === "link" && !r.verified;
    await db.doc("trades/" + tradeId).update({ status: pending ? "pending" : "set", replyId, takerKey: r.takerKey, proposal: r.proposal, setAt: now(),
      legs: legs.map((x) => Object.assign({ kind: x.kind }, x.rec)) });
    await trade(tradeId);
    const name = (w.byPos[r.takerKey] || {}).name || "them";
    return pending ? "Picked " + name + ". It's set once they sign in from their invite link." : "Picked " + name + ". The trade is on the schedule.";
  }

  return { trade, reply, daily, answer, pick, members, appUrl, fnUrl, sendText, sendPush };
};
