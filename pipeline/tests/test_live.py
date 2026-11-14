"""Tests for the daily near real-time update (pipeline/live_update.py).

Run: python -m unittest discover -s pipeline/tests -v
"""

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import live_update as lu  # noqa: E402

COV = {"sensor": "N20", "first": "2026-11-01", "last": "2026-11-12", "gaps": [], "sources": []}


class CoverageTest(unittest.TestCase):
    def test_extends_to_day_before_newest(self):
        c = lu.update_coverage(COV, "2026-11-07", "2026-11-14")
        self.assertEqual(c["last"], "2026-11-13")
        self.assertEqual(c["gaps"], [])
        self.assertIn(lu.SOURCE_NAME, c["sources"])

    def test_gap_when_file_starts_after_next_day(self):
        c = lu.update_coverage(COV, "2026-11-16", "2026-11-22")
        self.assertEqual(c["gaps"], ["2026-11-13", "2026-11-14", "2026-11-15"])
        self.assertEqual(c["last"], "2026-11-21")

    def test_no_gap_when_file_starts_on_next_day(self):
        c = lu.update_coverage(COV, "2026-11-13", "2026-11-19")
        self.assertEqual(c["gaps"], [])

    def test_older_file_does_not_move_coverage_back(self):
        c = lu.update_coverage(COV, "2026-11-01", "2026-11-08")
        self.assertEqual(c["last"], "2026-11-12")


class StoreTest(unittest.TestCase):
    def test_merge_is_idempotent(self):
        a = pd.DataFrame({"date": ["2026-11-02"], "time": ["0130"], "lat": [50.123456], "lon": [20.1],
                          "sensor": ["N20"], "frp": [3.2]})
        once = lu.merge(lu.merge(pd.DataFrame(columns=lu.NRT_COLUMNS), a), a)
        self.assertEqual(len(once), 1)
        self.assertAlmostEqual(once["lat"].iloc[0], 50.12346)

    def test_live_json_counts_cell_days(self):
        nrt = pd.DataFrame({
            "date": ["2026-11-01", "2026-11-01", "2026-11-03", "2026-11-14"],
            "time": ["0100", "0200", "0100", "0100"],
            "lat": [50.01, 50.02, 50.01, 50.01], "lon": [20.01, 20.02, 20.01, 20.01],
            "sensor": ["N20"] * 4, "frp": [1.0] * 4,
        })
        cov = dict(COV, last="2026-11-13")
        j = lu.live_json("XX", nrt, cov)
        # two detections in one cell on day 0 = one cell-day; day 13 is after `last`
        self.assertEqual(j["day"], [0, 2])
        self.assertEqual(j["det"], [2, 1])
        self.assertEqual(j["lat"], [500, 500])


if __name__ == "__main__":
    unittest.main()
