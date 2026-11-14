"""Out-of-sample check of the industrial mask used for near real-time rows (no `type`).

The 2026 archive rows (2026-01..07) still have `type`. We hide it, apply masks built from
VIIRS detections 2012-2025, and compare S-NPP type-0 cell-days with the truth.
Masks: a 0.01° cell is masked when type 2 is at least `min_share` of its VIIRS detections
(0 = any type 2 detection).

Run: python pipeline/mask_check.py [CC ...]  -> pipeline/cache/mask_check.json
"""

import json
import sys

import numpy as np
import pandas as pd

from build_data import DETECTION_KEY, VIIRS_SATS, build_mask, cell_index, file_year, mask_keys, raw_files, read_file
from config import CACHE_DIR, COUNTRIES, HIST_LAST_YEAR, INDUSTRIAL_MASK_YEARS

SHARES = [0.0, 0.25, 0.5, 0.75, 0.9]


def check(code: str) -> list[dict]:
    counts, archive = [], []
    for f in raw_files(code):
        if file_year(f) < INDUSTRIAL_MASK_YEARS[0]:
            continue
        df = read_file(f)
        df = df[df["sat"].isin(VIIRS_SATS)].drop_duplicates(DETECTION_KEY)
        if df.empty:
            continue
        if file_year(f) <= HIST_LAST_YEAR:
            counts.append(pd.DataFrame({"k": mask_keys(df["latitude"], df["longitude"]),
                                        "t2": (df["type"] == 2).to_numpy(int), "n": 1}))
        else:
            archive.append(df[~df["nrt"]])
    counts = pd.concat(counts, ignore_index=True)
    a = pd.concat(archive, ignore_index=True)
    a["k"] = mask_keys(a["latitude"], a["longitude"])
    a["cell"] = cell_index(a["latitude"]).astype(np.int64) * 100_000 + cell_index(a["longitude"])
    a["month"] = a["acq_date"].str[:7]

    def celldays(rows: pd.DataFrame) -> pd.Series:
        r = rows[rows["sat"] == "SNPP"]
        return r.drop_duplicates(["cell", "acq_date"]).groupby("month").size()

    truth = celldays(a[a["type"] == 0])
    t = a["type"].to_numpy()
    out = []
    for share in SHARES:
        hit = np.isin(a["k"].to_numpy(), build_mask(counts, share))
        est = celldays(a[~hit]).reindex(truth.index, fill_value=0)
        out.append({
            "code": code, "min_share": share,
            "type2_caught": float(((t == 2) & hit).sum() / max((t == 2).sum(), 1)),
            "type0_cut": float(((t == 0) & hit).sum() / max((t == 0).sum(), 1)),
            "celldays_error": float(est.sum() / truth.sum() - 1),
            "monthly_logrmse": float(np.sqrt(np.mean((np.log1p(est) - np.log1p(truth)) ** 2))),
            "months": len(truth),
        })
    return out


def main(codes: list[str]) -> None:
    rows = []
    for code in codes or list(COUNTRIES):
        rows += check(code)
        print(pd.DataFrame([r for r in rows if r["code"] == code]).round(3).to_string(index=False))
    path = CACHE_DIR / "mask_check.json"
    path.write_text(json.dumps(rows, indent=1))
    print(f"-> {path}")


if __name__ == "__main__":
    main(sys.argv[1:])
