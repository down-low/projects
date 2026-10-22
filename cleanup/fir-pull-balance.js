/* Tour schedule: daily balance report counts from fir-sap2 in one CSV.
 * Open the Daily Balance Report (the /rpt/open.jsp link, any date) on fir-sap2, then paste this in that tab's console
 * (F12 → Console). It asks for a first and last date, asks the same report for each day as an Excel file and reads its two
 * bottom tables: status counts (DP, IDV, PB, SP, SPI, TC, VA, WC, WDO… by OFF, PM, FF) and hires by rank (Voluntary,
 * Mandatory, Advance Hire, Total). Downloads fir-balance-<dates>.csv with: date, table, key and the columns.
 * Nothing is sent anywhere else. If fir-sap2 won't hand the Excel files to the script, it offers to download each day's
 * file instead; attach those (or a zip) in the chat. */
(async () => {
  const here = new URL(location.href);
  if (!/open\.jsp/i.test(here.pathname) || !here.searchParams.get('iDocID')) {
    return alert('Open the Daily Balance Report on fir-sap2 first (the open.jsp link), then run this again.');
  }
  const md = (d) => (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(), t = new Date();
  const from = (prompt('First date (MM/DD/YYYY)', md(t)) || '').trim(), to = (prompt('Last date (MM/DD/YYYY)', from) || '').trim();
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(from) || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(to)) return alert('Use dates like 10/22/2026.');
  const dt = (x) => { const a = x.split('/'); return new Date(+a[2], a[0] - 1, +a[1]); };
  const dates = [];
  for (let d = dt(from); d <= dt(to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.push(d);
  // The report's date parameter is Date(year,month,day) with month 1-12, as in the link fir-db1 opens.
  const urlFor = (d) => { const u = new URL(here.href); u.searchParams.set('lsSFROMDT', 'Date(' + d.getFullYear() + ',' + (d.getMonth() + 1) + ',' + d.getDate() + ')'); u.searchParams.set('sOutputFormat', 'E'); return u.href; };
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
  // Rows as [rowNumber, {column: value}], keeping column positions (the tables have blank cells).
  const colOf = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  async function readXlsx(buf) {
    const files = await unzip(buf), xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const sheet = Object.keys(files).find((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n));
    if (!sheet) throw new Error('no worksheet in the file');
    const ssName = Object.keys(files).find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
    const shared = ssName ? [...xml(await files[ssName]()).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    return [...xml(await files[sheet]()).getElementsByTagName('row')].map((row) => {
      const cells = {};
      [...row.getElementsByTagName('c')].forEach((c) => {
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        const val = (t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v ? (t === 's' ? shared[+v.textContent] : v.textContent) : '').replace(/_x000a_/g, ' ').trim();
        if (val) cells[colOf(c.getAttribute('r'))] = val;
      });
      return [+row.getAttribute('r'), cells];
    });
  }
  // The two tables under the totals: a header row with "Status … OFF PM FF" and "Rank Voluntary Mandatory Advance Hire Total".
  // Each value goes to the nearest header column of its block, since exported cells don't always line up under headers.
  function balance(rows, date) {
    const out = [], hi = rows.findIndex(([, c]) => Object.values(c).includes('Status') && Object.values(c).includes('OFF'));
    if (hi < 0) return out;
    const head = rows[hi][1], cols = Object.keys(head).map(Number).sort((a, b) => a - b);
    const sCol = cols.find((k) => head[k] === 'Status'), rCol = cols.find((k) => head[k] === 'Rank') || 1e9;
    const sHeads = cols.filter((k) => k > sCol && k < rCol), rHeads = cols.filter((k) => k > rCol);
    const near = (k, list) => list.reduce((b, x) => Math.abs(x - k) < Math.abs(b - k) ? x : b, list[0]);
    rows.slice(hi + 1).filter(([n]) => n <= rows[hi][0] + 20).forEach(([, c]) => {
      const ks = Object.keys(c).map(Number).sort((a, b) => a - b);
      const sKey = ks.filter((k) => k < (rCol === 1e9 ? 1e9 : rCol) && /^[A-Z]{1,4}$/.test(c[k]))[0];
      const rKey = rCol < 1e9 ? ks.filter((k) => Math.abs(k - rCol) <= 1 && /^(H\s*\d+|Total)$/.test(c[k]))[0] : undefined;
      if (sKey != null && sHeads.length) {
        const r = { date, table: 'status', key: c[sKey] };
        ks.filter((k) => k > sKey && (rKey == null || k < rKey) && /^-?\d+$/.test(c[k])).forEach((k) => { r[head[near(k, sHeads)]] = c[k]; });
        out.push(r);
      }
      if (rKey != null && rHeads.length) {
        const r = { date, table: 'hires', key: c[rKey].replace(/\s+/g, ' ') };
        ks.filter((k) => k > rKey && /^-?\d+$/.test(c[k])).forEach((k) => { r[head[near(k, rHeads)]] = c[k]; });
        out.push(r);
      }
    });
    return out;
  }

  // BusinessObjects answers with a page that loads the report in a frame (sometimes through a redirect script),
  // so follow frames, meta refreshes and location changes until a file arrives.
  const isZip = (buf) => { const h = new Uint8Array(buf.slice(0, 2)); return h[0] === 0x50 && h[1] === 0x4b; };
  function nextUrl(htmlText, base) {
    const pats = [/<i?frame[^>]*\ssrc\s*=\s*["']([^"']+)["']/i, /http-equiv\s*=\s*["']?refresh["']?[^>]*url\s*=\s*([^"'>\s]+)/i,
      /(?:window|document|top|self)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i, /location\.replace\(\s*["']([^"']+)["']/i];
    for (const re of pats) { const m = re.exec(htmlText); if (m && m[1] && !/^about:|^javascript:/i.test(m[1])) return new URL(m[1].replace(/&amp;/g, '&'), base).href; }
    return null;
  }
  async function getFile(url) {
    const trail = [];
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(url, { credentials: 'include' });
      const buf = await res.arrayBuffer();
      if (isZip(buf)) return { buf };
      const text = new TextDecoder().decode(buf);
      trail.push({ url: res.url || url, type: res.headers.get('content-type'), text });
      const next = nextUrl(text, res.url || url);
      if (!next || next === url) break;
      url = next;
    }
    return { trail };
  }

  const all = [], failed = [];
  for (const d of dates) {
    try {
      const got = await getFile(urlFor(d));
      if (!got.buf) {
        if (!all.length) {
          got.trail.forEach((t, i) => console.log('fir-sap2 step ' + (i + 1) + ': ' + t.url + ' (' + t.type + ')\n' + t.text.slice(0, 3000)));
          if (!confirm('fir-sap2 did not hand the Excel file to this script.\n\nDownload each day\'s Excel file instead? That is ' + dates.length +
            ' files, about 3 seconds apart; Chrome asks once to allow multiple downloads (choose Allow). Then attach the files (or a zip of them) in the chat.\n\nCancel stops here; then copy the "fir-sap2 step" lines from the console into the chat.')) return;
          for (const x of dates) {
            const f = document.createElement('iframe');
            f.style.display = 'none'; f.src = urlFor(x); document.body.appendChild(f);
            console.log('balance: asked for ' + md(x));
            await new Promise((r) => setTimeout(r, 3000));
            setTimeout(() => f.remove(), 60000);
          }
          return alert('Asked for all ' + dates.length + ' days. When the downloads finish, attach the files (or a zip of them) in the chat.');
        }
        failed.push(md(d)); continue;
      }
      const rows = balance(await readXlsx(got.buf), md(d));
      if (rows.length) all.push(...rows); else { failed.push(md(d) + ' (no tables)'); all.push({ date: md(d), table: 'not-found', key: '' }); }
      console.log('balance: ' + md(d) + ' · ' + rows.length + ' rows');
    } catch (e) { failed.push(md(d) + ' (' + e.message + ')'); }
    await wait();
  }
  if (!all.length) return alert('Nothing read. Failed: ' + failed.join(', '));
  const cols = ['date', 'table', 'key'];
  all.forEach((r) => Object.keys(r).forEach((h) => { if (cols.indexOf(h) < 0) cols.push(h); }));
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [cols.join(',')].concat(all.map((r) => cols.map((c) => q(r[c])).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'fir-balance-' + from.replace(/\//g, '-') + (to !== from ? '_to_' + to.replace(/\//g, '-') : '') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('balance: ' + all.length + ' rows' + (failed.length ? ' · failed: ' + failed.join(', ') : ''));
})();
