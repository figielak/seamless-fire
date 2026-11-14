# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **5 done** (area validation, TS logic, area/presets/period, CSV export, anomalies with k ≥ 2, annual chart, Leaflet polygon drawing), next: **6**
- Site: `src/pages/index.astro` (country select via `#CC` hash, Plotly calendar, "Now" panel); logic in
  `src/lib/harmonize.ts` (port of `harmonized_monthly`, `monthlyTotals(cells, n, keep)` ready for areas)
  and `src/lib/stats.ts`; tests `npm run test:site` (34, vs Python fixtures from `pipeline/site_fixture.py`)
- Pipeline: stages 1–2 done for 8 countries; model.json has full-precision params + `last_complete_month`
- Tests: `python -m unittest discover -s pipeline/tests` (20), `npm run test:site` (36), `npm run check`
- Mask check: `python pipeline/mask_check.py` (validation.md §2a). Model step refuses stale cache (`{CC}_meta.json`)
- Deploy: push to `main` → workflow "Deploy to GitHub Pages"; check the run via
  `curl https://api.github.com/repos/figielak/seamless-fire/actions/runs` (no `gh`)

## Next step

1. Stage 6: raw/harmonized toggle, season profile, briefing, Method page (use `model.area` + validation.md §9b).

## Blockers / open questions

- PT backtest systematic underestimate (−26%, every year): not smearing; likely drift between 2012–18 and 2019–25. Mention as limitation

## Done

- Stage 4: 2000–2025 outputs identical to stage 3 (all 8 countries); dist 207 MB; AU cells.json 23.8 MB / 2.9 MB gzip

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9, totals in cells.json match cache
- Stage 3: site minimum live; AU live: 2.2 MB gzip, parse 64 ms, first chart 1.6 s with Plotly preloaded
- Stage 2: PL = E (log-RMSE 0.43), PT = D (0.36); model.json ~4 kB
- Validation on all 8 countries (see docs/validation.md): D/E best everywhere, sigma 0.10 (AU) to 0.43 (PL); 12 unit tests pass
