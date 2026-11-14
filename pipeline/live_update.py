"""Stage B of the daily near real-time update (runs in GitHub Actions, no raw data needed).

1. Download the FIRMS global NOAA-20 VIIRS near real-time file (last 7 days, public, no key).
2. Per country: keep points inside the country (live/borders.json), drop the frozen industrial
   mask (live/masks/{CC}.json; NRT rows have no `type`), add new rows to live/nrt/{CC}.csv.
3. Update live/coverage.json: complete days covered (the newest UTC day in the file is still
   being filled, so coverage ends the day before; its rows are kept and completed next run).
   Days missing between runs (more than 7 days without an update) are listed as gaps.
4. Write public/data/{CC}/live.json (cell-days per 0.1° cell and day, for the site) and
   public/data/{CC}/hotspots/live.csv (points for the map and CSV export; not AU/CA).

Files are rewritten only when something changed, so a run without new data leaves no diff.
Usage: python pipeline/live_update.py [--file path/to/J1_VIIRS_C2_Global_7d.csv] [CC ...]
"""

import io
import json
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from borders import in_country, load as load_borders
from config import CELL_DEG, COUNTRIES, ENCODING, HOTSPOT_COUNTRIES, LIVE_DIR, OUT_DIR

SOURCE_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv"
SOURCE_NAME = "FIRMS NOAA-20 VIIRS NRT global 7d"
SENSOR = "N20"
NRT_COLUMNS = ["date", "time", "lat", "lon", "sensor", "frp"]
KEY = ["date", "time", "lat", "lon", "sensor"]
REQUIRED = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "frp"]
MIN_ROWS = 10_000  # a global 7-day file has hundreds of thousands of rows; fewer = broken download


def mask_keys(lat, lon) -> np.ndarray:
    """0.01° cell key, same as build_data.mask_keys (not imported: build_data needs raw-data config)."""
    li = np.floor(np.asarray(lat, float) * 100 + 1e-9).astype(np.int64)
    lj = np.floor(np.asarray(lon, float) * 100 + 1e-9).astype(np.int64)
    return li * 100_000 + lj


def fetch(path: str | None) -> pd.DataFrame:
    if path:
        text = open(path, encoding=ENCODING).read()
    else:
        req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "seamless-fire-update"})
        with urllib.request.urlopen(req, timeout=600) as r:
            text = r.read().decode(ENCODING)
    df = pd.read_csv(io.StringIO(text), dtype={"acq_time": str, "satellite": str}, encoding=ENCODING)
    missing = [c for c in REQUIRED if c not in df]
    if missing:
        raise SystemExit(f"source file lacks columns {missing}; nothing changed")
    if len(df) < MIN_ROWS:
        raise SystemExit(f"source file has only {len(df)} rows; nothing changed")
    df = df[df["satellite"].isin(["N20", "J1", "NOAA-20"])]
    df = df.dropna(subset=["latitude", "longitude", "acq_date", "acq_time"])
    df["acq_time"] = df["acq_time"].str.zfill(4)
    return df


def to_nrt(df: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({
        "date": df["acq_date"].to_numpy(), "time": df["acq_time"].to_numpy(),
        "lat": df["latitude"].round(5).to_numpy(), "lon": df["longitude"].round(5).to_numpy(),
        "sensor": SENSOR, "frp": df["frp"].to_numpy(),
    })


def read_store(code: str) -> pd.DataFrame:
    path = LIVE_DIR / "nrt" / f"{code}.csv"
    if not path.exists():
        return pd.DataFrame(columns=NRT_COLUMNS)
    return pd.read_csv(path, dtype={"time": str, "date": str, "sensor": str}, encoding=ENCODING)


def merge(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    both = pd.concat([old, new], ignore_index=True)
    both["lat"] = both["lat"].astype(float).round(5)
    both["lon"] = both["lon"].astype(float).round(5)
    return both.drop_duplicates(KEY).sort_values(["date", "time", "lat", "lon"], ignore_index=True)


def days(a: str, b: str) -> list[str]:
    d0, d1 = date.fromisoformat(a), date.fromisoformat(b)
    return [(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]


def update_coverage(cov: dict, file_first: str, file_last: str) -> dict:
    """Complete days end the day before the newest day in the file."""
    complete_last = (date.fromisoformat(file_last) - timedelta(days=1)).isoformat()
    cov = dict(cov)
    gaps = set(cov.get("gaps", []))
    if cov.get("last") and file_first > cov["last"]:
        nxt = (date.fromisoformat(cov["last"]) + timedelta(days=1)).isoformat()
        prev = (date.fromisoformat(file_first) - timedelta(days=1)).isoformat()
        if nxt <= prev:
            gaps.update(days(nxt, prev))
    if not cov.get("last") or complete_last > cov["last"]:
        cov["last"] = complete_last
    cov["gaps"] = sorted(gaps)
    sources = list(cov.get("sources", []))
    if SOURCE_NAME not in sources:
        sources.append(SOURCE_NAME)
    cov["sources"] = sources
    return cov


def live_json(code: str, nrt: pd.DataFrame, cov: dict) -> dict:
    """Unique (0.1° cell, day) pairs with >= 1 vegetation detection, days first..last."""
    n = nrt[(nrt["date"] >= cov["first"]) & (nrt["date"] <= cov["last"])]
    lat_i = np.floor(n["lat"].to_numpy(float) / CELL_DEG + 1e-9).astype(int)
    lon_i = np.floor(n["lon"].to_numpy(float) / CELL_DEG + 1e-9).astype(int)
    day = (pd.to_datetime(n["date"]) - pd.Timestamp(cov["first"])).dt.days.to_numpy()
    g = (pd.DataFrame({"lat": lat_i, "lon": lon_i, "day": day})
         .groupby(["lat", "lon", "day"]).size().rename("det").reset_index()
         .sort_values(["day", "lat", "lon"]))
    return {
        "sensor": cov["sensor"], "first": cov["first"], "last": cov["last"], "gaps": cov["gaps"],
        "cell_deg": CELL_DEG,
        # one row per cell-day: grid indices, day since `first`, raw detections (display only)
        "lat": g["lat"].astype(int).tolist(), "lon": g["lon"].astype(int).tolist(),
        "day": g["day"].astype(int).tolist(), "det": g["det"].astype(int).tolist(),
    }


def write_if_changed(path, text: str) -> bool:
    if path.exists() and path.read_text(encoding=ENCODING) == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding=ENCODING)
    return True


def main(args: list[str]) -> None:
    file_arg = None
    if "--file" in args:
        i = args.index("--file")
        file_arg = args[i + 1]
        args = args[:i] + args[i + 2:]
    codes = args or list(COUNTRIES)
    src = fetch(file_arg)
    file_first, file_last = src["acq_date"].min(), src["acq_date"].max()
    print(f"source: {len(src):,} NOAA-20 rows, {file_first} .. {file_last}")

    borders = load_borders()["countries"]
    cov_path = LIVE_DIR / "coverage.json"
    coverage = json.loads(cov_path.read_text(encoding=ENCODING))
    changed = []
    for code in codes:
        cov = coverage[code]
        pts = src[src["acq_date"] >= cov["first"]]
        pts = pts[in_country(pts["longitude"].to_numpy(), pts["latitude"].to_numpy(), borders[code])]
        mask = np.asarray(json.loads((LIVE_DIR / "masks" / f"{code}.json").read_text(encoding=ENCODING))["keys"])
        industrial = np.isin(mask_keys(pts["latitude"], pts["longitude"]), mask)
        old = read_store(code)
        nrt = merge(old, to_nrt(pts[~industrial]))
        new_cov = update_coverage(cov, file_first, file_last)
        added = len(nrt) - len(old)

        c1 = write_if_changed(LIVE_DIR / "nrt" / f"{code}.csv",
                              nrt.to_csv(index=False, lineterminator="\n"))
        c2 = write_if_changed(OUT_DIR / code / "live.json",
                              json.dumps(live_json(code, nrt, new_cov), separators=(",", ":")))
        c3 = False
        if code in HOTSPOT_COUNTRIES:
            pts_out = nrt[nrt["date"] <= new_cov["last"]]
            c3 = write_if_changed(OUT_DIR / code / "hotspots" / "live.csv",
                                  pts_out.to_csv(index=False, lineterminator="\n"))
        if c1 or c2 or c3 or new_cov != cov:
            new_cov["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
            coverage[code] = new_cov
            changed.append(code)
        print(f"{code}: +{added:,} rows ({int(industrial.sum())} industrial dropped), "
              f"store {len(nrt):,}, complete through {new_cov['last']}"
              + (f", gaps {new_cov['gaps']}" if new_cov["gaps"] else ""))
    if changed:
        cov_path.write_text(json.dumps(coverage, indent=1), encoding=ENCODING)
    print(f"changed: {changed or 'nothing'}")


if __name__ == "__main__":
    main(sys.argv[1:])
