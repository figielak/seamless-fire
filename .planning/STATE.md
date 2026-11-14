# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **2 done** (not committed yet), next: **3 (site minimum + deploy)**
- `pipeline/build_data.py` writes `countries.json`, `{CC}/cells.json` (columnar: lat, lon, m = months since 2000-01, modis, viirs) and cache `pipeline/cache/{CC}_celldays.parquet` (sat, lat_i, lon_i, date) + `{CC}_filter_stats.json`
- `pipeline/model.py` (stage 2) writes `{CC}/model.json`: model D/E, a[4], b, sigma, sigma_annual, n20_factor, terra_only, methods A–E (+D+s, E+s), agreement, industrial_share, annual series, flags. `build_data.py --model-only` skips stage 1
- `pipeline/sanity.py` prints sanity numbers from the cache and model.json
- Built: all 8 countries (incl. CA, CL); 2026 raw files present for all, used from stage 4 (years ≤ 2025; 2026 files skipped until stage 4). cells.json PL/PT/GR/ES < 1.1 MB, UA 5.7 MB, CA 4.5 MB, CL 1.4 MB, AU 20.4 MB (too big, see DECISIONS)
- Tests: `python -m unittest discover -s pipeline/tests` (12 tests); cross-country table: `python pipeline/sanity.py --summary`
- Deploy run / live site not verified yet (`gh` not installed)

## Next step

1. Stage 3: site minimum (country select, calendar, "Now" panel) from cells.json + model.json; deploy to GitHub Pages and verify the live URL
2. After stage 3: EFFIS independent check 2000–2011 (CLAUDE.md work order 3b)

## Blockers / open questions

- AU/UA cells.json size for the browser

- PT backtest systematic underestimate (−26%, every year): not smearing; likely drift between 2012–18 and 2019–25. Mention as limitation

## Done

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9, totals in cells.json match cache
- Stage 2: PL = E (log-RMSE 0.43), PT = D (0.36); model.json ~4 kB
- Validation on all 8 countries (see docs/validation.md): D/E best everywhere, sigma 0.10 (AU) to 0.43 (PL); 12 unit tests pass
