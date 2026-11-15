// "Places to watch" in the next 7 days: where fire happened most often at this time of year (VIIRS
// recurrence, ~1 km cells), weighted by the local fire weather forecast. Pure functions, tested in
// watch.test.ts.
//
// Score of a cell = recurrence × weather factor.
// - recurrence: share of years with fire in the cell at this time of year: the calendar month(s) of
//   the 7 days (weighted by how many days fall in each) and the months next to them at half weight
//   (seasonWeights); year-round (industrial) cells left out.
// - weather factor: exp(weather term of the country forecast model) computed from the weather of the
//   forecast points (pipeline/forecast_update.py), inverse-distance blend of the 3 nearest points,
//   mean over the 7 days. 1 = usual fire weather for the season, 0.3 = much wetter/calmer, 2 = drier.
// The score ranks places; it is not a calibrated probability.

import type { RecurrenceMeta, RecurrenceMonth } from './cellmap.ts';

export interface ForecastPoint {
  lat: number;
  lon: number;
  factor: number[]; // per forecast day
  fwi: number[];
}

export interface WatchPlace {
  lat: number; // cell centre
  lon: number;
  recurrence: number; // 0..1, weighted over the months (seasonWeights)
  byMonth: { cal: number; years: number; of: number }[]; // years with fire per month (cells with >= 2)
  factor: number | null; // weather factor (mean of the 7 days), null = no forecast
  fwi: number | null; // mean FWI of the 7 days near the place
  score: number;
}

const NEAREST = 3;
export const MIN_KM = 3; // places closer than this count as one

/** Distance in km (equirectangular; fine for the few hundred km between forecast points). */
function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(x, lat2 - lat1) * 111.2;
}

/** Weather factor and FWI near a place: inverse-distance (1/d²) blend of the 3 nearest points. */
export function localWeather(points: ForecastPoint[], lat: number, lon: number): { factor: number[]; fwi: number[] } | null {
  if (!points.length) return null;
  const near = points
    .map((p) => ({ p, d: km(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, NEAREST);
  if (near[0].d < 1) return { factor: [...near[0].p.factor], fwi: [...near[0].p.fwi] };
  const w = near.map((x) => 1 / (x.d * x.d));
  const sw = w.reduce((s, v) => s + v, 0);
  const n = near[0].p.factor.length;
  const blend = (key: 'factor' | 'fwi') =>
    Array.from({ length: n }, (_, i) => near.reduce((s, x, k) => s + w[k] * x.p[key][i], 0) / sw);
  // factors multiply activity: blend in log space
  const lf = Array.from({ length: n }, (_, i) => Math.exp(near.reduce((s, x, k) => s + w[k] * Math.log(x.p.factor[i]), 0) / sw));
  return { factor: lf, fwi: blend('fwi') };
}

/** Months of the days at full weight, the months next to them at half weight; sums to 1. */
export function seasonWeights(days: string[]): Map<number, number> {
  const base = monthWeights(days);
  const out = new Map<number, number>();
  for (const [m, w] of base) {
    out.set(m, (out.get(m) ?? 0) + w);
    for (const nb of [(m + 11) % 12, (m + 1) % 12]) if (!base.has(nb)) out.set(nb, (out.get(nb) ?? 0) + w / 2);
  }
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  for (const [m, w] of out) out.set(m, w / sum);
  return out;
}

/** Calendar months (0 = Jan) of the days and the share of the days in each. */
export function monthWeights(days: string[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of days) {
    const m = Number(d.slice(5, 7)) - 1;
    out.set(m, (out.get(m) ?? 0) + 1 / days.length);
  }
  return out;
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Ranked places inside the area (keep tests a cell centre in degrees; null = whole country).
 * months: recurrence files of the calendar months in `weights`.
 */
export function watchPlaces(
  meta: RecurrenceMeta,
  months: { cal: number; data: RecurrenceMonth }[],
  weights: Map<number, number>,
  keep: ((lat: number, lon: number) => boolean) | null,
  points: ForecastPoint[] | null,
  n = 10,
): WatchPlace[] {
  const d = meta.cell_deg;
  const industrial = new Set(meta.year_round.lat.map((la, i) => `${la},${meta.year_round.lon[i]}`));
  const cells = new Map<string, { lat: number; lon: number; rec: number; byMonth: WatchPlace['byMonth'] }>();
  for (const { cal, data } of months) {
    const w = weights.get(cal) ?? 0;
    const of = meta.years[cal] ?? 0;
    if (!w || !of) continue;
    for (let j = 0; j < data.n.length; j++) {
      const key = `${data.lat[j]},${data.lon[j]}`;
      if (industrial.has(key)) continue;
      const lat = (data.lat[j] + 0.5) * d, lon = (data.lon[j] + 0.5) * d;
      if (keep && !keep(lat, lon)) continue;
      const yrs = Math.min(data.n[j], of);
      const c = cells.get(key) ?? { lat, lon, rec: 0, byMonth: [] };
      c.rec += (w * yrs) / of;
      c.byMonth.push({ cal, years: yrs, of });
      cells.set(key, c);
    }
  }
  // the weather factor varies over tens of km: compute it once per 0.1° block
  const wxCache = new Map<string, { factor: number; fwi: number } | null>();
  const wx = (lat: number, lon: number) => {
    if (!points?.length) return null;
    const key = `${Math.floor(lat * 10)},${Math.floor(lon * 10)}`;
    if (!wxCache.has(key)) {
      const l = localWeather(points, lat, lon);
      wxCache.set(key, l ? { factor: mean(l.factor), fwi: mean(l.fwi) } : null);
    }
    return wxCache.get(key)!;
  };
  const out: WatchPlace[] = [];
  for (const c of cells.values()) {
    const w = wx(c.lat, c.lon);
    out.push({
      lat: c.lat, lon: c.lon, recurrence: c.rec, byMonth: c.byMonth.sort((a, b) => a.cal - b.cal),
      factor: w ? w.factor : null, fwi: w ? w.fwi : null, score: c.rec * (w ? w.factor : 1),
    });
  }
  out.sort((a, b) => b.score - a.score || b.recurrence - a.recurrence || b.lat - a.lat);
  // one entry per place: skip cells within MIN_KM of a higher-ranked one (neighbouring cells of one fire area)
  const picked: WatchPlace[] = [];
  for (const p of out) {
    if (picked.length >= n) break;
    if (picked.every((q) => km(p.lat, p.lon, q.lat, q.lon) >= MIN_KM)) picked.push(p);
  }
  return picked;
}

/** One word for a weather factor. */
export function factorWord(f: number): string {
  return f >= 1.5 ? 'much more favourable to fire than usual' : f >= 1.15 ? 'more favourable to fire than usual'
    : f > 0.87 ? 'close to usual' : f > 0.6 ? 'less favourable to fire than usual' : 'much less favourable to fire than usual';
}
