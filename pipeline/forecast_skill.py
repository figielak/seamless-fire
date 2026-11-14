"""Real forecast skill of the weather-based fire activity model (exploration).

forecast_check.py used reanalysis weather on the target day ("perfect forecast"). Here the
weather comes from archived numerical forecasts: Open-Meteo Previous Runs API, hourly values of
the run issued N days before (`*_previous_dayN`), aggregated to daily Tmax, RH min, mean wind,
rain. For an issue day I and lead L (1..7): the fire weather codes (FFMC, DMC, DC) start from the
observed state at I (NASA POWER) and continue with the forecast weather of days I+1..I+L of that
run. Forecast weather is bias-corrected per point and month against POWER (lead-0 vs POWER, the
same years; no fire data involved).

Model (as forecast_check.py, features "all"): trained on 2012-2023 with POWER weather; tested on
2024-2025 (target: daily S-NPP cell-days). Fire-weighted subset of the 1° weather points.

Usage: python pipeline/forecast_skill.py [CC ...]  -> pipeline/cache/forecast_skill_{CC}.json
"""

import json
import sys
import time
import urllib.request

import numpy as np
import pandas as pd

import fwi as F
from config import CACHE_DIR
from forecast_check import SEASON, climatology, es, fetch_point, grid_points, point_weights, target

API = "https://previous-runs-api.open-meteo.com/v1/forecast"
TEST = ("2024-01-01", "2025-12-31")
TRAIN_LAST = 2023
LEADS = range(0, 8)
HOURLY = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]
VARS = ["t", "rh", "w", "r"]
FEATS = ["ffmc", "dmc", "dc", "isi", "bui", "fwi", "t", "rh", "w", "vpd", "dry_days", "rain7"]
MAX_POINTS = 12


def fetch_om(lat: float, lon: float) -> pd.DataFrame:
    """Daily aggregates per lead (0..7) for valid dates in TEST, cached per point."""
    path = CACHE_DIR / "weather_om" / f"{lat:.2f}_{lon:.2f}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    names = [h if lead == 0 else f"{h}_previous_day{lead}" for lead in LEADS for h in HOURLY]
    q = (f"{API}?latitude={lat}&longitude={lon}&hourly={','.join(names)}"
         f"&start_date={TEST[0]}&end_date={TEST[1]}&timezone=UTC")
    req = urllib.request.Request(q, headers={"User-Agent": "fire-weather-client/1.0"})
    for attempt in range(18):  # free API: hourly and daily weighted limits, wait them out
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.loads(r.read().decode("utf-8"))
            if data.get("error"):
                raise RuntimeError(data.get("reason"))
            break
        except Exception as e:
            print(f"  retry {attempt + 1} ({lat}, {lon}): {e}")
            time.sleep(600 if "429" in str(e) else 90)
    else:
        raise SystemExit("Open-Meteo request failed")
    h = pd.DataFrame(data["hourly"])
    h["date"] = pd.to_datetime(h["time"]).dt.floor("D")
    rows = []
    for lead in LEADS:
        sfx = "" if lead == 0 else f"_previous_day{lead}"
        g = h.groupby("date").agg(
            t=(f"temperature_2m{sfx}", "max"), rh=(f"relative_humidity_2m{sfx}", "min"),
            w=(f"wind_speed_10m{sfx}", "mean"), r=(f"precipitation{sfx}", "sum"),
            n=(f"temperature_2m{sfx}", "count"),
        ).reset_index()
        g.loc[g["n"] < 20, ["t", "rh", "w", "r"]] = np.nan  # incomplete day
        g["lead"] = lead
        rows.append(g.drop(columns="n"))
    out = pd.concat(rows, ignore_index=True)
    out["lat"], out["lon"] = lat, lon
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(path, index=False)
    time.sleep(25)  # stay under the per-minute weighted limit
    return out


def subset(code: str, w_all: pd.DataFrame) -> pd.Series:
    """Largest fire weights, at most MAX_POINTS, renormalized."""
    wt = point_weights(code, w_all).sort_values(ascending=False)
    wt = wt[wt > 0].iloc[:MAX_POINTS]
    return wt / wt.sum()


def power_arrays(pts, dates) -> dict:
    """POWER daily arrays (dates × points) in the forecast variable names."""
    frames = {p: fetch_point(*p).set_index("date") for p in pts}
    a = {
        "t": np.column_stack([frames[p]["temperature_2m_max"].reindex(dates).to_numpy() for p in pts]),
        "rh": np.column_stack([frames[p]["relative_humidity_2m_min"].reindex(dates).to_numpy() for p in pts]),
        "w": np.column_stack([frames[p]["wind_speed_10m_mean"].reindex(dates).to_numpy() for p in pts]),
        "r": np.column_stack([frames[p]["precipitation_sum"].reindex(dates).to_numpy() for p in pts]),
    }
    for k in a:
        a[k] = pd.DataFrame(a[k]).ffill().bfill().to_numpy()
    return a


def dry_days(r: np.ndarray) -> np.ndarray:
    out = np.zeros_like(r)
    run = np.zeros(r.shape[1])
    for i in range(len(r)):
        run = np.where(r[i] >= 2.0, 0.0, run + 1.0)
        out[i] = run
    return out


def main(args: list[str]) -> None:
    for code in args or ["PL", "PT"]:
        pts_all = grid_points(code)
        from forecast_check import fetch_weather
        w_all = fetch_weather(code, pts_all)
        wt = subset(code, w_all)
        pts = [tuple(x) for x in wt.index]
        weights = wt.to_numpy()
        print(f"{code}: {len(pts)} points, fire weight covered by the subset (before renormalizing): "
              f"{point_weights(code, w_all).loc[wt.index].sum():.0%}")

        dates = pd.date_range("2012-01-01", TEST[1])
        P = power_arrays(pts, dates)
        months = dates.month.to_numpy()
        obs, _ = F.fwi_series(P["t"], P["rh"], P["w"], P["r"], months, south=code in ("AU", "CL"))
        P_dd = dry_days(P["r"])
        P_vpd = es(P["t"]) - es(P["t"]) * P["rh"] / 100

        def country(arrs: dict) -> pd.DataFrame:
            return pd.DataFrame({k: v @ weights for k, v in arrs.items()}, index=dates[-len(next(iter(arrs.values()))):])

        obs_feats = country({**{k: obs[k] for k in ("ffmc", "dmc", "dc", "isi", "bui", "fwi")},
                             "t": P["t"], "rh": P["rh"], "w": P["w"], "vpd": P_vpd, "dry_days": P_dd,
                             "rain7": pd.DataFrame(P["r"]).rolling(7, min_periods=1).sum().to_numpy()})

        # ---- model: climatology + seasonal ridge on weather anomalies, trained 2012..TRAIN_LAST
        y = target(code)
        ly = np.log1p(y)
        tr = (y.index.year <= TRAIN_LAST)
        clim = climatology(y, tr.to_numpy() if hasattr(tr, "to_numpy") else tr)
        season = SEASON[y.index.month - 1]
        Xtr = obs_feats.loc[y.index[tr], FEATS].to_numpy()
        resid = (ly - clim).to_numpy()[tr]
        models = {}
        for s in range(4):
            m = season[tr] == s
            mu, sd = Xtr[m].mean(0), Xtr[m].std(0) + 1e-9
            A = np.column_stack([np.ones(m.sum()), (Xtr[m] - mu) / sd])
            lam = np.eye(A.shape[1]); lam[0, 0] = 0
            models[s] = (mu, sd, np.linalg.solve(A.T @ A + lam, A.T @ resid[m]))

        def predict(X: pd.DataFrame) -> pd.Series:
            idx = X.index
            out = clim.reindex(idx).to_numpy().copy()
            ss = SEASON[idx.month - 1]
            for s, (mu, sd, b) in models.items():
                m = ss == s
                if m.any():
                    out[m] += np.column_stack([np.ones(m.sum()), (X.loc[idx[m], FEATS].to_numpy() - mu) / sd]) @ b
            return pd.Series(out, index=idx)

        # ---- forecasts: bias-corrected forecast weather, codes continued from the observed state
        om = pd.concat([fetch_om(*p) for p in pts], ignore_index=True)
        test_dates = pd.date_range(*TEST)
        FC = {lead: {v: np.column_stack([om[(om["lead"] == lead) & (om["lat"] == p[0]) & (om["lon"] == p[1])]
                                         .set_index("date")[v].reindex(test_dates).to_numpy() for p in pts])
                     for v in VARS} for lead in LEADS}
        # bias per lead, point and calendar month: forecast vs POWER on the same valid day. Per lead,
        # because the archive switches weather models with lead (day 7: drier, windier, less rain).
        Pt = {v: P[v][-len(test_dates):] for v in VARS}
        mon = test_dates.month.to_numpy()
        for v in VARS:
            for mo in range(1, 13):
                m = mon == mo
                for lead in LEADS:
                    f0, p0 = FC[lead][v][m], Pt[v][m]
                    if v == "r":
                        FC[lead][v][m] *= np.clip(np.nanmean(p0, 0) / np.maximum(np.nanmean(f0, 0), 1e-6), 0.3, 3.0)
                    else:
                        FC[lead][v][m] -= np.nanmean(f0 - p0, 0)
        for lead in LEADS:
            for v in VARS:
                FC[lead][v] = pd.DataFrame(FC[lead][v]).ffill().bfill().to_numpy()
            FC[lead]["rh"] = np.clip(FC[lead]["rh"], 1, 100)
            FC[lead]["r"] = np.maximum(FC[lead]["r"], 0)

        off = len(dates) - len(test_dates)  # index of TEST[0] in `dates`
        results = {}
        observed = y.reindex(test_dates)
        c_test = clim.reindex(test_dates)
        perfect = predict(obs_feats.loc[test_dates])
        lead_preds = {}
        for L in range(1, 8):
            # issue i: state at the end of day I = test_dates[i] - 1 (observed); forecast day k is
            # I + k = test_dates[i + k - 1] (lead k of the same run); target I + L = test_dates[i + L - 1]
            n = len(test_dates) - L
            # state at the end of issue day I (= day before the first forecast day)
            f0 = obs["ffmc"][off - 1 + np.arange(n)]
            p0 = obs["dmc"][off - 1 + np.arange(n)]
            d0 = obs["dc"][off - 1 + np.arange(n)]
            dd = P_dd[off - 1 + np.arange(n)]
            rain_hist = [P["r"][off - 1 - j + np.arange(n)] for j in range(6, -1, -1)]  # days I-6..I
            for k in range(1, L + 1):
                vi = np.arange(n) + k - 1  # valid day index in test_dates: I + k
                t, rh, w, r = (FC[k][v][vi] for v in VARS)
                mi = (test_dates.month.to_numpy()[vi] - 1 + (6 if code in ("AU", "CL") else 0)) % 12
                f0 = F.ffmc(t, rh, w, r, f0)
                p0 = F.dmc(t, rh, r, p0, F.LE_NORTH[mi][:, None])
                d0 = F.dc(t, r, d0, F.LF_NORTH[mi][:, None])
                dd = np.where(r >= 2.0, 0.0, dd + 1.0)
                rain_hist = rain_hist[1:] + [r]
            ri = F.isi(w, f0)
            u = F.bui(p0, d0)
            feats = {"ffmc": f0, "dmc": p0, "dc": d0, "isi": ri, "bui": u, "fwi": F.fwi(ri, u),
                     "t": t, "rh": rh, "w": w, "vpd": es(t) - es(t) * rh / 100, "dry_days": dd,
                     "rain7": sum(rain_hist)}
            tgt = test_dates[L - 1 + np.arange(n)]
            X = pd.DataFrame({k: v @ weights for k, v in feats.items()}, index=tgt)
            lead_preds[L] = predict(X)

        def score(pred: pd.Series) -> dict:
            o = np.log1p(observed.loc[pred.index].to_numpy())
            c = c_test.loc[pred.index].to_numpy()
            p = pred.to_numpy()
            sse_c, sse_p = np.sum((o - c) ** 2), np.sum((o - p) ** 2)
            return {"skill_vs_clim": round(float(1 - sse_p / sse_c), 3),
                    "r2": round(float(1 - sse_p / np.sum((o - o.mean()) ** 2)), 3),
                    "anom_corr": round(float(np.corrcoef(o - c, p - c)[0, 1]), 3),
                    "resid_sd": round(float(np.std(o - p)), 3)}

        common = lead_preds[7].index
        results["perfect (reanalysis)"] = score(perfect.loc[common])
        for L, p in lead_preds.items():
            results[f"lead {L}"] = score(p.loc[common])
        # 7-day total issued on day I: sum of leads 1..7 vs observed sum
        issue = common - pd.Timedelta(days=7)
        tot_p = sum(np.expm1(np.maximum(lead_preds[L].reindex(issue + pd.Timedelta(days=L)).to_numpy(), 0)) for L in range(1, 8))
        tot_c = sum(np.expm1(np.maximum(c_test.reindex(issue + pd.Timedelta(days=L)).to_numpy(), 0)) for L in range(1, 8))
        tot_o = sum(observed.reindex(issue + pd.Timedelta(days=L)).to_numpy() for L in range(1, 8))
        ok = ~np.isnan(tot_p + tot_c + tot_o)
        lo, lp, lc = np.log1p(tot_o[ok]), np.log1p(tot_p[ok]), np.log1p(tot_c[ok])
        results["next 7 days total"] = {
            "skill_vs_clim": round(float(1 - np.sum((lo - lp) ** 2) / np.sum((lo - lc) ** 2)), 3),
            "corr": round(float(np.corrcoef(lo, lp)[0, 1]), 3),
            "corr_clim": round(float(np.corrcoef(lo, lc)[0, 1]), 3),
            "anom_corr": round(float(np.corrcoef(lo - lc, lp - lc)[0, 1]), 3),
            # interval: residual SD of log1p 7-day totals
            "resid_sd_log": round(float(np.std(lo - lp)), 3),
        }
        (CACHE_DIR / f"forecast_skill_{code}.json").write_text(json.dumps(results, indent=1))
        print(json.dumps(results, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
