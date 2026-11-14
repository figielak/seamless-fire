// @ts-check
import { defineConfig } from 'astro/config';

// On GitHub Pages the site lives under a subpath (/<repo>/).
// SITE and BASE are set by the deploy workflow; local dev uses "/".
export default defineConfig({
  site: process.env.SITE || 'http://localhost:4321',
  base: process.env.BASE || '/',
  trailingSlash: 'ignore',
});
