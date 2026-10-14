/**
 * Diagrams in the grimoire's sketching marks.
 *
 * A diagram is written as text (see NOTATION). Layout is automatic; the seed only
 * varies ornament and hand tremor. Every mark used is listed in a key with its
 * meaning, because Revision 5 (§13) allows the marks "provided each mark's
 * meaning is stated every time it is used".
 */
import {
  Hand,
  rngFor,
  NODE_MARKS,
  EDGE_MARKS,
  sigBoundary,
  sigGround,
  sigBreak,
  sealOrnament,
  asterisk,
  arrowhead,
  dotted,
  offsetLine,
  pathLen,
  pointAt,
  bezier,
  catmull,
  monoline,
  wrapText,
  textWidth,
} from "./sigils.mjs";

export const NOTATION = `# One mark per line:      <mark> <id> "label"
# Marks: standing candidate authority gate bottleneck regulation
#        revision reflexive invariant boundary mark
# A boundary can enclose: boundary <id> "label" : <id> <id> ...
# Conditions beneath:     ground "label"
# Routes (chains allowed): a -> b -> c
#   +>  additive change (new branch, old kept)
#   />  substitutive change (old route struck out)
#   ~>  pointer (unverified attribution)
#   -x- route with a break
# Optional route label at the end: a -> b "label"
# Restate a meaning:      meaning gate "a required sign-off"`;

export const EXAMPLE = `# Worked example A: an outage delayed by authority (Revision 5, §8)
# A hypothetical incident, not an account of any employer.
standing   customers  "customers"
standing   technician "technician"
bottleneck matrix     "escalation matrix"
authority  execs      "executives, in conflict"
gate       approval   "dispatch approval"
standing   crew       "field crew"
boundary   provider   "the provider" : technician matrix execs approval
ground     "the fibre plant"

customers -> technician -> matrix -> approval -> crew
execs -> approval
crew -x- customers "fibre cut"
approval ~> execs "delay attributed"
technician +> crew "standing dispatch authority"`;

const EDGE_OPS = { "->": "route", "+>": "added", "/>": "struck", "~>": "pointer", "-x-": "break" };
const FLOW = new Set(["route", "added", "struck", "break"]);
const KINDS = Object.keys(NODE_MARKS);

// ---------------------------------------------------------------- parsing --

function tokenize(line) {
  const out = [],
    re = /"([^"]*)"?|(->|\+>|\/>|~>|-x-|:)|([A-Za-z0-9_]+)|(\S)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) out.push({ t: "str", v: m[1] });
    else if (m[2]) out.push({ t: m[2] === ":" ? "colon" : "op", v: m[2] });
    else if (m[3]) out.push({ t: "word", v: m[3] });
    else out.push({ t: "bad", v: m[4] });
  }
  return out;
}

function stripComment(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === "#" && !quoted) return line.slice(0, i);
  }
  return line;
}

export function parseDiagram(text) {
  const nodes = new Map(),
    boundaries = [],
    grounds = [],
    edges = [],
    meanings = {},
    errors = [],
    pending = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = index + 1,
        tokens = tokenize(stripComment(raw));
      if (!tokens.length) return;
      const err = (message) => errors.push({ line, message });
      const bad = tokens.find((t) => t.t === "bad");
      if (bad) return err(`Unexpected "${bad.v}".`);
      if (tokens.some((t) => t.t === "op")) {
        // Route chain: id op id op id ... ["label"]
        let label = "";
        if (tokens.at(-1).t === "str") label = tokens.pop().v;
        if (tokens.length < 3 || tokens.length % 2 === 0) return err("A route needs a mark on each side.");
        for (let i = 0; i < tokens.length; i++) {
          const want = i % 2 ? "op" : "word";
          if (tokens[i].t !== want)
            return err(i % 2 ? "Expected a route such as -> between marks." : "Expected a mark id.");
        }
        for (let i = 1; i < tokens.length; i += 2)
          pending.push({
            from: tokens[i - 1].v,
            to: tokens[i + 1].v,
            type: EDGE_OPS[tokens[i].v],
            label: i === tokens.length - 2 ? label : "",
            line,
          });
        return;
      }
      const [head, ...rest] = tokens;
      if (head.t !== "word") return err("Start the line with a mark name.");
      const kind = head.v.toLowerCase();
      if (kind === "meaning") {
        const [k, s] = rest;
        const target = k?.v?.toLowerCase();
        if (!k || !s || s.t !== "str") return err('Write: meaning <mark> "text".');
        if (!(target in NODE_MARKS) && !(target in EDGE_MARKS)) return err(`"${k.v}" is not a mark.`);
        meanings[target] = s.v;
        return;
      }
      if (kind === "ground") {
        const id = rest[0]?.t === "word" ? rest.shift().v : "ground";
        const label = rest[0]?.t === "str" ? rest.shift().v : "";
        if (grounds.length) return err("Only one ground is drawn; it runs beneath the whole diagram.");
        if (rest.length) return err("Unexpected text after the ground.");
        grounds.push({ id, label, line });
        return;
      }
      if (!(kind in NODE_MARKS))
        return err(
          `"${head.v}" is not a mark. Use one of: ${KINDS.filter((k) => k !== "ground").join(", ")}.`,
        );
      if (rest[0]?.t !== "word") return err(`Give the ${kind} an id, e.g. ${kind} a1 "label".`);
      const id = rest.shift().v;
      const label = rest[0]?.t === "str" ? rest.shift().v : "";
      let members = null;
      if (rest[0]?.t === "colon") {
        if (kind !== "boundary") return err("Only a boundary can enclose other marks.");
        rest.shift();
        if (rest.some((t) => t.t !== "word")) return err("List member ids after the colon.");
        members = rest.splice(0).map((t) => t.v);
      }
      if (rest.length) return err("Unexpected text after the label.");
      if (nodes.has(id) || boundaries.some((b) => b.id === id)) return err(`"${id}" is already declared.`);
      if (members?.length) boundaries.push({ id, label, members, line });
      else nodes.set(id, { id, kind, label, line });
    });

  const groupOf = new Map();
  for (const b of boundaries) {
    b.members = b.members.filter((m) => {
      if (!nodes.has(m)) {
        errors.push({ line: b.line, message: `"${m}" is not declared as a mark.` });
        return false;
      }
      if (groupOf.has(m)) {
        errors.push({ line: b.line, message: `"${m}" is already inside "${groupOf.get(m)}".` });
        return false;
      }
      groupOf.set(m, b.id);
      return true;
    });
  }
  for (const e of pending) {
    const missing = [e.from, e.to].filter((id) => !nodes.has(id));
    if (missing.length) {
      const enclosing = missing.filter((id) => boundaries.some((b) => b.id === id));
      errors.push({
        line: e.line,
        message: enclosing.length
          ? `Routes join marks; "${enclosing[0]}" is an enclosing boundary.`
          : `"${missing[0]}" is not declared.`,
      });
    } else if (e.from === e.to)
      errors.push({
        line: e.line,
        message: "A route cannot return to the same mark; use regulation or revision.",
      });
    else edges.push(e);
  }
  errors.sort((a, b) => a.line - b.line);
  return { nodes, boundaries, ground: grounds[0] || null, edges, meanings, errors, groupOf };
}

// ----------------------------------------------------------------- layout --

function rankNodes(nodes, edges) {
  const ids = [...nodes.keys()],
    out = new Map(ids.map((id) => [id, []])),
    flow = edges.filter((e) => FLOW.has(e.type));
  for (const e of flow) out.get(e.from).push(e.to);
  // Drop edges that close a cycle (depth-first, declaration order), then take longest paths.
  const state = new Map(),
    keep = new Set();
  const visit = (u) => {
    state.set(u, 1);
    for (const v of out.get(u)) {
      if (state.get(v) === 1) continue;
      keep.add(u + "\u0000" + v);
      if (!state.get(v)) visit(v);
    }
    state.set(u, 2);
  };
  // Declaration order decides where a loop is broken: the first mark declared starts the flow.
  for (const id of ids) if (!state.get(id)) visit(id);
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const key of keep) {
      const [u, v] = key.split("\u0000");
      if (rank.get(v) < rank.get(u) + 1) {
        rank.set(v, rank.get(u) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Pull each source forward to sit just before its nearest target.
  const incoming = new Set([...keep].map((k) => k.split("\u0000")[1]));
  for (const id of ids) {
    if (incoming.has(id)) continue;
    const targets = [...keep]
      .filter((k) => k.startsWith(id + "\u0000"))
      .map((k) => rank.get(k.split("\u0000")[1]));
    if (targets.length) rank.set(id, Math.max(0, Math.min(...targets) - 1));
  }
  return rank;
}

function orderRows(rows, edges, groupOf) {
  const pos = new Map();
  rows.forEach((row) => row.forEach((id, i) => pos.set(id, i / Math.max(1, row.length - 1))));
  const neighbours = new Map();
  for (const e of edges) {
    if (!neighbours.has(e.from)) neighbours.set(e.from, []);
    if (!neighbours.has(e.to)) neighbours.set(e.to, []);
    neighbours.get(e.from).push(e.to);
    neighbours.get(e.to).push(e.from);
  }
  for (let sweep = 0; sweep < 6; sweep++) {
    for (const row of rows) {
      const bary = new Map(
        row.map((id) => {
          const ns = neighbours.get(id) || [];
          return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(id)];
        }),
      );
      // Keep members of one boundary together, ordered by the group's mean position.
      const groupMean = new Map();
      for (const id of row) {
        const g = groupOf.get(id) || id;
        if (!groupMean.has(g)) groupMean.set(g, []);
        groupMean.get(g).push(bary.get(id));
      }
      const mean = (g) => groupMean.get(g).reduce((a, b) => a + b, 0) / groupMean.get(g).length;
      row.sort((a, b) => {
        const ga = groupOf.get(a) || a,
          gb = groupOf.get(b) || b;
        return mean(ga) - mean(gb) || (ga < gb ? -1 : ga > gb ? 1 : 0) || bary.get(a) - bary.get(b);
      });
      row.forEach((id, i) => pos.set(id, i / Math.max(1, row.length - 1)));
    }
  }
}

function bboxOf(strokes) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of strokes)
    for (const [x, y] of s.pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

// ----------------------------------------------------------------- render --

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SEAL_FROM = 0.85; // ornament level at which marks also get Tabula XIII's seal ring

/**
 * Lay out and draw a diagram inside box [x0, y0, x1, y1] (mm).
 * Returns { strokes: [{pts, color}], clearance: region | null, errors, stats }.
 */
export function buildDiagram(options, box) {
  const o = options,
    cfg = o.diagram,
    { nodes, boundaries, ground, edges, meanings, errors, groupOf } = parseDiagram(cfg.text),
    orn = cfg.ornament / 100,
    ornOn = orn > 0.12 ? 1 : 0,
    tremor = (o.distortion / 100) * 1.6,
    pen = o.pen,
    out = [],
    placed = new Map(),
    blocks = []; // rectangles (mm) the other motifs keep clear of
  const result = {
    strokes: out,
    errors,
    clearance: null,
    stats: { marks: nodes.size, routes: edges.length },
  };
  if (!nodes.size && !ground) return result;

  const W = box[2] - box[0],
    margin = Math.min(6, W * 0.03),
    left = box[0] + margin,
    right = box[2] - margin,
    cap = clamp(W / 80, 1.8, 2.8),
    keyCap = clamp(W / 95, 1.7, 2.3),
    kd = clamp(W / 1100, 0.12, 0.25); // mm per grimoire unit for routes, ground and rules

  const emit = (strokes, dx, dy, scale) => {
    for (const s of strokes) {
      const pts = s.pts.map(([x, y]) => [dx + x * scale, dy + y * scale]);
      out.push({ pts, color: s.color });
      // Core strokes are drawn twice, half a pen apart, to read heavier.
      if (s.weight === "core") out.push({ pts: offsetLine(pts, pen * 0.55), color: s.color });
    }
  };
  const hand = (seed, scale) =>
    new Hand(rngFor(`${o.seed}:diagram:${seed}`), { tremor, fillPitch: (pen * 0.85) / scale });
  const labels = [],
    routeMarks = [],
    overlaps = (r, q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3];
  const letter = (text, x, y, height, align = "center", color = "ink", nudge = false) => {
    const w = textWidth(text, height),
      lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x,
      rectAt = (yy) => [lx - 1, yy - 1, lx + w + 1, yy + (height * 7) / 6 + 1];
    // Free-standing labels move up or down until they clear earlier labels and marks.
    if (nudge) {
      const avoid = [...labels, ...routeMarks, ...[...placed.values()].map((p) => p.box)];
      for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4].map((n) => n * height * 1.5))
        if (!avoid.some((q) => overlaps(rectAt(y + dy), q))) {
          y += dy;
          break;
        }
    }
    for (const pts of monoline(text, x, y, height, align)) out.push({ pts, color });
    const rect = rectAt(y);
    blocks.push(rect);
    labels.push(rect);
    return rect;
  };

  // Key entries: every mark used, with its meaning.
  const usedKinds = KINDS.filter(
    (k) =>
      [...nodes.values()].some((n) => n.kind === k) ||
      (k === "boundary" && boundaries.length) ||
      (k === "ground" && ground),
  );
  const usedEdges = Object.keys(EDGE_MARKS).filter((t) => edges.some((e) => e.type === t));
  const entries = [
    ...usedKinds.map((k) => ({
      kind: k,
      node: true,
      name: NODE_MARKS[k].name,
      meaning: meanings[k] ?? NODE_MARKS[k].meaning,
    })),
    ...usedEdges.map((t) => ({
      kind: t,
      node: false,
      name: EDGE_MARKS[t].name,
      meaning: meanings[t] ?? EDGE_MARKS[t].meaning,
    })),
  ];
  const keyCols = W > 260 ? 3 : W > 150 ? 2 : 1,
    specimen = clamp(W / 18, 8, 11),
    colW = (right - left) / keyCols,
    textW = colW - specimen - 6,
    keyRows = [];
  let keyHeight = 0;
  if (cfg.key && entries.length) {
    for (let i = 0; i < entries.length; i += keyCols) {
      const row = entries
        .slice(i, i + keyCols)
        .map((e) => ({ ...e, lines: wrapText(`${e.name}: ${e.meaning}`, keyCap, textW) }));
      const h = Math.max(specimen, Math.max(...row.map((e) => e.lines.length)) * keyCap * 1.7) + 2.5;
      keyRows.push({ row, h });
      keyHeight += h;
    }
    keyHeight += keyCap * 4 + 6; // rule and closing line
  }
  const keyTop = box[3] - keyHeight,
    groundH = ground ? Math.min(20, (keyTop - box[1]) * 0.1) : 0,
    groundY = keyTop - (keyHeight ? 6 : 2) - groundH;
  if (ground) routeMarks.push([box[0], groundY - 1, box[2], box[3]]);
  else if (keyHeight) routeMarks.push([box[0], keyTop, box[2], box[3]]);

  // Ranks, then the orientation that gives the larger marks.
  const rank = rankNodes(nodes, edges),
    R = Math.max(1, ...[...rank.values()].map((r) => r + 1)),
    ranks = Array.from({ length: R }, () => []);
  for (const id of nodes.keys()) ranks[rank.get(id)].push(id);
  orderRows(ranks, edges, groupOf);
  const maxPer = Math.max(1, ...ranks.map((r) => r.length)),
    // Room outside the marks for routes that go around, and for boundary labels.
    reserve = edges.length ? clamp((keyTop - box[1]) * 0.05, 4, 12) : 0,
    top = box[1] + margin + reserve + (boundaries.length ? cap * 2.5 : 0),
    bottom = (ground ? groundY - 4 : keyTop - 4) - reserve - (boundaries.length ? 3 : 0),
    areaW = right - left,
    areaH = bottom - top,
    labelSpace = cfg.labels ? cap * 1.65 * 2 + 3 : 2,
    down = Math.min(areaH / R - labelSpace - 4, areaW / maxPer - 6),
    acrossSize = Math.min(areaW / R - 6, areaH / maxPer - labelSpace - 4),
    across = acrossSize > down * 1.05,
    size = clamp((across ? acrossSize : down) * 0.92, 8, 70),
    k = size / 200; // mm per grimoire unit for the marks

  // Marks: each is drawn centred at the origin in grimoire units, then placed.
  ranks.forEach((list, r) => {
    list.forEach((id, i) => {
      const node = nodes.get(id),
        n = list.length;
      let cx, cy, wrapW;
      if (across) {
        const slot = areaH / n;
        cx = left + ((r + 0.5) * areaW) / R;
        cy = top + i * slot + (slot - labelSpace) / 2;
        wrapW = areaW / R - 4;
      } else {
        const rowH = areaH / R;
        cx = left + ((i + 0.5) * areaW) / n;
        cy = top + r * rowH + (rowH - labelSpace) / 2;
        wrapW = areaW / n - 4;
      }
      const h = hand(id, k);
      if (node.kind === "boundary") sigBoundary(h, 0, 0, 150 * 0.42, ornOn);
      else NODE_MARKS[node.kind].draw(h, 150, ornOn);
      if (orn >= SEAL_FROM && node.kind !== "mark") {
        const b = bboxOf(h.strokes);
        sealOrnament(h, 0, 0, Math.max(-b[0], b[2], -b[1], b[3]) + 16);
      }
      const bb = bboxOf(h.strokes),
        mbox = [cx + bb[0] * k, cy + bb[1] * k, cx + bb[2] * k, cy + bb[3] * k];
      emit(h.strokes, cx, cy, k);
      blocks.push(mbox);
      let extent = [...mbox];
      if (cfg.labels && node.label) {
        const lines = wrapText(node.label, cap, Math.max(20, wrapW)).slice(0, 2);
        lines.forEach((ln, j) => {
          const rect = letter(ln, cx, mbox[3] + 2 + j * cap * 1.65, cap);
          extent = [
            Math.min(extent[0], rect[0]),
            extent[1],
            Math.max(extent[2], rect[2]),
            Math.max(extent[3], rect[3]),
          ];
        });
      }
      placed.set(id, { cx, cy, box: mbox, extent, under: extent[3] + 1, rank: r });
    });
  });

  // Boundaries: a dashed, rounded hull around their members and labels.
  const hullBoxes = [];
  for (const b of boundaries) {
    const ms = b.members.map((m) => placed.get(m)).filter(Boolean);
    if (!ms.length) continue;
    const pad = 4,
      corners = ms.flatMap(({ extent: e }) => [
        [e[0] - pad, e[1] - pad],
        [e[2] + pad, e[1] - pad],
        [e[2] + pad, e[3] + pad],
        [e[0] - pad, e[3] + pad],
      ]),
      hull = closedChaikin(convexHull(corners), 4),
      h = hand(b.id, kd),
      U = hull.map(([x, y]) => [x / kd, y / kd]);
    dashedClosed(h, U, 22, 12);
    for (let i = 0; i < hull.length; i += 2)
      routeMarks.push([hull[i][0] - 0.8, hull[i][1] - 0.8, hull[i][0] + 0.8, hull[i][1] + 0.8]);
    if (ornOn) {
      const outer = offsetClosed(U, 1.6 / kd);
      h.stroke(outer, "hair", "ink", true);
      const ext = [0, 1].flatMap((ax) => [
        outer.reduce((m, p) => (p[ax] < m[ax] ? p : m)),
        outer.reduce((m, p) => (p[ax] > m[ax] ? p : m)),
      ]);
      for (const p of ext) asterisk(h, p[0], p[1], 9, 8, { weight: "hair" });
    }
    emit(h.strokes, 0, 0, kd);
    const topY = Math.min(...hull.map((p) => p[1])),
      topX = hull.reduce((m, p) => (p[1] < m[1] ? p : m))[0];
    let hb = [
      Math.min(...hull.map((p) => p[0])) - 2,
      topY - 2,
      Math.max(...hull.map((p) => p[0])) + 2,
      Math.max(...hull.map((p) => p[1])) + 2,
    ];
    if (cfg.labels && b.label) {
      const r = letter(b.label, topX, Math.max(box[1] + 1, topY - cap * 2.4), cap, "center", "ink", true);
      hb = [Math.min(hb[0], r[0]), Math.min(hb[1], r[1]), Math.max(hb[2], r[2]), Math.max(hb[3], r[3])];
    }
    hullBoxes.push(hb);
  }

  // Routes: direct when the way is clear, otherwise along a lane past the marks in between.
  const routeLabels = [],
    lanes = [],
    takeLane = (v, lo, hi, step) => {
      // Step outward until no earlier lane runs at the same level over the same span.
      while (lanes.some((l) => Math.abs(l.v - v) < 3.5 && l.lo < hi && lo < l.hi)) v += step;
      return v;
    },
    pairCount = new Map(),
    inside = (p, e) => p[0] > e[0] - 1 && p[0] < e[2] + 1 && p[1] > e[1] - 1 && p[1] < e[3] + 1,
    hits = (pts, exts) => pts.filter((p) => exts.some((e) => inside(p, e))).length,
    detour = (pts) => pathLen(pts);
  for (const e of edges) {
    const a = placed.get(e.from),
      b = placed.get(e.to),
      key = [e.from, e.to].sort().join("\u0000"),
      dup = pairCount.get(key) || 0;
    pairCount.set(key, dup + 1);
    const shift = dup ? (dup % 2 ? 1 : -1) * Math.ceil(dup / 2) * 4 : 0,
      gap = 1.5,
      obstacles = [...placed.entries()]
        .filter(([id]) => id !== e.from && id !== e.to)
        .map(([, p]) => p.extent),
      candidates = [];

    // Direct curve between facing ports.
    let p0, p1, c0, c1;
    const forward = b.rank > a.rank;
    if (forward || b.rank === a.rank) {
      if (across && forward) {
        p0 = [a.box[2] + gap, a.cy + shift];
        p1 = [b.box[0] - gap, b.cy + shift];
        const dx = p1[0] - p0[0];
        [c0, c1] = [
          [p0[0] + dx * 0.45, p0[1]],
          [p1[0] - dx * 0.45, p1[1]],
        ];
      } else if (!across && forward) {
        p0 = [a.cx + shift, a.under + gap];
        p1 = [b.cx + shift, b.box[1] - gap];
        const dy = p1[1] - p0[1];
        [c0, c1] = [
          [p0[0], p0[1] + dy * 0.45],
          [p1[0], p1[1] - dy * 0.45],
        ];
      } else if (across) {
        const below = b.cy > a.cy,
          bow = Math.min(12, Math.abs(b.cy - a.cy) * 0.2) + Math.abs(shift);
        p0 = below ? [a.cx + shift, a.under + gap] : [a.cx + shift, a.box[1] - gap];
        p1 = below ? [b.cx + shift, b.box[1] - gap] : [b.cx + shift, b.under + gap];
        [c0, c1] = [
          [p0[0] + bow, lerpY(p0, p1, 0.3)],
          [p1[0] + bow, lerpY(p0, p1, 0.7)],
        ];
      } else {
        const dir = b.cx > a.cx ? 1 : -1,
          bow = Math.min(18, Math.abs(b.cx - a.cx) * 0.22) + Math.abs(shift);
        p0 = [dir > 0 ? a.box[2] + gap : a.box[0] - gap, a.cy + shift];
        p1 = [dir > 0 ? b.box[0] - gap : b.box[2] + gap, b.cy + shift];
        [c0, c1] = [
          [p0[0] + (p1[0] - p0[0]) * 0.3, p0[1] - bow],
          [p1[0] - (p1[0] - p0[0]) * 0.3, p1[1] - bow],
        ];
      }
      candidates.push(bezier(p0, c0, c1, p1, 48));
    }

    // Lanes: beside every mark that lies between the two ends.
    let laneSpan, squeezed;
    if (across) {
      const x0 = Math.min(a.cx, b.cx),
        x1 = Math.max(a.cx, b.cx),
        between = [...obstacles, ...hullBoxes].filter((ex) => ex[2] > x0 && ex[0] < x1),
        ys = [a.extent, b.extent, ...between],
        wantAbove = takeLane(Math.min(...ys.map((ex) => ex[1])) - 4, x0, x1, -4),
        wantBelow = takeLane(Math.max(...ys.map((ex) => ex[3])) + 4, x0, x1, 4),
        above = Math.max(box[1] + 1, wantAbove),
        below = Math.min(bottom + reserve + 2, wantBelow);
      squeezed = [above !== wantAbove, below !== wantBelow];
      laneSpan = [x0, x1, above, below];
      candidates.push(
        rounded([
          [a.cx + shift, a.box[1] - gap],
          [a.cx + shift, above],
          [b.cx + shift, above],
          [b.cx + shift, b.box[1] - gap],
        ]),
      );
      candidates.push(
        rounded([
          [a.cx + shift, a.under + gap],
          [a.cx + shift, below],
          [b.cx + shift, below],
          [b.cx + shift, b.under + gap],
        ]),
      );
    } else {
      const y0 = Math.min(a.cy, b.cy),
        y1 = Math.max(a.cy, b.cy),
        between = [...obstacles, ...hullBoxes].filter((ex) => ex[3] > y0 && ex[1] < y1),
        xs = [a.extent, b.extent, ...between],
        wantLeft = takeLane(Math.min(...xs.map((ex) => ex[0])) - 4, y0, y1, -4),
        wantRight = takeLane(Math.max(...xs.map((ex) => ex[2])) + 4, y0, y1, 4),
        leftLane = Math.max(box[0] + 1, wantLeft),
        rightLane = Math.min(box[2] - 1, wantRight);
      squeezed = [rightLane !== wantRight, leftLane !== wantLeft];
      laneSpan = [y0, y1, rightLane, leftLane];
      candidates.push(
        rounded([
          [a.box[2] + gap, a.cy + shift],
          [rightLane, a.cy + shift],
          [rightLane, b.cy + shift],
          [b.box[2] + gap, b.cy + shift],
        ]),
      );
      candidates.push(
        rounded([
          [a.box[0] - gap, a.cy + shift],
          [leftLane, a.cy + shift],
          [leftLane, b.cy + shift],
          [b.box[0] - gap, b.cy + shift],
        ]),
      );
    }
    const ranked = candidates
        .map((c, i) => {
          const lane = i - (candidates.length - 2);
          // Lanes already in use on a side make it costlier, so long routes spread above and below.
          const crowd = lane >= 0 ? lanes.filter((l) => l.side === lane).length * 25 : 0;
          return {
            c,
            i,
            score:
              hits(c, obstacles) * 1000 +
              (lane >= 0 && squeezed[lane] ? 500 : 0) +
              crowd +
              detour(c) +
              i * 0.01,
          };
        })
        .sort((m, n) => m.score - n.score),
      { c: pts, i: chosen } = ranked[0],
      lanesFrom = candidates.length - 2;
    if (chosen >= lanesFrom)
      lanes.push({
        v: laneSpan[2 + chosen - lanesFrom],
        lo: laneSpan[0],
        hi: laneSpan[1],
        side: chosen - lanesFrom,
      });

    const h = hand(`${e.from}>${e.to}:${dup}`, kd);
    drawRoute(
      h,
      e.type,
      pts.map(([x, y]) => [x / kd, y / kd]),
      ornOn,
    );
    emit(h.strokes, 0, 0, kd);
    for (const p of pts) blocks.push([p[0] - 1.2, p[1] - 1.2, p[0] + 1.2, p[1] + 1.2]);
    for (let i = 0; i < pts.length; i += 3)
      routeMarks.push([pts[i][0] - 0.8, pts[i][1] - 0.8, pts[i][0] + 0.8, pts[i][1] + 0.8]);
    if (cfg.labels && e.label) routeLabels.push({ e, pts });
  }
  // Route labels go down once every route is drawn, so each can avoid all of them.
  for (const { e, pts } of routeLabels) {
    const [mid, t] = pointAt(pts, pathLen(pts) * 0.5),
      steep = Math.abs(t[1]) > 0.6;
    letter(
      e.label,
      mid[0] + (steep ? 2.5 : 0),
      mid[1] + (steep ? -cap / 2 : -cap * 2.3),
      cap * 0.9,
      steep ? "left" : "center",
      e.type === "added" || e.type === "pointer" ? "red" : "ink",
      true,
    );
  }

  // Ground: conditions beneath the whole diagram.
  if (ground) {
    const h = hand("ground", kd);
    sigGround(h, left / kd, right / kd, groundY / kd, (groundH * 0.55) / kd, 7);
    emit(h.strokes, 0, 0, kd);
    blocks.push([box[0], groundY - 2, box[2], groundY + groundH]);
    if (cfg.labels && ground.label)
      letter(ground.label, right, groundY - cap * 1.9, cap, "right", "ink", true);
  }

  // Key.
  if (keyHeight) {
    const h = hand("key-rule", kd),
      ry = (keyTop + 1) / kd;
    h.stroke(
      [
        [left / kd, ry],
        [right / kd, ry],
      ],
      "hair",
    );
    asterisk(h, left / kd, ry, 9, 8, { weight: "hair" });
    asterisk(h, right / kd, ry, 9, 8, { weight: "hair" });
    emit(h.strokes, 0, 0, kd);
    let y = keyTop + 4;
    for (const { row, h: rh } of keyRows) {
      row.forEach((e, c) => {
        const x = left + c * colW,
          ks = specimen / 200,
          sh = new Hand(rngFor(`${o.seed}:key:${e.kind}`), { tremor, fillPitch: (pen * 0.85) / ks });
        if (e.node) NODE_MARKS[e.kind].draw(sh, 150, ornOn);
        else EDGE_MARKS[e.kind].sample(sh, 150, ornOn);
        const bb = bboxOf(sh.strokes),
          fit = Math.min(1, specimen / ((bb[2] - bb[0]) * ks), specimen / ((bb[3] - bb[1]) * ks)),
          cx = x + specimen / 2 - ((bb[0] + bb[2]) / 2) * ks * fit,
          cy = y + specimen / 2 - ((bb[1] + bb[3]) / 2) * ks * fit;
        for (const s of sh.strokes)
          out.push({
            pts: s.pts.map(([px, py]) => [cx + px * ks * fit, cy + py * ks * fit]),
            color: s.color,
          });
        const ty = y + (specimen - e.lines.length * keyCap * 1.7) / 2 + keyCap * 0.35;
        e.lines.forEach((ln, j) => letter(ln, x + specimen + 4, ty + j * keyCap * 1.7, keyCap, "left"));
      });
      y += rh;
    }
    letter(
      "A sketch prompts a claim and never replaces one.",
      (left + right) / 2,
      box[3] - keyCap * 1.6,
      keyCap * 0.85,
    );
    blocks.push([box[0], keyTop, box[2], box[3]]);
  }

  result.clearance = clearanceField(out, blocks, box, cfg.clearance);
  result.stats.size = Math.round(size * 10) / 10;
  result.stats.key = keyHeight ? entries.map((e) => `${e.name}: ${e.meaning}`) : [];
  result.stats.orientation = across ? "across" : "down";
  return result;
}

const lerpY = (a, b, t) => a[1] + (b[1] - a[1]) * t;

/** A polyline through the given corners, each corner rounded by a quadratic curve. */
function rounded(corners, radius = 6) {
  const out = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [a, c, b] = [corners[i - 1], corners[i], corners[i + 1]],
      la = Math.hypot(c[0] - a[0], c[1] - a[1]),
      lb = Math.hypot(b[0] - c[0], b[1] - c[1]),
      r = Math.min(radius, la / 2, lb / 2);
    if (r < 0.01) {
      out.push(c);
      continue;
    }
    const p = [c[0] + ((a[0] - c[0]) / la) * r, c[1] + ((a[1] - c[1]) / la) * r],
      q = [c[0] + ((b[0] - c[0]) / lb) * r, c[1] + ((b[1] - c[1]) / lb) * r];
    for (let t = 0; t <= 1.0001; t += 0.125)
      out.push([
        (1 - t) ** 2 * p[0] + 2 * (1 - t) * t * c[0] + t * t * q[0],
        (1 - t) ** 2 * p[1] + 2 * (1 - t) * t * c[1] + t * t * q[1],
      ]);
  }
  out.push(corners.at(-1));
  // Even spacing so dashes and route marks fall evenly.
  const dense = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1],
      b = out[i],
      n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let k = 1; k <= n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return dense;
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
    lower = [],
    upper = [];
  for (const q of p) {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function closedChaikin(pts, iterations) {
  for (let k = 0; k < iterations; k++) {
    const out = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      out.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
    });
    pts = out;
  }
  return pts;
}

/** Offset a closed ring outward by d. */
function offsetClosed(pts, d) {
  const area = pts.reduce(
      (s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1],
      0,
    ),
    sign = area > 0 ? -1 : 1;
  return pts.map((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length],
      b = pts[(i + 1) % pts.length],
      L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / L) * d * sign, p[1] + ((b[0] - a[0]) / L) * d * sign];
  });
}

function dashedClosed(h, ring, dash, gapLen) {
  const P = [...ring, ring[0]],
    L = pathLen(P);
  for (let s = 0; s < L; s += dash + gapLen) {
    const seg = [];
    for (let u = s; u <= Math.min(L, s + dash); u += 2) seg.push(pointAt(P, u)[0]);
    if (seg.length > 1) h.stroke(seg, "orn", "ink", false, 0.1);
  }
}

/** Route marks drawn along a path P in grimoire units. */
function drawRoute(h, type, P, ornament) {
  const end = P.at(-1),
    angle = (Math.atan2(end[1] - P.at(-3)[1], end[0] - P.at(-3)[0]) * 180) / Math.PI;
  if (type === "route" || type === "break") {
    h.stroke(P, "core");
    arrowhead(h, end, angle, 11);
    if (type === "break") {
      const [m] = pointAt(P, pathLen(P) * 0.5);
      sigBreak(h, m[0], m[1], 16);
    }
  } else if (type === "added") {
    h.stroke(P, "core", "red");
    arrowhead(h, end, angle, 11, "red");
    if (ornament) {
      dotted(h, offsetLine(P, -9), 9, 0.9, "red");
      asterisk(h, P[0][0], P[0][1], 6, 8, { weight: "hair", color: "red" });
    }
  } else if (type === "struck") {
    // Solid first third, dashed remainder, struck through with an X.
    const L = pathLen(P),
      cut = L * 0.34;
    let run = [],
      solid = true;
    for (let s = 0; s <= L; s += 1.5) {
      const [p] = pointAt(P, s),
        on = s <= cut || (s - cut) % 11 < 7;
      if (on) run.push(p);
      if (!on || (solid && s > cut)) {
        if (run.length > 1) h.stroke(run, solid ? "core" : "orn", "ink", false, 0.05);
        run = on ? [p] : [];
        solid = s <= cut;
      }
    }
    if (run.length > 1) h.stroke(run, "orn", "ink", false, 0.05);
    const [m] = pointAt(P, cut + (L - cut) * 0.45),
      sx = 9;
    h.stroke(
      [
        [m[0] - sx, m[1] - sx],
        [m[0] + sx, m[1] + sx],
      ],
      "core",
    );
    h.stroke(
      [
        [m[0] + sx, m[1] - sx],
        [m[0] - sx, m[1] + sx],
      ],
      "core",
    );
  } else if (type === "pointer") {
    const L = pathLen(P);
    for (let s = 0; s < L - 8; s += 12) {
      const seg = [];
      for (let u = s; u <= Math.min(L - 4, s + 7); u += 1) seg.push(pointAt(P, u)[0]);
      if (seg.length > 1) h.stroke(seg, "orn", "red", false, 0.05);
    }
    arrowhead(h, end, angle, 11, "red", "orn");
    h.ring(P[0][0], P[0][1], 4.5, "hair", "red");
  }
}

// ------------------------------------------------------------- clearance --

/**
 * A distance field (1 mm cells) from every diagram stroke and block. Motifs keep
 * out of `clearance` mm around it, with a ragged edge of about half that width.
 */
function clearanceField(strokes, blocks, box, clearance) {
  const g = 1,
    x0 = box[0],
    y0 = box[1],
    nx = Math.ceil((box[2] - box[0]) / g) + 1,
    ny = Math.ceil((box[3] - box[1]) / g) + 1,
    D = new Float32Array(nx * ny).fill(1e9),
    mark = (x, y) => {
      const i = Math.round((x - x0) / g),
        j = Math.round((y - y0) / g);
      if (i >= 0 && j >= 0 && i < nx && j < ny) D[j * nx + i] = 0;
    };
  for (const s of strokes)
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1],
        b = s.pts[i],
        n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g * 0.5)));
      for (let t = 0; t <= n; t++) mark(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n);
    }
  for (const [bx0, by0, bx1, by1] of blocks)
    for (let y = by0; y <= by1; y += g * 0.5) for (let x = bx0; x <= bx1; x += g * 0.5) mark(x, y);
  // Two-pass chamfer distance (3-4), in mm.
  const a = g,
    d = g * Math.SQRT2;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = D[k];
      if (i > 0) v = Math.min(v, D[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, D[k - nx] + a);
        if (i > 0) v = Math.min(v, D[k - nx - 1] + d);
        if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + d);
      }
      D[k] = v;
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = D[k];
      if (i < nx - 1) v = Math.min(v, D[k + 1] + a);
      if (j < ny - 1) {
        v = Math.min(v, D[k + nx] + a);
        if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + d);
        if (i > 0) v = Math.min(v, D[k + nx - 1] + d);
      }
      D[k] = v;
    }
  const at = (x, y) => {
    const i = Math.max(0, Math.min(nx - 1, Math.round((x - x0) / g))),
      j = Math.max(0, Math.min(ny - 1, Math.round((y - y0) / g)));
    return D[j * nx + i];
  };
  const ragged = Math.max(1, clearance * 0.5);
  return {
    score: (x, y) => Math.max(-1, Math.min(1, (at(x, y) - clearance - 0.5) / ragged)),
    keep: (x, y, jitter) => at(x, y) - clearance - 0.5 + jitter * ragged * 0.8 > 0,
  };
}
