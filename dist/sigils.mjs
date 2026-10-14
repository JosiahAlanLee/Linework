/**
 * The Revision 3 sketching marks, ported from the Clavicula Matricis generator
 * (Systems_Practice_Grimoire, generator/core.py and generator/marks.py).
 *
 * Each sigil is drawn in the grimoire's own unit space through a Hand, which
 * records strokes by weight ("core", "orn", "hair") and colour ("ink", "red").
 * Fills become pen strokes: dots are filled with a spiral, polygons with hatching,
 * at a pitch the caller sets from the physical pen width.
 */
import { random } from "./random.mjs";

const TAU = Math.PI * 2;
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- geometry --

export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function arcPts(cx, cy, r, a0, a1, n = null, ry = null) {
  ry = ry ?? r;
  n = n || Math.max(8, Math.floor(Math.abs(a1 - a0) / 4));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / n);
    out.push([cx + r * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

export function spiralPts(cx, cy, rOut, rIn, aOut, turns, hand = 1, n = null) {
  n = n || Math.floor(60 * turns) + 10;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      a = rad(aOut + hand * 360 * turns * t),
      r = rOut + (rIn - rOut) * t;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function curlPts(x0, y0, ang, stem, r, turns = 1.3, hand = 1) {
  const a = rad(ang),
    dx = Math.cos(a),
    dy = Math.sin(a),
    px = x0 + dx * stem,
    py = y0 + dy * stem,
    cx = px - dy * hand * r,
    cy = py + dx * hand * r,
    phi0 = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  return [...(stem > 0 ? [[x0, y0]] : []), ...spiralPts(cx, cy, r, r * 0.16, phi0, turns, hand)];
}

export function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i],
      L = dist(a, b);
    if (L === 0) continue;
    let t = step - carry;
    while (t <= L) {
      out.push(lerp(a, b, t / L));
      t += step;
    }
    carry = L - (t - step);
  }
  if (dist(out.at(-1), pts.at(-1)) > step * 0.1) out.push(pts.at(-1));
  return out;
}

export function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)],
      L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / L) * d, p[1] + ((b[0] - a[0]) / L) * d];
  });
}

export function pathLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Point and unit tangent at arc length s. */
export function pointAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = dist(pts[i - 1], pts[i]);
    if (acc + L >= s && L > 0) {
      const t = (s - acc) / L;
      return [
        lerp(pts[i - 1], pts[i], t),
        [(pts[i][0] - pts[i - 1][0]) / L, (pts[i][1] - pts[i - 1][1]) / L],
      ];
    }
    acc += L;
  }
  const a = pts.at(-2),
    b = pts.at(-1),
    L = dist(a, b) || 1;
  return [b, [(b[0] - a[0]) / L, (b[1] - a[1]) / L]];
}

export function bezier(p0, p1, p2, p3, n = 60) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      m = 1 - t;
    out.push([
      m ** 3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t ** 3 * p3[0],
      m ** 3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t ** 3 * p3[1],
    ]);
  }
  return out;
}

export function catmull(pts, n = 16) {
  const P = [pts[0], ...pts, pts.at(-1)],
    out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < n; k++) {
      const t = k / n,
        t2 = t * t,
        t3 = t2 * t;
      out.push(
        [0, 1].map(
          (j) =>
            0.5 *
            (2 * p1[j] +
              (-p0[j] + p2[j]) * t +
              (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
              (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3),
        ),
      );
    }
  }
  out.push(pts.at(-1));
  return out;
}

export function triPts(cx, cy, w, h, up = true) {
  return up
    ? [
        [cx, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2],
      ]
    : [
        [cx, cy + h / 2],
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
      ];
}

// Polygons are simple rings of points, without a repeated closing point.

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy,
    t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function edgeDist(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** Inset of a convex polygon by d (negative buffer). Returns null when it vanishes. */
export function insetConvex(poly, d) {
  const n = poly.length,
    area = poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * p[1], 0),
    sign = area > 0 ? 1 : -1,
    lines = poly.map((a, i) => {
      const b = poly[(i + 1) % n],
        L = dist(a, b),
        nx = (-(b[1] - a[1]) / L) * sign,
        ny = ((b[0] - a[0]) / L) * sign;
      return [
        [a[0] + nx * d, a[1] + ny * d],
        [b[0] + nx * d, b[1] + ny * d],
      ];
    }),
    out = [];
  for (let i = 0; i < n; i++) {
    const [p1, p2] = lines[(i + n - 1) % n],
      [p3, p4] = lines[i],
      den = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
    if (Math.abs(den) < 1e-12) return null;
    const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / den;
    out.push([p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]);
  }
  // A vanished inset turns inside out.
  const area2 = out.reduce((s, p, i) => s + p[0] * out[(i + 1) % n][1] - out[(i + 1) % n][0] * p[1], 0);
  return Math.sign(area2) === Math.sign(area) && Math.abs(area2) > 1e-9 ? out : null;
}

/** Parallel hatch lines clipped to a polygon (even–odd), as 2-point segments. */
export function hatchLines(poly, step, angDeg, offset = 0) {
  const xs = poly.map((p) => p[0]),
    ys = poly.map((p) => p[1]),
    cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2,
    R = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + step,
    a = rad(angDeg),
    dx = Math.cos(a),
    dy = Math.sin(a),
    nx = -dy,
    ny = dx,
    out = [];
  for (let k = -R + (((offset % step) + step) % step); k <= R; k += step) {
    const px = cx + nx * k,
      py = cy + ny * k,
      ts = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        ex = q[0] - p[0],
        ey = q[1] - p[1],
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p[0] - px) * ey - (p[1] - py) * ex) / den,
        u = ((p[0] - px) * dy - (p[1] - py) * dx) / den;
      if (u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((m, n) => m - n);
    for (let i = 0; i + 1 < ts.length; i += 2)
      if (ts[i + 1] - ts[i] > 1e-6)
        out.push([
          [px + dx * ts[i], py + dy * ts[i]],
          [px + dx * ts[i + 1], py + dy * ts[i + 1]],
        ]);
  }
  return out;
}

/** Diamond lattice: two hatch families and the cell centres well inside the polygon. */
export function lattice(poly, step, ang = 45) {
  const lines = [...hatchLines(poly, step, ang), ...hatchLines(poly, step, -ang)],
    xs = poly.map((p) => p[0]),
    ys = poly.map((p) => p[1]),
    cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2,
    n1 = [-Math.sin(rad(ang)), Math.cos(rad(ang))],
    n2 = [-Math.sin(rad(-ang)), Math.cos(rad(-ang))],
    det = n1[0] * n2[1] - n1[1] * n2[0],
    R =
      Math.floor(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / step) + 2,
    cents = [];
  for (let i = -R; i < R; i++)
    for (let j = -R; j < R; j++) {
      const u = (i + 0.5) * step,
        v = (j + 0.5) * step,
        p = [(u * n2[1] - n1[1] * v) / det + cx, (n1[0] * v - u * n2[0]) / det + cy];
      if (pointInPolygon(p, poly) && edgeDist(p, poly) > step * 0.18) cents.push(p);
    }
  return [lines, cents];
}

// ------------------------------------------------------------------- random --

export function rngFor(seed) {
  const r = random(seed);
  return {
    random: r,
    uniform: (a, b) => a + (b - a) * r(),
    choice: (arr) => arr[Math.floor(r() * arr.length)],
    gauss: (mu = 0, sigma = 1) => {
      const u = 1 - r(),
        v = r();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    },
  };
}

/** Smooth hand tremor: perpendicular offset from a sum of sines along arc length. */
function wobble(rng, pts, amp, step = 3) {
  if (amp <= 0 || pts.length < 2) return pts;
  const rs = resample(pts, step),
    ph = [0, 0, 0].map(() => rng.uniform(0, 6.283)),
    wl = [0, 0, 0].map(() => rng.uniform(22, 61));
  let s = 0;
  return rs.map((p, i) => {
    if (i) s += dist(rs[i - 1], p);
    const a = rs[Math.max(0, i - 1)],
      b = rs[Math.min(rs.length - 1, i + 1)],
      L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
      o =
        amp *
        (0.6 * Math.sin((s / wl[0]) * 6.283 + ph[0]) +
          0.3 * Math.sin((s / wl[1]) * 6.283 + ph[1]) +
          0.25 * Math.sin((s / wl[2]) * 2.1 + ph[2]));
    return [p[0] - ((b[1] - a[1]) / L) * o, p[1] + ((b[0] - a[0]) / L) * o];
  });
}

// --------------------------------------------------------------------- hand --

/**
 * Records strokes in unit space. `fillPitch` is the spacing used to fill dots and
 * polygons with pen strokes; `tremor` scales the grimoire's hand wobble.
 */
export class Hand {
  constructor(rng, { amp = 0.5, tremor = 1, fillPitch = 1 } = {}) {
    this.rng = rng;
    this.amp = amp;
    this.tremor = tremor;
    this.fillPitch = fillPitch;
    this.strokes = [];
  }
  stroke(pts, weight = "orn", color = "ink", closed = false, amp = null) {
    if (pts.length < 2) return;
    if (closed) pts = [...pts, pts[0]];
    this.strokes.push({ pts: wobble(this.rng, pts, (amp ?? this.amp) * this.tremor), weight, color });
  }
  raw(pts, weight, color) {
    if (pts.length > 1) this.strokes.push({ pts, weight, color });
  }
  /** A filled dot as one spiral stroke plus its rim. */
  dot(x, y, r, color = "ink") {
    const p = this.fillPitch,
      rim = arcPts(x, y, r, 0, 360, Math.max(12, Math.ceil(r * 6)));
    this.raw(rim, "hair", color);
    if (r > p * 0.75) {
      const turns = r / p,
        n = Math.ceil(turns * 24);
      this.raw(spiralPts(x, y, r - p * 0.5, 0, 0, turns - 0.5, 1, n), "hair", color);
    }
  }
  fillPoly(pts, color = "ink") {
    for (const [a, b] of hatchLines(pts, this.fillPitch, 45)) this.raw([a, b], "hair", color);
    this.stroke(pts, "hair", color, true, 0);
  }
  ring(x, y, r, weight = "orn", color = "ink") {
    this.stroke(
      arcPts(x, y, r, 0, 360, Math.max(16, Math.floor(r * 2.2))),
      weight,
      color,
      false,
      Math.min(0.4, r * 0.05),
    );
  }
}

// ----------------------------------------------------------------- ornament --

export function asterisk(
  h,
  cx,
  cy,
  r,
  n = 8,
  { rotDeg = null, weight = "orn", color = "ink", tipdots = false, centre = true } = {},
) {
  rotDeg = rotDeg ?? h.rng.uniform(0, 45);
  for (let i = 0; i < n / 2; i++) {
    const a = rad(rotDeg + (i * 360) / n);
    h.stroke(
      [
        [cx - r * Math.cos(a), cy - r * Math.sin(a)],
        [cx + r * Math.cos(a), cy + r * Math.sin(a)],
      ],
      weight,
      color,
      false,
      0.15,
    );
  }
  if (centre) h.dot(cx, cy, Math.max(0.9, r * 0.16), color);
  if (tipdots)
    for (let i = 0; i < n; i++) {
      const a = rad(rotDeg + (i * 360) / n);
      h.dot(cx + r * 1.18 * Math.cos(a), cy + r * 1.18 * Math.sin(a), Math.max(0.7, r * 0.09), color);
    }
}

export function curl(
  h,
  x0,
  y0,
  ang,
  stem,
  r,
  turns = 1.25,
  hand = 1,
  weight = "orn",
  color = "ink",
  endDot = true,
) {
  const pts = curlPts(x0, y0, ang, stem, r, turns, hand);
  h.stroke(pts, weight, color);
  if (endDot) h.dot(pts.at(-1)[0], pts.at(-1)[1], Math.max(0.9, r * 0.13), color);
  return pts;
}

export function dotted(h, pts, spacing, r, color = "ink", skipEnds = true) {
  const L = pathLen(pts),
    n = Math.floor(L / spacing);
  for (let i = skipEnds ? 1 : 0; i < n + (skipEnds ? 0 : 1); i++) {
    const [p] = pointAt(pts, (i * L) / Math.max(1, n));
    h.dot(p[0], p[1], r, color);
  }
}

export function arrowhead(h, tip, angDeg, size, color = "ink", weight = "core", filled = false) {
  const a = rad(angDeg),
    l = [tip[0] - size * Math.cos(a - 0.42), tip[1] - size * Math.sin(a - 0.42)],
    r = [tip[0] - size * Math.cos(a + 0.42), tip[1] - size * Math.sin(a + 0.42)];
  if (filled) h.fillPoly([l, tip, r, lerp(tip, lerp(l, r, 0.5), 0.72)], color);
  else h.stroke([l, tip, r], weight, color, false, 0.1);
}

export function latticeFill(
  h,
  pts,
  step,
  { marker = "x", weight = "hair", color = "ink", ang = 45, msize = 0.3, outline = true } = {},
) {
  const [lines, cents] = lattice(pts, step, ang);
  for (const ln of lines) h.stroke(ln, weight, color, false, 0.15);
  for (const [x, y] of cents) {
    const m = marker !== "mixed" ? marker : h.rng.choice(["x", "x", "dot", "star", "none"]),
      s = step * msize;
    if (m === "x") {
      h.stroke(
        [
          [x - s, y - s],
          [x + s, y + s],
        ],
        "hair",
        color,
        false,
        0.05,
      );
      h.stroke(
        [
          [x + s, y - s],
          [x - s, y + s],
        ],
        "hair",
        color,
        false,
        0.05,
      );
    } else if (m === "dot") h.dot(x, y, Math.max(0.8, step * 0.07), color);
    else if (m === "star") asterisk(h, x, y, s * 1.1, 8, { weight: "hair", color, centre: false });
  }
  if (outline) h.stroke(pts, weight !== "hair" ? weight : "orn", color, true);
  return cents;
}

export function ringX(h, cx, cy, rOut, rIn, cells, weight = "hair", color = "ink", dots = true) {
  h.stroke(arcPts(cx, cy, rOut, 0, 360, 180), weight, color);
  h.stroke(arcPts(cx, cy, rIn, 0, 360, 180), weight, color);
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  for (let i = 0; i < cells; i++) {
    const a0 = (TAU * i) / cells,
      a1 = (TAU * (i + 1)) / cells;
    h.stroke([p(rIn, a0), p(rOut, a0)], "hair", color, false, 0.05);
    h.stroke([p(rIn, a0), p(rOut, a1)], "hair", color, false, 0.05);
    h.stroke([p(rOut, a0), p(rIn, a1)], "hair", color, false, 0.05);
    if (dots) {
      const q = p((rIn + rOut) / 2, (a0 + a1) / 2);
      h.dot(q[0], q[1], Math.max(0.7, (rOut - rIn) * 0.08), color);
    }
  }
}

/** The variable ring every seal carries (Tabula XIII); the mark inside stays the stable core. */
export function sealOrnament(h, cx, cy, r) {
  const band = h.rng.choice(["x", "dots", "ticks", "x"]);
  if (band === "x") ringX(h, cx, cy, r - 1, r - 9, h.rng.choice([24, 28, 32]), "hair", "ink");
  else if (band === "dots") {
    h.stroke(arcPts(cx, cy, r - 1, 0, 360, 160), "hair");
    dotted(h, arcPts(cx, cy, r - 6, 0, 360, 160), 5.2, 0.9, "ink", false);
  } else {
    h.stroke(arcPts(cx, cy, r - 1, 0, 360, 160), "hair");
    for (let k = 0; k < 48; k++) {
      const a = rad(k * 7.5),
        r1 = r - (k % 4 === 0 ? 8 : 5);
      h.stroke(
        [
          [cx + (r - 1) * Math.cos(a), cy + (r - 1) * Math.sin(a)],
          [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)],
        ],
        "hair",
      );
    }
  }
  r -= 12;
  const kind = h.rng.choice(["stars", "crooks", "dots", "rays"]);
  if (kind === "stars")
    for (let i = 0; i < 8; i++) {
      const a = rad(22.5 + i * 45);
      asterisk(h, cx + r * 0.82 * Math.cos(a), cy + r * 0.82 * Math.sin(a), 3.2, 8, { weight: "hair" });
    }
  else if (kind === "crooks")
    for (let i = 0; i < 4; i++) {
      const a = 45 + i * 90;
      curl(
        h,
        cx + r * 0.9 * Math.cos(rad(a)),
        cy + r * 0.9 * Math.sin(rad(a)),
        a + 180,
        3,
        5.5,
        1.3,
        1,
        "hair",
      );
    }
  else if (kind === "dots")
    for (let i = 0; i < 16; i++) {
      const a = rad(i * 22.5 + 11.25);
      h.dot(cx + r * 0.84 * Math.cos(a), cy + r * 0.84 * Math.sin(a), 1.1);
    }
  else
    for (let i = 0; i < 12; i++) {
      const a = rad(i * 30 + 15);
      h.stroke(
        [
          [cx + r * 0.78 * Math.cos(a), cy + r * 0.78 * Math.sin(a)],
          [cx + r * 0.88 * Math.cos(a), cy + r * 0.88 * Math.sin(a)],
        ],
        "hair",
      );
    }
}

// ------------------------------------------------------------------- sigils --
// Each draws centred on (cx, cy). Sizes follow Tabula XIII's draw_mark with s = 150.

function sigStanding(h, cx, cy, r, orn) {
  h.dot(cx, cy, r);
  if (orn <= 0) return;
  const R = r * 2.05;
  h.ring(cx, cy, R, "hair");
  dotted(h, arcPts(cx, cy, R * 1.32, 0, 360, 90), R * 0.36, Math.max(0.9, r * 0.09), "ink", false);
  const k = h.rng.choice([3, 5]);
  for (let i = 0; i < k; i++) {
    const ar = rad(-90 + (i - (k - 1) / 2) * (100 / Math.max(1, k - 1))),
      p0 = [cx + R * Math.cos(ar), cy + R * Math.sin(ar)],
      p1 = [cx + R * 1.95 * Math.cos(ar), cy + R * 1.95 * Math.sin(ar)];
    h.stroke([p0, p1], "hair");
    asterisk(h, p1[0], p1[1], r * 0.55, 8, { weight: "hair" });
  }
  for (const sgn of [-1, 1])
    curl(h, cx + sgn * R, cy, sgn > 0 ? 0 : 180, R * 0.55, R * 0.42, 1.3, -sgn, "hair");
}

function brokenRing(h, cx, cy, r, period) {
  const seg = arcPts(cx, cy, r, 0, 360, 120);
  let run = [];
  seg.forEach((p, i) => {
    if (Math.floor(i / period) % 2 === 0) run.push(p);
    else {
      if (run.length > 1) h.stroke(run, "hair", "ink", false, 0.1);
      run = [];
    }
  });
  if (run.length > 1) h.stroke(run, "hair", "ink", false, 0.1);
}

function sigCandidate(h, cx, cy, r, orn) {
  h.ring(cx, cy, r, "core");
  if (orn <= 0) return;
  brokenRing(h, cx, cy, r * 1.7, 6);
  brokenRing(h, cx, cy, r * 2.35, 9);
  for (let i = 0; i < 4; i++) {
    const a = rad(45 + i * 90);
    h.ring(cx + r * 3 * Math.cos(a), cy + r * 3 * Math.sin(a), r * 0.28, "hair");
  }
}

function sigGate(h, cx, cy, w, ht, orn) {
  const A = [
      [cx - w / 2, cy - ht / 2],
      [cx + w / 2, cy - ht / 2],
      [cx, cy],
    ],
    B = [
      [cx - w / 2, cy + ht / 2],
      [cx + w / 2, cy + ht / 2],
      [cx, cy],
    ];
  if (orn > 0)
    for (const T of [A, B]) {
      const inset = insetConvex(T, w * 0.045);
      if (inset) latticeFill(h, inset, w * 0.105, { marker: "mixed", outline: false, msize: 0.26 });
    }
  h.stroke(A, "core", "ink", true);
  h.stroke(B, "core", "ink", true);
  h.dot(cx, cy, w * 0.075, "red");
  if (orn <= 0) return;
  for (const c of [A[0], A[1], B[0], B[1]]) {
    const sx = c[0] < cx ? -1 : 1,
      sy = c[1] < cy ? -1 : 1;
    curl(h, c[0], c[1], sx > 0 ? 0 : 180, w * 0.16, w * 0.11, 1.35, sx * sy, "hair");
    asterisk(h, c[0] + sx * w * 0.02, c[1] + sy * w * 0.02, w * 0.055, 8, { weight: "hair", centre: false });
  }
  h.ring(cx, cy, w * 0.14, "hair", "red");
}

function sigAuthority(h, cx, cy, w, ht, orn) {
  const T = triPts(cx, cy, w, ht),
    apex = T[0];
  if (orn > 0) {
    const inner = insetConvex(T, w * 0.075);
    if (inner) latticeFill(h, inner, w * 0.085, { marker: "mixed", msize: 0.28 });
    h.stroke(triPts(cx, cy + ht * 0.02, w * 1.16, ht * 1.14), "hair", "ink", true);
    const bx0 = cx - w * 0.82,
      bx1 = cx + w * 0.82,
      by = cy + ht / 2 + ht * 0.09;
    h.stroke(
      [
        [bx0, by],
        [bx1, by],
      ],
      "orn",
    );
    dotted(
      h,
      [
        [bx0, by + ht * 0.06],
        [bx1, by + ht * 0.06],
      ],
      w * 0.06,
      Math.max(0.8, w * 0.009),
    );
    asterisk(h, bx0, by, w * 0.055, 8, { weight: "hair" });
    asterisk(h, bx1, by, w * 0.055, 8, { weight: "hair" });
    for (const sgn of [-1, 1]) curl(h, cx + sgn * w * 0.58, by, 90, ht * 0.05, w * 0.07, 1.3, -sgn, "hair");
    const hr = w * 0.2,
      cyh = apex[1] - ht * 0.03 - hr * 0.98,
      outer = arcPts(cx, cyh, hr, -42, 222, 70),
      inner2 = arcPts(cx, cyh - hr * 0.34, hr * 0.8, -36, 216, 70);
    h.fillPoly([...outer, ...inner2.reverse()]);
    asterisk(h, cx, cyh - hr * 0.25, hr * 0.26, 8, { weight: "orn", color: "red" });
  }
  h.stroke(T, "core", "ink", true);
}

/** Revision 5's mark: an open, branching spiral; no central dot, open outer end, one branch. */
function sigMark(
  h,
  cx,
  cy,
  r,
  { color = "red", weight = "core", branch = true, turns = 1.75, hand = 1, ang0 = 90 } = {},
) {
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200,
      a = rad(ang0) + hand * t * turns * TAU,
      rr = r * (0.16 + 0.84 * t);
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  h.stroke(pts, weight, color);
  if (branch) {
    const [p, t] = pointAt(pts, pathLen(pts) * 0.72),
      nx = -t[1] * hand,
      ny = t[0] * hand;
    h.stroke(
      bezier(
        p,
        [p[0] + t[0] * r * 0.35, p[1] + t[1] * r * 0.35],
        [p[0] + t[0] * r * 0.55 - nx * r * 0.42, p[1] + t[1] * r * 0.55 - ny * r * 0.42],
        [p[0] + t[0] * r * 0.45 - nx * r * 0.75, p[1] + t[1] * r * 0.45 - ny * r * 0.75],
        30,
      ),
      weight,
      color,
    );
  }
  return pts;
}

export function sigGround(h, x0, x1, y, depth, step = 7) {
  h.stroke(
    [
      [x0, y],
      [x1, y],
    ],
    "core",
  );
  h.stroke(
    [
      [x0, y + 3.2],
      [x1, y + 3.2],
    ],
    "hair",
  );
  for (let x = x0 + 3; x < x1 - 2; x += step * h.rng.uniform(0.8, 1.2)) {
    const ln = depth * h.rng.uniform(0.55, 1);
    h.stroke(
      [
        [x, y + 5],
        [x - ln * 0.55, y + 5 + ln],
      ],
      "hair",
      "ink",
      false,
      0.1,
    );
  }
  for (let i = 0; i < Math.floor((x1 - x0) / 70); i++) {
    const pts = [[h.rng.uniform(x0 + 20, x1 - 20), y + 4]];
    for (let k = 0; k < 5; k++)
      pts.push([pts.at(-1)[0] + h.rng.uniform(-6, 6), pts.at(-1)[1] + depth * 0.32]);
    h.stroke(catmull(pts, 6), "hair");
    h.dot(pts.at(-1)[0], pts.at(-1)[1], 1.1);
  }
}

export function sigBreak(h, x, y, s, color = "red") {
  for (const a of [45, 135]) {
    const p0 = [x - s * Math.cos(rad(a)), y - s * Math.sin(rad(a))],
      p1 = [x + s * Math.cos(rad(a)), y + s * Math.sin(rad(a))];
    h.stroke([p0, p1], "core", color, false, 0.2);
    asterisk(h, p0[0] + (p0[0] - x) * 0.25, p0[1] + (p0[1] - y) * 0.25, s * 0.28, 8, {
      weight: "hair",
      color,
    });
    asterisk(h, p1[0] + (p1[0] - x) * 0.25, p1[1] + (p1[1] - y) * 0.25, s * 0.28, 8, {
      weight: "hair",
      color,
    });
  }
  h.ring(x, y, s * 0.38, "hair", color);
}

function sigRegulation(h, cx, cy, r, orn) {
  const pts = arcPts(cx, cy, r, -60, 250, 80);
  h.stroke(pts, "core");
  const a = (Math.atan2(pts.at(-1)[1] - pts.at(-3)[1], pts.at(-1)[0] - pts.at(-3)[0]) * 180) / Math.PI;
  arrowhead(h, pts.at(-1), a, r * 0.38);
  if (orn <= 0) return;
  for (let i = 0; i < 24; i++) {
    const ang = rad(i * 15),
      r0 = r * 1.18,
      r1 = r * (i % 3 === 0 ? 1.32 : 1.25);
    h.stroke(
      [
        [cx + r0 * Math.cos(ang), cy + r0 * Math.sin(ang)],
        [cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang)],
      ],
      "hair",
      "ink",
      false,
      0.03,
    );
  }
  const sp = [cx + r * 1.62 * Math.cos(rad(-60)), cy + r * 1.62 * Math.sin(rad(-60))];
  asterisk(h, sp[0], sp[1], r * 0.2, 8, { weight: "hair" });
  h.ring(cx, cy, r * 0.42, "hair");
}

function sigRevision(h, cx, cy, s, orn) {
  const pts = sigMark(h, cx, cy, s * 0.44, { branch: false });
  if (orn <= 0) return;
  dotted(h, offsetLine(pts.slice(60), s * 0.07), s * 0.075, 0.9, "red");
  asterisk(h, pts.at(-1)[0], pts.at(-1)[1] - 7, 4, 8, { weight: "hair", color: "red" });
}

function sigBottleneck(h, cx, cy, s, orn) {
  const L = [
      [cx - s, cy - s * 0.55],
      [cx - s, cy + s * 0.55],
    ],
    R = [
      [cx + s, cy - s * 0.55],
      [cx + s, cy + s * 0.55],
    ];
  for (const p of [...L, ...R]) {
    h.stroke([p, [cx, cy]], "orn");
    h.dot(p[0], p[1], s * 0.11);
  }
  h.stroke(L, "orn");
  h.stroke(R, "orn");
  if (orn > 0)
    for (const [grp, sx] of [
      [L, -1],
      [R, 1],
    ]) {
      latticeFill(h, [grp[0], grp[1], [cx + sx * s * 0.22, cy]], s * 0.2, { marker: "x", outline: false });
      for (const p of grp) asterisk(h, p[0] + sx * s * 0.28, p[1], s * 0.13, 8, { weight: "hair" });
    }
  h.dot(cx, cy, s * 0.16, "red");
  h.ring(cx, cy, s * 0.27, "hair", "red");
}

/** Additive change (branch, old kept) or substitutive change (old route struck out). */
export function sigBranch(h, x0, x1, y, struck, orn = 1) {
  const xm = x0 + (x1 - x0) * 0.34;
  if (struck) {
    h.stroke(
      [
        [x0, y],
        [xm, y],
      ],
      "core",
    );
    for (let x = xm; x < x1; x += 11)
      h.stroke(
        [
          [x + 2, y],
          [Math.min(x1, x + 7), y],
        ],
        "orn",
        "ink",
        false,
        0.05,
      );
    const sx = xm + (x1 - xm) * 0.45,
      s = (x1 - x0) * 0.1;
    h.stroke(
      [
        [sx - s, y - s],
        [sx + s, y + s],
      ],
      "core",
    );
    h.stroke(
      [
        [sx + s, y - s],
        [sx - s, y + s],
      ],
      "core",
    );
  } else
    h.stroke(
      [
        [x0, y],
        [x1, y],
      ],
      "core",
    );
  const br = bezier(
    [xm, y],
    [xm + (x1 - x0) * 0.24, y],
    [x1 - (x1 - x0) * 0.3, y - (x1 - x0) * 0.32],
    [x1, y - (x1 - x0) * 0.34],
    40,
  );
  h.stroke(br, "core", "red");
  if (orn > 0) {
    asterisk(h, x1 + 4, y - (x1 - x0) * 0.34, (x1 - x0) * 0.06, 8, { weight: "hair", color: "red" });
    asterisk(h, x0 - 4, y, (x1 - x0) * 0.05, 8, { weight: "hair" });
    if (!struck) asterisk(h, x1 + 4, y, (x1 - x0) * 0.05, 8, { weight: "hair" });
    dotted(h, offsetLine(br, -(x1 - x0) * 0.05), (x1 - x0) * 0.06, 0.9, "red");
  }
}

function sigReflexive(h, cx, cy, s, orn) {
  const bx = cx - s,
    by = cy - s * 0.32,
    bw = s * 0.62,
    bh = s * 0.62,
    box = [
      [bx, by],
      [bx + bw, by],
      [bx + bw, by + bh],
      [bx, by + bh],
    ];
  if (orn > 0) latticeFill(h, box, bw * 0.24, { marker: "dot", outline: false });
  h.stroke(box, "core", "ink", true);
  const ax0 = bx + bw + s * 0.08,
    ax1 = cx + s * 0.72;
  h.stroke(
    [
      [ax0, cy],
      [ax1, cy],
    ],
    "orn",
  );
  arrowhead(h, [ax1, cy], 0, s * 0.16, "ink", "orn");
  h.dot(cx + s * 0.88, cy, s * 0.11);
  const ret = bezier(
    [cx + s * 0.88, cy - s * 0.16],
    [cx + s * 0.88, cy - s * 0.95],
    [bx + bw / 2, cy - s],
    [bx + bw / 2, by - s * 0.06],
    50,
  );
  h.stroke(ret, "core", "red");
  const a = (Math.atan2(ret.at(-1)[1] - ret.at(-3)[1], ret.at(-1)[0] - ret.at(-3)[0]) * 180) / Math.PI;
  arrowhead(h, ret.at(-1), a, s * 0.16, "red", "orn");
  if (orn > 0) dotted(h, offsetLine(ret, s * 0.09), s * 0.09, 0.8, "red");
}

function sigInvariant(h, cx, cy, s, orn) {
  const x0 = cx - s * 0.7,
    x1 = cx + s * 0.55,
    y0 = cy - s * 0.6,
    y1 = cy + s * 0.6;
  h.stroke(
    [
      [x1, y0],
      [x0, y0],
      [x0, y1],
      [x1, y1],
    ],
    "core",
  );
  h.stroke(
    [
      [x1, y1],
      [x1, cy + s * 0.2],
    ],
    "core",
  );
  h.stroke(
    [
      [x1, y0],
      [x1, cy - s * 0.2],
    ],
    "core",
  );
  if (orn <= 0) return;
  const wall = [
    [x0 - s * 0.12, y0 - s * 0.12],
    [x1 + s * 0.02, y0 - s * 0.12],
    [x1 + s * 0.02, y0],
    [x0, y0],
    [x0, y1],
    [x1 + s * 0.02, y1],
    [x1 + s * 0.02, y1 + s * 0.12],
    [x0 - s * 0.12, y1 + s * 0.12],
  ];
  for (const ln of hatchLines(wall, s * 0.07, 60)) h.stroke(ln, "hair", "ink", false, 0.05);
  for (const yy of [cy - s * 0.2, cy + s * 0.2])
    asterisk(h, x1 + s * 0.16, yy, s * 0.09, 8, { weight: "hair" });
}

/** Dashed circle: a commons or institution. */
export function sigBoundary(h, cx, cy, r, orn, { ry = r, members = true } = {}) {
  const seg = arcPts(cx, cy, r, 0, 360, 160, ry);
  let run = [];
  seg.forEach((p, i) => {
    if (Math.floor(i / 7) % 2 === 0) run.push(p);
    else {
      if (run.length > 1) h.stroke(run, "orn", "ink", false, 0.1);
      run = [];
    }
  });
  if (run.length > 1) h.stroke(run, "orn", "ink", false, 0.1);
  if (members) {
    h.dot(cx - r * 0.33, cy + ry * 0.15, Math.min(r, ry) * 0.14);
    h.dot(cx + r * 0.3, cy - ry * 0.22, Math.min(r, ry) * 0.14);
  }
  if (orn <= 0) return;
  h.stroke(arcPts(cx, cy, r * 1.06, 0, 360, 160, ry * 1.06 + r * 0.0), "hair");
  for (let i = 0; i < 4; i++) {
    const a = rad(i * 90);
    asterisk(h, cx + r * 1.06 * Math.cos(a), cy + ry * 1.06 * Math.sin(a), Math.min(r, ry, 40) * 0.13, 8, {
      weight: "hair",
    });
  }
}

/** Dashed pointer: an unverified attribution. */
export function sigPointer(h, p0, p1, color = "red", dash = 7, gap = 5) {
  const L = dist(p0, p1),
    n = Math.floor(L / (dash + gap));
  for (let i = 0; i < n; i++)
    h.stroke(
      [lerp(p0, p1, (i * (dash + gap)) / L), lerp(p0, p1, Math.min(1, (i * (dash + gap) + dash) / L))],
      "orn",
      color,
      false,
      0.05,
    );
  arrowhead(h, p1, (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI, 11, color, "orn");
  h.ring(p0[0], p0[1], 4.5, "hair", color);
}

/**
 * Node marks, keyed by notation name. Names and meanings follow Tabula XIII
 * ("Of the Twelve Marks and the Mark"); gate and the mark follow plates VIII and §13.
 */
export const NODE_MARKS = {
  standing: {
    name: "Interest-bearing being",
    meaning: "has standing (P5)",
    draw: (h, s, o) => sigStanding(h, 0, 4, s * 0.15, o),
  },
  candidate: {
    name: "Sentience candidate",
    meaning: "standing uncertain",
    draw: (h, s, o) => sigCandidate(h, 0, 0, s * 0.15, o),
  },
  authority: {
    name: "Centre of decision",
    meaning: "authority, contestable",
    draw: (h, s, o) => sigAuthority(h, 0, s * 0.14, s * 0.68, s * 0.55, o),
  },
  gate: {
    name: "Gate",
    meaning: "a required gate",
    draw: (h, s, o) => sigGate(h, 0, 0, s * 0.5, s * 0.62, o),
  },
  bottleneck: {
    name: "Bottleneck",
    meaning: "fails the bypass test",
    draw: (h, s, o) => sigBottleneck(h, 0, 0, s * 0.48, o),
  },
  regulation: {
    name: "Regulation",
    meaning: "returns to set point",
    draw: (h, s, o) => sigRegulation(h, 0, 0, s * 0.36, o),
  },
  revision: { name: "Revision", meaning: "returns displaced", draw: (h, s, o) => sigRevision(h, 0, 0, s, o) },
  reflexive: {
    name: "Reflexive loop",
    meaning: "the map moves it",
    draw: (h, s, o) => sigReflexive(h, 0, s * 0.12, s * 0.52, o),
  },
  invariant: {
    name: "Learned invariant",
    meaning: "hard walls, one door",
    draw: (h, s, o) => sigInvariant(h, s * 0.04, 0, s * 0.6, o),
  },
  boundary: {
    name: "Boundary",
    meaning: "commons or institution",
    draw: (h, s, o) => sigBoundary(h, 0, 0, s * 0.42, o),
  },
  ground: {
    name: "Generative substrate",
    meaning: "conditions beneath",
    draw: (h, s, o) => {
      sigGround(h, -s * 0.55, s * 0.55, s * 0.04, s * 0.26, 5.5);
      if (o > 0) {
        h.dot(0, -s * 0.2, s * 0.08);
        asterisk(h, -s * 0.3, -s * 0.24, 3.4, 8, { weight: "hair" });
        asterisk(h, s * 0.3, -s * 0.24, 3.4, 8, { weight: "hair" });
      }
    },
  },
  mark: {
    name: "The mark",
    meaning: "return from a changed position",
    draw: (h, s) => sigMark(h, 0, 0, s * 0.44, { branch: true }),
  },
};

/** Route marks. `sample` draws a short specimen for the key, in unit space. */
export const EDGE_MARKS = {
  added: {
    name: "Additive change",
    meaning: "new branch, old kept",
    sample: (h, s, o) => sigBranch(h, -s * 0.52, s * 0.46, s * 0.14, false, o),
  },
  struck: {
    name: "Substitutive change",
    meaning: "old route struck out",
    sample: (h, s, o) => sigBranch(h, -s * 0.52, s * 0.46, s * 0.14, true, o),
  },
  pointer: {
    name: "Pointer",
    meaning: "unverified attribution",
    sample: (h, s) => sigPointer(h, [-s * 0.5, s * 0.1], [s * 0.45, -s * 0.05]),
  },
  break: { name: "Break", meaning: "a cut", sample: (h, s) => sigBreak(h, 0, 0, s * 0.22) },
};

// --------------------------------------------------------------- lettering --
// Monoline capitals from the grimoire's plotter edition (plotter/build.py), on a
// 4 x 6 grid; spaces separate strokes, commas separate vertices. Punctuation
// after "/" is added here in the same grid.

const ALPHABET = {
  A: "06,20,46 14,34",
  B: "06,00,30,41,32,02 32,43,45,36,06",
  C: "40,10,01,05,16,46",
  D: "06,00,20,41,45,26,06",
  E: "40,00,06,46 03,33",
  F: "40,00,06 03,33",
  G: "40,10,01,05,16,46,43,23",
  H: "00,06 40,46 03,43",
  I: "00,40 20,26 06,46",
  J: "00,40,45,36,16,05",
  K: "00,06 40,03,46",
  L: "00,06,46",
  M: "06,00,23,40,46",
  N: "06,00,46,40",
  O: "10,30,41,45,36,16,05,01,10",
  P: "06,00,30,41,42,33,03",
  Q: "10,30,41,45,36,16,05,01,10 24,47",
  R: "06,00,30,41,42,33,03 23,46",
  S: "40,10,01,02,13,33,44,45,36,06",
  T: "00,40 20,26",
  U: "00,05,16,36,45,40",
  V: "00,26,40",
  W: "00,16,23,36,40",
  X: "00,46 40,06",
  Y: "00,23,40 23,26",
  Z: "00,40,06,46",
  0: "10,30,41,45,36,16,05,01,10 04,42",
  1: "01,20,26 06,46",
  2: "01,10,30,41,42,06,46",
  3: "00,30,41,32,22 32,43,45,36,06",
  4: "30,03,43 30,36",
  5: "40,00,03,33,44,45,36,06",
  6: "40,10,01,05,16,36,45,44,33,03",
  7: "00,40,16",
  8: "10,30,41,42,33,13,02,01,10 13,04,05,16,36,45,44,33",
  9: "43,13,02,01,10,30,41,45,36,06",
  ".": "25,26",
  "-": "03,43",
  "/": "40,06",
  ":": "21,22 24,25",
  ",": "25,17",
  ";": "21,22 25,17",
  "'": "20,21",
  '"': "10,11 30,31",
  "(": "30,12,14,36",
  ")": "10,32,34,16",
  "?": "01,10,30,41,42,23,24 25,26",
  "!": "20,24 25,26",
  "&": "46,02,01,10,20,31,02,05,16,26,44",
  "+": "03,43 21,25",
  "=": "02,42 04,44",
  "§": "40,10,01,02,13,33,44,45,36,06 21,22",
};

/** Single-stroke capitals. (x, y) is the top-left of the first capital, in mm. */
export function monoline(text, x, y, height, align = "left") {
  text = String(text).toUpperCase();
  const unit = height / 6,
    width = Math.max(0, (text.length * 6 - 2) * unit);
  x -= align === "center" ? width / 2 : align === "right" ? width : 0;
  const strokes = [];
  for (const ch of text) {
    const spec = ALPHABET[ch];
    if (spec)
      for (const stroke of spec.split(" "))
        strokes.push(stroke.split(",").map((p) => [x + Number(p[0]) * unit, y + Number(p[1]) * unit]));
    x += height;
  }
  return strokes;
}

export const textWidth = (text, height) => Math.max(0, (String(text).length * 6 - 2) * (height / 6));

/** Greedy word wrap for monoline text to a width in mm. */
export function wrapText(text, height, width) {
  const words = String(text).split(/\s+/).filter(Boolean),
    lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (line && textWidth(next, height) > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
