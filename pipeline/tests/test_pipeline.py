"""Unit tests for the data pipeline (stdlib unittest, no extra dependencies).

Run: python -m unittest discover -s pipeline/tests -v
"""

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build_data  # noqa: E402
import model  # noqa: E402
from config import COUNTRIES, OUT_DIR, SEASON_OF_MONTH  # noqa: E402

MODIS_HEADER = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,"
                "confidence,version,bright_t31,frp,daynight,type")


def write_csv(path: Path, rows: list[str]) -> Path:
    path.write_text("\n".join([MODIS_HEADER, *rows]) + "\n", encoding="utf-8")
    return path


def modis_row(lat, lon, date, sat, typ, time="1030"):
    return f"{lat},{lon},310,1,1,{date},{time},{sat},MODIS,50,6.1,280,10,D,{typ}"


class CellIndexTest(unittest.TestCase):
    def test_floor_and_float_edges(self):
        s = pd.Series([50.0, 49.99, 50.1, -0.05, -8.75, 0.0])
        self.assertEqual(build_data.cell_index(s).tolist(), [500, 499, 501, -1, -88, 0])


class ProcessFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_filter_dedupe_and_stats(self):
        f = write_csv(self.dir / "modis_2012_Testland.csv", [
            modis_row(50.01, 20.01, "2012-05-01", "Terra", 0),
            modis_row(50.02, 20.03, "2012-05-01", "Terra", 0, time="1031"),  # same cell-day
            modis_row(50.02, 20.03, "2012-05-01", "Aqua", 0, time="1330"),   # same cell-day, Aqua
            modis_row(50.15, 20.01, "2012-05-01", "Terra", 2),               # industrial
            modis_row(50.01, 20.01, "2012-05-02", "Terra", 0),               # next day
        ])
        r = build_data.process_file(f)
        cells, stats, bbox = r.cells, r.stats, r.bbox
        self.assertEqual(len(cells), 3)  # Terra day1, Aqua day1, Terra day2
        self.assertEqual(set(cells["sat"]), {"Terra", "Aqua"})
        s = stats.set_index(["sat", "type"])["n"]
        self.assertEqual(s[("Terra", 0)], 3)
        self.assertEqual(s[("Terra", 2)], 1)
        self.assertEqual(bbox, [20.01, 50.01, 20.03, 50.15])

    def test_keeps_leading_zeros_in_time(self):
        f = write_csv(self.dir / "modis_2012_Testland.csv",
                      [modis_row(50.0, 20.0, "2012-05-01", "Terra", 0, time="0039")])
        self.assertEqual(build_data.read_file(f)["acq_time"].iloc[0], "0039")

    def test_unknown_satellite_fails(self):
        f = write_csv(self.dir / "modis_2012_Testland.csv",
                      [modis_row(50.0, 20.0, "2012-05-01", "Xyz", 0)])
        with self.assertRaises(ValueError):
            build_data.read_file(f)

    def test_raw_files_skip_browser_duplicates(self):
        root = self.dir / "Poland" / "MODIS"
        root.mkdir(parents=True)
        for name in ("modis_2012_Poland.csv", "modis_2012_Poland(1).csv"):
            (root / name).write_text(MODIS_HEADER + "\n")
        old = build_data.RAW_DIR
        build_data.RAW_DIR = self.dir
        try:
            self.assertEqual([p.name for p in build_data.raw_files("PL")], ["modis_2012_Poland.csv"])
        finally:
            build_data.RAW_DIR = old


VIIRS_HEADER = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
                "confidence,version,bright_ti5,frp,daynight,type")


def viirs_row(lat, lon, date, typ="", version="2", time="0130", sat="SNPP"):
    return f"{lat},{lon},330,0.4,0.4,{date},{time},{sat},VIIRS,n,{version},280,5,N,{typ}"


class NrtTest(unittest.TestCase):
    """2026 files: archive rows with `type`, near real-time rows (`2.0NRT`) with empty `type`."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "viirs-snpp_2026_Testland.csv"

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rows):
        self.path.write_text("\n".join([VIIRS_HEADER, *rows]) + "\n", encoding="utf-8")
        return self.path

    def test_nrt_rows_use_mask_archive_rows_keep_type(self):
        mask = build_data.mask_keys([50.123], [20.456])
        f = self.write([
            viirs_row(50.1231, 20.4561, "2026-07-30", typ=0),               # archive, in mask cell, real type 0 kept
            viirs_row(50.1232, 20.4562, "2026-08-02", version="2.0NRT"),    # NRT in mask -> industrial
            viirs_row(50.5, 20.5, "2026-08-03", version="2.0NRT"),          # NRT outside -> vegetation
            viirs_row(50.6, 20.6, "2026-11-05", version="2.0NRT"),          # after LAST_COMPLETE_MONTH: dropped
        ])
        r = build_data.process_file(f, mask=mask)
        self.assertEqual(r.preliminary, {"2026-08"})
        self.assertEqual((r.n_nrt, r.n_masked), (2, 1))
        self.assertEqual(sorted(r.cells["date"].dt.strftime("%m-%d")), ["07-30", "08-03"])
        # filter stats only from rows with a real `type`
        self.assertEqual(r.stats["n"].sum(), 1)
        self.assertEqual(r.sat_dates["SNPP"], ("2026-07-30", "2026-11-05"))

    def test_archive_wins_over_nrt_on_shared_days(self):
        f = self.write([
            viirs_row(50.1, 20.1, "2026-07-31", typ=0),
            viirs_row(50.2, 20.2, "2026-07-31", version="2.0NRT"),  # same day as archive: dropped
            viirs_row(50.3, 20.3, "2026-08-01", version="2.0NRT"),
        ])
        r = build_data.process_file(f, mask=np.array([], np.int64))
        self.assertEqual(int(r.detections["n"].sum()), 2)
        self.assertEqual(r.n_nrt, 1)

    def test_nrt_without_mask_fails(self):
        f = self.write([viirs_row(50.1, 20.1, "2026-08-01", version="2.0NRT")])
        with self.assertRaises(ValueError):
            build_data.process_file(f)

    def test_missing_type_in_archive_row_is_dropped(self):
        f = self.write([viirs_row(50.1, 20.1, "2026-07-01", typ=0), viirs_row(50.2, 20.2, "2026-07-01")])
        self.assertEqual(len(build_data.read_file(f)), 1)

    def test_duplicates_removed_before_counting(self):
        row = viirs_row(50.11, 20.11, "2026-05-01", typ=0)
        f = self.write([row, row, viirs_row(50.12, 20.12, "2026-05-01", typ=0, time="0131")])
        r = build_data.process_file(f, hotspots=True)
        self.assertEqual(int(r.detections["n"].sum()), 2)  # one cell-month, two detections
        self.assertEqual(len(r.cells), 1)
        self.assertEqual(len(r.hotspots), 2)
        self.assertEqual(r.hotspots["time"].tolist(), ["0130", "0131"])


class MaskTest(unittest.TestCase):
    def test_majority_rule(self):
        counts = pd.DataFrame({"k": [1, 2, 3, 3], "t2": [5, 1, 0, 2], "n": [6, 4, 3, 1]})
        self.assertEqual(build_data.build_mask(counts, 0.5).tolist(), [1, 3])  # cell 3: 2 of 4
        self.assertEqual(build_data.build_mask(counts, 0.0).tolist(), [1, 2, 3])

    def test_keys_negative_coordinates(self):
        k = build_data.mask_keys([-33.4567, -33.4512], [-70.6543, -70.6501])
        self.assertEqual(k[0], k[1])
        self.assertNotEqual(build_data.mask_keys([-33.455], [-70.65])[0], k[0])

    def test_overlapping_files_fail(self):
        r = lambda a, b: types.SimpleNamespace(sat_dates={"SNPP": (a, b)})
        build_data.check_date_ranges([(Path("x1"), r("2025-01-01", "2025-12-31")),
                                      (Path("x2"), r("2026-01-01", "2026-10-31"))])
        with self.assertRaises(ValueError):
            build_data.check_date_ranges([(Path("x1"), r("2025-01-01", "2026-01-02")),
                                          (Path("x2"), r("2026-01-01", "2026-10-31"))])


class CellsJsonTest(unittest.TestCase):
    def test_modis_is_terra_union_aqua(self):
        cd = pd.DataFrame({
            "sat": ["Terra", "Aqua", "Aqua", "SNPP", "SNPP", "N20"],
            "lat_i": [500, 500, 500, 500, 501, 500],
            "lon_i": [200, 200, 200, 200, 200, 200],
            "date": pd.to_datetime(["2012-05-01", "2012-05-01", "2012-05-02",
                                    "2012-05-01", "2012-05-01", "2012-05-01"]),
        })
        with tempfile.TemporaryDirectory() as tmp:
            old = build_data.OUT_DIR
            build_data.OUT_DIR = Path(tmp) / "public" / "data"
            try:
                build_data.write_cells_json("XX", cd)
                out = json.loads((build_data.OUT_DIR / "XX" / "cells.json").read_text())
            finally:
                build_data.OUT_DIR = old
        rows = {(la, lo, m): (mo, vi) for la, lo, m, mo, vi in
                zip(out["lat"], out["lon"], out["m"], out["modis"], out["viirs"])}
        m = (2012 - 2000) * 12 + 4
        self.assertEqual(rows[(500, 200, m)], (2, 1))  # MODIS: 05-01 once + 05-02; N20 ignored
        self.assertEqual(rows[(501, 200, m)], (0, 1))


def synthetic_frame(a, b, years=range(2012, 2026), noise=0.0, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for y in years:
        for mo in range(1, 13):
            s = SEASON_OF_MONTH[mo]
            M = float(rng.integers(5, 500))
            V = np.expm1(a[s] + b * np.log1p(M) + rng.normal(0, noise))
            rows.append({"country": "XX", "year": y, "cal_month": mo, "season": s, "M": M, "V": V})
    return pd.DataFrame(rows)


class ModelTest(unittest.TestCase):
    def test_fit_recovers_parameters(self):
        a, b = [1.0, 2.0, 2.5, 1.5], 0.7
        f = synthetic_frame(a, b)
        pe = model.fit_loglog(f, seasonal=True)
        np.testing.assert_allclose(pe["a"], a, atol=1e-9)
        self.assertAlmostEqual(pe["b"], b, places=9)
        pd_ = model.fit_loglog(synthetic_frame([2.0] * 4, b), seasonal=False)
        np.testing.assert_allclose(pd_["a"], [2.0] * 4, atol=1e-9)

    def test_validation_ranks_methods(self):
        f = synthetic_frame([1.0, 2.0, 2.5, 1.5], 0.7, noise=0.1)
        val = model.validate(f, f, ["B", "D", "E"])
        self.assertLess(val["E"]["loyo_logrmse"], val["D"]["loyo_logrmse"])
        self.assertLess(val["D"]["loyo_logrmse"], val["B"]["loyo_logrmse"])
        self.assertLess(val["E"]["loyo_logrmse"], 0.15)
        self.assertEqual(model.choose_de(val), "E")
        self.assertEqual(sorted(val["E"]["backtest_by_year"]), list(range(2012, 2019)))

    def test_choose_d_on_tie(self):
        val = {"D": {"loyo_logrmse": 0.300}, "E": {"loyo_logrmse": 0.295}}
        self.assertEqual(model.choose_de(val), "D")

    def test_ratio_methods(self):
        f = pd.DataFrame({"country": "XX", "year": 2012, "cal_month": [1, 2], "season": [0, 0],
                          "M": [10.0, 10.0], "V": [20.0, 40.0]})
        self.assertAlmostEqual(model.fit("B", f, f)["r"], 3.0)
        pc = model.fit("C", f, f)
        self.assertEqual(model.predict("C", pc, f).tolist(), [20.0, 40.0])
        self.assertEqual(pc["r_month"][7], 3.0)  # month without data -> country ratio

    def test_harmonized_switches_to_observed_viirs(self):
        idx = model.ALL_MONTHS
        ms = pd.DataFrame(0, index=idx, columns=["Terra", "Aqua", "SNPP", "N20", "MODIS"])
        ms["Terra"] = 10
        ms["MODIS"] = 10
        ms.loc[idx >= pd.Period("2012-01", "M"), "SNPP"] = 7
        terra = {"until": "2002-06", "ratio": [2.0] * 4}
        hm = model.harmonized_monthly(ms, [1.0] * 4, 0.5, terra)
        self.assertEqual(model.viirs_first_month(ms), pd.Period("2012-02", "M"))
        self.assertEqual(hm.loc[pd.Period("2015-06", "M"), "harmonized"], 7)
        self.assertAlmostEqual(hm.loc[pd.Period("2010-06", "M"), "harmonized"], np.expm1(1 + 0.5 * np.log1p(10)))
        self.assertAlmostEqual(hm.loc[pd.Period("2001-06", "M"), "harmonized"], np.expm1(1 + 0.5 * np.log1p(20)))
        self.assertTrue(hm.loc[pd.Period("2012-01", "M"), "estimated"])


@unittest.skipUnless((OUT_DIR / "countries.json").exists(), "built data not present")
class BuiltDataTest(unittest.TestCase):
    """Consistency checks on the generated public/data/ for every built country."""

    def test_outputs_consistent(self):
        countries = json.loads((OUT_DIR / "countries.json").read_text())
        self.assertEqual([c["code"] for c in countries], [c for c in COUNTRIES if c in {x["code"] for x in countries}])
        for c in countries:
            code = c["code"]
            with self.subTest(code=code):
                if not (model.CACHE_DIR / f"{code}_celldays.parquet").exists():
                    self.skipTest("cache missing")
                ms = model.monthly_series(code)
                cells = json.loads((OUT_DIR / code / "cells.json").read_text())
                mj = json.loads((OUT_DIR / code / "model.json").read_text())
                self.assertEqual(sum(cells["modis"]), ms["MODIS"].sum())
                self.assertEqual(sum(cells["viirs"]), ms["SNPP"].sum())
                W, S, E, N = c["bbox"]
                self.assertTrue(all(S * 10 - 1 <= la <= N * 10 for la in (min(cells["lat"]), max(cells["lat"]))))
                self.assertTrue(all(W * 10 - 1 <= lo <= E * 10 for lo in (min(cells["lon"]), max(cells["lon"]))))
                self.assertIn(mj["model"], ("D", "E"))
                self.assertTrue(0 < mj["b"] < 2)
                self.assertTrue(0.7 < mj["n20_factor"] < 1.3)
                an = mj["annual"]
                for y, v, h, lo, hi in zip(an["years"], an["viirs"], an["harmonized"], an["lo"], an["hi"]):
                    self.assertLessEqual(lo, h)
                    self.assertLessEqual(h, hi)
                    if y >= 2013:
                        self.assertEqual(v, h)
                # D/E beat the global ratio (A) in validation
                m = mj["methods"]
                self.assertLess(m[mj["model"]]["loyo_logrmse"], m["A"]["loyo_logrmse"])
                self.assertLess(Path(OUT_DIR / code / "cells.json").stat().st_size, 100e6)


if __name__ == "__main__":
    unittest.main()
