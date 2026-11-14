// Area map (browser only, loaded lazily): shows the selected area and lets the user draw a
// polygon by clicking. No drawing plugin: click = vertex, double-click or "Finish" = close.
// Leaflet uses [lat, lon]; the rest of the site uses [lon, lat] (see geo.ts).

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { normalizeRing, shapeBBox, type BBox, type LonLat, type Shape } from './geo.ts';

// Map view per country when the data bbox is a poor view (PT includes Azores and Madeira).
const VIEW: Record<string, BBox> = { PT: [-9.6, 36.9, -6.1, 42.2] };

const AREA_STYLE: L.PathOptions = { color: '#e8432e', weight: 2, fillOpacity: 0.12 };
const DRAFT_STYLE: L.PathOptions = { color: '#e8432e', weight: 2, dashArray: '4 4' };

const toLatLngs = (ring: LonLat[]) => ring.map(([lon, lat]) => L.latLng(lat, lon));
const bounds = (b: BBox) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

export interface AreaMapOptions {
  onPolygon: (ring: LonLat[]) => void; // a finished, valid polygon
  onDrawState: (drawing: boolean, points: number) => void;
}

export class AreaMap {
  private map: L.Map;
  private areaLayer: L.Layer | null = null;
  private countryLayer: L.Rectangle | null = null;
  private draft: LonLat[] = [];
  private draftLayer: L.Layer | null = null;
  private drawing = false;
  private lastView = '';

  constructor(el: HTMLElement, private opts: AreaMapOptions) {
    this.map = L.map(el, { zoomSnap: 0.25, worldCopyJump: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => this.addPoint(e.latlng));
    this.map.on('dblclick', () => this.finish());
    this.map.setView([50, 15], 4);
  }

  /** Show the country frame and the area; fit the view when the selection changed. */
  show(code: string, countryBBox: BBox, shape: Shape | null) {
    this.countryLayer?.remove();
    this.countryLayer = L.rectangle(bounds(countryBBox), {
      color: '#57606a', weight: 1, fill: false, dashArray: '2 4', interactive: false,
    }).addTo(this.map);
    this.areaLayer?.remove();
    this.areaLayer = null;
    if (shape) {
      this.areaLayer = (shape.kind === 'rect'
        ? L.rectangle(bounds(shape.bbox), { ...AREA_STYLE, interactive: false })
        : L.polygon(toLatLngs(shape.ring), { ...AREA_STYLE, interactive: false })
      ).addTo(this.map);
    }
    const key = JSON.stringify([code, shape]);
    if (key !== this.lastView && !this.drawing) {
      this.lastView = key;
      const b = shape ? bounds(shapeBBox(shape)) : bounds(VIEW[code] ?? countryBBox);
      this.map.fitBounds(b, { padding: [16, 16], maxZoom: 11 });
    }
  }

  /** Leaflet measures the container at creation; call after it becomes visible or resizes. */
  resize() {
    this.map.invalidateSize();
  }

  startDrawing() {
    this.drawing = true;
    this.draft = [];
    this.map.doubleClickZoom.disable();
    this.map.getContainer().style.cursor = 'crosshair';
    this.redrawDraft();
  }

  cancelDrawing() {
    this.drawing = false;
    this.draft = [];
    this.map.doubleClickZoom.enable();
    this.map.getContainer().style.cursor = '';
    this.redrawDraft();
  }

  /** Close the polygon; keeps drawing when it has fewer than 3 different points. */
  finish() {
    if (!this.drawing) return;
    let ring: LonLat[];
    try {
      ring = normalizeRing(dedupe(this.draft));
    } catch {
      return;
    }
    this.cancelDrawing();
    this.opts.onPolygon(ring);
  }

  undo() {
    if (!this.drawing) return;
    this.draft.pop();
    this.redrawDraft();
  }

  private addPoint(ll: L.LatLng) {
    if (!this.drawing) return;
    const w = ll.wrap();
    const p: LonLat = [round(w.lng), round(w.lat)];
    const last = this.draft.at(-1);
    if (last && last[0] === p[0] && last[1] === p[1]) return; // second click of a double-click
    this.draft.push(p);
    this.redrawDraft();
  }

  private redrawDraft() {
    this.draftLayer?.remove();
    this.draftLayer = null;
    if (this.drawing && this.draft.length) {
      const pts = toLatLngs(this.draft);
      this.draftLayer = (this.draft.length >= 3
        ? L.polygon(pts, { ...DRAFT_STYLE, fillOpacity: 0.08, interactive: false })
        : L.polyline(pts, { ...DRAFT_STYLE, interactive: false })
      ).addTo(this.map);
    }
    this.opts.onDrawState(this.drawing, this.draft.length);
  }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

function dedupe(pts: LonLat[]): LonLat[] {
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
}
