// "This season": cumulative fire cell-days since 1 January, the current year against earlier
// VIIRS years. Pure functions (no DOM), tested in season.test.ts.
//
// Points: 1 Jan (0) and the end of every month (from the harmonized monthly series). When the
// current month is not complete (month to date, day D), one more point at day D: earlier years get
// their exact value there (cumulative to the previous month end + the same days of this month,
// from the daily S-NPP history), so the comparison at "today" is like for like.

import { monthAbs, type Harmonized } from './harmonize.ts';
import { midRankPercentile, quantile } from './stats.ts';

const MONTH_END_DOY = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]; // non-leap year

export interface SeasonData {
  year: number;
  x: number[]; // day of year (non-leap scale) of every point
  history: { year: number; y: number[] }[]; // one curve per earlier year, all points of x
  p10: number[];
  p50: number[];
  p90: number[];
  current: number[]; // current year, points 0..current.length - 1 of x
  last: { x: number; value: number; median: number; percentile: number; nYears: number; ratio: number | null } | null;
}

/**
 * @param h       monthly series (country or area); its last month may be month to date
 * @param years   earlier years to compare with (e.g. 2012..year-1)
 * @param partial month to date: day D and same-days totals per earlier year (null = no partial month)
 */
export function seasonData(
  h: Harmonized, years: number[], partial: { day: number; hist: Map<number, number> } | null,
): SeasonData {
  const first = monthAbs(h.firstMonth);
  const lastIdx = h.value.length - 1;
  const lastAbs = first + lastIdx;
  const year = Math.floor(lastAbs / 12);
  const lastCal = lastAbs % 12; // 0 = Jan
  const isPartial = !!partial && h.partial[lastIdx];
  const val = (y: number, cal: number) => {
    const i = y * 12 + cal - first;
    return i >= 0 && i <= lastIdx ? h.value[i] : NaN;
  };

  // x: 0, month ends (with the partial month's day D placed inside that month)
  const x = [0];
  for (let c = 0; c < 12; c++) {
    if (isPartial && c === lastCal) x.push((c ? MONTH_END_DOY[c - 1] : 0) + partial!.day);
    x.push(MONTH_END_DOY[c]);
  }
  const dPos = isPartial ? lastCal + 1 : -1; // index in x of the "today" point

  const curve = (y: number, todayPart: number | null): number[] => {
    const out = [0];
    let cum = 0;
    for (let c = 0; c < 12; c++) {
      if (c === lastCal && isPartial) out.push(cum + (todayPart ?? 0));
      cum += val(y, c);
      out.push(cum);
    }
    return out;
  };
  const history = years.map((y) => ({ y: curve(y, partial?.hist.get(y) ?? 0), year: y }));

  const p10: number[] = [], p50: number[] = [], p90: number[] = [];
  for (let k = 0; k < x.length; k++) {
    const vs = history.map((c) => c.y[k]).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    p10.push(vs.length ? quantile(vs, 0.1) : NaN);
    p50.push(vs.length ? quantile(vs, 0.5) : NaN);
    p90.push(vs.length ? quantile(vs, 0.9) : NaN);
  }

  // current year: up to the last month end, plus "today" when the month is partial
  const full = curve(year, null);
  const nPts = isPartial ? dPos + 1 : lastCal + 2;
  const current = full.slice(0, nPts);
  if (isPartial) current[dPos] = full[dPos] + h.value[lastIdx];

  let last: SeasonData['last'] = null;
  if (current.length > 1 && history.length) {
    const k = current.length - 1;
    const vs = history.map((c) => c.y[k]);
    const v = current[k];
    last = {
      x: x[k], value: v, median: p50[k], nYears: vs.length,
      percentile: midRankPercentile([...vs, v], v),
      ratio: p50[k] > 0 ? v / p50[k] : null,
    };
  }
  return { year, x, history, p10, p50, p90, current, last };
}

/** Earlier years from the first VIIRS year (2012; its January is estimated from MODIS) to last year. */
export function seasonYears(h: Harmonized, viirsFirstMonth: string): number[] {
  const first = monthAbs(h.firstMonth);
  const year = Math.floor((first + h.value.length - 1) / 12);
  const y0 = Math.floor(monthAbs(viirsFirstMonth) / 12);
  const out: number[] = [];
  for (let y = y0; y < year; y++) out.push(y);
  return out;
}
