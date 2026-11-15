// Nearest named place (GeoNames town or village, >= 1000 people) for a point, e.g.
// "4 km NE of Monchique, Faro". Data: public/data/{CC}/places.json (pipeline/places.py).

export interface PlaceNames {
  source: string;
  regions: string[];
  lat: number[];
  lon: number[];
  name: string[];
  r: number[];
}

export interface NearPlace {
  name: string;
  region: string;
  km: number; // distance from the place to the point
  dir: string; // direction of the point as seen from the place: N, NE, ...
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const KM_PER_DEG = 111.32;

/** Nearest place to (lat, lon); null when there are no places. Flat-earth distance, fine below ~100 km. */
export function nearestPlace(p: PlaceNames, lat: number, lon: number): NearPlace | null {
  const c = Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < p.lat.length; i++) {
    const dy = p.lat[i] - lat;
    const dx = (p.lon[i] - lon) * c;
    const d = dy * dy + dx * dx;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;
  const dy = (lat - p.lat[best]) * KM_PER_DEG;
  const dx = (lon - p.lon[best]) * c * KM_PER_DEG;
  const km = Math.hypot(dx, dy);
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { name: p.name[best], region: p.regions[p.r[best]] ?? '', km, dir: DIRS[Math.round(bearing / 45) % 8] };
}

/** "4 km NE of Monchique" / "at Monchique" (under 1 km). */
export function placeText(n: NearPlace): string {
  return n.km < 1 ? `at ${n.name}` : `${Math.round(n.km)} km ${n.dir} of ${n.name}`;
}
