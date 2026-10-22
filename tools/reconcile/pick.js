/* Turns accepted proposals into page database write batches (50 writes or fewer each).
 *
 *   node tools/reconcile/pick.js <proposals.json> [--only 1-20,25] [--skip 4,9] [--out <folder>]
 *
 * Writes <folder>/batch-1.json, batch-2.json, ... for ArtifactData batch. Updates to existing documents need the
 * document's current version (if_version): those are listed so they can be read first and filled in.
 */
"use strict";
const fs = require("fs");
const path = require("path");

function range(spec) {
  const s = new Set();
  String(spec || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(x);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) s.add(i); else s.add(+x);
  });
  return s;
}

const v = process.argv.slice(2), file = v[0], a = {};
for (let i = 1; i < v.length; i += 2) a[v[i].replace(/^--/, "")] = v[i + 1];
if (!file) { console.error("usage: node tools/reconcile/pick.js <proposals.json> [--only 1-20] [--skip 4,9] [--out dir]"); process.exit(2); }
const items = JSON.parse(fs.readFileSync(file, "utf8"));
const only = a.only ? range(a.only) : null, skip = range(a.skip);
const chosen = items.filter((it) => (!only || only.has(it.n)) && !skip.has(it.n));
const writes = [], seen = new Set(), versions = [];
chosen.forEach((it) => it.writes.forEach((w) => {
  const k = w.collection + "/" + w.doc_id;
  if (seen.has(k)) return; // two proposals touching the same document: keep the first
  seen.add(k);
  const out = { op: w.op, collection: w.collection, doc_id: w.doc_id };
  if (w.data) out.data = w.data;
  if (w.needsVersion) { out.if_version = null; versions.push(k + " (item " + it.n + ")"); }
  writes.push(out);
}));
const dir = a.out || path.dirname(file);
fs.mkdirSync(dir, { recursive: true });
fs.readdirSync(dir).filter((f) => /^batch-\d+\.json$/.test(f)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
for (let i = 0; i * 50 < writes.length; i++) fs.writeFileSync(path.join(dir, "batch-" + (i + 1) + ".json"), JSON.stringify(writes.slice(i * 50, i * 50 + 50)));
console.log(chosen.length + " items, " + writes.length + " writes, " + Math.ceil(writes.length / 50) + " batch file(s) in " + dir);
if (versions.length) console.log("needs if_version (read these first): " + versions.join(", "));
