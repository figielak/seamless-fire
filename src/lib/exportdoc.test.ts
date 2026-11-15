// Export bundle: ZIP writer, README and area GeoJSON. Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipFiles } from './zip.ts';
import { areaGeoJson, exportReadme, type ExportInfo } from './exportdoc.ts';

const enc = new TextEncoder();

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

/** Reads a stored ZIP back through its central directory. */
function unzip(z: Uint8Array): Map<string, string> {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(z.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = z.subarray(start, start + size);
    assert.equal(crc32(data), crc, name);
    out.set(name, dec.decode(data));
    p += 46 + nameLen;
  }
  return out;
}

test('zipFiles round-trips several UTF-8 files', () => {
  const files = [
    { name: 'a.csv', text: 'month,v\n2020-04,10\n' },
    { name: 'README.txt', text: 'Fire cell-days · 0.1° cells, ~80% interval\n' },
    { name: 'area.geojson', text: '{}' },
  ];
  const got = unzip(zipFiles(files, new Date(2026, 10, 15, 10, 30)));
  assert.deepEqual([...got.keys()], files.map((f) => f.name));
  for (const f of files) assert.equal(got.get(f.name), f.text);
});

const info: ExportInfo = {
  kind: 'monthly', csvName: 'x_monthly.csv', rows: 323, country: 'Poland',
  area: 'Area: preset "Biebrza Valley", in Poland.', isArea: true, from: '2000-01', to: '2026-11',
  created: '2026-11-15T10:00:00Z', dataThrough: '2026-11-14', lastComplete: '2026-10', model: 'E',
  viewUrl: 'https://example.org/#PL', methodUrl: 'https://example.org/method/',
};

test('monthly README documents every CSV column, unit and area', () => {
  const t = exportReadme(info);
  const header = 'month,harmonized_celldays,lo80,hi80,estimated,modis_celldays,viirs_celldays,' +
    'viirs_detections,viirs_source,terra_only,low_quality,preliminary,month_to_date';
  for (const c of header.split(',')) assert.ok(t.includes(c), c);
  assert.match(t, /NOT burned area/);
  assert.match(t, /Biebrza/);
  assert.match(t, /area\.geojson/);
  assert.match(t, /2026-11-14/);
  assert.match(t, /share\s+of\s+the\s+country\s+estimate/);
});

test('hotspot README gives units and time zone', () => {
  const t = exportReadme({ ...info, kind: 'hotspots', csvName: 'x_hotspots.csv' });
  for (const c of ['date', 'time', 'lat, lon', 'sensor', 'frp']) assert.ok(t.includes(c), c);
  assert.match(t, /UTC/);
  assert.match(t, /megawatts \(MW\)/);
});

test('areaGeoJson closes polygons and boxes whole countries', () => {
  const g = JSON.parse(areaGeoJson([
    { name: 'poly', shape: { kind: 'polygon', ring: [[22, 53], [23, 53], [23, 54]] }, bbox: [22, 53, 23, 54] },
    { name: 'rect', shape: { kind: 'rect', bbox: [1, 2, 3, 4] }, bbox: [1, 2, 3, 4] },
    { name: 'PL', shape: null, bbox: [14, 49, 24.2, 55] },
  ]));
  assert.equal(g.type, 'FeatureCollection');
  const ring = g.features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.equal(ring.length, 4);
  assert.deepEqual(g.features[1].geometry.coordinates[0], [[1, 2], [3, 2], [3, 4], [1, 4], [1, 2]]);
  assert.match(g.features[2].properties.note, /bounding box/);
});
