// Live period and month-to-date statistics (live.ts) on the real data.
// Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harmonize, monthAbs, monthCount, monthlyTotals, type Cells, type Model } from './harmonize.ts';
import {
  addDays, applyLive, comparedDays, daysInMonth, mtdStats, sameDaysHistory, seriesEnd, type Daily, type Live,
} from './live.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf-8'));

for (const code of ['PL', 'AU']) {
  test(`${code}: live cell-days are added on the S-NPP scale after the last complete month`, () => {
    const cells: Cells = read(`public/data/${code}/cells.json`);
    const model: Model = read(`public/data/${code}/model.json`);
    const live: Live = read(`public/data/${code}/live.json`);
    const { cells: c2, model: m2 } = applyLive(cells, model, live);
    const info = m2.live!;
    assert.equal(seriesEnd(m2), live.last.slice(0, 7));
    assert.equal(info.throughDay, Number(live.last.slice(8)));
    assert.ok(m2.preliminary!.includes(info.lastMonth));
    // base cells unchanged, live rows appended
    assert.equal(cells.m.length + (c2.m.length - cells.m.length), c2.m.length);
    const n = monthCount(c2.first_month, seriesEnd(m2));
    const s = monthlyTotals(c2, n);
    const last = n - 1;
    const expected = live.day.filter((d) => addDays(live.first, d).startsWith(info.lastMonth)).length * model.n20_factor;
    assert.ok(Math.abs(s.viirs[last] - expected) < 1e-9, `${s.viirs[last]} vs ${expected}`);
    // months up to last_complete_month are unchanged
    const s0 = monthlyTotals(cells, monthCount(cells.first_month, model.last_complete_month));
    for (let i = 0; i < s0.viirs.length; i++) assert.equal(s.viirs[i], s0.viirs[i]);
    const h = harmonize(s, m2);
    assert.equal(h.partial[last], info.partialMonth !== null);
    assert.equal(h.partial.filter(Boolean).length, info.partialMonth ? 1 : 0);
    assert.equal(h.estimated[last], false);
  });
}

test('no live data or no complete live day: inputs unchanged', () => {
  const cells: Cells = read('public/data/PL/cells.json');
  const model: Model = read('public/data/PL/model.json');
  assert.equal(applyLive(cells, model, null).cells, cells);
  const empty: Live = { sensor: 'N20', first: '2026-11-01', last: '2026-10-31', gaps: [], cell_deg: 0.1, lat: [], lon: [], day: [], det: [] };
  assert.equal(applyLive(cells, model, empty).model, model);
  assert.equal(seriesEnd(model), model.last_complete_month);
});

test('daily history over all days equals the monthly VIIRS of cells.json (PL, October)', () => {
  const cells: Cells = read('public/data/PL/cells.json');
  const daily: Daily = read('public/data/PL/daily/m10.json');
  const all = new Set(Array.from({ length: 31 }, (_, i) => i + 1));
  const hist = sameDaysHistory(daily, all, cells.cell_deg);
  const first = monthAbs(cells.first_month);
  for (const [y, v] of hist) {
    const m = monthAbs(`${y}-10`) - first;
    let sum = 0;
    for (let i = 0; i < cells.m.length; i++) if (cells.m[i] === m) sum += cells.viirs[i];
    assert.equal(v, sum, `October ${y}`);
  }
  // an area filter only keeps cells inside
  const none = sameDaysHistory(daily, all, cells.cell_deg, () => false);
  assert.equal(none.size, 0);
});

test('compared days leave out live gaps; month-to-date stats use 2016-2025 and skip flagged months', () => {
  const model: Model = read('public/data/PL/model.json');
  const info = {
    sensor: 'N20', first: '2026-11-01', last: '2026-11-13', gaps: ['2026-11-05'], factor: 0.9,
    lastMonth: '2026-11', partialMonth: '2026-11', throughDay: 13,
  };
  const days = comparedDays(info);
  assert.equal(days.size, 12);
  assert.ok(!days.has(5) && days.has(13) && !days.has(14));
  const hist = new Map<number, number>();
  for (let y = 2012; y <= 2025; y++) hist.set(y, y - 2011); // 1..14
  const s = mtdStats(20, hist, info, model, days.size, 4);
  assert.equal(s.refFrom, 2016);
  assert.equal(s.nRef, 10); // 2016..2025, November has no sensor problem
  assert.equal(s.median, 9.5); // values 5..14
  assert.equal(s.k, (4 * 12) / 30);
  assert.equal(s.nAll, 15); // 2012..2025 + this year
  assert.equal(s.percentile, ((14 + 0.5) / 15) * 100);
  // a month with a sensor problem in 2022 (S-NPP outage in July) drops that year
  const july = { ...info, lastMonth: '2026-07', partialMonth: '2026-07' };
  assert.equal(mtdStats(20, hist, july, model, 13, null).nAll, 14);
  assert.equal(daysInMonth('2028-02'), 29);
});
