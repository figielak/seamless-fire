# Decisions and findings

Append-only log of things decided or learned **during the event** that are not obvious from code
and not already in `CLAUDE.md`. One entry = date/time + 1–3 lines. Include the reason.
Method changes need the user's approval first; record the approval here.

Format: `- YYYY-MM-DD HH:MM · [decision|finding|gotcha] text. Why: ...`

- 2026-11-14 · decision · Keep project memory in `.planning/` (STATE.md = snapshot, this file = log). Why: 24 h project, avoid losing context between sessions.
- 2026-11-14 · gotcha · Added AU to COUNTRIES. AU raw = 2.7 GB, VIIRS files up to 164 MB. Why it matters: pipeline must aggregate per file; AU hotspot CSVs may exceed size limits (skip or thin).
- 2026-11-14 · data · Merged 2026 FIRMS downloads (archive+nrt) into `viirs-{snpp,jpss1}_2026_{Country}.csv`, originals in `data/_downloads_2026/`. Why: one file layout for all years; empty `type` / `version=2.0NRT` mark NRT rows.
- 2026-11-14 · decision (user approved) · Terra-only months (before first Aqua rows, ~mid-2002) scaled by per-country (Terra+Aqua)/Terra cell-day ratio (per season if stable) before the model; extra uncertainty added to the interval. Why: MODIS guide, early years otherwise underestimated.
- 2026-11-14 · decision (user approved) · Exclude from calibration: S-NPP Jul–Aug 2022 (outage 27 Jul–10 Aug), Aqua Aug–Sep 2020 (FMU failure 16 Aug–2 Sep). Flag in calendar as low quality: these months + Jan–Oct 2000 (Terra detector issues, Sep 2000 outage). Why: sensor gaps, guides in docs/.
- 2026-11-14 · decision (user approved) · Custom area can be a polygon drawn on a Leaflet map, not only a rectangle; cell counted if its center is inside. Rectangle inputs stay as fallback; polygon is first to drop if time runs out. Why: real areas (parks, valleys) are not rectangles; still fully static.
- 2026-11-14 · decision (user approved) · Stage 2 adds a cell-day agreement check (share of MODIS cell-days also seen by VIIRS and vice versa). Why: direct evidence for the Method page that the 0.1° cell-day unit makes the sensors comparable.
