"""Daily balance report (fir-sap2 Excel exports) to one CSV: python3 -I tools/reconcile/balance_xlsx.py <folder or .zip> <out.csv>.
Reads the two bottom tables of each file: status counts (DP, IDV, SP, … by OFF, PM, FF) and overtime hired by rank
(Voluntary, Mandatory, Advance Hire, Total). The date comes from the report's "As of Date:" cell. Same logic and columns as
cleanup/fir-pull-balance.js: date (YYYY-MM-DD), table (status or overtime), group, code, OFF, PM, FF, rank, voluntary, mandatory,
advance, total."""
import sys, os, re, io, csv, zipfile, xml.etree.ElementTree as ET
M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def col(ref):
    n = 0
    for ch in re.sub(r'\d+$', '', ref): n = n * 26 + ord(ch) - 64
    return n
def rows_of(data):
    z = zipfile.ZipFile(io.BytesIO(data)); names = z.namelist()
    ss = [''.join(t.text or '' for t in si.iter(M + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(M + 'si')] if 'xl/sharedStrings.xml' in names else []
    sheet = next(n for n in names if re.match(r'xl/worksheets/[^/]+\.xml$', n, re.I))
    out = []
    for row in ET.fromstring(z.read(sheet)).iter(M + 'row'):
        cells = {}
        for c in row.findall(M + 'c'):
            t, v = c.get('t'), c.find(M + 'v')
            val = ''.join(x.text or '' for x in c.iter(M + 't')) if t == 'inlineStr' else (ss[int(v.text)] if t == 's' else v.text) if v is not None else ''
            val = (val or '').replace('_x000a_', ' ').strip()
            if val: cells[col(c.get('r'))] = val
        out.append((int(row.get('r')), cells))
    return out
COLS = ['date', 'table', 'group', 'code', 'OFF', 'PM', 'FF', 'rank', 'voluntary', 'mandatory', 'advance', 'total']
# Groups (user, 10/22/2026); WDO is an extra shift on a day off (overtime worked), kept apart from people off.
GROUP = {'SL': 'sick', 'SP': 'sick', 'SPI': 'sick', 'VA': 'vacation', 'IDV': 'vacation', 'TC': 'vacation', 'DP': 'disability', 'WC': 'disability', 'WDO': 'overtime'}
NAME = {'Voluntary': 'voluntary', 'Mandatory': 'mandatory', 'Advance Hire': 'advance', 'Advance': 'advance', 'Total': 'total'}
def iso(d):
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', d or '')
    return '%s-%02d-%02d' % (m.group(3), int(m.group(1)), int(m.group(2))) if m else (d or '')
def balance(rows):
    date = next((m.group(1) for _, c in rows for v in c.values() for m in [re.search(r'As of Date:?\s*(\d{1,2}/\d{1,2}/\d{4})', v)] if m), '')
    if not date:  # the date may sit in the cell after the label
        for _, c in rows:
            ks = sorted(c)
            for i, k in enumerate(ks):
                if re.match(r'As of Date', c[k]) and i + 1 < len(ks) and re.fullmatch(r'\d{1,2}/\d{1,2}/\d{4}', c[ks[i + 1]]): date = c[ks[i + 1]]
    date = iso(date)
    hi = next((i for i, (_, c) in enumerate(rows) if 'Status' in c.values() and 'OFF' in c.values()), None)
    if hi is None: return date, []
    head = rows[hi][1]; cols = sorted(head)
    s_col = next(k for k in cols if head[k] == 'Status'); r_col = next((k for k in cols if head[k] == 'Rank'), 10**9)
    s_heads = [k for k in cols if s_col < k < r_col]; r_heads = [k for k in cols if k > r_col]
    near = lambda k, lst: min(lst, key=lambda x: abs(x - k))
    out = []
    for n, c in rows[hi + 1:]:
        if n > rows[hi][0] + 60: break
        ks = sorted(c)
        s_key = next((k for k in ks if k < r_col and re.fullmatch(r'[A-Z]{1,4}', c[k])), None)
        r_key = next((k for k in ks if r_col < 10**9 and abs(k - r_col) <= 1 and re.fullmatch(r'H\s*\d+|Total', c[k])), None)
        if s_key is not None and s_heads:
            r = {'date': date, 'table': 'status', 'group': GROUP.get(c[s_key], 'other'), 'code': c[s_key]}
            for k in ks:
                if k > s_key and (r_key is None or k < r_key) and re.fullmatch(r'-?\d+', c[k]): r[NAME.get(head[near(k, s_heads)], head[near(k, s_heads)])] = c[k]
            out.append(r)
        if r_key is not None and r_heads:
            r = {'date': date, 'table': 'overtime', 'group': 'hired', 'rank': re.sub(r'\s+', ' ', c[r_key])}
            for k in ks:
                if k > r_key and re.fullmatch(r'-?\d+', c[k]): r[NAME.get(head[near(k, r_heads)], head[near(k, r_heads)])] = c[k]
            out.append(r)
            if c[r_key] == 'Total': break
    return date, out
def files(src):
    if zipfile.is_zipfile(src) and not src.lower().endswith('.xlsx'):
        z = zipfile.ZipFile(src)
        for n in z.namelist():
            if n.lower().endswith('.xlsx') and not n.startswith('__MACOSX'): yield n, z.read(n)
    elif src.lower().endswith('.xlsx'): yield os.path.basename(src), open(src, 'rb').read()
    else:
        for n in sorted(os.listdir(src)):
            if n.lower().endswith('.xlsx'): yield n, open(os.path.join(src, n), 'rb').read()
if __name__ == '__main__':
    # One report per date: a file repeated in the download (same date, same rows) is skipped, so counts aren't doubled;
    # two different reports for one date keep the later file and are listed as conflicts.
    bydate, failed, dupes, conflicts = {}, [], 0, []
    for name, data in files(sys.argv[1]):
        try:
            date, rows = balance(rows_of(data))
        except Exception as e:
            failed.append('%s (%s)' % (name, e)); continue
        print(name, date or '(no date)', len(rows), 'rows')
        if not rows: failed.append('%s %s (no tables)' % (name, date)); continue
        if date in bydate:
            same = sorted(map(repr, map(sorted, (r.items() for r in bydate[date])))) == sorted(map(repr, map(sorted, (r.items() for r in rows))))
            if same: dupes += 1; continue
            conflicts.append(date)
        bydate[date] = rows
    if dupes: print(dupes, 'duplicate files skipped (same date, same rows)')
    if conflicts: print('conflict: different reports for', ', '.join(sorted(set(conflicts))), '(kept the later file)')
    allrows = [r for d in sorted(bydate) for r in bydate[d]]
    allrows.sort(key=lambda r: (r['date'], r['table'] != 'status'))
    w = csv.DictWriter(open(sys.argv[2], 'w', newline=''), fieldnames=COLS, extrasaction='ignore'); w.writeheader(); w.writerows(allrows)
    print(len(allrows), 'rows; failed:', ', '.join(failed) or 'none')
