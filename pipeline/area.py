"""Custom areas (stage 5): country-share estimate before 2012 and its validation.

Site method for an area smaller than the country, estimated months (before VIIRS):
    V_area = V_country_hat * M_area / M_country   (0 when M_country = 0)
Observed months use the area's own VIIRS cell-days.

Validation (fixed before looking at results, see .planning/DECISIONS.md):
- test areas: 2°x2° blocks anchored at 0°/0° (a cell belongs to the block holding its center),
  kept when they have >= BLOCK_MIN_MODIS MODIS cell-days in the calibration months;
- both methods use the same LOYO folds as the country validation (model.loyo_fits):
  (1) "direct": country model applied to the area's MODIS sum, (2) "share" (above);
- truth = the area's observed S-NPP cell-days in the calibration months;
- interval half-width h (log1p space) = 80% quantile of |log1p(pred) - log1p(V)| of the share
  method over active months (V > 0 or M_area > 0); calibrated on checkerboard blocks
  ((i + j) even), coverage reported on the others; the stored h uses all blocks.
  The same for annual sums (h_annual, active block-years).
"""

import json

import numpy as np
import pandas as pd

from config import CELL_DEG, ROOT
from model import loyo_fits, predict_loglog, unique_by_sensor

BLOCK_DEG = 2.0
BLOCK_MIN_MODIS = 20
INTERVAL_Q = 0.8
PRESETS_FILE = ROOT / "src" / "lib" / "presets.json"


# ---------------------------------------------------------------- geometry (mirrors src/lib/geo.ts)

def load_presets() -> list[dict]:
    return json.loads(PRESETS_FILE.read_text(encoding="utf-8"))


def in_polygon(lon: np.ndarray, lat: np.ndarray, ring: list) -> np.ndarray:
    """Even-odd ray casting; ring = [[lon, lat], ...] (open or closed)."""
    inside = np.zeros(len(lon), dtype=bool)
    n = len(ring)
    for k in range(n):
        x1, y1 = ring[k]
        x2, y2 = ring[(k + 1) % n]
        crosses = (y1 > lat) != (y2 > lat)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_at = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (lon < x_at)
    return inside


def in_area(lon: np.ndarray, lat: np.ndarray, area: dict) -> np.ndarray:
    if "bbox" in area:
        w, s, e, n = area["bbox"]
        return (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    return in_polygon(lon, lat, area["polygon"])


# ---------------------------------------------------------------- area series

def sensor_cells(cd: pd.DataFrame) -> pd.DataFrame:
    """Unique cell-days of MODIS (Terra ∪ Aqua) and S-NPP with month and cell center."""
    u = unique_by_sensor(cd)
    u = u[u["sensor"].isin(["MODIS", "SNPP"])]
    return pd.DataFrame({
        "sensor": u["sensor"].to_numpy(),
        "month": u["date"].dt.to_period("M").astype(str).to_numpy(),
        "lat": (u["lat_i"].to_numpy() + 0.5) * CELL_DEG,
        "lon": (u["lon_i"].to_numpy() + 0.5) * CELL_DEG,
    })


def monthly_counts(cells: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """Cell-days per keys + month, columns M (MODIS) and V (S-NPP)."""
    g = cells.groupby([*keys, "month", "sensor"]).size().unstack("sensor", fill_value=0)
    return g.reindex(columns=["MODIS", "SNPP"], fill_value=0).rename(columns={"MODIS": "M", "SNPP": "V"})


def country_loyo(frame: pd.DataFrame, fit_frame: pd.DataFrame, frame_all: pd.DataFrame,
                 variant: str) -> tuple[dict, np.ndarray]:
    """LOYO folds of the chosen model and the country prediction for each calibration month."""
    fits = loyo_fits(fit_frame, frame_all, variant)
    pred = np.empty(len(frame))
    for y, p in fits.items():
        sel = (frame["year"] == y).to_numpy()
        if sel.any():
            pred[sel] = predict_loglog(p, frame[sel])
    return fits, pred


def area_predictions(frame: pd.DataFrame, country_pred: np.ndarray, fits: dict,
                     area_mv: pd.DataFrame) -> pd.DataFrame:
    """Both methods for one area over the calibration months (area_mv indexed by month str)."""
    a = area_mv.reindex(frame.index, fill_value=0)
    m_area = a["M"].to_numpy(float)
    m_c = frame["M"].to_numpy(float)
    df = frame[["year", "season"]].assign(M=m_area)
    direct = np.empty(len(frame))
    for y, p in fits.items():
        sel = (frame["year"] == y).to_numpy()
        if sel.any():
            direct[sel] = predict_loglog(p, df[sel])
    with np.errstate(divide="ignore", invalid="ignore"):
        share = np.where(m_c > 0, country_pred * m_area / m_c, 0.0)
    return pd.DataFrame({"year": frame["year"].to_numpy(), "M": m_area, "V": a["V"].to_numpy(float),
                         "direct": direct, "share": share}, index=frame.index)


# ---------------------------------------------------------------- metrics

def resid(pred, v):
    return np.log1p(pred) - np.log1p(v)


def area_metrics(p: pd.DataFrame) -> dict:
    out = {}
    ann = p.groupby("year")[["V", "M", "direct", "share"]].sum()
    for meth in ("direct", "share"):
        r = resid(p[meth].to_numpy(), p["V"].to_numpy())
        pos = ann[ann["V"] > 0]
        out[meth] = {
            "logrmse": float(np.sqrt(np.mean(r ** 2))),
            "bias": float(np.mean(r)),
            "annual": float(((pos[meth] - pos["V"]).abs() / pos["V"]).mean()) if len(pos) else np.nan,
        }
    out["n_months"] = len(p)
    out["zero_v_years_pred"] = int(((ann["V"] == 0) & (ann["share"] > 0)).sum())
    out["zero_v_years"] = int((ann["V"] == 0).sum())
    miss = (p["M"] == 0) & (p["V"] > 0)
    out["m0_v_months"] = int(miss.sum())
    out["m0_v_share"] = float(p.loc[miss, "V"].sum() / p["V"].sum()) if p["V"].sum() else 0.0
    return out


def block_table(cd: pd.DataFrame, frame: pd.DataFrame, country_pred: np.ndarray, fits: dict) -> pd.DataFrame:
    """Share/direct predictions for every qualifying 2° block (long format)."""
    cells = sensor_cells(cd)
    cells["bi"] = np.floor(cells["lat"] / BLOCK_DEG).astype(int)
    cells["bj"] = np.floor(cells["lon"] / BLOCK_DEG).astype(int)
    counts = monthly_counts(cells, ["bi", "bj"])
    calib = set(frame.index)
    rows = []
    for (bi, bj), g in counts.groupby(level=["bi", "bj"]):
        g = g.droplevel(["bi", "bj"])
        if g.loc[g.index.isin(calib), "M"].sum() < BLOCK_MIN_MODIS:
            continue
        p = area_predictions(frame, country_pred, fits, g)
        rows.append(p.assign(bi=bi, bj=bj))
    return pd.concat(rows) if rows else pd.DataFrame()


def half_width(r: np.ndarray) -> float:
    return float(np.quantile(np.abs(r), INTERVAL_Q)) if len(r) else float("nan")


def interval_calibration(blocks: pd.DataFrame) -> dict:
    """h (log1p) for months and years of the share method + checkerboard holdout coverage."""
    blocks = blocks.assign(month=blocks.index)
    act = blocks[(blocks["V"] > 0) | (blocks["M"] > 0)]
    r = resid(act["share"].to_numpy(), act["V"].to_numpy())
    even = ((act["bi"] + act["bj"]) % 2 == 0).to_numpy()

    ann = blocks.groupby(["bi", "bj", "year"])[["V", "M", "share"]].sum().reset_index()
    ann = ann[(ann["V"] > 0) | (ann["M"] > 0)]
    ra = resid(ann["share"].to_numpy(), ann["V"].to_numpy())
    even_a = ((ann["bi"] + ann["bj"]) % 2 == 0).to_numpy()

    h_cal, ha_cal = half_width(r[even]), half_width(ra[even_a])
    return {
        "h_month": half_width(r),
        "h_annual": half_width(ra),
        "coverage_holdout": {
            "month": float(np.mean(np.abs(r[~even]) <= h_cal)) if (~even).any() else None,
            "annual": float(np.mean(np.abs(ra[~even_a]) <= ha_cal)) if (~even_a).any() else None,
        },
        "n_active_months": int(len(act)),
        "n_active_years": int(len(ann)),
    }


def area_validation(code: str, cd: pd.DataFrame, frame: pd.DataFrame, fit_frame: pd.DataFrame,
                    frame_all: pd.DataFrame, variant: str, with_presets: bool = False) -> dict:
    """Everything stored under `area` in model.json (+ per-preset results when asked)."""
    fits, country_pred = country_loyo(frame, fit_frame, frame_all, variant)
    blocks = block_table(cd, frame, country_pred, fits)
    per_block = [area_metrics(g.drop(columns=["bi", "bj"])) for _, g in blocks.groupby(["bi", "bj"])]
    summary = {}
    for meth in ("direct", "share"):
        lr = np.array([b[meth]["logrmse"] for b in per_block])
        ae = np.array([b[meth]["annual"] for b in per_block])
        rr = resid(blocks[meth].to_numpy(), blocks["V"].to_numpy())
        summary[meth] = {
            "logrmse_median": float(np.median(lr)),
            "logrmse_p25": float(np.quantile(lr, 0.25)),
            "logrmse_p75": float(np.quantile(lr, 0.75)),
            "bias": float(np.mean(rr)),
            "annual_median": float(np.nanmedian(ae)),
        }
    out = {
        "block_deg": BLOCK_DEG, "block_min_modis": BLOCK_MIN_MODIS, "interval_q": INTERVAL_Q,
        "n_blocks": len(per_block),
        "methods": summary,
        "share_better_blocks": int(sum(b["share"]["logrmse"] < b["direct"]["logrmse"] for b in per_block)),
        "zero_v_block_years": int(sum(b["zero_v_years"] for b in per_block)),
        "zero_v_block_years_pred": int(sum(b["zero_v_years_pred"] for b in per_block)),
        "m0_v_months": int(sum(b["m0_v_months"] for b in per_block)),
        "m0_v_share": float(blocks.loc[(blocks["M"] == 0) & (blocks["V"] > 0), "V"].sum() / blocks["V"].sum()),
        **interval_calibration(blocks),
    }
    if with_presets:
        cells = sensor_cells(cd)
        out["presets"] = {}
        for pr in load_presets():
            if pr["country"] != code:
                continue
            sub = cells[in_area(cells["lon"].to_numpy(), cells["lat"].to_numpy(), pr)]
            p = area_predictions(frame, country_pred, fits, monthly_counts(sub, []))
            out["presets"][pr["id"]] = area_metrics(p) | {
                "share_coverage_month": float(np.mean(np.abs(resid(p["share"], p["V"]))[
                    (p["V"] > 0) | (p["M"] > 0)] <= out["h_month"])),
            }
    return out



# ---------------------------------------------------------------- site reference (fixture)

def area_series(hm: pd.DataFrame, area_modis: np.ndarray, area_viirs: np.ndarray, model: dict) -> dict:
    """Monthly custom-area series as the site computes it (src/lib/harmonize.ts:harmonizeArea).
    hm = model.harmonized_monthly of the country (raw MODIS in column `modis`)."""
    from config import INTERVAL_Z
    est = hm["estimated"].to_numpy(bool)
    m_c = hm["modis"].to_numpy(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        share = np.where(m_c > 0, hm["harmonized"].to_numpy(float) * area_modis / m_c, 0.0)
    v = np.where(est, share, area_viirs)
    h_t = np.hypot(model["area"]["h_month"], INTERVAL_Z * model["b"] * model["terra_only"]["sigma"])
    h = np.where(hm["terra_only"].to_numpy(bool), h_t, model["area"]["h_month"])
    lo = np.where(est, np.maximum(np.expm1(np.log1p(v) - h), 0), v)
    hi = np.where(est, np.expm1(np.log1p(v) + h), v)
    return {"value": v, "lo": lo, "hi": hi}
