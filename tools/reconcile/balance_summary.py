"""One row per date from balance_bottom.csv, for estimating sick leave from the same weekday last year:
python3 -I tools/reconcile/balance_summary.py <balance_bottom.csv> <out.csv>

Columns: date, weekday; sick, vacation and disability (each OFF, PM, FF and total); other off; WDO (overtime worked);
hired (overtime Total). Then the same columns for the same weekday a year earlier (364 days before), when that day is
in the file, and sick_change (this year's sick total minus last year's). OFF = officers, PM = paramedics, FF = firefighters."""
import sys, csv, datetime
from collections import defaultdict
GROUPS = ['sick', 'vacation', 'disability']
n = lambda v: int(v) if (v or '').strip().lstrip('-').isdigit() else 0
days = defaultdict(lambda: defaultdict(int))
for r in csv.DictReader(open(sys.argv[1])):
    d = days[r['date']]
    if r['table'] == 'status':
        g = r['group']
        for c in ('OFF', 'PM', 'FF'):
            if g in GROUPS: d[g + '_' + c] += n(r[c])
        tot = n(r['OFF']) + n(r['PM']) + n(r['FF'])
        if g in GROUPS: d[g] += tot
        elif g == 'overtime': d['wdo'] += tot
        else: d['other_off'] += tot
    elif r['table'] == 'overtime' and r['rank'] == 'Total':
        d['hired'] = n(r['total'])
COLS = [g + s for g in GROUPS for s in ('_OFF', '_PM', '_FF', '')] + ['other_off', 'wdo', 'hired']
out = csv.writer(open(sys.argv[2], 'w', newline=''))
out.writerow(['date', 'weekday'] + COLS + ['ly_date'] + ['ly_' + c for c in COLS] + ['sick_change'])
for date in sorted(days):
    dd = datetime.date.fromisoformat(date); ly = (dd - datetime.timedelta(days=364)).isoformat()
    row = [date, dd.strftime('%a')] + [days[date][c] for c in COLS]
    if ly in days: row += [ly] + [days[ly][c] for c in COLS] + [days[date]['sick'] - days[ly]['sick']]
    else: row += [''] * (len(COLS) + 2)
    out.writerow(row)
print(len(days), 'days;', sum(1 for d in days if (datetime.date.fromisoformat(d) - datetime.timedelta(days=364)).isoformat() in days), 'paired with the same weekday last year')
