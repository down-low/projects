"""Firebase build checks: the public Hosting folder holds no names or data files, and the rules cover every
collection the page uses.

Run: python3 -m unittest discover -s tests
"""
import json
import os
import re
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

    def test_only_static_app_files(self):
        self.assertEqual(sorted(os.listdir(self.app)), sorted(build_firebase.APP_FILES + ["manifest.json", "icon.svg"]))
        self.assertEqual(sorted(os.listdir(self.admin)), sorted(build_firebase.APP_FILES))

    def test_no_roster_names_or_ids(self):
        with open(os.path.join(ROOT, "data", "positions.json")) as f:
            names = {p["name"] for p in json.load(f) if p.get("name") and len(p["name"]) > 5}
        with open(os.path.join(ROOT, "data", "employee-ids.json")) as f:
            ids = {v["id"] for v in json.load(f)["ids"].values()}
        # Hint-text and comment examples already in the app code ("e.g. Lester,D"), not roster data.
        examples = {"Lester,D", "Smith,J", "Pereira,J"}
        for folder in (self.app, self.admin):
            text = "".join(self.read(folder, name) for name in os.listdir(folder))
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

    def test_rules_cover_every_page_collection(self):
        with open(os.path.join(ROOT, "firebase", "firestore.rules")) as f:
            rules = f.read()
        for rule in build_artifact.CAPABILITIES["db"]["rules"]:
            col = rule["path"].split("/")[0]
            if col == "contacts":  # the page's staff list is staffCells on Firebase; contacts/{uid} is per person there
                self.assertIn("match /staffCells/{key}", rules)
            self.assertIn("match /" + col + "/", rules, col)

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
