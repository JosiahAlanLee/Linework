/**
 * Linework v0.2 — geometry is in millimetres. No DOM or runtime dependencies.
 *
 * A drawing is a mix of motifs. Each motif is Off, a Region (motifs in this role
 * share the page through a soft noise partition) or an Overlay (drawn across the
 * page wherever its own coverage field allows). A single region with no overlays
 * is drawn unmasked, which reproduces the old single-mode behaviour.
 */

import { random, seedInt } from "./random.mjs";
import { buildDiagram } from "./diagram.mjs";

export const MOTIF_NAMES = ["ribbons", "signal", "wire", "growth"];
export const ROLES = ["off", "region", "overlay"];
const MAX_PATHS = 45000;

const motif = (role, amount = 50) => ({ role, amount, pen: "all" });
export const DEFAULTS = {
  seed: "AL-184",
  width: 210,
  height: 297,
  margin: 15,
  spacing: 1.15,
  pen: 0.3,
  distortion: 60,
  density: 65,
  palette: "earth",
  colors: ["#383c37", "#8c4f3c", "#798276"],
  background: "#f4efe4",
  crosshatch: true,
  frame: false,
  optimize: true,
  speed: 40,
  travelSpeed: 100,
  liftDelay: 0.35,
  motifs: {
    ribbons: motif("region"),
    signal: motif("off"),
    wire: motif("off"),
    growth: motif("off"),
  },
  blendScale: 140, // mm — typical size of a region
  feather: 60, // % — width of transitions between motifs
  diagram: { text: "", ornament: 70, clearance: 5, key: true, labels: true },
};

export const PALETTES = {
  carbon: ["#292c2b"],
  earth: ["#383c37", "#8c4f3c", "#798276"],
  signal: ["#202b30", "#c04735", "#b49a4d"],
  dusk: ["#30364b", "#96526f", "#71858c"],
};

// ---------------------------------------------------------------------------
// Randomness and noise

export { random };

function gradient(ix, iy, s) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ s;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const a = (((h ^ (h >>> 16)) >>> 0) / 4294967296) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

function perlin(x, y, s) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (gx, gy, dx, dy) => {
    const g = gradient(gx, gy, s);
    return g[0] * dx + g[1] * dy;
  };
  const u = fade(fx),
    v = fade(fy),
    a = dot(ix, iy, fx, fy),
    b = dot(ix + 1, iy, fx - 1, fy),
    c = dot(ix, iy + 1, fx, fy - 1),
    d = dot(ix + 1, iy + 1, fx - 1, fy - 1),
    top = a + (b - a) * u,
    bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/** Smooth fractal noise, roughly in [-1, 1], with features about `scale` mm across. */
export function noiseField(seed, scale, octaves = 3) {
  const s = seedInt(seed);
  return (x, y) => {
    let sum = 0,
      amp = 1,
      norm = 0,
      f = 1 / scale;
    for (let i = 0; i < octaves; i++) {
      sum += amp * perlin(x * f + i * 31.7, y * f - i * 17.3, (s + i * 1013) | 0);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return Math.max(-1, Math.min(1, (sum / norm) * 1.6));
  };
}

// ---------------------------------------------------------------------------
// Options

const HEX = /^#[0-9a-f]{6}$/i;

export function normalize(input = {}) {
  const o = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS))
    if (input[key] !== undefined && key !== "motifs" && key !== "diagram") o[key] = input[key];
  if (input.paper) o.paper = String(input.paper);
  if (input.orientation) o.orientation = String(input.orientation);
  const n = (key, lo, hi) => {
    const value = Number(o[key]);
    o[key] = Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : DEFAULTS[key]));
  };
  n("width", 50, 900);
  n("height", 50, 900);
  n("margin", 1, Math.min(o.width, o.height) / 2 - 5);
  n("spacing", 0.35, 8);
  n("pen", 0.05, 2);
  n("distortion", 1, 100);
  n("density", 1, 100);
  n("speed", 1, 200);
  n("travelSpeed", 1, 300);
  n("liftDelay", 0.05, 5);
  n("blendScale", 20, 400);
  n("feather", 0, 100);

  // Motifs. Version 1 recipes carried a single `mode`; image mode no longer exists.
  const motifs = {};
  const source = input.motifs && typeof input.motifs === "object" ? input.motifs : null;
  const legacy = MOTIF_NAMES.includes(input.mode) ? input.mode : "ribbons";
  for (const name of MOTIF_NAMES) {
    const m = source?.[name] || {};
    const amount = Number(m.amount);
    motifs[name] = {
      role: source ? (ROLES.includes(m.role) ? m.role : "off") : name === legacy ? "region" : "off",
      amount: Number.isFinite(amount) ? Math.max(1, Math.min(100, Math.round(amount))) : 50,
      pen: ["all", "1", "2", "3", "4"].includes(String(m.pen)) ? String(m.pen) : "all",
    };
  }
  // Diagram in the grimoire's sketching marks (see diagram.mjs).
  const dg = input.diagram && typeof input.diagram === "object" ? input.diagram : {},
    dn = (v, lo, hi, fallback) =>
      Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
  o.diagram = {
    text: typeof dg.text === "string" ? dg.text.slice(0, 20000) : "",
    ornament: dn(dg.ornament, 0, 100, DEFAULTS.diagram.ornament),
    clearance: dn(dg.clearance, 0, 30, DEFAULTS.diagram.clearance),
    key: dg.key === undefined ? true : !!dg.key,
    labels: dg.labels === undefined ? true : !!dg.labels,
  };
  const hasDiagram = hasDiagramText(o.diagram.text);
  // Without a diagram, something must be drawn.
  if (!hasDiagram && !MOTIF_NAMES.some((k) => motifs[k].role !== "off")) motifs.ribbons.role = "region";
  o.motifs = motifs;
  const active = MOTIF_NAMES.filter((k) => motifs[k].role !== "off");
  o.mode = !active.length
    ? "diagram"
    : active.length === 1 && motifs[active[0]].role === "region"
      ? active[0]
      : "blend";

  o.seed = String(o.seed).slice(0, 80);
  o.colors =
    o.palette === "custom" && Array.isArray(o.colors) ? o.colors : PALETTES[o.palette] || PALETTES.earth;
  o.colors = o.colors.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 4);
  if (!o.colors.length) o.colors = PALETTES.carbon;
  for (const key of ["crosshatch", "frame", "optimize"]) o[key] = !!o[key];
  if (!HEX.test(o.background)) o.background = DEFAULTS.background;
  return o;
}

/** True when the diagram text has anything besides comments and blank lines. */
export function hasDiagramText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .some((line) => line.replace(/#.*$/, "").trim());
}

// ---------------------------------------------------------------------------
// Geometry helpers

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

// Liang–Barsky clipping preserves the centreline, rather than clamping border points.
export function clipSegment(a, b, box) {
  let t0 = 0,
    t1 = 1;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy],
    q = [a[0] - box[0], box[2] - a[0], a[1] - box[1], box[3] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return null;
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/** Ramer–Douglas–Peucker; removes points that do not change the line by more than eps. */
export function simplify(pts, eps = 0.02) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i],
      [bx, by] = pts[j],
      dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1,
      index = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len;
      if (d > worst) {
        worst = d;
        index = k;
      }
    }
    if (worst > eps) {
      keep[index] = 1;
      stack.push([i, index], [index, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i],
      n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  }
  return out;
}

function chaikin(pts, iterations = 2) {
  for (let k = 0; k < iterations && pts.length > 2; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++)
      out.push(lerp(pts[i], pts[i + 1], 0.25), lerp(pts[i], pts[i + 1], 0.75));
    out.push(pts.at(-1));
    pts = out;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Blending: soft regions shared by Region motifs, coverage fields for Overlays.

function buildBlend(o, box) {
  const regions = MOTIF_NAMES.filter((k) => o.motifs[k].role === "region"),
    overlays = MOTIF_NAMES.filter((k) => o.motifs[k].role === "overlay"),
    solo = regions.length === 1 && overlays.length === 0,
    feather = (o.feather / 100) * 0.9,
    G = 48,
    grid = [];
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++)
      grid.push([
        box[0] + ((gx + 0.5) / G) * (box[2] - box[0]),
        box[1] + ((gy + 0.5) / G) * (box[3] - box[1]),
      ]);
  const margins = {};

  if (regions.length === 1) margins[regions[0]] = () => 1;
  else if (regions.length > 1) {
    // A softmax over one noise field per region. Biases are calibrated so each
    // region's share of the page roughly follows its amount.
    // Lower sharpness widens the band where one motif hands over to the next.
    const k = 16 - 13 * (o.feather / 100),
      fields = regions.map((r) => noiseField(`${o.seed}:region:${r}`, o.blendScale)),
      total = regions.reduce((s, r) => s + o.motifs[r].amount, 0),
      target = regions.map((r) => o.motifs[r].amount / total),
      bias = regions.map(() => 0),
      values = grid.map(([x, y]) => fields.map((f) => f(x, y)));
    for (let it = 0; it < 40; it++) {
      const counts = regions.map(() => 0);
      for (const v of values) {
        let best = 0;
        for (let i = 1; i < v.length; i++) if (k * v[i] + bias[i] > k * v[best] + bias[best]) best = i;
        counts[best]++;
      }
      regions.forEach((_, i) => {
        bias[i] += 0.6 * (Math.log(target[i]) - Math.log(counts[i] / values.length + 1e-3));
      });
    }
    const probabilities = (x, y) => {
      const e = fields.map((f, i) => Math.exp(k * f(x, y) + bias[i])),
        sum = e.reduce((a, b) => a + b, 0);
      return e.map((v) => v / sum);
    };
    regions.forEach((r, i) => {
      margins[r] = (x, y) => {
        const p = probabilities(x, y);
        let other = 0;
        for (let j = 0; j < p.length; j++) if (j !== i) other = Math.max(other, p[j]);
        return p[i] - other;
      };
    });
  }

  for (const r of overlays) {
    const field = noiseField(`${o.seed}:overlay:${r}`, o.blendScale * 0.8),
      amount = o.motifs[r].amount / 100;
    if (amount >= 0.999) {
      margins[r] = () => 1;
      continue;
    }
    const sorted = grid.map(([x, y]) => field(x, y)).sort((a, b) => a - b),
      threshold = sorted[Math.floor((1 - amount) * (sorted.length - 1))];
    margins[r] = (x, y) => Math.max(-1, Math.min(1, (field(x, y) - threshold) * 4));
  }

  const regionFor = (name) => {
    if (solo) return null;
    const margin = margins[name],
      ragged = noiseField(`${o.seed}:ragged:${name}`, Math.max(5, o.blendScale / 9), 2);
    // score > 0 means "inside". Each path gets its own threshold (jitter), so in a
    // transition band one motif's lines thin out progressively while the next one's
    // fill in. A little coherent noise roughens the edge so it reads as eroded.
    const score = (x, y) => margin(x, y) + feather * 0.25 * ragged(x, y);
    return {
      score,
      keep: (x, y, jitter) => score(x, y) + feather * 0.75 * jitter > 0,
    };
  };
  return { regionFor, active: [...regions, ...overlays] };
}

function maskPaths(items, region, rng) {
  const out = [];
  for (const item of items) {
    if (item.pts.length < 2) continue;
    const jitter = rng() * 2 - 1,
      pts = resample(item.pts, 0.5);
    let run = [];
    const flush = () => {
      if (run.length > 1 && pathLength(run) >= 1) out.push({ pts: simplify(run), ink: item.ink });
      run = [];
    };
    for (const p of pts) {
      if (region.keep(p[0], p[1], jitter)) run.push(p);
      else flush();
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Motifs. Each returns [{pts, ink}] in page coordinates; clipping happens later.
// Every motif draws from its own seeded streams so that changing one setting
// thins or extends the composition rather than reshuffling it.

function ribbons(c) {
  const { o, m, w, h, s, d, den, inks } = c,
    rng = random(o.seed), // unchanged from v0.1 so existing ribbon seeds reproduce
    out = [],
    phases = Array.from({ length: 5 }, () => rng() * Math.PI * 2),
    amp = Math.min(w, h) * 0.14 * d;
  const field = (x, y) => {
    const u = x / w,
      v = y / h;
    return (
      amp *
      (Math.sin(u * 7 + phases[0] + v * 1.4) +
        0.45 * Math.sin(u * 13 - v * 4 + phases[1]) +
        0.23 * Math.sin(u * 25 + v * 9 + phases[2]))
    );
  };
  let row = 0;
  for (let y = -amp * 2; y < h + amp * 2; y += s, row++) {
    // Periodic open channels leave breathing room between densely drawn ribbons.
    const band = Math.floor((y + amp * 2) / (s * 14));
    if (row % 14 > 10 + Math.floor(den * 3)) continue;
    const pts = [];
    for (let x = 0; x <= w + 0.8; x += 0.8) pts.push([m + Math.min(x, w), m + y + field(Math.min(x, w), y)]);
    out.push({ pts: simplify(pts, 0.01), ink: (band + Math.floor(phases[3])) % inks });
  }
  if (o.crosshatch) {
    for (let x = 0; x < w; x += s * 2.8) {
      let pts = [];
      for (let y = 0; y <= h; y += 1.2) {
        const xx = x + field((y * w) / h, x) * 0.3;
        if (Math.sin((y / h) * 16 + (xx / w) * 8 + phases[4]) > 0.72 + (1 - den) * 0.2)
          pts.push([m + xx, m + y]);
        else if (pts.length) {
          out.push({ pts, ink: 0 });
          pts = [];
        }
      }
      out.push({ pts, ink: 0 });
    }
  }
  return out;
}

function signal(c) {
  const { o, m, w, h, s, d, den, inks } = c,
    out = [];
  let y = 0,
    row = 0;
  while (y < h - 4) {
    const r = random(`${o.seed}:signal:${row}`),
      phase = r() * 4;
    let rh = (9 + r() * 24) * (0.8 + d * 0.8);
    // Absorb a thin leftover strip into the last band instead of drawing stubs.
    if (h - (y + rh + s * 1.7) < 8) rh = h - y;
    let x = 0,
      block = 0;
    while (x < w) {
      const b = random(`${o.seed}:signal:${row}:${block}`),
        bw = 8 + b() * 30,
        ink = Math.floor(b() * inks),
        lines = random(`${o.seed}:signal:${row}:${block}:lines`);
      for (let xx = x; xx < Math.min(w, x + bw); xx += s) {
        // Draw every value before testing density, so density only adds or removes lines.
        const keep = lines(),
          topU = lines(),
          bottomU = lines(),
          doubleU = lines();
        if (keep > den * 0.7 + 0.25) continue;
        const top = y + topU * rh * 0.3 * d,
          bottom = Math.min(h, y + rh * (0.6 + bottomU * 0.4)),
          bend = Math.sin((xx / w) * 12 + phase) * d * 1.2;
        out.push({
          pts: [
            [m + xx, m + top],
            [m + xx + bend, m + bottom],
          ],
          ink,
        });
        if (doubleU < den * 0.2)
          out.push({
            pts: [
              [m + xx + s * 0.35, m + top],
              [m + xx + s * 0.35 + bend, m + bottom],
            ],
            ink,
          });
      }
      x += bw;
      block++;
    }
    if (o.crosshatch && row % 3 === 0)
      out.push({
        pts: [
          [m, m + y + rh * 0.65],
          [m + w, m + y + rh * 0.65],
        ],
        ink: row % inks,
      });
    y += rh + s * 1.7;
    row++;
  }
  return out;
}

function wire(c) {
  const { o, m, w, h, s, d, den, inks } = c,
    out = [],
    n = Math.max(3, Math.floor(3 + den * 5)),
    sh = h / n;
  let prev = null;
  for (let k = 0; k < n; k++) {
    const station = random(`${o.seed}:wire:${k}`),
      lines = random(`${o.seed}:wire:${k}:lines`),
      y = k * sh,
      flip = k % 2 ? -1 : 1,
      peakX = w * (0.4 + station() * 0.28),
      peakY = y + sh * (0.2 + station() * 0.25),
      count = Math.max(6, Math.floor(sh / s));
    for (let j = 0; j < count; j++) {
      const t = j / (count - 1),
        yy = y + t * sh,
        xL = w * (0.04 + lines() * 0.025 * d),
        xR = w * (0.9 + lines() * 0.06 * d),
        a = [m + xL, m + yy],
        b = [m + peakX + Math.sin(t * 6 + k) * d * w * 0.06, m + peakY + t * sh * (0.45 + d * 0.25)],
        cc = [m + xR, m + y + sh * (flip > 0 ? t : 1 - t)];
      out.push({ pts: [a, b, cc], ink: k % inks });
      if (o.crosshatch && j % 3 === 0 && prev) out.push({ pts: [a, prev], ink: (k + 1) % inks });
      prev = cc;
    }
    if (o.crosshatch)
      out.push({
        pts: [
          [m + w * 0.08, m + y],
          [m + w * 0.08, m + y + sh],
        ],
        ink: 0,
      });
  }
  return out;
}

/**
 * Branching growth by space colonisation (Runions et al. 2005): scattered
 * attractor points pull branch tips toward them and are consumed on arrival.
 * Branch thickness follows the number of tips a branch feeds, and is drawn as
 * parallel strands — a plotter cannot vary line width.
 */
function growth(c) {
  const { o, m, w, h, s, d, den, inks, region, box, fullPage } = c,
    rng = random(`${o.seed}:growth`),
    step = 1.6,
    kill = step * 1.8,
    influence = Math.max(16, Math.min(w, h) * 0.13),
    clump = noiseField(`${o.seed}:growth:clump`, 45),
    wobble = noiseField(`${o.seed}:growth:wobble`, 22),
    candidates = Math.round((700 + den * 4500) * ((w * h) / (180 * 267))),
    inside = (x, y) => !region || region.score(x, y) > 0;

  // Attractors, clumped by distortion so growth gathers and leaves clearings.
  const ax = [],
    ay = [];
  for (let i = 0; i < candidates; i++) {
    const x = m + rng() * w,
      y = m + rng() * h,
      gate = rng(),
      p = Math.max(0, Math.min(1, 1 - d * (0.5 - 1.5 * clump(x, y))));
    if (gate < p && inside(x, y)) {
      ax.push(x);
      ay.push(y);
    }
  }
  if (!ax.length) return [];
  const alive = new Uint8Array(ax.length).fill(1),
    near = new Int32Array(ax.length).fill(-1),
    nearD = new Float64Array(ax.length).fill(Infinity),
    attractorGrid = new Map(),
    key = (x, y) => Math.floor(x / influence) + "," + Math.floor(y / influence);
  for (let i = 0; i < ax.length; i++) {
    const k = key(ax[i], ay[i]);
    if (!attractorGrid.has(k)) attractorGrid.set(k, []);
    attractorGrid.get(k).push(i);
  }

  const nx = [],
    ny = [],
    parent = [],
    occupied = new Set();
  const addNode = (x, y, p) => {
    const cellKey = Math.round(x * 4) + "," + Math.round(y * 4);
    if (occupied.has(cellKey)) return false;
    occupied.add(cellKey);
    const id = nx.length;
    nx.push(x);
    ny.push(y);
    parent.push(p);
    const cx = Math.floor(x / influence),
      cy = Math.floor(y / influence);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++)
        for (const a of attractorGrid.get(gx + "," + gy) || []) {
          if (!alive[a]) continue;
          const dd = Math.hypot(ax[a] - x, ay[a] - y);
          if (dd < kill) alive[a] = 0;
          else if (dd < influence && dd < nearD[a]) {
            nearD[a] = dd;
            near[a] = id;
          }
        }
    return true;
  };

  // Roots: along the lower edge for a full page; spread through the region otherwise.
  const rootCount = !fullPage
    ? Math.max(1, Math.min(6, Math.round(ax.length / 220)))
    : 1 + Math.floor(rng() * 2);
  if (fullPage) {
    // One or two roots on an edge chosen by the seed (mostly the bottom).
    const side = rng(),
      edges = [
        (t) => [m + w * t, box[3]],
        (t) => [box[0], m + h * t],
        (t) => [box[2], m + h * t],
        (t) => [m + w * t, box[1]],
      ],
      edge = edges[side < 0.55 ? 0 : side < 0.75 ? 1 : side < 0.95 ? 2 : 3];
    for (let i = 0; i < rootCount; i++) {
      const p = edge((i + 0.15 + rng() * 0.7) / rootCount);
      // An edge may be reserved (a diagram's key or ground); start inside instead.
      if (!region || region.score(...p) > 0) addNode(...p, -1);
    }
  }
  if (!nx.length) {
    let pick = Math.floor(rng() * ax.length);
    const chosen = [pick],
      want = Math.max(rootCount, Math.min(6, Math.round(ax.length / 220)));
    const far = new Float64Array(ax.length).fill(Infinity);
    for (let r = 1; r < want; r++) {
      let best = -1;
      for (let i = 0; i < ax.length; i++) {
        far[i] = Math.min(far[i], Math.hypot(ax[i] - ax[pick], ay[i] - ay[pick]));
        if (best < 0 || far[i] > far[best]) best = i;
      }
      pick = best;
      chosen.push(pick);
    }
    for (const i of chosen) addNode(ax[i], ay[i], -1);
  }

  for (let iteration = 0; iteration < 900 && nx.length < 40000; iteration++) {
    const sums = new Map();
    for (let a = 0; a < ax.length; a++) {
      if (!alive[a] || near[a] < 0) continue;
      const id = near[a],
        dx = ax[a] - nx[id],
        dy = ay[a] - ny[id],
        l = Math.hypot(dx, dy),
        v = sums.get(id) || [0, 0];
      v[0] += dx / l;
      v[1] += dy / l;
      sums.set(id, v);
    }
    let grew = 0;
    for (const [id, [sx, sy]] of sums) {
      const l = Math.hypot(sx, sy);
      if (l < 1e-6) continue;
      const turn = wobble(nx[id], ny[id]) * d * 0.7,
        cos = Math.cos(turn),
        sin = Math.sin(turn),
        ux = (sx / l) * cos - (sy / l) * sin,
        uy = (sx / l) * sin + (sy / l) * cos,
        x = nx[id] + ux * step,
        y = ny[id] + uy * step;
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
      if (region && region.score(x, y) < -0.08) continue;
      if (addNode(x, y, id)) grew++;
    }
    if (!grew && !region) {
      // Nothing within reach: extend the nearest node toward a few stranded attractors.
      let tries = 0;
      for (let a = 0; a < ax.length && tries < 3; a++) {
        if (!alive[a]) continue;
        tries++;
        let best = 0,
          bd = Infinity;
        for (let i = 0; i < nx.length; i++) {
          const dd = Math.hypot(ax[a] - nx[i], ay[a] - ny[i]);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        }
        const x = nx[best] + ((ax[a] - nx[best]) / bd) * step,
          y = ny[best] + ((ay[a] - ny[best]) / bd) * step;
        if (addNode(x, y, best)) grew++;
        else alive[a] = 0;
      }
    }
    if (!grew) break;
  }

  // Tip counts per node (parents always precede children).
  const N = nx.length,
    load = new Float64Array(N),
    children = Array.from({ length: N }, () => []);
  for (let i = N - 1; i >= 0; i--) {
    if (!load[i]) load[i] = 1;
    if (parent[i] >= 0) {
      load[parent[i]] += load[i];
      children[parent[i]].push(i);
    }
  }
  const maxStrands = 1 + 2 * Math.round(1 + den * 3),
    strandsAt = (i) => Math.min(maxStrands, Math.max(1, Math.pow(load[i], 0.5) * 0.75));

  // Decompose the tree into long chains: follow the heaviest child, start new chains for the rest.
  const chains = [],
    starts = [];
  for (let i = 0; i < N; i++) if (parent[i] < 0) starts.push([i, -1, 0]);
  while (starts.length) {
    const [first, from, order] = starts.pop(),
      chain = [];
    if (from >= 0) chain.push([nx[from], ny[from], strandsAt(first)]);
    let i = first;
    while (true) {
      chain.push([nx[i], ny[i], strandsAt(i)]);
      if (!children[i].length) break;
      const kids = [...children[i]].sort((a, b) => load[b] - load[a]);
      for (const kid of kids.slice(1)) starts.push([kid, i, order + 1]);
      i = kids[0];
    }
    if (chain.length > 1) chains.push({ pts: chain, order, tip: i });
  }

  const out = [],
    J = (maxStrands - 1) / 2;
  for (const chain of chains) {
    const pts = chaikin(chain.pts, 2),
      ink = Math.min(chain.order, inks - 1);
    for (let j = -J; j <= J; j++) {
      let run = [];
      const flush = () => {
        if (run.length > 1 && pathLength(run) >= 1) out.push({ pts: simplify(run), ink });
        run = [];
      };
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(j) > (pts[i][2] - 1) / 2 + 1e-9) {
          flush();
          continue;
        }
        const a = pts[Math.max(0, i - 1)],
          b = pts[Math.min(pts.length - 1, i + 1)],
          tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
          px = -(b[1] - a[1]) / tl,
          py = (b[0] - a[0]) / tl;
        run.push([pts[i][0] + px * j * s, pts[i][1] + py * j * s]);
      }
      flush();
    }
    if (o.crosshatch && chain.pts.length > 2) {
      // Fine hairs at each tip.
      const tip = pts.at(-1),
        before = pts.at(-2),
        heading = Math.atan2(tip[1] - before[1], tip[0] - before[0]),
        hr = random(`${o.seed}:growth:hair:${chain.tip}`);
      for (const side of [-1, 1]) {
        const angle = heading + side * (0.35 + hr() * 0.5),
          length = (1.5 + hr() * 2) * (0.5 + den);
        out.push({
          pts: [
            [tip[0], tip[1]],
            [tip[0] + Math.cos(angle) * length, tip[1] + Math.sin(angle) * length],
          ],
          ink: inks - 1,
        });
      }
    }
  }
  return out;
}

const GENERATORS = { ribbons, signal, wire, growth };

// ---------------------------------------------------------------------------

export function generate(input = {}) {
  const o = normalize(input),
    layers = o.colors.map((color, i) => ({
      id: "pen-" + (i + 1),
      name: "Pen " + (i + 1),
      color,
      paths: [],
    }));
  const m = o.margin + o.pen / 2,
    box = [m, m, o.width - m, o.height - m],
    base = {
      o,
      m,
      box,
      w: box[2] - m,
      h: box[3] - m,
      s: o.spacing,
      d: o.distortion / 100,
      den: o.density / 100,
      inks: layers.length,
    };
  let pathCount = 0;
  const add = (pts, ink = 0) => {
    if (pts.length < 2) return;
    let run = [];
    const flush = () => {
      // Fragments under 0.2 mm (lines grazing the margin) would only plot as dots.
      if (run.length > 1 && pathCount < MAX_PATHS && pathLength(run) >= 0.2) {
        layers[ink % layers.length].paths.push(run);
        pathCount++;
      }
      run = [];
    };
    for (let i = 1; i < pts.length; i++) {
      const seg = clipSegment(pts[i - 1], pts[i], box);
      if (!seg) {
        flush();
        continue;
      }
      if (!run.length) run = [seg[0], seg[1]];
      else if (dist(run.at(-1), seg[0]) < 0.001) run.push(seg[1]);
      else {
        flush();
        run = [seg[0], seg[1]];
      }
      if (dist(seg[1], pts[i]) > 0.001) flush();
    }
    flush();
  };

  // The diagram is laid out first; motifs then keep clear of it.
  const diagram = hasDiagramText(o.diagram.text) ? buildDiagram(o, box) : null,
    clear = diagram?.clearance || null,
    combine = (a, b) =>
      !a
        ? b
        : !b
          ? a
          : {
              score: (x, y) => Math.min(a.score(x, y), b.score(x, y)),
              keep: (x, y, j) => a.keep(x, y, j) && b.keep(x, y, j),
            };
  const blend = buildBlend(o, box);
  for (const name of blend.active) {
    const own = blend.regionFor(name),
      region = combine(own, clear),
      setting = o.motifs[name];
    let items = GENERATORS[name]({ ...base, region, fullPage: !own });
    // Growth respects its region while growing; the others are masked afterwards.
    if (region && name !== "growth") items = maskPaths(items, region, random(`${o.seed}:mask:${name}`));
    const fixed = setting.pen === "all" ? null : Number(setting.pen) - 1;
    for (const item of items) add(item.pts, fixed ?? item.ink);
  }
  if (o.frame)
    add(
      [
        [m, m],
        [o.width - m, m],
        [o.width - m, o.height - m],
        [m, o.height - m],
        [m, m],
      ],
      0,
    );
  if (diagram) {
    // Ink to the first pen, red to the second when there is one.
    const red = layers.length > 1 ? 1 : 0;
    for (const s of diagram.strokes) add(s.pts, s.color === "red" ? red : 0);
  }
  return {
    options: o,
    layers,
    bounds: box,
    limited: pathCount >= MAX_PATHS,
    diagram: diagram ? { errors: diagram.errors, stats: diagram.stats } : null,
  };
}

/** Local nearest-end routing, indexed by spatial cells, with reversible paths. */
export function routePaths(paths) {
  if (paths.length < 2) return paths.map((p) => p.map((x) => [...x]));
  const cell = 12,
    buckets = new Map(),
    used = new Uint8Array(paths.length);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  paths.forEach((p, i) => {
    for (const [rev, v] of [
      [false, p[0]],
      [true, p.at(-1)],
    ]) {
      const x = Math.floor(v[0] / cell),
        y = Math.floor(v[1] / cell),
        key = x + "," + y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ i, rev, v });
    }
  });
  const result = [];
  let cursor = [0, 0];
  for (let count = 0; count < paths.length; count++) {
    const bx = Math.floor(cursor[0] / cell),
      by = Math.floor(cursor[1] / cell);
    let best = null,
      bd = Infinity;
    const limit = Math.max(
      Math.abs(bx - minX),
      Math.abs(bx - maxX),
      Math.abs(by - minY),
      Math.abs(by - maxY),
    );
    for (let r = 0; r <= limit; r++) {
      for (let x = bx - r; x <= bx + r; x++)
        for (let y = by - r; y <= by + r; y++) {
          if (r > 0 && x !== bx - r && x !== bx + r && y !== by - r && y !== by + r) continue;
          const bucket = buckets.get(x + "," + y);
          if (!bucket) continue;
          for (const candidate of bucket) {
            if (used[candidate.i]) continue;
            const dd = dist(cursor, candidate.v);
            if (dd < bd) {
              bd = dd;
              best = candidate;
            }
          }
        }
      const edge = Math.min(
        cursor[0] - (bx - r) * cell,
        (bx + r + 1) * cell - cursor[0],
        cursor[1] - (by - r) * cell,
        (by + r + 1) * cell - cursor[1],
      );
      if (best && bd <= edge) break;
    }
    if (!best) break;
    used[best.i] = 1;
    const p = paths[best.i].map((x) => [...x]);
    if (best.rev) p.reverse();
    result.push(p);
    cursor = p.at(-1);
  }
  return result;
}

export function prepare(plot, optimized = false) {
  return {
    ...plot,
    sorted: optimized,
    layers: plot.layers.map((l) => ({
      ...l,
      paths: optimized ? routePaths(l.paths) : l.paths,
    })),
  };
}

export function metrics(plot) {
  let draw = 0,
    travel = 0,
    count = 0,
    points = 0;
  for (const l of plot.layers) {
    let cursor = [0, 0];
    for (const p of l.paths) {
      count++;
      points += p.length;
      travel += dist(cursor, p[0]);
      for (let i = 1; i < p.length; i++) draw += dist(p[i - 1], p[i]);
      cursor = p.at(-1);
    }
  }
  const o = plot.options;
  return {
    draw,
    travel,
    count,
    points,
    seconds: draw / o.speed + travel / o.travelSpeed + count * o.liftDelay,
  };
}

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );

export function toSVG(plot, { selected = null, preview = false } = {}) {
  const o = plot.options;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${o.width}mm" height="${o.height}mm" viewBox="0 0 ${o.width} ${o.height}">`,
    `<title>Linework / ${esc(o.mode)} / ${esc(o.seed)}</title>`,
    `<metadata>${esc(JSON.stringify({ generator: "Linework 0.3", ...o }))}</metadata>`,
  ];
  if (preview) parts.push(`<rect width="${o.width}" height="${o.height}" fill="${o.background}"/>`);
  for (const l of plot.layers) {
    if (selected && !selected.includes(l.id)) continue;
    parts.push(
      `<g id="${l.id}" inkscape:groupmode="layer" inkscape:label="${esc(l.name)} ${l.color}" fill="none" stroke="${l.color}" stroke-width="${o.pen}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const p of l.paths)
      parts.push(
        '<path d="' +
          p.map((v, i) => (i ? "L" : "M") + v.map((n) => Number(n.toFixed(3))).join(" ")).join(" ") +
          '"/>',
      );
    parts.push("</g>");
  }
  parts.push("</svg>");
  return parts.join("\n");
}
