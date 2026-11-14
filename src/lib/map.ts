// Main map (browser only, loaded lazily): satellite base map, fire cell layer, the selected
// area, and polygon drawing by clicking. No drawing plugin: click = vertex, double-click or
// "Finish" = close. Leaflet uses [lat, lon]; the rest of the site uses [lon, lat] (see geo.ts).

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { normalizeRing, shapeBBox, type BBox, type LonLat, type Shape } from './geo.ts';
import { cellLookup, type CellLayer } from './cellmap.ts';

// Map view per country when the data bbox is a poor view (PT includes Azores and Madeira).
const VIEW: Record<string, BBox> = { PT: [-9.6, 36.9, -6.1, 42.2] };

const AREA_STYLE: L.PathOptions = { color: '#e8432e', weight: 2, fillOpacity: 0.12 };
const DRAFT_STYLE: L.PathOptions = { color: '#e8432e', weight: 2, dashArray: '4 4' };

const toLatLngs = (ring: LonLat[]) => ring.map(([lon, lat]) => L.latLng(lat, lon));
const bounds = (b: BBox) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

export interface AreaMapOptions {
  onPolygon: (ring: LonLat[]) => void; // a finished, valid polygon
  onDrawState: (drawing: boolean, points: number) => void;
  // Space covered by floating panels (pixels), so fitted views stay visible.
  padding: () => { topLeft: [number, number]; bottomRight: [number, number] };
}

// Fire colour ramp: upper part of matplotlib "inferno" (visible on dark imagery and on OSM).
const INFERNO: [number, number, number][] = [
  [147, 38, 103], [188, 55, 84], [221, 81, 58], [243, 120, 25], [252, 165, 10], [246, 215, 70], [252, 255, 164],
];

export function fireColor(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (INFERNO.length - 1);
  const i = Math.min(Math.floor(x), INFERNO.length - 2);
  const f = x - i;
  const c = INFERNO[i].map((v, k) => Math.round(v + (INFERNO[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Log colour position of a value: log1p(v) / log1p(max). */
export const fireT = (v: number, max: number) => (max > 0 ? Math.log1p(v) / Math.log1p(max) : 0);

/** Canvas layer with one rectangle per 0.1° cell, redrawn after each move or zoom. */
class CellCanvas extends L.Layer {
  private canvas = L.DomUtil.create('canvas', 'cell-canvas') as HTMLCanvasElement;
  private data: CellLayer | null = null;
  private colors: string[] = [];

  /** Colours on a fixed scale [0, max] (same for every country); larger values get the top colour. */
  setData(data: CellLayer | null, max: number) {
    this.data = data;
    this.colors = [];
    if (data) for (let j = 0; j < data.value.length; j++) this.colors.push(fireColor(fireT(data.value[j], max)));
    if (this._map) this.redraw();
  }

  onAdd(map: L.Map) {
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.opacity = '0.85';
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on('moveend zoomend resize viewreset', this.redraw, this);
    map.on('zoomstart', this.hide, this);
    this.redraw();
    return this;
  }

  onRemove(map: L.Map) {
    this.canvas.remove();
    map.off('moveend zoomend resize viewreset', this.redraw, this);
    map.off('zoomstart', this.hide, this);
    return this;
  }

  private hide() {
    this.canvas.style.visibility = 'hidden';
  }

  private redraw() {
    const map = this._map;
    if (!map) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    this.canvas.width = size.x * dpr;
    this.canvas.height = size.y * dpr;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    this.canvas.style.visibility = '';
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const d = this.data;
    if (!d) return;
    const b = map.getBounds();
    const deg = d.cellDeg;
    const [s, n, w, e] = [b.getSouth() - deg, b.getNorth(), b.getWest() - deg, b.getEast()];
    for (let j = 0; j < d.value.length; j++) {
      const lat0 = d.lat[j] * deg;
      const lon0 = d.lon[j] * deg;
      if (lat0 < s || lat0 > n || lon0 < w || lon0 > e) continue;
      const p1 = map.latLngToContainerPoint([lat0 + deg, lon0]);
      const p2 = map.latLngToContainerPoint([lat0, lon0 + deg]);
      ctx.fillStyle = this.colors[j];
      ctx.fillRect(p1.x, p1.y, Math.max(p2.x - p1.x, 1.5), Math.max(p2.y - p1.y, 1.5));
    }
  }
}

export class AreaMap {
  private map: L.Map;
  private areaLayer: L.Layer | null = null;
  private countryLayer: L.Rectangle | null = null;
  private draft: LonLat[] = [];
  private draftLayer: L.Layer | null = null;
  private drawing = false;
  private lastView = '';
  private cells = new CellCanvas();
  private legend: HTMLElement;
  private lookup: ((lat: number, lon: number) => number) | null = null;
  private layerInfo = { title: '', unit: '', max: 0, empty: true };

  constructor(el: HTMLElement, private opts: AreaMapOptions) {
    this.map = L.map(el, { zoomSnap: 0.25, worldCopyJump: true, zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    const eox = 'Sentinel-2 cloudless 2020 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2020)';
    const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const satellite = L.layerGroup([
      L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', {
        maxZoom: 15, attribution: eox,
      }),
      L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/overlay_bright_3857/default/g/{z}/{y}/{x}.png', {
        maxZoom: 15, attribution: `Labels ${osmAttr}`,
      }),
    ]);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: osmAttr });
    satellite.addTo(this.map);
    this.cells.addTo(this.map);
    L.control.layers({ Satellite: satellite, 'Street map': osm }, { 'Fire cells': this.cells }, { position: 'topright' })
      .addTo(this.map);

    const Legend = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'map-legend');
        L.DomEvent.disableClickPropagation(div);
        return div;
      },
    });
    const legendCtl = new Legend({ position: 'bottomleft' });
    legendCtl.addTo(this.map);
    this.legend = legendCtl.getContainer()!;
    this.map.on('mousemove', (e: L.LeafletMouseEvent) => this.hover(e.latlng));
    this.map.on('mouseout', () => this.hover(null));

    this.map.on('click', (e: L.LeafletMouseEvent) => this.addPoint(e.latlng));
    this.map.on('dblclick', () => this.finish());
    this.map.setView([50, 15], 4);
  }

  /**
   * Fire cell layer on a fixed colour scale [0, scale.max] shared by all countries.
   * Title says what it shows (month or period, observed or estimated); unit labels the values.
   */
  setCells(layer: CellLayer | null, title: string, scale: { max: number; unit: string }) {
    this.cells.setData(layer, scale.max);
    this.lookup = layer ? cellLookup(layer) : null;
    this.layerInfo = { title, unit: scale.unit, max: scale.max, empty: !layer || layer.value.length === 0 };
    this.hover(null);
  }

  private hover(ll: L.LatLng | null) {
    const { title, unit, max, empty } = this.layerInfo;
    const ticks = [1, 3, 10].filter((t) => t < max * 0.8);
    const ramp = Array.from({ length: 11 }, (_, i) => fireColor(i / 10)).join(',');
    let cell = 'Hover a cell for its value';
    if (ll && this.lookup) {
      const v = this.lookup(ll.lat, ll.lng);
      const lat0 = Math.floor(ll.lat * 10 + 1e-9) / 10;
      const lon0 = Math.floor(ll.lng * 10 + 1e-9) / 10;
      cell = `Cell ${lat0.toFixed(1)}…${(lat0 + 0.1).toFixed(1)}°, ${lon0.toFixed(1)}…${(lon0 + 0.1).toFixed(1)}°: ` +
        `<b>${v >= 10 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)}</b>`;
    }
    this.legend.innerHTML = `<div class="lg-title">${title}</div>
        <div class="lg-bar" style="background:linear-gradient(90deg,${ramp})"></div>
        <div class="lg-ticks"><span>0</span>${ticks.map((t) =>
          `<span style="left:${(fireT(t, max) * 100).toFixed(1)}%">${t}</span>`).join('')}
          <span style="left:100%">${max}+</span></div>
        <div class="lg-unit">${unit}; same scale for all countries</div>
        <div class="lg-cell">${empty ? 'No fire cells in this selection' : cell}</div>`;
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
      const pad = this.opts.padding();
      this.map.fitBounds(b, { paddingTopLeft: pad.topLeft, paddingBottomRight: pad.bottomRight, maxZoom: 11 });
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
