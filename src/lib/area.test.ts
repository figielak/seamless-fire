// Custom areas, annual sums, anomalies and CSV export vs the Python reference.
// Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  annualTotals,
  harmonize,
  harmonizeArea,
  monthAbs,
  monthCount,
  monthlyTotals,
  rawRatio,
  rawSplice,
  type Cells,
  type Model,
} from './harmonize.ts';
import {
  AreaError,
  PRESETS,
  keepFn,
  normalizeRect,
  normalizeRing,
  parseHash,
  presetShape,
  resolveShape,
  serializeHash,
} from './geo.ts';
import { topAnomalies } from './stats.ts';
import { exportHotspots, filterHotspots, hotspotFiles, hotspotYears, monthlyCsv } from './csv.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf-8'));
const countries: { code: string; bbox: number[] }[] = read('public/data/countries.json');

function load(code: string) {
  const cells: Cells = read(`public/data/${code}/cells.json`);
  const model: Model = read(`public/data/${code}/model.json`);
  const n = monthCount(cells.first_month, model.last_complete_month);
  const h = harmonize(monthlyTotals(cells, n), model);
  return { cells, model, n, h };
}

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ------------------------------------------------------------------ geometry and hash

test('rectangle edges inclusive, polygon ray casting', () => {
  const r = keepFn({ kind: 'rect', bbox: [0, 0, 2, 2] });
  assert.deepEqual([r(1, 0), r(2, 2), r(1, 2.01)], [true, true, false]);
  const p = keepFn({ kind: 'polygon', ring: [[0, 0], [2, 0], [2, 2], [0, 2]] });
  assert.deepEqual([p(1, 1), p(1, 3), p(2.5, 1), p(1, -0.5)], [true, false, false, false]);
});

test('invalid areas', () => {
  assert.deepEqual(normalizeRect([23, 54, 22, 53]), [22, 53, 23, 54]); // swapped bounds fixed
  assert.throws(() => normalizeRect([1, 1, 1, 2]), AreaError);
  assert.throws(() => normalizeRect([1, NaN, 2, 3]), AreaError);
  assert.throws(() => normalizeRing([[0, 0], [1, 1], [0, 0]]), AreaError); // 2 distinct points
  assert.equal(normalizeRing([[0, 0], [1, 0], [1, 1], [0, 0]]).length, 3); // closing point dropped
});

test('hash round trip and bad hashes', () => {
  const states = [
    { code: 'PL', area: { kind: 'country' as const } },
    { code: 'PL', area: { kind: 'preset' as const, id: 'biebrza' }, from: '2019-01', to: '2020-12' },
    { code: 'PT', area: { kind: 'shape' as const, shape: { kind: 'rect' as const, bbox: [-9, 37, -8, 38] as [number, number, number, number] } } },
    { code: 'ES', area: { kind: 'shape' as const, shape: { kind: 'polygon' as const, ring: [[-3, 40], [-2, 40], [-2.5, 41]] as [number, number][] } } },
    { code: 'PT', area: { kind: 'country' as const }, view: 'raw' as const },
  ];
  for (const s of states) assert.deepEqual(parseHash(serializeHash(s)), s);
  const bad = parseHash('#pl&area=p:1,2;3,4&from=2020-13');
  assert.equal(bad.code, 'PL');
  assert.equal(bad.area.kind, 'country');
  assert.equal(bad.from, undefined);
  assert.match(bad.error!, /at least 3/);
  assert.match(parseHash('#PL&area=preset:nope').error!, /Unknown preset/);
  assert.match(parseHash('#PL&area=x:1').error!, /Unknown area/);
  assert.match(parseHash('#PL&v=odd').error!, /Unknown view/);
  const swapped = parseHash('#PL&from=2021-05&to=2020-01');
  assert.deepEqual([swapped.from, swapped.to], ['2020-01', '2021-05']);
});

test('presets are valid and inside their country', () => {
  for (const p of PRESETS) {
    const c = countries.find((x) => x.code === p.country);
    assert.ok(c, p.id);
    const s = presetShape(p);
    if (s.kind === 'polygon') normalizeRing(s.ring);
    else normalizeRect(s.bbox);
    const keep = keepFn(s);
    const [w, so, e, n] = c!.bbox;
    // at least one cell center of the country bbox is inside the preset
    let hit = false;
    for (let lat = Math.floor(so * 10) / 10 + 0.05; lat < n && !hit; lat += 0.1)
      for (let lon = Math.floor(w * 10) / 10 + 0.05; lon < e && !hit; lon += 0.1) hit = keep(lat, lon);
    assert.ok(hit, p.id);
  }
});

// ------------------------------------------------------------------ custom area series

for (const p of PRESETS) {
  test(`${p.country} ${p.id}: area series matches Python`, () => {
    const { cells, model, n, h } = load(p.country);
    const fx = read(`src/lib/fixtures/${p.country}.json`).areas[p.id];
    const a = harmonizeArea(monthlyTotals(cells, n, keepFn(resolveShape({ kind: 'preset', id: p.id })!)), h, model);
    assert.equal(a.value.length, fx.value.length);
    for (let i = 0; i < n; i++) {
      assert.ok(close(a.value[i], fx.value[i]), `value ${i}: ${a.value[i]} vs ${fx.value[i]}`);
      assert.ok(close(a.lo[i], fx.lo[i]), `lo ${i}`);
      assert.ok(close(a.hi[i], fx.hi[i]), `hi ${i}`);
    }
    assert.ok(a.area);
  });
}

for (const { code } of countries) {
  test(`${code}: area = whole country gives the country series where country MODIS > 0`, () => {
    const { cells, model, n, h } = load(code);
    const a = harmonizeArea(monthlyTotals(cells, n, () => true), h, model);
    let zeroMonths = 0;
    for (let i = 0; i < n; i++) {
      if (h.estimated[i] && h.modis[i] === 0) {
        assert.equal(a.value[i], 0); // documented exception: share rule gives 0
        assert.ok(a.hi[i] > 0); // but the interval keeps an upper bound
        zeroMonths++;
      } else assert.ok(close(a.value[i], h.value[i]), `${code} ${i}`);
    }
    if (code === 'PL') assert.ok(zeroMonths > 0); // e.g. 2001-12
  });

  test(`${code}: annual totals match model.annual`, () => {
    const { model, h } = load(code);
    const t = annualTotals(h, model);
    const an = model.annual;
    assert.deepEqual(t.map((x) => x.year), an.years);
    t.forEach((x, i) => {
      for (const [k, ref] of [['value', an.harmonized[i]], ['lo', an.lo[i]], ['hi', an.hi[i]]] as const)
        assert.ok(Math.abs(x[k] - ref) <= 0.051, `${code} ${x.year} ${k}: ${x[k]} vs ${ref}`);
      assert.equal(x.partial, an.partial_year![i]);
    });
    const y2012 = t.find((x) => x.year === 2012)!;
    assert.ok(y2012.lo < y2012.value && y2012.hi > y2012.value); // mixed year has an interval
  });
}

test('annual totals: range cut marks partial years; area interval for an empty area', () => {
  const { cells, model, n, h } = load('PL');
  const from = monthAbs('2005-04') - monthAbs(h.firstMonth);
  const to = monthAbs('2006-12') - monthAbs(h.firstMonth);
  const t = annualTotals(h, model, from, to);
  assert.deepEqual(t.map((x) => [x.year, x.months, x.partial]), [[2005, 9, true], [2006, 12, false]]);
  const empty = harmonizeArea(monthlyTotals(cells, n, () => false), h, model);
  const te = annualTotals(empty, model);
  const y2005 = te.find((x) => x.year === 2005)!;
  assert.equal(y2005.value, 0);
  assert.equal(y2005.lo, 0);
  assert.ok(close(y2005.hi, Math.expm1(model.area.h_annual)));
});

test('raw splice: MODIS before VIIRS, VIIRS after, no intervals; ratio > 1', () => {
  const { model, h } = load('PL');
  const r = rawSplice(h, model);
  const sw = monthAbs(model.viirs_first_month) - monthAbs(h.firstMonth);
  assert.equal(r.value[sw - 1], h.modis[sw - 1]);
  assert.equal(r.value[sw], h.viirs[sw]);
  assert.ok(r.raw && r.estimated.every((e) => !e));
  assert.ok(annualTotals(r, model).every((x) => x.lo === x.value && x.hi === x.value));
  assert.ok(h.estimated[0] && !h.raw); // input untouched
  const ratio = rawRatio(h, model)!;
  assert.ok(ratio > 2 && ratio < 6, `PL VIIRS/MODIS ${ratio}`);
});

// ------------------------------------------------------------------ anomalies

test('top anomalies: sorted, inside the range, statistics from full history', () => {
  const { h } = load('PL');
  const all = topAnomalies(h);
  assert.equal(all.length, 10);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].rankRatio >= all[i].rankRatio);
  for (const a of all) {
    if (a.estimated) assert.ok(a.rankRatio <= a.ratio! + 1e-12); // lower end of the interval
    else assert.equal(a.rankRatio, a.ratio);
  }
  const from = monthAbs('2020-01') - monthAbs(h.firstMonth);
  const to = monthAbs('2020-12') - monthAbs(h.firstMonth);
  const y2020 = topAnomalies(h, from, to, 3);
  assert.ok(y2020.every((a) => a.month.startsWith('2020')));
  const full = topAnomalies(h, 0, h.value.length - 1, 1000).find((a) => a.month === y2020[0].month)!;
  assert.equal(full.ratio, y2020[0].ratio); // range does not change the statistic
});

test('top anomalies: Biebrza April 2020 (largest month there in raw MODIS) ranks first', () => {
  const { cells, model, n, h } = load('PL');
  const a = harmonizeArea(monthlyTotals(cells, n, keepFn(resolveShape({ kind: 'preset', id: 'biebrza' })!)), h, model);
  assert.equal(topAnomalies(a)[0].month, '2020-04');
});

// ------------------------------------------------------------------ CSV

test('monthly CSV: empty cells outside sensor coverage', () => {
  const { model, h } = load('PL');
  const lines = monthlyCsv(h, model).trim().split('\n');
  assert.equal(lines.length, h.value.length + 1);
  const row = (ym: string) => lines.find((l) => l.startsWith(ym))!.split(',');
  assert.equal(row('2005-06')[6], ''); // no VIIRS before 2012
  assert.equal(row('2005-06')[7], '');
  assert.equal(row('2026-09')[5], ''); // no MODIS files for 2026
  assert.notEqual(row('2015-06')[5], '');
  assert.equal(row('2015-06')[4], '0');
});

test('hotspot filter and export', async () => {
  const csv = [
    'date,time,lat,lon,sensor,frp',
    '2020-03-31,0100,53.5,22.8,SNPP,1',
    '2020-04-10,0100,53.5,22.8,SNPP,2',
    '2020-04-10,0100,50.0,20.0,SNPP,3',
    '2020-05-01,0100,53.5,22.8,N20,4',
    '',
  ].join('\n');
  const keep = keepFn({ kind: 'rect', bbox: [22, 53, 23, 54] });
  assert.deepEqual(filterHotspots(csv, keep, '2020-04', '2020-05').map((l) => l.split(',')[5]), ['2', '4']);
  assert.equal(filterHotspots(csv, null, '2020-01', '2020-12').length, 4);
  assert.throws(() => filterHotspots('a,b\n', null, '2020-01', '2020-12'));

  const ok = await exportHotspots({
    code: 'PL', files: ['2020', '2021'], keep, from: '2020-04', to: '2021-12', signal: new AbortController().signal,
    fetchText: async (p) => (p.endsWith('2020.csv') ? csv : 'date,time,lat,lon,sensor,frp\n'),
  });
  assert.equal(ok.rows, 2);
  await assert.rejects(exportHotspots({
    code: 'PL', files: ['2020', '2021'], keep, from: '2020-01', to: '2021-12', signal: new AbortController().signal,
    fetchText: async (p) => { if (p.endsWith('2021.csv')) throw new Error('404'); return csv; },
  }), /404/);
  const ac = new AbortController();
  await assert.rejects(exportHotspots({
    code: 'PL', files: ['2020', '2021'], keep, from: '2020-01', to: '2021-12', signal: ac.signal,
    fetchText: async () => { ac.abort(); return csv; },
  }));

  const { model } = load('PL');
  assert.deepEqual(hotspotYears(model, '2019-06', '2021-02'), [2019, 2020, 2021]);
  assert.deepEqual(hotspotYears(load('AU').model, '2019-06', '2021-02'), []);
  // live file only when the range reaches past the last complete month and live data exist
  const withLive = { ...model, live: { lastMonth: '2026-11' } } as unknown as typeof model;
  assert.deepEqual(hotspotFiles(withLive, '2026-09', '2026-11'), ['2026', 'live']);
  assert.deepEqual(hotspotFiles(withLive, '2026-09', '2026-10'), ['2026']);
  assert.deepEqual(hotspotFiles(model, '2026-09', '2026-11'), ['2026']);
});
