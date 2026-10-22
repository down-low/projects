/* Tour schedule: fir-db1 pull (records in question, H 40 (52)). Paste in the console on a signed-in fir-db1 tab. */
(async () => {
  const PLAN = {"date":"10/19/2026","people":[{"id":"CR7635","name":"Crean,Ryan T.","co":"B01"},{"id":"PU8622","name":"Pumphrey,Zachary W","co":"B10"},{"id":"SA3603","name":"Sato,Joel H","co":"B01"},{"id":"GE4179","name":"Gering,Rick W","co":"B01"},{"id":"CR7255","name":"Crispen,Dean","co":"B02"},{"id":"RO9757","name":"Rocco,John S","co":"B03"},{"id":"KA6606","name":"Kasper,Marc T.","co":"B03"},{"id":"BR0862","name":"Brown,David M","co":"B04"},{"id":"UN7612","name":"Untalan,Richard D","co":"B04"},{"id":"MA5688","name":"Maloney,Michael E","co":"B05"},{"id":"HA4317","name":"Hayes,Mark T","co":"B05"},{"id":"MC8463","name":"McGuire,Thomas A","co":"B05"},{"id":"MU2854","name":"Mullin,Michael K","co":"B06"},{"id":"PA5985","name":"Paratley,Anita D","co":"B06"},{"id":"SI0377","name":"Siguenza,Pablo","co":"B06"},{"id":"AL1783","name":"Alba,Matthew L","co":"B07"},{"id":"RO0008","name":"Romero,Samuel","co":"B07"},{"id":"MU6444","name":"Murdock,Cherish","co":"B08"},{"id":"FR2651","name":"Francois,Pierre L","co":"B08"},{"id":"KI0171","name":"Kiernan,Thomas D","co":"B09"},{"id":"AB6214","name":"Abbott,Thomas F","co":"B10"},{"id":"RI1361","name":"Rivieccio,C","co":"B01"},{"id":"MO5148","name":"Molloy,D","co":"B01"},{"id":"TH7542","name":"Thompson,D","co":"B01"},{"id":"CH1691","name":"Choy,A","co":"B01"},{"id":"PE8323","name":"Pereira,J","co":"B02"},{"id":"MC6913","name":"McKinney,S","co":"B03"},{"id":"HO4233","name":"Hoo,E","co":"B03"},{"id":"KU1180","name":"Kuhn,K","co":"B03"},{"id":"KA0423","name":"Kaialoa,S","co":"B04"},{"id":"LE1207","name":"Leal,E","co":"B04"},{"id":"RO6076","name":"Rollins,F","co":"B04"},{"id":"SC1471","name":"Scheppler,R","co":"B05"},{"id":"CA4340","name":"Cavellini,N","co":"B05"},{"id":"JO5420","name":"Johannessen,T","co":"B06"},{"id":"MC4957","name":"McKeon,K","co":"B06"},{"id":"SC2112","name":"Scoble,H","co":"B06"},{"id":"TO7971","name":"Toby,R","co":"B07"},{"id":"KI9180","name":"Kircher,G","co":"B07"},{"id":"IB3665","name":"Ibarra-Rivera,L","co":"B08"},{"id":"RA9634","name":"Ramirez,R","co":"B08"},{"id":"LE8507","name":"Lee,M","co":"B09"},{"id":"TR6847","name":"Triplitt,C","co":"B10"},{"id":"SM0735","name":"Smith,M","co":"B10"},{"id":"BE0675","name":"Benz,C","co":""},{"id":"EC3860","name":"Eckerdt,D","co":""},{"id":"CA5637","name":"Cannon,Matthew M","co":""},{"id":"CE8113","name":"Cercos-IV,Frank","co":""},{"id":"DA7026","name":"D'Arcy,Patrick D","co":""},{"id":"PA7306","name":"Parks,Natasha J","co":""},{"id":"TH2682","name":"Thompson,Michael I","co":"T02"},{"id":"SM2424","name":"Smith,Kevin W","co":"E38"}],"companies":[]};
  const COLS = ["mode","pulledFor","date","query","emplId","name","co","trc","position","role","hours","status","flag"];
  const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
  if (!m) return alert('Open a fir-db1 page first (signed in), then run this again.');
  const app = '1022', session = m[2]; // Time Entry is app 1022, page 2; the session is shared with the 1021 menu
  let date = PLAN.date;
  if (!date) { const t = new Date(); date = (prompt('Date to pull (MM/DD/YYYY)', (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear()) || '').trim(); }
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) return alert('Use a date like 10/20/2026.');
  const base = location.origin + location.pathname + '?p=' + app + ':2:' + session + ':::RP,2:';
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
      const rows = read(await get(base + 'P2_WHICH,P2_EMPLID,P2_COMPANY,P2_SCHD_DT:Empl,' + enc(p.id) + ',' + enc(p.co) + ',' + enc(date)));
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
  a.download = 'fir-' + date.replace(/\//g, '-') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('fir pull done: ' + out.length + ' rows.');
})();
