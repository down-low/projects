#!/usr/bin/env python3
"""Build the two Firebase Hosting folders from the app files (FIREBASE_PLAN.md, "Two apps, one backend").

Usage: python3 tools/build_firebase.py [out_dir] [--app-url URL] [--admin-url URL] [--vapid-key KEY] [--app-id ID] [--own-auth-domain]
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
             "trades.js", "awards.js", "corrections.js", "feedback.js", "overtime.js", "myyear.js", "pay.js", "vendor/qrcode.js", "invite.js", "homescreen.js", "fir.js", "card.js", "app.js"]
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
TOUCH_ICON = os.path.join(ROOT, "tools", "apple-touch-icon.png")  # the same mark as a PNG: iPhone's Home Screen icon
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


# App notifications (trade alerts, announcements): the service worker at the site root that Firebase Cloud Messaging
# delivers to. It loads no SDK: the messaging SDK refuses to start inside some browsers' workers (Safari), and a worker
# that throws while loading is rejected, so no device could register. The page still gets the token (store.js).
PUSH_WORKER = """self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
// FCM's web payload: {notification: {title, body}, fcmOptions: {link}, data}. Always show one (Safari stops silent pushes).
self.addEventListener("push", function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = { notification: { body: e.data && e.data.text() } }; }
  var n = p.notification || {}, link = (p.fcmOptions && p.fcmOptions.link) || (p.data && p.data.link) || "/";
  e.waitUntil(self.registration.showNotification(n.title || "SFFD Tour Schedule", { body: n.body || "", icon: "/apple-touch-icon.png", data: { link: link } }));
});
// Tapping it opens the app (a trade alert opens that trade): an open app window if there is one, else a new one.
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ("navigate" in list[i]) return list[i].focus().then(function (c) { return c.navigate(link); });
    }
    return self.clients.openWindow(link);
  }));
});
"""


def sdk_tags(site, urls):
    libs = ["app", "auth", "firestore", "functions"] + (["messaging"] if site == "app" and urls.get("vapid") else [])
    tags = [f'<script src="/__/firebase/{SDK}/firebase-{lib}-compat.js"></script>' for lib in libs]
    cfg = {"FIREBASE_HOSTED": True, "FIREBASE_SITE": site, "FIREBASE_APP_URL": urls.get("app"), "FIREBASE_ADMIN_URL": urls.get("admin"),
           "FIREBASE_VAPID_KEY": urls.get("vapid") if site == "app" else None,
           # The web app's ID, for app notifications when Hosting's init.js leaves it out (no web app linked to the site).
           "FIREBASE_APP_ID": urls.get("appid") if site == "app" else None}
    js = "".join(f"window.{k} = {json.dumps(v)};" for k, v in cfg.items())
    if urls.get("ownauth"):
        # Sign-in on the site's own address (Hosting serves /__/auth/handler on every site) instead of
        # <project>.firebaseapp.com, which some phone browsers block. Needs each site's
        # https://<site>.web.app/__/auth/handler in the OAuth client's authorized redirect URIs (FIREBASE_SETUP.md).
        tags.append("<script>(function () { var init = firebase.initializeApp; firebase.initializeApp = function (o, n) {"
                    " if (n == null && o && /\\.web\\.app$/.test(location.hostname)) o = Object.assign({}, o, { authDomain: location.hostname });"
                    " return n == null ? init.call(this, o) : init.call(this, o, n); }; })();</script>")
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
        # iPhone: the Home Screen icon and full-screen launch (app notifications only work from the Home Screen there).
        extra = ('  <link rel="manifest" href="manifest.json" />\n  <link rel="icon" href="icon.svg" type="image/svg+xml" />\n'
                 '  <link rel="apple-touch-icon" href="apple-touch-icon.png" />\n'
                 '  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-title" content="Tours" />\n'
                 '  <meta name="theme-color" content="#b3261e" />\n')
        shutil.copy(TOUCH_ICON, os.path.join(out, "apple-touch-icon.png"))
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
    for key, flag in (("app", "--app-url"), ("admin", "--admin-url"), ("vapid", "--vapid-key"), ("appid", "--app-id")):
        if flag in args:
            i = args.index(flag)
            if args[i + 1]:
                urls[key] = args[i + 1].rstrip("/")
            del args[i:i + 2]
    if "--own-auth-domain" in args:
        args.remove("--own-auth-domain")
        urls["ownauth"] = True
    base = os.path.abspath(args[0]) if args else os.path.join(ROOT, "firebase")
    for site, folder in SITES.items():
        build_site(os.path.join(base, folder), site, urls)
    lib = os.path.join(ROOT, "firebase", "functions", "lib")
    os.makedirs(lib, exist_ok=True)
    shutil.copy(os.path.join(ROOT, "schedule.js"), os.path.join(lib, "schedule.js"))


if __name__ == "__main__":
    main()
