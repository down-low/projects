#!/usr/bin/env python3
"""Build the two Firebase Hosting folders from the app files (FIREBASE_PLAN.md, "Two apps, one backend").

Usage: python3 tools/build_firebase.py [out_dir] [--app-url URL] [--admin-url URL] [--vapid-key KEY]
  out_dir defaults to firebase/; it gets public-app/ (the employee app) and public-admin/ (the back office).
  The URLs (set by the deploy workflow) let each site link to the other. --vapid-key (the Web Push key from Firebase
  Cloud Messaging) turns on app notifications for trade alerts; the app gets firebase-messaging-sw.js for them.
  It also copies schedule.js into firebase/functions/lib/, for the trade alert functions.

Hosting is public, so only the static app goes there: no roster, Employee IDs, awards or PDFs (those are in Cloud
Storage, readable by approved accounts, uploaded by .github/workflows/firebase.yml). index.html gets the Firebase SDK
from Hosting's reserved /__/firebase/ URLs, which also configure it for the project, plus FIREBASE_HOSTED (store.js
uses the Firebase adapter) and FIREBASE_SITE.
  - admin: today's full page, for editors and admins (store.js sends anyone else to the app).
  - app:   the same page without the admin screens: Employee cards and 2027 awards are stubs, and store.js gives
           everyone member access there (no edit forms, Corrections list or Admin page). Installable (manifest, icon).
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDK = "10.14.1"  # Firebase JS SDK (compat) served by Hosting
APP_FILES = ["index.html", "style.css", "schedule.js", "organization.js", "store.js", "admin.js", "dashboard.js",
             "trades.js", "awards.js", "corrections.js", "feedback.js", "vendor/qrcode.js", "invite.js", "fir.js", "card.js", "app.js"]
# Admin-only screens left out of the employee app: same entry points as the real files, no screens behind them.
STUBS = {
    "fir.js": "/* fir-db1 checks are on the admin site only. */\n",
    "card.js": "/* Employee cards are on the admin site only. */\n"
               "window.CardViews = function () { return { render: function () {}, open: function () {} }; };\n",
    "awards.js": "/* 2027 awards import is on the admin site only. */\n"
                 "window.AwardViews = function () { return { render: function () {} }; };\n",
}
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
SITES = {"app": "public-app", "admin": "public-admin"}


# App notifications (trade alerts): Firebase Cloud Messaging's service worker, at the site root.
PUSH_WORKER = f"""importScripts("/__/firebase/{SDK}/firebase-app-compat.js", "/__/firebase/{SDK}/firebase-messaging-compat.js", "/__/firebase/init.js");
firebase.messaging(); // shows each alert as a notification; tapping it opens the trade (webpush.fcmOptions.link)
"""


def sdk_tags(site, urls):
    libs = ["app", "auth", "firestore", "functions"] + (["messaging"] if site == "app" and urls.get("vapid") else [])
    tags = [f'<script src="/__/firebase/{SDK}/firebase-{lib}-compat.js"></script>' for lib in libs]
    cfg = {"FIREBASE_HOSTED": True, "FIREBASE_SITE": site, "FIREBASE_APP_URL": urls.get("app"), "FIREBASE_ADMIN_URL": urls.get("admin"),
           "FIREBASE_VAPID_KEY": urls.get("vapid") if site == "app" else None}
    js = "".join(f"window.{k} = {json.dumps(v)};" for k, v in cfg.items())
    tags += ['<script src="/__/firebase/init.js"></script>', f"<script>{js}</script>"]
    return "\n".join(tags) + "\n"


def build_site(out, site, urls):
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    for name in APP_FILES:
        if site == "app" and name in STUBS:
            with open(os.path.join(out, name), "w") as f:
                f.write(STUBS[name])
        else:
            os.makedirs(os.path.dirname(os.path.join(out, name)), exist_ok=True)  # vendor/qrcode.js
            shutil.copy(os.path.join(ROOT, name), os.path.join(out, name))
    path = os.path.join(out, "index.html")
    with open(path) as f:
        html = f.read()
    store = '<script src="store.js"></script>'
    if html.count(store) != 1:
        sys.exit("index.html: expected one store.js script tag")
    html = html.replace(store, sdk_tags(site, urls) + store)
    if site == "admin":
        html = html.replace("<title>SFFD Tour Schedule</title>", "<title>SFFD Tour Schedule · Admin</title>", 1)
        extra = '  <meta name="robots" content="noindex" />\n'
    else:
        extra = ('  <link rel="manifest" href="manifest.json" />\n  <link rel="icon" href="icon.svg" type="image/svg+xml" />\n'
                 '  <meta name="theme-color" content="#b3261e" />\n')
        with open(os.path.join(out, "manifest.json"), "w") as f:
            f.write(MANIFEST)
        with open(os.path.join(out, "icon.svg"), "w") as f:
            f.write(ICON)
        if urls.get("vapid"):
            with open(os.path.join(out, "firebase-messaging-sw.js"), "w") as f:
                f.write(PUSH_WORKER)
    html = html.replace("</head>", extra + "</head>", 1)
    with open(path, "w") as f:
        f.write(html)
    print(f"wrote {out} ({len(os.listdir(out))} files)")


def main():
    args = sys.argv[1:]
    urls = {}
    for key, flag in (("app", "--app-url"), ("admin", "--admin-url"), ("vapid", "--vapid-key")):
        if flag in args:
            i = args.index(flag)
            if args[i + 1]:
                urls[key] = args[i + 1].rstrip("/")
            del args[i:i + 2]
    base = os.path.abspath(args[0]) if args else os.path.join(ROOT, "firebase")
    for site, folder in SITES.items():
        build_site(os.path.join(base, folder), site, urls)
    lib = os.path.join(ROOT, "firebase", "functions", "lib")
    os.makedirs(lib, exist_ok=True)
    shutil.copy(os.path.join(ROOT, "schedule.js"), os.path.join(lib, "schedule.js"))


if __name__ == "__main__":
    main()
