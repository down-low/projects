#!/usr/bin/env python3
"""Fictional data for the demo branch (claude/demo-app): ~200 made-up people in 2 battalions, view-only.

Usage: python3 tools/make_demo_data.py

Seeded and dated from a fixed day, so every run writes the same bytes. Writes the files the app reads, in the same shapes
as the real ones (none of the real values):
  data/positions.json, data/employee-ids.json, data/required-staffing.json, data/vacancy-awards-2027.json,
  data/organization.json (the demo's divisions, read by organization.js through build_artifact.py),
  demo/records.json (the view-only snapshot: statuses, tour changes, covers, an added person, moves and their log).
Then tools/build_demo.sh adds the trade demo and builds dist/demo.html. See DEMO.md.
"""
import datetime as dt
import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 2026
AS_OF = "2026-10-19"
OFFSETS = [0, 3, 6, 10, 13, 16, 20, 23, 26]  # schedule.js TOUR_OFFSETS
BASE = dt.date(2026, 1, 1)  # watch 16 (schedule.js BASE_WATCH)

# Invented surnames (checked against nothing real in the repo; the scan in DEMO.md confirms no overlap).
SURNAMES = [
    "Ashgrove", "Okafor", "Nakamura", "Lindqvist", "Thornbury", "Marchbank", "Wexley", "Ollander", "Kestrelton",
    "Halloway", "Tamsworth", "Brackenridge", "Brightwater", "Quillfeather", "Pennywhistle", "Fenwick", "Marlowe",
    "Amberly", "Birchfield", "Calloway", "Dunmore", "Elsworth", "Farrowby", "Galloway", "Hartwell", "Ivesdale",
    "Juniper", "Kingsbury", "Larkmoor", "Mossbank", "Northcote", "Oakhurst", "Pemberly", "Quarrington", "Redfern",
    "Stonebridge", "Tidewell", "Underhill", "Valemont", "Wintermere", "Yarrowby", "Zelinski", "Abernathy", "Blackmere",
    "Coldwell", "Draycott", "Eastbrook", "Fairbanks", "Glenrock", "Hollister", "Inglewood", "Jessamy", "Kilbride",
    "Lowenthal", "Merriweather", "Netherby", "Ormsby", "Prestwick", "Ravensworth", "Saltonstall", "Thistlewood",
    "Umberfield", "Vandermeer", "Wolcott", "Ainsley", "Bramblecote", "Copperfield", "Dewhurst", "Emberton", "Foxworth",
]
INITIALS = "ABCDEFGHJKLMNPRSTVW"

# Seats per apparatus: (type code, rank, title prefix, hclass, count, swing role or None)
ENGINE = [("EOC", "Captain", "Captain", "H30", 1), ("EOL", "Lieutenant", "Lt.", "H20", 2),
          ("EOA", "FF/Paramedic", "FF/PM", "H3", 2), ("EOD", "Firefighter", "FF/Driver", "H2", 3),
          ("EOE", "Firefighter", "FF/EMT", "H2", 4)]
TRUCK = [("TOC", "Captain", "Captain", "H30", 1), ("TOL", "Lieutenant", "Lt.", "H20", 2),
         ("TOD", "Firefighter", "FF/Driver", "H2", 3), ("TOE", "Firefighter", "FF/EMT", "H2", 3),
         ("TOF", "Firefighter", "Firefighter", "H2", 3), ("TOT", "Firefighter", "FF/Tiller", "H2", 3)]
SQUAD = [("SOC", "Captain", "Captain", "H30", 1), ("SOL", "Lieutenant", "Lt.", "H20", 2),
         ("SOD", "Firefighter", "FF/Driver", "H2", 3), ("SOE", "Firefighter", "FF/EMT", "H2", 3),
         ("SOF", "Firefighter", "Firefighter", "H2", 4)]
MEDIC = [("MOA", "FF/Paramedic", "FF/PM", "H3", 3)]

B01 = ["E01", "E02", "E03", "E04", "E05"]
B02 = ["E06", "E07", "E08", "E09", "E10"]
ALIASES = {"Rescue Captain 1": "RC1"}  # organization.js ALIASES
ORGANIZATION = [{"id": "DV01", "name": "Division 1", "battalions": [
    {"id": "BT01", "name": "Batt 1", "apparatus": ["B01"] + B01 + ["RC1", "RS1", "T03"]},
    {"id": "BT02", "name": "Batt 2", "apparatus": ["B02"] + B02 + ["MA1", "T08"]},
]}]


def watch(d):
    return ((d - BASE).days + 15) % 31 + 1


def works(tour, d):
    return (watch(d) - tour) % 31 in OFFSETS


def first_shift(tour, on_or_after):
    d = dt.date.fromisoformat(on_or_after)
    while not works(tour, d):
        d += dt.timedelta(days=1)
    return d.isoformat()


def watches(tour):
    return sorted((tour - 1 + o) % 31 + 1 for o in OFFSETS)


def on_duty(seats, recs, day):
    """People working at each apparatus on `day` (ISO date), by the Staffing screen's rules (app.js dayRows,
    dashboard.js summarize): seat by seat, the owner unless off, plus whoever covers the seat."""
    by = {s["pos"]: s for s in seats}
    d = dt.date.fromisoformat(day)
    def active(c):
        return c["start"] <= day and (not c["end"] or c["end"] >= day)
    covers = sorted((c for c in recs["covers"] if active(c)), key=lambda c: c["createdAt"], reverse=True)
    def acting(key):
        return next((c for c in covers if c["coverKey"] == key and not c["move"]), None)
    def moved(key):
        return next((c for c in covers if c["coverKey"] == key and c["move"]), None)
    def status(key):
        hits = [s for s in recs["statuses"] if s["pos"] == key and s["start"] <= day and (not s["end"] or s["end"] >= day)]
        return max(hits, key=lambda s: s["createdAt"])["code"] if hits else None
    def tour(p):
        ch = [c for c in recs["tourChanges"] if c["pos"] == p["pos"] and c["effective"] <= day]
        return max(ch, key=lambda c: (c["effective"], c["createdAt"]))["tour"] if ch else p["tour"]
    count = {}
    for p in seats:
        t = tour(p)
        if not works(t, d):
            continue
        co = p["company"] or ALIASES.get(p["title"], p["title"])
        if p.get("swing") and t == p["tour"]:
            co = next((s["co"] for s in p["swing"] if s["watch"] == watch(d)), co)
        mv = next((c for c in covers if c["move"] and c["targetPos"] == p["pos"]), None)
        out = moved(p["pos"]) if p["name"] else None
        owner = mv["coverKey"] if mv else p["pos"] if p["name"] and not (out and out["targetPos"] != p["pos"]) else None
        covs = [c for c in covers if c["targetPos"] == p["pos"] and not c["move"] and acting(c["coverKey"]) is c]
        away = acting(owner) if owner else None
        st = status(owner) if owner else None
        cov = next((c for c in covs if c["kind"] not in ("shadow", "extra")), None) or ((st or away or not owner) and covs[0] if covs else None)
        n = 1 if owner and not (st or away or cov) else 0
        n += sum(1 for c in covs if not status(c["coverKey"]))
        count[co] = count.get(co, 0) + n
    return count


def spread(n, start):
    """n distinct tours spread evenly over 1..31, starting at `start`."""
    return [(start + round(i * 31 / n)) % 31 + 1 for i in range(n)]


def rotation(tour, cos, roles):
    return [{"co": cos[i % len(cos)], "role": roles[i % len(roles)], "watch": w} for i, w in enumerate(watches(tour))]


def retour(s, tour):
    """Move seat s to another tour: its position number and swing rotation follow."""
    s["tour"], s["pos"] = tour, f"{s['_code'][0]}{s['_code'][1]}{tour:02d}M"
    if s.get("_rot"):
        s["swing"] = rotation(tour, *s["_rot"])


OFFICERS = ("Captain", "Lieutenant")
CHIEFS = ("Battalion Chief", "ISS", "Rescue Captain")
GAP_OFFSETS = (9, 19, 29, 30)  # watches tours t, t+1, t+2 all have off (no two of them ever share a watch)


def gap_watches(start):
    return {(start - 1 + g) % 31 + 1 for g in GAP_OFFSETS}


def fit_swings(starts, swing_tours):
    """Match each swing's watches to a company whose own officers are off that watch, each company-watch used once.
    starts: {company: first of its 3 officer tours}. Returns ({(swing index, watch): company}, matched count)."""
    slots = {}
    for co, st in starts.items():
        for w in sorted(gap_watches(st)):
            slots.setdefault(w, []).append(co)
    owner = {}
    def place(key, w, seen):
        for co in slots.get(w, []):
            if (co, w) in seen:
                continue
            seen.add((co, w))
            if (co, w) not in owner or place(owner[(co, w)], w, seen):
                owner[(co, w)] = key
                return True
        return False
    n = sum(1 for k, tour in enumerate(swing_tours) for w in watches(tour) if place((k, w), w, set()))
    return {key: co for (co, w), key in owner.items()}, n


def plan_officers(cos, n_swings):
    """Officer tours for each company (3 consecutive) and Lt swing tours, so every swing watch lands on a company whose
    officers are off: one officer per company per day. Deterministic search."""
    rng = random.Random(SEED)
    starts = {co: rng.randint(1, 31) for co in cos}
    sw = [rng.randint(1, 31) for _ in range(n_swings)]
    best = fit_swings(starts, sw)[1]
    while best < 9 * n_swings:
        if rng.random() < 0.5:
            co = rng.choice(cos)
            old, starts[co] = starts[co], rng.randint(1, 31)
            got = fit_swings(starts, sw)[1]
            if got >= best:
                best = got
            else:
                starts[co] = old
        else:
            k = rng.randrange(n_swings)
            old, sw[k] = sw[k], rng.randint(1, 31)
            got = fit_swings(starts, sw)[1]
            if got >= best:
                best = got
            else:
                sw[k] = old
    return starts, sw, fit_swings(starts, sw)[0]


def run(start, n):
    return [(start - 1 + k) % 31 + 1 for k in range(n)]


def free_bc(w, b02):
    """Battalions with no chief of their own on watch w (B01 chiefs on tours 1-3)."""
    return [co for co, tours in (("B02", b02), ("B01", (1, 2, 3))) if not any((w - x) % 31 in OFFSETS for x in tours)]


def plan_chiefs():
    """ISS tours, B02 chief tours, BC swing tour and rescue captain tours, chosen so the days some chief post is empty are
    spread out rather than stacked on the same watches. Exhaustive over a small space, so deterministic."""
    best = None
    for i in range(1, 32):
        for b in range(1, 32):
            b02 = run(b, 2)
            bts = [x for x in range(1, 32) if x not in b02 and all(free_bc(w, b02) for w in watches(x))]
            for bt in bts:
                for r in range(1, 32):
                    miss = []
                    for w in range(1, 32):
                        on = lambda tours: any((w - x) % 31 in OFFSETS for x in tours)
                        sw = w in watches(bt)
                        b01 = on((1, 2, 3)) or (sw and free_bc(w, b02)[0] == "B01")
                        b2 = on(b02) or (sw and free_bc(w, b02)[0] == "B02")
                        miss.append((not b01) + (not on(run(i, 3))) + (not b2) + (not on(run(r, 2))))
                    key = (max(miss), sum(x * x for x in miss), i, b, bt, r)
                    if best is None or key < best:
                        best = key
    _, _, i, b, bt, r = best
    return run(i, 3), run(b, 2), bt, run(r, 2)


def seat(station, typ, tour, title, hclass, rank, company, **more):
    return dict({"pos": f"{station}{typ}{tour:02d}M", "title": title, "hclass": hclass, "rank": rank, "company": company,
                 "swingType": None, "tour": tour, "name": None, "status": "Owned", "_code": (station, typ)}, **more)


def build_seats():
    seats = []
    ff_roles = ["EMT", "DR", "FF"]
    companies = [(co, co[1:], ENGINE) for co in B01 + B02] + [("T03", "03", TRUCK), ("T08", "08", TRUCK), ("RS1", "01", SQUAD)]
    starts, lt_tours, lt_at = plan_officers([c[0] for c in companies], 5)

    def apparatus(co, station, spec, swing=(), start=0):
        """Officers on tours start, start+1, start+2; everyone else and the FF swings spread over the other tours.
        swing: (type, rank, title, hclass, roles, companies) seats that rotate."""
        officer_tours = [(start - 1 + k) % 31 + 1 for k in range(3)] if start else []
        rest = [x for x in range(1, 32) if x not in officer_tours]
        rows = [(t, r, ti, h, None, None) for t, r, ti, h, n in spec for _ in range(n)] + list(swing)
        others = [r for r in rows if r[1] not in OFFICERS]
        picks = [rest[round(i * len(rest) / len(others))] for i in range(len(others))]
        tours = iter(officer_tours)
        others_t = iter(picks)
        for typ, rank, title, hcl, roles, cos in rows:
            tour = next(tours) if rank in OFFICERS else next(others_t)
            s = seat(station, typ, tour, f"{title} {co}", hcl, rank, co)
            if roles:
                s["title"] = f"{title} Swing {co}" if "SSwing" not in title else f"{title.replace(' SSwing', '')} SSwing {co}"
                s["swingType"] = "SSwing" if "SSwing" in title else "Swing"
                s["_rot"] = (cos, roles)
                s["swing"] = rotation(tour, cos, roles)
            seats.append(s)

    for co, st, spec in companies:
        sw = []
        if spec is ENGINE:
            sw.append(("ETX", "Firefighter", "FF", "H2", ff_roles, [co]))
        if co == "E06":
            sw.append(("ETA", "FF/Paramedic", "FF/PM", "H3", ["EMTP"], B02))
        if co == "E10":
            sw.append(("ENX", "Firefighter", "FF SSwing", "H2", ff_roles, B02))
        if spec is TRUCK:
            sw.append(("TTX", "Firefighter", "FF", "H2", ["DR", "EMT", "FF", "TLR"], [co]))
        if spec is SQUAD:
            sw.append(("STX", "Firefighter", "FF", "H2", ff_roles, ["RS1"]))
        apparatus(co, st, spec, sw, start=starts[co])
    apparatus("MA1", "09", MEDIC)
    # Lieutenant swings: on each of their watches they cover a company whose own officers are off.
    for k, tour in enumerate(lt_tours):
        rot = [{"co": lt_at[(k, w)], "role": "OFF", "watch": w} for w in watches(tour)]
        home = max(sorted({r["co"] for r in rot}), key=lambda c: sum(r["co"] == c for r in rot))
        station = home[1:] if home[0] in "ET" else "01"
        seats.append(seat(station, "ETL" if home[0] == "E" else "TTL" if home[0] == "T" else "STL", tour, f"Lt. Swing {home}",
                          "H20", "Lieutenant", home, swingType="Swing", swing=rot))
    # Battalion chiefs, ISS and rescue captains on consecutive tours (never two on one post on one day); the BC swing
    # fills days with no chief. Their days off are staggered (plan_chiefs).
    iss, b02, bt, rc = plan_chiefs()
    for k in range(3):
        seats.append(seat("01", "BO2", 1 + k, "BC B01", "H40", "Battalion Chief", "B01"))
        seats.append(seat("01", "BO0", iss[k], "ISS B01", "H10", "ISS", "B01"))
    for tour in b02:
        seats.append(seat("06", "BO2", tour, "BC B02", "H40", "Battalion Chief", "B02"))
    seats.append(seat("06", "BT2", bt, "BC Swing B02", "H40", "Battalion Chief", "B02", swingType="Swing",
                      swing=[{"co": free_bc(w, b02)[0], "role": "BC", "watch": w} for w in watches(bt)]))
    for tour in rc:
        seats.append(seat("01", "ROR", tour, "Rescue Captain 1", "H33", "Rescue Captain", None))
    return seats


def most_per_post(seats, recs, day):
    """The most officers (per company) or chiefs (per battalion, ISS, rescue captain) working one post on `day`."""
    groups = [[s for s in seats if s["rank"] in OFFICERS]] + [[s for s in seats if s["rank"] == r] for r in CHIEFS]
    return max(max(on_duty(g, recs, day).values(), default=0) for g in groups)


# Required staffing: short by SHORT_MIN..SHORT_MAX of Required on every day from AS_OF to FIT_END, as the Staffing
# screen counts it (Open = sum over apparatus of required minus working, where short).
SHORT_MIN, SHORT_MAX, FIT_END = 0.10, 0.15, "2027-06-30"
REQUIRED_RANGE = {"E": (3, 5), "T": (4, 6), "RS1": (3, 5), "MA1": (1, 1), "B01": (2, 2), "B02": (1, 1), "RC1": (1, 1)}


def fit_days():
    days, d = [], dt.date.fromisoformat(AS_OF)
    while d.isoformat() <= FIT_END:
        days.append(d.isoformat())
        d += dt.timedelta(days=1)
    return days


def fit_staffing(seats, recs, rng):
    """Spread the tours of seats no record mentions so each day's staffing is about as short as the next, and pick each
    apparatus's required number; returns {apparatus: required}. Seats named in records keep their tours (and numbers)."""
    days = fit_days()
    text = json.dumps(recs)
    # Seats that keep their tours: named in a record, swings with a fixed rotation, and officers and chiefs (one per
    # post per day, see plan_officers / plan_chiefs). Only unrecorded, named FF and FF/PM seats move.
    free = [s for s in seats if s["pos"] not in text and s["name"] and s.get("_code") and s["rank"] not in OFFICERS + CHIEFS
            and (not s.get("swing") or s.get("_rot"))]
    frozen = [s for s in seats if s not in free]
    base = {day: on_duty(frozen, recs, day) for day in days}  # frozen seats with every record applied
    wk = {day: watch(dt.date.fromisoformat(day)) for day in days}
    cos = [co for dv in ORGANIZATION for bt in dv["battalions"] for co in bt["apparatus"]]
    def rng_of(co):
        return REQUIRED_RANGE.get(co) or REQUIRED_RANGE[co[0]]
    def contrib(s, sign, table):  # a free seat adds 1 at its company on each watch its tour works
        for w in watches(s["tour"]):
            co = next((x["co"] for x in s.get("swing") or [] if x["watch"] == w), s["company"])
            table[w][co] = table[w].get(co, 0) + sign
    free_w = {w: {} for w in range(1, 32)}
    for s in free:
        contrib(s, 1, free_w)
    def score(req):
        total, out = sum(req.values()), 0.0
        for day in days:
            b, f = base[day], free_w[wk[day]]
            short = sum(max(0, req[co] - b.get(co, 0) - f.get(co, 0)) for co in cos) / total
            out += (short - (SHORT_MIN + SHORT_MAX) / 2) ** 2 + (1 if short < SHORT_MIN or short > SHORT_MAX else 0)
        return out
    # Pass 1: even out the head count per watch, overall and per apparatus (frozen seats averaged per watch).
    fixed = {w: {} for w in range(1, 32)}
    nday = {w: 0 for w in range(1, 32)}
    for day in days:
        nday[wk[day]] += 1
        for co, k in base[day].items():
            fixed[wk[day]][co] = fixed[wk[day]].get(co, 0) + k
    fixed = {w: {co: k / max(1, nday[w]) for co, k in v.items()} for w, v in fixed.items()}
    def lumpy():
        per = [{co: fixed[w].get(co, 0) + free_w[w].get(co, 0) for co in cos} for w in range(1, 32)]
        tot = [sum(x.values()) for x in per]
        out = 3 * sum((x - sum(tot) / 31) ** 2 for x in tot)
        for co in cos:
            col = [x[co] for x in per]
            out += 0.5 * sum((x - sum(col) / 31) ** 2 for x in col)
        return out
    used = {s["pos"] for s in seats}
    def try_tour(s, tour, judge, cur):
        """Move s to `tour` if that scores no worse than cur + allowance; returns the new score or None."""
        if f"{s['_code'][0]}{s['_code'][1]}{tour:02d}M" in used:
            return None
        old = s["tour"]
        contrib(s, -1, free_w)
        used.discard(s["pos"])
        retour(s, tour)
        contrib(s, 1, free_w)
        new = judge()
        if new <= cur:
            used.add(s["pos"])
            return new
        contrib(s, -1, free_w)
        retour(s, old)
        contrib(s, 1, free_w)
        used.add(s["pos"])
        return None
    cur = lumpy()
    for _ in range(15000):
        got = try_tour(rng.choice(free), rng.randint(1, 31), lumpy, cur)
        if got is not None:
            cur = got
    # Pass 2: required per apparatus and finer tour moves, scored day by day with the records applied.
    req = {co: max(rng_of(co)[0], min(rng_of(co)[1], round(sum(base[day].get(co, 0) + free_w[wk[day]].get(co, 0) for day in days) / len(days))))
           for co in cos}
    best = score(req)
    steps = 100000
    for step in range(steps):
        slack = 1 * max(0.0, 1 - 1.5 * step / steps)  # accept a slightly worse layout early on, to get out of dead ends
        if rng.random() < 0.15:
            co = rng.choice(cos)
            lo, hi = rng_of(co)
            old = req[co]
            req[co] = min(hi, max(lo, old + rng.choice((-1, 1))))
            new = score(req)
            if new <= best + slack * rng.random():
                best = new
            else:
                req[co] = old
            continue
        # Swap the tours of two seats: the head count per watch stays as even as pass 1 left it.
        s1, s2 = rng.sample(free, 2)
        t1, t2 = s1["tour"], s2["tour"]
        c1, c2 = f"{s1['_code'][0]}{s1['_code'][1]}{t2:02d}M", f"{s2['_code'][0]}{s2['_code'][1]}{t1:02d}M"
        if t1 == t2 or c1 in used or c2 in used:
            continue
        for s, tour in ((s1, t2), (s2, t1)):
            contrib(s, -1, free_w); used.discard(s["pos"]); retour(s, tour); used.add(s["pos"]); contrib(s, 1, free_w)
        new = score(req)
        if new <= best + slack * rng.random():
            best = new
        else:
            for s, tour in ((s1, t1), (s2, t2)):
                contrib(s, -1, free_w); used.discard(s["pos"]); retour(s, tour); used.add(s["pos"]); contrib(s, 1, free_w)
    shorts = []
    for day in days:
        n = on_duty(seats, recs, day)
        shorts.append(sum(max(0, req[co] - n.get(co, 0)) for co in cos) / sum(req.values()))
    print(f"required {sum(req.values())}; short {min(shorts):.1%} to {max(shorts):.1%} (mean {sum(shorts) / len(shorts):.1%}) "
          f"over {days[0]}..{days[-1]}")
    return req


def main():
    rng = random.Random(SEED)
    seats = build_seats()
    assert len({s["pos"] for s in seats}) == len(seats), "duplicate seat code"
    names = [f"{s},{i}" for s in SURNAMES for i in INITIALS]
    rng.shuffle(names)
    names = iter(names)

    # Vacant seats (no name): firefighter and paramedic seats, never swings.
    plain = [s for s in seats if not s.get("swing") and s["rank"] in ("Firefighter", "FF/Paramedic")]
    vacant = rng.sample(plain, 9)
    for s in seats:
        if s in vacant:
            s["status"] = "Vacant"
        else:
            s["name"] = next(names)
    # Spot open for bid: the holder still works it while it's up for bid.
    for s in rng.sample([s for s in seats if s["name"] and s["rank"] in ("Lieutenant", "Firefighter") and not s.get("swing")], 2):
        s["status"], s["open"] = "Vacant", True

    ids = {}
    for n, s in enumerate((s for s in seats if s["name"]), 1):
        s["_id"] = f"DM{n:04d}"
        ids[s["pos"]] = {"id": s["_id"], "name": s["name"], "source": "Demo (fictional)"}

    by = {s["pos"]: s for s in seats}
    named = [s for s in seats if s["name"] and not s.get("swing") and not s.get("open")]
    def pick(rank, k=1):
        got = rng.sample([s for s in named if s["rank"] == rank and s["pos"] not in used], k)
        used.update(s["pos"] for s in got)
        return got
    used = set()
    n = 0
    def rid(prefix):
        nonlocal n
        n += 1
        return f"{prefix}{n:03d}"
    def created(day):
        return f"{day}T15:{n % 60:02d}:00.000Z"

    statuses = []
    def status(seat, code, start, end, note):
        statuses.append({"id": rid("st"), "pos": seat["pos"], "code": code, "start": start, "end": end, "note": note, "createdAt": created(start)})
    ff = pick("Firefighter", 8)
    status(ff[0], "VA", "2026-10-12", "2026-10-25", "Vacation")
    status(ff[1], "VA", "2026-11-02", "2026-11-15", "")
    status(pick("Lieutenant")[0], "VA", "2026-12-20", "2027-01-05", "Holidays")
    status(ff[2], "S", "2026-10-18", "2026-10-22", "")
    status(pick("FF/Paramedic")[0], "S", "2026-11-05", "2026-11-08", "")
    capt_d = pick("Captain")[0]
    status(capt_d, "D", "2026-09-01", None, "Shoulder injury")
    status(ff[3], "D", "2026-10-01", "2026-12-31", "")
    lt_we = pick("Lieutenant")[0]
    status(lt_we, "WE", "2026-08-01", None, "Training division")
    status(ff[4], "WE", "2026-10-15", "2027-02-28", "Fire prevention detail")

    tour_changes = [{"id": rid("tc"), "pos": ff[5]["pos"], "tour": (ff[5]["tour"] + 10) % 31 + 1, "effective": "2026-11-01",
                     "note": "Mutual swap", "createdAt": created("2026-10-10")}]

    covers = []
    def cover(who_pos, who_name, target, start, end, kind, note, move=False):
        c = {"id": rid("cv"), "coverKey": who_pos, "coverName": who_name, "targetPos": target["pos"], "start": start, "end": end,
             "kind": kind, "move": move, "note": note, "createdAt": created(start)}
        covers.append(c)
        return c
    lt_act = pick("Lieutenant")[0]
    cover(lt_act["pos"], lt_act["name"], capt_d, "2026-09-01", None, "acting", f"Acting Captain while {capt_d['name']} is off")
    lt_cov = pick("Lieutenant")[0]
    cover(lt_cov["pos"], lt_cov["name"], lt_we, "2026-08-01", None, "cover", f"{lt_we['name']} working elsewhere")
    ff_sh = pick("Firefighter")[0]
    # The shadow fills the seat of the lieutenant acting as captain, so no post has two officers.
    cover(ff_sh["pos"], ff_sh["name"], lt_act, "2026-10-01", None, "shadow", "VR20 relief")
    ff_x = pick("Firefighter", 2)
    cover(ff_x[0]["pos"], ff_x[0]["name"], ff_x[1], "2026-10-05", "2026-12-31", "extra", "Second firefighter, training")

    # An added person (relief, not on the vacancy list) covering a vacant seat.
    open_seats = list(vacant)
    people = [{"id": "p001", "name": next(names), "rank": "Firefighter", "company": None, "tour": None, "emplId": "DM0900",
               "note": "Relief", "createdAt": created("2026-09-15")}]
    cover("person:p001", people[0]["name"], open_seats.pop(0), "2026-09-15", None, "cover", "Relief, long-term")

    # Two moves from assignment-change notices, each logged in `assignments`.
    assignments = []
    for k, (rank, first, last) in enumerate([("Firefighter", "2026-06-16", "2026-06-12"), ("FF/Paramedic", "2026-08-03", "2026-07-30")]):
        who = pick(rank)[0]
        to = next(s for s in open_seats if s["rank"] == rank)
        open_seats.remove(to)
        first = first_shift(to["tour"], first)
        c = cover(who["pos"], who["name"], to, first, None, "cover", f"Assignment change (demo notice 26 A-0{50 + k})", move=True)
        assignments.append({"id": rid("as"), "key": who["pos"], "emplId": ids[who["pos"]]["id"], "name": who["name"],
                            "firstReg": first, "lastReg": last, "fromPos": who["pos"], "fromStation": who["company"],
                            "toPos": to["pos"], "toStation": to["company"], "toTour": to["tour"], "rankFrom": rank, "rankTo": rank,
                            "source": f"Assignment change notice 26 A-0{50 + k} (demo)", "note": "", "recordId": c["id"],
                            "createdAt": created(first)})
    # Two 2027 moves (awards): the seat they own changes from the first shift of the new tour on or after Jan 16, 2027.
    for rank in ("Firefighter", "Firefighter"):
        who = pick(rank)[0]
        to = next(s for s in open_seats if s["rank"] == rank)
        open_seats.remove(to)
        cover(who["pos"], who["name"], to, first_shift(to["tour"], "2027-01-16"), None, "cover", "2027 award (demo)", move=True)

    snapshot = {"asOf": AS_OF, "records": {"statuses": statuses, "tourChanges": tour_changes, "covers": covers, "people": people,
                                           "staffing": [], "assignments": assignments}}
    required = fit_staffing(seats, snapshot["records"], rng)
    most = max(most_per_post(seats, snapshot["records"], day) for day in fit_days())
    print("most officers or chiefs on one post on one day:", most)
    assert most <= 1, "two officers or chiefs on one post on the same day"
    ids = {s["pos"]: {"id": s["_id"], "name": s["name"], "source": "Demo (fictional)"} for s in seats if s["name"]}
    # The report's day: its overtime hires make up the difference, so "Working but not in the tool" comes out at 0.
    overtime = max(0, sum(required.values()) - sum(on_duty(seats, snapshot["records"], AS_OF).values()))
    staffing = {"asOf": AS_OF, "source": "Demo (fictional)", "overtimeHires": overtime,
                "apparatus": {k: {"reportWorking": v, "required": v} for k, v in sorted(required.items())}}

    def write(rel, obj):
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(obj, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote", rel)
    seats.sort(key=lambda s: s["pos"])
    for s in seats:
        for k in [k for k in s if k.startswith("_")]:
            del s[k]
    write("data/positions.json", seats)
    write("data/employee-ids.json", {"source": "Demo (fictional IDs)", "ids": dict(sorted(ids.items()))})
    write("data/required-staffing.json", staffing)
    write("data/vacancy-awards-2027.json", {"source": "Demo (no awards)", "reportDate": AS_OF, "awards": []})
    write("data/organization.json", ORGANIZATION)
    write("demo/records.json", snapshot)
    ranks = {}
    for s in seats:
        ranks[s["rank"]] = ranks.get(s["rank"], 0) + 1
    print(len(seats), "seats,", sum(1 for s in seats if s["name"]), "named,", sum(1 for s in seats if s.get("swing")), "swing;", ranks)


if __name__ == "__main__":
    main()
