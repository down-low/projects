"""Station rosters (fir-sap2 Excel exports) to one CSV: python3 -I tools/reconcile/xlsx2csv.py <folder or .zip> <out.csv>.
Columns: station, id, name, reason (OWN, VR, OSE, POS, HIR or blank), rank (H class), company."""
import sys, os, re, io, csv, zipfile, xml.etree.ElementTree as ET
M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def rows_of(data):
    z = zipfile.ZipFile(io.BytesIO(data)); names = z.namelist()
    ss = [''.join(t.text or '' for t in si.iter(M + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(M + 'si')] if 'xl/sharedStrings.xml' in names else []
    sheet = next(n for n in names if re.match(r'xl/worksheets/[^/]+\.xml$', n, re.I))
    for row in ET.fromstring(z.read(sheet)).iter(M + 'row'):
        vals = []
        for c in row.findall(M + 'c'):
            t, v = c.get('t'), c.find(M + 'v')
            val = ''.join(x.text or '' for x in c.iter(M + 't')) if t == 'inlineStr' else (ss[int(v.text)] if t == 's' else v.text) if v is not None else ''
            val = (val or '').replace('_x000a_', ' ').strip()
            if val: vals.append(val)
        yield vals
def files(src):
    if zipfile.is_zipfile(src) and not src.lower().endswith('.xlsx'):
        z = zipfile.ZipFile(src)
        for n in z.namelist():
            if n.lower().endswith('.xlsx') and not n.startswith('__MACOSX'): yield n, z.read(n)
    else:
        for n in sorted(os.listdir(src)):
            if n.lower().endswith('.xlsx'): yield n, open(os.path.join(src, n), 'rb').read()
out = csv.writer(open(sys.argv[2], 'w', newline='')); out.writerow(['station', 'id', 'name', 'reason', 'rank', 'company'])
n = 0
for name, data in files(sys.argv[1]):
    st = ''
    for r in rows_of(data):
        m = re.search(r'Assigned To Station:\s*(\S+)', ' '.join(r))
        if m: st = m.group(1); continue
        if r and re.fullmatch(r'[A-Z]{2}\d{4}', r[0]):
            rest = r[2:]; rank = next((x for x in rest if re.fullmatch(r'H\s*\d+', x)), '')
            i = rest.index(rank) if rank else len(rest)
            out.writerow([st, r[0], r[1] if len(r) > 1 else '', ' '.join(rest[:i]), re.sub(r'\s+', ' ', rank), (rest[i + 1:] or [''])[-1]]); n += 1
print(n, 'rows')
