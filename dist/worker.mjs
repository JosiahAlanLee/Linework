import { generate, prepare, metrics, toSVG } from "./engine.mjs";
self.onmessage = ({ data }) => {
  try {
    if (data.kind === "generate") {
      const plot = generate(data.options, data.raster);
      self.postMessage({ id: data.id, plot, metrics: metrics(plot) });
    } else {
      const plot = prepare(data.plot, data.optimize),
        stat = metrics(plot),
        svg = data.separate ? null : toSVG(plot, { selected: data.selected }),
        files = data.separate
          ? plot.layers
              .filter((l) => data.selected.includes(l.id) && l.paths.length)
              .map((l) => ({ name: l.id + ".svg", text: toSVG(plot, { selected: [l.id] }) }))
          : null;
      self.postMessage({ id: data.id, svg, files, metrics: stat });
    }
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
