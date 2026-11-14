# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **1 done** (not committed yet), next: **2 (validation A–E, model.json)**
- `pipeline/build_data.py` writes `countries.json`, `{CC}/cells.json` (columnar: lat, lon, m = months since 2000-01, modis, viirs) and cache `pipeline/cache/{CC}_celldays.parquet` (sat, lat_i, lon_i, date) + `{CC}_filter_stats.json`
- `pipeline/sanity.py` prints sanity numbers from the cache
- Built: PL, PT (years ≤ 2025; 2026 files skipped until stage 4). cells.json ~0.35 MB each
- Deploy run / live site not verified yet (`gh` not installed)

## Next step

1. Stage 2: validation A–E (LOYO + backtest), D vs E, sigma, NOAA-20 factor, Terra-only ratio, spatial agreement -> `model.json`
2. Confirm the deploy workflow run is green and https://figielak.github.io/seamless-fire/ loads

## Blockers / open questions

- D vs E: which wins validation? (stage 2)
- PT backtest systematic underestimate: cause unknown
- LOYO sanity numbers in CLAUDE.md may also be detection-based (see DECISIONS); compare trends, not exact values

## Done

- Stage 1: cell-days PL/PT, corr 0.92/0.95, cell-day ratio 3.5/1.9, totals in cells.json match cache
