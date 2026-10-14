import { zip } from "./archive.mjs";
import {
  DEFAULTS,
  MOTIF_NAMES,
  normalize,
  generate,
  prepare,
  metrics,
  toSVG,
  hasDiagramText,
} from "./engine.mjs";
import { EXAMPLE, NOTATION } from "./diagram.mjs";

const $ = (id) => document.getElementById(id);
const MOTIF_INFO = {
  ribbons: {
    glyph: "∿",
    label: "Flow ribbons",
    text: "long contours bending into open channels, with optional cross-grain threads",
  },
  signal: {
    glyph: "▥",
    label: "Signal bands",
    text: "interrupted vertical registers grouped into irregular blocks of colour",
  },
  wire: {
    glyph: "⋈",
    label: "Wire structures",
    text: "angular fans connecting successive stations into a folded scaffold",
  },
  growth: {
    glyph: "Ψ",
    label: "Branching growth",
    text: "branches grown toward scattered points, thickened as bundled strands, with fine hairs at the tips",
  },
};
const ROLE_LABELS = { off: "Off", region: "Region", overlay: "Overlay" };
const SETTING_KEYS = [
  "seed",
  "spacing",
  "distortion",
  "density",
  "width",
  "height",
  "margin",
  "pen",
  "palette",
  "background",
  "speed",
  "travelSpeed",
  "liftDelay",
  "blendScale",
  "feather",
];
const TEXT_KEYS = ["seed", "palette", "background"];
const CHECK_KEYS = ["crosshatch", "frame", "optimize"];

const only = (name, extra = {}) => ({
  motifs: Object.fromEntries(
    MOTIF_NAMES.map((k) => [k, { role: k === name ? "region" : "off", amount: 50, pen: "all" }]),
  ),
  ...extra,
});
const mix = (roles) => ({
  motifs: Object.fromEntries(
    MOTIF_NAMES.map((k) => [k, { role: "off", amount: 50, pen: "all", ...roles[k] }]),
  ),
});
const presets = {
  mineral: {
    ...only("ribbons"),
    seed: "AL-184",
    palette: "earth",
    spacing: 1.15,
    distortion: 60,
    density: 65,
    crosshatch: true,
  },
  signal: {
    ...only("signal"),
    seed: "SG-407",
    palette: "signal",
    spacing: 0.9,
    distortion: 65,
    density: 82,
    crosshatch: true,
  },
  wire: {
    ...only("wire"),
    seed: "FL-029",
    palette: "earth",
    spacing: 1.2,
    distortion: 74,
    density: 63,
    crosshatch: true,
  },
  growth: {
    ...only("growth"),
    seed: "CO-77",
    palette: "dusk",
    spacing: 1.15,
    distortion: 60,
    density: 65,
    crosshatch: true,
  },
  erosion: {
    ...mix({
      ribbons: { role: "region", amount: 55 },
      growth: { role: "region", amount: 45 },
      signal: { role: "overlay", amount: 25 },
    }),
    seed: "ER-052",
    palette: "earth",
    spacing: 1.15,
    distortion: 60,
    density: 65,
    crosshatch: true,
    blendScale: 140,
    feather: 60,
  },
  outage: {
    ...mix({ growth: { role: "region", amount: 50 } }),
    seed: "OD-108",
    palette: "signal",
    spacing: 1.15,
    distortion: 55,
    density: 55,
    crosshatch: true,
    diagram: { text: EXAMPLE, ornament: 70, clearance: 6, key: true, labels: true },
  },
  relay: {
    ...mix({
      signal: { role: "region", amount: 50 },
      wire: { role: "region", amount: 25 },
      growth: { role: "region", amount: 25, pen: "1" },
    }),
    seed: "RL-208",
    palette: "signal",
    spacing: 1,
    distortion: 65,
    density: 70,
    crosshatch: true,
    blendScale: 160,
    feather: 70,
  },
};

let state = { ...normalize(DEFAULTS), paper: "a4", orientation: "portrait" },
  plot = null,
  zoom = 1,
  visible = new Set(),
  worker = null,
  exportWorker = null,
  job = 0,
  exportJob = 0,
  timer = null,
  toastTimer = null,
  pendingExport = false,
  exportContext = null;

try {
  const saved = JSON.parse(localStorage.getItem("linework-settings") || "null");
  if (saved)
    state = {
      ...state,
      ...normalize(saved),
      paper: saved.paper || "custom",
      orientation: saved.orientation || "portrait",
    };
} catch {}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
}

function save() {
  try {
    localStorage.setItem("linework-settings", JSON.stringify(state));
  } catch {}
}

// ---------------------------------------------------------------------------
// Motif rows

function buildMotifRows() {
  const container = $("motifs");
  for (const name of MOTIF_NAMES) {
    const info = MOTIF_INFO[name],
      row = document.createElement("div");
    row.className = "motif";
    row.dataset.motif = name;

    const solo = document.createElement("button");
    solo.className = "motif-name";
    solo.title = "Use this motif alone";
    solo.innerHTML = `<span class="glyph" aria-hidden="true">${info.glyph}</span>`;
    solo.append(info.label);
    solo.addEventListener("click", () => {
      for (const k of MOTIF_NAMES) state.motifs[k].role = k === name ? "region" : "off";
      changed();
    });

    const roles = document.createElement("div");
    roles.className = "roles";
    roles.setAttribute("role", "group");
    roles.setAttribute("aria-label", info.label + " role");
    for (const role of Object.keys(ROLE_LABELS)) {
      const b = document.createElement("button");
      b.dataset.role = role;
      b.textContent = ROLE_LABELS[role];
      b.addEventListener("click", () => {
        if (
          role === "off" &&
          !hasDiagramText(state.diagram.text) &&
          MOTIF_NAMES.filter((k) => k !== name && state.motifs[k].role !== "off").length === 0
        ) {
          toast("Keep at least one motif on, or write a diagram.");
          return;
        }
        state.motifs[name].role = role;
        changed();
      });
      roles.append(b);
    }

    const detail = document.createElement("div");
    detail.className = "motif-detail";
    const amount = document.createElement("input");
    amount.type = "range";
    amount.min = 1;
    amount.max = 100;
    amount.className = "amount";
    amount.setAttribute("aria-label", info.label + " amount");
    const out = document.createElement("output");
    amount.addEventListener("input", () => {
      state.motifs[name].amount = Number(amount.value);
      out.value = amount.value + "%";
      save();
      requestGenerate();
    });
    const pen = document.createElement("select");
    pen.className = "pen-select";
    pen.setAttribute("aria-label", info.label + " pen");
    pen.addEventListener("change", () => {
      state.motifs[name].pen = pen.value;
      changed();
    });
    detail.append(amount, out, pen);
    row.append(solo, roles, detail);
    container.append(row);
  }
}

function syncMotifRows() {
  const regions = MOTIF_NAMES.filter((k) => state.motifs[k].role === "region");
  for (const row of $("motifs").children) {
    const name = row.dataset.motif,
      m = state.motifs[name];
    row.dataset.role = m.role;
    for (const b of row.querySelectorAll("[data-role]")) {
      b.classList.toggle("active", b.dataset.role === m.role);
      b.setAttribute("aria-pressed", b.dataset.role === m.role);
    }
    const detail = row.querySelector(".motif-detail"),
      amount = row.querySelector(".amount"),
      pen = row.querySelector(".pen-select");
    detail.hidden = m.role === "off";
    amount.value = m.amount;
    row.querySelector("output").value = m.amount + "%";
    // A lone region fills the page, so its amount has no effect.
    amount.disabled = m.role === "region" && regions.length === 1;
    amount.title =
      m.role === "overlay"
        ? "Share of the page this overlay covers"
        : amount.disabled
          ? "A single region fills the page"
          : "Share of the page among regions";
    const options = ["all", ...state.colors.map((_, i) => String(i + 1))];
    pen.replaceChildren(
      ...options.map((v) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = v === "all" ? "All pens" : "Pen " + v;
        return o;
      }),
    );
    pen.value = options.includes(m.pen) ? m.pen : "all";
  }
}

function describe() {
  const base = describeMotifs();
  if (!hasDiagramText(state.diagram.text)) return base;
  return state.mode === "diagram"
    ? "A diagram alone, in the grimoire's sketching marks."
    : base + " A diagram is drawn over them, with clear space around it.";
}

function describeMotifs() {
  const m = state.motifs,
    active = MOTIF_NAMES.filter((k) => m[k].role !== "off");
  if (!active.length) return "";
  if (state.mode !== "blend") {
    const info = MOTIF_INFO[active[0]];
    return info.label + ": " + info.text + ".";
  }
  const regions = active.filter((k) => m[k].role === "region"),
    overlays = active.filter((k) => m[k].role === "overlay"),
    total = regions.reduce((s, k) => s + m[k].amount, 0),
    name = (k) => MOTIF_INFO[k].label.toLowerCase(),
    parts = [];
  if (regions.length === 1) parts.push(`${MOTIF_INFO[regions[0]].label} fills the page.`);
  else if (regions.length)
    parts.push(
      "Regions: " +
        regions.map((k) => `${name(k)} ${Math.round((m[k].amount / total) * 100)}%`).join(", ") +
        ".",
    );
  if (overlays.length)
    parts.push(
      "Overlay: " + overlays.map((k) => `${name(k)} across ${m[k].amount}% of the page`).join(", ") + ".",
    );
  return parts.join(" ");
}

// ---------------------------------------------------------------------------

function sync() {
  state = { ...normalize(state), paper: state.paper, orientation: state.orientation };
  for (const key of SETTING_KEYS) $(key).value = state[key];
  for (const key of CHECK_KEYS) $(key).checked = !!state[key];
  $("paper").value = state.paper || "custom";
  $("orientation").value = state.orientation || "portrait";
  state.colors.slice(0, 3).forEach((c, i) => ($("color" + (i + 1)).value = c));
  $("customSize").hidden = state.paper !== "custom";
  $("customPens").hidden = state.palette !== "custom";
  syncMotifRows();
  $("blendSection").hidden = state.mode !== "blend";
  if ($("diagramText").value !== state.diagram.text) $("diagramText").value = state.diagram.text;
  $("diagramOrnament").value = state.diagram.ornament;
  $("diagramClearance").value = state.diagram.clearance;
  $("diagramKey").checked = state.diagram.key;
  $("diagramLabels").checked = state.diagram.labels;
  $("diagramControls").hidden = !hasDiagramText(state.diagram.text);
  $("modeDescription").textContent = describe();
  outputs();
}

function outputs() {
  $("spacingOut").value = Number(state.spacing).toFixed(2) + " mm";
  $("distortionOut").value = state.distortion + "%";
  $("densityOut").value = state.density + "%";
  $("blendScaleOut").value = state.blendScale + " mm";
  $("featherOut").value = state.feather + "%";
  $("diagramOrnamentOut").value = state.diagram.ornament + "%";
  $("diagramClearanceOut").value = state.diagram.clearance + " mm";
  $("spacingWarning").hidden = !(state.spacing < state.pen * 2);
  $("spacingWarning").textContent =
    "Spacing is less than twice the pen width. Ink may merge; use a small proof.";
}

function readControls() {
  for (const key of SETTING_KEYS) state[key] = TEXT_KEYS.includes(key) ? $(key).value : Number($(key).value);
  for (const key of CHECK_KEYS) state[key] = $(key).checked;
  state.colors = [1, 2, 3].map((i) => $("color" + i).value);
  state.diagram = {
    text: $("diagramText").value,
    ornament: Number($("diagramOrnament").value),
    clearance: Number($("diagramClearance").value),
    key: $("diagramKey").checked,
    labels: $("diagramLabels").checked,
  };
  state = { ...normalize(state), paper: state.paper, orientation: state.orientation };
  outputs();
  save();
}

/** After a motif change: re-normalise, refresh controls, regenerate. */
function changed() {
  readControls();
  sync();
  save();
  requestGenerate();
}

function selectedPlot() {
  return { ...plot, layers: plot.layers.filter((l) => visible.has(l.id)) };
}

function updateMetrics(stat) {
  const sorted = plot?.sorted;
  $("travelLabel").textContent = "TRAVEL / " + (sorted ? "SORTED" : "UNSORTED");
  $("timeLabel").textContent = "ESTIMATED / " + (sorted ? "SORTED" : "UNSORTED");
  $("pathCount").textContent = stat.count.toLocaleString();
  $("drawLength").textContent = (stat.draw / 1000).toFixed(1) + " m";
  $("travelLength").textContent = (stat.travel / 1000).toFixed(1) + " m";
  $("timeEstimate").textContent =
    stat.seconds < 3600
      ? Math.max(1, Math.round(stat.seconds / 60)) + " min"
      : (stat.seconds / 3600).toFixed(1) + " hr";
}

function fit() {
  if (!plot) return;
  const ratio = plot.options.width / plot.options.height,
    width = Math.max(140, Math.min($("stage").clientWidth - 40, ($("stage").clientHeight - 60) * ratio));
  $("paperWrap").style.width = width * zoom + "px";
  $("zoomValue").textContent = Math.round(zoom * 100) + "%";
}

function draw() {
  if (!plot) return;
  const o = plot.options,
    c = $("canvas"),
    scale = Math.min(2400 / o.width, 2400 / o.height);
  c.width = Math.round(o.width * scale);
  c.height = Math.round(o.height * scale);
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.lineWidth = o.pen;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const l of plot.layers) {
    if (!visible.has(l.id)) continue;
    ctx.strokeStyle = l.color;
    ctx.beginPath();
    for (const p of l.paths) {
      ctx.moveTo(...p[0]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(...p[i]);
    }
    ctx.stroke();
  }
  if ($("showTravel").checked) {
    ctx.strokeStyle = "#ba3970aa";
    ctx.lineWidth = 0.12;
    ctx.setLineDash([1.2, 0.8]);
    ctx.beginPath();
    for (const l of plot.layers) {
      if (!visible.has(l.id)) continue;
      let pos = [0, 0];
      for (const p of l.paths) {
        ctx.moveTo(...pos);
        ctx.lineTo(...p[0]);
        pos = p.at(-1);
      }
    }
    ctx.stroke();
  }
  c.setAttribute("aria-label", `${describe()} ${o.width} by ${o.height} millimetres, seed ${o.seed}.`);
  $("pageLabel").textContent =
    (state.paper === "custom" ? "CUSTOM" : state.paper.toUpperCase()) +
    " / " +
    o.width +
    " × " +
    o.height +
    " MM";
  $("seedLabel").textContent = "SEED " + o.seed;
  updateMetrics(metrics(selectedPlot()));
  fit();
}

function buildLayers() {
  const old = new Set(visible);
  visible = new Set();
  $("layers").replaceChildren();
  for (const l of plot.layers) {
    const checked = old.size ? old.has(l.id) : true;
    if (checked) visible.add(l.id);
    const label = document.createElement("label"),
      input = document.createElement("input"),
      swatch = document.createElement("span");
    label.className = "layer";
    input.type = "checkbox";
    input.checked = checked;
    swatch.className = "swatch";
    swatch.style.background = l.color;
    label.append(input, swatch, document.createTextNode(l.name));
    input.addEventListener("change", () => {
      input.checked ? visible.add(l.id) : visible.delete(l.id);
      draw();
    });
    $("layers").append(label);
  }
}

function onGenerated(result) {
  if (result.id !== job) return;
  if (result.error) {
    $("status").textContent = result.error;
    toast(result.error);
    return;
  }
  plot = result.plot;
  buildLayers();
  draw();
  showDiagramErrors(plot.diagram?.errors || []);
  const mode = plot.options.mode;
  $("status").textContent = plot.limited
    ? "Path limit reached — reduce density"
    : "Ready / " +
      (mode === "blend" || mode === "diagram" ? mode : MOTIF_INFO[mode].label.toLowerCase()) +
      (plot.diagram && mode !== "diagram" ? " + diagram" : "") +
      (plot.diagram?.errors.length
        ? ` · ${plot.diagram.errors.length} diagram ${plot.diagram.errors.length === 1 ? "problem" : "problems"}`
        : "");
  $("export").disabled = false;
  $("exportPen").disabled = false;
}

function showDiagramErrors(errors) {
  const list = $("diagramErrors");
  list.replaceChildren(
    ...errors.slice(0, 12).map((e) => {
      const li = document.createElement("li");
      li.textContent = `Line ${e.line}: ${e.message}`;
      return li;
    }),
  );
  list.hidden = !errors.length;
}

function requestGenerate(delay = 150) {
  clearTimeout(timer);
  $("status").textContent = "Drawing…";
  $("export").disabled = true;
  $("exportPen").disabled = true;
  timer = setTimeout(() => {
    timer = null;
    runGenerate();
  }, delay);
}

function runGenerate() {
  readControls();
  const id = ++job;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  $("status").textContent = "Drawing…";
  $("export").disabled = true;
  $("exportPen").disabled = true;
  const message = { kind: "generate", id, options: state };
  try {
    worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker?.terminate();
      worker = null;
      onGenerated(data);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      fallbackGenerate(message);
    };
    worker.postMessage(message);
  } catch {
    fallbackGenerate(message);
  }
}

function fallbackGenerate(message) {
  try {
    const raw = generate(message.options);
    onGenerated({ id: message.id, plot: prepare(raw, raw.options.optimize) });
  } catch (e) {
    onGenerated({ id: message.id, error: e.message });
  }
}

function setPaper() {
  state.paper = $("paper").value;
  state.orientation = $("orientation").value;
  if (state.paper !== "custom") {
    const dimensions = { a4: [210, 297], a3: [297, 420], letter: [215.9, 279.4], square: [210, 210] }[
      state.paper
    ];
    [state.width, state.height] =
      state.orientation === "landscape" ? [dimensions[1], dimensions[0]] : dimensions;
    sync();
  } else $("customSize").hidden = false;
  requestGenerate();
}

function download(content, name, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

function filename() {
  return "linework-" + plot.options.mode + "-" + plot.options.seed.replace(/[^\w-]+/g, "-").slice(0, 50);
}

const recipe = (options) => ({ version: 3, ...options });

function onExport(result, separate) {
  pendingExport = false;
  $("export").disabled = !!worker || !!timer;
  $("exportPen").disabled = !!worker || !!timer;
  if (result.error) {
    toast(result.error);
    return;
  }
  const context = exportContext;
  if (separate) {
    const files = result.files.map((f) => ({ ...f, name: context.name + "-" + f.name }));
    files.push({ name: context.name + "-recipe.json", text: JSON.stringify(context.recipe, null, 2) });
    download(zip(files), context.name + "-pens.zip");
  } else download(result.svg, context.name + ".svg", "image/svg+xml");
  const stat = result.metrics;
  toast(
    `Exported ${stat.count.toLocaleString()} paths · ${(stat.draw / 1000).toFixed(1)} m ink · ${Math.max(1, Math.round(stat.seconds / 60))} min estimated${context.optimize ? " after sorting" : ""}.`,
  );
  $("status").textContent =
    "Exported / " +
    (stat.travel / 1000).toFixed(1) +
    " m travel" +
    (context.optimize ? " after sorting" : "");
}

function exportDrawing(separate = false) {
  if (!plot || pendingExport) return;
  if (worker || timer) {
    toast("Wait for the current drawing to finish.");
    return;
  }
  if (!visible.size || metrics(selectedPlot()).count === 0) {
    toast("Enable at least one nonempty pen layer.");
    return;
  }
  readControls();
  pendingExport = true;
  const exported = selectedPlot();
  exported.options = {
    ...plot.options,
    optimize: state.optimize,
    speed: state.speed,
    travelSpeed: state.travelSpeed,
    liftDelay: state.liftDelay,
  };
  exportContext = { name: filename(), optimize: state.optimize, recipe: recipe(exported.options) };
  $("export").disabled = true;
  $("exportPen").disabled = true;
  $("status").textContent = state.optimize ? "Sorting paths…" : "Preparing SVG…";
  const id = ++exportJob,
    message = {
      kind: "export",
      id,
      plot: exported,
      optimize: state.optimize,
      selected: [...visible],
      separate,
    };
  const fallback = () => {
    try {
      const prepared = prepare(message.plot, message.optimize);
      onExport(
        {
          svg: separate ? null : toSVG(prepared),
          files: separate
            ? prepared.layers
                .filter((l) => l.paths.length)
                .map((l) => ({ name: l.id + ".svg", text: toSVG(prepared, { selected: [l.id] }) }))
            : null,
          metrics: metrics(prepared),
        },
        separate,
      );
    } catch (e) {
      onExport({ error: e.message }, separate);
    }
  };
  try {
    exportWorker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    exportWorker.onmessage = ({ data }) => {
      exportWorker.terminate();
      exportWorker = null;
      onExport(data, separate);
    };
    exportWorker.onerror = () => {
      exportWorker.terminate();
      exportWorker = null;
      fallback();
    };
    exportWorker.postMessage(message);
  } catch {
    fallback();
  }
}

// ---------------------------------------------------------------------------
// Wiring

buildMotifRows();

document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const preset = structuredClone(presets[b.dataset.preset]);
    // Presets leave an existing diagram alone unless they bring their own.
    if (preset.diagram && hasDiagramText(state.diagram.text) && state.diagram.text !== preset.diagram.text)
      if (!confirm("Replace your diagram with the worked example?")) delete preset.diagram;
    state = {
      ...state,
      blendScale: DEFAULTS.blendScale,
      feather: DEFAULTS.feather,
      ...preset,
    };
    visible.clear();
    sync();
    requestGenerate();
  }),
);

for (const id of [
  "seed",
  "spacing",
  "distortion",
  "density",
  "margin",
  "pen",
  "width",
  "height",
  "palette",
  "background",
  "crosshatch",
  "frame",
  "color1",
  "color2",
  "color3",
  "blendScale",
  "feather",
])
  $(id).addEventListener(["crosshatch", "frame", "palette"].includes(id) ? "change" : "input", () => {
    readControls();
    if (id === "palette") {
      visible.clear();
      sync();
    }
    requestGenerate();
  });

$("diagramNotation").textContent = NOTATION;
$("diagramText").addEventListener("input", () => {
  readControls();
  $("diagramControls").hidden = !hasDiagramText(state.diagram.text);
  $("modeDescription").textContent = describe();
  requestGenerate(450);
});
for (const id of ["diagramOrnament", "diagramClearance"])
  $(id).addEventListener("input", () => (readControls(), requestGenerate()));
for (const id of ["diagramKey", "diagramLabels"])
  $(id).addEventListener("change", () => (readControls(), requestGenerate()));
$("diagramExample").addEventListener("click", () => {
  if (hasDiagramText($("diagramText").value) && !confirm("Replace your diagram with the worked example?"))
    return;
  $("diagramText").value = EXAMPLE;
  changed();
});
$("diagramClear").addEventListener("click", () => {
  if (hasDiagramText($("diagramText").value) && !confirm("Clear the diagram?")) return;
  $("diagramText").value = "";
  if (!MOTIF_NAMES.some((k) => state.motifs[k].role !== "off")) state.motifs.ribbons.role = "region";
  changed();
});

for (const id of ["speed", "travelSpeed", "liftDelay"])
  $(id).addEventListener("change", () => {
    readControls();
    if (plot) {
      plot.options = {
        ...plot.options,
        speed: state.speed,
        travelSpeed: state.travelSpeed,
        liftDelay: state.liftDelay,
      };
      draw();
    }
  });
$("optimize").addEventListener("change", () => {
  readControls();
  requestGenerate();
});
$("paper").addEventListener("change", setPaper);
$("orientation").addEventListener("change", () => {
  if (state.paper === "custom") {
    const w = $("width").value;
    $("width").value = $("height").value;
    $("height").value = w;
    state.orientation = $("orientation").value;
    requestGenerate();
  } else setPaper();
});
$("newSeed").addEventListener("click", () => {
  state.seed =
    "LW-" +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .toUpperCase();
  $("seed").value = state.seed;
  requestGenerate();
});
$("showTravel").addEventListener("change", draw);
$("zoomIn").addEventListener("click", () => {
  zoom = Math.min(3, zoom + 0.25);
  fit();
});
$("zoomOut").addEventListener("click", () => {
  zoom = Math.max(0.5, zoom - 0.25);
  fit();
});
$("fit").addEventListener("click", () => {
  zoom = 1;
  fit();
});
window.addEventListener("resize", fit);
$("export").addEventListener("click", () => exportDrawing());
$("exportPen").addEventListener("click", () => exportDrawing(true));
$("saveConfig").addEventListener("click", () => {
  readControls();
  download(JSON.stringify(recipe(state), null, 2), "linework-recipe.json", "application/json");
});
$("loadConfig").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("Recipe is too large.");
    const data = JSON.parse(await file.text());
    if (![1, 2, 3].includes(data.version) || !(data.mode || data.motifs || data.diagram))
      throw new Error("Choose a Linework recipe.");
    const legacyImage = data.version === 1 && data.mode === "image";
    state = {
      ...normalize(data),
      paper: ["a4", "a3", "letter", "square", "custom"].includes(data.paper) ? data.paper : "custom",
      orientation: data.orientation === "landscape" ? "landscape" : "portrait",
    };
    visible.clear();
    sync();
    requestGenerate();
    toast(legacyImage ? "Image hatching was removed; loaded the recipe as flow ribbons." : "Recipe loaded.");
  } catch (err) {
    toast(err.message || "The recipe could not be read.");
  }
  e.target.value = "";
});
$("reset").addEventListener("click", () => {
  state = { ...normalize(DEFAULTS), paper: "a4", orientation: "portrait" };
  visible.clear();
  zoom = 1;
  sync();
  requestGenerate();
});
$("help").addEventListener("click", () => $("notes").showModal());
$("closeNotes").addEventListener("click", () => $("notes").close());
$("notes").addEventListener("click", (e) => {
  if (e.target === $("notes")) {
    const r = $("notes").getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      $("notes").close();
  }
});

sync();
runGenerate();
