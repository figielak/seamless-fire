// Files that travel with an exported CSV: README.txt (what the columns mean, units, time zone,
// empty values, flags, the area and the data date) and area.geojson (the selected area).
// Pure functions, tested in exportdoc.test.ts.

import type { BBox, Shape } from './geo.ts';

export interface ExportInfo {
  kind: 'monthly' | 'hotspots';
  csvName: string;
  rows: number;
  country: string; // "Portugal" / "All countries (8)"
  area: string; // one sentence, e.g. 'Area: polygon with 7 vertices drawn on the map (...), in Portugal.'
  isArea: boolean; // custom area or preset (not the whole country)
  from: string; // YYYY-MM
  to: string; // YYYY-MM
  created: string; // ISO date-time of the export
  dataThrough: string; // last day with fire data, YYYY-MM-DD
  lastComplete: string; // last complete month of the archive, YYYY-MM
  model: string; // "D" / "E" / "per country"
  viewUrl: string; // link that reopens this view
  methodUrl: string;
}

const MONTHLY_COLUMNS: [string, string][] = [
  ['month', 'Calendar month, YYYY-MM.'],
  ['harmonized_celldays', 'Fire cell-days in the area on the VIIRS S-NPP scale. Observed VIIRS from Feb 2012; before that estimated from MODIS by the harmonization model. Use this column to compare years.'],
  ['lo80, hi80', 'About 80% interval of harmonized_celldays. Equal to harmonized_celldays for observed months.'],
  ['estimated', '1 = estimated from MODIS (before VIIRS), 0 = observed.'],
  ['modis_celldays', 'Raw MODIS cell-days (Terra + Aqua) in the area, before harmonization. Not on the VIIRS scale.'],
  ['viirs_celldays', 'Raw VIIRS cell-days in the area: S-NPP, or in the near real-time period NOAA-20 x the per-country factor.'],
  ['viirs_detections', 'Raw count of VIIRS vegetation fire detections (pixels) in the area: S-NPP, NOAA-20 in the near real-time period. Detections, not cell-days.'],
  ['viirs_source', '"S-NPP", "NOAA-20 x factor" (near real-time period), or empty for estimated months.'],
  ['terra_only', '1 = MODIS Terra only (before Aqua, until mid-2002); counts scaled up first, wider interval.'],
  ['low_quality', '1 = month with a known sensor problem: Jan-Oct 2000 (early Terra), Aug-Sep 2020 (Aqua), Jul-Aug 2022 (S-NPP outage).'],
  ['preliminary', '1 = near real-time data, may still change.'],
  ['month_to_date', '1 = current month, not complete yet (only the days through the data date).'],
];

const HOTSPOT_COLUMNS: [string, string][] = [
  ['date', 'Acquisition date, YYYY-MM-DD, UTC.'],
  ['time', 'Acquisition time, HHMM, UTC (leading zeros kept, e.g. 0039 = 00:39 UTC).'],
  ['lat, lon', 'Centre of the fire pixel, decimal degrees (WGS 84).'],
  ['sensor', 'Terra or Aqua (MODIS, 1 km pixels); SNPP or N20 (VIIRS S-NPP / NOAA-20, 375 m pixels).'],
  ['frp', 'Fire radiative power of the pixel, megawatts (MW).'],
];

function wrap(text: string, width = 92, indent = ''): string {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && (indent + line + ' ' + w).length > width) { out.push(indent + line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(indent + line);
  return out.join('\n');
}

export function exportReadme(x: ExportInfo): string {
  const monthly = x.kind === 'monthly';
  const cols = monthly ? MONTHLY_COLUMNS : HOTSPOT_COLUMNS;
  const p = (t: string) => wrap(t);
  const s: string[] = [];
  s.push(`Seamless Fire export: ${monthly ? 'monthly fire activity series' : 'filtered fire hotspots'}`);
  s.push('='.repeat(s[0].length), '');
  s.push(`File:          ${x.csvName} (${x.rows.toLocaleString('en-US')} rows)`);
  s.push(`Country:       ${x.country}`);
  s.push(`Period:        ${x.from} to ${x.to}`);
  s.push(`Exported:      ${x.created}`);
  s.push(`Data through:  ${x.dataThrough} (UTC); archive data complete through ${x.lastComplete}, later months preliminary`);
  if (monthly) s.push(`Model:         ${x.model}`);
  s.push(`Open view:     ${x.viewUrl}`);
  s.push(`Method:        ${x.methodUrl}`, '');
  s.push('AREA', '----', p(x.area));
  s.push(p('The exact outline is in area.geojson (WGS 84, [lon, lat]). ' + (monthly
    ? 'A 0.1° grid cell belongs to the area when its centre is inside the outline (rectangle edges inclusive).'
    : 'A hotspot belongs to the area when its own coordinates are inside the outline, so counts can differ slightly from the monthly series (cell centres) at the edge.')), '');
  if (monthly) {
    s.push('UNIT', '----');
    s.push(p('Fire cell-day = one 0.1° grid cell (about 11 km) with at least one vegetation fire detection on one day, per month summed over the area. It measures how widespread fire activity was. It is NOT burned area (hectares), NOT a number of fires and NOT damage.'), '');
    s.push(p('Harmonization: MODIS (2000-) and VIIRS (2012-) count fires very differently. Months before VIIRS are put on the VIIRS S-NPP scale with a per-country model calibrated on 2012-2025, so the whole series can be compared.' +
      (x.isArea ? ' For a custom area, estimated months get the area\'s share of the country estimate (area MODIS / country MODIS); uncertainty is higher than for a whole country.' : '')), '');
  } else {
    s.push('CONTENT', '-------');
    s.push(p('NASA FIRMS active fire detections, vegetation fires only: industrial heat sources (FIRMS type 2) removed; near real-time rows without type are removed in cells that were mostly industrial in 2012-2025. One row = one satellite pixel with fire, not one fire. 2026 has VIIRS only; the current month comes from NOAA-20 near real-time data.'), '');
  }
  s.push('COLUMNS', '-------');
  for (const [name, text] of cols) s.push(`${name}`, wrap(text, 92, '    '));
  s.push('');
  s.push('EMPTY VALUES', '------------');
  s.push(p(monthly
    ? 'An empty raw column means the sensor has no data for that month (outside its record), not zero. 0 means the sensor looked and found no fire. Flags are 1 or 0.'
    : 'No empty values. Times are UTC, not local time.'), '');
  s.push('SOURCES AND LICENCE', '-------------------');
  s.push(p('Fire data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m S-NPP and NOAA-20). Processing: Seamless Fire, code under Apache 2.0. Cite FIRMS when you use the data.'));
  return s.join('\n') + '\n';
}

export interface AreaFeature {
  name: string;
  shape: Shape | null; // null = whole country, given by its bbox only
  bbox: BBox;
}

/** GeoJSON of the area(s); a whole country is its bounding box with a note (borders are not in the site data). */
export function areaGeoJson(features: AreaFeature[]): string {
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  const box = ([w, s, e, n]: BBox) => [[[w, s], [e, s], [e, n], [w, n], [w, s]].map(([a, b]) => [r(a), r(b)])];
  return JSON.stringify({
    type: 'FeatureCollection',
    features: features.map((f) => {
      let coords: number[][][];
      let note: string;
      if (!f.shape) {
        coords = box(f.bbox);
        note = 'Whole country: the series uses the FIRMS country files; this is only the bounding box.';
      } else if (f.shape.kind === 'rect') {
        coords = box(f.shape.bbox);
        note = 'Rectangle, edges inclusive.';
      } else {
        const ring = f.shape.ring.map(([a, b]) => [r(a), r(b)]);
        const [a0, b0] = ring[0];
        const [a1, b1] = ring[ring.length - 1];
        if (a0 !== a1 || b0 !== b1) ring.push([a0, b0]);
        coords = [ring];
        note = 'Polygon.';
      }
      return { type: 'Feature', properties: { name: f.name, note }, geometry: { type: 'Polygon', coordinates: coords } };
    }),
  });
}
