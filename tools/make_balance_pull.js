/* Builds a fir-db1 time balances pull for any list of people, from cleanup/fir-pull-time-balances-test.js (the same
 * script with a different people list). The JSON is [{key, id, name}] (key = seat key or person record key).
 *
 *   node tools/make_balance_pull.js <people.json> <out.js> [label]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const [list, out, label] = process.argv.slice(2);
if (!list || !out) { console.error("usage: node tools/make_balance_pull.js <people.json> <out.js> [label]"); process.exit(2); }
const people = JSON.parse(fs.readFileSync(list, "utf8")).filter((p) => /^[A-Z]{2}\d{4}$/.test(p.id || ""));
const src = fs.readFileSync(path.join(__dirname, "..", "cleanup", "fir-pull-time-balances-test.js"), "utf8");
const at = src.lastIndexOf("})({ fileName:");
if (at < 0) throw new Error("template changed: no PLAN at the end of the test script");
const head = src.slice(0, at).replace(/\(test: [^)]*\)/, "(" + (label || people.length + " people") + ")");
const plan = { fileName: "fir-time-balances.csv", people: people.map((p) => ({ key: p.key, id: p.id, name: p.name })) };
fs.writeFileSync(out, head + "})(" + JSON.stringify(plan) + ");\n");
console.log("wrote " + out + ": " + people.length + " people");
