const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const APP_VERSION = "222";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if ((req.url || "").split("?")[0] === "/app-info.json") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ version: APP_VERSION, urls: localUrls() }));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Fitness App V1 running at http://localhost:${PORT}`);
  localUrls()
    .filter((url) => !url.includes("localhost"))
    .forEach((url) => console.log(`iPhone on same Wi-Fi: ${url}`));
});

function localUrls() {
  const urls = [`http://localhost:${PORT}`];
  Object.values(os.networkInterfaces()).flat().forEach((network) => {
    if (!network || network.family !== "IPv4" || network.internal) return;
    urls.push(`http://${network.address}:${PORT}`);
  });
  return [...new Set(urls)];
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
  if ((requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") && requestUrl.searchParams.get("fresh") !== APP_VERSION) {
    requestUrl.searchParams.set("fresh", APP_VERSION);
    res.writeHead(302, { Location: `${requestUrl.pathname}${requestUrl.search}` });
    res.end();
    return;
  }

  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}
