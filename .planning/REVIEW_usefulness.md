# Usefulness review of data and analyses (2026-11-15 ~10:30)

Question: does each output answer the challenge questions ("which periods burned most", "is now unusual",
"is it changing", "where") for emergency / land managers? Numbers below were measured on `public/data/` today
(quick Python checks, country level, anomaly index approximated as in `src/lib/stats.ts`).

## Findings

1. **Megafire months are invisible in cell-days and in the anomaly ranking (biggest gap).**
   Months with the most S-NPP detections vs their cell-day rank (2012–2026-10):
   GR 2021-08 (Evia/Attica) #1 det, #38 cell-days, anomaly index **0.91 (below typical)**, rank 90/190;
   GR 2023-08 (Evros) #2 det, #37 cd, index 1.06, rank 66; PT 2024-09 #1 det, #12 cd; ES 2026-07 #2 det, #21 cd.
   A Greek user would read the worst fire summers as normal. Known limitation (validation §1a), but not visible in the UI:
   detections only appear in the tooltip and CSV.
   Detections per cell-day separate these months cleanly: GR 2021-08 = 28.8, 2023-08 = 22.3 (median month 1.5);
   PT 2024-09 = 29.1, 2025-08 = 23.1, 2017-10 = 12.7, 2017-06 (Pedrógão) = 15.5 (median 1.8).
   A detection anomaly index (VIIRS years) ranks GR 2021-08 #1, 2023-08 #2; PT 2024-09 #1, 2017-10 #2, 2017-06 #3.
2. **Top anomalies favour low-baseline winter months.** The ratio index puts PT Jan 2017, Feb 2012, Jan 2019 and
   GR Dec 2016, Mar 2019, Jan 2020 on top (agricultural burning on a median near 0), ahead of the summer disasters.
   Ranking by excess (x − median) gives PT 2017-10, 2017-04, 2025-08, 2024-09 on top; in GR it still picks
   winter/spring burning (saturation, see 1). The method is correct but the "most unusual" list is not the
   "most dangerous" list, and the UI does not say so.
3. **2000–2011 interval does not include the drift.** PT annual 80% interval ≈ ±18% (sigma_annual 0.13), while the
   backtest is −21…−33% in every year; CL +17% the other way. The production fit averages the drift, so the true
   error is unknown, but the "honest uncertainty" claim is weakest exactly there. Not measured: coverage of the
   interval in the backtest.
4. **Trend intervals ignore harmonization uncertainty.** Full-period trends (2001–2025) use point estimates for
   2001–2011. Mitigated by the VIIRS-only column; PT drift makes the real decline steeper, CL drift could hide one.
5. **Country-level PL April 2020** ranks only #22 (index 1.45): correct (a local event), works in the Biebrza preset
   after the 2026-11-15 change. No action.
6. Not implemented from the concept: season shift indicator (start/peak/end day per year), template briefing
   (partly covered by the report summary lines). Low value compared with 1–2.

## To change (ordered by value for users; 1–3 need a user decision, they touch the method / UI meaning)

- [x] **A. Large-fire flag** (needs approval): per month, VIIRS detections per cell-day and a detection anomaly
      index (same formula, VIIRS years only); mark months above a threshold (e.g. ≥ 10 det/cd and det index ≥ 5)
      in the calendar and the ranking ("large-fire month: few cells, many detections"). Data already in
      `cells.json` (`viirs_det`), browser only; also for areas. No change to harmonized values.
- [x] **B. Ranking modes** (needs approval): Top anomalies tab with "Most unusual (index)" | "Largest excess" |
      "Most detections (VIIRS years)", or at least one line under the list explaining that the index favours
      quiet months.
- [x] **C. Drift in the interval** (method change, needs approval): measure backtest coverage of the 80% interval
      per country; if below ~70%, widen 2000–2011 intervals by |backtest bias| (PT, GR, UA, CL) or show a
      "possible drift" note on those countries' estimated years.
- [x] **D. Text only, no approval needed:** "How to read" tab + Method page + submission limitations: name the
      GR 2021 / 2023 example explicitly ("the largest single fires saturate: Evia 2021 shows as a typical August
      in cell-days; see detections in the tooltip / CSV"). Prepare the jury answer for "why is Evia not red?".
- [x] **E.** Trend note: "interval does not include the uncertainty of 2000–2011 estimates; compare with the
      VIIRS-only trend".
- [ ] Later / drop: season shift indicator; per-area drift check.

Done 2026-11-15 ~10:40 (user approved all). C: drift = |mean log backtest error| added in quadrature (validation §6a); A/B: validation §9c.
