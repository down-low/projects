#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file (data inlined) for sharing.

Usage: python3 tools/build_artifact.py [out.html]   (default: dist/tour-schedule.html)
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, name)) as f:
        return f.read()


def main():
    # build_artifact.py [out.html] [--snapshot records.json]
    # --snapshot bakes page records ({"asOf": "YYYY-MM-DD", "records": {statuses, tourChanges, covers, people, staffing}})
    # into a view-only page that needs no sign-in and no page database.
    args = sys.argv[1:]
    snapshot = None
    if "--snapshot" in args:
        i = args.index("--snapshot")
        snapshot = json.load(open(args[i + 1]))
        del args[i:i + 2]
    out = args[0] if args else os.path.join(ROOT, "dist", "tour-schedule.html")
    index = read("index.html")
    body = re.search(r"<!-- app:start -->(.*)<!-- app:end -->", index, re.S).group(1)
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)"', index).group(1)
    data = json.dumps(json.load(open(os.path.join(ROOT, "data", "positions.json"))), separators=(",", ":"))
    data = data.replace("</", "<\\/")
    required = json.dumps(json.load(open(os.path.join(ROOT, "data", "required-staffing.json"))), separators=(",", ":"))
    ids = json.dumps(json.load(open(os.path.join(ROOT, "data", "employee-ids.json"))), separators=(",", ":")).replace("</", "<\\/")
    docs = json.dumps(json.load(open(os.path.join(ROOT, "docs", "index.json"))), separators=(",", ":")).replace("</", "<\\/")
    snap = ""
    title = "SFFD Tour Schedule (view only)" if snapshot is not None else "SFFD Tour Schedule"
    if snapshot is not None:
        snap = "window.SNAPSHOT=" + json.dumps(snapshot, separators=(",", ":")).replace("</", "<\\/") + ";"
    html = (
        f"<title>{title}</title>\n"
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        f'<link rel="stylesheet" href="{fonts}">\n'
        f"<style>\n{read('style.css')}</style>\n"
        f"{body}\n"
        f"<script>window.POSITIONS={data};window.DOCS={docs};window.REQUIRED_STAFFING={required};window.EMPLOYEE_IDS={ids};{snap}</script>\n"
        f"<script>\n{read('schedule.js')}</script>\n"
        f"<script>\n{read('organization.js')}</script>\n"
        f"<script>\n{read('store.js')}</script>\n"
        f"<script>\n{read('admin.js')}</script>\n"
        f"<script>\n{read('dashboard.js')}</script>\n"
        f"<script>\n{read('app.js')}</script>\n"
    )
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
