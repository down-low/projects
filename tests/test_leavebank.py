"""Leave bank math (leavebank.js LeaveBankViews.project and vaTier), run in node."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(expr):
    js = "require(%s); const L = globalThis.LeaveBankViews; console.log(JSON.stringify(%s));" % (json.dumps(os.path.join(ROOT, "leavebank.js")), expr)
    return json.loads(subprocess.run(["node", "-e", js], check=True, capture_output=True, text=True).stdout)


def project(bank, today, hire=None, leave=None):
    return run("L.project(%s, %s)" % (json.dumps(bank), json.dumps({"today": today, "hire": hire, "leave": leave or {}})))


BANK = {"asOf": "2026-10-09", "sp": 100, "va": 200, "tc": 50, "tcUsed": []}
HIRE_10 = "2016-06-01"  # 10 years: VA 6.923 / 540


@unittest.skipUnless(shutil.which("node"), "node not installed")
class LeaveBank(unittest.TestCase):
    def test_va_tiers_by_years_of_service(self):
        self.assertEqual(run("[0.5, 4.9, 5, 15, 15.1].map(y => L.vaTier(y).rate)"), [4.615, 4.615, 6.923, 6.923, 9.231])
        self.assertEqual(run("[4.9, 5, 15.1].map(y => L.vaTier(y).cap)"), [480, 540, 600])

    def test_accrues_at_each_pay_period_end(self):
        # Pay periods end on Fridays 10/9, 10/23, 11/6 (anchored 9/12/26). As of 10/9: nothing until 10/23.
        r = project(BANK, "2026-10-22", HIRE_10)
        self.assertEqual((r["sp"], r["va"], r["tc"], r["next"]), (100, 200, 50, "2026-10-23"))
        r = project(BANK, "2026-10-23", HIRE_10)
        self.assertEqual((r["sp"], r["va"], r["tc"], r["next"]), (106, 206.923, 56.91, "2026-11-06"))
        r = project(BANK, "2026-11-06", HIRE_10)
        self.assertEqual((r["sp"], r["va"], r["tc"]), (112, 213.846, 63.82))

    def test_va_and_s_shifts_use_24_hours_and_tc_used_comes_off(self):
        bank = dict(BANK, tcUsed=[{"date": "2026-10-15", "hours": 12}])
        r = project(bank, "2026-10-23", HIRE_10, {"2026-10-12": "VA", "2026-10-18": "S", "2026-10-09": "VA"})
        # The 10/9 shift is on the as-of day itself, so it's already in the pay stub's balance.
        self.assertEqual((r["sp"], r["va"], r["tc"]), (82, 182.923, 44.91))

    def test_caps(self):
        r = project(dict(BANK, sp=1270, va=538, tc=199), "2026-10-23", HIRE_10)
        self.assertEqual((r["sp"], r["va"], r["tc"]), (1272, 540, 200))
        self.assertEqual(r["capped"], ["SP", "VA", "TC"])
        # Under 5 years the VA cap is 480.
        r = project(dict(BANK, va=479), "2026-10-23", "2024-01-01")
        self.assertEqual((r["va"], r["per"]["va"]), (480, 4.615))

    def test_tier_changes_on_the_anniversary(self):
        # 15 years on 10/20/26: over 15 from the 10/23 accrual on.
        r = project(BANK, "2026-10-23", "2011-10-20")
        self.assertEqual(r["va"], 209.231)

    def test_last_pay_period_end(self):
        self.assertEqual(run('L.lastPeriodEnd("2026-10-24")'), "2026-10-23")
        self.assertEqual(run('L.lastPeriodEnd("2026-10-23")'), "2026-10-23")
        self.assertEqual(run('L.lastPeriodEnd("2026-10-22")'), "2026-10-09")


if __name__ == "__main__":
    unittest.main()
