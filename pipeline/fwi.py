"""Canadian Forest Fire Weather Index System (Van Wagner 1987, Equations 1-31; Van Wagner and
Pickett 1985 implementation). Daily, vectorized over locations.

Inputs per day: temperature (°C), relative humidity (%), wind speed (km/h) and 24 h rain (mm),
by convention at local noon; here daily max temperature, min relative humidity and mean wind
from ERA5 / Open-Meteo stand in for noon values (a common approximation).
"""

import numpy as np

# Day-length factors for DMC (Le) and DC (Lf), by month, for latitudes >= 20 N (Van Wagner 1987).
# Southern hemisphere: shift by 6 months (standard practice).
LE_NORTH = np.array([6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0])
LF_NORTH = np.array([-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6])

FFMC0, DMC0, DC0 = 85.0, 6.0, 15.0  # standard start-up values


def ffmc(t, h, w, r, f0):
    mo = 147.2 * (101.0 - f0) / (59.5 + f0)
    rf = np.where(r > 0.5, r - 0.5, 0.0)
    wet = r > 0.5
    mo_r = np.where(
        mo > 150.0,
        mo + 42.5 * rf * np.exp(-100.0 / (251.0 - mo)) * (1.0 - np.exp(-6.93 / np.maximum(rf, 1e-9)))
        + 0.0015 * (mo - 150.0) ** 2 * np.sqrt(rf),
        mo + 42.5 * rf * np.exp(-100.0 / (251.0 - mo)) * (1.0 - np.exp(-6.93 / np.maximum(rf, 1e-9))),
    )
    mo = np.where(wet, np.minimum(mo_r, 250.0), mo)
    ed = 0.942 * h ** 0.679 + 11.0 * np.exp((h - 100.0) / 10.0) + 0.18 * (21.1 - t) * (1.0 - np.exp(-0.115 * h))
    ew = 0.618 * h ** 0.753 + 10.0 * np.exp((h - 100.0) / 10.0) + 0.18 * (21.1 - t) * (1.0 - np.exp(-0.115 * h))
    k0d = 0.424 * (1.0 - (h / 100.0) ** 1.7) + 0.0694 * np.sqrt(w) * (1.0 - (h / 100.0) ** 8)
    kd = k0d * 0.581 * np.exp(0.0365 * t)
    k0w = 0.424 * (1.0 - ((100.0 - h) / 100.0) ** 1.7) + 0.0694 * np.sqrt(w) * (1.0 - ((100.0 - h) / 100.0) ** 8)
    kw = k0w * 0.581 * np.exp(0.0365 * t)
    m = np.where(mo > ed, ed + (mo - ed) * 10.0 ** (-kd), np.where(mo < ew, ew - (ew - mo) * 10.0 ** (-kw), mo))
    return np.clip(59.5 * (250.0 - m) / (147.2 + m), 0.0, 101.0)


def dmc(t, h, r, p0, le):
    t = np.maximum(t, -1.1)
    rk = 1.894 * (t + 1.1) * (100.0 - h) * le * 1e-6
    re = 0.92 * r - 1.27
    mo = 20.0 + np.exp(5.6348 - p0 / 43.43)
    b = np.where(p0 <= 33.0, 100.0 / (0.5 + 0.3 * p0),
                 np.where(p0 <= 65.0, 14.0 - 1.3 * np.log(np.maximum(p0, 1e-9)), 6.2 * np.log(np.maximum(p0, 1e-9)) - 17.2))
    mr = mo + 1000.0 * re / (48.77 + b * re)
    pr = np.maximum(244.72 - 43.43 * np.log(np.maximum(mr - 20.0, 1e-9)), 0.0)
    p = np.where(r > 1.5, pr, p0)
    return np.maximum(p + 100.0 * rk, 0.0)


def dc(t, r, d0, lf):
    t = np.maximum(t, -2.8)
    rd = 0.83 * r - 1.27
    qo = 800.0 * np.exp(-d0 / 400.0)
    qr = qo + 3.937 * rd
    dr = np.maximum(400.0 * np.log(800.0 / np.maximum(qr, 1e-9)), 0.0)
    d = np.where(r > 2.8, dr, d0)
    v = np.maximum(0.36 * (t + 2.8) + lf, 0.0)
    return np.maximum(d + 0.5 * v, 0.0)


def isi(w, f):
    m = 147.2 * (101.0 - f) / (59.5 + f)
    ff = 91.9 * np.exp(-0.1386 * m) * (1.0 + m ** 5.31 / 4.93e7)
    return 0.208 * np.exp(0.05039 * w) * ff


def bui(p, d):
    u = np.where(p <= 0.4 * d, 0.8 * p * d / np.maximum(p + 0.4 * d, 1e-9),
                 p - (1.0 - 0.8 * d / np.maximum(p + 0.4 * d, 1e-9)) * (0.92 + (0.0114 * p) ** 1.7))
    return np.maximum(u, 0.0)


def fwi(r_isi, u):
    fd = np.where(u <= 80.0, 0.626 * u ** 0.809 + 2.0, 1000.0 / (25.0 + 108.64 * np.exp(-0.023 * u)))
    b = 0.1 * r_isi * fd
    s = np.where(b > 1.0, np.exp(2.72 * (0.434 * np.log(np.maximum(b, 1e-9))) ** 0.647), b)
    return s


def fwi_series(temp, rh, wind, rain, months, south=False, state=None):
    """Arrays shaped (days, locations); months 1..12 per day. Returns dict of index arrays and the
    final state (ffmc, dmc, dc per location) to continue a series (e.g. into a forecast)."""
    n, k = temp.shape
    f0, p0, d0 = (state if state is not None else
                  (np.full(k, FFMC0), np.full(k, DMC0), np.full(k, DC0)))
    shift = 6 if south else 0
    out = {name: np.zeros((n, k)) for name in ("ffmc", "dmc", "dc", "isi", "bui", "fwi")}
    for i in range(n):
        mi = (months[i] - 1 + shift) % 12
        h = np.clip(rh[i], 0.0, 100.0)
        r = np.maximum(rain[i], 0.0)
        f0 = ffmc(temp[i], h, wind[i], r, f0)
        p0 = dmc(temp[i], h, r, p0, LE_NORTH[mi])
        d0 = dc(temp[i], r, d0, LF_NORTH[mi])
        ri = isi(wind[i], f0)
        u = bui(p0, d0)
        out["ffmc"][i], out["dmc"][i], out["dc"][i] = f0, p0, d0
        out["isi"][i], out["bui"][i], out["fwi"][i] = ri, u, fwi(ri, u)
    return out, (f0, p0, d0)
