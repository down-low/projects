/* Builds cleanup/fir-sweep.js: one fir-db1 console script that pulls the employee time page (14 days) for everyone
 * the tool knows by Employee ID, plus everyone on the station rosters at a company the tool tracks, plus company pages
 * for seats that still have no ID. Three pages at a time; progress survives a sign-out (paste it again to carry on).
 *
 *   node tools/make_sweep.js --db <dump folder> [--rosters station-rosters.csv] [--date MM/DD/YYYY] [--out cleanup/fir-sweep.js]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const tool = require("./reconcile/page.js");
global.window = global;
require("../fir.js");

function args() {
  const a = {}, v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, "")] = v[i + 1];
  if (!a.db) { console.error("usage: node tools/make_sweep.js --db <dump folder> [--rosters csv] [--date MM/DD/YYYY] [--out file]"); process.exit(2); }
  return a;
}

(async () => {
  const a = args();
  const date = a.date || ""; // blank: the script asks for the date when it runs (today by default)
  const rosters = a.rosters ? tool.parseCsv(fs.readFileSync(a.rosters, "utf8")) : [];
  const { browser, page } = await tool.open(a.db);
  const plan = await page.evaluate((rosters) => {
    const A = window.__api, home = (p) => A.apparatus(A.home(p));
    const tracked = new Set(Object.values(A.byPos()).map(home).filter(Boolean));
    const people = [], seen = new Set(), noId = new Set();
    A.people().forEach((p) => {
      if (p.emplId && !seen.has(p.emplId)) { seen.add(p.emplId); people.push({ id: p.emplId, name: p.name, co: home(p) || "" }); }
      else if (!p.emplId && !p.added && p.name && p.company) noId.add(p.company);
    });
    rosters.forEach((r) => { if (r.id && !seen.has(r.id) && tracked.has(r.company)) { seen.add(r.id); people.push({ id: r.id, name: r.name, co: r.company }); } });
    return { people, companies: [...noId].sort() };
  }, rosters);
  await browser.close();
  const text = window.FirCompare.script({ date, people: plan.people, companies: plan.companies, concurrency: 3,
    resumeKey: "sweep" + (date ? "-" + date.replace(/\//g, "-") : ""), fileName: "",
    label: "sweep" + (date ? " " + date : "") + ": " + plan.people.length + " people, " + plan.companies.length + " company pages" });
  const out = a.out || path.join(__dirname, "..", "cleanup", "fir-sweep.js");
  fs.writeFileSync(out, text);
  console.log("wrote " + out + ": " + plan.people.length + " people, " + plan.companies.length + " company pages, date " + (date || "asked when it runs"));
})().catch((e) => { console.error(e); process.exit(1); });
