/* ============================================================
   Photos in R2 (binding PHOTOS, bucket carrental-photos)
   The R2 key is the URL path without "assets/img/": cars/thar/07.jpg, promos/diwali.jpg,
   uploads/site/logo.jpg. So the bucket shows the same folders in the Cloudflare dashboard, and
   content.json keeps its paths.

   Photos that came with the repo, and photos uploaded while they were kept in D1, are copied into
   R2 by syncPhotos (cron trigger, plus whenever the admin opens the Library). Each path is copied
   once and remembered in D1 photo_sync, so a photo deleted in the admin or in the R2 dashboard
   stays deleted instead of being copied back or served from the repo.
   ============================================================ */
import REPO_FILES from "./static-images.json"; // every photo file in the repo, incl. "-sm.jpg" thumbnails
import * as store from "./store.js";

export const PHOTO_PATH = /^assets\/img\/(cars|promos|uploads)\/[^?#]+\.(jpe?g|png|webp|gif)$/i;
const keyOf = (path) => path.replace(/^assets\/img\//, "");
const smallOf = (path) => (/\/\d{2}\.jpg$/i.test(path) ? path.replace(/(\/\d{2})\.jpg$/i, "$1-sm.jpg") : "");
const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const typeOf = (path) => TYPES[path.split(".").pop().toLowerCase()] || "application/octet-stream";

async function syncedSet(db) { return new Set((await db.prepare("SELECT path FROM photo_sync").all()).results.map((r) => r.path)); }
const markSynced = (db, paths) => paths.length && db.batch(paths.map((p) => db.prepare("INSERT OR IGNORE INTO photo_sync (path) VALUES (?)").bind(p)));

/* GET /assets/img/(cars|promos|uploads)/... */
export async function servePhoto(request, env, url) {
  let path; try { path = decodeURIComponent(url.pathname.slice(1)); } catch (e) { return new Response("Not found", { status: 404 }); }
  const obj = await env.PHOTOS.get(keyOf(path), { onlyIf: request.headers });
  if (obj) {
    const headers = new Headers({ "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400", ETag: obj.httpEtag, "X-Content-Type-Options": "nosniff" });
    obj.writeHttpMetadata(headers);
    if (!headers.get("Content-Type")) headers.set("Content-Type", typeOf(path));
    return "body" in obj && obj.body ? new Response(obj.body, { headers }) : new Response(null, { status: 304, headers });
  }
  // Not in R2: deleted on purpose, or not copied yet
  if (await env.DB.prepare("SELECT 1 FROM photo_sync WHERE path = ?").bind(path).first()) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-cache" } });
  const row = await store.getImage(env.DB, path);
  if (row) return new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.type, "Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff" } });
  return env.ASSETS.fetch(request);
}

export async function photoExists(env, path) {
  if (await env.PHOTOS.head(keyOf(path))) return true;
  if (await env.DB.prepare("SELECT 1 FROM photo_sync WHERE path = ?").bind(path).first()) return false;
  return REPO_FILES.includes(path) || !!(await store.getImage(env.DB, path));
}

export async function savePhoto(env, path, bytes, type) {
  await env.PHOTOS.put(keyOf(path), bytes, { httpMetadata: { contentType: type } });
  await markSynced(env.DB, [path]);
}

/* Deletes a photo and its "-sm.jpg" thumbnail. Returns false for a path that isn't a site photo. */
export async function deletePhoto(env, path) {
  if (!PHOTO_PATH.test(path) || path.includes("..")) return false;
  const paths = [path, smallOf(path)].filter(Boolean);
  await env.PHOTOS.delete(paths.map(keyOf));
  await env.DB.batch(paths.map((p) => env.DB.prepare("DELETE FROM images WHERE path = ?").bind(p)));
  await markSynced(env.DB, paths); // never copy these back from the repo
  return true;
}

/* Admin → Library: everything in R2, plus photos still waiting to be copied. Thumbnails are left out. */
export async function listPhotos(env) {
  const inR2 = new Set();
  let cursor;
  do {
    const page = await env.PHOTOS.list({ cursor, limit: 1000 });
    page.objects.forEach((o) => inR2.add("assets/img/" + o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const synced = await syncedSet(env.DB);
  const waiting = [...REPO_FILES, ...(await store.imagePaths(env.DB))].filter((p) => !synced.has(p));
  return [...new Set([...inR2, ...waiting])].filter((p) => PHOTO_PATH.test(p) && !/-sm\.jpg$/i.test(p)).sort();
}

/* Copies up to `limit` photos from D1 and the repo into R2. Returns how many are still waiting. */
export async function syncPhotos(env, limit = 60) {
  const db = env.DB, synced = await syncedSet(db), done = [];
  const legacy = (await store.imagePaths(db)).filter((p) => !synced.has(p));
  const repo = REPO_FILES.filter((p) => !synced.has(p));
  for (const path of [...legacy, ...repo].slice(0, limit)) {
    if (!(await env.PHOTOS.head(keyOf(path)))) { // something put there by hand wins
      const row = await store.getImage(db, path);
      let bytes = row ? new Uint8Array(row.data) : null, type = row ? row.type : typeOf(path);
      if (!row) { const r = await env.ASSETS.fetch(new Request("https://assets.local/" + path)); if (r.ok) bytes = await r.arrayBuffer(); }
      if (bytes) await env.PHOTOS.put(keyOf(path), bytes, { httpMetadata: { contentType: type } });
    }
    done.push(path);
    if (done.length % 20 === 0) await markSynced(db, done.slice(-20));
  }
  await markSynced(db, done.slice(done.length - (done.length % 20)));
  // Uploads now live in R2, so free the D1 copies
  const moved = legacy.filter((p) => done.includes(p));
  if (moved.length) await db.batch(moved.map((p) => db.prepare("DELETE FROM images WHERE path = ?").bind(p)));
  return legacy.length + repo.length - done.length;
}

export async function photoStatus(env) {
  const synced = await syncedSet(env.DB);
  const waiting = REPO_FILES.filter((p) => !synced.has(p)).length + (await store.imagePaths(env.DB)).filter((p) => !synced.has(p)).length;
  return { storage: "r2", waiting };
}
