# Seamless Fire

Harmonized MODIS + VIIRS burning activity calendar (2000 → today) for a selected area.

Built for the NASA Space Apps Challenge 2026, challenge
"Harmonization of MODIS and VIIRS Hot Spots", by team Lone Pixel.

> Work in progress.

## How it works

- **Python pipeline** (`pipeline/`) reads raw NASA FIRMS hotspot files, keeps vegetation fires,
  counts cell-days (0.1° cell × day) per sensor, calibrates a per-country MODIS → VIIRS model
  and writes small JSON/CSV files to `public/data/`.
- **Static Astro site** (`src/`) loads those files, sums the selected area, applies the model
  in the browser and draws the calendar with Plotly.

## Run locally

```bash
pip install -r requirements.txt
python pipeline/build_data.py   # needs raw FIRMS files in data/{Country}/
npm install
npm run dev
```

## Data sources

- NASA FIRMS: MODIS Collection 6.1 (MCD14) and VIIRS 375 m (S-NPP, NOAA-20) active fire products.
  https://firms.modaps.eosdis.nasa.gov/

## Use of AI

Code in this repository was written with the help of LLM tools (Claude Code).
The method and design decisions are the author's.

## License

Apache License 2.0, see [LICENSE](LICENSE).
