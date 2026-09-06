/* ============================================================
   DriveEase — zero-dependency Node server
   Serves the site and a small JSON API for the admin panel.
   Run:  node server.js     (or: npm start)
   Env:  PORT=3000  ADMIN_PASSWORD=...  (optional overrides)
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
const CONTENT_JSON = path.join(DATA_DIR, "content.json");
const CONTENT_JS = path.join(DATA_DIR, "content.js");
const CONFIG_FILE = path.join(ROOT, "admin.config.json");
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_BODY = 12 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4",
};
const BLOCKED = [/^\/server\.js$/i, /^\/admin\.config\.json$/i, /^\/package(-lock)?\.json$/i, /^\/data\/backups(\/|$)/i, /^\/node_modules(\/|$)/i, /(^|\/)\.[^/]+/, /^\/README\.md$/i, /\.(bat|sh|py)$/i];

/* ---------- password / config ---------- */
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString("hex"); }
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) { /* fallthrough */ } }
  const salt = crypto.randomBytes(16).toString("hex");
  const cfg = { salt, hash: hashPassword("admin123", salt), createdAt: new Date().toISOString() };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  console.log("\n  ⚠  Created admin.config.json with the default password: admin123");
  console.log("     Change it from Admin → Security as soon as you log in.\n");
  return cfg;
}
let config = loadConfig();
function verifyPassword(pw) {
  if (process.env.ADMIN_PASSWORD) return pw === process.env.ADMIN_PASSWORD;
  const a = Buffer.from(hashPassword(pw, config.salt), "hex"), b = Buffer.from(config.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  config = { ...config, salt, hash: hashPassword(pw, salt), updatedAt: new Date().toISOString() };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/* ---------- sessions & rate limiting ---------- */
const sessions = new Map();
const attempts = new Map();
function newSession() { const t = crypto.randomBytes(32).toString("hex"); sessions.set(t, Date.now() + SESSION_TTL); return t; }
function auth(req) {
  const h = req.headers.authorization || ""; const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const exp = sessions.get(t); if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  sessions.set(t, Date.now() + SESSION_TTL); return true;
}
function tooManyAttempts(ip) { const a = attempts.get(ip); return a && a.count >= 8 && Date.now() - a.last < 10 * 60 * 1000; }
function noteAttempt(ip, ok) { if (ok) { attempts.delete(ip); return; } const a = attempts.get(ip) || { count: 0 }; a.count++; a.last = Date.now(); attempts.set(ip, a); }

/* ---------- helpers ---------- */
function send(res, status, body, headers) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(headers || {}) };
  res.writeHead(status, h); res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const ok = (res, data) => send(res, 200, { ok: true, ...(data || {}) });
const fail = (res, status, error) => send(res, status, { ok: false, error });
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("Body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJson(req) { const raw = await readBody(req); try { return raw ? JSON.parse(raw) : {}; } catch (e) { throw new Error("Invalid JSON"); } }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function listImages(dir, prefix) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + "/" + ent.name;
    if (ent.isDirectory()) out.push(...listImages(path.join(dir, ent.name), rel));
    else if (/\.(jpe?g|png|webp|gif)$/i.test(ent.name) && !/-sm\.jpg$/i.test(ent.name)) out.push(rel);
  }
  return out;
}
function validateContent(c) {
  if (!c || typeof c !== "object") return "Content must be an object";
  if (!c.site || typeof c.site !== "object") return "Missing site settings";
  if (!Array.isArray(c.fleet)) return "fleet must be an array";
  for (const car of c.fleet) { if (!car.id || !car.name) return "Every car needs an id and a name"; }
  return null;
}
function writeContent(content) {
  ensureDir(DATA_DIR); ensureDir(BACKUP_DIR);
  if (fs.existsSync(CONTENT_JSON)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(CONTENT_JSON, path.join(BACKUP_DIR, `content-${stamp}.json`));
    const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("content-")).sort();
    while (backups.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
  }
  const json = JSON.stringify(content, null, 2);
  fs.writeFileSync(CONTENT_JSON, json + "\n");
  fs.writeFileSync(CONTENT_JS, "window.SITE_CONTENT = " + json + ";\n");
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const ip = req.socket.remoteAddress || "?";
  const route = req.method + " " + url.pathname;

  if (route === "GET /api/health") return ok(res, { mode: "server", version: 1, time: new Date().toISOString() });

  if (route === "POST /api/login") {
    if (tooManyAttempts(ip)) return fail(res, 429, "Too many attempts. Try again in 10 minutes.");
    const { password } = await readJson(req);
    const good = typeof password === "string" && verifyPassword(password);
    noteAttempt(ip, good);
    if (!good) return fail(res, 401, "Incorrect password");
    return ok(res, { token: newSession(), defaultPassword: !process.env.ADMIN_PASSWORD && verifyPassword("admin123") });
  }

  if (route === "GET /api/content") {
    if (!fs.existsSync(CONTENT_JSON)) return fail(res, 404, "No content yet");
    return send(res, 200, fs.readFileSync(CONTENT_JSON, "utf8"));
  }

  // everything below requires auth
  if (!auth(req)) return fail(res, 401, "Not signed in");

  if (route === "GET /api/me") return ok(res, { defaultPassword: !process.env.ADMIN_PASSWORD && verifyPassword("admin123") });
  if (route === "POST /api/logout") { const t = (req.headers.authorization || "").slice(7); sessions.delete(t); return ok(res); }

  if (route === "PUT /api/content") {
    const content = await readJson(req);
    const err = validateContent(content); if (err) return fail(res, 400, err);
    content.updatedAt = new Date().toISOString();
    writeContent(content);
    return ok(res, { updatedAt: content.updatedAt });
  }

  if (route === "GET /api/backups") {
    ensureDir(BACKUP_DIR);
    const list = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json")).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
    return ok(res, { backups: list });
  }
  if (route === "POST /api/restore") {
    const { name } = await readJson(req);
    if (!name || !/^content-[\w-]+\.json$/.test(name)) return fail(res, 400, "Bad backup name");
    const file = path.join(BACKUP_DIR, name); if (!fs.existsSync(file)) return fail(res, 404, "Backup not found");
    const content = JSON.parse(fs.readFileSync(file, "utf8")); writeContent(content);
    return ok(res, { content });
  }

  if (route === "POST /api/password") {
    const { current, next } = await readJson(req);
    if (!verifyPassword(String(current || ""))) return fail(res, 400, "Current password is incorrect");
    if (typeof next !== "string" || next.length < 6) return fail(res, 400, "New password must be at least 6 characters");
    setPassword(next); return ok(res);
  }

  if (route === "GET /api/images") {
    const images = [...listImages(path.join(ROOT, "assets", "img", "promos"), "assets/img/promos"), ...listImages(path.join(ROOT, "assets", "img", "cars"), "assets/img/cars"), ...listImages(UPLOAD_DIR, "assets/img/uploads")];
    return ok(res, { images });
  }

  if (route === "POST /api/upload") {
    const { name, data, folder } = await readJson(req);
    if (typeof data !== "string" || !data.startsWith("data:image/")) return fail(res, 400, "Expected a data:image/* payload");
    const m = data.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i); if (!m) return fail(res, 400, "Unsupported image type (use JPG, PNG or WebP)");
    const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    const buf = Buffer.from(m[2], "base64"); if (buf.length > 8 * 1024 * 1024) return fail(res, 400, "Image larger than 8 MB");
    const safeFolder = String(folder || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const dir = safeFolder ? path.join(UPLOAD_DIR, safeFolder) : UPLOAD_DIR; ensureDir(dir);
    const base = String(name || "image").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    const file = `${Date.now().toString(36)}-${base}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buf);
    const rel = ("assets/img/uploads/" + (safeFolder ? safeFolder + "/" : "") + file);
    return ok(res, { path: rel, size: buf.length });
  }

  if (route === "DELETE /api/upload") {
    const { path: rel } = await readJson(req);
    if (typeof rel !== "string" || !rel.startsWith("assets/img/uploads/") || rel.includes("..")) return fail(res, 400, "Only uploaded images can be deleted");
    const file = path.join(ROOT, rel); if (fs.existsSync(file)) fs.unlinkSync(file);
    return ok(res);
  }

  return fail(res, 404, "Unknown API route");
}

/* ---------- static ---------- */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  if (BLOCKED.some((re) => re.test(p))) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!path.extname(p)) { const alt = file + ".html"; if (fs.existsSync(alt)) return stream(alt, res, req); }
      return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    }
    stream(file, res, req, st);
  });
}
function stream(file, res, req, st) {
  const ext = path.extname(file).toLowerCase();
  const isAsset = /\.(jpe?g|png|webp|gif|svg|woff2?|ico)$/i.test(ext);
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": isAsset ? "public, max-age=604800" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  if (st) headers["Content-Length"] = st.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "Content-Type": "text/plain" });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message || "Server error");
  }
});
server.listen(PORT, HOST, () => {
  console.log(`\n  DriveEase is running`);
  console.log(`  Site:   http://localhost:${PORT}/`);
  console.log(`  Admin:  http://localhost:${PORT}/admin.html\n`);
});
