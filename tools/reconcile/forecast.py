"""Expected people off and overtime hires per day, from the balance-report history plus a future-dated pull (what is
already booked), and later the check of those estimates against the real reports.

  python3 -I tools/reconcile/forecast.py project <history balance_bottom.csv> <booked balance_bottom.csv> <out.csv> [--asof YYYY-MM-DD]
  python3 -I tools/reconcile/forecast.py check <forecast.csv> <actual balance_bottom.csv> <out.csv>

project: for each date in the booked file:
- disability as booked (a future report already carries it); vacation as the larger of booked and last year's same
  weekday that month, since vacation keeps getting booked closer to the day;
- sick from the same weekday over the 8 weeks before --asof, scaled by the month's share in last year's data when
  that month is in the history (Nov and Dec 2025 are);
- hires from a straight-line fit on the whole history: hires = a + b * (sick + vacation + disability), refit on
  every run, with a typical miss (the fit's average daily error) as a +/- band.
Holidays run low on sick and high on mandatory hires, which the fit doesn't know: a holiday that is in last year's
history gets last year's gap (its hires minus a typical same weekday that month) added, shown as holiday_adj.

check: joins a forecast with the real reports for the same dates and lists, per day, estimate vs actual for sick,
vacation, disability and hires, with the miss; prints the average miss for the days checked."""
import sys, csv, datetime, statistics as st
from collections import defaultdict, Counter

SICK, VAC, DIS = {'SL', 'SP', 'SPI'}, {'VA', 'IDV', 'TC'}, {'DP', 'WC'}
HOLIDAYS = {'11-11': "Veterans Day", '12-24': "Christmas Eve", '12-25': "Christmas", '12-31': "New Year's Eve", '01-01': "New Year's Day",
            '07-04': "Independence Day", '10-31': "Halloween"}


def thanksgiving(y):
    d = datetime.date(y, 11, 1)
    d += datetime.timedelta((3 - d.weekday()) % 7)  # first Thursday
    return d + datetime.timedelta(21)


def holiday(day):
    tg = thanksgiving(day.year)
    if day == tg: return 'Thanksgiving'
    if day == tg + datetime.timedelta(1): return 'Day after Thanksgiving'
    return HOLIDAYS.get(day.strftime('%m-%d'), '')


def days(path):
    """Per date: sick, vacation, disability and hires (overtime Total) from a balance_bottom.csv; OS and OP are ignored."""
    out = defaultdict(Counter)
    n = lambda v: int(v) if (v or '').strip().lstrip('-').isdigit() else 0
    for r in csv.DictReader(open(path, newline='')):
        d = out[r['date']]
        d['_seen'] = 1
        if r['table'] == 'status':
            tot = n(r['OFF']) + n(r['PM']) + n(r['FF'])
            c = r['code']
            if c in SICK: d['sick'] += tot
            elif c in VAC: d['vacation'] += tot
            elif c in DIS: d['disability'] += tot
        elif r['table'] == 'overtime' and r['rank'] == 'Total':
            d['hired'] = n(r['total'])
    return out


def solve(A, b):
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [x - f * y for x, y in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def fit(hist):
    # OS and OP on the balance sheet count neither people off nor hires (user), so they are not in the fit.
    X = [[1, h['sick'] + h['vacation'] + h['disability']] for h in hist.values()]
    y = [h['hired'] for h in hist.values()]
    A = [[sum(x[i] * x[j] for x in X) for j in range(2)] for i in range(2)]
    coef = solve(A, [sum(x[i] * v for x, v in zip(X, y)) for i in range(2)])
    miss = st.mean(abs(sum(c * xi for c, xi in zip(coef, x)) - v) for x, v in zip(X, y))
    return coef, miss


def project(hist_path, booked_path, out_path, asof):
    hist, booked = days(hist_path), days(booked_path)
    asof = datetime.date.fromisoformat(asof) if asof else max(datetime.date.fromisoformat(d) for d in hist)
    coef, miss = fit(hist)
    D = {datetime.date.fromisoformat(k): v for k, v in hist.items()}
    recent = [d for d in D if asof - datetime.timedelta(56) < d <= asof]
    month_sick, wd_vac, wd_hires = defaultdict(list), defaultdict(list), defaultdict(list)
    for d, v in D.items():
        month_sick[(d.year, d.month)].append(v['sick'])
        if not holiday(d):
            wd_vac[(d.year, d.month, d.weekday())].append(v['vacation'])
            wd_hires[(d.year, d.month, d.weekday())].append(v['hired'])
    # A holiday last year: its hires minus a typical same weekday that month (Thanksgiving 2025 ran about +32).
    hol_gap = {}
    for d, v in D.items():
        name, typ = holiday(d), wd_hires.get((d.year, d.month, d.weekday()))
        if name and typ: hol_gap[(d.year, name)] = v['hired'] - st.mean(typ)
    rows = []
    for k in sorted(booked):
        day = datetime.date.fromisoformat(k)
        b = booked[k]
        same = [D[d]['sick'] for d in recent if d.weekday() == day.weekday()]
        sick = st.mean(same) if same else st.mean(D[d]['sick'] for d in recent)
        # Season: last year's month vs last year's month of --asof, when both are in the history.
        ly, ly_ref = month_sick.get((day.year - 1, day.month)), month_sick.get((asof.year - 1, asof.month))
        if ly and ly_ref: sick *= st.mean(ly) / st.mean(ly_ref)
        # Vacation keeps getting booked after a future report is pulled (about 10/day booked 3-10 weeks out vs about 22
        # actual last Nov-Dec), so use the larger of booked and last year's same weekday that month.
        ly_vac = wd_vac.get((day.year - 1, day.month, day.weekday()))
        vac = max(b['vacation'], st.mean(ly_vac)) if ly_vac else b['vacation']
        hires = coef[0] + coef[1] * (sick + vac + b['disability'])
        hname = holiday(day)
        adj = hol_gap.get((day.year - 1, hname), 0) if hname else 0
        hires += adj
        rows.append({'date': k, 'weekday': day.strftime('%a'), 'holiday': hname, 'booked_vacation': b['vacation'],
                     'est_vacation': round(vac, 1), 'booked_disability': b['disability'], 'booked_sick': b['sick'], 'est_sick': round(sick, 1),
                     'holiday_adj': round(adj, 1), 'est_hires': round(hires, 1), 'low': round(max(0, hires - miss), 1),
                     'high': round(hires + miss, 1), 'asof': asof.isoformat()})
    w = csv.DictWriter(open(out_path, 'w', newline=''), fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)
    print(f"{len(rows)} days projected as of {asof}; hires = {coef[0]:.1f} + {coef[1]:.2f} x (sick+vacation+disability), "
          f"typical miss {miss:.1f}/day")
    weeks = defaultdict(list)
    for r in rows:
        d = datetime.date.fromisoformat(r['date']); weeks[d - datetime.timedelta(d.weekday())].append(r['est_hires'])
    for wk, v in sorted(weeks.items()):
        print(f"  week of {wk:%m/%d}: {len(v)} days, est. hires {round(sum(v))}")
    for r in sorted(rows, key=lambda r: -r['est_hires'])[:8]:
        print(f"  {r['date']} {r['weekday']} est. hires {r['est_hires']} ({r['low']}-{r['high']})" + (f" · {r['holiday']}" if r['holiday'] else ''))


def check(fc_path, actual_path, out_path):
    fc = {r['date']: r for r in csv.DictReader(open(fc_path, newline=''))}
    act = days(actual_path)
    rows = []
    for k in sorted(set(fc) & set(act)):
        f, a = fc[k], act[k]
        rows.append({'date': k, 'weekday': f['weekday'], 'holiday': f['holiday'],
                     'est_sick': f['est_sick'], 'sick': a['sick'], 'booked_vacation': f['booked_vacation'], 'vacation': a['vacation'],
                     'est_vacation': f.get('est_vacation', f['booked_vacation']), 'booked_disability': f['booked_disability'], 'disability': a['disability'],
                     'est_hires': f['est_hires'], 'hired': a['hired'], 'miss': round(a['hired'] - float(f['est_hires']), 1),
                     'in_band': float(f['low']) <= a['hired'] <= float(f['high'])})
    if not rows: return print('no dates in both files')
    w = csv.DictWriter(open(out_path, 'w', newline=''), fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)
    m = lambda k: st.mean(abs(float(r[k[0]]) - float(r[k[1]])) for r in rows)
    print(f"{len(rows)} days checked: hires off by {m(('est_hires', 'hired')):.1f}/day on average "
          f"({sum(r['in_band'] for r in rows)} of {len(rows)} inside the band); sick off by {m(('est_sick', 'sick')):.1f}; "
          f"vacation booked vs actual {m(('booked_vacation', 'vacation')):.1f}; disability {m(('booked_disability', 'disability')):.1f}")


if __name__ == '__main__':
    a = sys.argv[1:]
    asof = a[a.index('--asof') + 1] if '--asof' in a else None
    a = [x for i, x in enumerate(a) if x != '--asof' and (i == 0 or a[i - 1] != '--asof')]
    if a and a[0] == 'project' and len(a) == 4: project(a[1], a[2], a[3], asof)
    elif a and a[0] == 'check' and len(a) == 4: check(a[1], a[2], a[3])
    else: print(__doc__); sys.exit(2)
