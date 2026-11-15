// Month-vs-history statistics for the "Now" panel (and later anomalies).
// Definitions (see .planning/DECISIONS.md):
// - reference period: the 10 complete calendar years before the month's year
//   (2025-12 -> 2015..2024); low-quality and preliminary months are left out
// - k = max(2, 0.1 * mean of the 12 calendar-month medians of that period and area)
// - anomaly = (x + k) / (median + k); historical spread = P10..P90 of the same month in the period
// - percentile: same calendar month in all years of the series (low-quality and preliminary
//   months left out, the month itself always included), ties as mid-rank
// - fewer than MIN_REF_YEARS reference values -> anomaly is null ("not enough history")
// - top anomalies rank estimated months by the lower end of their ~80% interval (see topAnomalies)

import { monthAbs, monthStr, type Harmonized } from './harmonize.ts';

export const REF_YEARS = 10;
export const MIN_REF_YEARS = 5;
export const K_FRACTION = 0.1;
export const K_MIN = 2; // user decision 2026-11-14: 0.5 let single cell-days dominate small-area rankings

export interface MonthStats {
  month: string;
  value: number;
  refFrom: number; // first reference year
  refTo: number; // last reference year
  nRef: number; // reference values for this calendar month
  median: number | null;
  k: number | null;
  ratio: number | null; // anomaly (x + k) / (median + k)
  p10: number | null; // historical spread of the same month (not model uncertainty)
  p90: number | null;
  percentile: number; // 0..100, mid-rank
  nAll: number;
}

/** Linear-interpolated quantile (numpy default); `sorted` must be ascending and non-empty. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/** Mid-rank percentile of x among values (values include x itself). */
export function midRankPercentile(values: number[], x: number): number {
  let less = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) less++;
    else if (v === x) equal++;
  }
  return ((less + 0.5 * equal) / values.length) * 100;
}

export function monthStats(h: Harmonized, idx: number): MonthStats {
  const first = monthAbs(h.firstMonth);
  const abs = first + idx;
  const year = Math.floor(abs / 12);
  const cal = abs % 12;
  const refFrom = year - REF_YEARS;
  const refTo = year - 1;
  const usable = (i: number) => !h.lowQuality[i] && !h.preliminary[i];

  // Reference values per calendar month.
  const byCal: number[][] = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < h.value.length; i++) {
    const a = first + i;
    const y = Math.floor(a / 12);
    if (y < refFrom || y > refTo || !usable(i)) continue;
    byCal[a % 12].push(h.value[i]);
  }
  const ref = byCal[cal];
  const x = h.value[idx];

  let med: number | null = null;
  let k: number | null = null;
  let ratio: number | null = null;
  let p10: number | null = null;
  let p90: number | null = null;
  if (ref.length >= MIN_REF_YEARS) {
    const sorted = [...ref].sort((a, b) => a - b);
    med = quantile(sorted, 0.5);
    p10 = quantile(sorted, 0.1);
    p90 = quantile(sorted, 0.9);
    const medians = byCal.filter((v) => v.length > 0).map(median);
    const meanMed = medians.reduce((s, v) => s + v, 0) / medians.length;
    k = Math.max(K_MIN, K_FRACTION * meanMed);
    ratio = (x + k) / (med + k);
  }

  const all: number[] = [];
  for (let i = cal - (first % 12); i < h.value.length; i += 12) {
    if (i < 0) continue;
    if (i === idx || usable(i)) all.push(h.value[i]);
  }

  return {
    month: monthStr(abs),
    value: x,
    refFrom,
    refTo,
    nRef: ref.length,
    median: med,
    k,
    ratio,
    p10,
    p90,
    percentile: midRankPercentile(all, x),
    nAll: all.length,
  };
}

export interface Anomaly extends MonthStats {
  idx: number;
  estimated: boolean;
  lowQuality: boolean;
  preliminary: boolean;
  // Ranking key: the anomaly the ~80% interval supports. Observed months: = ratio.
  // Estimated months (before VIIRS): (lo + k) / (median + k), the lower end of the interval.
  rankRatio: number;
}

/**
 * Months in [fromIdx, toIdx] with the highest supported anomaly (`rankRatio`). Statistics always
 * use the full history (the range only limits which months are ranked). Months without enough
 * history skip. Estimated months rank by the lower end of their interval (user decision
 * 2026-11-15): in small areas the country share of a quiet country month can inflate a few MODIS
 * cell-days (Biebrza March 2001: 10 MODIS cell-days -> 54), and a reference median of 0 then
 * outranks real observed events (Biebrza April 2020).
 */
export function topAnomalies(h: Harmonized, fromIdx = 0, toIdx = h.value.length - 1, n = 10): Anomaly[] {
  const out: Anomaly[] = [];
  for (let i = Math.max(fromIdx, 0); i <= Math.min(toIdx, h.value.length - 1); i++) {
    if (h.partial?.[i]) continue; // month to date: not comparable with full months
    const s = monthStats(h, i);
    if (s.ratio === null) continue;
    const est = h.estimated[i];
    const rankRatio = est ? (h.lo[i] + s.k!) / (s.median! + s.k!) : s.ratio;
    out.push({ ...s, idx: i, estimated: est, lowQuality: h.lowQuality[i], preliminary: h.preliminary[i], rankRatio });
  }
  out.sort((a, b) => b.rankRatio - a.rankRatio || b.value - a.value);
  return out.slice(0, n);
}
