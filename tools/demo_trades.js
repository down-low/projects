#!/usr/bin/env node
/* Sample trades for the view-only demo page (tools/build_artifact.py --snapshot records.json --demo demo.json).

   Usage: node tools/demo_trades.js records.json > demo.json

   Picks real roster people and dates from today on, using the same schedule math as the page:
   Lester (Lieutenant, E10) and Goforth (FF/Paramedic, E21) each post trades, colleagues in their rank groups post trades
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

const lester = byPos["10ENL31M"], goforth = byPos["21EOA15M"];
// Lester: one on the board with two responses (a swap and pay back later), one sent to a few officers.
const [l1, l2] = workDays(lester, 4, 2).filter((d) => !taken(lester, d));
const lt = post(lester, l1, "Daughter's recital", { board: true, to: [] });
const lEl = eligible(lester, l1).filter((p) => !p.swing);
const swapper = lEl.find((p) => { const s = workDays(p, 1, 3)[0]; return s && !works(lester, s); });
reply(lt, swapper, { swapDate: M.isoDate(workDays(swapper, 1, 3)[0]) }, "Can swap");
const later = lEl.find((p) => p !== swapper);
reply(lt, later, { later: true }, "");
post(lester, l2, "", { board: false, to: eligible(lester, l2).slice(0, 6).map((p) => p.pos) });
// Goforth: one on the board, one sent to two people and the board.
const [g1, g2] = workDays(goforth, 2, 2);
post(goforth, g1, "Out of town", { board: true, to: [] });
post(goforth, g2, "", { board: true, to: eligible(goforth, g2).slice(0, 2).map((p) => p.pos) });
// Colleagues' trades that land on Lester's and Goforth's boards (days they're off).
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
colleagues(lester, ["Captain", "Lieutenant"], ["Vacation", "Family event", ""]);
colleagues(goforth, ["FF/Paramedic"], ["Wedding", "", "Kid's game"]);
// Someone who could take Goforth's board post, to view the board from the other side.
const ffpm = eligible(goforth, g1).find((p) => !p.swing);

process.stdout.write(JSON.stringify({ people: [lester.pos, goforth.pos, swapper.pos, ffpm.pos], trades, tradeReplies: replies }));
