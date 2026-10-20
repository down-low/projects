/* Tour schedule: every station's roster from fir-sap2 in one CSV.
 * Open any station roster report on fir-sap2 (signed in, city VPN), then paste this in that tab's console (F12 → Console).
 * It asks the same report for each station as an Excel file, reads the rows in this browser and downloads
 * station-rosters-<date>.csv with: station, id, name, reason, rank, company. Nothing is sent anywhere else. */
(async () => {
  const STATIONS = Array.from({ length: 51 }, (_, i) => 'ST' + String(i + 1).padStart(2, '0'));
  const COLS = ['station', 'id', 'name', 'reason', 'rank', 'company'];
  const here = new URL(location.href);
  if (!/open\.jsp/i.test(here.pathname) || !here.searchParams.get('iDocID')) {
    return alert('Open a station roster report on fir-sap2 first (the open.jsp link), then run this again.');
  }
  const urlFor = (st) => { const u = new URL(here.href); u.searchParams.set('lsSSTATION', st); u.searchParams.set('sOutputFormat', 'E'); return u.href; };
  const wait = () => new Promise((r) => setTimeout(r, 400));

  // A minimal .xlsx reader: find the files in the zip, inflate them, parse the XML.
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  async function unzip(buf) {
    const b = new Uint8Array(buf), files = {};
    let e = b.length - 22;
    while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a zip file');
    let p = u32(b, e + 16);
    for (let i = 0, n = u16(b, e + 10); i < n; i++) {
      const method = u16(b, p + 10), size = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), lo = u32(b, p + 42);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
      const start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28), raw = b.subarray(start, start + size);
      files[name] = async () => method === 0 ? new TextDecoder().decode(raw)
        : new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      p += 46 + nl + xl + cl;
    }
    return files;
  }
  async function readXlsx(buf) {
    const files = await unzip(buf), xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const sheet = Object.keys(files).find((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n));
    if (!sheet) throw new Error('no worksheet in the file');
    const ssName = Object.keys(files).find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
    const shared = ssName ? [...xml(await files[ssName]()).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    return [...xml(await files[sheet]()).getElementsByTagName('row')].map((row) => [...row.getElementsByTagName('c')].map((c) => {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
      const val = t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v ? (t === 's' ? shared[+v.textContent] : v.textContent) : '';
      return (val || '').replace(/_x000a_/g, ' ').trim();
    }).filter(Boolean));
  }
  // A person row starts with an Employee ID; then the name, then reason (OWN, VR, OSE, or blank), rank (H 2…H 40), company.
  function people(rows, st) {
    return rows.filter((r) => /^[A-Z]{2}\d{4}$/.test(r[0])).map((r) => {
      const rest = r.slice(2), rank = rest.find((x) => /^H\s*\d+$/.test(x)) || '';
      const after = rest.slice(rest.indexOf(rank) + 1), before = rank ? rest.slice(0, rest.indexOf(rank)) : rest;
      return { station: st, id: r[0], name: r[1] || '', reason: before.join(' '), rank: rank.replace(/\s+/g, ' '), company: after[after.length - 1] || '' };
    });
  }

  const out = [], empty = [], failed = [];
  for (const st of STATIONS) {
    try {
      const res = await fetch(urlFor(st), { credentials: 'include' });
      const buf = await res.arrayBuffer(), head = new Uint8Array(buf.slice(0, 2));
      if (head[0] !== 0x50 || head[1] !== 0x4b) { // not an .xlsx (PK)
        if (st === STATIONS[0] || !out.length) {
          console.log('fir-sap2 sent', res.headers.get('content-type'), new TextDecoder().decode(buf.slice(0, 300)));
          return alert('fir-sap2 did not send an Excel file for ' + st + '. Copy what the console shows (the line starting "fir-sap2 sent") into the chat.');
        }
        failed.push(st); continue;
      }
      const rows = people(await readXlsx(buf), st);
      if (rows.length) out.push(...rows); else empty.push(st);
      console.log('station rosters: ' + st + ' · ' + rows.length + ' people');
    } catch (e) { failed.push(st + ' (' + e.message + ')'); }
    await wait();
  }
  if (!out.length) return alert('No people found. Stations tried: ' + STATIONS.length + (failed.length ? '; failed: ' + failed.join(', ') : '') + '.');
  const q = (v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const csv = [COLS.join(',')].concat(out.map((r) => COLS.map((k) => q(String(r[k] || ''))).join(','))).join('\n');
  const d = new Date(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'station-rosters-' + (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('station rosters: ' + out.length + ' people from ' + (STATIONS.length - empty.length - failed.length) + ' stations' +
    (empty.length ? ' · no one at ' + empty.join(', ') : '') + (failed.length ? ' · failed: ' + failed.join(', ') : ''));
})();
