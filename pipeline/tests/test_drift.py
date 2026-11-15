"""Tests for the drift term of the interval (pipeline/model.py: drift_sigma, backtest_coverage).

Run: python -m unittest discover -s pipeline/tests -v
"""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import model  # noqa: E402
from config import INTERVAL_Z  # noqa: E402


class DriftTest(unittest.TestCase):
    def test_drift_is_abs_mean_log_error(self):
        v = {"backtest_by_year": {2012: -0.3, 2013: -0.2}}
        self.assertAlmostEqual(model.drift_sigma(v), abs(np.mean(np.log1p([-0.3, -0.2]))))
        self.assertEqual(model.drift_sigma({"backtest_by_year": {}}), 0.0)

    def test_coverage(self):
        v = {"backtest_by_year": {2012: -0.25, 2013: 0.05}}
        s = 0.1  # half-width z*s = 0.128 in log: -0.25 outside, +0.05 inside
        self.assertAlmostEqual(model.backtest_coverage(v, s), 0.5)
        wide = np.hypot(s, model.drift_sigma(v))
        self.assertGreaterEqual(INTERVAL_Z * wide, abs(np.log1p(0.05)))
        self.assertIsNone(model.backtest_coverage({"backtest_by_year": {}}, s))


if __name__ == "__main__":
    unittest.main()
