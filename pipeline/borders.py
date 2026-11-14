"""Country borders for the daily near real-time update (live/borders.json).

The FIRMS country files used for 2000-2026 are cut by FIRMS's own borders. The daily update
reads the global near real-time file instead, so points are assigned to countries here.
Source: Natural Earth 1:10m Admin 0 countries, "Ukraine point of view" variant (Crimea is part
of Ukraine, as in the FIRMS Ukraine files; the other 7 countries are the same as the default
file). Public domain, https://www.naturalearthdata.com/.

The polygons are rasterized once to a 0.01° grid (a cell is in the country when its centre is
inside, even-odd rule) and stored as column runs per grid row, so a point test is a lookup.
The country is then grown by one cell (~1 km) into cells that belong to no other Natural Earth
country: the 1:10m coastline misses coastal and island detections (Greece 1.8% of 2025 NOAA-20
vegetation detections), while land borders stay exact.

Usage: python pipeline/borders.py path/to/ne_10m_admin_0_countries_ukr.geojson
"""

import json
import sys
from pathlib import Path

import numpy as np

from config import BORDERS_FILE, COUNTRIES

ADM0_A3 = {"PL": "POL", "PT": "PRT", "ES": "ESP", "GR": "GRC", "UA": "UKR", "AU": "AUS", "CA": "CAN", "CL": "CHL"}
DEG = 0.01


def polygons_of(geom: dict) -> list:
    return geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]


def extract(src: Path) -> tuple[dict, dict]:
    """({code: polygons}, {ADM0_A3: polygons} for every country);
    polygon = [outer ring, hole, ...], ring = [[lon, lat], ...]."""
    geo = json.loads(src.read_text(encoding="utf-8"))
    by_a3 = {f["properties"]["ADM0_A3"]: polygons_of(f["geometry"]) for f in geo["features"]}
    ours = {code: by_a3[ADM0_A3[code]] for code in COUNTRIES}
    return ours, by_a3


def bbox_of(polygons: list) -> tuple[float, float, float, float]:
    pts = np.concatenate([np.asarray(p[0], float) for p in polygons])
    return pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()


def to_dense(raster: dict, r0: int, c0: int, shape: tuple[int, int]) -> np.ndarray:
    """Runs -> boolean grid with origin (row r0, col c0); parts outside the grid are clipped."""
    g = np.zeros(shape, dtype=bool)
    for k, rr in enumerate(raster["runs"]):
        r = raster["row0"] + k - r0
        if not 0 <= r < shape[0]:
            continue
        for a, b in zip(rr[0::2], rr[1::2]):
            a, b = max(a - c0, 0), min(b - c0, shape[1] - 1)
            if b >= a:
                g[r, a:b + 1] = True
    return g


def from_dense(g: np.ndarray, r0: int, c0: int) -> dict:
    rows = np.flatnonzero(g.any(axis=1))
    runs = []
    for r in range(rows.min(), rows.max() + 1):
        d = np.diff(np.concatenate([[0], g[r].astype(np.int8), [0]]))
        starts = np.flatnonzero(d == 1)
        ends = np.flatnonzero(d == -1) - 1
        runs.append([int(x) for pair in zip(starts + c0, ends + c0) for x in pair])
    return {"row0": int(rows.min() + r0), "runs": runs}


def grow_coast(own: dict, others: dict, deg: float = DEG) -> dict:
    """own ∪ (own grown by one cell, 8-neighbourhood) minus cells of other countries."""
    r0 = own["row0"] - 2
    c0 = min(min(r[0::2]) for r in own["runs"] if r) - 2
    c1 = max(max(r[1::2]) for r in own["runs"] if r) + 2
    shape = (len(own["runs"]) + 4, c1 - c0 + 1)
    g = to_dense(own, r0, c0, shape)
    grown = g.copy()
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            grown |= np.roll(np.roll(g, dr, axis=0), dc, axis=1)
    w, s, e, n = c0 * deg, r0 * deg, (c1 + 1) * deg, (r0 + shape[0]) * deg
    other = np.zeros(shape, dtype=bool)
    for polys in others.values():
        ow, os_, oe, on = bbox_of(polys)
        if oe < w or ow > e or on < s or os_ > n:
            continue
        other |= to_dense(rasterize(polys, deg), r0, c0, shape)
    return from_dense(g | (grown & ~other), r0, c0)


def rasterize(polygons: list, deg: float = DEG) -> dict:
    """Scanline fill at cell centres. Returns {"row0": first row, "runs": [[c0, c1, ...], ...]}:
    for grid row row0 + k, cells c0..c1 (inclusive), c2..c3, ... are inside."""
    xs, rows = [], []
    for poly in polygons:  # parts do not overlap, so even-odd over all rings of all parts works
        for ring in poly:
            r = np.asarray(ring, float)
            if not np.array_equal(r[0], r[-1]):
                r = np.vstack([r, r[:1]])
            x1, y1, x2, y2 = r[:-1, 0], r[:-1, 1], r[1:, 0], r[1:, 1]
            lo, hi = np.minimum(y1, y2), np.maximum(y1, y2)
            # rows whose centre yc satisfies lo <= yc < hi
            r_lo = np.ceil(lo / deg - 0.5).astype(np.int64)
            r_hi = np.ceil(hi / deg - 0.5).astype(np.int64) - 1
            n = np.maximum(r_hi - r_lo + 1, 0)
            if not n.sum():
                continue
            e = np.repeat(np.arange(len(n)), n)
            row = r_lo[e] + (np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n))
            yc = (row + 0.5) * deg
            x = x1[e] + (yc - y1[e]) * (x2[e] - x1[e]) / (y2[e] - y1[e])
            xs.append(x)
            rows.append(row)
    if not xs:  # tiny islands that cross no row centre
        return {"row0": 0, "runs": []}
    x = np.concatenate(xs)
    row = np.concatenate(rows)
    order = np.lexsort((x, row))
    x, row = x[order], row[order]
    row0 = int(row.min())
    runs: list[list[int]] = [[] for _ in range(int(row.max()) - row0 + 1)]
    bounds = np.flatnonzero(np.diff(row)) + 1
    for xr, rr in zip(np.split(x, bounds), np.split(row, bounds)):
        if len(xr) % 2:
            raise ValueError(f"odd number of crossings in row {rr[0]}")
        out = runs[int(rr[0]) - row0]
        for xa, xb in zip(xr[0::2], xr[1::2]):  # centre xc with xa <= xc < xb
            c0 = int(np.ceil(xa / deg - 0.5))
            c1 = int(np.ceil(xb / deg - 0.5)) - 1
            if c1 >= c0:
                out += [c0, c1]
    return {"row0": row0, "runs": runs}


def load() -> dict:
    return json.loads(BORDERS_FILE.read_text(encoding="utf-8"))


def in_country(lon, lat, raster: dict, deg: float = DEG) -> np.ndarray:
    """True where the point's 0.01° cell centre is inside the country."""
    lon = np.asarray(lon, float)
    lat = np.asarray(lat, float)
    row = np.floor(lat / deg + 1e-9).astype(np.int64) - raster["row0"]
    col = np.floor(lon / deg + 1e-9).astype(np.int64)
    out = np.zeros(len(lon), dtype=bool)
    runs = raster["runs"]
    ok = np.flatnonzero((row >= 0) & (row < len(runs)))
    for r in np.unique(row[ok]):
        rr = runs[r]
        if not rr:
            continue
        idx = ok[row[ok] == r]
        a = np.asarray(rr[0::2])
        b = np.asarray(rr[1::2])
        k = np.searchsorted(a, col[idx], side="right") - 1  # last run starting at or before col
        out[idx] = (k >= 0) & (col[idx] <= b[np.maximum(k, 0)])
    return out


def main(args: list[str]) -> None:
    if len(args) != 1:
        sys.exit(__doc__)
    ours, world = extract(Path(args[0]))
    data = {
        "source": "Natural Earth 1:10m Admin 0 countries, Ukraine point of view (public domain); "
                  "grown by one 0.01° cell into cells of no other country",
        "deg": DEG,
        "countries": {c: grow_coast(rasterize(p), {a3: q for a3, q in world.items() if a3 != ADM0_A3[c]})
                      for c, p in ours.items()},
    }
    BORDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    BORDERS_FILE.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    cells = {c: sum((b - a + 1) for r in v["runs"] for a, b in zip(r[0::2], r[1::2]))
             for c, v in data["countries"].items()}
    print(f"{BORDERS_FILE.name}: {BORDERS_FILE.stat().st_size / 1e6:.2f} MB, 0.01° cells {cells}")


if __name__ == "__main__":
    main(sys.argv[1:])
