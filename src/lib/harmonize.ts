// Harmonization in the browser: sum raw cell-days first, then apply the model.
// Port of pipeline/model.py:harmonized_monthly (country) and pipeline/area.py:area_series
// (custom area). Pure functions (no import.meta.env), so the same code runs in Node tests.

import type { LiveInfo } from './live.ts';

export interface Cells {
  first_month: string; // "YYYY-MM", month index 0
  cell_deg: number; // grid step in degrees
  lat: number[]; // grid indices, cell center = (lat + 0.5) * cell_deg
  lon: number[];
  m: number[]; // month index since first_month
  modis: number[]; // MODIS (Terra + Aqua) cell-days
  viirs: number[]; // VIIRS cell-days on the S-NPP scale
  viirs_det?: number[]; // raw S-NPP detections (type 0); absent = no data, not zero
}

export interface TerraOnly {
  until: string; // last month without Aqua data
  ratio: number[]; // per season (DJF, MAM, JJA, SON)
  seasonal: boolean;
  sigma: number;
}

export interface Model {
  model: string;
  a: number[];
  b: number;
  sigma: number;
  sigma_annual: number;
  interval_z: number;
  n20_factor: number;
  terra_only: TerraOnly;
  viirs_first_month: string;
  low_quality: string[];
  preliminary?: string[]; // months with near real-time data
  last_complete_month: string;
  live?: LiveInfo; // near real-time period after last_complete_month (added in the browser, live.ts)
  last_data: Record<string, string>;
  coverage?: Record<string, [string, string]>; // satellite -> [first, last] date in the raw files
  hotspots?: boolean; // {CC}/hotspots/{year}.csv exist (not for AU, CA)
  hotspot_sensors?: Record<string, string[]>; // year -> satellites present in the hotspot files
  area: {
    h_month: number; // log1p half-width of the ~80% interval for custom areas (monthly)
    h_annual: number; // the same for annual sums
    [key: string]: unknown;
  };
  annual: {
    years: number[];
    harmonized: number[];
    lo: number[];
    hi: number[];
    partial_year?: boolean[]; // same length as years; true = year not complete in the data
  };
  [key: string]: unknown;
}

export interface Series {
  firstMonth: string;
  modis: Float64Array;
  viirs: Float64Array;
  viirsDet?: Float64Array; // undefined when cells.json has no detection column
}

export interface Harmonized {
  firstMonth: string;
  value: Float64Array;
  lo: Float64Array;
  hi: Float64Array;
  modis: Float64Array;
  viirs: Float64Array;
  viirsDet?: Float64Array; // raw S-NPP detections, shown as is (not harmonized)
  estimated: boolean[];
  terraOnly: boolean[];
  lowQuality: boolean[];
  preliminary: boolean[];
  partial: boolean[]; // month to date (the current live month is not complete yet)
  area: boolean; // custom area (country share before VIIRS), not the whole country
  raw?: boolean; // naive splice (raw MODIS, then raw VIIRS), for display only
}

// Calendar month (1..12) -> season index: DJF=0, MAM=1, JJA=2, SON=3
const SEASON_OF_MONTH = [-1, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];

/** "YYYY-MM" -> absolute month number (year * 12 + month - 1). */
export function monthAbs(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

/** Absolute month number -> "YYYY-MM". */
export function monthStr(abs: number): string {
  const y = Math.floor(abs / 12);
  const m = (abs % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Number of months from `first` to `last` inclusive. */
export function monthCount(first: string, last: string): number {
  return monthAbs(last) - monthAbs(first) + 1;
}

/**
 * Monthly totals of raw cell-days. `keep` gets the cell center in degrees (lat, lon).
 * The length is always `nMonths`, also for an area with no records.
 */
export function monthlyTotals(
  cells: Cells,
  nMonths: number,
  keep?: (lat: number, lon: number) => boolean,
): Series {
  const modis = new Float64Array(nMonths);
  const viirs = new Float64Array(nMonths);
  const det = cells.viirs_det;
  const viirsDet = det ? new Float64Array(nMonths) : undefined;
  const d = cells.cell_deg;
  for (let i = 0; i < cells.m.length; i++) {
    const mi = cells.m[i];
    if (mi < 0 || mi >= nMonths) continue;
    if (keep && !keep((cells.lat[i] + 0.5) * d, (cells.lon[i] + 0.5) * d)) continue;
    modis[mi] += cells.modis[i];
    viirs[mi] += cells.viirs[i];
    if (viirsDet) viirsDet[mi] += det![i];
  }
  return viirsDet
    ? { firstMonth: cells.first_month, modis, viirs, viirsDet }
    : { firstMonth: cells.first_month, modis, viirs };
}

/** Harmonized monthly series on the VIIRS S-NPP scale with ~80% interval for estimated months. */
export function harmonize(s: Series, model: Model): Harmonized {
  const n = s.modis.length;
  const first = monthAbs(s.firstMonth);
  const terraUntil = monthAbs(model.terra_only.until);
  const viirsFirst = monthAbs(model.viirs_first_month);
  const lowQ = new Set(model.low_quality);
  const prelim = new Set(model.preliminary ?? []);
  const partialMonth = model.live?.partialMonth ?? null;
  const kModel = Math.exp(model.interval_z * model.sigma);
  const sTerra = Math.hypot(model.sigma, model.b * model.terra_only.sigma);
  const kTerra = Math.exp(model.interval_z * sTerra);

  const out: Harmonized = {
    firstMonth: s.firstMonth,
    value: new Float64Array(n),
    lo: new Float64Array(n),
    hi: new Float64Array(n),
    modis: s.modis,
    viirs: s.viirs,
    ...(s.viirsDet ? { viirsDet: s.viirsDet } : {}),
    estimated: new Array(n),
    terraOnly: new Array(n),
    lowQuality: new Array(n),
    preliminary: new Array(n),
    partial: new Array(n),
    area: false,
  };
  for (let i = 0; i < n; i++) {
    const abs = first + i;
    const season = SEASON_OF_MONTH[(abs % 12) + 1];
    const terra = abs <= terraUntil;
    const estimated = abs < viirsFirst;
    let v: number;
    let k = 1;
    if (estimated) {
      const m = terra ? model.terra_only.ratio[season] * s.modis[i] : s.modis[i];
      v = Math.max(Math.expm1(model.a[season] + model.b * Math.log1p(m)), 0);
      k = terra ? kTerra : kModel;
    } else {
      v = s.viirs[i];
    }
    const ym = monthStr(abs);
    out.value[i] = v;
    out.lo[i] = v / k;
    out.hi[i] = v * k;
    out.estimated[i] = estimated;
    out.terraOnly[i] = terra;
    out.lowQuality[i] = lowQ.has(ym);
    out.preliminary[i] = prelim.has(ym);
    out.partial[i] = ym === partialMonth;
  }
  return out;
}

/**
 * Custom area: estimated months = country share (country value × area MODIS / country MODIS,
 * 0 when the country has no MODIS), observed months = the area's VIIRS. Interval in log1p
 * space with the half-width from the block validation (model.area), so 0 keeps an upper bound.
 */
export function harmonizeArea(area: Series, country: Harmonized, model: Model): Harmonized {
  const n = country.value.length;
  if (area.modis.length !== n) throw new Error('area and country series differ in length');
  const h = model.area.h_month;
  const hTerra = Math.hypot(h, model.interval_z * model.b * model.terra_only.sigma);
  const out: Harmonized = {
    ...country,
    value: new Float64Array(n),
    lo: new Float64Array(n),
    hi: new Float64Array(n),
    modis: area.modis,
    viirs: area.viirs,
    viirsDet: area.viirsDet,
    area: true,
  };
  if (!area.viirsDet) delete out.viirsDet;
  for (let i = 0; i < n; i++) {
    if (country.estimated[i]) {
      const mc = country.modis[i];
      const v = mc > 0 ? (country.value[i] * area.modis[i]) / mc : 0;
      const hw = country.terraOnly[i] ? hTerra : h;
      out.value[i] = v;
      out.lo[i] = Math.max(Math.expm1(Math.log1p(v) - hw), 0);
      out.hi[i] = Math.expm1(Math.log1p(v) + hw);
    } else {
      out.value[i] = out.lo[i] = out.hi[i] = area.viirs[i];
    }
  }
  return out;
}

/**
 * Naive splice for the raw/harmonized toggle: raw MODIS cell-days before the first VIIRS month,
 * raw VIIRS after. No model and no interval, so the 2012 sensor jump stays visible.
 */
export function rawSplice(h: Harmonized, model: Model): Harmonized {
  const n = h.value.length;
  const first = monthAbs(h.firstMonth);
  const viirsFirst = monthAbs(model.viirs_first_month);
  const value = new Float64Array(n);
  for (let i = 0; i < n; i++) value[i] = first + i < viirsFirst ? h.modis[i] : h.viirs[i];
  return { ...h, value, lo: value, hi: value, estimated: new Array(n).fill(false), raw: true };
}

/** VIIRS / MODIS raw cell-day ratio over months where both sensors have data (null = no MODIS). */
export function rawRatio(h: Harmonized, model: Model): number | null {
  const first = monthAbs(h.firstMonth);
  const viirsFirst = monthAbs(model.viirs_first_month);
  const modisLast = coverageSpan(model, ['Terra', 'Aqua'])?.[1] ?? Infinity;
  let m = 0, v = 0;
  for (let i = 0; i < h.value.length; i++) {
    const a = first + i;
    if (a < viirsFirst || a > modisLast || h.lowQuality[i] || h.preliminary[i]) continue;
    m += h.modis[i];
    v += h.viirs[i];
  }
  return m > 0 ? v / m : null;
}

export interface YearTotal {
  year: number;
  value: number;
  lo: number;
  hi: number;
  estimated: boolean; // every month of the year (in range) estimated
  months: number; // months in the range
  partial: boolean; // fewer than 12 months (data coverage or the selected range)
}

/**
 * Annual sums over months [fromIdx, toIdx]. Port of model.py:annual_series: a fully estimated
 * year gets the annual interval (country: sigma_annual, area: h_annual in log1p space);
 * a mixed year (2012) = observed sum + monthly intervals of its estimated months.
 */
export function annualTotals(h: Harmonized, model: Model, fromIdx = 0, toIdx = h.value.length - 1): YearTotal[] {
  const first = monthAbs(h.firstMonth);
  const z = model.interval_z;
  const terraS = model.b * model.terra_only.sigma;
  const out: YearTotal[] = [];
  let cur: (YearTotal & { obs: number; estLo: number; estHi: number; terra: boolean }) | null = null;
  const flush = () => {
    if (!cur) return;
    if (cur.estimated) {
      if (h.area) {
        const hw = cur.terra ? Math.hypot(model.area.h_annual, z * terraS) : model.area.h_annual;
        cur.lo = Math.max(Math.expm1(Math.log1p(cur.value) - hw), 0);
        cur.hi = Math.expm1(Math.log1p(cur.value) + hw);
      } else {
        const k = Math.exp(z * (cur.terra ? Math.hypot(model.sigma_annual, terraS) : model.sigma_annual));
        cur.lo = cur.value / k;
        cur.hi = cur.value * k;
      }
    } else {
      cur.lo = cur.obs + cur.estLo;
      cur.hi = cur.obs + cur.estHi;
    }
    const { year, value, lo, hi, estimated, months } = cur;
    out.push({ year, value, lo, hi, estimated, months, partial: months < 12 });
  };
  for (let i = Math.max(fromIdx, 0); i <= Math.min(toIdx, h.value.length - 1); i++) {
    const year = Math.floor((first + i) / 12);
    if (!cur || cur.year !== year) {
      flush();
      cur = { year, value: 0, lo: 0, hi: 0, estimated: true, months: 0, partial: false, obs: 0, estLo: 0, estHi: 0, terra: false };
    }
    const v = h.value[i];
    cur.value += v;
    cur.months++;
    cur.terra ||= h.terraOnly[i];
    if (h.estimated[i]) {
      cur.estLo += h.lo[i];
      cur.estHi += h.hi[i];
    } else {
      cur.estimated = false;
      cur.obs += v;
    }
  }
  flush();
  return out;
}

/** First and last month (absolute) of the raw files of the given satellites; null = unknown. */
export function coverageSpan(model: Model, sats: string[]): [number, number] | null {
  const cov = model.coverage ?? {};
  const c = sats.map((s) => cov[s]).filter(Boolean);
  if (!c.length) return null;
  return [
    Math.min(...c.map((x) => monthAbs(x[0].slice(0, 7)))),
    Math.max(...c.map((x) => monthAbs(x[1].slice(0, 7)))),
  ];
}
