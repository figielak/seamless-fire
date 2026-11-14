"""Feasibility check for a fire activity forecast: does weather explain daily fire cell-days
beyond the seasonal cycle? (Exploration; writes pipeline/cache/forecast_check_{CC}.json.)

Weather: NASA POWER daily point API (MERRA-2 reanalysis, no key), at the centres of a 1° grid inside
the country (live/borders.json), weighted by the fire activity of each 1° box. Reanalysis = "perfect forecast", so the skill found here is an upper
bound for a 1-7 day forecast. Target: daily S-NPP vegetation cell-days (pipeline cache), 2012-2025.

Models, leave-one-year-out (LOYO):
  C  climatology: mean log1p(cell-days) by day of year (±15 days) over the training years
  W  C + weather anomaly regression (FWI system and raw weather, per season)
Metrics on held-out years: R² of daily log1p values, skill vs C, correlation of 7-day sums.

Usage: python pipeline/forecast_check.py [CC ...]
"""

import json
import sys
import time
import urllib.request

import numpy as np
import pandas as pd

import fwi as fwimod
from borders import in_country, load as load_borders
from config import CACHE_DIR, CELL_DEG

YEARS = (2012, 2025)
DAILY_VARS = ["temperature_2m_max", "relative_humidity_2m_min", "wind_speed_10m_mean", "precipitation_sum",
              "vapour_pressure_deficit_max"]
POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
SEASON = np.array([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0])  # month 1..12 -> DJF, MAM, JJA, SON


def grid_points(code: str, step: float = 1.0) -> list[tuple[float, float]]:
    """Centres of a `step`° grid (x.5) inside the country raster."""
    b = load_borders()
    r = b["countries"][code]
    s_lat = (r["row0"]) * b["deg"]
    n_lat = (r["row0"] + len(r["runs"])) * b["deg"]
    cols = [c for row in r["runs"] for c in row]
    w_lon, e_lon = min(cols) * b["deg"], (max(cols) + 1) * b["deg"]
    lats = np.arange(np.floor(s_lat) + step / 2, n_lat, step)
    lons = np.arange(np.floor(w_lon) + step / 2, e_lon, step)
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    la, lo = la.ravel(), lo.ravel()
    keep = in_country(lo, la, r)
    return [(round(float(a), 2), round(float(o), 2)) for a, o in zip(la[keep], lo[keep])]


def es(t):
    """Saturation vapour pressure (kPa), Magnus formula."""
    return 0.6108 * np.exp(17.27 * t / (t + 237.3))


def fetch_point(lat: float, lon: float) -> pd.DataFrame:
    """NASA POWER daily (MERRA-2), cached per point. RH min and VPD max from dew point and Tmax."""
    path = CACHE_DIR / "weather" / f"{lat:.2f}_{lon:.2f}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    q = (f"{POWER}?parameters=T2M_MAX,T2MDEW,WS10M,PRECTOTCORR&community=AG&longitude={lon}&latitude={lat}"
         f"&start={YEARS[0]}0101&end={YEARS[1]}1231&format=JSON")
    req = urllib.request.Request(q, headers={"User-Agent": "fire-weather-client/1.0"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                par = json.loads(r.read().decode("utf-8"))["properties"]["parameter"]
            break
        except Exception as e:
            print(f"  retry {attempt + 1} ({lat}, {lon}): {e}")
            time.sleep(20 * (attempt + 1))
    else:
        raise SystemExit("NASA POWER request failed")
    f = pd.DataFrame(par).replace(-999.0, np.nan)
    f.index = pd.to_datetime(f.index, format="%Y%m%d")
    t, td = f["T2M_MAX"], np.minimum(f["T2MDEW"], f["T2M_MAX"])
    out = pd.DataFrame({
        "date": f.index,
        "temperature_2m_max": t.to_numpy(),
        "relative_humidity_2m_min": (100 * es(td) / es(t)).clip(1, 100).to_numpy(),
        "wind_speed_10m_mean": (f["WS10M"] * 3.6).to_numpy(),
        "precipitation_sum": f["PRECTOTCORR"].to_numpy(),
        "vapour_pressure_deficit_max": (es(t) - es(td)).to_numpy(),
        "lat": lat, "lon": lon,
    })
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(path, index=False)
    time.sleep(1)
    return out


def fetch_weather(code: str, pts: list[tuple[float, float]]) -> pd.DataFrame:
    frames = []
    for k, (a, o) in enumerate(pts):
        frames.append(fetch_point(a, o))
        if (k + 1) % 10 == 0:
            print(f"  weather {code}: {k + 1}/{len(pts)} points")
    return pd.concat(frames, ignore_index=True)


def add_fwi(w: pd.DataFrame, south: bool) -> pd.DataFrame:
    w = w.sort_values(["lat", "lon", "date"]).copy()
    pts = w[["lat", "lon"]].drop_duplicates().to_numpy()
    dates = np.sort(w["date"].unique())
    piv = {v: w.pivot_table(index="date", columns=["lat", "lon"], values=v).loc[dates] for v in DAILY_VARS}
    months = pd.DatetimeIndex(dates).month.to_numpy()
    fill = lambda a: a.ffill().bfill().to_numpy()  # noqa: E731 (rare gaps)
    out, _ = fwimod.fwi_series(fill(piv["temperature_2m_max"]), fill(piv["relative_humidity_2m_min"]),
                               fill(piv["wind_speed_10m_mean"]), fill(piv["precipitation_sum"]), months, south)
    cols = piv["temperature_2m_max"].columns
    for name, arr in out.items():
        f = pd.DataFrame(arr, index=dates, columns=cols).stack(["lat", "lon"], future_stack=True).rename(name).reset_index()
        f = f.rename(columns={"level_0": "date"}) if "level_0" in f else f
        w = w.merge(f, on=["date", "lat", "lon"])
    return w


MAX_POINTS = 40  # largest fire weights only (AU and CA have hundreds of 1° points)


def box_counts(code: str) -> pd.Series:
    """2012-2025 S-NPP cell-days per 1° box (index: box centre lat, lon)."""
    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    cd = cd[cd["sat"] == "SNPP"]
    box = pd.DataFrame({"lat": np.floor(cd["lat_i"] * CELL_DEG) + 0.5, "lon": np.floor(cd["lon_i"] * CELL_DEG) + 0.5})
    return box.groupby(["lat", "lon"]).size()


def top_points(code: str) -> tuple[list[tuple[float, float]], float]:
    """Grid points with the largest fire activity (at most MAX_POINTS) and the share they cover."""
    n = box_counts(code)
    pts = grid_points(code)
    c = pd.Series([float(n.get((a, o), 0)) for a, o in pts], index=pd.MultiIndex.from_tuples(pts))
    top = c[c > 0].sort_values(ascending=False).iloc[:MAX_POINTS]
    return [tuple(x) for x in top.index], float(top.sum() / n.sum())


def point_weights(code: str, w: pd.DataFrame) -> pd.Series:
    """Weight of each weather point = share of 2012-2025 S-NPP cell-days in its 1° box, so the
    country weather is the weather where fires happen (islands without fire drop out)."""
    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    cd = cd[cd["sat"] == "SNPP"]
    box = pd.DataFrame({"lat": np.floor(cd["lat_i"] * CELL_DEG) + 0.5, "lon": np.floor(cd["lon_i"] * CELL_DEG) + 0.5})
    n = box.groupby(["lat", "lon"]).size()
    pts = w[["lat", "lon"]].drop_duplicates()
    wt = pd.Series([n.get((round(a, 2), round(o, 2)), 0) for a, o in zip(pts["lat"], pts["lon"])],
                   index=pd.MultiIndex.from_frame(pts), dtype=float)
    return wt / wt.sum()


def country_features(w: pd.DataFrame, weights: pd.Series) -> pd.DataFrame:
    feats = DAILY_VARS + ["ffmc", "dmc", "dc", "isi", "bui", "fwi", "dry_days"]
    w = w.sort_values(["lat", "lon", "date"]).copy()
    wet = (w["precipitation_sum"] >= 2.0).to_numpy()
    dsr = np.zeros(len(w))
    run, prev = 0.0, None
    for i, key in enumerate(zip(w["lat"].to_numpy(), w["lon"].to_numpy())):
        if key != prev:
            run, prev = 0.0, key
        run = 0.0 if wet[i] else run + 1.0
        dsr[i] = run
    w["dry_days"] = dsr
    wt = weights.reindex(pd.MultiIndex.from_frame(w[["lat", "lon"]])).to_numpy()
    g = w[feats].mul(wt, axis=0).assign(date=w["date"].to_numpy()).groupby("date")[feats].sum()
    g["rain7"] = g["precipitation_sum"].rolling(7, min_periods=1).sum()
    return g


def target(code: str) -> pd.Series:
    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    s = cd[cd["sat"] == "SNPP"].groupby("date").size()
    idx = pd.date_range(f"{YEARS[0]}-01-20", f"{YEARS[1]}-12-31")  # S-NPP starts 2012-01-20
    return s.reindex(idx, fill_value=0).astype(float)


def climatology(y: pd.Series, train: np.ndarray) -> pd.Series:
    """Mean log1p by day of year over training years, circular ±15 day window."""
    doy = np.minimum(y.index.dayofyear.to_numpy(), 365)
    ly = np.log1p(y.to_numpy())
    sums = np.bincount(doy[train] - 1, ly[train], minlength=365)
    cnt = np.bincount(doy[train] - 1, minlength=365).astype(float)
    k = np.ones(31)
    ext = lambda a: np.concatenate([a[-15:], a, a[:15]])  # noqa: E731
    clim = np.convolve(ext(sums), k, "valid") / np.maximum(np.convolve(ext(cnt), k, "valid"), 1)
    return pd.Series(clim[doy - 1], index=y.index)


def loyo(y: pd.Series, X: pd.DataFrame, feats: list[str], seasonal: bool = True) -> dict:
    years = y.index.year.to_numpy()
    ly = np.log1p(y.to_numpy())
    season = SEASON[y.index.month.to_numpy() - 1]
    pred_c = np.zeros(len(y))
    pred_w = np.zeros(len(y))
    Xa = X.loc[y.index, feats].to_numpy()
    for yr in np.unique(years):
        tr, te = years != yr, years == yr
        clim = climatology(y, tr).to_numpy()
        pred_c[te] = clim[te]
        # weather anomalies: features standardized by day-of-year mean of training years
        resid = ly - clim
        for s in (range(4) if seasonal else [None]):
            m_tr = tr & (season == s) if s is not None else tr
            m_te = te & (season == s) if s is not None else te
            mu, sd = Xa[m_tr].mean(0), Xa[m_tr].std(0) + 1e-9
            A = np.column_stack([np.ones(m_tr.sum()), (Xa[m_tr] - mu) / sd])
            lam = 1.0 * np.eye(A.shape[1]); lam[0, 0] = 0
            beta = np.linalg.solve(A.T @ A + lam, A.T @ resid[m_tr])
            B = np.column_stack([np.ones(m_te.sum()), (Xa[m_te] - mu) / sd])
            pred_w[m_te] = clim[m_te] + B @ beta
    ss = lambda p: float(np.sum((ly - p) ** 2))  # noqa: E731
    tot = float(np.sum((ly - ly.mean()) ** 2))
    week = lambda a: pd.Series(np.expm1(np.maximum(a, 0)), index=y.index).resample("W").sum()  # noqa: E731
    wo = y.resample("W").sum()
    lw = np.log1p
    return {
        "r2_clim": round(1 - ss(pred_c) / tot, 3),
        "r2_weather": round(1 - ss(pred_w) / tot, 3),
        "skill_vs_clim": round(1 - ss(pred_w) / ss(pred_c), 3),
        "week_corr_clim": round(float(np.corrcoef(lw(wo), lw(week(pred_c)))[0, 1]), 3),
        "week_corr_weather": round(float(np.corrcoef(lw(wo), lw(week(pred_w)))[0, 1]), 3),
        # anomaly skill: does the model get above/below-normal weeks right?
        "week_anom_corr": round(float(np.corrcoef(lw(wo) - lw(week(pred_c)), lw(week(pred_w)) - lw(week(pred_c)))[0, 1]), 3),
    }, pred_c, pred_w


def main(args: list[str]) -> None:
    codes = args or ["PL", "PT"]
    for code in codes:
        pts, cover = top_points(code)
        print(f"{code}: {len(pts)} weather points, {cover:.0%} of the fire activity in their 1° boxes")
        w = fetch_weather(code, pts)
        w = add_fwi(w, south=code in ("AU", "CL"))
        wts = point_weights(code, w)
        print(f"  points with fire weight > 0: {(wts > 0).sum()} of {len(wts)}")
        X = country_features(w, wts)
        y = target(code)
        res = {}
        sets = {
            "fwi_system": ["ffmc", "dmc", "dc", "isi", "bui", "fwi"],
            "raw_weather": ["temperature_2m_max", "relative_humidity_2m_min", "wind_speed_10m_mean",
                            "vapour_pressure_deficit_max", "dry_days", "rain7"],
        }
        sets["all"] = sets["fwi_system"] + sets["raw_weather"]
        for name, feats in sets.items():
            res[name], pc, pw = loyo(y, X, feats)
        # correlation of daily anomalies with single indices (what moves fire beyond season?)
        ly = np.log1p(y)
        anom = ly - climatology(y, np.ones(len(y), bool))
        res["daily_anom_corr"] = {f: round(float(np.corrcoef(anom, X.loc[y.index, f] - X.loc[y.index, f]
                                       .groupby(y.index.dayofyear).transform("mean"))[0, 1]), 3)
                                  for f in sets["all"]}
        (CACHE_DIR / f"forecast_check_{code}.json").write_text(json.dumps(res, indent=1))
        print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
