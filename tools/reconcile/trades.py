"""Who trades shifts, from fir-db1 pulls (the battalion roster CSV from cleanup/fir-pull-battalions.js, or the company-page
CSVs from the fir-pull-<rank>.js scripts):
python3 -I tools/reconcile/trades.py <out.csv> <pull.csv> [more pulls...]

TRW = they worked someone else's shift; TRO = someone worked theirs. A battalion roster TRW row names the partner in its
`with` column ("TRO FI2398"), so the partner gets the TRO day even when they aren't in the file. Each person and date
counts once across files. Writes one row per person who traded (ID, name, days seen, TRW, TRO, net = TRW - TRO,
top partners) and prints top-10 lists. Names stay out of the repo: write the output to the scratchpad."""
import sys, csv, datetime
from collections import Counter, defaultdict


def day(s):
    m, d, y = s.strip().split('/')
    return datetime.date(int(y) + (2000 if len(y) == 2 else 0), int(m), int(d)).isoformat()


trc, names, partners = {}, {}, defaultdict(Counter)
for path in sys.argv[2:]:
    for r in csv.DictReader(open(path, newline='')):
        i = (r.get('emplId') or '').strip()
        if not i or not r.get('date'):
            continue
        k = (i, day(r['date']))
        if r.get('name') and not r['name'][0].isdigit():
            names[i] = r['name']
        if k in trc and trc[k] != 'TRO?':
            continue  # already counted from another file
        trc[k] = r.get('trc', '').strip()
        w = (r.get('with') or '').split()
        if trc[k] == 'TRW' and len(w) == 2 and w[0] == 'TRO':
            p = w[1]
            trc.setdefault((p, k[1]), 'TRO?')  # partner known only from this row
            partners[i][p] += 1
            partners[p][i] += 1

seen, trw, tro = Counter(), Counter(), Counter()
for (i, d), t in trc.items():
    if t != 'TRO?':
        seen[i] += 1
    if t == 'TRW':
        trw[i] += 1
    elif t in ('TRO', 'TRO?'):
        tro[i] += 1

people = sorted({i for i in trw} | {i for i in tro}, key=lambda i: (-(trw[i] + tro[i]), i))
dates = sorted({d for _, d in trc})
with open(sys.argv[1], 'w', newline='') as f:
    out = csv.writer(f)
    out.writerow(['emplId', 'name', 'days_seen', 'trw', 'tro', 'trades', 'net', 'partners'])
    for i in people:
        top = ' '.join(f'{p}x{n}' for p, n in partners[i].most_common(3))
        out.writerow([i, names.get(i, ''), seen[i], trw[i], tro[i], trw[i] + tro[i], trw[i] - tro[i], top])

label = lambda i: f'{names.get(i, i)} ({i})'
print(f'{len(seen)} people, {dates[0] if dates else "-"} to {dates[-1] if dates else "-"} ({len(dates)} days); '
      f'{len(people)} traded; {sum(trw.values())} TRW, {sum(tro.values())} TRO days')
for title, key in (('Most trades (TRW + TRO)', lambda i: trw[i] + tro[i]), ('Worked most for others (TRW)', lambda i: trw[i]),
                   ('Others worked most for them (TRO)', lambda i: tro[i]), ('Most owed to them (TRW - TRO)', lambda i: trw[i] - tro[i]),
                   ('Owe the most (TRO - TRW)', lambda i: tro[i] - trw[i])):
    print('\n' + title)
    for i in sorted(people, key=lambda i: (-key(i), i))[:10]:
        if key(i) > 0:
            print(f'  {label(i)}: TRW {trw[i]}, TRO {tro[i]}')
pairs = Counter()
for i, c in partners.items():
    for p, n in c.items():
        if i < p:
            pairs[(i, p)] = n
if pairs:
    print('\nMost frequent pairs')
    for (a, b), n in pairs.most_common(10):
        print(f'  {label(a)} + {label(b)}: {n}')
