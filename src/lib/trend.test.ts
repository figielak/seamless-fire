// Trends (trend.ts). Reference numbers from an independent brute-force Python implementation.
// Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harmonize, monthCount, monthlyTotals, type Cells, type Model } from './harmonize.ts';
import { MIN_YEARS, normCdf, theilSen, trendYears, trends } from './trend.ts';

const close = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('Theil–Sen and Mann–Kendall match the Python reference', () => {
  const x = Array.from({ length: 14 }, (_, i) => 2001 + i);
  const y = [120, 95, 130, 80, 140, 70, 60, 90, 55, 65, 40, 58, 35, 30];
  const t = theilSen(x, y)!;
  close(t.slope, -0.09669809424116645, 1e-12, 'slope');
  close(t.pctPerYear, -9.216995611730587, 1e-9, '%/yr');
  assert.equal(t.s, -65);
  close(t.z, -3.503672969288697, 1e-9, 'z');
  close(t.p, 0.00045888852872688624, 1e-6, 'p');
  close(t.intercept, 198.263867023496, 1e-6, 'intercept');
  assert.ok(t.significant);
  assert.ok(t.lo <= t.pctPerYear && t.pctPerYear <= t.hi, 'interval contains the slope');
});

test('exact exponential growth, flat series, too few years', () => {
  const x = Array.from({ length: 10 }, (_, i) => 2010 + i);
  const g = theilSen(x, x.map((v) => Math.expm1(2 + 0.1 * (v - 2010))))!;
  close(g.pctPerYear, (Math.exp(0.1) - 1) * 100, 1e-9, 'growth');
  assert.ok(g.p < 0.001);
  const f = theilSen(x, x.map(() => 5))!;
  assert.equal(f.slope, 0);
  assert.equal(f.s, 0);
  assert.equal(f.p, 1);
  assert.equal(f.significant, false);
  assert.equal(theilSen(x.slice(0, MIN_YEARS - 1), x.slice(0, MIN_YEARS - 1)), null);
  close(normCdf(1.959964), 0.975, 1e-6, 'normCdf');
});

test('PL: usable years drop 2000 (early Terra) and partial years; VIIRS trend starts in 2013', () => {
  const read = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8'));
  const cells: Cells = read('public/data/PL/cells.json');
  const model: Model = read('public/data/PL/model.json');
  const n = monthCount(cells.first_month, model.last_complete_month);
  const h = harmonize(monthlyTotals(cells, n), model);
  const years = trendYears(h, 0, n - 1);
  assert.ok(!years.has(2000));
  assert.ok(years.has(2001) && years.has(2025));
  assert.ok(!years.has(2026)); // Jan–Oct only
  const t = trends(h, model, 0, n - 1);
  assert.equal(t.all!.from, 2001);
  assert.equal(t.all!.to, 2025);
  assert.equal(t.viirs!.from, 2013);
  assert.equal(t.byMonth.length, 12);
  // a period of 5 years has no trend
  assert.equal(trends(h, model, n - 12 * 6, n - 1).all, null);
});
