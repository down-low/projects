#!/usr/bin/env python3
"""Extract positions from the SFFD Vacancy List PDF into data/positions.json.

Usage: python3 tools/extract_vacancy.py <vacancy_list.pdf> [out.json]
Requires `pdftotext` (poppler-utils).
"""
import json
import re
import subprocess
import sys
from collections import Counter

POS = r"\d{1,2}[A-Z]{2,4}\d{2,3}M"
ENTRY = re.compile(
    r"(?P<star>\*\s*)?(?P<title>(?<![,\w.])(?!Owned|Vacant)[A-Za-z](?:(?!Owned|Vacant)[A-Za-z0-9/.\- ])*?)\s*(?P<pos>" + POS + r")"
    r"(?:\s*(?P<name>(?!Owned|Vacant)[A-Za-z'](?:(?!Owned|Vacant|\s{3})[^*])*))?\s*(?P<status>Owned|Vacant)"
)
CONT = re.compile(r"\*(?P<name>[A-Za-z'][^*]*?)\s*(?P<status>Owned|Vacant)")
HEADER = re.compile(r"^H\s?(\d+)\s+Position")
TOTAL = re.compile(r"Total H\s?(\d+) Positions:\s+(\d+)")
SWING_HEAD = re.compile(r"^\s*(" + POS + r")\s+(.+?)\s{2,}([A-Z]{1,3}\d{1,2})\s+(?:([A-Z]{2,4})\s+)?(\d{1,2})\s*$")
SWING_ROW = re.compile(r"^\s+([A-Z]{1,3}\d{1,2})\s+(?:([A-Z]{2,4})\s+)?(\d{1,2})\s*$")

RANKS = {
    "2": "Firefighter", "3": "FF/Paramedic", "10": "ISS", "20": "Lieutenant",
    "30": "Captain", "33": "Rescue Captain", "40": "Battalion Chief",
    "110": "Marine Engineer", "120": "Pilot",
}


def clean_name(n):
    n = (n or "").strip()
    return re.sub(r"\s{2,}", " ", n) or None


def parse(text):
    positions, order = {}, []
    totals = {}
    hclass = None
    in_swing = False
    pending_wrap = None  # titles wrapped onto the next line (Marine Engineer)
    swing_cur = None
    pages = text.split("\f")
    for page in pages:
        lines = [re.sub(r"\s{2,}(Attachment A|File Code .*)$", "", l) for l in page.splitlines()]
        if any("Swing Positions - Assigned Rotations" in l for l in lines):
            in_swing = True
        if in_swing:
            for l in lines:
                m = SWING_HEAD.match(l)
                if m:
                    swing_cur = m.group(1)
                    positions[swing_cur].setdefault("swing", []).append(
                        {"co": m.group(3), "role": m.group(4), "watch": int(m.group(5))})
                    continue
                m = SWING_ROW.match(l)
                if m and swing_cur:
                    positions[swing_cur]["swing"].append(
                        {"co": m.group(1), "role": m.group(2), "watch": int(m.group(3))})
            continue

        last = {"L": None, "R": None}
        right_start = None
        for l in lines:
            h = HEADER.match(l)
            if h:
                hclass = h.group(1)
                continue
            for t in TOTAL.finditer(l):
                totals[t.group(1)] = int(t.group(2))
            matches = list(ENTRY.finditer(l))
            if len(matches) > 1:
                rs = matches[1].start("title")
                right_start = rs if right_start is None else min(right_start, rs)
            # wrapped title: "Marine Engineer of Fire35FOH01M" / "Boats  Name  Owned"
            wm = re.match(r"^\s*(?P<title>.+?)(?P<pos>" + POS + r")\s*$", l)
            if wm and not matches:
                pending_wrap = (wm.group("title").strip(), wm.group("pos"))
                continue
            if pending_wrap and not matches:
                wm2 = re.match(r"^\s*(?P<rest>\S+)\s+(?:(?P<name>\S.*?)\s+)?(?P<status>Owned|Vacant)\s*$", l)
                if wm2:
                    title = pending_wrap[0] + " " + wm2.group("rest")
                    rec = make(title, pending_wrap[1], wm2.group("name"), wm2.group("status"), False, hclass)
                    positions[rec["pos"]] = rec
                    order.append(rec["pos"])
                    pending_wrap = None
                    continue
            spans = []
            for m in matches:
                rec = make(m.group("title"), m.group("pos"), m.group("name"),
                           m.group("status"), bool(m.group("star")), hclass)
                positions[rec["pos"]] = rec
                order.append(rec["pos"])
                spans.append((m.start(), m.end()))
                col = "R" if (right_start is not None and m.start("title") >= right_start) or (len(matches) > 1 and m is matches[1]) else "L"
                last[col] = rec["pos"]
            for c in CONT.finditer(l):
                if any(s <= c.start() < e for s, e in spans):
                    continue
                col = "R" if right_start is not None and c.start() >= right_start else "L"
                tgt = last[col] or last["L"]
                positions[tgt]["starred"] = clean_name(c.group("name"))
    return [positions[p] for p in order], totals


def make(title, pos, name, status, star, hclass):
    title = re.sub(r"\s+", " ", title.strip())
    m = re.search(r"\b([A-Z]{1,3}\d{1,2})$", title)
    company = m.group(1) if m else None
    swing = "SSwing" if "SSwing" in title else ("Swing" if "Swing" in title else None)
    return {
        "pos": pos, "title": title, "hclass": "H" + hclass, "rank": RANKS.get(hclass, "H" + hclass),
        "company": company, "swingType": swing, "tour": int(pos[-3:-1]),
        "name": clean_name(name), "status": status, "star": star,
    }


def main():
    pdf = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "data/positions.json"
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    recs, totals = parse(text)
    counts = Counter(r["hclass"][1:] for r in recs)
    ok = True
    for h, n in totals.items():
        flag = "ok" if counts.get(h) == n else "MISMATCH"
        ok &= flag == "ok"
        print(f"H{h:>4}: expected {n:4d} parsed {counts.get(h, 0):4d} {flag}")
    for r in recs:
        # Per user: when a starred replacement exists, show only the starred name.
        if r.get("starred"):
            r["name"], r["status"] = r.pop("starred"), "Owned"
        r.pop("star")
        if r["status"] == "Vacant":
            r["name"] = None
        if r.get("swing"):
            r["swing"].sort(key=lambda s: s["watch"])
    with open(out, "w") as f:
        json.dump(recs, f, separators=(",", ":"))
    print(f"wrote {len(recs)} positions to {out}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
