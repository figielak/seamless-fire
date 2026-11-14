// CSV export: monthly series of the selected area and filtered hotspots. Pure functions,
// except exportHotspots, which takes the fetch function as an argument (testable in Node).

import { coverageSpan, monthAbs, monthStr, type Harmonized, type Model } from './harmonize.ts';

const num = (v: number, digits = 2) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));

/**
 * Monthly series in [fromIdx, toIdx]. Raw sensor columns are empty (not 0) for months outside
 * the sensor's file coverage; viirs_detections is empty when the data has no detection column.
 */
export function monthlyCsv(h: Harmonized, model: Model, fromIdx = 0, toIdx = h.value.length - 1): string {
  const first = monthAbs(h.firstMonth);
  const modisSpan = coverageSpan(model, ['Terra', 'Aqua']);
  const viirsSpan = coverageSpan(model, ['SNPP']);
  const within = (a: number, s: [number, number] | null) => !s || (a >= s[0] && a <= s[1]);
  // Live months (after last_complete_month): VIIRS = NOAA-20 cell-days × n20_factor, detections
  // are raw NOAA-20; month_to_date = the month is not complete yet.
  const lastComplete = monthAbs(model.last_complete_month);
  const rows = [
    'month,harmonized_celldays,lo80,hi80,estimated,modis_celldays,viirs_celldays,' +
      'viirs_detections,viirs_source,terra_only,low_quality,preliminary,month_to_date',
  ];
  for (let i = Math.max(fromIdx, 0); i <= Math.min(toIdx, h.value.length - 1); i++) {
    const a = first + i;
    const vOk = within(a, viirsSpan) || a > lastComplete;
    rows.push([
      monthStr(a),
      num(h.value[i]),
      num(h.lo[i]),
      num(h.hi[i]),
      h.estimated[i] ? 1 : 0,
      within(a, modisSpan) ? num(h.modis[i]) : '',
      vOk ? num(h.viirs[i]) : '',
      h.viirsDet && vOk ? num(h.viirsDet[i]) : '',
      a > lastComplete ? 'NOAA-20 x factor' : vOk && !h.estimated[i] ? 'S-NPP' : '',
      h.terraOnly[i] ? 1 : 0,
      h.lowQuality[i] ? 1 : 0,
      h.preliminary[i] ? 1 : 0,
      h.partial?.[i] ? 1 : 0,
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

export const HOTSPOT_HEADER = 'date,time,lat,lon,sensor,frp';

/** Rows of one yearly hotspot file inside the area and the month range (inclusive). */
export function filterHotspots(
  text: string,
  keep: ((lat: number, lon: number) => boolean) | null,
  from: string,
  to: string,
): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== HOTSPOT_HEADER) throw new Error(`Unexpected hotspot file header: ${lines[0]}`);
  const out: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const ym = line.slice(0, 7);
    if (ym < from || ym > to) continue;
    if (keep) {
      const f = line.split(',', 4);
      if (!keep(Number(f[2]), Number(f[3]))) continue;
    }
    out.push(line);
  }
  return out;
}

export interface HotspotJob {
  code: string;
  files: string[]; // hotspot files inside the range: years ("2020") and "live" (hotspotFiles)
  keep: ((lat: number, lon: number) => boolean) | null;
  from: string; // YYYY-MM
  to: string;
  fetchText: (path: string, signal: AbortSignal) => Promise<string>;
  signal: AbortSignal;
  onProgress?: (done: number, total: number, rows: number) => void;
}

/** Whole CSV or an error: a failed or cancelled year never yields a partial file. */
export async function exportHotspots(job: HotspotJob): Promise<{ csv: string; rows: number }> {
  const rows: string[] = [HOTSPOT_HEADER];
  for (let k = 0; k < job.files.length; k++) {
    job.signal.throwIfAborted();
    const text = await job.fetchText(`${job.code}/hotspots/${job.files[k]}.csv`, job.signal);
    rows.push(...filterHotspots(text, job.keep, job.from, job.to));
    job.onProgress?.(k + 1, job.files.length, rows.length - 1);
  }
  job.signal.throwIfAborted();
  return { csv: rows.join('\n') + '\n', rows: rows.length - 1 };
}

/** Hotspot files for the month range: yearly files, then "live" (near real-time period after
 * last_complete_month, hotspots/live.csv) when the range reaches into it. */
export function hotspotFiles(model: Model, from: string, to: string): string[] {
  const files = hotspotYears(model, from, to).map(String);
  if (model.hotspots && model.live && to > model.last_complete_month) files.push('live');
  return files;
}

/** Years with hotspot files that overlap the month range. */
export function hotspotYears(model: Model, from: string, to: string): number[] {
  if (!model.hotspots) return [];
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  return Object.keys(model.hotspot_sensors ?? {})
    .map(Number)
    .filter((y) => y >= y0 && y <= y1)
    .sort((a, b) => a - b);
}
