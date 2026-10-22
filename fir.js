/* Compare with fir-db1 (admins, Employee cards screen).
 * fir-db1 is the department's time system (Oracle APEX, city VPN only). Page 2 shows time entries either for one employee
 * (P2_WHICH=Empl: a run of days from a date) or for a company on a date (P2_WHICH=Co: everyone assigned there, with TRC "H" for
 * those off that day). Nothing here talks to fir-db1. The admin picks a rank level; the tool lists the people it has questions
 * about (targets()) and builds a console script for exactly those people (script()). Run in a signed-in fir-db1 tab, it pulls
 * each one's employee page, plus company pages for people without an Employee ID, and downloads one CSV. Choosing that CSV
 * compares every pulled day with the tool's own Projection for that day (app.js dayRows). The CSV stays in this browser.
 * window.FirCompare = {LEVELS, targets(api, level, all), parseList(text), targetsFromList(list, api, group), script(plan), phoneScript(plan), licenseScript(plan), battalionScript(plan), balanceScript(plan),
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

  /* The console script for a plan: {date: "MM/DD/YYYY" or "", to: "MM/DD/YYYY" (optional range end), people: [{id, name, co}],
     companies: [codes], label, concurrency (pages at once, default 1), resumeKey (keep progress across a sign-out), fileName}.
     Employee pages for people with IDs (14 days from the date); company pages (100 rows) for the companies listed. */
  function script(plan) {
    return "/* Tour schedule: fir-db1 pull (" + String(plan.label || "").replace(/\*\//g, "") + "). Paste in the console on a signed-in fir-db1 tab. */\n" +
      "(async () => {\n" +
      "  const PLAN = " + JSON.stringify({ date: plan.date || "", to: plan.to || "", people: plan.people || [], companies: plan.companies || [],
        concurrency: plan.concurrency || 1, resumeKey: plan.resumeKey || "", fileName: plan.fileName || "" }) + ";\n" +
      "  const COLS = " + JSON.stringify(COLS) + ";\n" +
      "  const m = /[?&]p=(\\d+):\\d+:(\\d+)/.exec(location.href);\n" +
      "  if (!m) return alert('Open a fir-db1 page first (signed in), then run this again.');\n" +
      "  const app = '1022', session = m[2]; // Time Entry is app 1022, page 2; the session is shared with the 1021 menu\n" +
      "  let date = PLAN.date;\n" +
      "  if (!date) { const t = new Date(); date = (prompt('Date to pull (MM/DD/YYYY)', (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear()) || '').trim(); }\n" +
      "  if (!/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(date)) return alert('Use a date like 10/20/2026.');\n" +
      "  const base = location.origin + location.pathname + '?p=' + app + ':2:' + session + ':::RP,2:';\n" +
      "  // A range (PLAN.to): an employee page shows about 14 days, from 9 days before its date to 4 after, so ask at\n" +
      "  // several dates and keep each day once. Without PLAN.to: one page at the date.\n" +
      "  const md = (d) => (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();\n" +
      "  const dt = (s) => { const x = s.split('/'); return new Date(+(x[2].length === 2 ? '20' + x[2] : x[2]), x[0] - 1, +x[1]); };\n" +
      "  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);\n" +
      "  const anchors = [];\n" +
      "  if (PLAN.to) { const end = dt(PLAN.to); for (let a = add(dt(date), 9); ; a = add(a, 14)) { anchors.push(md(a)); if (add(a, 4) >= end) break; } } else anchors.push(date);\n" +
      "  const inRange = (s) => !PLAN.to || (s && dt(s) >= dt(date) && dt(s) <= dt(PLAN.to));\n" +
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
      "  // Resume (PLAN.resumeKey): finished people and their rows are kept in this browser, so after a sign-out the\n" +
      "  // same script picks up where it stopped. Cleared once the file is downloaded.\n" +
      "  const RK = PLAN.resumeKey ? 'tour-schedule:' + PLAN.resumeKey : null;\n" +
      "  let saved = { done: [], rows: [] };\n" +
      "  try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || 'null') || saved; } catch (e) { }\n" +
      "  const done = new Set(saved.done);\n" +
      "  saved.rows.forEach((v) => { const r = {}; COLS.forEach((c, i) => { r[c] = v[i]; }); out.push(r); });\n" +
      "  const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out.map((r) => COLS.map((c) => r[c] == null ? '' : r[c])) })); } catch (e) { console.warn('Could not save progress: ' + e.message); } };\n" +
      "  if (done.size) console.log('fir pull: resuming, ' + done.size + ' already done.');\n" +
      "  let n = done.size, stop = null;\n" +
      "  const pullPerson = async (p) => {\n" +
      "    let rows = null; const seen = {};\n" +
      "    for (const a of anchors) {\n" +
      "      const got = read(await get(base + 'P2_WHICH,P2_EMPLID,P2_COMPANY,P2_SCHD_DT:Empl,' + enc(p.id) + ',' + enc(p.co) + ',' + enc(a)));\n" +
      "      if (!got) continue;\n" +
      "      rows = rows || [];\n" +
      "      got.forEach((r) => { const k = r.date || JSON.stringify(r); if (!seen[k] && inRange(r.date)) { seen[k] = 1; rows.push(r); } });\n" +
      "      if (anchors.length > 1) await wait();\n" +
      "    }\n" +
      "    if (!rows) return [{ mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name, flag: 'no-table' }];\n" +
      "    if (!rows.length) return [{ mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name, flag: 'empty' }];\n" +
      "    return rows.map((r) => Object.assign(r, { mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name }));\n" +
      "  };\n" +
      "  try {\n" +
      "    // PLAN.concurrency workers (default 1) take people from one queue.\n" +
      "    const queue = PLAN.people.filter((p) => !done.has(p.id));\n" +
      "    const worker = async () => {\n" +
      "      while (queue.length && !stop) {\n" +
      "        const p = queue.shift();\n" +
      "        try { const rows = await pullPerson(p); rows.forEach((r) => out.push(r)); done.add(p.id); }\n" +
      "        catch (e) { stop = e; queue.unshift(p); break; }\n" +
      "        if (++n % 25 === 0) save();\n" +
      "        console.log('fir pull ' + n + '/' + total + ': ' + p.name + ' ' + p.id);\n" +
      "        await wait();\n" +
      "      }\n" +
      "    };\n" +
      "    await Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker));\n" +
      "    if (stop) throw stop;\n" +
      "    for (const co of PLAN.companies) {\n" +
      "      if (done.has('co:' + co)) continue;\n" +
      "      console.log('fir pull ' + (++n) + '/' + total + ': company ' + co);\n" +
      "      done.add('co:' + co);\n" +
      "      let rows = read(await get(base + 'P2_COMPANY,P2_SCHD_DT,P2_WHICH,P2_NUM_ROWS:' + enc(co) + ',' + enc(date) + ',Co,100'));\n" +
      "      if (!rows) rows = read(await get(base + 'P2_COMPANY,P2_SCHD_DT,P2_WHICH:' + enc(co) + ',' + enc(date) + ',Co'));\n" +
      "      if (!rows) out.push({ mode: 'co', pulledFor: date, query: co, flag: 'no-table' });\n" +
      "      else if (!rows.length) out.push({ mode: 'co', pulledFor: date, query: co, flag: 'empty' });\n" +
      "      else rows.forEach((r) => out.push(Object.assign(r, { mode: 'co', pulledFor: date, query: co, date: date })));\n" +
      "      await wait();\n" +
      "    }\n" +
      "  } catch (e) {\n" +
      "    if (RK) { save(); return alert(e.message === 'signed-out' ? 'fir-db1 signed you out after ' + done.size + ' of ' + total + '. Sign in again, then paste and run this script again: it carries on where it stopped.' : 'The pull stopped (' + e.message + ') after ' + done.size + ' of ' + total + '. Paste and run it again to carry on.'); }\n" +
      "    if (e.message === 'signed-out') alert('fir-db1 signed you out. Sign in again and rerun; the rows so far are in the file.'); else console.error(e);\n" +
      "  }\n" +
      "  if (RK) try { localStorage.removeItem(RK); } catch (e) { }\n" +
      "  const q = (v) => { v = v == null ? '' : String(v); return /[\",\\n]/.test(v) ? '\"' + v.replace(/\"/g, '\"\"') + '\"' : v; };\n" +
      "  const csv = [COLS.join(',')].concat(out.map((r) => COLS.map((c) => q(r[c])).join(','))).join('\\n');\n" +
      "  const a = document.createElement('a');\n" +
      "  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));\n" +
      "  a.download = PLAN.fileName || 'fir-' + date.replace(/\\//g, '-') + (PLAN.to ? '_to_' + PLAN.to.replace(/\\//g, '-') : '') + '.csv';\n" +
      "  document.body.appendChild(a); a.click(); a.remove();\n" +
      "  console.log('fir pull done: ' + out.length + ' rows.');\n" +
      "})();\n";
  }

  /* Phone numbers (admins; cleanup/fir-pull-phones-*.js): fir-db1's employee page (app 1021, page 2) carries the Phone
     numbers pop-up (region PHONE_NUMBERS) in its HTML, so a fetch of that page per Employee ID reads it. plan: {people:
     [{id, name, key}], label, concurrency, resumeKey, fileName}. Downloads key, emplId, name, type, number, flag rows; flag is
     "none" (no numbers), "mismatch" (the page showed someone else), "unchecked" (no Employee ID on the page) or
     "no-region". The file stays on the admin's computer. phoneMain runs in the fir-db1 tab (built with toString). */
  function phoneMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:2:" + m[2] + ":::RP,2:P2_EMPLID:";
    const COLS = ["key", "emplId", "name", "type", "number", "flag"];
    const PHONE = /\b([A-Z][A-Z]{2,11})\s*(\(?\d{3}\)?[\/\s.\-]*\d{3}[\s.\-]*\d{4})/g;
    const read = (html, id) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const field = doc.getElementById("P2_EMPLID");
      const shown = field ? (field.getAttribute("value") || field.textContent || "").trim().toUpperCase() : "";
      if (shown && shown !== id) return { flag: "mismatch", phones: [] };
      const reg = doc.getElementById("PHONE_NUMBERS");
      if (!reg) return { flag: "no-region", phones: [] };
      // Form fields show their value; every element boundary becomes a space so "CELL" and the number stay apart.
      reg.querySelectorAll("input, select, textarea").forEach((f) => {
        const v = f.tagName === "SELECT" ? ((f.querySelector("option[selected]") || {}).textContent || "") : (f.type === "hidden" ? "" : f.getAttribute("value") || "");
        f.replaceWith(doc.createTextNode(" " + v + " "));
      });
      const parts = [], walk = doc.createTreeWalker(reg, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) parts.push(walk.currentNode.nodeValue);
      const text = parts.join(" ").replace(/\s+/g, " "), phones = [], seen = {};
      let x;
      PHONE.lastIndex = 0;
      while ((x = PHONE.exec(text))) { const k = x[1] + x[2]; if (!seen[k] && !/^PHONE|TYPE$/.test(x[1])) { seen[k] = 1; phones.push({ type: x[1], number: x[2] }); } }
      return { flag: phones.length ? (shown ? "" : "unchecked") : "none", phones };
    };
    const get = async (url) => { const h = await (await fetch(url, { credentials: "same-origin" })).text();
      if (/type="password"/i.test(h) && !/PHONE_NUMBERS/.test(h)) throw new Error("signed-out"); return h; };
    const RK = PLAN.resumeKey ? "tour-schedule:" + PLAN.resumeKey : null;
    let saved = { done: [], rows: [] };
    try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const done = new Set(saved.done), out = saved.rows.slice();
    const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out })); } catch (e) { console.warn("Could not save progress: " + e.message); } };
    if (done.size) console.log("phone pull: resuming, " + done.size + " already done.");
    const queue = PLAN.people.filter((p) => !done.has(p.id)), total = PLAN.people.length, wait = () => new Promise((r) => setTimeout(r, 400));
    let n = done.size, stop = null;
    const worker = async () => {
      while (queue.length && !stop) {
        const p = queue.shift();
        try {
          const r = read(await get(base + encodeURIComponent(p.id)), p.id);
          if (!r.phones.length) out.push([p.key, p.id, p.name, "", "", r.flag]);
          r.phones.forEach((ph) => out.push([p.key, p.id, p.name, ph.type, ph.number, r.flag]));
          done.add(p.id);
        } catch (e) { stop = e; queue.unshift(p); break; }
        if (++n % 25 === 0) save();
        console.log("phone pull " + n + "/" + total + ": " + p.name + " " + p.id);
        await wait();
      }
    };
    return Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker)).then(() => {
      if (stop) {
        save();
        return alert(stop.message === "signed-out" ? "fir-db1 signed you out after " + done.size + " of " + total + ". Sign in again, then paste and run this script again: it carries on where it stopped."
          : "The pull stopped (" + stop.message + ") after " + done.size + " of " + total + ". Paste and run it again to carry on.");
      }
      if (RK) try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || "fir-phones.csv";
      document.body.appendChild(a); a.click(); a.remove();
      console.log("phone pull done: " + total + " people, " + out.filter((r) => r[4]).length + " numbers.");
    });
  }
  function phoneScript(plan) {
    return "/* Tour schedule: fir-db1 phone pull (" + String(plan.label || "").replace(/\*\//g, "") + "). Paste in the console on a signed-in fir-db1 tab. */\n" +
      "(" + phoneMain.toString() + ")(" + JSON.stringify({ people: plan.people || [], concurrency: plan.concurrency || 1,
        resumeKey: plan.resumeKey || "", fileName: plan.fileName || "" }) + ");\n";
  }

  /* Licenses and certifications (admins; cleanup/fir-pull-licenses-*.js): the Licenses and Certs pop-up (region
     LICENSES_AND_CERTS) is in the HTML of fir-db1's employee page (app 1021, page 2), like phone numbers. plan: {people:
     [{id, name, key}], label, concurrency, resumeKey, fileName}. Downloads key, emplId, name, description, expires, flag;
     license numbers are never read into the file. Flags as phoneMain ("none", "mismatch", "unchecked", "no-region"). */
  function licenseMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:2:" + m[2] + ":::RP,2:P2_EMPLID:";
    const COLS = ["key", "emplId", "name", "description", "expires", "flag"], DATE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Z]{3}-\d{2,4})\b/i;
    const val = (c) => {
      const k = c.cloneNode(true);
      k.querySelectorAll("input, select, textarea").forEach((f) => {
        const v = f.tagName === "SELECT" ? ((f.querySelector("option[selected]") || {}).textContent || "") : (f.type === "hidden" ? "" : f.getAttribute("value") || "");
        f.replaceWith(c.ownerDocument.createTextNode(" " + v + " "));
      });
      return k.textContent.replace(/\s+/g, " ").trim();
    };
    const read = (html, id) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const field = doc.getElementById("P2_EMPLID");
      const shown = field ? (field.getAttribute("value") || field.textContent || "").trim().toUpperCase() : "";
      if (shown && shown !== id) return { flag: "mismatch", items: [] };
      const reg = doc.getElementById("LICENSES_AND_CERTS");
      if (!reg) return { flag: "no-region", items: [] };
      // Rows of the innermost tables: description, license number (skipped), expiration (the cell that is a date).
      const items = [], seen = {};
      [...reg.querySelectorAll("tr")].filter((tr) => !tr.querySelector("table")).forEach((tr) => {
        const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map(val);
        if (!cells.length || /^Description$/i.test(cells[0]) || !cells[0]) return;
        const d = cells.slice(1).map((c) => DATE.exec(c)).filter(Boolean)[0];
        const k = cells[0] + "|" + (d ? d[1] : "");
        if (seen[k]) return;
        seen[k] = 1;
        items.push({ description: cells[0], expires: d ? d[1] : "" });
      });
      return { flag: items.length ? (shown ? "" : "unchecked") : "none", items };
    };
    const get = async (url) => { const h = await (await fetch(url, { credentials: "same-origin" })).text();
      if (/type="password"/i.test(h) && !/LICENSES_AND_CERTS/.test(h)) throw new Error("signed-out"); return h; };
    const RK = PLAN.resumeKey ? "tour-schedule:" + PLAN.resumeKey : null;
    let saved = { done: [], rows: [] };
    try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const done = new Set(saved.done), out = saved.rows.slice();
    const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out })); } catch (e) { } };
    const queue = PLAN.people.filter((p) => !done.has(p.id)), total = PLAN.people.length, wait = () => new Promise((r) => setTimeout(r, 400));
    let n = done.size, stop = null;
    const worker = async () => {
      while (queue.length && !stop) {
        const p = queue.shift();
        try {
          const r = read(await get(base + encodeURIComponent(p.id)), p.id);
          if (!r.items.length) out.push([p.key, p.id, p.name, "", "", r.flag]);
          r.items.forEach((it) => out.push([p.key, p.id, p.name, it.description, it.expires, r.flag]));
          done.add(p.id);
        } catch (e) { stop = e; queue.unshift(p); break; }
        if (++n % 25 === 0) save();
        console.log("license pull " + n + "/" + total + ": " + p.name + " " + p.id);
        await wait();
      }
    };
    return Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker)).then(() => {
      if (stop) { save(); return alert(stop.message === "signed-out" ? "fir-db1 signed you out after " + done.size + " of " + total + ". Sign in again, then paste and run this script again: it carries on where it stopped." : "The pull stopped (" + stop.message + ") after " + done.size + " of " + total + ". Paste and run it again to carry on."); }
      if (RK) try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || "fir-licenses.csv";
      document.body.appendChild(a); a.click(); a.remove();
      console.log("license pull done: " + total + " people, " + out.filter((r) => r[3]).length + " licenses.");
    });
  }
  function licenseScript(plan) {
    return "/* Tour schedule: fir-db1 licenses and certifications pull (" + String(plan.label || "").replace(/\*\//g, "") + "). Paste in the console on a signed-in fir-db1 tab. */\n" +
      "(" + licenseMain.toString() + ")(" + JSON.stringify({ people: plan.people || [], concurrency: plan.concurrency || 1,
        resumeKey: plan.resumeKey || "", fileName: plan.fileName || "" }) + ");\n";
  }

  /* Battalion rosters (admins; cleanup/fir-pull-battalions.js): fir-db1's Roster by Station (app 1021, page 11) lists one
     day's crews for a battalion: station, company, role, name, Employee ID, TRC and trade partner. plan: {from, to
     (MM/DD/YYYY), battalions: ["BT01", ...], fileName}. Rows use the COLS of script() with mode "co" and the company as
     query, so the Employee card's fir-db1 comparison reads the file like company pages; station, battalion, with (trade
     partner) and mark (the margin note, e.g. DP) are extra columns. A page with no rows downloads a structure note. */
  function battalionMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:11:" + m[2] + "::NO::P11_FROMDT,P11_BATTALION:";
    const ask = (q, d) => (prompt(q, d) || "").trim();
    const t = new Date(), md = (d) => (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    const from = PLAN.from || ask("First date (MM/DD/YYYY)", md(t)), to = PLAN.to || ask("Last date (MM/DD/YYYY)", from);
    const dt = (x) => { const a = x.split("/"); return new Date(+a[2], a[0] - 1, +a[1]); };
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(from) || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(to)) return alert("Use dates like 10/22/2026.");
    const dates = [];
    for (let d = dt(from); d <= dt(to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.push(md(d));
    const COLS = ["mode", "pulledFor", "date", "query", "emplId", "name", "co", "trc", "position", "role", "hours", "status", "flag", "station", "battalion", "with", "mark"];
    const ID = /^[A-Z]{2}\d{4}$/, ROLE = /^[A-Z][A-Z\/]{1,5}$/;
    const UNIT = { Engine: "E", Truck: "T", Battalion: "B", "Rescue Squad": "RS", "Rescue Captain": "RC", Fireboat: "FB", "Fire Boat": "FB", Medic: "M", "Hose Tender": "HT", "Mobile Air": "MA" };
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };
    const coCode = (label) => {
      if (/^Bureau of Equipment/.test(label)) return "BE";
      const u = /^(Engine|Truck|Battalion|Rescue Squad|Rescue Captain|Fireboat|Fire Boat|Medic|Hose Tender|Mobile Air)\s+(\d+)/.exec(label);
      if (u) return UNIT[u[1]] + (/^(E|T|B)$/.test(UNIT[u[1]]) ? ("0" + u[2]).slice(-2) : u[2]);
      const dv = /^Division\s+([IV]+)/.exec(label);
      return dv ? "D" + ROMAN[dv[1]] : label.replace(/\s+-\s+\d+\/\d+.*$/, "");
    };
    const cellText = (c) => { const k = c.cloneNode(true); k.querySelectorAll("script, noscript").forEach((x) => x.remove()); return k.textContent.replace(/\s+/g, " ").trim(); };
    const read = (html, date, bt) => {
      const doc = new DOMParser().parseFromString(html, "text/html"), rows = [], done = new Set();
      let station = "", co = "";
      const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const node = walk.currentNode, txt = node.nodeValue.replace(/\s+/g, " ").trim();
        if (!txt) continue;
        const tr = node.parentElement && node.parentElement.closest("tr");
        const st = /^Fire Station\s+(\w+)/.exec(txt), unit = /^(.+?)\s+-\s+\d+\/\d+\b/.exec(txt);
        if (st && !(tr && done.has(tr))) { station = st[1]; continue; }
        if (unit && !(tr && done.has(tr))) { co = coCode(unit[1]); continue; }
        if (!tr || done.has(tr)) continue;
        const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map(cellText);
        let i = cells.findIndex((c) => ID.test(c) || /\s[A-Z]{2}\d{4}$/.test(c));
        if (i < 0) continue;
        done.add(tr);
        let name = "", id = cells[i];
        const glued = /^(.*\S)\s+([A-Z]{2}\d{4})$/.exec(id);
        if (glued) { name = glued[1]; id = glued[2]; } else name = cells[i - 1] || "";
        const before = cells.slice(0, glued ? i : i - 1).filter(Boolean);
        const role = before.length && ROLE.test(before[before.length - 1]) ? before.pop() : "";
        const after = cells.slice(i + 1).filter(Boolean), trc = after.length && /^[A-Z]{1,4}$/.test(after[0]) ? after[0] : "";
        const tw = after.map((c) => /\b(TR[OW])\s*([A-Z]{2}\d{4})\b/.exec(c)).filter(Boolean)[0];
        rows.push({ mode: "co", pulledFor: date, date, query: co, emplId: id, name: name.replace(/\s*-ND$/, ""), co, trc, position: "", role,
          hours: "", status: "", flag: "", station, battalion: bt, with: tw ? tw[1] + " " + tw[2] : "", mark: before.join(" ") });
      }
      if (!rows.length) {
        const shape = [...doc.querySelectorAll("table")].slice(0, 5).map((tb) => tb.querySelectorAll("tr").length + " rows: " + cellText(tb).slice(0, 120)).join(" | ");
        rows.push({ mode: "co", pulledFor: date, date, query: bt, flag: /type="password"/i.test(html) ? "signed-out" : "no-rows", name: shape.slice(0, 600), battalion: bt });
      }
      return rows;
    };
    const out = [], jobs = [];
    dates.forEach((d) => PLAN.battalions.forEach((b) => jobs.push([d, b])));
    const wait = () => new Promise((r) => setTimeout(r, 400));
    return (async () => {
      for (let k = 0; k < jobs.length; k++) {
        const [d, b] = jobs[k];
        const html = await (await fetch(base + encodeURIComponent(d) + "," + b, { credentials: "same-origin" })).text();
        const rows = read(html, d, b);
        if (rows[0].flag === "signed-out") { alert("fir-db1 signed you out after " + k + " of " + jobs.length + " pages. Sign in and run again (the file has what came in so far)."); out.push(...rows); break; }
        rows.forEach((r) => out.push(r));
        console.log("battalion pull " + (k + 1) + "/" + jobs.length + ": " + d + " " + b + " (" + rows.filter((r) => !r.flag).length + " people)");
        await wait();
      }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => COLS.map((c) => q(r[c])).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || ("fir-battalions-" + from.replace(/\//g, "-") + (to !== from ? "_to_" + to.replace(/\//g, "-") : "") + ".csv");
      document.body.appendChild(a); a.click(); a.remove();
      console.log("battalion pull done: " + out.filter((r) => !r.flag).length + " rows.");
    })();
  }
  function battalionScript(plan) {
    return "/* Tour schedule: fir-db1 battalion roster pull (" + String(plan.label || "").replace(/\*\//g, "") + "). Paste in the console on a signed-in fir-db1 tab. */\n" +
      "(" + battalionMain.toString() + ")(" + JSON.stringify({ from: plan.from || "", to: plan.to || "", fileName: plan.fileName || "",
        battalions: plan.battalions || ["BT01", "BT02", "BT03", "BT04", "BT05", "BT06", "BT07", "BT08", "BT09", "BT10"] }) + ");\n";
  }

  /* Daily balance report (admins; cleanup/fir-pull-balance.js): run on the balance report page in fir-db1 (opened for any
     date). It finds the page and its date item from the address or the page, asks for a From-To range, and reads the
     two tables at the bottom of each day: status counts (DP, IDV, SP, SPI, TC, VA, WC, WDO… by OFF, PM, FF) and hires
     (by rank: Voluntary, Mandatory, Advance Hire, Total). Downloads date, table, key and the columns as CSV. */
  function balanceMain(PLAN) {
    const m = /[?&]p=(\d+):(\d+):(\d+)/.exec(location.href);
    if (!m) return alert("Open the balance report in fir-db1 first, then run this again.");
    const [, app, pg, session] = m, DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    let item = null;
    const u = /[?&]p=[^&]*?:NO::([^:&]+):([^:&]+)/.exec(location.href);
    if (u) { const names = decodeURIComponent(u[1]).split(","), vals = decodeURIComponent(u[2]).split(","); const k = vals.findIndex((v) => DATE.test(v)); if (k >= 0) item = names[k]; }
    if (!item) { const f = [...document.querySelectorAll("input[id^='P" + pg + "_']")].find((e) => DATE.test(e.value || "")); if (f) item = f.id; }
    if (!item) item = (prompt("Page " + pg + ": name of the date item (e.g. P" + pg + "_DATE)", "P" + pg + "_DATE") || "").trim();
    if (!item) return;
    const t = new Date(), md = (d) => (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    const from = PLAN.from || (prompt("First date (MM/DD/YYYY)", md(t)) || "").trim(), to = PLAN.to || (prompt("Last date (MM/DD/YYYY)", from) || "").trim();
    if (!DATE.test(from) || !DATE.test(to)) return alert("Use dates like 10/22/2026.");
    const dt = (x) => { const a = x.split("/"); return new Date(+a[2], a[0] - 1, +a[1]); };
    const dates = [];
    for (let d = dt(from); d <= dt(to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.push(md(d));
    const base = location.origin + location.pathname + "?p=" + app + ":" + pg + ":" + session + "::NO::" + item + ":";
    const txt = (c) => c.textContent.replace(/\s+/g, " ").trim();
    const read = (html, date) => {
      const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
      doc.querySelectorAll("table").forEach((tb) => {
        const trs = [...tb.querySelectorAll("tr")].filter((tr) => tr.closest("table") === tb);
        const rowText = (tr) => [...tr.children].map(txt).join(" ");
        const hi = trs.findIndex((tr) => [...tr.children].some((c) => /^(Status|Rank)$/.test(txt(c))) && /\b(OFF|Voluntary)\b/.test(rowText(tr)));
        if (hi < 0) return;
        const head = [...trs[hi].children].map(txt);
        // One table or two side by side: split the header where a block starts (Status, Rank).
        const starts = head.map((h, i) => (/^(Status|Rank)$/.test(h) ? i : -1)).filter((i) => i >= 0);
        starts.forEach((s, n) => {
          const e = n + 1 < starts.length ? starts[n + 1] : head.length, cols = head.slice(s + 1, e), table = head[s] === "Rank" ? "hires" : "status";
          trs.slice(hi + 1).forEach((tr) => {
            const c = [...tr.children].map(txt), key = c[s];
            if (!key) return;
            const r = { date, table, key };
            cols.forEach((h, j) => { r[h] = c[s + 1 + j] || ""; });
            out.push(r);
          });
        });
      });
      if (!out.length) out.push({ date, table: /type="password"/i.test(html) ? "signed-out" : "not-found",
        key: [...doc.querySelectorAll("table")].slice(-4).map((tb) => [...tb.querySelectorAll("tr")].slice(0, 3).map((tr) => [...tr.children].map(txt).join(" ")).join(" / ").slice(0, 140)).join(" | ").slice(0, 600) });
      return out;
    };
    return (async () => {
      const all = [];
      for (let k = 0; k < dates.length; k++) {
        const rows = read(await (await fetch(base + encodeURIComponent(dates[k]), { credentials: "same-origin" })).text(), dates[k]);
        if (rows[0].table === "signed-out") { alert("fir-db1 signed you out after " + k + " of " + dates.length + " days. Sign in and run again from " + dates[k] + "."); break; }
        rows.forEach((r) => all.push(r));
        console.log("balance pull " + (k + 1) + "/" + dates.length + ": " + dates[k] + " (" + rows.length + " rows)");
        await new Promise((r) => setTimeout(r, 400));
      }
      const cols = ["date", "table", "key"];
      all.forEach((r) => Object.keys(r).forEach((h) => { if (cols.indexOf(h) < 0) cols.push(h); }));
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [cols.join(",")].concat(all.map((r) => cols.map((c) => q(r[c])).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || ("fir-balance-" + from.replace(/\//g, "-") + (to !== from ? "_to_" + to.replace(/\//g, "-") : "") + ".csv");
      document.body.appendChild(a); a.click(); a.remove();
      console.log("balance pull done: " + all.length + " rows (date item " + item + ").");
    })();
  }
  function balanceScript(plan) {
    return "/* Tour schedule: fir-db1 daily balance report pull (" + String(plan.label || "").replace(/\*\//g, "") + "). Paste in the console on the balance report page. */\n" +
      "(" + balanceMain.toString() + ")(" + JSON.stringify({ from: plan.from || "", to: plan.to || "", fileName: plan.fileName || "" }) + ");\n";
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

  root.FirCompare = { LEVELS: LEVELS, targets: targets, parseList: parseList, targetsFromList: targetsFromList, script: script, phoneScript: phoneScript, licenseScript: licenseScript, battalionScript: battalionScript, balanceScript: balanceScript, parseCsv: parseCsv, compare: compare, firState: firState, COLS: COLS };
})(typeof window !== "undefined" ? window : globalThis);
