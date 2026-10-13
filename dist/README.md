# Linework — Pen Plot Studio

Version 0.2. A dependency-free SVG generator and browser interface for pen plots.

## Output contract

Coordinates and physical SVG dimensions are in millimetres. Art is exported as stroked polyline paths in named Inkscape pen layers. No raster, filled areas, fonts, or background rectangle are exported. Hidden pen layers are omitted. Separate-pen export produces a ZIP of full-page SVGs and a recipe.

All path centre lines are clipped to the selected page margin plus half the declared pen width. Fragments shorter than 0.2 mm are dropped. Actual ink spread and machine calibration remain physical constraints. Line spacing is nominal, not a certified minimum between marks.

## Motifs

- **Flow ribbons:** harmonically displaced contours separated by open channels, with optional sparse cross-grain threads.
- **Signal bands:** broken vertical registers within irregular coloured blocks.
- **Wire structures:** connected angular fans across a sequence of stations.
- **Branching growth:** space colonisation (Runions et al., 2005). Scattered attractor points pull branch tips toward them and are consumed on arrival. Displacement clumps the attractors and bends the branches; density sets how many attractors there are and how thick trunks can get. Thickness follows the number of tips a branch feeds and is drawn as parallel strands one line-spacing apart, because a plotter cannot vary line width. Pens follow branch order: trunk, branches, then twigs. Secondary lines add fine hairs at the tips. On a full page, one or two roots start from an edge chosen by the seed.

## Blending

Each motif is **Off**, a **Region** or an **Overlay**.

- **Regions** share the page through a soft partition built from one noise field per region. Region amounts set each one's approximate share of the page. A single region with no overlays fills the page unmasked; this is the single-motif case.
- **Overlays** are drawn across the regions wherever their own coverage field allows. The amount is the share of the page covered.
- **Region size** sets the typical size of a region in millimetres. **Transition** sets the width of the hand-over band. In that band each path gets its own threshold, so one motif's lines thin out gradually while the next motif's lines fill in. A little coherent noise roughens the edge.
- Ribbons, signal and wire are generated over the whole page, then masked. Masked fragments shorter than 1 mm are dropped, so transitions do not produce pen-lift confetti. Growth is not masked: it only grows where its region allows, so branches end naturally at region edges.
- Each motif has a pen setting. "All pens" keeps the motif's own colour scheme; choosing a pen sends the whole motif to that layer, so it can be plotted as its own pass.

## Reproducibility

Every motif draws from its own seeded random streams: per row and block in Signal bands, per station in Wire structures. Raising density in Signal bands only adds bars to the existing layout. Spacing changes keep the same blocks and stations. Blend settings change only the masks, not the underlying motif geometry. Flow ribbons uses the same stream as version 0.1, so ribbon seeds from 0.1 reproduce (to within 0.01 mm, from simplification). Signal and wire seeds from 0.1 produce different layouts.

## Plotting

Confirm the dimensions against your iDraw's usable area. Export individual pen SVGs if your plotting software ignores Inkscape layers. Plot a small proof before an extended run. Set paper background for screen preview only; dark-paper plots require physically contrasting ink.

Routing uses nearest endpoints within each pen layer and may reverse a path. It never joins separate paths or changes line geometry. It is a heuristic; global minimum travel is not guaranteed, and intersections still count as separate paths. When sorting is enabled, the preview figures and travel overlay show the sorted route. Time estimate = draw distance / draw speed + pen-up distance / travel speed + paths × lift delay. Speed defaults are estimates, not iDraw machine settings. Acceleration, homing, pen changes, return-to-home, and controller overhead are omitted.

## Reuse the engine

`engine.mjs` has no browser dependencies and exports `generate`, `prepare`, `metrics`, and `toSVG`:

```js
import {generate, prepare, toSVG} from './dist/engine.mjs';
import {writeFileSync} from 'node:fs';
const plot = generate({
  seed: 'my-01', width: 210, height: 297, spacing: 1.2, palette: 'earth', margin: 15, pen: 0.3,
  motifs: {
    ribbons: {role: 'region', amount: 60},
    growth: {role: 'region', amount: 40},
    signal: {role: 'overlay', amount: 20, pen: '2'},
  },
  blendScale: 140, feather: 60,
});
writeFileSync('plot.svg', toSVG(prepare(plot, true)));
```

Motifs left out of `motifs` are off. The version 0.1 form `{mode: 'wire'}` still works and means that motif alone. `generate` returns options and layers containing arrays of `[x, y]` points. The UI uses web workers where available. There is a 45,000-path safety cap; the preview reports when it is reached.

Run `npm test` (or `node tests/engine.test.mjs`) from the project root. Serve `dist/` from any static web server for the UI; ES modules and workers require HTTP rather than `file://`.

No telemetry, external libraries, remote processing, or machine commands are included. Settings are remembered in browser local storage.

## Changes from 0.1

- Removed image hatching.
- Added branching growth, and blending through regions and overlays.
- Signal and wire use per-row, per-block and per-station random streams, so density and spacing no longer reshuffle the layout.
- Sorted travel and time figures in the preview.
- Signal bands absorb a thin leftover strip into the last band instead of drawing stubs.
- Zero-length clipping fragments are removed. Ribbon polylines are simplified, so files are smaller; the geometry changes by less than 0.01 mm.
- The source is readable, not condensed onto single lines.
