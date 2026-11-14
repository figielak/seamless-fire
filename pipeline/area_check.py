"""Custom-area check (stage 5): share vs direct model on 2° blocks and presets.

Uses the same LOYO folds as the country validation. Prints a table per country;
the stored part (interval half-widths) is written by build_models into model.json `area`.

Run: python pipeline/area_check.py [CC ...]
"""

import sys

import pandas as pd

from area import area_validation
from config import COUNTRIES
from model import (MIN_FIRE_MONTHS, cached_countries, calib_frame, choose_de, load_celldays,
                   load_meta, monthly_series, validate)


def main(args: list[str]) -> None:
    codes = args or list(COUNTRIES)
    data = {}
    for c in cached_countries():
        load_meta(c, check_files=False)
        cd = load_celldays(c)
        ms = monthly_series(c, cd)
        data[c] = (cd, calib_frame(c, ms))
    frame_all = pd.concat([f for _, f in data.values()])
    print("country blocks | log-RMSE median [p25-p75] direct / share | bias direct / share | "
          "annual median direct / share | share better | h_month h_annual | holdout cov month/annual")
    presets = []
    for code in codes:
        cd, frame = data[code]
        val = validate(frame, frame_all, ["D", "E"])
        variant, fit_frame = choose_de(val), frame
        if int(((frame["M"] > 0) & (frame["V"] > 0)).sum()) < MIN_FIRE_MONTHS:
            pv = validate(frame_all, frame_all, ["D", "E"])
            variant, fit_frame = choose_de(pv), frame_all
        r = area_validation(code, cd, frame, fit_frame, frame_all, variant, with_presets=True)
        d, s = r["methods"]["direct"], r["methods"]["share"]
        cov = r["coverage_holdout"]
        print(f"{code} {variant} {r['n_blocks']:4d} | {d['logrmse_median']:.2f} [{d['logrmse_p25']:.2f}-{d['logrmse_p75']:.2f}]"
              f" / {s['logrmse_median']:.2f} [{s['logrmse_p25']:.2f}-{s['logrmse_p75']:.2f}]"
              f" | {d['bias']:+.2f} / {s['bias']:+.2f} | {d['annual_median']:.0%} / {s['annual_median']:.0%}"
              f" | {r['share_better_blocks']}/{r['n_blocks']} | {r['h_month']:.2f} {r['h_annual']:.2f}"
              f" | {cov['month']:.0%} / {cov['annual']:.0%}")
        print(f"     block-years V=0: {r['zero_v_block_years']} (share > 0 in {r['zero_v_block_years_pred']}); "
              f"months M_area=0, V>0: {r['m0_v_months']} ({r['m0_v_share']:.1%} of block VIIRS)")
        for pid, m in r.get("presets", {}).items():
            presets.append((code, pid, m))
    if presets:
        print("\npresets | log-RMSE direct / share | bias direct / share | annual direct / share | "
              "cov(h_month) | months M=0,V>0")
        for code, pid, m in presets:
            d, s = m["direct"], m["share"]
            print(f"{code} {pid:12s} | {d['logrmse']:.2f} / {s['logrmse']:.2f} | {d['bias']:+.2f} / {s['bias']:+.2f}"
                  f" | {d['annual']:.0%} / {s['annual']:.0%} | {m['share_coverage_month']:.0%}"
                  f" | {m['m0_v_months']} ({m['m0_v_share']:.1%})")


if __name__ == "__main__":
    main(sys.argv[1:])
