# Seamless Fire

**One fire calendar from 2000 to today, with MODIS and VIIRS hotspots put on one scale.**

Live site: <https://figielak.github.io/seamless-fire/>

Built for the NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots",
by team Lone Pixel (Rzeszów, Poland).

## The problem

NASA FIRMS has two long active-fire records: MODIS (since 2000) and VIIRS (since 2012). VIIRS has smaller
pixels and detects several times more fire, so joining the two records naively makes a false jump in
2012. Anyone who asks "was this fire season unusual compared with the last 25 years?" gets the wrong answer.

## What the site does

- Pick a country, a preset area (Podkarpacie, Biebrza valley, Algarve), a rectangle or a polygon drawn on
  the map, and a period.
- **Calendar** (years × months): 2000–2011 are estimated from MODIS on the VIIRS scale with a ~80%
  interval; from February 2012 the values are observed VIIRS. Preliminary months and months with known
  sensor problems are marked.
- **Updated every day.** The current month comes from FIRMS near real-time data (NOAA-20 on the S-NPP
  scale) and is marked "month to date".
- **Map** of fire cells for the selected month or period, on one colour scale for all countries, with the
  month's hotspot points (date, time, sensor, FRP).
- **Recurrence map**: for a calendar month, how often each ~1 km cell had fire in 2012–2026, so you see
  where fires come back. Rings mark year-round fire spots (fire in most months of every season), which are
  usually industrial sites rather than vegetation.
- **"Now" panel**: the current month so far compared with the same days in earlier years (median, usual
  range, percentile), plus the last full month.
- **This season**: fire activity since 1 January against the usual range of 2012–2025.
- **Per-year chart** with uncertainty and **trends**: the change per year (Theil–Sen, Mann–Kendall test) for the
  whole period and for the VIIRS years alone, and for each calendar month (e.g. April burning declines).
- **Top 10 anomalies**: months most above their usual level.
- **Raw / harmonized toggle**: shows the false 2012 jump and how the harmonized series removes it.
- **CSV export**: the monthly series, plus the hotspots inside the area and period (hotspot files for
  Poland, Portugal, Spain, Greece, Ukraine and Chile; for Australia and Canada they are too large, so the
  site links to FIRMS).
- **Method page**: method comparison, before/after 2012, sensor agreement, industrial filter and limitations.

Countries: Poland, Portugal, Spain, Greece, Ukraine, Australia, Canada, Chile, and an "All countries" view
(each country harmonized with its own model, then summed).

## Method in short

1. **Vegetation fires only.** FIRMS `type` 0 is kept and industrial heat sources (`type` 2) are removed. In
   Poland about 72% of VIIRS detections are industrial. Near real-time 2026 rows have no `type`, so they are
   removed when `type` 2 made up at least half of their 0.01° cell's detections in 2012–2025.
2. **Cell-days.** One unit for both sensors: a 0.1° cell with at least one detection on a day, per sensor.
   MODIS = Terra + Aqua.
3. **Model per country**, calibrated on monthly country totals 2012–2025:
   `log(1 + VIIRS) = a[season] + b · log(1 + MODIS)`. Variant D has one intercept, E one per season;
   the variant is chosen per country by validation.
4. **Validation**: leave-one-year-out and a backtest (fit on 2019–2025, predict 2012–2018), compared with
   simple ratio methods. The log-log model has the lowest error in every country. The interval shown for
   2000–2011 comes from these validation errors.
5. **Custom areas**: raw cell-days are summed inside the area first. Before 2012 the area gets its share of
   the country estimate (area MODIS / country MODIS), with a wider interval.

All evidence, with numbers: [docs/validation.md](docs/validation.md). Main limitations: cell-days measure how
widespread fire activity was, not burned area; very large fires saturate; in some countries
(Portugal most of all) the relation between the sensors drifts over time.

## How it is built

Python computes and a static site displays the results; there is no server.

```text
pipeline/       Python: raw FIRMS CSV -> public/data/ (cell-days, model, validation, hotspot files)
public/data/    generated data served by the site
src/            Astro site, plain TypeScript; Plotly charts, Leaflet map
docs/           plan, concept, validation report
```

The browser sums the cells inside the selected area and applies the model (`src/lib/harmonize.ts`, a port
of the Python code, tested against Python reference outputs).

Daily update: a GitHub Actions job (`.github/workflows/update-live.yml`, 05:30 UTC) downloads the FIRMS global
NOAA-20 near real-time file, keeps the points inside each country (Natural Earth borders rasterized to 0.01°,
`pipeline/borders.py`), removes known industrial sites, adds the new detections (`pipeline/live_update.py`),
commits only when something changed, and redeploys the site. No raw data are needed for this step.

## Run locally

Requirements: Python 3.12+ with pandas and numpy, Node 24.

```bash
npm install
npm run dev          # uses the committed public/data/
```

Rebuilding the data needs the raw FIRMS country files, which are not in the repository (several GB).
Download the yearly country files from FIRMS ("Archive Download" for the current year) into
`data/{Country}/MODIS/`, `data/{Country}/VIIRS-SNPP/` and `data/{Country}/VIIRS-JPSS1/`, then:

```bash
pip install -r requirements.txt
python pipeline/build_data.py   # cells, models, recurrence, industrial masks
python pipeline/live_base.py    # daily history for month-to-date comparisons, seed of the live data
python pipeline/live_update.py  # near real-time update (what the daily job runs)
```

Tests:

```bash
python -m unittest discover -s pipeline/tests
npm run test:site
npm run check
```

Deployment: every push to `main` builds the site and publishes it on GitHub Pages
(`.github/workflows/deploy.yml`); the daily data job calls the same workflow after it commits.

## Data sources and credits

- **NASA FIRMS** active fire data: MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP,
  NOAA-20). We acknowledge the use of data from NASA's Fire Information for Resource Management System
  (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).
  <https://firms.modaps.eosdis.nasa.gov/>
- **Natural Earth** 1:10m Admin 0 countries (public domain), used to assign near real-time points to
  countries. <https://www.naturalearthdata.com/>
- **EFFIS** national statistics, used only for an independent check of 2000–2011: San-Miguel-Ayanz, J.
  et al., *Forest Fires in Europe, Middle East and North Africa 2024*, European Commission JRC,
  [doi:10.2760/0649290](https://dx.doi.org/10.2760/0649290). The data file is not redistributed here.
- **Base maps**: Sentinel-2 cloudless 2020 by [EOX IT Services GmbH](https://s2maps.eu) (contains modified
  Copernicus Sentinel data 2020); labels and street map © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors.
- Libraries: [Astro](https://astro.build), [Plotly.js](https://plotly.com/javascript/),
  [Leaflet](https://leafletjs.com), pandas, numpy.

This project is not endorsed by NASA or by any of the data providers.

## Use of AI

The code in this repository was written with the help of LLM tools (Claude Code by Anthropic), as required
by the Space Apps rules to be disclosed. The method choices, validation design and final decisions are the
author's; every result was checked against the data.

## License

Apache License 2.0, see [LICENSE](LICENSE).
