# Seamless Fire

**One fire calendar from 2000 to today, with MODIS and VIIRS hotspots put on one scale.**

Live site: <https://figielak.github.io/seamless-fire/> (opens with a one-minute **Quick tour**)

Built for the NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots",
by team Hot Spot (Rzeszów, Poland).

## The problem

NASA FIRMS has two long active-fire records: MODIS (since 2000) and VIIRS (since 2012). VIIRS has smaller
pixels and detects several times more fire, so joining the two records naively makes a false jump in
2012. Anyone who asks "was this fire season unusual compared with the last 25 years?" gets the wrong answer.

On top of that, most VIIRS "fires" in some countries are not fires at all: in Poland 72% of VIIRS
detections are industrial heat sources (steelworks, refineries, gas flares).

## Results at a glance

Measured on 2012–2025, when both sensors flew. Full evidence: [docs/validation.md](docs/validation.md).

| | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| Monthly error, best simple ratio (log-RMSE) | 1.11 | 0.45 | 0.27 | 0.33 | 0.44 | 0.13 | 0.24 | 0.34 |
| Monthly error, our model (log-RMSE) | **0.43** | **0.36** | **0.22** | **0.26** | **0.24** | **0.10** | **0.17** | **0.27** |
| Annual error, our model (leave-one-year-out) | 15% | 10% | 6% | 9% | 7% | 3% | 8% | 10% |
| Harmonized 2012 / 2011 (naive splice: ×1.7–3.5) | 1.11 | 1.12 | 0.97 | 0.85 | 0.64* | 1.00 | 1.03 | 0.97 |

Log-RMSE 0.10 ≈ ±10% per month, 0.43 ≈ a factor of 1.5. \*Ukraine's drop is real: raw MODIS alone fell by 32%.

- The log-log model beats all ratio methods in every country, often by a factor of 2, because the
  sensor relation is not proportional (slope `b` = 0.56–0.86).
- An independent check against EFFIS national statistics (not satellite data) shows the naive splice puts
  2001–2011 24–63% too low; the harmonized series adds no break at 2012 (validation §9a).
- In a backtest (fit 2019–2025, predict 2012–2018) the sensor relation drifts in some countries (Portugal −27%
  every year). The intervals shown for 2000–2011 include that drift.

## Try it

The **▶ Quick tour** button on the site sets up each of these in one click:

- **Biebrza valley, April 2020**: the largest fire in the Biebrza National Park is the top anomaly of this
  small area; the map shows its hotspot points.
- **Portugal, raw vs harmonized**: the false 2012 jump in raw counts, and the harmonized series without it.
- **Portugal, September 2024**: the calendar coloured by anomaly.
- **Greece, August 2021 (Evia)**: one huge fire covers few cells, so cell-days look like a normal August;
  the large-fire flag and the "Most detections" ranking find it.
- **Poland, now and next 7 days**: this month so far against the same days of earlier years, and a
  fire-weather outlook with places to watch.
- **Your own area**: draw a polygon, get its calendar, anomalies and an area report.

## What the site does

- **Area and period**: a country, a preset (Podkarpacie, Biebrza valley, Algarve), a rectangle or a polygon
  drawn on the map, and a date range. The view is kept in the address bar, so a link reopens it.
- **Calendar** (years × months): 2000–2011 are estimated from MODIS on the VIIRS scale with a ~80%
  interval; from February 2012 the values are observed VIIRS. Preliminary months and months with known
  sensor problems are marked. Hover a month for value, interval and data status; click it to map it.
- **Up to recent days**: the current month comes from FIRMS near real-time data (NOAA-20 on the S-NPP
  scale), up to the date shown on the site, and is marked "month to date".
- **"Now" panel**: the current month so far compared with the same days in earlier years (anomaly index
  where 1 = typical, median, middle 80% of years, share of years that were lower), plus the last full month.
- **This season**: fire activity since 1 January against the usual range of 2012–2025.
- **Top 10 anomalies**, ranked by anomaly index, by excess over typical, or by VIIRS detections. Estimated
  months are ranked by the lower end of their interval and shown as "≥", so uncertain small-area estimates
  do not push out real events.
- **Large-fire months** (▲ in the calendar, 🔥 in the list): months with unusually many detections per
  cell-day, where cell-days saturate (Evia and Evros in Greece, Pedrógão in Portugal, Black Summer in Australia).
- **Map** of fire cells for the selected month or period, on one colour scale for all countries, with the
  month's hotspot points (date, UTC time, sensor, FRP).
- **Recurrence map**: for a calendar month, how many years each ~1 km cell had fire in 2012–2026, so you see
  where fires come back. Rings mark year-round fire spots, which are usually industrial sites.
- **Per-year chart** with uncertainty and **trends**: change per year (Theil–Sen, Mann–Kendall test) for the
  whole period, for the VIIRS years alone, and for each calendar month. In all five European countries
  burning declines by 3–4% per year.
- **Raw / harmonized toggle** on the same colour scale, so the false 2012 jump and its removal can be compared.
- **Next 7 days** (PL, PT, ES, UA): expected fire activity per day from the Canadian Fire Weather Index
  computed from weather forecasts, with an 80% range and its skill measured on real archived forecasts
  (Portugal: 32% better than the seasonal normal on day 1, 18% on day 7; validation §15). **Places to watch**
  rank the ~1 km cells where fire comes back most often at this time of year, weighted by the local fire weather
  of the coming days, each named by the nearest town or village. A ranking for patrols, not a probability.
- **Downloads**: the monthly series (harmonized value, interval, raw sensor counts, flags) and the hotspots
  inside the area and period as CSV, each in a ZIP with a README (columns, units, flags, data date, link back
  to the view) and the area outline as GeoJSON. Hotspot files exist for Poland, Portugal, Spain, Greece,
  Ukraine and Chile; for Australia and Canada they are too large, so the site links to FIRMS. Every chart
  downloads as PNG.
- **Area report**: one HTML file for the selected area and period (opens offline, prints to PDF): summary in
  sentences, calendar, fire season profile, yearly totals with trend, most unusual months, and the ~1 km places
  where fire comes back most often in the main fire months (year-round industrial spots listed separately).
- **Method page**: the decision in three sentences, method comparison, before/after 2012, sensor agreement,
  industrial filter and limitations.

Countries: Poland, Portugal, Spain, Greece, Ukraine, Australia, Canada, Chile, and an "All countries" view
(each country harmonized with its own model, then summed).

## Method in short

1. **Vegetation fires only.** FIRMS `type` 0 is kept, industrial heat sources (`type` 2) are removed.
   Near real-time rows have no `type`, so they are removed when `type` 2 made up at least half of their
   0.01° cell's VIIRS detections in 2012–2025.
2. **Cell-days.** One unit for both sensors: a 0.1° cell (~11 km) with at least one detection on a day,
   per sensor. MODIS = Terra + Aqua. This removes most of the pixel-size difference: Portugal, September 2024
   had 10,450 S-NPP detections but 358 cell-days.
3. **Model per country**, calibrated on monthly country totals 2012–2025:
   `log(1 + VIIRS) = a[season] + b · log(1 + MODIS)`. Variant D has one intercept, E one per season; the
   variant is chosen per country by a rule fixed before looking at results. Sensor outages (Aqua Aug–Sep 2020,
   S-NPP Jul–Aug 2022) are left out of calibration.
4. **Validation**: leave-one-year-out (each year hidden and predicted from MODIS alone, the same task as
   reconstructing 2000–2011) and a backtest, compared with three ratio methods.
5. **Uncertainty**: the ~80% interval for 2000–2011 comes from the leave-one-year-out errors, widened by the
   drift measured in the backtest. Months before Aqua (to mid-2002) get an extra Terra-only step and a wider
   interval.
6. **Custom areas**: raw cell-days are summed inside the area first (a cell is inside if its centre is).
   Before 2012 the area gets its share of the country estimate (area MODIS / country MODIS), with a wider
   interval. Per-cell harmonized values are never summed.
7. **Anomalies**: `(x + k) / (median + k)` against the same calendar month of the last 10 complete years,
   with `k` scaled to the size of the area.

## Limitations

- Cell-days measure how widespread fire activity was, not burned area or the number of fires.
- Very large single fires saturate cell-days (Evia, August 2021, looks like a typical August); large-fire
  months are flagged from VIIRS detections instead.
- 2000–2011 are estimates. In Portugal, Greece, Ukraine and Chile the sensor relation drifts over time, so
  their intervals are wider (Portugal annual ±54%). Poland has the largest monthly error (small, short
  agricultural fires that the two sensors often see differently).
- Small areas before 2012 have higher uncertainty than whole countries; the site says so.
- Trends treat estimated years as exact; the VIIRS-only trend is the check.
- Near real-time data are preliminary and refreshed by hand; the date of the last update is shown on the site.

## How it is built

Python computes and a static site displays the results; there is no server.

```text
pipeline/       Python: raw FIRMS CSV -> public/data/ (cell-days, models, validation, hotspot files, forecast)
public/data/    generated data served by the site
live/           inputs of the near real-time update (borders, industrial masks, new detections)
src/            Astro site, plain TypeScript; Plotly charts, Leaflet map
docs/           plan, concept, validation report
```

The browser sums the cells inside the selected area and applies the model (`src/lib/harmonize.ts`, a port
of the Python code, tested against Python reference outputs).

Near real-time update (run by hand, no raw data needed): `pipeline/live_update.py` downloads the FIRMS global
NOAA-20 near real-time file, keeps the points inside each country (Natural Earth borders rasterized to 0.01°,
`pipeline/borders.py`), removes known industrial sites and adds the new detections; it rewrites files only
when something changed. `pipeline/forecast_update.py` then moves the stored fire weather codes forward with
NASA POWER days, adds the Open-Meteo forecast (bias-corrected per lead day) and writes
`public/data/{CC}/forecast.json`. Commit and push to redeploy the site. The forecast model of a country is
built locally with `pipeline/forecast_model.py` (after `pipeline/forecast_skill.py` has measured its skill).

## Run locally

Requirements: Python 3.12+ (pandas, numpy, pyarrow), Node 24.

```bash
npm install
npm run dev          # uses the committed public/data/
```

Rebuilding the data needs the raw FIRMS country files, which are not in the repository (several GB).
Download the yearly country files from FIRMS ("Archive Download" for the current year) into
`data/{Country}/MODIS/`, `data/{Country}/VIIRS-SNPP/` and `data/{Country}/VIIRS-JPSS1/`, then:

```bash
pip install -r requirements.txt
python pipeline/build_data.py       # cells, models, recurrence, industrial masks
python pipeline/live_base.py        # daily history for month-to-date comparisons, seed of the live data
python pipeline/live_update.py      # near real-time update
python pipeline/forecast_update.py  # 7-day forecast after the last data day
```

Tests (153 in total: pipeline unit and consistency tests, TypeScript vs Python reference):

```bash
python -m unittest discover -s pipeline/tests
npm run test:site
npm run check
```

Deployment: every push to `main` builds the site and publishes it on GitHub Pages
(`.github/workflows/deploy.yml`).

## Data sources and credits

- **NASA FIRMS** active fire data: MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP,
  NOAA-20). We acknowledge the use of data from NASA's Fire Information for Resource Management System
  (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).
  <https://firms.modaps.eosdis.nasa.gov/>
- **NASA POWER** daily weather (MERRA-2) for the fire weather history and training of the forecast.
  <https://power.larc.nasa.gov/>
- **Open-Meteo** weather forecasts and archived forecasts: [Weather data by Open-Meteo.com](https://open-meteo.com/),
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Natural Earth** 1:10m Admin 0 countries (public domain), used to assign near real-time points to
  countries. <https://www.naturalearthdata.com/>
- **GeoNames** populated places (`cities1000`), region and country names, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): nearest town or village for the places to watch
  (`pipeline/places.py` → `public/data/{CC}/places.json`). <https://www.geonames.org/>
- **EFFIS** national statistics, used only for an independent check of 2000–2011: San-Miguel-Ayanz, J.
  et al., *Forest Fires in Europe, Middle East and North Africa 2024*, European Commission JRC,
  [doi:10.2760/0649290](https://dx.doi.org/10.2760/0649290). The data file is not redistributed here.
- **Base maps**: Sentinel-2 cloudless 2020 by [EOX IT Services GmbH](https://s2maps.eu) (contains modified
  Copernicus Sentinel data 2020); labels and street map © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors.
- Libraries: [Astro](https://astro.build), [Plotly.js](https://plotly.com/javascript/),
  [Leaflet](https://leafletjs.com), pandas, numpy, pyarrow.

Literature: Giglio, Schroeder & Justice (2016), *The collection 6 MODIS active fire detection algorithm and
fire products*, Remote Sensing of Environment 178; Schroeder et al. (2014), *The New VIIRS 375 m active fire
detection data product*, Remote Sensing of Environment 143.

This project is not endorsed by NASA or by any of the data providers.

## Use of AI

The code in this repository was written with the help of LLM tools (Claude Code by Anthropic), as required
by the Space Apps rules to be disclosed. The method choices, validation design and final decisions are the
author's; every result was checked against the data. No AI-generated images, video or audio are used.

## License

Apache License 2.0, see [LICENSE](LICENSE).
