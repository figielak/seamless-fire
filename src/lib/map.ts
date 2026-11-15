// Main map (browser only, loaded lazily): satellite base map, fire cell layer, the selected
// area, and polygon drawing by clicking. No drawing plugin: click = vertex, double-click or
// "Finish" = close. Leaflet uses [lat, lon]; the rest of the site uses [lon, lat] (see geo.ts).

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { normalizeRing, shapeBBox, type BBox, type LonLat, type Shape } from './geo.ts';
import { cellLookup, type CellLayer, type YearRoundCell } from './cellmap.ts';

// Ring around a year-round fire cell (likely industrial): cyan, hollow, visible at any zoom.
// Small at country/world zoom (hundreds of rings in AU and "All countries"), larger when zoomed in.
function ringStyle(zoom: number): L.CircleMarkerOptions {
  return {
    radius: zoom >= 9 ? 7 : zoom >= 6 ? 4.5 : 2.5, weight: zoom >= 6 ? 2 : 1.2,
    color: '#22d3ee', fill: true, fillOpacity: 0, opacity: 0.95,
  };
}

// Map view per country when the data bbox is a poor view (PT includes Azores and Madeira).
const VIEW: Record<string, BBox> = { PT: [-9.6, 36.9, -6.1, 42.2] };

const AREA_STYLE: L.PathOptions = { color: '#e8432e', weight: 2, fillOpacity: 0.12 };
const DRAFT_STYLE: L.PathOptions = { color: '#e8432e', weight: 2, dashArray: '4 4' };

const toLatLngs = (ring: LonLat[]) => ring.map(([lon, lat]) => L.latLng(lat, lon));
const bounds = (b: BBox) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

/** One filtered hotspot detection (row of public/data/{CC}/hotspots/{year}.csv). */
export interface Hotspot {
  date: string;
  time: string; // HHMM, UTC
  lat: number;
  lon: number;
  sensor: string; // Terra, Aqua, SNPP, N20
  frp: number; // fire radiative power, MW
}

const SENSOR_NAME: Record<string, string> = {
  Terra: 'MODIS Terra (1 km)', Aqua: 'MODIS Aqua (1 km)', SNPP: 'VIIRS S-NPP (375 m)', N20: 'VIIRS NOAA-20 (375 m)',
};

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

/**
 * Opacity for a colour position t: very low values fade out so the base map stays readable and
 * the eye goes to the active cells (t ≈ 0.12 is about 0.5 cell-days on the 0–30 scale).
 */
export function fireAlpha(t: number): number {
  const t0 = 0.06;
  if (t <= t0) return 0;
  return Math.min(0.4 + 0.55 * ((t - t0) / 0.45), 0.95);
}

/** Log colour position of a value: log1p(v) / log1p(max). */
export const fireT = (v: number, max: number) => (max > 0 ? Math.log1p(v) / Math.log1p(max) : 0);

/** Colour scale of a cell layer: fixed [0, max], log by default; `linear` for percentages. */
export interface CellScale {
  max: number;
  unit: string;
  linear?: boolean;
  ticks?: number[]; // legend ticks between 0 and max (default 1, 3, 10)
  format?: (v: number) => string; // hover value (default: number)
}

const scaleT = (v: number, sc: CellScale) => (sc.linear ? (sc.max > 0 ? v / sc.max : 0) : fireT(v, sc.max));

const LUT_SIZE = 256;
const FIRE_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b] = fireColor(i / (LUT_SIZE - 1)).match(/\d+/g)!.map(Number);
    lut.set([r, g, b], i * 3);
  }
  return lut;
})();
const ALPHA_LUT: Float32Array = (() => {
  const a = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) a[i] = fireAlpha(i / (LUT_SIZE - 1));
  return a;
})();

/** Smooth rendering needs cells at least this many screen pixels wide; below it, rectangles. */
const SMOOTH_MIN_PX = 3;

/**
 * Canvas layer for the fire cells, redrawn after each move or zoom.
 * "smooth": colours interpolated bilinearly between cell centres (each centre keeps its exact
 * colour; opacity fades towards empty cells). "cells": one flat rectangle per 0.1° cell.
 */
class CellCanvas extends L.Layer {
  private canvas = L.DomUtil.create('canvas', 'cell-canvas') as HTMLCanvasElement;
  private data: CellLayer | null = null;
  private colors: string[] = [];
  // Dense grid for smooth mode: q = 0 empty, 1..255 = colour position t (log scale).
  private grid: { q: Uint8Array; lat0: number; lon0: number; rows: number; cols: number } | null = null;
  smooth = true;

  /** Colours on a fixed scale [0, max] (same for every country); larger values get the top colour. */
  setData(data: CellLayer | null, sc: CellScale) {
    this.data = data;
    this.colors = [];
    this.grid = null;
    if (data && data.value.length) {
      let [la0, la1, lo0, lo1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let j = 0; j < data.value.length; j++) {
        const t = scaleT(data.value[j], sc);
        this.colors.push(fireColor(t).replace('rgb(', 'rgba(').replace(')', `,${fireAlpha(t).toFixed(3)})`));
        la0 = Math.min(la0, data.lat[j]); la1 = Math.max(la1, data.lat[j]);
        lo0 = Math.min(lo0, data.lon[j]); lo1 = Math.max(lo1, data.lon[j]);
      }
      const rows = la1 - la0 + 1;
      const cols = lo1 - lo0 + 1;
      // Very wide fine grids (0.01° over several countries): skip smooth mode, draw squares.
      if (rows * cols > 30e6) {
        if (this._map) this.redraw();
        return;
      }
      const q = new Uint8Array(rows * cols);
      for (let j = 0; j < data.value.length; j++) {
        const t = Math.min(Math.max(scaleT(data.value[j], sc), 0), 1);
        q[(data.lat[j] - la0) * cols + (data.lon[j] - lo0)] = 1 + Math.round(t * 254);
      }
      this.grid = { q, lat0: la0, lon0: lo0, rows, cols };
    }
    if (this._map) this.redraw();
  }

  setSmooth(on: boolean) {
    this.smooth = on;
    if (this._map) this.redraw();
  }

  onAdd(map: L.Map) {
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
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
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    this.canvas.style.visibility = '';
    const d = this.data;
    const c = map.getCenter();
    const cellPx = d
      ? map.latLngToContainerPoint([c.lat, c.lng + d.cellDeg]).x - map.latLngToContainerPoint(c).x
      : 0;
    if (d && this.grid && this.smooth && cellPx >= SMOOTH_MIN_PX) this.drawSmooth(map, size, d.cellDeg);
    else this.drawCells(map, size);
  }

  private drawCells(map: L.Map, size: L.Point) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size.x * dpr;
    this.canvas.height = size.y * dpr;
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

  /** Bilinear interpolation per screen pixel (CSS pixels; the canvas is scaled up for HiDPI). */
  private drawSmooth(map: L.Map, size: L.Point, deg: number) {
    const W = size.x;
    const H = size.y;
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const px = img.data;
    const { q, lat0, lon0, rows, cols } = this.grid!;
    // Fractional grid position relative to cell centres; Mercator: lon depends on x only, lat on y only.
    const gx = new Float64Array(W);
    for (let x = 0; x < W; x++) gx[x] = map.containerPointToLatLng([x + 0.5, 0]).lng / deg - 0.5 - lon0;
    const gy = new Float64Array(H);
    for (let y = 0; y < H; y++) gy[y] = map.containerPointToLatLng([0, y + 0.5]).lat / deg - 0.5 - lat0;
    const at = (r: number, k: number) => (r < 0 || r >= rows || k < 0 || k >= cols ? 0 : q[r * cols + k]);
    for (let y = 0; y < H; y++) {
      const fy0 = gy[y];
      if (fy0 < -1 || fy0 > rows) continue;
      const r0 = Math.floor(fy0);
      const fy = fy0 - r0;
      for (let x = 0; x < W; x++) {
        const fx0 = gx[x];
        if (fx0 < -1 || fx0 > cols) continue;
        const k0 = Math.floor(fx0);
        const fx = fx0 - k0;
        const a = at(r0, k0), b = at(r0, k0 + 1), cc = at(r0 + 1, k0), dd = at(r0 + 1, k0 + 1);
        if ((a | b | cc | dd) === 0) continue;
        const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
        let wm = 0, tq = 0;
        if (a) { wm += wa; tq += wa * a; }
        if (b) { wm += wb; tq += wb * b; }
        if (cc) { wm += wc; tq += wc * cc; }
        if (dd) { wm += wd; tq += wd * dd; }
        if (wm <= 0) continue;
        const lj = Math.round(((tq / wm - 1) / 254) * (LUT_SIZE - 1));
        const alpha = ALPHA_LUT[lj];
        if (alpha <= 0) continue;
        const li = lj * 3;
        const o = (y * W + x) * 4;
        px[o] = FIRE_LUT[li];
        px[o + 1] = FIRE_LUT[li + 1];
        px[o + 2] = FIRE_LUT[li + 2];
        px[o + 3] = Math.round(Math.min(wm * 1.6, 1) * alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
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
  private layerInfo: { title: string; scale: CellScale; empty: boolean } | null = null;
  private cellDeg = 0.1;
  private hotRenderer = L.canvas({ padding: 0.3 });
  private hotLayer = L.layerGroup();
  private hotNote = '';
  // Year-round fire cells (likely industrial), recurrence view only: ring markers.
  private ringRenderer = L.canvas({ padding: 0.3 });
  private ringLayer = L.layerGroup();
  private ringNote = '';
  private rings = new Map<string, YearRoundCell>();
  private ringDeg = 0.01;
  // "Places to watch" (Next 7 days tab): numbered markers.
  private watchLayer = L.layerGroup();

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
        maxZoom: 15, attribution: `Labels ${osmAttr}`, className: 'labels-overlay',
      }),
    ]);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: osmAttr });
    satellite.addTo(this.map);
    this.cells.addTo(this.map);
    this.hotLayer.addTo(this.map);
    this.ringLayer.addTo(this.map);
    this.watchLayer.addTo(this.map);
    L.control.layers(
      { Satellite: satellite, 'Street map': osm },
      { 'Fire cells': this.cells, 'Hotspot points': this.hotLayer, 'Year-round fire': this.ringLayer, 'Places to watch': this.watchLayer },
      { position: 'topright' },
    ).addTo(this.map);
    this.map.on('zoomend', () => {
      this.styleHotspots();
      const st = ringStyle(this.map.getZoom());
      this.ringLayer.eachLayer((l) => (l as L.CircleMarker).setStyle(st).setRadius(st.radius!));
    });

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
    this.legend.hidden = true; // shown once the first layer arrives
    this.map.on('mousemove', (e: L.LeafletMouseEvent) => this.hover(e.latlng));
    this.map.on('mouseout', () => this.hover(null));

    this.map.on('click', (e: L.LeafletMouseEvent) => this.addPoint(e.latlng));
    this.map.on('dblclick', () => this.finish());
    // No initial view here: the first show() fits the selected country, so no tiles are
    // fetched for a view that is replaced right away. ensureView() is the fallback.
  }

  /** Default view when nothing has been shown yet (e.g. the country list failed). */
  ensureView() {
    try {
      this.map.getCenter();
    } catch {
      this.map.setView([50, 15], 4);
    }
  }

  /**
   * Fire cell layer on a fixed colour scale [0, scale.max] shared by all countries.
   * Title says what it shows (month or period, observed or estimated); unit labels the values.
   */
  setCells(layer: CellLayer | null, title: string, scale: CellScale) {
    this.cells.setData(layer, scale);
    this.lookup = layer ? cellLookup(layer) : null;
    this.cellDeg = layer?.cellDeg ?? 0.1;
    this.layerInfo = { title, scale, empty: !layer || layer.value.length === 0 };
    this.hover(null);
  }

  /**
   * Hotspot detections as points (null = none). `note` is the legend line, e.g. the count or why
   * points are missing.
   */
  setHotspots(points: Hotspot[] | null, note: string) {
    this.hotLayer.clearLayers();
    this.hotNote = note;
    for (const p of points ?? []) {
      const sensor = SENSOR_NAME[p.sensor] ?? p.sensor;
      L.circleMarker([p.lat, p.lon], { renderer: this.hotRenderer, ...this.hotStyle() })
        .bindPopup(`<b>${p.date}</b>, ${p.time.slice(0, 2)}:${p.time.slice(2)} UTC<br>${sensor}<br>` +
          `FRP ${p.frp.toFixed(1)} MW<br>${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°`)
        .addTo(this.hotLayer);
    }
    this.hover(null);
  }

  /**
   * Year-round fire cells (null = none): fire in many months of every season, usually an industrial
   * source FIRMS did not flag. `note` is the legend line; `deg` the grid of the cells.
   */
  setYearRound(cells: YearRoundCell[] | null, note: string, deg = 0.01) {
    this.ringLayer.clearLayers();
    this.rings.clear();
    this.ringNote = note;
    this.ringDeg = deg;
    for (const c of cells ?? []) {
      this.rings.set(this.ringKey(c.lat, c.lon), c);
      L.circleMarker([c.lat, c.lon], { renderer: this.ringRenderer, ...ringStyle(this.map.getZoom?.() ?? 6) })
        .bindPopup(`<b>Year-round fire</b>, likely industrial<br>Fire in ${Math.round(c.share * 100)}% of all months, ` +
          `${c.cal} of 12 calendar months<br>${c.lat.toFixed(3)}°, ${c.lon.toFixed(3)}° (0.01° cell)<br>` +
          `<span class="pop-note">Not typical of vegetation fires. Check the site before treating it as fire risk.</span>`)
        .addTo(this.ringLayer);
    }
    this.hover(null);
  }

  /** Numbered markers of the places to watch (null = remove). Popup = `info` of each place. */
  setWatch(places: { lat: number; lon: number; info: string }[] | null) {
    this.watchLayer.clearLayers();
    (places ?? []).forEach((p, i) => {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: 'watch-pin', html: `<span>${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
        title: `Place to watch ${i + 1}`, keyboard: true,
      }).bindPopup(p.info).addTo(this.watchLayer);
    });
  }

  private ringKey(lat: number, lon: number) {
    const d = this.ringDeg;
    return `${Math.floor(lat / d + 1e-9)},${Math.floor(lon / d + 1e-9)}`;
  }

  private hotStyle(): L.CircleMarkerOptions {
    const z = this.map.getZoom?.() ?? 6;
    return {
      radius: z >= 10 ? 5 : z >= 8 ? 3.5 : 2.2,
      color: '#0b1a2b', weight: z >= 8 ? 1.2 : 0.8, fillColor: '#ffffff', fillOpacity: 0.95,
    };
  }

  private styleHotspots() {
    const st = this.hotStyle();
    this.hotLayer.eachLayer((l) => (l as L.CircleMarker).setStyle(st).setRadius(st.radius!));
  }

  /** "Smooth" (blended between cell centres) or "Cells" (one square per 0.1° cell). */
  setSmooth(on: boolean) {
    this.cells.setSmooth(on);
  }

  private hover(ll: L.LatLng | null) {
    if (!this.layerInfo) return;
    this.legend.hidden = false;
    const { title, scale, empty } = this.layerInfo;
    const { unit, max } = scale;
    const ticks = (scale.ticks ?? [1, 3, 10]).filter((t) => t < max * 0.8);
    const ramp = Array.from({ length: 11 }, (_, i) => {
      const c = fireColor(i / 10);
      return c.replace('rgb(', 'rgba(').replace(')', `,${Math.max(fireAlpha(i / 10), 0.12).toFixed(2)})`);
    }).join(',');
    let cell = 'Hover the map for a cell value';
    if (ll && this.lookup) {
      const v = this.lookup(ll.lat, ll.lng);
      // cell centre, e.g. "23.35°S 2.95°W"
      const step = this.cellDeg;
      const lat = (Math.floor(ll.lat / step + 1e-9) + 0.5) * step;
      const lon = (Math.floor(ll.lng / step + 1e-9) + 0.5) * step;
      const dp = step < 0.05 ? 3 : 2;
      const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(dp)}°${v < 0 ? neg : pos}`;
      cell = `${deg(lat, 'N', 'S')} ${deg(lon, 'E', 'W')}: ` +
        `<b>${scale.format ? scale.format(v) : v >= 10 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)}</b>`;
      const ring = this.rings.size ? this.rings.get(this.ringKey(ll.lat, ll.lng)) : undefined;
      if (ring) cell += `<br><span class="lg-ringtxt">Year-round fire (${Math.round(ring.share * 100)}% of all months): likely industrial</span>`;
    }
    this.legend.innerHTML = `<div class="lg-title">${title}</div>
        <div class="lg-bar" style="background-image:linear-gradient(90deg,${ramp})"></div>
        <div class="lg-ticks"><span>0</span>${ticks.map((t) =>
          `<span style="left:${(scaleT(t, scale) * 100).toFixed(1)}%">${t}</span>`).join('')}
          <span style="left:100%">${max}${scale.linear ? '' : '+'}</span></div>
        <div class="lg-unit">${unit}</div>
        ${this.hotNote && this.map.hasLayer(this.hotLayer)
          ? `<div class="lg-hot"><span class="lg-dot"></span>${this.hotNote}</div>` : ''}
        ${this.ringNote && this.map.hasLayer(this.ringLayer)
          ? `<div class="lg-hot"><span class="lg-ring"></span>${this.ringNote}</div>` : ''}
        <div class="lg-cell">${empty ? 'No fire cells in this selection' : cell}</div>`;
  }

  /** Show the country frame and the area; fit the view when the selection changed. */
  show(code: string, countryBBox: BBox, shape: Shape | null) {
    this.countryLayer?.remove();
    this.countryLayer = null;
    if (code !== 'ALL' && shape) { // frame only as context for a custom area
      this.countryLayer = L.rectangle(bounds(countryBBox), {
        color: '#57606a', weight: 1, fill: false, dashArray: '2 4', interactive: false,
      }).addTo(this.map);
    }
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
