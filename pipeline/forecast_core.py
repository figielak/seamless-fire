"""Fire activity forecast: shared computations (no raw data, no cache), used by the local model
builder (forecast_model.py) and the daily update (forecast_update.py, GitHub Actions).

Weather per point (1° grid centres where fires happen), daily: Tmax (°C), RH min (%), mean wind
(km/h), rain (mm), UTC days. Fire weather codes (FFMC, DMC, DC) carry memory between days (DC for
months), so the state is stored and moved forward day by day.

Prediction for a day = climatology (mean log1p S-NPP cell-days of the country for the day of year)
+ seasonal ridge regression on the country-weighted weather features (see forecast_check.py,
forecast_skill.py and docs/validation.md).
"""

import numpy as np
import pandas as pd

import fwi as F

FEATS = ["ffmc", "dmc", "dc", "isi", "bui", "fwi", "t", "rh", "w", "vpd", "dry_days", "rain7"]
VARS = ["t", "rh", "w", "r"]
SEASON = np.array([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0])  # month 1..12 -> DJF, MAM, JJA, SON
WET_MM = 2.0  # a day with at least this much rain ends a dry spell
HOURLY = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]


def es(t):
    """Saturation vapour pressure (kPa), Magnus formula."""
    return 0.6108 * np.exp(17.27 * t / (t + 237.3))


def daily_from_hourly(time: list[str], hourly: dict[str, list]) -> pd.DataFrame:
    """UTC daily Tmax, RH min, mean wind, rain sum from hourly values; days with < 20 hours -> NaN."""
    h = pd.DataFrame({k: hourly[k] for k in HOURLY})
    h["date"] = pd.to_datetime(pd.Series(time)).dt.floor("D")
    g = h.groupby("date").agg(
        t=("temperature_2m", "max"), rh=("relative_humidity_2m", "min"),
        w=("wind_speed_10m", "mean"), r=("precipitation", "sum"), n=("temperature_2m", "count"),
    )
    g.loc[g["n"] < 20, VARS] = np.nan
    return g[VARS]


POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
UA = "fire-weather-client/1.0"


def fetch_power(lat: float, lon: float, start: str, end: str) -> pd.DataFrame:
    """NASA POWER daily (MERRA-2) for one point, dates YYYY-MM-DD; missing days NaN. RH min from
    dew point and Tmax (Magnus), wind m/s -> km/h. Same conversion as forecast_check.fetch_point."""
    import json
    import time
    import urllib.request
    q = (f"{POWER}?parameters=T2M_MAX,T2MDEW,WS10M,PRECTOTCORR&community=AG&longitude={lon}&latitude={lat}"
         f"&start={start.replace('-', '')}&end={end.replace('-', '')}&format=JSON")
    req = urllib.request.Request(q, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                par = json.loads(r.read().decode("utf-8"))["properties"]["parameter"]
            break
        except Exception as e:  # noqa: BLE001 (network)
            if attempt == 3:
                raise RuntimeError(f"NASA POWER failed for ({lat}, {lon}): {e}") from e
            time.sleep(10 * (attempt + 1))
    f = pd.DataFrame(par).replace(-999.0, np.nan)
    f.index = pd.to_datetime(f.index, format="%Y%m%d")
    t, td = f["T2M_MAX"], np.minimum(f["T2MDEW"], f["T2M_MAX"])
    return pd.DataFrame({"t": t, "rh": (100 * es(td) / es(t)).clip(1, 100), "w": f["WS10M"] * 3.6,
                         "r": f["PRECTOTCORR"]}, index=f.index)


def correct(v: str, x: np.ndarray, month: np.ndarray, table: np.ndarray) -> np.ndarray:
    """Bias correction of one variable (days × points) with a (points × 12) table: additive for
    temperature, humidity and wind (subtract), multiplicative for rain."""
    b = table.T[month - 1]  # days × points
    if v == "r":
        return np.maximum(x * b, 0.0)
    out = x - b
    return np.clip(out, 1.0, 100.0) if v == "rh" else (np.maximum(out, 0.0) if v == "w" else out)


def new_state(n: int) -> dict:
    return {"ffmc": [F.FFMC0] * n, "dmc": [F.DMC0] * n, "dc": [F.DC0] * n,
            "dry_days": [0.0] * n, "rain": [[0.0] * n for _ in range(6)]}


def step(state: dict, t, rh, w, r, month: int, south: bool) -> tuple[dict, dict]:
    """One day for all points: new state and the day's features per point."""
    mi = (month - 1 + (6 if south else 0)) % 12
    rh = np.clip(rh, 0.0, 100.0)  # as fwi.fwi_series
    r = np.maximum(r, 0.0)
    f0 = F.ffmc(t, rh, w, r, np.asarray(state["ffmc"], float))
    p0 = F.dmc(t, rh, r, np.asarray(state["dmc"], float), F.LE_NORTH[mi])
    d0 = F.dc(t, r, np.asarray(state["dc"], float), F.LF_NORTH[mi])
    dd = np.where(r >= WET_MM, 0.0, np.asarray(state["dry_days"], float) + 1.0)
    rain = [np.asarray(x, float) for x in state["rain"]]  # previous 6 days, oldest first
    ri = F.isi(w, f0)
    u = F.bui(p0, d0)
    feats = {"ffmc": f0, "dmc": p0, "dc": d0, "isi": ri, "bui": u, "fwi": F.fwi(ri, u),
             "t": t, "rh": rh, "w": w, "vpd": es(t) - es(t) * rh / 100, "dry_days": dd,
             "rain7": sum(rain) + r}
    new = {"ffmc": f0, "dmc": p0, "dc": d0, "dry_days": dd, "rain": rain[1:] + [r]}
    return new, feats


def run(state: dict, days: pd.DatetimeIndex, wx: dict[str, np.ndarray], south: bool) -> tuple[dict, list[dict]]:
    """Move the state over consecutive days (wx: var -> days × points). Returns the final state and
    the features of every day."""
    out = []
    for i, d in enumerate(days):
        state, f = step(state, *(wx[v][i] for v in VARS), d.month, south)
        out.append(f)
    return state, out


def state_json(state: dict, date: str) -> dict:
    r = lambda a: [round(float(x), 3) for x in np.asarray(a, float)]  # noqa: E731
    return {"date": date, "ffmc": r(state["ffmc"]), "dmc": r(state["dmc"]), "dc": r(state["dc"]),
            "dry_days": r(state["dry_days"]), "rain": [r(x) for x in state["rain"]]}


def country(feats: dict, weights: np.ndarray) -> np.ndarray:
    """Country feature vector (FEATS order): fire-weighted mean over the points."""
    return np.array([float(np.asarray(feats[k], float) @ weights) for k in FEATS])


def anomaly(model: dict, x: np.ndarray, date: pd.Timestamp) -> float:
    """Weather term of the model (log1p units): how far the weather moves fire activity from the
    seasonal level. Used for the country (x = country features) and, as a local weather factor
    exp(anomaly), for single points (x = the point's own features)."""
    s = model["seasons"][SEASON[date.month - 1]]
    z = (x - np.asarray(s["mu"])) / np.asarray(s["sd"])
    return float(s["beta"][0] + z @ np.asarray(s["beta"][1:]))


def predict(model: dict, x: np.ndarray, date: pd.Timestamp) -> float:
    """log1p cell-days for one day from the country feature vector."""
    return float(model["clim"][min(date.dayofyear, 365) - 1] + anomaly(model, x, date))


def point_features(feats: dict, k: int) -> np.ndarray:
    """Feature vector (FEATS order) of point k."""
    return np.array([float(np.asarray(feats[f], float)[k]) for f in FEATS])


def fit(X: np.ndarray, resid: np.ndarray, season: np.ndarray, lam: float = 1.0) -> list[dict]:
    """Ridge per season on standardized features (intercept not penalized)."""
    out = []
    for s in range(4):
        m = season == s
        mu, sd = X[m].mean(0), X[m].std(0) + 1e-9
        A = np.column_stack([np.ones(m.sum()), (X[m] - mu) / sd])
        L = lam * np.eye(A.shape[1])
        L[0, 0] = 0
        beta = np.linalg.solve(A.T @ A + L, A.T @ resid[m])
        out.append({"mu": mu.tolist(), "sd": sd.tolist(), "beta": beta.tolist()})
    return out


def climatology(ly: np.ndarray, dates: pd.DatetimeIndex, half: int = 15) -> np.ndarray:
    """Mean log1p by day of year (365 values), circular ±half-day window."""
    doy = np.minimum(dates.dayofyear.to_numpy(), 365)
    sums = np.bincount(doy - 1, ly, minlength=365)
    cnt = np.bincount(doy - 1, minlength=365).astype(float)
    k = np.ones(2 * half + 1)
    ext = lambda a: np.concatenate([a[-half:], a, a[:half]])  # noqa: E731
    return np.convolve(ext(sums), k, "valid") / np.maximum(np.convolve(ext(cnt), k, "valid"), 1)
