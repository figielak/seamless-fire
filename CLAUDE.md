# Seamless Fire

Harmonized MODIS + VIIRS burning activity calendar (2000 → today) for a selected area.
NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".
Team "Lone Pixel" (solo), local event Rzeszów.

Full context:
- `docs/plan.md`: method decisions, data contract, pages, work order, submission checklist
- `docs/koncepcja.md`: product concept, users, differentiators (Polish)
- `docs/modis_guide.md`: MODIS C6 active fire notes (`type` codes, confidence, Terra-only 2000–2002,
  sensor gaps: Terra Sep 2000, Aqua 16 Aug–2 Sep 2020, no sub-8-day series, not burned area)
- `docs/viirs_guide.md`: VIIRS notes (from the burned area guide, not the 375 m hotspot guide;
  S-NPP outage 27 Jul–10 Aug 2022)
- `docs/validation.md`: measured validation evidence (method comparison, backtest, agreement, tests), English;
  update it when the pipeline results change
- `.planning/codex_plan.md`: independent plan by Codex, **second opinion only, not followed**
  (header lists differences and ideas worth considering)

## Working memory: `.planning/`

- **Read `.planning/STATE.md` at the start of every session** (current stage, next step, blockers).
- `STATE.md`: short snapshot, overwrite it after finishing a stage or when the next step changes.
- `DECISIONS.md`: append-only log of decisions, findings (actual sanity numbers, chosen model D/E),
  and data gotchas found during the event. 1–3 lines per entry, with the reason.
- Keep both short. Do not duplicate this file or `docs/plan.md`; no step-by-step history.

## Hard constraints

- **Deadline: Sunday 15.11.2026, 13:00 Europe/Warsaw.** Local judging starts then.
  Prefer a working, deployed minimum over unfinished extras.
- Talk to the user in **Polish**. Code, comments, commit messages, UI text and README in **English**.
- License: Apache 2.0. No NASA logos or branding in the site or generated assets.
- README must state that code was written with help of LLM tools (required by Space Apps rules).
- Do not change method decisions below without asking the user first.

## Architecture

Python computes, Astro displays. The site is fully static (no server).

```
pipeline/            Python: raw FIRMS CSV -> public/data/*
data/{Country}/      raw FIRMS files per country, full English name (gitignored, never commit)
public/data/         generated data served by the site (committed)
src/                 Astro site, plain TypeScript in <script> tags, no React
docs/                plan and concept
```

Stack: Python (pandas, numpy), Astro, `plotly.js-dist-min`. Leaflet (+ polygon drawing) for the area map.
Hosting: GitHub Pages via GitHub Actions.

Commands:
- `python pipeline/build_data.py` – rebuild `public/data/`
- `npm run dev` / `npm run build` / `npm run preview`
- `npm run test:site` – TS harmonization vs Python reference (`python pipeline/site_fixture.py` rewrites `src/lib/fixtures/`)

## Method (decided)

1. Keep only `type == 0` (vegetation). In PL ~73% of VIIRS detections are `type == 2` (industrial).
   Rows without `type` (2026 NRT rows) are dropped when their 0.01° cell was mostly industrial:
   `type == 2` ≥ 50% of the cell's VIIRS detections in 2012–2025 (user approved; "any type 2" cut
   24% of real PL vegetation, see `docs/validation.md` §2a). Archive rows win over NRT on shared days.
2. Unit: **cell-days** = unique (0.1° cell, date) pairs with ≥1 detection, per sensor.
   MODIS = Terra + Aqua combined. Sensors: MODIS, VIIRS S-NPP, VIIRS NOAA-20. Ignore NOAA-21.
3. Target scale: VIIRS S-NPP. VIIRS series = S-NPP up to 2026-11-02, after that
   NOAA-20 × factor (factor = ratio of S-NPP to NOAA-20 totals over 2018–2025).
   Coverage currently ends 2026-10 (`LAST_COMPLETE_MONTH`, user decision): Nov 2026 is partial, so the
   NOAA-20 switch is stored in model.json but not used yet.
4. Model per country, calibrated on 2012–2025 monthly country totals:
   `log1p(V) = a[season] + b * log1p(M)` (seasons: DJF, MAM, JJA, SON).
   Variant D = all `a` equal; variant E = seasonal `a`. Pick by validation.
   Pooled fallback model for countries with few fire months.
5. Validation: leave-one-year-out, metrics = annual % error and monthly log-RMSE.
   Compare A (global ratio), B (country ratio), C (country × month ratio), D, E.
   Plus backtest: calibrate 2019–2025, test 2012–2018.
6. 2000–2011: model applied to MODIS, ~80% interval from LOYO residual SD in log space.
   Terra-only months (before Aqua data start, ~mid-2002): scale MODIS cell-days by the country
   (Terra+Aqua)/Terra ratio first, widen the interval for that extra step.
   Calibration excludes S-NPP Jul–Aug 2022 and Aqua Aug–Sep 2020 (sensor outages).
7. **Custom area** (rectangle or polygon; a cell is inside if its center is inside the shape,
   rectangle edges inclusive; coordinates `[lon, lat]`; presets in `src/lib/presets.json`):
   the browser sums raw cell-days inside the area first. Estimated months use the **country share**
   `V_area = V_country × M_area / M_country` (0 when `M_country = 0`; user approved 2026-11-14,
   the direct model on a small area keeps its intercept ≈ 4–20/month, see `docs/validation.md` §9b).
   Observed months = area VIIRS. "Whole country" shows the country series unchanged.
   Area interval in log1p space: `expm1(log1p(v) ± h)`, h = `model.area.h_month` / `h_annual`.
   Never sum per-cell harmonized values. Show a "higher uncertainty" note for areas.
   Date range limits calendar, anomaly ranking, annual sums and export; statistics use full history.
8. Anomaly: `(x + k) / (median + k)`, median of the same calendar month over the last
   10 complete years; `k` scales with the area (e.g. fraction of mean monthly median),
   not a fixed 10. Also percentile of the month among all years.
9. Months with preliminary data are flagged. Low-quality months are flagged too:
   Jan–Oct 2000 (Terra), Aug–Sep 2020 (Aqua), Jul–Aug 2022 (S-NPP).

## Data contract (`public/data/`)

| File | Content |
|---|---|
| `countries.json` | `[{code, name, bbox: [W, S, E, N]}]` |
| `{CC}/cells.json` | rows: lat index, lon index (0.1°), month, MODIS cell-days, VIIRS cell-days (S-NPP scale), `viirs_det` raw S-NPP detections (display only; missing = no data) |
| `{CC}/model.json` | `a[4]`, `b`, sigma (compute params full precision), NOAA-20 factor, method comparison, filtered industrial share (files 2000–2025), last data date, `last_complete_month` (= 2026-10, drives the "Now" panel), `preliminary` months, `coverage` (raw file dates per satellite), `annual.partial_year` (2012 interval = observed + estimated-month interval), `hotspots` flag, `hotspot_sensors` per year, `industrial_mask` stats, `area` (custom-area check, `h_month`, `h_annual`) |
| `{CC}/hotspots/{year}.csv` | filtered hotspots: date, time, lat, lon, sensor (Terra/Aqua/SNPP/N20), frp (for CSV export). Only PL, PT, ES, GR, UA, CL (AU/CA too big for Pages → link to FIRMS). 2026 = VIIRS only |

Keep files small: compact arrays, no pretty printing. Check size before committing
(GitHub limit 100 MB per file).

## Raw data

FIRMS country yearly files + Archive Download files for 2026. Skip browser duplicates
(file names containing `(`, e.g. `Poland(1).csv`). Always pass `encoding` explicitly.
Drop duplicated rows across files.

Detect the sensor from the `satellite` column, fall back to the file name.

- Folder layout (`data/{Country}/`, Country = full name, e.g. `Poland`; code→name map in `pipeline/config.py`):
  ```
  MODIS/modis_{YYYY}_{Country}.csv              2000–2025
  VIIRS-SNPP/viirs-snpp_{YYYY}_{Country}.csv    2012–2026
  VIIRS-JPSS1/viirs-jpss1_{YYYY}_{Country}.csv  2018–2026 (NOAA-20)
  ```
  The 2026 files are merged from FIRMS Archive Download (`fire_archive_*` + `fire_nrt_*`,
  columns renamed to `bright_ti4`/`bright_ti5`). Originals: `data/_downloads_2026/{Country}/` (not read by the pipeline).
  `data/Canada` completed on 2026-11-14 (S-NPP 2018–2025 downloaded, truncated files kept as `*.csv.truncated`).
  `data/AttributesReadme.txt`: FIRMS column descriptions (one copy for all countries).
- Columns: MODIS `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type`;
  VIIRS: same but `bright_ti4`/`bright_ti5`.
  `acq_time` is HHMM as string (e.g. `0039`), keep leading zeros. Encoding: ASCII/UTF-8.
- `satellite` values: MODIS `Terra`/`Aqua`; S-NPP `N` (yearly), `SNPP` (2026); NOAA-20 `N20`
- 2026 files: rows 2026-01-03 → 2026-07-31 (archive) have `type`; rows from 2026-08-01 (NRT,
  `version` = `2.0NRT`) have **empty** `type` → industrial mask for those rows only. NRT rows = preliminary. Last dates: S-NPP NRT 2026-11-02 (PL: 2026-10-31, CL: 2026-11-01), NOAA-20 NRT 2026-11-12.
- Largest used file: ~164 MB (AU VIIRS S-NPP 2012); AU total ~2.7 GB, other countries ~290 MB together.
  Read with `usecols` and aggregate per file; never concat all raw AU rows in memory.

Countries: PL, PT, ES (required), GR, UA, AU, CA, CL (all downloaded and built). Country list is one variable.

## Sanity checks (results of earlier exploration, PL and PT, 2012–2025)

New code should reproduce these roughly. Large deviations mean a bug.

- Monthly correlation MODIS vs VIIRS (cell-days, `type == 0`): PL 0.93, PT 0.98
- VIIRS/MODIS ratio: PL ~4–5, PT ~2.7; PL seasonal ~3 (March) to ~12 (June)
- LOYO (annual error / log-RMSE): A PL 36% / 1.20, PT 28% / 0.46;
  B PL 24% / 1.05, PT 14% / 0.50; C PL 27% / 1.03, PT 10% / 0.41; D PL 15% / 0.48, PT 12% / 0.35
- Backtest: PL mixed errors ~19%; PT systematic underestimate 22–35%
- Known events to verify in the calendar: PL April 2020 (Biebrza), PT September 2024, PT August 2025

## Site

Main page (required): country select, rectangle inputs (W, S, E, N), presets
(Podkarpacie, Biebrza, Algarve – verify coordinates), date range (month/year),
calendar heatmap years × months (cividis, log color scale, 2000–2011 marked as estimated,
preliminary months marked), "Now" panel (latest month vs median, spread, percentile),
top 10 anomalies, CSV export (monthly series + hotspots in area and date range).

Then: raw/harmonized toggle, annual chart with uncertainty, season profile,
template-based area briefing (no AI), "Method" page (method comparison, before/after 2012,
filtered industrial share, limitations).

Area polygon: Leaflet map where the user draws a polygon (rectangle inputs stay as the
fallback without the map). Presets may be polygons (e.g. Biebrza outline). Hotspot CSV export
uses point-in-polygon on hotspots. Optional: cell map for a selected month.

Layout (user decision, 2026-11-14, revised same day): CSS grid, nothing floats over the map. Left control
panel (collapsible) | "Now" strip across the top | Leaflet map (Sentinel-2 cloudless base from EOX, OSM option)
and chart panel side by side, tabs Calendar, Per year, Top anomalies, How to read it. Calendar rows fit the
panel height; its colour range starts at the 2nd percentile of months without sensor problems. Map layer = per-cell share of the harmonized
value (`src/lib/cellmap.ts`, same rule as `harmonizeArea`); clicking a calendar month or anomaly row maps it.
Below 1150 px everything stacks in one column. Map colours use one fixed scale for all countries
(month: 0–31 cell-days per cell; period: average per year, 0–30). "All countries (8)" entry
(`src/lib/world.ts`): each country harmonized with its own model, then summed (series, annual totals
and intervals, map layers); hotspot export only per country.

Use `import.meta.env.BASE_URL` for all data paths (GitHub Pages subpath).

- GitHub: `figielak/seamless-fire` (remote `origin`, SSH), site https://figielak.github.io/seamless-fire/. `site`/`base` come from env `SITE`/`BASE`, set by `.github/workflows/deploy.yml` from `configure-pages`
- Fedora Linux, Python 3.14 (pandas 3.0, numpy 2.5), Node 24, Astro 7, plotly.js-dist-min 4.3

## Work order

1. Pipeline: load, filter, cell-days → `countries.json`, `cells.json` for PL, PT. Check sanity numbers.
2. Pipeline: validation A–E, model → `model.json`.
   Plus spatial agreement (2012–2025, per country): share of MODIS cell-days that VIIRS also
   detects, and vice versa, overall and per month; store in `model.json` for the Method page.
3. Site minimum: country select, calendar, "Now" panel. **Deploy to GitHub Pages immediately.**
   3b. Independent check 2000–2011: EFFIS annual country statistics (burnt area, number of fires) for
   PL, PT, ES, GR vs harmonized annual totals; compare correlation before and after 2012. Use official
   EFFIS downloads, do not scrape the viewer. Result → new section in `docs/validation.md`, cite EFFIS.
4. Pipeline: other countries, 2026 data, hotspot files.
5. Site: rectangle, Leaflet polygon, date range, CSV export, anomalies, annual chart.
6. Site: raw/harmonized toggle, season profile, briefing, Method page.
7. README (English, license, data sources, LLM disclosure).

If time runs out, drop in this order: Leaflet polygon (keep rectangle inputs) → season profile → briefing →
2026 data → countries other than PL and PT.

Work one stage at a time and report results before moving on.
