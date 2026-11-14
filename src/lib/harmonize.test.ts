// TS port vs Python reference (src/lib/fixtures, written by pipeline/site_fixture.py).
// Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  harmonize,
  monthAbs,
  monthCount,
  monthlyTotals,
  monthStr,
  type Cells,
  type Model,
} from './harmonize.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf-8'));
const countries: { code: string }[] = read('public/data/countries.json');

interface Fixture {
  first_month: string;
  modis: number[];
  viirs: number[];
  value: number[];
  estimated: number[];
  terra_only: number[];
  viirs_det?: number[];
}

function load(code: string) {
  const cells: Cells = read(`public/data/${code}/cells.json`);
  const model: Model = read(`public/data/${code}/model.json`);
  const fx: Fixture = read(`src/lib/fixtures/${code}.json`);
  const n = monthCount(cells.first_month, model.last_complete_month);
  const h = harmonize(monthlyTotals(cells, n), model);
  return { cells, model, fx, h, n };
}

test('month helpers', () => {
  assert.equal(monthStr(monthAbs('2012-01')), '2012-01');
  assert.equal(monthCount('2000-01', '2025-12'), 312);
  assert.equal(monthStr(monthAbs('2000-01') + 311), '2025-12');
});

for (const { code } of countries) {
  test(`${code}: monthly series matches Python`, () => {
    const { fx, h, n } = load(code);
    assert.equal(n, fx.value.length);
    assert.equal(h.viirsDet === undefined, fx.viirs_det === undefined);
    assert.equal(h.firstMonth, fx.first_month);
    for (let i = 0; i < n; i++) {
      assert.equal(h.modis[i], fx.modis[i], `${code} modis ${monthStr(monthAbs(h.firstMonth) + i)}`);
      assert.equal(h.viirs[i], fx.viirs[i]);
      if (fx.viirs_det) assert.equal(h.viirsDet![i], fx.viirs_det[i], `${code} det ${i}`);
      assert.equal(h.estimated[i], fx.estimated[i] === 1);
      assert.equal(h.terraOnly[i], fx.terra_only[i] === 1);
      const tol = 1e-6 * Math.max(1, Math.abs(fx.value[i]));
      assert.ok(Math.abs(h.value[i] - fx.value[i]) <= tol, `${code} ${i}: ${h.value[i]} vs ${fx.value[i]}`);
    }
  });

  test(`${code}: annual sums match model.json (rounded to 0.1)`, () => {
    const { model, h, n } = load(code);
    const partial = model.annual.partial_year!;
    assert.equal(partial.length, model.annual.years.length);
    model.annual.years.forEach((y, j) => {
      const i0 = (y - 2000) * 12;
      const i1 = Math.min(i0 + 12, n);
      let s = 0;
      for (let i = i0; i < i1; i++) s += h.value[i];
      assert.ok(Math.abs(s - model.annual.harmonized[j]) <= 0.05 + 1e-9, `${code} ${y}: ${s}`);
      assert.equal(partial[j], i1 - i0 < 12, `${code} ${y} partial`);
    });
  });

  test(`${code}: boundaries (Terra-only, 2012-01 estimated, 2012-02 observed)`, () => {
    const { model, h } = load(code);
    const at = (ym: string) => monthAbs(ym) - monthAbs(h.firstMonth);
    const until = at(model.terra_only.until);
    assert.equal(h.terraOnly[until], true);
    assert.equal(h.terraOnly[until + 1], false);
    assert.ok(h.hi[until] / h.value[until] > h.hi[until + 1] / h.value[until + 1] || h.value[until] === 0);
    assert.equal(model.viirs_first_month, '2012-02');
    const jan = at('2012-01');
    assert.equal(h.estimated[jan], true);
    assert.equal(h.estimated[jan + 1], false);
    assert.equal(h.value[jan + 1], h.viirs[jan + 1]);
    assert.equal(h.lo[jan + 1], h.hi[jan + 1]);
    assert.ok(h.hi[jan] >= h.value[jan] && h.lo[jan] <= h.value[jan]);
  });
}

test('empty area keeps full length and gives zeros', () => {
  const { cells, model, n } = load('PL');
  const s = monthlyTotals(cells, n, () => false);
  assert.equal(s.modis.length, n);
  const h = harmonize(s, model);
  assert.equal(h.value.length, n);
  // Estimated months with MODIS = 0 give expm1(a[season]) (country intercept, see DECISIONS.md:
  // open issue for small custom areas in stage 5); observed months are exactly 0.
  const season = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];
  for (let i = 0; i < monthAbs('2012-02') - monthAbs('2000-01'); i++) {
    const want = Math.expm1(model.a[season[i % 12]]);
    assert.ok(Math.abs(h.value[i] - want) < 1e-9 * want, `${i}`);
  }
  assert.ok(h.value.slice(monthAbs('2012-02') - monthAbs('2000-01')).every((v) => v === 0));
});

test('missing viirs_det means no data (undefined), present means sums', () => {
  const base: Cells = {
    first_month: '2000-01', cell_deg: 0.1, lat: [500, 501], lon: [200, 200], m: [0, 0], modis: [0, 0], viirs: [1, 2],
  };
  const model = load('PL').model;
  const without = harmonize(monthlyTotals(base, 2), model);
  assert.equal(without.viirsDet, undefined);
  const withDet = monthlyTotals({ ...base, viirs_det: [3, 4] }, 2);
  assert.deepEqual([...withDet.viirsDet!], [7, 0]);
  assert.deepEqual([...harmonize(withDet, model).viirsDet!], [7, 0]);
});

test('keep gets cell centers in degrees', () => {
  const cells: Cells = {
    first_month: '2000-01', cell_deg: 0.1, lat: [500], lon: [200], m: [0], modis: [3], viirs: [7],
  };
  let seen: [number, number] | null = null;
  monthlyTotals(cells, 1, (lat, lon) => ((seen = [lat, lon]), true));
  assert.ok(seen);
  assert.ok(Math.abs(seen![0] - 50.05) < 1e-9 && Math.abs(seen![1] - 20.05) < 1e-9);
});
