"""Shared configuration for the data pipeline."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data"  # data/{Country name}/{MODIS,VIIRS-SNPP,VIIRS-JPSS1,FIRMS_2026}/
OUT_DIR = ROOT / "public" / "data"
CACHE_DIR = ROOT / "pipeline" / "cache"  # intermediate cell-day tables (gitignored)

FIRST_MONTH = "2000-01"   # month index 0 in cells.json
LAST_YEAR_STAGE1 = 2025   # 2026 files (NRT rows without `type`) are handled in stage 4

ENCODING = "utf-8"

# Country list: code -> display name (= raw folder name). Order = order in the site's select.
COUNTRIES = {
    "PL": "Poland",
    "PT": "Portugal",
    "ES": "Spain",
    "GR": "Greece",
    "UA": "Ukraine",
    "AU": "Australia",
    "CA": "Canada",
}

CELL_DEG = 0.1                # aggregation grid
INDUSTRIAL_MASK_DEG = 0.01    # grid for the industrial mask (files without `type`)
CALIB_YEARS = (2012, 2025)    # model calibration period
N20_FACTOR_YEARS = (2018, 2025)
SNPP_LAST_DATE = "2026-11-02"  # after this date VIIRS series = NOAA-20 x factor

SENSORS = ("MODIS", "SNPP", "N20")

# Sensor outages: excluded from calibration and flagged in the calendar.
CALIB_EXCLUDE = ["2020-08", "2020-09", "2022-07", "2022-08"]  # Aqua FMU failure, S-NPP outage
LOW_QUALITY = [f"2000-{m:02d}" for m in range(1, 11)] + CALIB_EXCLUDE  # + Terra early 2000

# Calendar month (1..12) -> season index: DJF=0, MAM=1, JJA=2, SON=3
SEASON_OF_MONTH = [None, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0]

MIN_FIRE_MONTHS = 60    # fewer calibration months with M>0 and V>0 -> pooled model
INTERVAL_Z = 1.2816     # 80% interval
DE_TIE = 0.01           # E must beat D by more than this LOYO log-RMSE to be chosen
TERRA_SEASON_MIN = 100  # min Terra cell-days per season to use a seasonal Terra-only ratio

# `satellite` column value -> normalized satellite name
SATELLITE_NAMES = {
    "Terra": "Terra", "T": "Terra",
    "Aqua": "Aqua", "A": "Aqua",
    "N": "SNPP", "SNPP": "SNPP", "NPP": "SNPP",
    "N20": "N20", "J1": "N20", "NOAA-20": "N20",
}

# normalized satellite -> sensor
SATELLITE_SENSOR = {"Terra": "MODIS", "Aqua": "MODIS", "SNPP": "SNPP", "N20": "N20"}

# Fallback: file name fragment -> sensor
FILENAME_MAP = {
    "modis": "MODIS",
    "viirs-snpp": "SNPP", "_SV-": "SNPP",
    "viirs-jpss1": "N20", "_J1V-": "N20",
}
