// Custom areas: geometry, presets and the URL hash. Pure functions (tested in Node).
// Coordinates are always [lon, lat] (GeoJSON order); rectangles are [W, S, E, N].
// A 0.1° cell belongs to an area when its center is inside. Rectangle edges are inclusive.
// Polygons use even-odd ray casting; cell centers lie on x.x5°, preset vertices do not,
// so the polygon edge rule has no practical effect. Mirrors pipeline/area.py.

import presetsJson from './presets.json' with { type: 'json' };

export type LonLat = [number, number];
export type BBox = [number, number, number, number]; // W, S, E, N

export type Shape = { kind: 'rect'; bbox: BBox } | { kind: 'polygon'; ring: LonLat[] };

export interface Preset {
  id: string;
  name: string;
  country: string;
  note: string;
  bbox?: BBox;
  polygon?: LonLat[];
}

/** Selected area: whole country, a shape, or a preset (resolved to its shape). */
export type AreaSpec =
  | { kind: 'country' }
  | { kind: 'shape'; shape: Shape }
  | { kind: 'preset'; id: string };

export const PRESETS: Preset[] = presetsJson as Preset[];

export function presetShape(p: Preset): Shape {
  return p.bbox ? { kind: 'rect', bbox: p.bbox } : { kind: 'polygon', ring: p.polygon! };
}

export class AreaError extends Error {}

const finite = (...v: number[]) => v.every((x) => Number.isFinite(x));

/** Rectangle with swapped bounds put in order; error on non-numbers or zero size. */
export function normalizeRect(b: number[]): BBox {
  if (b.length !== 4 || !finite(...b)) throw new AreaError('Rectangle needs four numbers (W, S, E, N).');
  let [w, s, e, n] = b;
  if (w > e) [w, e] = [e, w];
  if (s > n) [s, n] = [n, s];
  if (w < -180 || e > 180 || s < -90 || n > 90) throw new AreaError('Rectangle is outside -180..180, -90..90.');
  if (w === e || s === n) throw new AreaError('Rectangle has zero width or height.');
  return [w, s, e, n];
}

/** Polygon ring without a repeated closing vertex; error with fewer than 3 distinct vertices. */
export function normalizeRing(ring: number[][]): LonLat[] {
  const pts = ring.filter((p) => p.length === 2 && finite(p[0], p[1])) as LonLat[];
  if (pts.length !== ring.length) throw new AreaError('Polygon has invalid coordinates.');
  const out = pts.slice();
  if (out.length > 1 && out[0][0] === out.at(-1)![0] && out[0][1] === out.at(-1)![1]) out.pop();
  const distinct = new Set(out.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) throw new AreaError('Polygon needs at least 3 different points.');
  return out;
}

export function shapeBBox(s: Shape): BBox {
  if (s.kind === 'rect') return s.bbox;
  const lons = s.ring.map((p) => p[0]);
  const lats = s.ring.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function bboxOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function inPolygon(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    if (y1 > lat !== y2 > lat && lon < x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/** Filter for monthlyTotals / hotspots: (lat, lon) -> inside. Bounding box checked first. */
export function keepFn(s: Shape): (lat: number, lon: number) => boolean {
  const [w, so, e, n] = shapeBBox(s);
  if (s.kind === 'rect') return (lat, lon) => lon >= w && lon <= e && lat >= so && lat <= n;
  const ring = s.ring;
  return (lat, lon) => lon >= w && lon <= e && lat >= so && lat <= n && inPolygon(lon, lat, ring);
}

// ------------------------------------------------------------------ URL hash
// #PL&area=r:W,S,E,N | p:lon,lat;lon,lat;... | preset:id &from=YYYY-MM&to=YYYY-MM

export interface ViewState {
  code: string;
  area: AreaSpec;
  from?: string;
  to?: string;
}

export interface ParsedHash extends ViewState {
  error?: string; // invalid part was dropped (state falls back to the whole country / full range)
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

export function parseArea(v: string): AreaSpec {
  const [kind, rest = ''] = v.split(/:(.*)/s);
  if (kind === 'r') return { kind: 'shape', shape: { kind: 'rect', bbox: normalizeRect(rest.split(',').map(num)) } };
  if (kind === 'p') {
    const ring = rest.split(';').map((p) => p.split(',').map(num));
    return { kind: 'shape', shape: { kind: 'polygon', ring: normalizeRing(ring) } };
  }
  if (kind === 'preset') {
    if (!PRESETS.some((p) => p.id === rest)) throw new AreaError(`Unknown preset "${rest}".`);
    return { kind: 'preset', id: rest };
  }
  throw new AreaError('Unknown area format in the link.');
}

export function parseHash(hash: string): ParsedHash {
  const parts = hash.replace(/^#/, '').split('&');
  const out: ParsedHash = { code: (parts[0] ?? '').toUpperCase(), area: { kind: 'country' } };
  const errors: string[] = [];
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const val = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1));
    try {
      if (key === 'area') out.area = parseArea(val);
      else if (key === 'from' || key === 'to') {
        if (!MONTH_RE.test(val)) throw new AreaError(`Invalid month "${val}".`);
        out[key] = val;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (out.from && out.to && out.from > out.to) [out.from, out.to] = [out.to, out.from];
  if (errors.length) out.error = errors.join(' ');
  return out;
}

const r5 = (x: number) => String(Math.round(x * 1e5) / 1e5);

export function areaToString(a: AreaSpec): string | null {
  if (a.kind === 'country') return null;
  if (a.kind === 'preset') return `preset:${a.id}`;
  const s = a.shape;
  return s.kind === 'rect' ? `r:${s.bbox.map(r5).join(',')}` : `p:${s.ring.map((p) => `${r5(p[0])},${r5(p[1])}`).join(';')}`;
}

export function serializeHash(v: ViewState): string {
  const parts = [v.code];
  const a = areaToString(v.area);
  if (a) parts.push(`area=${a}`);
  if (v.from) parts.push(`from=${v.from}`);
  if (v.to) parts.push(`to=${v.to}`);
  return `#${parts.join('&')}`;
}

/** Shape of an area spec (null = whole country). */
export function resolveShape(a: AreaSpec): Shape | null {
  if (a.kind === 'country') return null;
  if (a.kind === 'shape') return a.shape;
  const p = PRESETS.find((x) => x.id === a.id);
  if (!p) throw new AreaError(`Unknown preset "${a.id}".`);
  return presetShape(p);
}
