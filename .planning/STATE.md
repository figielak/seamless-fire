# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-15 ~10:25

## Where we are

- All stages done and live (<https://figielak.github.io/seamless-fire/>). Judging Sun 15.11 13:00.
- 2026-11-15 morning, UX review fixes (all pushed, deploy green, checked on the live site):
  cell-day definition above the calendar; "× typical" → "anomaly index (1 = typical)" (Now, calendar, ranking, report);
  Now labels "middle 80% of years" / "X% of years were lower" / "No detections so far"; "Highest" month and year above
  the anomaly ranking; calendar tooltip with separate Source / Status lines; hotspot legend = whole country + inside area;
  forecast tab: places to watch first (top 3, expandable), map legend separates forecast markers from history,
  Recurrence follows the forecast month; Method opens with "The decision in three sentences", year/month errors in
  separate columns; calendar fits at 1280×800; one colour scale / y range for Raw and Harmonized.
- Exports: monthly and hotspot CSV download as ZIP + README.txt + area.geojson (`src/lib/exportdoc.ts`, `zip.ts`).
- Places to watch name the nearest GeoNames town (`pipeline/places.py` → `public/data/{CC}/places.json`, 1.3 MB total;
  raw files in `data/geonames/`).
- Near real-time data: refreshed by hand (`live_update.py`, then `forecast_update.py`), last runs 2026-11-15 ~10:10 and ~10:21 (second: FIRMS file unchanged, nothing to commit):
  fire data through 2026-11-14, forecasts ES/PL/PT/UA issued 2026-11-15 for 15–21 Nov (POWER state 2026-11-12).
- `docs/submission.md` updated with all of the above (summary 942 characters).
- Tests: `python -m unittest discover -s pipeline/tests` (47), `npm run test:site` (106), `npm run check` (0 errors)
- Deploy: push to `main` → workflow "Deploy to GitHub Pages"; check the run via
  `curl https://api.github.com/repos/figielak/seamless-fire/actions/runs` (no `gh`). A newer push cancels the older run.

## Next step

- 2026-11-15 ~11:00: Quick tour for the jury (`index.astro`: dialog on first visit, `localStorage` key `seamless-fire.tour-seen`,
  `?notour` skips it; "▶ Quick tour" in the header; 6 one-click steps with a hint bar above the chart tabs). Not committed yet.

- Usefulness review 10:30 (`.planning/REVIEW_usefulness.md`), all items A–E done 10:40 (user: "do everything"):
  large-fire flag + 3 ranking modes, drift term in intervals (models rebuilt with `--model-only`), texts. Check live after push.

- Before 13:00: optionally refresh NRT data once more around 12:30 (15 Nov becomes complete in FIRMS only later); fill
  `[FULL NAME]` and the demo link in `docs/submission.md`; check links in a private window.
- UX review: all 12 points addressed (preliminary marker fixed: orange, was default green).
- Known limit: `live/nrt/{CC}.csv` and `live.json` grow every day (AU ~8k rows/day in season). Every few months rebuild
  the base locally with newer FIRMS files (move `LAST_COMPLETE_MONTH`, rerun build_data + live_base) to fold live months in.

## Blockers / open questions

- PT backtest systematic underestimate (−26%, every year): likely drift between 2012–18 and 2019–25. Stated as a limitation.

## Done (key numbers)

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9
- Stage 2: PL = E (log-RMSE 0.43), PT = D (0.36); D/E best in all 8 countries, sigma 0.10 (AU) to 0.43 (PL)
- Stage 4: dist 207 MB; AU cells.json 23.8 MB / 2.9 MB gzip
