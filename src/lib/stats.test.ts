import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midRankPercentile, monthStats, quantile } from './stats.ts';
import type { Harmonized } from './harmonize.ts';

/** Synthetic series from 2000-01; f(year, calMonth0) -> value. */
function series(
  lastYear: number,
  f: (y: number, m: number) => number,
  lowQ: string[] = [],
  lastMonth = 12,
  prelim: string[] = [],
): Harmonized {
  const n = (lastYear - 2000) * 12 + lastMonth;
  const value = new Float64Array(n);
  const lowQuality: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const y = 2000 + Math.floor(i / 12);
    const m = i % 12;
    value[i] = f(y, m);
    lowQuality.push(lowQ.includes(`${y}-${String(m + 1).padStart(2, '0')}`));
  }
  const z = new Float64Array(n);
  const no = new Array(n).fill(false);
  const preliminary = Array.from({ length: n }, (_, i) =>
    prelim.includes(`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`));
  return {
    firstMonth: '2000-01', value, lo: value, hi: value, modis: z, viirs: z,
    estimated: no, terraOnly: no, lowQuality, preliminary, area: false,
  };
}

test('reference years: 2025-12 uses 2015..2024', () => {
  // value = year for December, so the median of 2015..2024 is 2019.5
  const h = series(2025, (y, m) => (m === 11 ? y : 0));
  const s = monthStats(h, h.value.length - 1);
  assert.equal(s.month, '2025-12');
  assert.equal(s.refFrom, 2015);
  assert.equal(s.refTo, 2024);
  assert.equal(s.nRef, 10);
  assert.equal(s.median, 2019.5);
});

test('2026-10 (preliminary): reference 2016..2025, preliminary months only in their own stats', () => {
  const prelim = ['2026-08', '2026-09', '2026-10'];
  const h = series(2026, (y, m) => (m === 9 ? y : 0), [], 10, prelim);
  const s = monthStats(h, h.value.length - 1);
  assert.equal(s.month, '2026-10');
  assert.equal(s.refFrom, 2016);
  assert.equal(s.refTo, 2025);
  assert.equal(s.nRef, 10);
  assert.equal(s.median, 2020.5);
  assert.equal(s.nAll, 27); // 2000..2025 + the month itself
});

test('zero median: k keeps the ratio finite', () => {
  const h = series(2025, (y, m) => (y === 2025 && m === 11 ? 4 : 0));
  const s = monthStats(h, h.value.length - 1);
  assert.equal(s.median, 0);
  assert.equal(s.k, 0.5); // all medians 0 -> K_MIN
  assert.equal(s.ratio, (4 + 0.5) / 0.5);
});

test('k = 0.1 x mean of monthly medians', () => {
  const h = series(2025, (_y, m) => (m + 1) * 10); // medians 10..120, mean 65
  const s = monthStats(h, h.value.length - 1);
  assert.ok(Math.abs(s.k! - 6.5) < 1e-12);
  assert.ok(Math.abs(s.ratio! - 1) < 1e-12);
});

test('low-quality months are left out of the reference and percentile', () => {
  const h = series(2025, (y, m) => (m === 7 ? (y === 2020 ? 1000 : 10) : 0), ['2020-08']);
  const s = monthStats(h, h.value.length - 5); // 2025-08
  assert.equal(s.nRef, 9);
  assert.equal(s.p90, 10);
  assert.equal(s.nAll, 25);
});

test('ties in percentile use mid-rank', () => {
  assert.equal(midRankPercentile([1, 1, 1, 1], 1), 50);
  assert.equal(midRankPercentile([0, 1, 2, 3], 3), 87.5);
  const h = series(2025, () => 5);
  assert.equal(monthStats(h, h.value.length - 1).percentile, 50);
});

test('not enough history -> null anomaly', () => {
  const h = series(2004, () => 3); // 2004-06: reference 2000..2003 only (4 years)
  const s = monthStats(h, 4 * 12 + 5);
  assert.equal(s.nRef, 4);
  assert.equal(s.ratio, null);
  assert.equal(s.median, null);
  assert.equal(s.percentile, 50);
});

test('quantile interpolates like numpy', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.ok(Math.abs(quantile([0, 10], 0.1) - 1) < 1e-12);
});
