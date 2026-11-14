// Live period (near real-time NOAA-20 after the last complete month) and month-to-date statistics.
// Pure functions (no DOM, no import.meta.env), tested in live.test.ts.
//
// - applyLive: adds the live cell-days of {CC}/live.json to the monthly cells (VIIRS on the
//   S-NPP scale = NOAA-20 cell-days × model.n20_factor), so every view (calendar, areas, map,
//   "All countries", export) gets the current month without a separate code path.
// - sameDaysHistory + mtdStats: the current month so far (days 1..D) against the same days of the
//   same calendar month in earlier VIIRS years, from {CC}/daily/mMM.json (S-NPP, 2012 on).

import { monthAbs, monthStr, type Cells, type Model } from './harmonize.ts';
import { K_FRACTION, K_MIN, MIN_REF_YEARS, REF_YEARS, midRankPercentile, quantile } from './stats.ts';

/** {CC}/live.json (pipeline/live_update.py). */
export interface Live {
  sensor: string;
  first: string; // first live day "YYYY-MM-DD"
  last: string; // last complete day
  gaps: string[]; // days without data inside first..last
  cell_deg: number;
  lat: number[]; // one row per cell-day: 0.1° grid indices
  lon: number[];
  day: number[]; // days since `first`
  det: number[]; // detections (display only)
}

/** What the site needs to know about the live period (stored on the model). */
export interface LiveInfo {
  sensor: string;
  first: string;
  last: string;
  gaps: string[];
  factor: number; // NOAA-20 -> S-NPP scale
  lastMonth: string; // "YYYY-MM" of `last` (end of the series)
  partialMonth: string | null; // lastMonth when it is not complete yet
  throughDay: number; // day of month of `last`
}

/** {CC}/daily/mMM.json (pipeline/live_base.py): S-NPP cell-days of one calendar month. */
export interface Daily {
  first_year: number;
  lat: number[];
  lon: number[];
  d: number[]; // (year - first_year) * 32 + day of month
}

const DAY_MS = 86_400_000;

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Last month of the series: the live month when there is live data, else the last complete month. */
export function seriesEnd(model: Model): string {
  return (model.live as LiveInfo | undefined)?.lastMonth ?? model.last_complete_month;
}

/**
 * Cells and model with the live period added. Live rows before or in the last complete month are
 * ignored (the archive data win). Without complete live days the inputs are returned unchanged.
 */
export function applyLive(cells: Cells, model: Model, live: Live | null): { cells: Cells; model: Model } {
  if (!live || live.last < live.first) return { cells, model };
  const lastComplete = monthAbs(model.last_complete_month);
  const first = monthAbs(cells.first_month);
  const factor = model.n20_factor;
  // cell-days and detections per (cell, month)
  const acc = new Map<string, { lat: number; lon: number; m: number; n: number; det: number }>();
  const monthOfDay = new Map<number, number>();
  for (let i = 0; i < live.day.length; i++) {
    let abs = monthOfDay.get(live.day[i]);
    if (abs === undefined) {
      abs = monthAbs(addDays(live.first, live.day[i]).slice(0, 7));
      monthOfDay.set(live.day[i], abs);
    }
    if (abs <= lastComplete) continue;
    const key = `${live.lat[i]},${live.lon[i]},${abs}`;
    const a = acc.get(key);
    if (a) { a.n++; a.det += live.det[i]; } else acc.set(key, { lat: live.lat[i], lon: live.lon[i], m: abs - first, n: 1, det: live.det[i] });
  }
  const out: Cells = {
    ...cells,
    lat: [...cells.lat],
    lon: [...cells.lon],
    m: [...cells.m],
    modis: [...cells.modis],
    viirs: [...cells.viirs],
    ...(cells.viirs_det ? { viirs_det: [...cells.viirs_det] } : {}),
  };
  for (const a of acc.values()) {
    out.lat.push(a.lat);
    out.lon.push(a.lon);
    out.m.push(a.m);
    out.modis.push(0);
    out.viirs.push(a.n * factor);
    out.viirs_det?.push(a.det);
  }
  const lastMonth = live.last.slice(0, 7);
  const throughDay = Number(live.last.slice(8, 10));
  const liveMonths: string[] = [];
  for (let a = lastComplete + 1; a <= monthAbs(lastMonth); a++) liveMonths.push(monthStr(a));
  const info: LiveInfo = {
    sensor: live.sensor, first: live.first, last: live.last, gaps: live.gaps, factor,
    lastMonth, partialMonth: throughDay < daysInMonth(lastMonth) ? lastMonth : null, throughDay,
  };
  return {
    cells: out,
    model: { ...model, preliminary: [...new Set([...(model.preliminary ?? []), ...liveMonths])].sort(), live: info },
  };
}

/** Cell-days with day of month in `days`, per year (years without fire are absent = 0). */
export function sameDaysHistory(
  daily: Daily, days: Set<number>, cellDeg: number, keep?: (lat: number, lon: number) => boolean,
): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < daily.d.length; i++) {
    if (!days.has(daily.d[i] % 32)) continue;
    if (keep && !keep((daily.lat[i] + 0.5) * cellDeg, (daily.lon[i] + 0.5) * cellDeg)) continue;
    const y = daily.first_year + Math.floor(daily.d[i] / 32);
    out.set(y, (out.get(y) ?? 0) + 1);
  }
  return out;
}

/** Days 1..throughDay of the month, without live gap days (the history skips them too). */
export function comparedDays(info: LiveInfo): Set<number> {
  const days = new Set<number>();
  for (let d = 1; d <= info.throughDay; d++) days.add(d);
  for (const g of info.gaps) if (g.startsWith(info.lastMonth)) days.delete(Number(g.slice(8, 10)));
  return days;
}

export interface MtdStats {
  month: string; // "YYYY-MM"
  throughDay: number;
  days: number; // days compared (gaps left out)
  value: number;
  refFrom: number;
  refTo: number;
  nRef: number;
  median: number | null;
  k: number | null;
  ratio: number | null; // (x + k) / (median + k), k scaled to the compared days
  p10: number | null;
  p90: number | null;
  percentile: number;
  nAll: number;
  firstYear: number;
}

/**
 * Month to date against the same days in earlier years. Years: from the first full VIIRS month
 * (model.viirs_first_month) to the year before; months with known sensor problems left out.
 * Reference = the last REF_YEARS of them (as monthStats); k = the monthly k × days / days in month.
 */
export function mtdStats(
  value: number, hist: Map<number, number>, info: LiveInfo, model: Model, days: number, kMonth: number | null,
): MtdStats {
  const year = Number(info.lastMonth.slice(0, 4));
  const mm = info.lastMonth.slice(5, 7);
  const vf = monthAbs(model.viirs_first_month);
  const lowQ = new Set(model.low_quality);
  const years: number[] = [];
  for (let y = Math.floor(vf / 12); y < year; y++) {
    if (monthAbs(`${y}-${mm}`) < vf || lowQ.has(`${y}-${mm}`)) continue;
    years.push(y);
  }
  const vals = (ys: number[]) => ys.map((y) => hist.get(y) ?? 0);
  const refFrom = year - REF_YEARS;
  const ref = vals(years.filter((y) => y >= refFrom));
  const all = [...vals(years), value];
  let med: number | null = null, p10: number | null = null, p90: number | null = null;
  let k: number | null = null, ratio: number | null = null;
  if (ref.length >= MIN_REF_YEARS) {
    const s = [...ref].sort((a, b) => a - b);
    med = quantile(s, 0.5);
    p10 = quantile(s, 0.1);
    p90 = quantile(s, 0.9);
    const scale = days / daysInMonth(info.lastMonth);
    k = (kMonth ?? Math.max(K_MIN, K_FRACTION * med)) * scale;
    ratio = (value + k) / (med + k);
  }
  return {
    month: info.lastMonth, throughDay: info.throughDay, days, value,
    refFrom, refTo: year - 1, nRef: ref.length, median: med, k, ratio, p10, p90,
    percentile: midRankPercentile(all, value), nAll: all.length, firstYear: years[0] ?? year,
  };
}
