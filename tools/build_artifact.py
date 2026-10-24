#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file (data inlined) for sharing.

Usage: python3 tools/build_artifact.py [out.html]   (default: dist/tour-schedule.html)
       python3 tools/build_artifact.py --capabilities   (the page-database rules to publish with)
       python3 tools/build_artifact.py out.html --frozen https://ADMIN-SITE   (cut-over, CUTOVER.md: read-only page that
         points to the Firebase sites; publish it with `--capabilities --frozen`, every write raised to the owner)
       python3 tools/build_artifact.py out.html --snapshot records.json [--demo demo.json]
         (view-only page; --demo adds clickable sample trades that are never saved, see tools/demo_trades.js)
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, name)) as f:
        return f.read()


# Page-database rules for the published page (pass as the Artifact's `db` capability; `--capabilities` prints the set).
# Schedule records stay editor-only. Members (Contributor access) write trades and responses, and only their own
# "this is me" record; editors can undo anyone's.
CAPABILITIES = {
    "db": {"rules": [
        {"path": "statuses", "read": "view", "write": "admin"},
        {"path": "tourChanges", "read": "view", "write": "admin"},
        {"path": "covers", "read": "view", "write": "admin"},
        {"path": "people", "read": "view", "write": "admin"},
        {"path": "staffing", "read": "view", "write": "admin"},
        {"path": "profiles", "read": "admin", "write": "admin"},
        {"path": "assignments", "read": "view", "write": "admin"},  # move log from assignment-change notices
        {"path": "contacts", "read": "admin", "write": "admin"},  # cell numbers from the staff list
        {"path": "members", "read": "view", "write": "admin"},
        {"path": "members/{self}", "write": "interact"},
        {"path": "trades", "read": "view", "write": "interact"},
        {"path": "tradeReplies", "read": "view", "write": "interact"},
        # Corrections: each member writes and reads only their own record; admins read and update all.
        {"path": "corrections", "read": "admin", "write": "admin"},
        {"path": "corrections/{self}", "read": "interact", "write": "interact"},
        # Feedback about the app: the same shape as corrections.
        {"path": "feedback", "read": "admin", "write": "admin"},
        {"path": "feedback/{self}", "read": "interact", "write": "interact"},
        # Overtime days: everyone reads the marks; each member writes their own, admins anyone's. Notes are private.
        {"path": "overtime", "read": "view", "write": "admin"},
        {"path": "overtime/{self}", "write": "interact"},
        {"path": "overtimeNotes", "read": "admin", "write": "admin"},
        {"path": "overtimeNotes/{self}", "read": "interact", "write": "interact"},
        # Employee card: a roster seat's name, rank or Employee ID over the files. Everyone reads (IDs are on the page
        # anyway); only admins write.
        {"path": "rosterOverrides", "read": "view", "write": "admin"},
    ]},
    "user": {},
    "downloads": True,  # Employee cards, Download backup (admins): the one-time move to Firebase
}


def frozen_capabilities():
    """After cut-over the page database is a read-only copy: no page-level write below the owner."""
    caps = json.loads(json.dumps(CAPABILITIES))
    for rule in caps["db"]["rules"]:
        if "write" in rule:
            rule["write"] = "owner"
    return caps


def fold_trades(records):
    """Snapshots don't show trades; a set trade's cover and TR records (kept on the trade) join the schedule instead."""
    for t in records.pop("trades", None) or []:
        if t.get("status") != "set":
            continue
        for i, leg in enumerate(t.get("legs") or []):
            rec = {k: v for k, v in leg.items() if k != "kind"}
            rec.update({"id": f"trade:{t.get('id')}:{i}", "tradeId": t.get("id"), "createdAt": t.get("setAt") or t.get("createdAt")})
            records.setdefault(leg.get("kind"), []).append(rec)
    # Private records never go into a view-only page (cell numbers, corrections, personal dates).
    for k in ("tradeReplies", "members", "contacts", "corrections", "feedback", "overtime", "overtimeNotes", "profiles"):
        records.pop(k, None)


MAIN_URL = "https://claude.ai/artifact/TS7W51mXHxgy7p2uvReSgC"  # the shared page (page database)
DEMO_URL = "https://claude.ai/artifact/37DsLLYz74Kjysbd84cTXV"  # the view-only snapshot with the trade demo


def main():
    # build_artifact.py [out.html] [--snapshot records.json] [--page-url https://claude.ai/artifact/...]
    # --snapshot bakes page records ({"asOf": "YYYY-MM-DD", "records": {statuses, tourChanges, covers, people, staffing}})
    # into a view-only page that needs no sign-in and no page database.
    args = sys.argv[1:]
    if "--capabilities" in args:
        print(json.dumps(frozen_capabilities() if "--frozen" in args else CAPABILITIES))
        return
    frozen = None
    if "--frozen" in args:  # the address admins use after cut-over
        i = args.index("--frozen")
        frozen = args[i + 1]
        if not frozen.startswith("https://"):
            sys.exit("--frozen needs the new address, e.g. https://PROJECT-admin.web.app")
        del args[i:i + 2]
    page_url = None
    if "--page-url" in args:  # the page's own claude.ai link, put in trade invite texts
        i = args.index("--page-url")
        page_url = args[i + 1]
        del args[i:i + 2]
    snapshot = None
    if "--snapshot" in args:
        i = args.index("--snapshot")
        snapshot = json.load(open(args[i + 1]))
        fold_trades(snapshot.setdefault("records", {}))
        del args[i:i + 2]
    demo = None
    if "--demo" in args:  # trade demo for a snapshot: {"people": [keys], "trades": [...], "tradeReplies": [...]}
        i = args.index("--demo")
        demo = json.load(open(args[i + 1]))
        del args[i:i + 2]
        if snapshot is None:
            sys.exit("--demo needs --snapshot")
    out = args[0] if args else os.path.join(ROOT, "dist", "tour-schedule.html")
    index = read("index.html")
    body = re.search(r"<!-- app:start -->(.*)<!-- app:end -->", index, re.S).group(1)
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)"', index).group(1)
    data = json.dumps(json.load(open(os.path.join(ROOT, "data", "positions.json"))), separators=(",", ":"))
    data = data.replace("</", "<\\/")
    required = json.dumps(json.load(open(os.path.join(ROOT, "data", "required-staffing.json"))), separators=(",", ":"))
    ids = json.dumps(json.load(open(os.path.join(ROOT, "data", "employee-ids.json"))), separators=(",", ":")).replace("</", "<\\/")
    quals = json.dumps(json.load(open(os.path.join(ROOT, "data", "seat-qualifications.json"))), separators=(",", ":")).replace("</", "<\\/")
    awards = json.dumps(json.load(open(os.path.join(ROOT, "data", "vacancy-awards-2027.json"))), separators=(",", ":")).replace("</", "<\\/")
    docs = json.dumps(json.load(open(os.path.join(ROOT, "docs", "index.json"))), separators=(",", ":")).replace("</", "<\\/")
    snap = ""
    title = "SFFD Tour Schedule (view only)" if snapshot is not None else "SFFD Tour Schedule"
    if snapshot is not None:
        snap = "window.SNAPSHOT=" + json.dumps(snapshot, separators=(",", ":")).replace("</", "<\\/") + ";"
    if demo is not None:
        snap += "window.TRADE_DEMO=" + json.dumps(demo, separators=(",", ":")).replace("</", "<\\/") + ";"
    snap += "window.PAGE_URL=" + json.dumps(page_url or (DEMO_URL if snapshot is not None else MAIN_URL)) + ";"
    banner = ""
    if frozen is not None:
        import html as htmlmod
        addr = htmlmod.escape(frozen)
        banner = (f'<div class="frozen-banner" role="status" style="width:calc(100% - 32px);max-width:1148px;margin:12px auto 0;box-sizing:border-box">'
                  f'<span><b>Moved.</b> The tour schedule is now at <a href="{addr}">{addr}</a>. This copy is frozen and read-only.</span>'
                  f'<span id="frozen-backup"></span></div>\n')
        snap += "window.PAGE_FROZEN=true;"
    html = (
        f"<title>{title}</title>\n"
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        f'<link rel="stylesheet" href="{fonts}">\n'
        f"<style>\n{read('style.css')}</style>\n"
        f"{banner}{body}\n"
        f"<script>window.POSITIONS={data};window.DOCS={docs};window.REQUIRED_STAFFING={required};window.EMPLOYEE_IDS={ids};window.AWARDS_2027={awards};window.SEAT_QUALIFICATIONS={quals};{snap}</script>\n"
        f"<script>\n{read('schedule.js')}</script>\n"
        f"<script>\n{read('organization.js')}</script>\n"
        f"<script>\n{read('store.js')}</script>\n"
        f"<script>\n{read('admin.js')}</script>\n"
        f"<script>\n{read('dashboard.js')}</script>\n"
        f"<script>\n{read('trades.js')}</script>\n"
        f"<script>\n{read('awards.js')}</script>\n"
        f"<script>\n{read('fill.js')}</script>\n"
        f"<script>\n{read('corrections.js')}</script>\n"
        f"<script>\n{read('feedback.js')}</script>\n"
        f"<script>\n{read('overtime.js')}</script>\n"
        f"<script>\n{read('myyear.js')}</script>\n"
        f"<script>\n{read('pay.js')}</script>\n"
        f"<script>\n{read('vendor/qrcode.js')}</script>\n"
        f"<script>\n{read('invite.js')}</script>\n"
        f"<script>\n{read('homescreen.js')}</script>\n"
        f"<script>\n{read('fir.js')}</script>\n"
        f"<script>\n{read('card.js')}</script>\n"
        f"<script>\n{read('app.js')}</script>\n"
    )
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
