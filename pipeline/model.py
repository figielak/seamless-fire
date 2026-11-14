"""Stage 2: harmonization model, validation of methods A-E, model.json.

Reads the stage 1 cache (pipeline/cache/{CC}_celldays.parquet).
"""

import json

import numpy as np
import pandas as pd

from config import (
    CACHE_DIR, CALIB_EXCLUDE, CALIB_YEARS, COUNTRIES, DE_TIE, FIRST_MONTH, INTERVAL_Z,
    HIST_LAST_YEAR, LAST_COMPLETE_MONTH, LOW_QUALITY, MIN_FIRE_MONTHS, N20_FACTOR_YEARS, OUT_DIR,
    SATELLITE_SENSOR, SEASON_OF_MONTH, SNPP_LAST_DATE, TERRA_SEASON_MIN,
)

METHODS = ["A", "B", "C", "D", "E", "D+s", "E+s"]
BACKTEST_TRAIN = (2019, 2025)
BACKTEST_TEST = (2012, 2018)
ALL_MONTHS = pd.period_range(FIRST_MONTH, LAST_COMPLETE_MONTH, freq="M")


# ---------------------------------------------------------------- monthly series

def load_meta(code: str, check_files: bool = True) -> dict:
    """Cache metadata; refuse a cache built for another coverage end or other raw files,
    so a stale cache is never silently padded with zero months."""
    path = CACHE_DIR / f"{code}_meta.json"
    if not path.exists():
        raise RuntimeError(f"{code}: cache has no metadata, rebuild with build_data.py {code}")
    meta = json.loads(path.read_text())
    if meta["last_complete_month"] != LAST_COMPLETE_MONTH:
        raise RuntimeError(f"{code}: cache ends {meta['last_complete_month']}, config {LAST_COMPLETE_MONTH}")
    if check_files:
        from build_data import raw_files  # lazy: build_data imports this module
        current = [[f.name, f.stat().st_size] for f in raw_files(code)]
        if current != meta["files"]:
            raise RuntimeError(f"{code}: raw files changed since the cache was built, rebuild")
    return meta


def check_coverage(code: str, meta: dict) -> None:
    """S-NPP (the target scale) must cover the whole last month."""
    last = meta["coverage"].get("SNPP", [None, ""])[1]
    end = str(pd.Period(LAST_COMPLETE_MONTH, "M").end_time.date())
    if last < end:
        raise RuntimeError(f"{code}: S-NPP data end {last}, before the end of {LAST_COMPLETE_MONTH}")


def load_celldays(code: str) -> pd.DataFrame:
    cd = pd.read_parquet(CACHE_DIR / f"{code}_celldays.parquet")
    cd["sat"] = cd["sat"].astype(str)
    return cd


def unique_by_sensor(cd: pd.DataFrame) -> pd.DataFrame:
    """Cell-days per sensor; MODIS = Terra ∪ Aqua (a cell-day counts once)."""
    out = cd.assign(sensor=cd["sat"].map(SATELLITE_SENSOR))
    return out.drop_duplicates(["sensor", "lat_i", "lon_i", "date"])


def monthly_series(code: str, cd: pd.DataFrame | None = None) -> pd.DataFrame:
    """Country monthly cell-days: columns MODIS, Terra, Aqua, SNPP, N20; all months, zeros filled."""
    cd = load_celldays(code) if cd is None else cd
    month = cd["date"].dt.to_period("M")
    per_sat = cd.groupby([month, "sat"]).size().unstack("sat", fill_value=0)
    u = unique_by_sensor(cd)
    modis = u[u["sensor"] == "MODIS"].groupby(u["date"].dt.to_period("M")).size()
    out = per_sat.reindex(columns=["Terra", "Aqua", "SNPP", "N20"], fill_value=0)
    out["MODIS"] = modis
    out = out.reindex(ALL_MONTHS, fill_value=0).fillna(0).astype(int)
    out.index.name = "month"
    return out


def calib_frame(code: str, ms: pd.DataFrame) -> pd.DataFrame:
    """Calibration months: first full S-NPP month .. end of calibration, minus outages."""
    first = viirs_first_month(ms)
    idx = ms.index[(ms.index >= first) & (ms.index.year <= CALIB_YEARS[1])]
    idx = idx[~idx.astype(str).isin(CALIB_EXCLUDE)]
    df = pd.DataFrame({
        "country": code,
        "year": idx.year,
        "cal_month": idx.month,
        "season": [SEASON_OF_MONTH[m] for m in idx.month],
        "M": ms.loc[idx, "MODIS"].to_numpy(float),
        "V": ms.loc[idx, "SNPP"].to_numpy(float),
    }, index=idx.astype(str))
    return df


def viirs_first_month(ms: pd.DataFrame) -> pd.Period:
    """First full S-NPP month (S-NPP starts 2012-01-20, so January 2012 is partial)."""
    first = ms.index[ms["SNPP"] > 0][0]
    return first + 1 if first == pd.Period("2012-01", "M") else first


# ---------------------------------------------------------------- methods

def fit_loglog(train: pd.DataFrame, seasonal: bool) -> dict:
    x = np.log1p(train["M"].to_numpy())
    y = np.log1p(train["V"].to_numpy())
    if seasonal:
        X = np.zeros((len(train), 5))
        X[np.arange(len(train)), train["season"].to_numpy()] = 1
        X[:, 4] = x
        coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        a, b = list(coef[:4]), coef[4]
        # A season absent from the training data keeps the mean intercept.
        present = set(train["season"])
        mean_a = float(np.mean([a[s] for s in present]))
        a = [a[s] if s in present else mean_a for s in range(4)]
    else:
        X = np.column_stack([np.ones(len(train)), x])
        (a0, b), *_ = np.linalg.lstsq(X, y, rcond=None)
        a = [a0] * 4
    fitted = np.array(a)[train["season"].to_numpy()] + b * x
    smear = float(np.mean(np.exp(y - fitted)))  # Duan smearing factor for exp(log1p V)
    return {"a": [float(v) for v in a], "b": float(b), "smear": smear}


def predict_loglog(p: dict, df: pd.DataFrame, smear: bool = False) -> np.ndarray:
    log_v1 = np.array(p["a"])[df["season"].to_numpy()] + p["b"] * np.log1p(df["M"].to_numpy())
    v1 = np.exp(log_v1) * (p["smear"] if smear else 1.0)
    return np.maximum(v1 - 1, 0)


def fit(method: str, train_c: pd.DataFrame, train_all: pd.DataFrame) -> dict:
    if method == "A":
        return {"r": train_all["V"].sum() / train_all["M"].sum()}
    if method == "B":
        return {"r": train_c["V"].sum() / train_c["M"].sum()}
    if method == "C":
        g = train_c.groupby("cal_month")[["V", "M"]].sum()
        overall = train_c["V"].sum() / train_c["M"].sum()
        r = {m: (g.loc[m, "V"] / g.loc[m, "M"] if m in g.index and g.loc[m, "M"] > 0 else overall)
             for m in range(1, 13)}
        return {"r_month": r}
    if method in ("D", "D+s"):
        return fit_loglog(train_c, seasonal=False)
    if method in ("E", "E+s"):
        return fit_loglog(train_c, seasonal=True)
    raise ValueError(method)


def predict(method: str, p: dict, df: pd.DataFrame) -> np.ndarray:
    if method in ("A", "B"):
        return df["M"].to_numpy() * p["r"]
    if method == "C":
        return df["M"].to_numpy() * df["cal_month"].map(p["r_month"]).to_numpy()
    return predict_loglog(p, df, smear=method.endswith("+s"))


# ---------------------------------------------------------------- validation

def annual_errors(test: pd.DataFrame, pred: np.ndarray) -> pd.Series:
    """Signed annual relative error per year: (ΣV̂ − ΣV) / ΣV."""
    t = test.assign(pred=pred).groupby("year")[["pred", "V"]].sum()
    t = t[t["V"] > 0]
    return (t["pred"] - t["V"]) / t["V"]


def log_resid(test: pd.DataFrame, pred: np.ndarray) -> np.ndarray:
    return np.log1p(pred) - np.log1p(test["V"].to_numpy())


def validate(frame_c: pd.DataFrame, frame_all: pd.DataFrame, methods: list[str]) -> dict:
    """LOYO and backtest for one country (frame_c) given all countries (frame_all, for A)."""
    res = {}
    years = sorted(frame_c["year"].unique())
    for m in methods:
        errs, resids, loyo_ann_logratio = [], [], []
        for y in years:
            test = frame_c[frame_c["year"] == y]
            p = fit(m, frame_c[frame_c["year"] != y], frame_all[frame_all["year"] != y])
            pred = predict(m, p, test)
            e = annual_errors(test, pred)
            errs.append(e)
            resids.append(log_resid(test, pred))
            loyo_ann_logratio.extend(np.log1p(e.to_numpy()))
        errs = pd.concat(errs)
        resids = np.concatenate(resids)

        tr = frame_c["year"].between(*BACKTEST_TRAIN)
        tr_all = frame_all["year"].between(*BACKTEST_TRAIN)
        te = frame_c["year"].between(*BACKTEST_TEST)
        if tr.sum() >= 24 and te.sum() >= 12:
            p = fit(m, frame_c[tr], frame_all[tr_all])
            bt = annual_errors(frame_c[te], predict(m, p, frame_c[te]))
        else:  # e.g. S-NPP only in 2012-2017: no backtest possible
            bt = pd.Series(dtype=float)

        res[m] = {
            "loyo_annual": float(errs.abs().mean()),
            "loyo_bias": float(errs.mean()),
            "loyo_logrmse": float(np.sqrt(np.mean(resids ** 2))),
            "loyo_sigma": float(np.std(resids, ddof=1)),
            "loyo_sigma_annual": float(np.std(loyo_ann_logratio, ddof=1)),
            "backtest_annual": float(bt.abs().mean()),
            "backtest_bias": float(bt.mean()),
            "backtest_by_year": {int(k): float(v) for k, v in bt.items()},
        }
    return res


def choose_de(val: dict) -> str:
    return "E" if val["E"]["loyo_logrmse"] < val["D"]["loyo_logrmse"] - DE_TIE else "D"


# ---------------------------------------------------------------- extra diagnostics

def n20_factor(ms: pd.DataFrame) -> float:
    y0, y1 = N20_FACTOR_YEARS
    sel = ms[(ms.index.year >= y0) & (ms.index.year <= y1) & (ms["N20"] > 0)]
    sel = sel[~sel.index.astype(str).isin(CALIB_EXCLUDE)]
    return float(sel["SNPP"].sum() / sel["N20"].sum())


def terra_only(cd: pd.DataFrame, ms: pd.DataFrame) -> dict:
    """(Terra ∪ Aqua)/Terra ratio for months before Aqua, per season if stable."""
    first_aqua = cd.loc[cd["sat"] == "Aqua", "date"].min().to_period("M")
    until = first_aqua - 1  # last month without any Aqua data
    sel = ms[(ms.index.year >= 2003) & (ms.index.year <= HIST_LAST_YEAR)]
    sel = sel[~sel.index.astype(str).isin(CALIB_EXCLUDE)]
    season = np.array([SEASON_OF_MONTH[m] for m in sel.index.month])
    overall = sel["MODIS"].sum() / sel["Terra"].sum()
    by_season = [(sel["MODIS"][season == s].sum(), sel["Terra"][season == s].sum()) for s in range(4)]
    seasonal = all(t >= TERRA_SEASON_MIN for _, t in by_season)
    ratio = [float(m / t) for m, t in by_season] if seasonal else [float(overall)] * 4
    active = (sel["Terra"] > 0) | (sel["MODIS"] > 0)
    resid = (np.log1p(sel["MODIS"]) - np.log1p(np.array(ratio)[season] * sel["Terra"]))[active]
    return {"until": str(until), "ratio": ratio, "seasonal": seasonal,
            "sigma": float(np.std(resid, ddof=1))}


def agreement(cd: pd.DataFrame, first: pd.Period) -> dict:
    """Share of MODIS cell-days also seen by S-NPP and vice versa (exact cell and 3x3 neighbors)."""
    u = unique_by_sensor(cd)
    u = u[(u["date"].dt.to_period("M") >= first) & (u["date"].dt.year <= CALIB_YEARS[1])]
    keys = ["lat_i", "lon_i", "date"]
    mod = u.loc[u["sensor"] == "MODIS", keys]
    vii = u.loc[u["sensor"] == "SNPP", keys]

    def share(a: pd.DataFrame, b: pd.DataFrame, neighbors: bool) -> tuple[float, list]:
        if neighbors:
            b = pd.concat([b.assign(lat_i=b.lat_i + dy, lon_i=b.lon_i + dx)
                           for dy in (-1, 0, 1) for dx in (-1, 0, 1)]).drop_duplicates()
        hit = a.merge(b.assign(hit=True), on=keys, how="left")["hit"].fillna(False).to_numpy(bool)
        months = a["date"].dt.month.to_numpy()
        by_month = [round(float(hit[months == m].mean()), 4) if (months == m).any() else None
                    for m in range(1, 13)]
        return float(hit.mean()), by_month

    out = {}
    for name, nb in (("exact", False), ("neighbor", True)):
        mv, mv_m = share(mod, vii, nb)
        vm, vm_m = share(vii, mod, nb)
        out[name] = {"modis_in_viirs": mv, "viirs_in_modis": vm, "by_month": [mv_m, vm_m]}
    out["n_modis"], out["n_viirs"] = len(mod), len(vii)
    return out


def industrial_share(code: str) -> dict:
    stats = json.loads((CACHE_DIR / f"{code}_filter_stats.json").read_text())
    out = {sat: by_type.get("2", 0) / sum(by_type.values()) for sat, by_type in stats.items()}
    for sensor, sats in (("MODIS", ["Terra", "Aqua"]), ("VIIRS", ["SNPP", "N20"])):
        tot = sum(sum(stats.get(s, {}).values()) for s in sats)
        ind = sum(stats.get(s, {}).get("2", 0) for s in sats)
        out[sensor] = ind / tot if tot else None
    return out


# ---------------------------------------------------------------- harmonized series

def harmonized_monthly(ms: pd.DataFrame, a: list, b: float, terra: dict) -> pd.DataFrame:
    """Country monthly series on the S-NPP scale: observed S-NPP from the first full month,
    model on MODIS before (Terra-only months scaled first)."""
    first = viirs_first_month(ms)
    season = np.array([SEASON_OF_MONTH[m] for m in ms.index.month])
    m_eff = np.array(ms["MODIS"], dtype=float)  # copy: to_numpy may return a read-only view
    terra_only_mask = ms.index <= pd.Period(terra["until"], "M")
    m_eff[terra_only_mask] = np.array(terra["ratio"])[season[terra_only_mask]] * ms["Terra"].to_numpy()[terra_only_mask]
    model = np.maximum(np.expm1(np.array(a)[season] + b * np.log1p(m_eff)), 0)
    observed = ms.index >= first
    return pd.DataFrame({
        "modis": ms["MODIS"], "viirs": ms["SNPP"],
        "harmonized": np.where(observed, ms["SNPP"], model),
        "estimated": ~observed, "terra_only": terra_only_mask,
    }, index=ms.index)


def annual_series(hm: pd.DataFrame, sigma_annual: float, b: float, sigma_terra: float) -> dict:
    g = hm.groupby(hm.index.year).agg(
        modis=("modis", "sum"), viirs=("viirs", "sum"), harmonized=("harmonized", "sum"),
        estimated=("estimated", "all"), terra_only=("terra_only", "any"),
        n_months=("harmonized", "size"))
    s = np.where(g["terra_only"], np.sqrt(sigma_annual ** 2 + (b * sigma_terra) ** 2), sigma_annual)
    k = np.where(g["estimated"], np.exp(INTERVAL_Z * s), 1.0)
    return {
        "years": [int(y) for y in g.index],
        "modis": g["modis"].astype(int).tolist(),
        "viirs": g["viirs"].astype(int).tolist(),
        "harmonized": [round(float(v), 1) for v in g["harmonized"]],
        "lo": [round(float(v), 1) for v in g["harmonized"] / k],
        "hi": [round(float(v), 1) for v in g["harmonized"] * k],
        "partial_year": [bool(n < 12) for n in g["n_months"]],
    }


# ---------------------------------------------------------------- build

def rnd(x, n=4):
    if isinstance(x, dict):
        return {k: rnd(v, n) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [rnd(v, n) for v in x]
    if isinstance(x, (float, np.floating)):
        return round(float(x), n)
    return x


def cached_countries() -> list[str]:
    return [c for c in COUNTRIES if (CACHE_DIR / f"{c}_celldays.parquet").exists()]


def build_models(codes: list[str]) -> dict:
    """Write {CC}/model.json for each code; A and the pooled model use all cached countries."""
    data = {}
    for c in cached_countries():
        load_meta(c)  # every country in method A / the pooled model must use the current cache
        cd = load_celldays(c)
        ms = monthly_series(c, cd)
        data[c] = (cd, ms, calib_frame(c, ms))
    frame_all = pd.concat([f for _, _, f in data.values()])

    pooled = None
    results = {}
    for code in codes:
        meta = load_meta(code)
        check_coverage(code, meta)
        cd, ms, frame = data[code]
        val = validate(frame, frame_all, METHODS)
        fire_months = int(((frame["M"] > 0) & (frame["V"] > 0)).sum())
        source = "country"
        variant = choose_de(val)
        fit_frame, val_used = frame, val
        if fire_months < MIN_FIRE_MONTHS:
            if pooled is None:
                pooled_val = validate(frame_all, frame_all, ["D", "E"])
                pooled = (choose_de(pooled_val), pooled_val)
            variant, val_used = pooled[0], pooled[1]
            fit_frame, source = frame_all, "pooled"

        p = fit_loglog(fit_frame, seasonal=(variant == "E"))
        sigma = val_used[variant]["loyo_sigma"]
        sigma_annual = val_used[variant]["loyo_sigma_annual"]
        terra = terra_only(cd, ms)
        hm = harmonized_monthly(ms, p["a"], p["b"], terra)
        first = viirs_first_month(ms)
        last = cd.groupby(cd["sat"].map(SATELLITE_SENSOR))["date"].max()

        model = {
            "model": variant, "source": source, "fire_months": fire_months,
            "a": p["a"], "b": p["b"], "smear": p["smear"],
            "sigma": sigma, "sigma_annual": sigma_annual, "interval_z": INTERVAL_Z,
            "n20_factor": n20_factor(ms), "snpp_last_date": SNPP_LAST_DATE,
            "terra_only": terra,
            "viirs_first_month": str(first),
            "calib_years": list(CALIB_YEARS),
            "methods": val,
            "agreement": agreement(cd, first),
            "industrial_share": industrial_share(code),
            "industrial_share_years": [int(FIRST_MONTH[:4]), HIST_LAST_YEAR],
            "industrial_mask": meta["industrial_mask"],
            "annual": annual_series(hm, sigma_annual, p["b"], terra["sigma"]),
            "low_quality": LOW_QUALITY, "calib_excluded": CALIB_EXCLUDE,
            "last_data": {k: str(v.date()) for k, v in last.items()},
            # End of data coverage (not the last detection date).
            "last_complete_month": LAST_COMPLETE_MONTH,
            "preliminary": meta["preliminary"],
            "coverage": meta["coverage"],
            "hotspots": meta["hotspots"],
            "hotspot_sensors": meta["sensors_by_year"] if meta["hotspots"] else {},
        }
        out = rnd(model)
        # Parameters the site computes with keep full precision (rounded ones shift sums).
        for k in ("a", "b", "sigma", "sigma_annual", "interval_z"):
            out[k] = model[k]
        out["terra_only"] = terra
        path = OUT_DIR / code / "model.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
        print(f"  {code} model {variant} ({source}), a={rnd(p['a'], 3)}, b={p['b']:.3f}, "
              f"sigma={sigma:.3f}, model.json {path.stat().st_size / 1e3:.1f} kB")
        results[code] = model
    return results
