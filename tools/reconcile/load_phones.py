"""Adds numbers from fir-db1 phone pulls (cleanup/fir-pull-phones-*.js CSVs) to the staff-list contacts record:
python3 -I tools/reconcile/load_phones.py <staff-list.json> <out.json> <pull.csv> [more pulls...]

<staff-list.json> is the current contacts/staff-list document (ArtifactData get with out_dir). For each person (key) with
no number on file: their CELL, else their HOME (marked in `home`, so the tool can say a text may not reach it). A number
already on file is never replaced. Writes the whole new document to <out.json> for one `set` with if_version, and prints
counts only: numbers never go to the screen, the repo or chat."""
import sys, csv, json, re

cur = json.load(open(sys.argv[1]))
doc = cur.get('data', cur)  # an ArtifactData file wraps the document in {id, data, version}
cells, home = dict(doc.get('cells') or {}), dict(doc.get('home') or {})
digits = lambda v: re.sub(r'\D', '', v or '')

pick = {}  # key -> (kind, number); CELL beats HOME
for path in sys.argv[3:]:
    for r in csv.DictReader(open(path, newline='')):
        key, kind, num = (r.get('key') or '').strip(), (r.get('type') or '').strip().upper(), (r.get('number') or '').strip()
        if not key or kind not in ('CELL', 'HOME') or len(digits(num)) < 10:
            continue
        if key not in pick or (kind == 'CELL' and pick[key][0] == 'HOME'):
            pick[key] = (kind, num)

added = {'CELL': 0, 'HOME': 0}
kept = 0
for key, (kind, num) in sorted(pick.items()):
    if cells.get(key):
        kept += 1
        continue
    cells[key] = num
    if kind == 'HOME':
        home[key] = True
    else:
        home.pop(key, None)
    added[kind] += 1

out = dict(doc, cells=cells, home=home)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print(f"{len(pick)} people with a CELL or HOME in the pulls; added {added['CELL']} cells and {added['HOME']} home numbers; "
      f"{kept} already had a number (kept). Staff list: {len(doc.get('cells') or {})} -> {len(cells)} numbers, {len(home)} marked home.")
