/* ============================================================
   D1 storage for the Cloudflare Worker (binding: DB)
   Everything the admin panel changes lives here, so publishing needs no git push:
   content versions, enquiries, visitor analytics, the admin password. Photos live in R2 (worker/photos.js).
   Tables are created on first use.
   ============================================================ */
import analytics from "../lib/analytics.js";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY AUTOINCREMENT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS images (path TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS enquiries (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS analytics_days (day TEXT PRIMARY KEY, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS analytics_seen (day TEXT NOT NULL, vid TEXT NOT NULL, PRIMARY KEY (day, vid))",
  "CREATE TABLE IF NOT EXISTS analytics_online (vid TEXT PRIMARY KEY, t INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS photo_sync (path TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, last INTEGER NOT NULL)",
];
let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready = null; throw e; });
  return ready;
}

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

/* ---------- settings ---------- */
export async function getSetting(db, key) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return r ? r.value : null;
}
export const setSetting = (db, key, value) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, value).run();
/* A random secret created once and kept (session signing key, analytics salt). */
export async function secretSetting(db, key) {
  const have = await getSetting(db, key); if (have) return have;
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, randomHex(32)).run();
  return getSetting(db, key); // another request may have created it first
}

/* ---------- content: the live version plus 30 backups, like data/backups on the Node server ---------- */
const KEEP_VERSIONS = 31;
export async function currentContent(db) {
  return db.prepare("SELECT id, updated_at, json FROM content ORDER BY id DESC LIMIT 1").first();
}
export async function saveContent(db, content) {
  await db.batch([
    db.prepare("INSERT INTO content (updated_at, created_at, json) VALUES (?, ?, ?)").bind(String(content.updatedAt || ""), new Date().toISOString(), JSON.stringify(content, null, 2)),
    db.prepare(`DELETE FROM content WHERE id NOT IN (SELECT id FROM content ORDER BY id DESC LIMIT ${KEEP_VERSIONS})`),
  ]);
}
/* Earlier versions, newest first. The name carries the publish time in the format the admin's Backups list reads. */
export async function listBackups(db) {
  const { results } = await db.prepare("SELECT id, created_at, length(json) AS size FROM content ORDER BY id DESC LIMIT -1 OFFSET 1").all();
  return results.map((r) => ({ name: `content-${r.created_at.replace(/[:.]/g, "-")}-v${r.id}.json`, size: r.size }));
}
export async function backupContent(db, name) {
  const m = /-v(\d+)\.json$/.exec(String(name || "")); if (!m) return null;
  const r = await db.prepare("SELECT json FROM content WHERE id = ?").bind(Number(m[1])).first();
  return r ? JSON.parse(r.json) : null;
}

/* ---------- photos uploaded before the move to R2 (copied there by worker/photos.js, then removed) ---------- */
export const getImage = (db, path) => db.prepare("SELECT type, data FROM images WHERE path = ?").bind(path).first();
export async function imagePaths(db) { return (await db.prepare("SELECT path FROM images ORDER BY created_at").all()).results.map((r) => r.path); }

/* ---------- enquiries (same shape as data/enquiries.json) ---------- */
export async function allEnquiries(db) {
  const { results } = await db.prepare("SELECT data FROM enquiries ORDER BY created_at, rowid").all();
  return results.map((r) => JSON.parse(r.data));
}
/* Returns the id it was stored under (a suffix is added if a reference repeats). */
export async function addEnquiry(db, e) {
  const r = await db.prepare("INSERT OR IGNORE INTO enquiries (id, created_at, data) VALUES (?, ?, ?)").bind(e.id, e.createdAt, JSON.stringify(e)).run();
  if (r.meta.changes > 0) return e.id;
  e.id += "-" + randomHex(2).toUpperCase();
  await db.prepare("INSERT INTO enquiries (id, created_at, data) VALUES (?, ?, ?)").bind(e.id, e.createdAt, JSON.stringify(e)).run();
  return e.id;
}
export async function updateEnquiry(db, id, patch) {
  const r = await db.prepare("SELECT data FROM enquiries WHERE id = ?").bind(id).first(); if (!r) return null;
  const e = Object.assign(JSON.parse(r.data), patch, { updatedAt: new Date().toISOString() });
  await db.prepare("UPDATE enquiries SET data = ? WHERE id = ?").bind(JSON.stringify(e), id).run();
  return e;
}
export async function removeEnquiry(db, id) { return (await db.prepare("DELETE FROM enquiries WHERE id = ?").bind(id).run()).meta.changes > 0; }

/* ---------- analytics: one row of daily totals per day (India time), counted by lib/analytics.js ----------
   Two beacons landing at the same instant can both read the day before either writes, losing one count.
   For a site this size that is rare and harmless, and it keeps each visit to a few small writes. */
export async function track(db, body, headers) {
  if (analytics.isBot(headers)) return;
  const t = Date.now(), d = analytics.dayOf(t);
  const vid = analytics.visitorId(await secretSetting(db, "analytics_salt"), d, body, headers);
  const online = db.prepare("INSERT OR REPLACE INTO analytics_online (vid, t) VALUES (?, ?)").bind(vid, t);
  if (body.t === "ping") return online.run();
  let isNew = false;
  if (body.t !== "event") isNew = (await db.prepare("INSERT OR IGNORE INTO analytics_seen (day, vid) VALUES (?, ?)").bind(d, vid).run()).meta.changes > 0;
  const row = await db.prepare("SELECT data FROM analytics_days WHERE day = ?").bind(d).first();
  const rec = row ? JSON.parse(row.data) : analytics.emptyDay();
  if (!analytics.applyBeacon(rec, body, headers, t, isNew)) return online.run();
  const writes = [online, db.prepare("INSERT OR REPLACE INTO analytics_days (day, data) VALUES (?, ?)").bind(d, JSON.stringify(rec))];
  if (!row) writes.push( // first visit of a new day: drop what is no longer needed
    db.prepare("DELETE FROM analytics_days WHERE day < ?").bind(analytics.dayOf(t - analytics.KEEP_DAYS * 86400000)),
    db.prepare("DELETE FROM analytics_seen WHERE day < ?").bind(d),
    db.prepare("DELETE FROM analytics_online WHERE t < ?").bind(t - analytics.ONLINE_MS));
  await db.batch(writes);
}
export async function analyticsSummary(db, days) {
  const n = Math.max(1, Math.min(analytics.KEEP_DAYS, parseInt(days, 10) || 7));
  const from = analytics.dayOf(Date.now() - 2 * n * 86400000);
  const [rows, first, online] = await db.batch([
    db.prepare("SELECT day, data FROM analytics_days WHERE day >= ?").bind(from),
    db.prepare("SELECT MIN(day) AS day FROM analytics_days"),
    db.prepare("SELECT COUNT(*) AS n FROM analytics_online WHERE t > ?").bind(Date.now() - analytics.ONLINE_MS),
  ]);
  const all = {}; rows.results.forEach((r) => (all[r.day] = JSON.parse(r.data)));
  const out = analytics.summarize(all, n, online.results[0].n);
  out.since = first.results[0].day || "";
  return out;
}
export const resetAnalytics = (db) => db.batch(["analytics_days", "analytics_seen", "analytics_online"].map((t) => db.prepare(`DELETE FROM ${t}`)));

/* ---------- failed logins per IP ---------- */
export async function tooManyAttempts(db, ip) {
  const a = await db.prepare("SELECT count, last FROM login_attempts WHERE ip = ?").bind(ip).first();
  return !!a && a.count >= 8 && Date.now() - a.last < 10 * 60 * 1000;
}
export async function noteAttempt(db, ip, good) {
  if (good) return db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  const now = Date.now();
  // A failure more than 10 minutes after the last one starts the count again
  return db.prepare(`INSERT INTO login_attempts (ip, count, last) VALUES (?, 1, ?)
    ON CONFLICT(ip) DO UPDATE SET count = CASE WHEN ? - last > 600000 THEN 1 ELSE count + 1 END, last = ?`).bind(ip, now, now, now).run();
}
