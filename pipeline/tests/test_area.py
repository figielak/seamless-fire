"""Tests for custom areas (pipeline/area.py) and the annual interval of mixed years.

Run: python -m unittest discover -s pipeline/tests -v
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import area  # noqa: E402
import model  # noqa: E402
from config import INTERVAL_Z  # noqa: E402
from test_pipeline import synthetic_frame  # noqa: E402


def calib(frame: pd.DataFrame) -> pd.DataFrame:
    months = [f"{y}-{m:02d}" for y, m in zip(frame["year"], frame["cal_month"])]
    return frame.set_index(pd.Index(months))


class ShareTest(unittest.TestCase):
    def setUp(self):
        f = calib(synthetic_frame([1.0, 2.0, 2.5, 1.5], 0.7, noise=0.2))
        f.loc[f.index[5], "M"] = 0  # a month without MODIS in the whole country
        self.f = f
        self.fits, self.pred = area.country_loyo(f, f, f, "E")

    def test_loyo_folds_match_validate(self):
        fits = model.loyo_fits(self.f, self.f, "E")
        self.assertEqual(sorted(fits), sorted(self.f["year"].unique()))
        y = 2015
        ref = model.fit("E", self.f[self.f["year"] != y], self.f[self.f["year"] != y])
        np.testing.assert_allclose(fits[y]["a"], ref["a"])
        resid = model.log_resid(self.f, self.pred)
        val = model.validate(self.f, self.f, ["E"])["E"]
        self.assertAlmostEqual(float(np.sqrt(np.mean(resid ** 2))), val["loyo_logrmse"], places=12)

    def test_area_equal_to_country(self):
        p = area.area_predictions(self.f, self.pred, self.fits, self.f[["M", "V"]])
        pos = self.f["M"].to_numpy() > 0
        np.testing.assert_allclose(p["share"].to_numpy()[pos], self.pred[pos])
        np.testing.assert_allclose(p["direct"].to_numpy(), self.pred)  # direct = country model

    def test_zero_country_modis_gives_zero(self):
        p = area.area_predictions(self.f, self.pred, self.fits, self.f[["M", "V"]])
        self.assertEqual(p["share"].iloc[5], 0.0)
        self.assertGreater(self.pred[5], 0)  # the country model itself is not zero there

    def test_empty_area_gives_zero(self):
        p = area.area_predictions(self.f, self.pred, self.fits, pd.DataFrame(columns=["M", "V"]))
        self.assertTrue((p["share"] == 0).all())
        self.assertTrue((p["direct"] > 0).any())  # the old method's intercept problem


class GeometryTest(unittest.TestCase):
    def test_polygon_and_bbox(self):
        sq = [[0, 0], [2, 0], [2, 2], [0, 2]]
        lon = np.array([1.0, 3.0, 1.0, -0.5])
        lat = np.array([1.0, 1.0, 2.5, 1.0])
        self.assertEqual(area.in_polygon(lon, lat, sq).tolist(), [True, False, False, False])
        box = {"bbox": [0, 0, 2, 2]}
        self.assertEqual(area.in_area(np.array([0.0, 2.0, 2.01]), np.array([1.0, 2.0, 1.0]), box).tolist(),
                         [True, True, False])  # edges included

    def test_presets_valid(self):
        for p in area.load_presets():
            with self.subTest(p=p["id"]):
                self.assertIn(p["country"], ("PL", "PT", "ES", "GR", "UA", "AU", "CA", "CL"))
                coords = [p["bbox"][0:2], p["bbox"][2:4]] if "bbox" in p else p["polygon"]
                if "polygon" in p:
                    self.assertGreaterEqual(len({tuple(c) for c in p["polygon"]}), 3)
                for lon, lat in coords:
                    self.assertTrue(-180 <= lon <= 180 and -90 <= lat <= 90)
                    # vertices off the cell-center grid (x.x5), so the edge rule never matters
                    for v in (lon, lat):
                        self.assertNotAlmostEqual((v * 10) % 1, 0.5, places=6)


class AnnualIntervalTest(unittest.TestCase):
    def test_mixed_year_has_interval(self):
        idx = pd.period_range("2011-01", "2013-12", freq="M")
        est = idx < pd.Period("2012-02", "M")
        hm = pd.DataFrame({"modis": 10, "viirs": 7, "harmonized": 5.0, "estimated": est,
                           "terra_only": False}, index=idx)
        out = model.annual_series(hm, sigma_annual=0.2, b=0.5, sigma_terra=0.3, sigma=0.4)
        k_month, k_year = np.exp(INTERVAL_Z * 0.4), np.exp(INTERVAL_Z * 0.2)
        self.assertAlmostEqual(out["lo"][0], round(60 / k_year, 1))      # 2011 fully estimated
        self.assertAlmostEqual(out["lo"][1], round(55 + 5 / k_month, 1))  # 2012: Jan estimated
        self.assertAlmostEqual(out["hi"][1], round(55 + 5 * k_month, 1))
        self.assertEqual(out["lo"][2], out["hi"][2])                      # 2013 observed


if __name__ == "__main__":
    unittest.main()
