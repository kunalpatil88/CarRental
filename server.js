/* ============================================================
   DriveEase — zero-dependency Node server
   Serves the site and a small JSON API for the admin panel.
   Run:  node server.js     (or: npm start)
   Env:  PORT=3000  ADMIN_PASSWORD=...  CONFIG_FILE=...  TRUST_CF=1  (optional overrides)
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
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(ROOT, "admin.config.json");
const ENQUIRIES_FILE = path.join(DATA_DIR, "enquiries.json");
const enquiryLib = require("./lib/enquiries");
const enquiries = enquiryLib.createStore(ENQUIRIES_FILE);
const enquiryHits = new Map(); // ip -> { n, since }
const { renderCarPage, findCar, shareImages } = require("./lib/carpage");
// Public origin for absolute share links. Behind Cloudflare / a proxy the original scheme arrives in X-Forwarded-Proto.
function siteOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim().replace(/[^\w.:-]/g, "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_BODY = 12 * 1024 * 1024;       // photo uploads (base64)
const MAX_JSON = 2 * 1024 * 1024;        // content.json
const MAX_SMALL = 16 * 1024;             // login, password, restore

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4",
};
/* Only these paths are ever served. Everything else (config, backups, server code, original photo folders) stays private. */
const ALLOWED = [/^\/(index|admin)\.html$/, /^\/robots\.txt$/, /^\/data\/content\.(json|js)$/, /^\/assets\/(css|js|img)\/[\w\-./ ]+\.(css|js|jpe?g|png|webp|gif|svg|ico|woff2?)$/i];

/* Security headers. The CSP allows the one inline theme script in index.html by its hash. */
function inlineScriptHashes(file) {
  try {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`).join(" ");
  } catch (e) { return ""; }
}
function securityHeaders(isHtml) {
  const h = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  };
  if (isHtml) h["Content-Security-Policy"] = [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes("index.html")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "frame-src 'self' https://www.youtube-nocookie.com https://www.instagram.com https://www.facebook.com https://www.google.com https://maps.google.com",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  return h;
}

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
function safeEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function verifyPassword(pw) {
  if (process.env.ADMIN_PASSWORD) return safeEqual(pw, process.env.ADMIN_PASSWORD);
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
// Forget expired sessions and stale rate-limit entries every 10 minutes
setInterval(() => { const now = Date.now(); for (const [t, exp] of sessions) if (exp < now) sessions.delete(t); for (const [ip, a] of attempts) if (now - a.last > 10 * 60 * 1000) attempts.delete(ip); }, 10 * 60 * 1000).unref();
function noteAttempt(ip, ok) { if (ok) { attempts.delete(ip); return; } const a = attempts.get(ip) || { count: 0 }; a.count++; a.last = Date.now(); attempts.set(ip, a); }

/* ---------- helpers ---------- */
function send(res, status, body, headers) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders(false), ...(headers || {}) };
  res.writeHead(status, h); res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const ok = (res, data) => send(res, 200, { ok: true, ...(data || {}) });
const fail = (res, status, error) => send(res, status, { ok: false, error });
function readBody(req, limit) {
  const max = limit || MAX_SMALL;
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > max) { const e = new Error("Request too large"); e.status = 413; reject(e); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJson(req, limit) { const raw = await readBody(req, limit); try { return raw ? JSON.parse(raw) : {}; } catch (e) { throw new Error("Invalid JSON"); } }
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
  const ids = new Set();
  for (const car of c.fleet) {
    if (!car || !car.id || !car.name) return "Every car needs an id and a name";
    if (ids.has(car.id)) return `Two cars share the id "${car.id}"`;
    ids.add(car.id);
  }
  return null;
}
function currentUpdatedAt() { try { return JSON.parse(fs.readFileSync(CONTENT_JSON, "utf8")).updatedAt || ""; } catch (e) { return ""; } }
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
  // Behind Cloudflare every request arrives from the tunnel, so use the visitor IP it forwards.
  const ip = (process.env.TRUST_CF && req.headers["cf-connecting-ip"]) || req.socket.remoteAddress || "?";
  const route = req.method + " " + url.pathname;

  if (route === "GET /api/health") return ok(res, { mode: "server", version: 2, enquiries: true, time: new Date().toISOString() });

  // Public: a visitor pressed "Book on WhatsApp" or sent the contact form
  if (route === "POST /api/enquiry") {
    const hit = enquiryHits.get(ip) || { n: 0, since: Date.now() };
    if (Date.now() - hit.since > 60 * 60 * 1000) { hit.n = 0; hit.since = Date.now(); }
    if (++hit.n > 20) return fail(res, 429, "Too many enquiries. Please call us instead.");
    enquiryHits.set(ip, hit);
    const body = await readJson(req, 8 * 1024);
    if (body.website) return ok(res); // honeypot field: bots fill it, people never see it
    const { enquiry, error } = enquiryLib.cleanEnquiry(body);
    if (error) return fail(res, 400, error);
    if (enquiries.all().some((e) => e.id === enquiry.id)) enquiry.id += "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
    await enquiries.add(enquiry);
    return ok(res, { id: enquiry.id });
  }

  if (route === "POST /api/login") {
    if (tooManyAttempts(ip)) return fail(res, 429, "Too many attempts. Try again in 10 minutes.");
    const { password } = await readJson(req, MAX_SMALL);
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
    const content = await readJson(req, MAX_JSON);
    const err = validateContent(content); if (err) return fail(res, 400, err);
    // Published from another device since this editor loaded? Refuse unless the admin chose to overwrite.
    const base = req.headers["x-base-updated-at"], cur = currentUpdatedAt();
    if (base && cur && base !== cur && req.headers["x-force"] !== "1") return send(res, 409, { ok: false, error: "The site was published from another device since you started editing.", updatedAt: cur });
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
    if (process.env.ADMIN_PASSWORD) return fail(res, 400, "The password is set by the ADMIN_PASSWORD environment variable on the server.");
    if (tooManyAttempts(ip)) return fail(res, 429, "Too many attempts. Try again in 10 minutes.");
    const { current, next } = await readJson(req);
    const good = verifyPassword(String(current || "")); noteAttempt(ip, good);
    if (!good) return fail(res, 400, "Current password is incorrect");
    if (typeof next !== "string" || next.length < 8) return fail(res, 400, "New password must be at least 8 characters");
    setPassword(next); return ok(res);
  }

  if (route === "GET /api/enquiries") {
    const q = Object.fromEntries(url.searchParams);
    const all = enquiries.all();
    const list = enquiryLib.filterList(all, q).slice().reverse();
    const counts = { all: all.length }; enquiryLib.STATUSES.forEach((st) => (counts[st] = all.filter((e) => e.status === st).length));
    return ok(res, { enquiries: list, counts });
  }
  if (route === "GET /api/enquiries/export") {
    const q = Object.fromEntries(url.searchParams);
    const list = enquiryLib.filterList(enquiries.all(), q).slice().reverse();
    const stamp = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const buf = enquiryLib.toXlsx(list, "Enquiries");
    res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="enquiries-${stamp}.xlsx"`, "Content-Length": buf.length, "Cache-Control": "no-store", ...securityHeaders(false) });
    return res.end(buf);
  }
  if (route === "PATCH /api/enquiries") {
    const { id, status, notes } = await readJson(req);
    const patch = {};
    if (status !== undefined) { if (!enquiryLib.STATUSES.includes(status)) return fail(res, 400, "Unknown status"); patch.status = status; }
    if (notes !== undefined) patch.notes = String(notes).slice(0, 2000);
    const e = enquiries.update(String(id || ""), patch);
    return e ? ok(res, { enquiry: e }) : fail(res, 404, "Enquiry not found");
  }
  if (route === "DELETE /api/enquiries") {
    const { id } = await readJson(req);
    return enquiries.remove(String(id || "")) ? ok(res) : fail(res, 404, "Enquiry not found");
  }

  if (route === "GET /api/images") {
    const images = [...listImages(path.join(ROOT, "assets", "img", "promos"), "assets/img/promos"), ...listImages(path.join(ROOT, "assets", "img", "cars"), "assets/img/cars"), ...listImages(UPLOAD_DIR, "assets/img/uploads")];
    return ok(res, { images });
  }

  if (route === "POST /api/upload") {
    const { name, data, folder } = await readJson(req, MAX_BODY);
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
const ROBOTS = "User-agent: *\nDisallow: /admin.html\nDisallow: /api/\n";
function serveStatic(req, res, url) {
  let p;
  try { p = path.posix.normalize(decodeURIComponent(url.pathname)); } catch (e) { return send(res, 400, "Bad request", { "Content-Type": "text/plain" }); }
  if (p === "/" || p === "/index") p = "/index.html";
  if (p === "/admin" || p === "/admin/") p = "/admin.html";
  const carMatch = p.match(/^\/car\/([\w-]+)\/?$/);
  if (carMatch) {
    let html = null;
    try {
      const content = JSON.parse(fs.readFileSync(CONTENT_JSON, "utf8"));
      const { full, small } = shareImages(findCar(content, carMatch[1]));
      html = renderCarPage(content, carMatch[1], siteOrigin(req), small && fs.existsSync(path.join(ROOT, small)) ? small : full);
    } catch (e) { /* no content */ }
    if (!html) { res.writeHead(302, { Location: "/", "Cache-Control": "no-store" }); return res.end(); }
    return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  }
  if (p === "/robots.txt") return send(res, 200, ROBOTS, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" });
  if (p.includes("\0") || p.split("/").some((seg) => seg.startsWith(".")) || !ALLOWED.some((re) => re.test(p))) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    stream(file, res, req, st, p);
  });
}
function stream(file, res, req, st, p) {
  const ext = path.extname(file).toLowerCase();
  const isImage = /\.(jpe?g|png|webp|gif|svg|ico|woff2?)$/i.test(ext);
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    // Photos rarely change; code and content revalidate with the ETag so edits show up at once.
    "Cache-Control": isImage ? "public, max-age=604800, stale-while-revalidate=86400" : "no-cache",
    ETag: etag,
    ...securityHeaders(ext === ".html"),
  };
  if (p === "/admin.html") headers["X-Robots-Tag"] = "noindex, nofollow";
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
  headers["Content-Length"] = st.size;
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
    if (e.status) return fail(res, e.status, e.message);
    console.error(e);
    return fail(res, 500, e.message || "Server error");
  }
});
server.headersTimeout = 20000;
server.requestTimeout = 60000;
server.listen(PORT, HOST, () => {
  console.log(`\n  DriveEase is running`);
  console.log(`  Site:   http://localhost:${PORT}/`);
  console.log(`  Admin:  http://localhost:${PORT}/admin.html\n`);
});
