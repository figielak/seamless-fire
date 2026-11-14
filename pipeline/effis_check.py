"""Independent check of the 2000-2011 reconstruction against EFFIS national statistics (step 3b).

Source: EFFIS "Country totals" (burnt area in ha and number of forest fires, 1980-2024,
national reports), from "Forest fires in Europe, Middle East and North Africa 2024",
JRC, doi:10.2760/0649290. Downloaded manually to data/effis/report_2024.xlsx (not committed).

Idea: if the harmonized series is right before 2012, its relation to EFFIS in 2001-2011
(estimated from MODIS) should look like the relation in 2012-2024 (observed VIIRS):
similar rank correlation and the same level. A naive splice (raw MODIS until 2011, then
VIIRS) should instead show a level jump at 2012. 2000 is skipped (partial Terra year).

Run: python pipeline/effis_check.py   -> prints tables, writes pipeline/cache/effis_check.json
"""

import json
import re
import zipfile
import xml.etree.ElementTree as ET

import numpy as np

from config import CACHE_DIR, OUT_DIR, RAW_DIR

EFFIS_FILE = RAW_DIR / "effis" / "report_2024.xlsx"
ISO3 = {"PL": "POL", "PT": "PRT", "ES": "ESP", "GR": "GRC", "UA": "UKR"}
EARLY = (2001, 2011)
LATE = (2012, 2024)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_xlsx(path) -> dict[str, list[list[str]]]:
    """Minimal stdlib xlsx reader: {sheet name: rows of cell strings}."""
    z = zipfile.ZipFile(path)
    strings = [
        "".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t"))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)
    ]
    names = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS)]
    out = {}
    for i, name in enumerate(names, start=1):
        rows = []
        for r in ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml")).find("m:sheetData", NS):
            row = {}
            for c in r:
                v = c.find("m:v", NS)
                text = "" if v is None else v.text
                if c.get("t") == "s":
                    text = strings[int(text)]
                col = re.match(r"[A-Z]+", c.get("r")).group()
                row[col] = text
            rows.append(row)
        out[name] = rows
    return out


def to_number(s: str) -> float | None:
    s = (s or "").replace(" ", "").replace(" ", "")
    return float(s) if s else None


def effis_series() -> dict[str, dict[str, dict[int, float]]]:
    """{'burnt_area' | 'fires': {ISO3: {year: value}}}."""
    sheets = read_xlsx(EFFIS_FILE)
    result = {}
    for name, rows in sheets.items():
        key = "burnt_area" if name.lower().startswith("burnt") else "fires"
        header = rows[0]
        cols = {v: k for k, v in header.items() if k != "A"}
        series = {}
        for iso, col in cols.items():
            series[iso] = {
                int(float(r["A"])): x for r in rows[1:]
                if (x := to_number(r.get(col, ""))) is not None
            }
        result[key] = series
    return result


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    rx = np.argsort(np.argsort(x))
    ry = np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def check(code: str, effis: dict) -> dict:
    model = json.loads((OUT_DIR / code / "model.json").read_text(encoding="utf-8"))
    ann = model["annual"]
    years = np.array(ann["years"])
    harm = dict(zip(years.tolist(), ann["harmonized"]))
    modis = dict(zip(years.tolist(), ann["modis"]))
    viirs = dict(zip(years.tolist(), ann["viirs"]))
    # Naive splice: raw MODIS cell-days before 2012, observed VIIRS from 2012.
    naive = {y: (modis[y] if y < LATE[0] else viirs[y]) for y in harm}

    out = {}
    for kind in ("burnt_area", "fires"):
        e = effis[kind][ISO3[code]]
        res = {}
        for name, series in (("harmonized", harm), ("naive", naive), ("modis", modis)):
            per = {}
            for label, (a, b) in (("early", EARLY), ("late", LATE)):
                ys = [y for y in range(a, b + 1) if y in e and y in series and e[y] > 0 and series[y] > 0]
                x = np.log(np.array([e[y] for y in ys]))
                s = np.log(np.array([series[y] for y in ys]))
                per[label] = {
                    "n": len(ys), "years": [ys[0], ys[-1]] if ys else None,
                    "spearman": spearman(x, s) if len(ys) >= 4 else None,
                    "pearson_log": float(np.corrcoef(x, s)[0, 1]) if len(ys) >= 4 else None,
                    "log_ratio": s - x,  # per-year log(series / EFFIS), summarized below
                    "x": x, "s": s,
                }
            # Level shift: fit log(series) = alpha + beta*log(EFFIS) on the late period,
            # mean residual in the early period = systematic level error of 2001-2011.
            late, early = per["late"], per["early"]
            if late["n"] >= 4 and early["n"] >= 4:
                beta, alpha = np.polyfit(late["x"], late["s"], 1)
                resid_early = early["s"] - (alpha + beta * early["x"])
                resid_late = late["s"] - (alpha + beta * late["x"])
                shift = float(np.mean(resid_early))
                res[name] = {
                    "early": {k: early[k] for k in ("n", "years", "spearman", "pearson_log")},
                    "late": {k: late[k] for k in ("n", "years", "spearman", "pearson_log")},
                    "level_shift": float(np.expm1(shift)),  # early vs late relation, as % of level
                    "level_shift_se": float(np.std(resid_late, ddof=2) / np.sqrt(early["n"])),
                }
        out[kind] = res
    return out


def fmt(x, pct=False):
    if x is None:
        return "  –  "
    return f"{x:+.0%}" if pct else f"{x:.2f}"


def main() -> None:
    effis = effis_series()
    results = {}
    for code in ISO3:
        results[code] = check(code, effis)
    for kind in ("burnt_area", "fires"):
        print(f"\nEFFIS {kind}: Spearman early (2001-11) / late (2012-24) | level shift of early years")
        for code, r in results.items():
            h, n, m = r[kind]["harmonized"], r[kind]["naive"], r[kind]["modis"]
            print(f"  {code}  harmonized {fmt(h['early']['spearman'])} / {fmt(h['late']['spearman'])}"
                  f" | shift {fmt(h['level_shift'], True)} (±{h['level_shift_se']:.2f} log)"
                  f"   naive {fmt(n['level_shift'], True)}   MODIS-only {fmt(m['level_shift'], True)}"
                  f" (rho {fmt(m['early']['spearman'])}/{fmt(m['late']['spearman'])})"
                  f"   n={h['early']['n']}/{h['late']['n']}")
    path = CACHE_DIR / "effis_check.json"
    path.write_text(json.dumps(results, indent=1))
    print(f"\n-> {path}")


if __name__ == "__main__":
    main()
