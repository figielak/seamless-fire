// All data paths go through BASE_URL so the site works under a GitHub Pages subpath.
import type { Cells, Model } from './harmonize.ts';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export function dataUrl(path: string): string {
  return `${BASE}data/${path.replace(/^\//, '')}`;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path));
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export interface Country {
  code: string;
  name: string;
  bbox: [number, number, number, number]; // W, S, E, N
}

export interface CountryData {
  code: string;
  cells: Cells;
  model: Model;
  timing: { fetchMs: number; parseMs: number; bytes: number };
}

// Cache keeps pending requests too (switching back and forth does not refetch);
// failed entries are removed so a retry can succeed.
const cache = new Map<string, Promise<CountryData>>();

async function fetchCountry(code: string): Promise<CountryData> {
  const t0 = performance.now();
  const [cellsRes, model] = await Promise.all([
    fetch(dataUrl(`${code}/cells.json`)),
    fetchJson<Model>(`${code}/model.json`),
  ]);
  if (!cellsRes.ok) throw new Error(`Failed to load ${code}/cells.json: ${cellsRes.status}`);
  const text = await cellsRes.text();
  const t1 = performance.now();
  const cells = JSON.parse(text) as Cells;
  const t2 = performance.now();
  const timing = { fetchMs: t1 - t0, parseMs: t2 - t1, bytes: text.length };
  console.info(
    `[seamless-fire] ${code}: fetch ${timing.fetchMs.toFixed(0)} ms, ` +
      `parse ${timing.parseMs.toFixed(0)} ms, ${(timing.bytes / 1e6).toFixed(1)} MB`,
  );
  return { code, cells, model, timing };
}

export function loadCountry(code: string): Promise<CountryData> {
  let p = cache.get(code);
  if (!p) {
    p = fetchCountry(code);
    cache.set(code, p);
    p.catch(() => cache.delete(code));
  }
  return p;
}
