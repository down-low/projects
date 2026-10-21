/* Builds cleanup/fir-pull-phones-<rank>.js, one fir-db1 console script per rank, for the people with no cell number
 * (the JSON that tools/reconcile/missing_cells.js writes with --json). People without an Employee ID can't be pulled
 * and are listed instead. The scripts hold IDs, names and keys only.
 *
 *   node tools/make_phone_pull.js <missing.json> [--out cleanup]
 */
"use strict";
const fs = require("fs");
const path = require("path");
global.window = global;
require("../fir.js");

const v = process.argv.slice(2), file = v[0], a = {};
for (let i = 1; i < v.length; i += 2) a[v[i].replace(/^--/, "")] = v[i + 1];
if (!file) { console.error("usage: node tools/make_phone_pull.js <missing.json> [--out dir]"); process.exit(2); }
const RANKS = ["Battalion Chief", "Rescue Captain", "Captain", "Lieutenant", "ISS", "FF/Paramedic", "Firefighter", "Pilot", "Marine Engineer"];
const slug = (r) => r.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
const missing = JSON.parse(fs.readFileSync(file, "utf8")), dir = a.out || path.join(__dirname, "..", "cleanup");
const ranks = RANKS.concat([...new Set(missing.map((p) => p.rank))].filter((r) => RANKS.indexOf(r) === -1));
fs.readdirSync(dir).filter((f) => /^fir-pull-phones-.*\.js$/.test(f)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
ranks.forEach((rank, i) => {
  const seen = new Set(), people = missing.filter((p) => p.rank === rank && p.id && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, name: p.name, key: p.key }));
  const noId = missing.filter((p) => p.rank === rank && !p.id);
  if (!people.length && !noId.length) return;
  if (people.length) {
    const name = "fir-pull-phones-" + String(i + 1).padStart(2, "0") + "-" + slug(rank);
    fs.writeFileSync(path.join(dir, name + ".js"), window.FirCompare.phoneScript({ people, concurrency: 2, resumeKey: "phones-" + slug(rank),
      fileName: "fir-phones-" + slug(rank) + ".csv", label: rank + ": " + people.length + " people with no cell in the tool" }));
  }
  console.log(rank + ": " + people.length + " to pull" + (noId.length ? "; no Employee ID (not pulled): " + noId.map((p) => p.name + " " + p.co).join(", ") : ""));
});
