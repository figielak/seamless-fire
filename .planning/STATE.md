# State

Short, current snapshot. Overwrite sections, do not append history here.
Method, data contract and work order live in `CLAUDE.md` and `docs/plan.md`; do not copy them.

Updated: 2026-11-14

## Where we are

- Stage: **1 (pipeline: load, filter, cell-days)**, not started
- Scaffold exists: Astro (`src/pages/index.astro`, `method.astro`, `lib/data.ts`), `pipeline/build_data.py` (only lists files), `config.py`, deploy workflow
- `public/data/` is empty
- Git: scaffold + `.planning` pushed to `origin/main`; deploy run / live site not verified yet
- Raw data present for PL, PT, ES, GR, UA (52 CSV each)

## Next step

1. Stage 1 in `pipeline/build_data.py`, check sanity numbers for PL, PT (see CLAUDE.md)
2. Confirm the deploy workflow run is green and https://figielak.github.io/seamless-fire/ loads

## Blockers / open questions

- D vs E: which wins validation? (stage 2)
- PT backtest systematic underestimate: cause unknown

## Done

(stage, one line each, with key result)
