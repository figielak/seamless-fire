// "All countries": sums of per-country results. Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annualTotals, harmonize, monthCount, monthlyTotals, type Cells, type Model } from './harmonize.ts';
import { cellLayer } from './cellmap.ts';
import { mergeLayers, sumAnnual, sumSeries, unionBBox, worldModel } from './world.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf-8'));
const countries: { code: string; bbox: [number, number, number, number] }[] = read('public/data/countries.json');

const parts = countries.map(({ code }) => {
  const cells: Cells = read(`public/data/${code}/cells.json`);
  const model: Model = read(`public/data/${code}/model.json`);
  const n = monthCount(cells.first_month, model.last_complete_month);
  return { code, cells, model, n, h: harmonize(monthlyTotals(cells, n), model) };
});

test('world series = month-by-month sum of country series, flags united', () => {
  const w = sumSeries(parts.map((p) => p.h));
  const n = parts[0].n;
  for (const i of [0, 30, 145, n - 1]) {
    const want = parts.reduce((s, p) => s + p.h.value[i], 0);
    assert.ok(Math.abs(w.value[i] - want) < 1e-6 * Math.max(1, want), `${i}`);
    assert.ok(w.lo[i] <= w.value[i] && w.value[i] <= w.hi[i]);
  }
  assert.equal(w.preliminary[n - 1], true);
  assert.equal(w.estimated[0], true);
  assert.ok(w.viirsDet);
});

test('world annual = sum of country annual totals (value and interval)', () => {
  const n = parts[0].n;
  const w = sumAnnual(parts.map((p) => ({ h: p.h, model: p.model })), 0, n - 1);
  const pl = annualTotals(parts[0].h, parts[0].model, 0, n - 1);
  assert.equal(w.length, pl.length);
  const y2005 = w.find((t) => t.year === 2005)!;
  const sum = (k: 'value' | 'lo' | 'hi') =>
    parts.reduce((s, p) => s + annualTotals(p.h, p.model, 0, n - 1).find((t) => t.year === 2005)![k], 0);
  for (const k of ['value', 'lo', 'hi'] as const) assert.ok(Math.abs(y2005[k] - sum(k)) < 1e-6 * sum(k), k);
  assert.equal(y2005.estimated, true);
  assert.equal(w.at(-1)!.partial, true); // 2026 ends in October
});

test('world model unites flags and coverage, no hotspot export', () => {
  const m = worldModel(parts.map((p) => p.model));
  assert.equal(m.hotspots, false);
  assert.ok(m.preliminary!.includes('2026-10'));
  assert.equal(m.viirs_first_month, '2012-02');
  assert.ok(m.coverage!.Terra[0] <= '2000-11-01');
});

test('merged layer keeps every country cell and total', () => {
  const n = parts[0].n;
  const layers = parts.map((p) => cellLayer(p.cells, p.h, n - 1, n - 1));
  const m = mergeLayers(layers);
  assert.equal(m.value.length, layers.reduce((s, l) => s + l.value.length, 0));
  assert.ok(Math.abs(m.total - layers.reduce((s, l) => s + l.total, 0)) < 1e-6);
  const bb = unionBBox(countries.map((c) => c.bbox));
  assert.ok(bb[0] < -100 && bb[2] > 150 && bb[1] < -40 && bb[3] > 60);
});
