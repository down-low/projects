#!/usr/bin/env python3
"""Extract per-apparatus required staffing from an SFFD Daily Balance Report PDF.

Usage: python3 tools/extract_balance.py <balance_report.pdf> [out.json]   (default: data/required-staffing.json)
Requires `pdftotext` (poppler-utils).

For each apparatus the report lists the headcount working (TOTAL) and the over/under by role
(OFF, PM, FF, OTH). Required = TOTAL - (sum of over/under). The department totals are checked
against the report's "SFFD Total" line.
"""
import json
import re
import subprocess
import sys

HEADER = re.compile(r"^(DV\d+|HQFD)\b.*TOTAL")
APPARATUS = re.compile(r"^\s+(?:BT\d\d|AO)?\s+([A-Z][A-Z0-9]{1,4})\s{2,}(.*)$")


def columns(header):
    """Centre positions of each numeric column; the second OFF/PM/FF/OTH group is the over/under."""
    toks = [(m.group(), m.start(), m.end()) for m in re.finditer(r"OP OFF|OFF|AC|BC|RC|PM|FF|OTH|TOTAL", header)]
    cols, seen = [], set()
    for name, a, b in toks:
        name = "OFF" if name == "OP OFF" else name
        cols.append(("d" + name if name in seen else name, (a + b) / 2))
        seen.add(name)
    return cols


def parse(text):
    out, cols, date, totals = {}, None, None, None
    m = re.search(r"As of Date:\s*(\d{2})/(\d{2})/(\d{4})", text)
    if m:
        date = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
    for line in text.splitlines():
        if line.strip().startswith("Status"):
            break
        if HEADER.match(line):
            cols = columns(line)
            continue
        if line.startswith("SFFD Total") and cols:
            totals = values(line, 0, cols)
            continue
        m = APPARATUS.match(line)
        if not m or not cols or m.group(1).startswith("BT"):
            continue
        vals = values(line, m.start(2), cols)
        if "TOTAL" in vals:
            over = sum(vals.get(k, 0) for k in ("dOFF", "dPM", "dFF", "dOTH"))
            out[m.group(1)] = {"required": vals["TOTAL"] - over, "reportWorking": vals["TOTAL"]}
    return date, out, totals


def values(line, start, cols):
    vals = {}
    for mm in re.finditer(r"-?\d+", line[start:]):
        pos = start + (mm.start() + mm.end()) / 2
        name = min(cols, key=lambda c: abs(c[1] - pos))[0]
        vals[name] = int(mm.group())
    return vals


def main():
    pdf = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "data/required-staffing.json"
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    date, apparatus, totals = parse(text)
    req = sum(a["required"] for a in apparatus.values())
    working = sum(a["reportWorking"] for a in apparatus.values())
    print(f"report date {date}: {len(apparatus)} apparatus, required {req}, working {working}")
    ok = True
    if totals and "TOTAL" in totals:
        want_req = totals["TOTAL"] - sum(totals.get(k, 0) for k in ("dOFF", "dPM", "dFF", "dOTH"))
        ok = totals["TOTAL"] == working and want_req == req
        print(f"report totals: working {totals['TOTAL']}, required {want_req} -> {'ok' if ok else 'MISMATCH'}")
    ot = re.search(r"^\s+Total\s+(\d+)", text, re.M)
    doc = {"source": "SFFD Daily Balance Report - Day", "asOf": date, "overtimeHires": int(ot.group(1)) if ot else None,
           "apparatus": apparatus}
    with open(out_path, "w") as f:
        json.dump(doc, f, indent=1, sort_keys=True)
    print(f"wrote {out_path}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
