#!/usr/bin/env python3
"""Extract the 2027 Vacancy Awards (26 A-082) into data/vacancy-awards-2027.json.

Usage: python3 tools/extract_awards.py [awards.pdf] [out.json]
       (defaults: docs/vacancy-awards-26A082.pdf, data/vacancy-awards-2027.json)
Requires `pdftotext` (poppler-utils).

Each row: {pos, starred, emplId, name, hclass, from}. `from` is the awardee's current assignment (e.g. T01, CECC) and
`hclass` their current class (e.g. 20 for H 20). A position can appear twice: an unstarred row (the person the position
is awarded to on paper) and a starred row (the person who works it), as on the vacancy list. The awards screen
(awards.js) uses the starred row in that case.

Checks the number of awarded positions against the "N ... Positions Awarded" lines and exits non-zero on a mismatch.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROW = re.compile(r"(\d{1,2}[A-Z]{2,4}\d{2,3}M)(\*?)\s+([A-Z]{2}\d{4})\s+(.+?)(?:\s+H\s+(\d+)\s+(\S+))?\s*$")
TOTAL = re.compile(r"^\s*(\d+) (.+?) Positions Awarded")
DATE = re.compile(r"Date of Report: (\d\d)/(\d\d)/(\d{4})")


def main():
    args = sys.argv[1:]
    pdf = args[0] if args else os.path.join(ROOT, "docs", "vacancy-awards-26A082.pdf")
    out = args[1] if len(args) > 1 else os.path.join(ROOT, "data", "vacancy-awards-2027.json")
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    awards, totals = [], {}
    for line in text.splitlines():
        t = TOTAL.match(line)
        if t:
            totals[t.group(2)] = int(t.group(1))
            continue
        m = ROW.search(line)
        if m:
            pos, star, empl, name, hclass, frm = m.groups()
            awards.append({"pos": pos, "starred": bool(star), "emplId": empl, "name": re.sub(r"\s{2,}", " ", name.strip()),
                           "hclass": int(hclass) if hclass else None, "from": frm})
    d = DATE.search(text)
    positions = {a["pos"] for a in awards}
    expected = sum(totals.values())
    print(f"{len(awards)} rows, {len(positions)} positions awarded; report totals {expected}: " +
          ", ".join(f"{k} {v}" for k, v in totals.items()))
    if len(positions) != expected:
        sys.exit(f"Mismatch: parsed {len(positions)} awarded positions, report says {expected}")
    with open(out, "w") as f:
        json.dump({"source": "Vacancy Awards Report 26 A-082", "reportDate": d and f"{d.group(3)}-{d.group(1)}-{d.group(2)}",
                   "awards": awards}, f, indent=1)
        f.write("\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
