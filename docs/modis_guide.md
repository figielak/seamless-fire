# MODIS Collection 6 Active Fire: notes for Seamless Fire

Source: *MODIS Collection 6 Active Fire Product User's Guide* (Giglio et al., rev. C).
Only what matters for this project. FIRMS MODIS hotspots come from the standard
MCD14ML fire location product (Terra + Aqua, 1 km).

## Fields and their meaning

FIRMS CSV columns map to MCD14ML fields:

| FIRMS column | MCD14ML | Meaning |
|---|---|---|
| `acq_date`, `acq_time` | YYYYMMDD, HHMM | **UTC** date and time of detection |
| `satellite` | sat | Terra or Aqua (`T` / `A` in MCD14ML) |
| `latitude`, `longitude` | lat, lon | **center** of the ~1 km fire pixel |
| `brightness` | T21 | band 21 brightness temperature [K] |
| `bright_t31` | T31 | band 31 brightness temperature [K] |
| `frp` | FRP | fire radiative power [MW] |
| `confidence` | conf | detection confidence 0–100 % |
| `type` | type | inferred hot spot type (below) |
| `daynight` | dn | day (D) / night (N) algorithm |

**`type` values:**
- `0` = presumed vegetation fire → **keep**
- `1` = active volcano
- `2` = other static land source: hot spots detected on **16 or more days in a calendar year**,
  or any detection in an **urban area** (MCD12Q1 land cover)
- `3` = offshore (always assigned to detections over water, e.g. gas flares)

Non-vegetation hot spots are **not** removed from MCD14ML / FIRMS. Filtering by `type`
is our job. The guide notes some static sources remain unflagged (fewer since version 3),
so `type == 0` is not a perfect filter.

**Confidence classes:** low `0 ≤ C < 30`, nominal `30 ≤ C < 80`, high `80 ≤ C ≤ 100`.
The guide: drop low confidence to reduce false alarms, keep all to maximize detection.
Project decision: keep all confidences (VIIRS uses categorical confidence, so a MODIS-only
threshold would add another difference between sensors). Note this in the Method page.

## Caveats that affect our method

1. **Short time bins are biased.** The guide warns that time series of fire pixel locations
   with intervals **shorter than about 8 days** can have severe temporal and spatial biases
   (orbit / overpass sampling). → Our product is **monthly**. Do not present daily or weekly
   counts as a fire activity time series.
2. **No information on clouds or missing data.** A missing detection is not proof of no fire
   (clouds, smoke, no overpass). → Counts are "detected activity", not "fires that happened".
   State this in the Method page.
3. **Pixel size grows off-nadir.** Nominal 1 km² at nadir, larger toward the swath edge.
   A large fire can produce several adjacent pixels. → One reason to count **cell-days**
   instead of raw detections.
4. **Detection limit:** routinely ~1000 m² fires; under very good conditions ~100 m²;
   understory fires under canopy are very unlikely to be detected.
   → Explains why VIIRS (375 m) sees many more small fires, especially in grassland and
   agricultural burning.
5. Burned area cannot be estimated reliably from fire pixel counts. → Never present our
   numbers as burned area.

## Data gaps and quality problems (flag in the calendar)

| Period | Problem | What to do |
|---|---|---|
| Terra, before **November 2000** | dead detectors: striping, missed small and large fires; Feb–Mar 2000 occasional whole scan lines flagged as fire | flag 2000 as low quality; consider starting the calendar at Nov 2000 or marking Jan–Oct 2000 |
| Terra, **September 2000** | instrument inoperable for an extended period | flag month |
| Aqua launch **4 May 2002** (Terra launch 18 Dec 1999) | before Aqua data start in 2002 MODIS = **Terra only** | see "Terra-only years" below |
| Aqua, **16 Aug – 2 Sep 2020** | FMU failure, only partial Direct Broadcast coverage | flag Aug and Sep 2020; consider excluding from calibration |

### Terra-only years (important)

The harmonization model is calibrated on 2012–2025, when MODIS = Terra + Aqua.
In 2000 – mid-2002 only Terra exists, so MODIS cell-days are lower for a reason unrelated
to fire activity. Applying the model directly would underestimate early years.

Suggested fix: compute the ratio of (Terra + Aqua) cell-days to Terra-only cell-days per
country (optionally per season) over a period with both satellites, and scale Terra-only
months by it before applying the model. Add the extra uncertainty to the interval.
Check exactly when Aqua detections begin in the data (first `Aqua` rows).

## Not relevant for this project

HDF Level 2/3 products (MOD14, MOD14A1/A2), CMG products, sinusoidal tile navigation,
LAADS / LP-DAAC / SFTP download, IDL example code, Collection 5 issues. We only use
FIRMS CSV hotspots.

Note: the guide says near-real-time (NRT) MODIS locations should not be used for long time
series; the standard (archive) product is preferred. FIRMS yearly country files are
standard data. Treat any NRT months as preliminary.
