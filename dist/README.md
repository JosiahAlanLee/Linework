# Linework — Pen Plot Studio

Version 0.1. A dependency-free SVG generator and browser interface for pen plots.

## Output contract

Coordinates and physical SVG dimensions are in millimetres. Art is exported as stroked polyline paths in named Inkscape pen layers. No raster, filled areas, fonts, or background rectangle are exported. Hidden pen layers are omitted. Separate-pen export produces a ZIP of full-page SVGs and a recipe.

All path centre lines are clipped to the selected page margin plus half the declared pen width. Actual ink spread and machine calibration remain physical constraints. Line spacing is nominal, not a certified minimum between marks.

## Modes

- **Flow ribbons:** harmonically displaced contours separated by open channels, with optional sparse cross-grain threads.
- **Signal bands:** broken vertical registers within irregular coloured blocks.
- **Wire structures:** connected angular fans across a sequence of stations.
- **Image hatching:** brightness-thresholded hatch passes at −45°, +45°, and 0°. With secondary lines disabled, only the first pass is used. White and transparent areas are left empty. Invert tone is useful for light subjects on dark source backgrounds. Pen colour selection compares RGB chroma after removing average brightness. This is an approximate palette assignment, not colour-managed separation.

Image sources are processed locally and reduced to at most 900 pixels on the long edge. Their aspect ratio is retained and fitted into the drawing rectangle. A saved image recipe embeds this reduced source. Hatching is a tone translation; it does not reconstruct the original paths or edges. Image geometry is deterministic and does not use the seed or displacement controls.

The sample thread sketch is one of the user's supplied references. Procedural studies are newly generated geometry. The original uploads are not included; only a reduced sample is bundled.

## Plotting

Confirm the dimensions against your iDraw's usable area. Export individual pen SVGs if your plotting software ignores Inkscape layers. Plot a small proof before an extended run. Set paper background for screen preview only; dark-paper plots require physically contrasting ink.

Routing uses nearest endpoints within each pen layer and may reverse a path. It never joins separate paths or changes line geometry. It is a heuristic; global minimum travel is not guaranteed, and intersections still count as separate paths. Time estimate = draw distance / draw speed + pen-up distance / travel speed + paths × lift delay. Speed defaults are estimates, not iDraw machine settings. Acceleration, homing, pen changes, return-to-home, and controller overhead are omitted. Preview statistics show the unsorted route; the export notice gives the sorted estimate.

## Reuse the engine

`engine.mjs` has no browser dependencies and exports `generate`, `prepare`, `metrics`, and `toSVG`:

```js
import {generate, prepare, toSVG} from './dist/engine.mjs';
import {writeFileSync} from 'node:fs';
const plot = generate({mode:'wire', seed:'my-01', width:210, height:297,
  spacing:1.2, palette:'earth', margin:15, pen:0.3});
writeFileSync('plot.svg', toSVG(prepare(plot, true)));
```

Raster input is `{width, height, data}` with RGBA bytes. `generate` returns options and layers containing arrays of `[x, y]` points. The UI uses web workers where available. There is a 45,000-path safety cap; the preview reports when reached.

Run `node tests/engine.test.mjs` from the source checkout for the geometry and export checks. Serve `dist/` from any static web server for the UI; ES modules and workers require HTTP rather than `file://`.

No telemetry, external libraries, remote image processing, or machine commands are included. Settings are remembered in browser local storage. Images are only included in downloaded recipes.
