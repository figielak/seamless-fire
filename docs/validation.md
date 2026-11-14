# Validation evidence

Measured results that support the harmonization method of Seamless Fire, with a short
explanation of each number. All values come from the pipeline (`pipeline/build_data.py`,
`pipeline/model.py`) run on FIRMS country files, calibration period 2012–2025.

Reproduce:

```bash
python pipeline/build_data.py                  # cells.json + model.json for all countries
python pipeline/sanity.py --summary            # cross-country table below
python pipeline/sanity.py PL                   # full detail for one country
python -m unittest discover -s pipeline/tests  # unit + consistency tests
```

Run date: 2026-11-14. Countries: Poland (PL), Portugal (PT), Spain (ES), Greece (GR),
Ukraine (UA), Australia (AU), Canada (CA).

## 1. Unit of comparison: cell-days

A **cell-day** is one 0.1° grid cell (about 11 × 7 km in Poland) on one day with at least one
vegetation fire detection. MODIS = Terra and Aqua combined (a cell-day counts once even if both
saw it). VIIRS = S-NPP. Counting cell-days instead of raw detections removes most of the effect
of the different pixel sizes (MODIS ~1 km, VIIRS 375 m): one large fire produces thousands of
VIIRS points but only a few hundred cell-days (Portugal, September 2024: 10,450 S-NPP detections,
358 cell-days).

## 2. Industrial filter

Only `type == 0` (presumed vegetation fire) is kept. Share of `type == 2` (static land source,
mostly industry) among all detections:

| | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| MODIS | 26.7% | 0.2% | 3.8% | 0.9% | 4.5% | 0.5% | 0.1% |
| VIIRS | **71.9%** | 4.5% | 23.1% | 14.2% | 14.6% | 1.1% | 1.5% |

Without the filter almost three quarters of Polish VIIRS "fires" would be industrial sites
(steelworks, refineries, gas flares), and VIIRS would inflate them much more than MODIS.

## 3. Do the two sensors see the same fire activity?

| | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| Monthly correlation MODIS vs S-NPP | 0.922 | 0.951 | 0.932 | 0.942 | 0.982 | 0.967 | 0.989 |
| VIIRS / MODIS cell-day ratio | 3.50 | 1.87 | 2.38 | 2.86 | 2.40 | 1.90 | 1.73 |
| MODIS cell-days also seen by VIIRS (exact) | 25.7% | 54.4% | 39.9% | 47.3% | 60.5% | 82.1% | 78.5% |
| … with 3×3 neighbour tolerance | 34.2% | 70.1% | 50.5% | 64.5% | 80.6% | 91.5% | 87.3% |
| VIIRS cell-days also seen by MODIS (exact) | 7.3% | 29.1% | 16.7% | 16.5% | 25.2% | 43.0% | 45.2% |

**Correlation** (1.0 = perfect) shows how closely the two monthly series move together: same
seasons, same bad years. Above 0.9 everywhere, so converting one sensor to the other is justified.

**Agreement** is the direct test: in how many cell-days seen by MODIS did VIIRS also detect fire
on the same day. In Australia and Canada (large, long-lasting forest and bush fires) the
sensors mostly see the same events. In Poland they mostly see *different* events: Polish fires
are short agricultural and grass burns, and the satellites pass at different times of day
(Terra ~10:30, Aqua and S-NPP ~13:30), so a fire is often already out or not yet started.
VIIRS sees far more cell-days than MODIS because it detects smaller fires.

**Consequence:** harmonization is valid for **totals** (fire activity in an area and month), not
for individual fire events. This is why the site sums cell-days over the area first and only
then applies the model.

## 4. Method comparison (leave-one-year-out)

Each year 2012–2025 is hidden in turn, the method is calibrated on the remaining years, and the
hidden year's VIIRS is predicted from MODIS alone. This is the same task as reconstructing
2000–2011, when VIIRS did not exist yet. Months with sensor outages (Aqua Aug–Sep 2020,
S-NPP Jul–Aug 2022) and the partial first S-NPP month (Jan 2012) are excluded.

Methods:
- **A**: one VIIRS/MODIS ratio for all countries
- **B**: one ratio per country
- **C**: ratio per country and calendar month
- **D**: `log1p(V) = a + b·log1p(M)` per country
- **E**: as D, with a separate `a` per season (DJF, MAM, JJA, SON)

Metrics:
- **Annual error**: mean |predicted − observed| / observed of the yearly total.
- **Log-RMSE**: typical error of a single month on a log scale. 0.10 ≈ ±10%, 0.43 ≈ a factor of 1.5,
  1.1 ≈ a factor of 3.

| Annual error / log-RMSE | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| A | 46% / 1.39 | 14% / 0.51 | 20% / 0.39 | 32% / 0.70 | 20% / 0.75 | 6% / 0.14 | 12% / 0.52 |
| B | 24% / 1.17 | 15% / 0.52 | 10% / 0.28 | 7% / 0.45 | 7% / 0.63 | 6% / 0.15 | 12% / 0.59 |
| C | 28% / 1.11 | 9% / 0.45 | 11% / 0.27 | 5% / 0.33 | 6% / 0.44 | 5% / 0.13 | 7% / 0.24 |
| D | 15% / 0.48 | 10% / 0.36 | 6% / 0.22 | 11% / 0.28 | 7% / 0.25 | 3% / 0.10 | 8% / 0.17 |
| E | 15% / 0.43 | 10% / 0.35 | 7% / 0.21 | 9% / 0.26 | 7% / 0.24 | 3% / 0.09 | 8% / 0.17 |

The log-log model (D/E) has the lowest monthly error in every country, often by a factor of 2
(PL: 0.43 vs 1.11 for the best ratio method). Simple ratios fail because the relation is not
proportional: `b` is 0.56–0.86, so VIIRS gains relatively more in quiet months (small fires)
than in big fire months. Method A results depend on which countries are pooled (Australia and
Canada dominate the sums).

## 5. Chosen model per country

Rule (decided before looking at results): E only if its LOYO log-RMSE beats D by more than 0.01,
otherwise the simpler D.

| | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| E − D log-RMSE | −0.048 | −0.007 | −0.007 | −0.021 | −0.012 | −0.007 | −0.001 |
| Model | **E** | D | D | **E** | **E** | D | D |
| b | 0.564 | 0.802 | 0.769 | 0.787 | 0.815 | 0.858 | 0.734 |
| sigma (monthly, log) | 0.430 | 0.362 | 0.217 | 0.260 | 0.239 | 0.100 | 0.175 |
| sigma (annual, log) | 0.182 | 0.130 | 0.086 | 0.099 | 0.085 | 0.043 | 0.106 |

The seasonal term helps where the season changes how the sensors relate: in Poland, spring
grass burning versus summer stubble burning. Both variants use the same formula on the site
(D = E with four equal `a` values).

`sigma` is the standard deviation of the LOYO errors; the 80% interval for estimated years is
± 1.28 · sigma in log space.

## 6. Backtest (stability over time)

A harder test: calibrate only on 2019–2025, predict 2012–2018. The signed error shows whether the
model drifts.

| Signed annual error, chosen model | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| Mean | +6% | **−27%** | −4% | −11% | −9% | 0% | −3% |
| Mean absolute | 15% | 27% | 5% | 11% | 10% | 2% | 7% |

Portugal by year (D): 2012 −32%, 2013 −33%, 2014 −22%, 2015 −26%, 2016 −25%, 2017 −27%, 2018 −21%.

In Portugal, and to a lesser degree in Greece and Ukraine, a model fitted on recent years
underestimates older years in **every** year, so the MODIS–VIIRS relation has changed over
time (possible causes: MODIS orbit drift and ageing, changes in fire regime). The production
model is fitted on all of 2012–2025, which averages this out, but estimates for 2000–2011 in
these countries carry extra uncertainty. This is listed as a limitation.

## 7. Retransformation (smearing) check

A log model predicts the median, so summing back-transformed months can underestimate totals.
We tested the Duan smearing correction as a diagnostic (not adopted):

| Signed error, chosen model → with smearing | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| LOYO bias | −6.8% → +0.8% | −0.8% → +5.7% | −2.0% → +0.2% | −2.6% → +0.5% | −1.7% → +0.8% | −0.8% → −0.4% | −2.9% → −1.5% |
| Backtest bias | +6.1% → +12.9% | −26.5% → −21.4% | −3.8% → −1.4% | −11.2% → −8.3% | −8.7% → −6.0% | −0.4% → +0.2% | −3.3% → −1.5% |

Smearing removes the small LOYO bias but does not explain the Portuguese backtest drift
(−27% → −21%), and in Poland it makes the backtest worse. The LOYO biases without it are small
(below 7%), so the plain model is kept.

## 8. Other calibration factors

| | PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|---|
| NOAA-20 factor (S-NPP / NOAA-20, 2018–2025) | 0.922 | 0.962 | 0.941 | 0.917 | 0.956 | 0.975 | 0.968 |
| Terra-only ratio (Terra+Aqua)/Terra, DJF/MAM/JJA/SON | 2.10 (all year) | 2.25/1.95/1.70/1.86 | 2.13/1.60/1.66/1.60 | 3.88/2.16/1.76/2.18 | 3.47/2.19/1.54/2.19 | 1.70/2.69/2.28/1.70 | 1.79/1.68/1.34/1.72 |
| Terra-only extra sigma (log) | 0.40 | 0.28 | 0.15 | 0.40 | 0.34 | 0.15 | 0.14 |

- **NOAA-20 factor.** S-NPP ends on 2 Nov 2026 and NOAA-20 continues the VIIRS series. NOAA-20
  sees 2–9% more cell-days, so its counts are scaled down by this factor. Values close to 1
  confirm that the two VIIRS instruments are nearly interchangeable.
- **Terra-only ratio.** Before Aqua (data until June 2002), only Terra observed, so MODIS counts
  are scaled up by the (Terra+Aqua)/Terra ratio from 2003–2025 before the model is applied. A
  seasonal ratio is used when every season has at least 100 Terra cell-days (Poland: one ratio).
  The extra uncertainty is added to the interval for those months.

## 9. Continuity at the 2011/2012 switch

The calendar shows the model estimate before February 2012 and observed S-NPP after it.
Ratio of harmonized annual totals 2012 / 2011:

| PL | PT | ES | GR | UA | AU | CA |
|---|---|---|---|---|---|---|
| 1.11 | 1.12 | 0.97 | 0.85 | 0.64 | 1.00 | 1.03 |

There is no artificial jump at 2012; a naive splice of raw MODIS and VIIRS would jump by the
factor in section 3 (×1.7 to ×3.5). The Ukrainian drop is real: raw MODIS itself fell by 32%
from 2011 to 2012 (16,038 → 10,871 cell-days).

## 10. Data quality checks

- All raw files checked for truncation (field count of the last row). Two Canadian files were
  truncated downloads (MODIS 2025 ended on 2025-05-29, S-NPP 2017 in August) and were
  re-downloaded. The pipeline now drops incomplete rows with a warning instead of failing silently.
- Totals in each `cells.json` equal the totals of the cell-day cache (checked by tests).
- One Polish cell and month checked by hand against the raw CSV (19 unique days = 19 cell-days).

## 11. Automated tests

`pipeline/tests/test_pipeline.py`, 12 tests, all passing:
- 0.1° cell indexing at float edges
- `type` filter, duplicate removal, leading zeros in `acq_time`, error on unknown satellite,
  skipping browser duplicates such as `Poland(1).csv`
- MODIS counted as Terra ∪ Aqua
- the regression recovers known `a`, `b` on synthetic data; methods ranked correctly; D chosen on a tie
- switch from model to observed VIIRS at 2012-02; Terra-only scaling
- consistency of the generated files for every built country (totals, bbox, intervals,
  D/E better than A, file size under the GitHub limit)

## 12. Summary

| Confidence in 2000–2011 estimates | Countries | Why |
|---|---|---|
| High | AU, CA, ES | high correlation, monthly error 10–22%, stable backtest |
| Good, older years may be low | PT, GR, UA | good LOYO, systematic backtest underestimate (−9% to −27%) |
| Lower | PL | small, short agricultural fires; sensors see different events; monthly error ~×1.5 |

In every country the harmonized series is much closer to observed VIIRS than any constant
multiplier, and the uncertainty shown on the site comes from these validation errors.
