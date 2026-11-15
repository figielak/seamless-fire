# Space Apps submission texts

Texts for the NASA Space Apps Challenge 2026 project page, one section per form field.
Challenge: Harmonization of MODIS and VIIRS Hot Spots. Team: Lone Pixel. Local event: Rzeszów.

Before submitting: replace `[FULL NAME]`; check every link in a private window; add the optional
forecast paragraph (now live) only while the daily forecast keeps running.

---

## Project Name

Seamless Fire

## High-Level Project Summary

Seamless Fire is a burning activity calendar for any area, from 2000 to today, on one consistent
scale. MODIS (2000 on) and VIIRS (2012 on) see fire differently, so joining their records creates a
false jump in 2012. We harmonize them with a per-country, per-season model, validated year by year
against the years both sensors flew, and we remove industrial heat sources that would otherwise make
up three quarters of Polish VIIRS "fires". The web app lets emergency managers, land managers and
firefighters pick a country, a preset, a rectangle or a polygon drawn on the map, and see which months
and years burned most, how the current month compares with the same days in earlier years, long-term
trends, and where fires come back year after year at ~1 km. Data update every day from NASA FIRMS
near real-time feeds; everything can be downloaded as CSV.

## Link to Project Demo

[link to the 7-slide demo]

## Link to Final Project

- Site: https://figielak.github.io/seamless-fire/
- Code: https://github.com/figielak/seamless-fire

## Detailed Project Description

**What it does.** Seamless Fire shows the fire history of an area as a calendar heatmap (years ×
months, accessible cividis colour scale) from January 2000 to the current day, for Poland, Portugal,
Spain, Greece, Ukraine, Australia, Canada and Chile, or all eight together. Users choose the area
(country, presets such as the Biebrza valley or the Algarve, a latitude/longitude rectangle, or a
polygon drawn on the map) and a date range. The app answers the questions in the challenge:

- *Which periods and years burned most?* Calendar, per-year chart with uncertainty, top 10 anomalies.
- *How does now compare with the past?* A "Now" panel compares the current month so far with the same
  days in earlier VIIRS years (median, usual range, percentile); "This season" compares the activity
  since 1 January with the usual range.
- *Is it changing?* Trends per year (Theil–Sen, Mann–Kendall test) for the whole period and for the
  VIIRS years alone, and for each calendar month. In all five European countries burning declines by
  3–4% per year; in the Podkarpacie region spring grass burning (April) declines by 5.5% per year, in
  both sensors independently.
- *Where?* A map of fire cells for any month or period, the exact hotspot points (time, sensor, fire
  radiative power), and a recurrence map: for a calendar month, how many years each ~1 km cell had
  fire. Spots that burn in most months of every season are marked as likely industrial sites.
- *Downloads:* monthly series (harmonized values, interval, raw sensor counts, flags) and the hotspots
  inside the area and period as CSV; every chart as PNG.

**How it works.**
1. *Unit.* Hotspot counts are not comparable between sensors: the 375 m VIIRS pixel splits one fire
   into several detections, the 1 km MODIS pixel does not. We count *cell-days*, 0.1° cells with at
   least one detection on a day, per sensor.
2. *Industrial filter.* Only FIRMS `type` 0 (vegetation) is kept. Without it 72% of Polish VIIRS
   detections would be steelworks, refineries and gas flares. Near real-time rows without `type` are
   filtered with a mask of known industrial cells.
3. *Harmonization.* Per country, calibrated on 2012–2025 monthly totals:
   `log(1 + VIIRS) = a[season] + b · log(1 + MODIS)`. We compared five methods by leave-one-year-out
   validation (each year hidden and predicted from MODIS alone, the same task as reconstructing
   2000–2011). The log-log model has the lowest error in every country, often half that of simple
   ratios, because the relation is not proportional (b = 0.56–0.86). The ~80% interval shown for
   2000–2011 comes from these validation errors. A naive splice of raw counts would jump ×1.7–3.5 in
   2012; the harmonized series does not (2012/2011 ratio 0.85–1.12, Ukraine's drop is in raw MODIS too).
4. *Custom areas.* The browser sums raw cell-days inside the area, then applies the model (an area gets
   its share of the country estimate before 2012, with a wider interval).
5. *Today.* A daily GitHub Actions job downloads the FIRMS global NOAA-20 near real-time file, assigns
   points to countries (Natural Earth borders, 99.75–99.997% agreement with the FIRMS country files),
   removes industrial cells and redeploys the site. NOAA-20 is put on the S-NPP scale with a
   per-country factor, because S-NPP near real-time data ended in November 2026.

**Benefits.** One consistent view of 26 years instead of two incompatible records; honest uncertainty
where the record is estimated; current conditions in historical context within a day; local detail
(1 km recurrence, exact hotspots) for planning patrols and prevention campaigns, with industrial sites
told apart from vegetation fires.

**Tools.** Python (pandas, numpy) computes all data; an Astro static site with TypeScript, Plotly and
Leaflet displays it (no server); GitHub Actions and GitHub Pages update and host it. The TypeScript
harmonization is tested against the Python reference (140 automated tests in total).

**Limitations.** Cell-days measure how widespread fire activity was, not burned area or the impact of
one fire; very large fires saturate. 2000–2011 values are estimates with an interval; in some countries
(Portugal most) the relation between the sensors drifts over time. Near real-time data are preliminary.
All evidence: `docs/validation.md` in the repository.

**Forecast and places to watch.** A 7-day outlook of fire activity per country from the Canadian Fire Weather
Index, computed from NASA POWER weather history and Open-Meteo forecasts and updated daily. Its skill was measured
on real archived weather forecasts of 2024–2025 (Portugal: 32% better than the seasonal normal on day 1, 18% on
day 7) and is shown next to the outlook. For the selected area, "Places to watch" ranks the ~1 km cells where
vegetation fire happened most often at this time of year, weighted by the local fire weather of the coming days
(a ranking for patrols and prevention, not a probability).

## Use of Artificial Intelligence (AI)

The code was written with the help of an LLM coding assistant (Claude Code by Anthropic). The method
choices (unit, industrial filter, model, validation design), the interpretation of results and all final
decisions are the author's; every number was checked against the data. No AI-generated images, video or
audio are used; the site and slides contain no NASA logos or branding.

## NASA Data

- **FIRMS active fire data** (Fire Information for Resource Management System):
  MODIS Collection 6.1 (Terra, Aqua, 1 km) and VIIRS 375 m (Suomi NPP, NOAA-20), country yearly files
  and Archive Download 2000–2026, and the global NOAA-20 near real-time file, downloaded daily.
  https://firms.modaps.eosdis.nasa.gov/
  We acknowledge the use of data from NASA's FIRMS, part of NASA's Earth Science Data and Information
  System (ESDIS).

## Space Agency Partner Data

- **Copernicus Sentinel-2** (ESA / European Union): base map "Sentinel-2 cloudless 2020" by EOX IT Services
  GmbH (contains modified Copernicus Sentinel data 2020). https://s2maps.eu

## References

Data
- NASA FIRMS, https://firms.modaps.eosdis.nasa.gov/
- EFFIS national statistics (independent check of 2000–2011): San-Miguel-Ayanz, J. et al., *Forest Fires in
  Europe, Middle East and North Africa 2024*, European Commission JRC, doi:10.2760/0649290
- Natural Earth 1:10m Admin 0 countries (public domain), https://www.naturalearthdata.com/
- Sentinel-2 cloudless 2020 by EOX IT Services GmbH; OpenStreetMap contributors (labels, street map)

Literature
- Giglio, L., Schroeder, W., Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm
  and fire products. *Remote Sensing of Environment* 178, 31–41.
- Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data
  product. *Remote Sensing of Environment* 143, 85–96.
- Andela, N. et al. (2017). A human-driven decline in global burned area. *Science* 356, 1356–1362.
- Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. *JASA* 63, 1379–1389.

Software
- Python, pandas, numpy, pyarrow; Astro; TypeScript; Plotly.js; Leaflet; GitHub Actions and GitHub Pages.

## Screenshots to attach

1. Calendar of Poland with the red 2012 line and the "Now" panel (harmonized view).
2. The same calendar in "Raw" view: the false 2012 jump.
3. Podkarpacie, "Per year" tab with the trend lines and the month strip.
4. Recurrence map at Stalowa Wola: the single industrial ring instead of a town-sized cell.
5. Portugal, "This season" tab with the current year against the usual range.
