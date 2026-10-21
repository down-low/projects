/* Compares the department's own records with the tool and writes a numbered list of proposed fixes.
 *
 *   node tools/reconcile/reconcile.js --db <dump folder> [--rosters station-rosters.csv] [--time fir-sweep.csv]
 *        [--out cleanup/sync-<date>.md] [--batches <folder>]
 *
 * --rosters: fir-sap2 station rosters as one CSV (tools/reconcile/xlsx2csv.py).
 * --time:    fir-db1 employee time pages as one CSV (cleanup/fir-sweep.js, or any fir pull).
 * Writes the list (markdown) and <batches>/proposals.json: every item with the page database writes that apply it.
 * Then tools/reconcile/pick.js turns the items you accept into write batches.
 *
 * Rules, as settled while cleaning up by hand (10/2026):
 * - The H class on the station roster includes acting, so a rank difference alone changes nothing.
 * - Roster reason: OWN owns a seat at that company, VR vacancy relief, OSE owns a seat elsewhere, blank no seat yet.
 * - Time codes: REG worked (with the position), H off; TRO/TRW trades and WDO extra shifts are ignored.
 *   DP shows only on the day itself, so a run of DP days means disability from at least the first one.
 * - A position that isn't on the vacancy list (details, "...T" temporaries, other bureaus) means working elsewhere.
 * - The seat someone works on 3+ of their REG days (or every REG day, if 2+) is a standing cover; one day is a fill.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const tool = require("./page.js");

function args() {
  const a = {}, v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, "")] = v[i + 1];
  if (!a.db || (!a.rosters && !a.time)) { console.error("usage: node tools/reconcile/reconcile.js --db <dump> [--rosters csv] [--time csv] [--out md] [--batches dir]"); process.exit(2); }
  return a;
}

// Runs in the page: everything that needs the tool's view of seats, owners, covers and statuses.
function analyse(input) {
  const A = window.__api, ppl = A.people(), byPos = A.byPos();
  const home = (p) => (p ? A.apparatus(A.home(p)) : null);
  const iso = (s) => { if (!s) return ""; if (/^\d{4}-/.test(s)) return s; const x = s.split("/"); return (x[2].length === 2 ? "20" + x[2] : x[2]) + "-" + x[0].padStart(2, "0") + "-" + x[1].padStart(2, "0"); };
  const dayBefore = (s) => { const d = A.fromIso(s); d.setDate(d.getDate() - 1); return A.iso(d); };
  const md = (s) => { const x = s.split("-"); return +x[1] + "/" + +x[2]; };
  const RANK = { "H 40": "Battalion Chief", "H 30": "Captain", "H 33": "Rescue Captain", "H 20": "Lieutenant", "H 10": "ISS", "H 3": "FF/Paramedic", "H 2": "Firefighter", "H120": "Pilot", "H110": "Marine Engineer" };
  const tracked = new Set(Object.values(byPos).map(home).filter(Boolean));
  const byId = {}; ppl.forEach((p) => { if (p.emplId) byId[p.emplId] = p; });
  const covers = A.recs().covers, statuses = A.recs().statuses;
  const items = [], notes = [];
  const NOW = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const add = (group, title, evidence, writes) => items.push({ group, title, evidence, writes });
  const note = (group, title, evidence) => notes.push({ group, title, evidence });
  const activeOn = (r, d) => r.start <= d && (!r.end || r.end >= d);
  // The status record (not just its code) in force for a key on a date; the latest start wins, as in the page.
  const statusRec = (key, d) => statuses.filter((s) => s.pos === key && activeOn(s, d)).sort((x, y) => (y.start || "").localeCompare(x.start || ""))[0] || null;
  const short = (name) => { const p = name.split(","); return p[0] + "," + (p[1] || "").trim().charAt(0); };

  /* ---- Station rosters ---- */
  const seenRow = new Set(); // the same station can come twice (a re-downloaded file)
  (input.rosters || []).filter((r) => { const k = r.id + "|" + r.company; if (seenRow.has(k)) return false; seenRow.add(k); return true; }).forEach((r) => {
    if (!r.id || byId[r.id]) {
      const hit = byId[r.id];
      // A rank difference matters only when no cover already puts them in a seat of the roster's rank.
      const today = A.iso(A.today());
      const actingThere = hit && covers.some((c) => c.coverKey === hit.pos && !c.move && activeOn(c, today) && byPos[c.targetPos] && byPos[c.targetPos].rank === RANK[r.rank]);
      if (hit && RANK[r.rank] && hit.rank !== RANK[r.rank] && !actingThere) note("Rank", hit.name + " " + r.id, "roster " + r.rank + " (" + (r.reason || "no code") + " at " + r.company + "), tool " + hit.rank + " · H class may be acting");
      return;
    }
    if (!tracked.has(r.company)) return;
    const last = r.name.split(",")[0], first = (r.name.split(",")[1] || " ").trim().charAt(0);
    const same = A.byName(last + "," + first);
    const free = same.filter((x) => !x.emplId && home(x) === r.company);
    const taken = same.filter((x) => x.emplId && home(x) === r.company);
    if (free.length === 1) {
      const p = free[0];
      const w = p.added
        ? { op: "update", collection: "people", doc_id: p.pos.replace(/^person:/, ""), data: { emplId: r.id }, needsVersion: true }
        : { op: "set", collection: "rosterOverrides", doc_id: p.pos, data: { emplId: r.id, forName: (A.orig(p.pos) || p).name, name: null, rank: null, updatedAt: NOW, updatedBy: "admin" } };
      add("Employee IDs", p.name + " → " + r.id, "station roster " + r.station + ": " + r.name + ", " + (r.reason || "no code") + " at " + r.company + " · tool " + p.pos + " has no ID", [w]);
    } else if (taken.length && r.reason === "OWN") {
      note("Employee IDs to check", r.name + " " + r.id, "owns at " + r.company + " per roster; tool has " + taken.map((x) => x.name + " " + x.emplId + " (" + x.pos + ")").join(", "));
    } else if (same.some((x) => !x.emplId) && !free.length) {
      note("Employee IDs to check", r.name + " " + r.id, "roster at " + r.company + "; tool has the name elsewhere: " + same.map((x) => x.name + " " + (x.emplId || "no ID") + " " + home(x)).join(", "));
    } else if (RANK[r.rank] || !r.rank) {
      add("People to add", r.name + " " + r.id + " · " + r.company, "station roster " + r.station + ": " + (r.reason || "no seat code") + ", " + (r.rank || "no H class"),
        [{ op: "set", collection: "people", doc_id: "x-" + r.id, data: { company: r.company, createdAt: NOW, createdBy: "admin", emplId: r.id, name: short(r.name),
          note: r.name + " · fir-sap2 station roster " + r.station + ": " + (r.reason || "no seat code") + " at " + r.company + ", " + (r.rank || "no H class") + (/H (20|30|33)/.test(r.rank) ? " (H class may be acting)" : "") + " · needs contact info",
          rank: RANK[r.rank] || "Firefighter", tour: null } }]);
    } else note("Not tracked", r.name + " " + r.id, r.rank + " at " + r.company);
  });

  /* ---- Time pages ---- */
  const T = {};
  (input.time || []).forEach((r) => { if (r.mode === "empl" && r.emplId && r.date) (T[r.emplId] = T[r.emplId] || []).push(Object.assign({}, r, { d: iso(r.date) })); });
  const dates = [...new Set([].concat(...Object.values(T)).map((r) => r.d))].sort();
  const seatDaysCache = {};
  const seatDays = (pos) => { if (!seatDaysCache[pos]) seatDaysCache[pos] = dates.filter((d) => A.dayRows(A.fromIso(d)).some((x) => x.slot.pos === pos)); return seatDaysCache[pos]; };
  const info = {};
  Object.entries(T).forEach(([id, rs]) => {
    rs.sort((a, b) => a.d.localeCompare(b.d));
    const reg = rs.filter((r) => r.trc === "REG" && r.position);
    const cnt = {}; reg.forEach((r) => { cnt[r.position] = (cnt[r.position] || 0) + 1; });
    const main = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const leave = {}; rs.forEach((r) => { if (!["H", "REG", "TRO", "TRW", "WDO", ""].includes(r.trc)) leave[r.trc] = (leave[r.trc] || 0) + 1; });
    info[id] = { id, name: rs[0].name, rs, reg, main, leave, dp: rs.filter((r) => r.trc === "DP").map((r) => r.d) };
  });
  const last = dates[dates.length - 1] || A.iso(A.today());
  Object.values(info).forEach((o) => {
    const p = byId[o.id];
    if (!p) return; // not in the tool yet: added from the rosters first, then a later run places them
    const key = p.pos, mine = covers.filter((c) => c.coverKey === key);
    const move = mine.find((c) => c.move && activeOn(c, last));
    const own = move ? move.targetPos : (p.added ? null : p.pos);
    const live = mine.filter((c) => !c.move && activeOn(c, last));
    const stOn = (d) => statusRec(key, d);
    const leaveTxt = Object.entries(o.leave).map(([k, v]) => k + "×" + v).join(" ");
    const regAfter = (d) => o.reg.find((r) => r.d > d);

    // Disability: DP days in the window.
    if (o.dp.length) {
      const first = o.dp[0], lastDp = o.dp[o.dp.length - 1], back = regAfter(lastDp);
      const st = stOn(lastDp);
      if (!st || st.code !== "D") {
        add("Statuses", p.name + " D from " + md(first) + (back ? " to " + md(dayBefore(back.d)) : ""), "fir-db1: DP on " + o.dp.map(md).join(", ") + (back ? "; REG again " + md(back.d) + " in " + back.position : "") + " · start is the first DP day seen (may be earlier)",
          [{ op: "set", collection: "statuses", doc_id: "st-D-" + o.id, data: { code: "D", name: p.name, pos: key, start: first, end: back ? dayBefore(back.d) : null,
            note: "Disability (fir-db1 DP from " + md(first) + (back ? "; back " + md(back.d) : "") + ") · start may be earlier", createdAt: NOW, createdBy: "admin" } }]);
      } else if (back && !st.end) {
        add("Statuses", "End " + p.name + "'s D on " + md(dayBefore(back.d)), "fir-db1: last DP " + md(lastDp) + ", REG " + md(back.d) + " in " + back.position,
          [{ op: "update", collection: "statuses", doc_id: st.id, data: { end: dayBefore(back.d) }, needsVersion: true }]);
      }
    } else {
      // The tool has them on D or WE, but they're working.
      const st = o.reg.length ? stOn(o.reg[0].d) : null;
      if (st && (st.code === "D" || st.code === "WE") && !st.end && o.reg.length >= 2) {
        const offList = o.main.length && !byPos[o.main[0][0]];
        if (!(st.code === "WE" && offList))
          add("Statuses", "End " + p.name + "'s " + st.code + " on " + md(dayBefore(o.reg[0].d)), "fir-db1: REG " + o.reg.map((r) => md(r.d) + " " + r.position).join(", "),
            [{ op: "update", collection: "statuses", doc_id: st.id, data: { end: dayBefore(o.reg[0].d) }, needsVersion: true }]);
      }
    }
    if (!o.main.length) { if (leaveTxt && !o.dp.length) note("Leave only", p.name + " " + o.id, leaveTxt); return; }

    const [seat, n] = o.main[0], total = o.reg.length, firstIn = o.reg.find((r) => r.position === seat).d;
    const steady = n >= 3 || (o.main.length === 1 && n >= 2);
    // Working a position that isn't on the vacancy list.
    if (!byPos[seat]) {
      const st = stOn(firstIn);
      if (steady && !(st && st.code === "WE"))
        add("Statuses", p.name + " WE (" + seat + ")", "fir-db1: worked " + seat + " on " + n + " of " + total + " REG days · not on the vacancy list",
          [{ op: "set", collection: "statuses", doc_id: "st-WE-" + o.id, data: { code: "WE", name: p.name, pos: key, start: firstIn, end: null, note: "Working elsewhere: " + seat + " (fir-db1, seen from " + md(firstIn) + ") · start may be earlier", createdAt: NOW, createdBy: "admin" } }]);
      else if (!steady) note("One-off", p.name + " " + o.id, seat + " ×" + n + " (not on the vacancy list)");
      return;
    }
    // Back in their own seat: end covers that say otherwise.
    if (seat === own && o.main.length === 1 && n >= 2) {
      live.filter((c) => c.kind !== "extra" && c.kind !== "shadow" && c.start < o.reg[0].d).forEach((c) => {
        add("Covers to end", p.name + ": end cover in " + c.targetPos + " on " + md(dayBefore(o.reg[0].d)), "fir-db1: back in own seat " + own + " on " + n + " of " + total + " REG days",
          [{ op: "update", collection: "covers", doc_id: c.id, data: { end: dayBefore(o.reg[0].d) }, needsVersion: true }]);
      });
      return;
    }
    if (seat === own || mine.some((c) => !c.move && c.targetPos === seat && o.reg.some((r) => r.position === seat && activeOn(c, r.d)))) return; // agrees
    if (!steady) { note(o.main.length > 1 ? "Relief (moves around)" : "One-off", p.name + " " + o.id, o.main.map(([k, v]) => k + "×" + v).join(" ")); return; }
    const s = byPos[seat], ownerKey = s.name && s.status !== "Vacant" ? s.pos : null;
    let why = "vacant";
    if (ownerKey) {
      const ost = statusRec(ownerKey, firstIn);
      const away = ost || covers.some((c) => c.coverKey === ownerKey && !c.move && activeOn(c, firstIn));
      const oi = s.emplId && info[s.emplId];
      const ownerDp = oi && oi.dp.length;
      const chain = oi && oi.main.length && oi.main[0][0] !== seat;
      if (away) why = "owner away (" + (ost ? ost.code : "covering elsewhere") + ")";
      else if (ownerDp) why = "owner on DP (see Statuses)";
      else if (chain) why = "owner works " + oi.main[0][0];
      else {
        const sd = seatDays(seat), on = o.reg.filter((r) => r.position === seat && sd.includes(r.d)).length;
        note("Day-to-day fills (owner looks present)", p.name + " → " + seat + " (" + s.name + ")", "worked " + on + " of " + sd.length + " seat days" + (oi ? "" : " · owner " + (s.emplId || "no ID") + " not in this pull"));
        return;
      }
    }
    add("Covers", p.name + " → " + seat + " (" + (s.name || "vacant") + ")", "fir-db1: worked " + seat + " on " + n + " of " + total + " REG days from " + md(firstIn) + " · " + why + (p.rank !== s.rank ? " · shows as acting" : ""),
      [{ op: "set", collection: "covers", doc_id: "c-" + o.id + "-" + seat, data: { coverKey: key, coverName: p.name, targetPos: seat, start: firstIn, end: null, kind: null, move: null,
        note: "fir-db1 Time Entry: worked " + seat + " on " + n + " of " + total + " REG days (" + why + ") · start may be earlier", createdAt: NOW, createdBy: "admin" } }]);
  });
  return { items, notes, window: dates.length ? md(dates[0]) + "–" + md(last) + "/" + last.slice(0, 4) : "" };
}

(async () => {
  const a = args();
  const rosters = a.rosters ? tool.parseCsv(fs.readFileSync(a.rosters, "utf8")) : [];
  const time = a.time ? tool.parseCsv(fs.readFileSync(a.time, "utf8")) : [];
  const { browser, page, errors } = await tool.open(a.db);
  const res = await page.evaluate(analyse, { rosters, time });
  await browser.close();
  if (errors.length) console.warn("page errors:", errors);

  const ORDER = ["Employee IDs", "People to add", "Statuses", "Covers", "Covers to end"];
  res.items.sort((x, y) => ORDER.indexOf(x.group) - ORDER.indexOf(y.group));
  res.items.forEach((it, i) => { it.n = i + 1; });
  const today = new Date().toISOString().slice(0, 10);
  const out = a.out || path.join(__dirname, "..", "..", "cleanup", "sync-" + today + ".md");
  const L = ["# Sync " + today, "",
    "Sources: " + [a.rosters && "station rosters (" + rosters.length + " rows)", a.time && "fir-db1 time pages " + res.window + " (" + new Set(time.map((r) => r.emplId)).size + " people)"].filter(Boolean).join(", ") + ".",
    "Reply with the numbers to apply, e.g. \"all\", \"all except 4, 9\", or \"1-20\", plus anything you know that changes an item.", ""];
  ORDER.forEach((g) => {
    const its = res.items.filter((x) => x.group === g);
    if (!its.length) return;
    L.push("## " + g + " (" + its.length + ")", "");
    its.forEach((it) => L.push(it.n + ". **" + it.title + "** · " + it.evidence));
    L.push("");
  });
  const ng = {}; res.notes.forEach((x) => (ng[x.group] = ng[x.group] || []).push(x));
  if (res.notes.length) L.push("## For information (no change proposed)", "");
  Object.entries(ng).forEach(([g, xs]) => { L.push("**" + g + " (" + xs.length + ")**", ""); xs.forEach((x) => L.push("- " + x.title + " · " + x.evidence)); L.push(""); });
  fs.writeFileSync(out, L.join("\n"));
  const dir = a.batches || path.join(path.dirname(out), ".sync-" + today);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "proposals.json"), JSON.stringify(res.items, null, 1));
  const by = {}; res.items.forEach((x) => { by[x.group] = (by[x.group] || 0) + 1; });
  console.log("wrote " + out + " · " + res.items.length + " proposals " + JSON.stringify(by) + " · " + res.notes.length + " notes · " + path.join(dir, "proposals.json"));
})().catch((e) => { console.error(e); process.exit(1); });
