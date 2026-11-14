// "All countries" view: every country is harmonized with its own model first, then the
// results are summed (never one model over pooled raw counts). Pure functions.

import { annualTotals, type Harmonized, type Model, type YearTotal } from './harmonize.ts';
import { seriesEnd } from './live.ts';
import type { CellLayer } from './cellmap.ts';

export const WORLD_CODE = 'ALL';

export interface Part {
  h: Harmonized; // country or area series of one country
  model: Model;
}

/** Month-by-month sum of country series. The interval is the sum of the country bounds
 * (conservative: errors of different countries are treated as fully correlated). */
export function sumSeries(parts: Harmonized[]): Harmonized {
  if (!parts.length) throw new Error('no series to sum');
  const n = parts[0].value.length;
  for (const p of parts) {
    if (p.value.length !== n || p.firstMonth !== parts[0].firstMonth) throw new Error('series differ in range');
  }
  const add = (key: 'value' | 'lo' | 'hi' | 'modis' | 'viirs') => {
    const out = new Float64Array(n);
    for (const p of parts) for (let i = 0; i < n; i++) out[i] += p[key][i];
    return out;
  };
  const any = (key: 'estimated' | 'terraOnly' | 'lowQuality' | 'preliminary' | 'partial') =>
    Array.from({ length: n }, (_, i) => parts.some((p) => p[key][i]));
  const out: Harmonized = {
    firstMonth: parts[0].firstMonth,
    value: add('value'),
    lo: add('lo'),
    hi: add('hi'),
    modis: add('modis'),
    viirs: add('viirs'),
    estimated: any('estimated'),
    terraOnly: any('terraOnly'),
    lowQuality: any('lowQuality'),
    preliminary: any('preliminary'),
    partial: any('partial'),
    area: parts.some((p) => p.area),
  };
  if (parts.every((p) => p.viirsDet)) {
    const det = new Float64Array(n);
    for (const p of parts) for (let i = 0; i < n; i++) det[i] += p.viirsDet![i];
    out.viirsDet = det;
  }
  return out;
}

/** Annual totals per country (each with its own interval rule), then summed by year. */
export function sumAnnual(parts: Part[], fromIdx: number, toIdx: number): YearTotal[] {
  const byYear = new Map<number, YearTotal>();
  for (const { h, model } of parts) {
    for (const t of annualTotals(h, model, fromIdx, toIdx)) {
      const acc = byYear.get(t.year);
      if (!acc) byYear.set(t.year, { ...t });
      else {
        acc.value += t.value;
        acc.lo += t.lo;
        acc.hi += t.hi;
        acc.estimated &&= t.estimated;
      }
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** Model-like metadata for the summed series (flags and coverage only; no parameters). */
export function worldModel(models: Model[]): Model {
  const base = models[0];
  const union = (f: (m: Model) => string[] | undefined) => [...new Set(models.flatMap((m) => f(m) ?? []))].sort();
  const coverage: Record<string, [string, string]> = {};
  for (const m of models) {
    for (const [sat, [a, b]] of Object.entries(m.coverage ?? {})) {
      const c = coverage[sat];
      coverage[sat] = c ? [a < c[0] ? a : c[0], b > c[1] ? b : c[1]] : [a, b];
    }
  }
  const firsts = new Set(models.map((m) => m.viirs_first_month));
  const lasts = new Set(models.map((m) => `${m.last_complete_month}/${seriesEnd(m)}`));
  if (firsts.size !== 1 || lasts.size !== 1) throw new Error('countries differ in VIIRS start or data end');
  return {
    ...base,
    model: 'per country',
    low_quality: union((m) => m.low_quality),
    preliminary: union((m) => m.preliminary),
    coverage,
    hotspots: false,
    hotspot_sensors: {},
  };
}

/** Cells of several countries in one layer (country grids do not overlap in practice;
 * a shared border cell simply appears twice and is drawn twice). */
export function mergeLayers(layers: CellLayer[]): CellLayer {
  const size = layers.reduce((s, l) => s + l.value.length, 0);
  const out: CellLayer = {
    lat: new Int32Array(size),
    lon: new Int32Array(size),
    value: new Float64Array(size),
    cellDeg: layers[0]?.cellDeg ?? 0.1,
    max: 0,
    total: 0,
    estimatedMonths: layers[0]?.estimatedMonths ?? 0,
    months: layers[0]?.months ?? 0,
  };
  let o = 0;
  for (const l of layers) {
    out.lat.set(l.lat, o);
    out.lon.set(l.lon, o);
    out.value.set(l.value, o);
    o += l.value.length;
    out.max = Math.max(out.max, l.max);
    out.total += l.total;
  }
  return out;
}

/** Bounding box of all countries [W, S, E, N]. */
export function unionBBox(boxes: [number, number, number, number][]): [number, number, number, number] {
  return [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
}
