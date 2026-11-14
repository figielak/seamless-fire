"""Shared configuration for the data pipeline."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data"  # data/{Country name}/{MODIS,VIIRS-SNPP,VIIRS-JPSS1,FIRMS_2026}/
OUT_DIR = ROOT / "public" / "data"

ENCODING = "utf-8"

# Country list: code -> display name (= raw folder name). Order = order in the site's select.
COUNTRIES = {
    "PL": "Poland",
    "PT": "Portugal",
    "ES": "Spain",
    "GR": "Greece",
    "UA": "Ukraine",
    "AU": "Australia",
}

CELL_DEG = 0.1                # aggregation grid
INDUSTRIAL_MASK_DEG = 0.01    # grid for the industrial mask (files without `type`)
CALIB_YEARS = (2012, 2025)    # model calibration period
N20_FACTOR_YEARS = (2018, 2025)
SNPP_LAST_DATE = "2026-11-02"  # after this date VIIRS series = NOAA-20 x factor

SENSORS = ("MODIS", "SNPP", "N20")

# `satellite` column value -> sensor
SATELLITE_MAP = {
    "Terra": "MODIS", "Aqua": "MODIS", "T": "MODIS", "A": "MODIS",
    "N": "SNPP", "SNPP": "SNPP", "NPP": "SNPP",
    "N20": "N20", "J1": "N20", "NOAA-20": "N20",
}

# Fallback: file name fragment -> sensor
FILENAME_MAP = {
    "modis": "MODIS",
    "viirs-snpp": "SNPP", "_SV-": "SNPP",
    "viirs-jpss1": "N20", "_J1V-": "N20",
}
