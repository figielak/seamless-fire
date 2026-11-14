"""Rebuild public/data/ from raw FIRMS CSV files.

Usage: python pipeline/build_data.py [CC ...]
"""

import sys

from config import COUNTRIES, FILENAME_MAP, RAW_DIR


def raw_files(code: str):
    """All raw CSV files for a country, skipping browser duplicates like 'Poland(1).csv'."""
    return sorted(
        p for p in (RAW_DIR / COUNTRIES[code]).rglob("*.csv")
        if "(" not in p.name
    )


def sensor_from_name(name: str) -> str | None:
    for frag, sensor in FILENAME_MAP.items():
        if frag in name:
            return sensor
    return None


def main(codes: list[str]) -> None:
    for code in codes:
        files = raw_files(code)
        by_sensor: dict[str | None, int] = {}
        for f in files:
            s = sensor_from_name(f.name)
            by_sensor[s] = by_sensor.get(s, 0) + 1
        print(f"{code}: {len(files)} files {by_sensor}")
    # TODO stage 1: load, filter type == 0, cell-days -> countries.json, cells.json


if __name__ == "__main__":
    main(sys.argv[1:] or list(COUNTRIES))
