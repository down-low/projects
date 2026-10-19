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


def spread(n, start):
    """n distinct tours spread evenly over 1..31, starting at `start`."""
    return [(start + round(i * 31 / n)) % 31 + 1 for i in range(n)]


def build_seats():
    seats = []

    def apparatus(co, station, spec, swing=None, start=0):
        """swing: list of (type, rank, title, hclass, role, companies) seats that rotate; they take tours too."""
        rows = [(t, r, ti, h, None, None) for t, r, ti, h, n in spec for _ in range(n)] + (swing or [])
        for (typ, rank, title, hcl, role, cos), tour in zip(rows, spread(len(rows), start)):
            s = {"pos": f"{station}{typ}{tour:02d}M", "title": f"{title} {co}", "hclass": hcl, "rank": rank, "company": co,
                 "swingType": None, "tour": tour, "name": None, "status": "Owned"}
            if role:
                s["title"] = f"{title} Swing {co}" if "SSwing" not in title else f"{title.replace(' SSwing', '')} SSwing {co}"
                s["swingType"] = "SSwing" if "SSwing" in title else "Swing"
                roles = role if isinstance(role, list) else [role]
                s["swing"] = [{"co": cos[i % len(cos)], "role": roles[i % len(roles)], "watch": w} for i, w in enumerate(watches(tour))]
            seats.append(s)

    ff_roles = ["EMT", "DR", "FF"]
    lt_swing = {"E02": B01[:3], "E04": B01[2:], "E05": ["E05", "E01", "E03"], "E07": B02[:3], "E09": B02[2:], "E10": ["E10", "E06", "E08"]}
    for i, co in enumerate(B01 + B02):
        st = co[1:]
        sw = [("ETX", "Firefighter", "FF", "H2", ff_roles, [co])]
        if co in lt_swing:
            sw.append(("ETL", "Lieutenant", "Lt.", "H20", "OFF", lt_swing[co]))
        if co == "E06":
            sw.append(("ETA", "FF/Paramedic", "FF/PM", "H3", "EMTP", B02))
        if co == "E10":
            sw.append(("ENX", "Firefighter", "FF SSwing", "H2", ff_roles, B02))
        apparatus(co, st, ENGINE, sw, start=i * 3)
    apparatus("T03", "03", TRUCK, [("TTX", "Firefighter", "FF", "H2", ["DR", "EMT", "FF", "TLR"], ["T03"])], start=5)
    apparatus("T08", "08", TRUCK, [("TTX", "Firefighter", "FF", "H2", ["DR", "EMT", "FF", "TLR"], ["T08"])], start=20)
    apparatus("RS1", "01", SQUAD, [("STX", "Firefighter", "FF", "H2", ff_roles, ["RS1"])], start=9)
    apparatus("MA1", "09", MEDIC, start=12)
    # Battalion chiefs, ISS and rescue captains: one seat a tour on a few tours.
    for tour in (1, 2, 3):
        seats.append({"pos": f"01BO2{tour:02d}M", "title": "BC B01", "hclass": "H40", "rank": "Battalion Chief", "company": "B01",
                      "swingType": None, "tour": tour, "name": None, "status": "Owned"})
        seats.append({"pos": f"01BO0{tour:02d}M", "title": "ISS B01", "hclass": "H10", "rank": "ISS", "company": "B01",
                      "swingType": None, "tour": tour, "name": None, "status": "Owned"})
    for tour in (5, 6):
        seats.append({"pos": f"06BO2{tour:02d}M", "title": "BC B02", "hclass": "H40", "rank": "Battalion Chief", "company": "B02",
                      "swingType": None, "tour": tour, "name": None, "status": "Owned"})
    seats.append({"pos": "06BT204M", "title": "BC Swing B02", "hclass": "H40", "rank": "Battalion Chief", "company": "B02",
                  "swingType": "Swing", "tour": 4, "name": None, "status": "Owned",
                  "swing": [{"co": "B02" if i % 2 == 0 else "B01", "role": "BC", "watch": w} for i, w in enumerate(watches(4))]})
    for tour in (1, 2):
        seats.append({"pos": f"01ROR{tour:02d}M", "title": "Rescue Captain 1", "hclass": "H33", "rank": "Rescue Captain", "company": None,
                      "swingType": None, "tour": tour, "name": None, "status": "Owned"})
    return seats


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
        ids[s["pos"]] = {"id": f"DM{n:04d}", "name": s["name"], "source": "Demo (fictional)"}

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
    cover(ff_sh["pos"], ff_sh["name"], pick("Lieutenant")[0], "2026-10-01", None, "shadow", "VR20 relief")
    capt_x = pick("Captain", 2)
    cover(capt_x[0]["pos"], capt_x[0]["name"], capt_x[1], "2026-10-05", "2026-12-31", "extra", "Second captain, training")

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
    required = {}
    for co in B01 + B02:
        required[co] = 4
    required.update({"T03": 5, "T08": 5, "RS1": 4, "MA1": 1, "B01": 2, "B02": 1, "RC1": 1})
    staffing = {"asOf": AS_OF, "source": "Demo (fictional)", "overtimeHires": 7,
                "apparatus": {k: {"reportWorking": v, "required": v} for k, v in sorted(required.items())}}

    def write(rel, obj):
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(obj, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote", rel)
    seats.sort(key=lambda s: s["pos"])
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
