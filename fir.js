/* Compare with fir-db1 (admins, Employee cards screen).
 * fir-db1 is the department's time system (Oracle APEX, city VPN only). Its "Search Co Time" page lists everyone booked at a
 * company on a date. Nothing here talks to fir-db1: the admin copies a pull script, runs it in the browser console on a fir-db1
 * tab they are signed in to, and gets one CSV for a date. Dropping that CSV here compares it with the tool's own Projection
 * for the same date (app.js dayRows). The CSV stays in this browser; nothing is saved.
 * window.FirCompare = {script(companies), parseCsv(text), compare(rows, api)}.
 */
(function (root) {
  "use strict";

  var COLS = ["date", "company", "emplId", "name", "co", "trc", "position", "role", "surf", "start", "startTime", "end", "endTime", "hours", "status", "flag"];

  /* The console script. It reads the APEX session from the tab's address, opens the company page (page 2, P2_WHICH=Co) for
     each company one at a time, reads the Time Entry table by its column headings, and downloads fir-<date>.csv.
     Flags: "empty" (company pulled, nobody listed), "maybe-cut-off" (as many rows as the Rows setting, or a next-page link). */
  function script(companies) {
    return "/* Tour schedule: pull who's booked per company from fir-db1. Paste in the console on a signed-in fir-db1 tab. */\n" +
      "(async () => {\n" +
      "  const COMPANIES = " + JSON.stringify(companies) + ";\n" +
      "  const COLS = " + JSON.stringify(COLS) + ";\n" +
      "  const m = /[?&]p=(\\d+):\\d+:(\\d+)/.exec(location.href);\n" +
      "  if (!m) return alert('Open a fir-db1 page first (signed in), then run this again.');\n" +
      "  const app = m[1], session = m[2];\n" +
      "  const t = new Date(), dflt = (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear();\n" +
      "  const date = (prompt('Date to pull (MM/DD/YYYY)', dflt) || '').trim();\n" +
      "  if (!/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(date)) return alert('Use a date like 10/20/2026.');\n" +
      "  const pick = (prompt('Companies to pull (blank = all ' + COMPANIES.length + '), e.g. E10 T10', '') || '').trim();\n" +
      "  const list = pick ? pick.toUpperCase().split(/[\\s,]+/) : COMPANIES;\n" +
      "  const out = [], val = (td) => {\n" +
      "    if (!td) return '';\n" +
      "    const box = td.querySelector('input[type=checkbox]');\n" +
      "    if (box) return box.hasAttribute('checked') ? 'Y' : '';\n" +
      "    const f = td.querySelector('input:not([type=hidden]), select, textarea');\n" +
      "    if (f && f.tagName === 'SELECT') { const o = f.querySelector('option[selected]') || f.querySelector('option'); return o ? o.textContent.trim() : ''; }\n" +
      "    if (f) return (f.getAttribute('value') || f.textContent || '').trim();\n" +
      "    return td.textContent.replace(/\\s+/g, ' ').trim();\n" +
      "  };\n" +
      "  for (let i = 0; i < list.length; i++) {\n" +
      "    const co = list[i];\n" +
      "    console.log('fir pull ' + (i + 1) + '/' + list.length + ': ' + co);\n" +
      "    const url = location.origin + location.pathname + '?p=' + app + ':2:' + session + ':::RP:P2_COMPANY,P2_SCHD_DT,P2_WHICH:' + co + ',' + encodeURIComponent(date) + ',Co';\n" +
      "    const html = await (await fetch(url, { credentials: 'same-origin' })).text();\n" +
      "    const doc = new DOMParser().parseFromString(html, 'text/html');\n" +
      "    const table = [...doc.querySelectorAll('table')].find((tb) => { const h = tb.textContent; return /Empl/.test(h) && /Position/.test(h) && tb.querySelector('th'); });\n" +
      "    if (!table) {\n" +
      "      if (/password|sign in|log in/i.test(html)) { alert('fir-db1 signed you out at ' + co + '. Sign in again and rerun; ' + out.length + ' rows so far were not saved.'); return; }\n" +
      "      out.push({ date, company: co, flag: 'no-table' }); continue;\n" +
      "    }\n" +
      "    const heads = [...table.querySelectorAll('tr')].find((r) => r.querySelector('th'));\n" +
      "    const names = [...heads.children].map((th) => th.textContent.replace(/\\s+/g, ' ').trim());\n" +
      "    const idx = (label, nth) => { let k = -1, seen = 0; names.forEach((n, j) => { if (k < 0 && n === label && seen++ === (nth || 0)) k = j; }); return k; };\n" +
      "    const at = { emplId: idx('Empl'), name: idx('Name'), co: idx('Co'), trc: idx('TRC'), position: idx('Position'), role: idx('Role'), surf: idx('Surf?'),\n" +
      "      start: idx('Start Dt'), startTime: idx('Time'), end: idx('End Dt'), endTime: idx('Time', 1), status: idx('Status') };\n" +
      "    at.hours = at.endTime >= 0 ? at.endTime + 1 : -1;\n" +
      "    const rows = [...table.querySelectorAll('tr')].filter((r) => r !== heads && r.querySelectorAll('td').length > 3);\n" +
      "    rows.forEach((r) => {\n" +
      "      const tds = r.children, rec = { date, company: co };\n" +
      "      Object.keys(at).forEach((k) => { rec[k] = at[k] >= 0 ? val(tds[at[k]]) : ''; });\n" +
      "      if (rec.emplId || rec.name) out.push(rec);\n" +
      "    });\n" +
      "    const sel = doc.querySelector('select[id*=ROWS]'), per = sel ? +(sel.querySelector('option[selected]') || {}).value || 0 : 0;\n" +
      "    const more = doc.querySelector('.t-Report-paginationLink--next, a[class*=pagination][class*=next]');\n" +
      "    if (!rows.length) out.push({ date, company: co, flag: 'empty' });\n" +
      "    else if (more || (per && rows.length >= per)) out[out.length - 1].flag = 'maybe-cut-off';\n" +
      "    await new Promise((r) => setTimeout(r, 400));\n" +
      "  }\n" +
      "  const q = (v) => { v = v == null ? '' : String(v); return /[\",\\n]/.test(v) ? '\"' + v.replace(/\"/g, '\"\"') + '\"' : v; };\n" +
      "  const csv = [COLS.join(',')].concat(out.map((r) => COLS.map((c) => q(r[c])).join(','))).join('\\n');\n" +
      "  const a = document.createElement('a');\n" +
      "  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));\n" +
      "  a.download = 'fir-' + date.replace(/\\//g, '-') + '.csv';\n" +
      "  document.body.appendChild(a); a.click(); a.remove();\n" +
      "  console.log('fir pull done: ' + out.filter((r) => r.emplId || r.name).length + ' people from ' + list.length + ' companies.');\n" +
      "})();\n";
  }

  // CSV text -> [{date (ISO), company, emplId, name, ...}]. Handles quoted fields.
  function parseCsv(text) {
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
    var head = rows.shift() || [];
    if (head.indexOf("emplId") === -1 || head.indexOf("company") === -1) throw new Error("This isn't a fir-db1 pull (no emplId / company columns).");
    return rows.filter(function (r) { return r.length > 1; }).map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h] = (r[k] || "").trim(); });
      var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(o.date || "");
      o.date = m ? m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2) : o.date;
      o.emplId = (o.emplId || "").toUpperCase();
      return o;
    });
  }

  function nameKey(n) { return String(n || "").toLowerCase().replace(/[^a-z,]/g, ""); }

  /* Compare fir rows (one date) with the tool's day. api: {dayRows(d), people(), fromIso, apparatus(co)}.
     Returns {date, pulled: [companies], flags: [rows with a flag], ok, seat, onoff, firOnly, toolOnly} where each list item is
     {fir, tool, p, note}. fir "off" = a Status code on the row (e.g. DP); tool "off" = leave, away or covered. */
  function compare(rows, api) {
    var dates = {};
    rows.forEach(function (r) { if (r.date) dates[r.date] = 1; });
    var dlist = Object.keys(dates);
    if (dlist.length !== 1) throw new Error(dlist.length ? "The file has more than one date (" + dlist.join(", ") + "). Pull one date at a time." : "The file has no date.");
    var date = dlist[0], d = api.fromIso(date), app = api.apparatus;
    var pulled = {}, flags = [];
    rows.forEach(function (r) { pulled[app(r.company)] = 1; if (r.flag) flags.push(r); });
    var fir = rows.filter(function (r) { return r.emplId || r.name; });

    // The tool's day: one entry per person, preferring the row where they work.
    var tool = {}, toolByName = {};
    api.dayRows(d).forEach(function (r) {
      if (!r.name) return;
      var p = r.who, key = p ? p.pos : "name:" + r.name;
      var e = { p: p, name: r.name, emplId: p && p.emplId ? p.emplId.toUpperCase() : "", co: app(r.co), seat: r.slot.pos,
        status: r.status || null, off: !!r.off, away: r.away, kind: r.kind || null };
      var old = tool[key];
      if (!old || (old.off && !e.off)) tool[key] = e;
    });
    var byId = {};
    Object.keys(tool).forEach(function (k) {
      var e = tool[k];
      if (e.emplId) byId[e.emplId] = e;
      (toolByName[nameKey(e.name)] = toolByName[nameKey(e.name)] || []).push(e);
    });
    var peopleById = {}, peopleByName = {};
    api.people().forEach(function (p) {
      if (p.emplId) peopleById[p.emplId.toUpperCase()] = p;
      (peopleByName[nameKey(p.name)] = peopleByName[nameKey(p.name)] || []).push(p);
    });

    var out = { date: date, pulled: Object.keys(pulled), flags: flags, ok: [], seat: [], onoff: [], firOnly: [], toolOnly: [], count: fir.length };
    var used = {};
    fir.forEach(function (f) {
      var e = (f.emplId && byId[f.emplId]) || null, how = "id";
      if (!e) { var nm = toolByName[nameKey(f.name)] || []; if (nm.length === 1 && !nm[0].emplId) { e = nm[0]; how = "name"; } }
      var firOff = !!f.status;
      if (!e) {
        var p = (f.emplId && peopleById[f.emplId]) || ((peopleByName[nameKey(f.name)] || []).length === 1 ? peopleByName[nameKey(f.name)][0] : null);
        out.firOnly.push({ fir: f, p: p, note: p ? "In the tool but not scheduled this day" : "Not in the tool" + (f.emplId ? " (ID " + f.emplId + ")" : "") });
        return;
      }
      used[e.p ? e.p.pos : "name:" + e.name] = 1;
      var item = { fir: f, tool: e, p: e.p, note: how === "name" ? "Matched by name (no ID in the tool)" : "" };
      var co = app(f.co || f.company);
      if (firOff !== e.off) { item.note = (firOff ? "fir-db1 has them off (" + f.status + "), the tool has them working" : "fir-db1 has them working, the tool has them off") + (item.note ? " · " + item.note : ""); out.onoff.push(item); }
      else if (!firOff && (co !== e.co || (f.position && f.position !== e.seat))) { item.note = (co !== e.co ? "Different company" : "Different position") + (item.note ? " · " + item.note : ""); out.seat.push(item); }
      else out.ok.push(item);
    });
    // Working in the tool at a pulled company but not on fir-db1's list for that company.
    Object.keys(tool).forEach(function (k) {
      var e = tool[k];
      if (used[k] || e.off || !pulled[e.co]) return;
      out.toolOnly.push({ tool: e, p: e.p, note: "Not on fir-db1's list for " + e.co });
    });
    return out;
  }

  root.FirCompare = { script: script, parseCsv: parseCsv, compare: compare, COLS: COLS };
})(typeof window !== "undefined" ? window : globalThis);
