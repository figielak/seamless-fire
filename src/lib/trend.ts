// Trends of fire activity: Theil–Sen slope with the Mann–Kendall test. Pure functions, tested in
// trend.test.ts.
//
// Values are log(1 + cell-days), so the slope is a relative change per year (%/yr = e^slope - 1).
// Theil–Sen = median of all pairwise slopes: robust to single extreme years (one disastrous season
// does not make a trend). Mann–Kendall: is the series monotonic beyond chance (two-sided p, normal
// approximation with tie correction). Years are independent samples; serial correlation is ignored
// (annual fire totals have little of it, but p is approximate).

import { annualTotals, monthAbs, type Harmonized, type Model } from './harmonize.ts';

export const MIN_YEARS = 8;
export const ALPHA = 0.05;
const Z95 = 1.959964;

export interface Trend {
  n: number;
  from: number; // first year
  to: number; // last year
  slope: number; // per year, in log(1 + x)
  pctPerYear: number; // (e^slope - 1) * 100
  lo: number; // 95% interval of pctPerYear (Sen)
  hi: number;
  intercept: number; // log(1 + x) at year 0 (fit line: intercept + slope * year)
  s: number; // Mann–Kendall S
  z: number;
  p: number; // two-sided
  significant: boolean; // p < ALPHA
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 for erf, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Trend of y over years x (same length). Null when fewer than MIN_YEARS points. */
export function theilSen(x: number[], y: number[]): Trend | null {
  const n = x.length;
  if (n < MIN_YEARS || y.length !== n) return null;
  const ly = y.map((v) => Math.log1p(Math.max(v, 0)));
  const slopes: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (x[j] !== x[i]) slopes.push((ly[j] - ly[i]) / (x[j] - x[i]));
      s += Math.sign(ly[j] - ly[i]) * Math.sign(x[j] - x[i]);
    }
  }
  slopes.sort((a, b) => a - b);
  const med = (v: number[]) => {
    const a = [...v].sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const slope = med(slopes);
  const intercept = med(ly.map((v, i) => v - slope * x[i]));

  // variance of S with ties in y
  const counts = new Map<number, number>();
  for (const v of ly) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tie = 0;
  for (const t of counts.values()) tie += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tie) / 18;
  const z = varS > 0 ? (s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0) : 0;
  const p = z === 0 ? 1 : Math.min(1, 2 * (1 - normCdf(Math.abs(z))));

  // Sen's 95% interval: ranks (N ∓ C) / 2 of the sorted slopes, C = z * sqrt(var S)
  const N = slopes.length;
  const c = Z95 * Math.sqrt(Math.max(varS, 0));
  const k1 = Math.max(0, Math.min(N - 1, Math.round((N - c) / 2) - 1));
  const k2 = Math.max(0, Math.min(N - 1, Math.round((N + c) / 2)));
  const pct = (b: number) => Math.expm1(b) * 100;
  return {
    n, from: x[0], to: x[n - 1], slope, pctPerYear: pct(slope), lo: pct(slopes[k1]), hi: pct(slopes[k2]),
    intercept, s, z, p, significant: p < ALPHA,
  };
}

/**
 * Complete years in [fromIdx, toIdx] usable for a trend: 12 months in range and in the data, not
 * month to date, fewer than 3 months with known sensor problems (drops 2000, early Terra).
 */
export function trendYears(h: Harmonized, fromIdx: number, toIdx: number): Set<number> {
  const first = monthAbs(h.firstMonth);
  const months = new Map<number, { n: number; bad: number; partial: boolean }>();
  for (let i = Math.max(fromIdx, 0); i <= Math.min(toIdx, h.value.length - 1); i++) {
    const y = Math.floor((first + i) / 12);
    const m = months.get(y) ?? { n: 0, bad: 0, partial: false };
    m.n++;
    if (h.lowQuality[i]) m.bad++;
    if (h.partial[i]) m.partial = true;
    months.set(y, m);
  }
  const out = new Set<number>();
  for (const [y, m] of months) if (m.n === 12 && m.bad < 3 && !m.partial) out.add(y);
  return out;
}

export interface Trends {
  all: Trend | null; // all usable years (2001 on with the full period)
  viirs: Trend | null; // observed VIIRS years only (first full VIIRS year on)
  byMonth: (Trend | null)[]; // per calendar month, all usable years
  years: number[];
}

/** Annual and per-calendar-month trends of the selected period. */
export function trends(h: Harmonized, model: Model, fromIdx: number, toIdx: number): Trends {
  const years = [...trendYears(h, fromIdx, toIdx)].sort((a, b) => a - b);
  const set = new Set(years);
  const tot = annualTotals(h, model, fromIdx, toIdx).filter((t) => set.has(t.year));
  const vFirst = monthAbs(model.viirs_first_month);
  const vYear = Math.floor(vFirst / 12) + (vFirst % 12 === 0 ? 0 : 1); // first full VIIRS year
  const obs = tot.filter((t) => t.year >= vYear);
  const first = monthAbs(h.firstMonth);
  const byMonth = Array.from({ length: 12 }, (_, c) => {
    const xs: number[] = [], ys: number[] = [];
    for (const y of years) {
      const i = y * 12 + c - first;
      if (i >= 0 && i < h.value.length && !h.lowQuality[i]) { xs.push(y); ys.push(h.value[i]); }
    }
    return theilSen(xs, ys);
  });
  return {
    all: theilSen(tot.map((t) => t.year), tot.map((t) => t.value)),
    viirs: theilSen(obs.map((t) => t.year), obs.map((t) => t.value)),
    byMonth,
    years,
  };
}
