"""Tests for the country raster used by the daily near real-time update (pipeline/borders.py).

Run: python -m unittest discover -s pipeline/tests -v
"""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import borders  # noqa: E402

# 1° x 1° square at (10..11 E, 50..51 N) with a 0.2° hole at (10.4..10.6, 50.4..50.6).
SQUARE = [[[10, 50], [11, 50], [11, 51], [10, 51], [10, 50]],
          [[10.4, 50.4], [10.6, 50.4], [10.6, 50.6], [10.4, 50.6], [10.4, 50.4]]]


class RasterTest(unittest.TestCase):
    def setUp(self):
        self.r = borders.rasterize([SQUARE])

    def test_cell_count(self):
        cells = sum(b - a + 1 for row in self.r["runs"] for a, b in zip(row[0::2], row[1::2]))
        self.assertEqual(cells, 100 * 100 - 20 * 20)

    def test_points(self):
        lon = np.array([10.005, 10.995, 10.5, 10.39, 9.999, 11.001, 10.5])
        lat = np.array([50.005, 50.995, 50.5, 50.5, 50.5, 50.5, 51.2])
        got = borders.in_country(lon, lat, self.r)
        self.assertEqual(got.tolist(), [True, True, False, True, False, False, False])

    def test_grow_coast_stops_at_other_countries(self):
        # Neighbour to the east (11..12 E): the grown border reaches 9.99 E (sea) but not 11.005 E.
        neighbour = {"XXX": [[[[11, 50], [12, 50], [12, 51], [11, 51], [11, 50]]]]}
        grown = borders.grow_coast(self.r, neighbour)
        got = borders.in_country(np.array([9.995, 11.005, 10.405, 10.5]), np.array([50.5] * 4), grown)
        # sea cell next to land: in; neighbour's cell: out; hole edge cell: in; hole centre: still out
        self.assertEqual(got.tolist(), [True, False, True, False])


if __name__ == "__main__":
    unittest.main()
