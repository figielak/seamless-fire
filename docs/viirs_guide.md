# VIIRS: notes for Seamless Fire

Source: *Collection 2 VIIRS Burned Area Product User's Guide* v1.1 (Giglio et al., April 2024).

**Warning: this guide describes the VNP64A1 burned area product, not the VIIRS active fire
(hotspot) product used in this project.** FIRMS VIIRS hotspots come from the
375 m active fire product (VNP14IMG for S-NPP, VJ114IMG for NOAA-20). Most of this guide
(HDF layers, burn date, GeoTIFF and shapefile subsets, ENVI/ArcGIS) does not apply.
For field definitions of VIIRS hotspots, use the *VIIRS 375 m Active Fire Product
User's Guide* and the FIRMS attribute documentation.

## What is useful from this guide

1. **S-NPP VIIRS outage: 27 July – 10 August 2022.** The burned area guide says July and
   especially August 2022 monthly products are degraded because of it. The outage concerns
   the S-NPP instrument, so S-NPP hotspots for those dates are also missing or incomplete.
   → Flag July and August 2022 in the calendar.
   → Exclude them from calibration or fill them from NOAA-20 × factor.
   → Verify in the data: daily S-NPP detection counts around those dates.
2. **Cropland burning is hard to map reliably** (low confidence in the burned area product).
   Not directly about hotspots, but relevant context: agricultural burning dominates
   spring fires in Poland and Ukraine and consists of small fires. → Supports the finding
   that the VIIRS/MODIS ratio depends on season and fire type.
3. **Multi-sensor continuity is an official goal.** The VIIRS burned area algorithm was built
   on the MODIS algorithm "with an emphasis on data consistency and continuity", to extend the
   23-year MODIS record. → Useful framing for the presentation: NASA itself treats MODIS → VIIRS
   continuity as a key problem.
4. The burned area product uses 750 m S-NPP bands and 750 m S-NPP active fire observations,
   while FIRMS hotspots use the 375 m I-band product. Do not mix these resolutions in the text.

## VIIRS facts used in the project (not from this guide, verify against FIRMS docs)

- Sensors: S-NPP (2012 – 2 Nov 2026), NOAA-20 (from 2018), NOAA-21 (from 2023).
  Target scale of the project = S-NPP; after 2 Nov 2026 NOAA-20 × factor.
- FIRMS VIIRS columns are similar to MODIS, with `bright_ti4` / `bright_ti5` instead of
  `brightness` / `bright_t31`, and **categorical `confidence`** (`l`, `n`, `h`) instead of 0–100.
- `type` has the same meaning as for MODIS (0 vegetation, 1 volcano, 2 static land source,
  3 offshore). In PL ~73% of VIIRS detections are `type == 2`.
- `satellite` values in FIRMS: verify in the actual files (expected `N` for S-NPP and
  `N20` or `1` for NOAA-20).
- Near-real-time (NRT) files may lack the `type` column; treat NRT months as preliminary.

## Not relevant for this project

VNP64A1 HDF layers (Burn Date, uncertainty, QA bits), sinusoidal tiles and coordinate
conversion, CMG product, SFTP download, ENVI and ArcGIS instructions, burned area validation
against Landsat.
