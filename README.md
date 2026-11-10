# Serre Chevalier — Alpine

A browser skiing prototype on the real IGN LiDAR terrain of Serre Chevalier Vallée (Briançon, Chantemerle, Villeneuve and Le Monêtier-les-Bains). Open world and timed race modes are included.

**Play:** this repository is served on GitHub Pages. Use a current browser with WebGL 2. On a phone, use the on-screen thumbs; on a keyboard, A/D carve, W push/tuck, S/Space brake, **J or Shift jump**, C camera, M map, E lifts.

## Version 0.11

- Jump system in open world: pop, airtime, grabs (hold W), landing quality and crashes. Kickers sit beside official snowpark / boardercross elevations at Villeneuve, Chantemerle and Briançon. These are gameplay features placed from the official catalogue, not a surveyed park map.
- Live weather from Open-Meteo at Villeneuve is fetched every time the page loads, then every 15 minutes. A cached observation is used only if the live request fails. Settings can still override the atmosphere.
- Snow sparkle, an overcast preset, a slightly stronger carve/skid feel, and jump / crash poses on the existing 19-bone skier.
- Terrain elevations are still the v0.10 IGN LiDAR HD rasters (4 m detail / 32 m regional). This release does not replace that survey.

Timed Gates and Descent physics are unchanged so existing ghosts stay compatible. The prototype is fan-made and is not an official resort product.

## Sources

See [ATTRIBUTION.md](ATTRIBUTION.md). Terrain © IGN (Licence Ouverte 2.0). Pistes, lifts and buildings © OpenStreetMap contributors (ODbL). Official piste and lift names come from the operator’s public catalogue snapshot of 9 November 2026. Google Maps / Street View were used only as visual reference and are not redistributed.

## Local run

If you have the full source package, `npm start` in that folder serves the same `dist/` files at http://localhost:5173. This Pages build is the web folder only; serve it with any static HTTPS server.
