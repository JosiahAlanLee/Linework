import assert from "node:assert/strict";
import { generate, prepare, toSVG, metrics, clipSegment, normalize, routePaths } from "../dist/engine.mjs";
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
for (const mode of ["ribbons", "signal", "wire"]) {
  const opts = { mode, seed: "proof-01" },
    a = generate(opts),
    b = generate(opts),
    svg = toSVG(a);
  assert.deepEqual(a, b, "Seed must reproduce geometry");
  assert.notEqual(
    svg,
    toSVG(generate({ ...opts, seed: "proof-02" })),
    "Different seeds must change geometry",
  );
  assert.ok(withinBounds(a) > 100);
  assert.ok(svg.includes('width="210mm"'));
  assert.ok(!/<(rect|text|image|polygon|circle)\b/.test(svg));
  assert.ok(!svg.includes("data:image"));
  assert.equal((svg.match(/<path /g) || []).length, metrics(a).count);
  assert.ok(toSVG(a, { selected: ["pen-1"] }).includes('id="pen-1"'));
  assert.ok(!toSVG(a, { selected: ["pen-1"] }).includes('id="pen-2"'));
  const sorted = prepare(a, true),
    ma = metrics(a),
    mb = metrics(sorted);
  assert.equal(ma.count, mb.count);
  assert.equal(ma.points, mb.points);
  assert.ok(Math.abs(ma.draw - mb.draw) < 1e-7);
  assert.ok(mb.travel <= ma.travel, "Preset route must reduce travel");
  assert.ok(mb.seconds > 0);
  console.log(
    mode,
    ma.count + " paths",
    (ma.draw / 1000).toFixed(1) + "m ink",
    "travel",
    (ma.travel / 1000).toFixed(1) + " → " + (mb.travel / 1000).toFixed(1) + "m",
  );
}
const data = new Uint8ClampedArray(64 * 64 * 4);
for (let y = 0; y < 64; y++)
  for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4,
      t = x < 32 ? 0 : 255;
    data[i] = t;
    data[i + 1] = t;
    data[i + 2] = t;
    data[i + 3] = 255;
  }
const image = generate(
  { mode: "image", width: 80, height: 80, margin: 10, spacing: 1, palette: "carbon" },
  { width: 64, height: 64, data },
);
assert.ok(withinBounds(image) > 20);
for (const l of image.layers)
  for (const p of l.paths) for (const [x] of p) assert.ok(x <= 40.001, "White half must not be hatched");
const inverse = generate({ ...image.options, invert: true }, { width: 64, height: 64, data });
for (const l of inverse.layers)
  for (const p of l.paths) for (const [x] of p) assert.ok(x >= 39.5, "Inversion must swap hatch coverage");
const white = new Uint8ClampedArray(16 * 16 * 4).fill(255);
assert.equal(metrics(generate({ mode: "image" }, { width: 16, height: 16, data: white })).count, 0);
const transparent = new Uint8ClampedArray(16 * 16 * 4);
assert.equal(metrics(generate({ mode: "image" }, { width: 16, height: 16, data: transparent })).count, 0);
assert.throws(() => generate({ mode: "image" }), /Choose an image/);
for (const mode of ["ribbons", "signal", "wire"]) {
  for (const opts of [
    { width: 50, height: 900, margin: 100, distortion: 100, spacing: 4 },
    { width: 500, height: 50, margin: 1, spacing: 0.35, pen: 2 },
  ]) {
    const p = generate({ mode, ...opts });
    withinBounds(p);
    assert.ok(p.bounds[2] > p.bounds[0]);
  }
}
const normalized = normalize({
  width: Infinity,
  height: NaN,
  colors: null,
  palette: "custom",
  imageDataURL: "data:image/png;...",
  seed: '<script>&"',
});
assert.ok(!("imageDataURL" in normalized));
assert.equal(normalized.width, 210);
assert.deepEqual(normalized.colors, ["#383c37", "#8c4f3c", "#798276"]);
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
console.log("All geometry, clipping, determinism, routing, image tone, and SVG export checks passed.");
