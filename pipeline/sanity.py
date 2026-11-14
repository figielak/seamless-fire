"""Print sanity numbers from the stage 1 cache and stage 2 model.json (compare with CLAUDE.md).

Usage: python pipeline/sanity.py [CC ...]
"""

import json
import sys

import numpy as np
import pandas as pd

from config import CACHE_DIR, CALIB_YEARS, COUNTRIES, OUT_DIR
from model import monthly_series


def report(code: str) -> None:
    print(f"\n=== {code} ===")
    stats = json.loads((CACHE_DIR / f"{code}_filter_stats.json").read_text())
    for sat, by_type in stats.items():
        total = sum(by_type.values())
        shares = ", ".join(f"type {t}: {n / total:.1%}" for t, n in sorted(by_type.items()))
        print(f"{sat:5s} {total:>8,} detections  {shares}")

    mt = monthly_series(code)
    y0, y1 = CALIB_YEARS
    cal = mt[(mt.index.year >= y0) & (mt.index.year <= y1)]
    m, v = cal["MODIS"], cal["SNPP"]
    print(f"{y0}-{y1}: MODIS {m.sum():,} cell-days, S-NPP {v.sum():,}")
    print(f"monthly corr MODIS vs S-NPP: {np.corrcoef(m, v)[0, 1]:.3f}")
    print(f"VIIRS/MODIS ratio (totals): {v.sum() / m.sum():.2f}")
    by_cal_month = cal.groupby(cal.index.month)[["MODIS", "SNPP"]].sum()
    print("ratio by calendar month:", (by_cal_month["SNPP"] / by_cal_month["MODIS"]).round(1).tolist())
    print("top months S-NPP:", [(str(p), int(n)) for p, n in mt["SNPP"].nlargest(5).items()])
    print("top months MODIS:", [(str(p), int(n)) for p, n in mt["MODIS"].nlargest(5).items()])

    cells = json.loads((OUT_DIR / code / "cells.json").read_text())
    ok = sum(cells["modis"]) == mt["MODIS"].sum() and sum(cells["viirs"]) == mt["SNPP"].sum()
    print(f"cells.json totals match cache: {ok}")

    path = OUT_DIR / code / "model.json"
    if not path.exists():
        return
    mj = json.loads(path.read_text())
    print(f"\nmodel {mj['model']} ({mj['source']}, {mj['fire_months']} fire months): "
          f"a={mj['a']} b={mj['b']} sigma={mj['sigma']} sigma_annual={mj['sigma_annual']} "
          f"smear={mj['smear']}")
    rows = {k: {kk: vv for kk, vv in v.items() if kk != "backtest_by_year"}
            for k, v in mj["methods"].items()}
    print(pd.DataFrame(rows).T.round(3).to_string())
    print("backtest by year:")
    print(pd.DataFrame({k: v["backtest_by_year"] for k, v in mj["methods"].items()}).T.round(2).to_string())
    print(f"NOAA-20 factor: {mj['n20_factor']}  terra_only: {mj['terra_only']}")
    ag = mj["agreement"]
    for k in ("exact", "neighbor"):
        print(f"agreement {k}: MODIS in VIIRS {ag[k]['modis_in_viirs']:.1%}, "
              f"VIIRS in MODIS {ag[k]['viirs_in_modis']:.1%}")
    print("industrial share:", {k: round(v, 3) for k, v in mj["industrial_share"].items() if v is not None})
    an = mj["annual"]
    t = pd.DataFrame({k: an[k] for k in ("modis", "viirs", "harmonized", "lo", "hi")}, index=an["years"])
    print(t.T.to_string())


def summary(codes: list[str]) -> None:
    """One row per country: data, chosen model, LOYO/backtest of all methods, diagnostics."""
    rows = {}
    for code in codes:
        path = OUT_DIR / code / "model.json"
        if not path.exists():
            continue
        mj = json.loads(path.read_text())
        mt = monthly_series(code)
        cal = mt[(mt.index.year >= CALIB_YEARS[0]) & (mt.index.year <= CALIB_YEARS[1])]
        r = {
            "modis_cd": int(cal["MODIS"].sum()), "viirs_cd": int(cal["SNPP"].sum()),
            "corr": np.corrcoef(cal["MODIS"], cal["SNPP"])[0, 1],
            "V/M": cal["SNPP"].sum() / cal["MODIS"].sum(),
            "ind_VIIRS": mj["industrial_share"]["VIIRS"],
            "model": mj["model"], "b": mj["b"], "sigma": mj["sigma"],
        }
        for m in ("A", "B", "C", "D", "E"):
            r[f"{m}_ann"] = mj["methods"][m]["loyo_annual"]
            r[f"{m}_lr"] = mj["methods"][m]["loyo_logrmse"]
        sel = mj["methods"][mj["model"]]
        r["bt_ann"], r["bt_bias"] = sel["backtest_annual"], sel["backtest_bias"]
        r["n20"] = mj["n20_factor"]
        r["agree_M_in_V"] = mj["agreement"]["exact"]["modis_in_viirs"]
        r["agree_V_in_M"] = mj["agreement"]["exact"]["viirs_in_modis"]
        an = mj["annual"]
        h = dict(zip(an["years"], an["harmonized"]))
        r["jump_2012/2011"] = h[2012] / h[2011]
        rows[code] = r
    df = pd.DataFrame(rows)
    with pd.option_context("display.float_format", "{:.3f}".format, "display.width", 200):
        print(df.to_string())


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--summary" in args:
        summary([a for a in args if not a.startswith("--")] or list(COUNTRIES))
    else:
        for c in args or list(COUNTRIES):
            report(c)
