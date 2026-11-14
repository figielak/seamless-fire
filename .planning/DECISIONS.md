# Decisions and findings

Append-only log of things decided or learned **during the event** that are not obvious from code
and not already in `CLAUDE.md`. One entry = date/time + 1–3 lines. Include the reason.
Method changes need the user's approval first; record the approval here.

Format: `- YYYY-MM-DD HH:MM · [decision|finding|gotcha] text. Why: ...`

- 2026-11-14 · decision · Keep project memory in `.planning/` (STATE.md = snapshot, this file = log). Why: 24 h project, avoid losing context between sessions.
- 2026-11-14 · gotcha · Added AU to COUNTRIES. AU raw = 2.7 GB, VIIRS files up to 164 MB. Why it matters: pipeline must aggregate per file; AU hotspot CSVs may exceed size limits (skip or thin).
- 2026-11-14 · data · Merged 2026 FIRMS downloads (archive+nrt) into `viirs-{snpp,jpss1}_2026_{Country}.csv`, originals in `data/_downloads_2026/`. Why: one file layout for all years; empty `type` / `version=2.0NRT` mark NRT rows.
