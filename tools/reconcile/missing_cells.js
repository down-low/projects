/* Lists everyone in the tool with no staff-list cell number, by rank (names, positions and Employee IDs only; never
 * numbers). Needs a dump that includes contacts (admin read).
 *
 *   node tools/reconcile/missing_cells.js --db <dump folder> [--out cleanup/missing-cells.md] [--json <file>]
 */
"use strict";
const fs = require("fs");
const tool = require("./page.js");

const v = process.argv.slice(2), a = {};
for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, "")] = v[i + 1];
if (!a.db) { console.error("usage: node tools/reconcile/missing_cells.js --db <dump folder> [--out file] [--json file]"); process.exit(2); }

(async () => {
  const { browser, page } = await tool.open(a.db);
  const res = await page.evaluate(() => {
    const A = window.__api, cells = A.contacts(), t = A.today();
    const all = A.people().filter((p) => p.name);
    const missing = all.filter((p) => !(cells[p.pos] && cells[p.pos].staffList && cells[p.pos].phoneMobile)).map((p) => ({
      key: p.pos, name: p.name, rank: p.rank, hclass: p.hclass || "", id: p.emplId || "", co: A.home(p) || "",
      position: p.added ? "added" : p.pos, tour: A.tourOn(p, t) || "" }));
    return { ranks: A.RANKS, total: all.length, missing };
  });
  await browser.close();
  const by = {};
  res.missing.forEach((p) => (by[p.rank] = by[p.rank] || []).push(p));
  const order = res.ranks.concat(Object.keys(by).filter((r) => res.ranks.indexOf(r) === -1));
  const coKey = (co) => { const m = /^([A-Z]+)(\d+)$/.exec(co || ""); return m ? m[1] + ("000" + m[2]).slice(-3) : "ZZZ" + co; };
  const lines = ["# People in the tool with no cell number", "",
    "Generated " + new Date().toISOString().slice(0, 10) + " from the page records: " + res.missing.length + " of " + res.total +
    " people have no staff-list cell. Names, positions and Employee IDs only; numbers never go in the repo.", "",
    "| Rank | Missing |", "| --- | --- |"];
  order.filter((r) => by[r]).forEach((r) => lines.push("| " + r + " | " + by[r].length + " |"));
  order.filter((r) => by[r]).forEach((r) => {
    lines.push("", "## " + r + " (" + by[r].length + ")", "", "| Name | Employee ID | Company | Position | Tour | H-class |", "| --- | --- | --- | --- | --- | --- |");
    by[r].sort((x, y) => coKey(x.co).localeCompare(coKey(y.co)) || x.name.localeCompare(y.name))
      .forEach((p) => lines.push("| " + [p.name, p.id || "—", p.co || "—", p.position, p.tour || "—", p.hclass || "—"].join(" | ") + " |"));
  });
  fs.writeFileSync(a.out || "cleanup/missing-cells.md", lines.join("\n") + "\n");
  if (a.json) fs.writeFileSync(a.json, JSON.stringify(res.missing));
  console.log(res.missing.length + " of " + res.total + " missing; " + order.filter((r) => by[r]).map((r) => r + " " + by[r].length).join(", "));
})().catch((e) => { console.error(e); process.exit(1); });
