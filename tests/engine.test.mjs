import assert from "node:assert/strict";
import {
  generate,
  prepare,
  toSVG,
  metrics,
  clipSegment,
  normalize,
  routePaths,
  simplify,
  MOTIF_NAMES,
} from "../dist/engine.mjs";

function withinBounds(p) {
  const [x0, y0, x1, y1] = p.bounds;
  let paths = 0;
  for (const l of p.layers)
    for (const path of l.paths) {
      paths++;
      assert.ok(path.length >= 2);
      for (const [x, y] of path) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y));
        assert.ok(x >= x0 - 1e-7 && x <= x1 + 1e-7 && y >= y0 - 1e-7 && y <= y1 + 1e-7);
      }
    }
  return paths;
}
const solo = (name, extra = {}) => ({ motifs: { [name]: { role: "region" } }, ...extra });
const pathSet = (plot) => new Set(plot.layers.flatMap((l) => l.paths.map((p) => l.id + JSON.stringify(p))));

// Clipping
assert.deepEqual(clipSegment([-5, 5], [15, 5], [0, 0, 10, 10]), [
  [0, 5],
  [10, 5],
]);
assert.equal(clipSegment([-5, -5], [-1, -1], [0, 0, 10, 10]), null);
assert.equal(clipSegment([-1, 2], [-1, 8], [0, 0, 10, 10]), null);
assert.deepEqual(clipSegment([3, 3], [3, 3], [0, 0, 10, 10]), [
  [3, 3],
  [3, 3],
]);
assert.deepEqual(
  simplify([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 1],
  ]),
  [
    [0, 0],
    [2, 0],
    [3, 1],
  ],
);

// Each motif alone: determinism, seed sensitivity, bounds, clean SVG, routing.
for (const mode of MOTIF_NAMES) {
  const opts = solo(mode, { seed: "proof-01" }),
    a = generate(opts),
    b = generate(opts),
    svg = toSVG(a);
  assert.equal(a.options.mode, mode);
  assert.deepEqual(a, b, "Seed must reproduce geometry");
  assert.notEqual(
    svg,
    toSVG(generate({ ...opts, seed: "proof-02" })),
    "Different seeds must change geometry",
  );
  assert.ok(withinBounds(a) > 100, mode + " should draw a substantial plot");
  assert.ok(svg.includes('width="210mm"'));
  assert.ok(!/<(rect|text|image|polygon|circle)\b/.test(svg));
  assert.equal((svg.match(/<path /g) || []).length, metrics(a).count);
  assert.ok(toSVG(a, { selected: ["pen-1"] }).includes('id="pen-1"'));
  assert.ok(!toSVG(a, { selected: ["pen-1"] }).includes('id="pen-2"'));
  const sorted = prepare(a, true),
    ma = metrics(a),
    mb = metrics(sorted);
  assert.equal(ma.count, mb.count);
  assert.equal(ma.points, mb.points);
  assert.ok(Math.abs(ma.draw - mb.draw) < 1e-7);
  assert.ok(mb.travel <= ma.travel, "Routing must reduce travel");
  console.log(
    mode.padEnd(8),
    String(ma.count).padStart(5) + " paths",
    (ma.draw / 1000).toFixed(1) + " m ink",
    "travel " + (ma.travel / 1000).toFixed(1) + " → " + (mb.travel / 1000).toFixed(1) + " m",
  );
}

// Legacy v0.1 options still work; image mode falls back to ribbons.
assert.equal(normalize({ mode: "wire" }).motifs.wire.role, "region");
assert.equal(normalize({ mode: "wire" }).motifs.ribbons.role, "off");
assert.equal(normalize({ mode: "image" }).mode, "ribbons");
assert.deepEqual(generate({ mode: "signal", seed: "x" }), generate(solo("signal", { seed: "x" })));
// Nothing active → ribbons.
assert.equal(normalize({ motifs: { ribbons: { role: "off" } } }).mode, "ribbons");

// Stability: density only adds signal bars; it does not reshuffle the composition.
{
  const lo = pathSet(generate(solo("signal", { seed: "SG-407", density: 50, crosshatch: false }))),
    hi = pathSet(generate(solo("signal", { seed: "SG-407", density: 51, crosshatch: false })));
  for (const p of lo) assert.ok(hi.has(p), "Raising density must keep existing signal bars");
  assert.ok(hi.size >= lo.size);
}

// Blends: bounds, determinism, every active motif contributes, overlays add marks.
{
  const mix = {
    seed: "MX-1",
    motifs: {
      ribbons: { role: "region", amount: 50 },
      growth: { role: "region", amount: 50 },
      signal: { role: "overlay", amount: 30, pen: "2" },
    },
  };
  const a = generate(mix);
  assert.equal(a.options.mode, "blend");
  assert.deepEqual(a, generate(mix));
  assert.ok(withinBounds(a) > 200);
  const ribbonsOnly = metrics(generate(solo("ribbons", { seed: "MX-1" }))).draw,
    blended = metrics(a).draw;
  assert.ok(blended < ribbonsOnly * 1.5 && blended > 0, "Regions share the page rather than stacking");
  const noOverlay = generate({ ...mix, motifs: { ...mix.motifs, signal: { role: "off" } } });
  assert.ok(metrics(a).count > metrics(noOverlay).count, "Overlay adds paths");
  // Masked fragments are never confetti.
  for (const l of a.layers)
    for (const p of l.paths) {
      let len = 0;
      for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      assert.ok(len > 0.05);
    }
  // Region amounts steer the share of the page.
  const share = (amount) =>
    metrics(
      generate({
        seed: "MX-1",
        motifs: { ribbons: { role: "region", amount }, wire: { role: "region", amount: 100 - amount } },
      }),
    ).count;
  assert.notEqual(share(20), share(80));
}

// Fixed pen assignment routes a motif to one layer.
{
  const p = generate(solo("signal", { seed: "pens", motifs: { signal: { role: "region", pen: "3" } } }));
  assert.equal(p.layers[0].paths.length + p.layers[1].paths.length, 0);
  assert.ok(p.layers[2].paths.length > 0);
}

// Extreme pages stay in bounds.
for (const mode of MOTIF_NAMES)
  for (const opts of [
    { width: 50, height: 900, margin: 100, distortion: 100, spacing: 4 },
    { width: 500, height: 50, margin: 1, spacing: 0.35, pen: 2 },
  ]) {
    const p = generate(solo(mode, opts));
    withinBounds(p);
    assert.ok(p.bounds[2] > p.bounds[0]);
  }

// Untrusted input is sanitised.
const normalized = normalize({
  width: Infinity,
  height: NaN,
  colors: null,
  palette: "custom",
  imageDataURL: "data:image/png;...",
  seed: '<script>&"',
  motifs: { growth: { role: "evil", pen: "<x>" } },
});
assert.ok(!("imageDataURL" in normalized));
assert.equal(normalized.width, 210);
assert.deepEqual(normalized.colors, ["#383c37", "#8c4f3c", "#798276"]);
assert.equal(normalized.motifs.growth.pen, "all");
assert.ok(toSVG(generate(normalized)).includes("&lt;script&gt;&amp;&quot;"));

const route = routePaths([
  [
    [0, 0],
    [1, 0],
  ],
  [
    [100, 100],
    [101, 101],
  ],
  [
    [2, 0],
    [3, 0],
  ],
]);
assert.equal(route.length, 3);
assert.deepEqual(route[1], [
  [2, 0],
  [3, 0],
]);
console.log(
  "All geometry, clipping, determinism, blending, stability, routing, and SVG export checks passed.",
);
