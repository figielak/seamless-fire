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

Run date: 2026-11-14, sections 6a and 9c 2026-11-15 (near real-time sections: data through 2026-11-13). Countries: Poland (PL), Portugal (PT), Spain (ES), Greece (GR),
Ukraine (UA), Australia (AU), Canada (CA), Chile (CL).

## 1. Unit of comparison: cell-days

A **cell-day** is one 0.1° grid cell (about 11 × 7 km in Poland) on one day with at least one
vegetation fire detection. MODIS = Terra and Aqua combined (a cell-day counts once even if both
saw it). VIIRS = S-NPP. Counting cell-days instead of raw detections removes most of the effect
of the different pixel sizes (MODIS ~1 km, VIIRS 375 m): one large fire produces thousands of
VIIRS points but only a few hundred cell-days (Portugal, September 2024: 10,450 S-NPP detections,
358 cell-days).

### 1a. Sensitivity to the unit (`pipeline/sensitivity.py`)

The same calibration months and the same validation (LOYO, backtest 2019–2025 → 2012–2018) were
run on five units: cell-days on 0.05°, 0.1° (used) and 0.25° grids, raw detection counts, and
the FRP sum. AU was not run (2.7 GB of raw rows). The 0.1° column reproduces the stage 2 numbers,
which checks the script.

Cells: LOYO annual error / backtest bias / rank of the month with the most S-NPP detections
(2012–2025) within the unit's own ranking. Model variant as chosen for the country.

| Country (model) | cell 0.05° | **cell 0.1°** | cell 0.25° | detections | FRP sum |
|---|---|---|---|---|---|
| PL (E) | 15% / +5% / #1 | **15% / +6% / #1** | 15% / +6% / #1 | 17% / +8% / #1 | 25% / −19% / #2 |
| PT (D) | 10% / −26% / #8 | **10% / −27% / #12** | 10% / −24% / #24 | 10% / −18% / #1 | 16% / −31% / #3 |
| ES (D) | 6% / −4% / #1 | **6% / −4% / #2** | 5% / −3% / #3 | 11% / +11% / #1 | 13% / −11% / #1 |
| GR (E) | 11% / −14% / #23 | **9% / −11% / #38** | 7% / −7% / #49 | 8% / −3% / #1 | 21% / −4% / #1 |
| UA (E) | 7% / −9% / #3 | **7% / −9% / #3** | 6% / −8% / #1 | 8% / −3% / #1 | 14% / −17% / #3 |
| CL (D) | 9% / +14% / #3 | **10% / +17% / #8** | 10% / +19% / #10 | 13% / +20% / #1 | 7% / −3% / #1 |
| CA (D) | 10% / −3% / #1 | **8% / −3% / #1** | 6% / −3% / #1 | 19% / −8% / #1 | 14% / −6% / #3 |

Findings:

- **Grid size hardly changes the harmonization error.** Between 0.05° and 0.25° the LOYO annual
  error moves by 0–4 points. Coarser grids are slightly better on totals (smoothing).
- **But coarser grids saturate more.** The month with the most detections drops in the cell-day
  ranking: Greece, August 2021 (Evia and Attica fires) is #38 at 0.1° and #49 at 0.25°;
  Portugal, September 2024 is #12 and #24. Cell-days measure how widespread fire activity is
  (space × time), not how large or intense single fires are.
- **Detections are not better overall.** They avoid saturation and reduce the backtest drift in
  PT and GR, but are worse in ES, CA and CL (LOYO 11–19%), because the VIIRS/MODIS detection ratio
  depends on fire size.
- **FRP sum is the least stable** in most countries (LOYO 13–25%), except CL.
- No unit wins everywhere. 0.1° cell-days stay a good compromise for harmonization; saturation of
  megafire months is a stated limitation of the index.

## 2. Industrial filter

Only `type == 0` (presumed vegetation fire) is kept. Share of `type == 2` (static land source,
mostly industry) among all detections:

| | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| MODIS | 26.7% | 0.2% | 3.8% | 0.9% | 4.5% | 0.5% | 0.1% | 18.8% |
| VIIRS | **71.9%** | 4.5% | 23.1% | 14.2% | 14.6% | 1.1% | 1.5% | 16.7% |

Without the filter almost three quarters of Polish VIIRS "fires" would be industrial sites
(steelworks, refineries, gas flares), and VIIRS would inflate them much more than MODIS.
Chile is the only country where the industrial share is similar for both sensors (copper
smelters and other large static sources are bright enough for MODIS too).

Shares are computed from the yearly files 2000–2025 only (frozen, so adding 2026 does not move them).

### 2a. Industrial mask for near real-time 2026 rows (`pipeline/mask_check.py`)

FIRMS near real-time rows (2026-08-01 onward, `version = 2.0NRT`) have an empty `type`. For
those rows only, a detection is treated as industrial when its 0.01° cell was mostly
industrial in 2012–2025: `type == 2` is at least 50% of the cell's VIIRS (S-NPP + NOAA-20)
detections. Archive rows keep their own `type`; where archive and NRT cover the same day, the
archive wins.

Out-of-sample test: the 2026 archive rows (2026-01…07) still have `type`. We hide it, apply
the mask, and compare S-NPP type-0 cell-days with the truth (7 months per country).

| Country | Mask rule | type 2 caught | type 0 wrongly cut | cell-day error | monthly log-RMSE |
|---|---|---|---|---|---|
| PL | any type 2 | 99.9% | 24.2% | −26.2% | 0.46 |
| PL | **≥ 50% type 2** | 94.7% | 11.0% | **−2.5%** | 0.16 |
| PT | any / ≥ 50% | 100% / 100% | 1.0% / 0.4% | −2.8% / **−1.8%** | 0.07 / 0.04 |
| ES | any / ≥ 50% | 100% / 96.3% | 1.6% / 1.0% | −5.7% / **−2.2%** | 0.08 / 0.03 |
| GR | any / ≥ 50% | 100% / 91.3% | 4.4% / 2.4% | −8.6% / **+0.4%** | 0.16 / 0.02 |
| UA | any / ≥ 50% | 100% / 95.3% | 0.8% / 0.6% | **−0.1%** / +2.4% | 0.04 / 0.14 |
| CL | any / ≥ 50% | 99.5% / 98.5% | 0.5% / 0.2% | −1.0% / **−0.1%** | 0.01 / 0.01 |

The "any type 2" rule removes a quarter of real Polish vegetation detections, because in
Poland many fires (field burning around towns and industry) fall into cells that had an
occasional industrial detection. The majority rule keeps the 2026 near real-time months within
a few percent of the archive-quality result in all six countries (thresholds 0.25, 0.75, 0.9
and a 3×3 neighbourhood were also tried and were worse overall). AU and CA (pipeline log):
type 2 caught 90.6% / 88.8%, type 0 wrongly cut 0.04% / 0.06%. The months 2026-08…10 stay
flagged as preliminary.

## 3. Do the two sensors see the same fire activity?

| | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| Monthly correlation MODIS vs S-NPP | 0.922 | 0.951 | 0.932 | 0.942 | 0.982 | 0.967 | 0.989 | 0.906 |
| VIIRS / MODIS cell-day ratio | 3.50 | 1.87 | 2.38 | 2.86 | 2.40 | 1.90 | 1.73 | 2.38 |
| MODIS cell-days also seen by VIIRS (exact) | 25.7% | 54.4% | 39.9% | 47.3% | 60.5% | 82.1% | 78.5% | 58.1% |
| … with 3×3 neighbour tolerance | 34.2% | 70.1% | 50.5% | 64.5% | 80.6% | 91.5% | 87.3% | 71.1% |
| VIIRS cell-days also seen by MODIS (exact) | 7.3% | 29.1% | 16.7% | 16.5% | 25.2% | 43.0% | 45.2% | 24.3% |

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

| Annual error / log-RMSE | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| A | 46% / 1.39 | 14% / 0.51 | 20% / 0.39 | 32% / 0.69 | 19% / 0.74 | 6% / 0.14 | 13% / 0.52 | 20% / 0.47 |
| B | 24% / 1.17 | 15% / 0.52 | 10% / 0.28 | 7% / 0.45 | 7% / 0.63 | 6% / 0.15 | 12% / 0.59 | 14% / 0.38 |
| C | 28% / 1.11 | 9% / 0.45 | 11% / 0.27 | 5% / 0.33 | 6% / 0.44 | 5% / 0.13 | 7% / 0.24 | 14% / 0.34 |
| D | 15% / 0.48 | 10% / 0.36 | 6% / 0.22 | 11% / 0.28 | 7% / 0.25 | 3% / 0.10 | 8% / 0.17 | 10% / 0.27 |
| E | 15% / 0.43 | 10% / 0.35 | 7% / 0.21 | 9% / 0.26 | 7% / 0.24 | 3% / 0.09 | 8% / 0.17 | 8% / 0.26 |

The log-log model (D/E) has the lowest monthly error in every country, often by a factor of 2
(PL: 0.43 vs 1.11 for the best ratio method). Simple ratios fail because the relation is not
proportional: `b` is 0.56–0.86, so VIIRS gains relatively more in quiet months (small fires)
than in big fire months. Method A results depend on which countries are pooled (Australia and
Canada dominate the sums).

## 5. Chosen model per country

Rule (decided before looking at results): E only if its LOYO log-RMSE beats D by more than 0.01,
otherwise the simpler D.

| | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| E − D log-RMSE | −0.048 | −0.007 | −0.007 | −0.021 | −0.012 | −0.007 | −0.001 | −0.009 |
| Model | **E** | D | D | **E** | **E** | D | D | D |
| b | 0.564 | 0.802 | 0.769 | 0.787 | 0.815 | 0.858 | 0.734 | 0.718 |
| sigma (monthly, log) | 0.430 | 0.362 | 0.217 | 0.260 | 0.239 | 0.100 | 0.175 | 0.271 |
| sigma (annual, log) | 0.182 | 0.130 | 0.086 | 0.099 | 0.085 | 0.043 | 0.106 | 0.114 |

The seasonal term helps where the season changes how the sensors relate: in Poland, spring
grass burning versus summer stubble burning. Both variants use the same formula on the site
(D = E with four equal `a` values).

`sigma` is the standard deviation of the LOYO errors. The ~80% interval for estimated months and years
is ± 1.28 · sigma' in log space, with sigma' = √(sigma² + drift²) and drift from the backtest (section 6a).

## 6. Backtest (stability over time)

A harder test: calibrate only on 2019–2025, predict 2012–2018. The signed error shows whether the
model drifts.

| Signed annual error, chosen model | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| Mean | +6% | **−27%** | −4% | −11% | −9% | 0% | −3% | **+17%** |
| Mean absolute | 15% | 27% | 5% | 11% | 10% | 2% | 7% | 17% |

Portugal by year (D): 2012 −32%, 2013 −33%, 2014 −22%, 2015 −26%, 2016 −25%, 2017 −27%, 2018 −21%.
Chile by year (D): 2012 +17%, 2013 +9%, 2014 +16%, 2015 +14%, 2016 +24%, 2017 +38%, 2018 −1%.

In Portugal, and to a lesser degree in Greece and Ukraine, a model fitted on recent years
underestimates older years in **every** year, so the MODIS–VIIRS relation has changed over
time (possible causes: MODIS orbit drift and ageing, changes in fire regime). The production
model is fitted on all of 2012–2025, which averages this out, but estimates for 2000–2011 in
these countries carry extra uncertainty. This is listed as a limitation.

Chile drifts the other way: a model fitted on 2019–2025 **overestimates** 2012–2017
(+17% on average, +38% in the record fire year 2017). The drift therefore has no single
direction across countries, which points to regional changes in fire regime rather than one
global sensor trend.

### 6a. Drift in the interval (`pipeline/model.py: drift_sigma`, user decision 2026-11-15)

Does the ~80% annual interval (LOYO errors only) hold the backtest years? Share of the 7 backtest years
2012–2018 whose observed total falls inside ± 1.28 · sigma_annual of the backtest prediction:

| | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| drift = \|mean log1p(backtest error)\| | 0.044 | **0.310** | 0.040 | 0.121 | 0.093 | 0.005 | 0.036 | 0.150 |
| In interval, LOYO sigma only | 71% | **0%** | 86% | 57% | 43% | 100% | 86% | 57% |
| In interval, with drift term | 71% | 100% | 86% | 86% | 86% | 100% | 86% | 86% |
| sigma monthly (LOYO → with drift) | 0.430 → 0.432 | 0.362 → 0.477 | 0.217 → 0.221 | 0.260 → 0.286 | 0.239 → 0.257 | 0.100 → 0.100 | 0.175 → 0.179 | 0.271 → 0.310 |
| sigma annual (LOYO → with drift) | 0.182 → 0.188 | 0.130 → 0.336 | 0.086 → 0.095 | 0.099 → 0.156 | 0.085 → 0.126 | 0.043 → 0.043 | 0.106 → 0.112 | 0.114 → 0.188 |

LOYO errors measure how well a year is predicted from neighbouring years, not how the sensor relation
changes over a decade. The site's interval therefore adds the drift in quadrature to the monthly and annual
sigma and to the custom-area half-widths (`h_month`, `h_annual`: √(h² + (1.28 · drift)²)). Point estimates
are unchanged. Portugal 2005: 3,738 cell-days, ~80% 2,430–5,751 (before: ±18%). The coverage with the drift
term is partly in-sample (drift is measured on the same backtest years), so it shows consistency, not an
independent test. Values in `model.json` → `drift` (LOYO sigmas kept as `sigma_loyo`, `sigma_annual_loyo`).

## 7. Retransformation (smearing) check

A log model predicts the median, so summing back-transformed months can underestimate totals.
We tested the Duan smearing correction as a diagnostic (not adopted):

| Signed error, chosen model → with smearing | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| LOYO bias | −6.8% → +0.8% | −0.8% → +5.7% | −2.0% → +0.2% | −2.6% → +0.5% | −1.7% → +0.8% | −0.8% → −0.4% | −2.9% → −1.5% | −3.1% → +0.3% |
| Backtest bias | +6.1% → +12.9% | −26.5% → −21.4% | −3.8% → −1.4% | −11.2% → −8.3% | −8.7% → −6.0% | −0.4% → +0.2% | −3.3% → −1.5% | +16.7% → +19.6% |

Smearing removes the small LOYO bias but does not explain the Portuguese backtest drift
(−27% → −21%), and in Poland and Chile it makes the backtest worse. The LOYO biases without it are small
(below 7%), so the plain model is kept.

## 8. Other calibration factors

| | PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|---|
| NOAA-20 factor (S-NPP / NOAA-20, 2018–2025) | 0.922 | 0.962 | 0.941 | 0.917 | 0.956 | 0.975 | 0.968 | 0.977 |
| Terra-only ratio (Terra+Aqua)/Terra, DJF/MAM/JJA/SON | 2.10 (all year) | 2.25/1.95/1.70/1.86 | 2.13/1.60/1.66/1.60 | 3.88/2.16/1.76/2.18 | 3.47/2.19/1.54/2.19 | 1.70/2.69/2.28/1.70 | 1.79/1.68/1.34/1.72 | 1.92/4.48/3.73/1.94 |
| Terra-only extra sigma (log) | 0.40 | 0.28 | 0.15 | 0.40 | 0.34 | 0.15 | 0.14 | 0.29 |

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

| PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|
| 1.11 | 1.12 | 0.97 | 0.85 | 0.64 | 1.00 | 1.03 | 0.97 |

There is no artificial jump at 2012; a naive splice of raw MODIS and VIIRS would jump by the
factor in section 3 (×1.7 to ×3.5). The Ukrainian drop is real: raw MODIS itself fell by 32%
from 2011 to 2012 (16,038 → 10,871 cell-days).

Known events in Chile (MODIS / S-NPP cell-days, rank among all S-NPP months 2012–2025):

| Month | Event | MODIS | S-NPP | Rank |
|---|---|---|---|---|
| 2017-01 | central Chile fire storm (Maule, O'Higgins) | 1,067 | 1,353 | 8 |
| 2023-02 | Ñuble, Biobío, Araucanía | 1,108 | 1,700 | 2 |
| 2024-02 | Valparaíso / Viña del Mar | 185 | 520 | 71 |

Both sensors put the large 2017 and 2023 events at the top. The 2024 fire was deadly but
compact (a few cells at the urban edge over a few days), so it barely shows in cell-days.
The calendar measures widespread fire activity, not the impact of a single fire.

### 9a. Independent check against EFFIS national statistics (`pipeline/effis_check.py`)

Source: EFFIS country totals (forest fire burnt area in ha and number of forest fires, 1980–2024,
reported by national authorities), from *Forest fires in Europe, Middle East and North Africa
2024*, European Commission JRC, [doi:10.2760/0649290](https://dx.doi.org/10.2760/0649290),
file "Country totals 2024" on the [EFFIS data page](https://forest-fire.emergency.copernicus.eu/applications/data-and-services).
Not a satellite product, so it is independent of FIRMS. 2000 is skipped (partial Terra year);
UA starts in 2007.

Test: fit log(series) = α + β·log(EFFIS) on 2012–2024 (observed VIIRS), then measure how far the
2001–2011 years sit from that line (*level shift*). Three series are compared:
**harmonized** (ours), a **naive splice** (raw MODIS cell-days to 2011, VIIRS from 2012), and
**MODIS only** (one sensor for the whole period, the control). Spearman ρ is per period
(2001–2011 / 2012–2024).

| Country | ρ harmonized | ρ MODIS only | Shift: naive splice | Shift: harmonized | Shift: MODIS only | Expected from MODIS (×b) |
|---|---|---|---|---|---|---|
| **Burnt area** | | | | | | |
| PL | 0.79 / 0.80 | 0.82 / 0.46 | −51% | +26% | +72% | +36% |
| PT | 0.70 / 0.64 | 0.65 / 0.84 | −24% | +35% | +41% | +32% |
| ES | 0.48 / 0.36 | 0.69 / 0.45 | −34% | +47% | +58% | +42% |
| GR | 0.54 / −0.07 | 0.58 / 0.09 | −49% | +36% | +50% | +37% |
| UA | 0.50 / 0.35 | 0.50 / 0.45 | −37% | +40% | +53% | +41% |
| **Number of fires** | | | | | | |
| PL | 0.52 / 0.75 | 0.66 / 0.35 | −51% | +25% | +76% | +37% |
| PT | 0.81 / 0.95 | 0.69 / 0.79 | −59% | −27% | −23% | −19% |
| ES | 0.74 / 0.92 | 0.68 / 0.87 | −52% | +5% | +3% | +2% |
| GR | 0.93 / −0.07 | 0.83 / −0.03 | −48% | +39% | +44% | +33% |
| UA | 0.50 / 0.64 | 0.50 / 0.68 | −63% | −17% | −16% | −13% |

Findings:

- **The naive splice is wrong everywhere.** It puts 2001–2011 24–63% too low relative to EFFIS,
  the artificial jump at 2012 that harmonization is meant to remove.
- **The harmonized series follows the single-sensor control.** Its shift matches what MODIS alone
  implies through the model slope (last column) within ±12 points in every country and
  both EFFIS measures. So the reconstruction adds no extra break at 2012.
- **EFFIS cannot confirm the absolute level better than about ±40%.** Even MODIS alone, one
  sensor in both periods, sits 40–70% higher per unit of EFFIS burnt area in 2001–2011 than in
  2012–2024. The link between national *forest* fire statistics and satellite *vegetation* fire
  detections (which include agricultural burning) changed over time. This drift is a property of
  the comparison, not of the harmonization.
- **Year-to-year agreement before 2012 is as good as after.** Rank correlation of harmonized
  values with EFFIS burnt area is similar or higher in 2001–2011 than in 2012–2024 (PL 0.79 / 0.80,
  PT 0.70 / 0.64). Greece after 2012 shows no correlation for any satellite series: the large
  2021 and 2023 fires are compact in cell-days (see §1a) while many small fires fill other years.

### 9b. Custom areas before 2012: country share (`pipeline/area.py`, `pipeline/area_check.py`)

The site lets users pick an area smaller than the country. Applying the country model to the
area's own MODIS sum fails for small areas: the log model has an intercept, so an area with no
MODIS detections still gets `expm1(a)` ≈ 4–20 cell-days per month (PL summer ≈ 20). Before 2012
the site therefore uses the **country share**: `V_area = V_country × M_area / M_country`
(0 when the whole country has no MODIS cell-day that month). From 2012-02 the area's own observed
VIIRS cell-days are shown. With the whole country selected the site shows the country series
unchanged.

Test design (fixed before running): areas = 2°×2° blocks anchored at 0°/0° (a cell belongs to the
block holding its center) with ≥ 20 MODIS cell-days in the calibration months; both methods use the
same leave-one-year-out folds as §4; truth = the block's observed S-NPP cell-days 2012–2025.
Log-RMSE per block over all calibration months, median over blocks; bias = mean log1p residual;
annual error = mean |error| over block-years with VIIRS > 0, median over blocks.

| Country | Blocks | Log-RMSE direct / share (median) | Bias direct / share | Annual error direct / share | Share better |
|---|---|---|---|---|---|
| PL | 17 | 1.90 / 0.93 | +1.80 / −0.27 | 575% / 44% | 15 / 17 |
| PT | 8 | 0.79 / 0.75 | +0.68 / −0.16 | 82% / 21% | 4 / 8 |
| ES | 26 | 1.03 / 0.80 | +1.04 / −0.19 | 144% / 28% | 23 / 26 |
| GR | 15 | 1.23 / 0.85 | +1.06 / −0.22 | 170% / 23% | 12 / 15 |
| UA | 34 | 1.14 / 0.68 | +1.14 / −0.18 | 94% / 15% | 34 / 34 |
| AU | 216 | 1.22 / 0.54 | +1.10 / −0.17 | 171% / 28% | 182 / 216 |
| CA | 287 | 2.44 / 0.41 | +2.20 / −0.11 | 2238% / 49% | 278 / 287 |
| CL | 25 | 1.55 / 0.89 | +1.42 / −0.30 | 386% / 54% | 21 / 25 |

Presets (shown separately, not part of the block statistics): Podkarpacie 1.83 / 0.96,
Biebrza valley 2.67 / 0.34, Algarve 1.07 / 0.98 (log-RMSE direct / share).

- The share method wins in every country; the direct model overestimates small areas strongly
  (bias +0.7 to +2.2 in log1p). The share method is slightly low (−0.1 to −0.3).
- **Limitation:** an area with MODIS = 0 in a month gets 0, but VIIRS sees fire there in some months:
  0.6% (UA, AU) to 17% (PL) of block VIIRS cell-days fall in such months (Biebrza 34%, small area).
  Uncertainty for areas is therefore much larger than for countries.
- **Interval for areas** (log1p space, so a zero estimate still has an upper bound):
  `[max(0, expm1(log1p(v) − h)), expm1(log1p(v) + h)]`, h = 80% quantile of |residual| of the
  share method on active months (VIIRS > 0 or MODIS > 0). Calibrated on half of the blocks
  (checkerboard), coverage on the other half: months 76–85%, years 73–88%. Stored in
  `model.json` → `area` (`h_month` 0.79 AU to 1.39 PL/CL, i.e. ×2.2 to ×4; `h_annual` 0.27 UA to
  1.11 CL). Blocks are 2°, so the interval may still be too narrow for much smaller areas.
- Annual sums: years fully before VIIRS use `h_annual`; a mixed year (2012, January estimated)
  adds the monthly interval of the estimated month to the observed sum. The country annual
  series uses the same mixed-year rule (before stage 5 the 2012 interval was zero).

### 9c. Large single fires and the detection index (`src/lib/stats.ts`, user decision 2026-11-15)

Cell-days saturate when one fire burns in the same few 0.1° cells for days. The months with the most S-NPP
detections (2012 – Oct 2026) and their rank in cell-days:

| Month | Event | Detections (rank) | Cell-days (rank) | Det. per cell-day | Anomaly index (cell-days) |
|---|---|---|---|---|---|
| GR 2021-08 | Evia, Attica | 7,095 (#1) | 246 (#38) | 28.8 | 0.9 |
| GR 2023-08 | Evros, Dadia | 5,729 (#2) | 257 (#37) | 22.3 | 1.0 |
| PT 2024-09 | Aveiro, Viseu | 10,412 (#1) | 358 (#12) | 29.1 | 3.6 |
| PT 2025-08 | central and north | 10,060 (#2) | 436 (#8) | 23.1 | 3.2 |
| ES 2025-08 | Ourense, León | 20,859 (#1) | 1,111 (#2) | 18.8 | 2.8 |

The usual month has 1.4–2.2 detections per cell-day in Europe (AU 7.1, CA 3.3). A Greek user would read
the two worst fire summers as typical Augusts. The site keeps cell-days as the unit (the harmonization needs
it, section 1a) and adds, for observed VIIRS months only:

- **detection index** = (det + k) / (median + k), the anomaly formula on raw S-NPP detections (k and the
  10-year reference as for cell-days; estimated months have no detections on the VIIRS scale);
- **large-fire month** when detection index ≥ 5, detections per cell-day ≥ 3 × the area's median, and ≥ 100
  detections. An absolute threshold fails (AU and CA have high ratios every season). Flagged country months:
  GR 2021-05, 2021-08, 2023-07, 2023-08; PT 2017-06 (Pedrógão), 2017-10, 2024-09, 2025-08; ES 2021-10…12
  (La Palma eruption: lava is not flagged as type 2), 2022-06, 2022-07, 2025-08, 2026-07; AU 2019-12 (Black
  Summer); CA 2017-08/09, 2019-05, 2023-05/06/09 (record season), 2024-09, 2025-05/06/09; CL 2023-02; none in PL, UA
  (many small fires: 1.4 and 1.9 detections per cell-day).

"Top anomalies" ranks by the anomaly index (default), by excess (cell-days − typical, which favours big fire
months over winter burning on a near-zero median) or by the detection index.

## 10. Data quality checks

- All raw files checked for truncation (field count of the last row). Two Canadian files were
  truncated downloads (MODIS 2025 ended on 2025-05-29, S-NPP 2017 in August) and were
  re-downloaded. The pipeline now drops incomplete rows with a warning instead of failing silently.
- Totals in each `cells.json` equal the totals of the cell-day cache (checked by tests).
- One Polish cell and month checked by hand against the raw CSV (19 unique days = 19 cell-days).
- Chile (48 files, downloaded 2026-11-14) checked the same way: all files complete, Jan–Dec coverage.
- Stage 4 regression: after adding 2026 data, every 2000–2025 output (model parameters, all
  method metrics, agreement, NOAA-20 factor, Terra-only ratio, annual series with intervals,
  every `cells.json` row) is identical to the stage 3 build for all 8 countries.
- Each country's S-NPP files must cover the whole last month (2026-10); the model step refuses a
  cache built for other raw files or another end month.

## 11. Automated tests

`pipeline/tests/` (`test_pipeline.py`, `test_area.py`, `test_borders.py`, `test_live.py`), 36 tests, and
`npm run test:site` (TypeScript, 81 tests), all passing. Pipeline tests:
- 0.1° cell indexing at float edges
- `type` filter, duplicate removal, leading zeros in `acq_time`, error on unknown satellite,
  skipping browser duplicates such as `Poland(1).csv`
- MODIS counted as Terra ∪ Aqua
- 2026 files: NRT rows typed by the mask, archive rows keep `type`, archive wins on shared days,
  rows after 2026-10 dropped, preliminary months, duplicates removed before counting detections,
  majority mask rule, overlapping files rejected
- the regression recovers known `a`, `b` on synthetic data; methods ranked correctly; D chosen on a tie
- switch from model to observed VIIRS at 2012-02; Terra-only scaling
- custom areas: LOYO folds equal to validation, share = country model when area = country,
  zero when the country has no MODIS, point-in-polygon and inclusive rectangle edges, presets valid;
  mixed-year (2012) annual interval
- consistency of the generated files for every built country (totals, bbox, intervals,
  D/E better than A, file size under the GitHub limit)
- country raster (cell count of a polygon with a hole, point lookup, coast growth that stops at a
  neighbour), coverage of the daily update (complete days, gaps after missed runs, an older file
  never moves coverage back), idempotent merge, cell-day counting of `live.json`

Site tests also check: the TypeScript harmonization against Python reference outputs; preset
cells sum to the area series; live cell-days added on the S-NPP scale without changing earlier
months; daily history equal to monthly VIIRS; month-to-date statistics; recurrence files against
the hotspot files; season curves.

## 12. Near real-time updates (from November 2026)

The recent days are added by `pipeline/live_update.py` (run by hand, no raw data needed):
the FIRMS global NOAA-20 near real-time file of the last 7 days is cut to the 8 countries, the
frozen industrial mask removes rows without `type`, and new detections are added. S-NPP near
real-time data end between 2026-10-31 (PL) and 2026-11-02, so the live period is NOAA-20 ×
`n20_factor` (§8) from 1 November.

**Country borders** (`pipeline/borders.py`): Natural Earth 1:10m (Ukraine point of view, so Crimea is
in Ukraine as in the FIRMS Ukraine files), rasterized to 0.01° and grown by one cell into cells of
no other country (the 1:10m coastline misses coastal and island points). Recall against the FIRMS
country files, 2025 NOAA-20 vegetation detections:

| PL | PT | ES | GR | UA | AU | CA | CL |
|---|---|---|---|---|---|---|---|
| 99.94% | 99.85% | 99.94% | 99.75% | 99.91% | 99.99% | 99.997% | 99.95% |

Before the coast growth Greece was 98.2%. At the Portugal–Spain border 0.10–0.15% of points go to
the neighbour (FIRMS and Natural Earth borders differ by up to ~1 km).

**Global file vs country files**, 7–11 Nov 2026 (both available), after the same filters: identical in
PL, PT, GR, CA, CL; ES and UA +1 detection; AU −18 of 50,588 (0.04%).

**Daily history** (`{CC}/daily/`, S-NPP cell-days per cell and day): sums equal the monthly VIIRS of
`cells.json` in every month and country.

**Month to date** is compared only with the same days of earlier years (2012–2025, reference
2016–2025), never with full months. First result checked by hand: Portugal 1–13 Nov 2026 =
99 NOAA-20 cell-days × 0.962 = 95.3 on the S-NPP scale; the same days in 2016–2025 have a median
of 16.5, so 5.0× typical (above 97% of years). Year to date Portugal is at the median (1.0×).

**Coverage**: a day counts as complete only after the next day appears in the file; days missed by
more than 7 days without an update are listed as gaps and left out of both sides of the comparison.

## 13. Fire recurrence and year-round fire

The map mode "Recurrence" shows, per 0.01° cell (~1 km) and calendar month, the share of years with at
least one S-NPP vegetation detection (Feb 2012 – Oct 2026, the Jul–Aug 2022 outage left out; cells with
fire in a single year are not stored). The 0.1° grid of the calendar was too coarse for this question:
the October recurrence of the Stalowa Wola cell (33%) comes almost entirely from one ~1 km spot in the
industrial zone. The recurrence files match counts made directly from the hotspot files (test).

Cells with fire in ≥ 10% of all counted months **and** in ≥ 9 of the 12 calendar months are marked as
"year-round fire". Vegetation burning is seasonal, so these are mostly industrial sources that FIRMS
did not flag as `type` 2. The top Polish cells are the Płock refinery, coke plants (Wałbrzych,
Zdzieszowice), steelworks (Ostrowiec, Dąbrowa Górnicza, Częstochowa, Warsaw) and Stalowa Wola; in
Portugal the Sines refinery; in Spain Avilés, Tarragona, Puertollano, Huelva and A Coruña. The month
rule matters in Australia: the share rule alone marks 1,318 savanna cells that burn often but in one
season, with the month rule 224. Counts: PL 65, PT 14, ES 90, GR 20, UA 126, AU 224, CA 203, CL 53.
Only the top cells were checked against known sites; the marks are a display hint, the harmonized
values do not change.

## 14. Trends (`src/lib/trend.ts`)

Per-year trend of annual totals: Theil–Sen slope on log(1 + cell-days) (median of all pairwise
slopes, robust to single extreme years), Mann–Kendall test (two-sided, tie correction), Sen's 95%
interval. Complete years only; 2000 is left out (10 months of early Terra data). The site shows the
trend of the full harmonized period and of the observed VIIRS years alone: when both agree, the trend
does not come from the MODIS harmonization. Unit tests check slope, S, z, p and the intercept against
an independent brute-force Python implementation.

| Country | 2001–2025 (%/yr, 95%) | VIIRS only 2013–2025 | Significant calendar months (2001–2025) |
|---|---|---|---|
| PL | −3.6 (−4.7 to −2.3), p < 0.001 | −3.7 (−8.0 to +0.4), p = 0.08 | Apr, May, Jul, Aug, Oct, Nov down |
| PT | −3.7 (−6.1 to −1.4), p = 0.002 | −7.2 (−10.6 to −0.1), p = 0.04 | Jun–Oct down |
| ES | −3.6 (−4.4 to −2.8), p < 0.001 | −3.1 (−6.7 to −0.3), p = 0.02 | Apr–Nov down |
| GR | −3.9 (−5.2 to −2.0), p < 0.001 | −6.0 (−7.4 to −4.0), p = 0.001 | May, Jun, Sep, Oct down |
| UA | −3.1 (−5.0 to −0.7), p = 0.01 | −8.5 (−14.6 to −1.6), p = 0.02 | Jun, Dec down |
| AU | −1.0 (−2.4 to +0.4), p = 0.22 | −0.1, p = 0.95 | Sep, Nov down |
| CA | +2.1 (−0.9 to +3.9), p = 0.12 | +1.9, p = 0.50 | Apr down, Aug up |
| CL | −0.2 (−0.8 to +0.6), p = 0.66 | −1.3, p = 0.13 | Oct–Dec up |

All five European countries decline by 3–4% per year, and in four of them the VIIRS years alone
confirm it. This matches the human-driven decline of burning in agricultural landscapes reported
globally (Andela et al., 2017, *Science* 356, 1356–1362). Example area: the Podkarpacie preset declines
by 3.8%/yr (2001–2025, p = 0.009) and 10%/yr in the VIIRS years (p = 0.02), with April (spring grass
burning, −5.5%/yr) and August (−6.7%/yr) significant. Caveats: p assumes independent years; the trend
of a small area rests on few cell-days; the period of the trend follows the selected date range.

## 15. Fire activity forecast (`pipeline/forecast_*.py`, "Next 7 days" tab)

Daily S-NPP cell-days of a country = climatology (mean log1p by day of year) + a ridge regression per season
on fire-weighted weather features: the Canadian Fire Weather Index system (FFMC, DMC, DC, ISI, BUI, FWI,
own implementation, `pipeline/fwi.py`, checked on the reference day of Van Wagner 1987), Tmax, RH min, wind,
VPD, dry days, 7-day rain. Weather: NASA POWER (MERRA-2) at the 1° grid centres where fires happen (weight =
share of 2012–2025 cell-days in the 1° box; 12 points).

**Upper bound (observed weather, LOYO 2012–2025, `forecast_check.py`).** R² of daily log1p cell-days:

| | PL | PT | ES | GR | UA | CL | CA | AU |
|---|---|---|---|---|---|---|---|---|
| season only | 0.28 | 0.05 | 0.08 | 0.14 | 0.54 | 0.26 | 0.49 | 0.31 |
| with weather | 0.58 | 0.53 | 0.48 | 0.44 | 0.74 | 0.56 | 0.62 | 0.38 |

Best single predictors everywhere: RH min (r = −0.51 to −0.63 with daily anomalies) and FFMC/ISI. In AU and CA
one weather average for a continent adds little (the 40 points cover 30% and 20% of the fire activity).

**Real forecasts (`forecast_skill.py`).** Trained on 2012–2023, tested on 2024–2025 with archived numerical
forecasts (Open-Meteo Previous Runs API, the run issued L days before). FWI codes start from the observed state
and continue with forecast weather. Forecast weather is bias-corrected per lead day, point and calendar month
against POWER (the archive switches weather models with lead: on day 7 RH is 5 points lower and rain 40% less;
a lead-0 correction alone gave a false skill of −0.53 on day 7 in PT). Skill = 1 − SSE / SSE of climatology:

| Day ahead | 1 | 2 | 3 | 4 | 5 | 6 | 7 | observed weather | 7-day total, corr (climatology) |
|---|---|---|---|---|---|---|---|---|---|
| PT | 0.32 | 0.30 | 0.29 | 0.27 | 0.22 | 0.18 | 0.18 | 0.41 | 0.76 (0.37) |
| ES | 0.26 | 0.24 | 0.25 | 0.22 | 0.20 | 0.14 | 0.08 | 0.30 | 0.66 (0.42) |
| UA | 0.19 | 0.16 | 0.12 | 0.09 | 0.09 | 0.05 | −0.01 | 0.21 | 0.91 (0.88) |
| PL | 0.15 | 0.23 | 0.21 | 0.21 | 0.14 | 0.12 | 0.04 | 0.25 | 0.79 (0.76) |
| GR | −0.02 | −0.04 | −0.06 | −0.07 | −0.13 | −0.17 | −0.18 | 0.03 | 0.71 (0.44) |
| CL | n/a | | | | | | | 0.09 | 0.68 (0.63) |

Forecast on the site: **PT, ES, UA, PL** (positive skill on days 1–6). Portugal and Spain keep most of the upper bound
for several days; in Poland and Ukraine the gain is smaller and the 7-day total adds little to the seasonal level.
Greece fails: even observed weather adds almost nothing in the 2024–2025 test years (the 2012–2025 LOYO bound was
0.44 R², so the relation changed or two test years are too few). Chile: the daily skill could not be computed (gaps in
the archived forecasts) and the upper bound is low (0.09). AU, CA: no forecast (one weather average per continent).

**Operation.** DC carries months of memory: restarting the codes 92 days before a day from start-up values
leaves DC wrong by 86–106 units on average, so the state per point is stored (`live/forecast/state_{CC}.json`)
and moved forward at each update with NASA POWER days only (about 3 days behind). The forecast starts the day after the
last fire data day; the days between the state and that day use Open-Meteo lead 0. If the issue day is already
past, the forecast issued on that day is taken from the archive (no later weather). The interval (80%) comes from
the residual SD per lead in the test. Hindcast autumn 2026 (PT, POWER weather): correlation 0.38 with the daily
observations vs −0.19 for climatology; it caught the burst of 1–5 Nov (predicted 4–6 per day vs typical 1.3,
observed 7–29) and the wet week after it, but underestimates peaks (it predicts a typical outcome, not extremes).

## 16. Summary

| Confidence in 2000–2011 estimates | Countries | Why |
|---|---|---|
| High | AU, CA, ES | high correlation, monthly error 10–22%, stable backtest |
| Good, older years may be biased | PT, GR, UA, CL | good LOYO, systematic backtest drift (PT, GR, UA low by 9–27%; CL high by 17%) |
| Lower | PL | small, short agricultural fires; sensors see different events; monthly error ~×1.5 |

Drift is part of the interval since 2026-11-15 (section 6a), so the "older years may be biased" group has wider
intervals before 2012 (PT annual ±54%).

In every country the harmonized series is much closer to observed VIIRS than any constant
multiplier, and the uncertainty shown on the site comes from these validation errors.
