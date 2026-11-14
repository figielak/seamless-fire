"""Stage A of the daily near real-time update: inputs that need the raw data (run locally).

1. Daily S-NPP history, public/data/{CC}/daily/mMM.json: cell-days per (0.1° cell, day) for one
   calendar month over all years (Feb 2012 - LAST_COMPLETE_MONTH), from the pipeline cache.
   The site sums the cells of an area up to a given day of the month ("1-14 November in 2012-2025").
2. Seed of the live store, live/nrt/{CC}.csv: NOAA-20 vegetation detections after
   LAST_COMPLETE_MONTH from the local 2026 files (same filters as build_data: one row per
   detection, industrial mask for rows without `type`), and live/coverage.json.

The live period is NOAA-20 only (scaled by model.json n20_factor on the site): S-NPP near
real-time data end between 2026-10-31 (PL) and 2026-11-02, so the switch is at the month boundary.

Needs build_data.py to have run (pipeline/cache/{CC}_celldays.parquet, live/masks/{CC}.json).
Usage: python pipeline/live_base.py [CC ...]
"""

import json
import sys

import numpy as np
import pandas as pd

from build_data import DETECTION_KEY, LAST_DATE, assign_nrt_type, file_year, raw_files, read_file
from config import CACHE_DIR, COUNTRIES, ENCODING, LIVE_DIR, OUT_DIR

DAILY_FIRST_YEAR = 2012
LIVE_SENSOR = "N20"
NRT_COLUMNS = ["date", "time", "lat", "lon", "sensor", "frp"]


def load_mask(code: str) -> np.ndarray:
    data = json.loads((LIVE_DIR / "masks" / f"{code}.json").read_text(encoding=ENCODING))
    return np.asarray(data["keys"], dtype=np.int64)


def write_daily(code: str) -> dict:
    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    s = cd[(cd["sat"] == "SNPP") & (cd["date"] <= LAST_DATE)]
    year = s["date"].dt.year.to_numpy()
    out_dir = OUT_DIR / code / "daily"
    out_dir.mkdir(parents=True, exist_ok=True)
    sizes = []
    for mo in range(1, 13):
        g = s[s["date"].dt.month.to_numpy() == mo]
        y = g["date"].dt.year.to_numpy()
        d = (y - DAILY_FIRST_YEAR) * 32 + g["date"].dt.day.to_numpy()
        order = np.lexsort((d, g["lon_i"].to_numpy(), g["lat_i"].to_numpy()))
        path = out_dir / f"m{mo:02d}.json"
        path.write_text(json.dumps({
            "first_year": DAILY_FIRST_YEAR,
            "lat": g["lat_i"].to_numpy()[order].tolist(),
            "lon": g["lon_i"].to_numpy()[order].tolist(),
            "d": d[order].astype(int).tolist(),  # (year - first_year) * 32 + day of month
        }, separators=(",", ":")), encoding=ENCODING)
        sizes.append(path.stat().st_size)
    return {"rows": len(s), "years": [int(year.min()), int(year.max())],
            "mb": round(sum(sizes) / 1e6, 2), "largest_mb": round(max(sizes) / 1e6, 2)}


def seed_nrt(code: str) -> dict:
    """NOAA-20 vegetation detections after LAST_DATE from the local 2026 files."""
    mask = load_mask(code)
    files = [f for f in raw_files(code) if (file_year(f) or 0) > LAST_DATE.year - 1 and "jpss1" in f.name.lower()]
    parts, last = [], None
    for f in files:
        df = read_file(f)
        df = df[(df["sat"] == LIVE_SENSOR) & (df["acq_date"] > LAST_DATE.strftime("%Y-%m-%d"))]
        if df.empty:
            continue
        last = max(last or "", df["acq_date"].max())
        df = assign_nrt_type(df.drop_duplicates(DETECTION_KEY), mask, f)
        veg = df[df["type"] == 0]
        parts.append(pd.DataFrame({
            "date": veg["acq_date"].to_numpy(), "time": veg["acq_time"].to_numpy(),
            "lat": veg["latitude"].round(5).to_numpy(), "lon": veg["longitude"].round(5).to_numpy(),
            "sensor": LIVE_SENSOR, "frp": veg["frp"].to_numpy(),
        }))
    nrt = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=NRT_COLUMNS)
    nrt = nrt.drop_duplicates(["date", "time", "lat", "lon", "sensor"]).sort_values(
        ["date", "time", "lat", "lon"], ignore_index=True)
    path = LIVE_DIR / "nrt" / f"{code}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    nrt.to_csv(path, index=False, encoding=ENCODING, lineterminator="\n")
    return {"rows": len(nrt), "last_file_date": last}


def main(args: list[str]) -> None:
    codes = [a for a in args if not a.startswith("--")] or list(COUNTRIES)
    cov_path = LIVE_DIR / "coverage.json"
    coverage = json.loads(cov_path.read_text(encoding=ENCODING)) if cov_path.exists() else {}
    first_live = (LAST_DATE + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    for code in codes:
        daily = write_daily(code)
        seed = seed_nrt(code)
        # Days covered by the seed: first live day to the last day in the local NOAA-20 file.
        # That last day may be partial; the daily update re-reads it (rows are deduplicated).
        coverage[code] = {"sensor": LIVE_SENSOR, "first": first_live,
                          "last": seed["last_file_date"], "gaps": [], "sources": ["FIRMS country file (local seed)"]}
        print(f"{code}: daily {daily}, live seed {seed}")
    cov_path.write_text(json.dumps(coverage, indent=1), encoding=ENCODING)


if __name__ == "__main__":
    main(sys.argv[1:])
