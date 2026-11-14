# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **7 done** (README written and live). All planned stages done; remaining: final checks before judging (Sun 15.11 13:00)
- Main page `src/pages/index.astro`: CSS grid, nothing floats over the map (2026-11-14):
  controls left | "Now" strip on top | map and chart panel (Calendar / Per year / Anomalies / About) side by side.
  Calendar rows fit the panel height; colour range starts at P2 of non-flagged months. Below 1150 px: one column.
  Map layer = per-cell share of the harmonized total (`src/lib/cellmap.ts`; preset cells sum to `harmonizeArea`).
- "All countries (8)" view: `WORLD_CODE = 'ALL'` (`src/lib/world.ts`): each country harmonized with its own model,
  then summed; hotspot export stays per country; live cold first load ~7 s. Map colours: one fixed scale for all countries.
- Map rendering (`src/lib/map.ts`): default "Smooth" (bilinear between cell centres, ~20 ms/redraw), legend toggle
  "Smooth / Cells"; falls back to squares when a cell is < 3 px on screen. Live (95eddff).
- Polish pass 2026-11-14: map opacity ramp, compact legend, segmented controls, calendar toggle
  "Cell-days | vs typical", hotspot points on the map in "One month" mode (click = details).
- Map mode "Recurrence" (2026-11-14, firefighter use case): per calendar month, % of years with S-NPP fire per 0.01° cell
  from `{CC}/recurrence/` (meta + m01..m12, AU largest month 2 MB), cyan rings = "year-round fire" (likely industrial,
  ≥10% of all months and ≥9 calendar months).
- Raw toggle: `rawSplice`/`rawRatio` in `src/lib/harmonize.ts`, link `v=raw`; changes calendar + per-year only.
- Method page `src/pages/method.astro`: tables built from `public/data/{CC}/model.json` at build time,
  before/after 2012 Plotly chart (country select, `#CC` hash). Live and checked.
- Season profile and briefing **dropped** (user decision, time).
- Logic: `src/lib/harmonize.ts`, `stats.ts`, `geo.ts`, `csv.ts`, `cellmap.ts`
- Tests: `python -m unittest discover -s pipeline/tests` (27), `npm run test:site` (74), `npm run check` (0 errors)
- Deploy: push to `main` → workflow "Deploy to GitHub Pages"; check the run via
  `curl https://api.github.com/repos/figielak/seamless-fire/actions/runs` (no `gh`)

## Next step

Daily NRT updates ("present" = today), stages A–D agreed with the user 2026-11-14 (deadline not binding):
- A done (uncommitted): `pipeline/borders.py` → `live/borders.json`, masks → `live/masks/`, `pipeline/live_base.py`
  → `public/data/{CC}/daily/` + `live/nrt/`, `live/coverage.json` (seed NOAA-20 1–12 Nov 2026).
- B done (uncommitted): `pipeline/live_update.py`, idempotent, real download ~1.5 min, tests in `pipeline/tests/test_live.py`.
- C next: site (month to date, "Now" vs same days 2012–2025, "This season" tab). D: GitHub Actions daily cron.

## Blockers / open questions

- PT backtest systematic underestimate (−26%, every year): not smearing; likely drift between 2012–18 and 2019–25. Mention as limitation

## Done

- Stage 4: 2000–2025 outputs identical to stage 3 (all 8 countries); dist 207 MB; AU cells.json 23.8 MB / 2.9 MB gzip

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9, totals in cells.json match cache
- Stage 3: site minimum live; AU live: 2.2 MB gzip, parse 64 ms, first chart 1.6 s with Plotly preloaded
- Stage 2: PL = E (log-RMSE 0.43), PT = D (0.36); model.json ~4 kB
- Validation on all 8 countries (see docs/validation.md): D/E best everywhere, sigma 0.10 (AU) to 0.43 (PL); 12 unit tests pass
