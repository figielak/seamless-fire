// Nearest place names (placenames.ts). Run: npm run test:site
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestPlace, placeText, type PlaceNames } from './placenames.ts';

const toy: PlaceNames = {
  source: 'test', regions: ['A', 'B'],
  lat: [50, 51], lon: [20, 20], name: ['South', 'North'], r: [0, 1],
};

test('nearest place, distance and direction', () => {
  const n = nearestPlace(toy, 50.1, 20.1)!;
  assert.equal(n.name, 'South');
  assert.equal(n.region, 'A');
  assert.equal(n.dir, 'NE');
  assert.ok(n.km > 12 && n.km < 15, String(n.km)); // 11.1 km north, 7.2 km east
  assert.equal(placeText(n), `${Math.round(n.km)} km NE of South`);
  assert.equal(placeText({ ...n, km: 0.4 }), 'at South');
  assert.equal(nearestPlace(toy, 50.9, 19.9)!.dir, 'SW');
  assert.equal(nearestPlace({ ...toy, lat: [], lon: [], name: [], r: [] }, 50, 20), null);
});

test('site data: a point in the Biebrza valley names a nearby village', () => {
  const p = JSON.parse(readFileSync(new URL('../../public/data/PL/places.json', import.meta.url), 'utf-8')) as PlaceNames;
  assert.equal(p.lat.length, p.name.length);
  const n = nearestPlace(p, 53.5, 22.7)!;
  assert.ok(n.km < 15, `${n.name} ${n.km}`);
  assert.equal(n.region, 'Podlasie');
});
