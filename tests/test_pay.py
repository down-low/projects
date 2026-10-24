"""Pay estimate math (pay.js PayViews.estimate), run in node."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(expr):
    js = "require(%s); const P = globalThis.PayViews; console.log(JSON.stringify(%s));" % (json.dumps(os.path.join(ROOT, "pay.js")), expr)
    return json.loads(subprocess.run(["node", "-e", js], check=True, capture_output=True, text=True).stdout)


def estimate(code, yos, prem):
    return run("P.estimate(%s, %s, %s)" % (json.dumps(code), json.dumps(yos), json.dumps(prem)))


def period(y, m, d):
    p = run("P.payPeriodOf(new Date(%d, %d, %d))" % (y, m - 1, d))
    return p["start"], p["end"]


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

    def test_no_holiday_premium_on_overtime(self):
        e = estimate("H-2", 6, {"holiday": True, "ao": True})
        self.assertAlmostEqual(e["hourly"], 61.191 * 1.1409)
        self.assertAlmostEqual(e["otHourly"], 61.191 * 1.05 * 1.5)


    def test_pay_periods_are_14_days_from_9_12_26(self):
        self.assertEqual(period(2026, 9, 12), ("2026-09-12", "2026-09-25"))
        self.assertEqual(period(2026, 9, 25), ("2026-09-12", "2026-09-25"))
        self.assertEqual(period(2026, 10, 23), ("2026-10-10", "2026-10-23"))
        self.assertEqual(period(2026, 10, 24), ("2026-10-24", "2026-11-06"))
        self.assertEqual(period(2026, 9, 11), ("2026-08-29", "2026-09-11"))
        self.assertEqual(period(2027, 3, 20), ("2027-03-13", "2027-03-26"))  # across a time change

    def test_ot_worked_counts_worked_marks_in_range(self):
        marks = {"2026-10-09": {"kind": "worked", "hours": 24}, "2026-10-12": {"kind": "worked", "hours": 12},
                 "2026-10-15": {"kind": "worked"}, "2026-10-18": {"kind": "want"}, "2026-10-22": {"kind": "worked", "hours": 10}}
        self.assertEqual(run("P.otWorked(%s, '2026-10-10', '2026-10-20')" % json.dumps(marks)), {"days": 2, "hours": 36})
        self.assertEqual(run("P.otWorked({}, '2026-10-10', '2026-10-23')"), {"days": 0, "hours": 0})

    def test_lester_h20_training_9_retention_6(self):
        e = estimate("H-20", 26, {"train": 9})
        self.assertEqual(round(e["total"]), 223521)
        self.assertAlmostEqual(e["hourly"], 71.1294 * 1.2409)
        self.assertAlmostEqual(e["otHourly"], 71.1294 * 1.15 * 1.5)
        self.assertEqual(round(e["otShift"]), 2945)

    def test_emt_ao_boat_are_h2_only_and_paramedic_hidden(self):
        self.assertEqual(estimate("H-20", 6, {"holiday": False, "ao": True, "emt5": True, "boat": True, "medic": True})["total"], 180128)
        self.assertAlmostEqual(estimate("H-2", 6, {"holiday": False, "ao": True, "medic": True, "emt8": True})["total"], 154960 * 1.05)

    def test_default_classification_and_hidden_ones(self):
        self.assertEqual(run("P.defaultCode({hclass: 'H20', rank: 'Captain'})"), "H-20")
        self.assertEqual(run("P.defaultCode({hclass: 'H2', rank: 'Firefighter'})"), "H-2")
        self.assertEqual(run("P.defaultCode({rank: 'Captain'})"), "H-30")
        self.assertTrue(run("P.shows({hclass: 'H30'})"))
        self.assertFalse(run("P.shows({hclass: 'H40'})"))
        self.assertFalse(run("P.shows({hclass: 'H120'})"))
        self.assertFalse(run("P.shows({rank: 'Firefighter', hclass: 'H-3/8'})"))
        self.assertTrue(run("P.shows({rank: 'Firefighter', hclass: 'H-3/9'})"))


if __name__ == "__main__":
    unittest.main()
