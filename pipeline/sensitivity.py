"""Sensitivity of the harmonization to the counting unit (diagnostic, does not change outputs).

Units: cell-days on 0.05°, 0.1° (production), 0.25° grids; raw detection counts; FRP sum.
Each unit gets the same calibration frame and validation as stage 2 (model.validate):
LOYO annual % error and bias, backtest 2019-25 -> 2012-18, log-RMSE (scale-dependent,
not comparable across units), monthly correlation of log1p(M) vs log1p(V).
Plus saturation: how much the top month by detections drops in rank under each unit.

Run: python pipeline/sensitivity.py [CC ...]   (default PL PT)
Writes pipeline/cache/sensitivity.json.
"""

import json
import sys
import time

import numpy as np
import pandas as pd

from build_data import file_year, raw_files, read_file
from config import CACHE_DIR, CALIB_EXCLUDE, CALIB_YEARS, LAST_YEAR_STAGE1, SEASON_OF_MONTH
from model import validate

GRIDS = [0.05, 0.1, 0.25]
UNITS = [f"cell {g}°" for g in GRIDS] + ["detections", "FRP sum"]
FIRST_V = pd.Period("2012-02", "M")  # first full S-NPP month (as in stage 2)


def load_points(code: str) -> pd.DataFrame:
    """Type-0 detections of Terra, Aqua, S-NPP up to LAST_YEAR_STAGE1 (NOAA-20 not needed)."""
    parts = []
    for f in raw_files(code):
        if (file_year(f) or 0) > LAST_YEAR_STAGE1:
            continue
        df = read_file(f)
        df = df[(df["type"] == 0) & df["sat"].isin(["Terra", "Aqua", "SNPP"])]
        parts.append(pd.DataFrame({
            "sensor": np.where(df["sat"] == "SNPP", "V", "M"),
            "lat": df["latitude"].to_numpy(), "lon": df["longitude"].to_numpy(),
            "date": pd.to_datetime(df["acq_date"], format="%Y-%m-%d").to_numpy(),
            "frp": df["frp"].to_numpy(float),
        }))
    # Same rows in two files (e.g. year overlap) count once, as in stage 1.
    return pd.concat(parts, ignore_index=True).drop_duplicates()


def monthly(points: pd.DataFrame, unit: str) -> pd.DataFrame:
    """Monthly totals per sensor (columns M, V) for one unit."""
    month = points["date"].dt.to_period("M")
    if unit == "detections":
        g = points.groupby([month, "sensor"]).size()
    elif unit == "FRP sum":
        g = points.groupby([month, "sensor"])["frp"].sum()
    else:
        deg = float(unit.split()[1].rstrip("°"))
        cells = pd.DataFrame({
            "sensor": points["sensor"], "date": points["date"],
            "i": np.floor(points["lat"].to_numpy() / deg + 1e-9).astype(np.int32),
            "j": np.floor(points["lon"].to_numpy() / deg + 1e-9).astype(np.int32),
        }).drop_duplicates()  # MODIS = Terra ∪ Aqua cell-days
        g = cells.groupby([cells["date"].dt.to_period("M"), "sensor"]).size()
    return g.unstack("sensor", fill_value=0).reindex(columns=["M", "V"], fill_value=0)


def calib_frame(code: str, ms: pd.DataFrame) -> pd.DataFrame:
    idx = pd.period_range(FIRST_V, f"{CALIB_YEARS[1]}-12", freq="M")
    idx = idx[~idx.astype(str).isin(CALIB_EXCLUDE)]
    ms = ms.reindex(idx, fill_value=0)
    return pd.DataFrame({
        "country": code, "year": idx.year, "cal_month": idx.month,
        "season": [SEASON_OF_MONTH[m] for m in idx.month],
        "M": ms["M"].to_numpy(float), "V": ms["V"].to_numpy(float),
    }, index=idx.astype(str))


def rank_of(series: pd.Series, month: str) -> int:
    return int(series.rank(ascending=False, method="min")[month])


def analyse(code: str) -> dict:
    t0 = time.time()
    points = load_points(code)
    out = {}
    det_v = monthly(points, "detections")["V"]
    det_v = det_v[det_v.index >= FIRST_V]
    top = det_v.idxmax()
    for unit in UNITS:
        ms = monthly(points, unit)
        frame = calib_frame(code, ms)
        val = validate(frame, frame, ["B", "D", "E"])
        v = ms["V"][ms.index >= FIRST_V]
        out[unit] = {
            "corr_log": float(np.corrcoef(np.log1p(frame["M"]), np.log1p(frame["V"]))[0, 1]),
            "ratio_V_M": float(frame["V"].sum() / frame["M"].sum()),
            "top_detection_month": str(top),
            "top_month_rank": rank_of(v, top),
            **{m: {k: val[m][k] for k in ("loyo_annual", "loyo_bias", "loyo_logrmse",
                                          "backtest_annual", "backtest_bias")} for m in val},
        }
    print(f"  {code}: {len(points):,} type-0 detections, {time.time() - t0:.0f} s")
    return out


def print_table(code: str, res: dict) -> None:
    print(f"\n{code}  (LOYO annual err / bias | backtest err / bias | log-RMSE | corr | top-month rank)")
    for unit, r in res.items():
        for m in ("D", "E"):
            x = r[m]
            print(f"  {unit:<11} {m}  {x['loyo_annual']:6.1%} / {x['loyo_bias']:+6.1%} | "
                  f"{x['backtest_annual']:6.1%} / {x['backtest_bias']:+6.1%} | "
                  f"{x['loyo_logrmse']:.2f} | {r['corr_log']:.3f} | {r['top_month_rank']}")
        b = r["B"]
        print(f"  {'':<11} B  {b['loyo_annual']:6.1%} / {b['loyo_bias']:+6.1%} | "
              f"{b['backtest_annual']:6.1%} / {b['backtest_bias']:+6.1%}   ratio V/M {r['ratio_V_M']:.2f}")


def main(args: list[str]) -> None:
    codes = args or ["PL", "PT"]
    path = CACHE_DIR / "sensitivity.json"
    results = json.loads(path.read_text()) if path.exists() else {}
    for code in codes:
        results[code] = analyse(code)
        print_table(code, results[code])
    path.write_text(json.dumps(results, indent=1))
    print(f"\n-> {path}")


if __name__ == "__main__":
    main(sys.argv[1:])
