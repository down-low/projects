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
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "tour-schedule.html")
    index = read("index.html")
    body = re.search(r"<!-- app:start -->(.*)<!-- app:end -->", index, re.S).group(1)
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)"', index).group(1)
    data = json.dumps(json.load(open(os.path.join(ROOT, "data", "positions.json"))), separators=(",", ":"))
    data = data.replace("</", "<\\/")
    required = json.dumps(json.load(open(os.path.join(ROOT, "data", "required-staffing.json"))), separators=(",", ":"))
    docs = json.dumps(json.load(open(os.path.join(ROOT, "docs", "index.json"))), separators=(",", ":")).replace("</", "<\\/")
    html = (
        "<title>SFFD Tour Schedule</title>\n"
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        f'<link rel="stylesheet" href="{fonts}">\n'
        f"<style>\n{read('style.css')}</style>\n"
        f"{body}\n"
        f"<script>window.POSITIONS={data};window.DOCS={docs};window.REQUIRED_STAFFING={required};</script>\n"
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
