"""Firebase build checks: the public Hosting folder holds no names or data files, and the rules cover every
collection the page uses.

Run: python3 -m unittest discover -s tests
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_artifact  # noqa: E402
import build_firebase  # noqa: E402


class FirebaseBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_firebase.py"), cls.tmp.name,
                        "--app-url", "https://demo.web.app", "--admin-url", "https://demo-admin.web.app"], check=True, capture_output=True)
        cls.app = os.path.join(cls.tmp.name, "public-app")
        cls.admin = os.path.join(cls.tmp.name, "public-admin")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def read(self, folder, name):
        with open(os.path.join(folder, name), encoding="utf8") as f:
            return f.read()

    def files(self, folder):
        return sorted(os.path.relpath(os.path.join(d, f), folder) for d, _, fs in os.walk(folder) for f in fs)

    def test_only_static_app_files(self):
        self.assertEqual(self.files(self.app), sorted(build_firebase.APP_FILES + ["manifest.json", "icon.svg", "apple-touch-icon.png"]))
        self.assertEqual(self.files(self.admin), sorted(build_firebase.APP_FILES))

    def test_no_roster_names_or_ids(self):
        with open(os.path.join(ROOT, "data", "positions.json")) as f:
            names = {p["name"] for p in json.load(f) if p.get("name") and len(p["name"]) > 5}
        with open(os.path.join(ROOT, "data", "employee-ids.json")) as f:
            ids = {v["id"] for v in json.load(f)["ids"].values()}
        # Hint-text and comment examples already in the app code ("e.g. Lester,D"), not roster data.
        examples = {"Lester,D", "Smith,J", "Pereira,J"}
        for folder in (self.app, self.admin):
            text = "".join(self.read(folder, name) for name in self.files(folder) if not name.endswith(".png"))
            found = [n for n in names - examples if n in text] + [i for i in ids if re.search(r"\b" + i + r"\b", text)]
            self.assertEqual(found, [], "names or Employee IDs in the public Hosting files: " + folder)

    def test_employee_app_has_no_admin_screens(self):
        for name in build_firebase.STUBS:
            self.assertEqual(self.read(self.app, name), build_firebase.STUBS[name])
            self.assertEqual(self.read(self.admin, name), self.read(ROOT, name))
        self.assertIn('window.FIREBASE_SITE = "app"', self.read(self.app, "index.html"))
        self.assertIn('window.FIREBASE_SITE = "admin"', self.read(self.admin, "index.html"))

    def test_index_loads_firebase_before_store(self):
        for folder in (self.app, self.admin):
            html = self.read(folder, "index.html")
            self.assertLess(html.index("/__/firebase/init.js"), html.index('src="store.js"'))
            self.assertIn("window.FIREBASE_HOSTED = true", html)
            self.assertIn('window.FIREBASE_ADMIN_URL = "https://demo-admin.web.app"', html)
        self.assertIn('rel="manifest"', self.read(self.app, "index.html"))
        self.assertIn("· Admin</title>", self.read(self.admin, "index.html"))

    def test_frozen_page_rules_allow_no_writes_below_owner(self):
        caps = build_artifact.frozen_capabilities()
        self.assertEqual({r["write"] for r in caps["db"]["rules"] if "write" in r}, {"owner"})
        self.assertEqual(len(caps["db"]["rules"]), len(build_artifact.CAPABILITIES["db"]["rules"]))
        self.assertTrue(caps["downloads"])
        self.assertIn("admin", {r["write"] for r in build_artifact.CAPABILITIES["db"]["rules"]})  # the live rules are unchanged

    def test_feedback_on_every_site_and_kept_out_of_snapshots(self):
        for folder in (self.app, self.admin):
            self.assertIn('src="feedback.js"', self.read(folder, "index.html"))
            self.assertEqual(self.read(folder, "feedback.js"), self.read(ROOT, "feedback.js"))
        rules = {r["path"]: r for r in build_artifact.CAPABILITIES["db"]["rules"]}
        self.assertEqual((rules["feedback"]["read"], rules["feedback/{self}"]["read"]), ("admin", "interact"))
        records = {"feedback": [{"id": "u1", "items": {}}], "statuses": []}
        build_artifact.fold_trades(records)
        self.assertNotIn("feedback", records)

    def test_invite_a_coworker_on_both_sites_and_trades_untouched(self):
        for folder in (self.app, self.admin):
            html = self.read(folder, "index.html")
            self.assertLess(html.index('src="vendor/qrcode.js"'), html.index('src="invite.js"'))
            self.assertEqual(self.read(folder, "invite.js"), self.read(ROOT, "invite.js"))
            self.assertEqual(self.read(folder, "trades.js"), self.read(ROOT, "trades.js"))
        self.assertIn("MIT license", self.read(ROOT, "vendor/qrcode.js"))

    def test_rules_cover_every_page_collection(self):
        with open(os.path.join(ROOT, "firebase", "firestore.rules")) as f:
            rules = f.read()
        for rule in build_artifact.CAPABILITIES["db"]["rules"]:
            col = rule["path"].split("/")[0]
            if col == "contacts":  # the page's staff list is staffCells on Firebase; contacts/{uid} is per person there
                self.assertIn("match /staffCells/{key}", rules)
            self.assertIn("match /" + col + "/", rules, col)

    def test_push_worker_only_with_a_key(self):
        self.assertNotIn("firebase-messaging-sw.js", os.listdir(self.app))
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_firebase.py"), tmp, "--app-url", "https://demo.web.app",
                            "--vapid-key", "BKEY", "--app-id", "1:23:web:abc"], check=True, capture_output=True)
            app = os.path.join(tmp, "public-app")
            self.assertIn("firebase-messaging-sw.js", os.listdir(app))
            # The worker loads no SDK (a worker that throws while loading can't register) and shows each push itself.
            worker = self.read(app, "firebase-messaging-sw.js")
            self.assertNotIn("importScripts", worker)
            for event in ('"push"', '"notificationclick"', "showNotification"):
                self.assertIn(event, worker)
            if shutil.which("node"):
                subprocess.run(["node", "--check", os.path.join(app, "firebase-messaging-sw.js")], check=True)
            self.assertIn('window.FIREBASE_VAPID_KEY = "BKEY"', self.read(app, "index.html"))
            self.assertIn("firebase-messaging-compat.js", self.read(app, "index.html"))
            self.assertNotIn("BKEY", self.read(os.path.join(tmp, "public-admin"), "index.html"))
            # The web app's ID, for messaging when Hosting's init.js has none: app site only
            self.assertIn('window.FIREBASE_APP_ID = "1:23:web:abc"', self.read(app, "index.html"))
            self.assertNotIn("1:23:web:abc", self.read(os.path.join(tmp, "public-admin"), "index.html"))
            # iPhone: notifications only from the Home Screen app, which needs its icon and full-screen launch
            self.assertIn("apple-touch-icon.png", os.listdir(app))
            self.assertIn('rel="apple-touch-icon"', self.read(app, "index.html"))
            self.assertIn("apple-mobile-web-app-capable", self.read(app, "index.html"))
        self.assertTrue(os.path.exists(os.path.join(ROOT, "firebase", "functions", "lib", "schedule.js")))

    def test_announcements_and_notices_rules(self):
        with open(os.path.join(ROOT, "firebase", "firestore.rules")) as f:
            rules = f.read()
        block = re.search(r"match /announcements/\{id\} \{(.*?)\}", rules, re.S).group(1)
        self.assertIn("allow read: if isAdmin();", block)
        self.assertIn("allow write: if false;", block)
        block = re.search(r"match /notices/\{uid\} \{(.*?)\n    \}", rules, re.S).group(1)
        self.assertIn("only(['dismissed'])", block)
        self.assertNotIn("create", block)

    def test_cells_stay_admin_only(self):
        with open(os.path.join(ROOT, "firebase", "firestore.rules")) as f:
            rules = f.read()
        block = re.search(r"match /staffCells/\{key\} \{(.*?)\}", rules, re.S).group(1)
        self.assertEqual(block.strip(), "allow read, write: if isAdmin();")

    def test_firebase_json(self):
        with open(os.path.join(ROOT, "firebase", "firebase.json")) as f:
            cfg = json.load(f)
        self.assertEqual({h["target"]: h["public"] for h in cfg["hosting"]}, {"app": "public-app", "admin": "public-admin"})
        for key in ("firestore", "storage", "functions"):
            self.assertIn(key, cfg)


if __name__ == "__main__":
    unittest.main()
