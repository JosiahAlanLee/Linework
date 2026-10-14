// Minimal static server for the Linework UI. No dependencies.
// Browsers block ES modules and workers on file:// pages, so the UI must be served over HTTP.
// Usage: npm start            (http://localhost:8080)
//        PORT=9000 npm start
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw Object.assign(new Error(), { code: "ENOENT" });
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" || e.code === "EISDIR" ? 404 : 500, { "Content-Type": "text/plain" });
    res.end(e.code === "ENOENT" || e.code === "EISDIR" ? "Not found" : "Server error");
  }
}).listen(port, "127.0.0.1", () => console.log(`Linework is running at http://localhost:${port}/  (Ctrl+C to stop)`));
