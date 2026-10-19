#!/usr/bin/env node
/* Sample trades for the view-only demo page (tools/build_artifact.py --snapshot records.json --demo demo.json).

   Usage: node tools/demo_trades.js records.json [--posters LT_POS,FFPM_POS] [--extra YYYY-MM-DD:POS] > demo.json

   Picks roster people (data/positions.json) and dates from today on, using the same schedule math as the page:
   a Lieutenant and an FF/Paramedic (--posters) each post trades, colleagues in their rank groups post trades
   they could take, and a couple of responses are waiting. Open trades already in records.json are kept. The output's
   "people" are the ones the demo lets you view as. Nothing in it is ever saved anywhere. */
"use strict";
const fs = require("fs");
const path = require("path");
const M = require("../schedule.js");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "positions.json"), "utf8"));
const rec = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).records || {};
const byPos = {};
data.forEach((p) => { byPos[p.pos] = p; });
const opts = { statuses: rec.statuses || [], changes: rec.tourChanges || [], covers: rec.covers || [], byPos };
const people = data.filter((p) => p.name);

const t = new Date();
const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
const add = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
const works = (p, d) => { const s = M.dayFor(p.pos, p, d, opts); return !!(s && !s.status); };
const seat = (p, d) => { const s = M.dayFor(p.pos, p, d, opts); return s.acting ? s.acting.targetPos : p.pos; };
const eligible = (poster, d) => M.eligibleTakers(d, poster, { people, opts }).map((e) => e.p);
const workDays = (p, n, from) => { const out = []; for (let k = from; out.length < n && k < 60; k++) if (works(p, add(k))) out.push(add(k)); return out; };

const trades = (rec.trades || []).filter((x) => x.status === "open" && x.date >= M.isoDate(today));
const replies = [];
let n = 0;
const taken = (p, d) => trades.some((x) => x.posterKey === p.pos && x.date === M.isoDate(d));
function post(p, d, note, aud) {
  const id = "sample" + ++n;
  trades.push({ id, posterKey: p.pos, posterName: p.name, seatPos: seat(p, d), date: M.isoDate(d), note, audience: aud,
    status: "open", createdAt: new Date(Date.now() - (20 - n) * 36e5).toISOString() });
  return id;
}
function reply(tradeId, p, proposal, note) {
  replies.push({ id: "sample-r" + ++n, tradeId, takerKey: p.pos, takerName: p.name, proposal, note,
    createdAt: new Date(Date.now() - (10 - n) * 36e5).toISOString() });
}

// --posters LT_POS,FFPM_POS picks the two posters; by default the first named Lieutenant and FF/Paramedic in their own
// seat (not a swing, no leave or cover on record).
const busy = new Set([].concat((rec.statuses || []).map((s) => s.pos), (rec.covers || []).map((c) => c.coverKey), (rec.covers || []).map((c) => c.targetPos)));
const firstOf = (rank) => people.find((p) => p.rank === rank && !p.swing && !p.open && !busy.has(p.pos));
const pi = process.argv.indexOf("--posters");
const [lp, gp] = pi !== -1 ? (process.argv[pi + 1] || "").split(",") : [];
const officer = (lp && byPos[lp]) || firstOf("Lieutenant"), medic = (gp && byPos[gp]) || firstOf("FF/Paramedic");
// Ashgrove: one on the board with two responses (a swap and pay back later), one sent to a few officers.
const [l1, l2] = workDays(officer, 4, 2).filter((d) => !taken(officer, d));
const lt = post(officer, l1, "Daughter's recital", { board: true, to: [] });
const lEl = eligible(officer, l1).filter((p) => !p.swing);
const swapper = lEl.find((p) => { const s = workDays(p, 1, 3)[0]; return s && !works(officer, s); });
reply(lt, swapper, { swapDate: M.isoDate(workDays(swapper, 1, 3)[0]) }, "Can swap");
const later = lEl.find((p) => p !== swapper);
reply(lt, later, { later: true }, "");
post(officer, l2, "", { board: false, to: eligible(officer, l2).slice(0, 6).map((p) => p.pos) });
// Thornbury: one on the board, one sent to two people and the board.
const [g1, g2] = workDays(medic, 2, 2);
post(medic, g1, "Out of town", { board: true, to: [] });
post(medic, g2, "", { board: true, to: eligible(medic, g2).slice(0, 2).map((p) => p.pos) });
// Colleagues' trades that land on Ashgrove's and Thornbury's boards (days they're off).
function colleagues(me, rank, notes) {
  let made = 0;
  for (const o of people.filter((p) => rank.includes(p.rank) && p.pos !== me.pos && !p.swing && p !== swapper && p !== later)) {
    if (made >= notes.length) break;
    const d = workDays(o, 4, 2).find((x) => !works(me, x) && eligible(o, x).some((p) => p.pos === me.pos));
    if (!d) continue;
    post(o, d, notes[made], { board: true, to: made === 0 ? [me.pos] : [] });
    made++;
  }
}
colleagues(officer, ["Captain", "Lieutenant"], ["Vacation", "Family event", ""]);
colleagues(medic, ["FF/Paramedic"], ["Wedding", "", "Kid's game"]);
// Someone who could take Thornbury's board post, to view the board from the other side.
const ffpm = eligible(medic, g1).find((p) => !p.swing);
const viewAs = [officer.pos, medic.pos, swapper.pos, ffpm.pos];

/* --extra YYYY-MM-DD:POS adds two people to "Viewing as" who could take POS's shift that day (one who isn't working the
   day before or after, one who works the day after), so a trade on that day can be posted, answered and picked in the
   demo. It adds no trade; the person testing posts it. */
const ei = process.argv.indexOf("--extra");
if (ei !== -1) {
  const [day, pos] = (process.argv[ei + 1] || "").split(":");
  const poster = byPos[pos], d = day && new Date(day + "T00:00:00");
  if (!poster || !d || !works(poster, d)) throw new Error("--extra needs a date the position works, e.g. 2026-12-25:21EOA15M");
  const takers = M.eligibleTakers(d, poster, { people, opts }).filter((e) => !e.p.swing && viewAs.indexOf(e.p.pos) === -1);
  [takers.find((e) => !e.before && !e.after), takers.find((e) => e.after)].forEach((e) => { if (e) viewAs.push(e.p.pos); });
}

process.stdout.write(JSON.stringify({ people: viewAs, trades, tradeReplies: replies }));
