/* Tour schedule: daily balance report counts from fir-sap2 in one CSV.
 * Open the Daily Balance Report (the /rpt/open.jsp link, any date) on fir-sap2, then paste this in that tab's console
 * (F12 → Console). It asks for the dates (one or more ranges), asks the same report for each day as an Excel file and reads its two
 * bottom tables: status counts (DP, IDV, PB, SP, SPI, TC, VA, WC, WDO… by OFF, PM, FF) and overtime hired by rank
 * (Voluntary, Mandatory, Advance Hire, Total). Downloads balance_bottom.csv (date YYYY-MM-DD, table status|overtime, group,
 * code, OFF, PM, FF, rank, voluntary, mandatory, advance, total) and, if any day failed, balance_failed.txt. OFF = officers,
 * PM = paramedics, FF = firefighters. Groups: sick SL/SP/SPI, vacation VA/IDV/TC, disability DP/WC, overtime WDO, other.
 * The full reports are read in this browser's memory and never saved. Nothing is sent anywhere else. If fir-sap2 won't hand the Excel files to the script, it offers to download each day's
 * file instead; attach those (or a zip) in the chat. */
(async () => {
  const here = new URL(location.href);
  if (!/open\.jsp/i.test(here.pathname) || !here.searchParams.get('iDocID')) {
    return alert('Open the Daily Balance Report on fir-sap2 first (the open.jsp link), then run this again.');
  }
  const md = (d) => (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(), t = new Date();
  // One or more ranges, e.g. "10/1/2025-10/31/2025, 10/1/2026-10/22/2026" (a single date works too).
  const spec = (prompt('Dates to pull: ranges separated by commas', '10/1/2025-10/31/2025, 10/1/2026-' + md(t)) || '').trim();
  const D = /^\d{1,2}\/\d{1,2}\/\d{4}$/, dt = (x) => { const a = x.split('/'); return new Date(+a[2], a[0] - 1, +a[1]); };
  const dates = [], seenDay = new Set();
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map((x) => x.trim());
    if (!D.test(a) || (b && !D.test(b))) return alert('Use dates like 10/1/2025-10/31/2025, 10/1/2026-10/22/2026.');
    for (let d = dt(a); d <= dt(b || a); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const k = d.toDateString();
      if (!seenDay.has(k)) { seenDay.add(k); dates.push(d); }
    }
  }
  if (!dates.length) return;
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
  // Same logic as tools/reconcile/balance_xlsx.py.
  const NAME = { Voluntary: 'voluntary', Mandatory: 'mandatory', 'Advance Hire': 'advance', Advance: 'advance', Total: 'total' };
  // Groups (user, 10/22/2026): sick SL/SP/SPI; vacation VA/IDV/TC; disability DP/WC. WDO is an extra shift on a day off
  // (people working overtime, close to the overtime Total), so it is kept apart from the people-off groups.
  const GROUP = { SL: 'sick', SP: 'sick', SPI: 'sick', VA: 'vacation', IDV: 'vacation', TC: 'vacation', DP: 'disability', WC: 'disability', WDO: 'overtime' };
  const isoOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function balance(rows, date) {
    const out = [], hi = rows.findIndex(([, c]) => Object.values(c).includes('Status') && Object.values(c).includes('OFF'));
    if (hi < 0) return out;
    const head = rows[hi][1], cols = Object.keys(head).map(Number).sort((a, b) => a - b);
    const sCol = cols.find((k) => head[k] === 'Status'), rCol = cols.find((k) => head[k] === 'Rank') || 1e9;
    const sHeads = cols.filter((k) => k > sCol && k < rCol), rHeads = cols.filter((k) => k > rCol);
    const near = (k, list) => list.reduce((b, x) => Math.abs(x - k) < Math.abs(b - k) ? x : b, list[0]);
    const nm = (h) => NAME[h] || h;
    for (const [n, c] of rows.slice(hi + 1)) {
      if (n > rows[hi][0] + 60) break;
      const ks = Object.keys(c).map(Number).sort((a, b) => a - b);
      const sKey = ks.filter((k) => k < rCol && /^[A-Z]{1,4}$/.test(c[k]))[0];
      const rKey = rCol < 1e9 ? ks.filter((k) => Math.abs(k - rCol) <= 1 && /^(H\s*\d+|Total)$/.test(c[k]))[0] : undefined;
      if (sKey != null && sHeads.length) {
        const r = { date, table: 'status', group: GROUP[c[sKey]] || 'other', code: c[sKey] };
        ks.filter((k) => k > sKey && (rKey == null || k < rKey) && /^-?\d+$/.test(c[k])).forEach((k) => { r[nm(head[near(k, sHeads)])] = c[k]; });
        out.push(r);
      }
      if (rKey != null && rHeads.length) {
        const r = { date, table: 'overtime', group: 'hired', rank: c[rKey].replace(/\s+/g, ' ') };
        ks.filter((k) => k > rKey && /^-?\d+$/.test(c[k])).forEach((k) => { r[nm(head[near(k, rHeads)])] = c[k]; });
        out.push(r);
        if (c[rKey] === 'Total') break;
      }
    }
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
        failed.push(isoOf(d) + ' (no Excel file)'); continue;
      }
      const rows = balance(await readXlsx(got.buf), isoOf(d));
      if (rows.length) all.push(...rows); else failed.push(isoOf(d) + ' (no tables in the report)');
      console.log('balance: ' + isoOf(d) + ' · ' + rows.length + ' rows');
    } catch (e) { failed.push(isoOf(d) + ' (' + e.message + ')'); }
    await wait();
  }
  if (!all.length) return alert('Nothing read. Failed: ' + failed.join(', '));
  all.sort((a, b) => a.date.localeCompare(b.date) || (a.table === 'status' ? 0 : 1) - (b.table === 'status' ? 0 : 1));
  const COLS = ['date', 'table', 'group', 'code', 'OFF', 'PM', 'FF', 'rank', 'voluntary', 'mandatory', 'advance', 'total'];
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const save = (text, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  save([COLS.join(',')].concat(all.map((r) => COLS.map((c) => q(r[c])).join(','))).join('\n'), 'balance_bottom.csv', 'text/csv');
  if (failed.length) save('Dates that failed (' + failed.length + '):\n' + failed.join('\n') + '\n', 'balance_failed.txt', 'text/plain');
  const days = new Set(all.map((r) => r.date)).size;
  console.log('balance: ' + days + ' days, ' + all.length + ' rows' + (failed.length ? ' · failed: ' + failed.join(', ') : ''));
  alert('Done: ' + days + ' of ' + dates.length + ' days in balance_bottom.csv.' + (failed.length ? ' ' + failed.length + ' failed (listed in balance_failed.txt).' : ' None failed.'));
})();
