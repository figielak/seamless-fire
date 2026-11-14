// Harmonization in the browser: sum raw cell-days first, then apply the model.
// Port of pipeline/model.py:harmonized_monthly. Pure functions (no import.meta.env),
// so the same code runs in Node tests and later for custom areas (stage 5).

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
  last_data: Record<string, string>;
  coverage?: Record<string, [string, string]>; // satellite -> [first, last] date in the raw files
  hotspots?: boolean; // {CC}/hotspots/{year}.csv exist (not for AU, CA)
  hotspot_sensors?: Record<string, string[]>; // year -> satellites present in the hotspot files
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
  }
  return out;
}
