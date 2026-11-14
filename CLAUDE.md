# Seamless Fire

Harmonized MODIS + VIIRS burning activity calendar (2000 → today) for a selected area.
NASA Space Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".
Team "Lone Pixel" (solo), local event Rzeszów.

Full context:
- `docs/plan.md`: method decisions, data contract, pages, work order, submission checklist
- `docs/koncepcja.md`: product concept, users, differentiators (Polish)

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

Stack: Python (pandas, numpy), Astro, `plotly.js-dist-min`. Optional later: Leaflet.
Hosting: GitHub Pages via GitHub Actions.

Commands:
- `python pipeline/build_data.py` – rebuild `public/data/`
- `npm run dev` / `npm run build` / `npm run preview`

## Method (decided)

1. Keep only `type == 0` (vegetation). In PL ~73% of VIIRS detections are `type == 2` (industrial).
   If a file has no `type` column (2026 data), drop detections inside an industrial mask
   (~0.01° grid of locations with `type == 2` in 2012–2025).
2. Unit: **cell-days** = unique (0.1° cell, date) pairs with ≥1 detection, per sensor.
   MODIS = Terra + Aqua combined. Sensors: MODIS, VIIRS S-NPP, VIIRS NOAA-20. Ignore NOAA-21.
3. Target scale: VIIRS S-NPP. VIIRS series = S-NPP up to 2026-11-02, after that
   NOAA-20 × factor (factor = ratio of S-NPP to NOAA-20 totals over 2018–2025).
4. Model per country, calibrated on 2012–2025 monthly country totals:
   `log1p(V) = a[season] + b * log1p(M)` (seasons: DJF, MAM, JJA, SON).
   Variant D = all `a` equal; variant E = seasonal `a`. Pick by validation.
   Pooled fallback model for countries with few fire months.
5. Validation: leave-one-year-out, metrics = annual % error and monthly log-RMSE.
   Compare A (global ratio), B (country ratio), C (country × month ratio), D, E.
   Plus backtest: calibrate 2019–2025, test 2012–2018.
6. 2000–2011: model applied to MODIS, ~80% interval from LOYO residual SD in log space.
7. **Custom area:** the browser sums raw cell-days inside the rectangle first, then applies
   the model. Never sum per-cell harmonized values (log model is not additive).
   Show an "higher uncertainty" note when the area is smaller than the country.
8. Anomaly: `(x + k) / (median + k)`, median of the same calendar month over the last
   10 complete years; `k` scales with the area (e.g. fraction of mean monthly median),
   not a fixed 10. Also percentile of the month among all years.
9. Months with preliminary data are flagged.

## Data contract (`public/data/`)

| File | Content |
|---|---|
| `countries.json` | `[{code, name, bbox: [W, S, E, N]}]` |
| `{CC}/cells.json` | rows: lat index, lon index (0.1°), month, MODIS cell-days, VIIRS cell-days (S-NPP scale) |
| `{CC}/model.json` | `a[4]`, `b`, sigma, NOAA-20 factor, method comparison, filtered industrial share, last data date |
| `{CC}/hotspots/{year}.csv` | filtered hotspots: date, time, lat, lon, sensor, frp (for CSV export) |

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
  VIIRS-SNPP/viirs-snpp_{YYYY}_{Country}.csv    2012–2025
  VIIRS-JPSS1/viirs-jpss1_{YYYY}_{Country}.csv  2018–2025 (NOAA-20)
  FIRMS_2026/DL_FIRE_SV-C2_{id}/fire_{archive,nrt}_SV-C2_{id}.csv    S-NPP 2026
  FIRMS_2026/DL_FIRE_J1V-C2_{id}/fire_{archive,nrt}_J1V-C2_{id}.csv  NOAA-20 2026
  ```
  `data/Canada` exists but is not used.
- Columns: MODIS `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type`;
  VIIRS yearly: same but `bright_ti4`/`bright_ti5`; 2026 files use `brightness`/`bright_t31` for VIIRS too.
  `acq_time` is HHMM as string (e.g. `0039`), keep leading zeros. Encoding: ASCII/UTF-8.
- `satellite` values: MODIS `Terra`/`Aqua`; S-NPP `N` (yearly), `SNPP` (2026); NOAA-20 `N20`
- 2026: `fire_archive_*` (2026-01-03 → 2026-07-31) **has** `type`; `fire_nrt_*` (2026-08-01 →) has **no**
  `type` → industrial mask needed only for NRT. Last dates: S-NPP NRT 2026-11-02 (PL: 2026-10-31), NOAA-20 NRT 2026-11-12.
- Largest used file: ~13 MB (UA VIIRS S-NPP 2015). All 5 countries ~290 MB.

Countries: PL, PT, ES (required), GR, UA (if downloaded). Country list is one variable.

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

Optional: Leaflet rectangle drawing, cell map for a selected month.

Use `import.meta.env.BASE_URL` for all data paths (GitHub Pages subpath).

- GitHub: `figielak/seamless-fire` (remote `origin`, SSH), site https://figielak.github.io/seamless-fire/. `site`/`base` come from env `SITE`/`BASE`, set by `.github/workflows/deploy.yml` from `configure-pages`
- Fedora Linux, Python 3.14 (pandas 3.0, numpy 2.5), Node 24, Astro 7, plotly.js-dist-min 4.3

## Work order

1. Pipeline: load, filter, cell-days → `countries.json`, `cells.json` for PL, PT. Check sanity numbers.
2. Pipeline: validation A–E, model → `model.json`.
3. Site minimum: country select, calendar, "Now" panel. **Deploy to GitHub Pages immediately.**
4. Pipeline: other countries, 2026 data, hotspot files.
5. Site: rectangle, date range, CSV export, anomalies, annual chart.
6. Site: raw/harmonized toggle, season profile, briefing, Method page.
7. README (English, license, data sources, LLM disclosure).

If time runs out, drop in this order: Leaflet map → season profile → briefing →
2026 data → countries other than PL and PT.

Work one stage at a time and report results before moving on.
