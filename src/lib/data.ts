// All data paths go through BASE_URL so the site works under a GitHub Pages subpath.
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
