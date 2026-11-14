"""Build the fire activity forecast model of a country (local; needs the pipeline cache).

Writes (committed, read by the daily forecast_update.py):
  live/forecast/{CC}.json        points, weights, climatology, seasonal ridge, bias tables per lead,
                                 interval widths and measured skill
  live/forecast/state_{CC}.json  fire weather codes per point at the last NASA POWER day

Inputs: pipeline/cache/{CC}_celldays.parquet (target, point weights), NASA POWER (cached 2012-2025 +
fresh 2026 to the latest day), Open-Meteo archived forecasts of 2024-2025 (pipeline/cache/weather_om,
written by forecast_skill.py) for the bias tables, pipeline/cache/forecast_skill_{CC}.json for skill.

Model = forecast_skill.py's, trained on all of 2012-2025; skill and intervals come from the test
(trained 2012-2023, tested 2024-2025 with real archived forecasts).

Usage: python pipeline/forecast_model.py CC [CC ...]
"""

import json
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

import forecast_core as C
from config import CACHE_DIR, ROOT
from forecast_check import fetch_point, fetch_weather, grid_points, target
from forecast_skill import subset

OUT = ROOT / "live" / "forecast"
LEADS = range(0, 8)
SOUTH = ("AU", "CL")
TRAIN = ("2012-01-01", "2025-12-31")
BIAS_YEARS = ("2024-01-01", "2025-12-31")


def power_all(pts: list[tuple[float, float]], end: str) -> dict[str, pd.DataFrame]:
    """POWER daily 2012-01-01..end per point (var -> DataFrame dates × points), NaN where missing."""
    frames = []
    for la, lo in pts:
        old = fetch_point(la, lo).set_index("date")
        old = pd.DataFrame({"t": old["temperature_2m_max"], "rh": old["relative_humidity_2m_min"],
                            "w": old["wind_speed_10m_mean"], "r": old["precipitation_sum"]})
        new = C.fetch_power(la, lo, "2026-01-01", end)
        frames.append(pd.concat([old, new]))
    idx = pd.date_range(TRAIN[0], end)
    return {v: pd.DataFrame({k: f[v].reindex(idx) for k, f in enumerate(frames)}) for v in C.VARS}


def bias_tables(pts, power: dict[str, pd.DataFrame]) -> dict:
    """Per lead, variable, point and calendar month: Open-Meteo archived forecast vs POWER, 2024-2025."""
    om = [pd.read_parquet(CACHE_DIR / "weather_om" / f"{la:.2f}_{lo:.2f}.parquet") for la, lo in pts]
    days = pd.date_range(*BIAS_YEARS)
    mon = days.month.to_numpy()
    out = {}
    for lead in LEADS:
        out[str(lead)] = {}
        for v in C.VARS:
            f = np.column_stack([o[o["lead"] == lead].set_index("date")[v].reindex(days).to_numpy() for o in om])
            p = power[v].reindex(days).to_numpy()
            tab = np.zeros((len(pts), 12))
            for mo in range(1, 13):
                m = mon == mo
                if v == "r":
                    tab[:, mo - 1] = np.clip(np.nanmean(p[m], 0) / np.maximum(np.nanmean(f[m], 0), 1e-6), 0.3, 3.0)
                else:
                    tab[:, mo - 1] = np.nanmean(f[m] - p[m], 0)
            out[str(lead)][v] = np.round(tab, 4).tolist()
    return out


def build(code: str) -> None:
    south = code in SOUTH
    w_all = fetch_weather(code, grid_points(code))
    wt = subset(code, w_all)
    pts = [(float(a), float(o)) for a, o in wt.index]
    weights = wt.to_numpy()
    end = (date.today() - timedelta(days=1)).isoformat()
    P = power_all(pts, end)
    # last day with POWER data at every point; earlier rare gaps filled as in training
    complete = np.all([P[v].notna().all(axis=1).to_numpy() for v in C.VARS], axis=0)
    last = P["t"].index[np.nonzero(complete)[0].max()]
    wx = {v: P[v].loc[:last].ffill().bfill() for v in C.VARS}
    days = wx["t"].index

    state, feats = C.run(C.new_state(len(pts)), days, {v: wx[v].to_numpy() for v in C.VARS}, south)
    X = pd.DataFrame([C.country(f, weights) for f in feats], index=days, columns=C.FEATS)

    y = target(code)  # daily S-NPP cell-days, 2012-01-20..2025-12-31
    ly = np.log1p(y.to_numpy())
    clim = C.climatology(ly, y.index)
    doy = np.minimum(y.index.dayofyear.to_numpy(), 365)
    resid = ly - clim[doy - 1]
    seasons = C.fit(X.loc[y.index].to_numpy(), resid, C.SEASON[y.index.month.to_numpy() - 1])

    skill = json.loads((CACHE_DIR / f"forecast_skill_{code}.json").read_text())
    model = {
        "code": code, "south": south, "trained": f"{y.index[0].date()}..{y.index[-1].date()}",
        "points": [[a, o] for a, o in pts], "weights": np.round(weights, 6).tolist(),
        "feats": C.FEATS, "clim": np.round(clim, 5).tolist(), "seasons": seasons,
        "bias": bias_tables(pts, P), "bias_years": list(BIAS_YEARS),
        # interval half-width (log1p) and measured skill per day ahead (1..7), from the 2024-2025 test
        "resid_sd": [skill[f"lead {k}"]["resid_sd"] for k in range(1, 8)],
        "skill": [skill[f"lead {k}"]["skill_vs_clim"] for k in range(1, 8)],
        "anom_corr": [skill[f"lead {k}"]["anom_corr"] for k in range(1, 8)],
        "perfect_skill": skill["perfect (reanalysis)"]["skill_vs_clim"],
        "week": skill["next 7 days total"],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{code}.json").write_text(json.dumps(model, separators=(",", ":")))
    (OUT / f"state_{code}.json").write_text(json.dumps(C.state_json(state, str(last.date())), separators=(",", ":")))
    print(f"{code}: {len(pts)} points, state at {last.date()}, skill day 1-7 {model['skill']}")


if __name__ == "__main__":
    for c in sys.argv[1:]:
        build(c)
