/**
 * Local dev server: serves static files + proxies CGAuth POSTs (fixes browser CORS).
 * Run: npm start  ->  open http://localhost:5173/login.html
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fsp } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const CGAUTH_UPSTREAM = "https://cgauth.com/api/v1/";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function isAuthorized(req) {
  const incoming = req.headers["x-admin-key"];
  return Boolean(ADMIN_API_KEY) && incoming === ADMIN_API_KEY;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/content") {
    const statusPath = path.join(__dirname, "data", "status.json");
    const reviewsPath = path.join(__dirname, "data", "reviews.json");
    const blogPath = path.join(__dirname, "data", "blog.json");
    const configPath = path.join(__dirname, "data", "config.json");
    const [statusData, reviewsData, blogData, configData] = await Promise.all([
      readJsonFile(statusPath, { status: "Undetected", version: "v2.14.0", updatedAt: "Apr 1, 2026", notes: "" }),
      readJsonFile(reviewsPath, []),
      readJsonFile(blogPath, []),
      readJsonFile(configPath, { loaderUrl: "https://gofile.io/d/1Vi3FQ" }),
    ]);
    sendJson(res, 200, { status: statusData, reviews: reviewsData, blog: blogData, config: configData });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/admin/")) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const dataDir = path.join(__dirname, "data");

      if (req.url === "/api/admin/status") {
        const next = {
          status: String(payload.status || "Undetected"),
          version: String(payload.version || "v0.0.0"),
          updatedAt: String(payload.updatedAt || new Date().toISOString().slice(0, 10)),
          notes: String(payload.notes || ""),
        };
        await writeJsonFile(path.join(dataDir, "status.json"), next);
        sendJson(res, 200, { ok: true, data: next });
        return;
      }

      if (req.url === "/api/admin/reviews") {
        const existing = await readJsonFile(path.join(dataDir, "reviews.json"), []);
        const item = {
          id: Date.now(),
          stars: Math.max(1, Math.min(5, Number(payload.stars || 5))),
          text: String(payload.text || ""),
          author: String(payload.author || "Anonymous"),
          product: String(payload.product || "Roblox External"),
        };
        if (!item.text) {
          sendJson(res, 400, { error: "Missing review text" });
          return;
        }
        const next = [item, ...existing].slice(0, 50);
        await writeJsonFile(path.join(dataDir, "reviews.json"), next);
        sendJson(res, 200, { ok: true, data: item });
        return;
      }

      if (req.url === "/api/admin/blog") {
        const existing = await readJsonFile(path.join(dataDir, "blog.json"), []);
        const item = {
          id: Date.now(),
          date: String(payload.date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })),
          title: String(payload.title || ""),
          excerpt: String(payload.excerpt || ""),
        };
        if (!item.title || !item.excerpt) {
          sendJson(res, 400, { error: "Missing blog title or excerpt" });
          return;
        }
        const next = [item, ...existing].slice(0, 50);
        await writeJsonFile(path.join(dataDir, "blog.json"), next);
        sendJson(res, 200, { ok: true, data: item });
        return;
      }

      if (req.url === "/api/admin/loader") {
        const loaderUrl = String(payload.loaderUrl || "").trim();
        if (!loaderUrl) {
          sendJson(res, 400, { error: "Missing loaderUrl" });
          return;
        }
        const next = { loaderUrl };
        await writeJsonFile(path.join(dataDir, "config.json"), next);
        sendJson(res, 200, { ok: true, data: next });
        return;
      }

      sendJson(res, 404, { error: "Unknown admin endpoint" });
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON payload", message: String(err.message) });
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/cgauth")) {
    try {
      const body = await readBody(req);
      const upstream = await fetch(CGAUTH_UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await upstream.text();
      const ct = upstream.headers.get("content-type") || "application/json";
      res.writeHead(upstream.status, { "Content-Type": ct });
      res.end(text);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Proxy error", message: String(err.message) }));
    }
    return;
  }

  const filePath = safeJoin(__dirname, req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404);
        res.end("Not found");
      } else {
        res.writeHead(500);
        res.end("Server error");
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`MOMO site: http://localhost:${PORT}/`);
  console.log(`Login (CGAuth proxy): http://localhost:${PORT}/login.html`);
});
