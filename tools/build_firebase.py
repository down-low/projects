#!/usr/bin/env python3
"""Build the Firebase Hosting folder (firebase/public/) from the app files.

Usage: python3 tools/build_firebase.py [out_dir]   (default: firebase/public)

Hosting is public, so only the static app goes there: no roster, Employee IDs, awards or PDFs (those are in Cloud
Storage, readable by approved accounts, uploaded by .github/workflows/firebase.yml). index.html gets the Firebase SDK
from Hosting's reserved /__/firebase/ URLs, which also configure it for the project, and FIREBASE_HOSTED, which makes
store.js use the Firebase adapter.
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDK = "10.14.1"  # Firebase JS SDK (compat) served by Hosting
APP_FILES = ["index.html", "style.css", "schedule.js", "organization.js", "store.js", "admin.js", "dashboard.js",
             "trades.js", "awards.js", "corrections.js", "fir.js", "card.js", "app.js"]
ICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#b3261e"/>
<text x="32" y="42" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">TS</text></svg>
"""  # placeholder until there is a department-approved icon
MANIFEST = """{
  "name": "SFFD Tour Schedule",
  "short_name": "Tours",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#b3261e",
  "icons": [{"src": "icon.svg", "sizes": "any", "type": "image/svg+xml"}]
}
"""


def sdk_tags():
    libs = ["app", "auth", "firestore", "functions"]
    tags = [f'<script src="/__/firebase/{SDK}/firebase-{lib}-compat.js"></script>' for lib in libs]
    tags += ['<script src="/__/firebase/init.js"></script>', "<script>window.FIREBASE_HOSTED = true;</script>"]
    return "\n".join(tags) + "\n"


def build(out):
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    for name in APP_FILES:
        shutil.copy(os.path.join(ROOT, name), os.path.join(out, name))
    path = os.path.join(out, "index.html")
    with open(path) as f:
        html = f.read()
    store = '<script src="store.js"></script>'
    if html.count(store) != 1:
        sys.exit("index.html: expected one store.js script tag")
    html = html.replace(store, sdk_tags() + store)
    head = "</head>"
    html = html.replace(head, '  <link rel="manifest" href="manifest.json" />\n  <link rel="icon" href="icon.svg" type="image/svg+xml" />\n'
                        '  <meta name="theme-color" content="#b3261e" />\n' + head, 1)
    with open(path, "w") as f:
        f.write(html)
    with open(os.path.join(out, "manifest.json"), "w") as f:
        f.write(MANIFEST)
    with open(os.path.join(out, "icon.svg"), "w") as f:
        f.write(ICON)
    print(f"wrote {out} ({len(os.listdir(out))} files)")


if __name__ == "__main__":
    build(os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "firebase", "public"))
