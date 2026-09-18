/* ============================================================
   Cloudflare Worker (see wrangler.jsonc)
   The site's code, design and built-in photos are static files served by Cloudflare.
   Everything the admin panel changes is kept in D1 (worker/store.js), so Publish is live
   in seconds with no git push. This script handles:
   - /api/*                    the same JSON API as server.js, so the admin runs in full "server" mode
   - /data/content.json|.js    the latest published content (falls back to the file in the repo)
   - /assets/img/uploads/*     photos uploaded from the admin (falls back to files in the repo)
   - /car/<id>                 share page with the car's photo for WhatsApp thumbnails
   Secret: ADMIN_PASSWORD (first login). After a change in Admin → Security the D1 copy is used.
   ============================================================ */
import { renderCarPage, findCar, shareImages } from "../lib/carpage.js";
import enquiryLib from "../lib/enquiries.js";
import STATIC_IMAGES from "./static-images.json";
import * as store from "./store.js";

const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_JSON = 1900000;   // content.json (one D1 value holds at most 2 MB)
const MAX_UPLOAD = 2700000; // a base64 photo just over store.MAX_IMAGE, so the size check below can explain itself
const MAX_SMALL = 16 * 1024;
const PBKDF2_ROUNDS = 100000; // the most Workers allows

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (body, status = 200, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(headers || {}) } });
const ok = (data) => json({ ok: true, ...(data || {}) });
const fail = (status, error) => json({ ok: false, error }, status);
async function readJson(request, limit) {
  const raw = await request.text();
  if (raw.length > limit) throw new HttpError(413, "Request too large");
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { throw new HttpError(400, "Invalid JSON"); }
}

/* Per-instance limits for the public endpoints (each Cloudflare location keeps its own count). */
const hits = new Map();
function overLimit(key, max) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h.since > 60 * 60 * 1000) { if (hits.size > 5000) hits.clear(); hits.set(key, { n: 1, since: now }); return false; }
  return ++h.n > max;
}

/* ---------- password and sessions ---------- */
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
function sameText(a, b) { // constant time
  a = enc.encode(String(a)); b = enc.encode(String(b));
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}
async function pbkdf2(pw, saltHex, rounds) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}
async function verifyPassword(env, pw) {
  if (typeof pw !== "string" || !pw) return false;
  const stored = await store.getSetting(env.DB, "admin_password"); // "pbkdf2$<rounds>$<salt>$<hash>"
  if (stored) { const [, rounds, salt, hash] = stored.split("$"); return sameText(await pbkdf2(pw, salt, Number(rounds)), hash); }
  return !!env.ADMIN_PASSWORD && sameText(pw, env.ADMIN_PASSWORD);
}
async function setPassword(env, pw) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await store.setSetting(env.DB, "admin_password", `pbkdf2$${PBKDF2_ROUNDS}$${salt}$${await pbkdf2(pw, salt, PBKDF2_ROUNDS)}`);
}
/* Stateless tokens "<expiry>.<hmac>", signed with a random key kept in D1. */
async function sign(env, exp) {
  const key = await crypto.subtle.importKey("raw", enc.encode(await store.secretSetting(env.DB, "session_key")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(exp))));
}
async function newToken(env) { const exp = Date.now() + SESSION_TTL; return exp + "." + (await sign(env, exp)); }
async function signedIn(env, request) {
  const h = request.headers.get("Authorization") || "", [exp, sig] = (h.startsWith("Bearer ") ? h.slice(7) : "").split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return sameText(sig, await sign(env, exp));
}

/* ---------- content ---------- */
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
/* The published content as JSON text: D1 once the admin has published, otherwise data/content.json from the repo. */
async function contentText(env, origin) {
  const row = await store.currentContent(env.DB);
  if (row) return row.json;
  const r = await env.ASSETS.fetch(new URL("/data/content.json", origin));
  return r.ok ? r.text() : null;
}

/* ---------- API ---------- */
async function api(request, env, url) {
  const db = env.DB, ip = request.headers.get("CF-Connecting-IP") || "?";
  const route = request.method + " " + url.pathname;

  if (route === "GET /api/health") return ok({ mode: "server", version: 2, enquiries: true, analytics: true, host: "cloudflare", time: new Date().toISOString() });

  // Public: a visitor pressed "Book on WhatsApp" or sent the contact form
  if (route === "POST /api/enquiry") {
    if (overLimit("enq:" + ip, 20)) return fail(429, "Too many enquiries. Please call us instead.");
    const body = await readJson(request, 8 * 1024);
    if (body.website) return ok(); // honeypot field: bots fill it, people never see it
    const { enquiry, error } = enquiryLib.cleanEnquiry(body);
    if (error) return fail(400, error);
    return ok({ id: await store.addEnquiry(db, enquiry) });
  }

  // Public: page views and clicks (Admin → Analytics). Always answers 204 so it never slows the page.
  if (route === "POST /api/track") {
    if (!overLimit("trk:" + ip, 600)) {
      try {
        const cf = request.cf || {};
        const headers = { "user-agent": request.headers.get("User-Agent") || "", "cf-connecting-ip": ip, host: url.host, "cf-ipcountry": cf.country || "", "cf-region": cf.region || "", "cf-ipcity": cf.city || "" };
        await store.track(db, await readJson(request, 4 * 1024), headers);
      } catch (e) { /* bad beacon */ }
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  if (route === "POST /api/login") {
    if (await store.tooManyAttempts(db, ip)) return fail(429, "Too many attempts. Try again in 10 minutes.");
    if (!env.ADMIN_PASSWORD && !(await store.getSetting(db, "admin_password"))) return fail(500, "No admin password yet. Add the ADMIN_PASSWORD secret in Cloudflare → Workers & Pages → carrental → Settings → Variables and Secrets.");
    const { password } = await readJson(request, MAX_SMALL);
    const good = await verifyPassword(env, password);
    await store.noteAttempt(db, ip, good);
    if (!good) return fail(401, "Incorrect password");
    return ok({ token: await newToken(env), defaultPassword: false });
  }

  if (route === "GET /api/content") {
    const text = await contentText(env, url.origin);
    return text ? new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }) : fail(404, "No content yet");
  }

  // everything below requires auth
  if (!(await signedIn(env, request))) return fail(401, "Not signed in");

  if (route === "GET /api/me") return ok({ defaultPassword: false });
  if (route === "POST /api/logout") return ok(); // tokens are stateless; the browser forgets its copy

  if (route === "PUT /api/content") {
    const content = await readJson(request, MAX_JSON);
    const err = validateContent(content); if (err) return fail(400, err);
    // Published from another device since this editor loaded? Refuse unless the admin chose to overwrite.
    const base = request.headers.get("X-Base-Updated-At"), cur = ((await store.currentContent(db)) || {}).updated_at;
    if (base && cur && base !== cur && request.headers.get("X-Force") !== "1") return json({ ok: false, error: "The site was published from another device since you started editing.", updatedAt: cur }, 409);
    content.updatedAt = new Date().toISOString();
    await store.saveContent(db, content);
    return ok({ updatedAt: content.updatedAt });
  }

  if (route === "GET /api/backups") return ok({ backups: await store.listBackups(db) });
  if (route === "POST /api/restore") {
    const { name } = await readJson(request, MAX_SMALL);
    const content = await store.backupContent(db, name);
    if (!content) return fail(404, "Backup not found");
    await store.saveContent(db, content);
    return ok({ content });
  }

  if (route === "POST /api/password") {
    if (await store.tooManyAttempts(db, ip)) return fail(429, "Too many attempts. Try again in 10 minutes.");
    const { current, next } = await readJson(request, MAX_SMALL);
    const good = await verifyPassword(env, String(current || "")); await store.noteAttempt(db, ip, good);
    if (!good) return fail(400, "Current password is incorrect");
    if (typeof next !== "string" || next.length < 8) return fail(400, "New password must be at least 8 characters");
    await setPassword(env, next); return ok();
  }

  if (route === "GET /api/enquiries") {
    const q = Object.fromEntries(url.searchParams), all = await store.allEnquiries(db);
    const list = enquiryLib.filterList(all, q).slice().reverse();
    const counts = { all: all.length }; enquiryLib.STATUSES.forEach((st) => (counts[st] = all.filter((e) => e.status === st).length));
    return ok({ enquiries: list, counts });
  }
  if (route === "GET /api/enquiries/export") {
    const list = enquiryLib.filterList(await store.allEnquiries(db), Object.fromEntries(url.searchParams)).slice().reverse();
    const stamp = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    return new Response(enquiryLib.toXlsx(list, "Enquiries"), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="enquiries-${stamp}.xlsx"`, "Cache-Control": "no-store" } });
  }
  if (route === "PATCH /api/enquiries") {
    const { id, status, notes } = await readJson(request, MAX_SMALL);
    const patch = {};
    if (status !== undefined) { if (!enquiryLib.STATUSES.includes(status)) return fail(400, "Unknown status"); patch.status = status; }
    if (notes !== undefined) patch.notes = String(notes).slice(0, 2000);
    const e = await store.updateEnquiry(db, String(id || ""), patch);
    return e ? ok({ enquiry: e }) : fail(404, "Enquiry not found");
  }
  if (route === "DELETE /api/enquiries") {
    const { id } = await readJson(request, MAX_SMALL);
    return (await store.removeEnquiry(db, String(id || ""))) ? ok() : fail(404, "Enquiry not found");
  }

  if (route === "GET /api/analytics") return ok(await store.analyticsSummary(db, url.searchParams.get("days")));
  if (route === "DELETE /api/analytics") { await store.resetAnalytics(db); return ok(); }

  if (route === "GET /api/images") return ok({ images: [...new Set([...STATIC_IMAGES, ...(await store.imagePaths(db))])] });

  if (route === "POST /api/upload") {
    const { name, data, folder } = await readJson(request, MAX_UPLOAD);
    const m = typeof data === "string" && data.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    if (!m) return fail(400, "Unsupported image type (use JPG, PNG or WebP)");
    const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    let bytes; try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch (e) { return fail(400, "The image data is damaged"); }
    if (bytes.byteLength > store.MAX_IMAGE) return fail(400, "Image larger than 1.9 MB after resizing. Use a JPG photo instead of PNG, or a smaller image.");
    const safeFolder = String(folder || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const base = String(name || "image").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    const rel = "assets/img/uploads/" + (safeFolder ? safeFolder + "/" : "") + `${Date.now().toString(36)}-${base}.${ext}`;
    await store.putImage(db, rel, ext === "jpg" ? "image/jpeg" : "image/" + ext, bytes);
    return ok({ path: rel, size: bytes.byteLength });
  }

  if (route === "DELETE /api/upload") {
    const { path: rel } = await readJson(request, MAX_SMALL);
    if (typeof rel !== "string" || !rel.startsWith("assets/img/uploads/") || rel.includes("..")) return fail(400, "Only uploaded images can be deleted");
    if (await store.deleteImage(db, rel)) { await caches.default.delete(new URL("/" + rel, url.origin)).catch(() => {}); return ok(); }
    return STATIC_IMAGES.includes(rel) ? fail(400, "This photo is part of the site files in GitHub. Remove it from the project folder instead.") : ok();
  }

  return fail(404, "Unknown API route");
}

/* ---------- pages and files that come from D1 ---------- */
async function uploadedImage(request, env, url, ctx) {
  const cache = caches.default, key = new Request(url.origin + url.pathname);
  const hit = await cache.match(key); if (hit) return hit;
  const row = await store.getImage(env.DB, decodeURIComponent(url.pathname.slice(1)));
  if (!row) return env.ASSETS.fetch(request); // uploaded before the move to D1: still a file in the repo
  const res = new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.type, "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400", "X-Content-Type-Options": "nosniff" } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function carPage(env, url) {
  try {
    const id = decodeURIComponent(url.pathname.slice("/car/".length)).replace(/[^\w-]/g, "");
    const text = await contentText(env, url.origin);
    if (text) {
      const content = JSON.parse(text);
      let { full, small } = shareImages(findCar(content, id));
      // WhatsApp drops large og:images, so prefer the "-sm.jpg" copy when it exists
      if (small && !(await env.ASSETS.fetch(new URL("/" + small, url.origin), { method: "HEAD" })).ok) small = "";
      const html = renderCarPage(content, id, url.origin, small || full);
      if (html) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    }
  } catch (e) { /* fall through to the home page */ }
  return new Response(null, { status: 302, headers: { Location: "/", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    try {
      await store.ensureSchema(env.DB);
      if (p.startsWith("/api/")) return await api(request, env, url);
      if (p === "/data/content.json" || p === "/data/content.js") {
        const text = await contentText(env, url.origin);
        if (!text) return env.ASSETS.fetch(request);
        return p.endsWith(".js")
          ? new Response("window.SITE_CONTENT = " + text + ";\n", { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" } })
          : new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" } });
      }
      if (p.startsWith("/assets/img/uploads/")) return await uploadedImage(request, env, url, ctx);
      if (p.startsWith("/car/")) return await carPage(env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      // Database trouble must never take the public site down: serve the files from the repo instead.
      if (!p.startsWith("/api/")) return env.ASSETS.fetch(request);
      return fail(500, e.message || "Server error");
    }
  },
};
