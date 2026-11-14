# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **3 implementation ready, deploy pending** (stage 3 counts as done only after the live test)
- Site: `src/pages/index.astro` (country select via `#CC` hash, Plotly calendar, "Now" panel); logic in
  `src/lib/harmonize.ts` (port of `harmonized_monthly`, `monthlyTotals(cells, n, keep)` ready for areas)
  and `src/lib/stats.ts`; tests `npm run test:site` (34, vs Python fixtures from `pipeline/site_fixture.py`)
- Pipeline: stages 1–2 done for 8 countries; model.json now has full-precision params + `last_complete_month`
- Tests: `python -m unittest discover -s pipeline/tests` (12), `npm run test:site`, `npm run check`

## Next step

1. Push to `main` (user OK), confirm Pages source = GitHub Actions, check the workflow run for the commit
2. Live test https://figielak.github.io/seamless-fire/ (fresh browser): new UI, PL/PT/AU, no console errors,
   gzip on AU cells.json, AU timings → DECISIONS.md, then mark stage 3 done
3. Then 3b: EFFIS independent check 2000–2011

## Blockers / open questions

- AU cells.json: kept as JSON, live timing still to confirm
- Stage 5 method question: model intercept gives ~4–20 cell-days/month for empty small areas before 2012 (see DECISIONS)

- PT backtest systematic underestimate (−26%, every year): not smearing; likely drift between 2012–18 and 2019–25. Mention as limitation

## Done

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9, totals in cells.json match cache
- Stage 2: PL = E (log-RMSE 0.43), PT = D (0.36); model.json ~4 kB
- Validation on all 8 countries (see docs/validation.md): D/E best everywhere, sigma 0.10 (AU) to 0.43 (PL); 12 unit tests pass
