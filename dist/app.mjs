import { zip } from "./archive.mjs";
import { DEFAULTS, normalize, generate, prepare, metrics, toSVG } from "./engine.mjs";
const $ = (id) => document.getElementById(id),
  descriptions = {
    ribbons: "Long contours bend into open channels, with optional cross-grain threads.",
    signal: "Interrupted vertical registers, grouped into irregular blocks of colour.",
    wire: "Angular fans connect successive stations into a folded scaffold.",
    image: "Convert a source image into tone-dependent, coloured hatch paths.",
  };
const presets = {
  mineral: {
    mode: "ribbons",
    seed: "AL-184",
    palette: "earth",
    spacing: 1.15,
    distortion: 60,
    density: 65,
    crosshatch: true,
  },
  signal: {
    mode: "signal",
    seed: "SG-407",
    palette: "signal",
    spacing: 0.9,
    distortion: 65,
    density: 82,
    crosshatch: true,
  },
  wire: {
    mode: "wire",
    seed: "FL-029",
    palette: "earth",
    spacing: 1.2,
    distortion: 74,
    density: 63,
    crosshatch: true,
  },
};
let state = { ...DEFAULTS, paper: "a4", orientation: "portrait" },
  plot = null,
  source = null,
  sourceURL = null,
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
  if (state.mode === "image") state.mode = "ribbons";
} catch {}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
}
function sync() {
  state = normalize({ ...state });
  for (const key of [
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
  ])
    $(key).value = state[key];
  for (const key of ["crosshatch", "frame", "invert", "optimize"]) $(key).checked = !!state[key];
  $("paper").value = state.paper || "custom";
  $("orientation").value = state.orientation || "portrait";
  state.colors.slice(0, 3).forEach((c, i) => ($("color" + (i + 1)).value = c));
  $("customSize").hidden = state.paper !== "custom";
  $("customPens").hidden = state.palette !== "custom";
  $("imageSection").hidden = state.mode !== "image";
  document.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === state.mode);
    b.setAttribute("aria-pressed", b.dataset.mode === state.mode);
  });
  $("modeDescription").textContent = descriptions[state.mode];
  $("distortion").disabled = state.mode === "image";
  $("newSeed").disabled = state.mode === "image";
  outputs();
}
function outputs() {
  $("spacingOut").value = Number(state.spacing).toFixed(2) + " mm";
  $("distortionOut").value = state.distortion + "%";
  $("densityOut").value = state.density + "%";
  const overlap = state.spacing < state.pen * 2;
  $("spacingWarning").hidden = !overlap;
  $("spacingWarning").textContent =
    "Spacing is less than twice the pen width. Ink may merge; use a small proof.";
}
function readControls() {
  for (const key of [
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
  ])
    state[key] = ["seed", "palette", "background"].includes(key) ? $(key).value : Number($(key).value);
  for (const key of ["crosshatch", "frame", "invert", "optimize"]) state[key] = $(key).checked;
  state.colors = [1, 2, 3].map((i) => $("color" + i).value);
  state = normalize(state);
  outputs();
  try {
    localStorage.setItem("linework-settings", JSON.stringify(state));
  } catch {}
}
function selectedPlot() {
  return { ...plot, layers: plot.layers.filter((l) => visible.has(l.id)) };
}
function updateMetrics(stat) {
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
  $("canvas").setAttribute(
    "aria-label",
    `${descriptions[o.mode]} ${o.width} by ${o.height} millimetres, seed ${o.seed}.`,
  );
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
    const label = document.createElement("label");
    label.className = "layer";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const swatch = document.createElement("span");
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
    if (state.mode !== "image" || source) toast(result.error);
    return;
  }
  plot = result.plot;
  buildLayers();
  draw();
  $("status").textContent = plot.limited
    ? "Path limit reached — reduce density"
    : "Ready / " + plot.options.mode.replace("image", "image hatching");
  $("export").disabled = false;
  $("exportPen").disabled = false;
}
function requestGenerate() {
  clearTimeout(timer);
  $("export").disabled = true;
  $("exportPen").disabled = true;
  timer = setTimeout(() => {
    timer = null;
    runGenerate();
  }, 150);
}
function runGenerate() {
  readControls();
  const id = ++job;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (state.mode === "image" && !source) {
    $("status").textContent = "Choose a source image";
    $("export").disabled = true;
    $("exportPen").disabled = true;
    return;
  }
  $("status").textContent = "Drawing…";
  $("export").disabled = true;
  $("exportPen").disabled = true;
  const message = { kind: "generate", id, options: state, raster: state.mode === "image" ? source : null };
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
    onGenerated({ id: message.id, plot: generate(message.options, message.raster) });
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
  } else {
    $("customSize").hidden = false;
  }
  requestGenerate();
}
async function loadImageFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    toast("Choose a PNG, JPG, or WebP image.");
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    toast("Use an image smaller than 30 MB.");
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    await imageFromURL(url, file.name);
    state.mode = "image";
    sync();
    requestGenerate();
  } catch {
    toast("The image could not be decoded.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function imageFromURL(url, name) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 900 / Math.max(img.width, img.height)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  source = { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  sourceURL = c.toDataURL("image/png");
  $("imageName").textContent = name + " / " + c.width + " × " + c.height;
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

function recipe() {
  return { version: 1, ...state, imageDataURL: state.mode === "image" ? sourceURL : null };
}
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
  if (state.mode !== plot.options.mode) {
    toast("Wait for the current drawing to finish.");
    return;
  }
  pendingExport = true;
  const exported = selectedPlot();
  exported.options = {
    ...plot.options,
    optimize: state.optimize,
    speed: state.speed,
    travelSpeed: state.travelSpeed,
    liftDelay: state.liftDelay,
  };
  exportContext = {
    name: filename(),
    optimize: state.optimize,
    recipe: { version: 1, ...exported.options, imageDataURL: state.mode === "image" ? sourceURL : null },
  };
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
document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    readControls();
    state.mode = b.dataset.mode;
    sync();
    requestGenerate();
  }),
);
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    state = { ...state, ...presets[b.dataset.preset] };
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
  "invert",
  "color1",
  "color2",
  "color3",
])
  $(id).addEventListener(
    ["crosshatch", "frame", "invert", "palette"].includes(id) ? "change" : "input",
    () => {
      readControls();
      if (id === "palette") {
        visible.clear();
        sync();
      }
      requestGenerate();
    },
  );
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
$("optimize").addEventListener("change", readControls);
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
$("imageInput").addEventListener("change", (e) => loadImageFile(e.target.files[0]));
for (const type of ["dragenter", "dragover"])
  $("dropzone").addEventListener(type, (e) => {
    e.preventDefault();
    $("dropzone").classList.add("drag");
  });
for (const type of ["dragleave", "drop"])
  $("dropzone").addEventListener(type, (e) => {
    e.preventDefault();
    $("dropzone").classList.remove("drag");
    if (type === "drop") loadImageFile(e.dataTransfer.files[0]);
  });
$("sampleImage").addEventListener("click", async () => {
  try {
    await imageFromURL("sample-thread.png", "Thread sketch reference");
    state.invert = true;
    state.palette = "carbon";
    state.spacing = 1.2;
    state.density = 60;
    sync();
    requestGenerate();
  } catch {
    toast("The sample image could not be loaded.");
  }
});
$("export").addEventListener("click", () => exportDrawing());
$("exportPen").addEventListener("click", () => exportDrawing(true));
$("saveConfig").addEventListener("click", () => {
  readControls();
  download(JSON.stringify(recipe(), null, 2), "linework-recipe.json", "application/json");
});
$("loadConfig").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error("Recipe is too large.");
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !data.mode) throw new Error("Choose a Linework v1 recipe.");
    if (data.imageDataURL) {
      if (!/^data:image\/png;base64,/.test(data.imageDataURL))
        throw new Error("Invalid source image in recipe.");
      await imageFromURL(data.imageDataURL, "Recipe source");
    }
    state = {
      ...DEFAULTS,
      ...normalize(data),
      paper: ["a4", "a3", "letter", "square", "custom"].includes(data.paper) ? data.paper : "custom",
      orientation: data.orientation === "landscape" ? "landscape" : "portrait",
    };
    visible.clear();
    sync();
    requestGenerate();
    toast("Recipe loaded.");
  } catch (err) {
    toast(err.message || "The recipe could not be read.");
  }
  e.target.value = "";
});
$("reset").addEventListener("click", () => {
  state = { ...DEFAULTS, paper: "a4", orientation: "portrait" };
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
