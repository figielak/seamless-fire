// Map layer: each 0.1° cell's share of the harmonized total, for one month or a period.
// Same rule as harmonizeArea (stage 5), applied per cell, so the cells of any area sum to
// the area's calendar value:
//   estimated month (before VIIRS): country value × cell MODIS / country MODIS (0 if no MODIS)
//   observed month: the cell's own VIIRS cell-days
// Pure functions (no DOM), tested in cellmap.test.ts.

import type { Cells, Harmonized } from './harmonize.ts';

export interface CellLayer {
  lat: Int32Array; // grid indices, cell = [lat * deg, (lat + 1) * deg)
  lon: Int32Array;
  value: Float64Array; // cell-days on the VIIRS S-NPP scale
  cellDeg: number;
  max: number;
  total: number;
  estimatedMonths: number; // months of the range that are estimated from MODIS
  months: number;
}

export function cellLayer(cells: Cells, country: Harmonized, fromIdx: number, toIdx: number): CellLayer {
  // Factor per month: estimated -> value / MODIS of the country (MODIS units), observed -> NaN (use VIIRS).
  const n = country.value.length;
  const lo = Math.max(0, fromIdx);
  const hi = Math.min(n - 1, toIdx);
  const factor = new Float64Array(n).fill(NaN);
  let estimatedMonths = 0;
  for (let i = lo; i <= hi; i++) {
    if (!country.estimated[i]) continue;
    estimatedMonths++;
    factor[i] = country.modis[i] > 0 ? country.value[i] / country.modis[i] : 0;
  }

  const acc = new Map<number, number>();
  for (let i = 0; i < cells.m.length; i++) {
    const m = cells.m[i];
    if (m < lo || m > hi) continue;
    const f = factor[m];
    const v = Number.isNaN(f) ? cells.viirs[i] : f * cells.modis[i];
    if (v <= 0) continue;
    // Key from grid indices (|lat| < 900, |lon| < 1800 for a 0.1° grid).
    const key = (cells.lat[i] + 10_000) * 100_000 + (cells.lon[i] + 50_000);
    acc.set(key, (acc.get(key) ?? 0) + v);
  }

  const size = acc.size;
  const out: CellLayer = {
    lat: new Int32Array(size),
    lon: new Int32Array(size),
    value: new Float64Array(size),
    cellDeg: cells.cell_deg,
    max: 0,
    total: 0,
    estimatedMonths,
    months: hi - lo + 1,
  };
  let j = 0;
  for (const [key, v] of acc) {
    out.lat[j] = Math.floor(key / 100_000) - 10_000;
    out.lon[j] = (key % 100_000) - 50_000;
    out.value[j] = v;
    out.max = Math.max(out.max, v);
    out.total += v;
    j++;
  }
  return out;
}

/** Value of the cell that contains (lat, lon), or 0. Index built once per layer. */
export function cellLookup(layer: CellLayer): (lat: number, lon: number) => number {
  const idx = new Map<number, number>();
  for (let j = 0; j < layer.value.length; j++) {
    idx.set((layer.lat[j] + 10_000) * 100_000 + (layer.lon[j] + 50_000), layer.value[j]);
  }
  const d = layer.cellDeg;
  return (lat, lon) => {
    const li = Math.floor(lat / d + 1e-9);
    const lj = Math.floor(lon / d + 1e-9);
    return idx.get((li + 10_000) * 100_000 + (lj + 50_000)) ?? 0;
  };
}
