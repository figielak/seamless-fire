"""Daily fire activity forecast (GitHub Actions; no raw data, no cache).

Issue day = the day after the last day with fire data of the country (live/coverage.json), so the
forecast always continues from where the observations end, even when that day is in the past.

For every country with a model in live/forecast/{CC}.json:
1. Move the stored fire weather state (live/forecast/state_{CC}.json) forward with NASA POWER days
   that are complete at all points (POWER lags about 3 days). The state only ever uses POWER, the
   weather the model was trained on.
2. Open-Meteo (hourly, best-match models, UTC days): the days after the state up to the day before the
   issue day (bias-corrected as lead 0) and issue day .. +6 (lead 0..6, bias-corrected per lead).
   Issue day = today: forecast API. Issue day in the past: Previous Runs API, i.e. the forecast that was
   actually issued on that day (no later weather is used).
3. Predict log1p S-NPP cell-days per day; interval and skill come from the 2024-2025 test.
Writes public/data/{CC}/forecast.json and the new state. Rewrites files only when they change.

Weather forecast data: Open-Meteo.com (CC BY 4.0). Weather history: NASA POWER (MERRA-2).

Usage: python pipeline/forecast_update.py [--issue YYYY-MM-DD] [CC ...]
"""

import argparse
import json
import time
import urllib.request
from datetime import date, timedelta

import numpy as np
import pandas as pd

import forecast_core as C
from config import ROOT

MODELS = ROOT / "live" / "forecast"
DATA = ROOT / "public" / "data"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
PREVIOUS_RUNS = "https://previous-runs-api.open-meteo.com/v1/forecast"
COVERAGE = ROOT / "live" / "coverage.json"
DAYS = 7  # issue day .. issue day + 6
Z80 = 1.2816
FACTOR_MIN, FACTOR_MAX = 0.05, 20.0  # local weather factor, clipped (extreme z-scores at single points)


def write_if_changed(path, text: str) -> bool:
    if path.exists() and path.read_text() == text:
        return False
    path.write_text(text)
    return True


def advance_with_power(model: dict, state: dict, yesterday: date) -> dict:
    """State moved over POWER days that exist at every point (stops at the first incomplete day)."""
    start = date.fromisoformat(state["date"]) + timedelta(days=1)
    if start > yesterday:
        return state
    frames = [C.fetch_power(la, lo, start.isoformat(), yesterday.isoformat()) for la, lo in model["points"]]
    idx = pd.date_range(start, yesterday)
    wx = {v: pd.DataFrame({k: f[v].reindex(idx) for k, f in enumerate(frames)}) for v in C.VARS}
    ok = np.all([wx[v].notna().all(axis=1).to_numpy() for v in C.VARS], axis=0)
    n = int(np.argmin(ok)) if not ok.all() else len(ok)  # leading run of complete days
    if n == 0:
        return state
    days = idx[:n]
    s, _ = C.run(state_arrays(state), days, {v: wx[v].to_numpy()[:n] for v in C.VARS}, model["south"])
    return C.state_json(s, str(days[-1].date()))


def state_arrays(state: dict) -> dict:
    return {k: (np.asarray(v, float) if k != "rain" else [np.asarray(x, float) for x in v])
            for k, v in state.items() if k != "date"}


def get_json(q: str):
    req = urllib.request.Request(q, headers={"User-Agent": C.UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read().decode("utf-8"))
            break
        except Exception as e:  # noqa: BLE001 (network)
            if attempt == 3:
                raise RuntimeError(f"Open-Meteo failed: {e}") from e
            time.sleep(20 * (attempt + 1))
    return data if isinstance(data, list) else [data]


def fetch_open_meteo(points: list, past_days: int) -> list[pd.DataFrame]:
    """Daily weather per point (Open-Meteo forecast API, one request for all points)."""
    lat = ",".join(str(p[0]) for p in points)
    lon = ",".join(str(p[1]) for p in points)
    data = get_json(f"{OPEN_METEO}?latitude={lat}&longitude={lon}&hourly={','.join(C.HOURLY)}"
                    f"&past_days={past_days}&forecast_days={DAYS + 1}&timezone=UTC&wind_speed_unit=kmh")
    return [C.daily_from_hourly(d["hourly"]["time"], d["hourly"]) for d in data]


def fetch_previous_runs(points: list, start: date, end: date, issue: date) -> list[pd.DataFrame]:
    """Daily weather per point as forecast on the issue day: for a day d >= issue the run issued
    d - issue days before d (lead d - issue); days before the issue day: lead 0 (Previous Runs API)."""
    lat = ",".join(str(p[0]) for p in points)
    lon = ",".join(str(p[1]) for p in points)
    names = [h if L == 0 else f"{h}_previous_day{L}" for L in range(DAYS) for h in C.HOURLY]
    data = get_json(f"{PREVIOUS_RUNS}?latitude={lat}&longitude={lon}&hourly={','.join(names)}"
                    f"&start_date={start}&end_date={end}&timezone=UTC&wind_speed_unit=kmh")
    out = []
    for d in data:
        h = d["hourly"]
        per_lead = {L: C.daily_from_hourly(h["time"], {x: h[x if L == 0 else f"{x}_previous_day{L}"] for x in C.HOURLY})
                    for L in range(DAYS)}
        idx = per_lead[0].index
        lead = np.clip((idx - pd.Timestamp(issue)).days.to_numpy(), 0, DAYS - 1)
        out.append(pd.DataFrame({v: [per_lead[int(L)].loc[t, v] for t, L in zip(idx, lead)] for v in C.VARS}, index=idx))
    return out


def issue_day(code: str) -> date:
    """Day after the last day with fire data of the country."""
    cov = json.loads(COVERAGE.read_text())[code]
    return date.fromisoformat(cov["last"]) + timedelta(days=1)


def forecast(code: str, today: date) -> None:
    model = json.loads((MODELS / f"{code}.json").read_text())
    state_path = MODELS / f"state_{code}.json"
    state = json.loads(state_path.read_text())
    yesterday = today - timedelta(days=1)
    try:
        state = advance_with_power(model, state, yesterday)
    except RuntimeError as e:
        print(f"{code}: {e}; state stays at {state['date']}")
    write_if_changed(state_path, json.dumps(state, separators=(",", ":")))

    s_date = date.fromisoformat(state["date"])
    gap = (yesterday - s_date).days  # days between the state and the issue day (Open-Meteo, lead 0)
    if gap < 0:
        raise SystemExit(f"{code}: fire weather state ({s_date}) is not before the issue day {today}")
    if gap > 90:
        raise SystemExit(f"{code}: fire weather state is {gap} days old; rebuild with forecast_model.py")
    days = pd.date_range(s_date + timedelta(days=1), today + timedelta(days=DAYS - 1))
    now = pd.Timestamp.now(tz="UTC").date()
    om = (fetch_open_meteo(model["points"], gap + 1) if today >= now
          else fetch_previous_runs(model["points"], days[0].date(), days[-1].date(), today))
    wx = {}
    for v in C.VARS:
        a = pd.DataFrame({k: d[v].reindex(days) for k, d in enumerate(om)}).ffill().bfill().to_numpy().copy()
        lead = np.maximum((days - pd.Timestamp(today)).days.to_numpy(), 0)  # past days: lead 0
        mon = days.month.to_numpy()
        for L in np.unique(lead):
            m = lead == L
            a[m] = C.correct(v, a[m], mon[m], np.asarray(model["bias"][str(int(L))][v]))
        wx[v] = a
    w = np.asarray(model["weights"])
    _, feats = C.run(state_arrays(state), days, wx, model["south"])
    out_days = []
    for i, d in enumerate(days):
        if d < pd.Timestamp(today):
            continue
        j = (d - pd.Timestamp(today)).days  # 0..6, shown as day j + 1 of the measured skill
        x = C.country(feats[i], w)
        p = C.predict(model, x, d)
        c = float(model["clim"][min(d.dayofyear, 365) - 1])
        h = Z80 * model["resid_sd"][j]
        out_days.append({
            "date": str(d.date()), "value": round(float(np.expm1(max(p, 0))), 2),
            "lo": round(float(np.expm1(max(p - h, 0))), 2), "hi": round(float(np.expm1(max(p + h, 0)))),
            "typical": round(float(np.expm1(max(c, 0))), 2), "fwi": round(float(x[C.FEATS.index("fwi")]), 1),
            "skill": model["skill"][j],
        })
    # Local weather factor per point and day: exp(weather term) of the point's own weather, i.e. how many
    # times the usual fire activity for the season this weather implies (site: places to watch).
    fdays = [i for i, d in enumerate(days) if d >= pd.Timestamp(today)]
    points = []
    for k, (la, lo) in enumerate(model["points"]):
        fac = [float(np.clip(np.exp(C.anomaly(model, C.point_features(feats[i], k), days[i])), FACTOR_MIN, FACTOR_MAX))
               for i in fdays]
        points.append({"lat": la, "lon": lo, "factor": [round(f, 3) for f in fac],
                       "fwi": [round(float(np.asarray(feats[i]["fwi"])[k]), 1) for i in fdays]})
    tot = sum(d["value"] for d in out_days)
    typ = sum(d["typical"] for d in out_days)
    hw = Z80 * model["week"]["resid_sd_log"]
    out = {
        "issued": str(today), "data_through": str(yesterday), "weather_state": state["date"], "days": out_days, "points": points,
        "week": {"value": round(tot, 1), "typical": round(typ, 1),
                 "lo": round(float(np.expm1(max(np.log1p(tot) - hw, 0))), 1),
                 "hi": round(float(np.expm1(np.log1p(tot) + hw)), 1),
                 "skill": model["week"]["skill_vs_clim"], "corr": model["week"]["corr"],
                 "corr_typical": model["week"]["corr_clim"]},
        "perfect_skill": model["perfect_skill"], "trained": model["trained"], "tested": "2024-01-01..2025-12-31",
        "sources": "NASA POWER (MERRA-2) weather history; Open-Meteo.com forecast (CC BY 4.0)",
    }
    changed = write_if_changed(DATA / code / "forecast.json", json.dumps(out, separators=(",", ":")))
    print(f"{code}: state {state['date']}, next 7 days {tot:.0f} cell-days (typical {typ:.0f})"
          f"{'' if changed else ', unchanged'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("codes", nargs="*")
    ap.add_argument("--issue", help="issue day for all countries (default: day after each country's last data day)")
    a = ap.parse_args()
    codes = a.codes or sorted(p.stem for p in MODELS.glob("??.json"))
    failed = []
    for code in codes:  # one country failing (weather service, old state) does not stop the others
        try:
            forecast(code, date.fromisoformat(a.issue) if a.issue else issue_day(code))
        except (RuntimeError, SystemExit, OSError, ValueError, KeyError) as e:
            print(f"{code}: forecast failed: {e}")
            failed.append(code)
    if failed:
        raise SystemExit(f"forecast failed for {', '.join(failed)}")


if __name__ == "__main__":
    main()
