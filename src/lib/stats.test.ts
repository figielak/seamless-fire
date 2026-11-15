import { test } from 'node:test';
import assert from 'node:assert/strict';
import { K_MIN, detStats, midRankPercentile, monthStats, quantile, rankMonths, typicalPerCellDay } from './stats.ts';
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
    estimated: no, terraOnly: no, lowQuality, preliminary, partial: no, area: false,
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
  assert.equal(s.k, K_MIN); // all medians 0 -> K_MIN
  assert.equal(s.ratio, (4 + K_MIN) / K_MIN);
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

/** Observed series 2012-01..2025-12 with detections: August has 50 cell-days, 2 detections each. */
function detSeries(event?: { year: number; cd: number; det: number }): Harmonized {
  const h = series(2025, (y, m) => (y < 2012 ? 0 : m === 7 ? 50 : m === 0 ? 1 : 5));
  const n = h.value.length;
  const det = new Float64Array(n);
  const est: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const y = 2000 + Math.floor(i / 12);
    est.push(y < 2012);
    if (event && y === event.year && i % 12 === 7) h.value[i] = event.cd;
    det[i] = 2 * h.value[i];
    if (event && y === event.year && i % 12 === 7) det[i] = event.det;
  }
  return { ...h, viirs: h.value, viirsDet: det, estimated: est, lo: h.value, hi: h.value };
}

test('large fire: few cell-days, many detections is flagged; a normal month is not', () => {
  const h = detSeries({ year: 2024, cd: 50, det: 1500 });
  assert.equal(typicalPerCellDay(h), 2);
  const idx = (2024 - 2000) * 12 + 7;
  const ds = detStats(h, idx)!;
  assert.equal(ds.perCellDay, 30);
  assert.ok(ds.index! > 5);
  assert.equal(ds.large, true);
  // cell-day anomaly index of the same month is typical (1.0): only detections see it
  assert.equal(monthStats(h, idx).ratio, 1);
  assert.equal(detStats(h, idx - 12)!.large, false);
  // estimated months have no detection statistics
  assert.equal(detStats(h, 5 * 12 + 7), null);
});

test('large fire needs enough detections and a high ratio', () => {
  // many detections but proportional to cell-days (wide-spread burning): not a large-fire month
  const wide = detSeries({ year: 2024, cd: 750, det: 1500 });
  assert.equal(detStats(wide, (2024 - 2000) * 12 + 7)!.large, false);
});

test('rankMonths: modes sort by their key; detections skip estimated months', () => {
  const h = detSeries({ year: 2024, cd: 50, det: 1500 });
  // January is 1 cell-day (typical 1) -> make one January a big relative jump
  const jan = (2023 - 2000) * 12;
  h.value[jan] = 12; h.viirsDet![jan] = 24;
  const from = (2018 - 2000) * 12; // synthetic zeros before 2012 inflate 2012..2017
  const byIndex = rankMonths(h, 'index', from);
  assert.equal(byIndex[0].month, '2023-01');
  const byDet = rankMonths(h, 'detections');
  assert.equal(byDet[0].month, '2024-08');
  assert.ok(byDet.every((r) => !r.estimated));
  const byExcess = rankMonths(h, 'excess', from);
  assert.equal(byExcess[0].month, '2023-01'); // +11 over typical 1; August 2024 is +0
  for (const l of [byIndex, byDet, byExcess]) for (let i = 1; i < l.length; i++) assert.ok(l[i - 1].key >= l[i].key);
});
