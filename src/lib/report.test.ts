// Area report (report.ts). Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annualTotals, harmonize, monthCount, monthlyTotals, type Cells, type Model } from './harmonize.ts';
import type { RecurrenceMeta, RecurrenceMonth } from './cellmap.ts';
import {
  cividis, escapeHtml, lonLatStr, mainSeason, monthProfile, monthsText, placeMonths, placesInArea, reportHtml, summarize,
  type ReportInput,
} from './report.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8'));

function plInput(): ReportInput {
  const cells: Cells = read('public/data/PL/cells.json');
  const model: Model = read('public/data/PL/model.json');
  const n = monthCount(cells.first_month, model.last_complete_month);
  const h = harmonize(monthlyTotals(cells, n), model);
  return {
    title: 'Poland <test> & "x"', areaNote: 'Whole country', shape: null, isArea: false, h, model,
    fromIdx: 0, toIdx: n - 1, annual: annualTotals(h, model, 0, n - 1), mtd: null, season: null, places: null,
    appUrl: 'https://example.org/#PL', generated: '2026-11-14 20:00', dataThrough: '2026-10-31', modelNote: 'model E',
  };
}

test('main fire months: fewest months reaching the share, written as ranges', () => {
  const sh = [0.3, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.4];
  assert.deepEqual(mainSeason(sh, 0.7), { months: [0, 11], share: 0.7 });
  assert.deepEqual(mainSeason(sh, 0.9)!.months, [0, 1, 11]);
  assert.equal(mainSeason(new Array(12).fill(0)), null);
  assert.equal(monthsText([0, 1, 11]), 'Dec–Feb');
  assert.equal(monthsText([2, 3, 7]), 'Mar–Apr and Aug');
  assert.equal(monthsText([1, 4, 8]), 'Feb, May and Sep');
  assert.equal(monthsText([3]), 'April');
  assert.equal(monthsText([...Array(12).keys()]), 'all year');
});

test('PL profile: complete years only, shares sum to 1, spring is the main season', () => {
  const r = plInput();
  const p = monthProfile(r.h, r.fromIdx, r.toIdx);
  assert.equal(p.years[0], 2001);
  assert.equal(p.years[p.years.length - 1], 2025);
  assert.ok(Math.abs(p.share.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  for (let c = 0; c < 12; c++) assert.ok(p.p10[c] <= p.median[c] && p.median[c] <= p.p90[c]);
  const top = placeMonths(p);
  assert.equal(top.length, 3);
  assert.ok(top.includes(3), 'April among the main fire months in Poland');
});

test('PL summary: most active year 2003 (estimated), significant decline, ten anomalies', () => {
  const s = summarize(plInput());
  assert.equal(s.topYear!.year, 2003);
  assert.ok(s.topYear!.estimated);
  assert.ok(s.trends.all!.significant && s.trends.all!.slope < 0);
  assert.equal(s.anomalies.length, 10);
  assert.ok(s.lines.some((l) => l.includes('declines by')));
  assert.ok(s.lines.some((l) => l.startsWith('Main fire months')));
});

test('places: area filter, years capped, half count, year-round spots inside the area', () => {
  const meta: RecurrenceMeta = {
    cell_deg: 0.01, first_month: '2012-02', last_month: '2026-10', excluded: [], months: 176,
    years: [14, 15, 15, 15, 15, 15, 14, 14, 15, 15, 14, 14], min_years: 2,
    year_round_rule: { min_share: 0.1, min_cal_months: 9 },
    year_round: { lat: [5058, 4000], lon: [2205, 2000], share: [0.8, 0.5], cal: [12, 10] },
  };
  // 5058/2205 is a year-round (industrial) cell: listed separately, not as a vegetation fire place
  const data: RecurrenceMonth = { lat: [5058, 5050, 4000, 5052, 5059], lon: [2205, 2210, 2000, 2201, 2205], n: [20, 3, 9, 8, 15] };
  const keep = (lat: number, lon: number) => lat > 50 && lat < 51 && lon > 22 && lon < 23;
  const pl = placesInArea(meta, [{ cal: 3, data }], keep);
  const m = pl.months[0];
  assert.equal(m.years, 15);
  assert.equal(m.firstYear, 2012);
  assert.equal(m.lastYear, 2026);
  assert.equal(m.cells, 3);
  assert.equal(m.half, 2); // 15 and 8 of 15
  assert.deepEqual(m.top.map((p) => p.years), [15, 8, 3]);
  assert.ok(Math.abs(m.top[0].lat - 50.595) < 1e-9 && Math.abs(m.top[0].lon - 22.055) < 1e-9);
  assert.ok(!m.top.some((p) => Math.abs(p.lat - 50.585) < 1e-9 && Math.abs(p.lon - 22.055) < 1e-9), 'industrial cell left out');
  assert.equal(pl.yearRound.length, 1);
  // January: first counted month is Feb 2012, so January starts in 2013
  assert.equal(placesInArea(meta, [{ cal: 0, data }], null).months[0].firstYear, 2013);
});

test('report HTML: self-contained, escaped, balanced SVG', () => {
  const html = reportHtml(plInput());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script/i.test(html), 'no scripts');
  assert.ok(!/<(img|link)\b/i.test(html), 'no external resources');
  assert.ok(html.includes('Poland &lt;test&gt; &amp; &quot;x&quot;'));
  assert.equal((html.match(/<svg/g) ?? []).length, (html.match(/<\/svg>/g) ?? []).length);
  assert.ok((html.match(/<svg/g) ?? []).length >= 3);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
});

test('helpers', () => {
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(lonLatStr(-33.4567, -70.6543, 2), '33.46° S, 70.65° W');
  assert.equal(cividis(0), '#00204d');
  assert.equal(cividis(1), '#ffea46');
  assert.match(cividis(0.37), /^#[0-9a-f]{6}$/);
});
