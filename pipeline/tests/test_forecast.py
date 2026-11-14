"""Forecast computations (forecast_core.py) and the daily update (forecast_update.py), offline.

Run: PYTHONPATH=pipeline python -m unittest pipeline/tests/test_forecast.py
"""

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

import fwi as F
import forecast_core as C
import forecast_update as U


def weather(n: int, k: int, seed: int = 1) -> dict[str, np.ndarray]:
    g = np.random.default_rng(seed)
    return {"t": g.uniform(-5, 35, (n, k)), "rh": g.uniform(10, 100, (n, k)),
            "w": g.uniform(0, 40, (n, k)), "r": np.where(g.random((n, k)) < 0.3, g.exponential(6, (n, k)), 0.0)}


class Core(unittest.TestCase):
    def test_step_matches_fwi_series(self):
        days = pd.date_range("2020-01-01", periods=400)
        wx = weather(len(days), 3)
        for south in (False, True):
            ref, _ = F.fwi_series(wx["t"], wx["rh"], wx["w"], wx["r"], days.month.to_numpy(), south)
            _, feats = C.run(C.new_state(3), days, wx, south)
            for k in ("ffmc", "dmc", "dc", "isi", "bui", "fwi"):
                np.testing.assert_allclose(np.array([f[k] for f in feats]), ref[k], rtol=1e-12, err_msg=k)

    def test_state_continues_exactly(self):
        days = pd.date_range("2021-03-01", periods=120)
        wx = weather(len(days), 2, seed=5)
        _, whole = C.run(C.new_state(2), days, wx, False)
        s, _ = C.run(C.new_state(2), days[:70], {v: a[:70] for v, a in wx.items()}, False)
        s = json.loads(json.dumps(C.state_json(s, "x")))  # through the stored JSON (rounded to 3 decimals)
        _, rest = C.run(U.state_arrays(s), days[70:], {v: a[70:] for v, a in wx.items()}, False)
        for k in ("dc", "dry_days", "rain7"):
            np.testing.assert_allclose(rest[-1][k], whole[-1][k], atol=0.05, err_msg=k)

    def test_dry_days_and_rain7(self):
        days = pd.date_range("2022-06-01", periods=9)
        r = np.array([[0], [3], [0], [0], [1], [0], [0], [0], [0]], float)
        wx = {"t": np.full((9, 1), 20.0), "rh": np.full((9, 1), 40.0), "w": np.full((9, 1), 10.0), "r": r}
        _, f = C.run(C.new_state(1), days, wx, False)
        self.assertEqual([float(x["dry_days"][0]) for x in f], [1, 0, 1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(float(f[6]["rain7"][0]), 4.0)
        self.assertEqual(float(f[8]["rain7"][0]), 1.0)

    def test_correct(self):
        x = np.array([[10.0, 50.0], [2.0, 99.0]])
        mon = np.array([1, 2])
        tab = np.zeros((2, 12))
        tab[:, 0] = [1.0, -5.0]
        tab[:, 1] = [3.0, -5.0]
        np.testing.assert_allclose(C.correct("t", x, mon, tab), [[9.0, 55.0], [-1.0, 104.0]])
        self.assertEqual(C.correct("rh", x, mon, tab).max(), 100.0)
        self.assertEqual(C.correct("w", x, mon, tab)[1, 0], 0.0)
        rr = np.ones((2, 12)) * 2.0
        np.testing.assert_allclose(C.correct("r", x, mon, rr), 2 * x)

    def test_daily_from_hourly(self):
        t = pd.date_range("2024-05-01", periods=24 + 10, freq="h")
        n = len(t)
        hourly = {"temperature_2m": list(range(n)), "relative_humidity_2m": [50 - i % 24 for i in range(n)],
                  "wind_speed_10m": [10.0] * n, "precipitation": [0.5] * n}
        d = C.daily_from_hourly([x.isoformat() for x in t], hourly)
        self.assertEqual(d.loc["2024-05-01", "t"], 23)
        self.assertEqual(d.loc["2024-05-01", "rh"], 27)
        self.assertAlmostEqual(d.loc["2024-05-01", "r"], 12.0)
        self.assertTrue(np.isnan(d.loc["2024-05-02", "t"]))  # 10 hours only

    def test_climatology_and_predict(self):
        days = pd.date_range("2015-01-01", "2018-12-31")
        clim = C.climatology(np.full(len(days), 2.0), days)
        np.testing.assert_allclose(clim, 2.0)
        model = {"clim": clim.tolist(),
                 "seasons": [{"mu": [0.0] * 12, "sd": [1.0] * 12, "beta": [0.5 * s] + [0.0] * 12} for s in range(4)]}
        x = np.zeros(12)
        self.assertAlmostEqual(C.predict(model, x, pd.Timestamp("2026-07-10")), 3.0)  # JJA, beta0 = 1.0
        self.assertAlmostEqual(C.predict(model, x, pd.Timestamp("2026-12-31")), 2.0)  # DJF, day 365


class Update(unittest.TestCase):
    """End to end with fake NASA POWER and Open-Meteo responses."""

    def test_forecast_file(self):
        pts = [[40.5, -8.5], [41.5, -7.5]]
        zeros = np.zeros((2, 12)).tolist()
        bias = {str(L): {"t": zeros, "rh": zeros, "w": zeros, "r": np.ones((2, 12)).tolist()} for L in range(8)}
        model = {"code": "PT", "south": False, "points": pts, "weights": [0.25, 0.75], "feats": C.FEATS,
                 "clim": [0.5] * 365, "seasons": [{"mu": [0.0] * 12, "sd": [1.0] * 12, "beta": [0.0] * 13}] * 4,
                 "bias": bias, "resid_sd": [0.6] * 7, "skill": [0.3, 0.3, 0.3, 0.2, 0.2, 0.2, 0.1],
                 "perfect_skill": 0.4, "trained": "2012-01-20..2025-12-31",
                 "week": {"skill_vs_clim": 0.37, "corr": 0.76, "corr_clim": 0.37, "resid_sd_log": 0.74}}
        today = date(2026, 11, 14)

        def power(lat, lon, start, end):  # POWER has data to 2026-11-11
            idx = pd.date_range(start, end)
            f = pd.DataFrame({"t": 15.0, "rh": 60.0, "w": 10.0, "r": 0.0}, index=idx)
            f.loc[f.index > "2026-11-11"] = np.nan
            return f

        def om(points, past_days):
            idx = pd.date_range(pd.Timestamp(today) - pd.Timedelta(days=past_days), periods=past_days + 8)
            return [pd.DataFrame({"t": 18.0, "rh": 40.0, "w": 12.0, "r": 0.0}, index=idx) for _ in points]

        with tempfile.TemporaryDirectory() as tmp:
            models, data = Path(tmp) / "models", Path(tmp) / "data"
            models.mkdir()
            (data / "PT").mkdir(parents=True)
            (models / "PT.json").write_text(json.dumps(model))
            (models / "state_PT.json").write_text(json.dumps(C.state_json(C.new_state(2), "2026-11-01")))
            with mock.patch.object(U, "MODELS", models), mock.patch.object(U, "DATA", data), \
                    mock.patch.object(C, "fetch_power", power), mock.patch.object(U, "fetch_open_meteo", om), \
                    mock.patch.object(U, "fetch_previous_runs", lambda p, s, e, i: om(p, (i - s).days)):
                U.forecast("PT", today)
            state = json.loads((models / "state_PT.json").read_text())
            out = json.loads((data / "PT" / "forecast.json").read_text())
        self.assertEqual(state["date"], "2026-11-11")  # moved with POWER only
        self.assertEqual(out["issued"], "2026-11-14")
        self.assertEqual(out["data_through"], "2026-11-13")
        self.assertEqual([d["date"] for d in out["days"]], [f"2026-11-{d}" for d in range(14, 21)])
        for d in out["days"]:  # betas 0: prediction = climatology
            self.assertAlmostEqual(d["value"], round(float(np.expm1(0.5)), 2))
            self.assertLessEqual(d["lo"], d["value"])
            self.assertGreaterEqual(d["hi"], d["value"])
        self.assertEqual(out["days"][0]["skill"], 0.3)
        self.assertAlmostEqual(out["week"]["value"], round(7 * round(float(np.expm1(0.5)), 2), 1))

    def test_previous_runs_pick_lead_by_issue_day(self):
        """A past issue day uses the forecast issued that day: day issue+k = lead k, earlier days = lead 0."""
        issue = date(2026, 11, 3)
        times = pd.date_range("2026-11-01", "2026-11-09 23:00", freq="h")
        hourly = {"time": [t.isoformat() for t in times]}
        for L in range(U.DAYS):
            sfx = "" if L == 0 else f"_previous_day{L}"
            hourly[f"temperature_2m{sfx}"] = [float(L)] * len(times)  # temperature = lead number
            hourly[f"relative_humidity_2m{sfx}"] = [50.0] * len(times)
            hourly[f"wind_speed_10m{sfx}"] = [10.0] * len(times)
            hourly[f"precipitation{sfx}"] = [0.0] * len(times)
        with mock.patch.object(U, "get_json", lambda q: [{"hourly": hourly}]):
            d = U.fetch_previous_runs([[40.5, -8.5]], date(2026, 11, 1), date(2026, 11, 9), issue)[0]
        self.assertEqual(d["t"].tolist(), [0, 0, 0, 1, 2, 3, 4, 5, 6])

    def test_issue_day_follows_fire_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            cov = Path(tmp) / "coverage.json"
            cov.write_text(json.dumps({"PT": {"last": "2026-11-13"}}))
            with mock.patch.object(U, "COVERAGE", cov):
                self.assertEqual(U.issue_day("PT"), date(2026, 11, 14))


if __name__ == "__main__":
    unittest.main()
