# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **6 done**, next: **7 (README)**
- Main page `src/pages/index.astro` is map-first: full-screen Leaflet map, left control panel (country, area,
  period, raw/harmonized toggle in "Values"), Now card, bottom dock (Calendar / Per year / Anomalies / About).
  Map layer = per-cell share of the harmonized total (`src/lib/cellmap.ts`; preset cells sum to `harmonizeArea`).
- "All countries (8)" view: `WORLD_CODE = 'ALL'` (`src/lib/world.ts`): each country harmonized with its own model,
  then summed; hotspot export stays per country; live cold first load ~7 s. Map colours: one fixed scale for all countries.
- Raw toggle: `rawSplice`/`rawRatio` in `src/lib/harmonize.ts`, link `v=raw`; changes calendar + per-year only.
- Method page `src/pages/method.astro`: tables built from `public/data/{CC}/model.json` at build time,
  before/after 2012 Plotly chart (country select, `#CC` hash). Live and checked.
- Season profile and briefing **dropped** (user decision, time).
- Logic: `src/lib/harmonize.ts`, `stats.ts`, `geo.ts`, `csv.ts`, `cellmap.ts`
- Tests: `python -m unittest discover -s pipeline/tests` (20), `npm run test:site` (73), `npm run check` (0 errors)
- Deploy: push to `main` → workflow "Deploy to GitHub Pages"; check the run via
  `curl https://api.github.com/repos/figielak/seamless-fire/actions/runs` (no `gh`)

## Next step

1. Stage 7: README (English): what it does, method summary, data sources (NASA FIRMS, EFFIS for the check,
   EOX Sentinel-2 cloudless base map attribution), Apache 2.0, LLM-tools disclosure, how to rebuild.

## Blockers / open questions

- PT backtest systematic underestimate (−26%, every year): not smearing; likely drift between 2012–18 and 2019–25. Mention as limitation

## Done

- Stage 4: 2000–2025 outputs identical to stage 3 (all 8 countries); dist 207 MB; AU cells.json 23.8 MB / 2.9 MB gzip

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9, totals in cells.json match cache
- Stage 3: site minimum live; AU live: 2.2 MB gzip, parse 64 ms, first chart 1.6 s with Plotly preloaded
- Stage 2: PL = E (log-RMSE 0.43), PT = D (0.36); model.json ~4 kB
- Validation on all 8 countries (see docs/validation.md): D/E best everywhere, sigma 0.10 (AU) to 0.43 (PL); 12 unit tests pass
