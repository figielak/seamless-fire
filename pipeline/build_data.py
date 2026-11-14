"""Rebuild public/data/ from raw FIRMS CSV files.

Stage 1: load, filter `type == 0`, cell-days -> countries.json, {CC}/cells.json,
plus a cell-day cache in pipeline/cache/ for later stages.
Stage 2 (model.py): validation of methods A-E -> {CC}/model.json.
Stage 4: 2026 files (near real-time rows without `type` -> industrial mask), preliminary months,
VIIRS detections per cell-month, hotspot CSV files.

Files are read in two phases: all historical files (year <= HIST_LAST_YEAR) first, then the
industrial mask is frozen, then the newer files. Each file is read once.

Usage: python pipeline/build_data.py [--model-only] [CC ...]
"""

import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from model import build_models
from config import (
    CACHE_DIR, COUNTRIES, ENCODING, FILENAME_MAP, FIRST_MONTH, HIST_LAST_YEAR, HOTSPOT_COUNTRIES,
    INDUSTRIAL_MASK_MIN_SHARE, INDUSTRIAL_MASK_YEARS, LAST_COMPLETE_MONTH, OUT_DIR, RAW_DIR,
    SATELLITE_NAMES, SATELLITE_SENSOR,
)

WANTED_COLS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "frp", "type", "version"]
CELL_KEYS = ["sat", "lat_i", "lon_i", "date"]
# One detection: raw values from the file, before any rounding. Shared by cell-days,
# detection counts and the hotspot export.
DETECTION_KEY = ["sat", "latitude", "longitude", "acq_date", "acq_time"]
FIRST_PERIOD = pd.Period(FIRST_MONTH, freq="M")
LAST_DATE = pd.Period(LAST_COMPLETE_MONTH, freq="M").end_time.normalize()
VIIRS_SATS = ("SNPP", "N20")


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


def mask_keys(lat, lon) -> np.ndarray:
    """0.01° industrial-mask cell key (int64)."""
    li = np.floor(np.asarray(lat, float) * 100 + 1e-9).astype(np.int64)
    lj = np.floor(np.asarray(lon, float) * 100 + 1e-9).astype(np.int64)
    return li * 100_000 + lj


def build_mask(counts: pd.DataFrame, min_share: float) -> np.ndarray:
    """Keys of 0.01° cells where type 2 is at least `min_share` of VIIRS detections
    (min_share 0 = any type 2 detection)."""
    g = counts.groupby("k")[["t2", "n"]].sum()
    keep = (g["t2"] > 0) & (g["t2"] / g["n"] >= min_share)
    return np.sort(g.index[keep].to_numpy(np.int64))


def read_file(path: Path) -> pd.DataFrame:
    """Raw rows with a normalized `sat` and a boolean `nrt` (near real-time, `type` unknown)."""
    header = pd.read_csv(path, nrows=0, encoding=ENCODING).columns
    cols = [c for c in WANTED_COLS if c in header]
    df = pd.read_csv(
        path, usecols=cols, encoding=ENCODING,
        dtype={"acq_time": str, "satellite": str, "version": str},
    )
    if "type" not in df:
        df["type"] = np.nan
        df["nrt"] = True  # no `type` at all: every row needs the industrial mask
    elif "version" in df:
        df["nrt"] = df["version"].str.contains("NRT", na=False).to_numpy()
    else:
        df["nrt"] = False

    # A truncated download leaves an incomplete last row; drop it loudly, never silently.
    broken = df[["latitude", "longitude", "acq_date"]].isna().any(axis=1) | (df["type"].isna() & ~df["nrt"])
    if broken.any():
        print(f"  WARNING {path.name}: dropped {broken.sum()} incomplete row(s), "
              f"last date {df.loc[~broken, 'acq_date'].max()} (truncated file?)")
        df = df[~broken].copy()

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


@dataclass
class FileResult:
    cells: pd.DataFrame          # unique type-0 cell-days (sat, lat_i, lon_i, date)
    detections: pd.DataFrame     # type-0 detections per (sat, lat_i, lon_i, m)
    stats: pd.DataFrame          # rows per (sat, type), only rows with a real `type`
    bbox: list[float]
    sat_dates: dict              # sat -> (first, last) acq_date of all rows before the cut
    preliminary: set             # "YYYY-MM" months with near real-time rows
    industrial: pd.DataFrame     # VIIRS detections per 0.01° cell: k, t2, n (mask source)
    hotspots: pd.DataFrame | None = None
    n_nrt: int = 0               # near real-time rows (after the cut)
    n_masked: int = 0            # of those, removed by the industrial mask
    mask_eval: dict = field(default_factory=dict)


def assign_nrt_type(df: pd.DataFrame, mask: np.ndarray | None, path: Path) -> pd.DataFrame:
    """Near real-time rows (no `type`): in the industrial mask -> 2, else 0."""
    if not df["nrt"].any():
        return df
    if mask is None:
        raise ValueError(f"{path.name}: rows without `type` but no industrial mask yet")
    nrt = df["nrt"].to_numpy()
    in_mask = np.isin(mask_keys(df.loc[nrt, "latitude"], df.loc[nrt, "longitude"]), mask)
    df = df.copy()
    df.loc[nrt, "type"] = np.where(in_mask, 2, 0)
    return df


def evaluate_mask(df: pd.DataFrame, masks: dict) -> dict:
    """Out-of-sample check: apply the mask to VIIRS rows that do have `type`."""
    rows = df[~df["nrt"] & df["sat"].isin(VIIRS_SATS)]
    if rows.empty:
        return {}
    keys = mask_keys(rows["latitude"], rows["longitude"])
    t = rows["type"].to_numpy()
    out = {}
    for name, mask in masks.items():
        hit = np.isin(keys, mask)
        out[name] = {
            "t2": int((t == 2).sum()), "t2_in": int(((t == 2) & hit).sum()),
            "t0": int((t == 0).sum()), "t0_in": int(((t == 0) & hit).sum()),
            "other": int(((t != 0) & (t != 2)).sum()), "other_in": int(((t != 0) & (t != 2) & hit).sum()),
        }
    return out


def process_file(path: Path, mask: np.ndarray | None = None, eval_masks: dict | None = None,
                 hotspots: bool = False) -> FileResult:
    df = read_file(path)
    sat_dates = {s: (g.min(), g.max()) for s, g in df.groupby("sat")["acq_date"]}

    # 1. Coverage cut (November 2026 is partial).
    date = pd.to_datetime(df["acq_date"], format="%Y-%m-%d")
    keep = (date <= LAST_DATE).to_numpy()
    df, date = df[keep], date[keep]

    # 2. Preliminary months: any near real-time row, before the vegetation filter.
    preliminary = set(date[df["nrt"].to_numpy()].dt.strftime("%Y-%m"))

    # 3. Archive wins over near real-time: per satellite, NRT rows only after the last archive day.
    if df["nrt"].any() and (~df["nrt"]).any():
        last_arch = df[~df["nrt"]].groupby("sat")["acq_date"].max()
        nrt_ok = df["acq_date"] > df["sat"].map(last_arch).fillna("")
        df = df[~df["nrt"] | nrt_ok]

    # 4. One row per detection.
    df = df.drop_duplicates(DETECTION_KEY)

    mask_eval = evaluate_mask(df, eval_masks) if eval_masks else {}
    real = df[~df["nrt"]]
    stats = real.groupby(["sat", "type"]).size().rename("n").reset_index()
    ind = real[real["sat"].isin(VIIRS_SATS)]
    ind = ind[pd.to_datetime(ind["acq_date"]).dt.year.between(*INDUSTRIAL_MASK_YEARS)]
    industrial = (pd.DataFrame({"k": mask_keys(ind["latitude"], ind["longitude"]),
                                "t2": (ind["type"] == 2).to_numpy(int)})
                  .groupby("k")["t2"].agg(["sum", "size"]).set_axis(["t2", "n"], axis=1).reset_index())

    n_nrt = int(df["nrt"].sum())
    df = assign_nrt_type(df, mask, path)
    n_masked = int((df["nrt"] & (df["type"] == 2)).sum())

    bbox = [df.longitude.min(), df.latitude.min(), df.longitude.max(), df.latitude.max()]
    veg = df[df["type"] == 0]
    vdate = pd.to_datetime(veg["acq_date"], format="%Y-%m-%d")
    base = pd.DataFrame({
        "sat": veg["sat"].to_numpy(),
        "lat_i": cell_index(veg["latitude"]),
        "lon_i": cell_index(veg["longitude"]),
        "date": vdate.to_numpy(),
    })
    cells = base.drop_duplicates()
    m = (vdate.dt.year.to_numpy() - FIRST_PERIOD.year) * 12 + vdate.dt.month.to_numpy() - FIRST_PERIOD.month
    detections = (base.drop(columns="date").assign(m=m.astype(np.int32))
                  .groupby(["sat", "lat_i", "lon_i", "m"]).size().rename("n").reset_index())
    hs = None
    if hotspots:
        hs = pd.DataFrame({
            "date": veg["acq_date"].to_numpy(), "time": veg["acq_time"].to_numpy(),
            "lat": veg["latitude"].round(5).to_numpy(), "lon": veg["longitude"].round(5).to_numpy(),
            "sensor": veg["sat"].to_numpy(), "frp": veg["frp"].to_numpy(),
        })
    return FileResult(cells, detections, stats, bbox, sat_dates, preliminary, industrial,
                      hs, n_nrt, n_masked, mask_eval)


def check_date_ranges(results: list[tuple[Path, FileResult]]) -> None:
    """Files of the same satellite must not overlap in dates (per-file dedup is then enough)."""
    spans = sorted((s, a, b, p.name) for p, r in results for s, (a, b) in r.sat_dates.items())
    for (s1, a1, b1, n1), (s2, a2, b2, n2) in zip(spans, spans[1:]):
        if s1 == s2 and a2 <= b1:
            raise ValueError(f"{s1}: {n1} ({a1}..{b1}) overlaps {n2} ({a2}..{b2})")


def build_country(code: str) -> dict:
    t0 = time.time()
    files = raw_files(code)
    hist = [f for f in files if (file_year(f) or 0) <= HIST_LAST_YEAR]
    new = [f for f in files if (file_year(f) or 0) > HIST_LAST_YEAR]
    want_hs = code in HOTSPOT_COUNTRIES

    # Phase 1: historical files (real `type`), source of the industrial mask.
    results = [(f, process_file(f, hotspots=want_hs)) for f in hist]
    counts = pd.concat([r.industrial for _, r in results], ignore_index=True)
    mask = build_mask(counts, INDUSTRIAL_MASK_MIN_SHARE)

    # Phase 2: newer files with the frozen mask (and the rejected "any type 2" rule for comparison).
    eval_masks = {"majority": mask, "any": build_mask(counts, 0.0)}
    results += [(f, process_file(f, mask, eval_masks, want_hs)) for f in new]
    check_date_ranges(results)

    celldays = pd.concat([r.cells for _, r in results], ignore_index=True).drop_duplicates(CELL_KEYS)
    celldays["sat"] = celldays["sat"].astype("category")
    celldays = celldays.sort_values(CELL_KEYS, ignore_index=True)
    detections = (pd.concat([r.detections for _, r in results], ignore_index=True)
                  .groupby(["sat", "lat_i", "lon_i", "m"], as_index=False)["n"].sum())
    # Filter statistics: historical files only, so the industrial share stays fixed.
    stats = pd.concat([r.stats for f, r in results if f in hist]).groupby(["sat", "type"])["n"].sum()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    celldays.to_parquet(CACHE_DIR / f"{code}_celldays.parquet", index=False)
    detections.to_parquet(CACHE_DIR / f"{code}_detections.parquet", index=False)
    stats_json = {
        sat: {str(int(t)): int(n) for t, n in grp.droplevel(0).items()}
        for sat, grp in stats.groupby(level=0)
    }
    (CACHE_DIR / f"{code}_filter_stats.json").write_text(json.dumps(stats_json, indent=1))

    sat_dates: dict[str, list[str]] = {}
    years_by_sat: dict[str, set] = {}
    for f, r in results:
        for s, (a, b) in r.sat_dates.items():
            lo, hi = sat_dates.get(s, [a, b])
            sat_dates[s] = [min(lo, a), max(hi, b)]
            years_by_sat.setdefault(s, set()).update(range(int(a[:4]), min(int(b[:4]), LAST_DATE.year) + 1))
    mask_eval = sum_eval([r.mask_eval for _, r in results])
    meta = {
        "last_complete_month": LAST_COMPLETE_MONTH,
        "files": [[f.name, f.stat().st_size] for f in files],
        "preliminary": sorted(set().union(*(r.preliminary for _, r in results))),
        "coverage": sat_dates,
        "sensors_by_year": {str(y): sorted(s for s, ys in years_by_sat.items() if y in ys)
                            for y in sorted(set().union(*years_by_sat.values()))},
        "hotspots": want_hs,
        "industrial_mask": {
            "years": list(INDUSTRIAL_MASK_YEARS), "min_share": INDUSTRIAL_MASK_MIN_SHARE,
            "cells": int(len(mask)), "nrt_rows": sum(r.n_nrt for _, r in results),
            "nrt_masked": sum(r.n_masked for _, r in results), "eval_2026_archive": mask_eval,
        },
    }
    (CACHE_DIR / f"{code}_meta.json").write_text(json.dumps(meta, indent=1))

    write_cells_json(code, celldays, detections)
    if want_hs:
        write_hotspots(code, [r.hotspots for _, r in results])
    else:
        remove_hotspots(code)

    b = np.array([r.bbox for _, r in results if r.bbox[0] == r.bbox[0]])  # skip empty files (NaN)
    bbox = [
        float(np.floor(b[:, 0].min() * 10) / 10), float(np.floor(b[:, 1].min() * 10) / 10),
        float(np.ceil(b[:, 2].max() * 10) / 10), float(np.ceil(b[:, 3].max() * 10) / 10),
    ]
    im = meta["industrial_mask"]
    print(f"{code}: {len(files)} files, {len(celldays):,} cell-days (all sats), "
          f"preliminary {meta['preliminary']}, NRT rows {im['nrt_rows']:,} "
          f"(masked {im['nrt_masked']:,}), {time.time() - t0:.1f} s")
    for name, e in mask_eval.items():
        if e["t2"]:
            print(f"  mask {name}: 2026 archive type 2 caught {e['t2_in'] / e['t2']:.1%}, "
                  f"type 0 wrongly cut {e['t0_in'] / max(e['t0'], 1):.2%}")
    return {"code": code, "name": COUNTRIES[code], "bbox": bbox}


def sum_eval(evals: list[dict]) -> dict:
    out: dict = {}
    for e in evals:
        for name, counts in e.items():
            acc = out.setdefault(name, dict.fromkeys(counts, 0))
            for k, v in counts.items():
                acc[k] += v
    return out


def write_cells_json(code: str, celldays: pd.DataFrame, detections: pd.DataFrame | None = None) -> None:
    """Cell x month table: MODIS (Terra ∪ Aqua) and VIIRS (S-NPP scale) cell-days,
    plus raw S-NPP detections (shown next to cell-days, not harmonized)."""
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
    if detections is not None:
        det = detections[detections["sat"] == "SNPP"].drop(columns="sat")
        merged = counts[["lat_i", "lon_i", "m"]].merge(det, on=["lat_i", "lon_i", "m"], how="left")
        out["cols"].append("viirs_det")
        out["viirs_det"] = merged["n"].fillna(0).astype(int).tolist()
    path = OUT_DIR / code / "cells.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  {path.relative_to(OUT_DIR.parent.parent)}: {len(counts):,} rows, "
          f"{path.stat().st_size / 1e6:.2f} MB")


def write_hotspots(code: str, parts: list[pd.DataFrame | None]) -> None:
    """{CC}/hotspots/{year}.csv: filtered (type 0) detections, one file per year."""
    hs = pd.concat([p for p in parts if p is not None], ignore_index=True)
    hs = hs.sort_values(["date", "time", "sensor", "lat", "lon"], ignore_index=True)
    out_dir = OUT_DIR / code / "hotspots"
    remove_hotspots(code)
    out_dir.mkdir(parents=True, exist_ok=True)
    sizes = []
    for year, grp in hs.groupby(hs["date"].str[:4]):
        path = out_dir / f"{year}.csv"
        grp.to_csv(path, index=False, encoding=ENCODING, lineterminator="\n")
        sizes.append(path.stat().st_size)
    print(f"  {code}/hotspots: {len(hs):,} rows, {len(sizes)} files, "
          f"{sum(sizes) / 1e6:.1f} MB total, largest {max(sizes) / 1e6:.1f} MB")


def remove_hotspots(code: str) -> None:
    out_dir = OUT_DIR / code / "hotspots"
    if out_dir.exists():
        for p in out_dir.glob("*.csv"):
            p.unlink()


def main(args: list[str]) -> None:
    model_only = "--model-only" in args
    codes = [a for a in args if not a.startswith("--")] or list(COUNTRIES)
    unknown = [c for c in codes if c not in COUNTRIES]
    if unknown:
        sys.exit(f"Unknown country codes: {unknown}")

    if not model_only:
        build_cells(codes)
    print("models:")
    build_models(codes)


def build_cells(codes: list[str]) -> None:
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
    main(sys.argv[1:])
