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
        cls.out = os.path.join(cls.tmp.name, "public")
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_firebase.py"), cls.out], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_only_static_app_files(self):
        files = sorted(os.listdir(self.out))
        self.assertEqual(files, sorted(build_firebase.APP_FILES + ["manifest.json", "icon.svg"]))

    def test_no_roster_names_or_ids(self):
        with open(os.path.join(ROOT, "data", "positions.json")) as f:
            names = {p["name"] for p in json.load(f) if p.get("name") and len(p["name"]) > 5}
        with open(os.path.join(ROOT, "data", "employee-ids.json")) as f:
            ids = {v["id"] for v in json.load(f)["ids"].values()}
        text = ""
        for name in os.listdir(self.out):
            with open(os.path.join(self.out, name), encoding="utf8") as f:
                text += f.read()
        # Hint-text and comment examples already in the app code ("e.g. Lester,D"), not roster data.
        examples = {"Lester,D", "Smith,J", "Pereira,J"}
        found = [n for n in names - examples if n in text] + [i for i in ids if re.search(r"\b" + i + r"\b", text)]
        self.assertEqual(found, [], "names or Employee IDs in the public Hosting files")

    def test_index_loads_firebase_before_store(self):
        with open(os.path.join(self.out, "index.html")) as f:
            html = f.read()
        self.assertLess(html.index("/__/firebase/init.js"), html.index('src="store.js"'))
        self.assertIn("window.FIREBASE_HOSTED = true", html)
        self.assertIn('rel="manifest"', html)

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
        self.assertEqual(cfg["hosting"]["public"], "public")
        for key in ("firestore", "storage", "functions"):
            self.assertIn(key, cfg)


if __name__ == "__main__":
    unittest.main()
