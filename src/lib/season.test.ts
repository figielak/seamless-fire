// "This season" curves (season.ts).
// Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Harmonized } from './harmonize.ts';
import { seasonData, seasonYears } from './season.ts';

/** Series Jan 2012 .. lastMonth (index), value = f(year, cal). */
function series(lastYear: number, lastCal: number, f: (y: number, c: number) => number, partial = false): Harmonized {
  const n = (lastYear - 2012) * 12 + lastCal + 1;
  const value = new Float64Array(n);
  for (let i = 0; i < n; i++) value[i] = f(2012 + Math.floor(i / 12), i % 12);
  const no = new Array(n).fill(false);
  const part = no.map((_, i) => partial && i === n - 1);
  return {
    firstMonth: '2012-01', value, lo: value, hi: value, modis: value, viirs: value,
    estimated: no, terraOnly: no, lowQuality: no, preliminary: no, partial: part, area: false,
  };
}

test('complete last month: curves at month ends, current year stops at the last month', () => {
  const h = series(2026, 9, (y) => y - 2011); // 2026 Jan..Oct, 15 per month
  const years = seasonYears(h, '2012-02');
  assert.deepEqual(years, [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  const s = seasonData(h, years, null);
  assert.equal(s.x.length, 13);
  assert.equal(s.x[10], 304); // end of October
  assert.equal(s.current.length, 11);
  assert.equal(s.current[10], 150);
  assert.equal(s.history[0].y[12], 12); // 2012: 1 per month
  assert.equal(s.last!.x, 304);
  assert.equal(s.last!.median, 7.5 * 10); // median of 1..14 per month × 10 months
  assert.equal(s.last!.percentile, ((14 + 0.5) / 15) * 100);
});

test('month to date: extra point at day D, earlier years exact there', () => {
  const h = series(2026, 10, (y, c) => (y === 2026 && c === 10 ? 7 : 1), true); // Nov 2026 so far = 7
  const hist = new Map([[2024, 3], [2025, 5]]);
  const s = seasonData(h, [2024, 2025], { day: 13, hist });
  assert.equal(s.x.length, 14);
  assert.equal(s.x[11], 304 + 13);
  assert.equal(s.x[12], 334);
  assert.equal(s.current.length, 12);
  assert.equal(s.current[11], 10 + 7); // Jan..Oct + 1-13 Nov
  assert.equal(s.history[0].y[11], 10 + 3);
  assert.equal(s.history[1].y[11], 10 + 5);
  assert.equal(s.history[1].y[12], 11); // full November of 2025
  assert.equal(s.last!.median, 14);
  assert.equal(s.last!.ratio, 17 / 14);
});
