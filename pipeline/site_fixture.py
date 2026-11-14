"""Reference monthly series for the site's TypeScript port (src/lib/harmonize.test.ts).

Reads only published files (public/data/{CC}/cells.json + model.json, i.e. the saved
parameters the browser uses) and runs model.harmonized_monthly on the country totals.

Run: python pipeline/site_fixture.py [CC ...]
"""

import json
import sys

import numpy as np
import pandas as pd

from config import COUNTRIES, OUT_DIR, ROOT
from model import harmonized_monthly

FIXTURE_DIR = ROOT / "src" / "lib" / "fixtures"


def country_series(code: str) -> tuple[pd.DataFrame, dict]:
    cells = json.loads((OUT_DIR / code / "cells.json").read_text(encoding="utf-8"))
    model = json.loads((OUT_DIR / code / "model.json").read_text(encoding="utf-8"))
    months = pd.period_range(cells["first_month"], model["last_complete_month"], freq="M")
    m = np.asarray(cells["m"])
    keep = m < len(months)
    modis = np.bincount(m[keep], weights=np.asarray(cells["modis"])[keep], minlength=len(months))
    viirs = np.bincount(m[keep], weights=np.asarray(cells["viirs"])[keep], minlength=len(months))
    # Terra-only months have no Aqua data, so MODIS = Terra there.
    ms = pd.DataFrame({"MODIS": modis, "SNPP": viirs, "Terra": modis}, index=months)
    if "viirs_det" in cells:
        ms["DET"] = np.bincount(m[keep], weights=np.asarray(cells["viirs_det"])[keep], minlength=len(months))
    return ms, model


def build(code: str) -> dict:
    ms, model = country_series(code)
    hm = harmonized_monthly(ms, model["a"], model["b"], model["terra_only"])
    return {
        "first_month": str(ms.index[0]),
        "modis": ms["MODIS"].astype(int).tolist(),
        "viirs": ms["SNPP"].astype(int).tolist(),
        "value": [float(v) for v in hm["harmonized"]],
        "estimated": hm["estimated"].astype(int).tolist(),
        "terra_only": hm["terra_only"].astype(int).tolist(),
        **({"viirs_det": ms["DET"].astype(int).tolist()} if "DET" in ms else {}),
    }


def main(args: list[str]) -> None:
    codes = args or list(COUNTRIES)
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for code in codes:
        path = FIXTURE_DIR / f"{code}.json"
        path.write_text(json.dumps(build(code), separators=(",", ":")), encoding="utf-8")
        print(f"  {path.relative_to(ROOT)} {path.stat().st_size / 1e3:.1f} kB")


if __name__ == "__main__":
    main(sys.argv[1:])
