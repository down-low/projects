"""Pay estimate math (pay.js PayViews.estimate), run in node."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def estimate(code, yos, prem):
    js = ("require(%s); const e = globalThis.PayViews.estimate(%s, %s, %s);"
          "console.log(JSON.stringify(e));") % (json.dumps(os.path.join(ROOT, "pay.js")), json.dumps(code), json.dumps(yos), json.dumps(prem))
    return json.loads(subprocess.run(["node", "-e", js], check=True, capture_output=True, text=True).stdout)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class PayEstimate(unittest.TestCase):
    def test_h2_steps_by_years_of_service(self):
        self.assertEqual(estimate("H-2", 0, {"holiday": False})["base"], 100464)
        self.assertEqual(estimate("H-2", 6, {"holiday": False})["base"], 154960)
        self.assertEqual(estimate("H-2", 30, {"holiday": False})["base"], 154960)

    def test_longevity_2_4_6(self):
        pct = lambda y: sum(r["pct"] for r in estimate("H-30", y, {"holiday": False})["rows"] if r["label"].startswith("Longevity"))
        self.assertEqual([pct(20), pct(21), pct(22), pct(23), pct(25), pct(26), pct(30)], [0, 2, 2, 4, 4, 6, 6])

    def test_holiday_on_for_suppression_and_counts_for_retirement(self):
        e = estimate("H-2", 6, {})
        self.assertAlmostEqual(e["total"], 154960 * 1.0909)
        self.assertAlmostEqual(e["retire"], 154960 * 1.0909)
        self.assertEqual(estimate("H-41", 6, {})["total"], 271544)  # not suppression: off unless ticked
        self.assertEqual(estimate("H-2", 6, {"holiday": False})["total"], 154960)

    def test_training_not_counted_for_retirement(self):
        e = estimate("H-2", 6, {"holiday": False, "train": 8})
        self.assertAlmostEqual(e["total"], 154960 * 1.08)
        self.assertEqual(e["retire"], 154960)
        self.assertEqual(estimate("H-2", 6, {"holiday": False, "train": 12})["total"], 154960)

    def test_overtime_is_time_and_a_half_with_premiums(self):
        e = estimate("H-2", 6, {"holiday": False, "ao": True})
        self.assertAlmostEqual(e["hourly"], 61.191 * 1.05)
        self.assertAlmostEqual(e["otHourly"], 61.191 * 1.05 * 1.5)
        self.assertAlmostEqual(e["otShift"], 61.191 * 1.05 * 1.5 * 24)


if __name__ == "__main__":
    unittest.main()
