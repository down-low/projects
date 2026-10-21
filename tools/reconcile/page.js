/* Opens dist/tour-schedule.html headless against a dump of the page database, for the cleanup tools.
 * The dump is a folder of <collection>/<doc id>.json (what ArtifactData list with out_dir writes).
 * Exposes the Employee card api (people, byPos, dayRows, statusFor, recs, ...) as window.__api.
 * Needs Playwright (the cloud container has it at /opt/node-tools). */
"use strict";
const fs = require("fs");
const path = require("path");

const PLAYWRIGHT = ["/opt/node-tools/node_modules/playwright", "playwright"];
const DIST = path.join(__dirname, "..", "..", "dist", "tour-schedule.html");
const COLLECTIONS = ["covers", "statuses", "people", "rosterOverrides", "tourChanges", "staffing"];

function loadDump(dir) {
  const db = {};
  COLLECTIONS.forEach(function (c) {
    const d = path.join(dir, c), o = {};
    if (fs.existsSync(d)) fs.readdirSync(d).filter((f) => f.endsWith(".json")).forEach((f) => { o[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); });
    db[c] = o;
  });
  return db;
}

// In-memory window.claude db: enough of the page database api for the page to load the records read-only.
const STUB = `(function () {
  var subs = {};
  function coll(name) { return window.__db[name] = window.__db[name] || {}; }
  function snap(name) { return { docs: Object.keys(coll(name)).map(function (id) { var d = coll(name)[id]; return { id: id, data: function () { return JSON.parse(JSON.stringify(d)); } }; }) }; }
  function doc(name, id) { return { id: id, get: function () { var d = coll(name)[id]; return Promise.resolve({ exists: !!d, data: function () { return JSON.parse(JSON.stringify(d)); } }); },
    set: function () { return Promise.resolve(); }, update: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); } }; }
  var db = { collection: function (name) { return { onSnapshot: function (f) { (subs[name] = subs[name] || []).push(f); f(snap(name)); return function () {}; },
    add: function () { return Promise.resolve({ id: "x" }); }, doc: function (id) { return doc(name, id); } }; } };
  var user = { canEdit: function () { return Promise.resolve(true); }, id: function () { return Promise.resolve("tool"); }, can: function () { return Promise.resolve(true); } };
  window.claude = { use: function (k) { return Promise.resolve(k === "db" ? db : k === "user" ? user : null); } };
  var cv; Object.defineProperty(window, "CardViews", { configurable: true, set: function (v) { cv = v; }, get: function () { return function (api) { window.__api = api; return cv(api); }; } });
})();`;

async function open(dumpDir) {
  let pw = null;
  for (const p of PLAYWRIGHT) { try { pw = require(p); break; } catch (e) { /* try the next */ } }
  if (!pw) throw new Error("Playwright not found");
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const html = fs.readFileSync(DIST, "utf8");
  await page.setContent("<!doctype html><html><body><script>window.__db=" + JSON.stringify(loadDump(dumpDir)) + ";" + STUB + "</script>" + html + "</body></html>");
  await page.waitForFunction(() => window.__api && window.__api.people().length > 0, null, { timeout: 30000 });
  return { browser, page, errors };
}

// CSV reading/writing shared by the tools.
function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.some(Boolean)).map((r) => { const o = {}; head.forEach((h, i) => { o[h.trim()] = (r[i] || "").trim(); }); return o; });
}

module.exports = { open, loadDump, parseCsv };
