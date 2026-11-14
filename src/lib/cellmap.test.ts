// Map layer: per-cell shares must add up to the area and country values.
// Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harmonize, harmonizeArea, monthAbs, monthCount, monthlyTotals, type Cells, type Model } from './harmonize.ts';
import { PRESETS, keepFn, presetShape } from './geo.ts';
import {
  cellLayer, cellLookup, recurrenceLayer, yearRoundCells, type RecurrenceMeta, type RecurrenceMonth,
} from './cellmap.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf-8'));

function load(code: string) {
  const cells: Cells = read(`public/data/${code}/cells.json`);
  const model: Model = read(`public/data/${code}/model.json`);
  const n = monthCount(cells.first_month, model.last_complete_month);
  const h = harmonize(monthlyTotals(cells, n), model);
  return { cells, model, n, h };
}

const sum = (a: ArrayLike<number>, from = 0, to = a.length - 1) => {
  let s = 0;
  for (let i = from; i <= to; i++) s += a[i];
  return s;
};
const close = (a: number, b: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

for (const code of ['PL', 'PT']) {
  test(`${code}: cells of every preset sum to the area series (full period and single months)`, () => {
    const { cells, model, n, h } = load(code);
    for (const p of PRESETS.filter((x) => x.country === code)) {
      const keep = keepFn(presetShape(p));
      const area = harmonizeArea(monthlyTotals(cells, n, keep), h, model);
      const sumInside = (from: number, to: number) => {
        const layer = cellLayer(cells, h, from, to);
        let s = 0;
        for (let j = 0; j < layer.value.length; j++) {
          if (keep((layer.lat[j] + 0.5) * layer.cellDeg, (layer.lon[j] + 0.5) * layer.cellDeg)) s += layer.value[j];
        }
        return s;
      };
      close(sumInside(0, n - 1), sum(area.value), `${p.id} full`);
      for (const ym of ['2003-08', '2011-04', '2020-04', '2026-10']) {
        const i = monthAbs(ym) - monthAbs(cells.first_month);
        close(sumInside(i, i), area.value[i], `${p.id} ${ym}`);
      }
    }
  });

  test(`${code}: country cells sum to the calendar, except estimated months without MODIS`, () => {
    const { cells, n, h } = load(code);
    const layer = cellLayer(cells, h, 0, n - 1);
    let want = 0;
    for (let i = 0; i < n; i++) if (!(h.estimated[i] && h.modis[i] === 0)) want += h.value[i];
    close(layer.total, want, code);
    assert.equal(layer.months, n);
    assert.equal(layer.estimatedMonths, monthAbs('2012-02') - monthAbs('2000-01'));
  });
}

test('lookup finds the cell by coordinates, including negative ones', () => {
  const cells: Cells = {
    first_month: '2000-01', cell_deg: 0.1,
    lat: [500, -335, -335], lon: [200, -707, -707], m: [0, 0, 1], modis: [0, 0, 0], viirs: [3, 2, 5],
  };
  const h = {
    firstMonth: '2000-01', value: new Float64Array(2), lo: new Float64Array(2), hi: new Float64Array(2),
    modis: new Float64Array(2), viirs: new Float64Array(2), estimated: [false, false], terraOnly: [false, false],
    lowQuality: [false, false], preliminary: [false, false], partial: [false, false], area: false,
  };
  const layer = cellLayer(cells, h, 0, 1);
  assert.equal(layer.value.length, 2);
  const at = cellLookup(layer);
  assert.equal(at(50.05, 20.05), 3);
  assert.equal(at(-33.45, -70.65), 7);
  assert.equal(at(10, 10), 0);
  assert.equal(cellLayer(cells, h, 1, 1).total, 5);
});

test('recurrence files (PL) match the hotspot files: years with S-NPP fire per 0.01° cell and month', () => {
  const meta: RecurrenceMeta = read('public/data/PL/recurrence/meta.json');
  const bad = new Set(meta.excluded);
  const years = new Map<string, Set<number>>();
  const months = new Map<string, Set<string>>();
  for (let y = 2012; y <= Number(meta.last_month.slice(0, 4)); y++) {
    const text = readFileSync(new URL(`public/data/PL/hotspots/${y}.csv`, ROOT), 'utf-8');
    for (const line of text.split('\n').slice(1)) {
      if (!line) continue;
      const [date, , lat, lon, sensor] = line.split(',');
      const ym = date.slice(0, 7);
      if (sensor !== 'SNPP' || ym < meta.first_month || ym > meta.last_month || bad.has(ym)) continue;
      // hotspot coordinates are rounded to 5 decimals; the pipeline floors the raw value
      const cell = `${Math.floor(Number(lat) / meta.cell_deg + 1e-9)},${Math.floor(Number(lon) / meta.cell_deg + 1e-9)}`;
      const key = `${cell},${Number(date.slice(5, 7)) - 1}`;
      if (!years.has(key)) years.set(key, new Set());
      years.get(key)!.add(y);
      if (!months.has(cell)) months.set(cell, new Set());
      months.get(cell)!.add(ym);
    }
  }
  let rows = 0;
  let mismatch = 0;
  for (let mo = 0; mo < 12; mo++) {
    const data: RecurrenceMonth = read(`public/data/PL/recurrence/m${String(mo + 1).padStart(2, '0')}.json`);
    rows += data.n.length;
    for (let i = 0; i < data.n.length; i++) {
      assert.ok(data.n[i] >= meta.min_years);
      if (years.get(`${data.lat[i]},${data.lon[i]},${mo}`)?.size !== data.n[i]) mismatch++;
    }
  }
  const expected = [...years.values()].filter((v) => v.size >= meta.min_years).length;
  assert.ok(Math.abs(rows - expected) <= rows * 0.005, `${rows} vs ${expected}`);
  assert.ok(mismatch <= rows * 0.005, `mismatch ${mismatch}`);
  assert.equal(meta.years[3], 15); // Aprils 2012–2026
  assert.equal(meta.years[7], 14); // Augusts: 2022 left out (S-NPP outage)
  // Year-round cells: share of all counted months and calendar months match the hotspots.
  const yr = yearRoundCells(meta);
  assert.ok(yr.length > 10);
  for (let i = 0; i < meta.year_round.lat.length; i++) {
    const ms = months.get(`${meta.year_round.lat[i]},${meta.year_round.lon[i]}`)!;
    assert.ok(Math.abs(ms.size / meta.months - meta.year_round.share[i]) <= 0.01, 'share');
    assert.ok(meta.year_round.share[i] >= meta.year_round_rule.min_share);
    assert.ok(meta.year_round.cal[i] >= meta.year_round_rule.min_cal_months);
  }
  // Stalowa Wola industrial zone (50.555°N 22.055°E) is flagged.
  assert.ok(yr.some((c) => Math.abs(c.lat - 50.555) < 1e-6 && Math.abs(c.lon - 22.055) < 1e-6));
  const april = recurrenceLayer(meta, read('public/data/PL/recurrence/m04.json'), 3);
  assert.equal(april.firstYear, 2012);
  assert.equal(april.lastYear, 2026);
  for (const v of april.value) assert.ok(v > 0 && v <= 100);
  const jan = recurrenceLayer(meta, { lat: [], lon: [], n: [] }, 0);
  assert.equal(jan.firstYear, 2013); // Jan 2012 is before the first full month
  assert.equal(recurrenceLayer(meta, { lat: [], lon: [], n: [] }, 11).lastYear, 2025);
});
