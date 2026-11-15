"""Place names for "Places to watch": nearest town or village and its region, per country.

Source: GeoNames, cities1000 (populated places with at least 1000 people), admin1 region and country names,
https://www.geonames.org/, licence CC BY 4.0. Downloaded once into data/geonames/ (gitignored).

Output: public/data/{CC}/places.json, compact arrays:
  {"source": str, "regions": [str], "lat": [..], "lon": [..], "name": [..], "r": [region index]}
Places from neighbour countries within 0.3° of the country bounding box are kept too (a place to
watch near a border may be closest to a town across it); their region carries the country name.

Usage: python pipeline/places.py
"""

import json
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

from config import COUNTRIES, ENCODING, OUT_DIR, RAW_DIR

GEO_DIR = RAW_DIR / "geonames"
BASE = "https://download.geonames.org/export/dump/"
MARGIN = 0.3  # degrees around the country bounding box



def fetch(name: str) -> Path:
    path = GEO_DIR / name
    if not path.exists():
        GEO_DIR.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(BASE + name, headers={"User-Agent": "seamless-fire-pipeline"})
        with urllib.request.urlopen(req, timeout=120) as r:
            path.write_bytes(r.read())
    return path


def load() -> tuple[list[tuple], dict[str, str], dict[str, str]]:
    """(places [(lat, lon, name, country, admin1)], admin1 names {CC.code: name}, country names)."""
    with zipfile.ZipFile(fetch("cities1000.zip")) as z, z.open("cities1000.txt") as f:
        rows = [line.decode(ENCODING).rstrip("\n").split("\t") for line in f]
    places = [(float(r[4]), float(r[5]), r[1], r[8], r[10]) for r in rows]
    admin = {}
    for line in fetch("admin1CodesASCII.txt").read_text(encoding=ENCODING).splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            admin[parts[0]] = parts[1]
    names = {}
    for line in fetch("countryInfo.txt").read_text(encoding=ENCODING).splitlines():
        parts = line.split("\t")
        if not line.startswith("#") and len(parts) > 4:
            names[parts[0]] = parts[4]
    return places, admin, names


def build(code: str, bbox: list[float], places, admin, names) -> dict:
    w, s, e, n = bbox
    keep = [p for p in places
            if w - MARGIN <= p[1] <= e + MARGIN and s - MARGIN <= p[0] <= n + MARGIN]
    keep.sort(key=lambda p: (p[0], p[1]))
    regions: list[str] = []
    index: dict[str, int] = {}
    out = {"lat": [], "lon": [], "name": [], "r": []}
    for lat, lon, name, cc, a1 in keep:
        region = admin.get(f"{cc}.{a1}", "")
        if cc != code:
            region = f"{region}, {names.get(cc, cc)}" if region else names.get(cc, cc)
        if region not in index:
            index[region] = len(regions)
            regions.append(region)
        out["lat"].append(round(lat, 4))
        out["lon"].append(round(lon, 4))
        out["name"].append(name)
        out["r"].append(index[region])
    return {"source": f"GeoNames cities1000 (CC BY 4.0), downloaded {date.fromtimestamp((GEO_DIR / 'cities1000.zip').stat().st_mtime)}",
            "regions": regions, **out}


def main() -> None:
    places, admin, names = load()
    countries = json.loads((OUT_DIR / "countries.json").read_text(encoding=ENCODING))
    for c in countries:
        if c["code"] not in COUNTRIES:
            continue
        data = build(c["code"], c["bbox"], places, admin, names)
        path = OUT_DIR / c["code"] / "places.json"
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding=ENCODING)
        print(f"{c['code']}: {len(data['name'])} places, {len(data['regions'])} regions, {path.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
