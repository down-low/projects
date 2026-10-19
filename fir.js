/* Compare with fir-db1 (admins, Employee cards screen).
 * fir-db1 is the department's time system (Oracle APEX, city VPN only). Page 2 shows time entries either for one employee
 * (P2_WHICH=Empl: a run of days from a date) or for a company on a date (P2_WHICH=Co: everyone assigned there, with TRC "H" for
 * those off that day). Nothing here talks to fir-db1. The admin picks a rank level; the tool lists the people it has questions
 * about (targets()) and builds a console script for exactly those people (script()). Run in a signed-in fir-db1 tab, it pulls
 * each one's employee page, plus company pages for people without an Employee ID, and downloads one CSV. Choosing that CSV
 * compares every pulled day with the tool's own Projection for that day (app.js dayRows). The CSV stays in this browser.
 * window.FirCompare = {LEVELS, targets(api, level, all), parseList(text), targetsFromList(list, api, group), script(plan),
 * parseCsv(text), compare(rows, api)}. A list (e.g. cleanup/records-in-question.csv) can stand in for the tool's own questions.
 *
 * TRC (time reporting code): REG = working; H = off that day (not their shift); WDO = an extra shift on a day off (overtime,
 * which the tool doesn't track); anything else with hours (VA, IDV, FH, DP, WC…) is leave. The Status column (EMPL_CLASS: DP
 * disability, WC workers' comp) is the person's class, shown on every row; on a scheduled day it means off their seat, even
 * where a future day still reads REG.
 */
(function (root) {
  "use strict";

  var COLS = ["mode", "pulledFor", "date", "query", "emplId", "name", "co", "trc", "position", "role", "hours", "status", "flag"];
  // Rank levels, worked top-down (fewer people at the top). Ranks are the tool's names (schedule.js RANK_LEVEL).
  var LEVELS = [
    { id: "H40", label: "H40 · Battalion Chief", ranks: ["Battalion Chief"] },
    { id: "H30", label: "H30 · Captain, Rescue Captain", ranks: ["Captain", "Rescue Captain"] },
    { id: "H20", label: "H20 · Lieutenant", ranks: ["Lieutenant"] },
    { id: "H3", label: "H3 · FF/Paramedic", ranks: ["FF/Paramedic"] },
    { id: "H2", label: "H2 · Firefighter", ranks: ["Firefighter"] },
    { id: "other", label: "Other · ISS, Pilot, Marine Engineer", ranks: ["ISS", "Pilot", "Marine Engineer"] },
  ];
  var UNSURE = /not known|unknown|assumed|confirm|may vary|unofficial|not set|\?/i;

  /* The people at one rank level the tool has questions about, each with reasons. all: everyone at the level.
     api: {people(), recs(), byPos(), byName(key), today(), iso(d), coverOf(pos, d), statusFor(pos, d), home(p), kindWord(c)}.
     Returns [{p, reasons: [text]}], people with questions first. */
  function targets(api, levelId, all) {
    var lv = LEVELS.filter(function (l) { return l.id === levelId; })[0];
    if (!lv) return [];
    var t = api.today(), ti = api.iso(t), recs = api.recs(), M = root.TourMath;
    var fixes = recs.corrections || [];
    return api.people().filter(function (p) { return lv.ranks.indexOf(p.rank) !== -1; }).map(function (p) {
      var why = [], moved = M.movedTo(p.pos, t, recs.covers || []);
      if (!p.emplId) why.push("No Employee ID (checked by company)");
      if (p.added && !moved) why.push(p.company ? "Added, not on the vacancy list" : "Added, no seat or company");
      if (p.open && !moved) why.push("Own seat is open for bid");
      (recs.covers || []).forEach(function (c) {
        if (c.tradeId || (c.end && c.end < ti)) return;
        var mine = c.coverKey === p.pos, onSeat = c.targetPos === p.pos;
        if (!mine && !onSeat) return;
        var isMove = M.isMove(c), seat = api.byPos()[c.targetPos];
        if (mine && !isMove && c.start <= ti) why.push(api.kindWord(c) + " " + (seat ? seat.title : c.targetPos) + (UNSURE.test(c.note || "") ? " (note: " + shortNote(c.note) + ")" : ""));
        else if (mine && isMove && UNSURE.test(c.note || "")) why.push("Own seat " + c.targetPos + " (note: " + shortNote(c.note) + ")");
        else if (onSeat && !isMove && c.start <= ti && !mine) why.push("Someone else is in their seat (" + (c.coverName || c.coverKey) + ")");
      });
      var st = api.statusFor(p.pos, t);
      if (st === "D" || st === "WE") why.push(st === "D" ? "On disability" : "Working elsewhere");
      if (fixes.some(function (x) { return x.aboutKey === p.pos && x.state === "open"; })) why.push("Open correction");
      if ((api.byName(p.name) || []).length > 1) why.push("Same name as someone else");
      return { p: p, reasons: why };
    }).filter(function (x) { return all || x.reasons.length; }).sort(function (a, b) {
      return (b.reasons.length ? 1 : 0) - (a.reasons.length ? 1 : 0) || a.p.name.localeCompare(b.p.name);
    });
  }
  function shortNote(n) { n = String(n || ""); return n.length > 60 ? n.slice(0, 57) + "…" : n; }

  /* The console script for a plan: {date: "MM/DD/YYYY" or "", people: [{id, name, co}], companies: [codes], label}.
     Employee pages for people with IDs (14 days from the date); company pages (100 rows) for the companies listed. */
  function script(plan) {
    return "/* Tour schedule: fir-db1 pull (" + String(plan.label || "").replace(/\*\//g, "") + "). Paste in the console on a signed-in fir-db1 tab. */\n" +
      "(async () => {\n" +
      "  const PLAN = " + JSON.stringify({ date: plan.date || "", people: plan.people || [], companies: plan.companies || [] }) + ";\n" +
      "  const COLS = " + JSON.stringify(COLS) + ";\n" +
      "  const m = /[?&]p=(\\d+):\\d+:(\\d+)/.exec(location.href);\n" +
      "  if (!m) return alert('Open a fir-db1 page first (signed in), then run this again.');\n" +
      "  const app = '1022', session = m[2]; // Time Entry is app 1022, page 2; the session is shared with the 1021 menu\n" +
      "  let date = PLAN.date;\n" +
      "  if (!date) { const t = new Date(); date = (prompt('Date to pull (MM/DD/YYYY)', (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear()) || '').trim(); }\n" +
      "  if (!/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(date)) return alert('Use a date like 10/20/2026.');\n" +
      "  const base = location.origin + location.pathname + '?p=' + app + ':2:' + session + ':::RP,2:';\n" +
      "  const enc = (v) => encodeURIComponent(v || '');\n" +
      "  const val = (td) => {\n" +
      "    if (!td) return '';\n" +
      "    const c = td.cloneNode(true);\n" +
      "    c.querySelectorAll('script, noscript, label, .u-VisuallyHidden').forEach((x) => x.remove());\n" +
      "    const box = c.querySelector('input[type=checkbox]');\n" +
      "    if (box) return box.hasAttribute('checked') ? 'Y' : '';\n" +
      "    const f = c.querySelector('input:not([type=hidden]), select, textarea');\n" +
      "    if (f && f.tagName === 'SELECT') { const o = f.querySelector('option[selected]'); return o ? o.textContent.trim() : ''; }\n" +
      "    if (f) return (f.getAttribute('value') || '').trim();\n" +
      "    return c.textContent.replace(/\\s+/g, ' ').trim();\n" +
      "  };\n" +
      "  // Read the Time Entry table by column id (td headers=...), falling back to the heading text.\n" +
      "  const read = (html) => {\n" +
      "    const doc = new DOMParser().parseFromString(html, 'text/html');\n" +
      "    const table = doc.querySelector('table[aria-label=\"Time Entry\"], table.t-Report-report') ||\n" +
      "      [...doc.querySelectorAll('table')].find((tb) => /TRC/.test(tb.textContent) && /Position/.test(tb.textContent) && tb.querySelector('th'));\n" +
      "    if (!table) return null;\n" +
      "    const label = {};\n" +
      "    table.querySelectorAll('th').forEach((th) => { if (th.id) label[th.id] = th.textContent.replace(/\\s+/g, ' ').trim(); });\n" +
      "    const pick = (o, ids, labels) => { for (const k of ids) if (o.id[k] != null) return o.id[k]; for (const l of labels) if (o.lb[l] != null) return o.lb[l]; return ''; };\n" +
      "    return [...table.querySelectorAll('tr')].map((tr) => {\n" +
      "      const o = { id: {}, lb: {} };\n" +
      "      [...tr.querySelectorAll('td')].forEach((td) => { const h = td.getAttribute('headers'); if (!h) return; const v = val(td); o.id[h] = v; if (label[h] && o.lb[label[h]] == null) o.lb[label[h]] = v; });\n" +
      "      return { emplId: pick(o, ['ORDER_BY', 'EMPLID'], ['Empl']), name: pick(o, ['DATE_NAME', 'NAME'], ['Name']), date: pick(o, ['SCHD_DATE', 'SCHD_DT'], ['Date']),\n" +
      "        day: pick(o, [], ['Day']), co: pick(o, ['SCHD_COMPANY'], ['Co']), trc: pick(o, ['TIME_RPTG_CD'], ['TRC']), position: pick(o, ['POSITION_NBR'], ['Position']),\n" +
      "        role: pick(o, ['SCHD_ROLE_CD'], ['Role']), hours: pick(o, ['HOURS'], []), status: pick(o, ['EMPL_CLASS'], ['Status']) };\n" +
      "    }).filter((r) => r.trc || r.position || /^[A-Z]{2}\\d{4}$/.test(r.emplId));\n" +
      "  };\n" +
      "  const out = [], wait = () => new Promise((r) => setTimeout(r, 400));\n" +
      "  const get = async (url) => { const h = await (await fetch(url, { credentials: 'same-origin' })).text();\n" +
      "    if (!/Time Entry/.test(h) && /type=\"password\"/i.test(h)) throw new Error('signed-out'); return h; };\n" +
      "  const total = PLAN.people.length + PLAN.companies.length;\n" +
      "  let n = 0;\n" +
      "  try {\n" +
      "    for (const p of PLAN.people) {\n" +
      "      console.log('fir pull ' + (++n) + '/' + total + ': ' + p.name + ' ' + p.id);\n" +
      "      const rows = read(await get(base + 'P2_WHICH,P2_EMPLID,P2_COMPANY,P2_SCHD_DT:Empl,' + enc(p.id) + ',' + enc(p.co) + ',' + enc(date)));\n" +
      "      if (!rows) out.push({ mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name, flag: 'no-table' });\n" +
      "      else if (!rows.length) out.push({ mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name, flag: 'empty' });\n" +
      "      else rows.forEach((r) => out.push(Object.assign(r, { mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name })));\n" +
      "      await wait();\n" +
      "    }\n" +
      "    for (const co of PLAN.companies) {\n" +
      "      console.log('fir pull ' + (++n) + '/' + total + ': company ' + co);\n" +
      "      let rows = read(await get(base + 'P2_COMPANY,P2_SCHD_DT,P2_WHICH,P2_NUM_ROWS:' + enc(co) + ',' + enc(date) + ',Co,100'));\n" +
      "      if (!rows) rows = read(await get(base + 'P2_COMPANY,P2_SCHD_DT,P2_WHICH:' + enc(co) + ',' + enc(date) + ',Co'));\n" +
      "      if (!rows) out.push({ mode: 'co', pulledFor: date, query: co, flag: 'no-table' });\n" +
      "      else if (!rows.length) out.push({ mode: 'co', pulledFor: date, query: co, flag: 'empty' });\n" +
      "      else rows.forEach((r) => out.push(Object.assign(r, { mode: 'co', pulledFor: date, query: co, date: date })));\n" +
      "      await wait();\n" +
      "    }\n" +
      "  } catch (e) {\n" +
      "    if (e.message === 'signed-out') alert('fir-db1 signed you out. Sign in again and rerun; the rows so far are in the file.'); else console.error(e);\n" +
      "  }\n" +
      "  const q = (v) => { v = v == null ? '' : String(v); return /[\",\\n]/.test(v) ? '\"' + v.replace(/\"/g, '\"\"') + '\"' : v; };\n" +
      "  const csv = [COLS.join(',')].concat(out.map((r) => COLS.map((c) => q(r[c])).join(','))).join('\\n');\n" +
      "  const a = document.createElement('a');\n" +
      "  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));\n" +
      "  a.download = 'fir-' + date.replace(/\\//g, '-') + '.csv';\n" +
      "  document.body.appendChild(a); a.click(); a.remove();\n" +
      "  console.log('fir pull done: ' + out.length + ' rows.');\n" +
      "})();\n";
  }

  /* A list to check, e.g. cleanup/records-in-question.csv: any CSV with an employee_id (or emplId) column; rank_group,
     name, category and suggested_check are used when present. Returns {rows, groups}. */
  function parseList(text) {
    var rows = csvRows(text), head = rows.shift() || [];
    var idCol = head.indexOf("employee_id") !== -1 ? "employee_id" : head.indexOf("emplId") !== -1 ? "emplId" : null;
    if (!idCol) throw new Error("The list needs an employee_id column.");
    var out = rows.filter(function (r) { return r.length > 1; }).map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h] = (r[k] || "").trim(); });
      o.id = (o[idCol] || "").toUpperCase();
      return o;
    });
    var groups = [], order = ["H 40", "H 30", "H 20", "H 10", "H 3", "H 2"];
    out.forEach(function (o) { if (o.rank_group && groups.indexOf(o.rank_group) === -1) groups.push(o.rank_group); });
    groups.sort(function (a, b) { return ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99); }); // top ranks first
    return { rows: out, groups: groups };
  }
  // The people in a list (one rank group, or all) as targets: [{p, id, name, reasons}]; p is the tool's person or null.
  function targetsFromList(list, api, group) {
    var byId = {}, byShort = {}, seen = {}, out = [];
    // "Last,First M" and "Last,F" both reduce to last + first initial; used only when it picks out one person.
    var short = function (n) { var m = /^([^,]+),\s*(\S)/.exec(String(n || "")); return m ? (m[1] + "," + m[2]).toLowerCase().replace(/[^a-z,]/g, "") : ""; };
    api.people().forEach(function (p) {
      if (p.emplId) byId[p.emplId.toUpperCase()] = p;
      var k = short(p.name);
      if (k) (byShort[k] = byShort[k] || []).push(p);
    });
    list.rows.forEach(function (r) {
      if (group && r.rank_group !== group) return;
      var key = /^[A-Z]{2}\d{4}$/.test(r.id) ? r.id : "name:" + r.name;
      var why = [r.category, r.suggested_check].filter(Boolean).join(": ");
      if (seen[key]) { if (why && seen[key].reasons.indexOf(why) === -1) seen[key].reasons.push(why); return; }
      var nm = byShort[short(r.name)] || [];
      var t = seen[key] = { p: byId[r.id] || (!byId[r.id] && nm.length === 1 && !(nm[0].emplId && /^[A-Z]{2}\d{4}$/.test(r.id)) ? nm[0] : null), id: /^[A-Z]{2}\d{4}$/.test(r.id) ? r.id : "", name: r.name || r.id, reasons: why ? [why] : [] };
      out.push(t);
    });
    return out;
  }

  function csvRows(text) {
    var rows = [], row = [], f = "", q = false, i, c;
    text = String(text || "").replace(/^\ufeff/, "");
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  // CSV text -> rows (objects keyed by the header). Dates (MM/DD/YY or MM/DD/YYYY) become ISO.
  function parseCsv(text) {
    var rows = csvRows(text);
    var head = rows.shift() || [];
    if (head.indexOf("emplId") === -1 || head.indexOf("trc") === -1) throw new Error("This isn't a fir-db1 pull from this tool (no emplId / trc columns).");
    return rows.filter(function (r) { return r.length > 1; }).map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h] = (r[k] || "").trim(); });
      o.date = isoOf(o.date) || isoOf(o.pulledFor);
      o.emplId = (o.emplId || "").toUpperCase();
      return o;
    });
  }
  function isoOf(s) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s || "");
    if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : "";
    return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
  }
  function shortIso(iso) { return +iso.slice(5, 7) + "/" + +iso.slice(8, 10); }
  function nameKey(n) { return String(n || "").toLowerCase().replace(/[^a-z,]/g, ""); }

  // fir-db1's side of one row: working (REG, no Status), off (H: not their day) or leave (another TRC, or a Status like DP).
  function firState(f) {
    var trc = (f.trc || "").toUpperCase();
    if (trc === "H" || (!trc && !f.position)) return { kind: "off" };
    if (f.status) return { kind: "leave", code: f.status };
    if (trc === "REG") return { kind: "work" };
    if (trc === "WDO") return { kind: "extra" };
    return { kind: "leave", code: trc };
  }

  /* Compare pulled rows with the tool, day by day. api: {dayRows(d), people(), fromIso, apparatus(co)}.
     Returns {dates, flags, people: [{key, p, name, emplId, days, issues: [{date, fir, tool, note}], notes: [text]}], toolOnly,
     unknown}. Notes are things that agree but are worth knowing (a different leave code, an extra shift, working elsewhere). */
  function compare(rows, api) {
    var app = api.apparatus, flags = rows.filter(function (r) { return r.flag; });
    var data = rows.filter(function (r) { return !r.flag && r.date && (r.emplId || r.name); });
    if (!data.length) throw new Error(flags.length ? "The file only has flags (" + flags.map(function (f) { return f.query + " " + f.flag; }).join(", ") + ")." : "The file has no rows.");
    var peopleById = {}, peopleByName = {};
    api.people().forEach(function (p) {
      if (p.emplId) peopleById[p.emplId.toUpperCase()] = p;
      (peopleByName[nameKey(p.name)] = peopleByName[nameKey(p.name)] || []).push(p);
    });
    var dayCache = {};
    function toolDay(iso) {
      if (dayCache[iso]) return dayCache[iso];
      var byKey = {};
      api.dayRows(api.fromIso(iso)).forEach(function (r) {
        if (!r.name || !r.who) return;
        var e = { co: app(r.co), seat: r.slot.pos, status: r.status || null, off: !!r.off, away: !!r.away, kind: r.kind || null };
        var old = byKey[r.who.pos];
        if (!old || (old.off && !e.off)) byKey[r.who.pos] = e;
      });
      return (dayCache[iso] = byKey);
    }
    var byPerson = {}, unknown = {}, pulledCo = {}, known = null;
    if (api.companies) { known = {}; api.companies().forEach(function (c) { known[app(c)] = 1; }); }
    // A person's own employee page wins over a company page for the same day.
    var hasEmpl = {};
    data.forEach(function (f) { if (f.mode === "empl") hasEmpl[f.emplId + "|" + f.date] = 1; });
    data.forEach(function (f) {
      if (f.mode === "co") pulledCo[f.date + "|" + app(f.query)] = 1;
      if (f.mode === "co" && f.emplId && hasEmpl[f.emplId + "|" + f.date]) return;
      var p = (f.emplId && peopleById[f.emplId]) || null, how = "id";
      if (!p) { var nm = peopleByName[nameKey(f.name)] || []; if (nm.length === 1 && !nm[0].emplId) { p = nm[0]; how = "name"; } }
      if (!p) { var u = unknown[f.emplId || f.name] = unknown[f.emplId || f.name] || { emplId: f.emplId, name: f.name, rows: [] }; u.rows.push(f); return; }
      var rec = byPerson[p.pos] = byPerson[p.pos] || { key: p.pos, p: p, name: p.name, emplId: f.emplId || p.emplId, how: how, days: 0, issues: [], notes: [], dateFix: {} };
      var fs = firState(f), t = toolDay(f.date)[p.pos] || null, note = "";
      var toolKind = !t ? "off" : t.off ? "leave" : "work";
      var firCo = app(f.co || (f.mode === "co" ? f.query : ""));
      var addNote = function (n) { if (rec.notes.indexOf(n) === -1) rec.notes.push(n); };
      var offRoster = firCo && known && !known[firCo];
      // Status from the records too: someone on WE with no seat (it moved to someone else) has no row in the day.
      var toolSt = (t && t.status) || (api.statusFor ? api.statusFor(p.pos, api.fromIso(f.date)) : null);
      if (fs.kind === "extra") {
        rec.days++;
        if (!(toolKind === "work" && (!f.position || f.position === t.seat))) addNote("Extra shift (WDO) " + shortIso(f.date) + " at " + [firCo, f.position].filter(Boolean).join(" ") + " (overtime; the tool doesn't track it)");
        return;
      }
      // Someone the tool has as WE (working elsewhere) who fir-db1 shows working at a non-roster unit (CD3, DTA…) agrees.
      if (toolSt === "WE" && toolKind !== "work" && (fs.kind !== "work" || offRoster)) {
        rec.days++;
        if (offRoster) addNote("Works at " + firCo + "; WE in the tool");
        return;
      }
      if (fs.kind === "leave" && toolKind === "leave" && toolSt && toolSt !== fs.code) addNote("fir-db1 codes it " + fs.code + "; the tool has " + toolSt);
      // Status first, dates later: fir-db1 leave before the tool's matching record starts is a start date to update, not a difference.
      if (fs.kind === "leave") {
        var later = (api.recs ? api.recs().statuses || [] : []).filter(function (x) { return x.pos === p.pos && !x.tradeId && x.start > f.date; })
          .sort(function (a, b) { return a.start.localeCompare(b.start); })[0];
        if (later) {
          var fx = rec.dateFix[later.id] = rec.dateFix[later.id] || { rec: later, from: f.date, code: fs.code };
          if (f.date < fx.from) fx.from = f.date;
          rec.days++;
          return;
        }
      }
      if (fs.kind === "work" && toolKind === "work") {
        if (firCo && firCo !== t.co) note = "Different company";
        else if (f.position && f.position !== t.seat) note = "Different position";
      } else if (fs.kind === "work") note = toolKind === "off" ? "fir-db1 has them working; the tool has them off that day (tour?)" : "fir-db1 has them working; the tool has them " + (t.status || (t.away ? "away" : "covered"));
      else if (toolKind === "work") note = fs.kind === "off" ? "The tool has them working; fir-db1 has them off that day (tour?)" : "fir-db1 has them on " + fs.code + "; the tool has them working";
      else if (fs.kind === "leave" && toolKind === "off") note = "fir-db1 has them on " + fs.code + " on a day the tool has them off";
      rec.days++;
      if (note) rec.issues.push({ date: f.date, fir: f, tool: t, note: note + (how === "name" ? " · matched by name" : "") });
    });
    // Company pulls: people the tool has working at that company who aren't on fir-db1's list.
    var toolOnly = [];
    Object.keys(pulledCo).forEach(function (k) {
      var iso = k.split("|")[0], co = k.split("|")[1], day = toolDay(iso);
      var listed = {};
      data.forEach(function (f) { if (f.date === iso && f.mode === "co") { var p = (f.emplId && peopleById[f.emplId]) || null; if (p) listed[p.pos] = 1; } });
      Object.keys(day).forEach(function (pos) {
        var e = day[pos];
        if (!e.off && e.co === co && !listed[pos]) toolOnly.push({ date: iso, co: co, p: api.byPos ? api.byPos()[pos] : null, key: pos, tool: e });
      });
    });
    Object.keys(byPerson).forEach(function (k) {
      var r = byPerson[k];
      Object.keys(r.dateFix).forEach(function (id) {
        var fx = r.dateFix[id];
        r.notes.unshift("Start date to update: " + fx.rec.code + " starts " + shortIso(fx.rec.start) + " in the tool; fir-db1 shows " + fx.code + " from " + shortIso(fx.from) + " or earlier");
      });
    });
    var dates = {};
    data.forEach(function (f) { dates[f.date] = 1; });
    var people = Object.keys(byPerson).map(function (k) { return byPerson[k]; }).sort(function (a, b) { return b.issues.length - a.issues.length || a.name.localeCompare(b.name); });
    return { dates: Object.keys(dates).sort(), flags: flags, people: people, toolOnly: toolOnly,
      unknown: Object.keys(unknown).map(function (k) { return unknown[k]; }) };
  }

  root.FirCompare = { LEVELS: LEVELS, targets: targets, parseList: parseList, targetsFromList: targetsFromList, script: script, parseCsv: parseCsv, compare: compare, firState: firState, COLS: COLS };
})(typeof window !== "undefined" ? window : globalThis);
