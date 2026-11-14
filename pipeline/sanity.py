"""Print sanity numbers from the stage 1 cache (compare with CLAUDE.md).

Usage: python pipeline/sanity.py [CC ...]
"""

import json
import sys

import numpy as np
import pandas as pd

from config import CACHE_DIR, CALIB_YEARS, COUNTRIES, OUT_DIR, SATELLITE_SENSOR


def monthly_totals(code: str) -> pd.DataFrame:
    """Country monthly cell-days per sensor (MODIS = Terra ∪ Aqua)."""
    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    cd["sensor"] = cd["sat"].astype(str).map(SATELLITE_SENSOR)
    cd = cd.drop_duplicates(["sensor", "lat_i", "lon_i", "date"])
    cd["month"] = cd["date"].dt.to_period("M")
    return cd.groupby(["month", "sensor"]).size().unstack("sensor", fill_value=0)


def report(code: str) -> None:
    print(f"\n=== {code} ===")
    stats = json.loads((CACHE_DIR / f"{code}_filter_stats.json").read_text())
    for sat, by_type in stats.items():
        total = sum(by_type.values())
        shares = ", ".join(f"type {t}: {n / total:.1%}" for t, n in sorted(by_type.items()))
        print(f"{sat:5s} {total:>8,} detections  {shares}")

    mt = monthly_totals(code)
    y0, y1 = CALIB_YEARS
    full = pd.period_range(f"{y0}-01", f"{y1}-12", freq="M")
    cal = mt.reindex(full, fill_value=0)
    m, v = cal["MODIS"], cal["SNPP"]
    print(f"{y0}-{y1}: MODIS {m.sum():,} cell-days, S-NPP {v.sum():,}")
    print(f"monthly corr MODIS vs S-NPP: {np.corrcoef(m, v)[0, 1]:.3f}")
    print(f"VIIRS/MODIS ratio (totals): {v.sum() / m.sum():.2f}")
    by_cal_month = cal.groupby(cal.index.month)[["MODIS", "SNPP"]].sum()
    ratio = (by_cal_month["SNPP"] / by_cal_month["MODIS"]).round(1)
    print("ratio by calendar month:", dict(ratio))
    if "N20" in mt:
        both = mt.loc[mt.index.year.isin(range(2018, 2026))]
        print(f"S-NPP / NOAA-20 2018-2025: {both['SNPP'].sum() / both['N20'].sum():.3f}")

    print("top months S-NPP:", [(str(p), int(n)) for p, n in mt["SNPP"].nlargest(5).items()])
    print("top months MODIS:", [(str(p), int(n)) for p, n in mt["MODIS"].nlargest(5).items()])

    # cells.json totals must match the cache.
    cells = json.loads((OUT_DIR / code / "cells.json").read_text())
    ok = sum(cells["modis"]) == mt["MODIS"].sum() and sum(cells["viirs"]) == mt["SNPP"].sum()
    print(f"cells.json totals match cache: {ok}")

    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    aqua = cd.loc[cd["sat"] == "Aqua", "date"]
    print(f"first Aqua cell-day: {aqua.min().date() if len(aqua) else None}")


if __name__ == "__main__":
    for c in sys.argv[1:] or list(COUNTRIES):
        report(c)
