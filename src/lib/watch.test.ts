// Places to watch (watch.ts). Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecurrenceMeta, RecurrenceMonth } from './cellmap.ts';
import { factorWord, localWeather, monthWeights, seasonWeights, watchPlaces, type ForecastPoint } from './watch.ts';

const close = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const meta: RecurrenceMeta = {
  cell_deg: 0.01, first_month: '2012-02', last_month: '2026-10', excluded: [], months: 176,
  years: [14, 15, 15, 15, 15, 15, 14, 14, 15, 15, 14, 14], min_years: 2,
  year_round_rule: { min_share: 0.1, min_cal_months: 9 },
  year_round: { lat: [5058], lon: [2205], share: [0.8], cal: [12] },
};

test('local weather: exact at a point, blended between points (factors in log space)', () => {
  const pts: ForecastPoint[] = [
    { lat: 50, lon: 20, factor: [2, 2], fwi: [10, 10] },
    { lat: 50, lon: 22, factor: [0.5, 0.5], fwi: [2, 2] },
  ];
  assert.deepEqual(localWeather(pts, 50, 20)!.factor, [2, 2]);
  const mid = localWeather(pts, 50, 21)!;
  close(mid.factor[0], 1, 1e-9, 'geometric mean halfway');
  close(mid.fwi[0], 6, 1e-9, 'fwi linear');
  assert.equal(localWeather([], 50, 21), null);
});

test('month weights of a window across a month end', () => {
  const w = monthWeights(['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
  close(w.get(10)!, 3 / 7, 1e-12, 'Nov');
  close(w.get(11)!, 4 / 7, 1e-12, 'Dec');
  const sw = seasonWeights(['2026-11-14', '2026-11-15']);
  assert.deepEqual([...sw.keys()].sort((a, b) => a - b), [9, 10, 11]);
  close(sw.get(10)!, 0.5, 1e-12, 'Nov full weight');
  close(sw.get(9)!, 0.25, 1e-12, 'Oct half weight');
  const across = seasonWeights(['2026-12-30', '2026-12-31', '2027-01-01']);
  close([...across.values()].reduce((a, b) => a + b, 0), 1, 1e-12, 'sums to 1');
  assert.ok(across.has(10) && across.has(1), 'Nov and Feb as neighbours');
});

test('places: industrial cells out, area filter, weather reorders the ranking', () => {
  const nov: RecurrenceMonth = { lat: [5058, 5000, 5100, 4000], lon: [2205, 2000, 2200, 2000], n: [14, 10, 8, 14] };
  const keep = (lat: number, lon: number) => lat > 49.9 && lat < 51.1 && lon > 19.9 && lon < 22.1;
  const w = monthWeights(['2026-11-14']);
  const noWx = watchPlaces(meta, [{ cal: 10, data: nov }], w, keep, null);
  assert.equal(noWx.length, 2, 'industrial and outside cells left out');
  assert.deepEqual(noWx.map((p) => p.byMonth[0].years), [10, 8]);
  close(noWx[0].recurrence, 10 / 14, 1e-12, 'recurrence');
  assert.equal(noWx[0].factor, null);
  // dry near the second cell, wet near the first: the order flips
  const pts: ForecastPoint[] = [
    { lat: 50.005, lon: 20.005, factor: [0.3], fwi: [1] },
    { lat: 51.005, lon: 22.005, factor: [2.0], fwi: [20] },
  ];
  const withWx = watchPlaces(meta, [{ cal: 10, data: nov }], w, keep, pts);
  assert.deepEqual(withWx.map((p) => p.byMonth[0].years), [8, 10]);
  close(withWx[0].score, (8 / 14) * 2.0, 1e-9, 'score');
});

test('neighbouring cells of one place are listed once', () => {
  const m: RecurrenceMonth = { lat: [5000, 5001, 5050], lon: [2000, 2001, 2000], n: [10, 9, 5] };
  const p = watchPlaces(meta, [{ cal: 10, data: m }], monthWeights(['2026-11-14']), null, null);
  assert.deepEqual(p.map((x) => x.byMonth[0].years), [10, 5]);
});

test('factor words', () => {
  assert.match(factorWord(0.3), /much less/);
  assert.match(factorWord(1.0), /close to usual/);
  assert.match(factorWord(1.8), /much more/);
});
