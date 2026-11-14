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

/** {CC}/recurrence/meta.json (pipeline write_recurrence). */
export interface RecurrenceMeta {
  cell_deg: number;
  first_month: string; // "YYYY-MM", first month counted
  last_month: string;
  excluded: string[]; // months left out (S-NPP outage)
  months: number; // all months counted
  years: number[]; // per calendar month (0 = Jan): years counted
  min_years: number; // cells with fewer years with fire are not in the month files
  year_round_rule: { min_share: number; min_cal_months: number };
  // Year-round fire (likely industrial): grid indices, share of all counted months, calendar months.
  year_round: { lat: number[]; lon: number[]; share: number[]; cal: number[] };
}

/** {CC}/recurrence/mNN.json: years with >= 1 S-NPP vegetation detection per 0.01° cell. */
export interface RecurrenceMonth {
  lat: number[]; // grid indices, cell = [lat * cell_deg, (lat + 1) * cell_deg)
  lon: number[];
  n: number[];
}

export interface RecurrenceLayer extends CellLayer {
  years: number; // years counted (denominator)
  firstYear: number;
  lastYear: number;
}

/**
 * Recurrence of one calendar month (0 = Jan): per 0.01° cell, the percentage of years with at least
 * one S-NPP vegetation detection in that month. Full VIIRS record (not limited by the date range).
 */
export function recurrenceLayer(meta: RecurrenceMeta, data: RecurrenceMonth, calMonth: number): RecurrenceLayer {
  const years = meta.years[calMonth] ?? 0;
  const size = years ? data.n.length : 0;
  const [fy, fm] = meta.first_month.split('-').map(Number);
  const [ly, lm] = meta.last_month.split('-').map(Number);
  const out: RecurrenceLayer = {
    lat: new Int32Array(size),
    lon: new Int32Array(size),
    value: new Float64Array(size),
    cellDeg: meta.cell_deg,
    max: 0,
    total: 0,
    estimatedMonths: 0,
    months: years,
    years,
    firstYear: calMonth + 1 >= fm ? fy : fy + 1,
    lastYear: calMonth + 1 <= lm ? ly : ly - 1,
  };
  for (let j = 0; j < size; j++) {
    const v = (100 * Math.min(data.n[j], years)) / years;
    out.lat[j] = data.lat[j];
    out.lon[j] = data.lon[j];
    out.value[j] = v;
    out.max = Math.max(out.max, v);
    out.total += v;
  }
  return out;
}

export interface YearRoundCell {
  lat: number; // cell centre, degrees
  lon: number;
  share: number; // share of all counted months with fire
  cal: number; // calendar months with fire
}

/** Year-round fire cells of meta.json as cell centres. */
export function yearRoundCells(meta: RecurrenceMeta): YearRoundCell[] {
  const d = meta.cell_deg;
  const y = meta.year_round;
  return y.lat.map((la, i) => ({ lat: (la + 0.5) * d, lon: (y.lon[i] + 0.5) * d, share: y.share[i], cal: y.cal[i] }));
}
