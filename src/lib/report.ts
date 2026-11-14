// Area report: one self-contained HTML file (inline CSS and SVG, no scripts, no external requests)
// that summarizes the selected area and period. It opens in any browser and prints to PDF.
// Pure functions (no DOM), tested in report.test.ts. The page (index.astro) gathers the inputs.

import { monthAbs, monthStr, type Harmonized, type Model, type YearTotal } from './harmonize.ts';
import { quantile, topAnomalies, monthStats, type Anomaly } from './stats.ts';
import { trends, trendYears, type Trend, type Trends } from './trend.ts';
import type { MtdStats } from './live.ts';
import type { SeasonData } from './season.ts';
import type { RecurrenceMeta, RecurrenceMonth, YearRoundCell } from './cellmap.ts';
import type { LonLat, Shape } from './geo.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** Share of the yearly total that defines the main fire season (shortest run of months reaching it). */
export const SEASON_SHARE = 0.7;
export const PLACES_PER_MONTH = 10;
export const PLACE_MONTHS = 3;

// ------------------------------------------------------------------ numbers

export const fmt = (v: number) =>
  v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1);
const pctStr = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v) >= 10 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`;
const ratioStr = (r: number) => `${r >= 10 ? r.toFixed(0) : r.toFixed(1)}×`;
const pStr = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const monthLabel = (ym: string) => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const plural = (c: number) => (c === 2 ? 'Marches' : `${MONTHS_LONG[c]}s`);

/** Calendar months as ranges: [2, 3, 7] -> "Mar–Apr and Aug"; runs may wrap over the new year. */
export function monthsText(months: number[]): string {
  if (months.length >= 12) return 'all year';
  if (months.length === 1) return MONTHS_LONG[months[0]];
  const set = new Set(months);
  const starts = [...set].filter((c) => !set.has((c + 11) % 12)).sort((a, b) => a - b);
  const runs = starts.map((a) => {
    let len = 1;
    while (set.has((a + len) % 12)) len++;
    return len === 1 ? MONTHS[a] : `${MONTHS[a]}–${MONTHS[(a + len - 1) % 12]}`;
  });
  return runs.length === 1 ? runs[0] : `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Latitude / longitude as "50.581° N, 22.052° E". */
export function lonLatStr(lat: number, lon: number, digits = 3): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;
}

// ------------------------------------------------------------------ seasonal profile

export interface MonthProfile {
  years: number[]; // complete years used
  mean: number[]; // per calendar month
  median: number[];
  p10: number[];
  p90: number[];
  share: number[]; // mean month / sum of the 12 means (0 when no fire at all)
}

/** Per calendar month over the complete years of the period (low-quality months left out). */
export function monthProfile(h: Harmonized, fromIdx: number, toIdx: number): MonthProfile {
  const years = [...trendYears(h, fromIdx, toIdx)].sort((a, b) => a - b);
  const first = monthAbs(h.firstMonth);
  const vals: number[][] = Array.from({ length: 12 }, () => []);
  for (const y of years) {
    for (let c = 0; c < 12; c++) {
      const i = y * 12 + c - first;
      if (i >= 0 && i < h.value.length && !h.lowQuality[i]) vals[c].push(h.value[i]);
    }
  }
  const q = (v: number[], p: number) => (v.length ? quantile([...v].sort((a, b) => a - b), p) : 0);
  const mean = vals.map((v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0));
  const total = mean.reduce((s, v) => s + v, 0);
  return {
    years,
    mean,
    median: vals.map((v) => q(v, 0.5)),
    p10: vals.map((v) => q(v, 0.1)),
    p90: vals.map((v) => q(v, 0.9)),
    share: mean.map((v) => (total > 0 ? v / total : 0)),
  };
}

/** Fewest calendar months holding ≥ `share` of the year (largest months first), in calendar order. */
export function mainSeason(sh: number[], share = SEASON_SHARE): { months: number[]; share: number } | null {
  if (!(sh.reduce((s, v) => s + v, 0) > 0)) return null;
  const order = sh.map((v, c) => ({ v, c })).sort((a, b) => b.v - a.v || a.c - b.c);
  const months: number[] = [];
  let sum = 0;
  for (const { v, c } of order) {
    if (sum >= share - 1e-9) break;
    months.push(c);
    sum += v;
  }
  return { months: months.sort((a, b) => a - b), share: sum };
}

// ------------------------------------------------------------------ recurrent places

export interface Place {
  lat: number; // cell centre, degrees
  lon: number;
  years: number; // years with fire in this calendar month
}

export interface PlaceMonth {
  cal: number; // 0 = Jan
  years: number; // years counted
  firstYear: number;
  lastYear: number;
  cells: number; // cells in the area with fire in ≥ 2 years (year-round cells left out)
  half: number; // cells with fire in at least half of the years
  top: Place[];
}

export interface Places {
  cellDeg: number;
  months: PlaceMonth[];
  yearRound: YearRoundCell[]; // likely industrial, inside the area
}

/**
 * Most recurrent 0.01° cells of the area for some calendar months (recurrence files of one
 * country). `keep` tests a cell centre (lat, lon in degrees); null = whole country.
 */
export function placesInArea(
  meta: RecurrenceMeta,
  months: { cal: number; data: RecurrenceMonth }[],
  keep: ((lat: number, lon: number) => boolean) | null,
  n = PLACES_PER_MONTH,
): Places {
  const d = meta.cell_deg;
  const [fy, fm] = meta.first_month.split('-').map(Number);
  const [ly, lm] = meta.last_month.split('-').map(Number);
  // Year-round (likely industrial) cells are listed separately, never as vegetation fire places.
  const industrial = new Set(meta.year_round.lat.map((la, i) => `${la},${meta.year_round.lon[i]}`));
  const out: PlaceMonth[] = months.map(({ cal, data }) => {
    const years = meta.years[cal] ?? 0;
    const inside: Place[] = [];
    for (let j = 0; j < data.n.length; j++) {
      if (industrial.has(`${data.lat[j]},${data.lon[j]}`)) continue;
      const lat = (data.lat[j] + 0.5) * d, lon = (data.lon[j] + 0.5) * d;
      if (!keep || keep(lat, lon)) inside.push({ lat, lon, years: Math.min(data.n[j], years) });
    }
    inside.sort((a, b) => b.years - a.years || b.lat - a.lat || a.lon - b.lon);
    return {
      cal, years,
      firstYear: cal + 1 >= fm ? fy : fy + 1,
      lastYear: cal + 1 <= lm ? ly : ly - 1,
      cells: inside.length,
      half: inside.filter((p) => years > 0 && p.years * 2 >= years).length,
      top: inside.slice(0, n),
    };
  });
  const yr = meta.year_round;
  const yearRound: YearRoundCell[] = yr.lat
    .map((la, i) => ({ lat: (la + 0.5) * d, lon: (yr.lon[i] + 0.5) * d, share: yr.share[i], cal: yr.cal[i] }))
    .filter((c) => !keep || keep(c.lat, c.lon))
    .sort((a, b) => b.share - a.share);
  return { cellDeg: d, months: out, yearRound };
}

/** Calendar months for the places section: the largest mean months of the profile (fire only). */
export function placeMonths(profile: MonthProfile, k = PLACE_MONTHS): number[] {
  return profile.mean
    .map((v, c) => ({ v, c }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, k)
    .map((x) => x.c)
    .sort((a, b) => a - b);
}

// ------------------------------------------------------------------ report content

export interface ReportInput {
  title: string; // "Podkarpacie, Poland"
  areaNote: string; // how the area is defined
  shape: Shape | null; // null = whole country (or all countries)
  isArea: boolean; // custom area: higher uncertainty
  h: Harmonized; // harmonized series of the area
  model: Model;
  fromIdx: number;
  toIdx: number;
  annual: YearTotal[]; // annual totals of the period (computed by the caller)
  mtd: MtdStats | null; // current month so far
  season: SeasonData | null; // since 1 January
  places: Places | null;
  appUrl: string; // link back to the same view
  generated: string; // ISO timestamp
  dataThrough: string; // last day with data
  modelNote: string; // e.g. "model E (seasonal), b = 0.564"
}

export interface ReportSummary {
  period: [string, string];
  profile: MonthProfile;
  season: { months: number[]; share: number } | null; // main fire months
  meanYear: number | null; // mean of complete years in the period
  meanViirs: number | null; // mean of complete observed VIIRS years in the period
  topYear: YearTotal | null; // largest complete year
  topMonth: { idx: number; ym: string; value: number; estimated: boolean } | null;
  trends: Trends;
  anomalies: Anomaly[];
  lines: string[]; // plain-language summary (HTML)
}

export function summarize(r: ReportInput): ReportSummary {
  const { h, model, fromIdx, toIdx } = r;
  const first = monthAbs(h.firstMonth);
  const profile = monthProfile(h, fromIdx, toIdx);
  const season = mainSeason(profile.share);
  const complete = r.annual.filter((t) => !t.partial && profile.years.includes(t.year));
  const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
  const meanYear = mean(complete.map((t) => t.value));
  const obs = complete.filter((t) => !t.estimated && t.year * 12 >= monthAbs(model.viirs_first_month));
  const meanViirs = mean(obs.map((t) => t.value));
  const topYear = complete.reduce<YearTotal | null>((b, t) => (!b || t.value > b.value ? t : b), null);
  let topMonth: ReportSummary['topMonth'] = null;
  for (let i = Math.max(fromIdx, 0); i <= Math.min(toIdx, h.value.length - 1); i++) {
    if (h.lowQuality[i] || h.partial[i]) continue;
    if (!topMonth || h.value[i] > topMonth.value) {
      topMonth = { idx: i, ym: monthStr(first + i), value: h.value[i], estimated: h.estimated[i] };
    }
  }
  const tr = trends(h, model, fromIdx, toIdx);
  const anomalies = topAnomalies(h, fromIdx, toIdx, 10);

  const lines: string[] = [];
  if (meanYear !== null && profile.years.length) {
    const y0 = profile.years[0], y1 = profile.years[profile.years.length - 1];
    lines.push(`A typical year has <b>${fmt(meanYear)} fire cell-days</b> (mean of ${complete.length} complete years, ${y0}–${y1})` +
      (meanViirs !== null && obs.length >= 3 && obs.length < complete.length
        ? `; ${fmt(meanViirs)} in the observed VIIRS years (${obs[0].year}–${obs[obs.length - 1].year}).` : '.'));
  }
  if (season) {
    const peak = profile.mean.indexOf(Math.max(...profile.mean));
    lines.push(`Main fire months: <b>${monthsText(season.months)}</b>, ${Math.round(season.share * 100)}% of the yearly total` +
      (season.months.length > 1 ? `; peak month ${MONTHS_LONG[peak]} (${Math.round(profile.share[peak] * 100)}%).` : '.'));
  } else {
    lines.push('No fire activity recorded in the complete years of this period.');
  }
  if (topYear) {
    lines.push(`Most active year: <b>${topYear.year}</b> with ${fmt(topYear.value)} cell-days` +
      (topYear.estimated ? ` (estimated, ~80%: ${fmt(topYear.lo)}–${fmt(topYear.hi)})` : '') +
      (topMonth ? `; most active month: <b>${monthLabel(topMonth.ym)}</b> (${fmt(topMonth.value)}${topMonth.estimated ? ', estimated' : ''}).` : '.'));
  }
  if (tr.all) {
    const a = tr.all, v = tr.viirs;
    const dir = a.slope < 0 ? 'declines' : 'grows';
    let s = a.significant
      ? `Fire activity <b>${dir} by ${pctStr(a.pctPerYear).replace(/^[+−]/, '')} per year</b> (${a.from}–${a.to}, ${pStr(a.p)})`
      : `No significant trend in ${a.from}–${a.to} (${pctStr(a.pctPerYear)} per year, ${pStr(a.p)})`;
    if (a.significant && v) {
      const same = Math.sign(v.slope) === Math.sign(a.slope);
      s += v.significant && same
        ? `; the VIIRS years alone agree (${pctStr(v.pctPerYear)} per year, ${pStr(v.p)}).`
        : !same ? '; the VIIRS years alone point the other way.' : '; the VIIRS years alone are too few to confirm it.';
    } else s += '.';
    lines.push(s);
    const sig = tr.byMonth.map((t, c) => ({ t, c })).filter((x) => x.t?.significant);
    if (sig.length) {
      lines.push(`Months with a significant trend: ${sig.map((x) => `${MONTHS[x.c]} ${pctStr(x.t!.pctPerYear)}`).join(', ')} per year.`);
    }
  }
  if (r.mtd && r.mtd.ratio !== null) {
    const m = r.mtd;
    const span = `1–${m.throughDay} ${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`;
    if (m.value === 0) lines.push(`Now (${span}): <b>no fire cell-days so far</b>; typical for these days: ${fmt(m.median!)} (median ${m.refFrom}–${m.refTo}, usual range ${fmt(m.p10!)}–${fmt(m.p90!)}); preliminary near real-time data.`);
    else lines.push(`Now (${span}): <b>${fmt(m.value)} cell-days, ${ratioStr(m.ratio!)} typical</b> for these days ` +
      `(median ${m.refFrom}–${m.refTo}: ${fmt(m.median!)}, usual range ${fmt(m.p10!)}–${fmt(m.p90!)}); preliminary near real-time data.`);
  } else {
    // last complete month of the series
    let i = h.value.length - 1;
    while (i > 0 && h.partial[i]) i--;
    const s = monthStats(h, i);
    if (s.ratio !== null) {
      lines.push(`Latest complete month, ${monthLabel(s.month)}: <b>${fmt(s.value)} cell-days, ${ratioStr(s.ratio)} typical</b> ` +
        `(median ${s.refFrom}–${s.refTo}: ${fmt(s.median!)}).`);
    }
  }
  if (r.season?.last && r.season.last.ratio !== null) {
    const l = r.season.last;
    lines.push(`This season (since 1 January ${r.season.year}): ${fmt(l.value)} cell-days, ` +
      `${ratioStr(l.ratio!)} the median of ${l.nYears} earlier years (above ${Math.round(l.percentile)}% of them).`);
  }
  const pm = r.places?.months.filter((m) => m.top.length) ?? [];
  if (pm.length) {
    const best = pm.map((m) => ({ m, p: m.top[0] })).sort((a, b) => b.p.years / b.m.years - a.p.years / a.m.years)[0];
    lines.push(`Most recurrent place: <b>${lonLatStr(best.p.lat, best.p.lon)}</b>, fire in ${best.p.years} of ${best.m.years} ` +
      `${plural(best.m.cal)} (~1 km cell, VIIRS).`);
  }
  if (r.places?.yearRound.length) {
    lines.push(`${r.places.yearRound.length} spot${r.places.yearRound.length === 1 ? '' : 's'} with year-round fire ` +
      `(likely industrial, not vegetation): listed below.`);
  }
  return {
    period: [monthStr(first + fromIdx), monthStr(first + toIdx)],
    profile, season, meanYear, meanViirs, topYear, topMonth, trends: tr, anomalies, lines,
  };
}

// ------------------------------------------------------------------ SVG charts

// Cividis (as the site's calendar), interpolated.
const CIVIDIS = ['#00204d', '#00306f', '#2a406c', '#48526b', '#5f636e', '#757575', '#8b8778', '#a39a75', '#bdad6d', '#d8c35e', '#ffea46'];

export function cividis(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (CIVIDIS.length - 1);
  const i = Math.min(Math.floor(x), CIVIDIS.length - 2);
  const f = x - i;
  const a = CIVIDIS[i], b = CIVIDIS[i + 1];
  const ch = (s: string, k: number) => parseInt(s.slice(1 + 2 * k, 3 + 2 * k), 16);
  const c = [0, 1, 2].map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f).toString(16).padStart(2, '0'));
  return `#${c.join('')}`;
}

const svgOpen = (w: number, hgt: number, label: string) =>
  `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}" role="img" aria-label="${escapeHtml(label)}" xmlns="http://www.w3.org/2000/svg">`;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** Calendar heatmap: years × months, log colour scale, estimated years marked. */
export function calendarSvg(h: Harmonized, fromIdx: number, toIdx: number): string {
  const first = monthAbs(h.firstMonth);
  const y0 = Math.floor((first + fromIdx) / 12), y1 = Math.floor((first + toIdx) / 12);
  const rows = y1 - y0 + 1;
  const cw = 46, ch = Math.max(10, Math.min(18, Math.floor(420 / rows))), left = 44, top = 18;
  const w = left + 12 * cw + 70, hgt = top + rows * ch + 8;
  let vmax = 0;
  for (let i = fromIdx; i <= toIdx; i++) if (!h.lowQuality[i]) vmax = Math.max(vmax, h.value[i]);
  const lmax = Math.log1p(Math.max(vmax, 1));
  let s = svgOpen(w, hgt, 'Calendar of fire cell-days per month');
  MONTHS.forEach((m, c) => { s += `<text x="${left + c * cw + cw / 2}" y="12" class="ax" text-anchor="middle">${m}</text>`; });
  for (let y = y0; y <= y1; y++) {
    const ry = top + (y - y0) * ch;
    s += `<text x="${left - 6}" y="${ry + ch - 3}" class="ax" text-anchor="end">${y}</text>`;
    for (let c = 0; c < 12; c++) {
      const i = y * 12 + c - first;
      if (i < fromIdx || i > toIdx) continue;
      const v = h.value[i];
      const fill = cividis(Math.log1p(v) / lmax);
      s += `<rect x="${left + c * cw}" y="${ry}" width="${cw - 1}" height="${ch - 1}" fill="${fill}"><title>${MONTHS[c]} ${y}: ${fmt(v)}${h.estimated[i] ? ' (estimated)' : ''}</title></rect>`;
      if (h.lowQuality[i]) s += `<text x="${left + c * cw + cw / 2}" y="${ry + ch - 3}" class="mk" text-anchor="middle">×</text>`;
      else if (h.partial[i]) s += `<text x="${left + c * cw + cw / 2}" y="${ry + ch - 3}" class="mk" text-anchor="middle">…</text>`;
    }
  }
  // boundary: first observed VIIRS month
  const vIdx = h.estimated.findIndex((e, i) => i >= fromIdx && i <= toIdx && !e);
  if (vIdx > fromIdx) {
    const a = first + vIdx, ry = top + (Math.floor(a / 12) - y0) * ch, cx = left + (a % 12) * cw;
    // under the estimated months of the first VIIRS year, then above its observed months
    const d = a % 12 ? `M${left} ${ry + ch} H${cx} V${ry} H${left + 12 * cw}` : `M${left} ${ry} H${left + 12 * cw}`;
    s += `<path d="${d}" fill="none" stroke="#e8432e" stroke-width="2"/>`;
  }
  // legend
  const lx = left + 12 * cw + 18, lh = Math.min(rows * ch, 200);
  s += `<defs><linearGradient id="cv" x1="0" y1="1" x2="0" y2="0">${CIVIDIS.map((c, k) => `<stop offset="${k / (CIVIDIS.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`;
  s += `<rect x="${lx}" y="${top}" width="12" height="${lh}" fill="url(#cv)"/>`;
  s += `<text x="${lx + 16}" y="${top + 8}" class="ax">${fmt(vmax)}</text><text x="${lx + 16}" y="${top + lh}" class="ax">0</text>`;
  s += `<text x="${lx + 16}" y="${top + lh / 2}" class="ax">log</text>`;
  return s + '</svg>';
}

/** Annual totals with the ~80% interval and the trend lines. */
export function annualSvg(t: YearTotal[], tr: Trends): string {
  const w = 760, hgt = 260, left = 52, right = 10, top = 12, bottom = 26;
  if (!t.length) return '';
  const vmax = Math.max(...t.map((x) => Math.max(x.hi, x.value)), 1);
  const nice = niceMax(vmax);
  const pw = w - left - right, ph = hgt - top - bottom;
  const bw = pw / t.length;
  const X = (i: number) => left + i * bw;
  const Y = (v: number) => top + ph - (v / nice) * ph;
  let s = svgOpen(w, hgt, 'Fire cell-days per year with uncertainty and trend');
  for (let k = 0; k <= 4; k++) {
    const v = (nice * k) / 4;
    s += `<line x1="${left}" x2="${w - right}" y1="${n1(Y(v))}" y2="${n1(Y(v))}" class="grid"/><text x="${left - 6}" y="${n1(Y(v) + 4)}" class="ax" text-anchor="end">${fmt(v)}</text>`;
  }
  t.forEach((x, i) => {
    const col = x.estimated ? '#8a97aa' : '#00224e';
    s += `<rect x="${n1(X(i) + bw * 0.1)}" y="${n1(Y(x.value))}" width="${n1(bw * 0.8)}" height="${n1(Y(0) - Y(x.value))}" fill="${col}"${x.partial ? ' fill-opacity="0.35"' : ''}><title>${x.year}: ${fmt(x.value)}${x.partial ? ' (partial year)' : ''}</title></rect>`;
    if (x.hi > x.lo) {
      const cx = n1(X(i) + bw / 2);
      s += `<line x1="${cx}" x2="${cx}" y1="${n1(Y(x.hi))}" y2="${n1(Y(x.lo))}" stroke="#e8432e" stroke-width="1.5"/>`;
    }
    if (t.length <= 14 || i % 2 === 0) s += `<text x="${n1(X(i) + bw / 2)}" y="${hgt - 8}" class="ax" text-anchor="middle">${x.year}</text>`;
  });
  const line = (x: Trend | null, cls: string) => {
    if (!x) return;
    const i0 = t.findIndex((y) => y.year === x.from), i1 = t.findIndex((y) => y.year === x.to);
    if (i0 < 0 || i1 < 0) return;
    const v0 = Math.expm1(x.intercept + x.slope * x.from), v1 = Math.expm1(x.intercept + x.slope * x.to);
    s += `<line x1="${n1(X(i0) + bw / 2)}" y1="${n1(Y(v0))}" x2="${n1(X(i1) + bw / 2)}" y2="${n1(Y(v1))}" class="${cls}"/>`;
  };
  line(tr.all, 'tr-all');
  line(tr.viirs, 'tr-viirs');
  return s + '</svg>';
}

/** Monthly profile: median per calendar month with the P10–P90 range. */
export function profileSvg(p: MonthProfile, season: ReportSummary['season']): string {
  const w = 760, hgt = 200, left = 52, right = 10, top = 10, bottom = 24;
  const nice = niceMax(Math.max(...p.p90, ...p.median, 1));
  const pw = w - left - right, ph = hgt - top - bottom, bw = pw / 12;
  const Y = (v: number) => top + ph - (v / nice) * ph;
  let s = svgOpen(w, hgt, 'Typical fire cell-days per calendar month');
  if (season && season.months.length < 12) {
    for (const c of season.months) {
      s += `<rect x="${n1(left + c * bw)}" y="${top}" width="${n1(bw)}" height="${ph}" fill="#fbe3d6"/>`;
    }
  }
  for (let k = 0; k <= 4; k++) {
    const v = (nice * k) / 4;
    s += `<line x1="${left}" x2="${w - right}" y1="${n1(Y(v))}" y2="${n1(Y(v))}" class="grid"/><text x="${left - 6}" y="${n1(Y(v) + 4)}" class="ax" text-anchor="end">${fmt(v)}</text>`;
  }
  for (let c = 0; c < 12; c++) {
    const x = left + c * bw;
    s += `<rect x="${n1(x + bw * 0.2)}" y="${n1(Y(p.median[c]))}" width="${n1(bw * 0.6)}" height="${n1(Y(0) - Y(p.median[c]))}" fill="#00224e"><title>${MONTHS_LONG[c]}: median ${fmt(p.median[c])}, P10–P90 ${fmt(p.p10[c])}–${fmt(p.p90[c])}</title></rect>`;
    s += `<line x1="${n1(x + bw / 2)}" x2="${n1(x + bw / 2)}" y1="${n1(Y(p.p90[c]))}" y2="${n1(Y(p.p10[c]))}" stroke="#e8432e" stroke-width="1.5"/>`;
    s += `<text x="${n1(x + bw / 2)}" y="${hgt - 7}" class="ax" text-anchor="middle">${MONTHS[c]}</text>`;
  }
  return s + '</svg>';
}

/** Sketch of the area (outline) with the numbered recurrent places of one month and industrial spots. */
export function placesSvg(shape: Shape | null, m: PlaceMonth, yearRound: YearRoundCell[]): string {
  const pts: LonLat[] = [...m.top.map((p) => [p.lon, p.lat] as LonLat), ...yearRound.slice(0, 20).map((c) => [c.lon, c.lat] as LonLat)];
  const outline: LonLat[] | null = shape
    ? shape.kind === 'rect'
      ? [[shape.bbox[0], shape.bbox[1]], [shape.bbox[2], shape.bbox[1]], [shape.bbox[2], shape.bbox[3]], [shape.bbox[0], shape.bbox[3]]]
      : shape.ring
    : null;
  const all = outline ? [...outline, ...pts] : pts;
  if (!all.length) return '';
  let [w0, s0, e0, n0] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lo, la] of all) { w0 = Math.min(w0, lo); e0 = Math.max(e0, lo); s0 = Math.min(s0, la); n0 = Math.max(n0, la); }
  const padD = Math.max((e0 - w0) * 0.06, (n0 - s0) * 0.06, 0.02);
  w0 -= padD; e0 += padD; s0 -= padD; n0 += padD;
  const kx = Math.cos((((s0 + n0) / 2) * Math.PI) / 180);
  const W = 360;
  const scale = Math.min(W / ((e0 - w0) * kx), 300 / (n0 - s0));
  const width = Math.round((e0 - w0) * kx * scale), height = Math.round((n0 - s0) * scale);
  const P = (lo: number, la: number) => [n1((lo - w0) * kx * scale), n1((n0 - la) * scale)];
  let s = svgOpen(width, height, `Sketch of the area with the most recurrent places in ${MONTHS_LONG[m.cal]}`);
  s += `<rect width="${width}" height="${height}" fill="#f4f6f8"/>`;
  if (outline) s += `<polygon points="${outline.map(([lo, la]) => P(lo, la).join(',')).join(' ')}" fill="#ffffff" stroke="#57606a" stroke-width="1.5"/>`;
  for (const c of yearRound.slice(0, 20)) {
    const [x, y] = P(c.lon, c.lat);
    s += `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#0aa3c2" stroke-width="2"/>`;
  }
  m.top.forEach((p, k) => {
    const [x, y] = P(p.lon, p.lat);
    const r = 4 + 6 * (m.years ? p.years / m.years : 0);
    s += `<circle cx="${x}" cy="${y}" r="${n1(r)}" fill="#e8432e" fill-opacity="0.75"/><text x="${n1(Number(x) + r + 2)}" y="${n1(Number(y) + 4)}" class="ax">${k + 1}</text>`;
  });
  return s + '</svg>';
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ------------------------------------------------------------------ HTML

const CSS = `
:root{--ink:#1f2328;--soft:#57606a;--line:#d8dee4;--accent:#e8432e;--navy:#00224e}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 24px 48px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px;padding-top:8px;border-top:1px solid var(--line)}
.meta{color:var(--soft);margin:0}.meta a{color:var(--navy)}
.summary{background:#f6f8fa;border-left:4px solid var(--accent);padding:12px 16px 12px 32px;margin:16px 0}
.summary li{margin:4px 0}
.note{color:var(--soft);font-size:12.5px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}th{color:var(--soft);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
svg{max-width:100%;height:auto;display:block;margin:6px 0}
svg .ax{font-size:11px;fill:#57606a}svg .mk{font-size:11px;fill:#e8432e}svg .grid{stroke:#e5e8ec}
svg .tr-all{stroke:#e8432e;stroke-width:2;stroke-dasharray:6 4}svg .tr-viirs{stroke:#f28e2b;stroke-width:2;stroke-dasharray:2 3}
.months{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;font-size:12px;text-align:center}
.months div{background:#f6f8fa;padding:3px 0}.months .up{background:#fde0dc}.months .down{background:#dbe9f6}
.places{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}.places>div{flex:1 1 360px}
.key span{display:inline-block;margin-right:14px}
.sw{display:inline-block;width:10px;height:10px;margin-right:4px;vertical-align:-1px}
footer{margin-top:32px;color:var(--soft);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
@media print{main{padding:0;max-width:none}h2{break-after:avoid}svg,table,.places{break-inside:avoid}a{color:inherit}}
`;

const osm = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(4)}&amp;mlon=${lon.toFixed(4)}#map=15/${lat.toFixed(4)}/${lon.toFixed(4)}`;

export function reportHtml(r: ReportInput, s: ReportSummary = summarize(r)): string {
  const { h } = r;
  const period = `${monthLabel(s.period[0])} – ${monthLabel(s.period[1])}`;
  const esc = escapeHtml;
  const tr = s.trends;

  const trendRows = tr.all
    ? `<table><tr><th>Period</th><th class="num">% per year</th><th class="num">95% interval</th><th class="num">p</th><th>Significant</th></tr>
      ${[[`All years ${tr.all.from}–${tr.all.to}`, tr.all], tr.viirs ? [`VIIRS only ${tr.viirs.from}–${tr.viirs.to}`, tr.viirs] : null]
        .filter(Boolean).map((x) => {
          const [name, t] = x as [string, Trend];
          return `<tr><td>${name}</td><td class="num">${pctStr(t.pctPerYear)}</td><td class="num">${pctStr(t.lo)} to ${pctStr(t.hi)}</td><td class="num">${pStr(t.p).replace('p = ', '').replace('p ', '')}</td><td>${t.significant ? 'yes' : 'no'}</td></tr>`;
        }).join('')}</table>
      <div class="months">${tr.byMonth.map((t, c) => {
        if (!t) return `<div>${MONTHS[c]}<br>–</div>`;
        const cls = t.significant ? (t.slope > 0 ? 'up' : 'down') : '';
        return `<div class="${cls}">${MONTHS[c]}<br>${t.significant ? (t.slope > 0 ? '▲' : '▼') : '·'} ${pctStr(t.pctPerYear)}</div>`;
      }).join('')}</div>
      <p class="note">Theil–Sen slope of log(1 + yearly cell-days), Mann–Kendall test, complete years only. Coloured months: significant (p &lt; 0.05), red up, blue down. The VIIRS-only line checks that a trend does not come from the harmonization of MODIS years.</p>`
    : '<p class="note">A trend needs at least 8 complete years in the selected period.</p>';

  const anomRows = s.anomalies.length
    ? `<table><tr><th>#</th><th>Month</th><th class="num">Cell-days</th><th class="num">× typical</th><th class="num">Typical</th><th class="num">Percentile</th><th>Notes</th></tr>
      ${s.anomalies.map((a, i) => `<tr><td>${i + 1}</td><td>${monthLabel(a.month)}</td><td class="num">${fmt(a.value)}</td><td class="num">${ratioStr(a.ratio!)}</td><td class="num">${fmt(a.median!)}</td><td class="num">${Math.round(a.percentile)}%</td><td>${[a.estimated ? 'estimated' : '', a.preliminary ? 'preliminary' : '', a.lowQuality ? 'sensor problem' : ''].filter(Boolean).join(', ')}</td></tr>`).join('')}</table>
      <p class="note">× typical = (x + k) / (median + k): the month against the median of the same calendar month in the 10 years before it (k is a small constant scaled to the area, so that near-zero months do not dominate). Percentile among the same calendar month of all years.</p>`
    : '<p class="note">Not enough history in the selected period.</p>';

  const p = s.profile;
  const profileTable = `<table><tr><th>Month</th>${MONTHS.map((m) => `<th class="num">${m}</th>`).join('')}</tr>
    <tr><td>Median</td>${p.median.map((v) => `<td class="num">${fmt(v)}</td>`).join('')}</tr>
    <tr><td>Share</td>${p.share.map((v) => `<td class="num">${Math.round(v * 100)}%</td>`).join('')}</tr></table>`;

  let places = '';
  if (r.places) {
    const pl = r.places;
    const months = pl.months.filter((m) => m.years > 0);
    places = `<h2>Where fire comes back</h2>
      <p>For the main fire months: the ~1 km cells (0.01°) of the area where VIIRS S-NPP detected vegetation fire in the most years. Use them to plan patrols, prevention and checks on the ground.</p>
      ${months.map((m) => `
        <h3 style="font-size:15px;margin:16px 0 4px">${MONTHS_LONG[m.cal]} (${m.years} years, ${m.firstYear}–${m.lastYear})</h3>
        <p class="note">${m.cells.toLocaleString('en-US')} cells with fire in at least 2 ${plural(m.cal)}; ${m.half.toLocaleString('en-US')} in at least half of them.</p>
        ${m.top.length ? `<div class="places"><div>${placesSvg(r.shape, m, pl.yearRound)}
          <p class="note key"><span><i class="sw" style="background:#e8432e;border-radius:50%"></i>recurrent place (size = share of years)</span>${pl.yearRound.length ? '<span><i class="sw" style="border:2px solid #0aa3c2;border-radius:50%"></i>year-round fire</span>' : ''}</p></div>
          <div><table><tr><th>#</th><th>Cell centre</th><th class="num">Years with fire</th><th>Map</th></tr>
          ${m.top.map((q, k) => `<tr><td>${k + 1}</td><td>${lonLatStr(q.lat, q.lon)}</td><td class="num">${q.years} of ${m.years}</td><td><a href="${osm(q.lat, q.lon)}">OSM</a></td></tr>`).join('')}
          </table></div></div>` : '<p class="note">No cell with fire in 2 or more years.</p>'}`).join('')}
      ${pl.yearRound.length ? `<h3 style="font-size:15px;margin:16px 0 4px">Year-round fire (likely industrial)</h3>
        <p class="note">Fire in at least 10% of all months and in 9 or more calendar months: steelworks, refineries, gas flares, landfills. Vegetation fire statistics already exclude them (FIRMS type 0 and an industrial mask).</p>
        <table><tr><th>#</th><th>Cell centre</th><th class="num">Months with fire</th><th class="num">Calendar months</th><th>Map</th></tr>
        ${pl.yearRound.slice(0, 15).map((c, k) => `<tr><td>${k + 1}</td><td>${lonLatStr(c.lat, c.lon)}</td><td class="num">${Math.round(c.share * 100)}%</td><td class="num">${c.cal}</td><td><a href="${osm(c.lat, c.lon)}">OSM</a></td></tr>`).join('')}
        </table>${pl.yearRound.length > 15 ? `<p class="note">${pl.yearRound.length - 15} more not listed.</p>` : ''}` : ''}`;
  }

  const vfirst = monthLabel(r.model.viirs_first_month);
  const est = h.estimated.some((e, i) => e && i >= r.fromIdx && i <= r.toIdx);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fire activity report: ${esc(r.title)}</title><style>${CSS}</style></head>
<body><main>
<h1>Fire activity report: ${esc(r.title)}</h1>
<p class="meta">${esc(period)} · data through ${esc(r.dataThrough)} · generated ${esc(r.generated)} UTC · <a href="${esc(r.appUrl)}">open in Seamless Fire</a></p>
<p class="meta">${esc(r.areaNote)}</p>
<ul class="summary">${s.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
<p class="note">Unit: <b>fire cell-days</b> = days with at least one vegetation fire detection in a 0.1° cell (about 11 × 7 km), summed over the area: how widespread fire activity was, not burned area or the size of one fire. Values are on the VIIRS S-NPP scale; ${est ? `months before ${vfirst} are estimated from MODIS with the harmonization model (~80% interval)` : 'all months in this period are observed by VIIRS'}.${r.isArea ? ' Custom area: before VIIRS the area gets its share of the country estimate, so the uncertainty is higher than for a country.' : ''}</p>

<h2>Calendar</h2>
${calendarSvg(h, r.fromIdx, r.toIdx)}
<p class="note">Fire cell-days per month (log colour scale). ${est ? 'Above the red line: estimated from MODIS; below: observed VIIRS. ' : ''}× = month with a known sensor problem; … = month to date.</p>

<h2>Fire season</h2>
${profileSvg(p, s.season)}
${profileTable}
<p class="note">Median and usual range (P10–P90, red) of each calendar month over ${p.years.length} complete years${p.years.length ? ` (${p.years[0]}–${p.years[p.years.length - 1]})` : ''}; shaded: main fire months (the fewest months holding ${Math.round(SEASON_SHARE * 100)}% of the yearly total). Share = mean month / sum of the monthly means.</p>

<h2>Year by year and trend</h2>
${annualSvg(r.annual, tr)}
<p class="note">Grey: estimated from MODIS, dark blue: observed VIIRS; light bars: partial years. Red whiskers: ~80% interval. Dashed red: trend; dotted orange: trend of the VIIRS years only.</p>
${trendRows}

<h2>Most unusual months</h2>
${anomRows}

${places}

<h2>Method and sources</h2>
<p>MODIS (Terra, Aqua, 1 km, from 2000) and VIIRS (375 m, from 2012) see fire differently, so their records cannot be joined directly. Seamless Fire counts cell-days per sensor, keeps only vegetation fires (FIRMS type 0, plus a mask of industrial cells for near real-time rows) and puts MODIS on the VIIRS scale with a per-country, per-season model, <code>log(1 + VIIRS) = a[season] + b · log(1 + MODIS)</code>, chosen and checked by leave-one-year-out validation on 2012–2025 (${esc(r.modelNote)}). From November 2026 NOAA-20 near real-time data continue the VIIRS series with a per-country factor; recent days are preliminary.</p>
<p class="note">Validation and limitations: <a href="https://github.com/figielak/seamless-fire/blob/main/docs/validation.md">docs/validation.md</a>. Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m S-NPP and NOAA-20). We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS). Country borders: Natural Earth. Recurrence: VIIRS S-NPP vegetation detections since February 2012, July–August 2022 left out (sensor outage).</p>
<footer>Seamless Fire · https://figielak.github.io/seamless-fire/ · open source (Apache 2.0). Report generated in the browser from the site's data; it contains no tracking and needs no internet connection.</footer>
</main></body></html>`;
}
