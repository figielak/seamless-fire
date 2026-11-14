"""Rebuild public/data/ from raw FIRMS CSV files.

Stage 1: load, filter `type == 0`, cell-days -> countries.json, {CC}/cells.json,
plus a cell-day cache in pipeline/cache/ for later stages.

Usage: python pipeline/build_data.py [CC ...]
"""

import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from config import (
    CACHE_DIR, COUNTRIES, ENCODING, FILENAME_MAP, FIRST_MONTH, LAST_YEAR_STAGE1,
    OUT_DIR, RAW_DIR, SATELLITE_NAMES, SATELLITE_SENSOR,
)

WANTED_COLS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "frp", "type", "version"]
CELL_KEYS = ["sat", "lat_i", "lon_i", "date"]
FIRST_PERIOD = pd.Period(FIRST_MONTH, freq="M")


def raw_files(code: str) -> list[Path]:
    """All raw CSV files for a country, skipping browser duplicates like 'Poland(1).csv'."""
    return sorted(
        p for p in (RAW_DIR / COUNTRIES[code]).rglob("*.csv")
        if "(" not in p.name
    )


def file_year(path: Path) -> int | None:
    m = re.search(r"_(\d{4})_", path.name)
    return int(m.group(1)) if m else None


def sensor_from_name(name: str) -> str | None:
    for frag, sensor in FILENAME_MAP.items():
        if frag in name:
            return sensor
    return None


def cell_index(deg: pd.Series) -> np.ndarray:
    """Absolute 0.1° cell index; the cell center is (i + 0.5) / 10."""
    return np.floor(deg.to_numpy() * 10 + 1e-9).astype(np.int32)


def read_file(path: Path) -> pd.DataFrame:
    header = pd.read_csv(path, nrows=0, encoding=ENCODING).columns
    cols = [c for c in WANTED_COLS if c in header]
    df = pd.read_csv(
        path, usecols=cols, encoding=ENCODING,
        dtype={"acq_time": str, "satellite": str, "version": str},
    )
    if "type" not in df:
        raise ValueError(f"{path.name}: no `type` column (industrial mask is stage 4)")

    # Normalized satellite from the `satellite` column; file name only as fallback.
    sat = df["satellite"].map(SATELLITE_NAMES) if "satellite" in df else pd.Series(pd.NA, index=df.index)
    if sat.isna().any():
        fallback = sensor_from_name(path.name)
        if fallback not in ("SNPP", "N20"):  # MODIS cannot be split into Terra/Aqua by name
            bad = df.loc[sat.isna(), "satellite"].unique()[:5] if "satellite" in df else "missing column"
            raise ValueError(f"{path.name}: unknown satellite values {bad}")
        sat = sat.fillna(fallback)
    df["sat"] = sat
    return df


def process_file(path: Path) -> tuple[pd.DataFrame, pd.DataFrame, list[float]]:
    """Return (unique cell-days of type 0, detection counts per sat x type, [W, S, E, N])."""
    df = read_file(path)
    stats = df.groupby(["sat", "type"]).size().rename("n").reset_index()
    bbox = [df.longitude.min(), df.latitude.min(), df.longitude.max(), df.latitude.max()]

    veg = df[df["type"] == 0]
    cells = pd.DataFrame({
        "sat": veg["sat"].to_numpy(),
        "lat_i": cell_index(veg["latitude"]),
        "lon_i": cell_index(veg["longitude"]),
        "date": pd.to_datetime(veg["acq_date"], format="%Y-%m-%d").to_numpy(),
    }).drop_duplicates()
    return cells, stats, bbox


def build_country(code: str) -> dict:
    t0 = time.time()
    files = [f for f in raw_files(code) if (file_year(f) or 0) <= LAST_YEAR_STAGE1]
    parts, stats_parts, bboxes = [], [], []
    for f in files:
        cells, stats, bbox = process_file(f)
        parts.append(cells)
        stats_parts.append(stats)
        bboxes.append(bbox)

    celldays = pd.concat(parts, ignore_index=True).drop_duplicates(CELL_KEYS)
    celldays["sat"] = celldays["sat"].astype("category")
    celldays = celldays.sort_values(CELL_KEYS, ignore_index=True)
    stats = pd.concat(stats_parts).groupby(["sat", "type"])["n"].sum()

    # Cache for stage 2 (validation, NOAA-20 factor, spatial agreement, Terra-only ratio).
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    celldays.to_parquet(CACHE_DIR / f"{code}_celldays.parquet", index=False)
    stats_json = {
        sat: {str(int(t)): int(n) for t, n in grp.droplevel(0).items()}
        for sat, grp in stats.groupby(level=0)
    }
    (CACHE_DIR / f"{code}_filter_stats.json").write_text(json.dumps(stats_json, indent=1))

    write_cells_json(code, celldays)

    b = np.array(bboxes)
    bbox = [
        float(np.floor(b[:, 0].min() * 10) / 10), float(np.floor(b[:, 1].min() * 10) / 10),
        float(np.ceil(b[:, 2].max() * 10) / 10), float(np.ceil(b[:, 3].max() * 10) / 10),
    ]
    print(f"{code}: {len(files)} files, {len(celldays):,} cell-days (all sats), "
          f"{time.time() - t0:.1f} s")
    return {"code": code, "name": COUNTRIES[code], "bbox": bbox}


def write_cells_json(code: str, celldays: pd.DataFrame) -> None:
    """Cell x month table: MODIS (Terra ∪ Aqua) and VIIRS (S-NPP scale) cell-days."""
    cd = celldays.copy()
    cd["sensor"] = cd["sat"].map(SATELLITE_SENSOR).astype(str)
    # MODIS = Terra + Aqua combined: a cell-day counts once even if both saw it.
    cd = cd.drop_duplicates(["sensor", "lat_i", "lon_i", "date"])
    cd["m"] = (cd["date"].dt.to_period("M") - FIRST_PERIOD).map(lambda x: x.n).astype(np.int32)

    counts = (
        cd[cd["sensor"].isin(["MODIS", "SNPP"])]
        .groupby(["lat_i", "lon_i", "m", "sensor"]).size()
        .unstack("sensor", fill_value=0)
        .reindex(columns=["MODIS", "SNPP"], fill_value=0)
        .reset_index()
    )
    counts = counts[(counts["MODIS"] > 0) | (counts["SNPP"] > 0)]
    out = {
        "first_month": FIRST_MONTH,
        "cell_deg": 0.1,
        "cols": ["lat", "lon", "m", "modis", "viirs"],
        "lat": counts["lat_i"].tolist(),
        "lon": counts["lon_i"].tolist(),
        "m": counts["m"].tolist(),
        "modis": counts["MODIS"].tolist(),
        "viirs": counts["SNPP"].tolist(),
    }
    path = OUT_DIR / code / "cells.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  {path.relative_to(OUT_DIR.parent.parent)}: {len(counts):,} rows, "
          f"{path.stat().st_size / 1e6:.2f} MB")


def main(codes: list[str]) -> None:
    unknown = [c for c in codes if c not in COUNTRIES]
    if unknown:
        sys.exit(f"Unknown country codes: {unknown}")

    # countries.json keeps entries built earlier so countries can be rebuilt one at a time.
    countries_path = OUT_DIR / "countries.json"
    existing = {}
    if countries_path.exists():
        existing = {c["code"]: c for c in json.loads(countries_path.read_text(encoding="utf-8"))}
    for code in codes:
        existing[code] = build_country(code)

    ordered = [existing[c] for c in COUNTRIES if c in existing]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    countries_path.write_text(json.dumps(ordered, separators=(",", ":")), encoding="utf-8")
    print(f"countries.json: {[c['code'] for c in ordered]}")


if __name__ == "__main__":
    main(sys.argv[1:] or list(COUNTRIES))
