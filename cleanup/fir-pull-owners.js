/* Tour schedule: fir-db1 pull (owners of the 22 day-to-day fills (20) + E22 company page). Paste in the console on a signed-in fir-db1 tab. */
(async () => {
  const PLAN = {"date":"10/20/2026","to":"","people":[{"id":"MC1167","name":"McDonald,C","co":"19"},{"id":"PA1377","name":"Payne,T","co":"18"},{"id":"PE2341","name":"Petruzzella,A","co":"08"},{"id":"SH3212","name":"Shelton,A","co":"44"},{"id":"CO1596","name":"Colbert,A","co":"42"},{"id":"BE4760","name":"Bernstein,A","co":"16"},{"id":"AD7884","name":"Adams,M","co":"16"},{"id":"YO5760","name":"Young,M","co":"06"},{"id":"JA1161","name":"Jaime-Lopez,A","co":"24"},{"id":"DR5440","name":"Dresser,B","co":"21"},{"id":"TH0404","name":"Thompson,M","co":"02"},{"id":"MC2504","name":"McGee,J","co":"13"},{"id":"ON1765","name":"O'Neil,A","co":"48"},{"id":"TH1082","name":"Thurman,M","co":"18"},{"id":"GU0148","name":"Guajardo,M","co":"11"},{"id":"CH7124","name":"Chin,W","co":"09"},{"id":"ST5868","name":"Stiveson,E","co":"03"},{"id":"AG4244","name":"Aguado,A","co":"19"},{"id":"BA1279","name":"Baltodano,V","co":"40"},{"id":"VA1333","name":"Valenzuela Lopez,J","co":"12"}],"companies":["E22"]};
  const COLS = ["mode","pulledFor","date","query","emplId","name","co","trc","position","role","hours","status","flag"];
  const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
  if (!m) return alert('Open a fir-db1 page first (signed in), then run this again.');
  const app = '1022', session = m[2]; // Time Entry is app 1022, page 2; the session is shared with the 1021 menu
  let date = PLAN.date;
  if (!date) { const t = new Date(); date = (prompt('Date to pull (MM/DD/YYYY)', (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear()) || '').trim(); }
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) return alert('Use a date like 10/20/2026.');
  const base = location.origin + location.pathname + '?p=' + app + ':2:' + session + ':::RP,2:';
  // A range (PLAN.to): an employee page shows about 14 days, from 9 days before its date to 4 after, so ask at
  // several dates and keep each day once. Without PLAN.to: one page at the date.
  const md = (d) => (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  const dt = (s) => { const x = s.split('/'); return new Date(+(x[2].length === 2 ? '20' + x[2] : x[2]), x[0] - 1, +x[1]); };
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const anchors = [];
  if (PLAN.to) { const end = dt(PLAN.to); for (let a = add(dt(date), 9); ; a = add(a, 14)) { anchors.push(md(a)); if (add(a, 4) >= end) break; } } else anchors.push(date);
  const inRange = (s) => !PLAN.to || (s && dt(s) >= dt(date) && dt(s) <= dt(PLAN.to));
  const enc = (v) => encodeURIComponent(v || '');
  const val = (td) => {
    if (!td) return '';
    const c = td.cloneNode(true);
    c.querySelectorAll('script, noscript, label, .u-VisuallyHidden').forEach((x) => x.remove());
    const box = c.querySelector('input[type=checkbox]');
    if (box) return box.hasAttribute('checked') ? 'Y' : '';
    const f = c.querySelector('input:not([type=hidden]), select, textarea');
    if (f && f.tagName === 'SELECT') { const o = f.querySelector('option[selected]'); return o ? o.textContent.trim() : ''; }
    if (f) return (f.getAttribute('value') || '').trim();
    return c.textContent.replace(/\s+/g, ' ').trim();
  };
  // Read the Time Entry table by column id (td headers=...), falling back to the heading text.
  const read = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table[aria-label="Time Entry"], table.t-Report-report') ||
      [...doc.querySelectorAll('table')].find((tb) => /TRC/.test(tb.textContent) && /Position/.test(tb.textContent) && tb.querySelector('th'));
    if (!table) return null;
    const label = {};
    table.querySelectorAll('th').forEach((th) => { if (th.id) label[th.id] = th.textContent.replace(/\s+/g, ' ').trim(); });
    const pick = (o, ids, labels) => { for (const k of ids) if (o.id[k] != null) return o.id[k]; for (const l of labels) if (o.lb[l] != null) return o.lb[l]; return ''; };
    return [...table.querySelectorAll('tr')].map((tr) => {
      const o = { id: {}, lb: {} };
      [...tr.querySelectorAll('td')].forEach((td) => { const h = td.getAttribute('headers'); if (!h) return; const v = val(td); o.id[h] = v; if (label[h] && o.lb[label[h]] == null) o.lb[label[h]] = v; });
      return { emplId: pick(o, ['ORDER_BY', 'EMPLID'], ['Empl']), name: pick(o, ['DATE_NAME', 'NAME'], ['Name']), date: pick(o, ['SCHD_DATE', 'SCHD_DT'], ['Date']),
        day: pick(o, [], ['Day']), co: pick(o, ['SCHD_COMPANY'], ['Co']), trc: pick(o, ['TIME_RPTG_CD'], ['TRC']), position: pick(o, ['POSITION_NBR'], ['Position']),
        role: pick(o, ['SCHD_ROLE_CD'], ['Role']), hours: pick(o, ['HOURS'], []), status: pick(o, ['EMPL_CLASS'], ['Status']) };
    }).filter((r) => r.trc || r.position || /^[A-Z]{2}\d{4}$/.test(r.emplId));
  };
  const out = [], wait = () => new Promise((r) => setTimeout(r, 400));
  const get = async (url) => { const h = await (await fetch(url, { credentials: 'same-origin' })).text();
    if (!/Time Entry/.test(h) && /type="password"/i.test(h)) throw new Error('signed-out'); return h; };
  const total = PLAN.people.length + PLAN.companies.length;
  let n = 0;
  try {
    for (const p of PLAN.people) {
      console.log('fir pull ' + (++n) + '/' + total + ': ' + p.name + ' ' + p.id);
      let rows = null; const seen = {};
      for (const a of anchors) {
        const got = read(await get(base + 'P2_WHICH,P2_EMPLID,P2_COMPANY,P2_SCHD_DT:Empl,' + enc(p.id) + ',' + enc(p.co) + ',' + enc(a)));
        if (!got) continue;
        rows = rows || [];
        got.forEach((r) => { const k = r.date || JSON.stringify(r); if (!seen[k] && inRange(r.date)) { seen[k] = 1; rows.push(r); } });
        if (anchors.length > 1) await wait();
      }
      if (!rows) out.push({ mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name, flag: 'no-table' });
      else if (!rows.length) out.push({ mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name, flag: 'empty' });
      else rows.forEach((r) => out.push(Object.assign(r, { mode: 'empl', pulledFor: date, query: p.id, emplId: p.id, name: p.name })));
      await wait();
    }
    for (const co of PLAN.companies) {
      console.log('fir pull ' + (++n) + '/' + total + ': company ' + co);
      let rows = read(await get(base + 'P2_COMPANY,P2_SCHD_DT,P2_WHICH,P2_NUM_ROWS:' + enc(co) + ',' + enc(date) + ',Co,100'));
      if (!rows) rows = read(await get(base + 'P2_COMPANY,P2_SCHD_DT,P2_WHICH:' + enc(co) + ',' + enc(date) + ',Co'));
      if (!rows) out.push({ mode: 'co', pulledFor: date, query: co, flag: 'no-table' });
      else if (!rows.length) out.push({ mode: 'co', pulledFor: date, query: co, flag: 'empty' });
      else rows.forEach((r) => out.push(Object.assign(r, { mode: 'co', pulledFor: date, query: co, date: date })));
      await wait();
    }
  } catch (e) {
    if (e.message === 'signed-out') alert('fir-db1 signed you out. Sign in again and rerun; the rows so far are in the file.'); else console.error(e);
  }
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [COLS.join(',')].concat(out.map((r) => COLS.map((c) => q(r[c])).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'fir-' + date.replace(/\//g, '-') + (PLAN.to ? '_to_' + PLAN.to.replace(/\//g, '-') : '') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('fir pull done: ' + out.length + ' rows.');
})();
